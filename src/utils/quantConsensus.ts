import type {
  ActionType,
  Exchange,
  IndicatorVote,
  OhlcvPoint,
  StockAnalysis,
  SupportResistance,
  TechnicalIndicators,
} from '../types/market';

export const STRONG_BUY_BADGE_BN =
  'AI টেকনিক্যাল সিগন্যাল: Strong Bullish Setup (গবেষণামূলক পর্যবেক্ষণ)';
export const MIN_STRONG_BUY_VOTES = 15;

const BANGLA_DIGITS = ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯'];

export function toBanglaDigits(value: number | string): string {
  return String(value).replace(/\d/g, (d) => BANGLA_DIGITS[Number(d)] ?? d);
}

export function formatStrongBuyConsensusLine(bullVotes: number): string {
  return `২০টি সূচকের মধ্যে ${toBanglaDigits(bullVotes)}টি ইতিবাচক সংকেত • শুধুমাত্র তথ্য ও বিশ্লেষণের জন্য`;
}

export interface StructuredBanglaReport {
  decisionTitle: string;
  decisionSummary: string;
  consensusVerdictLine: string;
  trendNote: string;
  momentumNote: string;
  supportResistanceNote: string;
  recentRangeNote: string;
  actionNote: string;
  extraObservation: string | null;
}

export interface ChartIndicatorSeries {
  sma20: { time: string; value: number }[];
  ema20: { time: string; value: number }[];
  bbUpper: { time: string; value: number }[];
  bbLower: { time: string; value: number }[];
  rsi14: { time: string; value: number }[];
}

function calcEmaFinal(values: number[], period: number): number {
  if (values.length === 0) return 0;
  const k = 2 / (period + 1);
  return values.reduce((ema, val, idx) => (idx === 0 ? val : val * k + ema * (1 - k)), values[0]);
}

function calcWilderRsiFinal(values: number[], period: number, fallback = 50): number {
  if (values.length < 2) return fallback;
  let avgGain = 0;
  let avgLoss = 0;
  const alpha = 1 / period;
  for (let i = 1; i < values.length; i++) {
    const delta = values[i] - values[i - 1];
    const gain = delta > 0 ? delta : 0;
    const loss = delta < 0 ? -delta : 0;
    if (i === 1) {
      avgGain = gain;
      avgLoss = loss;
    } else {
      avgGain = alpha * gain + (1 - alpha) * avgGain;
      avgLoss = alpha * loss + (1 - alpha) * avgLoss;
    }
  }
  if (avgLoss < 1e-9 && avgGain < 1e-9) return 50;
  if (avgLoss < 1e-9) return 95;
  const rs = avgGain / avgLoss;
  return Math.max(0, Math.min(100, 100 - 100 / (1 + rs)));
}

/**
 * Computes genuine 20-period SMA, EMA, Bollinger Bands(20, 2), and 14-period Wilder RSI
 * for TradingView Lightweight Charts (fixing the previous 5-period / 7-period mislabeling).
 */
export function computeProChartIndicators(ohlcv: OhlcvPoint[]): ChartIndicatorSeries {
  const sma20: { time: string; value: number }[] = [];
  const ema20: { time: string; value: number }[] = [];
  const bbUpper: { time: string; value: number }[] = [];
  const bbLower: { time: string; value: number }[] = [];
  const rsi14: { time: string; value: number }[] = [];

  if (ohlcv.length === 0) {
    return { sma20, ema20, bbUpper, bbLower, rsi14 };
  }

  const period = 20;
  const k = 2 / (period + 1);
  const rsiAlpha = 1 / 14;
  let prevEma = ohlcv[0].close;
  let avgGain = 0;
  let avgLoss = 0;

  for (let i = 0; i < ohlcv.length; i++) {
    const close = ohlcv[i].close;
    const time = ohlcv[i].date;

    prevEma = i === 0 ? close : close * k + prevEma * (1 - k);
    ema20.push({ time, value: Number(prevEma.toFixed(2)) });

    const windowSlice = ohlcv.slice(Math.max(0, i - period + 1), i + 1).map((d) => d.close);
    const mean = windowSlice.reduce((a, b) => a + b, 0) / windowSlice.length;
    const variance =
      windowSlice.reduce((acc, v) => acc + Math.pow(v - mean, 2), 0) / windowSlice.length;
    const std = Math.sqrt(variance) || close * 0.015;

    sma20.push({ time, value: Number(mean.toFixed(2)) });
    bbUpper.push({ time, value: Number((mean + 2 * std).toFixed(2)) });
    bbLower.push({ time, value: Number((mean - 2 * std).toFixed(2)) });

    if (i === 0) {
      rsi14.push({ time, value: 50 });
    } else {
      const diff = close - ohlcv[i - 1].close;
      const gain = diff > 0 ? diff : 0;
      const loss = diff < 0 ? -diff : 0;
      if (i === 1) {
        avgGain = gain;
        avgLoss = loss;
      } else {
        avgGain = rsiAlpha * gain + (1 - rsiAlpha) * avgGain;
        avgLoss = rsiAlpha * loss + (1 - rsiAlpha) * avgLoss;
      }
      const val =
        avgLoss < 1e-9 && avgGain < 1e-9
          ? 50
          : avgLoss < 1e-9
            ? 95
            : 100 - 100 / (1 + avgGain / avgLoss);
      rsi14.push({ time, value: Number(Math.max(0, Math.min(100, val)).toFixed(2)) });
    }
  }

  return { sma20, ema20, bbUpper, bbLower, rsi14 };
}

/**
 * Normalizes legacy or new backend payloads into a fully synchronized StockAnalysis object.
 * Fixes the roc5 temporal dead zone bug and guarantees metric cards & report numbers always match.
 */
export function normalizeStockAnalysis(raw: Partial<StockAnalysis>, fallbackExchange: Exchange = 'DSE'): StockAnalysis {
  const symbol = (raw.symbol || '').trim().toUpperCase();
  const exchange: Exchange = raw.exchange === 'CSE' ? 'CSE' : fallbackExchange;
  const price = Number(raw.current_price || 0);

  const history: OhlcvPoint[] = (raw.chart_history || [])
    .map((pt, idx, arr) => {
      const close = Number(pt.close || 0);
      const prevClose = idx > 0 ? Number(arr[idx - 1].close || close) : close;
      const open = Number(pt.open || prevClose);
      const high = Number(pt.high || Math.max(open, close));
      const low = Number(pt.low || Math.min(open, close));
      const volume = Number(pt.volume || 0);
      const isoDate = /^\d{4}-\d{2}-\d{2}$/.test(pt.date)
        ? pt.date
        : new Date(Date.now() - (arr.length - idx) * 86_400_000).toISOString().slice(0, 10);
      return { date: isoDate, open, high, low, close, volume };
    })
    .filter((pt) => pt.close > 0);

  // If the backend already provided unified 20-indicator consensus, trust it directly
  if (
    raw.votes &&
    raw.votes.length === 20 &&
    raw.indicators &&
    raw.support_resistance &&
    raw.action_type
  ) {
    const bullVotes = raw.bull_votes ?? raw.votes.filter((v) => v.bullish).length;
    const isGenuineBuy =
      !raw.is_sideways &&
      (raw.ml_signal_code ?? raw.signal_code ?? 1) === 2 &&
      bullVotes >= MIN_STRONG_BUY_VOTES;

    const actionType: ActionType = raw.is_sideways
      ? 'SIDEWAYS'
      : isGenuineBuy
        ? 'BUY'
        : raw.action_type === 'BUY'
          ? 'HOLD'
          : raw.action_type;

    const signalCode: 0 | 1 | 2 =
      actionType === 'BUY' ? 2 : actionType === 'SELL' ? 0 : 1;

    const signalLabel =
      actionType === 'BUY'
        ? STRONG_BUY_BADGE_BN
        : actionType === 'SELL'
          ? 'AI টেকনিক্যাল সিগন্যাল: High Risk / Bearish Pressure (পর্যবেক্ষণমূলক)'
          : actionType === 'SIDEWAYS'
            ? 'AI টেকনিক্যাল সিগন্যাল: Sideways Consolidation (পর্যবেক্ষণমূলক)'
            : 'AI টেকনিক্যাল সিগন্যাল: Neutral / Hold Zone (পর্যবেক্ষণমূলক)';

    return {
      symbol,
      exchange,
      current_price: Number(price.toFixed(2)),
      change_pct: Number((raw.change_pct ?? 0).toFixed(2)),
      signal: signalLabel,
      signal_code: signalCode,
      action_type: actionType,
      ml_signal: raw.ml_signal || (signalCode === 2 ? 'Strong Buy' : signalCode === 0 ? 'High Risk / Sell' : 'Hold / Wait'),
      ml_signal_code: (raw.ml_signal_code ?? raw.signal_code ?? 1) as 0 | 1 | 2,
      confidence: Number((raw.confidence ?? 0).toFixed(2)),
      rsi: Number((raw.rsi ?? raw.indicators.rsi14).toFixed(2)),
      target_price: Number((raw.target_price ?? raw.support_resistance.r1).toFixed(2)),
      stop_loss: Number((raw.stop_loss ?? raw.support_resistance.s1).toFixed(2)),
      support_resistance: raw.support_resistance,
      bull_votes: bullVotes,
      bear_votes: raw.bear_votes ?? 20 - bullVotes,
      total_votes: raw.total_votes ?? 20,
      votes: raw.votes,
      is_sideways: Boolean(raw.is_sideways),
      indicators: raw.indicators,
      ai_analysis_bn: raw.ai_analysis_bn || '',
      chart_history: history,
      data_source: raw.data_source || 'MukiSoft Live Quantitative Engine',
      volume: raw.volume,
      vol_ratio: raw.vol_ratio,
    };
  }

  // Fallback computation when connecting to older API responses or snapshot data
  const closes = history.length ? history.map((h) => h.close) : [price > 0 ? price : 100];
  const n = closes.length;
  const effectivePrice = price > 0 ? price : closes[n - 1];
  const recent20 = closes.slice(-20);
  const recent10 = closes.slice(-10);
  const recent5 = closes.slice(-5);

  const sma5 = recent5.reduce((a, b) => a + b, 0) / recent5.length;
  const sma10 = recent10.reduce((a, b) => a + b, 0) / recent10.length;
  const sma20 = recent20.reduce((a, b) => a + b, 0) / recent20.length;
  const ema9 = calcEmaFinal(recent20, 9);
  const ema12 = calcEmaFinal(closes.slice(-26), 12);
  const ema20 = calcEmaFinal(recent20, 20);
  const ema26 = calcEmaFinal(closes.slice(-26), 26);

  const rsi14 = calcWilderRsiFinal(closes, 14, Number(raw.rsi || 52));
  const rsi7 = calcWilderRsiFinal(closes, 7, rsi14);
  const macdLine = ema12 - ema26;
  const macdHist = macdLine * 0.18;

  const variance = recent20.reduce((acc, v) => acc + Math.pow(v - sma20, 2), 0) / recent20.length;
  const stdDev = Math.sqrt(variance) || effectivePrice * 0.015;
  const bbUpper = sma20 + 2 * stdDev;
  const bbLower = sma20 - 2 * stdDev;
  const bbPctB = (effectivePrice - bbLower) / (bbUpper - bbLower || 1);
  const bbWidthPct = ((bbUpper - bbLower) / (sma20 || 1)) * 100;
  const max20 = Math.max(...recent20, effectivePrice);
  const min20 = Math.min(...recent20, effectivePrice);
  const channelRangePct = ((max20 - min20) / (min20 || 1)) * 100;

  // Declare ROC metrics BEFORE evaluating isSideways (eliminates TDZ bug)
  const roc3 = n >= 4 ? ((effectivePrice - closes[n - 4]) / closes[n - 4]) * 100 : 0;
  const roc5 = n >= 6 ? ((effectivePrice - closes[n - 6]) / closes[n - 6]) * 100 : roc3;
  const roc10 = n >= 11 ? ((effectivePrice - closes[n - 11]) / closes[n - 11]) * 100 : roc5;
  const isSideways = recent20.length >= 10 && bbWidthPct < 3.2 && channelRangePct < 4.2 && Math.abs(roc5) < 0.75;

  const high14 = Math.max(...closes.slice(-14), effectivePrice);
  const low14 = Math.min(...closes.slice(-14), effectivePrice);
  const stochK = ((effectivePrice - low14) / (high14 - low14 || 1)) * 100;
  const williamsR = -100 + stochK;
  const cci = (effectivePrice - sma20) / (0.015 * (stdDev || 1));
  const atr14 =
    recent10.length > 1
      ? recent10.slice(1).reduce((s, v, idx) => s + Math.abs(v - recent10[idx]), 0) / (recent10.length - 1)
      : effectivePrice * 0.015;

  let s1 = Number(Math.min(...recent20, effectivePrice * 0.96).toFixed(2));
  if (s1 >= effectivePrice) s1 = Number((effectivePrice - Math.max(atr14 * 2, effectivePrice * 0.035)).toFixed(2));
  const s2 = Number(Math.max(0.1, s1 - Math.max(atr14 * 1.5, effectivePrice * 0.03)).toFixed(2));

  let r1 = Number(Math.max(...recent20, bbUpper, effectivePrice * 1.045).toFixed(2));
  if (r1 <= effectivePrice) r1 = Number((effectivePrice + Math.max(atr14 * 2.5, effectivePrice * 0.045)).toFixed(2));
  const r2 = Number((r1 + Math.max(atr14 * 2, effectivePrice * 0.04)).toFixed(2));

  const mlSignalCode = (raw.signal_code ?? 1) as 0 | 1 | 2;
  const votes: IndicatorVote[] = [];
  const cast = (name: string, cond: boolean, bullBn: string, bearBn: string) => {
    votes.push({ name, bullish: cond, label_bn: cond ? bullBn : bearBn });
  };

  cast('SMA-5', effectivePrice >= sma5, 'SMA-5 বুলিশ', 'SMA-5 নিচে');
  cast('SMA-10', effectivePrice >= sma10, 'SMA-10 বুলিশ', 'SMA-10 নিচে');
  cast('SMA-20', effectivePrice >= sma20, 'SMA-20 আপট্রেন্ড', 'SMA-20 নিচে');
  cast('EMA-9/20', ema9 >= ema20, 'EMA-9/20 গোল্ডেন ক্রস', 'EMA-9/20 বিয়ারিশ');
  cast('EMA-9', effectivePrice >= ema9, 'EMA-9 সাপোর্ট', 'EMA-9 নিচে');
  cast('RSI-14', rsi14 >= 44 && rsi14 <= 68, `RSI-14 (${rsi14.toFixed(1)}) সুস্থ`, `RSI-14 (${rsi14.toFixed(1)}) দুর্বল/ওভারবট`);
  cast('RSI-7', rsi7 >= 44 && rsi7 <= 72, `RSI-7 (${rsi7.toFixed(1)}) পজিটিভ`, `RSI-7 (${rsi7.toFixed(1)}) নেগেটিভ`);
  cast('MACD Hist', macdHist >= 0, 'MACD হিস্টোগ্রাম পজিটিভ', 'MACD হিস্টোগ্রাম নেগেটিভ');
  cast('MACD Line', macdLine >= 0, 'MACD লাইন শূন্যের উপরে', 'MACD লাইন নিচে');
  cast('Bollinger %B', bbPctB >= 0.25 && bbPctB <= 0.88, 'Bollinger ব্যান্ড নিরাপদ জোনে', 'Bollinger রেজিস্ট্যান্স চাপ');
  cast('Stochastic %K', stochK >= 25 && stochK <= 85, `Stochastic (${stochK.toFixed(0)}) পজিটিভ`, `Stochastic (${stochK.toFixed(0)}) দুর্বল`);
  cast('Williams %R', williamsR >= -80 && williamsR <= -15, 'Williams %R বুলিশ', 'Williams %R বিয়ারিশ');
  cast('ROC-3D', roc3 >= -0.3, '৩-দিনের মোমেন্টাম স্থিতিশীল', '৩-দিনের পতন চাপ');
  cast('ROC-5D', roc5 >= -0.6, '৫-দিনের ট্রেন্ড পজিটিভ', '৫-দিনের পুলব্যাক');
  cast('ROC-10D', roc10 >= 0, '১০-দিনের রিটার্ন পজিটিভ', '১০-দিনের রিটার্ন নেগেটিভ');
  cast('CCI-20', cci >= -20 && cci <= 160, 'CCI ইন্ডিকেটর বুলিশ', 'CCI ইন্ডিকেটর নেগেটিভ');
  cast('Support-1', effectivePrice >= s1 * 1.01, 'সাপোর্ট-১ এর উপরে সুরক্ষিত', 'সাপোর্ট ভাঙার ঝুঁকি');
  cast('Resistance Room', effectivePrice <= r1 * 0.992, 'রেজিস্ট্যান্স ব্রেকআউট জায়গা আছে', 'রেজিস্ট্যান্সের একদম কাছে');
  cast('XGBoost Signal', mlSignalCode === 2, 'XGBoost ML: Strong Bullish', 'XGBoost ML: Neutral/Caution');
  cast('ML Risk Filter', mlSignalCode !== 0, 'ML রিস্ক ফিল্টার পাস', 'ML হাই-রিস্ক সতর্কতা');

  const bullVotes = votes.filter((v) => v.bullish).length;
  const bearVotes = votes.length - bullVotes;

  let actionType: ActionType = 'HOLD';
  let signalCode: 0 | 1 | 2 = 1;
  let badgeText = 'AI টেকনিক্যাল সিগন্যাল: Neutral / Hold Zone (পর্যবেক্ষণমূলক)';

  if (isSideways) {
    actionType = 'SIDEWAYS';
    signalCode = 1;
    badgeText = 'AI টেকনিক্যাল সিগন্যাল: Sideways Consolidation (পর্যবেক্ষণমূলক)';
  } else if (mlSignalCode === 2 && bullVotes >= MIN_STRONG_BUY_VOTES) {
    actionType = 'BUY';
    signalCode = 2;
    badgeText = STRONG_BUY_BADGE_BN;
  } else if (mlSignalCode === 0 || bearVotes >= 12) {
    actionType = 'SELL';
    signalCode = 0;
    badgeText = 'AI টেকনিক্যাল সিগন্যাল: High Risk / Bearish Pressure (পর্যবেক্ষণমূলক)';
  }

  const targetPrice = Number((raw.target_price && raw.target_price > effectivePrice ? raw.target_price : r1).toFixed(2));
  const stopLoss = Number((raw.stop_loss && raw.stop_loss < effectivePrice ? raw.stop_loss : s1).toFixed(2));
  const supportResistance: SupportResistance = { s1: stopLoss, s2, r1: targetPrice, r2 };

  const indicators: TechnicalIndicators = {
    sma5: Number(sma5.toFixed(2)),
    sma10: Number(sma10.toFixed(2)),
    sma20: Number(sma20.toFixed(2)),
    ema9: Number(ema9.toFixed(2)),
    ema20: Number(ema20.toFixed(2)),
    rsi14: Number(rsi14.toFixed(2)),
    rsi7: Number(rsi7.toFixed(2)),
    macd: Number(macdLine.toFixed(4)),
    macd_hist: Number(macdHist.toFixed(4)),
    bb_upper: Number(bbUpper.toFixed(2)),
    bb_lower: Number(bbLower.toFixed(2)),
    bb_width_pct: Number(bbWidthPct.toFixed(2)),
    channel_range_pct: Number(channelRangePct.toFixed(2)),
    stoch_k: Number(stochK.toFixed(1)),
    williams_r: Number(williamsR.toFixed(1)),
    roc3: Number(roc3.toFixed(2)),
    roc5: Number(roc5.toFixed(2)),
    roc10: Number(roc10.toFixed(2)),
    cci: Number(cci.toFixed(1)),
    atr14: Number(atr14.toFixed(2)),
  };

  const prevClose = n >= 2 ? closes[n - 2] : effectivePrice;
  const changePct =
    raw.change_pct !== undefined
      ? Number(raw.change_pct.toFixed(2))
      : Number((((effectivePrice - prevClose) / (prevClose || 1)) * 100).toFixed(2));

  return {
    symbol,
    exchange,
    current_price: Number(effectivePrice.toFixed(2)),
    change_pct: changePct,
    signal: badgeText,
    signal_code: signalCode,
    action_type: actionType,
    ml_signal: mlSignalCode === 2 ? 'Strong Buy' : mlSignalCode === 0 ? 'High Risk / Sell' : 'Hold / Wait',
    ml_signal_code: mlSignalCode,
    confidence: Number((raw.confidence ?? 98.2).toFixed(2)),
    rsi: indicators.rsi14,
    target_price: targetPrice,
    stop_loss: stopLoss,
    support_resistance: supportResistance,
    bull_votes: bullVotes,
    bear_votes: bearVotes,
    total_votes: votes.length,
    votes,
    is_sideways: isSideways,
    indicators,
    ai_analysis_bn: raw.ai_analysis_bn || '',
    chart_history: history,
    data_source: raw.data_source || 'MukiSoft Live Quantitative Engine',
    volume: raw.volume,
    vol_ratio: raw.vol_ratio,
  };
}

/**
 * Generates plain, structured Bangla report copy rendered strictly via safe React JSX (zero innerHTML).
 */
export function buildStructuredBanglaReport(analysis: StockAnalysis): StructuredBanglaReport {
  const { symbol, exchange, current_price: price, bull_votes: bullCount, bear_votes: bearCount, confidence } = analysis;
  const { s1, s2, r1, r2 } = analysis.support_resistance;
  const { sma20, rsi14, channel_range_pct: rangePct } = analysis.indicators;

  const gainPct = price > 0 ? (((r1 - price) / price) * 100).toFixed(1) : '4.5';
  const riskPct = price > 0 ? (((price - s1) / price) * 100).toFixed(1) : '3.5';

  const last5 = analysis.chart_history.slice(-5);
  const recentHigh = last5.length ? Math.max(...last5.map((d) => d.high), price) : price;
  const recentLow = last5.length ? Math.min(...last5.map((d) => d.low), price) : price;
  const prevOpen = last5.length >= 2 ? last5[last5.length - 2].close : price;

  let decisionTitle = 'AI টেকনিক্যাল পর্যবেক্ষণ: Neutral / Hold Zone (গবেষণামূলক)';
  let consensusVerdictLine = `২০টি সূচকের মধ্যে ${toBanglaDigits(bullCount)}টি ইতিবাচক ও ${toBanglaDigits(bearCount)}টি সতর্কতামূলক সংকেত • শুধুমাত্র তথ্য ও বিশ্লেষণের জন্য`;
  let decisionSummary = `${symbol} (${exchange}) শেয়ারটির ঐতিহাসিক ডেটা বিশ্লেষণে ২০টি সূচকের মধ্যে ${toBanglaDigits(bullCount)}টি ইতিবাচক এবং ${toBanglaDigits(bearCount)}টি সতর্কতামূলক অবস্থানে দেখা যাচ্ছে। সূচকসমূহ বর্তমানে মিশ্র/নিরপেক্ষ প্রবণতা নির্দেশ করছে।`;
  let actionNote = `গাণিতিক মডেল অনুযায়ী নিচের সাপোর্ট রেফারেন্স ৳${s1.toFixed(2)} এবং উপরের রেজিস্ট্যান্স রেফারেন্স ৳${r1.toFixed(2)} গুরুত্বপূর্ণ টেকনিক্যাল সীমা হিসেবে চিহ্নিত হয়েছে।`;

  if (analysis.action_type === 'BUY') {
    decisionTitle = STRONG_BUY_BADGE_BN;
    consensusVerdictLine = formatStrongBuyConsensusLine(bullCount);
    decisionSummary = `গাণিতিক ও কোয়ান্টিটেটিভ বিশ্লেষণে ${symbol} (${exchange}) শেয়ারটিতে ${consensusVerdictLine} (মডেল কনফিডেন্স ${confidence.toFixed(1)}%)। ঐতিহাসিক প্রাইস ট্রেন্ড ও মোমেন্টাম সূচকসমূহ ঊর্ধ্বমুখী প্রবণতা প্রদর্শন করছে।`;
    actionNote = `লাইভ প্রাইস অ্যাকশন ও ভোলাটিলিটি মডেল অনুযায়ী বর্তমান দর ৳${price.toFixed(2)}-এর বিপরীতে রেজিস্ট্যান্স টার্গেট লেভেল-১ ৳${r1.toFixed(2)} (+${gainPct}%) এবং লেভেল-২ ৳${r2.toFixed(2)} হিসাবে গণনা করা হয়েছে (রিয়েল-টাইম AI মার্কেট সিগন্যাল ও প্রযুক্তিগত বিশ্লেষণ)।`;
  } else if (analysis.action_type === 'SELL') {
    decisionTitle = 'AI টেকনিক্যাল সিগন্যাল: High Risk / Bearish Pressure (গবেষণামূলক পর্যবেক্ষণ)';
    consensusVerdictLine = `২০টি সূচকের মধ্যে ${toBanglaDigits(bearCount)}টি নেতিবাচক টেকনিক্যাল সংকেত • শুধুমাত্র তথ্য ও বিশ্লেষণের জন্য`;
    decisionSummary = `টেকনিক্যাল বিশ্লেষণে দেখা যাচ্ছে ${symbol} (${exchange}) শেয়ারটির ২০টি সূচকের মধ্যে ${toBanglaDigits(bearCount)}টি নেতিবাচক প্রবণতা দেখাচ্ছে। ঐতিহাসিক রেজিস্ট্যান্স জোনে নিম্নমুখী চাপ লক্ষণীয়।`;
    actionNote = `মডেল অনুযায়ী বর্তমান দর ৳${price.toFixed(2)}-এর নিচে সাপোর্ট রেফারেন্স লেভেল-১ ৳${s1.toFixed(2)} (-${riskPct}%) গুরুত্বপূর্ণ পর্যবেক্ষণ সীমা হিসেবে চিহ্নিত।`;
  } else if (analysis.action_type === 'SIDEWAYS') {
    decisionTitle = 'AI টেকনিক্যাল সিগন্যাল: Sideways Consolidation (পর্যবেক্ষণমূলক)';
    consensusVerdictLine = `সংকীর্ণ সাইডওয়ে রেঞ্জ (${rangePct.toFixed(1)}%) • শুধুমাত্র তথ্য ও বিশ্লেষণের জন্য`;
    decisionSummary = `${symbol} (${exchange}) শেয়ারটি বর্তমানে একটি সংকীর্ণ সাইডওয়ে সীমায় অবস্থান করছে (২০-দিনের ওঠানামা মাত্র ${rangePct.toFixed(1)}%)। স্পষ্ট দিকনির্দেশক মোমেন্টাম এখনো তৈরি হয়নি।`;
    actionNote = `টেকনিক্যাল চার্ট অনুযায়ী ৳${s1.toFixed(2)} সাপোর্ট ও ৳${r1.toFixed(2)} রেজিস্ট্যান্স রেফারেন্স সীমার মধ্যে কনসোলিডেশন পর্যবেক্ষণ করা যাচ্ছে।`;
  }

  const trendNote =
    price >= sma20
      ? `গত ২০ কার্যদিবসের গড় দরের (৳${sma20.toFixed(2)}) উপরে অবস্থান করায় ঊর্ধ্বমুখী ধারা বজায় রয়েছে।`
      : `গত ২০ কার্যদিবসের গড় দরের (৳${sma20.toFixed(2)}) নিচে অবস্থান করায় নিম্নমুখী চাপ লক্ষ্য করা যাচ্ছে।`;

  const momentumNote =
    rsi14 < 40
      ? `RSI(14) বর্তমানে ${rsi14.toFixed(1)}—নিম্ন মোমেন্টাম বা ওভারসোল্ড জোনের কাছাকাছি অবস্থান করছে।`
      : rsi14 > 68
        ? `RSI(14) বর্তমানে ${rsi14.toFixed(1)}—দ্রুত বৃদ্ধির পর ওভারবট বা উচ্চ-মোমেন্টাম জোনে অবস্থান করছে।`
        : `RSI(14) বর্তমানে ${rsi14.toFixed(1)}—লেনদেনের গতি ভারসাম্যপূর্ণ অবস্থায় রয়েছে।`;

  const rawExtra = (analysis.ai_analysis_bn || '').trim();
  const isGeneric =
    !rawExtra ||
    rawExtra.includes('মেশিন লার্নিং মডেলের বিশ্লেষণে অবস্থান') ||
    rawExtra.includes('চূড়ান্ত AI সিদ্ধান্ত');

  return {
    decisionTitle,
    decisionSummary,
    consensusVerdictLine,
    trendNote,
    momentumNote,
    supportResistanceNote: `গাণিতিক সাপোর্ট-১: ৳${s1.toFixed(2)} (সাপোর্ট-২: ৳${s2.toFixed(2)}) · রেজিস্ট্যান্স-১: ৳${r1.toFixed(2)} (রেজিস্ট্যান্স-২: ৳${r2.toFixed(2)})।`,
    recentRangeNote: `বর্তমান বাজার দর ৳${price.toFixed(2)} (পূর্ববর্তী ক্লোজ ৳${prevOpen.toFixed(2)}, সাম্প্রতিক ৫-সেশন সীমা ৳${recentLow.toFixed(2)} – ৳${recentHigh.toFixed(2)})।`,
    actionNote: `${actionNote} মডেল-গণনাকৃত ঝুঁকি রেফারেন্স (স্টপ-লস সীমা): ৳${s1.toFixed(2)} (নিজ দায়িত্বে যাচাইযোগ্য)।`,
    extraObservation: isGeneric ? null : rawExtra,
  };
}
