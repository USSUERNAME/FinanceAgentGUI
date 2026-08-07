from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from analyze_market_snapshot import bounded_us_market_internals
from build_daily_snapshot import load_us_market_internals
from build_us_market_internals import (
    REQUIRED_TICKERS,
    SECTOR_ETFS,
    build_us_market_internals,
)


def market_row(ticker: str, close: float = 101.0) -> dict:
    return {
        "ticker": ticker,
        "close": close,
        "previous_close": 100.0,
        "close_5_sessions_ago": 100.0,
        "close_20_sessions_ago": 95.0,
    }


def market_input(
    *,
    as_of: str = "2026-07-22",
    include: set[str] | None = None,
) -> dict:
    tickers = include if include is not None else set(REQUIRED_TICKERS)
    benchmarks = []
    for ticker in sorted(tickers):
        close = 101.0
        if ticker in {"RSP", "IWM", "MDY"}:
            close = 104.0
        elif ticker in list(SECTOR_ETFS)[:8]:
            close = 103.0
        elif ticker in SECTOR_ETFS:
            close = 99.0
        benchmarks.append(market_row(ticker, close))
    return {
        "schema_version": "us_equity_market_snapshot_input.v1",
        "report_date": "2026-07-23",
        "source_provider": "Licensed provider",
        "source_url": "https://provider.example/docs",
        "source_grade": "B",
        "rights_label": "licensed_internal_use",
        "as_of": as_of,
        "market_cutoff": "official_close",
        "benchmarks": benchmarks,
        "collection": {
            "alpaca_batch_enabled": True,
            "alpaca_feed": "iex",
            "alpaca_configuration_status": "ready",
        },
        "securities": [],
    }


def constituent_breadth(
    *,
    advance_pct: float = 60.0,
    above_50d_pct: float = 62.0,
) -> dict:
    return {
        "schema_version": "us_constituent_breadth.v1",
        "report_date": "2026-07-23",
        "collection_status": "ready",
        "breadth": {
            "advance_decline": {"advance_pct": advance_pct},
            "moving_averages": {
                "50d": {"above_pct": above_50d_pct},
            },
        },
    }


class UsMarketInternalsTests(unittest.TestCase):
    def test_missing_market_input_is_nonfatal(self) -> None:
        payload = build_us_market_internals("2026-07-23", None)
        self.assertEqual(payload["collection_status"], "missing_market_snapshot_input")
        self.assertEqual(
            payload["market_structure"]["classification"],
            "insufficient_data",
        )

    def test_full_coverage_builds_broadening_sector_and_style_view(self) -> None:
        payload = build_us_market_internals("2026-07-23", market_input())
        self.assertEqual(payload["collection_status"], "ready")
        self.assertEqual(payload["coverage"]["missing_tickers"], [])
        self.assertEqual(payload["market_structure"]["classification"], "broadening")
        self.assertEqual(len(payload["breadth_and_size"]), 3)
        self.assertEqual(len(payload["style_pairs"]), 5)
        self.assertEqual(
            payload["sector_leadership"]["5d"]["covered_sector_count"],
            11,
        )
        self.assertEqual(
            payload["sector_leadership"]["5d"]["outperforming_spy_count"],
            8,
        )

    def test_constituent_breadth_confirms_market_structure(self) -> None:
        payload = build_us_market_internals(
            "2026-07-23",
            market_input(),
            constituent_breadth(),
        )
        self.assertEqual(payload["market_structure"]["classification"], "broadening")
        confirmation = payload["market_structure"]["constituent_confirmation"]
        self.assertEqual(confirmation["advance_pct"], 60.0)
        self.assertEqual(confirmation["above_50d_pct"], 62.0)
        self.assertEqual(
            payload["constituent_breadth"]["collection_status"],
            "ready",
        )

    def test_partial_coverage_is_labeled_without_estimation(self) -> None:
        payload = build_us_market_internals(
            "2026-07-23",
            market_input(include={"SPY", "RSP", "IWM", "XLK", "XLF"}),
        )
        self.assertEqual(payload["collection_status"], "partial_coverage")
        self.assertEqual(
            payload["market_structure"]["classification"],
            "insufficient_data",
        )
        self.assertIn("XLE", payload["coverage"]["missing_tickers"])

    def test_missing_provider_configuration_is_preserved_as_a_data_gap(self) -> None:
        partial_input = market_input(
            include={"SPY", "IWM", "XLK", "XLF", "XLE"}
        )
        partial_input["collection"] = {
            "alpaca_batch_enabled": False,
            "alpaca_feed": None,
            "alpaca_configuration_status": "missing_credentials",
        }
        blocked_breadth = {
            "schema_version": "us_constituent_breadth.v1",
            "report_date": "2026-07-23",
            "collection_status": "blocked",
            "data_gaps": [
                "Alpaca credentials are required for constituent breadth."
            ],
        }
        payload = build_us_market_internals(
            "2026-07-23",
            partial_input,
            blocked_breadth,
        )
        self.assertFalse(
            payload["market_source"]["provider_configuration"][
                "alpaca_batch_enabled"
            ]
        )
        self.assertTrue(
            any(
                "complete 19-ticker market panel" in gap
                for gap in payload["data_gaps"]
            )
        )
        self.assertIn(
            "Alpaca credentials are required for constituent breadth.",
            payload["data_gaps"],
        )

    def test_stale_market_input_never_reports_ready(self) -> None:
        payload = build_us_market_internals(
            "2026-07-23",
            market_input(as_of="2026-07-10"),
        )
        self.assertEqual(payload["collection_status"], "stale_market_snapshot")
        self.assertEqual(payload["market_source"]["freshness_status"], "stale")

    def test_model_input_keeps_rankings_bounded(self) -> None:
        payload = build_us_market_internals("2026-07-23", market_input())
        payload["sector_leadership"]["5d"]["all_sectors"].append({
            "ticker": "EXTRA",
            "sector": "Extra",
            "return_pct": 99.0,
            "vs_spy_pct_point": 99.0,
        })
        bounded = bounded_us_market_internals({"us_market_internals": payload})
        self.assertEqual(len(bounded["sector_leadership"]["5d"]["all_sectors"]), 11)
        self.assertEqual(len(bounded["breadth_and_size"]), 3)
        self.assertEqual(len(bounded["style_pairs"]), 5)
        self.assertEqual(
            bounded["posture"],
            "market_structure_observation_not_investment_recommendation",
        )

    def test_snapshot_loader_rejects_wrong_report_date(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            path = Path(temp_dir) / "market_internals.json"
            payload = build_us_market_internals("2026-07-23", market_input())
            payload["report_date"] = "2026-07-22"
            path.write_text(json.dumps(payload), encoding="utf-8")
            loaded = load_us_market_internals(path, "2026-07-23")
        self.assertEqual(loaded["collection_status"], "report_date_mismatch")
        self.assertEqual(
            loaded["market_structure"]["classification"],
            "insufficient_data",
        )


if __name__ == "__main__":
    unittest.main()
