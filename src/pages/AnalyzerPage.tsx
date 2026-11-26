import { useCallback, useEffect, useState, type ClipboardEvent, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Check,
  ExternalLink,
  FileUp,
  Lock,
  RefreshCw,
  Trash2,
  TrendingUp,
} from 'lucide-react';
import type { Exchange, ManualStockPayload, StockAnalysis } from '../types/market';
import { DSE_CSE_SECTORS, findSectorBySymbol } from '../data/symbolCatalog';
import {
  useDocumentAnalysisMutation,
  useManualAnalysisMutation,
  useStockAnalysis,
} from '../hooks/useMarketQueries';
import { useFreeQuota } from '../hooks/useFreeQuota';
import { PriceMovementChart } from '../components/charts/PriceMovementChart';
import { BanglaReportCard } from '../components/common/BanglaReportCard';
import { FreeQuotaBanner } from '../components/common/FreeQuotaBanner';
import { FreeQuotaPaywallModal } from '../components/bdapps/FreeQuotaPaywallModal';
import { LIVE_FEED_WAITING_BN, StockNotFoundError } from '../services/apiClient';
import { QuotaExceededError } from '../services/quotaService';
import {
  formatStrongBuyConsensusLine,
  toBanglaDigits,
} from '../utils/quantConsensus';

const SECTOR_NAMES = Object.keys(DSE_CSE_SECTORS);

type PendingBlockedAction =
  | { type: 'live'; symbol: string; exchange: Exchange }
  | { type: 'manual'; payload: ManualStockPayload }
  | { type: 'document'; files: File[]; symbol: string; exchange: Exchange };

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
  const [authorizedKey, setAuthorizedKey] = useState<string>('');
  const [isAuthorizingQuota, setIsAuthorizingQuota] = useState(false);
  const [quotaBlocked, setQuotaBlocked] = useState(false);
  const [paywallOpen, setPaywallOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<PendingBlockedAction | null>(null);

  const {
    isSubscribed,
    remaining,
    liveResetSeconds,
    authorizeSymbolAnalysis,
    markSubscribed,
  } = useFreeQuota();

  const currentQueryKey = activeQuery.symbol
    ? `${activeQuery.exchange}:${activeQuery.symbol}`
    : '';
  const canRunLiveQuery =
    activeQuery.symbol.length > 0 &&
    !quotaBlocked &&
    (isSubscribed || authorizedKey === currentQueryKey);

  const {
    data: liveAnalysis,
    isFetching,
    isError,
    error: queryError,
    failureCount,
    refetch,
  } = useStockAnalysis(activeQuery.symbol, activeQuery.exchange, canRunLiveQuery);
  const manualMutation = useManualAnalysisMutation();
  const docMutation = useDocumentAnalysisMutation();

  const [elapsedSec, setElapsedSec] = useState(0);
  useEffect(() => {
    if (!(isFetching || isAuthorizingQuota)) {
      setElapsedSec(0);
      return;
    }
    const id = window.setInterval(() => {
      setElapsedSec((prev) => prev + 1);
    }, 1000);
    return () => window.clearInterval(id);
  }, [isFetching, isAuthorizingQuota]);

  const currentAnalysis: StockAnalysis | undefined = quotaBlocked
    ? undefined
    : overrideAnalysis || liveAnalysis;

  const authorizeLiveSymbol = useCallback(
    async (sym: string, exch: Exchange) => {
      const clean = sym.trim().toUpperCase();
      if (!clean) return;
      const key = `${exch}:${clean}`;

      if (isSubscribed) {
        setQuotaBlocked(false);
        setAuthorizedKey(key);
        return;
      }

      setIsAuthorizingQuota(true);
      try {
        const res = await authorizeSymbolAnalysis(clean);
        if (!res.allowed) {
          setQuotaBlocked(true);
          setAuthorizedKey('');
          setOverrideAnalysis(null);
          setPendingAction({ type: 'live', symbol: clean, exchange: exch });
          setPaywallOpen(true);
          return;
        }
        setQuotaBlocked(false);
        setAuthorizedKey(key);
      } finally {
        setIsAuthorizingQuota(false);
      }
    },
    [authorizeSymbolAnalysis, isSubscribed]
  );

  // Authorize initial symbol or deep-link changes through server-enforced 24h quota
  useEffect(() => {
    if (!activeQuery.symbol || quotaBlocked) return;
    if (isSubscribed) {
      setQuotaBlocked(false);
      setAuthorizedKey(`${activeQuery.exchange}:${activeQuery.symbol}`);
      return;
    }
    if (authorizedKey === `${activeQuery.exchange}:${activeQuery.symbol}`) {
      return;
    }
    void authorizeLiveSymbol(activeQuery.symbol, activeQuery.exchange);
  }, [
    activeQuery.symbol,
    activeQuery.exchange,
    isSubscribed,
    authorizedKey,
    quotaBlocked,
    authorizeLiveSymbol,
  ]);

  // If /api/analyze itself returns HTTP 429 (only for non-subscribers), block & show Bangla Paywall Modal
  useEffect(() => {
    if (isSubscribed) {
      setQuotaBlocked(false);
      setPaywallOpen(false);
      return;
    }
    if (queryError instanceof QuotaExceededError) {
      setQuotaBlocked(true);
      setAuthorizedKey('');
      setOverrideAnalysis(null);
      setPendingAction({
        type: 'live',
        symbol: activeQuery.symbol,
        exchange: activeQuery.exchange,
      });
      setPaywallOpen(true);
    }
  }, [isSubscribed, queryError, activeQuery.symbol, activeQuery.exchange]);

  // Sync URL query params if user navigates via deep link
  useEffect(() => {
    const qSym = searchParams.get('symbol')?.trim().toUpperCase();
    const qExch: Exchange = searchParams.get('exchange')?.toUpperCase() === 'CSE' ? 'CSE' : 'DSE';
    if (qSym && (qSym !== activeQuery.symbol || qExch !== activeQuery.exchange)) {
      setSymbolInput(qSym);
      setExchange(qExch);
      setOverrideAnalysis(null);
      setQuotaBlocked(false);
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
    setQuotaBlocked(false);

    if (clean === activeQuery.symbol && exchange === activeQuery.exchange) {
      void authorizeLiveSymbol(clean, exchange).then(() => {
        if (isSubscribed || authorizedKey === `${exchange}:${clean}`) {
          void refetch();
        }
      });
      return;
    }

    setAuthorizedKey('');
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

  const executeDocumentAnalysis = async (files: File[], sym: string, exch: Exchange, skipPrecheck = false) => {
    setUploadError(null);
    const cleanSym = sym.trim().toUpperCase() || 'STOCK';

    if (!skipPrecheck && !isSubscribed) {
      const quotaCheck = await authorizeSymbolAnalysis(cleanSym);
      if (!quotaCheck.allowed) {
        setQuotaBlocked(true);
        setPendingAction({ type: 'document', files, symbol: cleanSym, exchange: exch });
        setPaywallOpen(true);
        return;
      }
    }

    try {
      const res = await docMutation.mutateAsync({
        files,
        symbol: cleanSym,
        exchange: exch,
      });
      setQuotaBlocked(false);
      setOverrideAnalysis(res);
      setActionFeedback('ডকুমেন্ট OCR বিশ্লেষণ সম্পন্ন হয়েছে।');
    } catch (err) {
      if (err instanceof QuotaExceededError) {
        setQuotaBlocked(true);
        setPendingAction({ type: 'document', files, symbol: cleanSym, exchange: exch });
        setPaywallOpen(true);
        return;
      }
      setUploadError(err instanceof Error ? err.message : 'ডকুমেন্ট বিশ্লেষণ ব্যর্থ হয়েছে।');
    }
  };

  const handleDocumentSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setUploadError(null);
    if (uploadedFiles.length === 0) {
      setUploadError('অনুগ্রহ করে অন্তত একটি স্ক্রিনশট (PNG/JPG) অথবা PDF ফাইল যোগ করুন।');
      return;
    }
    await executeDocumentAnalysis(uploadedFiles, symbolInput.trim().toUpperCase() || 'STOCK', exchange);
  };

  const executeManualAnalysis = async (payload: ManualStockPayload, skipPrecheck = false) => {
    setManualError(null);

    if (!skipPrecheck && !isSubscribed) {
      const quotaCheck = await authorizeSymbolAnalysis(payload.symbol);
      if (!quotaCheck.allowed) {
        setQuotaBlocked(true);
        setPendingAction({ type: 'manual', payload });
        setPaywallOpen(true);
        return;
      }
    }

    try {
      const res = await manualMutation.mutateAsync(payload);
      setQuotaBlocked(false);
      setOverrideAnalysis(res);
      setActionFeedback('ম্যানুয়াল OHLCV বিশ্লেষণ সম্পন্ন হয়েছে।');
    } catch (err) {
      if (err instanceof QuotaExceededError) {
        setQuotaBlocked(true);
        setPendingAction({ type: 'manual', payload });
        setPaywallOpen(true);
        return;
      }
      setManualError(err instanceof Error ? err.message : LIVE_FEED_WAITING_BN);
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

    await executeManualAnalysis({
      symbol: symbolInput.trim().toUpperCase() || 'STOCK',
      exchange,
      open_price: o,
      high_price: h,
      low_price: l,
      close_price: c,
      yesterday_close: ycp,
      volume: vol,
    });
  };

  const handleModalSubscribed = () => {
    markSubscribed();
    setPaywallOpen(false);
    setQuotaBlocked(false);

    const action = pendingAction;
    setPendingAction(null);
    if (!action) {
      if (activeQuery.symbol) {
        setAuthorizedKey(`${activeQuery.exchange}:${activeQuery.symbol}`);
      }
      return;
    }

    if (action.type === 'live') {
      setSymbolInput(action.symbol);
      setExchange(action.exchange);
      setActiveQuery({ symbol: action.symbol, exchange: action.exchange });
      setAuthorizedKey(`${action.exchange}:${action.symbol}`);
      setSearchParams({ symbol: action.symbol, exchange: action.exchange });
    } else if (action.type === 'manual') {
      void executeManualAnalysis(action.payload, true);
    } else if (action.type === 'document') {
      void executeDocumentAnalysis(action.files, action.symbol, action.exchange, true);
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
            disabled={isFetching || isAuthorizingQuota}
            className="bg-blue-700 hover:bg-blue-800 disabled:opacity-60 text-white font-semibold px-7 py-2.5 rounded-xl transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            {isFetching || isAuthorizingQuota ? 'বিশ্লেষণ চলছে...' : 'বিশ্লেষণ শুরু করুন'}
          </button>
        </form>

        {/* Server-Enforced 24-Hour Free Trial Quota Status Banner */}
        <FreeQuotaBanner
          isSubscribed={isSubscribed}
          remaining={remaining}
          liveResetSeconds={liveResetSeconds}
          onOpenPaywall={() => setPaywallOpen(true)}
        />
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
      {!isSubscribed && quotaBlocked ? (
        <div className="bg-white border border-amber-300 rounded-xl p-8 sm:p-10 text-center space-y-4">
          <div className="w-12 h-12 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center mx-auto">
            <Lock className="w-6 h-6" />
          </div>
          <div className="space-y-1.5">
            <h2 className="text-lg font-extrabold text-slate-900">
              আজকের ২টি ফ্রি বিশ্লেষণ শেষ হয়েছে!
            </h2>
            <p className="text-xs sm:text-sm text-slate-600 max-w-lg mx-auto leading-relaxed">
              অপেক্ষা না করে এখনই আনলিমিটেড DSE ও CSE স্টক AI বিশ্লেষণ ও ৬টি Strong Bullish Setup পর্যবেক্ষণ আনলক করতে আপনার Robi &amp; Cirkle নম্বর দিয়ে সাবস্ক্রাইব করুন।
            </p>
          </div>
          <button
            type="button"
            onClick={() => setPaywallOpen(true)}
            className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-blue-700 hover:bg-blue-800 text-white text-sm font-bold cursor-pointer"
          >
            <span>Robi &amp; Cirkle দিয়ে আনলক করুন (৳২.৭৮/দিন)</span>
          </button>
        </div>
      ) : !activeQuery.symbol && !currentAnalysis ? (
        <div className="bg-white border border-slate-200 rounded-xl p-10 text-center space-y-2.5">
          <p className="text-sm font-bold text-slate-900">
            লাইভ DSE / CSE কোয়ান্টিটেটিভ বিশ্লেষণ শুরু করুন
          </p>
          <p className="text-xs text-slate-600 max-w-lg mx-auto leading-relaxed">
            উপরের সেক্টর ও কোম্পানি তালিকা থেকে যেকোনো শেয়ার বাছাই করুন অথবা ট্রেডিং কোড লিখে “বিশ্লেষণ শুরু করুন” বাটনে ক্লিক করুন।
          </p>
        </div>
      ) : (isFetching || isAuthorizingQuota) && !currentAnalysis ? (
        <div className="bg-white border border-blue-200 rounded-xl p-8 sm:p-10 text-center space-y-5">
          <div className="w-10 h-10 border-4 border-blue-700 border-t-transparent rounded-full animate-spin mx-auto" />
          <div className="space-y-1.5">
            <p className="text-sm sm:text-base font-bold text-slate-900">
              {activeQuery.symbol} ({activeQuery.exchange}) — কোয়ান্টিটেটিভ AI বিশ্লেষণ চলছে
              {elapsedSec > 0 ? ` (${toBanglaDigits(elapsedSec)} সে.)` : ''}
            </p>
            <p className="text-xs text-slate-600 max-w-lg mx-auto leading-relaxed">
              {failureCount > 0 || elapsedSec >= 6
                ? 'ক্লাউড AI ইঞ্জিন ও DSE/CSE ডেটা ফিড সংযোগ তৈরি হচ্ছে—অনুগ্রহ করে কয়েক সেকেন্ড অপেক্ষা করুন, ফলাফল স্বয়ংক্রিয়ভাবে প্রদর্শিত হবে।'
                : LIVE_FEED_WAITING_BN}
            </p>
          </div>
          <div className="max-w-md mx-auto grid grid-cols-1 sm:grid-cols-3 gap-2 text-[11px] font-semibold">
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-800 px-3 py-2">
              ১. লাইভ / ক্লোজিং OHLCV
            </div>
            <div
              className={`rounded-lg border px-3 py-2 ${
                elapsedSec >= 2
                  ? 'border-blue-200 bg-blue-50 text-blue-800'
                  : 'border-slate-200 bg-slate-50 text-slate-500'
              }`}
            >
              ২. XGBoost + ২০ সূচক
            </div>
            <div
              className={`rounded-lg border px-3 py-2 ${
                elapsedSec >= 4
                  ? 'border-blue-200 bg-blue-50 text-blue-800'
                  : 'border-slate-200 bg-slate-50 text-slate-500'
              }`}
            >
              ৩. বাংলা AI রিপোর্ট
            </div>
          </div>
        </div>
      ) : isError && !currentAnalysis ? (
        <div className="bg-white border border-slate-200 rounded-xl p-10 text-center space-y-4">
          {queryError instanceof StockNotFoundError ? (
            <>
              <p className="text-sm font-bold text-slate-900">{queryError.message}</p>
              <p className="text-xs text-slate-500 max-w-lg mx-auto leading-relaxed">
                ট্রেডিং কোডের বানান যাচাই করে আবার সার্চ করুন (যেমন: SQURPHARMA, BRACBANK, GP, WALTONHIL)। চাইলে নিচ থেকে ম্যানুয়াল OHLCV বা ডকুমেন্ট OCR বিশ্লেষণও চালাতে পারেন।
              </p>
              <div className="flex flex-wrap items-center justify-center gap-3">
                <button
                  type="button"
                  onClick={() => void refetch()}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-700 hover:bg-blue-800 text-white text-xs font-semibold cursor-pointer"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>আবার যাচাই করুন</span>
                </button>
                <button
                  type="button"
                  onClick={() => setShowAdvancedInput(true)}
                  className="px-4 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 text-xs font-semibold cursor-pointer"
                >
                  ডকুমেন্ট OCR / ম্যানুয়াল ইনপুট খুলুন
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="text-sm font-semibold text-slate-800">
                সার্ভারের সাথে সংযোগ হতে স্বাভাবিকের চেয়ে একটু বেশি সময় লাগছে।
              </p>
              <p className="text-xs text-slate-500 max-w-lg mx-auto leading-relaxed">
                {activeQuery.symbol} ({activeQuery.exchange})-এর সর্বশেষ DSE/CSE ডেটা আনতে নিচের বাটনে ক্লিক করুন—মার্কেট বন্ধ থাকলেও সর্বশেষ ক্লোজিং ডেটায় পূর্ণ AI বিশ্লেষণ চালু হবে।
              </p>
              <div className="flex flex-wrap items-center justify-center gap-3">
                <button
                  type="button"
                  onClick={() => void refetch()}
                  className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-lg bg-blue-700 hover:bg-blue-800 text-white text-xs font-semibold cursor-pointer"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>পুনরায় বিশ্লেষণ করুন</span>
                </button>
              </div>
            </>
          )}
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
                  : `২০টি সূচকের মধ্যে ${toBanglaDigits(currentAnalysis.bull_votes)}টি ইতিবাচক সংকেত • শুধুমাত্র তথ্য ও বিশ্লেষণের জন্য`}
              </div>
              <div className="text-[11px] text-slate-500 mt-1 font-mono-num">
                কনফিডেন্স: <strong className="text-slate-900">{currentAnalysis.confidence.toFixed(1)}%</strong>
              </div>
            </div>

            <div className="bg-white border border-slate-200 p-5 rounded-xl">
              <div className="text-xs text-slate-500">মডেল রেফারেন্স টার্গেট (R1)</div>
              <div className="text-3xl font-bold text-emerald-700 font-mono-num mt-2">
                ৳ {currentAnalysis.target_price.toFixed(2)}
              </div>
              <div className="text-xs text-slate-500 mt-2 font-mono-num">
                R2: ৳ {currentAnalysis.support_resistance.r2.toFixed(2)}
              </div>
            </div>

            <div className="bg-white border border-slate-200 p-5 rounded-xl">
              <div className="text-xs text-slate-500">ঝুঁকি রেফারেন্স / স্টপ-লস (S1)</div>
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
      {/* Tamper-Proof 24-Hour Free Quota Paywall Modal */}
      <FreeQuotaPaywallModal
        isOpen={!isSubscribed && paywallOpen}
        resetInSeconds={liveResetSeconds}
        requestedSymbol={
          pendingAction?.type === 'manual'
            ? pendingAction.payload.symbol
            : pendingAction?.symbol || activeQuery.symbol || undefined
        }
        onClose={() => setPaywallOpen(false)}
        onSubscribed={handleModalSubscribed}
      />
    </main>
  );
}
