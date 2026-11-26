import { useEffect } from 'react';
import { Clock, Lock, X } from 'lucide-react';
import { BdappsSubscriptionCard } from './BdappsSubscriptionCard';
import { formatBanglaCountdownHMS } from '../../services/quotaService';
import type { BdappsSession } from '../../services/bdappsService';

interface FreeQuotaPaywallModalProps {
  isOpen: boolean;
  resetInSeconds: number;
  requestedSymbol?: string | null;
  onClose: () => void;
  onSubscribed: (session: BdappsSession) => void;
}

export function FreeQuotaPaywallModal({
  isOpen,
  resetInSeconds,
  requestedSymbol,
  onClose,
  onSubscribed,
}: FreeQuotaPaywallModalProps) {
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = prevOverflow;
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const countdownLabel = formatBanglaCountdownHMS(
    resetInSeconds > 0 ? resetInSeconds : 86_400
  );

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="free-quota-paywall-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/70 backdrop-blur-xs overflow-y-auto"
    >
      <div className="relative w-full max-w-lg bg-white border border-slate-200 rounded-2xl shadow-2xl overflow-hidden my-auto max-h-[94vh] flex flex-col">
        {/* Top Header */}
        <div className="px-4 sm:px-6 pt-5 pb-4 border-b border-slate-200 bg-slate-900 text-white shrink-0">
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1.5 min-w-0">
              <div className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-amber-300">
                <Lock className="w-3.5 h-3.5 shrink-0" />
                <span>
                  🇧🇩 অফিসিয়াল বিডিঅ্যাপস সাবস্ক্রিপশন
                  {requestedSymbol ? ` • ${requestedSymbol} আনলক করুন` : ''}
                </span>
              </div>
              <h2
                id="free-quota-paywall-title"
                className="text-lg sm:text-xl font-extrabold tracking-tight text-white leading-snug"
              >
                আজকের ২টি ফ্রি বিশ্লেষণ শেষ হয়েছে!
              </h2>
            </div>

            <button
              type="button"
              onClick={onClose}
              aria-label="বন্ধ করুন"
              className="p-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-slate-800 transition-colors shrink-0 cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Live Ticking Bangla Countdown Badge */}
          <div className="mt-3 rounded-xl bg-amber-500/15 border border-amber-400/35 px-3.5 py-2.5 flex items-center gap-2 text-xs sm:text-[13px] font-bold text-amber-200">
            <Clock className="w-4 h-4 text-amber-300 shrink-0" />
            <span className="leading-snug">
              ⏳ পরবর্তী ফ্রি কোটা চালু হতে বাকি: {countdownLabel}
            </span>
          </div>
        </div>

        {/* Scrollable Body with Subtitle & Embedded 2-Step Robi & Cirkle OTP Form */}
        <div className="p-4 sm:p-6 space-y-4 overflow-y-auto min-w-0">
          <p className="text-xs sm:text-sm text-slate-700 leading-relaxed font-medium">
            অপেক্ষা না করে এখনই আনলিমিটেড DSE ও CSE স্টক AI টেকনিক্যাল বিশ্লেষণ ও ৬টি Strong Bullish Setup পর্যবেক্ষণ পেতে সাবস্ক্রাইব করুন —{' '}
            <strong className="text-slate-900">
              মাত্র ২.৭৮ টাকা /দিন (ভ্যাট + এসডি + এসসি সহ)
            </strong>
            ।
          </p>

          <BdappsSubscriptionCard
            embeddedInModal={true}
            onSubscribed={onSubscribed}
          />
        </div>
      </div>
    </div>
  );
}
