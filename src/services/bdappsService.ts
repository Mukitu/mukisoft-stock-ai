/**
 * Official BDApps (Robi & Cirkle) Subscription, OTP & One-Click Unsubscribe Service
 * Communicates with PHP endpoints using application/x-www-form-urlencoded (URLSearchParams)
 * so $_POST reads every parameter cleanly.
 */

export const BDAPPS_API_BASE = (
  import.meta.env.VITE_BDAPPS_API_BASE || 'https://stock.skillproof.top'
).replace(/\/+$/, '');

const BACKEND_API_BASE = (
  import.meta.env.VITE_API_BASE_URL || 'https://mukisoft-stock-ai.onrender.com'
).replace(/\/+$/, '');

export const BDAPPS_SESSION_KEY = 'ms_bdapps_session';
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
}

export const ROBI_CIRKLE_DIGITS_REGEX = /^1[3-9][0-9]{8}$/;

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
  if (isActiveSubscriptionPayload(data)) return false;
  const status = normalizeSubscriptionStatus(data.subscriptionStatus);
  if (status === 'UNREGISTERED' || status === 'DEREGISTERED' || status === 'EXPIRED') {
    return true;
  }
  return data.isSubscribed === false;
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

export function getBdappsSession(): BdappsSession | null {
  try {
    const raw = window.sessionStorage.getItem(BDAPPS_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<BdappsSession>;
    if (!parsed || typeof parsed.mobile !== 'string') return null;
    if (!parsed.sessionToken) {
      const migrated: BdappsSession = {
        subscriberId: String(parsed.subscriberId || ''),
        subscriptionStatus: String(parsed.subscriptionStatus || 'REGISTERED'),
        statusCode: String(parsed.statusCode || 'S1000'),
        mobile: parsed.mobile,
        verifiedAt: Number(parsed.verifiedAt || Date.now()),
        source: parsed.source || 'check_subscription',
        consentAccepted: parsed.consentAccepted ?? true,
        consentTimestamp: String(parsed.consentTimestamp || new Date().toISOString()),
        sessionToken: generateSessionToken(),
      };
      window.sessionStorage.setItem(BDAPPS_SESSION_KEY, JSON.stringify(migrated));
      return migrated;
    }
    return parsed as BdappsSession;
  } catch {
    return null;
  }
}

export function saveBdappsSession(
  session: BdappsSession,
  options?: { updateLocalLock?: boolean }
): void {
  try {
    window.sessionStorage.setItem(BDAPPS_SESSION_KEY, JSON.stringify(session));
    if (options?.updateLocalLock !== false) {
      writeLocalActiveSessionLock(session);
    }
    window.dispatchEvent(new CustomEvent(BDAPPS_SESSION_EVENT, { detail: session }));
  } catch {
    // Ignore storage quota errors
  }
}

export function clearBdappsCookies(): void {
  try {
    if (typeof document === 'undefined' || !document.cookie) return;
    const cookies = document.cookie.split(';');
    for (const rawCookie of cookies) {
      const eqPos = rawCookie.indexOf('=');
      const name = (eqPos > -1 ? rawCookie.slice(0, eqPos) : rawCookie).trim();
      if (!name) continue;
      if (/bdapps|subscriber|ms_bdapps|ms_free_quota|session_token/i.test(name)) {
        document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/`;
      }
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
  timeoutMs = 15_000
): Promise<BdappsApiResponse> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    const body = new URLSearchParams(fields);
    const res = await fetch(`${BDAPPS_API_BASE}/${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
        Accept: 'application/json, text/plain, */*',
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
 * 1. Proactive Pre-check & Server Re-check
 * POST ${BDAPPS_API_BASE}/check_subscription.php with user_mobile=+8801XXXXXXXXX
 */
export async function checkBdappsSubscription(userMobile: string): Promise<BdappsApiResponse> {
  return postFormEndpoint('check_subscription.php', {
    user_mobile: userMobile,
  });
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

  if (options?.checkServerSubscription && !isWithinFreshGraceWindow(session)) {
    try {
      const subRes = await checkBdappsSubscription(session.mobile);
      if (isUnregisteredPayload(subRes)) {
        return 'unsubscribed';
      }
    } catch {
      // Ignore transient network errors
    }
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
  const digits = mobile.replace(/\D/g, '');
  const fallbackSubscriberId = `tel:${digits.startsWith('880') ? digits : `880${digits}`}`;

  return {
    subscriberId: String(data.subscriberId || fallbackSubscriberId),
    subscriptionStatus,
    statusCode: String(data.statusCode || 'S1000'),
    mobile,
    verifiedAt: Date.now(),
    source,
    consentAccepted: consent?.consentAccepted ?? true,
    consentTimestamp: consent?.consentTimestamp || new Date().toISOString(),
    sessionToken: consent?.sessionToken || generateSessionToken(),
  };
}
