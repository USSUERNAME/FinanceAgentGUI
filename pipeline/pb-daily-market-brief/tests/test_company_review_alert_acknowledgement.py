from __future__ import annotations

import unittest

from acknowledge_company_review_alert import (
    CONFIRMATION_PHRASE,
    acknowledgement_review_hash,
    acknowledge_company_review_alert,
    _eligible_alerts,
)
from dispatch_company_review_alerts import plan_company_review_alerts
from dispatch_company_review_alerts import validate_acknowledgement_registry
from test_company_review_alert_dispatch import approved_policy, empty_history, monitor


def plan() -> dict:
    return plan_company_review_alerts(monitor(), [approved_policy()], [], empty_history(), False)


class CompanyReviewAlertAcknowledgementTests(unittest.TestCase):
    def test_exact_review_hash_and_confirmation_append_once(self) -> None:
        selected = _eligible_alerts(monitor(), plan())[0]
        acknowledgement, registry, receipt = acknowledge_company_review_alert(
            selected["alert_key"], monitor(), plan(), acknowledgement_review_hash(selected),
            "pm_owner", "Follow-up assigned to the analyst.", CONFIRMATION_PHRASE,
            acknowledged_at="2026-10-31T14:00:00+00:00",
        )
        self.assertEqual(acknowledgement["status"], "acknowledged_by_user_or_pm")
        self.assertFalse(acknowledgement["automatic_position_action_allowed"])
        self.assertEqual(len(registry), 1)
        self.assertTrue(receipt["operational_alert_acknowledged"])
        self.assertFalse(receipt["security_or_position_action_approved"])

    def test_stale_hash_wrong_key_and_duplicate_are_blocked(self) -> None:
        selected = _eligible_alerts(monitor(), plan())[0]
        review_hash = acknowledgement_review_hash(selected)
        with self.assertRaisesRegex(ValueError, "confirmation phrase"):
            acknowledge_company_review_alert(
                selected["alert_key"], monitor(), plan(), review_hash, "pm", "note", "YES",
                acknowledged_at="2026-10-31T14:00:00+00:00",
            )
        with self.assertRaisesRegex(ValueError, "review hash"):
            acknowledge_company_review_alert(
                selected["alert_key"], monitor(), plan(), "stale", "pm", "note", CONFIRMATION_PHRASE,
                acknowledged_at="2026-10-31T14:00:00+00:00",
            )
        acknowledgement, registry, _ = acknowledge_company_review_alert(
            selected["alert_key"], monitor(), plan(), review_hash, "pm", "note", CONFIRMATION_PHRASE,
            acknowledged_at="2026-10-31T14:00:00+00:00",
        )
        with self.assertRaisesRegex(ValueError, "already acknowledged"):
            acknowledge_company_review_alert(
                selected["alert_key"], monitor(), plan(), review_hash, "pm", "note", CONFIRMATION_PHRASE,
                registry, acknowledged_at="2026-10-31T14:01:00+00:00",
            )
        self.assertEqual(acknowledgement["ticker"], "GEV")

    def test_non_candidate_alert_cannot_be_acknowledged(self) -> None:
        suppressed = plan_company_review_alerts(
            monitor("attention_required", ["pre_event_preparation_due_date_missed_or_late"]),
            [approved_policy()], [], empty_history(), False,
        )
        with self.assertRaisesRegex(ValueError, "eligible current-plan"):
            acknowledge_company_review_alert(
                "0" * 64, monitor("attention_required"), suppressed, "0" * 64,
                "pm", "note", CONFIRMATION_PHRASE,
                acknowledged_at="2026-10-31T14:00:00+00:00",
            )

    def test_acknowledgement_cannot_carry_position_authority(self) -> None:
        selected = _eligible_alerts(monitor(), plan())[0]
        acknowledgement, _, _ = acknowledge_company_review_alert(
            selected["alert_key"], monitor(), plan(), acknowledgement_review_hash(selected),
            "pm", "note", CONFIRMATION_PHRASE,
            acknowledged_at="2026-10-31T14:00:00+00:00",
        )
        acknowledgement["automatic_position_action_allowed"] = True
        with self.assertRaisesRegex(ValueError, "position action"):
            validate_acknowledgement_registry([acknowledgement])


if __name__ == "__main__":
    unittest.main()
