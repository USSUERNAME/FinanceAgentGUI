from __future__ import annotations

import copy
import unittest

from track_sector_theses import update_sector_thesis_history
from compose_daily_brief import source_section


def sector(score: float | None, industry: float | None = 70.0, market: float | None = 60.0) -> dict:
    available_weight = sum(
        weight for value, weight in ((industry, 25), (70.0, 25), (market, 15)) if value is not None
    )
    return {
        "sector_id": "semiconductors_ai_compute",
        "name_ko": "반도체·AI 컴퓨트",
        "research_state": "scored_research_candidate" if score is not None else "operating_signal_only",
        "leadership_score": score,
        "ranking_bucket": "B" if score is not None else "unscored",
        "score_status": "scored_research_priority" if score is not None else "insufficient_evidence",
        "available_dimension_weight_pct": available_weight,
        "missing_required_dimensions": [] if score is not None else ["market_confirmation"],
        "blockers": [] if score is not None else ["missing_required_dimensions"],
        "dimension_scores": {
            "industry_leading_data": {"score": industry, "status": "available", "confidence": "medium", "weight": 25},
            "earnings_revisions": {"score": 70.0, "status": "available", "confidence": "medium", "weight": 25},
            "orders_capex_backlog": {"score": None, "status": "missing", "confidence": "none", "weight": 15},
            "market_confirmation": {"score": market, "status": "available" if market is not None else "missing", "confidence": "low", "weight": 15},
            "structural_driver": {"score": None, "status": "missing", "confidence": "none", "weight": 10},
            "catalyst_durability": {"score": None, "status": "missing", "confidence": "none", "weight": 10},
        },
        "evidence_readiness": {"independent_source_ids": ["FRED", "Alpha Vantage"]},
    }


def snapshot(row: dict) -> dict:
    return {"schema_version": "sector_market_snapshot.v1", "sectors": [row]}


class SectorThesisHistoryTests(unittest.TestCase):
    def test_first_run_creates_append_only_baseline(self) -> None:
        history, review = update_sector_thesis_history({}, "2026-07-20", snapshot(sector(70.0)))
        self.assertEqual(len(history["daily_records"]), 1)
        self.assertEqual(review["current_sector_states"][0]["transition"], "baseline_created")
        self.assertEqual(review["material_changes"], [])

    def test_market_only_score_increase_does_not_strengthen_company_thesis(self) -> None:
        history, _ = update_sector_thesis_history({}, "2026-07-20", snapshot(sector(70.0, market=55.0)))
        history, review = update_sector_thesis_history(history, "2026-07-21", snapshot(sector(76.0, market=85.0)))
        event = review["material_changes"][0]
        self.assertEqual(event["transition"], "market_confirmation_only")
        self.assertEqual(event["company_thesis_status"], "intact")
        self.assertEqual(event["improved_non_market_dimensions"], [])

    def test_non_market_improvement_strengthens_thesis(self) -> None:
        history, _ = update_sector_thesis_history({}, "2026-07-20", snapshot(sector(70.0, industry=60.0)))
        history, review = update_sector_thesis_history(history, "2026-07-21", snapshot(sector(76.0, industry=68.0)))
        event = review["material_changes"][0]
        self.assertEqual(event["transition"], "thesis_strengthening")
        self.assertIn("industry_leading_data", event["improved_non_market_dimensions"])

    def test_new_low_scoring_evidence_is_not_called_strengthening(self) -> None:
        history, _ = update_sector_thesis_history(
            {}, "2026-07-20", snapshot(sector(None, industry=None, market=None)),
        )
        history, review = update_sector_thesis_history(
            history, "2026-07-21", snapshot(sector(None, industry=35.0, market=None)),
        )
        event = review["material_changes"][0]
        self.assertEqual(event["transition"], "thesis_weakening")
        self.assertIn("industry_leading_data", event["deteriorated_non_market_dimensions"])

    def test_lost_composite_gate_is_explicit_watch_state(self) -> None:
        history, _ = update_sector_thesis_history({}, "2026-07-20", snapshot(sector(70.0)))
        history, review = update_sector_thesis_history(history, "2026-07-21", snapshot(sector(None, market=None)))
        event = review["material_changes"][0]
        self.assertEqual(event["transition"], "score_lost")
        self.assertEqual(event["company_thesis_status"], "watch")

    def test_same_input_rerun_is_idempotent_and_changed_input_appends_revision(self) -> None:
        initial = snapshot(sector(70.0))
        history, _ = update_sector_thesis_history({}, "2026-07-20", initial)
        history, rerun = update_sector_thesis_history(history, "2026-07-20", copy.deepcopy(initial))
        self.assertTrue(rerun["is_idempotent_rerun"])
        self.assertEqual(len(history["daily_records"]), 1)

        changed = snapshot(sector(71.0))
        history, revision = update_sector_thesis_history(history, "2026-07-20", changed)
        self.assertFalse(revision["is_idempotent_rerun"])
        self.assertEqual(revision["revision"], 2)
        self.assertEqual(len(history["daily_records"]), 2)
        self.assertEqual(history["runs"][-1]["supersedes_revision"], 1)

    def test_sector_driver_primary_url_is_kept_in_deterministic_sources(self) -> None:
        rendered = source_section([], {
            "sector_drivers": {"observations": [{
                "source_url": "https://example.gov/official-policy",
                "source_owner": "Official Agency",
                "evidence_type": "enacted_law",
                "evidence_summary": "A bounded official policy fact.",
            }]},
            "source_quality": {"evidence_posture": "research_grade"},
        })
        self.assertIn("https://example.gov/official-policy", rendered)
        self.assertEqual(rendered.count("https://example.gov/official-policy"), 1)


if __name__ == "__main__":
    unittest.main()
