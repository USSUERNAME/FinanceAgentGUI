from __future__ import annotations

import copy
import unittest

from build_company_review_alert_sla_summary import build_company_review_alert_sla_summary
from test_company_review_alert_sla_summary import records
from track_company_review_alert_sla_history import (
    update_company_review_alert_sla_history,
    validate_company_review_alert_sla_history,
    validate_company_review_alert_sla_trend,
)


def summary(report_date: str) -> dict:
    acknowledgements, followups, completions = records()
    return build_company_review_alert_sla_summary(
        report_date, acknowledgements, followups, completions,
        observed_at=f"{report_date}T12:00:00+00:00",
    )


class CompanyReviewAlertSlaHistoryTests(unittest.TestCase):
    def test_same_summary_is_idempotent_and_same_date_change_appends_revision(self) -> None:
        first = summary("2026-11-07")
        history, trend = update_company_review_alert_sla_history({}, first)
        self.assertEqual(len(history["snapshots"]), 1)
        self.assertEqual(trend["point_count"], 1)
        rerun, rerun_trend = update_company_review_alert_sla_history(history, first)
        self.assertEqual(rerun, history)
        self.assertEqual(rerun_trend["point_count"], 1)
        revised = copy.deepcopy(first)
        revised["current_backlog"]["active_overdue_followups"] = 2
        revised["observed_at"] = "2026-11-07T13:00:00+00:00"
        revised_history, revised_trend = update_company_review_alert_sla_history(history, revised)
        self.assertEqual(len(revised_history["snapshots"]), 2)
        self.assertEqual(revised_history["snapshots"][-1]["revision"], 2)
        self.assertEqual(revised_trend["point_count"], 1)

    def test_trend_uses_latest_date_revisions_and_discloses_rolling_windows(self) -> None:
        first = summary("2026-11-07")
        history, _ = update_company_review_alert_sla_history({}, first)
        second = summary("2026-11-08")
        second["current_backlog"]["acknowledged_without_assignment"] = 3
        second["current_backlog"]["active_overdue_followups"] = 2
        history, trend = update_company_review_alert_sla_history(history, second, trend_limit=8)
        self.assertEqual(trend["point_count"], 2)
        self.assertEqual(trend["latest_backlog_change"]["acknowledged_without_assignment_delta"], 2)
        self.assertEqual(trend["latest_backlog_change"]["active_overdue_followups_delta"], 1)
        self.assertTrue(trend["methodology"]["rolling_window_snapshots"])
        self.assertFalse(trend["methodology"]["independent_week_over_week_comparison"])

    def test_history_and_trend_reject_tampering(self) -> None:
        history, trend = update_company_review_alert_sla_history({}, summary("2026-11-07"))
        tampered = copy.deepcopy(history)
        tampered["snapshots"][0]["current_backlog"]["active_overdue_followups"] = 99
        with self.assertRaisesRegex(ValueError, "snapshot hash"):
            validate_company_review_alert_sla_history(tampered)
        tampered_trend = copy.deepcopy(trend)
        tampered_trend["methodology"]["independent_week_over_week_comparison"] = True
        with self.assertRaisesRegex(ValueError, "rolling-window"):
            validate_company_review_alert_sla_trend(tampered_trend)


if __name__ == "__main__":
    unittest.main()
