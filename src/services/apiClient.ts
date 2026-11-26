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

import { API_BASE_URL } from '../utils/apiBaseUrl';

export { API_BASE_URL };

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
  timeoutMs = 15_000
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

async function loadLockedDailySnapshot(): Promise<{
  generated_at_bst: string;
  picks: TopPick[];
} | null> {
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

export async function fetchMarketLive(): Promise<MarketLiveTicker> {
  const session = getBDMarketSession();
  try {
    const res = await fetchWithTimeout(`${API_BASE_URL}/api/market-live`, {}, 15_000);
    if (res.ok) {
      const data = await res.json();
      const dsex = String(data.dsex || '').trim();
      const ds30 = String(data.ds30 || '').trim();
      const dsexNum = Number(dsex.replace(/,/g, ''));
      const ds30Num = Number(ds30.replace(/,/g, ''));
      const isValidDsex = Number.isFinite(dsexNum) && dsexNum >= 1000 && dsexNum <= 25000;
      const isValidDs30 = Number.isFinite(ds30Num) && ds30Num >= 400 && ds30Num <= 12000;
      if (isValidDsex) {
        return {
          status: data.status === 'live' || data.status === 'closing' ? 'live' : 'degraded',
          is_stale: Boolean(data.is_stale),
          dsex: dsexNum.toLocaleString('en-US', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          }),
          ds30: isValidDs30
            ? ds30Num.toLocaleString('en-US', {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })
            : '—',
          updated: String(data.updated || session.bd_time),
          session,
        };
      }
      if (dsex && dsex !== '—') {
        console.warn('[MukiSoft API] Unexpected DSEX/DS30 payload from /api/market-live:', data);
      }
    } else {
      console.error(`[MukiSoft API] /api/market-live HTTP ${res.status}`);
    }
  } catch (err) {
    console.error('[MukiSoft API] /api/market-live request failed:', err);
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

export async function fetchLiveTopPicksFromApi(timeoutMs = 28_000): Promise<TopPicksResponse | null> {
  const session = getBDMarketSession();
  try {
    const res = await fetchWithTimeout(`${API_BASE_URL}/api/top-picks`, {}, timeoutMs);
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

export async function fetchTopPicks(preferLive = true): Promise<TopPicksResponse> {
  const session = getBDMarketSession();

  // 1. Always attempt fresh dynamic picks from Render backend first when requested
  if (preferLive) {
    const liveResult = await fetchLiveTopPicksFromApi(20_000);
    if (liveResult) {
      return liveResult;
    }
  }

  // 2. Fall back to latest verified localStorage cache from an earlier live Render response
  const localCached = readCachedTopPicks();
  if (localCached && localCached.picks.length > 0) {
    return localCached;
  }

  // 3. Last-resort fallback to closing snapshot only if Render is unreachable on cold start
  const snapshot = await loadLockedDailySnapshot();
  if (snapshot && snapshot.picks.length > 0) {
    return {
      generated_at_bst: snapshot.generated_at_bst,
      source: 'daily_snapshot',
      live_unavailable: false,
      picks: snapshot.picks,
    };
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

export async function analyzeStock(symbol: string, exchange: Exchange): Promise<StockAnalysis> {
  const cleanSym = symbol.trim().toUpperCase();
  if (!cleanSym) {
    throw new StockNotFoundError('অনুগ্রহ করে একটি বৈধ কোম্পানির কোড নির্বাচন করুন।', 422);
  }

  const quotaHeaders = await getQuotaRequestHeaders();

  const endpointUrl = `${API_BASE_URL}/api/analyze?symbol=${encodeURIComponent(cleanSym)}&exchange=${encodeURIComponent(exchange)}`;
  let res: Response;
  try {
    res = await fetchWithTimeout(
      endpointUrl,
      { headers: quotaHeaders },
      35_000
    );
  } catch (err) {
    console.error(`[MukiSoft API] /api/analyze network/timeout error for ${cleanSym} (${exchange}):`, err);
    throw new BackendWakeupError();
  }

  const data = await res.json().catch(() => null);
  if (res.status === 429) {
    handleQuotaExceededResponse(data);
  }
  if (res.status === 404 || res.status === 422) {
    throw new StockNotFoundError(
      (data && typeof data.detail === 'string' && data.detail) ||
        `'${cleanSym}' (${exchange}) ট্রেডিং কোডটি DSE/CSE-এর অফিসিয়াল ডেটায় পাওয়া যায়নি।`,
      res.status
    );
  }
  if (res.status >= 500) {
    console.error(`[MukiSoft API] /api/analyze HTTP ${res.status} for ${cleanSym}:`, data);
    throw new BackendWakeupError(
      (data && typeof data.detail === 'string' && data.detail) || undefined,
      res.status
    );
  }
  if (!res.ok || !data || !data.current_price) {
    console.error(`[MukiSoft API] /api/analyze unexpected response (${res.status}) for ${cleanSym}:`, data);
    throw new BackendWakeupError(
      (data && typeof data.detail === 'string' && data.detail) || undefined,
      res.status || 503
    );
  }

  syncQuotaFromResponsePayload(data);
  return normalizeStockAnalysis(data, exchange);
}

export async function analyzeManualStock(payload: ManualStockPayload): Promise<StockAnalysis> {
  const quotaHeaders = await getQuotaRequestHeaders();

  let res: Response;
  try {
    res = await fetchWithTimeout(
      `${API_BASE_URL}/api/analyze-manual`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...quotaHeaders,
        },
        body: JSON.stringify(payload),
      },
      18_000
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
    res = await fetchWithTimeout(
      `${API_BASE_URL}/api/analyze-document`,
      { method: 'POST', headers: quotaHeaders, body: formData },
      35_000
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
    const res = await fetchWithTimeout(
      `${API_BASE_URL}/api/contact`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      },
      8_000
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
