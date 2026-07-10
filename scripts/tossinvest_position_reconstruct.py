#!/usr/bin/env python3
import argparse
import bisect
import json
import os
import sqlite3
import sys
import uuid
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from pathlib import Path


GUIBUILD_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DB_PATH = GUIBUILD_ROOT / "data" / "tossinvest" / "tossinvest-ledger.sqlite3"
DB_PATH = Path(os.environ.get("FINANCE_AGENT_GUI_TOSSINVEST_DB_PATH", DEFAULT_DB_PATH))
SCHEMA_VERSION = 2
EPSILON = Decimal("0.000000001")
KST = timezone(timedelta(hours=9))


def decimal_value(value):
    if value is None:
        return Decimal("0")
    try:
        return Decimal(str(value).strip() or "0")
    except (InvalidOperation, ValueError):
        return Decimal("0")


def decimal_json(value, places="0.000001"):
    value = Decimal(value or "0")
    if abs(value) < EPSILON:
        value = Decimal("0")
    quant = Decimal(places)
    normalized = value.quantize(quant, rounding=ROUND_HALF_UP).normalize()
    text = format(normalized, "f")
    if "." in text:
        text = text.rstrip("0").rstrip(".")
    return text or "0"


def decimal_plain(value):
    if value is None:
        return ""
    normalized = Decimal(value).normalize()
    text = format(normalized, "f")
    if "." in text:
        text = text.rstrip("0").rstrip(".")
    return text or "0"


def parse_time(value):
    text = str(value or "").strip()
    if not text:
        return None
    if text.lower() == "latest":
        return "latest"
    if text.endswith("Z"):
        text = f"{text[:-1]}+00:00"
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        try:
            parsed = datetime.fromisoformat(f"{text}T23:59:59+09:00")
        except ValueError as error:
            raise SystemExit(f"invalid timestamp: {value}") from error
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=KST)
    return parsed.astimezone(timezone.utc)


def parse_time_or_none(value):
    try:
        parsed = parse_time(value)
    except SystemExit:
        return None
    return parsed if parsed != "latest" else None


def format_time(value):
    if not value:
        return ""
    return value.astimezone(KST).isoformat(timespec="seconds")


def date_key(value):
    return value.astimezone(KST).date().isoformat()


def display_path(path):
    try:
        return str(Path(path).relative_to(GUIBUILD_ROOT))
    except ValueError:
        return str(path)


def iso_now():
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def end_of_kst_day(value):
    if not value:
        return None
    return value.astimezone(KST).replace(hour=23, minute=59, second=59, microsecond=0).astimezone(timezone.utc)


def connect():
    if not DB_PATH.exists():
        raise SystemExit(f"missing ledger DB: {DB_PATH}")
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    init_snapshot_db(conn)
    return conn


def init_snapshot_db(conn):
    current_schema_version = int(conn.execute("PRAGMA user_version").fetchone()[0])
    if current_schema_version > SCHEMA_VERSION:
        raise RuntimeError(
            f"Toss ledger schema version {current_schema_version} is newer than supported version {SCHEMA_VERSION}"
        )
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS rebuild_runs (
          run_id TEXT PRIMARY KEY,
          status TEXT NOT NULL,
          started_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          finished_at TEXT,
          requested_start_date TEXT,
          requested_end_date TEXT,
          latest_trade_at TEXT,
          current_holdings_collected_at TEXT,
          total_snapshots INTEGER NOT NULL DEFAULT 0,
          completed_snapshots INTEGER NOT NULL DEFAULT 0,
          total_snapshot_rows INTEGER NOT NULL DEFAULT 0,
          daily_target_count INTEGER NOT NULL DEFAULT 0,
          monthly_target_count INTEGER NOT NULL DEFAULT 0,
          included_trades INTEGER NOT NULL DEFAULT 0,
          position_count INTEGER NOT NULL DEFAULT 0,
          symbol_count INTEGER NOT NULL DEFAULT 0,
          priced_symbol_count INTEGER NOT NULL DEFAULT 0,
          missing_symbol_count INTEGER NOT NULL DEFAULT 0,
          error_count INTEGER NOT NULL DEFAULT 0,
          market_value_usd TEXT,
          market_value_krw TEXT,
          error TEXT,
          metadata_json TEXT NOT NULL DEFAULT '{}'
        );

        CREATE INDEX IF NOT EXISTS idx_toss_rebuild_runs_updated_at
          ON rebuild_runs (updated_at DESC);

        CREATE TABLE IF NOT EXISTS market_candles (
          symbol TEXT NOT NULL,
          price_date TEXT NOT NULL,
          timestamp TEXT,
          currency TEXT,
          open_price TEXT,
          high_price TEXT,
          low_price TEXT,
          close_price TEXT NOT NULL,
          volume TEXT,
          source TEXT NOT NULL DEFAULT 'tossinvest-candles',
          updated_at TEXT NOT NULL,
          PRIMARY KEY (symbol, price_date)
        );

        CREATE TABLE IF NOT EXISTS market_candle_cache_state (
          symbol TEXT PRIMARY KEY,
          requested_start_date TEXT,
          requested_end_date TEXT,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS fx_rates (
          base_currency TEXT NOT NULL,
          quote_currency TEXT NOT NULL,
          rate_date TEXT NOT NULL,
          rate TEXT NOT NULL,
          source TEXT NOT NULL DEFAULT 'tossinvest-exchange-rate',
          valid_from TEXT,
          valid_until TEXT,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (base_currency, quote_currency, rate_date)
        );

        CREATE TABLE IF NOT EXISTS position_snapshots (
          frequency TEXT NOT NULL,
          snapshot_date TEXT NOT NULL,
          account_seq TEXT NOT NULL,
          currency TEXT NOT NULL,
          symbol TEXT NOT NULL,
          snapshot_at TEXT NOT NULL,
          quantity TEXT NOT NULL,
          known_quantity TEXT NOT NULL,
          unknown_quantity TEXT NOT NULL,
          opening_quantity_required TEXT NOT NULL,
          known_cost_basis TEXT NOT NULL,
          usd_krw_rate TEXT,
          known_cost_basis_usd TEXT,
          known_cost_basis_krw TEXT,
          market_price TEXT,
          market_price_date TEXT,
          market_price_currency TEXT,
          market_value TEXT,
          market_value_usd TEXT,
          market_value_krw TEXT,
          market_source TEXT,
          average_known_cost TEXT,
          buy_count INTEGER NOT NULL DEFAULT 0,
          sell_count INTEGER NOT NULL DEFAULT 0,
          rebuild_run_id TEXT,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (frequency, snapshot_date, account_seq, currency, symbol)
        );

        CREATE INDEX IF NOT EXISTS idx_toss_position_snapshots_frequency_date
          ON position_snapshots (frequency, snapshot_date);
        CREATE INDEX IF NOT EXISTS idx_toss_position_snapshots_symbol_date
          ON position_snapshots (symbol, snapshot_date);
        """
    )
    conn.execute(f"PRAGMA user_version = {SCHEMA_VERSION}")


def read_payload():
    raw = sys.stdin.read()
    if not raw.strip():
        return {}
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return {}


def read_fx_cache(conn=None):
    if conn is not None:
        rows = conn.execute(
            """
            SELECT rate_date, rate
            FROM fx_rates
            WHERE base_currency = 'USD' AND quote_currency = 'KRW'
            ORDER BY rate_date
            """
        ).fetchall()
        if rows:
            return {str(row["rate_date"]): decimal_value(row["rate"]) for row in rows if decimal_value(row["rate"]) > 0}
    return {}


def write_fx_cache(conn, rates):
    if conn is None:
        return
    now = iso_now()
    for day, rate in sorted(rates.items()):
        rate_value = decimal_value(rate)
        if rate_value <= 0:
            continue
        conn.execute(
            """
            INSERT INTO fx_rates (
              base_currency, quote_currency, rate_date, rate, source, updated_at
            ) VALUES ('USD', 'KRW', ?, ?, 'tossinvest-exchange-rate', ?)
            ON CONFLICT(base_currency, quote_currency, rate_date) DO UPDATE SET
              rate = excluded.rate,
              source = excluded.source,
              updated_at = excluded.updated_at
            """,
            (str(day)[:10], decimal_plain(rate_value), now),
        )


def normalize_fx_rates(raw_rates):
    if not isinstance(raw_rates, dict):
        return {}
    rates = {}
    for day, value in raw_rates.items():
        day_key = str(day or "").strip()[:10]
        if not day_key:
            continue
        rate = decimal_value(value)
        if rate > 0:
            rates[day_key] = rate
    return rates


def build_fx_context(trades, refresh=False, enabled=True, market_data=None, end_at=None, conn=None):
    if not enabled or not trades:
        return {"ok": False, "enabled": False, "rates": {}, "days": [], "error": ""}
    start_day = date_key(trades[0]["eventAt"])
    end_day = date_key(end_at or trades[-1]["eventAt"])
    payload_rates = normalize_fx_rates((market_data or {}).get("fxRates") if isinstance(market_data, dict) else {})
    cached_rates = {} if refresh else read_fx_cache(conn)
    rates = {**cached_rates, **payload_rates}
    days = sorted(rates)
    missing_range = bool(not days or min(days) > start_day or max(days) < end_day)
    return {
        "ok": bool(days),
        "enabled": True,
        "source": "tossinvest-exchange-rate",
        "meaning": "KRW per 1 USD",
        "cachePath": f"{display_path(DB_PATH)}:fx_rates",
        "requestedStart": start_day,
        "requestedEnd": end_day,
        "availableStart": days[0] if days else "",
        "availableEnd": days[-1] if days else "",
        "rateCount": len(days),
        "rates": rates,
        "days": days,
        "error": "missing Toss USD/KRW exchange-rate cache range" if missing_range else "",
        "warning": "Toss USD/KRW exchange-rate cache does not cover the full requested range" if days and missing_range else "",
    }


def fx_rate_for(fx_context, at_time):
    if not fx_context or not fx_context.get("ok") or not at_time:
        return None
    day = date_key(at_time)
    days = fx_context.get("days") or []
    index = bisect.bisect_right(days, day) - 1
    if index < 0:
        return None
    return fx_context.get("rates", {}).get(days[index])


def public_fx_meta(fx_context, at_time=None):
    if not fx_context:
        return {"enabled": False, "ok": False}
    keys = [
        "enabled",
        "ok",
        "source",
        "ticker",
        "meaning",
        "cachePath",
        "requestedStart",
        "requestedEnd",
        "availableStart",
        "availableEnd",
        "rateCount",
        "error",
        "warning",
    ]
    meta = {key: fx_context.get(key, "") for key in keys if key in fx_context}
    if at_time:
        rate = fx_rate_for(fx_context, at_time)
        meta["asOfDate"] = date_key(at_time)
        meta["asOfRate"] = decimal_json(rate, "0.0001") if rate else ""
    return meta


def candle_day(value):
    try:
        parsed = parse_time(str(value or ""))
    except SystemExit:
        return str(value or "")[:10]
    if not parsed or parsed == "latest":
        return str(value or "")[:10]
    return date_key(parsed)


def normalize_market_candle(raw, fallback_symbol=""):
    if not isinstance(raw, dict):
        return None
    timestamp = str(raw.get("timestamp") or raw.get("dateTime") or raw.get("time") or raw.get("date") or "").strip()
    day = str(raw.get("date") or "").strip()[:10] or candle_day(timestamp)
    close_price = decimal_value(raw.get("closePrice") or raw.get("close") or raw.get("lastPrice") or raw.get("price"))
    if not day or close_price <= 0:
        return None
    return {
        "symbol": str(raw.get("symbol") or fallback_symbol or "").strip().upper(),
        "date": day,
        "timestamp": timestamp,
        "closePrice": close_price,
        "currency": str(raw.get("currency") or "").strip().upper(),
        "openPrice": decimal_value(raw.get("openPrice") or raw.get("open")),
        "highPrice": decimal_value(raw.get("highPrice") or raw.get("high")),
        "lowPrice": decimal_value(raw.get("lowPrice") or raw.get("low")),
        "volume": str(raw.get("volume") or "").strip(),
    }


def upsert_market_candles(conn, candles_by_symbol, now=None):
    if conn is None or not isinstance(candles_by_symbol, dict):
        return 0
    updated_at = now or iso_now()
    written = 0
    for symbol, raw_candles in candles_by_symbol.items():
        symbol_key = str(symbol or "").strip().upper()
        if not symbol_key or not isinstance(raw_candles, list):
            continue
        for raw in raw_candles:
            candle = normalize_market_candle(raw, symbol_key)
            if not candle:
                continue
            conn.execute(
                """
                INSERT INTO market_candles (
                  symbol, price_date, timestamp, currency, open_price, high_price,
                  low_price, close_price, volume, source, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'tossinvest-candles', ?)
                ON CONFLICT(symbol, price_date) DO UPDATE SET
                  timestamp = excluded.timestamp,
                  currency = excluded.currency,
                  open_price = excluded.open_price,
                  high_price = excluded.high_price,
                  low_price = excluded.low_price,
                  close_price = excluded.close_price,
                  volume = excluded.volume,
                  source = excluded.source,
                  updated_at = excluded.updated_at
                """,
                (
                    candle["symbol"] or symbol_key,
                    candle["date"],
                    candle["timestamp"],
                    candle["currency"],
                    decimal_plain(candle["openPrice"]) if candle["openPrice"] > 0 else "",
                    decimal_plain(candle["highPrice"]) if candle["highPrice"] > 0 else "",
                    decimal_plain(candle["lowPrice"]) if candle["lowPrice"] > 0 else "",
                    decimal_plain(candle["closePrice"]),
                    candle["volume"],
                    updated_at,
                ),
            )
            written += 1
    return written


def update_market_candle_cache_state(conn, symbol, start_date, end_date, now=None):
    symbol_key = str(symbol or "").strip().upper()
    if not conn or not symbol_key:
        return
    current = conn.execute(
        """
        SELECT requested_start_date, requested_end_date
        FROM market_candle_cache_state
        WHERE symbol = ?
        """,
        (symbol_key,),
    ).fetchone()
    requested_start = str(start_date or "")[:10]
    requested_end = str(end_date or "")[:10]
    if current:
        old_start = str(current["requested_start_date"] or "")
        old_end = str(current["requested_end_date"] or "")
        if old_start and (not requested_start or old_start < requested_start):
            requested_start = old_start
        if old_end and (not requested_end or old_end > requested_end):
            requested_end = old_end
    conn.execute(
        """
        INSERT INTO market_candle_cache_state (
          symbol, requested_start_date, requested_end_date, updated_at
        ) VALUES (?, ?, ?, ?)
        ON CONFLICT(symbol) DO UPDATE SET
          requested_start_date = excluded.requested_start_date,
          requested_end_date = excluded.requested_end_date,
          updated_at = excluded.updated_at
        """,
        (symbol_key, requested_start, requested_end, now or iso_now()),
    )


def apply_market_data_to_db(conn, market_data):
    if not conn or not isinstance(market_data, dict):
        return {"candleRowsWritten": 0, "fxRowsWritten": 0}
    now = iso_now()
    candles_written = upsert_market_candles(conn, market_data.get("candlesBySymbol"), now=now)
    requested_start = str(market_data.get("startDate") or "")[:10]
    requested_end = str(market_data.get("endDate") or "")[:10]
    ranges_by_symbol = market_data.get("candleRangesBySymbol") if isinstance(market_data.get("candleRangesBySymbol"), dict) else {}
    if isinstance(market_data.get("candlesBySymbol"), dict):
        for symbol in market_data.get("candlesBySymbol", {}):
            range_info = ranges_by_symbol.get(str(symbol or "").strip().upper()) or {}
            symbol_start = str(range_info.get("startDate") or requested_start)[:10]
            symbol_end = str(range_info.get("endDate") or requested_end)[:10]
            update_market_candle_cache_state(conn, symbol, symbol_start, symbol_end, now=now)
    rates = normalize_fx_rates(market_data.get("fxRates") if isinstance(market_data, dict) else {})
    before = len(read_fx_cache(conn))
    if rates:
        write_fx_cache(conn, rates)
    after = len(read_fx_cache(conn))
    return {"candleRowsWritten": candles_written, "fxRowsWritten": max(0, after - before)}


def cached_market_symbols(conn, symbols, start_date, end_date):
    if not conn or not symbols or not start_date or not end_date:
        return []
    placeholders = ",".join("?" for _ in symbols)
    rows = conn.execute(
        f"""
        SELECT state.symbol, state.requested_start_date, state.requested_end_date,
               SUM(CASE WHEN candles.price_date >= ? AND candles.price_date <= ? THEN 1 ELSE 0 END) AS candle_count
        FROM market_candle_cache_state AS state
        LEFT JOIN market_candles AS candles
          ON candles.symbol = state.symbol
        WHERE state.symbol IN ({placeholders})
        GROUP BY state.symbol, state.requested_start_date, state.requested_end_date
        """,
        [start_date, end_date, *symbols],
    ).fetchall()
    cached = []
    for row in rows:
        if (
            str(row["requested_start_date"] or "") <= start_date
            and str(row["requested_end_date"] or "") >= end_date
            and int(row["candle_count"] or 0) > 0
        ):
            cached.append(str(row["symbol"] or "").upper())
    return sorted(cached)


def cached_fx_rate_dates(conn, target_dates):
    if not conn or not target_dates:
        return []
    placeholders = ",".join("?" for _ in target_dates)
    rows = conn.execute(
        f"""
        SELECT rate_date
        FROM fx_rates
        WHERE base_currency = 'USD'
          AND quote_currency = 'KRW'
          AND rate_date IN ({placeholders})
        """,
        target_dates,
    ).fetchall()
    return sorted({str(row["rate_date"]) for row in rows})


def read_market_candle_cache(symbols, conn=None):
    requested = sorted({str(symbol or "").strip().upper() for symbol in symbols if str(symbol or "").strip()})
    if conn is not None and requested:
        placeholders = ",".join("?" for _ in requested)
        rows = conn.execute(
            f"""
            SELECT symbol, price_date, timestamp, currency, open_price, high_price,
                   low_price, close_price, volume
            FROM market_candles
            WHERE symbol IN ({placeholders})
            ORDER BY symbol, price_date
            """,
            requested,
        ).fetchall()
        if rows:
            candles_by_symbol = defaultdict(list)
            for row in rows:
                candles_by_symbol[str(row["symbol"] or "").upper()].append(
                    {
                        "symbol": row["symbol"],
                        "date": row["price_date"],
                        "timestamp": row["timestamp"],
                        "currency": row["currency"],
                        "openPrice": row["open_price"],
                        "highPrice": row["high_price"],
                        "lowPrice": row["low_price"],
                        "closePrice": row["close_price"],
                        "volume": row["volume"],
                    }
                )
            return dict(candles_by_symbol)
    return {}


def build_market_context(symbols, market_data=None, conn=None):
    requested_symbols = sorted({str(symbol or "").strip().upper() for symbol in symbols if str(symbol or "").strip()})
    payload_candles = {}
    if isinstance(market_data, dict) and isinstance(market_data.get("candlesBySymbol"), dict):
        for symbol, candles in market_data.get("candlesBySymbol", {}).items():
            if isinstance(candles, list):
                payload_candles[str(symbol or "").strip().upper()] = candles
    cached_candles = read_market_candle_cache(requested_symbols, conn)
    source_candles = {**cached_candles, **payload_candles}
    by_symbol = {}
    for symbol in requested_symbols:
        by_day = {}
        for raw in source_candles.get(symbol, []):
            candle = normalize_market_candle(raw, symbol)
            if not candle:
                continue
            by_day[candle["date"]] = candle
        days = sorted(by_day)
        if days:
            by_symbol[symbol] = {
                "days": days,
                "candlesByDay": by_day,
                "availableStart": days[0],
                "availableEnd": days[-1],
                "count": len(days),
            }
    missing_symbols = [symbol for symbol in requested_symbols if symbol not in by_symbol]
    return {
        "enabled": True,
        "ok": bool(by_symbol) and not missing_symbols,
        "source": "tossinvest-candles",
        "cachePath": f"{display_path(DB_PATH)}:market_candles",
        "symbolCount": len(requested_symbols),
        "pricedSymbolCount": len(by_symbol),
        "missingSymbolCount": len(missing_symbols),
        "missingSymbols": missing_symbols[:50],
        "bySymbol": by_symbol,
        "errors": market_data.get("errors", []) if isinstance(market_data, dict) else [],
    }


def market_candle_for(market_context, symbol, at_time):
    if not market_context or not at_time:
        return None
    symbol_key = str(symbol or "").strip().upper()
    info = (market_context.get("bySymbol") or {}).get(symbol_key)
    if not info:
        return None
    day = date_key(at_time)
    days = info.get("days") or []
    index = bisect.bisect_right(days, day) - 1
    if index < 0:
        return None
    return (info.get("candlesByDay") or {}).get(days[index])


def convert_market_value(row, candle, fx_rate):
    if not candle:
        return {
            "marketPrice": "",
            "marketPriceDate": "",
            "marketPriceCurrency": "",
            "marketValue": "",
            "marketValueUsd": "",
            "marketValueKrw": "",
            "marketSource": "",
        }
    quantity = decimal_value(row["quantity"])
    price = decimal_value(candle.get("closePrice"))
    if abs(quantity) <= EPSILON or price <= 0:
        return {
            "marketPrice": "",
            "marketPriceDate": "",
            "marketPriceCurrency": "",
            "marketValue": "",
            "marketValueUsd": "",
            "marketValueKrw": "",
            "marketSource": "",
        }
    currency = str(candle.get("currency") or row["currency"] or "").strip().upper()
    market_value = quantity * price
    market_usd = ""
    market_krw = ""
    if currency == "USD":
        market_usd = market_value
        if fx_rate and fx_rate > 0:
            market_krw = market_value * fx_rate
    elif currency == "KRW":
        market_krw = market_value
        if fx_rate and fx_rate > 0:
            market_usd = market_value / fx_rate
    return {
        "marketPrice": decimal_json(price),
        "marketPriceDate": str(candle.get("date") or ""),
        "marketPriceCurrency": currency,
        "marketValue": decimal_json(market_value),
        "marketValueUsd": decimal_json(market_usd) if market_usd != "" else "",
        "marketValueKrw": decimal_json(market_krw) if market_krw != "" else "",
        "marketSource": "tossinvest-candles",
    }


def public_market_meta(market_context):
    if not market_context:
        return {"enabled": False, "ok": False}
    return {
        "enabled": True,
        "ok": bool(market_context.get("ok")),
        "source": market_context.get("source", ""),
        "cachePath": market_context.get("cachePath", ""),
        "symbolCount": market_context.get("symbolCount", 0),
        "pricedSymbolCount": market_context.get("pricedSymbolCount", 0),
        "missingSymbolCount": market_context.get("missingSymbolCount", 0),
        "missingSymbols": market_context.get("missingSymbols", []),
        "errorCount": len(market_context.get("errors", []) or []),
    }


def convert_known_cost(row, fx_rate):
    if not fx_rate or fx_rate <= 0:
        return {
            "usdKrwRate": "",
            "knownCostBasisUsd": "",
            "knownCostBasisKrw": "",
        }
    known_cost = decimal_value(row["knownCostBasis"])
    currency = str(row["currency"] or "").upper()
    if currency == "USD":
        known_usd = known_cost
        known_krw = known_cost * fx_rate
    elif currency == "KRW":
        known_krw = known_cost
        known_usd = known_cost / fx_rate
    else:
        return {
            "usdKrwRate": decimal_json(fx_rate, "0.0001"),
            "knownCostBasisUsd": "",
            "knownCostBasisKrw": "",
        }
    return {
        "usdKrwRate": decimal_json(fx_rate, "0.0001"),
        "knownCostBasisUsd": decimal_json(known_usd),
        "knownCostBasisKrw": decimal_json(known_krw),
    }


def current_holdings_context(payload):
    current = payload.get("currentHoldings") if isinstance(payload, dict) else {}
    if not isinstance(current, dict) or not current:
        return {
            "enabled": False,
            "ok": False,
            "positions": {},
            "accountCount": 0,
            "positionCount": 0,
            "collectedAt": "",
            "source": "",
        }
    positions = defaultdict(Decimal)
    accounts = current.get("accounts") if isinstance(current.get("accounts"), list) else []
    for account in accounts:
        if not isinstance(account, dict):
            continue
        account_seq = str(account.get("accountSeq") or account.get("account_seq") or "").strip()
        items = account.get("items") if isinstance(account.get("items"), list) else []
        for item in items:
            if not isinstance(item, dict):
                continue
            symbol = str(item.get("symbol") or "").strip()
            currency = str(item.get("currency") or "").strip()
            quantity = decimal_value(item.get("quantity"))
            if not account_seq or not symbol or not currency or abs(quantity) <= EPSILON:
                continue
            positions[(account_seq, currency, symbol)] += quantity
    return {
        "enabled": True,
        "ok": bool(positions) or bool(accounts),
        "positions": dict(positions),
        "accountCount": len(accounts),
        "positionCount": len([value for value in positions.values() if abs(value) > EPSILON]),
        "collectedAt": str(current.get("collectedAt") or ""),
        "source": str(current.get("source") or "tossinvest-holdings"),
    }


def reconcile_latest_rows_with_current_holdings(rows, current_context):
    if not current_context.get("enabled"):
        return rows, set(), {
            "enabled": False,
            "ok": False,
            "status": "not-provided",
        }
    current_positions = current_context.get("positions") or {}
    adjusted_rows = []
    excluded_keys = set()
    removed = []
    mismatched = []
    matched_count = 0
    for row in rows:
        key = (row["accountSeq"], row["currency"], row["symbol"])
        current_quantity = current_positions.get(key, Decimal("0"))
        quantity = row["quantity"]
        if quantity > EPSILON and current_quantity <= EPSILON:
            excluded_keys.add(key)
            removed.append(
                {
                    "accountSeq": row["accountSeq"],
                    "currency": row["currency"],
                    "symbol": row["symbol"],
                    "snapshotQuantityBeforeAdjustment": decimal_json(quantity),
                    "currentQuantity": "0",
                    "knownCostBasisRemoved": decimal_json(row["knownCostBasis"]),
                    "reason": "present in order replay but absent from current holdings",
                }
            )
            continue
        if abs(quantity - current_quantity) <= EPSILON:
            matched_count += 1
        elif current_quantity > EPSILON:
            mismatched.append(
                {
                    "accountSeq": row["accountSeq"],
                    "currency": row["currency"],
                    "symbol": row["symbol"],
                    "snapshotQuantity": decimal_json(quantity),
                    "currentQuantity": decimal_json(current_quantity),
                }
            )
        adjusted_rows.append(row)

    replay_keys = {(row["accountSeq"], row["currency"], row["symbol"]) for row in rows if row["quantity"] > EPSILON}
    only_in_current = [
        {
            "accountSeq": key[0],
            "currency": key[1],
            "symbol": key[2],
            "currentQuantity": decimal_json(quantity),
        }
        for key, quantity in sorted(current_positions.items())
        if abs(quantity) > EPSILON and key not in replay_keys
    ]

    return adjusted_rows, excluded_keys, {
        "enabled": True,
        "ok": not mismatched and not only_in_current,
        "status": "adjusted" if removed else "matched" if not mismatched and not only_in_current else "mismatch",
        "appliedScope": "all-snapshots",
        "source": current_context.get("source", ""),
        "collectedAt": current_context.get("collectedAt", ""),
        "currentPositionCount": current_context.get("positionCount", 0),
        "matchedPositionCount": matched_count,
        "removedZeroValuePositionCount": len(removed),
        "quantityMismatchCount": len(mismatched),
        "currentOnlyPositionCount": len(only_in_current),
        "removedZeroValuePositions": removed,
        "quantityMismatches": mismatched,
        "currentOnlyPositions": only_in_current,
    }



def load_trades(conn):
    rows = conn.execute(
        """
        SELECT
          account_seq,
          order_id,
          symbol,
          side,
          status,
          currency,
          filled_quantity,
          filled_amount,
          commission,
          tax,
          filled_at,
          ordered_at
        FROM orders
        WHERE CAST(COALESCE(NULLIF(filled_quantity, ''), '0') AS REAL) > 0
        ORDER BY COALESCE(filled_at, ordered_at), ordered_at, order_id
        """
    ).fetchall()
    trades = []
    for row in rows:
        event_at = parse_time(row["filled_at"] or row["ordered_at"])
        if not event_at:
            continue
        quantity = decimal_value(row["filled_quantity"])
        if quantity <= 0:
            continue
        side = str(row["side"] or "").upper()
        if side not in {"BUY", "SELL"}:
            continue
        trades.append(
            {
                "accountSeq": str(row["account_seq"] or ""),
                "orderId": str(row["order_id"] or ""),
                "symbol": str(row["symbol"] or "").strip(),
                "currency": str(row["currency"] or "").strip(),
                "side": side,
                "status": str(row["status"] or "").strip(),
                "eventAt": event_at,
                "orderedAt": parse_time(row["ordered_at"]),
                "quantity": quantity,
                "amount": decimal_value(row["filled_amount"]),
                "commission": decimal_value(row["commission"]),
                "tax": decimal_value(row["tax"]),
            }
        )
    return trades


def trade_key(trade):
    return (trade["accountSeq"], trade["currency"], trade["symbol"])


def opening_requirements(trades):
    cumulative = defaultdict(Decimal)
    minimum = defaultdict(Decimal)
    first_negative_at = {}
    for trade in trades:
        key = trade_key(trade)
        signed = trade["quantity"] if trade["side"] == "BUY" else -trade["quantity"]
        cumulative[key] += signed
        if cumulative[key] < minimum[key]:
            minimum[key] = cumulative[key]
            first_negative_at.setdefault(key, trade["eventAt"])
    requirements = {}
    for key, min_value in minimum.items():
        if min_value < -EPSILON:
            requirements[key] = {
                "quantity": -min_value,
                "firstNegativeAt": first_negative_at.get(key),
            }
    return requirements


def new_position_state(opening_quantity=Decimal("0")):
    return {
        "quantity": opening_quantity,
        "knownQuantity": Decimal("0"),
        "unknownQuantity": opening_quantity,
        "knownCostBasis": Decimal("0"),
        "buyAmount": Decimal("0"),
        "sellProceeds": Decimal("0"),
        "commission": Decimal("0"),
        "tax": Decimal("0"),
        "buyCount": 0,
        "sellCount": 0,
        "firstTradeAt": None,
        "lastTradeAt": None,
    }


def apply_trade(state, trade):
    quantity = trade["quantity"]
    amount = trade["amount"]
    commission = trade["commission"]
    tax = trade["tax"]
    event_at = trade["eventAt"]
    state["firstTradeAt"] = state["firstTradeAt"] or event_at
    state["lastTradeAt"] = event_at
    state["commission"] += commission
    state["tax"] += tax

    if trade["side"] == "BUY":
        gross_cost = amount + commission + tax
        state["quantity"] += quantity
        state["knownQuantity"] += quantity
        state["knownCostBasis"] += gross_cost
        state["buyAmount"] += amount
        state["buyCount"] += 1
        return

    state["quantity"] -= quantity
    state["sellProceeds"] += max(Decimal("0"), amount - commission - tax)
    state["sellCount"] += 1

    remaining_sell = quantity
    if state["unknownQuantity"] > 0:
        unknown_sold = min(state["unknownQuantity"], remaining_sell)
        state["unknownQuantity"] -= unknown_sold
        remaining_sell -= unknown_sold

    if remaining_sell > 0 and state["knownQuantity"] > 0:
        known_sold = min(state["knownQuantity"], remaining_sell)
        average_known_cost = state["knownCostBasis"] / state["knownQuantity"]
        state["knownCostBasis"] -= average_known_cost * known_sold
        state["knownQuantity"] -= known_sold
        remaining_sell -= known_sold

    if abs(state["quantity"]) < EPSILON:
        state["quantity"] = Decimal("0")
    if state["knownQuantity"] <= EPSILON:
        state["knownQuantity"] = Decimal("0")
        state["knownCostBasis"] = Decimal("0")
    if state["unknownQuantity"] <= EPSILON:
        state["unknownQuantity"] = Decimal("0")


def build_initial_positions(requirements, infer_opening):
    states = {}
    if not infer_opening:
        return states
    for key, info in requirements.items():
        states[key] = new_position_state(info["quantity"])
    return states


def replay_positions(trades, as_of=None, infer_opening=True):
    requirements = opening_requirements(trades)
    states = build_initial_positions(requirements, infer_opening)
    included = 0
    non_filled_statuses = defaultdict(int)
    latest_event = None
    for trade in trades:
        if as_of and trade["eventAt"] > as_of:
            break
        key = trade_key(trade)
        if key not in states:
            states[key] = new_position_state()
        apply_trade(states[key], trade)
        included += 1
        latest_event = trade["eventAt"]
        if trade["status"] != "FILLED":
            non_filled_statuses[trade["status"] or ""] += 1
    return states, {
        "includedTrades": included,
        "latestIncludedEventAt": latest_event,
        "openingRequirements": requirements,
        "nonFilledStatusesIncluded": dict(sorted(non_filled_statuses.items())),
    }


def position_rows(states, requirements, include_zero=False):
    rows = []
    for key, state in states.items():
        account_seq, currency, symbol = key
        quantity = state["quantity"]
        known_cost = state["knownCostBasis"]
        unknown_quantity = state["unknownQuantity"]
        if not include_zero and abs(quantity) < EPSILON and abs(known_cost) < EPSILON and abs(unknown_quantity) < EPSILON:
            continue
        average_known_cost = known_cost / state["knownQuantity"] if state["knownQuantity"] > EPSILON else Decimal("0")
        rows.append(
            {
                "accountSeq": account_seq,
                "currency": currency,
                "symbol": symbol,
                "quantity": quantity,
                "knownQuantity": state["knownQuantity"],
                "unknownQuantity": unknown_quantity,
                "openingQuantityRequired": requirements.get(key, {}).get("quantity", Decimal("0")),
                "knownCostBasis": known_cost,
                "averageKnownCost": average_known_cost,
                "buyAmount": state["buyAmount"],
                "sellProceeds": state["sellProceeds"],
                "commission": state["commission"],
                "tax": state["tax"],
                "buyCount": state["buyCount"],
                "sellCount": state["sellCount"],
                "firstTradeAt": state["firstTradeAt"],
                "lastTradeAt": state["lastTradeAt"],
            }
        )
    rows.sort(key=lambda item: (item["currency"], -abs(item["knownCostBasis"]), item["symbol"]))
    return rows


def serialize_position(row, fx_rate=None, market_context=None, at_time=None):
    converted = convert_known_cost(row, fx_rate)
    market = convert_market_value(row, market_candle_for(market_context, row["symbol"], at_time), fx_rate)
    return {
        "accountSeq": row["accountSeq"],
        "currency": row["currency"],
        "symbol": row["symbol"],
        "quantity": decimal_json(row["quantity"]),
        "knownQuantity": decimal_json(row["knownQuantity"]),
        "unknownQuantity": decimal_json(row["unknownQuantity"]),
        "openingQuantityRequired": decimal_json(row["openingQuantityRequired"]),
        "knownCostBasis": decimal_json(row["knownCostBasis"]),
        "usdKrwRate": converted["usdKrwRate"],
        "knownCostBasisUsd": converted["knownCostBasisUsd"],
        "knownCostBasisKrw": converted["knownCostBasisKrw"],
        "marketPrice": market["marketPrice"],
        "marketPriceDate": market["marketPriceDate"],
        "marketPriceCurrency": market["marketPriceCurrency"],
        "marketValue": market["marketValue"],
        "marketValueUsd": market["marketValueUsd"],
        "marketValueKrw": market["marketValueKrw"],
        "marketSource": market["marketSource"],
        "averageKnownCost": decimal_json(row["averageKnownCost"]),
        "buyAmount": decimal_json(row["buyAmount"]),
        "sellProceeds": decimal_json(row["sellProceeds"]),
        "commission": decimal_json(row["commission"]),
        "tax": decimal_json(row["tax"]),
        "buyCount": row["buyCount"],
        "sellCount": row["sellCount"],
        "firstTradeAt": format_time(row["firstTradeAt"]),
        "lastTradeAt": format_time(row["lastTradeAt"]),
    }


def portfolio_converted_totals(rows, fx_rate):
    if not fx_rate or fx_rate <= 0:
        return {
            "usdKrwRate": "",
            "knownCostBasisUsd": "",
            "knownCostBasisKrw": "",
            "convertedPositionCount": 0,
        }
    known_usd = Decimal("0")
    known_krw = Decimal("0")
    converted_count = 0
    for row in rows:
        converted = convert_known_cost(row, fx_rate)
        if not converted["knownCostBasisUsd"] or not converted["knownCostBasisKrw"]:
            continue
        known_usd += decimal_value(converted["knownCostBasisUsd"])
        known_krw += decimal_value(converted["knownCostBasisKrw"])
        converted_count += 1
    return {
        "usdKrwRate": decimal_json(fx_rate, "0.0001"),
        "knownCostBasisUsd": decimal_json(known_usd),
        "knownCostBasisKrw": decimal_json(known_krw),
        "convertedPositionCount": converted_count,
    }


def portfolio_totals(rows, fx_rate=None):
    totals = {}
    for row in rows:
        currency = row["currency"] or ""
        bucket = totals.setdefault(
            currency,
            {
                "positionCount": 0,
                "knownCostBasis": Decimal("0"),
                "knownCostBasisUsd": Decimal("0"),
                "knownCostBasisKrw": Decimal("0"),
                "unknownPositionCount": 0,
                "openingQuantityRequiredCount": 0,
                "convertedPositionCount": 0,
            },
        )
        if abs(row["quantity"]) > EPSILON:
            bucket["positionCount"] += 1
        bucket["knownCostBasis"] += row["knownCostBasis"]
        converted = convert_known_cost(row, fx_rate)
        if converted["knownCostBasisUsd"] and converted["knownCostBasisKrw"]:
            bucket["knownCostBasisUsd"] += decimal_value(converted["knownCostBasisUsd"])
            bucket["knownCostBasisKrw"] += decimal_value(converted["knownCostBasisKrw"])
            bucket["convertedPositionCount"] += 1
        if row["unknownQuantity"] > EPSILON:
            bucket["unknownPositionCount"] += 1
        if row["openingQuantityRequired"] > EPSILON:
            bucket["openingQuantityRequiredCount"] += 1
    serialized = {}
    for currency, value in sorted(totals.items()):
        item = {
            "positionCount": value["positionCount"],
            "knownCostBasis": decimal_json(value["knownCostBasis"]),
            "unknownPositionCount": value["unknownPositionCount"],
            "openingQuantityRequiredCount": value["openingQuantityRequiredCount"],
        }
        if fx_rate:
            item["knownCostBasisUsd"] = decimal_json(value["knownCostBasisUsd"])
            item["knownCostBasisKrw"] = decimal_json(value["knownCostBasisKrw"])
            item["convertedPositionCount"] = value["convertedPositionCount"]
        serialized[currency] = item
    return serialized


def portfolio_market_totals(serialized_rows):
    market_usd = Decimal("0")
    market_krw = Decimal("0")
    priced_count = 0
    for row in serialized_rows:
        usd = decimal_value(row.get("marketValueUsd"))
        krw = decimal_value(row.get("marketValueKrw"))
        if usd > 0 or krw > 0:
            priced_count += 1
        market_usd += usd
        market_krw += krw
    return {
        "marketValueUsd": decimal_json(market_usd) if market_usd > 0 else "",
        "marketValueKrw": decimal_json(market_krw) if market_krw > 0 else "",
        "pricedPositionCount": priced_count,
    }


def status_payload(conn, trades):
    requirements = opening_requirements(trades)
    sync_rows = [
        dict(row)
        for row in conn.execute(
            """
            SELECT account_seq, has_next, total_orders, last_successful_sync_at, last_error
            FROM sync_state
            ORDER BY account_seq
            """
        ).fetchall()
    ]
    status_counts = [
        dict(row)
        for row in conn.execute(
            """
            SELECT status, side, COUNT(*) AS count
            FROM orders
            WHERE CAST(COALESCE(NULLIF(filled_quantity, ''), '0') AS REAL) > 0
            GROUP BY status, side
            ORDER BY status, side
            """
        ).fetchall()
    ]
    return {
        "ok": True,
        "dbPath": str(DB_PATH.relative_to(GUIBUILD_ROOT)),
        "tradeCount": len(trades),
        "earliestTradeAt": format_time(trades[0]["eventAt"]) if trades else "",
        "latestTradeAt": format_time(trades[-1]["eventAt"]) if trades else "",
        "syncState": sync_rows,
        "openingRequirementCount": len(requirements),
        "openingRequirements": [
            {
                "accountSeq": key[0],
                "currency": key[1],
                "symbol": key[2],
                "quantity": decimal_json(value["quantity"]),
                "firstNegativeAt": format_time(value["firstNegativeAt"]),
            }
            for key, value in sorted(requirements.items())
        ],
        "filledStatusCounts": status_counts,
    }


def month_end_targets(trades, end_at=None):
    if not trades:
        return []
    first = trades[0]["eventAt"].astimezone(KST)
    latest = end_of_kst_day(end_at or trades[-1]["eventAt"]).astimezone(KST)
    latest_trade = trades[-1]["eventAt"]
    current = first.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    targets = []
    while current <= latest:
        next_month = (current.replace(day=28) + timedelta(days=4)).replace(
            day=1, hour=0, minute=0, second=0, microsecond=0
        )
        month_end = next_month - timedelta(seconds=1)
        if month_end > latest:
            targets.append(latest.astimezone(timezone.utc))
            break
        targets.append(month_end.astimezone(timezone.utc))
        current = next_month
    if targets and targets[-1] < latest_trade:
        targets.append(latest_trade)
    return targets


def day_end_targets(trades, end_at=None):
    if not trades:
        return []
    first = trades[0]["eventAt"].astimezone(KST)
    latest = end_of_kst_day(end_at or trades[-1]["eventAt"]).astimezone(KST)
    latest_trade = trades[-1]["eventAt"]
    current = first.replace(hour=23, minute=59, second=59, microsecond=0)
    targets = []
    while current <= latest:
        targets.append(current.astimezone(timezone.utc))
        current += timedelta(days=1)
    if not targets or targets[-1] < latest_trade:
        targets.append(latest_trade)
    return targets


def db_snapshot_payload(target, row, fx_context=None, market_context=None, run_id=""):
    fx_rate = fx_rate_for(fx_context, target)
    serialized = serialize_position(row, fx_rate, market_context, target)
    return {
        "snapshot_date": date_key(target),
        "snapshot_at": format_time(target),
        "account_seq": serialized["accountSeq"],
        "currency": serialized["currency"],
        "symbol": serialized["symbol"],
        "quantity": serialized["quantity"],
        "known_quantity": serialized["knownQuantity"],
        "unknown_quantity": serialized["unknownQuantity"],
        "opening_quantity_required": serialized["openingQuantityRequired"],
        "known_cost_basis": serialized["knownCostBasis"],
        "usd_krw_rate": serialized["usdKrwRate"],
        "known_cost_basis_usd": serialized["knownCostBasisUsd"],
        "known_cost_basis_krw": serialized["knownCostBasisKrw"],
        "market_price": serialized["marketPrice"],
        "market_price_date": serialized["marketPriceDate"],
        "market_price_currency": serialized["marketPriceCurrency"],
        "market_value": serialized["marketValue"],
        "market_value_usd": serialized["marketValueUsd"],
        "market_value_krw": serialized["marketValueKrw"],
        "market_source": serialized["marketSource"],
        "average_known_cost": serialized["averageKnownCost"],
        "buy_count": int(serialized["buyCount"] or 0),
        "sell_count": int(serialized["sellCount"] or 0),
        "rebuild_run_id": run_id,
        "updated_at": iso_now(),
    }


def upsert_snapshot_row(conn, frequency, payload):
    conn.execute(
        """
        INSERT INTO position_snapshots (
          frequency, snapshot_date, account_seq, currency, symbol, snapshot_at,
          quantity, known_quantity, unknown_quantity, opening_quantity_required,
          known_cost_basis, usd_krw_rate, known_cost_basis_usd, known_cost_basis_krw,
          market_price, market_price_date, market_price_currency, market_value,
          market_value_usd, market_value_krw, market_source, average_known_cost,
          buy_count, sell_count, rebuild_run_id, updated_at
        ) VALUES (
          :frequency, :snapshot_date, :account_seq, :currency, :symbol, :snapshot_at,
          :quantity, :known_quantity, :unknown_quantity, :opening_quantity_required,
          :known_cost_basis, :usd_krw_rate, :known_cost_basis_usd, :known_cost_basis_krw,
          :market_price, :market_price_date, :market_price_currency, :market_value,
          :market_value_usd, :market_value_krw, :market_source, :average_known_cost,
          :buy_count, :sell_count, :rebuild_run_id, :updated_at
        )
        ON CONFLICT(frequency, snapshot_date, account_seq, currency, symbol) DO UPDATE SET
          snapshot_at = excluded.snapshot_at,
          quantity = excluded.quantity,
          known_quantity = excluded.known_quantity,
          unknown_quantity = excluded.unknown_quantity,
          opening_quantity_required = excluded.opening_quantity_required,
          known_cost_basis = excluded.known_cost_basis,
          usd_krw_rate = excluded.usd_krw_rate,
          known_cost_basis_usd = excluded.known_cost_basis_usd,
          known_cost_basis_krw = excluded.known_cost_basis_krw,
          market_price = excluded.market_price,
          market_price_date = excluded.market_price_date,
          market_price_currency = excluded.market_price_currency,
          market_value = excluded.market_value,
          market_value_usd = excluded.market_value_usd,
          market_value_krw = excluded.market_value_krw,
          market_source = excluded.market_source,
          average_known_cost = excluded.average_known_cost,
          buy_count = excluded.buy_count,
          sell_count = excluded.sell_count,
          rebuild_run_id = excluded.rebuild_run_id,
          updated_at = excluded.updated_at
        """,
        {"frequency": frequency, **payload},
    )


def write_snapshot_db(
    conn,
    frequency,
    trades,
    targets,
    run_id,
    infer_opening=True,
    fx_context=None,
    market_context=None,
    excluded_keys=None,
    progress_callback=None,
    replace_frequency=True,
):
    requirements = opening_requirements(trades)
    states = build_initial_positions(requirements, infer_opening)
    trade_index = 0
    row_count = 0
    if replace_frequency:
        conn.execute("DELETE FROM position_snapshots WHERE frequency = ?", (frequency,))
    for target in targets:
        while trade_index < len(trades) and trades[trade_index]["eventAt"] <= target:
            trade = trades[trade_index]
            key = trade_key(trade)
            if key not in states:
                states[key] = new_position_state()
            apply_trade(states[key], trade)
            trade_index += 1
        target_row_count = 0
        for row in position_rows(states, requirements):
            key = (row["accountSeq"], row["currency"], row["symbol"])
            if excluded_keys and key in excluded_keys:
                continue
            upsert_snapshot_row(conn, frequency, db_snapshot_payload(target, row, fx_context, market_context, run_id))
            target_row_count += 1
        row_count += target_row_count
        if progress_callback:
            progress_callback(frequency, target, target_row_count)
    return row_count


def update_rebuild_run(conn, run_id, **fields):
    allowed = {
        "status",
        "updated_at",
        "finished_at",
        "requested_start_date",
        "requested_end_date",
        "latest_trade_at",
        "current_holdings_collected_at",
        "total_snapshots",
        "completed_snapshots",
        "total_snapshot_rows",
        "daily_target_count",
        "monthly_target_count",
        "included_trades",
        "position_count",
        "symbol_count",
        "priced_symbol_count",
        "missing_symbol_count",
        "error_count",
        "market_value_usd",
        "market_value_krw",
        "error",
        "metadata_json",
    }
    updates = {key: value for key, value in fields.items() if key in allowed}
    updates["updated_at"] = updates.get("updated_at") or iso_now()
    if not updates:
        return
    assignments = ", ".join(f"{key} = ?" for key in updates)
    conn.execute(f"UPDATE rebuild_runs SET {assignments} WHERE run_id = ?", [*updates.values(), run_id])


def create_rebuild_run(conn, run_id, trades, daily_targets, monthly_targets, end_at, payload):
    now = iso_now()
    current = payload.get("currentHoldings") if isinstance(payload, dict) else {}
    conn.execute(
        """
        INSERT INTO rebuild_runs (
          run_id, status, started_at, updated_at, requested_start_date, requested_end_date,
          latest_trade_at, current_holdings_collected_at, total_snapshots,
          completed_snapshots, total_snapshot_rows, daily_target_count, monthly_target_count,
          metadata_json
        ) VALUES (?, 'running', ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, '{}')
        """,
        (
            run_id,
            now,
            now,
            date_key(trades[0]["eventAt"]) if trades else "",
            date_key(end_at) if end_at else "",
            format_time(trades[-1]["eventAt"]) if trades else "",
            str(current.get("collectedAt") or "") if isinstance(current, dict) else "",
            len(daily_targets) + len(monthly_targets),
            len(daily_targets),
            len(monthly_targets),
        ),
    )
    conn.commit()


def latest_snapshot_date(conn, frequency):
    row = conn.execute(
        "SELECT MAX(snapshot_date) AS snapshot_date FROM position_snapshots WHERE frequency = ?",
        (frequency,),
    ).fetchone()
    return str(row["snapshot_date"] or "") if row else ""


def filter_targets_after_date(targets, snapshot_date):
    if not snapshot_date:
        return list(targets)
    return [target for target in targets if date_key(target) > snapshot_date]


def snapshot_market_gap_dates(conn, frequency):
    rows = conn.execute(
        """
        SELECT snapshot_date,
               SUM(
                 CASE
                   WHEN ABS(CAST(COALESCE(NULLIF(quantity, ''), '0') AS REAL)) > 0.000000001
                    AND (
                      CAST(COALESCE(NULLIF(market_value_krw, ''), '0') AS REAL)
                      + CAST(COALESCE(NULLIF(market_value_usd, ''), '0') AS REAL)
                      + CAST(COALESCE(NULLIF(market_value, ''), '0') AS REAL)
                    ) <= 0
                   THEN 1
                   ELSE 0
                 END
               ) AS missing_market_rows
        FROM position_snapshots
        WHERE frequency = ?
        GROUP BY snapshot_date
        HAVING missing_market_rows > 0
        ORDER BY snapshot_date
        """,
        (frequency,),
    ).fetchall()
    return {str(row["snapshot_date"] or "") for row in rows}


def rebuild_target_plan(conn, trades, daily_targets, monthly_targets, force_full=False):
    latest_trade_date = date_key(trades[-1]["eventAt"]) if trades else ""

    def plan_frequency(frequency, targets):
        latest_date = latest_snapshot_date(conn, frequency)
        can_incremental = (
            not force_full
            and latest_date
            and latest_trade_date
            and latest_trade_date <= latest_date
        )
        if can_incremental:
            gap_dates = snapshot_market_gap_dates(conn, frequency)
            pending_dates = {
                date_key(target)
                for target in targets
                if date_key(target) > latest_date or date_key(target) in gap_dates
            }
            return {
                "mode": "incremental-backfill" if gap_dates else "incremental",
                "latestSnapshotDate": latest_date,
                "targets": [target for target in targets if date_key(target) in pending_dates],
                "fullTargetCount": len(targets),
                "marketGapCount": len(gap_dates),
            }
        return {
            "mode": "full",
            "latestSnapshotDate": latest_date,
            "targets": list(targets),
            "fullTargetCount": len(targets),
            "marketGapCount": 0,
        }

    daily = plan_frequency("daily", daily_targets)
    monthly = plan_frequency("monthly", monthly_targets)
    if daily["mode"] == "full" or monthly["mode"] == "full":
        mode = "full"
    elif daily["mode"] == "incremental-backfill" or monthly["mode"] == "incremental-backfill":
        mode = "incremental-backfill"
    else:
        mode = "incremental"
    return {
        "forceFull": bool(force_full),
        "latestTradeDate": latest_trade_date,
        "daily": daily,
        "monthly": monthly,
        "mode": mode,
    }


def unique_trade_symbols(trades):
    return sorted({str(trade.get("symbol") or "").strip().upper() for trade in trades if str(trade.get("symbol") or "").strip()})


def reconstruction_end_at(payload, trades):
    if not trades:
        return None
    current = payload.get("currentHoldings") if isinstance(payload, dict) else {}
    collected_at = parse_time_or_none(current.get("collectedAt") if isinstance(current, dict) else "")
    now_kst = datetime.now(KST).astimezone(timezone.utc)
    end_at = collected_at or now_kst
    if end_at < trades[-1]["eventAt"]:
        end_at = trades[-1]["eventAt"]
    return end_at


def command_market_context(args):
    payload = read_payload()
    conn = connect()
    try:
        trades = load_trades(conn)
        end_at = reconstruction_end_at(payload, trades)
        all_daily_targets = day_end_targets(trades, end_at)
        all_monthly_targets = month_end_targets(trades, end_at)
        plan = rebuild_target_plan(
            conn,
            trades,
            all_daily_targets,
            all_monthly_targets,
            force_full=bool(payload.get("forceFull")) if isinstance(payload, dict) else False,
        )
        daily_targets = plan["daily"]["targets"]
        monthly_targets = plan["monthly"]["targets"]
        target_dates = sorted({date_key(target) for target in [*daily_targets, *monthly_targets]})
        symbols = unique_trade_symbols(trades)
        market_start = target_dates[0] if target_dates else date_key(end_at) if end_at else date_key(trades[0]["eventAt"]) if trades else ""
        market_end = target_dates[-1] if target_dates else date_key(end_at) if end_at else ""
        cached_symbols = cached_market_symbols(conn, symbols, market_start, market_end)
        cached_fx_dates = cached_fx_rate_dates(conn, target_dates)
        print(
            json.dumps(
                {
                    "ok": True,
                    "tradeCount": len(trades),
                    "symbolCount": len(symbols),
                    "symbols": symbols,
                    "currencies": sorted({str(trade.get("currency") or "").strip().upper() for trade in trades if trade.get("currency")}),
                    "startDate": market_start,
                    "latestTradeDate": date_key(trades[-1]["eventAt"]) if trades else "",
                    "endDate": market_end,
                    "endAt": format_time(end_at) if end_at else "",
                    "dailyTargetCount": len(daily_targets),
                    "monthlyTargetCount": len(monthly_targets),
                    "fullDailyTargetCount": len(all_daily_targets),
                    "fullMonthlyTargetCount": len(all_monthly_targets),
                    "rebuildMode": plan["mode"],
                    "dailyRebuildMode": plan["daily"]["mode"],
                    "monthlyRebuildMode": plan["monthly"]["mode"],
                    "latestDailySnapshotDate": plan["daily"]["latestSnapshotDate"],
                    "latestMonthlySnapshotDate": plan["monthly"]["latestSnapshotDate"],
                    "dailyMarketGapCount": plan["daily"]["marketGapCount"],
                    "monthlyMarketGapCount": plan["monthly"]["marketGapCount"],
                    "forceFull": plan["forceFull"],
                    "targetDates": target_dates,
                    "cachedSymbols": cached_symbols,
                    "missingSymbols": [symbol for symbol in symbols if symbol not in set(cached_symbols)],
                    "cachedFxDateCount": len(cached_fx_dates),
                    "missingFxDates": [day for day in target_dates if day not in set(cached_fx_dates)],
                },
                ensure_ascii=False,
                indent=2,
            )
        )
    finally:
        conn.close()


def command_status(args):
    conn = connect()
    try:
        trades = load_trades(conn)
        print(json.dumps(status_payload(conn, trades), ensure_ascii=False, indent=2))
    finally:
        conn.close()


def command_asof(args):
    payload = read_payload()
    conn = connect()
    try:
        trades = load_trades(conn)
        market_data = payload.get("marketData") if isinstance(payload, dict) else {}
        if market_data:
            apply_market_data_to_db(conn, market_data)
        as_of = parse_time(args.at)
        if as_of == "latest":
            as_of = trades[-1]["eventAt"] if trades else None
        fx_context = build_fx_context(trades, refresh=args.refresh_fx, enabled=not args.no_fx, market_data=market_data, end_at=as_of, conn=conn)
        market_context = build_market_context(unique_trade_symbols(trades), market_data, conn=conn)
        fx_rate = fx_rate_for(fx_context, as_of)
        states, meta = replay_positions(trades, as_of=as_of, infer_opening=not args.no_infer_opening)
        rows = position_rows(states, meta["openingRequirements"])
        serialized_rows = [serialize_position(row, fx_rate, market_context, as_of) for row in rows]
        payload = {
            "ok": True,
            "asOf": format_time(as_of) if as_of else "",
            "includedTrades": meta["includedTrades"],
            "latestIncludedEventAt": format_time(meta["latestIncludedEventAt"]),
            "positionCount": len([row for row in rows if abs(row["quantity"]) > EPSILON]),
            "totalsByCurrency": portfolio_totals(rows, fx_rate),
            "convertedTotals": portfolio_converted_totals(rows, fx_rate),
            "marketTotals": portfolio_market_totals(serialized_rows),
            "fx": public_fx_meta(fx_context, as_of),
            "marketData": public_market_meta(market_context),
            "nonFilledStatusesIncluded": meta["nonFilledStatusesIncluded"],
            "positions": serialized_rows[: max(0, int(args.top))] if args.top else serialized_rows,
            "positionRowsTotal": len(serialized_rows),
            "notes": [
                "knownCostBasis is based only on synced executions and does not include market prices.",
                "marketValue uses cached Toss Invest daily candles and USD/KRW exchange rates.",
                "unknownQuantity is the inferred opening/transfer quantity required to avoid impossible negative holdings.",
                "FX conversion uses cached Toss Invest USD/KRW exchange-rate data as KRW per 1 USD.",
            ],
        }
        if args.output:
            output_path = Path(args.output)
            if not output_path.is_absolute():
                output_path = GUIBUILD_ROOT / output_path
            output_path.parent.mkdir(parents=True, exist_ok=True)
            output_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
            payload["outputPath"] = display_path(output_path)
        print(json.dumps(payload, ensure_ascii=False, indent=2))
    finally:
        conn.close()


def command_monthly(args):
    payload = read_payload()
    conn = connect()
    try:
        trades = load_trades(conn)
        market_data = payload.get("marketData") if isinstance(payload, dict) else {}
        if market_data:
            apply_market_data_to_db(conn, market_data)
        end_at = reconstruction_end_at(payload, trades)
        fx_context = build_fx_context(trades, refresh=args.refresh_fx, enabled=not args.no_fx, market_data=market_data, end_at=end_at, conn=conn)
        market_context = build_market_context(unique_trade_symbols(trades), market_data, conn=conn)
        run_id = f"manual-monthly-{uuid.uuid4().hex[:12]}"
        count = write_snapshot_db(
            conn,
            "monthly",
            trades,
            month_end_targets(trades, end_at),
            run_id=run_id,
            infer_opening=not args.no_infer_opening,
            fx_context=fx_context,
            market_context=market_context,
        )
        print(
            json.dumps(
                {
                    "ok": True,
                    "dbPath": display_path(DB_PATH),
                    "tradeCount": len(trades),
                    "snapshotFrequency": "monthly",
                    "snapshotRowCount": count,
                    "fx": public_fx_meta(fx_context),
                    "marketData": public_market_meta(market_context),
                },
                ensure_ascii=False,
                indent=2,
            )
        )
    finally:
        conn.close()


def command_daily(args):
    payload = read_payload()
    conn = connect()
    try:
        trades = load_trades(conn)
        market_data = payload.get("marketData") if isinstance(payload, dict) else {}
        if market_data:
            apply_market_data_to_db(conn, market_data)
        end_at = reconstruction_end_at(payload, trades)
        fx_context = build_fx_context(trades, refresh=args.refresh_fx, enabled=not args.no_fx, market_data=market_data, end_at=end_at, conn=conn)
        market_context = build_market_context(unique_trade_symbols(trades), market_data, conn=conn)
        run_id = f"manual-daily-{uuid.uuid4().hex[:12]}"
        count = write_snapshot_db(
            conn,
            "daily",
            trades,
            day_end_targets(trades, end_at),
            run_id=run_id,
            infer_opening=not args.no_infer_opening,
            fx_context=fx_context,
            market_context=market_context,
        )
        print(
            json.dumps(
                {
                    "ok": True,
                    "dbPath": display_path(DB_PATH),
                    "tradeCount": len(trades),
                    "snapshotFrequency": "daily",
                    "snapshotRowCount": count,
                    "fx": public_fx_meta(fx_context),
                    "marketData": public_market_meta(market_context),
                },
                ensure_ascii=False,
                indent=2,
            )
        )
    finally:
        conn.close()


def command_rebuild(args):
    payload = read_payload()
    conn = connect()
    try:
        trades = load_trades(conn)
        as_of = reconstruction_end_at(payload, trades)
        all_daily_targets = day_end_targets(trades, as_of)
        all_monthly_targets = month_end_targets(trades, as_of)
        plan = rebuild_target_plan(
            conn,
            trades,
            all_daily_targets,
            all_monthly_targets,
            force_full=bool(payload.get("forceFull")) if isinstance(payload, dict) else False,
        )
        daily_targets = plan["daily"]["targets"]
        monthly_targets = plan["monthly"]["targets"]
        run_id = str(payload.get("runId") or f"rebuild-{uuid.uuid4().hex}")
        create_rebuild_run(conn, run_id, trades, daily_targets, monthly_targets, as_of, payload)
        completed_snapshots = 0
        total_snapshot_rows = 0

        def progress_callback(_frequency, _target, row_count):
            nonlocal completed_snapshots, total_snapshot_rows
            completed_snapshots += 1
            total_snapshot_rows += row_count
            update_rebuild_run(
                conn,
                run_id,
                completed_snapshots=completed_snapshots,
                total_snapshot_rows=total_snapshot_rows,
            )
            conn.commit()

        try:
            market_data = payload.get("marketData") if isinstance(payload, dict) else {}
            with conn:
                if market_data:
                    apply_market_data_to_db(conn, market_data)
            fx_context = build_fx_context(trades, refresh=args.refresh_fx, enabled=not args.no_fx, market_data=market_data, end_at=as_of, conn=conn)
            market_context = build_market_context(unique_trade_symbols(trades), market_data, conn=conn)
            fx_rate = fx_rate_for(fx_context, as_of)
            states, meta = replay_positions(trades, as_of=as_of, infer_opening=not args.no_infer_opening)
            rows = position_rows(states, meta["openingRequirements"])
            latest_rows, excluded_keys, reconciliation = reconcile_latest_rows_with_current_holdings(
                rows,
                current_holdings_context(payload),
            )
            serialized_positions = [serialize_position(row, fx_rate, market_context, as_of) for row in latest_rows]
            market_totals = portfolio_market_totals(serialized_positions)
            monthly_rows = write_snapshot_db(
                conn,
                "monthly",
                trades,
                monthly_targets,
                run_id=run_id,
                infer_opening=not args.no_infer_opening,
                fx_context=fx_context,
                market_context=market_context,
                excluded_keys=excluded_keys,
                progress_callback=progress_callback,
                replace_frequency=plan["monthly"]["mode"] == "full",
            )
            daily_rows = write_snapshot_db(
                conn,
                "daily",
                trades,
                daily_targets,
                run_id=run_id,
                infer_opening=not args.no_infer_opening,
                fx_context=fx_context,
                market_context=market_context,
                excluded_keys=excluded_keys,
                progress_callback=progress_callback,
                replace_frequency=plan["daily"]["mode"] == "full",
            )
            latest_payload = {
                "ok": True,
                "asOf": format_time(as_of) if as_of else "",
                "includedTrades": meta["includedTrades"],
                "latestIncludedEventAt": format_time(meta["latestIncludedEventAt"]),
                "positionCount": len([row for row in latest_rows if abs(row["quantity"]) > EPSILON]),
                "totalsByCurrency": portfolio_totals(latest_rows, fx_rate),
                "convertedTotals": portfolio_converted_totals(latest_rows, fx_rate),
                "marketTotals": market_totals,
                "fx": public_fx_meta(fx_context, as_of),
                "marketData": public_market_meta(market_context),
                "reconciliation": reconciliation,
                "nonFilledStatusesIncluded": meta["nonFilledStatusesIncluded"],
                "positionRowsTotal": len(latest_rows),
            }
            update_rebuild_run(
                conn,
                run_id,
                status="completed",
                finished_at=iso_now(),
                completed_snapshots=len(daily_targets) + len(monthly_targets),
                total_snapshot_rows=daily_rows + monthly_rows,
                included_trades=meta["includedTrades"],
                position_count=latest_payload["positionCount"],
                symbol_count=market_context.get("symbolCount", 0),
                priced_symbol_count=market_context.get("pricedSymbolCount", 0),
                missing_symbol_count=market_context.get("missingSymbolCount", 0),
                error_count=len(market_context.get("errors", []) or []),
                market_value_usd=market_totals.get("marketValueUsd", ""),
                market_value_krw=market_totals.get("marketValueKrw", ""),
                metadata_json=json.dumps(
                    {
                        "fx": latest_payload["fx"],
                        "marketData": latest_payload["marketData"],
                        "reconciliation": reconciliation,
                        "convertedTotals": latest_payload["convertedTotals"],
                        "rebuildPlan": {
                            "mode": plan["mode"],
                            "forceFull": plan["forceFull"],
                            "dailyRebuildMode": plan["daily"]["mode"],
                            "monthlyRebuildMode": plan["monthly"]["mode"],
                            "dailyMarketGapCount": plan["daily"]["marketGapCount"],
                            "monthlyMarketGapCount": plan["monthly"]["marketGapCount"],
                            "fullDailyTargetCount": plan["daily"]["fullTargetCount"],
                            "fullMonthlyTargetCount": plan["monthly"]["fullTargetCount"],
                        },
                    },
                    ensure_ascii=False,
                    separators=(",", ":"),
                ),
            )
            conn.commit()
            print(
                json.dumps(
                    {
                        "ok": True,
                        "runId": run_id,
                        "tradeCount": len(trades),
                        "asOf": latest_payload["asOf"],
                        "positionCount": latest_payload["positionCount"],
                        "convertedTotals": latest_payload["convertedTotals"],
                        "marketTotals": market_totals,
                        "fx": latest_payload["fx"],
                        "marketData": latest_payload["marketData"],
                        "reconciliation": latest_payload["reconciliation"],
                        "rebuildPlan": {
                            "mode": plan["mode"],
                            "forceFull": plan["forceFull"],
                            "dailyRebuildMode": plan["daily"]["mode"],
                            "monthlyRebuildMode": plan["monthly"]["mode"],
                            "dailyTargetCount": len(daily_targets),
                            "monthlyTargetCount": len(monthly_targets),
                            "dailyMarketGapCount": plan["daily"]["marketGapCount"],
                            "monthlyMarketGapCount": plan["monthly"]["marketGapCount"],
                            "fullDailyTargetCount": plan["daily"]["fullTargetCount"],
                            "fullMonthlyTargetCount": plan["monthly"]["fullTargetCount"],
                        },
                        "outputs": {
                            "db": display_path(DB_PATH),
                            "snapshots": "position_snapshots",
                            "runs": "rebuild_runs",
                        },
                    },
                    ensure_ascii=False,
                    indent=2,
                )
            )
        except Exception as error:
            update_rebuild_run(conn, run_id, status="failed", finished_at=iso_now(), error=str(error))
            conn.commit()
            raise
    finally:
        conn.close()


def normalize_arg(value):
    return str(value or "").strip().lower().replace(" ", "_").replace("-", "_")


def snapshot_row_count(conn, frequency):
    return int(
        conn.execute(
            "SELECT COUNT(*) AS count FROM position_snapshots WHERE frequency = ?",
            (frequency,),
        ).fetchone()["count"]
        or 0
    )


def rebuild_updated_at(conn):
    row = conn.execute("SELECT MAX(updated_at) AS updated_at FROM rebuild_runs").fetchone()
    return row["updated_at"] or ""


def metric_meta(currency, value_field=""):
    unit_label = "달러" if currency == "USD" else "원화"
    if str(value_field or "").startswith("marketValue"):
        return {
            "metric": "market_value",
            "metricLabel": "평가액",
            "valueLabel": f"{unit_label} 평가액",
            "valuationAvailable": True,
            "valuationReason": "",
            "valuationSource": "tossinvest-candles",
            "metricDescription": "토스증권 일봉과 USD/KRW 환율 캐시로 계산한 일별 평가액입니다.",
        }
    return {
        "metric": "known_cost_basis",
        "metricLabel": "투자 원금",
        "valueLabel": f"{unit_label} 투자 원금",
        "valuationAvailable": False,
        "valuationReason": "historical_market_prices_not_synced",
        "valuationSource": "",
        "metricDescription": "체결 내역으로 재구성한 투자 원금이며 시세 평가액은 포함하지 않습니다.",
    }


def history_value_fields(currency):
    requested_market = "marketValueUsd" if currency == "USD" else "marketValueKrw"
    fallback_market = "marketValueKrw" if currency == "USD" else "marketValueUsd"
    requested_cost = "knownCostBasisUsd" if currency == "USD" else "knownCostBasisKrw"
    fallback_cost = "knownCostBasisKrw" if currency == "USD" else "knownCostBasisUsd"
    return {
        "market": [requested_market, fallback_market, "rawMarketValue"],
        "cost": [requested_cost, fallback_cost, "rawKnownCostBasis"],
    }


def active_history_points(points):
    return [
        point
        for point in points
        if int(point.get("positionCount") or 0) > 0
        or any(
            decimal_value(point.get(field)) > 0
            for field in [
                "marketValueKrw",
                "marketValueUsd",
                "rawMarketValue",
                "knownCostBasisKrw",
                "knownCostBasisUsd",
                "rawKnownCostBasis",
            ]
        )
    ]


def field_positive_count(points, field):
    return sum(1 for point in points if decimal_value(point.get(field)) > 0)


def field_coverage(points, field):
    active = active_history_points(points)
    denominator = len(active) or len(points)
    count = field_positive_count(active or points, field)
    return {
        "field": field,
        "positivePoints": count,
        "activePoints": denominator,
        "ratio": (count / denominator) if denominator else 0,
    }


def choose_value_field(points, currency):
    fields = history_value_fields(currency)
    active = active_history_points(points)
    denominator = len(active) or len(points)
    if denominator:
        for field in fields["market"]:
            count = field_positive_count(active or points, field)
            if count > 0 and count / denominator >= 0.8:
                return field
    for field in fields["cost"]:
        if any(decimal_value(point.get(field)) > 0 for point in points):
            return field
    for field in fields["market"]:
        if any(decimal_value(point.get(field)) > 0 for point in points):
            return field
    return "rawKnownCostBasis"


def value_unit(value_field):
    if str(value_field or "").endswith("Usd"):
        return "USD"
    if str(value_field or "").endswith("Krw"):
        return "KRW"
    return "원본 통화"


def history_point_value(point, value_field, currency):
    fields = history_value_fields(currency)
    fallback_fields = [value_field]
    if value_field in fields["market"]:
        fallback_fields.extend(fields["cost"])
    else:
        fallback_fields.extend(fields["market"])
    for field in dict.fromkeys(fallback_fields):
        value = decimal_value(point.get(field))
        if value > 0:
            return float(value)
    return 0


def command_rebuild_status(args):
    conn = connect()
    try:
        row = conn.execute(
            """
            SELECT *
            FROM rebuild_runs
            ORDER BY datetime(updated_at) DESC, rowid DESC
            LIMIT 1
            """
        ).fetchone()
        if not row:
            print(json.dumps({"ok": True, "reconstruction": None}, ensure_ascii=False, indent=2))
            return
        total = int(row["total_snapshots"] or 0)
        completed = int(row["completed_snapshots"] or 0)
        status = str(row["status"] or "")
        reconstruction = {
            "ok": True if status == "completed" else False if status == "failed" else None,
            "status": status,
            "runId": row["run_id"],
            "startedAt": row["started_at"] or "",
            "updatedAt": row["updated_at"] or "",
            "finishedAt": row["finished_at"] or "",
            "asOf": row["requested_end_date"] or "",
            "includedTrades": int(row["included_trades"] or 0),
            "positionCount": int(row["position_count"] or 0),
            "outputPath": display_path(DB_PATH),
            "progress": {
                "completed": completed,
                "total": total,
                "percent": round((completed / total) * 100, 1) if total > 0 else 0,
                "rowCount": int(row["total_snapshot_rows"] or 0),
                "dailyTargetCount": int(row["daily_target_count"] or 0),
                "monthlyTargetCount": int(row["monthly_target_count"] or 0),
            },
            "marketTotals": {
                "marketValueUsd": row["market_value_usd"] or "",
                "marketValueKrw": row["market_value_krw"] or "",
            },
            "error": row["error"] or "",
        }
        print(json.dumps({"ok": True, "reconstruction": reconstruction}, ensure_ascii=False, indent=2))
    finally:
        conn.close()


def command_investment_history(args):
    conn = connect()
    try:
        timeframe = "1mo" if normalize_arg(args.timeframe) in {"1mo", "month", "monthly", "월", "월별"} else "1d"
        frequency = "monthly" if timeframe == "1mo" else "daily"
        currency = "USD" if normalize_arg(args.currency) in {"usd", "dollar", "dollars", "달러", "$"} else "KRW"
        start = str(args.start_date or "")[:10]
        end = str(args.end_date or "")[:10]
        where = ["frequency = ?"]
        params = [frequency]
        if end:
            where.append("snapshot_date <= ?")
            params.append(end)
        rows = conn.execute(
            f"""
            SELECT snapshot_date,
                   SUM(CAST(COALESCE(NULLIF(market_value_krw, ''), '0') AS REAL)) AS market_value_krw,
                   SUM(CAST(COALESCE(NULLIF(market_value_usd, ''), '0') AS REAL)) AS market_value_usd,
                   SUM(CAST(COALESCE(NULLIF(market_value, ''), '0') AS REAL)) AS raw_market_value,
                   SUM(CAST(COALESCE(NULLIF(known_cost_basis_krw, ''), '0') AS REAL)) AS known_cost_basis_krw,
                   SUM(CAST(COALESCE(NULLIF(known_cost_basis_usd, ''), '0') AS REAL)) AS known_cost_basis_usd,
                   SUM(CAST(COALESCE(NULLIF(known_cost_basis, ''), '0') AS REAL)) AS raw_known_cost_basis,
                   SUM(CASE WHEN ABS(CAST(COALESCE(NULLIF(quantity, ''), '0') AS REAL)) > 0 THEN 1 ELSE 0 END) AS position_count,
                   COUNT(*) AS row_count
            FROM position_snapshots
            WHERE {" AND ".join(where)}
            GROUP BY snapshot_date
            ORDER BY snapshot_date
            """,
            params,
        ).fetchall()
        points = [
            {
                "time": row["snapshot_date"],
                "marketValueKrw": float(row["market_value_krw"] or 0),
                "marketValueUsd": float(row["market_value_usd"] or 0),
                "rawMarketValue": float(row["raw_market_value"] or 0),
                "knownCostBasisKrw": float(row["known_cost_basis_krw"] or 0),
                "knownCostBasisUsd": float(row["known_cost_basis_usd"] or 0),
                "rawKnownCostBasis": float(row["raw_known_cost_basis"] or 0),
                "positionCount": int(row["position_count"] or 0),
                "rowCount": int(row["row_count"] or 0),
            }
            for row in rows
        ]
        filtered = [point for point in points if (not start or point["time"] >= start) and (not end or point["time"] <= end)]
        value_field = choose_value_field(filtered or points, currency)
        for point in filtered:
            point["value"] = history_point_value(point, value_field, currency)
        coverage = field_coverage(filtered or points, value_field)
        latest_date = conn.execute(
            "SELECT MAX(snapshot_date) AS latest FROM position_snapshots WHERE frequency = 'daily'"
        ).fetchone()["latest"] or ""
        payload = {
            "ok": True,
            "dataProvider": "토스 증권 Open API",
            "source": "position_snapshots",
            "sourcePath": display_path(DB_PATH),
            **metric_meta(currency, value_field),
            "updatedAt": rebuild_updated_at(conn),
            "timeframe": timeframe,
            "startDate": start,
            "endDate": end,
            "timelineEndDate": filtered[-1]["time"] if filtered else "",
            "latestHoldingsDate": latest_date,
            "currency": currency,
            "unit": value_unit(value_field),
            "valueField": value_field,
            "valueFieldCoverage": coverage,
            "rowCount": snapshot_row_count(conn, frequency),
            "pointCount": len(filtered),
            "points": filtered,
            "notes": [
                "Values use Toss daily candle mark-to-market data and cached Toss USD/KRW rates; missing points fall back to synced execution cost basis."
                if value_field.startswith("marketValue")
                else "Values use synced execution cost basis because market-value coverage is incomplete for the selected period."
            ],
        }
        print(json.dumps(payload, ensure_ascii=False, indent=2))
    finally:
        conn.close()


def command_position_status(args):
    conn = connect()
    try:
        currency = "USD" if normalize_arg(args.currency) in {"usd", "dollar", "dollars", "달러", "$"} else "KRW"
        view = "pie" if normalize_arg(args.view) in {"pie", "circle", "donut", "round", "원", "원형"} else "bar"
        end = str(args.end_date or "")[:10]
        if end:
            row = conn.execute(
                "SELECT MAX(snapshot_date) AS snapshot_date FROM position_snapshots WHERE frequency = 'daily' AND snapshot_date <= ?",
                (end,),
            ).fetchone()
        else:
            row = conn.execute(
                "SELECT MAX(snapshot_date) AS snapshot_date FROM position_snapshots WHERE frequency = 'daily'"
            ).fetchone()
        snapshot_date = row["snapshot_date"] or ""
        if not snapshot_date:
            print(
                json.dumps(
                    {
                        "ok": True,
                        "dataProvider": "토스 증권 Open API",
                        "source": "position_snapshots",
                        **metric_meta(currency),
                        "currency": currency,
                        "unit": currency,
                        "view": view,
                        "requestedEndDate": end,
                        "asOfDate": end,
                        "snapshotDate": "",
                        "totalValue": 0,
                        "positionCount": 0,
                        "items": [],
                        "error": "포지션 스냅샷 DB가 아직 없습니다.",
                    },
                    ensure_ascii=False,
                    indent=2,
                )
            )
            return
        rows = conn.execute(
            """
            SELECT *
            FROM position_snapshots
            WHERE frequency = 'daily' AND snapshot_date = ?
            ORDER BY symbol
            """,
            (snapshot_date,),
        ).fetchall()
        previous_row = conn.execute(
            """
            SELECT MAX(snapshot_date) AS snapshot_date
            FROM position_snapshots
            WHERE frequency = 'daily' AND snapshot_date < ?
            """,
            (snapshot_date,),
        ).fetchone()
        previous_snapshot_date = previous_row["snapshot_date"] or ""
        previous_rows = []
        if previous_snapshot_date:
            previous_rows = conn.execute(
                """
                SELECT *
                FROM position_snapshots
                WHERE frequency = 'daily' AND snapshot_date = ?
                """,
                (previous_snapshot_date,),
            ).fetchall()
        previous_by_key = {
            (row["account_seq"], row["currency"], row["symbol"]): row
            for row in previous_rows
        }
        requested_market = "market_value_usd" if currency == "USD" else "market_value_krw"
        fallback_market = "market_value_krw" if currency == "USD" else "market_value_usd"
        requested_cost = "known_cost_basis_usd" if currency == "USD" else "known_cost_basis_krw"
        fallback_cost = "known_cost_basis_krw" if currency == "USD" else "known_cost_basis_usd"

        requested_value_field = (
            "marketValueUsd" if requested_market == "market_value_usd" else "marketValueKrw"
        )
        fallback_value_field = (
            "marketValueUsd" if fallback_market == "market_value_usd" else "marketValueKrw"
        )
        requested_cost_field = (
            "knownCostBasisUsd" if requested_cost == "known_cost_basis_usd" else "knownCostBasisKrw"
        )
        fallback_cost_field = (
            "knownCostBasisUsd" if fallback_cost == "known_cost_basis_usd" else "knownCostBasisKrw"
        )
        value_field = (
            requested_value_field if any(decimal_value(row[requested_market]) > 0 for row in rows)
            else fallback_value_field if any(decimal_value(row[fallback_market]) > 0 for row in rows)
            else requested_cost_field if any(decimal_value(row[requested_cost]) > 0 for row in rows)
            else fallback_cost_field if any(decimal_value(row[fallback_cost]) > 0 for row in rows)
            else "knownCostBasis"
        )

        def row_value(row):
            for field in [requested_market, fallback_market, requested_cost, fallback_cost, "known_cost_basis"]:
                value = decimal_value(row[field])
                if value > 0:
                    return value
            return Decimal("0")

        def row_cost_value(row):
            for field in [requested_cost, fallback_cost, "known_cost_basis"]:
                value = decimal_value(row[field])
                if value > 0:
                    return value
            return Decimal("0")

        def converted_share_value(row, field_name):
            value = decimal_value(row[field_name])
            if value <= 0:
                return Decimal("0")
            row_currency = str(row["currency"] or "").upper()
            rate = decimal_value(row["usd_krw_rate"])
            if currency == "KRW" and row_currency == "USD" and rate > 0:
                return value * rate
            if currency == "USD" and row_currency == "KRW" and rate > 0:
                return value / rate
            return value

        def market_price_value(row):
            price = decimal_value(row["market_price"])
            if price <= 0:
                return Decimal("0")
            price_currency = str(row["market_price_currency"] or row["currency"] or "").upper()
            rate = decimal_value(row["usd_krw_rate"])
            if currency == "KRW" and price_currency == "USD" and rate > 0:
                return price * rate
            if currency == "USD" and price_currency == "KRW" and rate > 0:
                return price / rate
            return price

        items = []
        total_cost = Decimal("0")
        total_daily_profit = Decimal("0")
        total_previous_value = Decimal("0")
        for row in rows:
            quantity = abs(decimal_value(row["quantity"]))
            value = row_value(row)
            if quantity <= EPSILON or value <= 0:
                continue
            cost_value = row_cost_value(row)
            profit_value = value - cost_value
            profit_percent = (profit_value / cost_value) * Decimal("100") if cost_value > 0 else Decimal("0")
            previous = previous_by_key.get((row["account_seq"], row["currency"], row["symbol"]))
            previous_value = row_value(previous) if previous else Decimal("0")
            daily_profit = value - previous_value if previous_value > 0 else Decimal("0")
            daily_percent = (daily_profit / previous_value) * Decimal("100") if previous_value > 0 else Decimal("0")
            total_cost += cost_value
            total_daily_profit += daily_profit
            total_previous_value += previous_value
            items.append(
                {
                    "symbol": row["symbol"],
                    "label": row["symbol"],
                    "currency": row["currency"],
                    "quantity": float(quantity),
                    "value": float(value),
                    "costBasis": float(cost_value),
                    "profit": float(profit_value),
                    "profitPercent": float(profit_percent),
                    "dailyProfit": float(daily_profit),
                    "dailyReturnPercent": float(daily_percent),
                    "knownCostBasisKrw": float(decimal_value(row["known_cost_basis_krw"])),
                    "knownCostBasisUsd": float(decimal_value(row["known_cost_basis_usd"])),
                    "marketValueKrw": float(decimal_value(row["market_value_krw"])),
                    "marketValueUsd": float(decimal_value(row["market_value_usd"])),
                    "currentPrice": float(market_price_value(row)),
                    "marketPrice": float(decimal_value(row["market_price"])),
                    "marketPriceDate": row["market_price_date"] or "",
                    "marketPriceCurrency": row["market_price_currency"] or row["currency"],
                    "averageKnownCost": float(converted_share_value(row, "average_known_cost")),
                    "averageKnownCostRaw": float(decimal_value(row["average_known_cost"])),
                    "rowCount": 1,
                }
            )
        items = sorted(items, key=lambda entry: (-entry["value"], entry["symbol"]))
        total = sum(item["value"] for item in items)
        colors = ["#6d28d9", "#55b95f", "#ffd23f", "#78d7db", "#ef13c9", "#12aee8", "#1f63f2", "#f47aa0", "#0f8f86", "#ffb43b"]
        for index, item in enumerate(items):
            item["color"] = colors[index % len(colors)]
            item["percent"] = (item["value"] / total) * 100 if total > 0 else 0
        payload = {
            "ok": True,
            "dataProvider": "토스 증권 Open API",
            "source": "position_snapshots",
            "sourcePath": display_path(DB_PATH),
            **metric_meta(currency, value_field),
            "updatedAt": rebuild_updated_at(conn),
            "currency": currency,
            "unit": currency,
            "valueField": value_field,
            "view": view,
            "requestedEndDate": end,
            "asOfDate": end or snapshot_date,
            "snapshotDate": snapshot_date,
            "carriedForward": bool(end and end > snapshot_date),
            "latestHoldingsDate": snapshot_date,
            "totalValue": total,
            "totalCostBasis": float(total_cost),
            "totalProfit": float(Decimal(str(total)) - total_cost),
            "totalProfitPercent": float(((Decimal(str(total)) - total_cost) / total_cost) * Decimal("100")) if total_cost > 0 else 0,
            "dailyProfit": float(total_daily_profit),
            "dailyReturnPercent": float((total_daily_profit / total_previous_value) * Decimal("100")) if total_previous_value > 0 else 0,
            "previousSnapshotDate": previous_snapshot_date,
            "positionCount": len(items),
            "itemCount": len(items),
            "rowCount": len(rows),
            "items": items,
        }
        print(json.dumps(payload, ensure_ascii=False, indent=2))
    finally:
        conn.close()


def add_fx_arguments(parser):
    parser.add_argument("--no-fx", action="store_true", help="do not add USD/KRW conversion columns")
    parser.add_argument("--refresh-fx", action="store_true", help="ignore local Toss USD/KRW cache unless marketData is provided")


def main():
    parser = argparse.ArgumentParser(description="Reconstruct Toss Securities positions from the local order ledger.")
    subparsers = parser.add_subparsers(dest="command", required=True)

    status_parser = subparsers.add_parser("status")
    status_parser.set_defaults(func=command_status)

    market_context_parser = subparsers.add_parser("market-context")
    market_context_parser.set_defaults(func=command_market_context)

    rebuild_status_parser = subparsers.add_parser("rebuild-status")
    rebuild_status_parser.set_defaults(func=command_rebuild_status)

    history_parser = subparsers.add_parser("investment-history")
    history_parser.add_argument("--start-date", default="")
    history_parser.add_argument("--end-date", default="")
    history_parser.add_argument("--timeframe", default="1d")
    history_parser.add_argument("--currency", default="KRW")
    history_parser.set_defaults(func=command_investment_history)

    position_status_parser = subparsers.add_parser("position-status")
    position_status_parser.add_argument("--end-date", default="")
    position_status_parser.add_argument("--currency", default="KRW")
    position_status_parser.add_argument("--view", default="bar")
    position_status_parser.set_defaults(func=command_position_status)

    asof_parser = subparsers.add_parser("asof")
    asof_parser.add_argument("--at", default="latest", help="ISO timestamp, YYYY-MM-DD, or latest")
    asof_parser.add_argument("--top", type=int, default=40, help="number of position rows to print")
    asof_parser.add_argument("--output", default="")
    asof_parser.add_argument("--no-infer-opening", action="store_true")
    add_fx_arguments(asof_parser)
    asof_parser.set_defaults(func=command_asof)

    monthly_parser = subparsers.add_parser("monthly")
    monthly_parser.add_argument("--no-infer-opening", action="store_true")
    add_fx_arguments(monthly_parser)
    monthly_parser.set_defaults(func=command_monthly)

    daily_parser = subparsers.add_parser("daily")
    daily_parser.add_argument("--no-infer-opening", action="store_true")
    add_fx_arguments(daily_parser)
    daily_parser.set_defaults(func=command_daily)

    rebuild_parser = subparsers.add_parser("rebuild")
    rebuild_parser.add_argument("--no-infer-opening", action="store_true")
    add_fx_arguments(rebuild_parser)
    rebuild_parser.set_defaults(func=command_rebuild)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
