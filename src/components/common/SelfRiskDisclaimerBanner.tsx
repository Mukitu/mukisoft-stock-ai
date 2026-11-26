import { AlertTriangle } from 'lucide-react';
import { Link } from 'react-router-dom';

interface SelfRiskDisclaimerBannerProps {
  className?: string;
}

export const SELF_RISK_DISCLAIMER_TEXT_BN =
  '⚠️ রিয়েল-টাইম মার্কেট সিগন্যাল ও নিজস্ব ঝুঁকি সতর্কতা (Self-Risk Disclaimer): MukiSoft Stock AI একটি রিয়েল-টাইম AI মার্কেট সিগন্যাল ও প্রযুক্তিগত বিশ্লেষণ প্ল্যাটফর্ম (কোনো BSEC-নিবন্ধিত ব্রোকারেজ হাউজ বা আর্থিক উপদেষ্টা নয়)। এখানে প্রদর্শিত সকল স্কোর, টার্গেট ও স্টপ-লস লাইভ ডেটা ও অ্যালগরিদম-ভিত্তিক প্রযুক্তিগত সিগন্যাল—চূড়ান্ত ট্রেডিং সিদ্ধান্ত ও ঝুঁকি সম্পূর্ণভাবে আপনার নিজের।';

export function SelfRiskDisclaimerBanner({ className = '' }: SelfRiskDisclaimerBannerProps) {
  return (
    <div
      role="note"
      aria-label="বিনিয়োগ ঝুঁকি সতর্কতা"
      className={`w-full min-w-0 rounded-xl border border-amber-300/90 bg-amber-50/90 px-4 py-3.5 text-xs sm:text-[13px] text-amber-950 leading-relaxed flex items-start gap-2.5 ${className}`}
    >
      <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
      <div className="min-w-0 space-y-1">
        <p className="font-medium break-words">
          <strong className="font-bold">⚠️ রিয়েল-টাইম মার্কেট সিগন্যাল ও নিজস্ব ঝুঁকি সতর্কতা (Self-Risk):</strong>{' '}
          MukiSoft Stock AI একটি রিয়েল-টাইম AI মার্কেট সিগন্যাল ও প্রযুক্তিগত বিশ্লেষণ প্ল্যাটফর্ম (কোনো BSEC-নিবন্ধিত ব্রোকারেজ হাউজ বা আর্থিক উপদেষ্টা নয়)। এখানে প্রদর্শিত সকল স্কোর, টার্গেট ও স্টপ-লস লাইভ ডেটা ও অ্যালগরিদম-ভিত্তিক প্রযুক্তিগত সিগন্যাল—চূড়ান্ত ট্রেডিং সিদ্ধান্ত ও ঝুঁকি সম্পূর্ণভাবে আপনার নিজের।{' '}
          <Link
            to="/risk-disclosure"
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-800 hover:text-blue-900 underline underline-offset-2 font-semibold whitespace-nowrap"
          >
            বিনিয়োগ ঝুঁকি ও নীতিমালা পড়ুন →
          </Link>
        </p>
      </div>
    </div>
  );
}
