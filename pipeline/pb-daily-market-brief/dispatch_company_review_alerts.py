"""Plan and optionally deliver explicitly approved critical company-review alerts."""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
import os
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any, Callable
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from collectors.common import ROOT, load_dotenv
from monitor_company_review_operations import validate_company_review_operations_monitor

PLAN_SCHEMA_VERSION = "company_review_alert_delivery_plan.v1"
HISTORY_SCHEMA_VERSION = "company_review_alert_delivery_history.v1"
APPROVED_POLICY_STATUS = "approved_by_user_or_pm"
ACKNOWLEDGED_STATUS = "acknowledged_by_user_or_pm"
ENABLE_VARIABLE = "COMPANY_REVIEW_ALERTS_ENABLED"
ALLOWED_CRITICAL_REASONS = {
    "post_event_update_sla_missed_or_late",
    "approved_kill_criterion_matched",
}


def _aware_datetime(value: str) -> datetime:
    parsed = datetime.fromisoformat(value)
    if parsed.utcoffset() is None:
        raise ValueError("Alert timestamps must include a timezone offset")
    return parsed


def _empty_history() -> dict[str, Any]:
    return {"schema_version": HISTORY_SCHEMA_VERSION, "delivery_attempts": []}


def validate_delivery_policy_registry(policies: list[dict[str, Any]]) -> None:
    identities: set[tuple[str, int]] = set()
    for policy in policies:
        identity = (str(policy.get("policy_id") or ""), int(policy.get("version") or 0))
        if not identity[0] or identity[1] < 1 or identity in identities:
            raise ValueError("Delivery policies require unique policy ID and positive version")
        identities.add(identity)
        date.fromisoformat(str(policy.get("effective_from")))
        approval = policy.get("approval") or {}
        if approval.get("status") == APPROVED_POLICY_STATUS:
            if not approval.get("approved_by") or not approval.get("approval_note"):
                raise ValueError("Approved delivery policy requires approver identity and note")
            _aware_datetime(str(approval.get("approved_at")))
        if policy.get("channel") != "telegram":
            raise ValueError("Company review delivery policy only supports Telegram")
        if policy.get("minimum_alert_level") != "critical_review_required":
            raise ValueError("Delivery policy cannot lower the critical alert threshold")
        reasons = set(policy.get("allowed_escalation_reasons") or [])
        if not reasons or not reasons.issubset(ALLOWED_CRITICAL_REASONS):
            raise ValueError("Delivery policy contains an unapproved escalation reason")
        if policy.get("repeat_exact_alert") is not False:
            raise ValueError("Exact company review alerts cannot be repeated")
        if policy.get("environment_enable_variable") != ENABLE_VARIABLE:
            raise ValueError("Delivery policy must use the fixed activation switch")
        if policy.get("recipient_scope") != "configured_private_chat":
            raise ValueError("Delivery policy must remain scoped to the configured private chat")
        if policy.get("message_scope") != "operational_review_only":
            raise ValueError("Delivery policy cannot expand beyond operational review")
        if policy.get("automatic_position_action_allowed") is not False:
            raise ValueError("Delivery policy cannot authorize a position action")


def validate_acknowledgement_registry(acknowledgements: list[dict[str, Any]]) -> None:
    ids: set[str] = set()
    keys: set[str] = set()
    for row in acknowledgements:
        acknowledgement_id = str(row.get("acknowledgement_id") or "")
        alert_key = str(row.get("alert_key") or "")
        if not acknowledgement_id or acknowledgement_id in ids:
            raise ValueError("Acknowledgements require a unique stable identity")
        if len(alert_key) != 64 or any(character not in "0123456789abcdef" for character in alert_key):
            raise ValueError("Acknowledgement requires a valid alert key")
        if alert_key in keys:
            raise ValueError("An exact alert can be acknowledged only once")
        if row.get("status") != ACKNOWLEDGED_STATUS:
            raise ValueError("Acknowledgement must be explicit user or PM confirmation")
        if not row.get("review_id") or not row.get("ticker") or not row.get("acknowledged_by") or not row.get("note"):
            raise ValueError("Acknowledgement requires review identity, owner, and note")
        _aware_datetime(str(row.get("acknowledged_at")))
        if row.get("acknowledgement_scope", "operational_review_only") != "operational_review_only":
            raise ValueError("Acknowledgement cannot expand beyond operational review")
        if row.get("automatic_position_action_allowed", False) is not False:
            raise ValueError("Acknowledgement cannot authorize position action")
        ids.add(acknowledgement_id)
        keys.add(alert_key)


def validate_delivery_history(history: dict[str, Any]) -> None:
    if history.get("schema_version") != HISTORY_SCHEMA_VERSION:
        raise ValueError("Unexpected company review alert delivery history schema")
    attempt_ids: set[str] = set()
    for row in history.get("delivery_attempts", []):
        attempt_id = str(row.get("attempt_id") or "")
        if not attempt_id or attempt_id in attempt_ids:
            raise ValueError("Delivery history requires unique append-only attempt identities")
        if row.get("status") not in {"sent", "failed"}:
            raise ValueError("Delivery history contains an unsupported status")
        alert_key = str(row.get("alert_key") or "")
        if len(alert_key) != 64:
            raise ValueError("Delivery history requires a stable alert key")
        _aware_datetime(str(row.get("attempted_at")))
        if row.get("automatic_position_action_allowed") is not False:
            raise ValueError("Alert delivery history cannot authorize position action")
        attempt_ids.add(attempt_id)


def _approved_policy(policies: list[dict[str, Any]], report_date: str) -> dict[str, Any] | None:
    eligible = [
        policy for policy in policies
        if (policy.get("approval") or {}).get("status") == APPROVED_POLICY_STATUS
        and str(policy.get("effective_from")) <= report_date
    ]
    if not eligible:
        return None
    return max(eligible, key=lambda policy: (int(policy["version"]), str(policy["effective_from"])))


def company_review_alert_key(review: dict[str, Any]) -> str:
    material = {
        "review_id": review.get("review_id"),
        "ticker": review.get("ticker"),
        "event_date": review.get("event_date"),
        "alert_level": review.get("alert_level"),
        "escalation_reasons": sorted(review.get("escalation_reasons") or []),
        "prep_status": review.get("prep_status"),
        "sla_status": review.get("sla_status"),
        "sla_deadline": review.get("sla_deadline"),
    }
    encoded = json.dumps(material, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


def _alert_message(review: dict[str, Any], allowed_reasons: list[str]) -> str:
    reason_labels = {
        "post_event_update_sla_missed_or_late": "사후 업데이트 SLA 경과 또는 지연",
        "approved_kill_criterion_matched": "승인된 중단 조건 충족",
    }
    reasons = ", ".join(reason_labels[reason] for reason in allowed_reasons)
    return (
        f"[기업 검토 심각 경고] {review.get('ticker')}\n"
        f"이벤트: {review.get('event_name') or '자료 없음'} ({review.get('event_date')})\n"
        f"사유: {reasons}\n"
        f"검토 책임자: {review.get('escalation_owner') or '미지정'}\n"
        "범위: 운영 검토 요청이며 매수·매도·비중 변경 지시가 아닙니다."
    )


def plan_company_review_alerts(
    monitor: dict[str, Any], policies: list[dict[str, Any]],
    acknowledgements: list[dict[str, Any]], history: dict[str, Any],
    delivery_enabled: bool,
) -> dict[str, Any]:
    validate_company_review_operations_monitor(monitor)
    validate_delivery_policy_registry(policies)
    validate_acknowledgement_registry(acknowledgements)
    validate_delivery_history(history)
    policy = _approved_policy(policies, str(monitor["report_date"]))
    acknowledged = {str(row["alert_key"]) for row in acknowledgements}
    sent = {
        str(row["alert_key"]) for row in history.get("delivery_attempts", [])
        if row.get("status") == "sent"
    }
    candidates: list[dict[str, Any]] = []
    suppressions: list[dict[str, Any]] = []
    for review in monitor.get("reviews", []):
        alert_key = company_review_alert_key(review)
        reason = None
        allowed_reasons: list[str] = []
        if policy is None:
            reason = "no_approved_delivery_policy"
        elif review.get("alert_level") != "critical_review_required":
            reason = "below_approved_critical_threshold"
        else:
            policy_reasons = set(policy.get("allowed_escalation_reasons") or [])
            allowed_reasons = [
                value for value in review.get("escalation_reasons", []) if value in policy_reasons
            ]
            if not allowed_reasons:
                reason = "no_explicitly_allowed_critical_reason"
            elif alert_key in acknowledged:
                reason = "acknowledged_by_user_or_pm"
            elif alert_key in sent:
                reason = "exact_alert_already_sent"
        if reason:
            suppressions.append({
                "review_id": review.get("review_id"), "ticker": review.get("ticker"),
                "alert_key": alert_key, "reason": reason,
            })
            continue
        message = _alert_message(review, allowed_reasons)
        candidates.append({
            "review_id": review.get("review_id"), "ticker": review.get("ticker"),
            "event_date": review.get("event_date"), "alert_key": alert_key,
            "allowed_escalation_reasons": allowed_reasons, "message": message,
            "message_hash": hashlib.sha256(message.encode("utf-8")).hexdigest(),
            "delivery_status": "ready_to_send" if delivery_enabled else "ready_but_delivery_disabled",
            "automatic_position_action_allowed": False,
        })
    plan = {
        "schema_version": PLAN_SCHEMA_VERSION,
        "report_date": monitor["report_date"], "planned_at": monitor["observed_at"],
        "approved_policy_status": "approved_policy_applied" if policy else "no_approved_delivery_policy",
        "approved_policy_id": policy.get("policy_id") if policy else None,
        "approved_policy_version": policy.get("version") if policy else None,
        "delivery_enabled": bool(delivery_enabled),
        "candidate_count": len(candidates), "suppressed_count": len(suppressions),
        "sent_count": 0, "failed_count": 0,
        "candidates": candidates, "suppressions": suppressions,
        "methodology": {
            "approved_policy_required": True,
            "critical_alert_only": True,
            "explicit_reason_allowlist_required": True,
            "exact_alert_repeat_allowed": False,
            "user_or_pm_acknowledgement_suppresses_alert": True,
            "environment_activation_required": True,
            "automatic_position_action_allowed": False,
        },
        "posture": "approved_operational_notification_not_investment_action",
    }
    validate_delivery_plan(plan)
    return plan


def validate_delivery_plan(plan: dict[str, Any]) -> None:
    if plan.get("schema_version") != PLAN_SCHEMA_VERSION:
        raise ValueError("Unexpected company review alert delivery plan schema")
    if int(plan.get("candidate_count", -1)) != len(plan.get("candidates", [])):
        raise ValueError("Delivery plan candidate count does not match rows")
    if int(plan.get("suppressed_count", -1)) != len(plan.get("suppressions", [])):
        raise ValueError("Delivery plan suppression count does not match rows")
    keys: set[str] = set()
    for row in plan.get("candidates", []):
        key = str(row.get("alert_key") or "")
        if len(key) != 64 or key in keys:
            raise ValueError("Delivery plan requires unique stable alert keys")
        if row.get("automatic_position_action_allowed") is not False:
            raise ValueError("Delivery plan cannot authorize position action")
        keys.add(key)
    if (plan.get("methodology") or {}).get("automatic_position_action_allowed") is not False:
        raise ValueError("Delivery plan cannot authorize position action")


def _telegram_send(token: str, chat_id: str, message: str) -> None:
    body = json.dumps({
        "chat_id": chat_id, "text": message, "disable_web_page_preview": True,
    }).encode("utf-8")
    request = Request(
        f"https://api.telegram.org/bot{token}/sendMessage", method="POST", data=body,
        headers={"Content-Type": "application/json"},
    )
    try:
        with urlopen(request, timeout=30) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except (HTTPError, URLError) as exc:
        raise RuntimeError(f"Telegram request failed ({type(exc).__name__})") from exc
    if not payload.get("ok"):
        raise RuntimeError("Telegram did not accept the company review alert")


def dispatch_company_review_alerts(
    monitor: dict[str, Any], policies: list[dict[str, Any]],
    acknowledgements: list[dict[str, Any]], history: dict[str, Any] | None = None,
    *, delivery_enabled: bool = False, token: str = "", chat_id: str = "",
    sender: Callable[[str, str, str], None] = _telegram_send,
    attempted_at: str | None = None,
) -> tuple[dict[str, Any], dict[str, Any]]:
    history_copy = copy.deepcopy(history or _empty_history())
    plan = plan_company_review_alerts(
        monitor, policies, acknowledgements, history_copy, delivery_enabled,
    )
    if not delivery_enabled or not plan["candidates"]:
        return plan, history_copy
    if plan["approved_policy_status"] != "approved_policy_applied":
        raise ValueError("External alert delivery requires an approved policy")
    if not token or not chat_id:
        raise ValueError("External alert delivery requires Telegram credentials")
    now = _aware_datetime(attempted_at or datetime.now(timezone.utc).isoformat()).isoformat()
    for index, candidate in enumerate(plan["candidates"], start=1):
        status = "sent"
        error_type = None
        try:
            sender(token, chat_id, str(candidate["message"]))
        except Exception as exc:  # delivery failures must be recorded without leaking credentials
            status = "failed"
            error_type = type(exc).__name__
        history_copy["delivery_attempts"].append({
            "attempt_id": f"attempt:{candidate['alert_key']}:{now}:{index}",
            "alert_key": candidate["alert_key"], "review_id": candidate["review_id"],
            "ticker": candidate["ticker"], "policy_id": plan["approved_policy_id"],
            "policy_version": plan["approved_policy_version"], "attempted_at": now,
            "status": status, "error_type": error_type,
            "message_hash": candidate["message_hash"],
            "automatic_position_action_allowed": False,
        })
        candidate["delivery_status"] = status
        plan[f"{status}_count"] += 1
    validate_delivery_history(history_copy)
    validate_delivery_plan(plan)
    return plan, history_copy


def _atomic_write(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    temporary.replace(path)


def main() -> None:
    parser = argparse.ArgumentParser(description="Plan and optionally dispatch approved company review alerts")
    parser.add_argument("--date", required=True)
    parser.add_argument("--monitor-file")
    parser.add_argument("--policy-registry-file")
    parser.add_argument("--acknowledgement-registry-file")
    parser.add_argument("--history-file")
    parser.add_argument("--output-file")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    load_dotenv()
    monitor_path = Path(args.monitor_file) if args.monitor_file else ROOT / "workspace" / "company_review_operations_monitor" / args.date / "company_review_operations_monitor.json"
    policy_path = Path(args.policy_registry_file) if args.policy_registry_file else ROOT / "company_review_alert_delivery_policy_registry.json"
    acknowledgement_path = Path(args.acknowledgement_registry_file) if args.acknowledgement_registry_file else ROOT / "company_review_alert_acknowledgement_registry.json"
    history_path = Path(args.history_file) if args.history_file else ROOT / "workspace" / "history" / "company_review_alert_delivery_history.json"
    output_path = Path(args.output_file) if args.output_file else ROOT / "workspace" / "company_review_alert_delivery_plans" / args.date / "company_review_alert_delivery_plan.json"
    for label, path in (("monitor", monitor_path), ("policy registry", policy_path), ("acknowledgement registry", acknowledgement_path)):
        if not path.exists():
            raise SystemExit(f"Company review alert {label} does not exist: {path}")
    monitor = json.loads(monitor_path.read_text(encoding="utf-8"))
    policies = json.loads(policy_path.read_text(encoding="utf-8"))
    acknowledgements = json.loads(acknowledgement_path.read_text(encoding="utf-8"))
    history = json.loads(history_path.read_text(encoding="utf-8")) if history_path.exists() else _empty_history()
    enabled = os.getenv(ENABLE_VARIABLE, "").strip().lower() in {"1", "true", "yes", "on"}
    if args.dry_run:
        enabled = False
    plan, updated_history = dispatch_company_review_alerts(
        monitor, policies, acknowledgements, history,
        delivery_enabled=enabled,
        token=os.getenv("TELEGRAM_BOT_TOKEN", "").strip(),
        chat_id=os.getenv("TELEGRAM_CHAT_ID", "").strip(),
    )
    _atomic_write(output_path, plan)
    if updated_history != history:
        _atomic_write(history_path, updated_history)
    print(f"Company review alert plan saved: {output_path.relative_to(ROOT)}")
    print(
        f"Candidates: {plan['candidate_count']} · sent: {plan['sent_count']} · "
        f"failed: {plan['failed_count']} · suppressed: {plan['suppressed_count']}"
    )
    if plan["failed_count"]:
        raise SystemExit("One or more approved company review alerts failed to send")


if __name__ == "__main__":
    main()
