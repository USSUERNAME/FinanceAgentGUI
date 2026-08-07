from __future__ import annotations

import copy
import unittest

from dispatch_company_review_alerts import (
    company_review_alert_key,
    dispatch_company_review_alerts,
    plan_company_review_alerts,
    validate_acknowledgement_registry,
    validate_delivery_policy_registry,
)


def monitor(level: str = "critical_review_required", reasons: list[str] | None = None) -> dict:
    reasons = reasons if reasons is not None else ["post_event_update_sla_missed_or_late"]
    row = {
        "review_id": "company-review:GEV:2026-10-30", "ticker": "GEV",
        "company_name": "GE Vernova", "event_name": "Q3 earnings review",
        "event_date": "2026-10-30", "operating_config_version": 1,
        "prep_owner": "research_analyst", "prep_due_date": "2026-10-25",
        "prep_status": "completed_on_time", "prep_first_observed_at": "2026-10-25T08:00:00+00:00",
        "post_event_sla_rule": {"value": 24, "unit": "hours"},
        "sla_clock_started_at": "2026-10-30T12:00:00+00:00",
        "sla_deadline": "2026-10-31T12:00:00+00:00",
        "sla_status": "sla_breached_update_unconfirmed",
        "formal_update_first_observed_at": None,
        "escalation_reasons": reasons, "alert_level": level,
        "escalation_owner": "portfolio_manager", "company_thesis_status": "intact",
        "security_thesis_readiness": "not_decision_grade", "position_action": "wait_for_proof",
        "automatic_notification_sent": False, "automatic_position_action_allowed": False,
    }
    return {
        "schema_version": "company_review_operations_monitor.v1",
        "report_date": "2026-10-31", "observed_at": "2026-10-31T13:00:00+00:00",
        "monitored_review_count": 1,
        "attention_count": int(level == "attention_required"),
        "critical_count": int(level == "critical_review_required"),
        "reviews": [row],
        "methodology": {
            "automatic_notification_sent": False,
            "automatic_position_action_allowed": False,
        },
        "posture": "operational_review_alert_not_investment_action",
    }


def approved_policy() -> dict:
    return {
        "policy_id": "company-review-critical-telegram", "version": 1,
        "effective_from": "2026-07-21",
        "approval": {
            "status": "approved_by_user_or_pm", "approved_by": "pm_owner",
            "approved_at": "2026-07-21T09:00:00+09:00",
            "approval_note": "Critical operational exceptions may be sent to the private chat.",
        },
        "channel": "telegram", "minimum_alert_level": "critical_review_required",
        "allowed_escalation_reasons": [
            "post_event_update_sla_missed_or_late", "approved_kill_criterion_matched",
        ],
        "repeat_exact_alert": False, "recipient_scope": "configured_private_chat",
        "environment_enable_variable": "COMPANY_REVIEW_ALERTS_ENABLED",
        "message_scope": "operational_review_only",
        "automatic_position_action_allowed": False,
    }


def empty_history() -> dict:
    return {"schema_version": "company_review_alert_delivery_history.v1", "delivery_attempts": []}


class CompanyReviewAlertDispatchTests(unittest.TestCase):
    def test_without_approved_policy_every_alert_is_suppressed(self) -> None:
        plan = plan_company_review_alerts(monitor(), [], [], empty_history(), False)
        self.assertEqual(plan["candidate_count"], 0)
        self.assertEqual(plan["suppressions"][0]["reason"], "no_approved_delivery_policy")
        self.assertFalse(plan["delivery_enabled"])

    def test_approved_critical_reason_becomes_disabled_candidate(self) -> None:
        plan = plan_company_review_alerts(monitor(), [approved_policy()], [], empty_history(), False)
        self.assertEqual(plan["candidate_count"], 1)
        self.assertEqual(plan["candidates"][0]["delivery_status"], "ready_but_delivery_disabled")
        self.assertIn("매수·매도·비중 변경 지시가 아닙니다", plan["candidates"][0]["message"])

    def test_attention_and_unlisted_reason_never_deliver(self) -> None:
        attention = plan_company_review_alerts(
            monitor("attention_required", ["pre_event_preparation_due_date_missed_or_late"]),
            [approved_policy()], [], empty_history(), True,
        )
        self.assertEqual(attention["suppressions"][0]["reason"], "below_approved_critical_threshold")
        unlisted = plan_company_review_alerts(
            monitor("critical_review_required", ["required_primary_evidence_unavailable_after_event"]),
            [approved_policy()], [], empty_history(), True,
        )
        self.assertEqual(unlisted["suppressions"][0]["reason"], "no_explicitly_allowed_critical_reason")

    def test_sent_exact_alert_is_not_repeated(self) -> None:
        calls: list[str] = []
        first, history = dispatch_company_review_alerts(
            monitor(), [approved_policy()], [], empty_history(), delivery_enabled=True,
            token="test-token", chat_id="test-chat",
            sender=lambda _token, _chat, message: calls.append(message),
            attempted_at="2026-10-31T13:01:00+00:00",
        )
        self.assertEqual(first["sent_count"], 1)
        second, rerun_history = dispatch_company_review_alerts(
            monitor(), [approved_policy()], [], history, delivery_enabled=True,
            token="test-token", chat_id="test-chat", sender=lambda *_args: calls.append("repeat"),
            attempted_at="2026-10-31T14:01:00+00:00",
        )
        self.assertEqual(second["candidate_count"], 0)
        self.assertEqual(second["suppressions"][0]["reason"], "exact_alert_already_sent")
        self.assertEqual(rerun_history, history)
        self.assertEqual(len(calls), 1)

    def test_acknowledgement_suppresses_exact_alert(self) -> None:
        payload = monitor()
        key = company_review_alert_key(payload["reviews"][0])
        acknowledgement = {
            "acknowledgement_id": "ack:gev:q3", "alert_key": key,
            "review_id": payload["reviews"][0]["review_id"], "ticker": "GEV",
            "status": "acknowledged_by_user_or_pm", "acknowledged_by": "pm_owner",
            "acknowledged_at": "2026-10-31T13:05:00+00:00", "note": "Follow-up assigned.",
        }
        plan = plan_company_review_alerts(payload, [approved_policy()], [acknowledgement], empty_history(), True)
        self.assertEqual(plan["candidate_count"], 0)
        self.assertEqual(plan["suppressions"][0]["reason"], "acknowledged_by_user_or_pm")

    def test_enabled_delivery_requires_credentials(self) -> None:
        with self.assertRaisesRegex(ValueError, "credentials"):
            dispatch_company_review_alerts(
                monitor(), [approved_policy()], [], empty_history(), delivery_enabled=True,
            )

    def test_failed_delivery_is_recorded_without_secret_details(self) -> None:
        def fail(*_args: str) -> None:
            raise RuntimeError("secret-bearing provider response")

        plan, history = dispatch_company_review_alerts(
            monitor(), [approved_policy()], [], empty_history(), delivery_enabled=True,
            token="secret-token", chat_id="secret-chat", sender=fail,
            attempted_at="2026-10-31T13:01:00+00:00",
        )
        self.assertEqual(plan["failed_count"], 1)
        self.assertEqual(history["delivery_attempts"][0]["error_type"], "RuntimeError")
        self.assertNotIn("secret", str(history))

    def test_policy_and_acknowledgement_validators_reject_authority_or_tampering(self) -> None:
        policy = copy.deepcopy(approved_policy())
        policy["automatic_position_action_allowed"] = True
        with self.assertRaisesRegex(ValueError, "position action"):
            validate_delivery_policy_registry([policy])
        invalid_ack = [{
            "acknowledgement_id": "ack:bad", "alert_key": "not-a-hash",
            "review_id": "review", "ticker": "GEV", "status": "acknowledged_by_user_or_pm",
            "acknowledged_by": "pm", "acknowledged_at": "2026-10-31T13:00:00+00:00",
            "note": "Reviewed.",
        }]
        with self.assertRaisesRegex(ValueError, "valid alert key"):
            validate_acknowledgement_registry(invalid_ack)


if __name__ == "__main__":
    unittest.main()
