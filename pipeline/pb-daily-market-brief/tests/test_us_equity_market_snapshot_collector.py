from __future__ import annotations

import os
import unittest
from datetime import date, timedelta
from unittest.mock import patch

from build_daily_snapshot import build_scoreboard
from collect_us_equity_market_snapshot import (
    CORE_MARKET_BENCHMARKS,
    DEFAULT_ALPACA_FEED,
    alpaca_batch_request_plan,
    benchmark_rows_from_etf_metrics,
    collect_market_snapshot,
    supplemental_request_plan,
)


def metric(ticker: str, close: float = 100.0) -> dict:
    return {
        "ticker": ticker,
        "as_of": "2026-07-22",
        "close": close,
        "return_1d_pct": 1.0,
        "return_5d_pct": 2.0,
        "return_20d_pct": 4.0,
    }


def etf_metrics() -> dict:
    return {
        "report_date": "2026-07-23",
        "items": [
            metric("SPY", 700),
            metric("IWM", 250),
            metric("XLE", 95),
            metric("XLF", 55),
            metric("XLK", 290),
        ],
    }


def universe() -> dict:
    return {
        "securities": [
            {
                "ticker": "NVDA",
                "company_name": "NVIDIA Corporation",
                "sector_ids": ["semiconductors_ai_compute"],
                "selection_reasons": ["current_sec_filing"],
            },
            {
                "ticker": "TSLA",
                "company_name": "Tesla, Inc.",
                "sector_ids": ["electric_vehicles_autonomy"],
                "selection_reasons": ["current_sec_filing"],
            },
            {
                "ticker": "MSFT",
                "company_name": "Microsoft Corporation",
                "sector_ids": ["cloud_saas_cybersecurity"],
                "selection_reasons": ["configured_watchlist"],
            },
        ],
    }


def daily_series(base: float = 100.0) -> list[dict]:
    start = date(2026, 6, 1)
    return [
        {
            "date": start + timedelta(days=index),
            "close": base + index,
            "volume": 1_000_000 + index * 10_000,
        }
        for index in range(52)
    ]


class UsEquityMarketSnapshotCollectorTests(unittest.TestCase):
    def test_existing_etf_metrics_are_reused_with_reference_closes(self) -> None:
        rows = benchmark_rows_from_etf_metrics(etf_metrics())
        spy = next(row for row in rows if row["ticker"] == "SPY")
        self.assertAlmostEqual(spy["previous_close"], 700 / 1.01)
        self.assertAlmostEqual(spy["close_5_sessions_ago"], 700 / 1.02)
        self.assertEqual(spy["lineage"], "reused_daily_etf_metrics")

    def test_plan_prioritizes_sec_events_breadth_and_missing_sectors(self) -> None:
        rows = benchmark_rows_from_etf_metrics(etf_metrics())
        plan = supplemental_request_plan(universe(), rows, request_budget=7)
        self.assertEqual(
            [row["ticker"] for row in plan],
            ["NVDA", "TSLA", "RSP", "MDY", "XLC", "XLY", "XLP"],
        )
        self.assertEqual([row["kind"] for row in plan[:2]], ["security", "security"])

    def test_alpaca_plan_requests_market_panel_and_authorized_universe(self) -> None:
        rows = benchmark_rows_from_etf_metrics(etf_metrics())
        plan = alpaca_batch_request_plan(universe(), rows)
        requested = {row["ticker"] for row in plan}
        self.assertEqual(
            requested,
            (set(CORE_MARKET_BENCHMARKS) - {"SPY", "IWM", "XLE", "XLF", "XLK"})
            | {"NVDA", "TSLA", "MSFT"},
        )
        self.assertEqual(
            {
                row["ticker"]
                for row in plan
                if row["kind"] == "security"
            },
            {"NVDA", "TSLA", "MSFT"},
        )

    def test_alpaca_plan_bounds_the_screening_universe(self) -> None:
        rows = benchmark_rows_from_etf_metrics(etf_metrics())
        expanded = {
            "securities": [
                {
                    "ticker": f"T{index:03}",
                    "company_name": f"Company {index}",
                    "selection_reasons": ["verified_index_membership"],
                    "sector_ids": [],
                }
                for index in range(20)
            ],
        }
        plan = alpaca_batch_request_plan(
            expanded,
            rows,
            maximum_event_securities=0,
            maximum_screen_securities=7,
        )
        self.assertEqual(
            sum(row["kind"] == "security" for row in plan),
            7,
        )

    def test_collection_builds_valid_partial_batch_with_security_volume(self) -> None:
        calls = []

        def fetcher(ticker: str, api_key: str) -> list[dict]:
            calls.append((ticker, api_key))
            return daily_series(100 + len(calls))

        payload = collect_market_snapshot(
            "2026-07-23",
            universe(),
            etf_metrics(),
            "test-key",
            request_budget=7,
            fetcher=fetcher,
        )
        self.assertEqual(payload["collection_status"], "complete_for_plan")
        self.assertEqual(payload["collection"]["request_count"], 7)
        self.assertEqual(len(payload["securities"]), 2)
        self.assertEqual(len(payload["benchmarks"]), 10)
        self.assertGreater(payload["securities"][0]["avg_volume_20d"], 0)
        self.assertEqual(payload["rights_label"], "provider_permitted_internal_research")
        self.assertNotIn("raw_series", payload)

    def test_provider_failure_keeps_reusable_rows_without_fabrication(self) -> None:
        def failing_fetcher(ticker: str, api_key: str) -> list[dict]:
            raise RuntimeError("provider unavailable")

        payload = collect_market_snapshot(
            "2026-07-23",
            universe(),
            etf_metrics(),
            "test-key",
            request_budget=2,
            fetcher=failing_fetcher,
        )
        self.assertEqual(payload["collection_status"], "partial")
        self.assertEqual(payload["securities"], [])
        self.assertEqual(len(payload["benchmarks"]), 5)
        self.assertEqual(len(payload["collection"]["errors"]), 2)

    def test_alpaca_batch_completes_all_nineteen_market_benchmarks(self) -> None:
        alpha_calls = []
        alpaca_calls = []

        def alpha_fetcher(ticker: str, api_key: str) -> list[dict]:
            alpha_calls.append((ticker, api_key))
            return daily_series()

        def alpaca_fetcher(
            tickers: list[str],
            api_key_id: str,
            secret_key: str,
            report_date: str,
            *,
            feed: str,
        ) -> dict[str, list[dict]]:
            alpaca_calls.append((tickers, api_key_id, secret_key, report_date, feed))
            return {
                ticker: daily_series(100 + index)
                for index, ticker in enumerate(tickers)
            }

        payload = collect_market_snapshot(
            "2026-07-23",
            universe(),
            etf_metrics(),
            "alpha-key",
            request_budget=7,
            fetcher=alpha_fetcher,
            alpaca_api_key_id="alpaca-id",
            alpaca_secret_key="alpaca-secret",
            alpaca_feed="sip",
            alpaca_fetcher=alpaca_fetcher,
        )
        self.assertEqual(len(alpaca_calls), 1)
        self.assertEqual(alpha_calls, [])
        self.assertEqual(payload["collection_status"], "complete_for_plan")
        self.assertEqual(payload["collection"]["available_required_benchmark_count"], 19)
        self.assertEqual(payload["collection"]["missing_required_benchmarks"], [])
        self.assertTrue(payload["collection"]["market_internals_ready"])
        self.assertEqual(len(payload["benchmarks"]), 19)
        self.assertEqual(len(payload["securities"]), 3)
        self.assertEqual(
            payload["collection"]["screening_security_requested_count"],
            3,
        )
        self.assertIn("Alpaca Historical Bars", payload["source_provider"])

    def test_alpaca_failure_falls_back_to_bounded_alpha_plan(self) -> None:
        alpha_calls = []
        alpaca_calls = []

        def alpha_fetcher(ticker: str, api_key: str) -> list[dict]:
            alpha_calls.append((ticker, api_key))
            return daily_series(100 + len(alpha_calls))

        def alpaca_fetcher(*args, **kwargs) -> dict[str, list[dict]]:
            alpaca_calls.append((args, kwargs))
            raise RuntimeError("entitlement unavailable")

        payload = collect_market_snapshot(
            "2026-07-23",
            universe(),
            etf_metrics(),
            "alpha-key",
            request_budget=7,
            fetcher=alpha_fetcher,
            alpaca_api_key_id="alpaca-id",
            alpaca_secret_key="alpaca-secret",
            alpaca_fetcher=alpaca_fetcher,
        )
        self.assertEqual(len(alpha_calls), 7)
        self.assertEqual(alpaca_calls[0][1]["feed"], DEFAULT_ALPACA_FEED)
        self.assertEqual(payload["collection_status"], "partial")
        self.assertEqual(payload["collection"]["available_benchmark_count"], 10)
        self.assertFalse(payload["collection"]["market_internals_ready"])
        self.assertEqual(payload["collection"]["errors"][0]["provider"], "alpaca")

    def test_missing_alpaca_credentials_are_explicit(self) -> None:
        payload = collect_market_snapshot(
            "2026-07-23",
            universe(),
            etf_metrics(),
            "",
            request_budget=0,
        )
        self.assertFalse(payload["collection"]["alpaca_batch_enabled"])
        self.assertEqual(
            payload["collection"]["alpaca_configuration_status"],
            "missing_credentials",
        )

    def test_scoreboard_reuses_managed_rsp_without_alpha_vantage_fallback(self) -> None:
        market_input = {
            "as_of": "2026-07-22",
            "benchmarks": [{
                "ticker": "RSP",
                "close": 180.0,
                "previous_close": 178.0,
                "close_5_sessions_ago": 175.0,
                "close_20_sessions_ago": 170.0,
            }],
        }
        with patch.dict(os.environ, {}, clear=True):
            scoreboard, warnings = build_scoreboard(
                "2026-07-23",
                etf_metrics(),
                market_input,
            )
        self.assertNotEqual(scoreboard["breadth"].get("status"), "missing_required_source")
        self.assertAlmostEqual(scoreboard["breadth"]["rsp_return_1d_pct"], (180 / 178 - 1) * 100)
        self.assertFalse(any("RSP unavailable" in warning for warning in warnings))


if __name__ == "__main__":
    unittest.main()
