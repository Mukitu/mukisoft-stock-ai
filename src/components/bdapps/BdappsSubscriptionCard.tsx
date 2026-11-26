import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  CheckCircle2,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Smartphone,
} from 'lucide-react';
import {
  ROBI_CIRKLE_DIGITS_REGEX,
  VERIFY_REDIRECT_GRACE_MS,
  buildActiveSessionFromResponse,
  checkBdappsSubscription,
  clearPendingOtp,
  formatFullBdMobile,
  getBdappsSession,
  getPendingOtp,
  isActiveSubscriptionPayload,
  isSessionActive,
  maskBdMobile,
  requestBdappsOtp,
  sanitizeBdLocalDigits,
  saveBdappsSession,
  savePendingOtp,
  verifyBdappsOtp,
  type BdappsSession,
} from '../../services/bdappsService';

type CardStep = 'mobile' | 'otp' | 'verified';

interface BdappsSubscriptionCardProps {
  highlighted?: boolean;
  unlockPrompt?: string | null;
  embeddedInModal?: boolean;
  onSubscribed?: (session: BdappsSession) => void;
}

export function BdappsSubscriptionCard({
  highlighted = false,
  unlockPrompt = null,
  embeddedInModal = false,
  onSubscribed,
}: BdappsSubscriptionCardProps) {
  const navigate = useNavigate();

  const [step, setStep] = useState<CardStep>('mobile');
  const [localDigits, setLocalDigits] = useState('');
  const [activeMobile, setActiveMobile] = useState('');
  const [referenceNo, setReferenceNo] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [cooldown, setCooldown] = useState(0);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isResending, setIsResending] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [consentAccepted, setConsentAccepted] = useState(false);
  const [consentWarning, setConsentWarning] = useState<string | null>(null);

  const otpInputRef = useRef<HTMLInputElement | null>(null);
  const redirectTimerRef = useRef<number | null>(null);

  const CONSENT_REQUIRED_WARNING_BN =
    "এগিয়ে যেতে অনুগ্রহ করে উপরের 'I Agree' ঝুঁকি ও নীতিমালা সম্মতি বক্সে টিক দিন।";

  // Auto-redirect returning verified Robi & Cirkle subscribers directly to /dashboard
  // (when rendered inline on Home; inside Paywall Modal we invoke onSubscribed directly)
  useEffect(() => {
    const existing = getBdappsSession();
    if (isSessionActive(existing)) {
      if (onSubscribed) {
        onSubscribed(existing);
      } else {
        navigate('/dashboard', { replace: true });
      }
      return;
    }

    // Restore pending OTP state if user is mid-verification within last 5 minutes
    const pending = getPendingOtp();
    if (pending && Date.now() - pending.sentAt < 5 * 60 * 1000) {
      setActiveMobile(pending.mobile);
      setLocalDigits(sanitizeBdLocalDigits(pending.mobile));
      setReferenceNo(pending.referenceNo);
      setStep('otp');
    }
  }, [navigate, onSubscribed]);

  // 30-second resend cooldown timer
  useEffect(() => {
    if (cooldown <= 0) return;
    const id = window.setInterval(() => {
      setCooldown((prev) => (prev <= 1 ? 0 : prev - 1));
    }, 1000);
    return () => window.clearInterval(id);
  }, [cooldown]);

  // Focus OTP input cleanly when swapping to Step 2
  useEffect(() => {
    if (step === 'otp') {
      window.setTimeout(() => otpInputRef.current?.focus(), 60);
    }
  }, [step]);

  useEffect(() => {
    return () => {
      if (redirectTimerRef.current !== null) {
        window.clearTimeout(redirectTimerRef.current);
      }
    };
  }, []);

  const handleMobileSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setStatusMsg(null);

    if (!consentAccepted) {
      setConsentWarning(CONSENT_REQUIRED_WARNING_BN);
      return;
    }
    setConsentWarning(null);

    const cleaned = sanitizeBdLocalDigits(localDigits);
    setLocalDigits(cleaned);

    if (!ROBI_CIRKLE_DIGITS_REGEX.test(cleaned)) {
      setErrorMsg('অনুগ্রহ করে সঠিক ১০ ডিজিটের Robi & Cirkle নম্বর দিন (শুরুতে ০ ছাড়া, যেমন 18XXXXXXXX বা 16XXXXXXXX)।');
      return;
    }

    const fullMobile = formatFullBdMobile(cleaned);
    setIsSubmitting(true);

    try {
      const consentRecord = {
        consentAccepted: true,
        consentTimestamp: new Date().toISOString(),
      };

      // 1. Proactive Pre-check: check_subscription.php before sending OTP
      try {
        const precheck = await checkBdappsSubscription(fullMobile);
        if (isActiveSubscriptionPayload(precheck)) {
          const session = buildActiveSessionFromResponse(
            fullMobile,
            precheck,
            'check_subscription',
            consentRecord
          );
          saveBdappsSession(session);
          clearPendingOtp();
          setStep('verified');
          setStatusMsg(
            onSubscribed
              ? 'আপনার Robi & Cirkle সাবস্ক্রিপশন সক্রিয় আছে! আপনার কাঙ্ক্ষিত স্টক রিপোর্ট আনলক করা হচ্ছে...'
              : 'আপনার Robi & Cirkle নম্বরটি ইতিমধ্যেই সক্রিয় রয়েছে। ড্যাশবোর্ডে নিয়ে যাওয়া হচ্ছে...'
          );
          redirectTimerRef.current = window.setTimeout(() => {
            if (onSubscribed) {
              onSubscribed(session);
            } else {
              navigate('/dashboard', { replace: true, state: { freshHandoff: true } });
            }
          }, 400);
          return;
        }
      } catch {
        // If pre-check transiently fails, continue cleanly to send_otp.php
      }

      // 2. Request OTP: send_otp.php
      const otpRes = await requestBdappsOtp(fullMobile);

      // Handle E1351 (already registered) or active subscription payload directly
      if (
        String(otpRes.statusCode || '').toUpperCase() === 'E1351' ||
        isActiveSubscriptionPayload(otpRes)
      ) {
        const session = buildActiveSessionFromResponse(
          fullMobile,
          otpRes,
          'send_otp',
          consentRecord
        );
        saveBdappsSession(session);
        clearPendingOtp();
        setStep('verified');
        setStatusMsg(
          onSubscribed
            ? 'আপনার Robi & Cirkle সাবস্ক্রিপশন সক্রিয় আছে! স্টক বিশ্লেষণ আনলক করা হচ্ছে...'
            : 'আপনার Robi & Cirkle সাবস্ক্রিপশন সক্রিয় আছে! ড্যাশবোর্ডে প্রবেশ করা হচ্ছে...'
        );
        redirectTimerRef.current = window.setTimeout(() => {
          if (onSubscribed) {
            onSubscribed(session);
          } else {
            navigate('/dashboard', { replace: true, state: { freshHandoff: true } });
          }
        }, 400);
        return;
      }

      if (otpRes.success && otpRes.referenceNo) {
        const ref = String(otpRes.referenceNo).trim();
        setActiveMobile(fullMobile);
        setReferenceNo(ref);
        setOtpCode('');
        setCooldown(30);
        savePendingOtp({
          referenceNo: ref,
          mobile: fullMobile,
          sentAt: Date.now(),
        });
        setStep('otp');
        return;
      }

      setErrorMsg(
        otpRes.message ||
          otpRes.statusDetail ||
          otpRes.error ||
          'OTP পাঠানো সম্ভব হয়নি। অনুগ্রহ করে আপনার Robi & Cirkle নম্বরটি যাচাই করে আবার চেষ্টা করুন।'
      );
    } catch (err) {
      setErrorMsg(
        err instanceof Error
          ? err.message
          : 'OTP পাঠানোর সময় সমস্যা হয়েছে। অনুগ্রহ করে কিছুক্ষণ পর আবার চেষ্টা করুন।'
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleResendOtp = async () => {
    if (cooldown > 0 || isResending || !activeMobile) return;
    setErrorMsg(null);
    setStatusMsg(null);
    setIsResending(true);

    try {
      const otpRes = await requestBdappsOtp(activeMobile);

      if (
        String(otpRes.statusCode || '').toUpperCase() === 'E1351' ||
        isActiveSubscriptionPayload(otpRes)
      ) {
        const session = buildActiveSessionFromResponse(activeMobile, otpRes, 'send_otp', {
          consentAccepted: true,
          consentTimestamp: new Date().toISOString(),
        });
        saveBdappsSession(session);
        clearPendingOtp();
        if (onSubscribed) {
          onSubscribed(session);
        } else {
          navigate('/dashboard', { replace: true, state: { freshHandoff: true } });
        }
        return;
      }

      if (otpRes.success && otpRes.referenceNo) {
        const ref = String(otpRes.referenceNo).trim();
        setReferenceNo(ref);
        setCooldown(30);
        savePendingOtp({
          referenceNo: ref,
          mobile: activeMobile,
          sentAt: Date.now(),
        });
        setStatusMsg('নতুন ৬ ডিজিটের OTP কোড পাঠানো হয়েছে।');
      } else {
        setErrorMsg(
          otpRes.message ||
            otpRes.statusDetail ||
            otpRes.error ||
            'পুনরায় OTP পাঠানো যায়নি। অনুগ্রহ করে আবার চেষ্টা করুন।'
        );
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'পুনরায় OTP পাঠাতে সমস্যা হয়েছে।');
    } finally {
      setIsResending(false);
    }
  };

  const handleVerifyOtp = async (e: FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setStatusMsg(null);

    if (!consentAccepted) {
      setConsentWarning(CONSENT_REQUIRED_WARNING_BN);
      return;
    }
    setConsentWarning(null);

    const cleanOtp = otpCode.replace(/\D/g, '').slice(0, 6);
    setOtpCode(cleanOtp);

    if (cleanOtp.length < 4) {
      setErrorMsg('অনুগ্রহ করে এসএমএস-এ পাওয়া ৬ ডিজিটের OTP কোড সঠিকভাবে বসান।');
      return;
    }

    if (!referenceNo) {
      setErrorMsg('সেশন রেফারেন্স পাওয়া যায়নি। অনুগ্রহ করে নম্বর দিয়ে পুনরায় OTP চান।');
      setStep('mobile');
      return;
    }

    setIsSubmitting(true);

    try {
      // 3. Verify OTP: verify_otp.php with exact capital 'O' in Otp & referenceNo
      const verifyRes = await verifyBdappsOtp(cleanOtp, referenceNo);

      if (isActiveSubscriptionPayload(verifyRes)) {
        const session = buildActiveSessionFromResponse(activeMobile, verifyRes, 'verify_otp', {
          consentAccepted: true,
          consentTimestamp: new Date().toISOString(),
        });
        // Save session synchronously BEFORE navigation/unlock
        saveBdappsSession(session);
        clearPendingOtp();
        setStep('verified');
        setStatusMsg(
          onSubscribed
            ? 'ভেরিফিকেশন সফল হয়েছে! আপনার কাঙ্ক্ষিত স্টকের পূর্ণ AI বিশ্লেষণ আনলক করা হচ্ছে...'
            : 'ভেরিফিকেশন সফল হয়েছে! আপনার প্রিমিয়াম ড্যাশবোর্ড আনলক করা হচ্ছে...'
        );

        // 700ms grace window before unlocking or navigating to /dashboard
        redirectTimerRef.current = window.setTimeout(() => {
          if (onSubscribed) {
            onSubscribed(session);
          } else {
            navigate('/dashboard', { replace: true, state: { freshHandoff: true } });
          }
        }, VERIFY_REDIRECT_GRACE_MS);
        return;
      }

      setErrorMsg(
        verifyRes.message ||
          verifyRes.statusDetail ||
          verifyRes.error ||
          'OTP কোডটি সঠিক নয় বা মেয়াদ শেষ হয়েছে। অনুগ্রহ করে আবার যাচাই করুন।'
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'OTP যাচাই করার সময় সমস্যা হয়েছে।');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleChangeNumber = () => {
    clearPendingOtp();
    setReferenceNo('');
    setOtpCode('');
    setErrorMsg(null);
    setStatusMsg(null);
    setCooldown(0);
    setStep('mobile');
  };

  const mobileInputId = embeddedInModal ? 'bdapps-modal-mobile-input' : 'bdapps-mobile-input';
  const otpInputId = embeddedInModal ? 'bdapps-modal-otp-input' : 'bdapps-otp-input';
  const consentCheckboxId = embeddedInModal ? 'bdapps-modal-consent-checkbox' : 'bdapps-consent-checkbox';

  const renderConsentBlock = () => (
    <div className="space-y-2 w-full min-w-0">
      <label
        htmlFor={consentCheckboxId}
        className={`flex items-start gap-2.5 rounded-xl border p-3 text-[11px] sm:text-xs leading-relaxed cursor-pointer transition-colors ${
          consentWarning && !consentAccepted
            ? 'border-rose-400 bg-rose-50/70 text-slate-800'
            : consentAccepted
              ? 'border-emerald-300 bg-emerald-50/50 text-slate-800'
              : 'border-slate-300 bg-white text-slate-700 hover:border-blue-400'
        }`}
      >
        <input
          id={consentCheckboxId}
          type="checkbox"
          checked={consentAccepted}
          onChange={(e) => {
            setConsentAccepted(e.target.checked);
            if (e.target.checked) setConsentWarning(null);
          }}
          className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-400 text-blue-700 focus:ring-blue-600 cursor-pointer"
        />
        <span className="min-w-0 break-words">
          <strong className="text-slate-900">I Agree:</strong> আমি সম্মত হচ্ছি যে, MukiSoft Stock AI শুধুমাত্র একটি শিক্ষামূলক ও ডেটা-ভিত্তিক প্রযুক্তিগত বিশ্লেষণ প্ল্যাটফর্ম (কোনো আর্থিক বা বিনিয়োগ উপদেষ্টা নয়)। শেয়ার বাজারে যেকোনো বিনিয়োগ, লাভ বা ক্ষতির সম্পূর্ণ দায়ভার ও ঝুঁকি (Self-Risk) একান্তই আমার নিজের, এবং এ বিষয়ে MukiSoft Technology-র কোনো আইনি বাধ্যবাধকতা থাকবে না।{' '}
          <a
            href="/risk-disclosure"
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="font-bold text-blue-700 hover:text-blue-800 underline underline-offset-2"
          >
            বিনিয়োগ ঝুঁকি ও নীতিমালা
          </a>
        </span>
      </label>

      {consentWarning && !consentAccepted && (
        <div
          role="alert"
          className="rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700 leading-relaxed"
        >
          {consentWarning}
        </div>
      )}
    </div>
  );

  return (
    <div
      id={embeddedInModal ? 'bdapps-modal-subscription-card' : 'bdapps-subscription-card'}
      className={`w-full min-w-0 max-w-full rounded-2xl flex flex-col justify-between transition-all duration-300 ${
        embeddedInModal
          ? 'bg-slate-50 border border-slate-200 p-4 sm:p-5'
          : `bg-slate-50 border p-4 sm:p-6 h-full shadow-xs ${
              highlighted
                ? 'border-blue-600 ring-4 ring-blue-600/20'
                : 'border-slate-200'
            }`
      }`}
    >
      {/* Always-Visible Official BDApps Pricing Header */}
      {!embeddedInModal && (
        <div className="space-y-2.5 sm:space-y-3 pb-4 sm:pb-5 border-b border-slate-200 min-w-0">
          <div className="inline-flex items-center text-[11px] font-semibold text-blue-800 bg-blue-50 border border-blue-200/80 px-2.5 py-1 rounded-md max-w-full leading-snug">
            <span>🇧🇩 অফিসিয়াল বিডিঅ্যাপস সাবস্ক্রিপশন • কোনো পাসওয়ার্ড লাগবে না</span>
          </div>

          <div className="space-y-1">
            <h2 className="text-lg sm:text-2xl font-extrabold text-slate-900 tracking-tight leading-snug">
              ৳২.৭৮ টাকা /দিন{' '}
              <span className="text-xs sm:text-sm font-semibold text-slate-600 inline-block">
                (ভ্যাট + এসডি + এসসি সহ)
              </span>
            </h2>
            <p className="text-xs sm:text-[13px] text-slate-600 leading-relaxed">
              আপনার Robi &amp; Cirkle মোবাইল নম্বর দিন, OTP আসবে সেই নম্বরে। ভেরিফাই ও অ্যাক্টিভেট করলেই আপনার ড্যাশবোর্ড ও সকল প্রিমিয়াম AI টেকনিক্যাল বিশ্লেষণ টুল আনলক হয়ে যাবে।
            </p>
          </div>

          {unlockPrompt && (
            <div className="rounded-lg bg-blue-50 border border-blue-200 px-3 py-2 text-xs font-semibold text-blue-900 leading-relaxed">
              {unlockPrompt}
            </div>
          )}
        </div>
      )}

      {/* Interactive Card Body: Step 1 -> Step 2 -> Verified */}
      <div className={`${embeddedInModal ? 'pb-3' : 'py-4 sm:py-5'} flex-1 flex flex-col justify-center min-w-0`}>
        {step === 'mobile' && (
          <form onSubmit={handleMobileSubmit} className="space-y-3.5 sm:space-y-4 w-full min-w-0" noValidate>
            <div className="space-y-1.5 min-w-0">
              <label
                htmlFor={mobileInputId}
                className="flex items-center gap-1.5 text-sm font-bold text-slate-800"
              >
                <Smartphone className="w-4 h-4 text-blue-700 shrink-0" />
                <span>আপনার Robi &amp; Cirkle নম্বর দিন</span>
              </label>

              <div className="flex items-stretch w-full min-w-0 rounded-xl border border-slate-300 bg-white overflow-hidden focus-within:border-blue-700 focus-within:ring-2 focus-within:ring-blue-700/15 transition">
                <span className="inline-flex items-center px-3 sm:px-3.5 bg-slate-100 border-r border-slate-200 text-sm font-bold text-slate-700 font-mono-num select-none shrink-0">
                  +880
                </span>
                <input
                  id={mobileInputId}
                  type="tel"
                  inputMode="numeric"
                  autoComplete="tel-national"
                  maxLength={14}
                  value={localDigits}
                  onChange={(e) => {
                    setLocalDigits(sanitizeBdLocalDigits(e.target.value));
                    if (errorMsg) setErrorMsg(null);
                  }}
                  placeholder="Robi & Cirkle নম্বর লিখুন"
                  className="flex-1 min-w-0 w-full px-3 sm:px-3.5 py-3 text-sm font-semibold text-slate-900 placeholder:text-slate-400 placeholder:font-normal outline-none font-mono-num"
                />
              </div>

              <p className="text-[11px] text-slate-500 leading-relaxed">
                Robi &amp; Cirkle এর ১০ ডিজিটের নম্বর দিন (শুরুতে ০ ছাড়া)। যেমন ১৮XXXXXXXX বা ১৬XXXXXXXX
              </p>
            </div>

            {renderConsentBlock()}

            {errorMsg && (
              <div
                role="alert"
                className="rounded-lg border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs font-medium text-rose-700 leading-relaxed"
              >
                {errorMsg}
              </div>
            )}

            <button
              type="submit"
              disabled={isSubmitting}
              aria-disabled={!consentAccepted || isSubmitting}
              className={`w-full inline-flex items-center justify-center gap-2 bg-blue-700 text-white font-bold text-sm px-5 py-3.5 rounded-xl transition-colors ${
                !consentAccepted
                  ? 'opacity-50 cursor-not-allowed'
                  : 'hover:bg-blue-800 disabled:opacity-65 cursor-pointer'
              }`}
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>যাচাই ও OTP পাঠানো হচ্ছে...</span>
                </>
              ) : (
                <>
                  <span>OTP চান</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </form>
        )}

        {step === 'otp' && (
          <form onSubmit={handleVerifyOtp} className="space-y-4 w-full min-w-0" noValidate>
            <div className="space-y-1">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-base font-bold text-slate-900">৬ ডিজিটের কোড বসান</h3>
                <button
                  type="button"
                  onClick={handleResendOtp}
                  disabled={cooldown > 0 || isResending}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-blue-700 hover:text-blue-800 disabled:text-slate-400 disabled:cursor-not-allowed cursor-pointer"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isResending ? 'animate-spin' : ''}`} />
                  <span>{cooldown > 0 ? `আবার পাঠান (${cooldown}s)` : 'আবার পাঠান'}</span>
                </button>
              </div>
              <p className="text-xs text-slate-600">
                পাঠানো হয়েছে{' '}
                <strong className="font-mono-num text-slate-900">
                  {maskBdMobile(activeMobile)}
                </strong>{' '}
                নম্বরে
              </p>
            </div>

            <div>
              <label htmlFor={otpInputId} className="sr-only">
                ৬ ডিজিটের কোড বসান
              </label>
              <input
                ref={otpInputRef}
                id={otpInputId}
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={otpCode}
                onChange={(e) => {
                  setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6));
                  if (errorMsg) setErrorMsg(null);
                }}
                placeholder="------"
                className="w-full min-w-0 bg-white border border-slate-300 focus:border-blue-700 focus:ring-2 focus:ring-blue-700/15 rounded-xl px-3 sm:px-4 py-3 text-center text-xl sm:text-2xl font-bold tracking-[0.35em] sm:tracking-[0.5em] text-slate-900 font-mono-num outline-none"
              />
            </div>

            {renderConsentBlock()}

            {statusMsg && (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3.5 py-2 text-xs font-medium text-emerald-800">
                {statusMsg}
              </div>
            )}

            {errorMsg && (
              <div
                role="alert"
                className="rounded-lg border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs font-medium text-rose-700 leading-relaxed"
              >
                {errorMsg}
              </div>
            )}

            <button
              type="submit"
              disabled={isSubmitting}
              aria-disabled={!consentAccepted || isSubmitting || otpCode.length < 4}
              className={`w-full inline-flex items-center justify-center gap-2 bg-emerald-700 text-white font-bold text-sm px-5 py-3.5 rounded-xl transition-colors ${
                !consentAccepted || otpCode.length < 4
                  ? 'opacity-50 cursor-not-allowed'
                  : 'hover:bg-emerald-800 disabled:opacity-60 cursor-pointer'
              }`}
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>ভেরিফাই করা হচ্ছে...</span>
                </>
              ) : (
                <>
                  <ShieldCheck className="w-4 h-4" />
                  <span>ভেরিফাই ও অ্যাক্টিভেট →</span>
                </>
              )}
            </button>

            <div className="text-center">
              <button
                type="button"
                onClick={handleChangeNumber}
                className="text-xs font-semibold text-slate-500 hover:text-slate-800 underline underline-offset-2 cursor-pointer"
              >
                নম্বর পরিবর্তন করুন
              </button>
            </div>
          </form>
        )}

        {step === 'verified' && (
          <div className="py-5 text-center space-y-3">
            <div className="w-12 h-12 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center mx-auto">
              <CheckCircle2 className="w-7 h-7" />
            </div>
            <div className="text-base font-bold text-slate-900">সাবস্ক্রিপশন ভেরিফাই সম্পন্ন!</div>
            <p className="text-xs text-slate-600 leading-relaxed">
              {statusMsg || 'আপনার প্রিমিয়াম ড্যাশবোর্ড আনলক করা হচ্ছে...'}
            </p>
            <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-blue-700">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              <span>ড্যাশবোর্ড লোড হচ্ছে...</span>
            </div>
          </div>
        )}
      </div>

      {/* Footer Note inside Card */}
      <div className="pt-3.5 sm:pt-4 border-t border-slate-200 text-[11px] text-slate-500 leading-relaxed">
        🔒 Robi &amp; Cirkle (বিডিঅ্যাপস) • যেকোনো সময় ড্যাশবোর্ড থেকে এক ক্লিকে বাতিল করুন
      </div>
    </div>
  );
}
