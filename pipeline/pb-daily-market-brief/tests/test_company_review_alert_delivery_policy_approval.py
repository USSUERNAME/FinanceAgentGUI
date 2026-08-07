from __future__ import annotations

import copy
import unittest

from approve_company_review_alert_delivery_policy import (
    CONFIRMATION_PHRASE,
    approve_company_review_alert_delivery_policy,
    delivery_policy_review_hash,
)
from test_company_review_alert_dispatch import approved_policy


def draft_policy() -> dict:
    policy = approved_policy()
    policy["approval"] = {
        "status": "draft_pending_user_or_pm_approval",
        "approved_by": None, "approved_at": None, "approval_note": None,
    }
    return policy


class CompanyReviewAlertDeliveryPolicyApprovalTests(unittest.TestCase):
    def test_hash_and_exact_confirmation_append_approved_policy(self) -> None:
        draft = draft_policy()
        approved, registry, receipt = approve_company_review_alert_delivery_policy(
            draft, delivery_policy_review_hash(draft), "pm_owner", "Approve critical review alerts only.",
            CONFIRMATION_PHRASE, approved_at="2026-07-21T09:00:00+09:00",
        )
        self.assertEqual(approved["approval"]["status"], "approved_by_user_or_pm")
        self.assertEqual(len(registry), 1)
        self.assertTrue(receipt["environment_activation_still_required"])
        self.assertFalse(receipt["security_or_position_action_approved"])

    def test_tampering_confirmation_and_version_reuse_are_blocked(self) -> None:
        draft = draft_policy()
        with self.assertRaisesRegex(ValueError, "confirmation phrase"):
            approve_company_review_alert_delivery_policy(
                draft, delivery_policy_review_hash(draft), "pm", "note", "YES",
                approved_at="2026-07-21T09:00:00+09:00",
            )
        stale_hash = delivery_policy_review_hash(draft)
        tampered = copy.deepcopy(draft)
        tampered["allowed_escalation_reasons"] = ["approved_kill_criterion_matched"]
        with self.assertRaisesRegex(ValueError, "review hash"):
            approve_company_review_alert_delivery_policy(
                tampered, stale_hash, "pm", "note", CONFIRMATION_PHRASE,
                approved_at="2026-07-21T09:00:00+09:00",
            )
        approved, registry, _ = approve_company_review_alert_delivery_policy(
            draft, stale_hash, "pm", "note", CONFIRMATION_PHRASE,
            approved_at="2026-07-21T09:00:00+09:00",
        )
        with self.assertRaisesRegex(ValueError, "requires version 2"):
            approve_company_review_alert_delivery_policy(
                draft, stale_hash, "pm", "note", CONFIRMATION_PHRASE, registry,
                approved_at="2026-07-21T10:00:00+09:00",
            )
        self.assertEqual(approved["version"], 1)


if __name__ == "__main__":
    unittest.main()
