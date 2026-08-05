"""Build an owner-facing operational queue for unresolved company-review alerts."""

from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from assign_company_review_alert_followup import validate_followup_registry
from build_company_review_alert_sla_summary import _validate_relationships
from collectors.common import ROOT
from complete_company_review_alert_followup import validate_completion_registry
from dispatch_company_review_alerts import validate_acknowledgement_registry

SCHEMA_VERSION = "company_review_alert_owner_queue.v1"


def _aware_datetime(value: str) -> datetime:
    parsed = datetime.fromisoformat(value)
    if parsed.utcoffset() is None:
        raise ValueError("Owner queue timestamps must include a timezone offset")
    return parsed


def build_company_review_alert_owner_queue(
    report_date: str, acknowledgements: list[dict[str, Any]], followups: list[dict[str, Any]],
    completions: list[dict[str, Any]], *, observed_at: str | None = None,
) -> dict[str, Any]:
    validate_acknowledgement_registry(acknowledgements)
    validate_followup_registry(followups)
    validate_completion_registry(completions)
    _validate_relationships(acknowledgements, followups, completions)
    now = _aware_datetime(observed_at or datetime.now(timezone.utc).isoformat())
    followup_by_key = {str(row["alert_key"]): row for row in followups}
    completed_keys = {str(row["alert_key"]) for row in completions}
    rows: list[dict[str, Any]] = []
    for acknowledgement in acknowledgements:
        key = str(acknowledgement["alert_key"])
        followup = followup_by_key.get(key)
        if key in completed_keys:
            continue
        if followup is None:
            rows.append({
                "alert_key": key, "review_id": acknowledgement["review_id"], "ticker": acknowledgement["ticker"],
                "owner": "unassigned", "queue_status": "followup_assignment_missing", "priority": "high",
                "priority_rank": 2, "due_at": None, "acknowledged_at": acknowledgement["acknowledged_at"],
                "root_cause": "acknowledged_alert_without_followup_assignment",
                "required_next_action": "assign_followup_owner_due_date_and_completion_criteria",
                "security_thesis_readiness": "not_decision_grade", "position_action": "wait_for_proof",
                "automatic_notification_sent": False, "automatic_position_action_allowed": False,
            })
            continue
        overdue = now > _aware_datetime(str(followup["due_at"]))
        rows.append({
            "alert_key": key, "review_id": followup["review_id"], "ticker": followup["ticker"],
            "owner": followup["owner"],
            "queue_status": "followup_overdue" if overdue else "followup_open",
            "priority": "critical" if overdue else "normal", "priority_rank": 1 if overdue else 3,
            "due_at": followup["due_at"], "acknowledged_at": acknowledgement["acknowledged_at"],
            "root_cause": "acknowledged_alert_followup_due_date_missed" if overdue else "assigned_followup_open",
            "required_next_action": "complete_followup_with_evidence" if overdue else "complete_before_due_date_with_evidence",
            "security_thesis_readiness": "not_decision_grade", "position_action": "wait_for_proof",
            "automatic_notification_sent": False, "automatic_position_action_allowed": False,
        })
    rows.sort(key=lambda row: (int(row["priority_rank"]), str(row.get("due_at") or row.get("acknowledged_at")), str(row["ticker"])))
    owner_summary: list[dict[str, Any]] = []
    for owner in sorted({str(row["owner"]) for row in rows}):
        owned = [row for row in rows if row["owner"] == owner]
        owner_summary.append({
            "owner": owner, "unresolved_count": len(owned),
            "critical_count": sum(row["priority"] == "critical" for row in owned),
            "high_count": sum(row["priority"] == "high" for row in owned),
            "normal_count": sum(row["priority"] == "normal" for row in owned),
        })
    causes = [
        {"root_cause": cause, "count": sum(row["root_cause"] == cause for row in rows)}
        for cause in sorted({str(row["root_cause"]) for row in rows})
    ]
    payload = {
        "schema_version": SCHEMA_VERSION, "report_date": report_date, "observed_at": now.isoformat(),
        "unresolved_count": len(rows),
        "critical_count": sum(row["priority"] == "critical" for row in rows),
        "high_count": sum(row["priority"] == "high" for row in rows),
        "normal_count": sum(row["priority"] == "normal" for row in rows),
        "completed_excluded_count": len(completed_keys),
        "owner_summary": owner_summary, "root_cause_summary": causes, "queue": rows,
        "methodology": {
            "completed_followups_excluded_from_active_queue": True,
            "priority_order": ["critical_overdue", "high_missing_assignment", "normal_open"],
            "root_causes_are_deterministic_statuses": True,
            "automatic_notification_sent": False,
            "automatic_position_action_allowed": False,
        },
        "posture": "operational_owner_queue_not_investment_action",
    }
    validate_company_review_alert_owner_queue(payload)
    return payload


def validate_company_review_alert_owner_queue(payload: dict[str, Any]) -> None:
    if payload.get("schema_version") != SCHEMA_VERSION:
        raise ValueError("Unexpected company review alert owner queue schema")
    _aware_datetime(str(payload["observed_at"]))
    rows = payload.get("queue", [])
    for field, priority in (("critical_count", "critical"), ("high_count", "high"), ("normal_count", "normal")):
        if int(payload.get(field, -1)) != sum(row.get("priority") == priority for row in rows):
            raise ValueError("Owner queue priority count does not match rows")
    if int(payload.get("unresolved_count", -1)) != len(rows):
        raise ValueError("Owner queue unresolved count does not match rows")
    seen: set[str] = set()
    previous_sort: tuple[int, str, str] | None = None
    for row in rows:
        key = str(row.get("alert_key") or "")
        if len(key) != 64 or key in seen:
            raise ValueError("Owner queue requires unique alert keys")
        sort_key = (int(row.get("priority_rank", 99)), str(row.get("due_at") or row.get("acknowledged_at")), str(row.get("ticker")))
        if previous_sort and sort_key < previous_sort:
            raise ValueError("Owner queue must be sorted by deterministic priority")
        if row.get("security_thesis_readiness") != "not_decision_grade" or row.get("position_action") != "wait_for_proof":
            raise ValueError("Owner queue cannot promote security readiness or position action")
        if row.get("automatic_notification_sent") is not False or row.get("automatic_position_action_allowed") is not False:
            raise ValueError("Owner queue cannot send or execute unapproved actions")
        seen.add(key)
        previous_sort = sort_key
    owner_total = sum(int(row.get("unresolved_count", -1)) for row in payload.get("owner_summary", []))
    if owner_total != len(rows):
        raise ValueError("Owner summary does not reconcile to active queue")
    cause_total = sum(int(row.get("count", -1)) for row in payload.get("root_cause_summary", []))
    if cause_total != len(rows):
        raise ValueError("Root-cause summary does not reconcile to active queue")
    methodology = payload.get("methodology") or {}
    if methodology.get("automatic_notification_sent") is not False or methodology.get("automatic_position_action_allowed") is not False:
        raise ValueError("Owner queue cannot send or execute unapproved actions")


def _atomic_write(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    temporary.replace(path)


def main() -> None:
    parser = argparse.ArgumentParser(description="Build owner queue for unresolved company review alert follow-ups")
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
    payload = build_company_review_alert_owner_queue(
        args.date, json.loads(acknowledgement_path.read_text(encoding="utf-8")),
        json.loads(followup_path.read_text(encoding="utf-8")),
        json.loads(completion_path.read_text(encoding="utf-8")),
    )
    output = Path(args.output_file) if args.output_file else ROOT / "workspace" / "company_review_alert_owner_queue" / args.date / "company_review_alert_owner_queue.json"
    _atomic_write(output, payload)
    print(f"Company review alert owner queue saved: {output.relative_to(ROOT)}")
    print(f"Unresolved: {payload['unresolved_count']} · critical: {payload['critical_count']}")


if __name__ == "__main__":
    main()
