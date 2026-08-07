from __future__ import annotations

import unittest

from build_sector_leadership_radar import build_sector_leadership_radar
from track_sector_theses import update_sector_thesis_history


def sector(
    score: float | None,
    industry: float | None = 70.0,
    market: float | None = 60.0,
    structural: float | None = 75.0,
) -> dict:
    dimensions = {
        "industry_leading_data": {"score": industry, "status": "available", "confidence": "medium", "weight": 25},
        "earnings_revisions": {"score": 70.0, "status": "available", "confidence": "medium", "weight": 25},
        "orders_capex_backlog": {"score": None, "status": "missing", "confidence": "none", "weight": 15},
        "market_confirmation": {"score": market, "status": "available" if market is not None else "missing", "confidence": "low", "weight": 15},
        "structural_driver": {"score": structural, "status": "available" if structural is not None else "missing", "confidence": "medium", "weight": 10},
        "catalyst_durability": {"score": None, "status": "missing", "confidence": "none", "weight": 10},
    }
    available_weight = sum(
        row["weight"] for row in dimensions.values() if isinstance(row["score"], (int, float))
    )
    return {
        "sector_id": "grid_electrification",
        "name_ko": "전력망·전기화",
        "research_state": "scored_research_candidate" if score is not None else "operating_signal_only",
        "leadership_score": score,
        "ranking_bucket": "B" if score is not None else "unscored",
        "score_status": "scored_research_priority" if score is not None else "insufficient_evidence",
        "available_dimension_weight_pct": available_weight,
        "missing_required_dimensions": [] if score is not None else ["market_confirmation"],
        "blockers": [] if score is not None else ["missing_required_dimensions"],
        "dimension_scores": dimensions,
        "evidence_readiness": {"independent_source_ids": ["FRED", "Alpha Vantage", "DOE"]},
    }


def add(history: dict, report_date: str, row: dict) -> dict:
    history, _ = update_sector_thesis_history(
        history, report_date, {"schema_version": "sector_market_snapshot.v1", "sectors": [row]},
    )
    return history


class SectorLeadershipRadarTests(unittest.TestCase):
    def test_two_reports_remain_insufficient_history(self) -> None:
        history = add({}, "2026-07-20", sector(72.0))
        history = add(history, "2026-07-21", sector(74.0))
        radar = build_sector_leadership_radar("2026-07-21", history)
        self.assertEqual(radar["sectors"][0]["stage"], "insufficient_history")
        self.assertEqual(radar["candidate_count"], 0)

    def test_price_only_rise_cannot_create_emerging_candidate(self) -> None:
        history = add({}, "2026-07-20", sector(60.0, market=45.0))
        history = add(history, "2026-07-21", sector(66.0, market=75.0))
        history = add(history, "2026-07-22", sector(71.0, market=90.0))
        radar = build_sector_leadership_radar("2026-07-22", history)
        row = radar["sectors"][0]
        self.assertEqual(row["stage"], "watchlist_needs_trigger")
        self.assertEqual(radar["candidate_count"], 0)
        self.assertFalse(radar["methodology"]["price_only_transition_can_create_emerging_candidate"])

    def test_non_market_strengthening_can_create_emerging_candidate(self) -> None:
        history = add({}, "2026-07-20", sector(None, industry=42.0, market=None))
        history = add(history, "2026-07-21", sector(None, industry=45.0, market=None))
        history = add(history, "2026-07-22", sector(72.0, industry=62.0, market=65.0))
        radar = build_sector_leadership_radar("2026-07-22", history)
        row = radar["sectors"][0]
        self.assertEqual(row["stage"], "emerging_research_candidate")
        self.assertEqual(radar["candidate_count"], 1)
        self.assertEqual(row["actionability"], "advance_to_deeper_work")
        self.assertEqual(row["priced_in_status"], "data_gap")
        self.assertEqual(row["next_workflow"], "company_exposure_and_expectations_diligence")

    def test_five_report_persistence_can_advance_candidate(self) -> None:
        history: dict = {}
        for index, report_date in enumerate((
            "2026-07-20", "2026-07-21", "2026-07-22", "2026-07-23", "2026-07-24",
        )):
            history = add(history, report_date, sector(72.0 + index))
        radar = build_sector_leadership_radar("2026-07-24", history)
        row = radar["sectors"][0]
        self.assertEqual(row["stage"], "persistent_research_candidate")
        self.assertEqual(row["scored_report_share"], 1.0)
        self.assertEqual(row["observed_report_count"], 5)

    def test_latest_score_loss_routes_to_reunderwrite(self) -> None:
        history: dict = {}
        for report_date in ("2026-07-20", "2026-07-21", "2026-07-22"):
            history = add(history, report_date, sector(74.0))
        history = add(history, "2026-07-23", sector(None, market=None))
        radar = build_sector_leadership_radar("2026-07-23", history)
        row = radar["sectors"][0]
        self.assertEqual(row["stage"], "fading_reunderwrite")
        self.assertEqual(radar["reunderwrite_count"], 1)


if __name__ == "__main__":
    unittest.main()
