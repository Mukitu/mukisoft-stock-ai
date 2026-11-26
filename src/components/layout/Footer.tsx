import { Link } from 'react-router-dom';

export function Footer() {
  return (
    <footer className="border-t border-slate-200 bg-white py-8 text-xs text-slate-500">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col md:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <img
            src="/assets/logo.svg"
            alt="MukiSoft AI"
            referrerPolicy="no-referrer"
            className="h-7 w-auto"
          />
          <span>
            © 2026 <strong className="text-slate-900 font-semibold">MukiSoft Technology</strong> · Founded by Mukitu Islam Nishat
          </span>
        </div>

        <div className="flex flex-col md:items-end gap-1.5 text-center md:text-right">
          <div className="flex flex-wrap items-center justify-center md:justify-end gap-x-4 gap-y-1 font-medium text-slate-600">
            <Link to="/analyzer" className="hover:text-blue-700 transition-colors">
              AI অ্যানালাইজার
            </Link>
            <Link to="/market" className="hover:text-blue-700 transition-colors">
              মার্কেট চার্ট
            </Link>
            <Link to="/about" className="hover:text-blue-700 transition-colors">
              আমাদের সম্পর্কে
            </Link>
            <Link to="/contact" className="hover:text-blue-700 transition-colors">
              যোগাযোগ
            </Link>
            <Link to="/risk-disclosure" className="text-blue-700 hover:underline font-semibold">
              বিনিয়োগ ঝুঁকি ও নীতিমালা
            </Link>
          </div>
          <p className="text-[11px] text-slate-400">
            সতর্কীকরণ (Self-Risk): MukiSoft Stock AI কোনো BSEC-নিবন্ধিত ব্রোকারেজ হাউজ বা আর্থিক উপদেষ্টা নয়; এটি একটি রিয়েল-টাইম AI মার্কেট সিগন্যাল ও প্রযুক্তিগত বিশ্লেষণ প্ল্যাটফর্ম।
          </p>
        </div>
      </div>
    </footer>
  );
}
