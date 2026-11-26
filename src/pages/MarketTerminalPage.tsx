import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { RotateCcw } from 'lucide-react';
import type { Exchange } from '../types/market';
import { DSE_CSE_SECTORS, findSectorBySymbol } from '../data/symbolCatalog';
import { useStockAnalysis } from '../hooks/useMarketQueries';
import {
  TradingViewTerminal,
  type TerminalIndicatorToggles,
} from '../components/charts/TradingViewTerminal';
import { buildStructuredBanglaReport } from '../utils/quantConsensus';

const SECTOR_NAMES = Object.keys(DSE_CSE_SECTORS);

export function MarketTerminalPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialSymbol = (searchParams.get('symbol') || 'SQURPHARMA').trim().toUpperCase();
  const initialExchange: Exchange = searchParams.get('exchange')?.toUpperCase() === 'CSE' ? 'CSE' : 'DSE';

  const [exchange, setExchange] = useState<Exchange>(initialExchange);
  const [sector, setSector] = useState<string>(() => {
    const found = findSectorBySymbol(initialSymbol);
    return SECTOR_NAMES.includes(found) ? found : SECTOR_NAMES[0];
  });
  const [symbol, setSymbol] = useState<string>(initialSymbol);
  const [resetCounter, setResetCounter] = useState(0);

  const [toggles, setToggles] = useState<TerminalIndicatorToggles>({
    sma: true,
    ema: true,
    bb: true,
    vol: true,
    rsi: true,
  });

  const { data: analysis, isFetching } = useStockAnalysis(symbol, exchange, true);
  const report = analysis ? buildStructuredBanglaReport(analysis) : null;

  const updateSelection = (nextSym: string, nextExch: Exchange) => {
    setSymbol(nextSym);
    setExchange(nextExch);
    setSearchParams({ symbol: nextSym, exchange: nextExch });
  };

  const toggleKey = (key: keyof TerminalIndicatorToggles) => {
    setToggles((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const indicatorButtons: { key: keyof TerminalIndicatorToggles; label: string }[] = [
    { key: 'sma', label: 'SMA (20)' },
    { key: 'ema', label: 'EMA (20)' },
    { key: 'bb', label: 'Bollinger (20,2)' },
    { key: 'vol', label: 'Volume' },
    { key: 'rsi', label: 'RSI (14)' },
  ];

  return (
    <main className="max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 flex-1 space-y-5">
      {/* Toolbar: Exchange, Sector, Pair & Indicators */}
      <section className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-3 items-end">
          <div className="lg:col-span-2">
            <label className="block text-[11px] font-semibold text-slate-500 mb-1">এক্সচেঞ্জ</label>
            <div className="flex bg-slate-100 p-1 rounded-xl border border-slate-200">
              {(['DSE', 'CSE'] as Exchange[]).map((ex) => (
                <button
                  key={ex}
                  type="button"
                  onClick={() => updateSelection(symbol, ex)}
                  className={`flex-1 py-2 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                    exchange === ex
                      ? 'bg-blue-700 text-white'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {ex}
                </button>
              ))}
            </div>
          </div>

          <div className="lg:col-span-4">
            <label htmlFor="tv-sector" className="block text-[11px] font-semibold text-slate-500 mb-1">
              ১. সেক্টর বাছাই করুন
            </label>
            <select
              id="tv-sector"
              value={sector}
              onChange={(e) => {
                const nextSec = e.target.value;
                setSector(nextSec);
                const first = DSE_CSE_SECTORS[nextSec]?.[0];
                if (first) updateSelection(first, exchange);
              }}
              className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3.5 py-2.5 text-sm font-medium text-slate-900 outline-none focus:border-blue-700"
            >
              {SECTOR_NAMES.map((sec) => (
                <option key={sec} value={sec}>
                  {sec}
                </option>
              ))}
            </select>
          </div>

          <div className="lg:col-span-4">
            <label htmlFor="tv-pair" className="block text-[11px] font-semibold text-slate-500 mb-1">
              ২. কোম্পানি পেয়ার সিলেক্ট করুন
            </label>
            <select
              id="tv-pair"
              value={symbol}
              onChange={(e) => updateSelection(e.target.value, exchange)}
              className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3.5 py-2.5 text-sm font-medium text-slate-900 outline-none focus:border-blue-700"
            >
              {(DSE_CSE_SECTORS[sector] || []).map((sym) => (
                <option key={sym} value={sym}>
                  {sym} / BDT ({exchange})
                </option>
              ))}
            </select>
          </div>

          <div className="lg:col-span-2">
            <Link
              to={`/analyzer?symbol=${encodeURIComponent(symbol)}&exchange=${exchange}`}
              className="block w-full text-center bg-blue-700 hover:bg-blue-800 text-white text-xs font-semibold py-3 px-4 rounded-xl transition-colors whitespace-nowrap"
            >
              পূর্ণ AI রিপোর্ট
            </Link>
          </div>
        </div>

        {/* Indicator Toggle Bar */}
        <div className="pt-4 border-t border-slate-100 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold text-slate-600 mr-1">ইন্ডিকেটর:</span>
            {indicatorButtons.map((btn) => {
              const active = toggles[btn.key];
              return (
                <button
                  key={btn.key}
                  type="button"
                  onClick={() => toggleKey(btn.key)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors cursor-pointer whitespace-nowrap ${
                    active
                      ? 'bg-slate-900 text-white border-slate-900'
                      : 'bg-slate-50 text-slate-500 border-slate-200 hover:text-slate-800'
                  }`}
                >
                  {active ? 'ON' : 'OFF'} · {btn.label}
                </button>
              );
            })}
          </div>

          <button
            type="button"
            onClick={() => setResetCounter((c) => c + 1)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-300 cursor-pointer whitespace-nowrap"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Reset Zoom</span>
          </button>
        </div>
      </section>

      {/* Live Metrics Strip */}
      <section className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <div className="bg-white border border-slate-200 p-4 rounded-xl">
          <div className="text-[11px] text-slate-500">নির্বাচিত পেয়ার</div>
          <div className="text-base font-bold text-blue-700 mt-0.5 truncate">
            {symbol} / BDT ({exchange})
          </div>
        </div>
        <div className="bg-white border border-slate-200 p-4 rounded-xl">
          <div className="text-[11px] text-slate-500">বর্তমান দর</div>
          <div className="text-base font-bold text-slate-900 font-mono-num mt-0.5">
            {analysis ? `৳ ${analysis.current_price.toFixed(2)}` : isFetching ? 'লোড হচ্ছে...' : '—'}
          </div>
        </div>
        <div className="bg-white border border-slate-200 p-4 rounded-xl">
          <div className="text-[11px] text-slate-500">কনসেনসাস সিগন্যাল</div>
          <div
            className={`text-sm font-bold mt-1 truncate ${
              analysis?.action_type === 'BUY'
                ? 'text-emerald-700'
                : analysis?.action_type === 'SELL'
                  ? 'text-rose-700'
                  : 'text-amber-700'
            }`}
          >
            {analysis ? analysis.signal : '—'}
          </div>
        </div>
        <div className="bg-white border border-slate-200 p-4 rounded-xl">
          <div className="text-[11px] text-slate-500">টার্গেট প্রাইস (R1)</div>
          <div className="text-base font-bold text-emerald-700 font-mono-num mt-0.5">
            {analysis ? `৳ ${analysis.target_price.toFixed(2)}` : '—'}
          </div>
        </div>
        <div className="bg-white border border-slate-200 p-4 rounded-xl col-span-2 sm:col-span-1">
          <div className="text-[11px] text-slate-500">নিরাপদ স্টপ-লস (S1)</div>
          <div className="text-base font-bold text-rose-700 font-mono-num mt-0.5">
            {analysis ? `৳ ${analysis.stop_loss.toFixed(2)}` : '—'}
          </div>
        </div>
      </section>

      {/* Main TradingView Candlestick + Synced RSI Terminal */}
      <section className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500 px-1">
          <div className="flex flex-wrap items-center gap-3">
            <strong className="text-slate-900">
              {symbol} ({exchange}) — Technical Candlestick Terminal
            </strong>
            <span className="text-amber-600 font-semibold">SMA(20)</span>
            <span className="text-sky-600 font-semibold">EMA(20)</span>
            <span className="text-purple-600 font-semibold">BB(20,2)</span>
          </div>
          <span>মাউস হুইল দিয়ে জুম ও ড্র্যাগ করে স্ক্রল করুন</span>
        </div>

        <TradingViewTerminal
          ohlcv={analysis?.chart_history || []}
          toggles={toggles}
          resetSignal={resetCounter}
        />
      </section>

      {/* Quick Bangla AI Summary */}
      {report && analysis && (
        <section className="bg-white border border-slate-200 p-6 rounded-xl flex flex-col md:flex-row md:items-center justify-between gap-5">
          <div className="space-y-1.5">
            <div className="text-xs font-semibold text-blue-700">
              MukiSoft AI কুইক ট্রেড সামারি · {analysis.bull_votes}/{analysis.total_votes} বুলিশ
            </div>
            <h2 className="text-base font-bold text-slate-900">{report.decisionTitle}</h2>
            <p className="text-sm text-slate-700 leading-relaxed">{report.decisionSummary}</p>
            <p className="text-xs text-slate-600">{report.actionNote}</p>
          </div>
          <Link
            to={`/analyzer?symbol=${encodeURIComponent(symbol)}&exchange=${exchange}`}
            className="shrink-0 bg-blue-700 hover:bg-blue-800 text-white text-xs font-semibold px-6 py-3 rounded-xl transition-colors text-center whitespace-nowrap"
          >
            বিস্তারিত অ্যানালাইজারে যান
          </Link>
        </section>
      )}
    </main>
  );
}
