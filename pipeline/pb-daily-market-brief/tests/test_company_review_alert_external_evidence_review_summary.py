from __future__ import annotations

import unittest

from build_company_review_alert_external_evidence_backlog import update_company_review_alert_external_evidence_backlog
from build_company_review_alert_external_evidence_review_summary import (
    build_company_review_alert_external_evidence_review_summary,
    validate_company_review_alert_external_evidence_review_summary,
)
from review_company_review_alert_external_evidence_backlog import (
    CONFIRMATION_PHRASE, backlog_item_review_hash, review_company_review_alert_external_evidence_backlog,
)
from test_company_review_alert_external_evidence_backlog import external_pending_integrity


class CompanyReviewAlertExternalEvidenceReviewSummaryTests(unittest.TestCase):
    def test_summary_separates_active_unreviewed_and_recorded_decisions(self) -> None:
        integrity, completions = external_pending_integrity("2026-11-08")
        history, backlog = update_company_review_alert_external_evidence_backlog({}, integrity, completions)
        item = backlog["queue"][0]
        _, registry, _ = review_company_review_alert_external_evidence_backlog(
            item["item_key"], backlog, backlog_item_review_hash(item), "pm", "alternate_evidence_requested",
            "대체 근거 요청", CONFIRMATION_PHRASE, reviewed_at="2026-11-08T12:00:00+00:00",
        )
        _, reviewed_backlog = update_company_review_alert_external_evidence_backlog(history, integrity, completions, review_records=registry)
        summary = build_company_review_alert_external_evidence_review_summary(reviewed_backlog, registry)
        self.assertEqual(summary["active_backlog"]["alternate_evidence_requested_count"], 1)
        self.assertEqual(summary["review_flow"]["recorded_in_window_count"], 1)
        self.assertEqual(summary["review_flow"]["decision_counts"]["alternate_evidence_requested"], 1)
        self.assertTrue(summary["methodology"]["external_urls_not_fetched"])

    def test_validator_rejects_auto_action_or_unreconciled_decisions(self) -> None:
        integrity, completions = external_pending_integrity("2026-11-08")
        _, backlog = update_company_review_alert_external_evidence_backlog({}, integrity, completions)
        summary = build_company_review_alert_external_evidence_review_summary(backlog, [])
        summary["methodology"]["automatic_position_action_allowed"] = True
        with self.assertRaisesRegex(ValueError, "cannot send or execute"):
            validate_company_review_alert_external_evidence_review_summary(summary)


if __name__ == "__main__":
    unittest.main()
