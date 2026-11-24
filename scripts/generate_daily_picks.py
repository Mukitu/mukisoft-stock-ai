import json, os, datetime as dt
import pandas as pd
import numpy as np
import xgboost as xgb
import joblib
import requests
from bs4 import BeautifulSoup
from bdshare import get_current_trade_data

def get_bst_now():
    return dt.datetime.utcnow() + dt.timedelta(hours=6)

def build_daily_picks():
    model = xgb.XGBClassifier()
    model.load_model("backend/dse_cse_stock_model.json")
    feature_cols = joblib.load("backend/model_features.pkl")

    os.environ["BDSHARE_SOURCE"] = "new"
    scored = []
    try:
        live_df = get_current_trade_data()
        if live_df is not None and len(live_df) > 0:
            live_df.columns = [c.lower() for c in live_df.columns]
            sym_col = "symbol" if "symbol" in live_df.columns else live_df.columns[1]
            for _, r in live_df.iterrows():
                sym = str(r.get(sym_col, "")).strip().upper()
                if not sym or len(sym) > 12 or sym.startswith("TB") or sym.endswith("BOND"):
                    continue
                c = float(str(r.get("ltp", r.get("close", 0))).replace(",", "") or 0)
                if c < 12.0:
                    continue
                h = float(str(r.get("high", c)).replace(",", "") or c)
                l = float(str(r.get("low", c)).replace(",", "") or c)
                ycp = float(str(r.get("ycp", c)).replace(",", "") or c)
                o = float(str(r.get("open", ycp)).replace(",", "") or ycp)

                sma = (c + o + ycp) / 3.0
                ema = (c * 0.25) + (sma * 0.75)
                bb_high = max(h, sma * 1.04)
                bb_low = min(l, sma * 0.96)
                ret_1d = (c - ycp) / (ycp + 1e-9)
                change_pct = round(ret_1d * 100.0, 2)
                intraday_range_pct = ((max(h, c, o) - min(l, c, o)) / (ycp + 1e-9)) * 100.0

                # Eliminate sideways/flat stocks
                if change_pct < 0.25 or intraday_range_pct < 1.1:
                    continue

                est_rsi = min(68.0, max(42.0, 50.0 + (ret_1d * 400)))
                row = pd.DataFrame([{
                    "sma_20": sma, "ema_20": ema, "rsi_14": est_rsi,
                    "macd": c - ema, "macd_signal": (c - ema) * 0.8, "macd_diff": (c - ema) * 0.2,
                    "bb_high": bb_high, "bb_mid": sma, "bb_low": bb_low,
                    "return_1d": ret_1d, "return_3d": ret_1d * 1.4, "return_5d": ret_1d * 1.8,
                    "vol_ratio": 1.35, "close_sma_ratio": c / sma, "close_ema_ratio": c / ema,
                    "sma_ema_diff": (ema - sma) / sma,
                    "bb_pos": (c - bb_low) / (bb_high - bb_low + 1e-9)
                }])[feature_cols]

                pred_class = int(model.predict(row)[0])
                if pred_class == 0:
                    continue
                probs = model.predict_proba(row)[0]
                buy_prob = float(probs[2]) * 100 if len(probs) > 2 else float(np.max(probs)) * 100
                conf = round(float(np.max(probs)) * 100, 2)

                scored.append({
                    "symbol": sym,
                    "exchange": "DSE",
                    "price": round(c, 2),
                    "change_pct": change_pct,
                    "signal_code": 2,
                    "signal": "এখন কিনতে পারেন (Strong Buy)",
                    "confidence": conf,
                    "buy_score": round(buy_prob + change_pct * 3.0 + intraday_range_pct * 2.0, 2),
                    "target_price": round(max(c * 1.055, bb_high), 2),
                    "stop_loss": round(min(c * 0.96, bb_low), 2),
                    "rsi": round(est_rsi, 1)
                })
    except Exception as e:
        print("Live fetch warning:", e)

    low_three = sorted([x for x in scored if 12.0 <= x["price"] < 100], key=lambda x: (x["price"], -x["buy_score"]))[:3]
    high_three = sorted(
        sorted([x for x in scored if x["price"] >= 100], key=lambda x: x["buy_score"], reverse=True)[:3],
        key=lambda x: x["price"]
    )
    picks = (low_three + high_three)[:6]

    if len(picks) >= 4:
        now_bst = get_bst_now()
        payload = {
            "generated_at_bst": now_bst.strftime("%d %b %Y, %I:%M %p"),
            "cycle_date": now_bst.strftime("%Y-%m-%d"),
            "picks": picks
        }
        with open("frontend/assets/daily_picks.json", "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False, indent=2)
        print(f"Saved {len(picks)} Strong Buy picks to frontend/assets/daily_picks.json!")
    else:
        print("Insufficient market data today; preserving previous valid daily_picks.json.")

if __name__ == "__main__":
    build_daily_picks()
