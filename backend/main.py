from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import xgboost as xgb
import joblib
import pandas as pd
import numpy as np
import datetime as dt
import requests
import os
from bdshare import get_basic_historical_data, get_market_info, get_current_trade_data
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


class ManualStockInput(BaseModel):
    symbol: str
    exchange: str = "DSE"
    open_price: float
    high_price: float
    low_price: float
    close_price: float
    volume: float
    sma_20: float
    rsi_14: float = 50.0


def generate_humanized_advice(symbol, exchange, price, rsi, signal, confidence, target_price, stop_loss):
    if not AI_API_KEY:
        raise HTTPException(status_code=500, detail="MukiSoft AI ইঞ্জিন কী কনফিগার করা নেই।")

    prompt = f"""
    Tumi Bangladesh Share Market-er ekjon senior human trader. Kono AI-er moto formal kotha bolbe na, ekdom manusher moto shohoj o choto kore (matro 3 line-e) Banglay (বাংলা লিপিতে) poramorsho dao:
    - Share: {symbol} ({exchange}), Current Price: {price} BDT, RSI: {rsi:.1f}
    - Signal: {signal} ({confidence:.0f}% confidence), Target: {target_price} BDT, Stop-Loss: {stop_loss} BDT
    
    Porishkar kore bolo: ekhon trade neya thik hobe kina, naki kotokkhon/kon dam porjonto wait kora uchit. Shudhu 3 line Bangla text dibe, kono heading ba bullet point dibe na.
    """

    res = requests.post(
        "https://api.groq.com/openai/v1/chat/completions",
        headers={"Authorization": f"Bearer {AI_API_KEY}", "Content-Type": "application/json"},
        json={
            "model": "llama-3.3-70b-versatile",
            "messages": [{"role": "user", "content": prompt}],
            "temperature": 0.5,
            "max_tokens": 220,
        },
        timeout=12,
    )
    data = res.json()
    return data["choices"][0]["message"]["content"].strip()


@app.get("/")
def home():
    return {"status": "Live", "engine": "MukiSoft AI Dynamic Stock Engine"}


@app.get("/api/market-live")
def get_live_ticker():
    """DSE o CSE-er ashol live index o top active stock data"""
    try:
        mkt = get_market_info()
        latest = mkt.iloc[0]
        dsex_val = str(latest.get("DSEX", latest.iloc[1]))
        ds30_val = str(latest.get("DS30", latest.iloc[2]))
        return {
            "status": "live",
            "dsex": dsex_val,
            "ds30": ds30_val,
            "updated": str(latest.get("Date", dt.date.today()))
        }
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"লাইভ মার্কেট ইনডেক্স পাওয়া যাচ্ছে না: {str(e)}")


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
            detail=f"অটো-ফেচ সাময়িকভাবে সীমাবদ্ধ ({symbol})। নিচের বক্সে আজকের ডেটা বসিয়ে MukiSoft AI বিশ্লেষণ দেখুন।"
        )


@app.post("/api/analyze-manual")
def analyze_manual_stock(payload: ManualStockInput):
    c = payload.close_price
    o = payload.open_price
    h = payload.high_price
    l = payload.low_price
    sma = payload.sma_20 if payload.sma_20 > 0 else c
    ema = (c * 0.2) + (sma * 0.8)
    bb_high = max(h, sma * 1.04)
    bb_low = min(l, sma * 0.96)
    ret_1d = (c - o) / (o + 1e-9)

    row = pd.DataFrame([{
        'sma_20': sma,
        'ema_20': ema,
        'rsi_14': payload.rsi_14,
        'macd': c - ema,
        'macd_signal': (c - ema) * 0.8,
        'macd_diff': (c - ema) * 0.2,
        'bb_high': bb_high,
        'bb_mid': sma,
        'bb_low': bb_low,
        'return_1d': ret_1d,
        'return_3d': ret_1d * 1.5,
        'return_5d': ret_1d * 2.0,
        'vol_ratio': 1.15,
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
        payload.symbol.upper(), payload.exchange.upper(), c, payload.rsi_14, signal_text, confidence, target_price, stop_loss
    )

    return {
        "mode": "manual",
        "symbol": payload.symbol.upper(),
        "exchange": payload.exchange.upper(),
        "current_price": c,
        "signal": signal_text,
        "signal_code": pred_class,
        "confidence": round(confidence, 2),
        "rsi": round(payload.rsi_14, 2),
        "target_price": target_price,
        "stop_loss": stop_loss,
        "ai_analysis_bn": ai_summary_bn,
        "chart_history": [
            {"date": "20D Avg", "close": round(sma, 2)},
            {"date": "Open", "close": round(o, 2)},
            {"date": "Current", "close": round(c, 2)}
        ]
    }