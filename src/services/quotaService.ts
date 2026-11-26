/**
 * Tamper-Proof 24-Hour Free Analysis Quota Service (Max 2 Free Analyses per 24h).
 * Synchronizes authoritative server-side IP + Device Fingerprint quota state
 * with localStorage so the live Bangla countdown ticks smoothly without flicker,
 * while clearing cookies/localStorage/Incognito immediately re-hydrates from server truth.
 */

import { getDeviceFingerprintHash } from '../utils/deviceFingerprint';
import { toBanglaDigits } from '../utils/quantConsensus';
import { API_BASE_URL as DEFAULT_API_BASE } from '../utils/apiBaseUrl';
import { BDAPPS_API_BASE, getBdappsSession, isSessionActive } from './bdappsService';

export const FREE_QUOTA_LIMIT = 2;
export const QUOTA_WINDOW_SECONDS = 86_400; // 24 hours
export const QUOTA_STORAGE_KEY = 'ms_free_quota_state_v1';
export const QUOTA_UPDATED_EVENT = 'ms-free-quota-updated';

export const QUOTA_ENDPOINT_URL = (
  import.meta.env.VITE_QUOTA_API_URL || `${BDAPPS_API_BASE}/free_quota.php`
).trim();

const FALLBACK_QUOTA_ENDPOINT_URL = `${DEFAULT_API_BASE}/api/free-quota`;

export interface FreeQuotaState {
  allowed: boolean;
  isSubscribed: boolean;
  unlimited: boolean;
  limit: number;
  windowStart: number; // unix epoch seconds
  symbols: string[];
  remaining: number;
  resetInSeconds: number;
  syncedAt: number; // client epoch ms when resetInSeconds was captured
  source: 'server' | 'cache' | 'default';
}

export class QuotaExceededError extends Error {
  public readonly quota: FreeQuotaState;

  constructor(quota: FreeQuotaState, message?: string) {
    super(
      message ||
        'আজকের ২টি ফ্রি বিশ্লেষণ শেষ হয়েছে! আনলিমিটেড অ্যাক্সেসের জন্য Robi & Cirkle নম্বর দিয়ে সাবস্ক্রাইব করুন।'
    );
    this.name = 'QuotaExceededError';
    this.quota = quota;
  }
}

export function createDefaultQuotaState(isSubscribed = false): FreeQuotaState {
  return {
    allowed: true,
    isSubscribed,
    unlimited: isSubscribed,
    limit: FREE_QUOTA_LIMIT,
    windowStart: 0,
    symbols: [],
    remaining: FREE_QUOTA_LIMIT,
    resetInSeconds: 0,
    syncedAt: Date.now(),
    source: 'default',
  };
}

export function computeLiveResetSeconds(state: FreeQuotaState, nowMs = Date.now()): number {
  if (state.isSubscribed || state.unlimited) return 0;
  if (state.resetInSeconds <= 0) return 0;
  const elapsedSec = Math.max(0, Math.floor((nowMs - state.syncedAt) / 1000));
  return Math.max(0, state.resetInSeconds - elapsedSec);
}

export function normalizeQuotaPayload(
  raw: Record<string, unknown>,
  source: FreeQuotaState['source'] = 'server'
): FreeQuotaState {
  const isSub = Boolean(raw.isSubscribed || raw.unlimited);
  const symbols = Array.isArray(raw.symbols)
    ? raw.symbols.map((s) => String(s).trim().toUpperCase()).filter(Boolean)
    : [];
  const limit = Number.isFinite(Number(raw.limit)) ? Number(raw.limit) : FREE_QUOTA_LIMIT;
  const remaining = isSub
    ? limit
    : Number.isFinite(Number(raw.remaining))
      ? Math.max(0, Math.min(limit, Number(raw.remaining)))
      : Math.max(0, limit - symbols.length);
  const resetInSeconds = isSub
    ? 0
    : Math.max(0, Math.floor(Number(raw.resetInSeconds ?? 0) || 0));
  const windowStart = Math.max(0, Math.floor(Number(raw.windowStart ?? 0) || 0));
  const allowed = isSub ? true : raw.allowed !== undefined ? Boolean(raw.allowed) : remaining > 0;

  return {
    allowed,
    isSubscribed: isSub,
    unlimited: isSub,
    limit,
    windowStart,
    symbols,
    remaining,
    resetInSeconds,
    syncedAt: Date.now(),
    source,
  };
}

export function readStoredQuotaState(): FreeQuotaState {
  const activeSub = isSessionActive(getBdappsSession());
  if (activeSub) {
    return createDefaultQuotaState(true);
  }

  try {
    const raw = window.localStorage.getItem(QUOTA_STORAGE_KEY);
    if (!raw) return createDefaultQuotaState(false);
    const parsed = JSON.parse(raw) as Partial<FreeQuotaState>;
    if (!parsed || typeof parsed !== 'object') return createDefaultQuotaState(false);

    const syncedAt = typeof parsed.syncedAt === 'number' ? parsed.syncedAt : Date.now();
    const baseReset = Math.max(0, Math.floor(Number(parsed.resetInSeconds ?? 0) || 0));
    const elapsedSec = Math.max(0, Math.floor((Date.now() - syncedAt) / 1000));
    const currentReset = Math.max(0, baseReset - elapsedSec);
    const symbols = Array.isArray(parsed.symbols)
      ? parsed.symbols.map((s) => String(s).trim().toUpperCase()).filter(Boolean)
      : [];

    // If the 24-hour window elapsed locally, reset cleanly until server confirms
    if (symbols.length > 0 && currentReset <= 0) {
      return createDefaultQuotaState(false);
    }

    const remaining = Math.max(0, FREE_QUOTA_LIMIT - symbols.length);
    return {
      allowed: remaining > 0,
      isSubscribed: false,
      unlimited: false,
      limit: FREE_QUOTA_LIMIT,
      windowStart: Math.max(0, Math.floor(Number(parsed.windowStart ?? 0) || 0)),
      symbols,
      remaining,
      resetInSeconds: currentReset,
      syncedAt: Date.now(),
      source: 'cache',
    };
  } catch {
    return createDefaultQuotaState(false);
  }
}

export function syncQuotaState(state: FreeQuotaState): FreeQuotaState {
  try {
    window.localStorage.setItem(QUOTA_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Ignore storage quota errors in restricted browsing modes
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent<FreeQuotaState>(QUOTA_UPDATED_EVENT, { detail: state }));
  }
  return state;
}

export function clearStoredQuotaState(): void {
  try {
    window.localStorage.removeItem(QUOTA_STORAGE_KEY);
  } catch {
    // Ignore
  }
}

export async function getQuotaRequestHeaders(): Promise<Record<string, string>> {
  const deviceHash = await getDeviceFingerprintHash();
  const headers: Record<string, string> = {
    'X-Device-Hash': deviceHash,
  };

  const session = getBdappsSession();
  if (isSessionActive(session)) {
    if (session.subscriberId) headers['X-Subscriber-Id'] = session.subscriberId;
    if (session.mobile) headers['X-Subscriber-Mobile'] = session.mobile;
  }

  return headers;
}

async function postSingleQuotaUrl(
  url: string,
  body: Record<string, unknown>,
  timeoutMs = 8_000
): Promise<{ status: number; data: Record<string, unknown> } | null> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  const isPhpEndpoint = url.toLowerCase().includes('.php');

  try {
    const formFields: Record<string, string> = {};
    for (const [key, val] of Object.entries(body)) {
      if (val !== undefined && val !== null) {
        formFields[key] = String(val);
      }
    }

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': isPhpEndpoint
          ? 'application/x-www-form-urlencoded;charset=UTF-8'
          : 'application/json',
        Accept: 'application/json',
        ...(typeof body.deviceHash === 'string' ? { 'X-Device-Hash': body.deviceHash } : {}),
        ...(typeof body.subscriberId === 'string' ? { 'X-Subscriber-Id': body.subscriberId } : {}),
        ...(typeof body.mobile === 'string' ? { 'X-Subscriber-Mobile': body.mobile } : {}),
      },
      body: isPhpEndpoint ? new URLSearchParams(formFields).toString() : JSON.stringify(body),
      signal: controller.signal,
    });

    if (res.status !== 200 && res.status !== 429) {
      return null;
    }

    const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (!data || typeof data !== 'object') {
      return null;
    }
    return { status: res.status, data };
  } catch {
    return null;
  } finally {
    window.clearTimeout(timer);
  }
}

async function postQuotaEndpoint(
  body: Record<string, unknown>,
  timeoutMs = 8_000
): Promise<{ status: number; data: Record<string, unknown> } | null> {
  const primary = await postSingleQuotaUrl(QUOTA_ENDPOINT_URL, body, timeoutMs);
  if (primary) return primary;

  if (FALLBACK_QUOTA_ENDPOINT_URL !== QUOTA_ENDPOINT_URL) {
    return postSingleQuotaUrl(FALLBACK_QUOTA_ENDPOINT_URL, body, timeoutMs);
  }
  return null;
}

/**
 * Fetches authoritative 24-hour quota status from the backend without consuming a credit.
 * Even if localStorage/cookies were cleared, this immediately restores the exact server-side
 * remaining credits and countdown timer for this IP + Device Fingerprint.
 */
export async function fetchServerQuotaStatus(): Promise<FreeQuotaState> {
  const session = getBdappsSession();
  if (isSessionActive(session)) {
    return syncQuotaState(createDefaultQuotaState(true));
  }

  const deviceHash = await getDeviceFingerprintHash();
  const res = await postQuotaEndpoint({
    action: 'status',
    deviceHash,
  });

  if (res) {
    const normalized = normalizeQuotaPayload(res.data, 'server');
    return syncQuotaState(normalized);
  }

  return readStoredQuotaState();
}

/**
 * Checks & consumes 1 credit for `symbol` on the server (or returns allowed: true
 * without consuming a credit if `symbol` was already analyzed in this 24-hour window).
 * Returns allowed: false on the 3rd distinct symbol (HTTP 429).
 */
export async function authorizeAndConsumeQuota(symbol: string): Promise<FreeQuotaState> {
  const cleanSym = symbol.trim().toUpperCase();
  const session = getBdappsSession();
  if (isSessionActive(session)) {
    return syncQuotaState(createDefaultQuotaState(true));
  }

  const deviceHash = await getDeviceFingerprintHash();
  const res = await postQuotaEndpoint({
    action: 'consume',
    deviceHash,
    symbol: cleanSym,
  });

  if (res) {
    const normalized = normalizeQuotaPayload(res.data, 'server');
    if (res.status === 429) {
      normalized.allowed = false;
      normalized.remaining = 0;
    }
    return syncQuotaState(normalized);
  }

  // Fallback local 24h mirror only if backend quota endpoint is temporarily waking up
  const local = readStoredQuotaState();
  const liveReset = computeLiveResetSeconds(local);
  const nowSec = Math.floor(Date.now() / 1000);

  if (local.symbols.includes(cleanSym)) {
    return syncQuotaState({
      ...local,
      allowed: true,
      resetInSeconds: liveReset,
      syncedAt: Date.now(),
    });
  }

  if (local.symbols.length >= FREE_QUOTA_LIMIT && liveReset > 0) {
    return syncQuotaState({
      ...local,
      allowed: false,
      remaining: 0,
      resetInSeconds: liveReset,
      syncedAt: Date.now(),
    });
  }

  const nextSymbols = liveReset > 0 ? [...local.symbols, cleanSym] : [cleanSym];
  const windowStart = liveReset > 0 && local.windowStart > 0 ? local.windowStart : nowSec;
  const resetInSeconds = liveReset > 0 ? liveReset : QUOTA_WINDOW_SECONDS;

  return syncQuotaState({
    allowed: true,
    isSubscribed: false,
    unlimited: false,
    limit: FREE_QUOTA_LIMIT,
    windowStart,
    symbols: nextSymbols,
    remaining: Math.max(0, FREE_QUOTA_LIMIT - nextSymbols.length),
    resetInSeconds,
    syncedAt: Date.now(),
    source: 'cache',
  });
}

export function isSymbolAlreadyUnlocked(state: FreeQuotaState, symbol: string): boolean {
  if (state.isSubscribed || state.unlimited) return true;
  const clean = symbol.trim().toUpperCase();
  if (!clean) return false;
  const liveReset = computeLiveResetSeconds(state);
  if (state.symbols.length > 0 && liveReset <= 0) return false;
  return state.symbols.includes(clean);
}

/**
 * Formats seconds into Bangla "{HH} ঘণ্টা {MM} মিনিট" (e.g., "২৩ ঘণ্টা ৪৫ মিনিট").
 */
export function formatBanglaCountdownHM(totalSeconds: number): string {
  const clamped = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(clamped / 3600);
  const minutes = Math.floor((clamped % 3600) / 60);
  const hh = toBanglaDigits(String(hours).padStart(2, '0'));
  const mm = toBanglaDigits(String(minutes).padStart(2, '0'));
  return `${hh} ঘণ্টা ${mm} মিনিট`;
}

/**
 * Formats seconds into Bangla "{HH} ঘণ্টা {MM} মিনিট {SS} সেকেন্ড" (e.g., "২৩ ঘণ্টা ৪৫ মিনিট ১২ সেকেন্ড").
 */
export function formatBanglaCountdownHMS(totalSeconds: number): string {
  const clamped = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(clamped / 3600);
  const minutes = Math.floor((clamped % 3600) / 60);
  const seconds = clamped % 60;
  const hh = toBanglaDigits(String(hours).padStart(2, '0'));
  const mm = toBanglaDigits(String(minutes).padStart(2, '0'));
  const ss = toBanglaDigits(String(seconds).padStart(2, '0'));
  return `${hh} ঘণ্টা ${mm} মিনিট ${ss} সেকেন্ড`;
}
