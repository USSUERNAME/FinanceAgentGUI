"""Explicitly assign follow-up work for one acknowledged company-review alert."""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from collectors.common import ROOT
from dispatch_company_review_alerts import validate_acknowledgement_registry

CONFIRMATION_PHRASE = "ASSIGN_COMPANY_REVIEW_ALERT_FOLLOWUP"


def _aware_datetime(value: str) -> datetime:
    parsed = datetime.fromisoformat(value)
    if parsed.utcoffset() is None:
        raise ValueError("Follow-up timestamps must include a timezone offset")
    return parsed


def validate_followup_registry(followups: list[dict[str, Any]]) -> None:
    ids: set[str] = set()
    keys: set[str] = set()
    for row in followups:
        followup_id = str(row.get("followup_id") or "")
        alert_key = str(row.get("alert_key") or "")
        if not followup_id or followup_id in ids:
            raise ValueError("Follow-ups require a unique stable identity")
        if len(alert_key) != 64 or any(character not in "0123456789abcdef" for character in alert_key):
            raise ValueError("Follow-up requires a valid alert key")
        if alert_key in keys:
            raise ValueError("An exact acknowledged alert can have only one active follow-up")
        if row.get("status") != "open":
            raise ValueError("This follow-up registry accepts only open assignments")
        if not row.get("review_id") or not row.get("ticker") or not row.get("assigned_by") or not row.get("owner"):
            raise ValueError("Follow-up requires stable review identity and named owners")
        if not row.get("completion_criteria") or not row.get("acknowledgement_review_hash"):
            raise ValueError("Follow-up requires completion criteria and acknowledged alert hash")
        assigned_at = _aware_datetime(str(row.get("assigned_at")))
        due_at = _aware_datetime(str(row.get("due_at")))
        if due_at <= assigned_at:
            raise ValueError("Follow-up due time must be after assignment time")
        if row.get("followup_scope") != "operational_review_only":
            raise ValueError("Follow-up cannot expand beyond operational review")
        if row.get("automatic_position_action_allowed") is not False:
            raise ValueError("Follow-up cannot authorize position action")
        ids.add(followup_id)
        keys.add(alert_key)


def acknowledgement_review_hash(acknowledgement: dict[str, Any]) -> str:
    reviewed = {
        field: acknowledgement.get(field)
        for field in (
            "alert_key", "review_id", "ticker", "status", "acknowledged_by",
            "acknowledged_at", "note", "reviewed_alert_hash",
        )
    }
    canonical = json.dumps(reviewed, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def assign_company_review_alert_followup(
    alert_key: str, acknowledgements: list[dict[str, Any]], expected_acknowledgement_hash: str,
    assigned_by: str, owner: str, due_at: str, completion_criteria: str, confirmation: str,
    existing_followups: list[dict[str, Any]] | None = None,
    assigned_at: str | None = None,
) -> tuple[dict[str, Any], list[dict[str, Any]], dict[str, Any]]:
    if confirmation != CONFIRMATION_PHRASE:
        raise ValueError(f"Actual follow-up assignment requires the exact confirmation phrase {CONFIRMATION_PHRASE}")
    if not all(str(value or "").strip() for value in (assigned_by, owner, completion_criteria)):
        raise ValueError("Follow-up assignment requires assigner, owner, and completion criteria")
    validate_acknowledgement_registry(acknowledgements)
    acknowledgement = next((row for row in acknowledgements if row.get("alert_key") == alert_key), None)
    if acknowledgement is None:
        raise ValueError("Follow-up can be assigned only to an acknowledged alert")
    actual_hash = acknowledgement_review_hash(acknowledgement)
    if expected_acknowledgement_hash != actual_hash:
        raise ValueError("Expected acknowledgement hash does not match the current acknowledgement")
    assignment_time = assigned_at or datetime.now(timezone.utc).isoformat()
    assigned_time = _aware_datetime(assignment_time)
    deadline = _aware_datetime(due_at)
    if deadline <= assigned_time:
        raise ValueError("Follow-up due time must be after assignment time")
    followups = copy.deepcopy(existing_followups or [])
    validate_followup_registry(followups)
    if any(row.get("alert_key") == alert_key for row in followups):
        raise ValueError("This acknowledged alert already has an active follow-up")
    followup = {
        "followup_id": f"followup:{alert_key}", "alert_key": alert_key,
        "review_id": acknowledgement["review_id"], "ticker": acknowledgement["ticker"],
        "status": "open", "assigned_by": assigned_by.strip(), "owner": owner.strip(),
        "assigned_at": assignment_time, "due_at": due_at,
        "completion_criteria": completion_criteria.strip(),
        "acknowledgement_review_hash": actual_hash,
        "followup_scope": "operational_review_only",
        "automatic_position_action_allowed": False,
    }
    validate_followup_registry([followup])
    followups.append(followup)
    receipt = {
        "schema_version": "company_review_alert_followup_assignment_receipt.v1",
        "alert_key": alert_key, "review_id": acknowledgement["review_id"],
        "ticker": acknowledgement["ticker"], "assigned_by": assigned_by.strip(),
        "owner": owner.strip(), "assigned_at": assignment_time, "due_at": due_at,
        "acknowledgement_review_hash": actual_hash,
        "registry_record_count_after_append": len(followups),
        "operational_followup_assigned": True,
        "security_or_position_action_approved": False,
    }
    return followup, followups, receipt


def _atomic_write(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    temporary.replace(path)


def main() -> None:
    parser = argparse.ArgumentParser(description="Explicitly assign follow-up work for an acknowledged alert")
    parser.add_argument("--date", required=True)
    parser.add_argument("--acknowledgement-registry-file")
    parser.add_argument("--followup-registry-file")
    parser.add_argument("--list-acknowledged", action="store_true")
    parser.add_argument("--alert-key")
    parser.add_argument("--show-acknowledgement-hash", action="store_true")
    parser.add_argument("--assigned-by")
    parser.add_argument("--owner")
    parser.add_argument("--due-at")
    parser.add_argument("--completion-criteria")
    parser.add_argument("--expected-acknowledgement-hash")
    parser.add_argument("--confirm-assignment", default="")
    parser.add_argument("--receipt-file")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    acknowledgement_path = Path(args.acknowledgement_registry_file) if args.acknowledgement_registry_file else ROOT / "company_review_alert_acknowledgement_registry.json"
    followup_path = Path(args.followup_registry_file) if args.followup_registry_file else ROOT / "company_review_alert_followup_registry.json"
    for label, path in (("acknowledgement registry", acknowledgement_path), ("follow-up registry", followup_path)):
        if not path.exists():
            raise SystemExit(f"Company review alert {label} does not exist: {path}")
    acknowledgements = json.loads(acknowledgement_path.read_text(encoding="utf-8"))
    followups = json.loads(followup_path.read_text(encoding="utf-8"))
    validate_acknowledgement_registry(acknowledgements)
    validate_followup_registry(followups)
    open_keys = {row.get("alert_key") for row in followups}
    acknowledged = [row for row in acknowledgements if row.get("alert_key") not in open_keys]
    if args.list_acknowledged:
        print(json.dumps([
            {
                "alert_key": row["alert_key"], "ticker": row["ticker"],
                "acknowledged_at": row["acknowledged_at"],
                "acknowledgement_hash": acknowledgement_review_hash(row),
            }
            for row in acknowledged
        ], ensure_ascii=False, indent=2))
        return
    if not args.alert_key:
        raise SystemExit("--alert-key is required unless --list-acknowledged is used")
    selected = next((row for row in acknowledged if row.get("alert_key") == args.alert_key), None)
    if selected is None:
        raise SystemExit("--alert-key is not an acknowledged alert without an active follow-up")
    if args.show_acknowledgement_hash:
        print(json.dumps({
            "alert_key": selected["alert_key"], "ticker": selected["ticker"],
            "acknowledgement_hash": acknowledgement_review_hash(selected), "assignment_executed": False,
        }, ensure_ascii=False, indent=2))
        return
    for name, value in (
        ("--assigned-by", args.assigned_by), ("--owner", args.owner), ("--due-at", args.due_at),
        ("--completion-criteria", args.completion_criteria),
        ("--expected-acknowledgement-hash", args.expected_acknowledgement_hash),
    ):
        if not value:
            raise SystemExit(f"{name} is required for follow-up assignment")
    confirmation = args.confirm_assignment if not args.dry_run else CONFIRMATION_PHRASE
    followup, updated_followups, receipt = assign_company_review_alert_followup(
        args.alert_key, acknowledgements, args.expected_acknowledgement_hash,
        args.assigned_by, args.owner, args.due_at, args.completion_criteria,
        confirmation, followups,
    )
    print(json.dumps({
        "alert_key": followup["alert_key"], "owner": followup["owner"],
        "due_at": followup["due_at"], "status": followup["status"],
        "security_or_position_action_approved": False, "dry_run": args.dry_run,
    }, ensure_ascii=False, indent=2))
    if args.dry_run:
        print("Dry run complete. Registry was not modified.")
        return
    _atomic_write(followup_path, updated_followups)
    receipt_path = (
        Path(args.receipt_file) if args.receipt_file else
        ROOT / "workspace" / "company_review_alert_followup_assignments" / args.date /
        f"{followup['alert_key']}_assignment_receipt.json"
    )
    _atomic_write(receipt_path, receipt)
    print(f"Follow-up appended: {followup_path}")
    print(f"Follow-up assignment receipt saved: {receipt_path}")


if __name__ == "__main__":
    main()
