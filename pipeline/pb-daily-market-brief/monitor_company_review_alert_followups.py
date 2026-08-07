"""Monitor open assignments for acknowledged company-review alerts."""

from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from assign_company_review_alert_followup import validate_followup_registry
from collectors.common import ROOT
from complete_company_review_alert_followup import validate_completion_registry
from dispatch_company_review_alerts import validate_acknowledgement_registry

SCHEMA_VERSION = "company_review_alert_followup_monitor.v1"


def _aware_datetime(value: str) -> datetime:
    parsed = datetime.fromisoformat(value)
    if parsed.utcoffset() is None:
        raise ValueError("Follow-up monitor timestamps must include a timezone offset")
    return parsed


def monitor_company_review_alert_followups(
    report_date: str, acknowledgements: list[dict[str, Any]], followups: list[dict[str, Any]],
    completions: list[dict[str, Any]] | None = None, observed_at: str | None = None,
) -> dict[str, Any]:
    validate_acknowledgement_registry(acknowledgements)
    validate_followup_registry(followups)
    completion_rows = completions or []
    validate_completion_registry(completion_rows)
    now = _aware_datetime(observed_at or datetime.now(timezone.utc).isoformat())
    by_key = {str(row["alert_key"]): row for row in followups}
    completed_by_key = {str(row["alert_key"]): row for row in completion_rows}
    for completion in completion_rows:
        followup = by_key.get(str(completion["alert_key"]))
        if followup is None:
            raise ValueError("Follow-up completion must reference an assigned follow-up")
        if any(completion.get(field) != followup.get(field) for field in ("followup_id", "review_id", "ticker")):
            raise ValueError("Follow-up completion identity does not match the assigned follow-up")
        if completion.get("reviewed_followup_hash") != _followup_hash(followup):
            raise ValueError("Follow-up completion hash does not match the assigned follow-up")
    rows: list[dict[str, Any]] = []
    for acknowledgement in acknowledgements:
        followup = by_key.get(str(acknowledgement["alert_key"]))
        completion = completed_by_key.get(str(acknowledgement["alert_key"]))
        if followup is None:
            status = "acknowledged_followup_assignment_missing"
            alert_level = "attention_required"
            reason = "acknowledged_alert_without_followup_assignment"
            owner = None
            due_at = None
            completion_criteria = None
            completion_record = None
        elif completion is not None:
            due_at = followup["due_at"]
            owner = followup["owner"]
            completion_criteria = followup["completion_criteria"]
            completed_at = _aware_datetime(str(completion["completed_at"]))
            if completed_at > _aware_datetime(str(due_at)):
                status = "assigned_followup_completed_after_due"
            else:
                status = "assigned_followup_completed"
            alert_level = "normal"
            reason = None
            completion_record = completion
        else:
            due_at = followup["due_at"]
            owner = followup["owner"]
            completion_criteria = followup["completion_criteria"]
            if now > _aware_datetime(str(due_at)):
                status = "assigned_followup_overdue"
                alert_level = "critical_review_required"
                reason = "acknowledged_alert_followup_due_date_missed"
            else:
                status = "assigned_followup_open"
                alert_level = "normal"
                reason = None
            completion_record = None
        rows.append({
            "alert_key": acknowledgement["alert_key"], "review_id": acknowledgement["review_id"],
            "ticker": acknowledgement["ticker"], "acknowledged_by": acknowledgement["acknowledged_by"],
            "acknowledged_at": acknowledgement["acknowledged_at"],
            "status": status, "alert_level": alert_level, "escalation_reason": reason,
            "owner": owner, "due_at": due_at, "completion_criteria": completion_criteria,
            "completed_by": (completion_record or {}).get("completed_by"),
            "completed_at": (completion_record or {}).get("completed_at"),
            "completion_outcome": (completion_record or {}).get("completion_outcome"),
            "completion_evidence_count": len((completion_record or {}).get("evidence_references") or []),
            "security_thesis_readiness": "not_decision_grade", "position_action": "wait_for_proof",
            "automatic_notification_sent": False, "automatic_position_action_allowed": False,
        })
    payload = {
        "schema_version": SCHEMA_VERSION, "report_date": report_date,
        "observed_at": now.isoformat(), "followup_count": len(rows),
        "missing_assignment_count": sum(row["status"] == "acknowledged_followup_assignment_missing" for row in rows),
        "overdue_count": sum(row["status"] == "assigned_followup_overdue" for row in rows),
        "completed_count": sum(row["status"] in {"assigned_followup_completed", "assigned_followup_completed_after_due"} for row in rows),
        "completed_after_due_count": sum(row["status"] == "assigned_followup_completed_after_due" for row in rows),
        "rows": rows,
        "methodology": {
            "acknowledgement_requires_followup_assignment": True,
            "overdue_followup_reopens_internal_review": True,
            "completion_requires_evidence": True,
            "automatic_notification_sent": False,
            "automatic_position_action_allowed": False,
        },
        "posture": "operational_followup_monitor_not_investment_action",
    }
    validate_company_review_alert_followup_monitor(payload)
    return payload


def _followup_hash(followup: dict[str, Any]) -> str:
    from complete_company_review_alert_followup import followup_review_hash
    return followup_review_hash(followup)


def validate_company_review_alert_followup_monitor(payload: dict[str, Any]) -> None:
    if payload.get("schema_version") != SCHEMA_VERSION:
        raise ValueError("Unexpected company review follow-up monitor schema")
    rows = payload.get("rows", [])
    if int(payload.get("followup_count", -1)) != len(rows):
        raise ValueError("Follow-up monitor count does not match rows")
    if int(payload.get("missing_assignment_count", -1)) != sum(
        row.get("status") == "acknowledged_followup_assignment_missing" for row in rows
    ):
        raise ValueError("Follow-up monitor missing-assignment count does not match rows")
    if int(payload.get("overdue_count", -1)) != sum(
        row.get("status") == "assigned_followup_overdue" for row in rows
    ):
        raise ValueError("Follow-up monitor overdue count does not match rows")
    if int(payload.get("completed_count", -1)) != sum(
        row.get("status") in {"assigned_followup_completed", "assigned_followup_completed_after_due"} for row in rows
    ):
        raise ValueError("Follow-up monitor completion count does not match rows")
    if int(payload.get("completed_after_due_count", -1)) != sum(
        row.get("status") == "assigned_followup_completed_after_due" for row in rows
    ):
        raise ValueError("Follow-up monitor late-completion count does not match rows")
    _aware_datetime(str(payload["observed_at"]))
    keys: set[str] = set()
    for row in rows:
        key = str(row.get("alert_key") or "")
        if len(key) != 64 or key in keys:
            raise ValueError("Follow-up monitor requires unique alert keys")
        if row.get("security_thesis_readiness") != "not_decision_grade" or row.get("position_action") != "wait_for_proof":
            raise ValueError("Follow-up monitor cannot promote security readiness or position action")
        if row.get("automatic_notification_sent") is not False or row.get("automatic_position_action_allowed") is not False:
            raise ValueError("Follow-up monitor cannot send or execute unapproved actions")
        keys.add(key)


def _atomic_write(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    temporary.replace(path)


def main() -> None:
    parser = argparse.ArgumentParser(description="Monitor assigned follow-ups for acknowledged company review alerts")
    parser.add_argument("--date", required=True)
    parser.add_argument("--acknowledgement-registry-file")
    parser.add_argument("--followup-registry-file")
    parser.add_argument("--completion-registry-file")
    parser.add_argument("--output-file")
    args = parser.parse_args()
    acknowledgement_path = Path(args.acknowledgement_registry_file) if args.acknowledgement_registry_file else ROOT / "company_review_alert_acknowledgement_registry.json"
    followup_path = Path(args.followup_registry_file) if args.followup_registry_file else ROOT / "company_review_alert_followup_registry.json"
    completion_path = Path(args.completion_registry_file) if args.completion_registry_file else ROOT / "company_review_alert_followup_completion_registry.json"
    for label, path in (("acknowledgement registry", acknowledgement_path), ("follow-up registry", followup_path), ("completion registry", completion_path)):
        if not path.exists():
            raise SystemExit(f"Company review alert {label} does not exist: {path}")
    payload = monitor_company_review_alert_followups(
        args.date,
        json.loads(acknowledgement_path.read_text(encoding="utf-8")),
        json.loads(followup_path.read_text(encoding="utf-8")),
        json.loads(completion_path.read_text(encoding="utf-8")),
    )
    output = Path(args.output_file) if args.output_file else ROOT / "workspace" / "company_review_alert_followup_monitor" / args.date / "company_review_alert_followup_monitor.json"
    _atomic_write(output, payload)
    print(f"Company review alert follow-up monitor saved: {output.relative_to(ROOT)}")
    print(f"Missing assignment: {payload['missing_assignment_count']} · overdue: {payload['overdue_count']}")


if __name__ == "__main__":
    main()
