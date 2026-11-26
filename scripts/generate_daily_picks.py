"""
MukiSoft AI — Daily 3:00 PM BST Strong Buy Picks Generator.
Imports backend/quant_engine.py as the single source of truth.
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
    analyze_ohlcv_dataframe,
    get_bst_now,
    score_snapshot_batch,
    select_genuine_top_picks,
)

OUTPUT_PATH = ROOT_DIR / "public" / "assets" / "daily_picks.json"


def build_daily_picks() -> int:
    os.environ["BDSHARE_SOURCE"] = "new"
    live_df = get_current_trade_data()
    shortlist = score_snapshot_batch(live_df)

    low_cands = [c for c in shortlist if 12.0 <= c["price"] < 100.0][:12]
    high_cands = [c for c in shortlist if c["price"] >= 100.0][:12]

    end_date = dt.date.today()
    start_date = end_date - dt.timedelta(days=100)
    verified = []

    for cand in low_cands + high_cands:
        try:
            hist_df = get_basic_historical_data(str(start_date), str(end_date), cand["symbol"])
            if hist_df is None or len(hist_df) < 20:
                continue
            full = analyze_ohlcv_dataframe(cand["symbol"], "DSE", hist_df.reset_index(), "Daily 3PM 90D Verified")
            if full["signal_code"] == 2 and full["bull_votes"] >= 16 and not full["is_sideways"]:
                verified.append({
                    "symbol": full["symbol"],
                    "exchange": "DSE",
                    "price": full["current_price"],
                    "change_pct": full["change_pct"],
                    "signal_code": full["signal_code"],
                    "ml_signal_code": full["ml_signal_code"],
                    "signal": full["signal"],
                    "confidence": full["confidence"],
                    "buy_score": round(full["confidence"] + full["bull_votes"], 2),
                    "target_price": full["target_price"],
                    "stop_loss": full["stop_loss"],
                    "rsi": full["rsi"],
                    "bull_votes": full["bull_votes"],
                    "is_sideways": full["is_sideways"],
                })
        except Exception as exc:
            print(f"Skipping {cand['symbol']}: {exc}")

    picks = select_genuine_top_picks(verified)
    if not picks:
        print("ERROR: No genuine Strong Buy picks verified today; preserving existing file.")
        return 1

    now_bst = get_bst_now()
    payload = {
        "generated_at_bst": now_bst.strftime("%d %b %Y, %I:%M %p"),
        "cycle_date": now_bst.strftime("%Y-%m-%d"),
        "picks": picks,
    }
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Saved {len(picks)} genuine Strong Buy picks to {OUTPUT_PATH}")
    return 0


if __name__ == "__main__":
    sys.exit(build_daily_picks())
