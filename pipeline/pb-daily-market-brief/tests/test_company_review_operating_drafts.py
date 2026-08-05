from __future__ import annotations

import copy
import json
import tempfile
import unittest
from pathlib import Path

from generate_company_review_operating_drafts import (
    build_company_review_operating_drafts,
    materialize_operating_drafts,
    validate_company_review_operating_drafts,
)
from test_company_review_operating_config import approved_config
from test_company_thesis_review_calendar import confirmed_events
from test_company_thesis_update import registry


class CompanyReviewOperatingDraftTests(unittest.TestCase):
    def test_approved_underwriting_generates_unapproved_editable_v1(self) -> None:
        payload = build_company_review_operating_drafts(
            "2026-10-31", registry(), confirmed_events(), [],
        )
        row = payload["drafts"][0]
        record = row["draft_record"]
        self.assertEqual(row["draft_status"], "generated_requires_user_or_pm_completion")
        self.assertEqual(record["version"], 1)
        self.assertEqual(record["review_policy"]["next_scheduled_review_date"], "2026-11-05")
        self.assertEqual(record["owners"]["analyst_owner"], "REPLACE_WITH_NAME_OR_ROLE")
        self.assertFalse(record["draft_metadata"]["suggested_defaults_are_approved"])
        self.assertFalse(row["approval_executed"])

    def test_no_approved_underwriting_generates_no_draft(self) -> None:
        underwriting = copy.deepcopy(registry())
        underwriting["companies"] = []
        payload = build_company_review_operating_drafts(
            "2026-10-31", underwriting, confirmed_events(), [],
        )
        self.assertEqual(payload["draft_count"], 0)

    def test_configured_company_is_skipped_unless_explicitly_requested(self) -> None:
        existing = [approved_config()]
        payload = build_company_review_operating_drafts(
            "2026-10-31", registry(), confirmed_events(), existing,
        )
        self.assertEqual(payload["draft_count"], 0)
        payload = build_company_review_operating_drafts(
            "2026-10-31", registry(), confirmed_events(), existing, include_configured=True,
        )
        self.assertEqual(payload["drafts"][0]["version"], 2)

    def test_existing_input_is_detected_without_new_materialization(self) -> None:
        payload = build_company_review_operating_drafts(
            "2026-10-31", registry(), confirmed_events(), [], {("GEV", 1)},
        )
        self.assertEqual(payload["drafts"][0]["draft_status"], "existing_input_detected")

    def test_materialization_never_overwrites_existing_input(self) -> None:
        payload = build_company_review_operating_drafts(
            "2026-10-31", registry(), confirmed_events(), [],
        )
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            written = materialize_operating_drafts(payload, root)
            self.assertEqual(len(written), 1)
            original = written[0].read_text(encoding="utf-8")
            written_again = materialize_operating_drafts(payload, root)
            self.assertEqual(written_again, [])
            self.assertEqual(written[0].read_text(encoding="utf-8"), original)
            self.assertEqual(json.loads(original)["ticker"], "GEV")

    def test_validator_blocks_false_approval_or_position_authority(self) -> None:
        payload = build_company_review_operating_drafts(
            "2026-10-31", registry(), confirmed_events(), [],
        )
        tampered = copy.deepcopy(payload)
        tampered["drafts"][0]["draft_record"]["approval"]["status"] = "approved_by_user_or_pm"
        with self.assertRaisesRegex(ValueError, "unapproved draft"):
            validate_company_review_operating_drafts(tampered)
        tampered = copy.deepcopy(payload)
        tampered["drafts"][0]["draft_record"]["automatic_position_action_allowed"] = True
        with self.assertRaisesRegex(ValueError, "automatic position"):
            validate_company_review_operating_drafts(tampered)


if __name__ == "__main__":
    unittest.main()
