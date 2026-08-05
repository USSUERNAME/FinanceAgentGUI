from __future__ import annotations

import copy
import unittest

from approve_company_review_operating_config import (
    CONFIRMATION_PHRASE,
    approve_company_review_operating_config,
    operating_config_review_hash,
)
from build_company_review_operating_review_queue import (
    build_company_review_operating_review_queue,
    validate_company_review_operating_review_queue,
)
from test_company_review_operating_approval import reviewed_config
from generate_company_review_operating_drafts import build_company_review_operating_drafts
from test_company_thesis_review_calendar import confirmed_events
from test_company_thesis_update import registry


def item(record: dict) -> dict:
    return {"input_file": f"workspace/company_review_operating_inputs/{record['ticker']}_v{record['version']}.json", "draft_record": record}


class CompanyReviewOperatingReviewQueueTests(unittest.TestCase):
    def test_complete_unapproved_input_becomes_review_ready(self) -> None:
        record = reviewed_config()
        payload = build_company_review_operating_review_queue("2026-10-30", [item(record)], [])
        row = payload["companies"][0]
        self.assertEqual(payload["ready_count"], 1)
        self.assertEqual(row["review_status"], "ready_for_user_or_pm_review")
        self.assertEqual(row["review_hash"], operating_config_review_hash(record))
        self.assertFalse(row["approval_executed"])

    def test_placeholder_or_duplicate_inputs_are_blocked(self) -> None:
        placeholder = reviewed_config()
        placeholder["owners"]["analyst_owner"] = "REPLACE_WITH_NAME_OR_ROLE"
        payload = build_company_review_operating_review_queue("2026-10-30", [item(placeholder)], [])
        self.assertEqual(payload["blocked_count"], 1)
        self.assertIn("analyst_owner", payload["companies"][0]["block_reason"])
        record = reviewed_config()
        payload = build_company_review_operating_review_queue(
            "2026-10-30", [item(record), item(copy.deepcopy(record))], [],
        )
        self.assertEqual(payload["blocked_count"], 2)

    def test_same_approved_hash_is_not_queued_again(self) -> None:
        record = reviewed_config()
        approved, registry, _ = approve_company_review_operating_config(
            record, operating_config_review_hash(record), "portfolio_manager", "Reviewed.",
            CONFIRMATION_PHRASE, approved_at="2026-10-30T00:00:00+00:00",
        )
        payload = build_company_review_operating_review_queue("2026-10-30", [item(record)], registry)
        self.assertEqual(payload["already_approved_count"], 1)
        self.assertEqual(payload["ready_count"], 0)
        self.assertEqual(approved["version"], 1)

    def test_existing_version_with_changed_content_is_blocked(self) -> None:
        original = reviewed_config()
        _, registry, _ = approve_company_review_operating_config(
            original, operating_config_review_hash(original), "portfolio_manager", "Reviewed.",
            CONFIRMATION_PHRASE, approved_at="2026-10-30T00:00:00+00:00",
        )
        changed = reviewed_config()
        changed["review_policy"]["cadence"] = "weekly"
        payload = build_company_review_operating_review_queue("2026-10-30", [item(changed)], registry)
        self.assertEqual(payload["blocked_count"], 1)
        self.assertIn("already approved", payload["companies"][0]["block_reason"])

    def test_generated_placeholder_draft_is_completion_work_not_error(self) -> None:
        generated = build_company_review_operating_drafts(
            "2026-10-30", registry(), confirmed_events(), [],
        )["drafts"][0]["draft_record"]
        payload = build_company_review_operating_review_queue(
            "2026-10-30", [item(generated)], [],
        )
        row = payload["companies"][0]
        self.assertEqual(payload["completion_required_count"], 1)
        self.assertEqual(row["review_status"], "generated_requires_user_or_pm_completion")
        self.assertIn("analyst_owner", row["missing_completion_fields"])
        self.assertIsNone(row["review_hash"])

    def test_validator_rejects_false_approval_or_tampered_hash(self) -> None:
        payload = build_company_review_operating_review_queue("2026-10-30", [item(reviewed_config())], [])
        tampered = copy.deepcopy(payload)
        tampered["companies"][0]["approval_executed"] = True
        with self.assertRaisesRegex(ValueError, "execute approval"):
            validate_company_review_operating_review_queue(tampered)
        tampered = copy.deepcopy(payload)
        tampered["companies"][0]["review_hash"] = "0" * 64
        with self.assertRaisesRegex(ValueError, "hash"):
            validate_company_review_operating_review_queue(tampered)


if __name__ == "__main__":
    unittest.main()
