import { useMarketLive } from '../../hooks/useMarketQueries';
import { getBDMarketSession } from '../../utils/bdMarketSession';

export function MarketTickerBar() {
  const { data } = useMarketLive();
  const session = data?.session || getBDMarketSession();

  return (
    <div className="w-full max-w-full overflow-x-hidden bg-slate-900 text-slate-200 text-[11px] sm:text-xs border-b border-slate-800">
      <div className="max-w-7xl w-full mx-auto px-3 sm:px-6 lg:px-8 py-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 min-w-0">
        <div className="flex flex-wrap items-center gap-x-3 sm:gap-x-5 gap-y-1 min-w-0 max-w-full">
          <span className="inline-flex items-center gap-1.5 font-medium text-slate-100 min-w-0">
            {session.is_live ? (
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shrink-0" aria-hidden="true" />
            ) : (
              <span className="w-2 h-2 rounded-full bg-amber-400 shrink-0" aria-hidden="true" />
            )}
            <span className="truncate max-w-[200px] sm:max-w-none">{session.badge}</span>
          </span>
          <span className="text-slate-400 hidden sm:inline" aria-hidden="true">
            ·
          </span>
          <span className="text-slate-300 shrink-0">
            DSEX:{' '}
            <strong className="font-mono-num text-white font-semibold">
              {data ? data.dsex : 'লোড হচ্ছে...'}
            </strong>
          </span>
          <span className="text-slate-300 hidden sm:inline shrink-0">
            DS30:{' '}
            <strong className="font-mono-num text-white font-semibold">
              {data ? data.ds30 : 'লোড হচ্ছে...'}
            </strong>
          </span>
        </div>

        <div className="hidden md:flex items-center gap-3 text-slate-400 shrink-0">
          <span>সময় (BST):</span>
          <span className="font-mono-num text-slate-200">{data?.updated || session.bd_time}</span>
          <span aria-hidden="true">·</span>
          <span>DSE &amp; CSE</span>
        </div>
      </div>
    </div>
  );
}
