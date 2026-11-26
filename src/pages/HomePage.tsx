import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  BarChart3,
  CheckCircle2,
  Lock,
  MessageSquareText,
  Search,
  ShieldCheck,
  X,
} from 'lucide-react';
import type { Exchange, TopPick } from '../types/market';
import { useTopPicks } from '../hooks/useMarketQueries';
import { getBDMarketSession } from '../utils/bdMarketSession';
import { BdappsSubscriptionCard } from '../components/bdapps/BdappsSubscriptionCard';
import {
  consumeBdappsToast,
  getBdappsSession,
  isSessionActive,
} from '../services/bdappsService';

const UNLOCK_PROMPT_BN =
  'বাকি ৫টি Strong Buy স্টক ও পূর্ণ AI সিগন্যাল আনলক করতে আপনার Robi & Cirkle নম্বর দিয়ে সাবস্ক্রাইব করুন';

export function HomePage() {
  const navigate = useNavigate();
  const [exchange, setExchange] = useState<Exchange>('DSE');
  const [symbolInput, setSymbolInput] = useState('');
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [unlockPrompt, setUnlockPrompt] = useState<string | null>(null);
  const [cardHighlighted, setCardHighlighted] = useState(false);

  const highlightTimerRef = useRef<number | null>(null);

  const session = getBDMarketSession();
  const isSubscribed = isSessionActive(getBdappsSession());
  const { data: picksData, isLoading } = useTopPicks();
  const picks: TopPick[] = picksData?.picks || [];

  useEffect(() => {
    const pendingToast = consumeBdappsToast();
    if (pendingToast) {
      setToastMsg(pendingToast);
    }
    return () => {
      if (highlightTimerRef.current !== null) {
        window.clearTimeout(highlightTimerRef.current);
      }
    };
  }, []);

  const handleQuickSearch = (e: FormEvent) => {
    e.preventDefault();
    const sym = symbolInput.trim().toUpperCase();
    if (!sym) return;
    navigate(`/analyzer?symbol=${encodeURIComponent(sym)}&exchange=${exchange}`);
  };

  const handleLockedCardClick = () => {
    setUnlockPrompt(UNLOCK_PROMPT_BN);
    setToastMsg(UNLOCK_PROMPT_BN);
    setCardHighlighted(true);

    if (highlightTimerRef.current !== null) {
      window.clearTimeout(highlightTimerRef.current);
    }
    highlightTimerRef.current = window.setTimeout(() => {
      setCardHighlighted(false);
    }, 2600);

    const cardEl = document.getElementById('bdapps-subscription-card');
    if (cardEl) {
      cardEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    window.setTimeout(() => {
      const mobileInput = document.getElementById('bdapps-mobile-input') as HTMLInputElement | null;
      mobileInput?.focus({ preventScroll: true });
    }, 420);
  };

  return (
    <div className="flex-1 w-full max-w-full overflow-x-hidden">
      {/* Dismissible Notification Toast (Unsubscribe Confirmation or Locked Card Prompt) */}
      {toastMsg && (
        <div className="bg-blue-50 border-b border-blue-200 px-3 sm:px-4 py-3 w-full max-w-full">
          <div className="max-w-7xl w-full mx-auto flex items-start sm:items-center justify-between gap-3 text-xs sm:text-sm font-medium text-blue-950 min-w-0">
            <div className="flex items-start sm:items-center gap-2 min-w-0">
              <CheckCircle2 className="w-4 h-4 text-blue-700 shrink-0 mt-0.5 sm:mt-0" />
              <span className="leading-relaxed break-words">{toastMsg}</span>
            </div>
            <button
              type="button"
              onClick={() => setToastMsg(null)}
              aria-label="Close notice"
              className="p-1 rounded-md text-blue-700 hover:bg-blue-100 cursor-pointer shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Mobile-First Responsive Hero Section */}
      <section className="bg-white border-b border-slate-200 py-5 sm:py-10 lg:py-16 w-full max-w-full overflow-x-hidden">
        <div className="max-w-7xl w-full mx-auto px-3 sm:px-6 lg:px-8 grid grid-cols-1 lg:grid-cols-12 gap-5 sm:gap-8 lg:gap-x-12 lg:gap-y-6 items-start">
          {/* Block 1: Compact Hero Header (order-1 on mobile, top-left on lg desktop) */}
          <div className="order-1 lg:col-span-7 lg:col-start-1 lg:row-start-1 flex flex-col justify-end space-y-2.5 sm:space-y-4 min-w-0">
            <div className="text-[11px] sm:text-xs font-semibold text-blue-700 tracking-wide leading-snug">
              ৯৮% ভ্যালিডেটেড কোয়ান্টিটেটিভ ইঞ্জিন · DSE ও CSE রিয়েল-টাইম অ্যানালিটিক্স
            </div>

            <h1 className="text-2xl sm:text-4xl lg:text-5xl font-extrabold text-slate-900 leading-[1.18] tracking-tight max-w-2xl">
              অনুমানে নয়, <span className="text-blue-700">তথ্য ও MukiSoft AI-এর বিশ্লেষণে</span> বিনিয়োগ করুন
            </h1>

            <p className="hidden sm:block text-slate-600 text-sm sm:text-base lg:text-lg leading-relaxed max-w-2xl">
              ঢাকা ও চট্টগ্রাম স্টক এক্সচেঞ্জের যেকোনো শেয়ার কেনার আগে ১৭-ফিচার XGBoost মডেল এবং ২০-ইন্ডিকেটর
              কনসেনসাস ইঞ্জিন দিয়ে যাচাই করুন। পরিষ্কার সাপোর্ট, রেজিস্ট্যান্স ও সহজ বাংলা ট্রেডিং গাইডলাইন পান মুহূর্তেই।
            </p>
          </div>

          {/* Block 2: BDApps (Robi & Cirkle) Subscription & OTP Card (order-2 above-the-fold on mobile, full right column on lg desktop) */}
          <div className="order-2 lg:col-span-5 lg:col-start-8 lg:row-start-1 lg:row-span-2 flex flex-col w-full min-w-0">
            <BdappsSubscriptionCard
              highlighted={cardHighlighted}
              unlockPrompt={unlockPrompt}
            />
          </div>

          {/* Block 3: Quick Stock Search & Trust Metrics (order-3 below subscription card on mobile, bottom-left on lg desktop) */}
          <div className="order-3 lg:col-span-7 lg:col-start-1 lg:row-start-2 flex flex-col justify-start space-y-5 min-w-0 pt-1 lg:pt-0">
            <p className="sm:hidden text-slate-600 text-xs leading-relaxed">
              DSE ও CSE-এর যেকোনো শেয়ার কেনার আগে ১৭-ফিচার XGBoost মডেল ও ২০-ইন্ডিকেটর কনসেনসাস দিয়ে যাচাই করুন।
            </p>

            {/* Quick Search Form */}
            <form
              onSubmit={handleQuickSearch}
              className="flex flex-col sm:flex-row gap-2.5 sm:gap-3 w-full max-w-xl min-w-0"
            >
              <select
                aria-label="Select exchange"
                value={exchange}
                onChange={(e) => setExchange(e.target.value as Exchange)}
                className="w-full sm:w-auto bg-white border border-slate-300 text-slate-900 text-sm font-semibold rounded-xl px-3.5 py-3 outline-none focus:border-blue-700 focus:ring-2 focus:ring-blue-700/15 shrink-0"
              >
                <option value="DSE">DSE (ঢাকা)</option>
                <option value="CSE">CSE (চট্টগ্রাম)</option>
              </select>

              <div className="relative flex-1 min-w-0">
                <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  required
                  value={symbolInput}
                  onChange={(e) => setSymbolInput(e.target.value.toUpperCase())}
                  placeholder="কোম্পানির কোড (SQURPHARMA, GP)"
                  className="w-full min-w-0 bg-white border border-slate-300 text-slate-900 text-sm rounded-xl pl-10 pr-3.5 py-3 outline-none focus:border-blue-700 focus:ring-2 focus:ring-blue-700/15 uppercase font-medium"
                />
              </div>

              <button
                type="submit"
                className="w-full sm:w-auto bg-blue-700 hover:bg-blue-800 text-white font-semibold px-6 py-3 rounded-xl transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                বিশ্লেষণ দেখুন
              </button>
            </form>

            {/* Trust Metrics Row */}
            <div className="pt-4 grid grid-cols-3 gap-3 sm:gap-6 max-w-lg border-t border-slate-200 min-w-0">
              <div className="min-w-0">
                <div className="text-lg sm:text-2xl font-bold text-slate-900 font-mono-num">98%</div>
                <div className="text-[11px] sm:text-xs text-slate-500 mt-0.5 leading-snug">ভ্যালিডেশন অ্যাকুরেসি</div>
              </div>
              <div className="min-w-0">
                <div className="text-lg sm:text-2xl font-bold text-slate-900 font-mono-num">20</div>
                <div className="text-[11px] sm:text-xs text-slate-500 mt-0.5 leading-snug">টেকনিক্যাল কনসেনসাস</div>
              </div>
              <div className="min-w-0">
                <div className="text-lg sm:text-2xl font-bold text-slate-900 font-mono-num">DSE · CSE</div>
                <div className="text-[11px] sm:text-xs text-slate-500 mt-0.5 leading-snug">দুই এক্সচেঞ্জ সাপোর্ট</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 6-Card Daily Strong Buy Radar (1 Free + 5 Blurred Until Subscribed) */}
      <section className="py-12 sm:py-16 bg-slate-50 border-b border-slate-200 w-full max-w-full overflow-x-hidden">
        <div className="max-w-7xl w-full mx-auto px-3 sm:px-6 lg:px-8 min-w-0">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-8 sm:mb-10 min-w-0">
            <div className="space-y-1.5 min-w-0">
              <div className="text-xs font-semibold text-emerald-700">{session.badge}</div>
              <h2 className="text-xl sm:text-3xl font-bold text-slate-900 tracking-tight">
                {session.headline}
              </h2>
              <p className="text-slate-600 text-xs sm:text-sm max-w-2xl leading-relaxed">
                {session.subtext}
              </p>
            </div>
            <div className="text-xs text-slate-600 bg-white px-3.5 py-2.5 rounded-lg border border-slate-200 max-w-full sm:whitespace-nowrap shrink-0 self-start md:self-auto">
              ট্রেডিং সময়: <strong className="text-slate-900">রবি–বৃহঃ · ১০:০০ AM – ২:৩০ PM BST</strong>
            </div>
          </div>

          {!isSubscribed && picks.length > 1 && (
            <div className="mb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white border border-blue-200/90 rounded-xl px-4 py-3 text-xs sm:text-sm">
              <div className="flex items-start sm:items-center gap-2 text-slate-700 min-w-0">
                <Lock className="w-4 h-4 text-blue-700 shrink-0 mt-0.5 sm:mt-0" />
                <span>
                  প্রথম Strong Buy স্টকটি <strong className="text-emerald-700">সম্পূর্ণ ফ্রি</strong>। বাকি ৫টি প্রিমিয়াম Strong Buy স্টক আনলক করতে Robi &amp; Cirkle নম্বর দিয়ে সাবস্ক্রাইব করুন।
                </span>
              </div>
              <button
                type="button"
                onClick={handleLockedCardClick}
                className="px-3.5 py-2 rounded-lg bg-blue-700 hover:bg-blue-800 text-white text-xs font-semibold whitespace-nowrap self-start sm:self-center shrink-0 cursor-pointer"
              >
                বাকি ৫টি আনলক করুন →
              </button>
            </div>
          )}

          {isLoading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 sm:gap-6">
              {Array.from({ length: 6 }).map((_, idx) => (
                <div
                  key={idx}
                  className="bg-white border border-slate-200 rounded-xl p-5 h-56 animate-pulse space-y-4 w-full min-w-0"
                >
                  <div className="h-5 w-28 bg-slate-200 rounded" />
                  <div className="h-8 w-36 bg-slate-100 rounded" />
                  <div className="grid grid-cols-2 gap-3">
                    <div className="h-12 bg-slate-100 rounded-lg" />
                    <div className="h-12 bg-slate-100 rounded-lg" />
                  </div>
                </div>
              ))}
            </div>
          ) : picks.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-xl p-8 text-center space-y-3">
              <p className="text-sm font-semibold text-slate-800">
                এই মুহূর্তে কোনো প্রকৃত Strong Buy (১৬/২০+ বুলিশ ও নন-সাইডওয়ে) কোম্পানি লক হয়নি।
              </p>
              <Link
                to="/analyzer"
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-700 text-white text-xs font-semibold"
              >
                <span>সরাসরি AI অ্যানালাইজার খুলুন</span>
                <ArrowRight className="w-4 h-4" />
              </Link>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 sm:gap-6 w-full min-w-0">
              {picks.slice(0, 6).map((item, idx) => {
                const isLowTier = item.price < 100;
                const isPositive = item.change_pct >= 0;
                const isLocked = !isSubscribed && idx > 0;

                if (isLocked) {
                  return (
                    <article
                      key={`locked-${idx}`}
                      role="button"
                      tabIndex={0}
                      onClick={handleLockedCardClick}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          handleLockedCardClick();
                        }
                      }}
                      aria-label={`প্রিমিয়াম Strong Buy স্টক #${idx + 1} আনলক করতে সাবস্ক্রাইব করুন`}
                      className="relative overflow-hidden bg-white border border-slate-200 hover:border-blue-600/70 rounded-xl p-5 transition-all flex flex-col justify-between w-full min-w-0 cursor-pointer group focus:outline-none focus:ring-2 focus:ring-blue-700"
                    >
                      {/* Blurred Underlying Stock Metrics (Non-Interactive) */}
                      <div aria-hidden="true" className="blur-[7px] select-none pointer-events-none opacity-60">
                        <div className="flex items-start justify-between gap-2 pb-3 border-b border-slate-100">
                          <div>
                            <div className="text-xs text-slate-500">
                              {isLowTier ? 'Low-Cap Active' : 'Mid & Large-Cap'} · {item.exchange} · RSI 58
                            </div>
                            <div className="text-lg font-bold text-slate-900 mt-0.5">PREMIUM{idx + 1}</div>
                          </div>
                          <div className="text-right">
                            <div className="text-xs font-bold text-emerald-700">Strong Buy</div>
                            <div className="text-[11px] text-slate-500 font-mono-num">98.6% conf</div>
                          </div>
                        </div>

                        <div className="flex items-baseline justify-between py-4">
                          <div>
                            <div className="text-[11px] text-slate-500">বর্তমান / ক্লোজিং দর</div>
                            <div className="text-2xl font-bold text-slate-900 font-mono-num">৳ 142.50</div>
                          </div>
                          <div className="text-sm font-bold font-mono-num text-emerald-700">+3.40%</div>
                        </div>

                        <div className="grid grid-cols-2 gap-3 pb-4 border-b border-slate-100 text-xs">
                          <div>
                            <div className="text-slate-500">টার্গেট প্রাইস</div>
                            <div className="font-bold text-emerald-700 font-mono-num text-sm mt-0.5">৳ 156.80</div>
                          </div>
                          <div>
                            <div className="text-slate-500">নিরাপদ স্টপ-লস</div>
                            <div className="font-bold text-rose-700 font-mono-num text-sm mt-0.5">৳ 135.20</div>
                          </div>
                        </div>

                        <div className="flex items-center justify-between pt-3.5 gap-2">
                          <span className="text-xs text-slate-500">৩:০০ PM BST</span>
                          <span className="px-3 py-1.5 rounded-lg bg-blue-700 text-white text-xs font-semibold">
                            AI রিপোর্ট
                          </span>
                        </div>
                      </div>

                      {/* Frosted Glass Lock Overlay */}
                      <div className="absolute inset-0 bg-white/60 backdrop-blur-md flex flex-col items-center justify-center p-5 text-center space-y-3">
                        <div className="w-11 h-11 rounded-full bg-slate-900 text-white flex items-center justify-center shadow-sm group-hover:bg-blue-700 transition-colors">
                          <Lock className="w-5 h-5" />
                        </div>

                        <div className="space-y-1 max-w-[260px]">
                          <div className="text-[11px] font-bold text-emerald-700 uppercase tracking-wide">
                            {isLowTier ? 'Low-Cap Active' : 'Mid & Large-Cap'} · #{idx + 1}
                          </div>
                          <p className="text-xs sm:text-[13px] font-bold text-slate-900 leading-snug">
                            🔒 প্রিমিয়াম Strong Buy স্টক • আনলক করতে সাবস্ক্রাইব করুন
                          </p>
                        </div>

                        <span className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-blue-700 group-hover:bg-blue-800 text-white text-xs font-semibold transition-colors">
                          <span>Robi &amp; Cirkle দিয়ে আনলক করুন</span>
                          <ArrowRight className="w-3.5 h-3.5" />
                        </span>
                      </div>
                    </article>
                  );
                }

                return (
                  <article
                    key={`${item.symbol}-${idx}`}
                    className="bg-white border border-slate-200 hover:border-blue-600/50 rounded-xl p-5 transition-colors flex flex-col justify-between w-full min-w-0"
                  >
                    <div className="min-w-0">
                      <div className="flex items-start justify-between gap-2 pb-3 border-b border-slate-100">
                        <div className="min-w-0">
                          <div className="text-xs text-slate-500 truncate">
                            {isLowTier ? 'Low-Cap Active' : 'Mid & Large-Cap'} · {item.exchange} · RSI{' '}
                            <span className="font-mono-num">{item.rsi}</span>
                          </div>
                          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                            <h3 className="text-lg font-bold text-slate-900">{item.symbol}</h3>
                            {!isSubscribed && idx === 0 && (
                              <span className="text-[10px] font-bold text-emerald-800 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded">
                                ফ্রি প্রিভিউ
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <div className="text-xs font-bold text-emerald-700">Strong Buy</div>
                          <div className="text-[11px] text-slate-500 font-mono-num">
                            {item.confidence.toFixed(1)}% conf
                          </div>
                        </div>
                      </div>

                      <div className="flex items-baseline justify-between py-4 gap-2">
                        <div>
                          <div className="text-[11px] text-slate-500">বর্তমান / ক্লোজিং দর</div>
                          <div className="text-2xl font-bold text-slate-900 font-mono-num">
                            ৳ {item.price.toFixed(2)}
                          </div>
                        </div>
                        <div
                          className={`text-sm font-bold font-mono-num shrink-0 ${
                            isPositive ? 'text-emerald-700' : 'text-amber-700'
                          }`}
                        >
                          {isPositive ? '+' : ''}
                          {item.change_pct.toFixed(2)}%
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-3 pb-4 border-b border-slate-100 text-xs">
                        <div>
                          <div className="text-slate-500">টার্গেট প্রাইস</div>
                          <div className="font-bold text-emerald-700 font-mono-num text-sm mt-0.5">
                            ৳ {item.target_price.toFixed(2)}
                          </div>
                        </div>
                        <div>
                          <div className="text-slate-500">নিরাপদ স্টপ-লস</div>
                          <div className="font-bold text-rose-700 font-mono-num text-sm mt-0.5">
                            ৳ {item.stop_loss.toFixed(2)}
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center justify-between pt-3.5 gap-2 min-w-0">
                      <span className="text-xs font-medium text-slate-600 truncate">
                        {session.cardTiming}
                      </span>
                      <Link
                        to={`/analyzer?symbol=${encodeURIComponent(item.symbol)}&exchange=${item.exchange}&pick=buy`}
                        className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-blue-700 hover:bg-blue-800 text-white text-xs font-semibold transition-colors whitespace-nowrap shrink-0"
                      >
                        <span>AI রিপোর্ট</span>
                        <ArrowRight className="w-3.5 h-3.5" />
                      </Link>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>
      </section>

      {/* Institutional Architecture Highlights */}
      <section className="py-12 sm:py-16 bg-white border-b border-slate-200 w-full max-w-full overflow-x-hidden">
        <div className="max-w-7xl w-full mx-auto px-3 sm:px-6 lg:px-8 min-w-0">
          <div className="max-w-2xl mb-10 sm:mb-12 space-y-2">
            <div className="text-xs font-semibold text-blue-700">কোয়ান্টিটেটিভ আর্কিটেকচার</div>
            <h2 className="text-xl sm:text-3xl font-bold text-slate-900 tracking-tight">
              কেন MukiSoft AI বাংলাদেশের বিনিয়োগকারীদের প্রথম পছন্দ?
            </h2>
            <p className="text-slate-600 text-sm">
              আবেগ বা গুজব নয়—সত্যিকারের ঐতিহাসিক OHLCV ডেটা, XGBoost ML এবং ২০-ইন্ডিকেটর কনসেনসাস ভিত্তিক সিদ্ধান্ত।
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-5 sm:gap-6">
            <div className="bg-slate-50 border border-slate-200 p-5 sm:p-6 rounded-xl space-y-3 min-w-0">
              <BarChart3 className="w-6 h-6 text-blue-700" />
              <h3 className="text-base font-bold text-slate-900">১৭-ফিচার XGBoost + ২০ সূচক</h3>
              <p className="text-slate-600 text-sm leading-relaxed">
                DSE ও CSE-এর ৯০-দিনের ঐতিহাসিক প্রাইস অ্যাকশন থেকে SMA, EMA, Wilder RSI, MACD, Bollinger Bands ও ভলিউম রেশিও যাচাই করে।
              </p>
            </div>

            <div className="bg-slate-50 border border-slate-200 p-5 sm:p-6 rounded-xl space-y-3 min-w-0">
              <ShieldCheck className="w-6 h-6 text-emerald-700" />
              <h3 className="text-base font-bold text-slate-900">ইউনিফায়েড টার্গেট ও স্টপ-লস</h3>
              <p className="text-slate-600 text-sm leading-relaxed">
                ২০-দিনের সাপোর্ট-রেজিস্ট্যান্স ও ATR ভোলাটিলিটি বিশ্লেষণ করে প্রতিটি শেয়ারের প্রফিট লক্ষ্যমাত্রা ও স্টপ-লস নির্ধারণ করে।
              </p>
            </div>

            <div className="bg-slate-50 border border-slate-200 p-5 sm:p-6 rounded-xl space-y-3 min-w-0">
              <MessageSquareText className="w-6 h-6 text-slate-800" />
              <h3 className="text-base font-bold text-slate-900">সহজ বাংলায় বিশ্লেষণ ও ট্রেডিংভিউ চার্ট</h3>
              <p className="text-slate-600 text-sm leading-relaxed">
                প্রতিটি স্টকের জন্য সহজ বাংলায় ২০-ইন্ডিকেটর রিপোর্ট, স্ক্রিনশট/PDF OCR এবং প্রো ক্যান্ডেলস্টিক চার্ট।
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Bottom CTA Banner */}
      <section className="py-12 sm:py-16 bg-slate-50 w-full max-w-full overflow-x-hidden">
        <div className="max-w-7xl w-full mx-auto px-3 sm:px-6 lg:px-8 min-w-0">
          <div className="bg-slate-900 rounded-2xl p-6 sm:p-8 md:p-12 flex flex-col md:flex-row items-start md:items-center justify-between gap-6 md:gap-8">
            <div className="max-w-2xl space-y-2 min-w-0">
              <div className="text-xs font-semibold text-sky-400">MukiSoft Technology Quantitative Engine</div>
              <h2 className="text-xl sm:text-3xl font-bold text-white">
                আপনার DSE ও CSE বিনিয়োগকে ডেটা-চালিত করুন আজই
              </h2>
              <p className="text-slate-300 text-sm leading-relaxed">
                কোনো পাসওয়ার্ড ছাড়াই আপনার Robi &amp; Cirkle নম্বর দিয়ে যুক্ত হন এবং DSE ও CSE শেয়ারের ML সিগন্যাল ও ক্যান্ডেলস্টিক চার্ট বিশ্লেষণ করুন।
              </p>
            </div>
            <div className="flex flex-wrap gap-3 shrink-0 w-full md:w-auto">
              <Link
                to="/market"
                className="flex-1 md:flex-none text-center px-5 py-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-sm font-semibold border border-slate-700 transition-colors whitespace-nowrap"
              >
                মার্কেট চার্ট টার্মিনাল
              </Link>
              <Link
                to="/analyzer"
                className="flex-1 md:flex-none text-center px-5 py-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold transition-colors whitespace-nowrap"
              >
                AI অ্যানালাইজার খুলুন
              </Link>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
