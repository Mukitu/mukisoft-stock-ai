/**
 * Official BDApps (Robi & Cirkle) Subscription, OTP & One-Click Unsubscribe Service
 * Communicates with PHP endpoints using application/x-www-form-urlencoded (URLSearchParams)
 * so $_POST reads every parameter cleanly.
 */

export const BDAPPS_API_BASE = (
  import.meta.env.VITE_BDAPPS_API_BASE || 'https://skillproof.top/stock'
).replace(/\/+$/, '');

export const BDAPPS_SESSION_KEY = 'ms_bdapps_session';
export const BDAPPS_PENDING_KEY = 'ms_bdapps_pending';
export const BDAPPS_TOAST_KEY = 'ms_bdapps_toast';

export const FRESH_GRACE_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
export const VERIFY_REDIRECT_GRACE_MS = 700; // 700ms handoff delay

export interface BdappsSession {
  subscriberId: string;
  subscriptionStatus: string;
  statusCode: string;
  mobile: string;
  verifiedAt: number;
  source: 'check_subscription' | 'send_otp' | 'verify_otp';
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
    .toUpperCase();
}

export function isActiveSubscriptionPayload(data: BdappsApiResponse | null | undefined): boolean {
  if (!data) return false;
  const status = normalizeSubscriptionStatus(data.subscriptionStatus);
  const code = String(data.statusCode || '')
    .trim()
    .toUpperCase();
  return (
    data.isSubscribed === true ||
    status === 'REGISTERED' ||
    status === 'INITIAL CHARGING PENDING' ||
    code === 'E1351'
  );
}

export function isUnregisteredPayload(data: BdappsApiResponse | null | undefined): boolean {
  if (!data) return false;
  const status = normalizeSubscriptionStatus(data.subscriptionStatus);
  if (status === 'UNREGISTERED' || status === 'DEREGISTERED' || status === 'EXPIRED') {
    return true;
  }
  return data.isSubscribed === false && status !== 'REGISTERED' && status !== 'INITIAL CHARGING PENDING';
}

export function isSessionActive(session: BdappsSession | null | undefined): session is BdappsSession {
  if (!session) return false;
  const status = normalizeSubscriptionStatus(session.subscriptionStatus);
  return status === 'REGISTERED' || status === 'INITIAL CHARGING PENDING';
}

export function isWithinFreshGraceWindow(session: BdappsSession | null | undefined): boolean {
  if (!session || typeof session.verifiedAt !== 'number') return false;
  return Date.now() - session.verifiedAt < FRESH_GRACE_WINDOW_MS;
}

export function getBdappsSession(): BdappsSession | null {
  try {
    const raw = window.sessionStorage.getItem(BDAPPS_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as BdappsSession;
    if (!parsed || typeof parsed.mobile !== 'string') return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveBdappsSession(session: BdappsSession): void {
  try {
    window.sessionStorage.setItem(BDAPPS_SESSION_KEY, JSON.stringify(session));
  } catch {
    // Ignore storage quota errors
  }
}

export function clearBdappsSession(): void {
  try {
    window.sessionStorage.removeItem(BDAPPS_SESSION_KEY);
    window.sessionStorage.removeItem(BDAPPS_PENDING_KEY);
  } catch {
    // Ignore
  }
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
 * Helper to derive a consistent session object from any active BDApps API payload.
 */
export function buildActiveSessionFromResponse(
  mobile: string,
  data: BdappsApiResponse,
  source: BdappsSession['source']
): BdappsSession {
  const rawStatus = normalizeSubscriptionStatus(data.subscriptionStatus);
  const subscriptionStatus =
    rawStatus === 'INITIAL CHARGING PENDING' ? 'INITIAL CHARGING PENDING' : 'REGISTERED';
  const digits = mobile.replace(/\D/g, '');
  const fallbackSubscriberId = `tel:${digits.startsWith('880') ? digits : `880${digits}`}`;

  return {
    subscriberId: String(data.subscriberId || fallbackSubscriberId),
    subscriptionStatus,
    statusCode: String(data.statusCode || 'S1000'),
    mobile,
    verifiedAt: Date.now(),
    source,
  };
}
