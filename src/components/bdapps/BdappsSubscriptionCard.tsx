import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  BarChart3,
  CheckCircle2,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Smartphone,
} from 'lucide-react';
import {
  BDAPPS_SESSION_EVENT,
  ROBI_CIRKLE_DIGITS_REGEX,
  buildActiveSessionFromResponse,
  checkBdappsSubscription,
  claimSubscriberSession,
  clearPendingOtp,
  formatFullBdMobile,
  getBdappsSession,
  getPendingOtp,
  isActiveSubscriptionPayload,
  isOtpChallengePayload,
  isSessionActive,
  maskBdMobile,
  maskSubscriberId,
  normalizeSubscriptionStatus,
  requestBdappsOtp,
  sanitizeBdLocalDigits,
  saveBdappsSession,
  savePendingOtp,
  setBdappsToast,
  verifyBdappsOtp,
  type BdappsSession,
} from '../../services/bdappsService';

type CardStep = 'mobile' | 'otp' | 'verified';

const PATH_A_WELCOME_TOAST = 'স্বাগতম! আপনার সাবস্ক্রিপশন সক্রিয় রয়েছে।';
const PATH_B_WELCOME_TOAST = 'ভেরিফিকেশন সফল হয়েছে! স্বাগতম, আপনার প্রিমিয়াম ড্যাশবোর্ড এখন আনলক।';

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

  const initialSession = (() => {
    const existing = getBdappsSession();
    return isSessionActive(existing) ? existing : null;
  })();

  const [activeSession, setActiveSession] = useState<BdappsSession | null>(initialSession);
  const [step, setStep] = useState<CardStep>(() =>
    initialSession && !onSubscribed ? 'verified' : 'mobile'
  );
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

  const CONSENT_REQUIRED_WARNING_BN =
    "এগিয়ে যেতে অনুগ্রহ করে উপরের 'I Agree' ঝুঁকি ও নীতিমালা সম্মতি বক্সে টিক দিন।";

  // Hydrate active subscriber state without hijacking Home navigation;
  // inside Paywall Modal (onSubscribed provided) unlock immediately.
  useEffect(() => {
    const existing = getBdappsSession();
    if (isSessionActive(existing)) {
      setActiveSession(existing);
      if (onSubscribed) {
        onSubscribed(existing);
      } else {
        setStep('verified');
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
  }, [onSubscribed]);

  // Keep inline card synced if user unsubscribes or logs in elsewhere
  useEffect(() => {
    const onSessionUpdated = (evt: Event) => {
      const customEvt = evt as CustomEvent<BdappsSession | null>;
      const next = 'detail' in customEvt ? customEvt.detail : getBdappsSession();
      if (isSessionActive(next)) {
        setActiveSession(next);
        if (!onSubscribed) setStep('verified');
      } else {
        setActiveSession(null);
        setStep('mobile');
      }
    };
    window.addEventListener(BDAPPS_SESSION_EVENT, onSessionUpdated);
    return () => window.removeEventListener(BDAPPS_SESSION_EVENT, onSessionUpdated);
  }, [onSubscribed]);

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

      // 1. Step 1 Pre-check: Always call check_subscription.php BEFORE sending OTP
      try {
        const precheck = await checkBdappsSubscription(fullMobile);
        if (isActiveSubscriptionPayload(precheck)) {
          // Path A (Already Subscribed): Do NOT call send_otp.php; unlock & navigate immediately
          const session = buildActiveSessionFromResponse(
            fullMobile,
            precheck,
            'check_subscription',
            consentRecord
          );
          saveBdappsSession(session);
          clearPendingOtp();
          await claimSubscriberSession(session);
          setActiveSession(session);
          setStep('verified');
          setBdappsToast(PATH_A_WELCOME_TOAST);
          setStatusMsg(PATH_A_WELCOME_TOAST);

          if (onSubscribed) {
            onSubscribed(session);
          } else {
            navigate('/dashboard', {
              replace: true,
              state: { freshHandoff: true, welcomeToast: PATH_A_WELCOME_TOAST },
            });
          }
          return;
        }
      } catch {
        // If pre-check transiently fails, proceed cleanly to send_otp.php
      }

      // 2. Path B (Not Subscribed): Call send_otp.php and strictly enforce OTP verification
      const otpRes = await requestBdappsOtp(fullMobile);

      // Strict OTP enforcement: whenever referenceNo is returned (non-subscribed challenge),
      // stay on this form and reveal the 6-digit OTP verification input box immediately.
      if (isOtpChallengePayload(otpRes)) {
        const ref = String(otpRes.referenceNo).trim();
        setActiveMobile(fullMobile);
        setReferenceNo(ref);
        setOtpCode('');
        setCooldown(30);
        setStatusMsg('আপনার ফোনে পাঠানো ৬-ডিজিটের OTP কোডটি নিচে বসান');
        savePendingOtp({
          referenceNo: ref,
          mobile: fullMobile,
          sentAt: Date.now(),
        });
        setStep('otp');
        return;
      }

      // Only bypass OTP if send_otp.php itself confirms E1351 / active without issuing an OTP challenge
      if (
        !otpRes.referenceNo &&
        (String(otpRes.statusCode || '').toUpperCase() === 'E1351' ||
          isActiveSubscriptionPayload(otpRes))
      ) {
        const session = buildActiveSessionFromResponse(
          fullMobile,
          otpRes,
          'send_otp',
          consentRecord
        );
        saveBdappsSession(session);
        clearPendingOtp();
        await claimSubscriberSession(session);
        setActiveSession(session);
        setStep('verified');
        setBdappsToast(PATH_A_WELCOME_TOAST);
        setStatusMsg(PATH_A_WELCOME_TOAST);

        if (onSubscribed) {
          onSubscribed(session);
        } else {
          navigate('/dashboard', {
            replace: true,
            state: { freshHandoff: true, welcomeToast: PATH_A_WELCOME_TOAST },
          });
        }
        return;
      }

      if (otpRes.success && otpRes.referenceNo) {
        const ref = String(otpRes.referenceNo).trim();
        setActiveMobile(fullMobile);
        setReferenceNo(ref);
        setOtpCode('');
        setCooldown(30);
        setStatusMsg('আপনার ফোনে পাঠানো ৬-ডিজিটের OTP কোডটি নিচে বসান');
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
        !otpRes.referenceNo &&
        (String(otpRes.statusCode || '').toUpperCase() === 'E1351' ||
          isActiveSubscriptionPayload(otpRes))
      ) {
        const session = buildActiveSessionFromResponse(activeMobile, otpRes, 'send_otp', {
          consentAccepted: true,
          consentTimestamp: new Date().toISOString(),
        });
        saveBdappsSession(session);
        clearPendingOtp();
        await claimSubscriberSession(session);
        setActiveSession(session);
        setBdappsToast(PATH_A_WELCOME_TOAST);
        if (onSubscribed) {
          onSubscribed(session);
        } else {
          navigate('/dashboard', {
            replace: true,
            state: { freshHandoff: true, welcomeToast: PATH_A_WELCOME_TOAST },
          });
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
        // Save session & claim single-browser lock BEFORE immediate navigation/unlock
        saveBdappsSession(session);
        clearPendingOtp();
        await claimSubscriberSession(session);
        setActiveSession(session);
        setStep('verified');
        setBdappsToast(PATH_B_WELCOME_TOAST);
        setStatusMsg(PATH_B_WELCOME_TOAST);

        if (onSubscribed) {
          onSubscribed(session);
        } else {
          navigate('/dashboard', {
            replace: true,
            state: { freshHandoff: true, welcomeToast: PATH_B_WELCOME_TOAST },
          });
        }
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
          <strong className="text-slate-900">I Agree:</strong> আমি সম্মত হচ্ছি যে, MukiSoft Stock AI একটি রিয়েল-টাইম AI মার্কেট সিগন্যাল ও প্রযুক্তিগত বিশ্লেষণ প্ল্যাটফর্ম, যা ডেটা ও অ্যালগরিদমের মাধ্যমে উচ্চ-নির্ভুলতার সিগন্যাল প্রদান করে। তবে শেয়ার বাজারে চূড়ান্ত ফলাফল লাইভ মার্কেট পরিস্থিতির ওপর নির্ভরশীল—তাই যেকোনো বিনিয়োগ, লাভ বা ক্ষতির সম্পূর্ণ দায়ভার ও ঝুঁকি (Self-Risk) একান্তই আমার নিজের, এবং এ বিষয়ে প্ল্যাটফর্মের কোনো আইনি বাধ্যবাধকতা থাকবে না।{' '}
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
              ২.৭৮ টাকা /দিন{' '}
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
                  <span>OTP চান / সাবমিট করুন</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </form>
        )}

        {step === 'otp' && (
          <form onSubmit={handleVerifyOtp} className="space-y-4 w-full min-w-0" noValidate>
            <div className="space-y-1.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-base font-bold text-slate-900">৬ ডিজিটের OTP যাচাই করুন</h3>
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
              <p className="text-xs font-semibold text-blue-800 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 leading-relaxed">
                আপনার ফোনে পাঠানো ৬-ডিজিটের OTP কোডটি নিচে বসান (
                <strong className="font-mono-num text-slate-900">
                  {maskBdMobile(activeMobile)}
                </strong>
                )
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
          <div className="py-3 space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-11 h-11 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0">
                <CheckCircle2 className="w-6 h-6" />
              </div>
              <div className="min-w-0">
                <div className="text-base font-extrabold text-slate-900">
                  সাবস্ক্রিপশন সক্রিয় রয়েছে!
                </div>
                <p className="text-xs text-slate-600 mt-0.5 leading-relaxed">
                  {statusMsg ||
                    'আপনার Robi & Cirkle সাবস্ক্রিপশন সক্রিয় আছে—সকল AI বিশ্লেষণ, প্রো চার্ট ও Strong Bullish Setup এখন সম্পূর্ণ আনলক।'}
                </p>
              </div>
            </div>

            {activeSession && (
              <div className="bg-white border border-slate-200 rounded-xl p-3.5 space-y-2 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-slate-500">মোবাইল নম্বর</span>
                  <span className="font-bold text-slate-900 font-mono-num">
                    {maskBdMobile(activeSession.mobile)}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-slate-500">সাবস্ক্রাইবার আইডি</span>
                  <span className="font-semibold text-slate-700 font-mono-num">
                    {maskSubscriberId(activeSession.subscriberId)}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-slate-500">স্ট্যাটাস</span>
                  <span className="inline-flex items-center gap-1 font-bold text-emerald-700">
                    <ShieldCheck className="w-3.5 h-3.5" />
                    <span>{normalizeSubscriptionStatus(activeSession.subscriptionStatus)}</span>
                  </span>
                </div>
              </div>
            )}

            {!embeddedInModal && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
                <Link
                  to="/dashboard"
                  className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold transition-colors whitespace-nowrap"
                >
                  <span>সাবস্ক্রাইবার ড্যাশবোর্ড</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </Link>
                <Link
                  to="/analyzer"
                  className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl bg-blue-700 hover:bg-blue-800 text-white text-xs font-bold transition-colors whitespace-nowrap"
                >
                  <BarChart3 className="w-3.5 h-3.5" />
                  <span>AI অ্যানালাইজার খুলুন</span>
                </Link>
              </div>
            )}
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
