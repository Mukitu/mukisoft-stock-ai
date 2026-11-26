import { AlertTriangle, Cpu, ShieldAlert, ShieldCheck } from 'lucide-react';
import { Link } from 'react-router-dom';

export function RiskDisclosurePage() {
  return (
    <main className="max-w-4xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-10 sm:py-12 flex-1">
      <div className="bg-white border border-slate-200 rounded-2xl p-6 sm:p-8 md:p-10 space-y-6 shadow-xs">
        {/* Institutional FinTech Page Header */}
        <header className="border-b border-slate-200 pb-6 space-y-2.5">
          <div className="inline-flex items-center gap-2 text-xs font-semibold text-blue-800 bg-blue-50 border border-blue-200/80 px-3 py-1 rounded-md">
            <span>রিয়েল-টাইম AI সিগন্যাল স্বচ্ছতা ও ব্যবহারের নীতিমালা • সর্বশেষ হালনাগাদ ২০২৬</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
            বিনিয়োগ ঝুঁকি ও ব্যবহারকারীর সম্মতি নীতিমালা
          </h1>
          <p className="text-sm font-medium text-slate-600">
            DSE ও CSE প্রোডাকশন-রেডি রিয়েল-টাইম AI মার্কেট সিগন্যাল প্ল্যাটফর্ম
          </p>
        </header>

        <div className="space-y-4 text-sm text-slate-700 leading-relaxed">
          {/* Top Highlight Alert Box */}
          <section
            aria-label="রিয়েল-টাইম মার্কেট সিগন্যাল ও নিজস্ব ঝুঁকি সতর্কতা"
            className="p-5 sm:p-6 rounded-xl bg-amber-50 border border-amber-300/90 space-y-2 text-amber-950"
          >
            <div className="flex items-start gap-2.5">
              <AlertTriangle className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
              <div className="space-y-1.5">
                <h2 className="text-base font-bold text-amber-950">
                  ⚠️ রিয়েল-টাইম মার্কেট সিগন্যাল ও নিজস্ব ঝুঁকি সতর্কতা
                </h2>
                <p className="leading-relaxed">
                  MukiSoft Stock AI একটি আধুনিক রিয়েল-টাইম কোয়ান্টিটেটিভ মার্কেট সিগন্যাল ও টেকনিক্যাল অ্যানালাইসিস প্ল্যাটফর্ম। আমাদের ৯৭-ফিচার XGBoost মডেল এবং ২০-ইন্ডিকেটর ইঞ্জিন সর্বোচ্চ গাণিতিক নির্ভুলতায় লাইভ মার্কেট সিগন্যাল, টার্গেট ও স্টপ-লস প্রদান করে। তবে পুঁজিবাজারের গতিবিধি সবসময় তাৎক্ষণিক লাইভ মার্কেট চাহিদা ও পরিস্থিতির ওপর নির্ভরশীল—তাই চূড়ান্ত ট্রেডিং সিদ্ধান্ত ও ঝুঁকি (Self-Risk) সম্পূর্ণভাবে ব্যবহারকারীর নিজের।
                </p>
              </div>
            </div>
          </section>

          {/* Section 1 */}
          <section className="p-5 sm:p-6 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-blue-100 text-blue-700 flex items-center justify-center shrink-0">
                <Cpu className="w-4 h-4" />
              </div>
              <h2 className="text-base font-bold text-slate-900">
                ১. প্রোডাকশন-রেডি রিয়েল-টাইম সিগন্যাল প্ল্যাটফর্ম (সিগন্যাল ইঞ্জিন)
              </h2>
            </div>
            <p className="leading-relaxed">
              MukiSoft Stock AI সরাসরি লাইভ মার্কেট ডেটা বিশ্লেষণ করে ব্যবহারকারীদের দ্রুত ও কার্যকর ট্রেডিং সিদ্ধান্ত নিতে সহায়তা করার জন্য তৈরি একটি রিয়েল-টাইম সিগন্যাল ও অ্যানালাইসিস টুল। এটি কোনো BSEC-নিবন্ধিত ব্রোকারেজ হাউজ বা ব্যক্তিগত তহবিল ব্যবস্থাপক নয়; বরং একটি প্রযুক্তিগত সিদ্ধান্ত-সহায়ক প্ল্যাটফর্ম মাত্র।
            </p>
          </section>

          {/* Section 2 */}
          <section className="p-5 sm:p-6 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-rose-100 text-rose-700 flex items-center justify-center shrink-0">
                <ShieldAlert className="w-4 h-4" />
              </div>
              <h2 className="text-base font-bold text-slate-900">
                ২. পুঁজিবাজারের ঝুঁকি ও ব্যবহারকারীর একক দায়ভার (Zero Legal Binding)
              </h2>
            </div>
            <p className="leading-relaxed">
              ঢাকা স্টক এক্সচেঞ্জ (DSE) ও চট্টগ্রাম স্টক এক্সচেঞ্জ (CSE)-এ যেকোনো বিনিয়োগ সর্বদা লাইভ মার্কেট ওঠানামার অধীন। আমাদের AI মডেল সর্বোচ্চ নির্ভুলতায় সম্ভাব্য শক্তিশালী শেয়ার শনাক্ত করলেও শতভাগ মুনাফার নিশ্চয়তা পুঁজিবাজারে সম্ভব নয়। এই প্ল্যাটফর্মের সিগন্যাল ব্যবহার করে শেয়ার ক্রয়-বিক্রয়ের ফলে অর্জিত যেকোনো লাভ বা ক্ষতির সম্পূর্ণ দায়ভার একান্তই ব্যবহারকারীর নিজের, এবং এ বিষয়ে MukiSoft Stock AI বা MukiSoft Technology-র কোনো আর্থিক বা আইনি বাধ্যবাধকতা থাকবে না।
            </p>
          </section>

          {/* Section 3 */}
          <section className="p-5 sm:p-6 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0">
                <ShieldCheck className="w-4 h-4" />
              </div>
              <h2 className="text-base font-bold text-slate-900">
                ৩. সাবস্ক্রিপশন ও ব্যবহারকারীর সম্মতি (I Agree Consent)
              </h2>
            </div>
            <p className="leading-relaxed">
              BDApps (Robi &amp; Cirkle) সাবস্ক্রিপশন গ্রহণের পূর্বে প্রতিটি ব্যবহারকারীকে বাধ্যতামূলকভাবে &lsquo;I Agree&rsquo; সম্মতি প্রদান করতে হয়। সাবস্ক্রিপশন ফি শুধুমাত্র প্রোডাকশন-রেডি রিয়েল-টাইম AI সিগন্যাল, লাইভ চার্ট ও কোয়ান্টিটেটিভ অ্যানালাইসিস ড্যাশবোর্ড ব্যবহারের অ্যাক্সেস ফি—কোনো নিশ্চিত আর্থিক মুনাফার চুক্তি নয়।
            </p>
          </section>
        </div>

        {/* Footer Return Actions */}
        <div className="pt-4 border-t border-slate-200 flex flex-wrap items-center justify-between gap-3 text-xs">
          <span className="text-slate-500">
            MukiSoft Technology · DSE &amp; CSE Real-Time AI Market Signal Platform
          </span>
          <div className="flex items-center gap-2.5">
            <Link
              to="/"
              className="px-4 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 font-semibold transition-colors"
            >
              হোম পেজে ফিরুন
            </Link>
            <Link
              to="/analyzer"
              className="px-4 py-2 rounded-lg bg-blue-700 hover:bg-blue-800 text-white font-semibold transition-colors"
            >
              AI অ্যানালাইজার খুলুন
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
