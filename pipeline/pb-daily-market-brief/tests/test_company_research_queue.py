from __future__ import annotations

import copy
import unittest

from build_company_research_queue import (
    build_company_research_queue,
    validate_company_research_queue,
)
from collect_sector_fundamentals import load_fundamental_registry
from sector_master import load_sector_master
from compose_daily_brief import source_section


def radar_row(stage: str = "emerging_research_candidate") -> dict:
    return {
        "thesis_id": "sector:semiconductors_ai_compute",
        "sector_id": "semiconductors_ai_compute",
        "name_ko": "반도체·AI 컴퓨트",
        "stage": stage,
        "stage_reason": "Non-market evidence strengthened.",
        "latest_leadership_score": 74.0,
    }


def radar(bucket: str = "advance_to_deeper_work") -> dict:
    row = radar_row("watchlist_needs_trigger" if bucket == "watchlist" else "emerging_research_candidate")
    return {
        "schema_version": "sector_leadership_radar.v1",
        "funnel": {
            "advance_to_deeper_work": [row] if bucket == "advance_to_deeper_work" else [],
            "reunderwrite": [],
            "watchlist": [row] if bucket == "watchlist" else [],
            "not_ready": [],
        },
    }


def fundamentals() -> dict:
    return {
        "estimate_observations": [{
            "sector_id": "semiconductors_ai_compute",
            "market": "US",
            "ticker": "NVDA",
            "status": "available",
            "score": 78.0,
            "score_candidate": 78.0,
            "eligible_for_sector_score": True,
            "as_of": "2026-07-20",
            "source_provider": "Alpha Vantage",
            "source_grade": "B",
            "source_url": "https://www.alphavantage.co/documentation/#earnings-estimates",
        }, {
            "sector_id": "semiconductors_ai_compute",
            "market": "KR",
            "ticker": "005930",
            "status": "available",
            "score": None,
            "score_candidate": 72.0,
            "eligible_for_sector_score": False,
            "as_of": "2026-07-20",
            "source_provider": "example",
            "source_grade": "B",
            "source_url": "https://example.com/estimates",
        }],
        "operating_observations": [],
    }


class CompanyResearchQueueTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.master = load_sector_master()
        cls.registry = load_fundamental_registry()

    def test_verified_exposure_and_financial_signal_advance_only_to_diligence(self) -> None:
        payload = build_company_research_queue(
            "2026-07-20", radar(), self.master, self.registry, fundamentals(),
        )
        nvda = next(row for row in payload["candidates"] if row["ticker"] == "NVDA")
        self.assertEqual(nvda["queue_stage"], "valuation_expectations_gated")
        self.assertEqual(nvda["actionability"], "advance_to_company_diligence")
        self.assertEqual(nvda["exposure_status"], "verified_primary")
        self.assertEqual(nvda["priced_in_status"], "data_gap")
        self.assertEqual(nvda["valuation_status"], "not_collected")
        self.assertEqual(payload["advance_count"], 1)

    def test_verified_exposure_without_signal_stays_waiting(self) -> None:
        payload = build_company_research_queue(
            "2026-07-20", radar(), self.master, self.registry, fundamentals(),
        )
        tsm = next(row for row in payload["candidates"] if row["ticker"] == "TSM")
        self.assertEqual(tsm["queue_stage"], "verified_exposure_needs_financial_signal")
        self.assertEqual(tsm["actionability"], "wait_for_proof")

    def test_provider_estimate_without_primary_exposure_cannot_advance(self) -> None:
        payload = build_company_research_queue(
            "2026-07-20", radar(), self.master, self.registry, fundamentals(),
        )
        samsung = next(row for row in payload["candidates"] if row["ticker"] == "005930")
        self.assertEqual(samsung["queue_stage"], "needs_exposure_attribution")
        self.assertEqual(samsung["exposure_status"], "candidate_unverified")
        self.assertNotIn(samsung, payload["funnel"]["advance_to_company_diligence"])

    def test_watchlist_sector_deprioritizes_even_verified_company(self) -> None:
        payload = build_company_research_queue(
            "2026-07-20", radar("watchlist"), self.master, self.registry, fundamentals(),
        )
        nvda = next(row for row in payload["candidates"] if row["ticker"] == "NVDA")
        self.assertEqual(nvda["queue_stage"], "sector_watchlist_only")
        self.assertEqual(payload["advance_count"], 0)

    def test_validator_rejects_false_advanced_candidate(self) -> None:
        payload = build_company_research_queue(
            "2026-07-20", radar(), self.master, self.registry, fundamentals(),
        )
        tampered = copy.deepcopy(payload)
        row = tampered["candidates"][0]
        row["queue_stage"] = "valuation_expectations_gated"
        row["exposure_status"] = "candidate_unverified"
        row["exposure_source_url"] = None
        with self.assertRaisesRegex(ValueError, "primary exposure proof"):
            validate_company_research_queue(tampered)

    def test_direct_watchlist_company_advances_without_sector_radar(self) -> None:
        payload = build_company_research_queue(
            "2026-07-20",
            {"schema_version": "sector_leadership_radar.v1", "funnel": {}},
            self.master,
            self.registry,
            {"estimate_observations": [], "operating_observations": []},
            direct_inputs=[{"ticker": "NVDA", "market": "US", "sources": ["watchlist"]}],
        )
        self.assertEqual(payload["candidate_count"], 1)
        row = payload["candidates"][0]
        self.assertEqual(row["ticker"], "NVDA")
        self.assertEqual(row["candidate_origin"], "direct_user_watchlist")
        self.assertEqual(row["queue_stage"], "valuation_expectations_gated")
        self.assertEqual(payload["advance_count"], 1)

    def test_verified_event_screen_candidate_advances_to_bounded_diligence(self) -> None:
        payload = build_company_research_queue(
            "2026-07-20",
            {"schema_version": "sector_leadership_radar.v1", "funnel": {}},
            self.master,
            self.registry,
            {"estimate_observations": [], "operating_observations": []},
            candidate_screen={
                "schema_version": "us_equity_candidate_screen.v1",
                "deep_analysis_shortlist": [{
                    "ticker": "MSFT",
                    "company_name": "Microsoft",
                    "sector_ids": [],
                    "selection_score": 62,
                    "selection_reasons": ["material_event", "volume_anomaly"],
                    "deep_analysis_eligible": True,
                    "market_reaction": {"return_1d_pct": 4.2},
                    "event_evidence": [{
                        "primary_source_confirmed": True,
                        "source_url": "https://www.sec.gov/example-msft",
                        "verified_facts": [{
                            "source_url": "https://www.sec.gov/example-msft",
                            "value_text": "Item 2.02",
                        }],
                    }],
                }],
            },
        )
        self.assertEqual(payload["advance_count"], 1)
        row = payload["candidates"][0]
        self.assertEqual(row["candidate_origin"], "verified_event_screen")
        self.assertEqual(row["queue_stage"], "valuation_expectations_gated")
        self.assertEqual(row["selection_score"], 62)
        self.assertEqual(row["exposure_status"], "verified_primary_event")

    def test_event_screen_without_source_linked_fact_stays_out(self) -> None:
        payload = build_company_research_queue(
            "2026-07-20",
            {"schema_version": "sector_leadership_radar.v1", "funnel": {}},
            self.master,
            self.registry,
            {"estimate_observations": [], "operating_observations": []},
            candidate_screen={"deep_analysis_shortlist": [{
                "ticker": "MSFT",
                "deep_analysis_eligible": True,
                "event_evidence": [{
                    "primary_source_confirmed": True,
                    "source_url": "https://www.sec.gov/example-msft",
                    "verified_facts": [],
                }],
            }]},
        )
        self.assertEqual(payload["candidate_count"], 0)

    def test_company_evidence_url_is_added_to_deterministic_sources(self) -> None:
        rendered = source_section([], {
            "company_research_queue": {"candidates": [{
                "company_name": "NVIDIA",
                "ticker": "NVDA",
                "source_urls": ["https://example.gov/company-evidence"],
            }]},
            "source_quality": {"evidence_posture": "research_grade"},
        })
        self.assertIn("https://example.gov/company-evidence", rendered)
        self.assertEqual(rendered.count("https://example.gov/company-evidence"), 1)


if __name__ == "__main__":
    unittest.main()
