"""Build a deterministic weekly operational SLA summary for company-review alerts."""

from __future__ import annotations

import argparse
import json
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from statistics import median
from typing import Any

from acknowledge_company_review_alert import _aware_datetime as acknowledgement_datetime
from assign_company_review_alert_followup import acknowledgement_review_hash, validate_followup_registry
from collectors.common import ROOT
from complete_company_review_alert_followup import followup_review_hash, validate_completion_registry
from dispatch_company_review_alerts import validate_acknowledgement_registry

SCHEMA_VERSION = "company_review_alert_weekly_sla_summary.v1"
MINIMUM_COMPLETION_SAMPLE = 3


def _aware_datetime(value: str) -> datetime:
    parsed = datetime.fromisoformat(value)
    if parsed.utcoffset() is None:
        raise ValueError("SLA summary timestamps must include a timezone offset")
    return parsed


def _in_window(value: str, start: date, end: date) -> bool:
    observed_day = _aware_datetime(value).date()
    return start <= observed_day <= end


def _validate_relationships(
    acknowledgements: list[dict[str, Any]], followups: list[dict[str, Any]],
    completions: list[dict[str, Any]],
) -> None:
    acknowledgment_by_key = {str(row["alert_key"]): row for row in acknowledgements}
    followup_by_key = {str(row["alert_key"]): row for row in followups}
    for followup in followups:
        acknowledgement = acknowledgment_by_key.get(str(followup["alert_key"]))
        if acknowledgement is None:
            raise ValueError("Follow-up must reference an acknowledged alert")
        if any(followup.get(field) != acknowledgement.get(field) for field in ("review_id", "ticker")):
            raise ValueError("Follow-up identity does not match its acknowledgement")
        if followup.get("acknowledgement_review_hash") != acknowledgement_review_hash(acknowledgement):
            raise ValueError("Follow-up hash does not match its acknowledgement")
    for completion in completions:
        followup = followup_by_key.get(str(completion["alert_key"]))
        if followup is None:
            raise ValueError("Completion must reference an assigned follow-up")
        if any(completion.get(field) != followup.get(field) for field in ("followup_id", "review_id", "ticker")):
            raise ValueError("Completion identity does not match its follow-up")
        if completion.get("reviewed_followup_hash") != followup_review_hash(followup):
            raise ValueError("Completion hash does not match its follow-up")


def build_company_review_alert_sla_summary(
    report_date: str, acknowledgements: list[dict[str, Any]], followups: list[dict[str, Any]],
    completions: list[dict[str, Any]], *, lookback_days: int = 7,
    observed_at: str | None = None,
) -> dict[str, Any]:
    if lookback_days < 1:
        raise ValueError("SLA summary lookback must be at least one day")
    validate_acknowledgement_registry(acknowledgements)
    validate_followup_registry(followups)
    validate_completion_registry(completions)
    _validate_relationships(acknowledgements, followups, completions)
    now = _aware_datetime(observed_at or datetime.now(timezone.utc).isoformat())
    end = date.fromisoformat(report_date)
    start = end - timedelta(days=lookback_days - 1)
    followup_by_key = {str(row["alert_key"]): row for row in followups}
    completion_by_key = {str(row["alert_key"]): row for row in completions}
    completed_in_window = [row for row in completions if _in_window(str(row["completed_at"]), start, end)]
    assigned_in_window = [row for row in followups if _in_window(str(row["assigned_at"]), start, end)]
    acknowledged_in_window = [row for row in acknowledgements if _in_window(str(row["acknowledged_at"]), start, end)]
    active_open = [
        followup for key, followup in followup_by_key.items()
        if key not in completion_by_key
    ]
    overdue_open = [
        row for row in active_open if now > _aware_datetime(str(row["due_at"]))
    ]
    missing_assignment = [
        acknowledgement for acknowledgement in acknowledgements
        if str(acknowledgement["alert_key"]) not in followup_by_key
    ]
    completed_within_due = [
        row for row in completed_in_window
        if _aware_datetime(str(row["completed_at"])) <= _aware_datetime(str(followup_by_key[str(row["alert_key"])]["due_at"]))
    ]
    completed_after_due = [row for row in completed_in_window if row not in completed_within_due]
    assignment_hours = [
        (_aware_datetime(str(row["assigned_at"])) - acknowledgement_datetime(str(next(
            acknowledgement for acknowledgement in acknowledgements if acknowledgement["alert_key"] == row["alert_key"]
        )["acknowledged_at"]))).total_seconds() / 3600
        for row in assigned_in_window
    ]
    completion_hours = [
        (_aware_datetime(str(row["completed_at"])) - _aware_datetime(str(followup_by_key[str(row["alert_key"])]["assigned_at"]))).total_seconds() / 3600
        for row in completed_in_window
    ]
    metrics_available = len(completed_in_window) >= MINIMUM_COMPLETION_SAMPLE
    priority_rows = [
        {
            "alert_key": row["alert_key"], "ticker": row["ticker"],
            "status": "acknowledged_followup_assignment_missing", "owner": None,
            "due_at": None, "reason": "acknowledged_alert_without_followup_assignment",
        }
        for row in missing_assignment
    ] + [
        {
            "alert_key": row["alert_key"], "ticker": row["ticker"],
            "status": "assigned_followup_overdue", "owner": row["owner"],
            "due_at": row["due_at"], "reason": "acknowledged_alert_followup_due_date_missed",
        }
        for row in overdue_open
    ]
    payload = {
        "schema_version": SCHEMA_VERSION, "report_date": report_date,
        "observed_at": now.isoformat(), "window": {
            "start_date": start.isoformat(), "end_date": end.isoformat(), "lookback_days": lookback_days,
        },
        "flow_counts": {
            "acknowledged_in_window": len(acknowledged_in_window),
            "assigned_in_window": len(assigned_in_window),
            "completed_in_window": len(completed_in_window),
            "completed_within_due_in_window": len(completed_within_due),
            "completed_after_due_in_window": len(completed_after_due),
        },
        "current_backlog": {
            "acknowledged_without_assignment": len(missing_assignment),
            "active_open_followups": len(active_open), "active_overdue_followups": len(overdue_open),
        },
        "metrics": {
            "minimum_completion_sample": MINIMUM_COMPLETION_SAMPLE,
            "status": "available" if metrics_available else "insufficient_completion_sample",
            "completion_within_due_rate_pct": round(100 * len(completed_within_due) / len(completed_in_window), 1) if metrics_available else None,
            "median_assignment_hours": round(median(assignment_hours), 1) if metrics_available and assignment_hours else None,
            "median_completion_hours": round(median(completion_hours), 1) if metrics_available and completion_hours else None,
        },
        "priority_followups": priority_rows,
        "methodology": {
            "append_only_operational_registries": True,
            "completion_requires_evidence": True,
            "metrics_require_minimum_completion_sample": MINIMUM_COMPLETION_SAMPLE,
            "automatic_notification_sent": False,
            "automatic_position_action_allowed": False,
        },
        "posture": "operational_sla_summary_not_investment_action",
    }
    validate_company_review_alert_sla_summary(payload)
    return payload


def validate_company_review_alert_sla_summary(payload: dict[str, Any]) -> None:
    if payload.get("schema_version") != SCHEMA_VERSION:
        raise ValueError("Unexpected company review alert weekly SLA summary schema")
    window = payload.get("window") or {}
    start = date.fromisoformat(str(window.get("start_date")))
    end = date.fromisoformat(str(window.get("end_date")))
    if start > end or int(window.get("lookback_days", 0)) < 1:
        raise ValueError("SLA summary requires a valid date window")
    _aware_datetime(str(payload["observed_at"]))
    counts = payload.get("flow_counts") or {}
    if any(int(counts.get(key, -1)) < 0 for key in (
        "acknowledged_in_window", "assigned_in_window", "completed_in_window",
        "completed_within_due_in_window", "completed_after_due_in_window",
    )):
        raise ValueError("SLA summary flow counts must be non-negative")
    if int(counts["completed_in_window"]) != int(counts["completed_within_due_in_window"]) + int(counts["completed_after_due_in_window"]):
        raise ValueError("SLA summary completion split does not match total")
    backlog = payload.get("current_backlog") or {}
    if any(int(backlog.get(key, -1)) < 0 for key in (
        "acknowledged_without_assignment", "active_open_followups", "active_overdue_followups",
    )):
        raise ValueError("SLA summary backlog counts must be non-negative")
    metrics = payload.get("metrics") or {}
    if metrics.get("status") not in {"available", "insufficient_completion_sample"}:
        raise ValueError("SLA summary metrics require an explicit sample status")
    if metrics.get("status") == "insufficient_completion_sample":
        if any(metrics.get(key) is not None for key in (
            "completion_within_due_rate_pct", "median_assignment_hours", "median_completion_hours",
        )):
            raise ValueError("SLA metrics must remain blank below the minimum sample")
    elif metrics.get("completion_within_due_rate_pct") is None:
        raise ValueError("Available SLA metrics require a completion rate")
    keys: set[str] = set()
    for row in payload.get("priority_followups", []):
        key = str(row.get("alert_key") or "")
        if len(key) != 64 or key in keys:
            raise ValueError("SLA priority follow-ups require unique alert keys")
        keys.add(key)
    methodology = payload.get("methodology") or {}
    if methodology.get("automatic_notification_sent") is not False or methodology.get("automatic_position_action_allowed") is not False:
        raise ValueError("SLA summary cannot send or execute unapproved actions")


def _atomic_write(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    temporary.replace(path)


def main() -> None:
    parser = argparse.ArgumentParser(description="Build weekly operational SLA summary for company review alerts")
    parser.add_argument("--date", required=True)
    parser.add_argument("--lookback-days", type=int, default=7)
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
    payload = build_company_review_alert_sla_summary(
        args.date, json.loads(acknowledgement_path.read_text(encoding="utf-8")),
        json.loads(followup_path.read_text(encoding="utf-8")),
        json.loads(completion_path.read_text(encoding="utf-8")), lookback_days=args.lookback_days,
    )
    output = Path(args.output_file) if args.output_file else ROOT / "workspace" / "company_review_alert_sla_summary" / args.date / "company_review_alert_weekly_sla_summary.json"
    _atomic_write(output, payload)
    print(f"Company review alert SLA summary saved: {output.relative_to(ROOT)}")
    print(f"Completed: {payload['flow_counts']['completed_in_window']} · overdue: {payload['current_backlog']['active_overdue_followups']}")


if __name__ == "__main__":
    main()
