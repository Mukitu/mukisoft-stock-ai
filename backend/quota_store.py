"""
MukiSoft AI — Tamper-Proof Server-Side 24-Hour Free Analysis Quota Store.
Uses SQLite (WAL mode, atomic BEGIN IMMEDIATE transactions, parameterized queries)
keyed by sha256(client_ip + ":" + deviceHash) so clearing cookies, localStorage,
or switching to Incognito cannot bypass the 2-symbol / 24-hour rolling window.
"""

from __future__ import annotations

import hashlib
import ipaddress
import json
import re
import sqlite3
import threading
import time
from pathlib import Path
from typing import Any, Mapping

FREE_QUOTA_LIMIT = 2
QUOTA_WINDOW_SECONDS = 86_400  # 24 hours
SESSION_TTL_MS = 30 * 24 * 3600 * 1000  # 30 days

BASE_DIR = Path(__file__).resolve().parent
QUOTA_DB_PATH = BASE_DIR / "free_quota.db"

_DEVICE_HASH_RE = re.compile(r"^[a-f0-9]{16,128}$")
_LOCK = threading.Lock()
_SESSION_LOCK = threading.Lock()
_SUBSCRIBER_SESSION_CACHE: dict[str, dict[str, Any]] = {}


def _get_connection(db_path: Path = QUOTA_DB_PATH) -> sqlite3.Connection:
    conn = sqlite3.connect(str(db_path), timeout=10.0, isolation_level=None)
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("PRAGMA synchronous=NORMAL;")
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS free_quota_windows (
            quota_key TEXT PRIMARY KEY,
            window_start INTEGER NOT NULL,
            symbols_json TEXT NOT NULL,
            updated_at INTEGER NOT NULL
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS subscriber_sessions (
            subscriber_key TEXT PRIMARY KEY,
            session_token TEXT NOT NULL,
            status TEXT NOT NULL,
            revoked INTEGER NOT NULL DEFAULT 0,
            updated_at INTEGER NOT NULL
        )
        """
    )
    return conn


def _parse_valid_ip(raw: str | None) -> str | None:
    if not raw:
        return None
    candidate = raw.strip()
    if not candidate:
        return None
    try:
        return str(ipaddress.ip_address(candidate))
    except ValueError:
        return None


def extract_client_ip(headers: Mapping[str, str], client_host: str | None = None) -> str:
    """
    Extracts the client's public IP from Cloudflare / reverse-proxy headers
    (CF-Connecting-IP -> X-Forwarded-For -> REMOTE_ADDR) and validates IP syntax.
    """
    lowered = {k.lower(): v for k, v in headers.items()}

    cf_ip = _parse_valid_ip(lowered.get("cf-connecting-ip"))
    if cf_ip:
        return cf_ip

    xff = lowered.get("x-forwarded-for", "")
    if xff:
        for part in xff.split(","):
            parsed = _parse_valid_ip(part)
            if parsed:
                return parsed

    real_ip = _parse_valid_ip(lowered.get("x-real-ip"))
    if real_ip:
        return real_ip

    direct = _parse_valid_ip(client_host)
    return direct or "0.0.0.0"


def normalize_device_hash(raw: str | None) -> str:
    """Normalizes the client-provided deterministic hardware/canvas deviceHash."""
    if not raw:
        return "anonymous-device"
    cleaned = raw.strip().lower()
    if _DEVICE_HASH_RE.match(cleaned):
        return cleaned
    return hashlib.sha256(cleaned[:256].encode("utf-8")).hexdigest()


def build_quota_key(client_ip: str, device_hash: str) -> str:
    normalized_hash = normalize_device_hash(device_hash)
    raw_key = f"{client_ip}:{normalized_hash}"
    return hashlib.sha256(raw_key.encode("utf-8")).hexdigest()


def _parse_symbols_json(raw_json: str) -> list[str]:
    try:
        parsed = json.loads(raw_json)
        if isinstance(parsed, list):
            return [str(s).strip().upper() for s in parsed if str(s).strip()]
    except Exception:
        pass
    return []


def _format_quota_response(
    allowed: bool,
    window_start: int,
    symbols: list[str],
    now_ts: int,
) -> dict[str, Any]:
    used = len(symbols)
    remaining = max(0, FREE_QUOTA_LIMIT - used)
    if window_start > 0 and used > 0:
        elapsed = max(0, now_ts - window_start)
        reset_in_seconds = max(0, QUOTA_WINDOW_SECONDS - elapsed)
    else:
        reset_in_seconds = 0

    return {
        "allowed": allowed,
        "isSubscribed": False,
        "unlimited": False,
        "limit": FREE_QUOTA_LIMIT,
        "windowStart": window_start if used > 0 else 0,
        "symbols": symbols,
        "remaining": remaining,
        "resetInSeconds": reset_in_seconds,
    }


def get_quota_status(
    client_ip: str,
    device_hash: str | None,
    now: float | None = None,
    db_path: Path = QUOTA_DB_PATH,
) -> dict[str, Any]:
    """Reads current 24-hour quota status without consuming any credit."""
    now_ts = int(now if now is not None else time.time())
    quota_key = build_quota_key(client_ip, device_hash or "")

    with _LOCK:
        conn = _get_connection(db_path)
        try:
            row = conn.execute(
                "SELECT window_start, symbols_json FROM free_quota_windows WHERE quota_key = ?",
                (quota_key,),
            ).fetchone()

            if row is None:
                return _format_quota_response(True, 0, [], now_ts)

            window_start, symbols_json = int(row[0]), str(row[1])
            symbols = _parse_symbols_json(symbols_json)

            # Auto-reset once 24 hours (86400s) elapse from windowStart
            if now_ts - window_start >= QUOTA_WINDOW_SECONDS:
                conn.execute("DELETE FROM free_quota_windows WHERE quota_key = ?", (quota_key,))
                return _format_quota_response(True, 0, [], now_ts)

            allowed = len(symbols) < FREE_QUOTA_LIMIT
            return _format_quota_response(allowed, window_start, symbols, now_ts)
        finally:
            conn.close()


def check_and_consume_quota(
    client_ip: str,
    device_hash: str | None,
    symbol: str,
    now: float | None = None,
    db_path: Path = QUOTA_DB_PATH,
) -> dict[str, Any]:
    """
    Atomically checks & increments the 24-hour rolling window quota for a stock symbol:
    - Up to 2 distinct stock symbols per 86400s window.
    - Re-checking an already-unlocked symbol within the same 24h window returns allowed=True
      without consuming an additional credit.
    - 3rd distinct symbol returns allowed=False, remaining=0, resetInSeconds>0.
    - Automatically resets after 86400s from windowStart.
    """
    clean_symbol = symbol.strip().upper()
    now_ts = int(now if now is not None else time.time())
    quota_key = build_quota_key(client_ip, device_hash or "")

    with _LOCK:
        conn = _get_connection(db_path)
        try:
            conn.execute("BEGIN IMMEDIATE")
            row = conn.execute(
                "SELECT window_start, symbols_json FROM free_quota_windows WHERE quota_key = ?",
                (quota_key,),
            ).fetchone()

            if row is None:
                window_start = now_ts
                symbols: list[str] = []
            else:
                window_start = int(row[0])
                symbols = _parse_symbols_json(str(row[1]))
                if now_ts - window_start >= QUOTA_WINDOW_SECONDS:
                    window_start = now_ts
                    symbols = []

            # Re-checking an already unlocked symbol consumes 0 extra credits
            if clean_symbol in symbols:
                conn.execute("COMMIT")
                return _format_quota_response(True, window_start, symbols, now_ts)

            # 3rd distinct symbol within 24 hours -> block (HTTP 429)
            if len(symbols) >= FREE_QUOTA_LIMIT:
                conn.execute("COMMIT")
                return _format_quota_response(False, window_start, symbols, now_ts)

            # Consume 1 credit for this new distinct symbol
            symbols.append(clean_symbol)
            conn.execute(
                """
                INSERT INTO free_quota_windows (quota_key, window_start, symbols_json, updated_at)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(quota_key) DO UPDATE SET
                    window_start = excluded.window_start,
                    symbols_json = excluded.symbols_json,
                    updated_at = excluded.updated_at
                """,
                (quota_key, window_start, json.dumps(symbols), now_ts),
            )
            conn.execute("COMMIT")
            return _format_quota_response(True, window_start, symbols, now_ts)
        except Exception:
            conn.execute("ROLLBACK")
            raise
        finally:
            conn.close()


def _read_subscriber_session_unlocked(
    subscriber_key: str,
    now_ms: int,
    db_path: Path = QUOTA_DB_PATH,
) -> dict[str, Any] | None:
    cached = _SUBSCRIBER_SESSION_CACHE.get(subscriber_key)
    if isinstance(cached, dict):
        if (now_ms - int(cached.get("updatedAt", now_ms))) < SESSION_TTL_MS:
            return cached
        _SUBSCRIBER_SESSION_CACHE.pop(subscriber_key, None)

    conn = _get_connection(db_path)
    try:
        row = conn.execute(
            "SELECT session_token, status, revoked, updated_at FROM subscriber_sessions WHERE subscriber_key = ?",
            (subscriber_key,),
        ).fetchone()
        if row is None:
            return None

        session_token, status, revoked_int, updated_at = (
            str(row[0]),
            str(row[1]),
            int(row[2]),
            int(row[3]),
        )
        if (now_ms - updated_at) >= SESSION_TTL_MS:
            conn.execute("DELETE FROM subscriber_sessions WHERE subscriber_key = ?", (subscriber_key,))
            return None

        record = {
            "sessionToken": session_token,
            "status": status,
            "revoked": bool(revoked_int) or status == "UNSUBSCRIBED",
            "updatedAt": updated_at,
        }
        _SUBSCRIBER_SESSION_CACHE[subscriber_key] = record
        return record
    finally:
        conn.close()


def _upsert_subscriber_session_unlocked(
    subscriber_key: str,
    session_token: str,
    status: str,
    revoked: bool,
    now_ms: int,
    db_path: Path = QUOTA_DB_PATH,
) -> dict[str, Any]:
    conn = _get_connection(db_path)
    try:
        conn.execute("BEGIN IMMEDIATE")
        conn.execute(
            """
            INSERT INTO subscriber_sessions (subscriber_key, session_token, status, revoked, updated_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(subscriber_key) DO UPDATE SET
                session_token = excluded.session_token,
                status = excluded.status,
                revoked = excluded.revoked,
                updated_at = excluded.updated_at
            """,
            (subscriber_key, session_token, status, 1 if revoked else 0, now_ms),
        )
        conn.execute("COMMIT")
    except Exception:
        conn.execute("ROLLBACK")
        raise
    finally:
        conn.close()

    record = {
        "sessionToken": session_token,
        "status": status,
        "revoked": bool(revoked),
        "updatedAt": now_ms,
    }
    _SUBSCRIBER_SESSION_CACHE[subscriber_key] = record
    return record


def claim_subscriber_session_record(
    subscriber_key: str,
    session_token: str,
    now_ms: int | None = None,
    db_path: Path = QUOTA_DB_PATH,
) -> dict[str, Any]:
    """Marks a subscriber key as ACTIVE with the given session token in memory & SQLite."""
    ts_ms = int(now_ms if now_ms is not None else time.time() * 1000)
    with _SESSION_LOCK:
        return _upsert_subscriber_session_unlocked(
            subscriber_key=subscriber_key,
            session_token=session_token,
            status="ACTIVE",
            revoked=False,
            now_ms=ts_ms,
            db_path=db_path,
        )


def revoke_subscriber_session_record(
    subscriber_key: str,
    now_ms: int | None = None,
    db_path: Path = QUOTA_DB_PATH,
) -> dict[str, Any]:
    """Immediately marks a subscriber key as UNSUBSCRIBED / revoked in memory & SQLite."""
    ts_ms = int(now_ms if now_ms is not None else time.time() * 1000)
    with _SESSION_LOCK:
        return _upsert_subscriber_session_unlocked(
            subscriber_key=subscriber_key,
            session_token="__UNSUBSCRIBED__",
            status="UNSUBSCRIBED",
            revoked=True,
            now_ms=ts_ms,
            db_path=db_path,
        )


def verify_subscriber_session_record(
    subscriber_key: str,
    session_token: str,
    now_ms: int | None = None,
    db_path: Path = QUOTA_DB_PATH,
) -> dict[str, Any]:
    """Verifies whether a subscriber session token is still active and unrevoked."""
    ts_ms = int(now_ms if now_ms is not None else time.time() * 1000)
    with _SESSION_LOCK:
        record = _read_subscriber_session_unlocked(subscriber_key, ts_ms, db_path=db_path)
        if record is not None:
            if bool(record.get("revoked")) or record.get("status") == "UNSUBSCRIBED":
                return {
                    "valid": False,
                    "active": False,
                    "subscribed": False,
                    "revoked": True,
                    "reason": "UNSUBSCRIBED",
                    "updatedAt": record.get("updatedAt"),
                }
            stored_token = str(record.get("sessionToken") or "")
            if stored_token and stored_token != session_token:
                return {
                    "valid": False,
                    "active": False,
                    "subscribed": True,
                    "revoked": False,
                    "reason": "SESSION_REPLACED",
                    "updatedAt": record.get("updatedAt"),
                }
            return {
                "valid": True,
                "active": True,
                "subscribed": True,
                "revoked": False,
                "reason": "OK",
                "updatedAt": record.get("updatedAt"),
            }

        return {
            "valid": False,
            "active": False,
            "subscribed": False,
            "revoked": False,
            "reason": "UNVERIFIED",
            "updatedAt": None,
        }


def is_subscriber_revoked(
    subscriber_key: str,
    within_seconds: int | None = None,
    now_ms: int | None = None,
    db_path: Path = QUOTA_DB_PATH,
) -> bool:
    """Returns True if the subscriber key is currently marked revoked/unsubscribed."""
    ts_ms = int(now_ms if now_ms is not None else time.time() * 1000)
    with _SESSION_LOCK:
        record = _read_subscriber_session_unlocked(subscriber_key, ts_ms, db_path=db_path)
        if record is None:
            return False
        if not (bool(record.get("revoked")) or record.get("status") == "UNSUBSCRIBED"):
            return False
        if within_seconds is not None:
            return (ts_ms - int(record.get("updatedAt", 0))) <= within_seconds * 1000
        return True
