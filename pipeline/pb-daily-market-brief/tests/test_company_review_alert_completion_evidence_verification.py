from __future__ import annotations

import copy
import unittest

from test_company_review_alert_sla_summary import records
from validate_company_review_alert_completion_evidence import validate_company_review_alert_completion_evidence
from verify_company_review_alert_completion_evidence import (
    CONFIRMATION_PHRASE,
    external_evidence_review_hash,
    list_external_evidence_candidates,
    verify_company_review_alert_completion_evidence,
)


class CompanyReviewAlertCompletionEvidenceVerificationTests(unittest.TestCase):
    def external_completion(self) -> tuple[list[dict[str, object]], dict[str, object]]:
        _, _, completions = records()
        completions = copy.deepcopy(completions[:1])
        reference = completions[0]["evidence_references"][0]
        reference["evidence_id"] = "official-url-001"
        reference["source_type"] = "company_ir"
        reference["source_reference"] = "https://example.com/official-evidence"
        reference["limitation"] = "Manual operational reference review only."
        return completions, reference

    def test_manual_verification_binds_current_external_reference_without_fetching(self) -> None:
        completions, reference = self.external_completion()
        completion = completions[0]
        evidence_hash = external_evidence_review_hash(completion, reference)
        record, registry, receipt = verify_company_review_alert_completion_evidence(
            completion["completion_id"], reference["evidence_id"], completions, evidence_hash,
            "pm", "원문 URL과 종결 근거의 연결을 직접 검토함", CONFIRMATION_PHRASE,
            verified_at="2026-11-07T12:00:00+00:00",
        )
        self.assertEqual(record["status"], "verified_by_user_or_pm")
        self.assertFalse(record["automatic_position_action_allowed"])
        self.assertFalse(receipt["external_url_fetched_by_automation"])
        candidates = list_external_evidence_candidates(completions, registry)
        self.assertEqual(candidates[0]["manual_verification_status"], "verified_by_user_or_pm")
        payload = validate_company_review_alert_completion_evidence(
            "2026-11-07", completions, observed_at="2026-11-07T12:05:00+00:00",
            external_verifications=registry,
        )
        self.assertEqual(payload["external_references_verified_by_user_or_pm_count"], 1)
        self.assertEqual(payload["external_reference_verification_pending_count"], 0)
        self.assertEqual(payload["rows"][0]["references"][0]["status"], "external_reference_verified_by_user_or_pm")
        self.assertTrue(payload["methodology"]["external_urls_not_fetched"])

    def test_stale_hash_or_duplicate_cannot_be_recorded(self) -> None:
        completions, reference = self.external_completion()
        completion = completions[0]
        evidence_hash = external_evidence_review_hash(completion, reference)
        with self.assertRaisesRegex(ValueError, "Expected evidence hash"):
            verify_company_review_alert_completion_evidence(
                completion["completion_id"], reference["evidence_id"], completions, "0" * 64,
                "pm", "직접 검토함", CONFIRMATION_PHRASE,
            )
        record, registry, _ = verify_company_review_alert_completion_evidence(
            completion["completion_id"], reference["evidence_id"], completions, evidence_hash,
            "pm", "직접 검토함", CONFIRMATION_PHRASE,
        )
        self.assertEqual(record["reviewed_evidence_hash"], evidence_hash)
        with self.assertRaisesRegex(ValueError, "already manually verified"):
            verify_company_review_alert_completion_evidence(
                completion["completion_id"], reference["evidence_id"], completions, evidence_hash,
                "pm", "재검토함", CONFIRMATION_PHRASE, registry,
            )

    def test_confirmation_and_reference_scope_are_required(self) -> None:
        completions, reference = self.external_completion()
        completion = completions[0]
        with self.assertRaisesRegex(ValueError, "exact confirmation phrase"):
            verify_company_review_alert_completion_evidence(
                completion["completion_id"], reference["evidence_id"], completions,
                external_evidence_review_hash(completion, reference), "pm", "직접 검토함", "wrong",
            )
        with self.assertRaisesRegex(ValueError, "current external"):
            verify_company_review_alert_completion_evidence(
                completion["completion_id"], "not-present", completions,
                external_evidence_review_hash(completion, reference), "pm", "직접 검토함", CONFIRMATION_PHRASE,
            )


if __name__ == "__main__":
    unittest.main()
