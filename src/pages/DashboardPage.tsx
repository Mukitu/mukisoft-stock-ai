import { useCallback, useEffect, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Banknote,
  BarChart3,
  CheckCircle2,
  Clock,
  Fingerprint,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  Trash2,
  TrendingUp,
  X,
} from 'lucide-react';
import {
  BDAPPS_SESSION_EVENT,
  SESSION_REPLACED_TOAST_BN,
  UNSUBSCRIBED_TOAST_BN,
  type BdappsSession,
  buildActiveSessionFromResponse,
  checkBdappsSubscription,
  consumeBdappsToast,
  getBdappsSession,
  isActiveSubscriptionPayload,
  isSessionActive,
  isUnregisteredPayload,
  maskBdMobile,
  maskSubscriberId,
  normalizeSubscriptionStatus,
  purgeAllSubscriberState,
  revokeSubscriberSession,
  saveBdappsSession,
  setBdappsToast,
  unsubscribeBdappsSubscription,
  verifyActiveSubscriberSession,
} from '../services/bdappsService';
import { useTopPicks } from '../hooks/useMarketQueries';
import { LIVE_FEED_WAITING_BN } from '../services/apiClient';
import { SelfRiskDisclaimerBanner } from '../components/common/SelfRiskDisclaimerBanner';
import {
  toBanglaDigits,
} from '../utils/quantConsensus';

interface DashboardLocationState {
  freshHandoff?: boolean;
  welcomeToast?: string;
}

function formatVerifiedTimestamp(ts: number): string {
  try {
    return new Intl.DateTimeFormat('bn-BD', {
      timeZone: 'Asia/Dhaka',
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    }).format(new Date(ts));
  } catch {
    return new Date(ts).toLocaleString();
  }
}

export function DashboardPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const locationState = (location.state as DashboardLocationState | null) || null;

  const [session, setSession] = useState<BdappsSession | null>(() => getBdappsSession());
  const [isRechecking, setIsRechecking] = useState(false);
  const [recheckNotice, setRecheckNotice] = useState<{
    tone: 'success' | 'info' | 'warning';
    text: string;
  } | null>(null);

  const [showUnsubModal, setShowUnsubModal] = useState(false);
  const [isUnsubscribing, setIsUnsubscribing] = useState(false);
  const [unsubError, setUnsubError] = useState<string | null>(null);

  const { data: picksData } = useTopPicks();
  const picks = picksData?.picks || [];

  const runServerRecheck = useCallback(
    async (currentSession: BdappsSession, manualTrigger = false) => {
      setIsRechecking(true);
      if (manualTrigger) setRecheckNotice(null);

      try {
        const lockVerdict = await verifyActiveSubscriberSession(currentSession);
        if (lockVerdict === 'session_replaced') {
          purgeAllSubscriberState({
            forceClearLock: false,
            currentSessionToken: currentSession.sessionToken,
          });
          setBdappsToast(SESSION_REPLACED_TOAST_BN);
          navigate('/', { replace: true });
          return;
        }
        if (lockVerdict === 'unsubscribed') {
          purgeAllSubscriberState({
            forceClearLock: true,
            currentSessionToken: currentSession.sessionToken,
          });
          setBdappsToast(
            'আপনার Robi & Cirkle সাবস্ক্রিপশনটি বর্তমানে সক্রিয় নয়। পুনরায় অ্যাক্টিভেট করতে মোবাইল নম্বর দিয়ে OTP ভেরিফাই করুন।'
          );
          navigate('/', { replace: true });
          return;
        }

        const res = await checkBdappsSubscription(currentSession.mobile);

        if (isActiveSubscriptionPayload(res)) {
          const refreshed = buildActiveSessionFromResponse(
            currentSession.mobile,
            res,
            'check_subscription',
            {
              consentAccepted: currentSession.consentAccepted ?? true,
              consentTimestamp: currentSession.consentTimestamp,
              sessionToken: currentSession.sessionToken,
            }
          );
          // Preserve original verifiedAt when refreshing so grace window math stays accurate
          refreshed.verifiedAt = currentSession.verifiedAt;
          saveBdappsSession(refreshed);
          setSession(refreshed);
          if (manualTrigger) {
            setRecheckNotice({
              tone: 'success',
              text: `বিডিঅ্যাপস সার্ভার নিশ্চিত করেছে: আপনার Robi & Cirkle সাবস্ক্রিপশন সক্রিয় (${refreshed.subscriptionStatus})।`,
            });
          }
          return;
        }

        if (isUnregisteredPayload(res)) {
          // Confirmed UNREGISTERED by check_subscription.php -> revoke on Render, wipe cookies/localStorage, bounce to /
          await revokeSubscriberSession(currentSession);
          purgeAllSubscriberState({
            forceClearLock: true,
            currentSessionToken: currentSession.sessionToken,
          });
          setBdappsToast(UNSUBSCRIBED_TOAST_BN);
          navigate('/', { replace: true });
          return;
        }

        if (manualTrigger) {
          setRecheckNotice({
            tone: 'warning',
            text:
              res.message ||
              res.statusDetail ||
              'সার্ভার থেকে স্পষ্ট স্ট্যাটাস পাওয়া যায়নি; আপনার বর্তমান সেশন সক্রিয় রাখা হয়েছে।',
          });
        }
      } catch (err) {
        if (manualTrigger) {
          setRecheckNotice({
            tone: 'warning',
            text:
              err instanceof Error
                ? err.message
                : 'সার্ভার রি-চেক করা সম্ভব হয়নি। কিছুক্ষণ পর আবার চেষ্টা করুন।',
          });
        }
      } finally {
        setIsRechecking(false);
      }
    },
    [navigate]
  );

  // Automatic server re-check on load UNLESS just handed off from OTP verification
  useEffect(() => {
    if (!isSessionActive(session)) return;

    if (locationState?.freshHandoff) {
      const pendingToast = consumeBdappsToast();
      setRecheckNotice({
        tone: 'success',
        text:
          locationState.welcomeToast ||
          pendingToast ||
          'স্বাগতম! আপনার সাবস্ক্রিপশন সক্রিয় রয়েছে এবং প্রিমিয়াম ড্যাশবোর্ড আনলক আছে।',
      });
      // Replace location state so subsequent reloads perform a normal server check
      navigate('/dashboard', { replace: true, state: null });
      return;
    }

    const pendingToast = consumeBdappsToast();
    if (pendingToast) {
      setRecheckNotice({ tone: 'success', text: pendingToast });
    }

    void runServerRecheck(session, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // React immediately if SessionEnforcer invalidates this session while on /dashboard
  useEffect(() => {
    const onSessionUpdated = (evt: Event) => {
      const next = (evt as CustomEvent<BdappsSession | null>).detail ?? null;
      setSession(next);
    };
    window.addEventListener(BDAPPS_SESSION_EVENT, onSessionUpdated);
    return () => window.removeEventListener(BDAPPS_SESSION_EVENT, onSessionUpdated);
  }, []);

  if (!isSessionActive(session)) {
    return <Navigate to="/" replace />;
  }

  const normalizedStatus = normalizeSubscriptionStatus(session.subscriptionStatus);
  const isPendingCharge = normalizedStatus === 'INITIAL CHARGING PENDING';

  const handleConfirmUnsubscribe = async () => {
    setUnsubError(null);
    setIsUnsubscribing(true);
    try {
      const res = await unsubscribeBdappsSubscription(session);
      if (res.success === false && res.isSubscribed !== false) {
        setUnsubError(
          res.message ||
            res.statusDetail ||
            res.error ||
            'সাবস্ক্রিপশন বাতিল করা সম্ভব হয়নি। অনুগ্রহ করে আবার চেষ্টা করুন।'
        );
        return;
      }

      navigate('/', { replace: true });
    } catch (err) {
      setUnsubError(
        err instanceof Error
          ? err.message
          : 'সাবস্ক্রিপশন বাতিল করার সময় সমস্যা হয়েছে। অনুগ্রহ করে আবার চেষ্টা করুন।'
      );
    } finally {
      setIsUnsubscribing(false);
    }
  };

  return (
    <main className="max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 flex-1 space-y-6">
      {/* Header Row */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-5 border-b border-slate-200">
        <div>
          <div className="text-xs font-semibold text-blue-700">
            🇧🇩 অফিসিয়াল বিডিঅ্যাপস সাবস্ক্রাইবার ড্যাশবোর্ড · Robi &amp; Cirkle
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight mt-1">
            MukiSoft Stock AI প্রিমিয়াম ড্যাশবোর্ড
          </h1>
          <p className="text-sm text-slate-600 mt-0.5">
            আপনার সাবস্ক্রিপশন স্ট্যাটাস, ২০-ইন্ডিকেটর অ্যানালাইজার এবং প্রো মার্কেট চার্ট এখান থেকে পরিচালনা করুন।
          </p>
        </div>

        <button
          type="button"
          onClick={() => void runServerRecheck(session, true)}
          disabled={isRechecking}
          className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 disabled:opacity-60 text-slate-800 text-xs font-semibold transition-colors self-start md:self-center cursor-pointer"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isRechecking ? 'animate-spin' : ''}`} />
          <span>{isRechecking ? 'সার্ভার যাচাই চলছে...' : 'সার্ভার স্ট্যাটাস রি-চেক করুন'}</span>
        </button>
      </div>

      {/* Status / Grace Window Notice */}
      {recheckNotice && (
        <div
          className={`flex items-start gap-2.5 rounded-xl border px-4 py-3 text-xs sm:text-sm font-medium leading-relaxed ${
            recheckNotice.tone === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : recheckNotice.tone === 'info'
                ? 'bg-blue-50 border-blue-200 text-blue-800'
                : 'bg-amber-50 border-amber-200 text-amber-900'
          }`}
        >
          <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{recheckNotice.text}</span>
        </div>
      )}

      {/* Subscriber Status & Profile Card + Quick AI Tools Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left: Executive Subscriber Membership Card */}
        <section className="lg:col-span-5 bg-white border border-slate-200 rounded-2xl shadow-xs overflow-hidden flex flex-col justify-between">
          <div>
            {/* Top Header Block with Subtle Slate/Emerald Gradient Accent */}
            <div className="bg-gradient-to-br from-slate-50 via-white to-emerald-50/80 border-b border-slate-200/80 px-6 py-5 space-y-3.5">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3.5 min-w-0">
                  <div className="w-11 h-11 rounded-xl bg-slate-900 text-emerald-400 shadow-xs flex items-center justify-center shrink-0">
                    <Smartphone className="w-5 h-5" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                      Robi &amp; Cirkle সাবস্ক্রাইবার
                    </div>
                    <div className="text-lg sm:text-xl font-extrabold text-slate-900 font-mono-num tabular-nums tracking-tight mt-0.5 truncate">
                      {maskBdMobile(session.mobile)}
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between gap-2 pt-0.5">
                <span className="text-[11px] font-medium text-slate-500">সদস্যপদ অবস্থা</span>
                <span
                  className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-bold tracking-wide border whitespace-nowrap shrink-0 ${
                    isPendingCharge
                      ? 'bg-amber-50 text-amber-800 border-amber-200/90'
                      : 'bg-emerald-50 text-emerald-800 border-emerald-200/90'
                  }`}
                >
                  <span
                    className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                      isPendingCharge ? 'bg-amber-500' : 'bg-emerald-500'
                    }`}
                  />
                  <span>{normalizedStatus}</span>
                </span>
              </div>
            </div>

            {/* Structured Metadata Rows */}
            <div className="p-6 space-y-4">
              <dl className="divide-y divide-slate-100 rounded-xl border border-slate-200/90 bg-slate-50/50">
                <div className="flex items-center justify-between gap-4 px-4 py-3.5">
                  <dt className="text-xs font-medium text-slate-500 flex items-center gap-2">
                    <Fingerprint className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    <span>সাবস্ক্রাইবার আইডি (Masked)</span>
                  </dt>
                  <dd className="text-xs font-bold text-slate-900 font-mono-num tabular-nums text-right">
                    {maskSubscriberId(session.subscriberId)}
                  </dd>
                </div>

                <div className="flex items-center justify-between gap-4 px-4 py-3.5">
                  <dt className="text-xs font-medium text-slate-500 flex items-center gap-2 shrink-0">
                    <Banknote className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    <span>চার্জ রেট</span>
                  </dt>
                  <dd className="text-xs font-bold text-slate-900 text-right tabular-nums">
                    ২.৭৮ টাকা /দিন{' '}
                    <span className="font-normal text-slate-500">(ভ্যাট + এসডি + এসসি সহ)</span>
                  </dd>
                </div>

                <div className="flex items-center justify-between gap-4 px-4 py-3.5">
                  <dt className="text-xs font-medium text-slate-500 flex items-center gap-2 shrink-0">
                    <Clock className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    <span>ভেরিফাই সময় (BST)</span>
                  </dt>
                  <dd className="text-xs font-semibold text-slate-800 text-right tabular-nums">
                    {formatVerifiedTimestamp(session.verifiedAt)}
                  </dd>
                </div>
              </dl>

              {/* Refined Legal Risk Consent Card */}
              <div className="rounded-xl border border-emerald-200/90 bg-emerald-50/60 px-4 py-3.5 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 text-xs font-bold text-emerald-950">
                    <ShieldCheck className="w-4 h-4 text-emerald-700 shrink-0" />
                    <span>Legal Risk Consent</span>
                  </div>
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100/90 border border-emerald-200 px-2.5 py-0.5 text-[11px] font-bold text-emerald-800 whitespace-nowrap">
                    <CheckCircle2 className="w-3 h-3 shrink-0" />
                    <span>{session.consentAccepted !== false ? 'Agreed (I Agree)' : 'Pending'}</span>
                  </span>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5 text-[11px] text-emerald-900/80">
                  <span className="tabular-nums">
                    সম্মতির সময়:{' '}
                    {session.consentTimestamp
                      ? formatVerifiedTimestamp(Date.parse(session.consentTimestamp) || session.verifiedAt)
                      : formatVerifiedTimestamp(session.verifiedAt)}
                  </span>
                  <Link
                    to="/risk-disclosure"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-semibold text-blue-700 underline underline-offset-2 hover:text-blue-800 whitespace-nowrap"
                  >
                    বিনিয়োগ ঝুঁকি ও নীতিমালা
                  </Link>
                </div>
              </div>
            </div>
          </div>

          {/* One-Click Unsubscribe Control */}
          <div className="px-6 py-5 bg-slate-50/70 border-t border-slate-200/80 space-y-2.5">
            <button
              type="button"
              onClick={() => {
                setUnsubError(null);
                setShowUnsubModal(true);
              }}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-white hover:bg-rose-600 text-rose-700 hover:text-white border border-rose-300 hover:border-rose-600 text-xs sm:text-sm font-bold shadow-2xs transition-colors cursor-pointer"
            >
              <Trash2 className="w-4 h-4 shrink-0" />
              <span>সাবস্ক্রিপশন বাতিল করুন (One-Click Unsubscribe)</span>
            </button>
            <p className="text-[11px] text-slate-500 text-center leading-relaxed">
              বাতিল করলে আপনার Robi &amp; Cirkle নম্বর থেকে পরবর্তী দৈনিক চার্জ সাথে সাথে বন্ধ হয়ে যাবে।
            </p>
          </div>
        </section>

        {/* Right: Quick Access to Full AI Tools + Daily Picks Summary */}
        <div className="lg:col-span-7 flex flex-col gap-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Link
              to="/analyzer"
              className="group bg-white border border-slate-200 hover:border-blue-600/60 rounded-2xl p-6 shadow-xs flex flex-col justify-between space-y-4 transition-all"
            >
              <div className="space-y-3">
                <div className="w-11 h-11 rounded-xl bg-blue-50 border border-blue-100 text-blue-700 flex items-center justify-center">
                  <BarChart3 className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-base sm:text-lg font-bold text-slate-900 group-hover:text-blue-700 transition-colors">
                    ২০-ইন্ডিকেটর AI স্টক অ্যানালাইজার
                  </h2>
                  <p className="text-xs text-slate-600 mt-1.5 leading-relaxed">
                    DSE ও CSE-এর যেকোনো কোম্পানির ১৭-ফিচার XGBoost সিগন্যাল, সহজ বাংলা রিপোর্ট, স্ক্রিনশট/PDF OCR ও ম্যানুয়াল OHLCV বিশ্লেষণ করুন।
                  </p>
                </div>
              </div>
              <div className="inline-flex items-center gap-1.5 text-xs font-bold text-blue-700">
                <span>অ্যানালাইজার খুলুন</span>
                <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
              </div>
            </Link>

            <Link
              to="/market"
              className="group bg-white border border-slate-200 hover:border-emerald-600/60 rounded-2xl p-6 shadow-xs flex flex-col justify-between space-y-4 transition-all"
            >
              <div className="space-y-3">
                <div className="w-11 h-11 rounded-xl bg-emerald-50 border border-emerald-100 text-emerald-700 flex items-center justify-center">
                  <TrendingUp className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-base sm:text-lg font-bold text-slate-900 group-hover:text-emerald-700 transition-colors">
                    ট্রেডিংভিউ প্রো চার্ট টার্মিনাল
                  </h2>
                  <p className="text-xs text-slate-600 mt-1.5 leading-relaxed">
                    ইন্টারেক্টিভ ক্যান্ডেলস্টিক, ভলিউম, SMA(20), EMA(20), বলিঞ্জার ব্যান্ড ও সিঙ্কড RSI(14) সাব-চার্ট এক স্ক্রিনে বিশ্লেষণ করুন।
                  </p>
                </div>
              </div>
              <div className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-700">
                <span>প্রো চার্ট টার্মিনাল খুলুন</span>
                <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
              </div>
            </Link>
          </div>

          {/* Live Daily Strong Bullish Setup Radar Shortcuts */}
          <section className="bg-white border border-slate-200 rounded-2xl p-6 shadow-xs space-y-4 flex-1">
            <div className="flex flex-wrap items-center justify-between gap-2 pb-3.5 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-emerald-50 border border-emerald-100 text-emerald-700 flex items-center justify-center shrink-0">
                  <Activity className="w-4 h-4" />
                </div>
                <h2 className="text-sm sm:text-base font-bold text-slate-900">
                  আজকের Strong Bullish Setup পর্যবেক্ষণ শর্টকাট
                </h2>
              </div>
              <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-500 bg-slate-100 px-2.5 py-1 rounded-md tabular-nums">
                <Clock className="w-3 h-3 text-slate-400" />
                <span>{picksData?.generated_at_bst || '৩:০০ PM BST'}</span>
              </span>
            </div>

            <SelfRiskDisclaimerBanner />

            {picks.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {picks.slice(0, 6).map((pick) => {
                  const totalVotes = pick.total_votes || 20;
                  const votePct = Math.min(100, Math.max(0, (pick.bull_votes / totalVotes) * 100));
                  const upsidePct =
                    pick.price > 0 ? ((pick.target_price - pick.price) / pick.price) * 100 : 0;

                  return (
                    <Link
                      key={pick.symbol}
                      to={`/analyzer?symbol=${encodeURIComponent(pick.symbol)}&exchange=${pick.exchange}&pick=buy`}
                      className="group flex flex-col justify-between border border-slate-200 hover:border-blue-600/60 bg-white hover:bg-slate-50/40 rounded-2xl p-4 shadow-2xs transition-all space-y-3.5"
                    >
                      {/* Card Header */}
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-base font-extrabold text-slate-900 tracking-tight truncate">
                            {pick.symbol}
                          </span>
                          <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider bg-slate-100 text-slate-600 border border-slate-200 shrink-0">
                            {pick.exchange}
                          </span>
                        </div>
                        <span className="inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-bold bg-emerald-50 text-emerald-800 border border-emerald-200/80 font-mono-num tabular-nums whitespace-nowrap shrink-0">
                          কনফিডেন্স {toBanglaDigits(pick.confidence.toFixed(1))}%
                        </span>
                      </div>

                      {/* Consensus Indicator Pill + Visual Progress Bar */}
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between gap-2 text-[11px]">
                          <span className="inline-flex items-center gap-1.5 font-semibold text-emerald-800">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
                            <span>
                              {toBanglaDigits(pick.bull_votes)}/{toBanglaDigits(totalVotes)} বুলিশ সূচক
                            </span>
                          </span>
                          <span className="text-slate-500 font-medium tabular-nums">
                            {toBanglaDigits(Math.round(votePct))}% ঐকমত্য
                          </span>
                        </div>
                        <div className="h-1.5 w-full rounded-full bg-slate-100 overflow-hidden">
                          <div
                            className="h-full rounded-full bg-emerald-600 transition-all"
                            style={{ width: `${votePct}%` }}
                          />
                        </div>
                      </div>

                      {/* Price vs Reference Target Box */}
                      <div className="grid grid-cols-2 gap-3 rounded-xl bg-slate-50 border border-slate-200/80 p-3 font-mono-num tabular-nums">
                        <div>
                          <div className="text-[10px] font-semibold text-slate-500">বর্তমান দর</div>
                          <div className="text-sm font-bold text-slate-900 mt-0.5">
                            ৳ {pick.price.toFixed(2)}
                          </div>
                        </div>
                        <div className="border-l border-slate-200/80 pl-3">
                          <div className="text-[10px] font-semibold text-slate-500">রেফারেন্স টার্গেট</div>
                          <div className="flex flex-wrap items-baseline gap-1.5 mt-0.5">
                            <span className="text-sm font-bold text-emerald-700">
                              ৳ {pick.target_price.toFixed(2)}
                            </span>
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-100/80 text-emerald-800">
                              {upsidePct >= 0 ? '+' : ''}
                              {upsidePct.toFixed(2)}%
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Footer Link */}
                      <div className="flex items-center justify-between pt-0.5 text-xs font-semibold text-blue-700 group-hover:text-blue-800">
                        <span>বিস্তারিত বিশ্লেষণ দেখুন</span>
                        <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" />
                      </div>
                    </Link>
                  );
                })}
              </div>
            ) : (
              <p className="text-xs text-slate-600 leading-relaxed">
                {LIVE_FEED_WAITING_BN}
              </p>
            )}
          </section>
        </div>
      </div>

      {/* One-Click Unsubscribe Confirmation Dialog */}
      {showUnsubModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="unsub-dialog-title"
        >
          <div className="bg-white border border-slate-200 rounded-2xl max-w-md w-full p-6 shadow-xl space-y-5">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-rose-50 text-rose-600 flex items-center justify-center shrink-0">
                  <AlertTriangle className="w-5 h-5" />
                </div>
                <h2 id="unsub-dialog-title" className="text-base font-bold text-slate-900">
                  সাবস্ক্রিপশন বাতিল নিশ্চিতকরণ
                </h2>
              </div>
              <button
                type="button"
                onClick={() => !isUnsubscribing && setShowUnsubModal(false)}
                aria-label="Close modal"
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-sm text-slate-700 leading-relaxed">
              আপনি কি নিশ্চিতভাবে MukiSoft Stock AI সাবস্ক্রিপশন বাতিল করতে চান?
            </p>

            <div className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-xs text-slate-600 space-y-1">
              <div>
                নম্বর: <strong className="font-mono-num text-slate-900">{maskBdMobile(session.mobile)}</strong>
              </div>
              <div>বাতিল করার পর আপনার Robi &amp; Cirkle নম্বর থেকে দৈনিক ২.৭৮ টাকা চার্জ বন্ধ হয়ে যাবে।</div>
            </div>

            {unsubError && (
              <div className="rounded-lg border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs font-medium text-rose-700">
                {unsubError}
              </div>
            )}

            <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2.5 pt-1">
              <button
                type="button"
                disabled={isUnsubscribing}
                onClick={() => setShowUnsubModal(false)}
                className="px-4 py-2.5 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold cursor-pointer"
              >
                ফিরে যান
              </button>
              <button
                type="button"
                disabled={isUnsubscribing}
                onClick={handleConfirmUnsubscribe}
                className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 disabled:opacity-60 text-white text-xs font-bold cursor-pointer"
              >
                {isUnsubscribing ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>বাতিল করা হচ্ছে...</span>
                  </>
                ) : (
                  <span>হ্যাঁ, সাবস্ক্রিপশন বাতিল করুন</span>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
