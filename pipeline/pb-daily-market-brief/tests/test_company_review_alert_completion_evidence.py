from __future__ import annotations

import copy
import unittest

from test_company_review_alert_sla_summary import records
from validate_company_review_alert_completion_evidence import (
    validate_company_review_alert_completion_evidence,
    validate_completion_evidence_integrity,
)


class CompanyReviewAlertCompletionEvidenceTests(unittest.TestCase):
    def test_integrity_reports_missing_local_and_unverified_external_without_fetching(self) -> None:
        _, _, completions = records()
        completions = copy.deepcopy(completions[:2])
        completions[0]["evidence_references"][0]["source_reference"] = "workspace/not-present/GEV.md"
        completions[1]["evidence_references"][0]["source_reference"] = "https://example.com/official-evidence"
        payload = validate_company_review_alert_completion_evidence(
            "2026-11-07", completions, observed_at="2026-11-07T12:00:00+00:00",
        )
        self.assertEqual(payload["reference_integrity_issue_count"], 1)
        self.assertEqual(payload["external_reference_verification_pending_count"], 1)
        self.assertEqual(payload["rows"][0]["completion_status"], "reference_integrity_issue")
        self.assertEqual(payload["rows"][1]["completion_status"], "external_reference_verification_pending")
        self.assertTrue(payload["methodology"]["external_urls_not_fetched"])

    def test_integrity_validator_blocks_position_authority(self) -> None:
        _, _, completions = records()
        payload = validate_company_review_alert_completion_evidence("2026-11-07", completions[:1])
        tampered = copy.deepcopy(payload)
        tampered["rows"][0]["position_action"] = "sell"
        with self.assertRaisesRegex(ValueError, "position action"):
            validate_completion_evidence_integrity(tampered)


if __name__ == "__main__":
    unittest.main()
