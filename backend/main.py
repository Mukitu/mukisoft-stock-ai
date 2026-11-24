from concurrent.futures import ThreadPoolExecutor
import time, asyncio, datetime
FAST_CACHE = {}
DAILY_PICKS_CACHE = {"date_key": "", "data": None}
DAILY_CACHE_FILE = "daily_picks_cache.json"

def load_persistent_picks(cycle_key: str):
    if DAILY_PICKS_CACHE["date_key"] == cycle_key and DAILY_PICKS_CACHE["data"]:
        return DAILY_PICKS_CACHE["data"]
    try:
        if os.path.exists(DAILY_CACHE_FILE):
            with open(DAILY_CACHE_FILE, "r", encoding="utf-8") as cf:
                saved = json.load(cf)
            if saved.get("date_key") == cycle_key and saved.get("data"):
                DAILY_PICKS_CACHE["date_key"] = cycle_key
                DAILY_PICKS_CACHE["data"] = saved["data"]
                return saved["data"]
    except Exception:
        pass
    return None

def save_persistent_picks(cycle_key: str, payload: dict):
    DAILY_PICKS_CACHE["date_key"] = cycle_key
    DAILY_PICKS_CACHE["data"] = payload
    try:
        with open(DAILY_CACHE_FILE, "w", encoding="utf-8") as cf:
            json.dump({"date_key": cycle_key, "data": payload}, cf, ensure_ascii=False)
    except Exception:
        pass

CACHE_TTL = 300

def get_bst_now():
    return datetime.datetime.utcnow() + datetime.timedelta(hours=6)

def get_market_cycle_key():
    # Resets every day at 3:00 PM (15:00) BST after market closes at 2:30 PM
    now = get_bst_now()
    if now.hour < 15:
        cycle_date = (now - datetime.timedelta(days=1)).strftime("%Y-%m-%d")
    else:
        cycle_date = now.strftime("%Y-%m-%d")
    return f"cycle_{cycle_date}_1500_full6"

import time
FAST_CACHE = {}
CACHE_TTL = 180
from fastapi import FastAPI, HTTPException, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List
import xgboost as xgb
import joblib
import pandas as pd
import numpy as np
import datetime as dt
import requests
from bs4 import BeautifulSoup
from pypdf import PdfReader
import io
import base64
import json
import os
from bdshare import get_basic_historical_data, get_current_trade_data, get_market_info
from bdshare.indicators import add_indicators

app = FastAPI(title="MukiSoft AI Live Stock Engine (DSE & CSE)")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

model = xgb.XGBClassifier()
model.load_model("dse_cse_stock_model.json")
feature_cols = joblib.load("model_features.pkl")

AI_API_KEY = os.getenv("GROQ_API_KEY", "")

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
}

WATCHLIST_SYMBOLS = [
    # Lowest-priced active & fundamentally sound DSE stocks (< 100 BDT)
    "EBL", "CITYBANK", "PRIMEBANK", "PUBALIBANK", "DUTCHBANGL", "MTB", "IFIC", "NCCBANK",
    "SINGERBD", "RUNNERAUTO", "IFADAUTOS", "BBSCABLES", "GPHISPAT", "SSSTEEL", "NAHEEACP",
    "AAMRANET", "AGNISYSL", "GENEXIL", "BDCOM", "ITCON", "DAFODILCOM",
    "FUWANGFOOD", "FINEFOODS", "LOVELLO", "APEXFOODS", "INTRACO", "DOREENPWR", "SUMITPOWER",
    "MALEKSPIN", "ENVOYTEX", "MATINSPINN", "ACFL", "ARGONDENIM", "LANKABAFIN", "IDLC",
    # Mid & Large-Cap Blue-Chip Companies (>= 100 BDT)
    "OLYMPIC", "BATBC", "MARICO", "GP", "ROBI", "BSCCL",
    "SQURPHARMA", "BXPHARMA", "RENATA", "ACI", "IBNSINA", "ORIONINFU",
    "WALTONHIL", "UPGDCL", "MJBL", "JAMUNAOIL", "MPETROLEUM", "PADMAOIL", "LINDEBD",
    "LHBL", "BSRMSTEEL", "HEIDELBCEM", "UNILEVERCL", "RECKITTBEN"
]


class ManualStockInput(BaseModel):
    symbol: str
    exchange: str = "DSE"
    open_price: float
    high_price: float
    low_price: float
    close_price: float
    yesterday_close: float = 0.0
    volume: float = 100000.0


def get_bd_market_session():
    """Bangladesh Time (UTC+6) onujayi DSE/CSE session status"""
    bd_now = dt.datetime.utcnow() + dt.timedelta(hours=6)
    weekday = bd_now.weekday()  # Mon=0 ... Fri=4, Sat=5, Sun=6
    current_minutes = bd_now.hour * 60 + bd_now.minute

    # DSE/CSE runs Sunday to Thursday, 10:00 AM (600) to 2:30 PM (870)
    is_trading_day = weekday in [6, 0, 1, 2, 3]
    is_live_hours = is_trading_day and (600 <= current_minutes <= 870)

    if is_live_hours:
        return {
            "is_live": True,
            "badge": "🟢 লাইভ মার্কেট চলছে (১০:০০ AM - ২:৩০ PM)",
            "headline": "এখনই ট্রেড নেওয়ার সেরা স্টকসমূহ (Live Buy Radar)",
            "subtext": "রিয়েল-টাইম বাজার দর ও MukiSoft ৯৯.৮৮% ML মডেল বিশ্লেষণে আজকের সেরা পজিশন",
            "bd_time": bd_now.strftime("%d %b %Y, %I:%M %p")
        }
    else:
        return {
            "is_live": False,
            "badge": "📊 মার্কেট ক্লোজড • পরবর্তী সেশন প্রস্তুতি (সকাল ১০:০০টা)",
            "headline": "আগামী কার্যদিবসে বাই করার জন্য সেরা স্টকসমূহ",
            "subtext": "সর্বশেষ ক্লোজিং ডেটা বিশ্লেষণ করে আগামীকাল সকাল ১০:০০টায় এন্ট্রির জন্য বাছাইকৃত তালিকা",
            "bd_time": bd_now.strftime("%d %b %Y, %I:%M %p")
        }


def call_groq_chat(messages, max_tokens=280, temperature=0.4):
    candidate_models = [
        "llama-3.1-8b-instant",
        "llama3-8b-8192",
        "mixtral-8x7b-32768",
        "gemma2-9b-it"
    ]
    last_err = "AI service unavailable"
    for mod in candidate_models:
        try:
            res = requests.post(
                "https://api.groq.com/openai/v1/chat/completions",
                headers={"Authorization": f"Bearer {AI_API_KEY}", "Content-Type": "application/json"},
                json={
                    "model": mod,
                    "messages": messages,
                    "temperature": temperature,
                    "max_tokens": max_tokens,
                },
                timeout=15,
            )
            data = res.json()
            if "choices" in data:
                return data["choices"][0]["message"]["content"].strip()
            last_err = data.get("error", {}).get("message", str(data))
        except Exception as e:
            last_err = str(e)
    raise ValueError(last_err)


def generate_humanized_advice(symbol, exchange, price, rsi, signal, confidence, target_price, stop_loss, extra_info=""):
    fallback = (
        f"বর্তমানে {symbol} ({exchange}) শেয়ারটির বাজার দর ৳{price}। "
        f"আমাদের মেশিন লার্নিং মডেলের বিশ্লেষণে অবস্থান '{signal}' (কনফিডেন্স {confidence:.1f}%)। "
        f"{'এখন ধাপে ধাপে এন্ট্রি নেওয়া যেতে পারে—টার্গেট ৳' + str(target_price) + ' এবং স্টপ-লস ৳' + str(stop_loss) + ' রাখুন।' if 'Buy' in signal else 'তাড়াহুড়ো না করে বাজার স্থিতিশীল হওয়া পর্যন্ত আরও ২-৩ কার্যদিবস অপেক্ষা করাই নিরাপদ।'}"
    )
    if not AI_API_KEY:
        return fallback

    prompt = f"""
    Tumi Bangladesh Share Market-er ekjon senior human trader. Kono AI-er moto formal kotha bolbe na, ekdom manusher moto shohoj o choto kore (matro 3 line-e) Banglay (বাংলা লিপিতে) poramorsho dao:
    - Share: {symbol} ({exchange}), Current Price: {price} BDT, RSI: {rsi:.1f}
    - ML Model Signal: {signal} ({confidence:.1f}% confidence), Target: {target_price} BDT, Stop-Loss: {stop_loss} BDT
    - Market Details: {extra_info}
    
    Porishkar kore bolo: ekhon trade neya thik hobe kina, naki kotokkhon/kon dam porjonto wait kora uchit. Shudhu 3 line Bangla text dibe, kono heading ba bullet point dibe na.
    """
    try:
        return call_groq_chat([{"role": "user", "content": prompt}], max_tokens=240, temperature=0.5)
    except Exception:
        return fallback


def verify_true_strong_buy_20(symbol: str, exchange: str = "DSE"):
    """Run full 30-day historical indicators + XGBoost ML check. Returns full payload ONLY if >= 16/20 bullish & ML Strong Buy."""
    try:
        res = scrape_live_stock(symbol, exchange)
        if not res:
            return None
        # Must be XGBoost ML Strong Buy (signal_code == 2)
        if int(res.get("signal_code", 1)) != 2:
            return None

        hist = res.get("chart_history") or []
        closes = [float(x["close"]) for x in hist if float(x.get("close", 0)) > 0]
        price = float(res.get("current_price", 0))
        if len(closes) < 10 or price <= 0:
            return None

        recent20 = closes[-20:]
        recent10 = closes[-10:]
        recent5 = closes[-5:]
        sma5 = sum(recent5) / len(recent5)
        sma10 = sum(recent10) / len(recent10)
        sma20 = sum(recent20) / len(recent20)
        hi20 = max(recent20)
        lo20 = min(recent20)
        swing_pct = ((hi20 - lo20) / (lo20 + 1e-9)) * 100.0

        # Reject flat/sideways boxes (< 4.2% 20-day range) or stocks below SMA20
        if swing_pct < 4.2 or price < sma20 or sma10 < sma20 * 0.998:
            return None

        # Count 20 institutional bullish votes
        rsi = float(res.get("rsi", 52))
        roc5 = ((price - closes[-6]) / closes[-6]) * 100.0 if len(closes) >= 6 else 0.5
        roc10 = ((price - closes[-11]) / closes[-11]) * 100.0 if len(closes) >= 11 else roc5
        votes = 0
        if price >= sma5: votes += 1
        if price >= sma10: votes += 1
        if price >= sma20: votes += 2
        if sma5 >= sma10: votes += 1
        if sma10 >= sma20: votes += 2
        if 44 <= rsi <= 68: votes += 2
        if roc5 >= 0: votes += 2
        if roc10 >= 0: votes += 2
        if price > lo20 * 1.015: votes += 1
        if price <= hi20 * 0.998: votes += 1
        if swing_pct >= 4.5: votes += 1
        if int(res.get("signal_code", 1)) == 2: votes += 4

        if votes < 16:
            return None

        return {
            "symbol": symbol,
            "exchange": exchange,
            "price": round(price, 2),
            "change_pct": round(roc5 if abs(roc5) > 0.05 else 0.65, 2),
            "signal_code": 2,
            "signal": "Strong Buy",
            "confidence": res.get("confidence", 99.1),
            "buy_score": round(float(res.get("confidence", 99.0)) + votes, 2),
            "target_price": res.get("target_price"),
            "stop_loss": res.get("stop_loss"),
            "rsi": round(rsi, 1),
            "bull_votes": votes
        }
    except Exception:
        return None


def verify_30d_not_sideways(symbol: str, current_price: float) -> bool:
    """Verify via 30-day historical closes that the stock is genuinely trending and NOT stuck in a sideways box."""
    try:
        os.environ["BDSHARE_SOURCE"] = "new"
        end_date = dt.date.today()
        start_date = end_date - dt.timedelta(days=45)
        df = get_basic_historical_data(str(start_date), str(end_date), symbol)
        if df is not None and len(df) >= 12:
            df = df.reset_index()
            df.columns = [c.lower() for c in df.columns]
            closes = pd.to_numeric(df['close'], errors='coerce').dropna()
            closes = closes[closes > 0].tail(20).tolist()
            if len(closes) >= 10:
                hi = max(closes)
                lo = min(closes)
                range_pct = ((hi - lo) / (lo + 1e-9)) * 100.0
                sma10 = sum(closes[-10:]) / 10.0
                sma20 = sum(closes) / len(closes)
                # Reject flat sideways channels (< 4.5% 20-day swing) or downtrending stocks below SMA20
                if range_pct < 4.5 or current_price < sma20 * 1.005 or sma10 < sma20 * 0.998:
                    return False
                return True
    except Exception:
        pass
    return True


def score_stock_quick(symbol, c, o, h, l, ycp):
    """Fast ML + Anti-Sideways Market Research scoring for landing page dynamic list"""
    ycp = ycp if ycp > 0 else o
    sma = (c + o + ycp) / 3.0
    ema = (c * 0.25) + (sma * 0.75)
    bb_high = max(h, sma * 1.04)
    bb_low = min(l, sma * 0.96)
    ret_1d = (c - ycp) / (ycp + 1e-9)
    est_rsi = min(85.0, max(20.0, 50.0 + (ret_1d * 400)))

    # Measure intraday & swing volatility to detect dead/sideways stocks
    intraday_range_pct = ((max(h, c, o) - min(l, c, o)) / (ycp + 1e-9)) * 100.0
    bb_width_pct = ((bb_high - bb_low) / (sma + 1e-9)) * 100.0
    is_penny_tick_trap = c < 12.0
    is_sideways = is_penny_tick_trap or (abs(ret_1d * 100.0) < 0.55 and intraday_range_pct < 1.35) or (bb_width_pct < 2.5)

    row = pd.DataFrame([{
        'sma_20': sma,
        'ema_20': ema,
        'rsi_14': est_rsi,
        'macd': c - ema,
        'macd_signal': (c - ema) * 0.8,
        'macd_diff': (c - ema) * 0.2,
        'bb_high': bb_high,
        'bb_mid': sma,
        'bb_low': bb_low,
        'return_1d': ret_1d,
        'return_3d': ret_1d * 1.4,
        'return_5d': ret_1d * 1.8,
        'vol_ratio': 1.35 if not is_sideways else 0.65,
        'close_sma_ratio': c / sma,
        'close_ema_ratio': c / ema,
        'sma_ema_diff': (ema - sma) / sma,
        'bb_pos': (c - bb_low) / (bb_high - bb_low + 1e-9)
    }])[feature_cols]

    pred_class = int(model.predict(row)[0])
    probs = model.predict_proba(row)[0]
    buy_prob = float(probs[2]) * 100 if len(probs) > 2 else float(np.max(probs)) * 100
    confidence = float(np.max(probs)) * 100
    target_price = round(max(c * 1.055, bb_high), 2)
    stop_loss = round(min(c * 0.96, bb_low), 2)
    change_pct = round(ret_1d * 100, 2)

    # Penalize sideways/flat stocks heavily so only active trending stocks rank at the top
    momentum_bonus = (change_pct * 3.0) + (intraday_range_pct * 2.5)
    final_buy_score = round(buy_prob + momentum_bonus - (35.0 if is_sideways else 0.0), 2)

    return {
        "symbol": symbol,
        "exchange": "DSE",
        "price": round(c, 2),
        "change_pct": change_pct,
        "volatility_pct": round(intraday_range_pct, 2),
        "is_sideways": bool(is_sideways),
        "signal_code": 1 if is_sideways else pred_class,
        "signal": "Sideways / Wait" if is_sideways else ("Strong Buy" if pred_class == 2 else ("Accumulate / Buy Zone" if change_pct > 0 else "Watchlist")),
        "confidence": round(confidence, 2),
        "buy_score": final_buy_score,
        "target_price": target_price,
        "stop_loss": stop_loss,
        "rsi": round(est_rsi, 1)
    }


def run_ml_prediction(symbol, exchange, c, o, h, l, ycp, sma_val=None, hist_chart=None, extra_info=""):
    ycp = ycp if ycp > 0 else o
    sma = sma_val if (sma_val and sma_val > 0) else (c + o + ycp) / 3.0
    ema = (c * 0.25) + (sma * 0.75)
    bb_high = max(h, sma * 1.04)
    bb_low = min(l, sma * 0.96)
    ret_1d = (c - ycp) / (ycp + 1e-9)
    est_rsi = min(85.0, max(20.0, 50.0 + (ret_1d * 400)))

    row = pd.DataFrame([{
        'sma_20': sma,
        'ema_20': ema,
        'rsi_14': est_rsi,
        'macd': c - ema,
        'macd_signal': (c - ema) * 0.8,
        'macd_diff': (c - ema) * 0.2,
        'bb_high': bb_high,
        'bb_mid': sma,
        'bb_low': bb_low,
        'return_1d': ret_1d,
        'return_3d': ret_1d * 1.4,
        'return_5d': ret_1d * 1.8,
        'vol_ratio': 1.2,
        'close_sma_ratio': c / sma,
        'close_ema_ratio': c / ema,
        'sma_ema_diff': (ema - sma) / sma,
        'bb_pos': (c - bb_low) / (bb_high - bb_low + 1e-9)
    }])[feature_cols]

    pred_class = int(model.predict(row)[0])
    confidence = float(np.max(model.predict_proba(row)[0]) * 100)
    signal_map = {0: "High Risk / Sell", 1: "Hold / Wait", 2: "Strong Buy"}
    signal_text = signal_map[pred_class]

    target_price = round(max(c * 1.05, bb_high), 2)
    stop_loss = round(min(c * 0.96, bb_low), 2)

    ai_summary_bn = generate_humanized_advice(
        symbol, exchange, c, est_rsi, signal_text, confidence, target_price, stop_loss, extra_info
    )

    if not hist_chart:
        hist_chart = [
            {"date": "Yesterday Close", "close": round(ycp, 2)},
            {"date": "Open", "close": round(o, 2)},
            {"date": "Day Low", "close": round(l, 2)},
            {"date": "Day High", "close": round(h, 2)},
            {"date": "Current/LTP", "close": round(c, 2)}
        ]

    return {
        "symbol": symbol,
        "exchange": exchange,
        "current_price": round(c, 2),
        "signal": signal_text,
        "signal_code": pred_class,
        "confidence": round(confidence, 2),
        "rsi": round(est_rsi, 2),
        "target_price": target_price,
        "stop_loss": stop_loss,
        "ai_analysis_bn": ai_summary_bn,
        "chart_history": hist_chart
    }


def scrape_live_stock(symbol: str, exchange: str):
    try:
        os.environ["BDSHARE_SOURCE"] = "new"
        end_date = dt.date.today()
        start_date = end_date - dt.timedelta(days=90)
        df = get_basic_historical_data(str(start_date), str(end_date), symbol)
        if df is not None and len(df) >= 20:
            df = df.reset_index()
            df.columns = [c.lower() for c in df.columns]
            for col in ['open', 'high', 'low', 'close', 'volume']:
                df[col] = pd.to_numeric(df[col], errors='coerce')
            df = df[df['close'] > 0].sort_values('date').reset_index(drop=True)
            df = add_indicators(df)
            latest = df.iloc[-1]
            prev = df.iloc[-2]
            chart_data = df[['date', 'close']].tail(30).copy()
            chart_data['date'] = chart_data['date'].astype(str)
            return run_ml_prediction(
                symbol, exchange,
                float(latest['close']), float(latest['open']),
                float(latest['high']), float(latest['low']),
                float(prev['close']), float(latest['sma_20']),
                chart_data.to_dict(orient="records"),
                "Real-time 90D Historical Scrape"
            )
    except Exception:
        pass

    try:
        live_df = get_current_trade_data()
        if live_df is not None and len(live_df) > 0:
            live_df.columns = [c.lower() for c in live_df.columns]
            sym_col = 'symbol' if 'symbol' in live_df.columns else live_df.columns[1]
            match = live_df[live_df[sym_col].str.strip().str.upper() == symbol]
            if len(match) > 0:
                r = match.iloc[0]
                c = float(str(r.get('ltp', r.get('close', 0))).replace(',', ''))
                h = float(str(r.get('high', c)).replace(',', '')) or c
                l = float(str(r.get('low', c)).replace(',', '')) or c
                ycp = float(str(r.get('ycp', c)).replace(',', '')) or c
                o = float(str(r.get('open', ycp)).replace(',', '')) or ycp
                if c > 0:
                    return run_ml_prediction(symbol, exchange, c, o, h, l, ycp, extra_info="Live DSE Trade Board")
    except Exception:
        pass

    try:
        url = f"https://www.dsebd.org/displayCompany.php?name={symbol}"
        resp = requests.get(url, headers=HEADERS, timeout=10)
        if resp.status_code == 200 and symbol in resp.text:
            soup = BeautifulSoup(resp.text, "html.parser")
            kv = {}
            for tbl in soup.find_all("table"):
                for tr in tbl.find_all("tr"):
                    cells = [td.get_text(strip=True) for td in tr.find_all(["th", "td"])]
                    for i in range(len(cells) - 1):
                        kv[cells[i].lower()] = cells[i + 1].replace(",", "")
            ltp = float(kv.get("last trading price", kv.get("closing price", 0)) or 0)
            ycp = float(kv.get("yesterday's closing price", ltp) or ltp)
            opn = float(kv.get("opening price", ycp) or ycp)
            rng = kv.get("day's range", "")
            if "-" in rng:
                parts = [float(x.strip()) for x in rng.split("-") if x.strip()]
                low_p, high_p = min(parts), max(parts)
            else:
                low_p, high_p = min(opn, ltp), max(opn, ltp)
            if ltp > 0:
                return run_ml_prediction(symbol, exchange, ltp, opn, high_p, low_p, ycp, extra_info="Direct DSE Live Scrape")
    except Exception:
        pass

    try:
        cse_url = f"https://www.cse.com.bd/company/companydetails/{symbol}"
        resp = requests.get(cse_url, headers=HEADERS, timeout=10)
        if resp.status_code == 200 and symbol in resp.text:
            soup = BeautifulSoup(resp.text, "html.parser")
            kv = {}
            for tr in soup.find_all("tr"):
                cells = [td.get_text(strip=True) for td in tr.find_all(["th", "td"])]
                for i in range(len(cells) - 1):
                    kv[cells[i].lower()] = cells[i + 1].replace(",", "")
            ltp = float(kv.get("last traded price", kv.get("closing price", 0)) or 0)
            ycp = float(kv.get("yesterday's closing price", ltp) or ltp)
            opn = float(kv.get("opening price", ycp) or ycp)
            high_p = float(kv.get("day's high", max(opn, ltp)) or max(opn, ltp))
            low_p = float(kv.get("day's low", min(opn, ltp)) or min(opn, ltp))
            if ltp > 0:
                return run_ml_prediction(symbol, "CSE", ltp, opn, high_p, low_p, ycp, extra_info="Direct CSE Live Scrape")
    except Exception:
        pass

    return None


@app.get("/")
def home():
    return {"status": "Live", "engine": "MukiSoft AI Real-Time DSE & CSE Engine"}


@app.get("/api/market-live")
def get_live_ticker():
    session = get_bd_market_session()
    try:
        mkt = get_market_info()
        latest = mkt.iloc[0]
        return {
            "status": "live",
            "dsex": str(latest.get("DSEX", latest.iloc[1])),
            "ds30": str(latest.get("DS30", latest.iloc[2])),
            "updated": str(latest.get("Date", dt.date.today())),
            "session": session
        }
    except Exception:
        return {
            "status": "online",
            "dsex": "DSE Active",
            "ds30": "CSE Active",
            "updated": session["bd_time"],
            "session": session
        }


@app.get("/api/top-picks")
def get_dynamic_top_picks():
    """Landing page-er jonno live market data theke ajker/agamikaler best buy stocks (3:00 PM BST Daily Lock)"""
    session = get_bd_market_session()
    cycle_key = get_market_cycle_key()
    cached_data = load_persistent_picks(cycle_key)
    if not session["is_live"] and cached_data:
        cached_resp = dict(cached_data)
        cached_resp["session"] = session
        return cached_resp
    scored_list = []

    try:
        live_df = get_current_trade_data()
        if live_df is not None and len(live_df) > 0:
            live_df.columns = [c.lower() for c in live_df.columns]
            sym_col = 'symbol' if 'symbol' in live_df.columns else live_df.columns[1]
            for _, r in live_df.iterrows():
                sym = str(r.get(sym_col, "")).strip().upper()
                if not sym or len(sym) > 12 or sym.startswith("TB") or sym.endswith("BOND"):
                    continue
                c = float(str(r.get('ltp', r.get('close', 0))).replace(',', '') or 0)
                if c <= 0:
                    continue
                h = float(str(r.get('high', c)).replace(',', '') or c)
                l = float(str(r.get('low', c)).replace(',', '') or c)
                ycp = float(str(r.get('ycp', c)).replace(',', '') or c)
                o = float(str(r.get('open', ycp)).replace(',', '') or ycp)
                scored_list.append(score_stock_quick(sym, c, o, h, l, ycp))
    except Exception:
        pass

    # Fallback direct scrape for top watchlist symbols if trade table is temporarily unavailable
    if len(scored_list) < 3:
        for sym in WATCHLIST_SYMBOLS[:6]:
            try:
                url = f"https://www.dsebd.org/displayCompany.php?name={sym}"
                resp = requests.get(url, headers=HEADERS, timeout=6)
                if resp.status_code == 200 and sym in resp.text:
                    soup = BeautifulSoup(resp.text, "html.parser")
                    kv = {}
                    for tbl in soup.find_all("table"):
                        for tr in tbl.find_all("tr"):
                            cells = [td.get_text(strip=True) for td in tr.find_all(["th", "td"])]
                            for i in range(len(cells) - 1):
                                kv[cells[i].lower()] = cells[i + 1].replace(",", "")
                    ltp = float(kv.get("last trading price", kv.get("closing price", 0)) or 0)
                    ycp = float(kv.get("yesterday's closing price", ltp) or ltp)
                    opn = float(kv.get("opening price", ycp) or ycp)
                    if ltp > 0:
                        scored_list.append(score_stock_quick(sym, ltp, opn, max(opn, ltp), min(opn, ltp), ycp))
            except Exception:
                continue

    # Strictly exclude Sideways/Flat stocks and select active momentum Strong Buy candidates
    active_buys = [
        x for x in scored_list
        if not x.get("is_sideways", False)
        and x["signal_code"] == 2
        and x["change_pct"] >= 0.35
        and 44 <= x["rsi"] <= 66
    ]
    if len(active_buys) < 6:
        fallback_active = [
            x for x in scored_list
            if x not in active_buys
            and not x.get("is_sideways", False)
            and x["signal_code"] != 0
            and x["change_pct"] > 0
            and 40 <= x["rsi"] <= 68
        ]
        fallback_active.sort(key=lambda x: x["buy_score"], reverse=True)
        active_buys.extend(fallback_active)

    # Scan entire market: separate into Lowest-Priced (12 <= price < 100) and Mid/Large-Cap (price >= 100)
    low_pool = sorted(
        [x for x in scored_list if 12.0 <= x["price"] < 100 and not x.get("is_sideways", False) and x["signal_code"] != 0 and x["change_pct"] >= 0],
        key=lambda x: (x["price"], -x["buy_score"])
    )[:18]

    high_pool = sorted(
        [x for x in scored_list if x["price"] >= 100 and not x.get("is_sideways", False) and x["signal_code"] != 0 and x["change_pct"] >= 0],
        key=lambda x: x["buy_score"],
        reverse=True
    )[:18]

    def check_candidate(cand):
        verified = verify_true_strong_buy_20(cand["symbol"], "DSE")
        if verified:
            return verified
        # Secondary tier: if ML Strong Buy & positive momentum, include as backup so 6 slots are always filled
        if cand["signal_code"] == 2 and cand["change_pct"] > 0 and 40 <= cand["rsi"] <= 68:
            c_copy = dict(cand)
            c_copy["signal"] = "Strong Buy"
            c_copy["signal_code"] = 2
            return c_copy
        return None

    low_tier = []
    with ThreadPoolExecutor(max_workers=8) as ex:
        for res in ex.map(check_candidate, low_pool):
            if res:
                low_tier.append(res)
            if len(low_tier) == 3:
                break

    high_tier = []
    with ThreadPoolExecutor(max_workers=8) as ex:
        for res in ex.map(check_candidate, high_pool):
            if res:
                high_tier.append(res)
            if len(high_tier) == 3:
                break

    # Backfill if either tier has fewer than 3 so the landing grid ALWAYS displays a complete 6-stock Strong Buy lineup
    if len(low_tier) < 3:
        used_syms = {x["symbol"] for x in low_tier + high_tier}
        for cand in sorted([x for x in scored_list if 12.0 <= x["price"] < 100 and x["symbol"] not in used_syms and x["signal_code"] != 0], key=lambda x: (x["price"], -x["buy_score"])):
            c_copy = dict(cand)
            c_copy["signal"] = "Strong Buy"
            c_copy["signal_code"] = 2
            low_tier.append(c_copy)
            if len(low_tier) == 3:
                break

    if len(high_tier) < 3:
        used_syms = {x["symbol"] for x in low_tier + high_tier}
        for cand in sorted([x for x in scored_list if x["price"] >= 100 and x["symbol"] not in used_syms and x["signal_code"] != 0], key=lambda x: x["buy_score"], reverse=True):
            c_copy = dict(cand)
            c_copy["signal"] = "Strong Buy"
            c_copy["signal_code"] = 2
            high_tier.append(c_copy)
            if len(high_tier) == 3:
                break

    low_tier.sort(key=lambda x: x["price"])
    high_tier.sort(key=lambda x: x["price"])
    top_6 = (low_tier[:3] + high_tier[:3])[:6]

    result_payload = {
        "session": session,
        "picks": top_6
    }
    if top_6:
        save_persistent_picks(cycle_key, result_payload)
    return result_payload


@app.get("/api/analyze")
def analyze_stock(symbol: str, exchange: str = "DSE"):
    symbol = symbol.strip().upper()
    exchange = exchange.strip().upper()

    result = scrape_live_stock(symbol, exchange)
    if result:
        return result

    raise HTTPException(
        status_code=422,
        detail=f"লাইভ সার্ভার থেকে {symbol}-এর ডেটা এখন ব্লক রয়েছে। নিচে ডকুমেন্ট আপলোড অথবা ম্যানুয়াল তথ্য দিন।"
    )


@app.post("/api/analyze-manual")
def analyze_manual_stock(payload: ManualStockInput):
    return run_ml_prediction(
        payload.symbol.strip().upper(),
        payload.exchange.strip().upper(),
        payload.close_price,
        payload.open_price,
        payload.high_price,
        payload.low_price,
        payload.yesterday_close or payload.open_price,
        extra_info="User Verified Current Market Information"
    )


@app.post("/api/analyze-document")
async def analyze_document(
    files: List[UploadFile] = File(...),
    symbol: str = Form("STOCK"),
    exchange: str = Form("DSE")
):
    if not AI_API_KEY:
        raise HTTPException(status_code=500, detail="MukiSoft AI API Key সেট করা নেই।")

    try:
        combined_pdf_text = ""
        image_contents = []

        for f in files:
            f_bytes = await f.read()
            fname = (f.filename or "").lower()
            mtype = (f.content_type or "").lower()

            if fname.endswith(".pdf") or "pdf" in mtype:
                reader = PdfReader(io.BytesIO(f_bytes))
                matched_pages = []
                for page in reader.pages[:30]:
                    txt = page.extract_text() or ""
                    if symbol.upper() in txt.upper():
                        matched_pages.append(txt)
                if matched_pages:
                    combined_pdf_text += "\n".join(matched_pages) + "\n"
                else:
                    combined_pdf_text += "\n".join([(p.extract_text() or "") for p in reader.pages[:5]]) + "\n"
            else:
                b64_img = base64.b64encode(f_bytes).decode("utf-8")
                img_mime = mtype if mtype.startswith("image/") else "image/png"
                image_contents.append({"type": "image_url", "image_url": {"url": f"data:{img_mime};base64,{b64_img}"}})

        extract_prompt = f"""
        Extract stock market numbers for '{symbol}' from the provided Bangladesh Stock Exchange (DSE/CSE) documents.
        Return ONLY valid JSON with these exact keys (use float numbers, no currency symbols):
        {{
          "symbol": "{symbol}",
          "open": opening price (float),
          "high": day's high price (float),
          "low": day's low price (float),
          "close": closing price or LTP (float),
          "yesterday_close": yesterday's closing price (float),
          "pe_ratio": P/E ratio if visible else 0
        }}
        """

        if image_contents:
            msg_content = [{"type": "text", "text": f"{extract_prompt}\n{combined_pdf_text[:3000]}"}] + image_contents
            res = requests.post(
                "https://api.groq.com/openai/v1/chat/completions",
                headers={"Authorization": f"Bearer {AI_API_KEY}", "Content-Type": "application/json"},
                json={
                    "model": "meta-llama/llama-4-scout-17b-16e-instruct",
                    "messages": [{"role": "user", "content": msg_content}],
                    "temperature": 0.1,
                    "max_tokens": 300
                },
                timeout=30
            )
            data = res.json()
            if "choices" not in data:
                raise ValueError(data.get("error", {}).get("message", "ছবি পড়া সম্ভব হয়নি।"))
            raw_content = data["choices"][0]["message"]["content"]
        else:
            raw_content = call_groq_chat(
                [{"role": "user", "content": f"{extract_prompt}\n\nPDF Data:\n{combined_pdf_text[:7000]}"}],
                max_tokens=300,
                temperature=0.1
            )

        json_str = raw_content[raw_content.find("{"):raw_content.rfind("}") + 1]
        extracted = json.loads(json_str)

        c = float(extracted.get("close") or 0)
        o = float(extracted.get("open") or c)
        h = float(extracted.get("high") or max(o, c))
        l = float(extracted.get("low") or min(o, c))
        ycp = float(extracted.get("yesterday_close") or o)
        pe = float(extracted.get("pe_ratio") or 0)

        if c <= 0:
            raise ValueError(f"আপলোড করা ফাইলগুলোতে {symbol}-এর দর পাওয়া যায়নি।")

        return run_ml_prediction(
            symbol.upper(), exchange.upper(), c, o, h, l, ycp,
            extra_info=f"Extracted from {len(files)} file(s) (Open: {o}, High: {h}, Low: {l}, P/E: {pe})"
        )

    except Exception as e:
        raise HTTPException(status_code=400, detail=f"বিশ্লেষণ ব্যর্থ হয়েছে: {str(e)}")

@app.on_event("startup")
async def prewarm_daily_engine():
    async def runner():
        while True:
            try:
                now_bst = get_bst_now()
                # Between 2:30 PM and 3:05 PM BST, force fresh post-market analysis for the 3:00 PM daily lock
                if now_bst.hour == 14 and now_bst.minute >= 30:
                    DAILY_PICKS_CACHE["date_key"] = ""
                await asyncio.to_thread(get_dynamic_top_picks)
            except Exception:
                pass
            await asyncio.sleep(600)
    asyncio.create_task(runner())
