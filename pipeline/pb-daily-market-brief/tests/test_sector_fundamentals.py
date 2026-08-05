from __future__ import annotations

import copy
import unittest
from datetime import date

from collect_sector_fundamentals import (
    aggregate_dimension_scores,
    collect_estimate_observations,
    estimate_revision_score,
    estimate_universe,
    load_fundamental_registry,
    load_registry_operating_inputs,
    select_estimate_rows,
    validate_operating_input,
)
from sector_master import load_sector_master


def estimate_payload() -> dict:
    return {"estimates": [
        {
            "date": "2026-10-31", "horizon": "fiscal quarter",
            "eps_estimate_average": "2.10", "eps_estimate_average_30_days_ago": "2.00",
            "eps_estimate_analyst_count": "20", "eps_estimate_revision_up_trailing_30_days": "8",
            "eps_estimate_revision_down_trailing_30_days": "2", "revenue_estimate_average": "1000",
            "revenue_estimate_analyst_count": "18",
        },
        {
            "date": "2027-01-31", "horizon": "fiscal year",
            "eps_estimate_average": "8.20", "eps_estimate_average_30_days_ago": "8.00",
            "eps_estimate_analyst_count": "25", "eps_estimate_revision_up_trailing_30_days": "10",
            "eps_estimate_revision_down_trailing_30_days": "2", "revenue_estimate_average": "4200",
            "revenue_estimate_analyst_count": "22",
        },
    ]}


class SectorFundamentalTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.registry = load_fundamental_registry()
        cls.master = load_sector_master()

    def test_universe_is_bounded_to_focus_us_candidates(self) -> None:
        universe = estimate_universe(self.registry, self.master)
        self.assertEqual(len(universe), 8)
        self.assertTrue(all(item["market"] == "US" for item in universe))
        self.assertNotIn("shipbuilding_marine", {item["sector_id"] for item in universe})

    def test_revision_score_uses_30_day_change_and_breadth(self) -> None:
        result = estimate_revision_score(estimate_payload()["estimates"][0])
        self.assertGreater(result["score"], 50)
        self.assertAlmostEqual(result["revision_pct"], 5.0, places=3)
        self.assertAlmostEqual(result["revision_breadth"], 0.6, places=3)
        rows = select_estimate_rows(estimate_payload(), date(2026, 7, 20))
        self.assertEqual({item["horizon"] for item in rows}, {"fiscal quarter", "fiscal year"})

    def test_candidate_estimates_are_collected_but_not_sector_scored(self) -> None:
        registry = copy.deepcopy(self.registry)
        registry["verified_exposures"] = []
        observations, errors = collect_estimate_observations(
            "2026-07-20", "test", registry,
            fetcher=lambda ticker, key: estimate_payload(),
            max_companies=2,
        )
        self.assertFalse(errors)
        self.assertEqual(len(observations), 2)
        self.assertTrue(all(item["score_candidate"] is not None for item in observations))
        self.assertTrue(all(item["score"] is None for item in observations))
        self.assertTrue(all(item["exposure_status"] == "candidate_unverified" for item in observations))
        dimensions = aggregate_dimension_scores(registry, observations, [])
        semis = next(item for item in dimensions if item["sector_id"] == "semiconductors_ai_compute" and item["dimension_id"] == "earnings_revisions")
        self.assertIsNone(semis["score"])
        self.assertEqual(semis["candidate_company_count"], 2)

    def test_two_primary_verified_exposures_unlock_estimate_dimension(self) -> None:
        registry = copy.deepcopy(self.registry)
        registry["verified_exposures"] = [
            {
                "sector_id": "semiconductors_ai_compute", "market": "US", "ticker": ticker,
                "source_url": f"https://ir.example.com/{ticker}", "body_location": "Business overview p. 1",
                "primary_source_confirmed": True,
            }
            for ticker in ("NVDA", "TSM")
        ]
        observations, errors = collect_estimate_observations(
            "2026-07-20", "test", registry,
            fetcher=lambda ticker, key: estimate_payload(),
            max_companies=2,
        )
        self.assertFalse(errors)
        dimensions = aggregate_dimension_scores(registry, observations, [])
        semis = next(item for item in dimensions if item["sector_id"] == "semiconductors_ai_compute" and item["dimension_id"] == "earnings_revisions")
        self.assertIsNotNone(semis["score"])
        self.assertEqual(semis["company_count"], 2)
        self.assertEqual(semis["independent_source_count"], 1)

    def operating_record(self, ticker: str, source_url: str) -> dict:
        return {
            "record_id": f"orders-{ticker}", "sector_id": "semiconductors_ai_compute",
            "market": "US", "ticker": ticker, "company_name": ticker,
            "metric_type": "new_orders", "current_value": 120, "prior_value": 100,
            "unit": "USD millions", "currency": "USD", "current_period": "2026Q2",
            "prior_period": "2025Q2", "source_type": "company_filing",
            "source_url": source_url, "source_date": "2026-07-10",
            "body_location": "Orders table, p. 12", "primary_source_confirmed": True,
            "body_verified": True, "exposure_verified": True,
            "exposure_source_url": source_url, "exposure_body_location": "Business section, p. 3",
        }

    def test_orders_input_requires_body_and_primary_source(self) -> None:
        invalid = self.operating_record("NVDA", "https://ir.example.com/nvda")
        invalid["body_verified"] = False
        with self.assertRaisesRegex(ValueError, "primary body"):
            validate_operating_input(invalid, self.registry, date(2026, 7, 20))

        rows = [
            validate_operating_input(self.operating_record("NVDA", "https://ir.example.com/nvda"), self.registry, date(2026, 7, 20)),
            validate_operating_input(self.operating_record("TSM", "https://ir.example.com/tsm"), self.registry, date(2026, 7, 20)),
        ]
        dimensions = aggregate_dimension_scores(self.registry, [], rows)
        semis = next(item for item in dimensions if item["sector_id"] == "semiconductors_ai_compute" and item["dimension_id"] == "orders_capex_backlog")
        self.assertEqual(semis["status"], "available")
        self.assertEqual(semis["score"], 80.0)

    def test_registry_primary_backlog_rows_unlock_grid_and_defense(self) -> None:
        rows, errors = load_registry_operating_inputs("2026-07-20", self.registry)
        self.assertFalse(errors)
        self.assertEqual(len(rows), 4)
        dimensions = aggregate_dimension_scores(self.registry, [], rows)
        grid = next(item for item in dimensions if item["sector_id"] == "grid_electrification" and item["dimension_id"] == "orders_capex_backlog")
        defense = next(item for item in dimensions if item["sector_id"] == "aerospace_defense" and item["dimension_id"] == "orders_capex_backlog")
        self.assertEqual(grid["status"], "available")
        self.assertEqual(grid["company_count"], 2)
        self.assertIsNotNone(defense["score"])

        expired, expired_errors = load_registry_operating_inputs("2027-04-01", self.registry)
        self.assertFalse(expired_errors)
        self.assertEqual(expired, [])


if __name__ == "__main__":
    unittest.main()
