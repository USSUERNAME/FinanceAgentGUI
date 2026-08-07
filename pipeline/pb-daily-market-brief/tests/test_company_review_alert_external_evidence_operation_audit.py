from __future__ import annotations

import copy
import unittest

from audit_company_review_alert_external_evidence_operation import (
    audit_company_review_alert_external_evidence_operation,
    validate_company_review_alert_external_evidence_operation_audit,
)
from build_company_review_alert_external_evidence_backlog import update_company_review_alert_external_evidence_backlog
from build_company_review_alert_external_evidence_review_summary import build_company_review_alert_external_evidence_review_summary
from test_company_review_alert_external_evidence_backlog import external_pending_integrity


class CompanyReviewAlertExternalEvidenceOperationAuditTests(unittest.TestCase):
    def test_audit_reconciles_current_artifacts_without_network_or_action(self) -> None:
        integrity, completions = external_pending_integrity("2026-11-08")
        _, backlog = update_company_review_alert_external_evidence_backlog({}, integrity, completions)
        summary = build_company_review_alert_external_evidence_review_summary(backlog, [])
        audit = audit_company_review_alert_external_evidence_operation(
            integrity, backlog, summary, completions, [], [], observed_at="2026-11-08T12:00:00+00:00",
        )
        self.assertEqual(audit["status"], "pass")
        self.assertEqual(audit["reconciliation"]["unverified_external_reference_count"], 1)
        self.assertTrue(audit["methodology"]["external_urls_not_fetched"])
        self.assertFalse(audit["methodology"]["automatic_position_action_allowed"])

    def test_audit_validator_rejects_reconciliation_or_auto_remediation(self) -> None:
        integrity, completions = external_pending_integrity("2026-11-08")
        _, backlog = update_company_review_alert_external_evidence_backlog({}, integrity, completions)
        summary = build_company_review_alert_external_evidence_review_summary(backlog, [])
        audit = audit_company_review_alert_external_evidence_operation(integrity, backlog, summary, completions, [], [])
        tampered = copy.deepcopy(audit)
        tampered["reconciliation"]["tracked_pending_backlog_count"] = 99
        with self.assertRaisesRegex(ValueError, "reconciliation"):
            validate_company_review_alert_external_evidence_operation_audit(tampered)
        tampered = copy.deepcopy(audit)
        tampered["methodology"]["attention_is_not_automatic_remediation"] = False
        with self.assertRaisesRegex(ValueError, "non-network"):
            validate_company_review_alert_external_evidence_operation_audit(tampered)


if __name__ == "__main__":
    unittest.main()
