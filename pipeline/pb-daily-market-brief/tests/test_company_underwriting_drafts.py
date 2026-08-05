from __future__ import annotations

import copy
import unittest

from build_company_earnings_scenarios import build_company_earnings_scenarios
from build_company_underwriting_drafts import (
    build_company_underwriting_drafts,
    underwriting_draft_hash,
    validate_company_underwriting_drafts,
)
from collect_company_underwriting import collect_company_underwriting
from test_company_earnings_driver_review import bundle
from test_company_earnings_scenarios import ready_review
from test_company_thesis_update import registry as approved_registry


def empty_registry() -> dict:
    return collect_company_underwriting(
        "2026-10-30", {"reviews": [{"ticker": "GEV", "company_name": "GE Vernova"}]}, [],
    )


def inputs() -> tuple[dict, dict, dict, dict]:
    tearsheets, _, _ = bundle()
    review = ready_review()
    scenarios = build_company_earnings_scenarios("2026-10-30", review)
    return tearsheets, review, scenarios, empty_registry()


class CompanyUnderwritingDraftTests(unittest.TestCase):
    def test_ready_evidence_generates_unapproved_source_bounded_draft(self) -> None:
        payload = build_company_underwriting_drafts("2026-10-30", *inputs())
        row = payload["companies"][0]
        draft = row["draft_record"]
        self.assertEqual(row["draft_status"], "ready_for_user_or_pm_review")
        self.assertEqual(draft["approval"]["status"], "draft_pending_user_approval")
        self.assertEqual(draft["variant_perception"], "not_established_requires_user_or_pm_view")
        self.assertGreaterEqual(len(draft["pillars"]), 2)
        self.assertTrue(all(
            criterion["threshold_origin"] == "Draft threshold for PM confirmation"
            and criterion["threshold_approval_status"] == "draft_pending_user_approval"
            for criterion in draft["kill_criteria"]
        ))
        self.assertFalse(draft["draft_metadata"]["position_action_generated"])
        self.assertFalse(any(str(gap).startswith("{") for gap in draft["open_diligence"]))

    def test_draft_preserves_threshold_period_units_and_source_lineage(self) -> None:
        draft = build_company_underwriting_drafts("2026-10-30", *inputs())["companies"][0]["draft_record"]
        headline = draft["pillars"][0]
        self.assertEqual(headline["baseline"]["period_end"], "2026-09-30")
        self.assertEqual(headline["baseline"]["units"], "USD")
        source_ids = {row["source_id"] for row in draft["source_index"]}
        self.assertTrue(set(headline["source_ids"]).issubset(source_ids))
        self.assertTrue(set(draft["kill_criteria"][0]["source_ids"]).issubset(source_ids))

    def test_existing_approved_underwriting_is_not_overwritten_by_draft(self) -> None:
        tearsheets, review, scenarios, _ = inputs()
        payload = build_company_underwriting_drafts(
            "2026-10-30", tearsheets, review, scenarios, approved_registry(),
        )
        row = payload["companies"][0]
        self.assertEqual(row["draft_status"], "skipped_existing_approved_underwriting")
        self.assertIsNone(row["draft_record"])

    def test_insufficient_evidence_yields_visible_blocked_state(self) -> None:
        tearsheets, _, _, registry = inputs()
        payload = build_company_underwriting_drafts(
            "2026-10-30", tearsheets, {"reviews": []}, {"companies": []}, registry,
        )
        row = payload["companies"][0]
        self.assertEqual(row["draft_status"], "blocked_insufficient_falsifiable_evidence")
        self.assertIsNone(row["draft_record"])

    def test_validator_rejects_auto_approval_or_invented_variant_perception(self) -> None:
        payload = build_company_underwriting_drafts("2026-10-30", *inputs())
        tampered = copy.deepcopy(payload)
        tampered["companies"][0]["draft_record"]["approval"]["status"] = "approved_by_user_or_pm"
        tampered["companies"][0]["draft_hash"] = underwriting_draft_hash(
            tampered["companies"][0]["draft_record"]
        )
        with self.assertRaisesRegex(ValueError, "unapproved draft"):
            validate_company_underwriting_drafts(tampered)
        tampered = copy.deepcopy(payload)
        tampered["companies"][0]["draft_record"]["variant_perception"] = "Market underestimates growth"
        tampered["companies"][0]["draft_hash"] = underwriting_draft_hash(
            tampered["companies"][0]["draft_record"]
        )
        with self.assertRaisesRegex(ValueError, "invent a variant"):
            validate_company_underwriting_drafts(tampered)


if __name__ == "__main__":
    unittest.main()
