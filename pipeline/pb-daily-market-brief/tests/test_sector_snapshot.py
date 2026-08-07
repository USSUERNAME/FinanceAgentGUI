from __future__ import annotations

import copy
import unittest

from build_sector_snapshot import (
    compact_sector_snapshot,
    composite_score,
    create_sector_snapshot,
    fundamental_dimension_score,
    driver_dimension_score,
    industry_leading_data_score,
    market_confirmation_score,
    validate_sector_snapshot,
)
from sector_classifier import annotate_market_payload, classify_records
from sector_master import load_sector_master


class SectorSnapshotTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.master = load_sector_master()

    def market_payload(self) -> dict:
        return annotate_market_payload({"items": [
            {
                "ticker": "SPY", "as_of": "2026-07-20",
                "return_5d_pct": 2.0, "return_20d_pct": 5.0,
            },
            {
                "ticker": "SMH", "as_of": "2026-07-20",
                "return_5d_pct": 6.0, "return_20d_pct": 10.0,
            },
        ]}, self.master)

    def test_market_confirmation_is_price_only_and_benchmark_relative(self) -> None:
        result = market_confirmation_score("semiconductors_ai_compute", self.market_payload())
        self.assertEqual(result["status"], "available")
        self.assertEqual(result["proxy_count"], 1)
        self.assertEqual(result["confidence"], "low")
        self.assertGreater(result["median_vs_spy_5d_pct"], 0)
        self.assertGreater(result["score"], 50)
        self.assertIn("does not establish industry", result["note"])

    def test_missing_proxy_stays_unscored(self) -> None:
        result = market_confirmation_score("shipbuilding_marine", self.market_payload())
        self.assertIsNone(result["score"])
        self.assertEqual(result["status"], "missing_market_proxy_or_benchmark")

    def test_official_operating_proxy_populates_only_industry_dimension(self) -> None:
        metrics = {"metrics": [{
            "metric_id": "us_semiconductor_industrial_production",
            "sector_id": "semiconductors_ai_compute",
            "dimension_id": "industry_leading_data",
            "status": "available",
            "score": 82.0,
            "source_grade": "A",
            "primary_source_confirmed": True,
            "series_id": "IPG3344S",
            "source_url": "https://fred.stlouisfed.org/series/IPG3344S",
        }]}
        result = industry_leading_data_score("semiconductors_ai_compute", metrics)
        self.assertEqual(result["score"], 82.0)
        self.assertEqual(result["confidence"], "low")
        self.assertIn("does not establish earnings", result["note"])

        daily = {
            "schema_version": "daily_market_snapshot.v1",
            "records": [],
            "etf_metrics": self.market_payload(),
            "sector_metrics": metrics,
        }
        snapshot = create_sector_snapshot("2026-07-20", daily, self.master)
        semis = next(item for item in snapshot["sectors"] if item["sector_id"] == "semiconductors_ai_compute")
        self.assertEqual(semis["research_state"], "operating_and_market_signals_unscored")
        self.assertEqual(semis["available_dimension_weight_pct"], 40)
        self.assertIsNone(semis["dimension_scores"]["earnings_revisions"]["score"])
        self.assertIsNone(semis["leadership_score"])

    def test_verified_fundamental_dimension_row_is_accepted(self) -> None:
        payload = {"dimension_scores": [{
            "sector_id": "semiconductors_ai_compute",
            "dimension_id": "earnings_revisions",
            "status": "available", "score": 70.0, "confidence": "medium",
            "company_count": 2, "minimum_company_count": 2,
            "independent_source_count": 1,
            "observation_ids": ["US:NVDA", "US:TSM"],
            "source_urls": ["https://www.alphavantage.co/documentation/#earnings-estimates"],
        }]}
        result = fundamental_dimension_score("semiconductors_ai_compute", "earnings_revisions", payload)
        self.assertEqual(result["score"], 70.0)
        self.assertEqual(result["company_count"], 2)

        missing = fundamental_dimension_score("shipbuilding_marine", "earnings_revisions", payload)
        self.assertIsNone(missing["score"])
        self.assertEqual(missing["status"], "awaiting_structured_estimate_revisions")

    def test_primary_driver_dimension_row_is_accepted_without_reusing_news(self) -> None:
        payload = {
            "dimension_scores": [{
                "sector_id": "grid_electrification",
                "dimension_id": "structural_driver",
                "status": "available",
                "score": 81.5,
                "confidence": "medium",
                "independent_source_count": 2,
                "minimum_independent_sources": 2,
                "evidence_ids": ["official-a", "official-b"],
                "source_urls": ["https://example.gov/a", "https://example.gov/b"],
            }]
        }
        result = driver_dimension_score("grid_electrification", "structural_driver", payload)
        self.assertEqual(result["score"], 81.5)
        self.assertEqual(result["observations"], ["official-a", "official-b"])

        missing = driver_dimension_score("nuclear_generation", "structural_driver", payload)
        self.assertIsNone(missing["score"])
        self.assertEqual(missing["status"], "awaiting_primary_policy_or_demand_evidence")

    def test_full_structured_path_can_unlock_research_priority_score(self) -> None:
        daily = {
            "schema_version": "daily_market_snapshot.v1",
            "records": [],
            "etf_metrics": self.market_payload(),
            "sector_metrics": {"metrics": [{
                "metric_id": "us_semiconductor_industrial_production",
                "sector_id": "semiconductors_ai_compute",
                "dimension_id": "industry_leading_data",
                "status": "available", "score": 80.0,
                "source_grade": "A", "primary_source_confirmed": True,
                "provider": "FRED", "upstream_source": "Federal Reserve Board",
            }]},
            "sector_fundamentals": {
                "dimension_scores": [{
                    "sector_id": "semiconductors_ai_compute",
                    "dimension_id": "earnings_revisions",
                    "status": "available", "score": 70.0, "confidence": "medium",
                    "company_count": 2, "minimum_company_count": 2,
                    "independent_source_count": 1,
                    "observation_ids": ["US:NVDA", "US:TSM"],
                    "source_urls": ["https://www.alphavantage.co/documentation/#earnings-estimates"],
                }],
                "estimate_observations": [
                    {
                        "sector_id": "semiconductors_ai_compute", "market": "US", "ticker": ticker,
                        "eligible_for_sector_score": True, "source_provider": "Alpha Vantage",
                        "source_url": "https://www.alphavantage.co/documentation/#earnings-estimates",
                        "primary_source_confirmed": False,
                    }
                    for ticker in ("NVDA", "TSM")
                ],
                "operating_observations": [],
            },
        }
        snapshot = create_sector_snapshot("2026-07-20", daily, self.master)
        semis = next(item for item in snapshot["sectors"] if item["sector_id"] == "semiconductors_ai_compute")
        self.assertEqual(semis["score_status"], "scored_research_priority")
        self.assertEqual(semis["available_dimension_weight_pct"], 65)
        self.assertIsNotNone(semis["leadership_score"])
        self.assertEqual(semis["evidence_readiness"]["independent_source_count"], 2)

    def test_composite_requires_core_dimensions_sources_and_primary_evidence(self) -> None:
        dimensions = {
            "industry_leading_data": {"weight": 25, "score": 80},
            "earnings_revisions": {"weight": 25, "score": 70},
            "market_confirmation": {"weight": 15, "score": 90},
            "orders_capex_backlog": {"weight": 15, "score": None},
            "structural_driver": {"weight": 10, "score": None},
            "catalyst_durability": {"weight": 10, "score": None},
        }
        evidence = {"independent_source_count": 2, "primary_confirmed_record_count": 1}
        result = composite_score(dimensions, evidence)
        self.assertEqual(result["score_status"], "scored_research_priority")
        self.assertEqual(result["ranking_bucket"], "A")
        self.assertAlmostEqual(result["leadership_score"], 78.46, places=2)

        evidence["primary_confirmed_record_count"] = 0
        blocked = composite_score(dimensions, evidence)
        self.assertIsNone(blocked["leadership_score"])
        self.assertIn("no_primary_confirmed_record", blocked["blockers"])

    def test_current_inputs_create_market_signal_not_false_leadership_score(self) -> None:
        records = classify_records([{
            "id": "official-nvda", "source_id": "sec_inbox", "source_grade": "A",
            "primary_source_confirmed": True, "tickers": ["NVDA"],
            "title": "NVIDIA filing", "tags": [], "raw_text": "",
        }], self.master)
        daily = {
            "schema_version": "daily_market_snapshot.v1",
            "records": records,
            "etf_metrics": self.market_payload(),
        }
        snapshot = create_sector_snapshot("2026-07-20", daily, self.master)
        self.assertEqual(len(snapshot["sectors"]), 21)
        self.assertEqual(snapshot["summary"]["scored_sector_count"], 0)
        self.assertEqual(snapshot["summary"]["market_signal_only_count"], 1)
        semis = next(item for item in snapshot["sectors"] if item["sector_id"] == "semiconductors_ai_compute")
        self.assertEqual(semis["research_state"], "market_signal_only")
        self.assertIsNone(semis["leadership_score"])
        self.assertEqual(semis["available_dimension_weight_pct"], 15)
        self.assertIn("dimension_coverage_below_60", semis["blockers"])

        compact = compact_sector_snapshot(snapshot)
        observation = compact["market_confirmation_observations"][0]
        self.assertEqual(observation["sector_id"], "semiconductors_ai_compute")
        self.assertIsNone(observation["leadership_score"])

    def test_validator_rejects_score_that_bypasses_gate(self) -> None:
        daily = {
            "schema_version": "daily_market_snapshot.v1",
            "records": [],
            "etf_metrics": self.market_payload(),
        }
        snapshot = create_sector_snapshot("2026-07-20", daily, self.master)
        tampered = copy.deepcopy(snapshot)
        tampered["sectors"][0]["leadership_score"] = 99
        with self.assertRaisesRegex(ValueError, "Invalid leadership score gate"):
            validate_sector_snapshot(tampered, self.master)


if __name__ == "__main__":
    unittest.main()
