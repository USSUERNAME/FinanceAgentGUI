from __future__ import annotations

import copy
import unittest

from acknowledge_company_review_alert import (
    CONFIRMATION_PHRASE as ACK_CONFIRMATION,
    acknowledgement_review_hash as alert_review_hash,
    acknowledge_company_review_alert,
    _eligible_alerts,
)
from assign_company_review_alert_followup import (
    CONFIRMATION_PHRASE,
    acknowledgement_review_hash,
    assign_company_review_alert_followup,
    validate_followup_registry,
)
from complete_company_review_alert_followup import (
    CONFIRMATION_PHRASE as COMPLETE_CONFIRMATION,
    complete_company_review_alert_followup,
    followup_review_hash,
    validate_completion_registry,
)
from dispatch_company_review_alerts import plan_company_review_alerts
from monitor_company_review_alert_followups import (
    monitor_company_review_alert_followups,
    validate_company_review_alert_followup_monitor,
)
from test_company_review_alert_dispatch import approved_policy, empty_history, monitor


def alert_plan() -> dict:
    return plan_company_review_alerts(monitor(), [approved_policy()], [], empty_history(), False)


def acknowledged() -> list[dict]:
    selected = _eligible_alerts(monitor(), alert_plan())[0]
    acknowledgement, registry, _ = acknowledge_company_review_alert(
        selected["alert_key"], monitor(), alert_plan(), alert_review_hash(selected),
        "pm_owner", "Follow-up required.", ACK_CONFIRMATION,
        acknowledged_at="2026-10-31T14:00:00+00:00",
    )
    assert registry == [acknowledgement]
    return registry


class CompanyReviewAlertFollowupTests(unittest.TestCase):
    def test_assignment_requires_exact_acknowledgement_hash_and_is_append_only(self) -> None:
        acknowledgements = acknowledged()
        review_hash = acknowledgement_review_hash(acknowledgements[0])
        followup, registry, receipt = assign_company_review_alert_followup(
            acknowledgements[0]["alert_key"], acknowledgements, review_hash,
            "pm_owner", "research_analyst", "2026-11-01T14:00:00+00:00",
            "Review primary evidence and log the formal thesis-update decision.", CONFIRMATION_PHRASE,
            assigned_at="2026-10-31T14:05:00+00:00",
        )
        self.assertEqual(followup["status"], "open")
        self.assertFalse(followup["automatic_position_action_allowed"])
        self.assertEqual(len(registry), 1)
        self.assertTrue(receipt["operational_followup_assigned"])
        self.assertFalse(receipt["security_or_position_action_approved"])
        with self.assertRaisesRegex(ValueError, "already has an active follow-up"):
            assign_company_review_alert_followup(
                acknowledgements[0]["alert_key"], acknowledgements, review_hash,
                "pm_owner", "research_analyst", "2026-11-02T14:00:00+00:00",
                "Other criterion", CONFIRMATION_PHRASE, registry,
                assigned_at="2026-10-31T14:05:00+00:00",
            )

    def test_stale_hash_and_position_authority_are_rejected(self) -> None:
        acknowledgements = acknowledged()
        with self.assertRaisesRegex(ValueError, "acknowledgement hash"):
            assign_company_review_alert_followup(
                acknowledgements[0]["alert_key"], acknowledgements, "stale",
                "pm_owner", "research_analyst", "2026-11-01T14:00:00+00:00",
                "Criterion", CONFIRMATION_PHRASE,
                assigned_at="2026-10-31T14:05:00+00:00",
            )
        followup, _, _ = assign_company_review_alert_followup(
            acknowledgements[0]["alert_key"], acknowledgements,
            acknowledgement_review_hash(acknowledgements[0]), "pm_owner", "research_analyst",
            "2026-11-01T14:00:00+00:00", "Criterion", CONFIRMATION_PHRASE,
            assigned_at="2026-10-31T14:05:00+00:00",
        )
        tampered = copy.deepcopy(followup)
        tampered["automatic_position_action_allowed"] = True
        with self.assertRaisesRegex(ValueError, "position action"):
            validate_followup_registry([tampered])

    def test_monitor_reopens_missing_or_overdue_assignments_without_position_action(self) -> None:
        missing = monitor_company_review_alert_followups(
            "2026-10-31", acknowledged(), [], observed_at="2026-10-31T15:00:00+00:00",
        )
        self.assertEqual(missing["missing_assignment_count"], 1)
        self.assertEqual(missing["rows"][0]["alert_level"], "attention_required")
        acknowledgements = acknowledged()
        followup, _, _ = assign_company_review_alert_followup(
            acknowledgements[0]["alert_key"], acknowledgements,
            acknowledgement_review_hash(acknowledgements[0]), "pm_owner", "research_analyst",
            "2026-10-31T15:30:00+00:00", "Criterion", CONFIRMATION_PHRASE,
            assigned_at="2026-10-31T14:05:00+00:00",
        )
        overdue = monitor_company_review_alert_followups(
            "2026-10-31", acknowledgements, [followup], observed_at="2026-10-31T16:00:00+00:00",
        )
        self.assertEqual(overdue["overdue_count"], 1)
        self.assertEqual(overdue["rows"][0]["alert_level"], "critical_review_required")
        self.assertFalse(overdue["rows"][0]["automatic_position_action_allowed"])
        tampered = copy.deepcopy(overdue)
        tampered["rows"][0]["position_action"] = "sell"
        with self.assertRaisesRegex(ValueError, "position action"):
            validate_company_review_alert_followup_monitor(tampered)

    def test_evidence_backed_completion_closes_open_followup_without_changing_position(self) -> None:
        acknowledgements = acknowledged()
        followup, _, _ = assign_company_review_alert_followup(
            acknowledgements[0]["alert_key"], acknowledgements,
            acknowledgement_review_hash(acknowledgements[0]), "pm_owner", "research_analyst",
            "2026-11-01T14:00:00+00:00", "Review primary evidence.", CONFIRMATION_PHRASE,
            assigned_at="2026-10-31T14:05:00+00:00",
        )
        references = [{
            "evidence_id": "workpaper-1", "source_type": "internal_workpaper",
            "source_reference": "workspace/internal_notes/GEV.md",
            "limitation": "Operational completion evidence only.",
        }]
        completion, registry, receipt = complete_company_review_alert_followup(
            followup["alert_key"], [followup], followup_review_hash(followup),
            "research_analyst", "evidence_review_completed", "Primary evidence reviewed.",
            references, COMPLETE_CONFIRMATION, completed_at="2026-10-31T15:00:00+00:00",
        )
        self.assertEqual(completion["status"], "completed_with_evidence")
        self.assertFalse(completion["automatic_position_action_allowed"])
        self.assertEqual(len(registry), 1)
        self.assertTrue(receipt["operational_followup_completed"])
        monitored = monitor_company_review_alert_followups(
            "2026-10-31", acknowledgements, [followup], registry,
            observed_at="2026-10-31T16:00:00+00:00",
        )
        self.assertEqual(monitored["completed_count"], 1)
        self.assertEqual(monitored["rows"][0]["status"], "assigned_followup_completed")

    def test_completion_requires_current_followup_hash_and_evidence(self) -> None:
        acknowledgements = acknowledged()
        followup, _, _ = assign_company_review_alert_followup(
            acknowledgements[0]["alert_key"], acknowledgements,
            acknowledgement_review_hash(acknowledgements[0]), "pm_owner", "research_analyst",
            "2026-11-01T14:00:00+00:00", "Review primary evidence.", CONFIRMATION_PHRASE,
            assigned_at="2026-10-31T14:05:00+00:00",
        )
        with self.assertRaisesRegex(ValueError, "follow-up hash"):
            complete_company_review_alert_followup(
                followup["alert_key"], [followup], "stale", "research_analyst",
                "evidence_review_completed", "Reviewed.", [], COMPLETE_CONFIRMATION,
                completed_at="2026-10-31T15:00:00+00:00",
            )
        with self.assertRaisesRegex(ValueError, "evidence reference"):
            complete_company_review_alert_followup(
                followup["alert_key"], [followup], followup_review_hash(followup), "research_analyst",
                "evidence_review_completed", "Reviewed.", [], COMPLETE_CONFIRMATION,
                completed_at="2026-10-31T15:00:00+00:00",
            )
        invalid = [{
            "completion_id": "completion:bad", "alert_key": followup["alert_key"],
            "followup_id": followup["followup_id"], "review_id": followup["review_id"],
            "ticker": followup["ticker"], "status": "completed_with_evidence",
            "completed_by": "research_analyst", "completed_at": "2026-10-31T15:00:00+00:00",
            "completion_outcome": "evidence_review_completed", "evidence_summary": "Reviewed.",
            "evidence_references": [{"evidence_id": "note", "source_type": "internal", "source_reference": "note", "limitation": "ops"}],
            "reviewed_followup_hash": followup_review_hash(followup),
            "completion_scope": "operational_review_only", "automatic_position_action_allowed": True,
        }]
        with self.assertRaisesRegex(ValueError, "position action"):
            validate_completion_registry(invalid)


if __name__ == "__main__":
    unittest.main()
