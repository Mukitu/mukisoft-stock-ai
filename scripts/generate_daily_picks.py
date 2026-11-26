"""
MukiSoft AI — Daily 3:00 PM BST Real-Time Strong Buy Picks Generator.
Imports backend/quant_engine.py as the single source of truth.
Zero demo/fallback stocks: writes strictly verified 90D real-time Strong Buy picks
(ML signal_code == 2, 15..20/20 bullish votes, non-sideways, price >= 12 BDT,
change_pct > 0, active volume > 0).
"""

from __future__ import annotations

import datetime as dt
import json
import os
import sys
from pathlib import Path

from bdshare import get_basic_historical_data, get_current_trade_data

ROOT_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT_DIR / "backend"))

from quant_engine import (  # noqa: E402
    MIN_STRONG_BUY_PRICE,
    MIN_STRONG_BUY_VOTES,
    analyze_ohlcv_dataframe,
    compute_real_buy_score,
    get_bst_now,
    rank_active_market_candidates,
    select_genuine_top_picks,
)

OUTPUT_PATH = ROOT_DIR / "public" / "assets" / "daily_picks.json"


def build_daily_picks() -> int:
    os.environ["BDSHARE_SOURCE"] = "new"
    live_df = get_current_trade_data()
    if live_df is None or len(live_df) == 0:
        print("ERROR: Live DSE trade board unavailable; aborting without writing fake picks.")
        return 1

    shortlist = rank_active_market_candidates(live_df)
    low_cands = [c for c in shortlist if MIN_STRONG_BUY_PRICE <= c["price"] < 100.0][:25]
    high_cands = [c for c in shortlist if c["price"] >= 100.0][:25]

    end_date = dt.date.today()
    start_date = end_date - dt.timedelta(days=100)
    verified = []

    for cand in low_cands + high_cands:
        try:
            hist_df = get_basic_historical_data(str(start_date), str(end_date), cand["symbol"])
            if hist_df is None or len(hist_df) < 20:
                continue
            full = analyze_ohlcv_dataframe(
                cand["symbol"], "DSE", hist_df.reset_index(), "Daily 3PM 90D Verified"
            )
            if (
                full["signal_code"] == 2
                and full["ml_signal_code"] == 2
                and full["bull_votes"] >= MIN_STRONG_BUY_VOTES
                and not full["is_sideways"]
                and full["current_price"] >= MIN_STRONG_BUY_PRICE
                and full["change_pct"] > 0.0
                and full["volume"] > 0
            ):
                verified.append({
                    "symbol": full["symbol"],
                    "exchange": "DSE",
                    "price": full["current_price"],
                    "change_pct": full["change_pct"],
                    "volume": full["volume"],
                    "vol_ratio": full["vol_ratio"],
                    "signal_code": full["signal_code"],
                    "ml_signal_code": full["ml_signal_code"],
                    "signal": full["signal"],
                    "confidence": full["confidence"],
                    "buy_score": compute_real_buy_score(full),
                    "target_price": full["target_price"],
                    "stop_loss": full["stop_loss"],
                    "rsi": full["rsi"],
                    "bull_votes": full["bull_votes"],
                    "total_votes": full["total_votes"],
                    "is_sideways": full["is_sideways"],
                })
        except Exception as exc:
            print(f"Skipping {cand['symbol']}: {exc}")

    picks = select_genuine_top_picks(verified)
    now_bst = get_bst_now()
    payload = {
        "schema_version": 2,
        "generated_at_bst": now_bst.strftime("%d %b %Y, %I:%M %p"),
        "cycle_date": now_bst.strftime("%Y-%m-%d"),
        "picks": picks,
    }
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Saved {len(picks)} genuine real-time Strong Buy picks to {OUTPUT_PATH}")
    return 0


if __name__ == "__main__":
    sys.exit(build_daily_picks())
