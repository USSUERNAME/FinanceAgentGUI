#!/usr/bin/env python3
import importlib.util
import sqlite3
import unittest
from datetime import datetime, timezone
from pathlib import Path


SCRIPT_PATH = Path(__file__).with_name("tossinvest_position_reconstruct.py")
SPEC = importlib.util.spec_from_file_location("tossinvest_position_reconstruct", SCRIPT_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class InvestmentHistoryValueFieldTest(unittest.TestCase):
    def test_sparse_market_values_do_not_zero_full_history(self):
        points = [
            {
                "time": "2024-02-07",
                "marketValueKrw": 0,
                "marketValueUsd": 0,
                "rawMarketValue": 0,
                "knownCostBasisKrw": 1_992_958.86,
                "knownCostBasisUsd": 1_497.79,
                "rawKnownCostBasis": 1_497.79,
                "positionCount": 8,
            },
            {
                "time": "2026-07-09",
                "marketValueKrw": 2_666_753.55,
                "marketValueUsd": 1_955.22,
                "rawMarketValue": 1_955.22,
                "knownCostBasisKrw": 3_091_327.52,
                "knownCostBasisUsd": 2_265.12,
                "rawKnownCostBasis": 2_265.12,
                "positionCount": 15,
            },
        ]

        value_field = MODULE.choose_value_field(points, "KRW")

        self.assertEqual(value_field, "knownCostBasisKrw")
        self.assertEqual(MODULE.history_point_value(points[0], value_field, "KRW"), 1_992_958.86)
        self.assertEqual(MODULE.history_point_value(points[1], value_field, "KRW"), 3_091_327.52)

    def test_market_value_is_used_when_selected_range_has_coverage(self):
        points = [
            {
                "time": "2026-07-08",
                "marketValueKrw": 2_670_463.48,
                "marketValueUsd": 1_958.40,
                "rawMarketValue": 1_958.40,
                "knownCostBasisKrw": 3_095_628.12,
                "knownCostBasisUsd": 2_268.27,
                "rawKnownCostBasis": 2_268.27,
                "positionCount": 15,
            },
            {
                "time": "2026-07-09",
                "marketValueKrw": 2_666_753.55,
                "marketValueUsd": 1_955.22,
                "rawMarketValue": 1_955.22,
                "knownCostBasisKrw": 3_091_327.52,
                "knownCostBasisUsd": 2_265.12,
                "rawKnownCostBasis": 2_265.12,
                "positionCount": 15,
            },
        ]

        value_field = MODULE.choose_value_field(points, "KRW")

        self.assertEqual(value_field, "marketValueKrw")
        self.assertEqual(MODULE.history_point_value(points[0], value_field, "KRW"), 2_670_463.48)
        self.assertEqual(MODULE.history_point_value(points[1], value_field, "KRW"), 2_666_753.55)

    def test_rebuild_plan_backfills_existing_snapshots_missing_market_values(self):
        conn = sqlite3.connect(":memory:")
        conn.row_factory = sqlite3.Row
        MODULE.init_snapshot_db(conn)
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
              'daily', '2026-07-07', '1', 'USD', 'NVDA', '2026-07-07T23:59:59+09:00',
              '1', '1', '0', '0',
              '100', '1400', '100', '140000',
              '', '', '', '', '', '', '', '100',
              1, 0, 'old-run', '2026-07-08T00:00:00Z'
            )
            """
        )
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
              'monthly', '2026-07-07', '1', 'USD', 'NVDA', '2026-07-07T23:59:59+09:00',
              '1', '1', '0', '0',
              '100', '1400', '100', '140000',
              '', '', '', '', '', '', '', '100',
              1, 0, 'old-run', '2026-07-08T00:00:00Z'
            )
            """
        )
        targets = [datetime(2026, 7, 7, 14, 59, 59, tzinfo=timezone.utc)]
        trades = [{"eventAt": datetime(2026, 7, 1, 1, 0, tzinfo=timezone.utc)}]

        plan = MODULE.rebuild_target_plan(conn, trades, targets, targets, force_full=False)

        self.assertEqual(plan["mode"], "incremental-backfill")
        self.assertEqual(plan["daily"]["marketGapCount"], 1)
        self.assertEqual([MODULE.date_key(target) for target in plan["daily"]["targets"]], ["2026-07-07"])
        self.assertEqual([MODULE.date_key(target) for target in plan["monthly"]["targets"]], ["2026-07-07"])

    def test_cached_market_symbols_require_candles_inside_requested_range(self):
        conn = sqlite3.connect(":memory:")
        conn.row_factory = sqlite3.Row
        MODULE.init_snapshot_db(conn)
        conn.execute(
            """
            INSERT INTO market_candle_cache_state (
              symbol, requested_start_date, requested_end_date, updated_at
            ) VALUES ('NVDA', '2026-07-01', '2026-07-10', '2026-07-10T00:00:00Z')
            """
        )
        conn.execute(
            """
            INSERT INTO market_candles (
              symbol, price_date, timestamp, currency, close_price, source, updated_at
            ) VALUES ('NVDA', '2026-06-30', '2026-06-30T00:00:00Z', 'USD', '100', 'tossinvest-candles', '2026-07-10T00:00:00Z')
            """
        )

        self.assertEqual(MODULE.cached_market_symbols(conn, ["NVDA"], "2026-07-01", "2026-07-10"), [])

        conn.execute(
            """
            INSERT INTO market_candles (
              symbol, price_date, timestamp, currency, close_price, source, updated_at
            ) VALUES ('NVDA', '2026-07-07', '2026-07-07T00:00:00Z', 'USD', '120', 'tossinvest-candles', '2026-07-10T00:00:00Z')
            """
        )

        self.assertEqual(MODULE.cached_market_symbols(conn, ["NVDA"], "2026-07-01", "2026-07-10"), ["NVDA"])


if __name__ == "__main__":
    unittest.main()
