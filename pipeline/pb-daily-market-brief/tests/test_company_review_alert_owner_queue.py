from __future__ import annotations

import copy
import unittest

from build_company_review_alert_owner_queue import (
    build_company_review_alert_owner_queue,
    validate_company_review_alert_owner_queue,
)
from test_company_review_alert_sla_summary import records


class CompanyReviewAlertOwnerQueueTests(unittest.TestCase):
    def test_queue_prioritizes_overdue_then_missing_then_open_and_groups_owner(self) -> None:
        acknowledgements, followups, completions = records()
        payload = build_company_review_alert_owner_queue(
            "2026-11-07", acknowledgements, followups, completions,
            observed_at="2026-11-07T12:00:00+00:00",
        )
        self.assertEqual(payload["unresolved_count"], 2)
        self.assertEqual(payload["critical_count"], 1)
        self.assertEqual(payload["high_count"], 1)
        self.assertEqual(payload["normal_count"], 0)
        self.assertEqual(payload["completed_excluded_count"], 3)
        self.assertEqual(payload["queue"][0]["queue_status"], "followup_overdue")
        self.assertEqual(payload["queue"][1]["queue_status"], "followup_assignment_missing")
        owners = {row["owner"]: row for row in payload["owner_summary"]}
        self.assertEqual(owners["research_analyst"]["critical_count"], 1)
        self.assertEqual(owners["unassigned"]["high_count"], 1)

    def test_queue_rejects_position_authority_and_unsorted_rows(self) -> None:
        acknowledgements, followups, completions = records()
        payload = build_company_review_alert_owner_queue("2026-11-07", acknowledgements, followups, completions)
        tampered = copy.deepcopy(payload)
        tampered["queue"][0]["automatic_position_action_allowed"] = True
        with self.assertRaisesRegex(ValueError, "send or execute"):
            validate_company_review_alert_owner_queue(tampered)
        tampered = copy.deepcopy(payload)
        tampered["queue"] = list(reversed(tampered["queue"]))
        with self.assertRaisesRegex(ValueError, "sorted"):
            validate_company_review_alert_owner_queue(tampered)


if __name__ == "__main__":
    unittest.main()
