from fastapi import FastAPI, HTTPException, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
import xgboost as xgb
import joblib
import pandas as pd
import numpy as np
import datetime as dt
import requests
import base64
import json
import os
from bdshare import get_basic_historical_data, get_market_info
from bdshare.indicators import add_indicators

os.environ["BDSHARE_SOURCE"] = "legacy"

app = FastAPI(title="MukiSoft AI Stock Engine (DSE & CSE)")

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


def generate_humanized_advice(symbol, exchange, price, rsi, signal, confidence, target_price, stop_loss, extra_info=""):
    if not AI_API_KEY:
        raise HTTPException(status_code=500, detail="MukiSoft AI API Key সেট করা নেই।")

    prompt = f"""
    Tumi Bangladesh Share Market-er ekjon senior human trader. Kono AI-er moto formal kotha bolbe na, ekdom manusher moto shohoj o choto kore (matro 3-4 line-e) Banglay (বাংলা লিপিতে) poramorsho dao:
    - Share: {symbol} ({exchange}), Current/Close Price: {price} BDT, RSI: {rsi:.1f}
    - Signal: {signal} ({confidence:.0f}% confidence), Target: {target_price} BDT, Stop-Loss: {stop_loss} BDT
    - Extra Market Info: {extra_info}
    
    Porishkar kore bolo: ekhon trade neya thik hobe kina, naki kotokkhon/kon dam porjonto wait kora uchit. Shudhu 3-4 line Bangla text dibe, kono heading ba bullet point dibe na.
    """

    res = requests.post(
        "https://api.groq.com/openai/v1/chat/completions",
        headers={"Authorization": f"Bearer {AI_API_KEY}", "Content-Type": "application/json"},
        json={
            "model": "llama-3.3-70b-versatile",
            "messages": [{"role": "user", "content": prompt}],
            "temperature": 0.5,
            "max_tokens": 250,
        },
        timeout=15,
    )
    return res.json()["choices"][0]["message"]["content"].strip()


@app.get("/")
def home():
    return {"status": "Live", "engine": "MukiSoft AI Vision & Quantitative Engine"}


@app.get("/api/market-live")
def get_live_ticker():
    try:
        mkt = get_market_info()
        latest = mkt.iloc[0]
        return {
            "status": "live",
            "dsex": str(latest.get("DSEX", latest.iloc[1])),
            "ds30": str(latest.get("DS30", latest.iloc[2])),
            "updated": str(latest.get("Date", dt.date.today()))
        }
    except Exception as e:
        raise HTTPException(status_code=503, detail=str(e))


@app.get("/api/analyze")
def analyze_stock(symbol: str, exchange: str = "DSE"):
    symbol = symbol.strip().upper()
    exchange = exchange.strip().upper()

    try:
        end_date = dt.date.today()
        start_date = end_date - dt.timedelta(days=90)
        df = get_basic_historical_data(str(start_date), str(end_date), symbol)

        if df is None or len(df) < 25:
            raise ValueError("Live scraping blocked")

        df = df.reset_index()
        df.columns = [c.lower() for c in df.columns]
        for col in ['open', 'high', 'low', 'close', 'volume']:
            df[col] = pd.to_numeric(df[col], errors='coerce')
        df = df[df['close'] > 0].sort_values('date').reset_index(drop=True)

        df = add_indicators(df)
        df['return_1d'] = df['close'].pct_change(1)
        df['return_3d'] = df['close'].pct_change(3)
        df['return_5d'] = df['close'].pct_change(5)
        df['vol_ratio'] = df['volume'] / (df['volume'].rolling(10).mean() + 1e-9)
        df['close_sma_ratio'] = df['close'] / df['sma_20']
        df['close_ema_ratio'] = df['close'] / df['ema_20']
        df['sma_ema_diff'] = (df['ema_20'] - df['sma_20']) / (df['sma_20'] + 1e-9)
        df['bb_pos'] = (df['close'] - df['bb_low']) / (df['bb_high'] - df['bb_low'] + 1e-9)

        df.replace([np.inf, -np.inf], np.nan, inplace=True)
        df.dropna(inplace=True)

        latest = df.iloc[-1:]
        X_live = latest[feature_cols]

        pred_class = int(model.predict(X_live)[0])
        confidence = float(np.max(model.predict_proba(X_live)[0]) * 100)
        signal_map = {0: "High Risk / Sell", 1: "Hold / Wait", 2: "Strong Buy"}
        signal_text = signal_map[pred_class]

        current_price = float(latest['close'].values[0])
        rsi_val = float(latest['rsi_14'].values[0])
        target_price = round(max(current_price * 1.05, float(latest['bb_high'].values[0])), 2)
        stop_loss = round(min(current_price * 0.96, float(latest['bb_low'].values[0])), 2)

        ai_summary_bn = generate_humanized_advice(
            symbol, exchange, current_price, rsi_val, signal_text, confidence, target_price, stop_loss
        )

        chart_data = df[['date', 'close']].tail(30).copy()
        chart_data['date'] = chart_data['date'].astype(str)

        return {
            "mode": "auto",
            "symbol": symbol,
            "exchange": exchange,
            "current_price": current_price,
            "signal": signal_text,
            "signal_code": pred_class,
            "confidence": round(confidence, 2),
            "rsi": round(rsi_val, 2),
            "target_price": target_price,
            "stop_loss": stop_loss,
            "ai_analysis_bn": ai_summary_bn,
            "chart_history": chart_data.to_dict(orient="records")
        }

    except Exception:
        raise HTTPException(
            status_code=422,
            detail=f"অটো-ফেচ সীমাবদ্ধ ({symbol})। নিচের লিংক থেকে একটি স্ক্রিনশট আপলোড করুন।"
        )


@app.post("/api/analyze-screenshot")
async def analyze_screenshot(
    file: UploadFile = File(...),
    symbol: str = Form("STOCK"),
    exchange: str = Form("DSE")
):
    """DSE ba CSE company page-er screenshot theke Vision AI diye number ber kore XGBoost model-e check"""
    if not AI_API_KEY:
        raise HTTPException(status_code=500, detail="MukiSoft AI API Key কনফিগার করা নেই।")

    try:
        img_bytes = await file.read()
        b64_img = base64.b64encode(img_bytes).decode("utf-8")
        mime_type = file.content_type or "image/png"

        # Step 1: Vision AI extracts exact numbers from DSE/CSE screenshot
        extract_prompt = """
        Extract stock market numbers from this Dhaka/Chittagong Stock Exchange (DSE/CSE) screenshot.
        Return ONLY valid JSON with these exact keys (use float numbers, no currency text):
        {
          "symbol": "company trading code if visible else null",
          "open": opening price (float),
          "high": day's high price from Day's Range (float),
          "low": day's low price from Day's Range (float),
          "close": closing price or current/LTP price (float),
          "yesterday_close": yesterday's closing price (float),
          "volume": day's volume (float),
          "pe_ratio": P/E ratio if visible else 0
        }
        """

        vision_res = requests.post(
            "https://api.groq.com/openai/v1/chat/completions",
            headers={"Authorization": f"Bearer {AI_API_KEY}", "Content-Type": "application/json"},
            json={
                "model": "llama-3.2-90b-vision-preview",
                "messages": [
                    {
                        "role": "user",
                        "content": [
                            {"type": "text", "text": extract_prompt},
                            {"type": "image_url", "image_url": {"url": f"data:{mime_type};base64,{b64_img}"}}
                        ]
                    }
                ],
                "temperature": 0.1,
                "max_tokens": 300
            },
            timeout=20
        )

        raw_content = vision_res.json()["choices"][0]["message"]["content"]
        # JSON clean kora
        json_str = raw_content[raw_content.find("{"):raw_content.rfind("}") + 1]
        extracted = json.loads(json_str)

        detected_symbol = (extracted.get("symbol") or symbol).strip().upper()
        c = float(extracted.get("close") or 0)
        o = float(extracted.get("open") or c)
        h = float(extracted.get("high") or max(o, c))
        l = float(extracted.get("low") or min(o, c))
        ycp = float(extracted.get("yesterday_close") or o)
        pe = float(extracted.get("pe_ratio") or 0)

        if c <= 0:
            raise ValueError("স্ক্রিনশট থেকে শেয়ারের দাম পড়া সম্ভব হয়নি। পরিষ্কার স্ক্রিনশট দিন।")

        # Technical indicator estimation for XGBoost model
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
        confidence = float(np.max(model.predict_proba(row)[0]) * 100)
        signal_map = {0: "High Risk / Sell", 1: "Hold / Wait", 2: "Strong Buy"}
        signal_text = signal_map[pred_class]

        target_price = round(max(c * 1.05, bb_high), 2)
        stop_loss = round(min(c * 0.96, bb_low), 2)

        ai_summary_bn = generate_humanized_advice(
            detected_symbol, exchange.upper(), c, est_rsi, signal_text, confidence, target_price, stop_loss,
            extra_info=f"Open: {o}, High: {h}, Low: {l}, P/E: {pe}"
        )

        return {
            "mode": "screenshot",
            "symbol": detected_symbol,
            "exchange": exchange.upper(),
            "current_price": c,
            "signal": signal_text,
            "signal_code": pred_class,
            "confidence": round(confidence, 2),
            "rsi": round(est_rsi, 2),
            "target_price": target_price,
            "stop_loss": stop_loss,
            "ai_analysis_bn": ai_summary_bn,
            "chart_history": [
                {"date": "Yesterday Close", "close": round(ycp, 2)},
                {"date": "Open", "close": round(o, 2)},
                {"date": "Day Low", "close": round(l, 2)},
                {"date": "Day High", "close": round(h, 2)},
                {"date": "Current/Close", "close": round(c, 2)}
            ]
        }

    except Exception as e:
        raise HTTPException(status_code=400, detail=f"স্ক্রিনশট বিশ্লেষণ ব্যর্থ হয়েছে: {str(e)}")