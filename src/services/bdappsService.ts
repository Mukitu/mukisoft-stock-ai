/**
 * Official BDApps (Robi & Cirkle) Subscription, OTP & One-Click Unsubscribe Service
 * Communicates with PHP endpoints using application/x-www-form-urlencoded (URLSearchParams)
 * so $_POST reads every parameter cleanly.
 */

import { API_BASE_URL as BACKEND_API_BASE } from '../utils/apiBaseUrl';

export const BDAPPS_API_BASE = (
  import.meta.env.VITE_BDAPPS_API_BASE || 'https://stock.skillproof.top'
).replace(/\/+$/, '');

export const BDAPPS_SESSION_KEY = 'ms_bdapps_session';
export const BDAPPS_MSISDN_KEY = 'ms_bdapps_msisdn';
export const BDAPPS_COOKIE_NAME = 'ms_bdapps_session';
export const BDAPPS_MSISDN_COOKIE_NAME = 'ms_bdapps_msisdn';
export const BDAPPS_COOKIE_MAX_AGE_SECONDS = 31_536_000; // 365 days
export const BDAPPS_PENDING_KEY = 'ms_bdapps_pending';
export const BDAPPS_TOAST_KEY = 'ms_bdapps_toast';
export const BDAPPS_ACTIVE_LOCK_KEY = 'ms_bdapps_active_lock_v1';
export const BDAPPS_SESSION_EVENT = 'ms-bdapps-session-updated';
export const BDAPPS_TOAST_EVENT = 'ms-bdapps-toast-updated';

const QUOTA_STORAGE_KEY_REF = 'ms_free_quota_state_v1';
const QUOTA_UPDATED_EVENT_REF = 'ms-free-quota-updated';

export const SESSION_REPLACED_TOAST_BN =
  'অন্য একটি ব্রাউজারে এই নম্বরটি লগইন হওয়ায় এই সেশনটি লগআউট করা হয়েছে।';
export const UNSUBSCRIBED_TOAST_BN =
  'সাবস্ক্রিপশন সফলভাবে বাতিল হয়েছে। পুনরায় অ্যাক্সেস পেতে নম্বর দিয়ে OTP ভেরিফাই করুন।';

export const FRESH_GRACE_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
export const VERIFY_REDIRECT_GRACE_MS = 700; // 700ms handoff delay

export interface BdappsSession {
  subscriberId: string;
  subscriptionStatus: string;
  statusCode: string;
  mobile: string;
  msisdn?: string;
  localMobile?: string;
  verifiedAt: number;
  source: 'check_subscription' | 'send_otp' | 'verify_otp';
  consentAccepted: boolean;
  consentTimestamp: string;
  sessionToken: string;
}

export interface LocalActiveSessionLock {
  subscriberKey: string;
  sessionToken: string;
  updatedAt: number;
}

export interface BdappsPendingOtp {
  referenceNo: string;
  mobile: string;
  sentAt: number;
}

export interface BdappsApiResponse {
  success?: boolean;
  isSubscribed?: boolean;
  subscriptionStatus?: string;
  statusCode?: string;
  statusDetail?: string;
  subscriberId?: string;
  referenceNo?: string;
  message?: string;
  error?: string;
  _httpOk?: boolean;
  _httpStatus?: number;
}

export const ROBI_CIRKLE_DIGITS_REGEX = /^1[3-9][0-9]{8}$/;

/**
 * Normalizes any BD mobile / tel: subscriberId to 13-digit MSISDN (8801XXXXXXXXX).
 */
export function normalizeBdMsisdn(raw: string): string {
  let digits = String(raw || '').replace(/\D/g, '');
  if (digits.startsWith('01') && digits.length === 11) {
    digits = `88${digits}`;
  } else if (digits.startsWith('1') && digits.length === 10) {
    digits = `880${digits}`;
  }
  return /^8801[3-9][0-9]{8}$/.test(digits) ? digits : '';
}

/**
 * Normalizes any BD mobile / tel: subscriberId to 11-digit local mobile (01XXXXXXXXX).
 */
export function normalizeBdLocalMobile(raw: string): string {
  const msisdn = normalizeBdMsisdn(raw);
  return msisdn ? `0${msisdn.slice(3)}` : '';
}

/**
 * Strips non-digits and optional leading 880 / 0 prefixes to yield up to 10 digits (1XXXXXXXXX).
 */
export function sanitizeBdLocalDigits(raw: string): string {
  let digits = raw.replace(/\D/g, '');
  if (digits.startsWith('880') && digits.length > 10) {
    digits = digits.slice(3);
  } else if (digits.startsWith('0') && digits.length > 1) {
    digits = digits.slice(1);
  }
  return digits.slice(0, 10);
}

export function formatFullBdMobile(local10Digits: string): string {
  return `+880${local10Digits}`;
}

export function maskBdMobile(mobile: string): string {
  const digits = mobile.replace(/\D/g, '');
  const local = digits.startsWith('880') ? digits.slice(3) : digits;
  if (local.length >= 4) {
    return `+880 ••••••${local.slice(-2)}`;
  }
  return '+880 ••••••••';
}

export function maskSubscriberId(subscriberId: string): string {
  const clean = (subscriberId || '').trim();
  if (!clean) return 'tel:880••••••';
  if (clean.startsWith('tel:')) {
    const tail = clean.slice(4);
    const prefix = tail.slice(0, 3) || '880';
    const last2 = tail.length > 5 ? tail.slice(-2) : '';
    return `tel:${prefix}••••••${last2}`;
  }
  const prefix = clean.slice(0, 3);
  const last2 = clean.length > 5 ? clean.slice(-2) : '';
  return `tel:${prefix}••••••${last2}`;
}

export function normalizeSubscriptionStatus(status?: string): string {
  return String(status || '')
    .trim()
    .toUpperCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ');
}

export function isPendingChargingStatus(status?: string): boolean {
  const normalized = normalizeSubscriptionStatus(status);
  return normalized === 'INITIAL CHARGING PENDING' || normalized === 'PENDING';
}

export function isAuthenticatedStatus(status?: string): boolean {
  const normalized = normalizeSubscriptionStatus(status);
  return normalized === 'REGISTERED' || isPendingChargingStatus(normalized);
}

export function isActiveSubscriptionPayload(data: BdappsApiResponse | null | undefined): boolean {
  if (!data) return false;
  const status = normalizeSubscriptionStatus(data.subscriptionStatus);
  const code = String(data.statusCode || '')
    .trim()
    .toUpperCase();
  const isExplicitlyInactive =
    status === 'UNREGISTERED' || status === 'DEREGISTERED' || status === 'EXPIRED';
  const hasReferenceNo = Boolean(data.referenceNo && String(data.referenceNo).trim().length > 0);

  // An OTP challenge response carrying a referenceNo must NEVER bypass OTP verification
  // unless BDApps explicitly indicates the user is already subscribed / E1351.
  if (
    hasReferenceNo &&
    data.isSubscribed !== true &&
    !isAuthenticatedStatus(status) &&
    code !== 'E1351'
  ) {
    return false;
  }

  return (
    data.isSubscribed === true ||
    isAuthenticatedStatus(status) ||
    code === 'E1351' ||
    (data.success === true &&
      code === 'S1000' &&
      !isExplicitlyInactive &&
      data.isSubscribed !== false)
  );
}

export function isOtpChallengePayload(data: BdappsApiResponse | null | undefined): boolean {
  if (!data) return false;
  const ref = String(data.referenceNo || '').trim();
  if (!ref) return false;
  const code = String(data.statusCode || '')
    .trim()
    .toUpperCase();
  return code !== 'E1351' && data.isSubscribed !== true;
}

export function isUnregisteredPayload(data: BdappsApiResponse | null | undefined): boolean {
  if (!data) return false;
  // Never log out on transient gateway/HTTP errors (e.g., 500, 502, 503, 504)
  if (data._httpOk === false) return false;
  if (isActiveSubscriptionPayload(data)) return false;
  const status = normalizeSubscriptionStatus(data.subscriptionStatus);
  if (status === 'UNREGISTERED' || status === 'DEREGISTERED' || status === 'EXPIRED') {
    return true;
  }
  return data.isSubscribed === false && !data.error;
}

export function isSessionActive(session: BdappsSession | null | undefined): session is BdappsSession {
  if (!session) return false;
  return isAuthenticatedStatus(session.subscriptionStatus);
}

export function isWithinFreshGraceWindow(session: BdappsSession | null | undefined): boolean {
  if (!session || typeof session.verifiedAt !== 'number') return false;
  return Date.now() - session.verifiedAt < FRESH_GRACE_WINDOW_MS;
}

export function generateSessionToken(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    // Fallback below
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function getSubscriberLockKey(mobileOrId: string): string {
  const digits = String(mobileOrId || '').replace(/\D/g, '');
  if (digits.startsWith('01') && digits.length === 11) {
    return `88${digits}`;
  }
  if (digits.startsWith('1') && digits.length === 10) {
    return `880${digits}`;
  }
  return digits || String(mobileOrId || '').trim().toLowerCase();
}

export function readLocalActiveSessionLock(): LocalActiveSessionLock | null {
  try {
    const raw = window.localStorage.getItem(BDAPPS_ACTIVE_LOCK_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<LocalActiveSessionLock>;
    if (!parsed || !parsed.subscriberKey || !parsed.sessionToken) return null;
    return {
      subscriberKey: String(parsed.subscriberKey),
      sessionToken: String(parsed.sessionToken),
      updatedAt: Number(parsed.updatedAt || 0),
    };
  } catch {
    return null;
  }
}

export function writeLocalActiveSessionLock(session: BdappsSession): void {
  try {
    const lock: LocalActiveSessionLock = {
      subscriberKey: getSubscriberLockKey(session.mobile || session.subscriberId),
      sessionToken: session.sessionToken,
      updatedAt: Date.now(),
    };
    window.localStorage.setItem(BDAPPS_ACTIVE_LOCK_KEY, JSON.stringify(lock));
  } catch {
    // Ignore storage errors
  }
}

export function isLocalSessionLockConflict(session: BdappsSession | null | undefined): boolean {
  if (!session || !session.sessionToken) return false;
  const lock = readLocalActiveSessionLock();
  if (!lock) return false;
  const myKey = getSubscriberLockKey(session.mobile || session.subscriberId);
  return lock.subscriberKey === myKey && lock.sessionToken !== session.sessionToken;
}

function enrichSessionRecord(parsed: Partial<BdappsSession>): BdappsSession | null {
  if (!parsed || typeof parsed.mobile !== 'string' || !parsed.mobile.trim()) {
    return null;
  }
  const msisdn = normalizeBdMsisdn(parsed.msisdn || parsed.mobile || parsed.subscriberId || '');
  const localMobile = normalizeBdLocalMobile(parsed.localMobile || msisdn || parsed.mobile);
  const mobile = msisdn ? `+${msisdn}` : parsed.mobile.trim();
  const subscriptionStatus = String(parsed.subscriptionStatus || 'REGISTERED');
  if (!isAuthenticatedStatus(subscriptionStatus)) {
    return null;
  }

  return {
    subscriberId: String(parsed.subscriberId || (msisdn ? `tel:${msisdn}` : '')),
    subscriptionStatus,
    statusCode: String(parsed.statusCode || 'S1000'),
    mobile,
    msisdn: msisdn || undefined,
    localMobile: localMobile || undefined,
    verifiedAt: Number(parsed.verifiedAt || Date.now()),
    source: parsed.source || 'check_subscription',
    consentAccepted: parsed.consentAccepted ?? true,
    consentTimestamp: String(parsed.consentTimestamp || new Date().toISOString()),
    sessionToken: String(parsed.sessionToken || generateSessionToken()),
  };
}

function getCookieAttributes(maxAgeSeconds: number): string {
  const isHttps = typeof window !== 'undefined' && window.location.protocol === 'https:';
  const securePart = isHttps ? '; Secure' : '';
  return `SameSite=Lax${securePart}; path=/; max-age=${maxAgeSeconds}`;
}

function readCookieValue(name: string): string | null {
  try {
    if (typeof document === 'undefined' || !document.cookie) return null;
    const prefix = `${name}=`;
    for (const part of document.cookie.split(';')) {
      const trimmed = part.trim();
      if (trimmed.startsWith(prefix)) {
        return decodeURIComponent(trimmed.slice(prefix.length));
      }
    }
    return null;
  } catch {
    return null;
  }
}

function writeBdappsCookies(session: BdappsSession): void {
  try {
    if (typeof document === 'undefined') return;
    const attrs = getCookieAttributes(BDAPPS_COOKIE_MAX_AGE_SECONDS);
    const msisdn = normalizeBdMsisdn(session.msisdn || session.mobile || session.subscriberId);
    if (msisdn) {
      document.cookie = `${BDAPPS_MSISDN_COOKIE_NAME}=${encodeURIComponent(msisdn)}; ${attrs}`;
    }
    document.cookie = `${BDAPPS_COOKIE_NAME}=${encodeURIComponent(JSON.stringify(session))}; ${attrs}`;
  } catch {
    // Ignore cookie errors
  }
}

export function getBdappsSession(): BdappsSession | null {
  try {
    const lsRaw = window.localStorage.getItem(BDAPPS_SESSION_KEY);
    if (lsRaw) {
      const parsed = enrichSessionRecord(JSON.parse(lsRaw) as Partial<BdappsSession>);
      if (parsed) {
        // Ensure sessionStorage and 365-day cookies remain hydrated
        try {
          window.sessionStorage.setItem(BDAPPS_SESSION_KEY, JSON.stringify(parsed));
          if (parsed.msisdn && !window.localStorage.getItem(BDAPPS_MSISDN_KEY)) {
            window.localStorage.setItem(BDAPPS_MSISDN_KEY, parsed.msisdn);
          }
        } catch {
          // Ignore
        }
        if (!readCookieValue(BDAPPS_COOKIE_NAME)) {
          writeBdappsCookies(parsed);
        }
        return parsed;
      }
    }

    const ssRaw = window.sessionStorage.getItem(BDAPPS_SESSION_KEY);
    if (ssRaw) {
      const parsed = enrichSessionRecord(JSON.parse(ssRaw) as Partial<BdappsSession>);
      if (parsed) {
        persistSessionToAllStores(parsed, { updateLocalLock: true });
        return parsed;
      }
    }

    const cookieRaw = readCookieValue(BDAPPS_COOKIE_NAME);
    if (cookieRaw) {
      const parsed = enrichSessionRecord(JSON.parse(cookieRaw) as Partial<BdappsSession>);
      if (parsed) {
        persistSessionToAllStores(parsed, { updateLocalLock: true });
        return parsed;
      }
    }

    return null;
  } catch {
    return null;
  }
}

function persistSessionToAllStores(
  session: BdappsSession,
  options?: { updateLocalLock?: boolean }
): BdappsSession {
  const enriched = enrichSessionRecord(session) || session;
  try {
    const serialized = JSON.stringify(enriched);
    window.localStorage.setItem(BDAPPS_SESSION_KEY, serialized);
    if (enriched.msisdn) {
      window.localStorage.setItem(BDAPPS_MSISDN_KEY, enriched.msisdn);
    }
    window.sessionStorage.setItem(BDAPPS_SESSION_KEY, serialized);
    writeBdappsCookies(enriched);
    if (options?.updateLocalLock !== false) {
      writeLocalActiveSessionLock(enriched);
    }
  } catch {
    // Ignore storage quota errors
  }
  return enriched;
}

export function saveBdappsSession(
  session: BdappsSession,
  options?: { updateLocalLock?: boolean }
): void {
  const enriched = persistSessionToAllStores(session, options);
  try {
    window.dispatchEvent(new CustomEvent(BDAPPS_SESSION_EVENT, { detail: enriched }));
  } catch {
    // Ignore event errors
  }
}

export function clearBdappsCookies(): void {
  try {
    if (typeof document === 'undefined') return;
    const names = new Set<string>([BDAPPS_COOKIE_NAME, BDAPPS_MSISDN_COOKIE_NAME]);
    if (document.cookie) {
      for (const rawCookie of document.cookie.split(';')) {
        const eqPos = rawCookie.indexOf('=');
        const name = (eqPos > -1 ? rawCookie.slice(0, eqPos) : rawCookie).trim();
        if (name && /bdapps|subscriber|ms_bdapps|ms_free_quota|session_token/i.test(name)) {
          names.add(name);
        }
      }
    }
    for (const name of names) {
      document.cookie = `${name}=; max-age=0; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; SameSite=Lax`;
      document.cookie = `${name}=; max-age=0; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; SameSite=Lax; Secure`;
    }
  } catch {
    // Ignore cookie errors
  }
}

export function purgeAllSubscriberState(options?: {
  forceClearLock?: boolean;
  currentSessionToken?: string;
}): void {
  try {
    window.sessionStorage.removeItem(BDAPPS_SESSION_KEY);
    window.sessionStorage.removeItem(BDAPPS_PENDING_KEY);
    window.localStorage.removeItem(BDAPPS_SESSION_KEY);
    window.localStorage.removeItem(BDAPPS_MSISDN_KEY);
    window.localStorage.removeItem(BDAPPS_PENDING_KEY);
    window.localStorage.removeItem(QUOTA_STORAGE_KEY_REF);

    if (options?.forceClearLock) {
      window.localStorage.removeItem(BDAPPS_ACTIVE_LOCK_KEY);
    } else if (options?.currentSessionToken) {
      const lock = readLocalActiveSessionLock();
      if (lock && lock.sessionToken === options.currentSessionToken) {
        window.localStorage.removeItem(BDAPPS_ACTIVE_LOCK_KEY);
      }
    }

    clearBdappsCookies();

    window.dispatchEvent(
      new CustomEvent(QUOTA_UPDATED_EVENT_REF, {
        detail: {
          allowed: true,
          isSubscribed: false,
          unlimited: false,
          limit: 2,
          windowStart: 0,
          symbols: [],
          remaining: 2,
          resetInSeconds: 0,
          syncedAt: Date.now(),
          source: 'default',
        },
      })
    );
    window.dispatchEvent(new CustomEvent(BDAPPS_SESSION_EVENT, { detail: null }));
  } catch {
    // Ignore storage errors
  }
}

export function clearBdappsSession(): void {
  const existing = getBdappsSession();
  purgeAllSubscriberState({
    forceClearLock: true,
    currentSessionToken: existing?.sessionToken,
  });
}

export function getPendingOtp(): BdappsPendingOtp | null {
  try {
    const raw = window.sessionStorage.getItem(BDAPPS_PENDING_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as BdappsPendingOtp;
    if (!parsed || !parsed.referenceNo || !parsed.mobile) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function savePendingOtp(pending: BdappsPendingOtp): void {
  try {
    window.sessionStorage.setItem(BDAPPS_PENDING_KEY, JSON.stringify(pending));
  } catch {
    // Ignore
  }
}

export function clearPendingOtp(): void {
  try {
    window.sessionStorage.removeItem(BDAPPS_PENDING_KEY);
  } catch {
    // Ignore
  }
}

export function setBdappsToast(message: string): void {
  try {
    window.sessionStorage.setItem(BDAPPS_TOAST_KEY, message);
    window.dispatchEvent(new CustomEvent(BDAPPS_TOAST_EVENT, { detail: message }));
  } catch {
    // Ignore
  }
}

export function consumeBdappsToast(): string | null {
  try {
    const msg = window.sessionStorage.getItem(BDAPPS_TOAST_KEY);
    if (msg) {
      window.sessionStorage.removeItem(BDAPPS_TOAST_KEY);
      return msg;
    }
    return null;
  } catch {
    return null;
  }
}

async function postFormEndpoint(
  endpoint: string,
  fields: Record<string, string>,
  timeoutMs = 15_000,
  fetchOptions?: RequestInit
): Promise<BdappsApiResponse> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    const body = new URLSearchParams(fields);
    const res = await fetch(`${BDAPPS_API_BASE}/${endpoint}`, {
      ...fetchOptions,
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
        Accept: 'application/json, text/plain, */*',
        ...(fetchOptions?.headers || {}),
      },
      body: body.toString(),
      signal: controller.signal,
    });

    const text = await res.text();
    let parsed: BdappsApiResponse = {};
    try {
      parsed = text ? (JSON.parse(text) as BdappsApiResponse) : {};
    } catch {
      parsed = {
        success: res.ok,
        message: text || undefined,
      };
    }

    parsed._httpOk = res.ok;
    parsed._httpStatus = res.status;

    if (!res.ok && !parsed.message && !parsed.statusDetail && !parsed.error) {
      parsed.error = `সার্ভার থেকে সঠিক উত্তর পাওয়া যায়নি (HTTP ${res.status})।`;
    }

    return parsed;
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error('বিডিঅ্যাপস সার্ভার সাড়া দিতে সময় নিচ্ছে। অনুগ্রহ করে আবার চেষ্টা করুন।');
    }
    throw new Error('বিডিঅ্যাপস সার্ভারের সাথে সংযোগ স্থাপন করা যায়নি। ইন্টারনেট সংযোগ যাচাই করে আবার চেষ্টা করুন।');
  } finally {
    window.clearTimeout(timer);
  }
}

/**
 * 1. Proactive Pre-check & Server Re-check (cache-busted with ?_t=timestamp & no-store)
 * POST ${BDAPPS_API_BASE}/check_subscription.php?_t=... with user_mobile=+8801XXXXXXXXX
 */
export async function checkBdappsSubscription(userMobile: string): Promise<BdappsApiResponse> {
  return postFormEndpoint(
    `check_subscription.php?_t=${Date.now()}`,
    {
      user_mobile: userMobile,
    },
    15_000,
    { cache: 'no-store' }
  );
}

/**
 * 2. Request OTP
 * POST ${BDAPPS_API_BASE}/send_otp.php with user_mobile=+8801XXXXXXXXX
 */
export async function requestBdappsOtp(userMobile: string): Promise<BdappsApiResponse> {
  return postFormEndpoint('send_otp.php', {
    user_mobile: userMobile,
  });
}

/**
 * 3. Verify OTP
 * POST ${BDAPPS_API_BASE}/verify_otp.php with Otp=<code_entered> (exact capital O) and referenceNo=<ref>
 */
export async function verifyBdappsOtp(
  otpCode: string,
  referenceNo: string
): Promise<BdappsApiResponse> {
  return postFormEndpoint('verify_otp.php', {
    Otp: otpCode.trim(),
    referenceNo: referenceNo.trim(),
  });
}

/**
 * 4. One-Click Unsubscribe
 * POST ${BDAPPS_API_BASE}/unsubscribe.php with subscriberId & user_mobile
 */
export async function unsubscribeBdapps(params: {
  subscriberId?: string;
  userMobile?: string;
}): Promise<BdappsApiResponse> {
  const fields: Record<string, string> = {};
  if (params.subscriberId) fields.subscriberId = params.subscriberId;
  if (params.userMobile) fields.user_mobile = params.userMobile;
  return postFormEndpoint('unsubscribe.php', fields);
}

/**
 * Server-Side Single-Session Claim (Cross-Browser / Cross-Device Lock)
 */
export async function claimSubscriberSession(session: BdappsSession): Promise<void> {
  writeLocalActiveSessionLock(session);
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 12_000);

  const reqPromise = fetch(`${BACKEND_API_BASE}/api/subscriber-session/claim`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    keepalive: true,
    body: JSON.stringify({
      mobile: session.mobile,
      subscriberId: session.subscriberId,
      sessionToken: session.sessionToken,
      source: session.source,
      verifiedAt: session.verifiedAt,
    }),
    signal: controller.signal,
  })
    .catch(() => undefined)
    .finally(() => {
      window.clearTimeout(timer);
    });

  // Wait up to 3.5s so an awake server records the new token before navigation fires,
  // while never blocking the user if Render is waking from cold start.
  await Promise.race([
    reqPromise,
    new Promise<void>((resolve) => window.setTimeout(resolve, 3_500)),
  ]);
}

/**
 * Server-Side Single-Session Verify
 */
export type SessionVerifyResult = 'valid' | 'session_replaced' | 'unsubscribed';

export async function verifyActiveSubscriberSession(
  session: BdappsSession,
  options?: { checkServerSubscription?: boolean }
): Promise<SessionVerifyResult> {
  if (isLocalSessionLockConflict(session)) {
    return 'session_replaced';
  }

  const verifyBackendLock = async (): Promise<SessionVerifyResult> => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 6_000);
    try {
      const res = await fetch(`${BACKEND_API_BASE}/api/subscriber-session/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          mobile: session.mobile,
          subscriberId: session.subscriberId,
          sessionToken: session.sessionToken,
          source: session.source,
          verifiedAt: session.verifiedAt,
        }),
        signal: controller.signal,
      });

      if (res.ok) {
        const data = (await res.json().catch(() => null)) as {
          valid?: boolean;
          reason?: string;
        } | null;
        if (data && data.valid === false) {
          if (data.reason === 'SESSION_REPLACED') return 'session_replaced';
          if (data.reason === 'UNSUBSCRIBED') return 'unsubscribed';
        }
      }
    } catch {
      // Transient network blip during cold start: do not falsely log out active subscriber
    } finally {
      window.clearTimeout(timer);
    }
    return 'valid';
  };

  const verifyBdappsLiveStatus = async (): Promise<SessionVerifyResult> => {
    if (!options?.checkServerSubscription) {
      return 'valid';
    }
    try {
      const subRes = await checkBdappsSubscription(session.mobile);
      if (isUnregisteredPayload(subRes)) {
        return 'unsubscribed';
      }
    } catch {
      // Ignore transient network errors or timeouts
    }
    return 'valid';
  };

  const [bdappsVerdict, lockVerdict] = await Promise.all([
    verifyBdappsLiveStatus(),
    verifyBackendLock(),
  ]);

  if (bdappsVerdict === 'unsubscribed' || lockVerdict === 'unsubscribed') {
    return 'unsubscribed';
  }
  if (lockVerdict === 'session_replaced') {
    return 'session_replaced';
  }

  return 'valid';
}

/**
 * Release server-side session lock cleanly on unsubscribe
 */
export async function releaseSubscriberSession(session: BdappsSession): Promise<void> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 5_000);
  try {
    await fetch(`${BACKEND_API_BASE}/api/subscriber-session/release`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      keepalive: true,
      body: JSON.stringify({
        mobile: session.mobile,
        subscriberId: session.subscriberId,
        sessionToken: session.sessionToken,
        source: session.source,
        verifiedAt: session.verifiedAt,
      }),
      signal: controller.signal,
    });
  } catch {
    // Best effort
  } finally {
    window.clearTimeout(timer);
  }
}

/**
 * Helper to derive a consistent session object from any active BDApps API payload.
 */
export function buildActiveSessionFromResponse(
  mobile: string,
  data: BdappsApiResponse,
  source: BdappsSession['source'],
  consent?: { consentAccepted?: boolean; consentTimestamp?: string; sessionToken?: string }
): BdappsSession {
  const subscriptionStatus = isPendingChargingStatus(data.subscriptionStatus)
    ? 'INITIAL CHARGING PENDING'
    : 'REGISTERED';
  const msisdn = normalizeBdMsisdn(mobile || data.subscriberId || '');
  const localMobile = normalizeBdLocalMobile(msisdn || mobile);
  const digits = msisdn || mobile.replace(/\D/g, '');
  const fallbackSubscriberId = `tel:${digits.startsWith('880') ? digits : `880${digits}`}`;

  return {
    subscriberId: String(data.subscriberId || fallbackSubscriberId),
    subscriptionStatus,
    statusCode: String(data.statusCode || 'S1000'),
    mobile: msisdn ? `+${msisdn}` : mobile,
    msisdn: msisdn || undefined,
    localMobile: localMobile || undefined,
    verifiedAt: Date.now(),
    source,
    consentAccepted: consent?.consentAccepted ?? true,
    consentTimestamp: consent?.consentTimestamp || new Date().toISOString(),
    sessionToken: consent?.sessionToken || generateSessionToken(),
  };
}
