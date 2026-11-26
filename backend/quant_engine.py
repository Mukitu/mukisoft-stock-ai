"""
MukiSoft AI — Unified Quantitative ML & 20-Indicator Consensus Engine.
Single source of truth imported by both backend/main.py and scripts/generate_daily_picks.py.

Strict Zero-Demo, 100% Real-Time Rules:
- Zero hardcoded/mock/synthetic stocks or fabricated linear RSI/return approximations.
- Strong Buy requires simultaneously:
    1. Genuine XGBoost ML prediction signal_code == 2 (from real 90D computed time-series features)
    2. At least 15 out of 20 bullish technical indicator votes (15/20 to 20/20)
    3. Non-sideways market regime (is_sideways == False)
    4. Active price & momentum (price >= 12.0 BDT, change_pct > 0, volume > 0)
- Never relabels Hold or Sideways stocks into Strong Buy.
"""

from __future__ import annotations

import datetime as dt
import json
import math
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
import xgboost as xgb

BASE_DIR = Path(__file__).resolve().parent
MODEL_PATH = BASE_DIR / "dse_cse_stock_model.json"
FEATURES_PATH = BASE_DIR / "model_features.json"

with FEATURES_PATH.open("r", encoding="utf-8") as _f:
    FEATURE_COLS: list[str] = json.load(_f)

_model = xgb.XGBClassifier()
_model.load_model(str(MODEL_PATH))

SIGNAL_MAP = {
    0: "High Risk / Sell",
    1: "Hold / Wait",
    2: "Strong Buy",
}

MIN_STRONG_BUY_VOTES = 15
MIN_STRONG_BUY_PRICE = 12.0


def get_bst_now() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc) + dt.timedelta(hours=6)


def get_market_cycle_key(now: dt.datetime | None = None) -> str:
    """Resets daily at 3:00 PM (15:00) BST after DSE/CSE 2:30 PM close."""
    current = now or get_bst_now()
    cycle_date = (
        (current - dt.timedelta(days=1)).strftime("%Y-%m-%d")
        if current.hour < 15
        else current.strftime("%Y-%m-%d")
    )
    return f"cycle_{cycle_date}_1500_bst_v3"


def get_bd_market_session(now: dt.datetime | None = None) -> dict[str, Any]:
    """Bangladesh Standard Time (UTC+6) DSE/CSE session schedule."""
    bd_now = now or get_bst_now()
    weekday = bd_now.weekday()  # Mon=0 .. Fri=4, Sat=5, Sun=6
    minutes = bd_now.hour * 60 + bd_now.minute
    is_trading_day = weekday in (6, 0, 1, 2, 3)  # Sun–Thu
    is_live_hours = is_trading_day and (600 <= minutes <= 870)

    if is_live_hours:
        return {
            "is_live": True,
            "mode": "LIVE",
            "badge": "লাইভ মার্কেট চলছে (১০:০০ AM – ২:৩০ PM BST)",
            "headline": "লাইভ টেকনিক্যাল বুলিশ সেটআপ রাডার (Strong Bullish Setup)",
            "subtext": "রিয়েল-টাইম বাজার দর, ১৭-ফিচার XGBoost ML ও ২০-ইন্ডিকেটর কনসেনসাস ভিত্তিক রিয়েল-টাইম AI মার্কেট সিগন্যাল ও প্রযুক্তিগত বিশ্লেষণ",
            "bd_time": bd_now.strftime("%d %b %Y, %I:%M %p"),
        }

    return {
        "is_live": False,
        "mode": "DAILY_LOCK",
        "badge": "৩:০০ PM ডেইলি লক • পরবর্তী সেশন সকাল ১০:০০টা BST",
        "headline": "আগামী কার্যদিবসের Strong Bullish Setup পর্যবেক্ষণ তালিকা",
        "subtext": "সর্বশেষ ক্লোজিং ডেটা ও ২০-ইন্ডিকেটর কনসেনসাস বিশ্লেষণে বাছাইকৃত গবেষণামূলক তালিকা",
        "bd_time": bd_now.strftime("%d %b %Y, %I:%M %p"),
    }


def compute_timeseries_indicators(df: pd.DataFrame) -> pd.DataFrame:
    """
    Compute genuine 17 time-series features required by dse_cse_stock_model.json
    directly from historical OHLCV data without discarding or fabricating metrics.
    """
    data = df.copy()
    data.columns = [str(c).lower().strip() for c in data.columns]

    for col in ("open", "high", "low", "close", "volume"):
        if col in data.columns:
            data[col] = pd.to_numeric(data[col], errors="coerce")

    data = data[data["close"] > 0].copy()
    if "date" in data.columns:
        data = data.sort_values("date").reset_index(drop=True)

    close = data["close"].astype(float)
    volume = (
        data["volume"].fillna(0.0).astype(float)
        if "volume" in data.columns
        else pd.Series(0.0, index=data.index)
    )

    # Moving averages
    data["sma_20"] = close.rolling(window=20, min_periods=1).mean()
    data["ema_20"] = close.ewm(span=20, adjust=False).mean()

    # Wilder RSI (14)
    delta = close.diff()
    gain = delta.clip(lower=0.0)
    loss = (-delta).clip(lower=0.0)
    avg_gain = gain.ewm(alpha=1 / 14, min_periods=1, adjust=False).mean()
    avg_loss = loss.ewm(alpha=1 / 14, min_periods=1, adjust=False).mean()
    rs = avg_gain / avg_loss.replace(0.0, np.nan)
    data["rsi_14"] = (100.0 - (100.0 / (1.0 + rs))).fillna(50.0).clip(0.0, 100.0)

    # MACD (12, 26, 9)
    ema_12 = close.ewm(span=12, adjust=False).mean()
    ema_26 = close.ewm(span=26, adjust=False).mean()
    data["macd"] = ema_12 - ema_26
    data["macd_signal"] = data["macd"].ewm(span=9, adjust=False).mean()
    data["macd_diff"] = data["macd"] - data["macd_signal"]

    # Bollinger Bands (20, 2)
    std_20 = close.rolling(window=20, min_periods=1).std(ddof=0).fillna(close * 0.015)
    std_20 = std_20.where(std_20 > 1e-6, close * 0.015)
    data["bb_mid"] = data["sma_20"]
    data["bb_high"] = data["bb_mid"] + 2.0 * std_20
    data["bb_low"] = data["bb_mid"] - 2.0 * std_20

    # Multi-horizon returns
    data["return_1d"] = close.pct_change(1).fillna(0.0)
    data["return_3d"] = close.pct_change(3).fillna(data["return_1d"])
    data["return_5d"] = close.pct_change(5).fillna(data["return_3d"])

    # Volume ratio against 20-day average volume
    vol_ma_20 = volume.rolling(window=20, min_periods=1).mean()
    data["vol_ratio"] = np.where(vol_ma_20 > 0, volume / vol_ma_20, 1.0)

    # Ratios & BB position
    data["close_sma_ratio"] = close / data["sma_20"].replace(0.0, np.nan)
    data["close_ema_ratio"] = close / data["ema_20"].replace(0.0, np.nan)
    data["sma_ema_diff"] = (data["ema_20"] - data["sma_20"]) / data["sma_20"].replace(0.0, np.nan)
    bb_span = (data["bb_high"] - data["bb_low"]).replace(0.0, np.nan)
    data["bb_pos"] = ((close - data["bb_low"]) / bb_span).fillna(0.5)

    for col in FEATURE_COLS:
        data[col] = (
            pd.to_numeric(data[col], errors="coerce")
            .replace([np.inf, -np.inf], np.nan)
            .fillna(0.0)
        )

    return data


def predict_from_feature_frame(features_df: pd.DataFrame) -> tuple[np.ndarray, np.ndarray]:
    """Vectorized XGBoost prediction returning (predicted_classes, probabilities)."""
    x = features_df[FEATURE_COLS].astype(float)
    preds = _model.predict(x).astype(int)
    probs = _model.predict_proba(x)
    return preds, probs


def evaluate_20_indicator_consensus(
    df: pd.DataFrame,
    ml_signal_code: int,
    ml_confidence: float,
) -> dict[str, Any]:
    """
    Unified 20-indicator quantitative consensus engine synchronized with XGBoost ML.
    Requires ML Strong Buy (signal_code == 2) AND >= 15/20 bullish indicators AND non-sideways
    to emit 'AI টেকনিক্যাল সিগন্যাল: Strong Bullish Setup (গবেষণামূলক পর্যবেক্ষণ)'.
    """
    closes = df["close"].astype(float).tolist()
    highs = df["high"].astype(float).tolist() if "high" in df.columns else closes
    lows = df["low"].astype(float).tolist() if "low" in df.columns else closes
    n = len(closes)
    price = closes[-1]

    recent20 = closes[-20:]
    recent10 = closes[-10:]
    recent5 = closes[-5:]

    sma5 = float(np.mean(recent5))
    sma10 = float(np.mean(recent10))
    sma20 = float(df["sma_20"].iloc[-1])
    ema9 = float(pd.Series(closes).ewm(span=9, adjust=False).mean().iloc[-1])
    ema20 = float(df["ema_20"].iloc[-1])

    rsi14 = float(df["rsi_14"].iloc[-1])
    delta7 = pd.Series(closes).diff()
    g7 = delta7.clip(lower=0.0).ewm(alpha=1 / 7, min_periods=1, adjust=False).mean().iloc[-1]
    l7 = (-delta7).clip(lower=0.0).ewm(alpha=1 / 7, min_periods=1, adjust=False).mean().iloc[-1]
    rsi7 = float(100.0 - (100.0 / (1.0 + (g7 / (l7 if l7 > 1e-9 else 1e-9)))))

    macd_line = float(df["macd"].iloc[-1])
    macd_hist = float(df["macd_diff"].iloc[-1])
    bb_upper = float(df["bb_high"].iloc[-1])
    bb_lower = float(df["bb_low"].iloc[-1])
    bb_pct_b = float(df["bb_pos"].iloc[-1])
    bb_width_pct = ((bb_upper - bb_lower) / max(sma20, 1e-9)) * 100.0

    max20 = max(recent20)
    min20 = min(recent20)
    channel_range_pct = ((max20 - min20) / max(min20, 1e-9)) * 100.0

    high14 = max(highs[-14:])
    low14 = min(lows[-14:])
    stoch_k = ((price - low14) / max(high14 - low14, 1e-9)) * 100.0
    williams_r = -100.0 + stoch_k

    roc3 = ((price - closes[-4]) / closes[-4]) * 100.0 if n >= 4 else float(df["return_1d"].iloc[-1]) * 100.0
    roc5 = ((price - closes[-6]) / closes[-6]) * 100.0 if n >= 6 else roc3
    roc10 = ((price - closes[-11]) / closes[-11]) * 100.0 if n >= 11 else roc5

    std20 = float(np.std(recent20)) if len(recent20) > 1 else price * 0.015
    cci = (price - sma20) / (0.015 * max(std20, 1e-6))

    # True ATR (14)
    tr_values = []
    for i in range(max(1, n - 14), n):
        tr = max(
            highs[i] - lows[i],
            abs(highs[i] - closes[i - 1]),
            abs(lows[i] - closes[i - 1]),
        )
        tr_values.append(tr)
    atr14 = float(np.mean(tr_values)) if tr_values else price * 0.018

    is_sideways = (
        len(recent20) >= 10
        and bb_width_pct < 3.2
        and channel_range_pct < 4.2
        and abs(roc5) < 0.75
    )

    # Support & resistance levels (single source of truth for both cards & report)
    s1 = round(min(min20, price * 0.96), 2)
    if s1 >= price:
        s1 = round(price - max(atr14 * 2.0, price * 0.035), 2)
    s2 = round(max(0.1, s1 - max(atr14 * 1.5, price * 0.03)), 2)

    r1 = round(max(max20, bb_upper, price * 1.045), 2)
    if r1 <= price:
        r1 = round(price + max(atr14 * 2.5, price * 0.045), 2)
    r2 = round(r1 + max(atr14 * 2.0, price * 0.04), 2)

    votes: list[dict[str, Any]] = []

    def cast(name: str, cond: bool, bull_bn: str, bear_bn: str) -> None:
        votes.append({
            "name": name,
            "bullish": bool(cond),
            "label_bn": bull_bn if cond else bear_bn,
        })

    cast("SMA-5", price >= sma5, "SMA-5 বুলিশ", "SMA-5 নিচে")
    cast("SMA-10", price >= sma10, "SMA-10 বুলিশ", "SMA-10 নিচে")
    cast("SMA-20", price >= sma20, "SMA-20 আপট্রেন্ড", "SMA-20 নিচে")
    cast("EMA-9/20", ema9 >= ema20, "EMA-9/20 গোল্ডেন ক্রস", "EMA-9/20 বিয়ারিশ")
    cast("EMA-9", price >= ema9, "EMA-9 সাপোর্ট", "EMA-9 নিচে")
    cast("RSI-14", 44.0 <= rsi14 <= 68.0, f"RSI-14 ({rsi14:.1f}) সুস্থ", f"RSI-14 ({rsi14:.1f}) দুর্বল/ওভারবট")
    cast("RSI-7", 44.0 <= rsi7 <= 72.0, f"RSI-7 ({rsi7:.1f}) পজিটিভ", f"RSI-7 ({rsi7:.1f}) নেগেটিভ")
    cast("MACD Hist", macd_hist >= 0.0, "MACD হিস্টোগ্রাম পজিটিভ", "MACD হিস্টোগ্রাম নেগেটিভ")
    cast("MACD Line", macd_line >= 0.0, "MACD লাইন শূন্যের উপরে", "MACD লাইন নিচে")
    cast("Bollinger %B", 0.25 <= bb_pct_b <= 0.88, "Bollinger ব্যান্ড নিরাপদ জোনে", "Bollinger রেজিস্ট্যান্স চাপ")
    cast("Stochastic %K", 25.0 <= stoch_k <= 85.0, f"Stochastic ({stoch_k:.0f}) পজিটিভ", f"Stochastic ({stoch_k:.0f}) দুর্বল")
    cast("Williams %R", -80.0 <= williams_r <= -15.0, "Williams %R বুলিশ", "Williams %R বিয়ারিশ")
    cast("ROC-3D", roc3 >= -0.3, "৩-দিনের মোমেন্টাম স্থিতিশীল", "৩-দিনের পতন চাপ")
    cast("ROC-5D", roc5 >= -0.6, "৫-দিনের ট্রেন্ড পজিটিভ", "৫-দিনের পুলব্যাক")
    cast("ROC-10D", roc10 >= 0.0, "১০-দিনের রিটার্ন পজিটিভ", "১০-দিনের রিটার্ন নেগেটিভ")
    cast("CCI-20", -20.0 <= cci <= 160.0, "CCI ইন্ডিকেটর বুলিশ", "CCI ইন্ডিকেটর নেগেটিভ")
    cast("Support-1", price >= s1 * 1.01, "সাপোর্ট-১ এর উপরে সুরক্ষিত", "সাপোর্ট ভাঙার ঝুঁকি")
    cast("Resistance Room", price <= r1 * 0.992, "রেজিস্ট্যান্স ব্রেকআউট জায়গা আছে", "রেজিস্ট্যান্সের একদম কাছে")
    cast("XGBoost Signal", ml_signal_code == 2, "XGBoost ML: Strong Buy", "XGBoost ML: সতর্ক/হোল্ড")
    cast("ML Risk Filter", ml_signal_code != 0, "ML রিস্ক ফিল্টার পাস", "ML হাই-রিস্ক সতর্কতা")

    bull_count = sum(1 for v in votes if v["bullish"])
    bear_count = len(votes) - bull_count

    if is_sideways:
        action_type = "SIDEWAYS"
        signal_code = 1
        badge_bn = "AI টেকনিক্যাল সিগন্যাল: Sideways / নিরপেক্ষ (গবেষণামূলক পর্যবেক্ষণ)"
    elif ml_signal_code == 2 and bull_count >= MIN_STRONG_BUY_VOTES:
        action_type = "BUY"
        signal_code = 2
        badge_bn = "AI টেকনিক্যাল সিগন্যাল: Strong Bullish Setup (গবেষণামূলক পর্যবেক্ষণ)"
    elif ml_signal_code == 0 or bear_count >= 12:
        action_type = "SELL"
        signal_code = 0
        badge_bn = "AI টেকনিক্যাল সিগন্যাল: Bearish / উচ্চ-ঝুঁকি সংকেত (সতর্কতামূলক পর্যবেক্ষণ)"
    else:
        action_type = "HOLD"
        signal_code = 1
        badge_bn = "AI টেকনিক্যাল সিগন্যাল: Neutral / Hold জোন (গবেষণামূলক পর্যবেক্ষণ)"

    return {
        "action_type": action_type,
        "signal_code": signal_code,
        "signal": badge_bn,
        "ml_signal_code": ml_signal_code,
        "ml_signal": SIGNAL_MAP.get(ml_signal_code, "Hold / Wait"),
        "confidence": round(ml_confidence, 2),
        "bull_votes": bull_count,
        "bear_votes": bear_count,
        "total_votes": len(votes),
        "votes": votes,
        "is_sideways": is_sideways,
        "target_price": r1,
        "stop_loss": s1,
        "support_resistance": {"s1": s1, "s2": s2, "r1": r1, "r2": r2},
        "indicators": {
            "sma5": round(sma5, 2),
            "sma10": round(sma10, 2),
            "sma20": round(sma20, 2),
            "ema9": round(ema9, 2),
            "ema20": round(ema20, 2),
            "rsi14": round(rsi14, 2),
            "rsi7": round(rsi7, 2),
            "macd": round(macd_line, 4),
            "macd_hist": round(macd_hist, 4),
            "bb_upper": round(bb_upper, 2),
            "bb_lower": round(bb_lower, 2),
            "bb_width_pct": round(bb_width_pct, 2),
            "channel_range_pct": round(channel_range_pct, 2),
            "stoch_k": round(stoch_k, 1),
            "williams_r": round(williams_r, 1),
            "roc3": round(roc3, 2),
            "roc5": round(roc5, 2),
            "roc10": round(roc10, 2),
            "cci": round(cci, 1),
            "atr14": round(atr14, 2),
        },
    }


def analyze_ohlcv_dataframe(
    symbol: str,
    exchange: str,
    df: pd.DataFrame,
    source_label: str = "Real-time Historical OHLCV",
) -> dict[str, Any]:
    """Full synchronized pipeline: genuine indicators -> XGBoost ML -> 20-indicator consensus."""
    enriched_df = compute_timeseries_indicators(df)
    latest_row = enriched_df.iloc[[-1]]
    preds, probs = predict_from_feature_frame(latest_row)
    ml_code = int(preds[0])
    ml_conf = float(np.max(probs[0]) * 100.0)

    consensus = evaluate_20_indicator_consensus(enriched_df, ml_code, ml_conf)
    latest = enriched_df.iloc[-1]
    prev_close = float(enriched_df.iloc[-2]["close"]) if len(enriched_df) >= 2 else float(latest["open"])
    current_price = round(float(latest["close"]), 2)
    change_pct = round(((current_price - prev_close) / max(prev_close, 1e-9)) * 100.0, 2)
    latest_volume = int(max(0.0, float(latest.get("volume", 0.0) or 0.0)))
    vol_ratio = round(float(latest.get("vol_ratio", 1.0) or 1.0), 2)

    tail = enriched_df.tail(60)
    ohlcv_history = []
    for idx, row in tail.iterrows():
        date_val = str(row["date"])[:10] if "date" in row and pd.notna(row["date"]) else (
            dt.date.today() - dt.timedelta(days=len(tail) - int(idx))
        ).isoformat()
        ohlcv_history.append({
            "date": date_val,
            "open": round(float(row["open"]), 2),
            "high": round(float(row["high"]), 2),
            "low": round(float(row["low"]), 2),
            "close": round(float(row["close"]), 2),
            "volume": int(max(0.0, float(row.get("volume", 0.0) or 0.0))),
        })

    return {
        "symbol": symbol,
        "exchange": exchange,
        "current_price": current_price,
        "change_pct": change_pct,
        "volume": latest_volume,
        "vol_ratio": vol_ratio,
        "signal": consensus["signal"],
        "signal_code": consensus["signal_code"],
        "action_type": consensus["action_type"],
        "ml_signal": consensus["ml_signal"],
        "ml_signal_code": consensus["ml_signal_code"],
        "confidence": consensus["confidence"],
        "rsi": consensus["indicators"]["rsi14"],
        "target_price": consensus["target_price"],
        "stop_loss": consensus["stop_loss"],
        "support_resistance": consensus["support_resistance"],
        "bull_votes": consensus["bull_votes"],
        "bear_votes": consensus["bear_votes"],
        "total_votes": consensus["total_votes"],
        "votes": consensus["votes"],
        "is_sideways": consensus["is_sideways"],
        "indicators": consensus["indicators"],
        "chart_history": ohlcv_history,
        "data_source": source_label,
    }


def build_manual_ohlcv_frame(
    open_price: float,
    high_price: float,
    low_price: float,
    close_price: float,
    yesterday_close: float,
    volume: float = 100000.0,
) -> pd.DataFrame:
    """Create a minimal OHLCV frame from verified single-session inputs."""
    ycp = yesterday_close if yesterday_close > 0 else open_price
    today = dt.date.today()
    rows = [
        {
            "date": (today - dt.timedelta(days=1)).isoformat(),
            "open": ycp,
            "high": max(ycp, open_price),
            "low": min(ycp, open_price),
            "close": ycp,
            "volume": volume,
        },
        {
            "date": today.isoformat(),
            "open": open_price,
            "high": high_price,
            "low": low_price,
            "close": close_price,
            "volume": volume,
        },
    ]
    return pd.DataFrame(rows)


def compute_real_buy_score(analysis: dict[str, Any]) -> float:
    """
    Ranks genuine Strong Buy stocks strictly by:
    - Real bullish indicator consensus count (15..20)
    - Real XGBoost ML confidence
    - Real positive intraday momentum & relative volume ratio
    """
    bull_votes = int(analysis.get("bull_votes", 0))
    confidence = float(analysis.get("confidence", 0.0))
    change_pct = max(0.0, float(analysis.get("change_pct", 0.0)))
    vol_ratio = min(4.0, max(0.5, float(analysis.get("vol_ratio", 1.0))))
    return round(bull_votes * 10.0 + confidence + change_pct * 3.0 + vol_ratio * 4.0, 2)


def select_genuine_top_picks(candidates: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """
    Strictly select ONLY genuine Strong Buy stocks passing EVERY real-time filter:
      1. price >= 12.0 BDT, positive intraday momentum (change_pct > 0), non-sideways, volume > 0
      2. ML Strong Buy verdict (ml_signal_code == 2 and signal_code == 2)
      3. 15 to 20 bullish technical indicator votes (15 <= bull_votes <= 20)
      4. Never relabels Hold/Sideways stocks and never excludes genuine consecutive-day top stocks.
    Selects up to 3 lowest-priced (12–99.99 BDT) + up to 3 mid/large-cap (>= 100 BDT),
    ranked from highest bullish indicator count & buying momentum downward.
    """
    genuine = [
        c for c in candidates
        if int(c.get("signal_code", 1)) == 2
        and int(c.get("ml_signal_code", 1)) == 2
        and not bool(c.get("is_sideways", False))
        and MIN_STRONG_BUY_VOTES <= int(c.get("bull_votes", 0)) <= 20
        and float(c.get("price", 0.0)) >= MIN_STRONG_BUY_PRICE
        and float(c.get("change_pct", 0.0)) > 0.0
        and float(c.get("volume", 1.0)) > 0.0
    ]

    def rank_key(item: dict[str, Any]) -> tuple[int, float, float, float]:
        return (
            -int(item.get("bull_votes", 0)),
            -float(item.get("buy_score", 0.0)),
            -float(item.get("vol_ratio", 1.0)),
            -float(item.get("change_pct", 0.0)),
        )

    low_three = sorted(
        [c for c in genuine if MIN_STRONG_BUY_PRICE <= float(c["price"]) < 100.0],
        key=rank_key,
    )[:3]

    high_three = sorted(
        [c for c in genuine if float(c["price"]) >= 100.0],
        key=rank_key,
    )[:3]

    return low_three + high_three


def rank_active_market_candidates(live_df: pd.DataFrame) -> list[dict[str, Any]]:
    """
    Pure real-time market liquidity & momentum pre-filter on the live DSE trade board.
    Zero fabricated linear RSI/MACD approximations — strictly filters active stocks
    with price >= 12 BDT, positive intraday momentum (change_pct > 0), and active volume,
    then hands them to full 90-day historical OHLCV XGBoost + 20-indicator verification.
    """
    if live_df is None or len(live_df) == 0:
        return []

    df = live_df.copy()
    df.columns = [str(c).lower().strip() for c in df.columns]
    sym_col = "symbol" if "symbol" in df.columns else df.columns[1]

    active_candidates: list[dict[str, Any]] = []

    for _, r in df.iterrows():
        sym = str(r.get(sym_col, "")).strip().upper()
        if not sym or len(sym) > 15 or sym.startswith("TB") or sym.endswith("BOND"):
            continue
        try:
            ltp = float(str(r.get("ltp", r.get("close", 0))).replace(",", "") or 0)
            if ltp < MIN_STRONG_BUY_PRICE or not math.isfinite(ltp):
                continue
            ycp = float(str(r.get("ycp", ltp)).replace(",", "") or ltp)
            high_p = float(str(r.get("high", ltp)).replace(",", "") or ltp)
            low_p = float(str(r.get("low", ltp)).replace(",", "") or ltp)
            vol = float(str(r.get("volume", 0)).replace(",", "") or 0)
            value_mn = float(str(r.get("value", 0)).replace(",", "") or 0)
        except ValueError:
            continue

        if ycp <= 0 or vol <= 0:
            continue

        change_pct = ((ltp - ycp) / ycp) * 100.0
        intraday_range = ((max(high_p, ltp) - min(low_p, ltp)) / ycp) * 100.0
        if change_pct <= 0.0:
            continue

        # Pure real-time liquidity + momentum priority score for 90D verification queue
        liquidity_momentum_score = (
            change_pct * 4.0
            + intraday_range * 1.2
            + math.log10(max(vol, 10.0)) * 3.0
            + math.log10(max(value_mn + 1.0, 1.0)) * 2.5
        )
        active_candidates.append({
            "symbol": sym,
            "price": round(ltp, 2),
            "change_pct": round(change_pct, 2),
            "volume": int(vol),
            "liquidity_score": round(liquidity_momentum_score, 2),
        })

    active_candidates.sort(key=lambda x: x["liquidity_score"], reverse=True)
    return active_candidates
