import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ExternalLink, User } from 'lucide-react';

export function AboutPage() {
  const [imgFailed, setImgFailed] = useState(false);

  return (
    <main className="max-w-5xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-12 flex-1 space-y-8">
      <section className="bg-white border border-slate-200 rounded-2xl p-8 md:p-10 space-y-4">
        <div className="text-xs font-semibold text-blue-700">MukiSoft Technology Initiative</div>
        <h1 className="text-3xl sm:text-4xl font-extrabold text-slate-900 tracking-tight">
          MukiSoft AI — পুঁজিবাজারে ডেটা-চালিত সিদ্ধান্তের নতুন দিগন্ত
        </h1>
        <p className="text-slate-600 leading-relaxed text-base">
          <strong className="text-slate-900">MukiSoft AI</strong> হলো বাংলাদেশের পুঁজিবাজার—ঢাকা স্টক এক্সচেঞ্জ (DSE) এবং
          চট্টগ্রাম স্টক এক্সচেঞ্জ (CSE)-এর জন্য নির্মিত একটি প্রাতিষ্ঠানিক মানের{' '}
          <strong className="text-slate-900">কোয়ান্টিটেটিভ এআই ইঞ্জিন</strong>। সাধারণ বিনিয়োগকারীরা যাতে অনুমান বা গুজবের ওপর
          নির্ভর না করে গাণিতিক তথ্য ও ২০টি প্রযুক্তিগত সূচকের ভিত্তিতে সঠিক সিদ্ধান্ত নিতে পারেন, সেই লক্ষ্য নিয়েই প্ল্যাটফর্মটি তৈরি।
        </p>
      </section>

      {/* Founder & Architect Profile */}
      <section className="bg-white border border-slate-200 rounded-2xl p-8">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
          <div className="flex items-start gap-5">
            {!imgFailed ? (
              <img
                src="/assets/founder.png"
                alt="মুকিতু ইসলাম নিশাত (Mukitu Islam Nishat)"
                referrerPolicy="no-referrer"
                onError={() => setImgFailed(true)}
                className="w-20 h-20 rounded-2xl object-cover border border-slate-200 shrink-0"
              />
            ) : (
              <div className="w-20 h-20 rounded-2xl bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-500 shrink-0">
                <User className="w-8 h-8" />
              </div>
            )}

            <div className="space-y-1.5">
              <div className="text-xs font-semibold text-blue-700">নির্মাতা ও প্রতিষ্ঠাতা · Founder &amp; Architect</div>
              <h2 className="text-2xl font-bold text-slate-900">মুকিতু ইসলাম নিশাত (Mukitu Islam Nishat)</h2>
              <p className="text-sm font-semibold text-slate-700">
                Founder &amp; Director, MukiSoft Technology · Software Developer &amp; AI Engineer
              </p>
              <p className="text-sm text-slate-600 leading-relaxed pt-1 max-w-2xl">
                বাংলাদেশের ফিনটেক ও কৃত্রিম বুদ্ধিমত্তা খাতে আধুনিক সমাধান তৈরির লক্ষ্যে{' '}
                <strong className="text-slate-900">মুকিতু ইসলাম নিশাত</strong> এই সম্পূর্ণ প্ল্যাটফর্ম এবং ৯৮% ভ্যালিডেটেড
                কোয়ান্টিটেটিভ এআই ইঞ্জিনটি ডিজাইন ও ডেভেলপ করেছেন।
              </p>
            </div>
          </div>

          <div className="flex flex-col gap-2 shrink-0 w-full md:w-auto">
            <a
              href="https://mukisoft.tech"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-1.5 px-5 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold transition-colors whitespace-nowrap"
            >
              <span>MukiSoft Technology</span>
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
            <Link
              to="/contact"
              className="px-5 py-2.5 rounded-xl bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 text-xs font-semibold text-center transition-colors whitespace-nowrap"
            >
              সরাসরি যোগাযোগ করুন
            </Link>
          </div>
        </div>
      </section>

      <section className="bg-white border border-slate-200 p-8 rounded-2xl space-y-5">
        <h2 className="text-xl font-bold text-slate-900">আমাদের কোয়ান্টিটেটিভ এআই ইঞ্জিনের মূল বৈশিষ্ট্য</h2>
        <div className="grid md:grid-cols-3 gap-4 text-sm">
          <div className="p-5 rounded-xl bg-slate-50 border border-slate-200">
            <strong className="text-blue-700 block mb-1.5 text-base">৯৮% ভ্যালিডেটেড প্রেডিক্টিভ ইঞ্জিন</strong>
            <p className="text-slate-600 leading-relaxed">
              DSE ও CSE-এর ঐতিহাসিক প্রাইস অ্যাকশন ও ভলিউম প্যাটার্নের ওপর ট্রেন করা ১৭-ফিচার XGBoost ক্লাসিফায়ার।
            </p>
          </div>
          <div className="p-5 rounded-xl bg-slate-50 border border-slate-200">
            <strong className="text-blue-700 block mb-1.5 text-base">২০-ইন্ডিকেটর কনসেনসাস ফিল্টার</strong>
            <p className="text-slate-600 leading-relaxed">
              SMA, EMA, Wilder RSI(14), MACD, Bollinger Bands, Stochastic, CCI এবং ATR একসাথে যাচাই করে।
            </p>
          </div>
          <div className="p-5 rounded-xl bg-slate-50 border border-slate-200">
            <strong className="text-blue-700 block mb-1.5 text-base">সহজ বাংলায় ট্রেডিং গাইডলাইন</strong>
            <p className="text-slate-600 leading-relaxed">
              বিনিয়োগকারীদের বোঝার সুবিধার্থে জটিল চার্টের পাশাপাশি স্পষ্ট বাংলায় টার্গেট, স্টপ-লস ও করণীয় প্রদান করে।
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}
