#!/usr/bin/env python3
import hashlib
import json
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path


GUIBUILD_ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = GUIBUILD_ROOT / "data" / "tossinvest"
DB_PATH = DATA_DIR / "tossinvest-ledger.sqlite3"
SCHEMA_VERSION = 2


def iso_now():
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def rel(path):
    return str(path.relative_to(GUIBUILD_ROOT))


def output(payload):
    print(json.dumps(payload, ensure_ascii=False, separators=(",", ":")))


def read_payload():
    raw = sys.stdin.read()
    if not raw.strip():
        return {}
    return json.loads(raw)


def connect(create=False):
    if create:
        DATA_DIR.mkdir(parents=True, exist_ok=True)
    if not DB_PATH.exists() and not create:
        return None
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    init_db(conn)
    return conn


def init_db(conn):
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS orders (
          account_seq TEXT NOT NULL,
          order_id TEXT NOT NULL,
          symbol TEXT NOT NULL DEFAULT '',
          side TEXT NOT NULL DEFAULT '',
          order_type TEXT NOT NULL DEFAULT '',
          time_in_force TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT '',
          currency TEXT NOT NULL DEFAULT '',
          price TEXT,
          quantity TEXT,
          order_amount TEXT,
          ordered_at TEXT,
          canceled_at TEXT,
          filled_quantity TEXT,
          average_filled_price TEXT,
          filled_amount TEXT,
          commission TEXT,
          tax TEXT,
          filled_at TEXT,
          settlement_date TEXT,
          raw_json TEXT NOT NULL,
          raw_hash TEXT NOT NULL,
          first_seen_at TEXT NOT NULL,
          last_seen_at TEXT NOT NULL,
          PRIMARY KEY (account_seq, order_id)
        );

        CREATE INDEX IF NOT EXISTS idx_toss_orders_ordered_at
          ON orders (ordered_at DESC);
        CREATE INDEX IF NOT EXISTS idx_toss_orders_symbol_ordered_at
          ON orders (symbol, ordered_at DESC);
        CREATE INDEX IF NOT EXISTS idx_toss_orders_status_ordered_at
          ON orders (status, ordered_at DESC);

        CREATE TABLE IF NOT EXISTS sync_state (
          account_seq TEXT PRIMARY KEY,
          enabled INTEGER NOT NULL DEFAULT 0,
          last_sync_started_at TEXT,
          last_sync_finished_at TEXT,
          last_successful_sync_at TEXT,
          last_error_at TEXT,
          last_error TEXT,
          last_cursor TEXT,
          has_next INTEGER NOT NULL DEFAULT 0,
          last_from_date TEXT,
          last_to_date TEXT,
          last_ordered_at TEXT,
          last_filled_at TEXT,
          total_orders INTEGER NOT NULL DEFAULT 0,
          last_fetch_count INTEGER NOT NULL DEFAULT 0,
          last_inserted_count INTEGER NOT NULL DEFAULT 0,
          last_updated_count INTEGER NOT NULL DEFAULT 0,
          last_seen_count INTEGER NOT NULL DEFAULT 0,
          last_pages_fetched INTEGER NOT NULL DEFAULT 0,
          updated_at TEXT NOT NULL
        );

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


def clean_text(value):
    if value is None:
        return None
    text = str(value).strip()
    return text if text else None


def order_row(account_seq, order, now):
    execution = order.get("execution") if isinstance(order.get("execution"), dict) else {}
    raw_json = json.dumps(order, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return {
        "account_seq": account_seq,
        "order_id": clean_text(order.get("orderId")) or "",
        "symbol": clean_text(order.get("symbol")) or "",
        "side": clean_text(order.get("side")) or "",
        "order_type": clean_text(order.get("orderType")) or "",
        "time_in_force": clean_text(order.get("timeInForce")) or "",
        "status": clean_text(order.get("status")) or "",
        "currency": clean_text(order.get("currency")) or "",
        "price": clean_text(order.get("price")),
        "quantity": clean_text(order.get("quantity")),
        "order_amount": clean_text(order.get("orderAmount")),
        "ordered_at": clean_text(order.get("orderedAt")),
        "canceled_at": clean_text(order.get("canceledAt")),
        "filled_quantity": clean_text(execution.get("filledQuantity")),
        "average_filled_price": clean_text(execution.get("averageFilledPrice")),
        "filled_amount": clean_text(execution.get("filledAmount")),
        "commission": clean_text(execution.get("commission")),
        "tax": clean_text(execution.get("tax")),
        "filled_at": clean_text(execution.get("filledAt")),
        "settlement_date": clean_text(execution.get("settlementDate")),
        "raw_json": raw_json,
        "raw_hash": hashlib.sha256(raw_json.encode("utf-8")).hexdigest(),
        "first_seen_at": now,
        "last_seen_at": now,
    }


def summarize_store(conn):
    summary = conn.execute(
        """
        SELECT
          COUNT(*) AS order_count,
          COUNT(DISTINCT account_seq) AS account_count,
          MIN(ordered_at) AS earliest_ordered_at,
          MAX(ordered_at) AS latest_ordered_at,
          MAX(filled_at) AS latest_filled_at
        FROM orders
        """
    ).fetchone()
    states = [
        dict(row)
        for row in conn.execute(
            """
            SELECT *
            FROM sync_state
            ORDER BY account_seq
            """
        ).fetchall()
    ]
    recent_orders = [
        dict(row)
        for row in conn.execute(
            """
            SELECT
              symbol,
              side,
              status,
              order_type AS orderType,
              currency,
              ordered_at AS orderedAt,
              filled_at AS filledAt,
              filled_quantity AS filledQuantity,
              average_filled_price AS averageFilledPrice,
              filled_amount AS filledAmount,
              commission,
              tax,
              settlement_date AS settlementDate
            FROM orders
            ORDER BY COALESCE(ordered_at, '') DESC, last_seen_at DESC
            LIMIT 5
            """
        ).fetchall()
    ]
    return {
        "ok": True,
        "exists": DB_PATH.exists(),
        "schemaVersion": SCHEMA_VERSION,
        "dbPath": rel(DB_PATH),
        "orderCount": int(summary["order_count"] or 0),
        "accountCount": int(summary["account_count"] or 0),
        "earliestOrderedAt": summary["earliest_ordered_at"] or "",
        "latestOrderedAt": summary["latest_ordered_at"] or "",
        "latestFilledAt": summary["latest_filled_at"] or "",
        "states": states,
        "recentOrders": recent_orders,
    }


def status():
    if not DB_PATH.exists():
        return {
            "ok": True,
            "exists": False,
            "schemaVersion": SCHEMA_VERSION,
            "dbPath": rel(DB_PATH),
            "orderCount": 0,
            "accountCount": 0,
            "earliestOrderedAt": "",
            "latestOrderedAt": "",
            "latestFilledAt": "",
            "states": [],
            "recentOrders": [],
        }
    conn = connect(create=False)
    try:
        return summarize_store(conn)
    finally:
        conn.close()


def upsert():
    payload = read_payload()
    account_seq = clean_text(payload.get("accountSeq")) or ""
    if not account_seq:
        raise ValueError("accountSeq is required")
    orders = payload.get("orders") if isinstance(payload.get("orders"), list) else []
    sync = payload.get("sync") if isinstance(payload.get("sync"), dict) else {}
    now = clean_text(sync.get("finishedAt")) or iso_now()

    conn = connect(create=True)
    inserted = 0
    updated = 0
    unchanged = 0
    try:
        with conn:
            for order in orders:
                if not isinstance(order, dict):
                    continue
                row = order_row(account_seq, order, now)
                if not row["order_id"]:
                    continue
                current = conn.execute(
                    """
                    SELECT raw_hash
                    FROM orders
                    WHERE account_seq = ? AND order_id = ?
                    """,
                    (account_seq, row["order_id"]),
                ).fetchone()
                if current is None:
                    conn.execute(
                        """
                        INSERT INTO orders (
                          account_seq, order_id, symbol, side, order_type, time_in_force, status,
                          currency, price, quantity, order_amount, ordered_at, canceled_at,
                          filled_quantity, average_filled_price, filled_amount, commission, tax,
                          filled_at, settlement_date, raw_json, raw_hash, first_seen_at, last_seen_at
                        ) VALUES (
                          :account_seq, :order_id, :symbol, :side, :order_type, :time_in_force, :status,
                          :currency, :price, :quantity, :order_amount, :ordered_at, :canceled_at,
                          :filled_quantity, :average_filled_price, :filled_amount, :commission, :tax,
                          :filled_at, :settlement_date, :raw_json, :raw_hash, :first_seen_at, :last_seen_at
                        )
                        """,
                        row,
                    )
                    inserted += 1
                elif current["raw_hash"] != row["raw_hash"]:
                    conn.execute(
                        """
                        UPDATE orders
                        SET
                          symbol = :symbol,
                          side = :side,
                          order_type = :order_type,
                          time_in_force = :time_in_force,
                          status = :status,
                          currency = :currency,
                          price = :price,
                          quantity = :quantity,
                          order_amount = :order_amount,
                          ordered_at = :ordered_at,
                          canceled_at = :canceled_at,
                          filled_quantity = :filled_quantity,
                          average_filled_price = :average_filled_price,
                          filled_amount = :filled_amount,
                          commission = :commission,
                          tax = :tax,
                          filled_at = :filled_at,
                          settlement_date = :settlement_date,
                          raw_json = :raw_json,
                          raw_hash = :raw_hash,
                          last_seen_at = :last_seen_at
                        WHERE account_seq = :account_seq AND order_id = :order_id
                        """,
                        row,
                    )
                    updated += 1
                else:
                    conn.execute(
                        """
                        UPDATE orders
                        SET last_seen_at = ?
                        WHERE account_seq = ? AND order_id = ?
                        """,
                        (now, account_seq, row["order_id"]),
                    )
                    unchanged += 1

            summary = conn.execute(
                """
                SELECT COUNT(*) AS total_orders, MAX(ordered_at) AS last_ordered_at, MAX(filled_at) AS last_filled_at
                FROM orders
                WHERE account_seq = ?
                """,
                (account_seq,),
            ).fetchone()
            ok = sync.get("status") != "error"
            conn.execute(
                """
                INSERT INTO sync_state (
                  account_seq, enabled, last_sync_started_at, last_sync_finished_at,
                  last_successful_sync_at, last_error_at, last_error, last_cursor,
                  has_next, last_from_date, last_to_date, last_ordered_at, last_filled_at,
                  total_orders, last_fetch_count, last_inserted_count, last_updated_count,
                  last_seen_count, last_pages_fetched, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(account_seq) DO UPDATE SET
                  enabled = excluded.enabled,
                  last_sync_started_at = excluded.last_sync_started_at,
                  last_sync_finished_at = excluded.last_sync_finished_at,
                  last_successful_sync_at = CASE
                    WHEN excluded.last_error = '' THEN excluded.last_successful_sync_at
                    ELSE sync_state.last_successful_sync_at
                  END,
                  last_error_at = excluded.last_error_at,
                  last_error = excluded.last_error,
                  last_cursor = excluded.last_cursor,
                  has_next = excluded.has_next,
                  last_from_date = excluded.last_from_date,
                  last_to_date = excluded.last_to_date,
                  last_ordered_at = excluded.last_ordered_at,
                  last_filled_at = excluded.last_filled_at,
                  total_orders = excluded.total_orders,
                  last_fetch_count = excluded.last_fetch_count,
                  last_inserted_count = excluded.last_inserted_count,
                  last_updated_count = excluded.last_updated_count,
                  last_seen_count = excluded.last_seen_count,
                  last_pages_fetched = excluded.last_pages_fetched,
                  updated_at = excluded.updated_at
                """,
                (
                    account_seq,
                    1 if sync.get("enabled", True) else 0,
                    clean_text(sync.get("startedAt")),
                    now,
                    now if ok else None,
                    "" if ok else now,
                    "" if ok else clean_text(sync.get("error")) or "sync failed",
                    clean_text(sync.get("nextCursor")) or "",
                    1 if sync.get("hasNext") else 0,
                    clean_text(sync.get("from")) or "",
                    clean_text(sync.get("to")) or "",
                    summary["last_ordered_at"] or "",
                    summary["last_filled_at"] or "",
                    int(summary["total_orders"] or 0),
                    int(sync.get("fetchedCount") or len(orders)),
                    inserted,
                    updated,
                    unchanged,
                    int(sync.get("pagesFetched") or 0),
                    now,
                ),
            )
        store = summarize_store(conn)
        store["upsert"] = {
            "accountSeq": account_seq,
            "inserted": inserted,
            "updated": updated,
            "unchanged": unchanged,
            "seen": inserted + updated + unchanged,
        }
        return store
    finally:
        conn.close()


def main():
    command = sys.argv[1] if len(sys.argv) > 1 else "status"
    if command == "status":
        output(status())
        return
    if command == "upsert":
        output(upsert())
        return
    raise ValueError(f"unknown command: {command}")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        output({"ok": False, "error": str(error), "dbPath": rel(DB_PATH)})
        sys.exit(1)
