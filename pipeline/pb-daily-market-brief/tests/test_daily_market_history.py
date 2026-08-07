from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from analyze_market_snapshot import bounded_input
from record_daily_market_history import (
    compact_market_state,
    compare_market_states,
    load_previous_state,
    record_daily_market_history,
)


def snapshot(report_date: str, spy_close: float, structure: str, candidate: str) -> dict:
    return {
        "schema_version": "daily_market_snapshot.v1",
        "report_date": report_date,
        "generated_at": f"{report_date}T08:00:00+09:00",
        "market_scoreboard": {
            "breadth": {"rsp_vs_spy_5d_pct": 0.5},
            "volatility": {"vix_term_ratio": 0.9},
            "credit": {"high_yield_oas": {"value": 2.7}},
            "rates": {
                "nominal_10y": {"value": 4.5},
                "real_10y": {"value": 2.2},
            },
        },
        "etf_metrics": {
            "items": [{
                "ticker": "SPY",
                "as_of": report_date,
                "close": spy_close,
                "return_1d_pct": 1.0,
                "return_5d_pct": 2.0,
                "return_20d_pct": 3.0,
            }]
        },
        "us_market_internals": {
            "market_structure": {
                "classification": structure,
                "reason": "test",
            },
            "coverage": {"available_ticker_count": 11},
            "sector_leadership": {
                "5d": {"leaders": [{"ticker": "XLK"}]}
            },
        },
        "us_equity_candidate_screen": {
            "candidates": [{
                "ticker": candidate,
                "selection_score": 40,
                "deep_analysis_eligible": True,
            }]
        },
        "korea_market": {
            "collection_status": "complete",
            "transmission_gate": {"status": "ready"},
        },
    }


class DailyMarketHistoryTests(unittest.TestCase):
    def test_compact_state_and_comparison_capture_report_changes(self) -> None:
        previous = compact_market_state(
            snapshot("2026-07-22", 100.0, "broadening", "NVDA")
        )
        current = compact_market_state(
            snapshot("2026-07-23", 102.0, "mixed_rotation", "TSLA")
        )
        changes = compare_market_states(current, previous)
        self.assertEqual(changes["status"], "compared")
        self.assertEqual(changes["etf_close_changes_pct"]["SPY"], 2.0)
        self.assertTrue(changes["market_structure_change"]["changed"])
        self.assertEqual(changes["candidate_changes"]["added"], ["TSLA"])
        self.assertEqual(changes["candidate_changes"]["removed"], ["NVDA"])

    def test_record_attaches_previous_comparison_and_writes_current_state(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            history = root / "history"
            history.mkdir()
            previous = compact_market_state(
                snapshot("2026-07-22", 100.0, "broadening", "NVDA")
            )
            (history / "2026-07-22.json").write_text(
                json.dumps(previous),
                encoding="utf-8",
            )
            snapshot_path = root / "daily_snapshot.json"
            snapshot_path.write_text(
                json.dumps(snapshot("2026-07-23", 101.0, "mixed_rotation", "TSLA")),
                encoding="utf-8",
            )
            updated, output = record_daily_market_history(snapshot_path, history)
            self.assertTrue(output.exists())
            self.assertEqual(
                updated["day_over_day_changes"]["previous_report_date"],
                "2026-07-22",
            )
            persisted = json.loads(snapshot_path.read_text(encoding="utf-8"))
            self.assertEqual(persisted["day_over_day_changes"]["status"], "compared")

    def test_loader_uses_latest_strictly_prior_report(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            history = Path(directory)
            for report_date in ("2026-07-20", "2026-07-22", "2026-07-23"):
                (history / f"{report_date}.json").write_text(
                    json.dumps({"report_date": report_date}),
                    encoding="utf-8",
                )
            previous = load_previous_state(history, "2026-07-23")
            self.assertEqual(previous["report_date"], "2026-07-22")

    def test_bounded_analysis_input_receives_deterministic_comparison(self) -> None:
        payload = snapshot("2026-07-23", 101.0, "mixed_rotation", "TSLA")
        payload["day_over_day_changes"] = {"status": "compared"}
        self.assertEqual(
            bounded_input(payload)["day_over_day_changes"]["status"],
            "compared",
        )


if __name__ == "__main__":
    unittest.main()
