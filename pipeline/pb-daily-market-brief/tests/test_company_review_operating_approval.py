from __future__ import annotations

import copy
import unittest

from approve_company_review_operating_config import (
    CONFIRMATION_PHRASE,
    approve_company_review_operating_config,
    operating_config_review_hash,
)
from test_company_review_operating_config import approved_config


def reviewed_config(version: int = 1) -> dict:
    record = approved_config(version)
    record["approval"] = {
        "status": "draft_pending_user_or_pm_approval",
        "approved_by": None, "approved_at": None,
        "approval_note": "Review required.",
    }
    return record


def approve(record: dict | None = None, registry: list[dict] | None = None):
    record = record or reviewed_config()
    return approve_company_review_operating_config(
        record, operating_config_review_hash(record), "portfolio_manager",
        "Reviewed owners, cadence, preparation timing, SLA, and escalation triggers.",
        CONFIRMATION_PHRASE, registry or [], approved_at="2026-10-30T15:00:00+00:00",
    )


class CompanyReviewOperatingApprovalTests(unittest.TestCase):
    def test_explicit_approval_appends_record_and_receipt(self) -> None:
        record, registry, receipt = approve()
        self.assertEqual(record["approval"]["status"], "approved_by_user_or_pm")
        self.assertEqual(len(registry), 1)
        self.assertTrue(receipt["company_thesis_review_operations_approved"])
        self.assertFalse(receipt["security_or_position_action_approved"])
        self.assertEqual(receipt["reviewed_record_hash"], record["approval"]["reviewed_record_hash"])

    def test_approval_replaces_draft_source_with_canonical_lineage(self) -> None:
        record, _, _ = approve()
        source = next(row for row in record["source_index"] if row["source_id"] == "OPS-GEV-V1")
        self.assertEqual(source["source_type"], "user_provided_internal_operating_policy")
        self.assertEqual(source["reliability"], "explicit_user_or_pm_approval")

    def test_wrong_hash_or_confirmation_is_rejected(self) -> None:
        record = reviewed_config()
        with self.assertRaisesRegex(ValueError, "confirmation phrase"):
            approve_company_review_operating_config(
                record, operating_config_review_hash(record), "portfolio_manager", "Reviewed.", "YES",
            )
        with self.assertRaisesRegex(ValueError, "review hash"):
            approve_company_review_operating_config(
                record, "0" * 64, "portfolio_manager", "Reviewed.", CONFIRMATION_PHRASE,
            )

    def test_content_change_after_hash_is_rejected(self) -> None:
        record = reviewed_config()
        review_hash = operating_config_review_hash(record)
        record["review_policy"]["post_event_update_sla"]["value"] = 48
        with self.assertRaisesRegex(ValueError, "review hash"):
            approve_company_review_operating_config(
                record, review_hash, "portfolio_manager", "Reviewed.", CONFIRMATION_PHRASE,
            )

    def test_placeholders_and_position_authority_are_rejected(self) -> None:
        record = reviewed_config()
        record["owners"]["analyst_owner"] = "REPLACE_WITH_NAME_OR_ROLE"
        with self.assertRaisesRegex(ValueError, "analyst_owner"):
            approve(record)
        record = reviewed_config()
        record["automatic_position_action_allowed"] = True
        with self.assertRaisesRegex(ValueError, "automatic position"):
            approve(record)

    def test_append_only_registry_requires_next_version(self) -> None:
        _, registry, _ = approve()
        with self.assertRaisesRegex(ValueError, "requires version 2"):
            approve(reviewed_config(1), registry)
        version_two = reviewed_config(2)
        record, appended, _ = approve(version_two, registry)
        self.assertEqual(record["version"], 2)
        self.assertEqual(len(appended), 2)

    def test_identity_and_timezone_must_be_stable(self) -> None:
        record = reviewed_config()
        record["operating_config_id"] = "company:GEV:review-operations:wrong"
        with self.assertRaisesRegex(ValueError, "ID"):
            approve(record)
        record = reviewed_config()
        with self.assertRaisesRegex(ValueError, "timezone"):
            approve_company_review_operating_config(
                record, operating_config_review_hash(record), "portfolio_manager", "Reviewed.",
                CONFIRMATION_PHRASE, approved_at="2026-10-30T15:00:00",
            )


if __name__ == "__main__":
    unittest.main()
