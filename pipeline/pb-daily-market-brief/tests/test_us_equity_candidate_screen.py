from __future__ import annotations

import copy
import unittest

from screen_us_equity_candidates import (
    carried_candidate_evidence,
    screen_us_equity_candidates,
    validate_market_input,
)


def universe(tickers: tuple[str, ...] = ("NVDA", "MSFT", "TSLA")) -> dict:
    return {
        "schema_version": "us_equity_universe.v1",
        "security_count": len(tickers),
        "securities": [
            {
                "ticker": ticker,
                "company_name": ticker,
                "index_memberships": ["sp500"],
                "sector_ids": ["semiconductors_ai_compute"] if ticker == "NVDA" else [],
            }
            for ticker in tickers
        ],
    }


def market_input(rows: list[dict] | None = None, as_of: str = "2026-07-22") -> dict:
    return {
        "schema_version": "us_equity_market_snapshot_input.v1",
        "report_date": "2026-07-23",
        "source_provider": "Licensed provider",
        "source_url": "https://provider.example/docs",
        "source_grade": "B",
        "rights_label": "licensed_internal_use",
        "as_of": as_of,
        "market_cutoff": "official_close",
        "benchmarks": [
            {
                "ticker": "SPY",
                "close": 100.0,
                "previous_close": 100.0,
                "close_5_sessions_ago": 100.0,
                "close_20_sessions_ago": 98.0,
            },
            {
                "ticker": "SOXX",
                "close": 102.0,
                "previous_close": 100.0,
                "close_5_sessions_ago": 98.0,
                "close_20_sessions_ago": 95.0,
            },
        ],
        "securities": rows or [{
            "ticker": "NVDA",
            "company_name": "NVIDIA",
            "sector_etf": "SOXX",
            "close": 90.0,
            "previous_close": 100.0,
            "close_5_sessions_ago": 105.0,
            "close_20_sessions_ago": 95.0,
            "volume": 400.0,
            "avg_volume_20d": 100.0,
        }],
    }


def sec_event(
    ticker: str = "NVDA",
    *,
    body_verified: bool = True,
    grade: str = "A",
    primary: bool = True,
) -> dict:
    return {
        "id": f"sec-{ticker}",
        "source_id": "sec_edgar",
        "source_grade": grade,
        "primary_source_confirmed": primary,
        "tickers": [ticker],
        "tags": ["sec", "8-K"],
        "title": f"{ticker} 8-K filed",
        "url": "https://www.sec.gov/Archives/example",
        "evidence_scope": "filing_body_excerpt" if body_verified else "filing_metadata_only",
        "evidence_label": (
            "verified_primary_body_excerpt" if body_verified else "fact_source_reported"
        ),
        "filing_facts": {
            "facts": [{
                "fact_id": f"fact-{ticker}",
                "field": "sec_item",
                "value_text": "2.02",
                "context": "Item 2.02 Results of Operations.",
                "evidence_status": "exact_text_excerpt",
                "evidence_scope": "bounded_filing_body_excerpt",
                "source_url": "https://www.sec.gov/Archives/example",
            }] if body_verified else [],
        },
    }


class UsEquityCandidateScreenTests(unittest.TestCase):
    def test_missing_market_input_is_explicit_and_nonfatal(self) -> None:
        payload = screen_us_equity_candidates(
            "2026-07-23",
            universe(),
            [sec_event()],
            None,
        )
        self.assertEqual(payload["screen_status"], "missing_market_snapshot_input")
        self.assertEqual(payload["candidates"], [])

    def test_price_volume_sec_and_relative_scores_create_shortlist(self) -> None:
        payload = screen_us_equity_candidates(
            "2026-07-23",
            universe(),
            [sec_event()],
            market_input(),
        )
        row = payload["candidates"][0]
        self.assertEqual(payload["screen_status"], "deep_analysis_shortlist_ready")
        self.assertEqual(row["ticker"], "NVDA")
        self.assertEqual(row["score_breakdown"]["event_importance"], 20)
        self.assertEqual(row["score_breakdown"]["abnormal_price_move"], 20)
        self.assertEqual(row["score_breakdown"]["volume_anomaly"], 15)
        self.assertEqual(row["score_breakdown"]["official_material"], 10)
        self.assertTrue(row["deep_analysis_eligible"])
        self.assertEqual(payload["deep_analysis_count"], 1)

    def test_same_day_regeneration_can_carry_verified_evidence_forward(self) -> None:
        first = screen_us_equity_candidates(
            "2026-07-23",
            universe(),
            [sec_event()],
            market_input(),
        )
        records = carried_candidate_evidence(first, "2026-07-23")
        regenerated = screen_us_equity_candidates(
            "2026-07-23",
            universe(),
            records,
            market_input(),
        )
        self.assertEqual(len(records), 1)
        self.assertTrue(regenerated["candidates"][0]["deep_analysis_eligible"])
        self.assertEqual(
            regenerated["candidates"][0]["event_evidence"][0]["verified_facts"][0]["field"],
            "sec_item",
        )

    def test_metadata_only_primary_filing_stays_out_of_deep_analysis(self) -> None:
        payload = screen_us_equity_candidates(
            "2026-07-23",
            universe(),
            [sec_event(body_verified=False)],
            market_input(),
        )
        row = payload["candidates"][0]
        self.assertEqual(row["score_breakdown"]["official_material"], 6)
        self.assertEqual(
            row["event_evidence"][0]["evidence_scope"],
            "filing_metadata_only",
        )
        self.assertFalse(row["deep_analysis_eligible"])
        self.assertEqual(payload["deep_analysis_count"], 0)

    def test_primary_body_without_supported_fact_stays_out_of_deep_analysis(self) -> None:
        event = sec_event()
        event["filing_facts"] = {"facts": []}
        payload = screen_us_equity_candidates(
            "2026-07-23",
            universe(),
            [event],
            market_input(),
        )
        row = payload["candidates"][0]
        self.assertEqual(
            row["evidence_status"],
            "primary_body_without_supported_facts",
        )
        self.assertFalse(row["deep_analysis_eligible"])

    def test_grade_d_news_does_not_unlock_deep_analysis(self) -> None:
        news = {
            "id": "news-nvda",
            "source_id": "newsapi",
            "source_grade": "D",
            "primary_source_confirmed": False,
            "tickers": ["NVDA"],
            "tags": ["earnings"],
            "title": "NVDA headline",
            "url": "https://example.com/news",
            "evidence_scope": "metadata_only",
            "evidence_label": "metadata_only",
        }
        payload = screen_us_equity_candidates(
            "2026-07-23",
            universe(),
            [news],
            market_input(),
        )
        row = payload["candidates"][0]
        self.assertEqual(row["score_breakdown"]["official_material"], 0)
        self.assertFalse(row["deep_analysis_eligible"])
        self.assertEqual(payload["deep_analysis_count"], 0)

    def test_stale_market_data_blocks_deep_analysis(self) -> None:
        payload = screen_us_equity_candidates(
            "2026-07-23",
            universe(),
            [sec_event()],
            market_input(as_of="2026-07-10"),
        )
        self.assertEqual(payload["screen_status"], "stale_market_snapshot")
        self.assertEqual(payload["deep_analysis_count"], 0)
        self.assertFalse(payload["candidates"][0]["deep_analysis_eligible"])

    def test_out_of_universe_market_row_is_excluded(self) -> None:
        rows = market_input()["securities"] + [{
            "ticker": "OUT",
            "company_name": "Outside Universe",
            "close": 50.0,
            "previous_close": 100.0,
            "close_5_sessions_ago": 100.0,
            "close_20_sessions_ago": 100.0,
            "volume": 1000.0,
            "avg_volume_20d": 100.0,
        }]
        payload = screen_us_equity_candidates(
            "2026-07-23",
            universe(),
            [sec_event()],
            market_input(rows),
        )
        self.assertEqual(payload["market_covered_security_count"], 1)
        self.assertNotIn("OUT", [row["ticker"] for row in payload["candidates"]])

    def test_outputs_are_bounded_to_ten_candidates_and_three_deep_analysis(self) -> None:
        tickers = tuple(f"T{index:02}" for index in range(12))
        rows = [{
            "ticker": ticker,
            "company_name": ticker,
            "close": 90.0 - index,
            "previous_close": 100.0,
            "close_5_sessions_ago": 100.0,
            "close_20_sessions_ago": 100.0,
            "volume": 500.0,
            "avg_volume_20d": 100.0,
        } for index, ticker in enumerate(tickers)]
        payload = screen_us_equity_candidates(
            "2026-07-23",
            universe(tickers),
            [sec_event(ticker) for ticker in tickers],
            market_input(rows),
        )
        self.assertEqual(len(payload["candidates"]), 10)
        self.assertEqual(len(payload["deep_analysis_shortlist"]), 3)

    def test_market_input_rejects_unapproved_rights(self) -> None:
        payload = copy.deepcopy(market_input())
        payload["rights_label"] = "unknown"
        with self.assertRaisesRegex(ValueError, "automation-rights"):
            validate_market_input(payload, "2026-07-23")


if __name__ == "__main__":
    unittest.main()
