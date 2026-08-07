from __future__ import annotations

import copy
import unittest

from approve_company_underwriting_draft import (
    CONFIRMATION_PHRASE,
    approve_underwriting_draft,
)
from build_company_underwriting_drafts import build_company_underwriting_drafts
from test_company_underwriting_drafts import inputs


def draft_payload() -> dict:
    return build_company_underwriting_drafts("2026-10-30", *inputs())


def approve(payload: dict | None = None, registry: list[dict] | None = None):
    payload = payload or draft_payload()
    row = payload["companies"][0]
    return approve_underwriting_draft(
        payload, "GEV", row["draft_hash"], "portfolio_manager",
        "Reviewed the thesis, pillars, sources and break conditions.",
        CONFIRMATION_PHRASE, registry or [],
        one_sentence_thesis="GE Vernova execution depends on revenue-range delivery and comparable backlog persistence.",
        variant_perception="No market-mispricing conclusion is approved; this is a company-thesis monitoring baseline.",
        horizon="12-24 months", approved_at="2026-10-30T15:00:00+00:00",
    )


class CompanyUnderwritingApprovalTests(unittest.TestCase):
    def test_explicit_review_appends_approved_version_and_receipt(self) -> None:
        record, registry, receipt = approve()
        self.assertEqual(record["approval"]["status"], "approved_by_user_or_pm")
        self.assertEqual(len(registry), 1)
        self.assertTrue(record["underwriting_id"].startswith("company:GEV:original:"))
        self.assertEqual(receipt["company_thesis_update_allowed"], True)
        self.assertEqual(receipt["security_or_position_action_approved"], False)
        self.assertTrue(all(
            row["threshold_origin"] == "Inherited threshold"
            and row["threshold_approval_status"] == "Approved monitoring rule"
            for row in record["kill_criteria"]
        ))

    def test_approval_adds_internal_judgment_source_to_every_rule(self) -> None:
        record, _, _ = approve()
        approval_source = f"UW-GEV-V{record['version']}"
        self.assertIn(approval_source, {row["source_id"] for row in record["source_index"]})
        self.assertTrue(all(approval_source in row["source_ids"] for row in record["pillars"]))
        self.assertTrue(all(approval_source in row["source_ids"] for row in record["kill_criteria"]))

    def test_wrong_hash_or_confirmation_phrase_is_rejected(self) -> None:
        payload = draft_payload()
        row = payload["companies"][0]
        common = (
            payload, "GEV", row["draft_hash"], "portfolio_manager", "Reviewed.",
        )
        with self.assertRaisesRegex(ValueError, "confirmation phrase"):
            approve_underwriting_draft(*common, "YES", one_sentence_thesis="Reviewed thesis", variant_perception="No variant approved", horizon="12 months")
        with self.assertRaisesRegex(ValueError, "hash"):
            approve_underwriting_draft(
                payload, "GEV", "0" * 64, "portfolio_manager", "Reviewed.", CONFIRMATION_PHRASE,
                one_sentence_thesis="Reviewed thesis", variant_perception="No variant approved", horizon="12 months",
            )

    def test_generated_placeholders_cannot_be_approved_unchanged(self) -> None:
        payload = draft_payload()
        row = payload["companies"][0]
        with self.assertRaisesRegex(ValueError, "one-sentence thesis"):
            approve_underwriting_draft(
                payload, "GEV", row["draft_hash"], "portfolio_manager", "Reviewed.", CONFIRMATION_PHRASE,
            )

    def test_append_only_registry_rejects_same_ticker_version(self) -> None:
        record, registry, _ = approve()
        payload = draft_payload()
        with self.assertRaisesRegex(ValueError, "already contains"):
            approve(payload, registry)
        self.assertEqual(record["version"], registry[0]["version"])

    def test_reviewed_record_cannot_change_ticker_or_version(self) -> None:
        payload = draft_payload()
        row = payload["companies"][0]
        reviewed = copy.deepcopy(row["draft_record"])
        reviewed["ticker"] = "OTHER"
        with self.assertRaisesRegex(ValueError, "ticker"):
            approve_underwriting_draft(
                payload, "GEV", row["draft_hash"], "portfolio_manager", "Reviewed.",
                CONFIRMATION_PHRASE, reviewed_record=reviewed,
                one_sentence_thesis="Reviewed thesis", variant_perception="No variant approved", horizon="12 months",
            )


if __name__ == "__main__":
    unittest.main()
