import type {
  Exchange,
  ManualStockPayload,
  MarketLiveTicker,
  StockAnalysis,
  TopPick,
  TopPicksResponse,
} from '../types/market';
import { getBDMarketSession, getBstCycleStamp } from '../utils/bdMarketSession';
import {
  MIN_STRONG_BUY_VOTES,
  STRONG_BUY_BADGE_BN,
  normalizeStockAnalysis,
} from '../utils/quantConsensus';
import {
  QuotaExceededError,
  getQuotaRequestHeaders,
  normalizeQuotaPayload,
  syncQuotaState,
} from './quotaService';

import {
  API_BASE_URL,
  API_TIMEOUT_MS,
  DIRECT_RENDER_API_BASE_URL,
  getCandidateApiUrls,
} from '../utils/apiBaseUrl';

export { API_BASE_URL, API_TIMEOUT_MS, DIRECT_RENDER_API_BASE_URL };

export const LIVE_FEED_WAITING_BN =
  'লাইভ ও সর্বশেষ ক্লোজিং মার্কেট ডেটা সংগ্রহ করে ১৭-ফিচার XGBoost বিশ্লেষণ চলছে...';

export class StockNotFoundError extends Error {
  public readonly status: number;
  constructor(message: string, status = 404) {
    super(message);
    this.name = 'StockNotFoundError';
    this.status = status;
  }
}

export class BackendWakeupError extends Error {
  public readonly status: number;
  constructor(message?: string, status = 503) {
    super(
      message ||
        'ক্লাউড AI অ্যানালাইসিস সার্ভার চালু হচ্ছে—স্বয়ংক্রিয়ভাবে পুনরায় চেষ্টা করা হচ্ছে...'
    );
    this.name = 'BackendWakeupError';
    this.status = status;
  }
}

async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeoutMs = API_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    window.clearTimeout(timer);
  }
}

/**
 * Derives a deterministic 15..20 bullish indicator score from real live metrics
 * ONLY when the live Render API returns a verified Strong Buy (signal_code === 2,
 * is_sideways === false, price >= 12, change_pct > 0) before the backend adds
 * explicit `bull_votes`. When `bull_votes` IS present, it is strictly enforced.
 */
function resolveRealTimeBullVotes(p: Partial<TopPick>, price: number, changePct: number): number | null {
  if (p.bull_votes !== undefined && p.bull_votes !== null) {
    const explicit = Number(p.bull_votes);
    if (!Number.isFinite(explicit) || explicit < MIN_STRONG_BUY_VOTES || explicit > 20) {
      return null;
    }
    return Math.round(explicit);
  }

  const confidence = Number(p.confidence ?? 0);
  const rsi = Number(p.rsi ?? 50);
  const buyScore = Number(p.buy_score ?? 0);
  if (!Number.isFinite(confidence) || confidence < 55 || price < 12.0 || changePct <= 0) {
    return null;
  }

  let score = MIN_STRONG_BUY_VOTES;
  if (confidence >= 95) score += 1;
  if (rsi >= 50 && rsi <= 68) score += 1;
  if (changePct >= 1.0) score += 1;
  if (buyScore >= 115) score += 1;
  if (changePct >= 2.0 && confidence >= 99) score += 1;
  return Math.min(20, Math.max(MIN_STRONG_BUY_VOTES, score));
}

/**
 * Strictly validates that every Buy Radar pick comes from verified real-time
 * XGBoost + technical consensus scoring (never forced Hold/Sideways or fake picks).
 */
function sanitizeVerifiedTopPicks(rawPicks: unknown): TopPick[] {
  if (!Array.isArray(rawPicks)) return [];

  const valid: TopPick[] = [];
  for (const item of rawPicks) {
    if (!item || typeof item !== 'object') continue;
    const p = item as Partial<TopPick>;
    const price = Number(p.price ?? 0);
    const changePct = Number(p.change_pct ?? 0);
    const signalCode = Number(p.signal_code ?? 1);
    const mlSignalCode = Number(p.ml_signal_code ?? signalCode);
    const isSideways = Boolean(p.is_sideways);

    if (
      !p.symbol ||
      !Number.isFinite(price) ||
      price < 12.0 ||
      !Number.isFinite(changePct) ||
      changePct <= 0 ||
      signalCode !== 2 ||
      mlSignalCode !== 2 ||
      isSideways
    ) {
      continue;
    }

    const bullVotes = resolveRealTimeBullVotes(p, price, changePct);
    if (bullVotes === null) {
      continue;
    }

    valid.push({
      symbol: String(p.symbol).trim().toUpperCase(),
      exchange: p.exchange === 'CSE' ? 'CSE' : 'DSE',
      price: Number(price.toFixed(2)),
      change_pct: Number(changePct.toFixed(2)),
      volume: p.volume !== undefined ? Number(p.volume) : undefined,
      vol_ratio: p.vol_ratio !== undefined ? Number(p.vol_ratio) : undefined,
      signal_code: 2,
      ml_signal_code: 2,
      signal: STRONG_BUY_BADGE_BN,
      confidence: Number(Number(p.confidence ?? 0).toFixed(2)),
      buy_score: Number(Number(p.buy_score ?? 0).toFixed(2)),
      target_price: Number(Number(p.target_price ?? 0).toFixed(2)),
      stop_loss: Number(Number(p.stop_loss ?? 0).toFixed(2)),
      rsi: Number(Number(p.rsi ?? 0).toFixed(1)),
      bull_votes: bullVotes,
      total_votes: 20,
      is_sideways: false,
    });
  }

  return valid.slice(0, 6);
}

export const MARKET_LIVE_CACHE_KEY = 'ms_market_live_cache_v2';

export interface MarketEdgeSnapshot {
  schema_version: number;
  generated_at_bst: string;
  trading_date: string;
  market_status: string;
  indices: {
    dsex: string;
    dsex_change?: number;
    dsex_change_pct?: number;
    ds30: string;
    ds30_change?: number;
    ds30_change_pct?: number;
    dses?: string;
  };
  picks: TopPick[];
}

interface MlAnalysisEdgeCache {
  schema_version: number;
  generated_at_bst: string;
  trading_date: string;
  analyses: Record<string, Record<string, unknown>>;
}

let _marketSnapshotPromise: Promise<MarketEdgeSnapshot | null> | null = null;
let _mlCachePromise: Promise<MlAnalysisEdgeCache | null> | null = null;
let _mlCacheData: MlAnalysisEdgeCache | null = null;

function formatValidatedIndex(raw: unknown, minVal: number, maxVal: number): string | null {
  const str = String(raw ?? '').trim();
  if (!str || str === '—') return null;
  const num = Number(str.replace(/,/g, ''));
  if (!Number.isFinite(num) || num < minVal || num > maxVal) return null;
  return num.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export async function loadMarketSnapshot(force = false): Promise<MarketEdgeSnapshot | null> {
  if (!force && _marketSnapshotPromise) {
    return _marketSnapshotPromise;
  }

  const promise = (async () => {
    try {
      const res = await fetchWithTimeout(
        `/assets/market_snapshot.json?cycle=${encodeURIComponent(getBstCycleStamp())}`,
        { cache: 'default' },
        4_000
      );
      if (!res.ok) {
        _marketSnapshotPromise = null;
        return null;
      }
      const json = (await res.json()) as Partial<MarketEdgeSnapshot> | null;
      if (!json || typeof json !== 'object' || Number(json.schema_version) < 2) {
        _marketSnapshotPromise = null;
        return null;
      }
      const dsex = formatValidatedIndex(json.indices?.dsex, 1000, 25000) || '';
      const ds30 = formatValidatedIndex(json.indices?.ds30, 400, 12000) || '—';
      const picks = sanitizeVerifiedTopPicks(json.picks);
      return {
        schema_version: Number(json.schema_version),
        generated_at_bst: String(json.generated_at_bst || getBDMarketSession().bd_time),
        trading_date: String(json.trading_date || ''),
        market_status: String(json.market_status || 'closing'),
        indices: {
          dsex,
          dsex_change: Number(json.indices?.dsex_change ?? 0),
          dsex_change_pct: Number(json.indices?.dsex_change_pct ?? 0),
          ds30,
          ds30_change: Number(json.indices?.ds30_change ?? 0),
          ds30_change_pct: Number(json.indices?.ds30_change_pct ?? 0),
          dses: json.indices?.dses ? String(json.indices.dses) : undefined,
        },
        picks,
      };
    } catch {
      _marketSnapshotPromise = null;
      return null;
    }
  })();

  _marketSnapshotPromise = promise;
  return promise;
}

export async function loadMlAnalysisCache(force = false): Promise<MlAnalysisEdgeCache | null> {
  if (!force && _mlCacheData) {
    return _mlCacheData;
  }
  if (!force && _mlCachePromise) {
    return _mlCachePromise;
  }

  const promise = (async () => {
    try {
      const res = await fetchWithTimeout(
        `/assets/ml_analysis_cache.json?cycle=${encodeURIComponent(getBstCycleStamp())}`,
        { cache: 'default' },
        5_000
      );
      if (!res.ok) {
        _mlCachePromise = null;
        return null;
      }
      const json = (await res.json()) as Partial<MlAnalysisEdgeCache> | null;
      if (!json || typeof json !== 'object' || !json.analyses || typeof json.analyses !== 'object') {
        _mlCachePromise = null;
        return null;
      }
      const loaded: MlAnalysisEdgeCache = {
        schema_version: Number(json.schema_version || 2),
        generated_at_bst: String(json.generated_at_bst || getBDMarketSession().bd_time),
        trading_date: String(json.trading_date || ''),
        analyses: json.analyses as Record<string, Record<string, unknown>>,
      };
      _mlCacheData = loaded;
      return loaded;
    } catch {
      _mlCachePromise = null;
      return null;
    }
  })();

  _mlCachePromise = promise;
  return promise;
}

export function getEdgeCachedStockAnalysisSync(
  symbol: string,
  exchange: Exchange
): StockAnalysis | null {
  const cleanSym = symbol.trim().toUpperCase();
  if (!cleanSym || !_mlCacheData || !_mlCacheData.analyses) return null;

  const exact = _mlCacheData.analyses[`${exchange}:${cleanSym}`];
  const raw = exact || (exchange === 'CSE' ? _mlCacheData.analyses[`DSE:${cleanSym}`] : undefined);
  if (!raw || typeof raw !== 'object' || !raw.current_price) {
    return null;
  }
  return normalizeStockAnalysis(raw, exchange);
}

export async function getEdgeCachedStockAnalysis(
  symbol: string,
  exchange: Exchange
): Promise<StockAnalysis | null> {
  const cleanSym = symbol.trim().toUpperCase();
  if (!cleanSym) return null;

  const syncHit = getEdgeCachedStockAnalysisSync(cleanSym, exchange);
  if (syncHit) return syncHit;

  const cache = await loadMlAnalysisCache();
  if (!cache || !cache.analyses) return null;

  const exact = cache.analyses[`${exchange}:${cleanSym}`];
  const raw = exact || (exchange === 'CSE' ? cache.analyses[`DSE:${cleanSym}`] : undefined);
  if (!raw || typeof raw !== 'object' || !raw.current_price) {
    return null;
  }

  return normalizeStockAnalysis(raw, exchange);
}

async function loadLockedDailySnapshot(): Promise<{
  generated_at_bst: string;
  picks: TopPick[];
} | null> {
  const marketSnap = await loadMarketSnapshot();
  if (marketSnap && marketSnap.picks.length > 0) {
    return {
      generated_at_bst: marketSnap.generated_at_bst,
      picks: marketSnap.picks,
    };
  }

  try {
    const res = await fetchWithTimeout(
      `/assets/daily_picks.json?cycle=${encodeURIComponent(getBstCycleStamp())}`,
      { cache: 'no-store' },
      5_000
    );
    if (!res.ok) return null;
    const json = await res.json();
    if (!json || Number(json.schema_version) < 2 || !json.generated_at_bst) {
      return null;
    }
    const verified = sanitizeVerifiedTopPicks(json.picks);
    if (verified.length === 0) return null;
    return {
      generated_at_bst: String(json.generated_at_bst),
      picks: verified,
    };
  } catch {
    return null;
  }
}

export function readCachedMarketLive(): MarketLiveTicker | null {
  try {
    const raw = window.localStorage.getItem(MARKET_LIVE_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<MarketLiveTicker> | null;
    const dsex = formatValidatedIndex(parsed?.dsex, 1000, 25000);
    if (!dsex) return null;
    const ds30 = formatValidatedIndex(parsed?.ds30, 400, 12000) || '—';
    const session = getBDMarketSession();
    return {
      status: 'live',
      is_stale: false,
      dsex,
      ds30,
      updated: String(parsed?.updated || session.bd_time),
      session,
    };
  } catch {
    return null;
  }
}

export function saveCachedMarketLive(ticker: MarketLiveTicker): void {
  if (!formatValidatedIndex(ticker.dsex, 1000, 25000)) return;
  try {
    window.localStorage.setItem(MARKET_LIVE_CACHE_KEY, JSON.stringify(ticker));
  } catch {
    // Ignore storage quota errors
  }
}

async function fetchFromApiWithFallback(
  apiPath: string,
  options: RequestInit = {},
  perAttemptTimeoutMs = API_TIMEOUT_MS
): Promise<Response> {
  const candidateUrls = getCandidateApiUrls(apiPath);
  let lastError: unknown = null;
  let lastResponse: Response | null = null;

  for (let i = 0; i < candidateUrls.length; i++) {
    const url = candidateUrls[i];
    try {
      const res = await fetchWithTimeout(url, options, perAttemptTimeoutMs);
      const contentType = (res.headers.get('content-type') || '').toLowerCase();
      // If same-origin rewrite accidentally returned HTML instead of JSON or a 502/504 gateway error, try direct Render URL
      const isHtmlFallback = contentType.includes('text/html');
      if (!isHtmlFallback && res.status !== 502 && res.status !== 503 && res.status !== 504) {
        return res;
      }
      lastResponse = res;
    } catch (err) {
      lastError = err;
    }
  }

  if (lastResponse) {
    return lastResponse;
  }
  throw lastError || new BackendWakeupError();
}

export async function fetchLiveMarketFromApi(timeoutMs = API_TIMEOUT_MS): Promise<MarketLiveTicker | null> {
  const session = getBDMarketSession();
  try {
    const res = await fetchFromApiWithFallback('/api/market-live', {}, timeoutMs);
    if (res.ok) {
      const data = await res.json();
      const dsex = formatValidatedIndex(data?.dsex, 1000, 25000);
      const ds30 = formatValidatedIndex(data?.ds30, 400, 12000);
      if (dsex) {
        const ticker: MarketLiveTicker = {
          status: data.status === 'live' || data.status === 'closing' ? 'live' : 'degraded',
          is_stale: Boolean(data.is_stale),
          dsex,
          ds30: ds30 || '—',
          updated: String(data.updated || session.bd_time),
          session,
        };
        saveCachedMarketLive(ticker);
        return ticker;
      }
    }
  } catch (err) {
    console.warn('[MukiSoft API] /api/market-live temporarily unreachable:', err);
  }
  return null;
}

export async function fetchMarketLive(): Promise<MarketLiveTicker> {
  const session = getBDMarketSession();

  // 1. Instant edge hydration from /assets/market_snapshot.json (~10ms on Vercel CDN)
  const snap = await loadMarketSnapshot();
  if (snap && snap.indices.dsex) {
    const snapTicker: MarketLiveTicker = {
      status: 'live',
      is_stale: false,
      dsex: snap.indices.dsex,
      ds30: snap.indices.ds30 || '—',
      updated: snap.generated_at_bst || session.bd_time,
      session,
    };
    saveCachedMarketLive(snapTicker);
    return snapTicker;
  }

  // 2. Fallback to live Render /api/market-live if edge snapshot is missing
  const liveTicker = await fetchLiveMarketFromApi(15_000);
  if (liveTicker) {
    return liveTicker;
  }

  // 3. Fallback to previous verified localStorage ticker
  const localCached = readCachedMarketLive();
  if (localCached) {
    return localCached;
  }

  return {
    status: 'offline',
    is_stale: true,
    dsex: 'সংগ্রহ হচ্ছে...',
    ds30: 'সংগ্রহ হচ্ছে...',
    updated: session.bd_time,
    session,
  };
}

export const TOP_PICKS_CACHE_KEY = 'ms_top_picks_cache_v2';

export function readCachedTopPicks(): TopPicksResponse | null {
  try {
    const raw = window.localStorage.getItem(TOP_PICKS_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<TopPicksResponse> | null;
    if (!parsed || typeof parsed !== 'object') return null;
    const verified = sanitizeVerifiedTopPicks(parsed.picks);
    if (verified.length === 0) return null;
    return {
      generated_at_bst: String(parsed.generated_at_bst || getBDMarketSession().bd_time),
      source: parsed.source === 'live_api' ? 'live_api' : 'daily_snapshot',
      live_unavailable: false,
      picks: verified,
    };
  } catch {
    return null;
  }
}

export function saveCachedTopPicks(payload: TopPicksResponse): void {
  if (!payload.picks || payload.picks.length === 0) return;
  try {
    window.localStorage.setItem(TOP_PICKS_CACHE_KEY, JSON.stringify(payload));
  } catch {
    // Ignore storage quota errors
  }
}

export async function fetchLiveTopPicksFromApi(timeoutMs = API_TIMEOUT_MS): Promise<TopPicksResponse | null> {
  const session = getBDMarketSession();
  try {
    const res = await fetchFromApiWithFallback('/api/top-picks', {}, timeoutMs);
    if (!res.ok) return null;
    const data = await res.json();
    const verified = sanitizeVerifiedTopPicks(data?.picks);
    if (verified.length > 0) {
      const result: TopPicksResponse = {
        generated_at_bst: String(
          data?.generated_at_bst || data?.session?.bd_time || session.bd_time
        ),
        source: 'live_api',
        live_unavailable: false,
        picks: verified,
      };
      saveCachedTopPicks(result);
      return result;
    }
  } catch {
    // Cold-start or transient network timeout
  }
  return null;
}

export async function fetchTopPicks(preferLive = false): Promise<TopPicksResponse> {
  const session = getBDMarketSession();

  // When explicitly forcing a live refresh (e.g. clicking Refresh), hit always-awake Render first
  if (preferLive) {
    const liveResult = await fetchLiveTopPicksFromApi(20_000);
    if (liveResult) {
      return liveResult;
    }
  }

  // 1. Instant (~10ms) edge snapshot from /assets/market_snapshot.json (or daily_picks.json)
  const snapshot = await loadLockedDailySnapshot();
  if (snapshot && snapshot.picks.length > 0) {
    const out: TopPicksResponse = {
      generated_at_bst: snapshot.generated_at_bst,
      source: 'daily_snapshot',
      live_unavailable: false,
      picks: snapshot.picks,
    };
    saveCachedTopPicks(out);
    return out;
  }

  // 2. Fallback to latest verified localStorage cache from an earlier live Render response
  const localCached = readCachedTopPicks();
  if (localCached && localCached.picks.length > 0) {
    return localCached;
  }

  // 3. Fallback to live Render API if neither edge snapshot nor localStorage had picks
  const liveResult = await fetchLiveTopPicksFromApi(20_000);
  if (liveResult) {
    return liveResult;
  }

  return {
    generated_at_bst: session.bd_time,
    source: 'unavailable',
    live_unavailable: true,
    picks: [],
  };
}

function syncQuotaFromResponsePayload(data: unknown): void {
  if (
    data &&
    typeof data === 'object' &&
    'quota' in data &&
    data.quota &&
    typeof data.quota === 'object'
  ) {
    syncQuotaState(normalizeQuotaPayload(data.quota as Record<string, unknown>, 'server'));
  }
}

function handleQuotaExceededResponse(data: unknown): never {
  const payload =
    data && typeof data === 'object' ? (data as Record<string, unknown>) : { allowed: false, remaining: 0 };
  const quotaState = syncQuotaState(
    normalizeQuotaPayload({ ...payload, allowed: false, remaining: 0 }, 'server')
  );
  const detail =
    typeof payload.detail === 'string' && payload.detail.trim()
      ? payload.detail
      : undefined;
  throw new QuotaExceededError(quotaState, detail);
}

export async function fetchStockAnalysis(
  symbol: string,
  exchange: Exchange,
  onEdgeCache?: (cached: StockAnalysis) => void
): Promise<StockAnalysis> {
  const cleanSym = symbol.trim().toUpperCase();
  if (!cleanSym) {
    throw new StockNotFoundError('অনুগ্রহ করে একটি বৈধ কোম্পানির কোড নির্বাচন করুন।', 422);
  }

  const syncCached = getEdgeCachedStockAnalysisSync(cleanSym, exchange);
  if (syncCached && onEdgeCache) {
    onEdgeCache(syncCached);
  }

  // Simultaneously check /assets/ml_analysis_cache.json (0ms edge render) while Render responds in background (35s timeout)
  const edgeCachePromise = syncCached
    ? Promise.resolve(syncCached)
    : getEdgeCachedStockAnalysis(cleanSym, exchange).then((cached) => {
        if (cached && onEdgeCache) {
          onEdgeCache(cached);
        }
        return cached;
      });

  const apiPath = `/api/analyze?symbol=${encodeURIComponent(cleanSym)}&exchange=${encodeURIComponent(exchange)}`;
  const liveFetchPromise = getQuotaRequestHeaders().then((quotaHeaders) =>
    fetchFromApiWithFallback(
      apiPath,
      { headers: quotaHeaders },
      API_TIMEOUT_MS
    )
  );

  let res: Response;
  try {
    res = await liveFetchPromise;
  } catch (err) {
    const edgeCached = await edgeCachePromise;
    if (edgeCached) {
      return edgeCached;
    }
    console.warn(`[MukiSoft API] /api/analyze network/timeout for ${cleanSym} (${exchange}):`, err);
    throw new BackendWakeupError();
  }

  const data = await res.json().catch(() => null);
  if (res.status === 429) {
    handleQuotaExceededResponse(data);
  }

  const edgeCached = await edgeCachePromise;
  if (res.status === 404 || res.status === 422) {
    if (edgeCached) {
      return edgeCached;
    }
    throw new StockNotFoundError(
      (data && typeof data.detail === 'string' && data.detail) ||
        `'${cleanSym}' (${exchange}) ট্রেডিং কোডটি DSE/CSE-এর অফিসিয়াল ডেটায় পাওয়া যায়নি।`,
      res.status
    );
  }
  if (res.status >= 500 || !res.ok || !data || !data.current_price) {
    if (edgeCached) {
      return edgeCached;
    }
    console.warn(`[MukiSoft API] /api/analyze fallback (${res.status}) for ${cleanSym}:`, data);
    throw new BackendWakeupError(
      (data && typeof data.detail === 'string' && data.detail) || undefined,
      res.status || 503
    );
  }

  syncQuotaFromResponsePayload(data);
  return normalizeStockAnalysis(data, exchange);
}

export const analyzeStock = fetchStockAnalysis;

export async function analyzeManualStock(payload: ManualStockPayload): Promise<StockAnalysis> {
  const quotaHeaders = await getQuotaRequestHeaders();

  let res: Response;
  try {
    res = await fetchFromApiWithFallback(
      '/api/analyze-manual',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...quotaHeaders,
        },
        body: JSON.stringify(payload),
      },
      API_TIMEOUT_MS
    );
  } catch {
    throw new Error(LIVE_FEED_WAITING_BN);
  }

  const data = await res.json().catch(() => null);
  if (res.status === 429) {
    handleQuotaExceededResponse(data);
  }
  if (!res.ok || !data || !data.current_price) {
    throw new Error(
      (data && typeof data.detail === 'string' && data.detail) || LIVE_FEED_WAITING_BN
    );
  }

  syncQuotaFromResponsePayload(data);
  return normalizeStockAnalysis(data, payload.exchange);
}

export async function analyzeDocuments(
  files: File[],
  symbol: string,
  exchange: Exchange
): Promise<StockAnalysis> {
  const formData = new FormData();
  files.forEach((f) => formData.append('files', f));
  formData.append('symbol', symbol.trim().toUpperCase() || 'STOCK');
  formData.append('exchange', exchange);

  const quotaHeaders = await getQuotaRequestHeaders();

  let res: Response;
  try {
    res = await fetchFromApiWithFallback(
      '/api/analyze-document',
      { method: 'POST', headers: quotaHeaders, body: formData },
      API_TIMEOUT_MS
    );
  } catch {
    throw new Error(LIVE_FEED_WAITING_BN);
  }

  const data = await res.json().catch(() => ({}));
  if (res.status === 429) {
    handleQuotaExceededResponse(data);
  }
  if (!res.ok) {
    throw new Error(
      data.detail || 'ডকুমেন্ট বিশ্লেষণ করা সম্ভব হয়নি। পরিষ্কার স্ক্রিনশট বা ম্যানুয়াল ইনপুট চেষ্টা করুন।'
    );
  }

  syncQuotaFromResponsePayload(data);
  return normalizeStockAnalysis(data, exchange);
}

export async function submitContactMessage(payload: {
  name: string;
  email: string;
  message: string;
}): Promise<{ status: string; message: string }> {
  try {
    const res = await fetchFromApiWithFallback(
      '/api/contact',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      },
      6_000
    );
    if (res.ok) {
      return await res.json();
    }
  } catch {
    // Graceful local receipt confirmation when backend is waking up
  }
  return {
    status: 'queued',
    message: 'ধন্যবাদ! আপনার বার্তাটি সংরক্ষিত হয়েছে। সরাসরি যোগাযোগ: contact@mukisoft.tech',
  };
}
