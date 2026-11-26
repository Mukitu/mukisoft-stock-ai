import { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import type { StockAnalysis } from '../../types/market';
import { buildStructuredBanglaReport } from '../../utils/quantConsensus';

export function BanglaReportCard({
  analysis,
  showVotesByDefault = true,
}: {
  analysis: StockAnalysis;
  showVotesByDefault?: boolean;
}) {
  const [showVotes, setShowVotes] = useState(showVotesByDefault);
  const report = buildStructuredBanglaReport(analysis);

  return (
    <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2 pb-4 border-b border-slate-100">
        <div>
          <div className="text-xs font-semibold text-blue-700">MukiSoft AI ২০-ইন্ডিকেটর কনসেনসাস রিপোর্ট</div>
          <h2 className="text-lg font-bold text-slate-900 mt-0.5">{report.decisionTitle}</h2>
        </div>
        <div className="text-xs text-slate-500 font-mono-num">
          {analysis.bull_votes}/{analysis.total_votes} বুলিশ · {analysis.bear_votes}/{analysis.total_votes} সতর্ক
        </div>
      </div>

      <p className="text-sm sm:text-base text-slate-700 leading-relaxed">{report.decisionSummary}</p>

      <ul className="space-y-3 text-sm text-slate-700 leading-relaxed list-disc pl-5">
        <li>
          <strong className="text-slate-900">মার্কেট ট্রেন্ড ও গতিবিধি:</strong> {report.trendNote}{' '}
          {report.momentumNote}
        </li>
        <li>
          <strong className="text-slate-900">গুরুত্বপূর্ণ সাপোর্ট ও রেজিস্ট্যান্স:</strong>{' '}
          <span className="font-mono-num">{report.supportResistanceNote}</span>
        </li>
        <li>
          <strong className="text-slate-900">সাম্প্রতিক লেনদেনের চিত্র:</strong>{' '}
          <span className="font-mono-num">{report.recentRangeNote}</span>
        </li>
        <li>
          <strong className="text-slate-900">করণীয় ও ঝুঁকি ব্যবস্থাপনা:</strong> {report.actionNote}
        </li>
      </ul>

      {report.extraObservation && (
        <div className="pt-4 border-t border-slate-100 text-sm text-slate-700 leading-relaxed">
          <div className="text-xs font-semibold text-slate-500 mb-1">বিশেষ বাজার পর্যবেক্ষণ</div>
          <p>{report.extraObservation}</p>
        </div>
      )}

      {/* Expandable 20-Indicator Breakdown Matrix */}
      <div className="pt-4 border-t border-slate-100">
        <button
          type="button"
          onClick={() => setShowVotes((prev) => !prev)}
          className="inline-flex items-center gap-2 text-xs font-semibold text-blue-700 hover:text-blue-800 cursor-pointer"
        >
          <span>২০টি টেকনিক্যাল ইন্ডিকেটর ও XGBoost ভোটের বিস্তারিত তালিকা</span>
          {showVotes ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>

        {showVotes && (
          <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
            {analysis.votes.map((v) => (
              <div
                key={v.name}
                className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg border border-slate-200 bg-slate-50 text-xs"
              >
                <span className="font-medium text-slate-800 truncate">{v.label_bn}</span>
                <span
                  className={`font-semibold shrink-0 ${
                    v.bullish ? 'text-emerald-700' : 'text-rose-700'
                  }`}
                >
                  {v.bullish ? 'বুলিশ' : 'দুর্বল'}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
