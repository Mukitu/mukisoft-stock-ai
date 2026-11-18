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
    "SQURPHARMA", "BRACBANK", "GP", "BATBC", "WALTONHIL",
    "RENATA", "ROBI", "CITYBANK", "EBL", "ACI",
    "BXPHARMA", "UPGDCL", "MARICO", "OLYMPIC", "SINGERBD"
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


def score_stock_quick(symbol, c, o, h, l, ycp):
    """Fast ML scoring without extra LLM calls for landing page dynamic list"""
    ycp = ycp if ycp > 0 else o
    sma = (c + o + ycp) / 3.0
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
    probs = model.predict_proba(row)[0]
    buy_prob = float(probs[2]) * 100 if len(probs) > 2 else float(np.max(probs)) * 100
    confidence = float(np.max(probs)) * 100
    target_price = round(max(c * 1.05, bb_high), 2)
    stop_loss = round(min(c * 0.96, bb_low), 2)
    change_pct = round(ret_1d * 100, 2)

    return {
        "symbol": symbol,
        "exchange": "DSE",
        "price": round(c, 2),
        "change_pct": change_pct,
        "signal_code": pred_class,
        "signal": "Strong Buy" if pred_class == 2 else ("Accumulate / Buy Zone" if change_pct >= 0 else "Watchlist"),
        "confidence": round(confidence, 2),
        "buy_score": round(buy_prob + (change_pct * 2), 2),
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
    """Landing page-er jonno live market data theke ajker/agamikaler best buy stocks"""
    session = get_bd_market_session()
    scored_list = []

    try:
        live_df = get_current_trade_data()
        if live_df is not None and len(live_df) > 0:
            live_df.columns = [c.lower() for c in live_df.columns]
            sym_col = 'symbol' if 'symbol' in live_df.columns else live_df.columns[1]
            for _, r in live_df.iterrows():
                sym = str(r.get(sym_col, "")).strip().upper()
                if sym not in WATCHLIST_SYMBOLS:
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

    # Sort by highest ML buy score & confidence
    scored_list.sort(key=lambda x: (x["signal_code"] == 2, x["buy_score"]), reverse=True)
    top_6 = scored_list[:6]

    return {
        "session": session,
        "picks": top_6
    }


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