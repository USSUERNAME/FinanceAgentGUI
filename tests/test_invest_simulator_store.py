import importlib.util
import json
import sqlite3
import tempfile
import unittest
from pathlib import Path


GUIBUILD_ROOT = Path(__file__).resolve().parents[1]
STORE_PATH = GUIBUILD_ROOT / "scripts" / "invest_simulator_store.py"
SCHEMA_PATH = GUIBUILD_ROOT / "config" / "invest-simulator.schema.sql"
SPEC = importlib.util.spec_from_file_location("invest_simulator_store_under_test", STORE_PATH)
STORE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(STORE)


V1_SCHEMA = """
PRAGMA user_version = 1;
CREATE TABLE simulator_accounts (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, base_currency TEXT NOT NULL DEFAULT 'KRW',
  status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL, updated_at TEXT NOT NULL, archived_at TEXT
);
CREATE TABLE simulator_ledger_events (
  id TEXT PRIMARY KEY, simulator_id TEXT NOT NULL, event_type TEXT NOT NULL, occurred_at TEXT NOT NULL,
  payload_json TEXT NOT NULL, idempotency_key TEXT, source TEXT NOT NULL DEFAULT 'gui',
  reversal_of_event_id TEXT, created_at TEXT NOT NULL
);
CREATE TABLE simulator_orders (
  id TEXT PRIMARY KEY, simulator_id TEXT NOT NULL, side TEXT NOT NULL, symbol TEXT NOT NULL,
  market TEXT NOT NULL DEFAULT '', order_type TEXT NOT NULL DEFAULT 'market', quantity TEXT,
  limit_price TEXT, currency TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'draft',
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, raw_json TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE simulator_trades (
  id TEXT PRIMARY KEY, simulator_id TEXT NOT NULL, order_id TEXT, symbol TEXT NOT NULL, side TEXT NOT NULL,
  quantity TEXT NOT NULL, price TEXT NOT NULL, currency TEXT NOT NULL, fee_amount TEXT NOT NULL DEFAULT '0',
  fee_currency TEXT NOT NULL DEFAULT '', executed_at TEXT NOT NULL, ledger_event_id TEXT,
  raw_json TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE simulator_snapshots (
  id TEXT PRIMARY KEY, simulator_id TEXT NOT NULL, snapshot_at TEXT NOT NULL, cash_krw TEXT NOT NULL,
  cash_usd TEXT NOT NULL, positions_json TEXT NOT NULL DEFAULT '[]', valuation_json TEXT NOT NULL DEFAULT '{}',
  source_event_id TEXT, created_at TEXT NOT NULL
);
"""


def binance_instrument_payload(**overrides):
    payload = {
        "instrumentId": "BINANCE:SPOT:btcusdt",
        "provider": "binance",
        "venue": "BINANCE_SPOT",
        "assetClass": "crypto",
        "symbol": "BTCUSDT",
        "displaySymbol": "BTC/USDT",
        "baseAsset": "BTC",
        "quoteAsset": "USDT",
        "nativeQuoteAsset": "USDT",
        "settlementAsset": "USDT",
        "currency": "USD",
        "status": "TRADING",
        "sessionPolicy": "24x7",
        "market": "BINANCE_SPOT",
        "name": "Bitcoin",
        "englishName": "Bitcoin",
        "source": "binance-market-data",
    }
    payload.update(overrides)
    return payload


def binance_usdm_instrument_payload(**overrides):
    payload = binance_instrument_payload(
        instrumentId="binance:usdm:NVDAUSDT",
        venue="BINANCE_USDM_FUTURES",
        marketType="usdm",
        assetClass="equity",
        symbol="NVDAUSDT",
        displaySymbol="NVDA/USDT",
        baseAsset="NVDA",
        market="BINANCE_USDM_FUTURES",
        name="NVIDIA perpetual",
        englishName="NVIDIA perpetual",
        source="Binance USDⓈ-M Futures public market data",
    )
    payload.update(overrides)
    return payload


class InvestSimulatorStoreTest(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        STORE.DB_PATH = Path(self.temp_dir.name) / "simulator.sqlite3"

    def tearDown(self):
        self.temp_dir.cleanup()

    def test_v1_database_migrates_additively_to_v3(self):
        conn = sqlite3.connect(STORE.DB_PATH)
        conn.executescript(V1_SCHEMA)
        conn.execute(
            "INSERT INTO simulator_accounts VALUES (?, ?, ?, ?, ?, ?, NULL)",
            ("legacy", "기존 계정", "KRW", "active", "2026-07-09T00:00:00Z", "2026-07-09T00:00:00Z"),
        )
        conn.execute(
            "INSERT INTO simulator_ledger_events VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?)",
            (
                "evt_legacy",
                "legacy",
                "initial_cash",
                "2026-07-09T00:00:00Z",
                '{"cashKrw":"10000000","cashUsd":"0"}',
                "create:legacy",
                "gui",
                "2026-07-09T00:00:00Z",
            ),
        )
        conn.commit()
        conn.close()

        migrated = STORE.connect(create=False)
        try:
            self.assertEqual(migrated.execute("PRAGMA user_version").fetchone()[0], 3)
            for table_name in ("simulator_ledger_events", "simulator_orders", "simulator_trades"):
                columns = {row["name"] for row in migrated.execute(f"PRAGMA table_info({table_name})")}
                self.assertTrue(set(STORE.INSTRUMENT_COLUMN_DEFINITIONS).issubset(columns))
            self.assertIn("symbol", {row["name"] for row in migrated.execute("PRAGMA table_info(simulator_ledger_events)")})
            self.assertEqual(migrated.execute("SELECT COUNT(*) FROM simulator_accounts").fetchone()[0], 1)
            self.assertEqual(migrated.execute("SELECT COUNT(*) FROM simulator_ledger_events").fetchone()[0], 1)
        finally:
            migrated.close()

    def test_v2_database_repairs_legacy_usdm_rows_without_losing_history(self):
        conn = sqlite3.connect(STORE.DB_PATH)
        conn.executescript(SCHEMA_PATH.read_text(encoding="utf-8"))
        conn.execute("PRAGMA user_version = 2")
        conn.execute(
            "INSERT INTO simulator_accounts VALUES (?, ?, ?, ?, ?, ?, NULL)",
            ("legacy-usdm", "USDM legacy", "KRW", "active", "2026-07-17T00:00:00Z", "2026-07-17T00:00:00Z"),
        )
        corrupted = binance_usdm_instrument_payload(
            instrumentId="binance:spot:NVDAUSDT",
            marketType="spot",
            venue="BINANCE_SPOT",
            market="BINANCE_SPOT",
            assetClass="crypto",
            quantity="0.5",
            price="200",
            grossAmount="100",
            feeAmount="0",
            feeCurrency="USD",
        )
        raw_json = json.dumps(corrupted, ensure_ascii=False)
        conn.execute(
            """
            INSERT INTO simulator_ledger_events (
              id, simulator_id, instrument_id, provider, venue, asset_class, symbol,
              base_asset, quote_asset, settlement_asset, instrument_status, session_policy,
              event_type, occurred_at, payload_json, idempotency_key, source, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                "evt_usdm", "legacy-usdm", "binance:spot:NVDAUSDT", "binance", "BINANCE_SPOT", "crypto",
                "NVDAUSDT", "NVDA", "USDT", "USD", "TRADING", "24x7", "stock_buy",
                "2026-07-17T00:00:00Z", raw_json, "buy:legacy-usdm:nvda", "gui", "2026-07-17T00:00:00Z",
            ),
        )
        conn.execute(
            """
            INSERT INTO simulator_orders (
              id, simulator_id, instrument_id, provider, venue, asset_class,
              base_asset, quote_asset, settlement_asset, instrument_status, session_policy,
              side, symbol, market, quantity, currency, status, created_at, updated_at, raw_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                "ord_usdm", "legacy-usdm", "binance:spot:NVDAUSDT", "binance", "BINANCE_SPOT", "crypto",
                "NVDA", "USDT", "USD", "TRADING", "24x7", "buy", "NVDAUSDT", "BINANCE_SPOT",
                "0.5", "USD", "filled", "2026-07-17T00:00:00Z", "2026-07-17T00:00:00Z", raw_json,
            ),
        )
        conn.execute(
            """
            INSERT INTO simulator_trades (
              id, simulator_id, order_id, instrument_id, provider, venue, asset_class,
              base_asset, quote_asset, settlement_asset, instrument_status, session_policy,
              symbol, side, quantity, price, currency, fee_amount, fee_currency,
              executed_at, ledger_event_id, raw_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                "trd_usdm", "legacy-usdm", "ord_usdm", "binance:spot:NVDAUSDT", "binance",
                "BINANCE_SPOT", "crypto", "NVDA", "USDT", "USD", "TRADING", "24x7", "NVDAUSDT",
                "buy", "0.5", "200", "USD", "0", "USD", "2026-07-17T00:00:00Z", "evt_usdm", raw_json,
            ),
        )
        conn.execute(
            """
            INSERT INTO simulator_snapshots (
              id, simulator_id, snapshot_at, cash_krw, cash_usd, positions_json,
              valuation_json, source_event_id, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                "snap_usdm", "legacy-usdm", "2026-07-17T00:00:00Z", "0", "0",
                json.dumps([corrupted], ensure_ascii=False), "{}", "evt_usdm", "2026-07-17T00:00:00Z",
            ),
        )
        conn.commit()
        conn.close()

        migrated = STORE.connect(create=False)
        try:
            self.assertEqual(migrated.execute("PRAGMA user_version").fetchone()[0], 3)
            for table_name, json_column in (
                ("simulator_ledger_events", "payload_json"),
                ("simulator_orders", "raw_json"),
                ("simulator_trades", "raw_json"),
            ):
                row = migrated.execute(
                    f"SELECT instrument_id, venue, asset_class, {json_column} FROM {table_name}"
                ).fetchone()
                self.assertEqual(row["instrument_id"], "binance:usdm:NVDAUSDT")
                self.assertEqual(row["venue"], "BINANCE_USDM_FUTURES")
                self.assertEqual(row["asset_class"], "tradfi")
                saved = json.loads(row[json_column])
                self.assertEqual(saved["marketType"], "usdm")
                self.assertEqual(saved["assetClass"], "tradfi")
            snapshot = json.loads(
                migrated.execute("SELECT positions_json FROM simulator_snapshots").fetchone()["positions_json"]
            )
            self.assertEqual(snapshot[0]["instrumentId"], "binance:usdm:NVDAUSDT")
            self.assertEqual(STORE.positions_from_trades(migrated, "legacy-usdm")[0]["marketType"], "usdm")
        finally:
            migrated.close()

    def test_v1_trade_recovers_provider_metadata_from_raw_json_after_migration(self):
        conn = sqlite3.connect(STORE.DB_PATH)
        conn.executescript(V1_SCHEMA)
        raw = binance_instrument_payload(
            grossAmount="100",
            feeAmount="0",
            feeCurrency="USD",
            marketCountry="GLOBAL",
        )
        conn.execute(
            "INSERT INTO simulator_trades VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                "trd_v1",
                "legacy-binance",
                None,
                "BTCUSDT",
                "buy",
                "0.002",
                "50000",
                "USD",
                "0",
                "USD",
                "2026-07-09T00:00:00Z",
                None,
                json.dumps(raw, ensure_ascii=False),
            ),
        )
        conn.commit()
        conn.close()

        migrated = STORE.connect(create=False)
        try:
            items = STORE.positions_from_trades(migrated, "legacy-binance")
            self.assertEqual(len(items), 1)
            self.assertEqual(items[0]["instrumentId"], "binance:spot:BTCUSDT")
            self.assertEqual(items[0]["provider"], "binance")
            self.assertEqual(items[0]["assetClass"], "crypto")
            self.assertEqual(items[0]["quoteAsset"], "USDT")
            self.assertEqual(items[0]["settlementAsset"], "USD")
            self.assertEqual(items[0]["status"], "TRADING")
            self.assertEqual(items[0]["sessionPolicy"], "24x7")
        finally:
            migrated.close()

    def test_tracked_schema_matches_runtime_version_and_identity_columns(self):
        conn = sqlite3.connect(":memory:")
        conn.row_factory = sqlite3.Row
        try:
            conn.executescript(SCHEMA_PATH.read_text(encoding="utf-8"))
            self.assertEqual(conn.execute("PRAGMA user_version").fetchone()[0], STORE.SCHEMA_VERSION)
            for table_name in ("simulator_ledger_events", "simulator_orders", "simulator_trades"):
                columns = {row["name"] for row in conn.execute(f"PRAGMA table_info({table_name})")}
                self.assertTrue(set(STORE.INSTRUMENT_COLUMN_DEFINITIONS).issubset(columns))
        finally:
            conn.close()

    def test_newer_database_version_is_not_downgraded(self):
        conn = sqlite3.connect(STORE.DB_PATH)
        conn.execute("PRAGMA user_version = 4")
        conn.close()

        with self.assertRaisesRegex(RuntimeError, "newer than supported"):
            STORE.connect(create=False)
        check = sqlite3.connect(STORE.DB_PATH)
        try:
            self.assertEqual(check.execute("PRAGMA user_version").fetchone()[0], 4)
        finally:
            check.close()

    def test_binance_trade_preserves_identity_and_zero_fee_assumption_idempotently(self):
        conn = STORE.connect(create=True)
        try:
            account, created = STORE.create_account(
                conn,
                {"id": "crypto", "initialKrw": 0, "initialUsd": 6400, "idempotencyKey": "create:crypto"},
            )
            self.assertTrue(created)
            self.assertEqual(account["balances"], {"KRW": 0, "USD": 6400})

            order_payload = binance_instrument_payload(
                simulatorId="crypto",
                price="64000",
                quantity="0.1",
                settlementAmount="6400",
                feeAmount="25",
                feeCurrency="USDT",
                idempotencyKey="buy:crypto:btcusdt:1",
            )
            snapshot, filled, order, trade = STORE.buy_stock(conn, order_payload)
            self.assertTrue(filled)
            for record in (order, trade):
                self.assertEqual(record["instrumentId"], "binance:spot:BTCUSDT")
                self.assertEqual(record["provider"], "binance")
                self.assertEqual(record["venue"], "BINANCE_SPOT")
                self.assertEqual(record["assetClass"], "crypto")
                self.assertEqual(record["quoteAsset"], "USDT")
                self.assertEqual(record["nativeQuoteAsset"], "USDT")
                self.assertEqual(record["settlementAsset"], "USD")
                self.assertEqual(record["sessionPolicy"], "24x7")
            self.assertEqual(trade["price"], 64000)
            self.assertEqual(trade["feeAmount"], 0)
            self.assertEqual(trade["feeCurrency"], "USD")
            self.assertEqual(trade["raw"]["feeAssumption"], "zero-no-public-account-rate")
            self.assertEqual(snapshot["balances"], {"KRW": 0, "USD": 0})
            self.assertEqual(snapshot["items"][0]["marketCountry"], "GLOBAL")
            self.assertEqual(snapshot["items"][0]["instrumentId"], "binance:spot:BTCUSDT")
            self.assertEqual(set(snapshot["balances"]), {"KRW", "USD"})

            events_before = conn.execute("SELECT COUNT(*) FROM simulator_ledger_events").fetchone()[0]
            trades_before = conn.execute("SELECT COUNT(*) FROM simulator_trades").fetchone()[0]
            _, duplicate_fill, duplicate_order, duplicate_trade = STORE.buy_stock(conn, order_payload)
            self.assertFalse(duplicate_fill)
            self.assertIsNone(duplicate_order)
            self.assertIsNone(duplicate_trade)
            self.assertEqual(conn.execute("SELECT COUNT(*) FROM simulator_ledger_events").fetchone()[0], events_before)
            self.assertEqual(conn.execute("SELECT COUNT(*) FROM simulator_trades").fetchone()[0], trades_before)

            event_rows = STORE.ledger_rows(conn, "crypto")
            stock_event = next(row for row in event_rows if row["event_type"] == "stock_buy")
            public_event = STORE.public_event(stock_event)
            self.assertEqual(public_event["instrumentId"], "binance:spot:BTCUSDT")
            self.assertEqual(public_event["provider"], "binance")
            self.assertEqual(public_event["payload"]["feeAssumption"], "zero-no-public-account-rate")
            self.assertEqual(public_event["payload"]["currency"], "USD")

            sell_payload = binance_instrument_payload(
                simulatorId="crypto",
                price="65000",
                quantity="0.05",
                idempotencyKey="sell:crypto:btcusdt:1",
            )
            sell_snapshot, sold, sell_order, sell_trade = STORE.sell_stock(conn, sell_payload)
            self.assertTrue(sold)
            self.assertEqual(sell_order["instrumentId"], "binance:spot:BTCUSDT")
            self.assertEqual(sell_trade["instrumentId"], "binance:spot:BTCUSDT")
            self.assertEqual(sell_trade["feeAmount"], 0)
            self.assertEqual(sell_trade["raw"]["feeAssumption"], "zero-no-public-account-rate")
            self.assertEqual(sell_snapshot["items"][0]["quantity"], 0.05)
            self.assertEqual(sell_snapshot["items"][0]["instrumentId"], "binance:spot:BTCUSDT")
        finally:
            conn.close()

    def test_binance_usdm_trade_preserves_market_type_venue_and_asset_class(self):
        conn = STORE.connect(create=True)
        try:
            STORE.create_account(conn, {"id": "tradfi", "initialKrw": 0, "initialUsd": 1000})
            snapshot, filled, order, trade = STORE.buy_stock(
                conn,
                binance_usdm_instrument_payload(
                    simulatorId="tradfi",
                    price="200",
                    quantity="0.5",
                    settlementAmount="100",
                    idempotencyKey="buy:tradfi:nvda:1",
                ),
            )
            self.assertTrue(filled)
            for record in (order, trade, snapshot["items"][0]):
                self.assertEqual(record["instrumentId"], "binance:usdm:NVDAUSDT")
                self.assertEqual(record["marketType"], "usdm")
                self.assertEqual(record["venue"], "BINANCE_USDM_FUTURES")
                self.assertEqual(record["assetClass"], "equity")
        finally:
            conn.close()

    def test_legacy_equity_order_remains_supported(self):
        conn = STORE.connect(create=True)
        try:
            STORE.create_account(conn, {"id": "legacy", "initialKrw": 0, "initialUsd": 1000})
            snapshot, filled, order, trade = STORE.buy_stock(
                conn,
                {
                    "simulatorId": "legacy",
                    "symbol": "AAPL",
                    "market": "NASDAQ",
                    "marketCountry": "US",
                    "currency": "USD",
                    "price": 100,
                    "quantity": 1,
                    "feeAmount": 1,
                },
            )
            self.assertTrue(filled)
            self.assertEqual(order["instrumentId"], "")
            self.assertEqual(trade["provider"], "")
            self.assertEqual(snapshot["items"][0]["marketCountry"], "US")
            self.assertEqual(snapshot["balances"]["USD"], 899)
        finally:
            conn.close()

    def test_binance_halted_instrument_is_not_filled(self):
        conn = STORE.connect(create=True)
        try:
            STORE.create_account(conn, {"id": "halted", "initialKrw": 0, "initialUsd": 6400})
            with self.assertRaisesRegex(ValueError, "status must be TRADING"):
                STORE.buy_stock(
                    conn,
                    binance_instrument_payload(
                        simulatorId="halted",
                        status="HALT",
                        price="64000",
                        quantity="0.1",
                    ),
                )
            self.assertEqual(conn.execute("SELECT COUNT(*) FROM simulator_orders").fetchone()[0], 0)
            self.assertEqual(conn.execute("SELECT COUNT(*) FROM simulator_trades").fetchone()[0], 0)
        finally:
            conn.close()

    def test_binance_order_without_authoritative_trading_status_is_not_filled(self):
        conn = STORE.connect(create=True)
        try:
            STORE.create_account(conn, {"id": "missing-status", "initialKrw": 0, "initialUsd": 6400})
            with self.assertRaisesRegex(ValueError, "status must be TRADING"):
                STORE.buy_stock(
                    conn,
                    binance_instrument_payload(
                        simulatorId="missing-status",
                        status="",
                        price="64000",
                        quantity="0.1",
                    ),
                )
            self.assertEqual(conn.execute("SELECT COUNT(*) FROM simulator_orders").fetchone()[0], 0)
            self.assertEqual(conn.execute("SELECT COUNT(*) FROM simulator_trades").fetchone()[0], 0)
        finally:
            conn.close()

    def test_buy_rejects_inconsistent_amount_quantity_and_execution_price(self):
        conn = STORE.connect(create=True)
        try:
            STORE.create_account(conn, {"id": "bad-math", "initialKrw": 0, "initialUsd": 1000})
            with self.assertRaisesRegex(ValueError, "inconsistent"):
                STORE.buy_stock(
                    conn,
                    binance_instrument_payload(
                        simulatorId="bad-math",
                        price="100",
                        quantity="100",
                        settlementAmount="1",
                    ),
                )
            self.assertEqual(conn.execute("SELECT COUNT(*) FROM simulator_orders").fetchone()[0], 0)
            self.assertEqual(conn.execute("SELECT COUNT(*) FROM simulator_trades").fetchone()[0], 0)
        finally:
            conn.close()

    def test_orders_without_an_idempotency_key_do_not_collide_inside_the_same_second(self):
        conn = STORE.connect(create=True)
        try:
            STORE.create_account(conn, {"id": "no-key", "initialKrw": 0, "initialUsd": 1000})
            payload = binance_instrument_payload(
                simulatorId="no-key",
                price="100",
                quantity="1",
                settlementAmount="100",
            )
            _, first_filled, _, _ = STORE.buy_stock(conn, payload)
            _, second_filled, _, _ = STORE.buy_stock(conn, payload)
            self.assertTrue(first_filled)
            self.assertTrue(second_filled)
            self.assertEqual(conn.execute("SELECT COUNT(*) FROM simulator_trades").fetchone()[0], 2)
        finally:
            conn.close()


if __name__ == "__main__":
    unittest.main()
