from __future__ import annotations

import copy
import unittest

from assign_company_review_alert_followup import acknowledgement_review_hash
from build_company_review_alert_sla_summary import (
    build_company_review_alert_sla_summary,
    validate_company_review_alert_sla_summary,
)
from complete_company_review_alert_followup import followup_review_hash


def records() -> tuple[list[dict], list[dict], list[dict]]:
    acknowledgements: list[dict] = []
    followups: list[dict] = []
    completions: list[dict] = []
    assignment_days = ("2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04")
    for index, assigned_day in enumerate(assignment_days, start=1):
        key = f"{index:064x}"
        acknowledgement = {
            "acknowledgement_id": f"ack:{key}", "alert_key": key,
            "review_id": f"company-review:GEV:{index}", "ticker": "GEV",
            "status": "acknowledged_by_user_or_pm", "acknowledged_by": "pm_owner",
            "acknowledged_at": f"{assigned_day}T07:00:00+00:00", "note": "Follow-up required.",
        }
        acknowledgements.append(acknowledgement)
        followup = {
            "followup_id": f"followup:{key}", "alert_key": key,
            "review_id": acknowledgement["review_id"], "ticker": "GEV", "status": "open",
            "assigned_by": "pm_owner", "owner": "research_analyst",
            "assigned_at": f"{assigned_day}T08:00:00+00:00",
            "due_at": f"2026-11-0{index + 2}T08:00:00+00:00",
            "completion_criteria": "Review primary evidence.",
            "acknowledgement_review_hash": acknowledgement_review_hash(acknowledgement),
            "followup_scope": "operational_review_only", "automatic_position_action_allowed": False,
        }
        followups.append(followup)
    completed_times = (
        "2026-11-01T20:00:00+00:00", "2026-11-04T10:00:00+00:00", "2026-11-04T07:00:00+00:00",
    )
    for followup, completed_at in zip(followups[:3], completed_times):
        completions.append({
            "completion_id": f"completion:{followup['alert_key']}", "alert_key": followup["alert_key"],
            "followup_id": followup["followup_id"], "review_id": followup["review_id"], "ticker": "GEV",
            "status": "completed_with_evidence", "completed_by": "research_analyst", "completed_at": completed_at,
            "completion_outcome": "evidence_review_completed", "evidence_summary": "Primary evidence reviewed.",
            "evidence_references": [{
                "evidence_id": f"workpaper:{followup['alert_key']}", "source_type": "internal_workpaper",
                "source_reference": "workspace/internal_notes/GEV.md", "limitation": "Operational completion evidence only.",
            }],
            "reviewed_followup_hash": followup_review_hash(followup),
            "completion_scope": "operational_review_only", "automatic_position_action_allowed": False,
        })
    key = f"{5:064x}"
    acknowledgements.append({
        "acknowledgement_id": f"ack:{key}", "alert_key": key,
        "review_id": "company-review:GEV:5", "ticker": "GEV",
        "status": "acknowledged_by_user_or_pm", "acknowledged_by": "pm_owner",
        "acknowledged_at": "2026-11-05T07:00:00+00:00", "note": "Follow-up required.",
    })
    return acknowledgements, followups, completions


class CompanyReviewAlertSlaSummaryTests(unittest.TestCase):
    def test_summary_reports_flow_backlog_and_available_metrics(self) -> None:
        acknowledgements, followups, completions = records()
        payload = build_company_review_alert_sla_summary(
            "2026-11-07", acknowledgements, followups, completions,
            observed_at="2026-11-07T12:00:00+00:00",
        )
        self.assertEqual(payload["flow_counts"]["completed_in_window"], 3)
        self.assertEqual(payload["flow_counts"]["completed_within_due_in_window"], 2)
        self.assertEqual(payload["flow_counts"]["completed_after_due_in_window"], 1)
        self.assertEqual(payload["current_backlog"]["acknowledged_without_assignment"], 1)
        self.assertEqual(payload["current_backlog"]["active_overdue_followups"], 1)
        self.assertEqual(payload["metrics"]["status"], "available")
        self.assertEqual(payload["metrics"]["completion_within_due_rate_pct"], 66.7)
        self.assertEqual(payload["metrics"]["median_assignment_hours"], 1.0)
        self.assertEqual(payload["metrics"]["median_completion_hours"], 23.0)
        self.assertEqual(len(payload["priority_followups"]), 2)

    def test_below_minimum_sample_hides_rate_and_duration_metrics(self) -> None:
        acknowledgements, followups, completions = records()
        payload = build_company_review_alert_sla_summary(
            "2026-11-07", acknowledgements, followups, completions[:2],
            observed_at="2026-11-07T12:00:00+00:00",
        )
        self.assertEqual(payload["metrics"]["status"], "insufficient_completion_sample")
        self.assertIsNone(payload["metrics"]["completion_within_due_rate_pct"])
        self.assertIsNone(payload["metrics"]["median_completion_hours"])

    def test_summary_rejects_tampering_and_broken_links(self) -> None:
        acknowledgements, followups, completions = records()
        broken = copy.deepcopy(completions)
        broken[0]["reviewed_followup_hash"] = "stale"
        with self.assertRaisesRegex(ValueError, "Completion hash"):
            build_company_review_alert_sla_summary("2026-11-07", acknowledgements, followups, broken)
        payload = build_company_review_alert_sla_summary("2026-11-07", acknowledgements, followups, completions)
        tampered = copy.deepcopy(payload)
        tampered["methodology"]["automatic_position_action_allowed"] = True
        with self.assertRaisesRegex(ValueError, "cannot send or execute"):
            validate_company_review_alert_sla_summary(tampered)


if __name__ == "__main__":
    unittest.main()
