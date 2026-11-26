import { useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { Menu, X } from 'lucide-react';
import { getBdappsSession, isSessionActive } from '../../services/bdappsService';

const PRIMARY_LINKS = [
  { to: '/', label: 'হোম' },
  { to: '/analyzer', label: 'AI অ্যানালাইজার' },
  { to: '/market', label: 'মার্কেট চার্ট' },
  { to: '/about', label: 'আমাদের সম্পর্কে' },
  { to: '/contact', label: 'যোগাযোগ' },
];

export function Navbar() {
  const [mobileOpen, setMobileOpen] = useState(false);
  // Subscribe to route transitions so active BDApps session state reflects immediately
  useLocation();
  const hasActiveSubscription = isSessionActive(getBdappsSession());

  return (
    <header className="sticky top-0 z-40 w-full max-w-full bg-white/95 backdrop-blur-md border-b border-slate-200">
      <div className="max-w-7xl w-full mx-auto px-3 sm:px-6 lg:px-8 h-14 sm:h-16 flex items-center justify-between gap-3 lg:gap-8 min-w-0">
        {/* Zone 1: Single Brand Lockup */}
        <Link to="/" className="flex items-center shrink-0 min-w-0 max-w-[75%]" aria-label="MukiSoft AI Home">
          <img
            src="/assets/logo.svg"
            alt="MukiSoft AI"
            referrerPolicy="no-referrer"
            className="h-8 sm:h-9 w-auto max-w-full"
          />
        </Link>

        {/* Zone 2: Clean Single-Line Nav Links */}
        <nav className="hidden lg:flex items-center gap-7 text-sm font-medium text-slate-600" aria-label="Main Navigation">
          {PRIMARY_LINKS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                `whitespace-nowrap shrink-0 py-1 transition-colors border-b-2 ${
                  isActive
                    ? 'text-blue-700 border-blue-700 font-semibold'
                    : 'text-slate-600 border-transparent hover:text-slate-900 hover:border-slate-300'
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>

        {/* Zone 3: Single Primary Action */}
        <div className="hidden lg:flex items-center gap-4 shrink-0">
          {hasActiveSubscription ? (
            <Link
              to="/dashboard"
              className="px-4 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-semibold transition-colors whitespace-nowrap shrink-0"
            >
              সাবস্ক্রাইবার ড্যাশবোর্ড
            </Link>
          ) : (
            <Link
              to="/analyzer"
              className="px-4 py-2 rounded-lg bg-blue-700 hover:bg-blue-800 text-white text-sm font-semibold transition-colors whitespace-nowrap shrink-0"
            >
              স্টক বিশ্লেষণ করুন
            </Link>
          )}
        </div>

        {/* Mobile Drawer Toggle */}
        <button
          type="button"
          onClick={() => setMobileOpen((prev) => !prev)}
          aria-expanded={mobileOpen}
          aria-label="Toggle navigation menu"
          className="lg:hidden inline-flex items-center justify-center w-11 h-11 rounded-lg border border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
        >
          {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>
      </div>

      {/* Mobile Navigation Drawer */}
      {mobileOpen && (
        <div className="lg:hidden bg-white border-t border-slate-200 px-4 py-4 space-y-1.5 shadow-sm">
          {PRIMARY_LINKS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              onClick={() => setMobileOpen(false)}
              className={({ isActive }) =>
                `block px-3.5 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-blue-50 text-blue-700 font-semibold'
                    : 'text-slate-700 hover:bg-slate-50'
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
          <NavLink
            to="/disclaimer"
            onClick={() => setMobileOpen(false)}
            className={({ isActive }) =>
              `block px-3.5 py-2.5 rounded-lg text-sm font-medium ${
                isActive ? 'bg-blue-50 text-blue-700 font-semibold' : 'text-slate-700 hover:bg-slate-50'
              }`
            }
          >
            ঝুঁকি সতর্কতা ও নীতিমালা
          </NavLink>

          <div className="pt-3 mt-2 border-t border-slate-200">
            {hasActiveSubscription ? (
              <Link
                to="/dashboard"
                onClick={() => setMobileOpen(false)}
                className="block w-full text-center px-4 py-2.5 rounded-lg bg-emerald-700 text-white text-sm font-semibold"
              >
                সাবস্ক্রাইবার ড্যাশবোর্ড
              </Link>
            ) : (
              <Link
                to="/analyzer"
                onClick={() => setMobileOpen(false)}
                className="block w-full text-center px-4 py-2.5 rounded-lg bg-blue-700 text-white text-sm font-semibold"
              >
                স্টক বিশ্লেষণ করুন
              </Link>
            )}
          </div>
        </div>
      )}
    </header>
  );
}
