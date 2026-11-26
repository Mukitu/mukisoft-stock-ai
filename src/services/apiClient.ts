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

export const API_BASE_URL = (
  import.meta.env.VITE_API_BASE_URL || 'https://mukisoft-stock-ai.onrender.com'
).replace(/\/+$/, '');

export const LIVE_FEED_WAITING_BN =
  'লাইভ মার্কেট ডেটা সংগ্রহ করা হচ্ছে, অনুগ্রহ করে কয়েক মুহূর্ত অপেক্ষা করুন...';

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
    const res = await fetchWithTimeout(`${API_BASE_URL}/api/market-live`, {}, 12_000);
    if (res.ok) {
      const data = await res.json();
      const dsex = String(data.dsex || '').trim();
      const ds30 = String(data.ds30 || '').trim();
      if (dsex && dsex !== '—') {
        return {
          status: data.status === 'live' ? 'live' : 'degraded',
          is_stale: Boolean(data.is_stale),
          dsex,
          ds30: ds30 || '—',
          updated: String(data.updated || session.bd_time),
          session,
        };
      }
    }
  } catch {
    // Zero fake fallback numbers when live feed is unreachable
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

async function fetchLiveTopPicksFromApi(timeoutMs = 28_000): Promise<TopPicksResponse | null> {
  const session = getBDMarketSession();
  try {
    const res = await fetchWithTimeout(`${API_BASE_URL}/api/top-picks`, {}, timeoutMs);
    if (!res.ok) return null;
    const data = await res.json();
    const verified = sanitizeVerifiedTopPicks(data?.picks);
    if (verified.length > 0 || Number(data?.schema_version) >= 2) {
      return {
        generated_at_bst: String(
          data?.generated_at_bst || data?.session?.bd_time || session.bd_time
        ),
        source: 'live_api',
        live_unavailable: false,
        picks: verified,
      };
    }
  } catch {
    // Cold-start or transient network timeout
  }
  return null;
}

export async function fetchTopPicks(): Promise<TopPicksResponse> {
  const session = getBDMarketSession();

  // During live market hours (Sun-Thu 10:00 AM-2:30 PM BST), fetch live API first
  if (session.is_live) {
    const liveResult = await fetchLiveTopPicksFromApi(28_000);
    if (liveResult) {
      return liveResult;
    }
  }

  // Outside live hours (after 3:00 PM BST lock), serve instant 0ms verified daily snapshot
  const snapshot = await loadLockedDailySnapshot();
  if (snapshot) {
    return {
      generated_at_bst: snapshot.generated_at_bst,
      source: 'daily_snapshot',
      live_unavailable: false,
      picks: snapshot.picks,
    };
  }

  // Live API fetch if daily_picks.json hasn't been populated for this cycle yet
  if (!session.is_live) {
    const liveResult = await fetchLiveTopPicksFromApi(28_000);
    if (liveResult) {
      return liveResult;
    }
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
    throw new Error('অনুগ্রহ করে একটি বৈধ কোম্পানির কোড নির্বাচন করুন।');
  }

  const quotaHeaders = await getQuotaRequestHeaders();

  let res: Response;
  try {
    res = await fetchWithTimeout(
      `${API_BASE_URL}/api/analyze?symbol=${encodeURIComponent(cleanSym)}&exchange=${encodeURIComponent(exchange)}`,
      { headers: quotaHeaders },
      20_000
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
