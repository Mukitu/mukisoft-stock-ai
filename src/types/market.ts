export type Exchange = 'DSE' | 'CSE';
export type ActionType = 'BUY' | 'HOLD' | 'SELL' | 'SIDEWAYS';

export interface OhlcvPoint {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface IndicatorVote {
  name: string;
  bullish: boolean;
  label_bn: string;
}

export interface SupportResistance {
  s1: number;
  s2: number;
  r1: number;
  r2: number;
}

export interface TechnicalIndicators {
  sma5: number;
  sma10: number;
  sma20: number;
  ema9: number;
  ema20: number;
  rsi14: number;
  rsi7: number;
  macd: number;
  macd_hist: number;
  bb_upper: number;
  bb_lower: number;
  bb_width_pct: number;
  channel_range_pct: number;
  stoch_k: number;
  williams_r: number;
  roc3: number;
  roc5: number;
  roc10: number;
  cci: number;
  atr14: number;
}

export interface StockAnalysis {
  symbol: string;
  exchange: Exchange;
  current_price: number;
  change_pct: number;
  signal: string;
  signal_code: 0 | 1 | 2;
  action_type: ActionType;
  ml_signal: string;
  ml_signal_code: 0 | 1 | 2;
  confidence: number;
  rsi: number;
  target_price: number;
  stop_loss: number;
  support_resistance: SupportResistance;
  bull_votes: number;
  bear_votes: number;
  total_votes: number;
  votes: IndicatorVote[];
  is_sideways: boolean;
  indicators: TechnicalIndicators;
  ai_analysis_bn: string;
  chart_history: OhlcvPoint[];
  data_source: string;
  is_fallback?: boolean;
}

export interface TopPick {
  symbol: string;
  exchange: Exchange;
  price: number;
  change_pct: number;
  signal_code: number;
  signal: string;
  confidence: number;
  buy_score: number;
  target_price: number;
  stop_loss: number;
  rsi: number;
  bull_votes?: number;
}

export interface MarketSessionInfo {
  is_live: boolean;
  mode: 'LIVE' | 'PRE_MARKET' | 'WEEKEND' | 'DAILY_LOCK';
  badge: string;
  headline: string;
  subtext: string;
  cardTiming: string;
  bd_time: string;
}

export interface MarketLiveTicker {
  status: 'live' | 'degraded' | 'offline';
  is_stale: boolean;
  dsex: string;
  ds30: string;
  updated: string;
  session: MarketSessionInfo;
}

export interface TopPicksResponse {
  generated_at_bst: string;
  source: 'live_api' | 'daily_snapshot';
  picks: TopPick[];
}

export interface ManualStockPayload {
  symbol: string;
  exchange: Exchange;
  open_price: number;
  high_price: number;
  low_price: number;
  close_price: number;
  yesterday_close: number;
  volume: number;
}
