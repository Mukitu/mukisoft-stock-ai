import { useEffect, useState, type ClipboardEvent, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Check,
  ExternalLink,
  FileUp,
  RefreshCw,
  Trash2,
  TrendingUp,
} from 'lucide-react';
import type { Exchange, StockAnalysis } from '../types/market';
import { DSE_CSE_SECTORS, findSectorBySymbol } from '../data/symbolCatalog';
import {
  useDocumentAnalysisMutation,
  useManualAnalysisMutation,
  useStockAnalysis,
} from '../hooks/useMarketQueries';
import { PriceMovementChart } from '../components/charts/PriceMovementChart';
import { BanglaReportCard } from '../components/common/BanglaReportCard';
import { LIVE_FEED_WAITING_BN } from '../services/apiClient';
import {
  formatStrongBuyConsensusLine,
  toBanglaDigits,
} from '../utils/quantConsensus';

const SECTOR_NAMES = Object.keys(DSE_CSE_SECTORS);

export function AnalyzerPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialSymbol = (searchParams.get('symbol') || '').trim().toUpperCase();
  const initialExchange: Exchange = searchParams.get('exchange')?.toUpperCase() === 'CSE' ? 'CSE' : 'DSE';

  const [exchange, setExchange] = useState<Exchange>(initialExchange);
  const [selectedSector, setSelectedSector] = useState<string>(() => {
    const found = initialSymbol ? findSectorBySymbol(initialSymbol) : '';
    return SECTOR_NAMES.includes(found) ? found : SECTOR_NAMES[0];
  });
  const [symbolInput, setSymbolInput] = useState<string>(initialSymbol);
  const [activeQuery, setActiveQuery] = useState<{ symbol: string; exchange: Exchange }>({
    symbol: initialSymbol,
    exchange: initialExchange,
  });

  // Override result from OCR or manual OHLCV input
  const [overrideAnalysis, setOverrideAnalysis] = useState<StockAnalysis | null>(null);
  const [showAdvancedInput, setShowAdvancedInput] = useState(false);

  // Multi-file upload state (safe typed File[] — zero innerHTML)
  const [uploadedFiles, setUploadedFiles] = useState<File[]>([]);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // Manual OHLCV state
  const [manualOpen, setManualOpen] = useState('');
  const [manualHigh, setManualHigh] = useState('');
  const [manualLow, setManualLow] = useState('');
  const [manualClose, setManualClose] = useState('');
  const [manualYcp, setManualYcp] = useState('');
  const [manualVolume, setManualVolume] = useState('100000');
  const [manualError, setManualError] = useState<string | null>(null);

  const [actionFeedback, setActionFeedback] = useState<string | null>(null);

  const {
    data: liveAnalysis,
    isFetching,
    isError,
    error: queryError,
    refetch,
  } = useStockAnalysis(activeQuery.symbol, activeQuery.exchange, activeQuery.symbol.length > 0);
  const manualMutation = useManualAnalysisMutation();
  const docMutation = useDocumentAnalysisMutation();

  const currentAnalysis: StockAnalysis | undefined = overrideAnalysis || liveAnalysis;

  // Sync URL query params if user navigates via deep link
  useEffect(() => {
    const qSym = searchParams.get('symbol')?.trim().toUpperCase();
    const qExch: Exchange = searchParams.get('exchange')?.toUpperCase() === 'CSE' ? 'CSE' : 'DSE';
    if (qSym && (qSym !== activeQuery.symbol || qExch !== activeQuery.exchange)) {
      setSymbolInput(qSym);
      setExchange(qExch);
      setOverrideAnalysis(null);
      setActiveQuery({ symbol: qSym, exchange: qExch });
      const found = findSectorBySymbol(qSym);
      if (SECTOR_NAMES.includes(found)) setSelectedSector(found);
    }
  }, [searchParams, activeQuery.symbol, activeQuery.exchange]);

  const handleAnalyzeSubmit = (e: FormEvent) => {
    e.preventDefault();
    const clean = symbolInput.trim().toUpperCase();
    if (!clean) return;
    setOverrideAnalysis(null);
    setActionFeedback(null);
    setActiveQuery({ symbol: clean, exchange });
    setSearchParams({ symbol: clean, exchange });
  };

  const handleFilesSelected = (list: FileList | File[]) => {
    const incoming = Array.from(list);
    setUploadError(null);
    setUploadedFiles((prev) => {
      const merged = [...prev, ...incoming].slice(0, 5);
      return merged;
    });
  };

  const handlePaste = (e: ClipboardEvent<HTMLDivElement>) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    const pasted: File[] = [];
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.startsWith('image/')) {
        const f = items[i].getAsFile();
        if (f) pasted.push(f);
      }
    }
    if (pasted.length > 0) {
      handleFilesSelected(pasted);
    }
  };

  const handleDocumentSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setUploadError(null);
    if (uploadedFiles.length === 0) {
      setUploadError('অনুগ্রহ করে অন্তত একটি স্ক্রিনশট (PNG/JPG) অথবা PDF ফাইল যোগ করুন।');
      return;
    }
    try {
      const res = await docMutation.mutateAsync({
        files: uploadedFiles,
        symbol: symbolInput.trim().toUpperCase() || 'STOCK',
        exchange,
      });
      setOverrideAnalysis(res);
      setActionFeedback('ডকুমেন্ট OCR বিশ্লেষণ সম্পন্ন হয়েছে।');
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'ডকুমেন্ট বিশ্লেষণ ব্যর্থ হয়েছে।');
    }
  };

  const handleManualSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setManualError(null);
    const o = Number(manualOpen);
    const h = Number(manualHigh);
    const l = Number(manualLow);
    const c = Number(manualClose);
    const ycp = Number(manualYcp || manualOpen);
    const vol = Number(manualVolume || 100000);

    if (![o, h, l, c].every((n) => Number.isFinite(n) && n > 0)) {
      setManualError('Open, High, Low এবং Close প্রতিটি মান শূন্যের চেয়ে বড় হতে হবে।');
      return;
    }
    if (l > h || c < l || c > h) {
      setManualError("Close প্রাইস অবশ্যই Day's Low এবং Day's High-এর মধ্যে থাকতে হবে।");
      return;
    }

    try {
      const res = await manualMutation.mutateAsync({
        symbol: symbolInput.trim().toUpperCase() || 'STOCK',
        exchange,
        open_price: o,
        high_price: h,
        low_price: l,
        close_price: c,
        yesterday_close: ycp,
        volume: vol,
      });
      setOverrideAnalysis(res);
      setActionFeedback('ম্যানুয়াল OHLCV বিশ্লেষণ সম্পন্ন হয়েছে।');
    } catch (err) {
      setManualError(err instanceof Error ? err.message : LIVE_FEED_WAITING_BN);
    }
  };

  const signalColorClass =
    currentAnalysis?.action_type === 'BUY'
      ? 'text-emerald-700'
      : currentAnalysis?.action_type === 'SELL'
        ? 'text-rose-700'
        : 'text-amber-700';

  const cleanUrlSym = symbolInput.trim().toUpperCase();
  const dseCompanyUrl = cleanUrlSym
    ? `https://www.dsebd.org/displayCompany.php?name=${encodeURIComponent(cleanUrlSym)}`
    : 'https://www.dsebd.org/latest_share_price_scroll_l.php';
  const cseCompanyUrl = cleanUrlSym
    ? `https://www.cse.com.bd/company/companydetails/${encodeURIComponent(cleanUrlSym)}`
    : 'https://www.cse.com.bd/market/current_price';

  return (
    <main className="max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 flex-1 space-y-6">
      {/* Unified Search & Sector Selector Card */}
      <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-4 border-b border-slate-100">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
              DSE ও CSE কোয়ান্টিটেটিভ স্টক অ্যানালাইজার
            </h1>
            <p className="text-slate-500 text-sm mt-0.5">
              সেক্টর বা ট্রেডিং কোড নির্বাচন করুন—১৭-ফিচার XGBoost ও ২০-ইন্ডিকেটর কনসেনসাস একসাথে যাচাই হবে।
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowAdvancedInput((prev) => !prev)}
            className="text-xs font-semibold text-blue-700 hover:text-blue-800 whitespace-nowrap self-start sm:self-center cursor-pointer"
          >
            {showAdvancedInput ? 'ডকুমেন্ট / ম্যানুয়াল প্যানেল লুকান' : 'ডকুমেন্ট OCR বা ম্যানুয়াল OHLCV দিন →'}
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label htmlFor="sector-select" className="block text-xs font-semibold text-slate-600 mb-1.5">
              ১. সেক্টর বাছাই করুন ({SECTOR_NAMES.length} সেক্টর)
            </label>
            <select
              id="sector-select"
              value={selectedSector}
              onChange={(e) => {
                const nextSec = e.target.value;
                setSelectedSector(nextSec);
                const firstSym = DSE_CSE_SECTORS[nextSec]?.[0];
                if (firstSym) setSymbolInput(firstSym);
              }}
              className="w-full bg-slate-50 border border-slate-300 rounded-xl px-4 py-2.5 text-sm font-medium text-slate-900 outline-none focus:border-blue-700 focus:bg-white"
            >
              {SECTOR_NAMES.map((sec) => (
                <option key={sec} value={sec}>
                  {sec}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="stock-select" className="block text-xs font-semibold text-slate-600 mb-1.5">
              ২. কোম্পানি সিলেক্ট করুন (Trading Code)
            </label>
            <select
              id="stock-select"
              value={DSE_CSE_SECTORS[selectedSector]?.includes(symbolInput) ? symbolInput : ''}
              onChange={(e) => {
                if (e.target.value) setSymbolInput(e.target.value);
              }}
              className="w-full bg-slate-50 border border-slate-300 rounded-xl px-4 py-2.5 text-sm font-medium text-slate-900 outline-none focus:border-blue-700 focus:bg-white"
            >
              <option value="">-- কোম্পানি নির্বাচন করুন --</option>
              {(DSE_CSE_SECTORS[selectedSector] || []).map((sym) => (
                <option key={sym} value={sym}>
                  {sym}
                </option>
              ))}
            </select>
          </div>
        </div>

        <form onSubmit={handleAnalyzeSubmit} className="flex flex-col md:flex-row gap-3">
          <div className="flex bg-slate-100 p-1 rounded-xl border border-slate-200 shrink-0">
            {(['DSE', 'CSE'] as Exchange[]).map((ex) => (
              <button
                key={ex}
                type="button"
                onClick={() => setExchange(ex)}
                className={`px-5 py-2 rounded-lg text-sm font-semibold transition-colors cursor-pointer ${
                  exchange === ex
                    ? 'bg-blue-700 text-white'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {ex}
              </button>
            ))}
          </div>

          <input
            type="text"
            value={symbolInput}
            onChange={(e) => setSymbolInput(e.target.value.toUpperCase())}
            placeholder="কোম্পানির কোড লিখুন (যেমন: SQURPHARMA, BRACBANK)"
            className="flex-1 bg-slate-50 border border-slate-300 focus:border-blue-700 focus:bg-white rounded-xl px-4 py-2.5 text-slate-900 uppercase font-bold text-sm outline-none"
          />

          <button
            type="submit"
            disabled={isFetching}
            className="bg-blue-700 hover:bg-blue-800 disabled:opacity-60 text-white font-semibold px-7 py-2.5 rounded-xl transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            {isFetching ? 'বিশ্লেষণ চলছে...' : 'বিশ্লেষণ শুরু করুন'}
          </button>
        </form>
      </section>

      {/* Optional Multi-File OCR & Manual OHLCV Panel */}
      {showAdvancedInput && (
        <section
          onPaste={handlePaste}
          className="bg-white border border-slate-200 rounded-xl p-6 space-y-6"
        >
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-4 border-b border-slate-100">
            <div>
              <h2 className="text-lg font-bold text-slate-900">
                স্ক্রিনশট / PDF Vision OCR এবং ম্যানুয়াল OHLCV ইনপুট
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                অফিশিয়াল DSE/CSE পেজ থেকে স্ক্রিনশট পেস্ট (Ctrl+V / Cmd+V), PDF আপলোড বা সরাসরি বাজার দর দিন।
              </p>
            </div>
            <div className="flex flex-wrap gap-2 shrink-0">
              <a
                href={dseCompanyUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold"
              >
                <span>DSE পেজ</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
              <a
                href={cseCompanyUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-slate-300 hover:bg-slate-50 text-slate-800 text-xs font-semibold"
              >
                <span>CSE পেজ</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </div>
          </div>

          {/* Method 1: Multi-file Screenshot/PDF OCR */}
          <form onSubmit={handleDocumentSubmit} className="space-y-4">
            <div className="text-sm font-bold text-slate-900">
              পদ্ধতি ১: একাধিক স্ক্রিনশট (PNG/JPG/WEBP) বা PDF আপলোড করুন (সর্বোচ্চ ৫টি, প্রতি ফাইল ৫MB)
            </div>
            <label
              htmlFor="ocr-file-input"
              className="flex flex-col items-center justify-center w-full min-h-[120px] border-2 border-dashed border-slate-300 hover:border-blue-600 rounded-xl bg-slate-50 cursor-pointer transition-colors p-4 text-center"
            >
              <FileUp className="w-6 h-6 text-blue-700 mb-2" />
              <span className="text-sm font-semibold text-slate-800">
                ক্লিক করে ফাইল বাছাই করুন অথবা এখানে স্ক্রিনশট পেস্ট (Ctrl+V / Cmd+V) করুন
              </span>
              <span className="text-xs text-slate-500 mt-1">PDF, PNG, JPG, WEBP সমর্থিত</span>
              <input
                id="ocr-file-input"
                type="file"
                multiple
                accept="image/png,image/jpeg,image/webp,.pdf,application/pdf"
                className="hidden"
                onChange={(e) => {
                  if (e.target.files) handleFilesSelected(e.target.files);
                  e.target.value = '';
                }}
              />
            </label>

            {uploadedFiles.length > 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {uploadedFiles.map((file, idx) => (
                  <div
                    key={`${file.name}-${idx}`}
                    className="flex items-center justify-between gap-2 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2"
                  >
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-slate-800 truncate">{file.name}</div>
                      <div className="text-[11px] text-slate-500 font-mono-num">
                        {(file.size / 1024).toFixed(1)} KB
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        setUploadedFiles((prev) => prev.filter((_, i) => i !== idx))
                      }
                      aria-label={`Remove ${file.name}`}
                      className="p-1.5 rounded-lg text-rose-600 hover:bg-rose-50 cursor-pointer shrink-0"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {uploadError && (
              <div className="text-xs font-medium text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3.5 py-2.5">
                {uploadError}
              </div>
            )}

            <div className="flex justify-end">
              <button
                type="submit"
                disabled={docMutation.isPending}
                className="px-5 py-2.5 rounded-lg bg-emerald-700 hover:bg-emerald-800 disabled:opacity-60 text-white text-xs font-semibold cursor-pointer"
              >
                {docMutation.isPending ? 'OCR বিশ্লেষণ চলছে...' : 'আপলোড করা ফাইল বিশ্লেষণ করুন'}
              </button>
            </div>
          </form>

          {/* Method 2: Manual OHLCV Form */}
          <form onSubmit={handleManualSubmit} className="pt-5 border-t border-slate-200 space-y-4">
            <div className="text-sm font-bold text-slate-900">
              পদ্ধতি ২: Current Market Information (ম্যানুয়াল OHLCV ইনপুট)
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">Open Price *</label>
                <input
                  type="number"
                  step="0.01"
                  required
                  value={manualOpen}
                  onChange={(e) => setManualOpen(e.target.value)}
                  placeholder="215.0"
                  className="w-full bg-slate-50 border border-slate-300 rounded-lg px-3 py-2 text-sm font-mono-num"
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">Day's High *</label>
                <input
                  type="number"
                  step="0.01"
                  required
                  value={manualHigh}
                  onChange={(e) => setManualHigh(e.target.value)}
                  placeholder="221.5"
                  className="w-full bg-slate-50 border border-slate-300 rounded-lg px-3 py-2 text-sm font-mono-num"
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">Day's Low *</label>
                <input
                  type="number"
                  step="0.01"
                  required
                  value={manualLow}
                  onChange={(e) => setManualLow(e.target.value)}
                  placeholder="213.8"
                  className="w-full bg-slate-50 border border-slate-300 rounded-lg px-3 py-2 text-sm font-mono-num"
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">Close / LTP *</label>
                <input
                  type="number"
                  step="0.01"
                  required
                  value={manualClose}
                  onChange={(e) => setManualClose(e.target.value)}
                  placeholder="220.4"
                  className="w-full bg-slate-50 border border-slate-300 rounded-lg px-3 py-2 text-sm font-mono-num"
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">Yesterday Close</label>
                <input
                  type="number"
                  step="0.01"
                  value={manualYcp}
                  onChange={(e) => setManualYcp(e.target.value)}
                  placeholder="214.2"
                  className="w-full bg-slate-50 border border-slate-300 rounded-lg px-3 py-2 text-sm font-mono-num"
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">Volume</label>
                <input
                  type="number"
                  min="0"
                  value={manualVolume}
                  onChange={(e) => setManualVolume(e.target.value)}
                  placeholder="100000"
                  className="w-full bg-slate-50 border border-slate-300 rounded-lg px-3 py-2 text-sm font-mono-num"
                />
              </div>
            </div>

            {manualError && (
              <div className="text-xs font-medium text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3.5 py-2.5">
                {manualError}
              </div>
            )}

            <div className="flex justify-end">
              <button
                type="submit"
                disabled={manualMutation.isPending}
                className="px-5 py-2.5 rounded-lg bg-blue-700 hover:bg-blue-800 disabled:opacity-60 text-white text-xs font-semibold cursor-pointer"
              >
                {manualMutation.isPending ? 'গণনা চলছে...' : 'ML ও ২০-ইন্ডিকেটর অ্যানালাইজ করুন'}
              </button>
            </div>
          </form>
        </section>
      )}

      {/* Results Dashboard */}
      {!activeQuery.symbol && !currentAnalysis ? (
        <div className="bg-white border border-slate-200 rounded-xl p-10 text-center space-y-2.5">
          <p className="text-sm font-bold text-slate-900">
            লাইভ DSE / CSE কোয়ান্টিটেটিভ বিশ্লেষণ শুরু করুন
          </p>
          <p className="text-xs text-slate-600 max-w-lg mx-auto leading-relaxed">
            উপরের সেক্টর ও কোম্পানি তালিকা থেকে যেকোনো শেয়ার বাছাই করুন অথবা ট্রেডিং কোড লিখে “বিশ্লেষণ শুরু করুন” বাটনে ক্লিক করুন।
          </p>
        </div>
      ) : isFetching && !currentAnalysis ? (
        <div className="bg-white border border-slate-200 rounded-xl p-12 text-center space-y-3">
          <div className="w-9 h-9 border-4 border-blue-700 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-sm font-semibold text-slate-800">{LIVE_FEED_WAITING_BN}</p>
          <p className="text-xs text-slate-500">
            {activeQuery.symbol} ({activeQuery.exchange})-এর রিয়েল-টাইম ঐতিহাসিক ডেটা ও ২০টি সূচক যাচাই চলছে।
          </p>
        </div>
      ) : isError && !currentAnalysis ? (
        <div className="bg-white border border-slate-200 rounded-xl p-10 text-center space-y-4">
          <p className="text-sm font-semibold text-slate-800">
            {queryError instanceof Error ? queryError.message : LIVE_FEED_WAITING_BN}
          </p>
          <p className="text-xs text-slate-500 max-w-lg mx-auto">
            আমরা কোনো ডেমো বা অনুমানভিত্তিক প্রাইস দেখাই না। কয়েক মুহূর্ত পর আবার চেষ্টা করুন অথবা ডকুমেন্ট OCR / ম্যানুয়াল OHLCV ইনপুট ব্যবহার করুন।
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <button
              type="button"
              onClick={() => void refetch()}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-700 hover:bg-blue-800 text-white text-xs font-semibold cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>আবার চেষ্টা করুন</span>
            </button>
            <button
              type="button"
              onClick={() => setShowAdvancedInput(true)}
              className="px-4 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 text-xs font-semibold cursor-pointer"
            >
              ডকুমেন্ট OCR / ম্যানুয়াল ইনপুট খুলুন
            </button>
          </div>
        </div>
      ) : currentAnalysis ? (
        <div className="space-y-6">
          {/* Action Toolbar */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-xs text-slate-500">
              উৎস: <strong className="text-slate-800">{currentAnalysis.data_source}</strong>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Link
                to={`/market?symbol=${encodeURIComponent(currentAnalysis.symbol)}&exchange=${currentAnalysis.exchange}`}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold"
              >
                <TrendingUp className="w-3.5 h-3.5" />
                <span>ক্যান্ডেলস্টিক চার্টে দেখুন</span>
              </Link>
            </div>
          </div>

          {actionFeedback && (
            <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl px-4 py-3 text-xs font-semibold">
              <Check className="w-4 h-4 shrink-0" />
              <span>{actionFeedback}</span>
            </div>
          )}

          {/* 4 Synchronized Metric KPI Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white border border-slate-200 p-5 rounded-xl">
              <div className="flex items-center justify-between text-xs text-slate-500">
                <span>বর্তমান বাজার দর</span>
                <strong className="text-blue-700">
                  {currentAnalysis.symbol} ({currentAnalysis.exchange})
                </strong>
              </div>
              <div className="text-3xl font-bold text-slate-900 font-mono-num mt-2">
                ৳ {currentAnalysis.current_price.toFixed(2)}
              </div>
              <div className="text-xs text-slate-500 mt-2 font-mono-num">
                RSI(14): <strong className="text-slate-900">{currentAnalysis.rsi.toFixed(1)}</strong> ·{' '}
                <span className={currentAnalysis.change_pct >= 0 ? 'text-emerald-700' : 'text-rose-700'}>
                  {currentAnalysis.change_pct >= 0 ? '+' : ''}
                  {currentAnalysis.change_pct.toFixed(2)}%
                </span>
              </div>
            </div>

            <div className="bg-white border border-slate-200 p-5 rounded-xl">
              <div className="text-xs text-slate-500">ইউনিফায়েড কনসেনসাস সিগন্যাল</div>
              <div className={`text-base font-bold mt-2 leading-snug ${signalColorClass}`}>
                {currentAnalysis.signal}
              </div>
              <div className="text-[11px] font-semibold text-slate-700 mt-1.5 leading-snug">
                {currentAnalysis.action_type === 'BUY'
                  ? formatStrongBuyConsensusLine(currentAnalysis.bull_votes)
                  : `২০টি সূচকের মধ্যে ${toBanglaDigits(currentAnalysis.bull_votes)}টি ইতিবাচক সিদ্ধান্ত`}
              </div>
              <div className="text-[11px] text-slate-500 mt-1 font-mono-num">
                কনফিডেন্স: <strong className="text-slate-900">{currentAnalysis.confidence.toFixed(1)}%</strong>
              </div>
            </div>

            <div className="bg-white border border-slate-200 p-5 rounded-xl">
              <div className="text-xs text-slate-500">সম্ভাব্য টার্গেট প্রাইস (R1)</div>
              <div className="text-3xl font-bold text-emerald-700 font-mono-num mt-2">
                ৳ {currentAnalysis.target_price.toFixed(2)}
              </div>
              <div className="text-xs text-slate-500 mt-2 font-mono-num">
                R2: ৳ {currentAnalysis.support_resistance.r2.toFixed(2)}
              </div>
            </div>

            <div className="bg-white border border-slate-200 p-5 rounded-xl">
              <div className="text-xs text-slate-500">নিরাপদ স্টপ-লস (S1)</div>
              <div className="text-3xl font-bold text-rose-700 font-mono-num mt-2">
                ৳ {currentAnalysis.stop_loss.toFixed(2)}
              </div>
              <div className="text-xs text-slate-500 mt-2 font-mono-num">
                S2: ৳ {currentAnalysis.support_resistance.s2.toFixed(2)}
              </div>
            </div>
          </div>

          {/* Humanized Bangla 20-Indicator AI Report */}
          <BanglaReportCard analysis={currentAnalysis} showVotesByDefault={true} />

          {/* Price Movement Chart */}
          <section className="bg-white border border-slate-200 p-6 rounded-xl">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-bold text-slate-900">
                প্রাইস মুভমেন্ট চার্ট — {currentAnalysis.symbol} (BDT)
              </h2>
              <span className="text-xs text-slate-500 font-mono-num">
                {currentAnalysis.chart_history.length} সেশন
              </span>
            </div>
            <PriceMovementChart
              symbol={currentAnalysis.symbol}
              history={currentAnalysis.chart_history}
            />
          </section>
        </div>
      ) : null}
    </main>
  );
}
