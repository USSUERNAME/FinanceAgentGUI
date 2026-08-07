from __future__ import annotations

import copy
import unittest

from build_company_review_alert_external_evidence_backlog import (
    update_company_review_alert_external_evidence_backlog,
    validate_company_review_alert_external_evidence_backlog,
    validate_company_review_alert_external_evidence_backlog_history,
)
from test_company_review_alert_sla_summary import records
from validate_company_review_alert_completion_evidence import validate_company_review_alert_completion_evidence
from review_company_review_alert_external_evidence_backlog import (
    CONFIRMATION_PHRASE,
    backlog_item_review_hash,
    review_company_review_alert_external_evidence_backlog,
)


def external_pending_integrity(report_date: str) -> tuple[dict, list[dict]]:
    _, _, completions = records()
    completions = copy.deepcopy(completions[:1])
    reference = completions[0]["evidence_references"][0]
    reference.update({
        "evidence_id": "official-url-001", "source_type": "company_ir",
        "source_reference": "https://example.com/official-evidence",
        "limitation": "Operational completion evidence only.",
    })
    return validate_company_review_alert_completion_evidence(
        report_date, completions, observed_at=f"{report_date}T12:00:00+00:00",
    ), completions


class CompanyReviewAlertExternalEvidenceBacklogTests(unittest.TestCase):
    def test_aging_queue_preserves_first_pending_date_and_escalates_weekly_review(self) -> None:
        first, completions = external_pending_integrity("2026-11-01")
        history, queue = update_company_review_alert_external_evidence_backlog({}, first, completions)
        self.assertEqual(queue["normal_count"], 1)
        same_history, same_queue = update_company_review_alert_external_evidence_backlog(history, first, completions)
        self.assertEqual(same_history, history)
        self.assertEqual(same_queue["queue"][0]["pending_age_days"], 0)
        eighth, _ = external_pending_integrity("2026-11-08")
        history, queue = update_company_review_alert_external_evidence_backlog(history, eighth, completions)
        row = queue["queue"][0]
        self.assertEqual(row["first_pending_report_date"], "2026-11-01")
        self.assertEqual(row["pending_age_days"], 7)
        self.assertEqual(row["queue_status"], "weekly_manual_review_due")
        self.assertEqual(queue["critical_count"], 1)
        self.assertTrue(row["owner_assignment_required"])
        self.assertFalse(row["automatic_position_action_allowed"])

    def test_same_date_changed_snapshot_appends_revision(self) -> None:
        first, completions = external_pending_integrity("2026-11-01")
        history, _ = update_company_review_alert_external_evidence_backlog({}, first, completions)
        revised = copy.deepcopy(first)
        revised["rows"][0]["references"][0]["status"] = "local_reference_exists"
        revised["rows"][0]["completion_status"] = "local_references_available"
        revised["external_reference_verification_pending_count"] = 0
        revised["local_references_available_count"] = 1
        history, queue = update_company_review_alert_external_evidence_backlog(history, revised, completions)
        self.assertEqual(len(history["snapshots"]), 2)
        self.assertEqual(history["snapshots"][-1]["revision"], 2)
        self.assertEqual(queue["pending_count"], 0)

    def test_validators_reject_owner_or_position_promotion(self) -> None:
        integrity, completions = external_pending_integrity("2026-11-01")
        history, queue = update_company_review_alert_external_evidence_backlog({}, integrity, completions)
        tampered = copy.deepcopy(queue)
        tampered["queue"][0]["owner"] = "analyst"
        with self.assertRaisesRegex(ValueError, "cannot infer"):
            validate_company_review_alert_external_evidence_backlog(tampered)
        tampered_history = copy.deepcopy(history)
        tampered_history["snapshots"][0]["pending_items"][0]["source_reference"] = "https://changed.example"
        with self.assertRaisesRegex(ValueError, "snapshot hash"):
            validate_company_review_alert_external_evidence_backlog_history(tampered_history)

    def test_human_backlog_decision_is_hash_bound_and_only_changes_queue_priority(self) -> None:
        integrity, completions = external_pending_integrity("2026-11-08")
        history, queue = update_company_review_alert_external_evidence_backlog({}, integrity, completions)
        item = queue["queue"][0]
        review, registry, receipt = review_company_review_alert_external_evidence_backlog(
            item["item_key"], queue, backlog_item_review_hash(item), "pm", "deferred_pending_recheck",
            "후속 공시 확인 후 재검토", CONFIRMATION_PHRASE, deferred_until="2026-11-15",
            reviewed_at="2026-11-08T12:00:00+00:00",
        )
        self.assertFalse(review["automatic_position_action_allowed"])
        self.assertFalse(receipt["security_or_position_action_approved"])
        _, reviewed_queue = update_company_review_alert_external_evidence_backlog(
            history, integrity, completions, review_records=registry,
        )
        self.assertEqual(reviewed_queue["queue"][0]["queue_status"], "deferred_pending_recheck")
        self.assertEqual(reviewed_queue["queue"][0]["priority"], "normal")
        self.assertEqual(integrity["external_reference_verification_pending_count"], 1)
        with self.assertRaisesRegex(ValueError, "Expected backlog hash"):
            review_company_review_alert_external_evidence_backlog(
                item["item_key"], queue, "0" * 64, "pm", "alternate_evidence_requested",
                "대체 근거 요청", CONFIRMATION_PHRASE,
            )


if __name__ == "__main__":
    unittest.main()
