#!/usr/bin/env python3
import argparse
import json
import os
import sqlite3
import sys
import uuid
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from pathlib import Path


GUIBUILD_ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = GUIBUILD_ROOT / "data" / "invest-simulator"
DEFAULT_DB_PATH = DATA_DIR / "simulator.sqlite3"
DB_PATH = Path(os.environ.get("FINANCE_AGENT_GUI_INVEST_SIMULATOR_DB_PATH", DEFAULT_DB_PATH))
SCHEMA_VERSION = 2
INITIAL_KRW = Decimal("10000000")
INITIAL_USD = Decimal("0")

INSTRUMENT_COLUMN_DEFINITIONS = {
    "instrument_id": "TEXT NOT NULL DEFAULT ''",
    "provider": "TEXT NOT NULL DEFAULT ''",
    "venue": "TEXT NOT NULL DEFAULT ''",
    "asset_class": "TEXT NOT NULL DEFAULT ''",
    "base_asset": "TEXT NOT NULL DEFAULT ''",
    "quote_asset": "TEXT NOT NULL DEFAULT ''",
    "settlement_asset": "TEXT NOT NULL DEFAULT ''",
    "instrument_status": "TEXT NOT NULL DEFAULT ''",
    "session_policy": "TEXT NOT NULL DEFAULT ''",
}


def iso_now():
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def rel(path):
    try:
        return str(Path(path).resolve().relative_to(GUIBUILD_ROOT))
    except ValueError:
        return str(path)


def output(payload):
    print(json.dumps(payload, ensure_ascii=False, separators=(",", ":")))


def read_payload():
    raw = sys.stdin.read()
    if not raw.strip():
        return {}
    return json.loads(raw)


def clean_text(value, *, limit=160):
    text = str(value or "").replace("\n", " ").replace("\r", " ")
    text = " ".join(text.split()).strip()
    return text[:limit]


def clean_id(value):
    text = str(value or "").strip()
    return "".join(char for char in text if char.isalnum() or char in ("-", "_"))[:96]


def clean_currency(value, fallback="KRW"):
    text = str(value or "").strip().upper()
    return text if text in {"KRW", "USD"} else fallback


def clean_symbol(value):
    text = str(value or "").strip().upper()
    return "".join(char for char in text if char.isalnum() or char in (".", "-", "_"))[:40]


def clean_market(value):
    return clean_text(value, limit=40).upper()


def clean_instrument_id(value):
    text = str(value or "").strip()
    return "".join(char for char in text if char.isalnum() or char in (":", ".", "-", "_", "/"))[:160]


def clean_provider(value):
    text = str(value or "").strip().lower()
    return "".join(char for char in text if char.isalnum() or char in ("-", "_"))[:40]


def clean_asset_class(value):
    text = str(value or "").strip().lower()
    return "".join(char for char in text if char.isalnum() or char in ("-", "_"))[:40]


def clean_asset_code(value):
    return "".join(char for char in str(value or "").strip().upper() if char.isalnum() or char in (".", "-", "_"))[:40]


def clean_instrument_status(value):
    return clean_text(value, limit=40).upper()


def clean_session_policy(value):
    return clean_text(value, limit=40).lower()


def market_country(symbol, market, provider="", asset_class=""):
    symbol_text = clean_symbol(symbol)
    market_text = clean_market(market)
    provider_text = clean_provider(provider)
    asset_class_text = clean_asset_class(asset_class)
    if provider_text == "binance" or asset_class_text == "crypto":
        return "GLOBAL"
    if symbol_text.isdigit() and len(symbol_text) == 6:
        return "KR"
    if any(token in market_text for token in ("KOSPI", "KOSDAQ", "KONEX", "KRX", "KOREA", "SEOUL")):
        return "KR"
    if any(token in market_text for token in ("NASDAQ", "NYSE", "AMEX", "ARCA", "OTC", "BATS", "US")):
        return "US"
    if symbol_text and symbol_text[0].isalpha():
        return "US"
    return ""


def normalize_instrument_metadata(payload):
    source = payload if isinstance(payload, dict) else {}
    symbol = clean_symbol(source.get("symbol"))
    provider = clean_provider(source.get("provider"))
    venue = clean_market(source.get("venue") or source.get("market"))
    market = clean_market(source.get("market") or venue)
    asset_class = clean_asset_class(source.get("assetClass") or source.get("asset_class"))
    base_asset = clean_asset_code(source.get("baseAsset") or source.get("base_asset"))
    quote_asset = clean_asset_code(
        source.get("quoteAsset") or source.get("nativeQuoteAsset") or source.get("quote_asset")
    )
    settlement_asset = clean_asset_code(
        source.get("settlementAsset") or source.get("settlementCurrency") or source.get("currency")
    )
    status = clean_instrument_status(source.get("status") or source.get("instrumentStatus"))
    session_policy = clean_session_policy(source.get("sessionPolicy") or source.get("session_policy"))
    instrument_id = clean_instrument_id(source.get("instrumentId") or source.get("instrument_id"))

    if not provider and instrument_id.lower().startswith("binance:spot:"):
        provider = "binance"

    if provider == "binance":
        venue = "BINANCE_SPOT"
        market = "BINANCE_SPOT"
        asset_class = "crypto"
        if symbol:
            instrument_id = f"binance:spot:{symbol}"
        if quote_asset == "USDT":
            settlement_asset = "USD"
        session_policy = "24x7"

    display_symbol = clean_text(source.get("displaySymbol"), limit=80)
    if not display_symbol:
        display_symbol = f"{base_asset}/{quote_asset}" if base_asset and quote_asset else symbol
    source_name = clean_text(source.get("source"), limit=80)
    if not source_name and provider == "binance":
        source_name = "binance-market-data"
    return {
        "instrumentId": instrument_id,
        "provider": provider,
        "venue": venue,
        "assetClass": asset_class,
        "symbol": symbol,
        "displaySymbol": display_symbol,
        "baseAsset": base_asset,
        "quoteAsset": quote_asset,
        "nativeQuoteAsset": quote_asset,
        "settlementAsset": settlement_asset,
        "status": status,
        "sessionPolicy": session_policy,
        "market": market,
        "name": clean_text(source.get("symbolName") or source.get("name") or symbol, limit=120) or symbol,
        "englishName": clean_text(source.get("englishName"), limit=120),
        "source": source_name,
    }


def decimal_value(value, fallback=Decimal("0")):
    if value is None or value == "":
        return fallback
    try:
        number = Decimal(str(value).replace(",", "").strip())
    except (InvalidOperation, ValueError):
        return fallback
    if not number.is_finite():
        return fallback
    return number


def decimal_to_json(value):
    number = decimal_value(value)
    if number == number.to_integral_value():
        return int(number)
    return float(number)


def decimal_to_store(value):
    number = decimal_value(value)
    normalized = number.normalize()
    text = format(normalized, "f")
    return "0" if text == "-0" else text


def ensure_parent_dir():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)


def connect(create=False):
    if create:
        ensure_parent_dir()
    if not DB_PATH.exists() and not create:
        return None
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    try:
        init_db(conn)
    except Exception:
        conn.close()
        raise
    return conn


def ensure_table_columns(conn, table_name, definitions):
    existing_columns = {row["name"] for row in conn.execute(f"PRAGMA table_info({table_name})").fetchall()}
    for column_name, column_definition in definitions.items():
        if column_name in existing_columns:
            continue
        conn.execute(f"ALTER TABLE {table_name} ADD COLUMN {column_name} {column_definition}")


def init_db(conn):
    current_schema_version = int(conn.execute("PRAGMA user_version").fetchone()[0])
    if current_schema_version > SCHEMA_VERSION:
        raise RuntimeError(
            f"simulator schema version {current_schema_version} is newer than supported version {SCHEMA_VERSION}"
        )
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS simulator_accounts (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          base_currency TEXT NOT NULL DEFAULT 'KRW',
          status TEXT NOT NULL DEFAULT 'active',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          archived_at TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_simulator_accounts_status_created
          ON simulator_accounts (status, created_at);

        CREATE TABLE IF NOT EXISTS simulator_ledger_events (
          id TEXT PRIMARY KEY,
          simulator_id TEXT NOT NULL,
          instrument_id TEXT NOT NULL DEFAULT '',
          provider TEXT NOT NULL DEFAULT '',
          venue TEXT NOT NULL DEFAULT '',
          asset_class TEXT NOT NULL DEFAULT '',
          symbol TEXT NOT NULL DEFAULT '',
          base_asset TEXT NOT NULL DEFAULT '',
          quote_asset TEXT NOT NULL DEFAULT '',
          settlement_asset TEXT NOT NULL DEFAULT '',
          instrument_status TEXT NOT NULL DEFAULT '',
          session_policy TEXT NOT NULL DEFAULT '',
          event_type TEXT NOT NULL,
          occurred_at TEXT NOT NULL,
          payload_json TEXT NOT NULL,
          idempotency_key TEXT,
          source TEXT NOT NULL DEFAULT 'gui',
          reversal_of_event_id TEXT,
          created_at TEXT NOT NULL,
          FOREIGN KEY (simulator_id) REFERENCES simulator_accounts (id)
        );

        CREATE INDEX IF NOT EXISTS idx_simulator_ledger_events_account_time
          ON simulator_ledger_events (simulator_id, occurred_at, id);

        CREATE UNIQUE INDEX IF NOT EXISTS idx_simulator_ledger_events_idempotency
          ON simulator_ledger_events (simulator_id, idempotency_key)
          WHERE idempotency_key IS NOT NULL AND idempotency_key != '';

        CREATE TABLE IF NOT EXISTS simulator_orders (
          id TEXT PRIMARY KEY,
          simulator_id TEXT NOT NULL,
          instrument_id TEXT NOT NULL DEFAULT '',
          provider TEXT NOT NULL DEFAULT '',
          venue TEXT NOT NULL DEFAULT '',
          asset_class TEXT NOT NULL DEFAULT '',
          base_asset TEXT NOT NULL DEFAULT '',
          quote_asset TEXT NOT NULL DEFAULT '',
          settlement_asset TEXT NOT NULL DEFAULT '',
          instrument_status TEXT NOT NULL DEFAULT '',
          session_policy TEXT NOT NULL DEFAULT '',
          side TEXT NOT NULL,
          symbol TEXT NOT NULL,
          market TEXT NOT NULL DEFAULT '',
          order_type TEXT NOT NULL DEFAULT 'market',
          quantity TEXT,
          limit_price TEXT,
          currency TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT 'draft',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          raw_json TEXT NOT NULL DEFAULT '{}',
          FOREIGN KEY (simulator_id) REFERENCES simulator_accounts (id)
        );

        CREATE INDEX IF NOT EXISTS idx_simulator_orders_account_created
          ON simulator_orders (simulator_id, created_at DESC);

        CREATE TABLE IF NOT EXISTS simulator_trades (
          id TEXT PRIMARY KEY,
          simulator_id TEXT NOT NULL,
          order_id TEXT,
          instrument_id TEXT NOT NULL DEFAULT '',
          provider TEXT NOT NULL DEFAULT '',
          venue TEXT NOT NULL DEFAULT '',
          asset_class TEXT NOT NULL DEFAULT '',
          base_asset TEXT NOT NULL DEFAULT '',
          quote_asset TEXT NOT NULL DEFAULT '',
          settlement_asset TEXT NOT NULL DEFAULT '',
          instrument_status TEXT NOT NULL DEFAULT '',
          session_policy TEXT NOT NULL DEFAULT '',
          symbol TEXT NOT NULL,
          side TEXT NOT NULL,
          quantity TEXT NOT NULL,
          price TEXT NOT NULL,
          currency TEXT NOT NULL,
          fee_amount TEXT NOT NULL DEFAULT '0',
          fee_currency TEXT NOT NULL DEFAULT '',
          executed_at TEXT NOT NULL,
          ledger_event_id TEXT,
          raw_json TEXT NOT NULL DEFAULT '{}',
          FOREIGN KEY (simulator_id) REFERENCES simulator_accounts (id),
          FOREIGN KEY (order_id) REFERENCES simulator_orders (id),
          FOREIGN KEY (ledger_event_id) REFERENCES simulator_ledger_events (id)
        );

        CREATE INDEX IF NOT EXISTS idx_simulator_trades_account_executed
          ON simulator_trades (simulator_id, executed_at DESC);

        CREATE TABLE IF NOT EXISTS simulator_snapshots (
          id TEXT PRIMARY KEY,
          simulator_id TEXT NOT NULL,
          snapshot_at TEXT NOT NULL,
          cash_krw TEXT NOT NULL,
          cash_usd TEXT NOT NULL,
          positions_json TEXT NOT NULL DEFAULT '[]',
          valuation_json TEXT NOT NULL DEFAULT '{}',
          source_event_id TEXT,
          created_at TEXT NOT NULL,
          FOREIGN KEY (simulator_id) REFERENCES simulator_accounts (id),
          FOREIGN KEY (source_event_id) REFERENCES simulator_ledger_events (id)
        );

        CREATE INDEX IF NOT EXISTS idx_simulator_snapshots_account_time
          ON simulator_snapshots (simulator_id, snapshot_at DESC);
        """
    )
    with conn:
        ensure_table_columns(
            conn,
            "simulator_ledger_events",
            {**INSTRUMENT_COLUMN_DEFINITIONS, "symbol": "TEXT NOT NULL DEFAULT ''"},
        )
        ensure_table_columns(conn, "simulator_orders", INSTRUMENT_COLUMN_DEFINITIONS)
        ensure_table_columns(conn, "simulator_trades", INSTRUMENT_COLUMN_DEFINITIONS)
        conn.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_simulator_ledger_events_account_instrument_time
              ON simulator_ledger_events (simulator_id, instrument_id, occurred_at, id)
            """
        )
        conn.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_simulator_orders_account_instrument_created
              ON simulator_orders (simulator_id, instrument_id, created_at DESC)
            """
        )
        conn.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_simulator_trades_account_instrument_executed
              ON simulator_trades (simulator_id, instrument_id, executed_at DESC)
            """
        )
        conn.execute(f"PRAGMA user_version = {SCHEMA_VERSION}")


def public_paths():
    return {
        "dbPath": rel(DB_PATH),
        "schemaPath": "config/invest-simulator.schema.sql",
    }


def ledger_rows(conn, simulator_id):
    return conn.execute(
        """
        SELECT *
        FROM simulator_ledger_events
        WHERE simulator_id = ?
        ORDER BY occurred_at ASC, id ASC
        """,
        (simulator_id,),
    ).fetchall()


def decode_payload(row):
    try:
        return json.loads(row["payload_json"] or "{}")
    except json.JSONDecodeError:
        return {}


def decode_json_text(value):
    try:
        return json.loads(value or "{}")
    except json.JSONDecodeError:
        return {}


def row_value(row, key, fallback=""):
    if row is None or key not in row.keys():
        return fallback
    value = row[key]
    return fallback if value is None else value


def row_metadata_value(row, key, fallback=""):
    value = row_value(row, key, fallback)
    return fallback if value == "" else value


def instrument_metadata_from_row(row, raw=None):
    raw_payload = raw if isinstance(raw, dict) else {}
    metadata_payload = {
        **raw_payload,
        "instrumentId": row_metadata_value(row, "instrument_id", raw_payload.get("instrumentId", "")),
        "provider": row_metadata_value(row, "provider", raw_payload.get("provider", "")),
        "venue": row_metadata_value(row, "venue", raw_payload.get("venue", "")),
        "assetClass": row_metadata_value(row, "asset_class", raw_payload.get("assetClass", "")),
        "symbol": row_metadata_value(row, "symbol", raw_payload.get("symbol", "")),
        "baseAsset": row_metadata_value(row, "base_asset", raw_payload.get("baseAsset", "")),
        "quoteAsset": row_metadata_value(
            row,
            "quote_asset",
            raw_payload.get("quoteAsset") or raw_payload.get("nativeQuoteAsset", ""),
        ),
        "settlementAsset": row_metadata_value(
            row,
            "settlement_asset",
            raw_payload.get("settlementAsset") or raw_payload.get("settlementCurrency", ""),
        ),
        "status": row_metadata_value(row, "instrument_status", raw_payload.get("status", "")),
        "sessionPolicy": row_metadata_value(row, "session_policy", raw_payload.get("sessionPolicy", "")),
    }
    return normalize_instrument_metadata(metadata_payload)


def instrument_db_values(metadata):
    return (
        metadata.get("instrumentId", ""),
        metadata.get("provider", ""),
        metadata.get("venue", ""),
        metadata.get("assetClass", ""),
        metadata.get("baseAsset", ""),
        metadata.get("quoteAsset", ""),
        metadata.get("settlementAsset", ""),
        metadata.get("status", ""),
        metadata.get("sessionPolicy", ""),
    )


def ledger_instrument_db_values(metadata):
    return (
        metadata.get("instrumentId", ""),
        metadata.get("provider", ""),
        metadata.get("venue", ""),
        metadata.get("assetClass", ""),
        metadata.get("symbol", ""),
        metadata.get("baseAsset", ""),
        metadata.get("quoteAsset", ""),
        metadata.get("settlementAsset", ""),
        metadata.get("status", ""),
        metadata.get("sessionPolicy", ""),
    )


def public_instrument_metadata(metadata):
    return {
        "instrumentId": metadata.get("instrumentId", ""),
        "provider": metadata.get("provider", ""),
        "venue": metadata.get("venue", ""),
        "assetClass": metadata.get("assetClass", ""),
        "symbol": metadata.get("symbol", ""),
        "displaySymbol": metadata.get("displaySymbol", ""),
        "baseAsset": metadata.get("baseAsset", ""),
        "quoteAsset": metadata.get("quoteAsset", ""),
        "nativeQuoteAsset": metadata.get("quoteAsset", ""),
        "settlementAsset": metadata.get("settlementAsset", ""),
        "status": metadata.get("status", ""),
        "sessionPolicy": metadata.get("sessionPolicy", ""),
        "market": metadata.get("market", ""),
        "name": metadata.get("name", ""),
        "englishName": metadata.get("englishName", ""),
        "source": metadata.get("source", ""),
    }


def replay_cash(rows):
    cash_krw = Decimal("0")
    cash_usd = Decimal("0")
    for row in rows:
        event_type = row["event_type"]
        payload = decode_payload(row)
        if event_type == "initial_cash":
            cash_krw += decimal_value(payload.get("cashKrw"), Decimal("0"))
            cash_usd += decimal_value(payload.get("cashUsd"), Decimal("0"))
        elif event_type in {"cash_adjustment", "cash_deposit", "cash_withdrawal"}:
            cash_krw += decimal_value(payload.get("deltaKrw"), Decimal("0"))
            cash_usd += decimal_value(payload.get("deltaUsd"), Decimal("0"))
        elif event_type == "fx_exchange":
            from_currency = clean_currency(payload.get("fromCurrency"))
            to_currency = clean_currency(payload.get("toCurrency"), "USD")
            from_amount = decimal_value(payload.get("fromAmount"), Decimal("0"))
            to_amount = decimal_value(payload.get("toAmount"), Decimal("0"))
            fee_currency = clean_currency(payload.get("feeCurrency"), from_currency)
            fee_amount = decimal_value(payload.get("feeAmount"), Decimal("0"))
            if from_currency == "KRW":
                cash_krw -= from_amount
            else:
                cash_usd -= from_amount
            if to_currency == "KRW":
                cash_krw += to_amount
            else:
                cash_usd += to_amount
            if fee_currency == "KRW":
                cash_krw -= fee_amount
            else:
                cash_usd -= fee_amount
        elif event_type == "stock_buy":
            currency = clean_currency(payload.get("currency") or payload.get("settlementCurrency"), "USD")
            gross_amount = decimal_value(payload.get("grossAmount") or payload.get("settlementAmount"), Decimal("0"))
            fee_currency = clean_currency(payload.get("feeCurrency"), currency)
            fee_amount = decimal_value(payload.get("feeAmount"), Decimal("0"))
            if currency == "KRW":
                cash_krw -= gross_amount
            else:
                cash_usd -= gross_amount
            if fee_currency == "KRW":
                cash_krw -= fee_amount
            else:
                cash_usd -= fee_amount
        elif event_type == "stock_sell":
            currency = clean_currency(payload.get("currency") or payload.get("settlementCurrency"), "USD")
            gross_amount = decimal_value(payload.get("grossAmount") or payload.get("settlementAmount"), Decimal("0"))
            fee_currency = clean_currency(payload.get("feeCurrency"), currency)
            fee_amount = decimal_value(payload.get("feeAmount"), Decimal("0"))
            if currency == "KRW":
                cash_krw += gross_amount
            else:
                cash_usd += gross_amount
            if fee_currency == "KRW":
                cash_krw -= fee_amount
            else:
                cash_usd -= fee_amount
    return cash_krw, cash_usd


def trade_rows(conn, simulator_id):
    return conn.execute(
        """
        SELECT *
        FROM simulator_trades
        WHERE simulator_id = ?
        ORDER BY executed_at ASC, id ASC
        """,
        (simulator_id,),
    ).fetchall()


def positions_from_trades(conn, simulator_id):
    positions = {}
    for row in trade_rows(conn, simulator_id):
        raw = decode_json_text(row["raw_json"])
        instrument = instrument_metadata_from_row(row, raw)
        symbol = instrument["symbol"]
        if not symbol:
            continue
        side = str(row["side"] or "").lower()
        currency = clean_currency(row["currency"], "USD")
        instrument_id = instrument["instrumentId"]
        key = (
            ("instrument", instrument_id)
            if instrument_id
            else ("legacy", instrument["provider"], instrument["venue"], symbol, currency)
        )
        position = positions.setdefault(
            key,
            {
                **public_instrument_metadata(instrument),
                "symbol": symbol,
                "label": instrument["name"] or symbol,
                "marketCountry": clean_text(
                    raw.get("marketCountry")
                    or market_country(symbol, instrument["market"], instrument["provider"], instrument["assetClass"]),
                    limit=20,
                ),
                "currency": currency,
                "displayCurrency": currency,
                "quantity": Decimal("0"),
                "costBasis": Decimal("0"),
                "lastPrice": Decimal("0"),
                "lastExecutedAt": "",
                "lots": [],
            },
        )
        quantity = decimal_value(row["quantity"], Decimal("0"))
        price = decimal_value(row["price"], Decimal("0"))
        fee_currency = clean_currency(row["fee_currency"], currency)
        fee_amount = decimal_value(row["fee_amount"], Decimal("0"))
        gross_amount = decimal_value(raw.get("grossAmount"), quantity * price)
        if side == "buy":
            position["quantity"] += quantity
            lot_cost_basis = gross_amount
            if fee_currency == currency:
                lot_cost_basis += fee_amount
            position["costBasis"] += lot_cost_basis
            position["lots"].append(
                {
                    "side": "buy",
                    "quantity": decimal_to_json(quantity),
                    "price": decimal_to_json(price),
                    "grossAmount": decimal_to_json(gross_amount),
                    "costBasis": decimal_to_json(lot_cost_basis),
                    "feeAmount": decimal_to_json(fee_amount),
                    "feeCurrency": fee_currency,
                    "executedAt": row["executed_at"],
                    "orderId": row["order_id"] or "",
                    "tradeId": row["id"],
                    **public_instrument_metadata(instrument),
                }
            )
        elif side == "sell":
            if position["quantity"] > 0 and position["costBasis"] > 0:
                sold_quantity = min(quantity, position["quantity"])
                average_cost = position["costBasis"] / position["quantity"]
                position["costBasis"] -= average_cost * sold_quantity
                if position["costBasis"] < Decimal("0"):
                    position["costBasis"] = Decimal("0")
            position["quantity"] -= quantity
        if price > 0:
            position["lastPrice"] = price
        if row["executed_at"]:
            position["lastExecutedAt"] = row["executed_at"]
        for text_field in ("name", "symbolName", "englishName", "market", "marketCountry"):
            value = raw.get(text_field)
            if not value:
                continue
            if text_field in {"name", "symbolName"}:
                position["label"] = clean_text(value, limit=120) or position["label"]
            elif text_field == "englishName":
                position["englishName"] = clean_text(value, limit=120)
            elif text_field == "market":
                position["market"] = clean_market(value)
            elif text_field == "marketCountry":
                position["marketCountry"] = clean_text(value, limit=20)

    items = []
    for position in positions.values():
        quantity = position["quantity"]
        if quantity <= 0:
            continue
        current_price = position["lastPrice"]
        value = quantity * current_price
        cost_basis = position["costBasis"]
        profit = value - cost_basis
        profit_percent = (profit / cost_basis * Decimal("100")) if cost_basis else Decimal("0")
        average_cost = cost_basis / quantity if quantity else Decimal("0")
        currency = position["currency"]
        item = {
            **public_instrument_metadata(position),
            "symbol": position["symbol"],
            "label": position["label"],
            "englishName": position["englishName"],
            "market": position["market"],
            "marketCountry": position["marketCountry"]
            or market_country(
                position["symbol"],
                position["market"],
                position.get("provider"),
                position.get("assetClass"),
            ),
            "currency": currency,
            "displayCurrency": currency,
            "quantity": decimal_to_json(quantity),
            "currentPrice": decimal_to_json(current_price),
            "averageKnownCost": decimal_to_json(average_cost),
            "value": decimal_to_json(value),
            "rawValue": decimal_to_json(value),
            "costBasis": decimal_to_json(cost_basis),
            "profit": decimal_to_json(profit),
            "profitPercent": decimal_to_json(profit_percent),
            "dailyProfit": 0,
            "dailyReturnPercent": 0,
            "currentPriceTimestamp": position["lastExecutedAt"],
            "lots": position["lots"],
            "marketValueKrw": decimal_to_json(value if currency == "KRW" else Decimal("0")),
            "marketValueUsd": decimal_to_json(value if currency == "USD" else Decimal("0")),
            "knownCostBasisKrw": decimal_to_json(cost_basis if currency == "KRW" else Decimal("0")),
            "knownCostBasisUsd": decimal_to_json(cost_basis if currency == "USD" else Decimal("0")),
        }
        items.append(item)
    return sorted(items, key=lambda item: (item.get("marketCountry") or "", item.get("symbol") or ""))


def totals_from_items(items):
    totals = {
        "totalValueKrw": Decimal("0"),
        "totalValueUsd": Decimal("0"),
        "totalCostBasisKrw": Decimal("0"),
        "totalCostBasisUsd": Decimal("0"),
        "totalProfitKrw": Decimal("0"),
        "totalProfitUsd": Decimal("0"),
    }
    for item in items:
        currency = clean_currency(item.get("currency"), "KRW")
        value = decimal_value(item.get("value"), Decimal("0"))
        cost_basis = decimal_value(item.get("costBasis"), Decimal("0"))
        profit = decimal_value(item.get("profit"), Decimal("0"))
        if currency == "USD":
            totals["totalValueUsd"] += value
            totals["totalCostBasisUsd"] += cost_basis
            totals["totalProfitUsd"] += profit
        else:
            totals["totalValueKrw"] += value
            totals["totalCostBasisKrw"] += cost_basis
            totals["totalProfitKrw"] += profit
    return {key: decimal_to_json(value) for key, value in totals.items()}


def account_snapshot(conn, row):
    rows = ledger_rows(conn, row["id"])
    cash_krw, cash_usd = replay_cash(rows)
    items = positions_from_trades(conn, row["id"])
    totals = totals_from_items(items)
    return {
        "id": row["id"],
        "name": row["name"],
        "baseCurrency": row["base_currency"],
        "status": row["status"],
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
        "archivedAt": row["archived_at"] or "",
        "cashKrw": decimal_to_json(cash_krw),
        "cashUsd": decimal_to_json(cash_usd),
        "balances": {
            "KRW": decimal_to_json(cash_krw),
            "USD": decimal_to_json(cash_usd),
        },
        "items": items,
        "positionCount": len(items),
        **totals,
        "ledgerEventCount": len(rows),
    }


def list_accounts(conn):
    rows = conn.execute(
        """
        SELECT *
        FROM simulator_accounts
        WHERE status = 'active'
        ORDER BY created_at ASC, id ASC
        """
    ).fetchall()
    return [account_snapshot(conn, row) for row in rows]


def get_account_row(conn, simulator_id):
    return conn.execute("SELECT * FROM simulator_accounts WHERE id = ?", (simulator_id,)).fetchone()


def next_default_name(conn):
    count = conn.execute("SELECT COUNT(*) AS count FROM simulator_accounts").fetchone()["count"]
    return f"투자 시뮬레이터 {int(count) + 1}"


def generate_id(prefix):
    return f"{prefix}_{uuid.uuid4().hex}"


def create_account(conn, payload):
    requested_id = clean_id(payload.get("id"))
    account_id = requested_id or generate_id("sim")
    existing = get_account_row(conn, account_id)
    if existing:
        return account_snapshot(conn, existing), False

    name = clean_text(payload.get("name"), limit=80) or next_default_name(conn)
    base_currency = clean_currency(payload.get("baseCurrency"), "KRW")
    initial_krw = decimal_value(payload.get("initialKrw"), INITIAL_KRW)
    initial_usd = decimal_value(payload.get("initialUsd"), INITIAL_USD)
    if initial_krw < 0 or initial_usd < 0:
        raise ValueError("initial cash balances must be zero or positive")
    now = iso_now()
    idempotency_key = clean_text(payload.get("idempotencyKey"), limit=160) or f"create:{account_id}"
    event_payload = {
        "cashKrw": decimal_to_store(initial_krw),
        "cashUsd": decimal_to_store(initial_usd),
        "memo": "initial simulator funding",
    }
    with conn:
        conn.execute(
            """
            INSERT INTO simulator_accounts (
              id, name, base_currency, status, created_at, updated_at, archived_at
            )
            VALUES (?, ?, ?, 'active', ?, ?, NULL)
            """,
            (account_id, name, base_currency, now, now),
        )
        conn.execute(
            """
            INSERT INTO simulator_ledger_events (
              id, simulator_id, event_type, occurred_at, payload_json,
              idempotency_key, source, reversal_of_event_id, created_at
            )
            VALUES (?, ?, 'initial_cash', ?, ?, ?, 'gui', NULL, ?)
            """,
            (
                generate_id("evt"),
                account_id,
                now,
                json.dumps(event_payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")),
                idempotency_key,
                now,
            ),
        )
    return account_snapshot(conn, get_account_row(conn, account_id)), True


def rename_account(conn, payload):
    simulator_id = clean_id(payload.get("simulatorId") or payload.get("id"))
    if not simulator_id:
        raise ValueError("simulatorId is required")
    row = get_account_row(conn, simulator_id)
    if not row or row["status"] != "active":
        raise ValueError("active simulator account not found")

    name = clean_text(payload.get("name"), limit=80)
    if not name:
        raise ValueError("simulator account name is required")
    if name == row["name"]:
        return account_snapshot(conn, row), False

    now = iso_now()
    event_payload = {
        "previousName": row["name"],
        "name": name,
        "memo": "simulator account renamed",
    }
    with conn:
        conn.execute(
            "UPDATE simulator_accounts SET name = ?, updated_at = ? WHERE id = ?",
            (name, now, simulator_id),
        )
        conn.execute(
            """
            INSERT INTO simulator_ledger_events (
              id, simulator_id, event_type, occurred_at, payload_json,
              idempotency_key, source, reversal_of_event_id, created_at
            )
            VALUES (?, ?, 'account_renamed', ?, ?, ?, 'gui', NULL, ?)
            """,
            (
                generate_id("evt"),
                simulator_id,
                now,
                json.dumps(event_payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")),
                f"rename:{simulator_id}:{now}",
                now,
            ),
        )
    return account_snapshot(conn, get_account_row(conn, simulator_id)), True


def exchange_cash(conn, payload):
    simulator_id = clean_id(payload.get("simulatorId") or payload.get("id"))
    if not simulator_id:
        raise ValueError("simulatorId is required")
    row = get_account_row(conn, simulator_id)
    if not row or row["status"] != "active":
        raise ValueError("active simulator account not found")

    from_currency = clean_currency(payload.get("fromCurrency"))
    to_currency = clean_currency(payload.get("toCurrency"), "USD" if from_currency == "KRW" else "KRW")
    if from_currency not in {"KRW", "USD"} or to_currency not in {"KRW", "USD"}:
        raise ValueError("currency must be KRW or USD")
    if from_currency == to_currency:
        raise ValueError("fromCurrency and toCurrency must be different")

    from_amount = decimal_value(payload.get("fromAmount"), Decimal("0"))
    to_amount = decimal_value(payload.get("toAmount"), Decimal("0"))
    rate = decimal_value(payload.get("rate"), Decimal("0"))
    fee_currency = clean_currency(payload.get("feeCurrency"), from_currency)
    fee_amount = decimal_value(payload.get("feeAmount"), Decimal("0"))
    if from_amount <= 0 or to_amount <= 0:
        raise ValueError("exchange amounts must be positive")
    if rate <= 0:
        raise ValueError("rate must be positive")
    if fee_currency not in {"KRW", "USD"}:
        raise ValueError("feeCurrency must be KRW or USD")
    if fee_amount < 0:
        raise ValueError("feeAmount must be zero or positive")

    snapshot = account_snapshot(conn, row)
    available_by_currency = {
        "KRW": decimal_value(snapshot.get("cashKrw"), Decimal("0")),
        "USD": decimal_value(snapshot.get("cashUsd"), Decimal("0")),
    }
    deltas = {"KRW": Decimal("0"), "USD": Decimal("0")}
    deltas[from_currency] -= from_amount
    deltas[to_currency] += to_amount
    deltas[fee_currency] -= fee_amount
    for currency, delta in deltas.items():
        if available_by_currency[currency] + delta < Decimal("0"):
            raise ValueError(f"insufficient {currency} cash balance")

    now = iso_now()
    idempotency_key = clean_text(payload.get("idempotencyKey"), limit=160) or f"fx:{simulator_id}:{now}"
    event_payload = {
        "fromCurrency": from_currency,
        "toCurrency": to_currency,
        "fromAmount": decimal_to_store(from_amount),
        "toAmount": decimal_to_store(to_amount),
        "rate": decimal_to_store(rate),
        "feeCurrency": fee_currency,
        "feeAmount": decimal_to_store(fee_amount),
        "memo": clean_text(payload.get("memo"), limit=160) or "simulator fx exchange",
    }
    with conn:
        conn.execute(
            """
            INSERT INTO simulator_ledger_events (
              id, simulator_id, event_type, occurred_at, payload_json,
              idempotency_key, source, reversal_of_event_id, created_at
            )
            VALUES (?, ?, 'fx_exchange', ?, ?, ?, 'gui', NULL, ?)
            """,
            (
                generate_id("evt"),
                simulator_id,
                now,
                json.dumps(event_payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")),
                idempotency_key,
                now,
            ),
        )
        conn.execute(
            "UPDATE simulator_accounts SET updated_at = ? WHERE id = ?",
            (now, simulator_id),
        )
    return account_snapshot(conn, get_account_row(conn, simulator_id)), True


def existing_event_for_idempotency(conn, simulator_id, idempotency_key):
    if not idempotency_key:
        return None
    return conn.execute(
        """
        SELECT *
        FROM simulator_ledger_events
        WHERE simulator_id = ? AND idempotency_key = ?
        LIMIT 1
        """,
        (simulator_id, idempotency_key),
    ).fetchone()


def public_order(row):
    raw = decode_json_text(row["raw_json"])
    instrument = instrument_metadata_from_row(row, raw)
    limit_price = row["limit_price"]
    return {
        "id": row["id"],
        "simulatorId": row["simulator_id"],
        **public_instrument_metadata(instrument),
        "side": row["side"],
        "orderType": row["order_type"],
        "quantity": decimal_to_json(row["quantity"]),
        "limitPrice": None if limit_price is None else decimal_to_json(limit_price),
        "currency": row["currency"],
        "status": row["status"],
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
        "raw": raw,
    }


def public_trade(row):
    raw = decode_json_text(row["raw_json"])
    instrument = instrument_metadata_from_row(row, raw)
    return {
        "id": row["id"],
        "simulatorId": row["simulator_id"],
        "orderId": row["order_id"] or "",
        **public_instrument_metadata(instrument),
        "side": row["side"],
        "quantity": decimal_to_json(row["quantity"]),
        "price": decimal_to_json(row["price"]),
        "currency": row["currency"],
        "feeAmount": decimal_to_json(row["fee_amount"]),
        "feeCurrency": row["fee_currency"],
        "executedAt": row["executed_at"],
        "ledgerEventId": row["ledger_event_id"] or "",
        "raw": raw,
    }


def buy_stock(conn, payload):
    simulator_id = clean_id(payload.get("simulatorId") or payload.get("id"))
    if not simulator_id:
        raise ValueError("simulatorId is required")
    row = get_account_row(conn, simulator_id)
    if not row or row["status"] != "active":
        raise ValueError("active simulator account not found")

    instrument = normalize_instrument_metadata(payload)
    symbol = instrument["symbol"]
    if not symbol:
        raise ValueError("symbol is required")
    if instrument["provider"] and not instrument["instrumentId"]:
        raise ValueError("instrumentId is required when provider is set")
    if instrument["provider"] == "binance" and instrument["status"] != "TRADING":
        raise ValueError("Binance Spot instrument status must be TRADING")
    market = instrument["market"]
    market_country_value = (
        market_country(symbol, market, instrument["provider"], instrument["assetClass"])
        if instrument["provider"] or instrument["assetClass"]
        else clean_text(payload.get("marketCountry") or market_country(symbol, market), limit=20).upper()
    )
    currency = clean_currency(
        instrument["settlementAsset"] or payload.get("settlementCurrency") or payload.get("currency"),
        "USD",
    )
    if market_country_value == "KR" and currency != "KRW":
        raise ValueError("Korean stocks must settle in KRW")
    if market_country_value == "US" and currency != "USD":
        raise ValueError("US stocks must settle in USD")
    price_currency = clean_currency(payload.get("priceCurrency"), currency)
    if price_currency != currency:
        raise ValueError("execution price currency must match settlement currency")

    now = iso_now()
    idempotency_key = clean_text(payload.get("idempotencyKey"), limit=160) or f"buy:{simulator_id}:{uuid.uuid4().hex}"
    existing_event = existing_event_for_idempotency(conn, simulator_id, idempotency_key)
    if existing_event:
        return account_snapshot(conn, row), False, None, None

    price = decimal_value(payload.get("price") or payload.get("executionPrice"), Decimal("0"))
    gross_amount = decimal_value(
        payload.get("settlementAmount") or payload.get("grossAmount") or payload.get("amount"),
        Decimal("0"),
    )
    quantity = decimal_value(payload.get("quantity"), Decimal("0"))
    if price <= 0:
        raise ValueError("execution price must be positive")
    if gross_amount <= 0 and quantity > 0:
        gross_amount = quantity * price
    if quantity <= 0 and gross_amount > 0:
        quantity = gross_amount / price
    if gross_amount <= 0 or quantity <= 0:
        raise ValueError("buy amount and quantity must be positive")
    calculated_gross = quantity * price
    gross_tolerance = max(Decimal("0.01") if currency == "USD" else Decimal("1"), gross_amount * Decimal("0.00000001"))
    if abs(calculated_gross - gross_amount) > gross_tolerance:
        raise ValueError("buy amount, quantity, and execution price are inconsistent")

    fee_currency = clean_currency(payload.get("feeCurrency"), currency)
    fee_amount = decimal_value(payload.get("feeAmount"), Decimal("0"))
    fee_assumption = clean_text(payload.get("feeAssumption"), limit=80)
    if instrument["provider"] == "binance":
        fee_currency = "USD"
        fee_amount = Decimal("0")
        fee_assumption = "zero-no-public-account-rate"
    if fee_amount < 0:
        raise ValueError("feeAmount must be zero or positive")

    snapshot = account_snapshot(conn, row)
    available_by_currency = {
        "KRW": decimal_value(snapshot.get("cashKrw"), Decimal("0")),
        "USD": decimal_value(snapshot.get("cashUsd"), Decimal("0")),
    }
    required_by_currency = {"KRW": Decimal("0"), "USD": Decimal("0")}
    required_by_currency[currency] += gross_amount
    required_by_currency[fee_currency] += fee_amount
    for required_currency, required_amount in required_by_currency.items():
        if available_by_currency[required_currency] < required_amount:
            raise ValueError(f"insufficient {required_currency} cash balance")

    order_id = generate_id("ord")
    trade_id = generate_id("trd")
    event_id = generate_id("evt")
    raw_payload = {
        **public_instrument_metadata(instrument),
        "market": market,
        "marketCountry": market_country_value,
        "orderUnit": clean_currency(payload.get("orderUnit"), currency),
        "orderAmount": decimal_to_store(decimal_value(payload.get("orderAmount"), gross_amount)),
        "settlementCurrency": currency,
        "grossAmount": decimal_to_store(gross_amount),
        "price": decimal_to_store(price),
        "priceCurrency": currency,
        "quantity": decimal_to_store(quantity),
        "feeCurrency": fee_currency,
        "feeAmount": decimal_to_store(fee_amount),
        "feeAssumption": fee_assumption,
        "marketSession": clean_text(payload.get("marketSession"), limit=40) or instrument["sessionPolicy"],
        "priceTimestamp": clean_text(payload.get("priceTimestamp"), limit=80),
        "priceSource": clean_text(payload.get("priceSource"), limit=80)
        or ("binance-market-data" if instrument["provider"] == "binance" else "tossinvest-prices"),
        "memo": clean_text(payload.get("memo"), limit=160) or "simulator market buy",
    }
    event_payload = {
        **raw_payload,
        "orderId": order_id,
        "tradeId": trade_id,
        "currency": currency,
    }
    raw_json = json.dumps(raw_payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    with conn:
        conn.execute(
            """
            INSERT INTO simulator_orders (
              id, simulator_id, instrument_id, provider, venue, asset_class,
              base_asset, quote_asset, settlement_asset, instrument_status, session_policy,
              side, symbol, market, order_type, quantity,
              limit_price, currency, status, created_at, updated_at, raw_json
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'buy', ?, ?, 'market', ?, NULL, ?, 'filled', ?, ?, ?)
            """,
            (
                order_id,
                simulator_id,
                *instrument_db_values(instrument),
                symbol,
                market,
                decimal_to_store(quantity),
                currency,
                now,
                now,
                raw_json,
            ),
        )
        conn.execute(
            """
            INSERT INTO simulator_ledger_events (
              id, simulator_id, instrument_id, provider, venue, asset_class, symbol,
              base_asset, quote_asset, settlement_asset, instrument_status, session_policy,
              event_type, occurred_at, payload_json,
              idempotency_key, source, reversal_of_event_id, created_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'stock_buy', ?, ?, ?, 'gui', NULL, ?)
            """,
            (
                event_id,
                simulator_id,
                *ledger_instrument_db_values(instrument),
                now,
                json.dumps(event_payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")),
                idempotency_key,
                now,
            ),
        )
        conn.execute(
            """
            INSERT INTO simulator_trades (
              id, simulator_id, order_id, instrument_id, provider, venue, asset_class,
              base_asset, quote_asset, settlement_asset, instrument_status, session_policy,
              symbol, side, quantity, price,
              currency, fee_amount, fee_currency, executed_at, ledger_event_id, raw_json
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'buy', ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                trade_id,
                simulator_id,
                order_id,
                *instrument_db_values(instrument),
                symbol,
                decimal_to_store(quantity),
                decimal_to_store(price),
                currency,
                decimal_to_store(fee_amount),
                fee_currency,
                now,
                event_id,
                raw_json,
            ),
        )
        conn.execute(
            "UPDATE simulator_accounts SET updated_at = ? WHERE id = ?",
            (now, simulator_id),
        )
    order_row = conn.execute("SELECT * FROM simulator_orders WHERE id = ?", (order_id,)).fetchone()
    trade_row = conn.execute("SELECT * FROM simulator_trades WHERE id = ?", (trade_id,)).fetchone()
    return account_snapshot(conn, get_account_row(conn, simulator_id)), True, public_order(order_row), public_trade(trade_row)


def sell_stock(conn, payload):
    simulator_id = clean_id(payload.get("simulatorId") or payload.get("id"))
    if not simulator_id:
        raise ValueError("simulatorId is required")
    row = get_account_row(conn, simulator_id)
    if not row or row["status"] != "active":
        raise ValueError("active simulator account not found")

    instrument = normalize_instrument_metadata(payload)
    symbol = instrument["symbol"]
    if not symbol:
        raise ValueError("symbol is required")
    if instrument["provider"] and not instrument["instrumentId"]:
        raise ValueError("instrumentId is required when provider is set")
    if instrument["provider"] == "binance" and instrument["status"] != "TRADING":
        raise ValueError("Binance Spot instrument status must be TRADING")
    market = instrument["market"]
    market_country_value = (
        market_country(symbol, market, instrument["provider"], instrument["assetClass"])
        if instrument["provider"] or instrument["assetClass"]
        else clean_text(payload.get("marketCountry") or market_country(symbol, market), limit=20).upper()
    )
    currency = clean_currency(
        instrument["settlementAsset"] or payload.get("settlementCurrency") or payload.get("currency"),
        "USD",
    )
    if market_country_value == "KR" and currency != "KRW":
        raise ValueError("Korean stocks must settle in KRW")
    if market_country_value == "US" and currency != "USD":
        raise ValueError("US stocks must settle in USD")
    price_currency = clean_currency(payload.get("priceCurrency"), currency)
    if price_currency != currency:
        raise ValueError("execution price currency must match settlement currency")

    now = iso_now()
    idempotency_key = clean_text(payload.get("idempotencyKey"), limit=160) or f"sell:{simulator_id}:{uuid.uuid4().hex}"
    existing_event = existing_event_for_idempotency(conn, simulator_id, idempotency_key)
    if existing_event:
        return account_snapshot(conn, row), False, None, None

    price = decimal_value(payload.get("price") or payload.get("executionPrice"), Decimal("0"))
    quantity = decimal_value(payload.get("quantity"), Decimal("0"))
    gross_amount = decimal_value(
        payload.get("settlementAmount") or payload.get("grossAmount") or payload.get("amount"),
        Decimal("0"),
    )
    if price <= 0:
        raise ValueError("execution price must be positive")
    if quantity <= 0 and gross_amount > 0:
        quantity = gross_amount / price
    if quantity <= 0:
        raise ValueError("sell quantity must be positive")
    gross_amount = quantity * price

    fee_currency = clean_currency(payload.get("feeCurrency"), currency)
    fee_amount = decimal_value(payload.get("feeAmount"), Decimal("0"))
    fee_assumption = clean_text(payload.get("feeAssumption"), limit=80)
    if instrument["provider"] == "binance":
        fee_currency = "USD"
        fee_amount = Decimal("0")
        fee_assumption = "zero-no-public-account-rate"
    if fee_amount < 0:
        raise ValueError("feeAmount must be zero or positive")

    snapshot = account_snapshot(conn, row)
    holding = None
    for item in snapshot.get("items", []):
        same_instrument = bool(instrument["instrumentId"]) and clean_instrument_id(item.get("instrumentId")) == instrument["instrumentId"]
        same_legacy_symbol = (
            not instrument["instrumentId"]
            and clean_symbol(item.get("symbol")) == symbol
            and clean_currency(item.get("currency"), currency) == currency
        )
        if same_instrument or same_legacy_symbol:
            holding = item
            break
    held_quantity = decimal_value(holding.get("quantity") if holding else None, Decimal("0"))
    if held_quantity <= 0:
        raise ValueError("sell position not found")
    tolerance = Decimal("0.0000000001")
    if quantity - held_quantity > tolerance:
        raise ValueError("sell quantity exceeds current position")
    if held_quantity - quantity < tolerance:
        quantity = held_quantity
        gross_amount = quantity * price

    order_id = generate_id("ord")
    trade_id = generate_id("trd")
    event_id = generate_id("evt")
    raw_payload = {
        **public_instrument_metadata(instrument),
        "name": clean_text(
            payload.get("symbolName") or payload.get("name") or (holding.get("label") if holding else symbol),
            limit=120,
        )
        or symbol,
        "englishName": clean_text(
            payload.get("englishName") or (holding.get("englishName") if holding else ""),
            limit=120,
        ),
        "market": market or clean_market(holding.get("market") if holding else ""),
        "marketCountry": market_country_value,
        "orderUnit": clean_currency(payload.get("orderUnit"), currency),
        "orderAmount": decimal_to_store(decimal_value(payload.get("orderAmount"), gross_amount)),
        "settlementCurrency": currency,
        "grossAmount": decimal_to_store(gross_amount),
        "price": decimal_to_store(price),
        "priceCurrency": currency,
        "quantity": decimal_to_store(quantity),
        "feeCurrency": fee_currency,
        "feeAmount": decimal_to_store(fee_amount),
        "feeAssumption": fee_assumption,
        "marketSession": clean_text(payload.get("marketSession"), limit=40) or instrument["sessionPolicy"],
        "priceTimestamp": clean_text(payload.get("priceTimestamp"), limit=80),
        "priceSource": clean_text(payload.get("priceSource"), limit=80)
        or ("binance-market-data" if instrument["provider"] == "binance" else "tossinvest-prices"),
        "memo": clean_text(payload.get("memo"), limit=160) or "simulator market sell",
    }
    event_payload = {
        **raw_payload,
        "orderId": order_id,
        "tradeId": trade_id,
        "currency": currency,
    }
    raw_json = json.dumps(raw_payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    with conn:
        conn.execute(
            """
            INSERT INTO simulator_orders (
              id, simulator_id, instrument_id, provider, venue, asset_class,
              base_asset, quote_asset, settlement_asset, instrument_status, session_policy,
              side, symbol, market, order_type, quantity,
              limit_price, currency, status, created_at, updated_at, raw_json
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'sell', ?, ?, 'market', ?, NULL, ?, 'filled', ?, ?, ?)
            """,
            (
                order_id,
                simulator_id,
                *instrument_db_values(instrument),
                symbol,
                raw_payload["market"],
                decimal_to_store(quantity),
                currency,
                now,
                now,
                raw_json,
            ),
        )
        conn.execute(
            """
            INSERT INTO simulator_ledger_events (
              id, simulator_id, instrument_id, provider, venue, asset_class, symbol,
              base_asset, quote_asset, settlement_asset, instrument_status, session_policy,
              event_type, occurred_at, payload_json,
              idempotency_key, source, reversal_of_event_id, created_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'stock_sell', ?, ?, ?, 'gui', NULL, ?)
            """,
            (
                event_id,
                simulator_id,
                *ledger_instrument_db_values(instrument),
                now,
                json.dumps(event_payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")),
                idempotency_key,
                now,
            ),
        )
        conn.execute(
            """
            INSERT INTO simulator_trades (
              id, simulator_id, order_id, instrument_id, provider, venue, asset_class,
              base_asset, quote_asset, settlement_asset, instrument_status, session_policy,
              symbol, side, quantity, price,
              currency, fee_amount, fee_currency, executed_at, ledger_event_id, raw_json
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'sell', ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                trade_id,
                simulator_id,
                order_id,
                *instrument_db_values(instrument),
                symbol,
                decimal_to_store(quantity),
                decimal_to_store(price),
                currency,
                decimal_to_store(fee_amount),
                fee_currency,
                now,
                event_id,
                raw_json,
            ),
        )
        conn.execute(
            "UPDATE simulator_accounts SET updated_at = ? WHERE id = ?",
            (now, simulator_id),
        )
    order_row = conn.execute("SELECT * FROM simulator_orders WHERE id = ?", (order_id,)).fetchone()
    trade_row = conn.execute("SELECT * FROM simulator_trades WHERE id = ?", (trade_id,)).fetchone()
    return account_snapshot(conn, get_account_row(conn, simulator_id)), True, public_order(order_row), public_trade(trade_row)


def archive_account(conn, payload):
    simulator_id = clean_id(payload.get("simulatorId") or payload.get("id"))
    if not simulator_id:
        raise ValueError("simulatorId is required")
    row = get_account_row(conn, simulator_id)
    if not row:
        raise ValueError("simulator account not found")
    if row["status"] == "archived":
        return account_snapshot(conn, row), False

    now = iso_now()
    event_payload = {
        "memo": "simulator account archived",
        "previousStatus": row["status"],
    }
    with conn:
        conn.execute(
            """
            UPDATE simulator_accounts
            SET status = 'archived', updated_at = ?, archived_at = ?
            WHERE id = ?
            """,
            (now, now, simulator_id),
        )
        conn.execute(
            """
            INSERT INTO simulator_ledger_events (
              id, simulator_id, event_type, occurred_at, payload_json,
              idempotency_key, source, reversal_of_event_id, created_at
            )
            VALUES (?, ?, 'account_archived', ?, ?, ?, 'gui', NULL, ?)
            """,
            (
                generate_id("evt"),
                simulator_id,
                now,
                json.dumps(event_payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")),
                f"archive:{simulator_id}:{now}",
                now,
            ),
        )
    return account_snapshot(conn, get_account_row(conn, simulator_id)), True


def public_event(row):
    payload = decode_payload(row)
    instrument = instrument_metadata_from_row(row, payload)
    return {
        "id": row["id"],
        "simulatorId": row["simulator_id"],
        **public_instrument_metadata(instrument),
        "eventType": row["event_type"],
        "occurredAt": row["occurred_at"],
        "payload": payload,
        "idempotencyKey": row["idempotency_key"] or "",
        "instrumentSource": instrument.get("source", ""),
        "source": row["source"],
        "reversalOfEventId": row["reversal_of_event_id"] or "",
        "createdAt": row["created_at"],
    }


def handle_status(_payload):
    db_exists = DB_PATH.exists()
    result = {
        "ok": True,
        "dbExists": db_exists,
        **public_paths(),
        "schemaVersion": SCHEMA_VERSION,
        "accountCount": 0,
        "ledgerEventCount": 0,
        "orderCount": 0,
        "tradeCount": 0,
    }
    if not db_exists:
        return result
    conn = connect(create=False)
    try:
        result["accountCount"] = int(conn.execute("SELECT COUNT(*) AS count FROM simulator_accounts").fetchone()["count"])
        result["ledgerEventCount"] = int(conn.execute("SELECT COUNT(*) AS count FROM simulator_ledger_events").fetchone()["count"])
        result["orderCount"] = int(conn.execute("SELECT COUNT(*) AS count FROM simulator_orders").fetchone()["count"])
        result["tradeCount"] = int(conn.execute("SELECT COUNT(*) AS count FROM simulator_trades").fetchone()["count"])
        return result
    finally:
        conn.close()


def handle_init(_payload):
    existed = DB_PATH.exists()
    conn = connect(create=True)
    try:
        return {
            "ok": True,
            "initialized": not existed,
            **public_paths(),
            "schemaVersion": SCHEMA_VERSION,
            "actualSchemaVersion": int(conn.execute("PRAGMA user_version").fetchone()[0]),
            "accountCount": int(conn.execute("SELECT COUNT(*) FROM simulator_accounts").fetchone()[0]),
            "ledgerEventCount": int(conn.execute("SELECT COUNT(*) FROM simulator_ledger_events").fetchone()[0]),
            "orderCount": int(conn.execute("SELECT COUNT(*) FROM simulator_orders").fetchone()[0]),
            "tradeCount": int(conn.execute("SELECT COUNT(*) FROM simulator_trades").fetchone()[0]),
        }
    finally:
        conn.close()


def handle_accounts(_payload):
    conn = connect(create=True)
    try:
        return {
            "ok": True,
            **public_paths(),
            "schemaVersion": SCHEMA_VERSION,
            "accounts": list_accounts(conn),
        }
    finally:
        conn.close()


def handle_create_account(payload):
    conn = connect(create=True)
    try:
        account, created = create_account(conn, payload or {})
        return {
            "ok": True,
            "created": created,
            **public_paths(),
            "schemaVersion": SCHEMA_VERSION,
            "account": account,
            "accounts": list_accounts(conn),
        }
    finally:
        conn.close()


def handle_archive_account(payload):
    conn = connect(create=True)
    try:
        account, archived = archive_account(conn, payload or {})
        return {
            "ok": True,
            "archived": archived,
            **public_paths(),
            "schemaVersion": SCHEMA_VERSION,
            "account": account,
            "accounts": list_accounts(conn),
        }
    finally:
        conn.close()


def handle_rename_account(payload):
    conn = connect(create=True)
    try:
        account, renamed = rename_account(conn, payload or {})
        return {
            "ok": True,
            "renamed": renamed,
            **public_paths(),
            "schemaVersion": SCHEMA_VERSION,
            "account": account,
            "accounts": list_accounts(conn),
        }
    finally:
        conn.close()


def handle_exchange(payload):
    conn = connect(create=True)
    try:
        account, exchanged = exchange_cash(conn, payload or {})
        return {
            "ok": True,
            "exchanged": exchanged,
            **public_paths(),
            "schemaVersion": SCHEMA_VERSION,
            "account": account,
            "accounts": list_accounts(conn),
        }
    finally:
        conn.close()


def handle_buy(payload):
    conn = connect(create=True)
    try:
        account, filled, order, trade = buy_stock(conn, payload or {})
        return {
            "ok": True,
            "filled": filled,
            **public_paths(),
            "schemaVersion": SCHEMA_VERSION,
            "account": account,
            "order": order,
            "trade": trade,
            "accounts": list_accounts(conn),
        }
    finally:
        conn.close()


def handle_sell(payload):
    conn = connect(create=True)
    try:
        account, filled, order, trade = sell_stock(conn, payload or {})
        return {
            "ok": True,
            "filled": filled,
            **public_paths(),
            "schemaVersion": SCHEMA_VERSION,
            "account": account,
            "order": order,
            "trade": trade,
            "accounts": list_accounts(conn),
        }
    finally:
        conn.close()


def handle_events(payload):
    simulator_id = clean_id(payload.get("simulatorId"))
    if not simulator_id:
        raise ValueError("simulatorId is required")
    conn = connect(create=True)
    try:
        account = get_account_row(conn, simulator_id)
        if not account:
            raise ValueError("simulator account not found")
        rows = ledger_rows(conn, simulator_id)
        order_rows = conn.execute(
            """
            SELECT *
            FROM simulator_orders
            WHERE simulator_id = ?
            ORDER BY created_at DESC, id DESC
            """,
            (simulator_id,),
        ).fetchall()
        trade_rows_for_account = conn.execute(
            """
            SELECT *
            FROM simulator_trades
            WHERE simulator_id = ?
            ORDER BY executed_at DESC, id DESC
            """,
            (simulator_id,),
        ).fetchall()
        return {
            "ok": True,
            **public_paths(),
            "schemaVersion": SCHEMA_VERSION,
            "account": account_snapshot(conn, account),
            "events": [public_event(row) for row in rows],
            "orders": [public_order(row) for row in order_rows],
            "trades": [public_trade(row) for row in trade_rows_for_account],
        }
    finally:
        conn.close()


def main():
    parser = argparse.ArgumentParser(description="Manage FinanceAgentGUI investment simulator SQLite store.")
    parser.add_argument("command", choices=["init", "status", "accounts", "create-account", "rename-account", "archive-account", "exchange", "buy", "sell", "events"])
    args = parser.parse_args()
    payload = read_payload()
    try:
        if args.command == "init":
            output(handle_init(payload))
        elif args.command == "status":
            output(handle_status(payload))
        elif args.command == "accounts":
            output(handle_accounts(payload))
        elif args.command == "create-account":
            output(handle_create_account(payload))
        elif args.command == "rename-account":
            output(handle_rename_account(payload))
        elif args.command == "archive-account":
            output(handle_archive_account(payload))
        elif args.command == "exchange":
            output(handle_exchange(payload))
        elif args.command == "buy":
            output(handle_buy(payload))
        elif args.command == "sell":
            output(handle_sell(payload))
        elif args.command == "events":
            output(handle_events(payload))
    except Exception as error:
        output({"ok": False, "error": str(error), **public_paths()})
        raise SystemExit(1)


if __name__ == "__main__":
    main()
