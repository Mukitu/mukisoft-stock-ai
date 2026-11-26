"""
MukiSoft AI — Post-Market Automated ML Execution & Edge Snapshot Generator.
Imports backend/quant_engine.py (17-feature xgb.Booster + 20-indicator consensus engine)
as the single source of truth.

Outputs written atomically to public/assets/ for 0ms Vercel CDN edge hydration:
  1. public/assets/market_snapshot.json  — real closing DSEX/DS30 indices, market status,
                                           and Top 6 genuine Strong Bullish Setups
  2. public/assets/ml_analysis_cache.json — pre-computed full ML analysis payloads
                                            (indicators, 20 votes, targets/stop-loss,
                                            chart history, Bangla summary) for active DSE & CSE stocks
  3. public/assets/daily_picks.json      — backwards-compatible top 6 picks snapshot
"""

from __future__ import annotations

import concurrent.futures
import datetime as dt
import json
import os
import re
import sys
import tempfile
import urllib.request
from pathlib import Path
from typing import Any
from urllib.parse import quote, urlparse

import pandas as pd
from bdshare import get_basic_historical_data, get_current_trade_data, get_market_info
from bs4 import BeautifulSoup

ROOT_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT_DIR / "backend"))

from quant_engine import (  # noqa: E402
    MIN_STRONG_BUY_PRICE,
    MIN_STRONG_BUY_VOTES,
    analyze_ohlcv_dataframe,
    build_manual_ohlcv_frame,
    compute_real_buy_score,
    get_bd_market_session,
    get_bst_now,
    rank_active_market_candidates,
    select_genuine_top_picks,
)

ASSETS_DIR = ROOT_DIR / "public" / "assets"
DAILY_PICKS_PATH = ASSETS_DIR / "daily_picks.json"
MARKET_SNAPSHOT_PATH = ASSETS_DIR / "market_snapshot.json"
ML_ANALYSIS_CACHE_PATH = ASSETS_DIR / "ml_analysis_cache.json"

ALLOWED_EXCHANGE_HOSTS = {"www.dsebd.org", "dsebd.org", "www.cse.com.bd", "cse.com.bd"}
SYMBOL_REGEX = re.compile(r"^[A-Z0-9&().-]{1,20}$")

HTTP_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,application/json;q=0.8,*/*;q=0.7",
    "Accept-Language": "en-US,en;q=0.9,bn;q=0.8",
    "Referer": "https://www.dsebd.org/",
}

# Core liquid DSE/CSE catalog symbols always included in the post-market ML cache
CORE_CACHE_SYMBOLS: list[str] = [
    "GP", "ROBI", "BSCCL",
    "SQURPHARMA", "RENATA", "BXPHARMA", "ACI", "ACIFORMULA", "BEACONPHAR",
    "ORIONPHARM", "IBNSINA", "MARICO", "RECKITTBEN", "NAVANAPHAR",
    "BRACBANK", "CITYBANK", "DUTCHBANGL", "EBL", "PUBALIBANK", "PRIMEBANK",
    "MTB", "UCB", "BANKASIA", "IFIC", "JAMUNABANK", "UTTARABANK", "ISLAMIBANK",
    "WALTONHIL", "BSRMSTEEL", "BSRMLTD", "GPHISPAT", "SINGERBD", "BBSCABLES",
    "UPGDCL", "SUMITPOWER", "MJLBD", "JAMUNAOIL", "MPETROLEUM", "PADMAOIL",
    "LINDEBD", "POWERGRID", "TITASGAS",
    "BATBC", "OLYMPIC", "UNILEVERCL", "LOVELLO", "FINEFOODS",
    "AAMRANET", "AAMRATECH", "AGNISYSL", "BDCOM", "GENEXIL",
    "LANKABAFIN", "IDLC", "DBH", "IPDC", "ICB",
    "SQUARETEXT", "ENVOYTEX", "MALEKSPIN", "MATINSPINN",
    "LHBL", "HEIDELBCEM", "CONFIDCEM", "CROWNCEMNT", "RAKCEC",
    "DELTALIFE", "GREENDELT", "RELIANCINS", "PRAGATIINS", "PIONEERINS",
]


def _is_allowlisted_url(url: str) -> bool:
    parsed = urlparse(url)
    return parsed.scheme == "https" and (parsed.hostname or "").lower() in ALLOWED_EXCHANGE_HOSTS


def _http_get_text(url: str, timeout: float = 8.0) -> str | None:
    if not _is_allowlisted_url(url):
        return None
    try:
        req = urllib.request.Request(url, headers=HTTP_HEADERS)
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            if resp.status == 200:
                return resp.read().decode("utf-8", "ignore")
    except Exception as exc:
        print(f"[fetch] {url} failed: {exc}")
    return None


def _parse_float(raw: Any, default: float = 0.0) -> float:
    if raw is None:
        return default
    cleaned = re.sub(r"[^0-9.\-]", "", str(raw).replace(",", "").strip())
    if not cleaned or cleaned in {"-", ".", "-."}:
        return default
    try:
        val = float(cleaned)
        return val if val == val and abs(val) != float("inf") else default
    except ValueError:
        return default


def _atomic_write_json(target_path: Path, payload: dict[str, Any]) -> None:
    target_path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_path = tempfile.mkstemp(dir=str(target_path.parent), suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as tmp_file:
            json.dump(payload, tmp_file, ensure_ascii=False, indent=2)
        os.replace(tmp_path, target_path)
    except Exception:
        if os.path.exists(tmp_path):
            os.unlink(tmp_path)
        raise


def build_bangla_quantitative_summary(result: dict[str, Any]) -> str:
    """Deterministic, objective Bangla technical summary matching backend/main.py."""
    symbol = result["symbol"]
    exchange = result["exchange"]
    price = float(result["current_price"])
    change_pct = float(result.get("change_pct", 0.0))
    rsi = float(result["rsi"])
    confidence = float(result["confidence"])
    target = float(result["target_price"])
    stop_loss = float(result["stop_loss"])
    bull_votes = int(result["bull_votes"])
    bear_votes = int(result.get("bear_votes", 20 - bull_votes))
    indicators = result.get("indicators") or {}
    sma20 = float(indicators.get("sma20", price))
    ema20 = float(indicators.get("ema20", price))
    macd_hist = float(indicators.get("macd_hist", 0.0))
    vol_ratio = float(result.get("vol_ratio", 1.0))

    trend_note = (
        f"দর বর্তমানে ২০-দিনের গড় SMA(৳{sma20:.2f}) ও EMA(৳{ema20:.2f})-এর উপরে অবস্থান করছে"
        if price >= sma20 and price >= ema20
        else f"দর বর্তমানে ২০-দিনের গড় SMA(৳{sma20:.2f}) ও EMA(৳{ema20:.2f})-এর কাছাকাছি বা নিচে অবস্থান করছে"
    )
    momentum_note = (
        "MACD হিস্টোগ্রাম পজিটিভ মোমেন্টাম সমর্থন করছে"
        if macd_hist >= 0
        else "MACD হিস্টোগ্রাম কিছুটা দুর্বল বা কনসলিডেশন চাপ নির্দেশ করছে"
    )
    return (
        f"বর্তমানে {symbol} ({exchange}) শেয়ারটির সর্বশেষ ক্লোজিং দর ৳{price:.2f} ({change_pct:+.2f}%) এবং ২০টি টেকনিক্যাল সূচকের মধ্যে "
        f"{bull_votes}টি ইতিবাচক ও {bear_votes}টি সতর্কতামূলক সংকেত দিচ্ছে (XGBoost কনফিডেন্স {confidence:.1f}%)। "
        f"RSI(14) মান {rsi:.1f}, ভলিউম রেশিও {vol_ratio:.2f}x; {trend_note} এবং {momentum_note}। "
        f"গাণিতিক রেফারেন্স রেজিস্ট্যান্স ৳{target:.2f} এবং সাপোর্ট / ঝুঁকি রেফারেন্স ৳{stop_loss:.2f} কেবল তথ্য ও গবেষণামূলক পর্যবেক্ষণের জন্য প্রদর্শিত হয়েছে।"
    )


def fetch_closing_indices_and_home_board() -> tuple[dict[str, Any], pd.DataFrame | None]:
    """Scrapes real closing DSEX/DS30/DSES indices + 380+ ticker tape from https://www.dsebd.org/."""
    indices: dict[str, Any] = {
        "dsex": "",
        "dsex_change": 0.0,
        "dsex_change_pct": 0.0,
        "ds30": "",
        "ds30_change": 0.0,
        "ds30_change_pct": 0.0,
        "dses": "",
    }
    home_board_df: pd.DataFrame | None = None

    html = _http_get_text("https://www.dsebd.org/", timeout=8.0)
    if html:
        unesc = html.replace('\\"', '"')

        for key_name, field_prefix, lo, hi in [
            ("DSEX", "dsex", 1000.0, 25000.0),
            ("DS30", "ds30", 400.0, 12000.0),
            ("DSES", "dses", 400.0, 12000.0),
        ]:
            m = re.search(
                rf'"key":"{key_name}","value":([0-9.]+),"change":([-0-9.]+),"percent":([-0-9.]+)',
                unesc,
            )
            if m:
                val = _parse_float(m.group(1))
                if lo <= val <= hi:
                    indices[field_prefix] = f"{val:,.2f}"
                    if field_prefix in {"dsex", "ds30"}:
                        indices[f"{field_prefix}_change"] = round(_parse_float(m.group(2)), 2)
                        indices[f"{field_prefix}_change_pct"] = round(_parse_float(m.group(3)), 2)

        if not indices["dsex"]:
            intra_m = re.search(r'"initialIntraday":\{"key":"DSEX","points":\[(.*?)\]', unesc)
            if intra_m:
                pts = re.findall(r'"value":([0-9.]+)', intra_m.group(1))
                if pts:
                    val = _parse_float(pts[-1])
                    if 1000.0 <= val <= 25000.0:
                        indices["dsex"] = f"{val:,.2f}"

        ticker_matches = re.findall(
            r'"code":"([A-Z0-9&().-]{1,20})","price":"([0-9.,]+)","change":([-0-9.]+),"delta":([-0-9.]+)',
            unesc,
        )
        rows: list[dict[str, Any]] = []
        seen: set[str] = set()
        for sym, price_s, _chg_s, delta_s in ticker_matches:
            clean = sym.strip().upper()
            if clean in seen or not SYMBOL_REGEX.match(clean):
                continue
            price = _parse_float(price_s)
            if price <= 0:
                continue
            delta = _parse_float(delta_s)
            ycp = round(price - delta, 2) if (price - delta) > 0 else price
            seen.add(clean)
            rows.append({
                "symbol": clean,
                "ltp": price,
                "high": max(price, ycp),
                "low": min(price, ycp),
                "close": price,
                "ycp": ycp,
                "value": 0.0,
                "volume": 0.0,
            })
        if rows:
            home_board_df = pd.DataFrame(rows)

    # Fallback / supplement indices via bdshare.get_market_info()
    if not indices["dsex"] or not indices["ds30"]:
        try:
            mkt = get_market_info()
            if mkt is not None and len(mkt) > 0:
                latest = mkt.iloc[0]
                for col in mkt.columns:
                    low = str(col).strip().lower()
                    val = _parse_float(latest[col])
                    if not indices["dsex"] and "dsex" in low and 1000.0 <= val <= 25000.0:
                        indices["dsex"] = f"{val:,.2f}"
                    elif not indices["ds30"] and "ds30" in low and 400.0 <= val <= 12000.0:
                        indices["ds30"] = f"{val:,.2f}"
        except Exception as exc:
            print(f"[bdshare] get_market_info failed: {exc}")

    return indices, home_board_df


def fetch_cse_closing_board() -> dict[str, dict[str, Any]]:
    """Scrapes CSE official closing price board when reachable."""
    html = _http_get_text("https://www.cse.com.bd/market/current_price", timeout=8.0)
    if not html:
        return {}
    soup = BeautifulSoup(html, "html.parser")
    board: dict[str, dict[str, Any]] = {}
    for tr in soup.find_all("tr"):
        cells = [td.get_text(" ", strip=True) for td in tr.find_all("td")]
        if len(cells) < 8:
            continue
        sym = cells[1].strip().upper()
        if not SYMBOL_REGEX.match(sym):
            continue
        ltp = _parse_float(cells[2])
        open_p = _parse_float(cells[3])
        high_p = _parse_float(cells[4])
        low_p = _parse_float(cells[5])
        ycp = _parse_float(cells[6])
        vol = _parse_float(cells[-1])
        price = ltp if ltp > 0 else ycp
        if price <= 0:
            continue
        board[sym] = {
            "open": open_p if open_p > 0 else (ycp if ycp > 0 else price),
            "high": max(high_p, price),
            "low": min(low_p, price) if low_p > 0 else price,
            "close": price,
            "ycp": ycp if ycp > 0 else price,
            "volume": vol,
        }
    return board


def fetch_dse_company_ssr_quote(symbol: str) -> dict[str, Any] | None:
    """Fetches real latest closing OHLCV quote from https://www.dsebd.org/company/{SYMBOL}."""
    html = _http_get_text(f"https://www.dsebd.org/company/{quote(symbol, safe='')}", timeout=6.0)
    if not html:
        return None
    unesc = html.replace('\\"', '"')

    def _num(pat: str) -> float:
        m = re.search(pat, unesc)
        return _parse_float(m.group(1)) if m else 0.0

    last_price = _num(r'"lastPrice":([0-9.]+)')
    close_p = _num(r'"close":([0-9.]+),"trades"') or _num(r'"close":([0-9.]+)')
    prev_close = _num(r'"prevClose":([0-9.]+)')
    open_p = _num(r'"open":([0-9.]+),"high"') or _num(r'"open":([0-9.]+)')
    high_p = _num(r'"open":[0-9.]+,"high":([0-9.]+)') or _num(r'"high":([0-9.]+)')
    low_p = _num(r'"high":[0-9.]+,"low":([0-9.]+)') or _num(r'"low":([0-9.]+)')
    vol = _num(r'"volume":([0-9.]+),"trades"') or _num(r'"volume":([0-9.]+)')

    final_close = last_price if last_price > 0 else (close_p if close_p > 0 else prev_close)
    if final_close <= 0:
        return None

    ycp = prev_close if prev_close > 0 else (open_p if open_p > 0 else final_close)
    final_open = open_p if open_p > 0 else ycp
    return {
        "open": final_open,
        "high": max(high_p, final_open, final_close),
        "low": min(low_p, final_open, final_close) if low_p > 0 else min(final_open, final_close),
        "close": final_close,
        "ycp": ycp,
        "volume": vol,
    }


def _analyze_single_symbol(
    symbol: str,
    start_date: str,
    end_date: str,
    board_map: dict[str, dict[str, Any]],
) -> tuple[str, dict[str, Any] | None, bool]:
    """
    Runs real 17-feature XGBoost + 20-indicator analysis for a single DSE symbol.
    Returns (symbol, full_analysis_or_none, has_90d_history).
    """
    hist_df: pd.DataFrame | None = None
    has_90d = False
    try:
        raw_df = get_basic_historical_data(start_date, end_date, symbol)
        if raw_df is not None and len(raw_df) >= 15:
            hist_df = raw_df.reset_index()
            has_90d = True
    except Exception:
        hist_df = None

    if hist_df is None:
        quote = fetch_dse_company_ssr_quote(symbol) or board_map.get(symbol)
        if not quote or quote["close"] <= 0:
            return symbol, None, False
        hist_df = build_manual_ohlcv_frame(
            open_price=quote["open"],
            high_price=quote["high"],
            low_price=quote["low"],
            close_price=quote["close"],
            yesterday_close=quote["ycp"],
            volume=quote["volume"],
        )

    source_label = (
        "Post-Market 90D Closing OHLCV (XGBoost + 20 Indicators)"
        if has_90d
        else "Official DSE Closing Feed (XGBoost + 20 Indicators)"
    )
    try:
        full = analyze_ohlcv_dataframe(symbol, "DSE", hist_df, source_label=source_label)
        full["ai_analysis_bn"] = build_bangla_quantitative_summary(full)
        return symbol, full, has_90d
    except Exception as exc:
        print(f"[analyze] Skipping {symbol}: {exc}")
        return symbol, None, False


def build_post_market_snapshots() -> int:
    os.environ["BDSHARE_SOURCE"] = "new"
    now_bst = get_bst_now()
    session = get_bd_market_session(now_bst)
    generated_at_bst = now_bst.strftime("%d %b %Y, %I:%M %p")
    trading_date = now_bst.strftime("%Y-%m-%d")

    print(f"Starting Post-Market ML Sync at {generated_at_bst} BST...")

    # 1. Fetch closing DSEX/DS30 indices + homepage ticker board
    indices, home_board_df = fetch_closing_indices_and_home_board()
    print(f"Indices fetched: DSEX={indices.get('dsex') or 'N/A'}, DS30={indices.get('ds30') or 'N/A'}")

    # 2. Fetch full live/closing DSE board (bdshare primary, homepage SSR ticker fallback)
    live_df: pd.DataFrame | None = None
    try:
        live_df = get_current_trade_data()
    except Exception as exc:
        print(f"[bdshare] get_current_trade_data failed: {exc}")

    if live_df is None or len(live_df) == 0:
        live_df = home_board_df

    board_map: dict[str, dict[str, Any]] = {}
    if live_df is not None and len(live_df) > 0:
        df_norm = live_df.copy()
        df_norm.columns = [str(c).lower().strip() for c in df_norm.columns]
        sym_col = "symbol" if "symbol" in df_norm.columns else (df_norm.columns[1] if len(df_norm.columns) > 1 else df_norm.columns[0])
        for _, row in df_norm.iterrows():
            sym = str(row.get(sym_col, "")).strip().upper()
            if not SYMBOL_REGEX.match(sym):
                continue
            ltp = _parse_float(row.get("ltp", row.get("close", row.get("closep"))))
            ycp = _parse_float(row.get("ycp")) or ltp
            if ltp <= 0:
                continue
            opn = _parse_float(row.get("open")) or ycp or ltp
            board_map[sym] = {
                "open": opn,
                "high": max(_parse_float(row.get("high")), opn, ltp),
                "low": min(_parse_float(row.get("low")) or ltp, opn, ltp),
                "close": ltp,
                "ycp": ycp,
                "volume": _parse_float(row.get("volume")),
            }

    # 3. Build candidate screening queue + core popular ticker cache queue
    shortlist = rank_active_market_candidates(live_df) if live_df is not None else []
    low_cands = [c["symbol"] for c in shortlist if MIN_STRONG_BUY_PRICE <= c["price"] < 100.0][:25]
    high_cands = [c["symbol"] for c in shortlist if c["price"] >= 100.0][:25]

    screening_set = set(low_cands + high_cands)
    target_symbols: list[str] = []
    seen_targets: set[str] = set()
    for sym in [*low_cands, *high_cands, *CORE_CACHE_SYMBOLS]:
        clean = sym.strip().upper()
        if clean and clean not in seen_targets:
            seen_targets.add(clean)
            target_symbols.append(clean)

    end_date = now_bst.date()
    start_date = end_date - dt.timedelta(days=115)

    verified_strong_buys: list[dict[str, Any]] = []
    analyses_cache: dict[str, dict[str, Any]] = {}

    print(f"Running 17-feature XGBoost + 20-indicator engine across {len(target_symbols)} active DSE tickers...")
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as executor:
        futures = [
            executor.submit(
                _analyze_single_symbol,
                sym,
                str(start_date),
                str(end_date),
                board_map,
            )
            for sym in target_symbols
        ]
        for fut in concurrent.futures.as_completed(futures):
            sym, full, has_90d = fut.result()
            if not full:
                continue
            full_with_session = {**full, "session": session}
            analyses_cache[f"DSE:{sym}"] = full_with_session

            if (
                has_90d
                and sym in screening_set
                and full["signal_code"] == 2
                and full["ml_signal_code"] == 2
                and full["bull_votes"] >= MIN_STRONG_BUY_VOTES
                and not full["is_sideways"]
                and full["current_price"] >= MIN_STRONG_BUY_PRICE
                and full["change_pct"] > 0.0
                and full["volume"] > 0
            ):
                verified_strong_buys.append({
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

    # 4. Also enrich CSE closing quotes for core symbols when cse.com.bd is reachable
    cse_board = fetch_cse_closing_board()
    if cse_board:
        print(f"Fetched {len(cse_board)} CSE closing quotes.")
        for sym in CORE_CACHE_SYMBOLS:
            cse_q = cse_board.get(sym)
            if not cse_q:
                continue
            try:
                base_dse = analyses_cache.get(f"DSE:{sym}")
                if base_dse and base_dse.get("chart_history"):
                    cse_df = pd.DataFrame(base_dse["chart_history"])
                    cse_df.iloc[-1, cse_df.columns.get_loc("close")] = cse_q["close"]
                    cse_df.iloc[-1, cse_df.columns.get_loc("high")] = max(cse_q["high"], cse_q["close"])
                    cse_df.iloc[-1, cse_df.columns.get_loc("low")] = min(cse_q["low"], cse_q["close"])
                    if cse_q["volume"] > 0:
                        cse_df.iloc[-1, cse_df.columns.get_loc("volume")] = cse_q["volume"]
                else:
                    cse_df = build_manual_ohlcv_frame(
                        open_price=cse_q["open"],
                        high_price=cse_q["high"],
                        low_price=cse_q["low"],
                        close_price=cse_q["close"],
                        yesterday_close=cse_q["ycp"],
                        volume=cse_q["volume"],
                    )
                cse_full = analyze_ohlcv_dataframe(
                    sym,
                    "CSE",
                    cse_df,
                    source_label="Post-Market CSE Closing Feed (XGBoost + 20 Indicators)",
                )
                cse_full["ai_analysis_bn"] = build_bangla_quantitative_summary(cse_full)
                analyses_cache[f"CSE:{sym}"] = {**cse_full, "session": session}
            except Exception as exc:
                print(f"[CSE] Skipping {sym}: {exc}")

    picks = select_genuine_top_picks(verified_strong_buys)

    # Preserve existing verified closing picks if upstream board had an outage and yielded 0 picks
    if len(picks) == 0 and DAILY_PICKS_PATH.exists():
        try:
            existing = json.loads(DAILY_PICKS_PATH.read_text(encoding="utf-8"))
            if isinstance(existing, dict) and existing.get("picks"):
                picks = existing["picks"]
                print("Preserved previous verified closing picks (0 new Strong Buys detected).")
        except Exception:
            pass

    if not indices["dsex"] and MARKET_SNAPSHOT_PATH.exists():
        try:
            prev_snap = json.loads(MARKET_SNAPSHOT_PATH.read_text(encoding="utf-8"))
            if isinstance(prev_snap, dict) and isinstance(prev_snap.get("indices"), dict):
                indices = prev_snap["indices"]
        except Exception:
            pass

    # 5. Write market_snapshot.json (instant 0ms DSEX, DS30, market status & Top 6 picks)
    market_snapshot = {
        "schema_version": 2,
        "generated_at_bst": generated_at_bst,
        "trading_date": trading_date,
        "market_status": "live" if session["is_live"] else "closing",
        "indices": indices,
        "session": session,
        "picks": picks,
    }
    _atomic_write_json(MARKET_SNAPSHOT_PATH, market_snapshot)
    print(f"Saved market_snapshot.json (DSEX={indices.get('dsex')}, DS30={indices.get('ds30')}, picks={len(picks)})")

    # 6. Write ml_analysis_cache.json (instant 0ms pre-computed /analyzer reports)
    if analyses_cache:
        ml_cache_payload = {
            "schema_version": 2,
            "generated_at_bst": generated_at_bst,
            "trading_date": trading_date,
            "count": len(analyses_cache),
            "analyses": analyses_cache,
        }
        _atomic_write_json(ML_ANALYSIS_CACHE_PATH, ml_cache_payload)
        print(f"Saved ml_analysis_cache.json ({len(analyses_cache)} DSE/CSE pre-computed ML analyses)")

    # 7. Keep daily_picks.json synchronized for backwards compatibility
    if picks:
        daily_payload = {
            "schema_version": 2,
            "generated_at_bst": generated_at_bst,
            "cycle_date": trading_date,
            "picks": picks,
        }
        _atomic_write_json(DAILY_PICKS_PATH, daily_payload)
        print(f"Synced daily_picks.json ({len(picks)} picks)")

    return 0


if __name__ == "__main__":
    sys.exit(build_post_market_snapshots())
