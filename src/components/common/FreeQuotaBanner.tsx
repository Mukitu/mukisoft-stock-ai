import { Clock, Lock } from 'lucide-react';
import {
  QUOTA_WINDOW_SECONDS,
  formatBanglaCountdownHM,
  formatBanglaCountdownHMS,
} from '../../services/quotaService';
import { toBanglaDigits } from '../../utils/quantConsensus';

interface FreeQuotaBannerProps {
  isSubscribed: boolean;
  remaining: number;
  liveResetSeconds: number;
  onOpenPaywall: () => void;
  className?: string;
}

export function FreeQuotaBanner({
  isSubscribed,
  remaining,
  liveResetSeconds,
  onOpenPaywall,
  className = '',
}: FreeQuotaBannerProps) {
  if (isSubscribed) return null;

  const hasRemaining = remaining > 0;
  const resetDisplayHM = formatBanglaCountdownHM(
    liveResetSeconds > 0 ? liveResetSeconds : QUOTA_WINDOW_SECONDS
  );
  const resetDisplayHMS = formatBanglaCountdownHMS(
    liveResetSeconds > 0 ? liveResetSeconds : QUOTA_WINDOW_SECONDS
  );

  if (hasRemaining) {
    return (
      <div
        className={`w-full min-w-0 rounded-xl border border-blue-200 bg-blue-50/80 px-3.5 py-2.5 text-xs sm:text-[13px] font-semibold text-blue-950 flex items-start sm:items-center gap-2 leading-relaxed ${className}`}
      >
        <Clock className="w-4 h-4 text-blue-700 shrink-0 mt-0.5 sm:mt-0" />
        <span className="min-w-0 break-words">
          🎁 ফ্রি ট্রায়াল: আজকের ২টি ফ্রি বিশ্লেষণের মধ্যে {toBanglaDigits(remaining)}টি বাকি আছে (রিসেট হতে বাকি: {resetDisplayHM})
        </span>
      </div>
    );
  }

  return (
    <div
      className={`w-full min-w-0 rounded-xl border border-amber-300 bg-amber-50 px-3.5 py-2.5 text-xs sm:text-[13px] font-semibold text-amber-950 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 leading-relaxed ${className}`}
    >
      <div className="flex items-start sm:items-center gap-2 min-w-0">
        <Lock className="w-4 h-4 text-amber-700 shrink-0 mt-0.5 sm:mt-0" />
        <span className="min-w-0 break-words">
          ⏳ আজকের ২টি ফ্রি বিশ্লেষণ শেষ হয়েছে • পরবর্তী ফ্রি কোটা চালু হতে বাকি: {resetDisplayHMS}
        </span>
      </div>
      <button
        type="button"
        onClick={onOpenPaywall}
        className="px-3 py-1.5 rounded-lg bg-blue-700 hover:bg-blue-800 text-white text-xs font-semibold whitespace-nowrap self-start sm:self-center shrink-0 cursor-pointer"
      >
        আনলিমিটেড আনলক করুন →
      </button>
    </div>
  );
}
