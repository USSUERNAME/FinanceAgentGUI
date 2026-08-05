from __future__ import annotations

import copy
import unittest

from build_company_earnings_scenarios import build_company_earnings_scenarios
from build_company_thesis_review_calendar import build_company_thesis_review_calendar
from build_company_thesis_update import build_company_thesis_update
from collect_company_earnings_results import collect_company_earnings_results
from monitor_company_review_operations import (
    monitor_company_review_operations,
    validate_company_review_operations_monitor,
)
from test_company_earnings_results import scenario_payload, verified_result
from test_company_earnings_scenarios import ready_review
from test_company_review_operating_config import collected_config
from test_company_thesis_review_calendar import confirmed_events
from test_company_thesis_update import deep_dive, registry


def calendar(event_date: str = "2026-10-30") -> dict:
    events = confirmed_events()
    events["companies"][0]["selected_event"]["event_date"] = event_date
    events["companies"][0]["selected_event"]["event_id"] = "gev-2026q3"
    return build_company_thesis_review_calendar(
        "2026-10-20", registry(), events, {"updates": []}, collected_config(),
    )


def empty_scenarios(report_date: str) -> dict:
    return build_company_earnings_scenarios(report_date, {"reviews": []})


def no_results(report_date: str) -> dict:
    return collect_company_earnings_results(report_date, empty_scenarios(report_date), [])


def no_formal_update(report_date: str) -> dict:
    return build_company_thesis_update(report_date, registry(), {"reviews": []})


class CompanyReviewOperationsMonitorTests(unittest.TestCase):
    def test_pre_event_pack_observed_by_due_date_is_on_time(self) -> None:
        scenarios = build_company_earnings_scenarios("2026-10-25", ready_review())
        payload, history = monitor_company_review_operations(
            "2026-10-25", calendar(), scenarios, no_results("2026-10-25"),
            no_formal_update("2026-10-25"), observed_at="2026-10-25T08:00:00+00:00",
        )
        review = payload["reviews"][0]
        self.assertEqual(review["prep_status"], "completed_on_time")
        self.assertEqual(review["sla_status"], "clock_not_started_waiting_verified_primary_results")
        self.assertEqual(review["alert_level"], "normal")
        self.assertEqual(len(history["milestones"]), 1)

    def test_missing_prep_after_due_date_requires_attention(self) -> None:
        payload, _ = monitor_company_review_operations(
            "2026-10-26", calendar(), empty_scenarios("2026-10-26"), no_results("2026-10-26"),
            no_formal_update("2026-10-26"), observed_at="2026-10-26T08:00:00+00:00",
        )
        review = payload["reviews"][0]
        self.assertEqual(review["prep_status"], "overdue_unconfirmed")
        self.assertIn("pre_event_preparation_due_date_missed_or_late", review["escalation_reasons"])
        self.assertEqual(review["alert_level"], "attention_required")

    def test_verified_result_starts_clock_and_missing_update_breaches_sla(self) -> None:
        results = collect_company_earnings_results("2026-10-30", scenario_payload(), [verified_result()])
        first, history = monitor_company_review_operations(
            "2026-10-30", calendar(), scenario_payload(), results,
            no_formal_update("2026-10-30"), observed_at="2026-10-30T12:00:00+00:00",
        )
        self.assertEqual(first["reviews"][0]["sla_status"], "sla_active")
        second, _ = monitor_company_review_operations(
            "2026-10-31", calendar(), scenario_payload(), results,
            no_formal_update("2026-10-31"), history,
            observed_at="2026-10-31T13:00:00+00:00",
        )
        review = second["reviews"][0]
        self.assertEqual(review["sla_status"], "sla_breached_update_unconfirmed")
        self.assertEqual(review["alert_level"], "critical_review_required")

    def test_formal_update_observed_with_result_completes_within_sla(self) -> None:
        results = collect_company_earnings_results("2026-10-31", scenario_payload(), [verified_result()])
        formal = build_company_thesis_update("2026-10-31", registry(), deep_dive())
        payload, history = monitor_company_review_operations(
            "2026-10-31", calendar(), scenario_payload(), results, formal,
            observed_at="2026-10-31T08:00:00+00:00",
        )
        review = payload["reviews"][0]
        self.assertEqual(review["sla_status"], "completed_within_sla")
        self.assertIsNotNone(review["formal_update_first_observed_at"])
        self.assertEqual(len(history["milestones"]), 3)

    def test_event_date_change_and_broken_thesis_trigger_escalation(self) -> None:
        _, history = monitor_company_review_operations(
            "2026-10-24", calendar(), empty_scenarios("2026-10-24"), no_results("2026-10-24"),
            no_formal_update("2026-10-24"), observed_at="2026-10-24T08:00:00+00:00",
        )
        formal = build_company_thesis_update("2026-10-25", registry(), deep_dive())
        formal["updates"][0]["company_thesis_status"] = "broken"
        payload, _ = monitor_company_review_operations(
            "2026-10-25", calendar("2026-10-31"), empty_scenarios("2026-10-25"),
            no_results("2026-10-25"), formal, history,
            observed_at="2026-10-25T08:00:00+00:00",
        )
        reasons = payload["reviews"][0]["escalation_reasons"]
        self.assertIn("confirmed_event_date_changed", reasons)
        self.assertIn("approved_kill_criterion_matched", reasons)
        self.assertEqual(payload["reviews"][0]["alert_level"], "critical_review_required")

    def test_same_observation_is_idempotent(self) -> None:
        inputs = (
            "2026-10-25", calendar(), build_company_earnings_scenarios("2026-10-25", ready_review()),
            no_results("2026-10-25"), no_formal_update("2026-10-25"),
        )
        _, history = monitor_company_review_operations(*inputs, observed_at="2026-10-25T08:00:00+00:00")
        _, rerun = monitor_company_review_operations(*inputs, history, observed_at="2026-10-25T08:00:00+00:00")
        self.assertEqual(rerun, history)

    def test_validator_blocks_false_notification_or_position_action(self) -> None:
        payload, _ = monitor_company_review_operations(
            "2026-10-26", calendar(), empty_scenarios("2026-10-26"), no_results("2026-10-26"),
            no_formal_update("2026-10-26"), observed_at="2026-10-26T08:00:00+00:00",
        )
        tampered = copy.deepcopy(payload)
        tampered["reviews"][0]["automatic_notification_sent"] = True
        with self.assertRaisesRegex(ValueError, "send or execute"):
            validate_company_review_operations_monitor(tampered)
        tampered = copy.deepcopy(payload)
        tampered["reviews"][0]["position_action"] = "sell"
        with self.assertRaisesRegex(ValueError, "position action"):
            validate_company_review_operations_monitor(tampered)


if __name__ == "__main__":
    unittest.main()
