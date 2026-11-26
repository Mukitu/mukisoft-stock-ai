export function DisclaimerPage() {
  return (
    <main className="max-w-4xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-12 flex-1">
      <div className="bg-white border border-slate-200 rounded-2xl p-8 md:p-10 space-y-6">
        <div className="border-b border-slate-200 pb-5 space-y-1.5">
          <div className="text-xs font-semibold text-amber-700">
            বিনিয়োগ ঝুঁকি সতর্কতা ও স্বচ্ছতা নীতিমালা · সর্বশেষ হালনাগাদ ২০২৬
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900">
            বিনিয়োগ ঝুঁকি সতর্কতা ও ব্যবহারের নীতিমালা
          </h1>
          <p className="text-xs text-slate-500">MukiSoft Technology · DSE &amp; CSE Quantitative Research Platform</p>
        </div>

        <div className="space-y-4 text-sm text-slate-700 leading-relaxed">
          <div className="p-5 rounded-xl bg-slate-50 border border-slate-200 space-y-1.5">
            <h2 className="font-bold text-slate-900">১. কোনো সরাসরি বিনিয়োগ পরামর্শ নয়</h2>
            <p>
              <strong className="text-slate-900">MukiSoft AI</strong> একটি ডেটা-ভিত্তিক কোয়ান্টিটেটিভ রিসার্চ ও প্রযুক্তিগত
              বিশ্লেষণ টুল মাত্র। এই প্ল্যাটফর্মে প্রদর্শিত কোনো সিগন্যাল (Strong Buy, Hold, Sell, Sideways), টার্গেট প্রাইস
              বা এআই মন্তব্যকে কোনোভাবেই সরাসরি শেয়ার ক্রয়-বিক্রয়ের প্ররোচনা বা আর্থিক পরামর্শ (Financial Advice) হিসেবে গণ্য করা যাবে না।
            </p>
          </div>

          <div className="p-5 rounded-xl bg-slate-50 border border-slate-200 space-y-1.5">
            <h2 className="font-bold text-slate-900">২. পুঁজিবাজারের ঝুঁকি ও আর্থিক দায়ভার</h2>
            <p>
              ঢাকা স্টক এক্সচেঞ্জ (DSE) ও চট্টগ্রাম স্টক এক্সচেঞ্জ (CSE)-এ বিনিয়োগ সর্বদা বাজারগত ঝুঁকির অধীন। অতীতের ডেটা বা
              গাণিতিক মডেলের ফলাফল ভবিষ্যতের শতভাগ মুনাফার নিশ্চয়তা প্রদান করে না। এই ওয়েবসাইটের তথ্য ব্যবহার করে কোনো বিনিয়োগকারী
              আর্থিকভাবে ক্ষতিগ্রস্ত হলে <strong className="text-slate-900">MukiSoft Technology</strong> বা এর নির্মাতা{' '}
              <strong className="text-slate-900">মুকিতু ইসলাম নিশাত (Mukitu Islam Nishat)</strong> কোনোভাবেই দায়ী থাকবেন না।
            </p>
          </div>

          <div className="p-5 rounded-xl bg-slate-50 border border-slate-200 space-y-1.5">
            <h2 className="font-bold text-slate-900">৩. নিজ দায়িত্বে সিদ্ধান্ত গ্রহণ</h2>
            <p>
              যেকোনো শেয়ারে অর্থ বিনিয়োগের পূর্বে অনুগ্রহ করে কোম্পানির মৌলভিত্তি (Fundamentals), নিরীক্ষিত আর্থিক প্রতিবেদন এবং
              বাংলাদেশ সিকিউরিটিজ অ্যান্ড এক্সচেঞ্জ কমিশন (BSEC) অনুমোদিত ব্রোকারেজ বা বিশেষজ্ঞের পরামর্শ নিয়ে নিজ দায়িত্বে সিদ্ধান্ত গ্রহণ করুন।
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}
