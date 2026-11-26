import { AlertTriangle } from 'lucide-react';
import { Link } from 'react-router-dom';

interface SelfRiskDisclaimerBannerProps {
  className?: string;
}

export const SELF_RISK_DISCLAIMER_TEXT_BN =
  '⚠️ বিনিয়োগ ঝুঁকি সতর্কতা (Self-Risk Disclaimer): MukiSoft Stock AI কোনো BSEC-নিবন্ধিত ব্রোকার হাউজ বা আর্থিক উপদেষ্টা নয়। এখানে প্রদর্শিত সকল স্কোর, টার্গেট ও স্টপ-লস কেবল গাণিতিক মডেল ও ঐতিহাসিক ডেটা-ভিত্তিক শিক্ষামূলক পর্যবেক্ষণ। যেকোনো বিনিয়োগ সিদ্ধান্ত সম্পূর্ণ আপনার নিজস্ব ঝুঁকিতে গ্রহণ করুন।';

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
          <strong className="font-bold">⚠️ বিনিয়োগ ঝুঁকি সতর্কতা (Self-Risk Disclaimer):</strong>{' '}
          MukiSoft Stock AI কোনো BSEC-নিবন্ধিত ব্রোকার হাউজ বা আর্থিক উপদেষ্টা নয়। এখানে প্রদর্শিত সকল স্কোর, টার্গেট ও স্টপ-লস কেবল গাণিতিক মডেল ও ঐতিহাসিক ডেটা-ভিত্তিক শিক্ষামূলক পর্যবেক্ষণ। যেকোনো বিনিয়োগ সিদ্ধান্ত সম্পূর্ণ আপনার নিজস্ব ঝুঁকিতে গ্রহণ করুন।{' '}
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
