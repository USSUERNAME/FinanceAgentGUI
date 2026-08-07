"""Explicitly close one assigned company-review alert follow-up with evidence."""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from assign_company_review_alert_followup import validate_followup_registry
from collectors.common import ROOT

CONFIRMATION_PHRASE = "COMPLETE_COMPANY_REVIEW_ALERT_FOLLOWUP"


def _aware_datetime(value: str) -> datetime:
    parsed = datetime.fromisoformat(value)
    if parsed.utcoffset() is None:
        raise ValueError("Completion timestamps must include a timezone offset")
    return parsed


def validate_completion_registry(completions: list[dict[str, Any]]) -> None:
    ids: set[str] = set()
    keys: set[str] = set()
    for row in completions:
        completion_id = str(row.get("completion_id") or "")
        alert_key = str(row.get("alert_key") or "")
        if not completion_id or completion_id in ids:
            raise ValueError("Follow-up completions require a unique stable identity")
        if len(alert_key) != 64 or any(character not in "0123456789abcdef" for character in alert_key):
            raise ValueError("Follow-up completion requires a valid alert key")
        if alert_key in keys:
            raise ValueError("An exact follow-up can be completed only once")
        if row.get("status") != "completed_with_evidence":
            raise ValueError("Follow-up completion must be explicitly evidence-backed")
        if not row.get("followup_id") or not row.get("review_id") or not row.get("ticker") or not row.get("completed_by"):
            raise ValueError("Follow-up completion requires stable review identity and owner")
        _aware_datetime(str(row.get("completed_at")))
        if row.get("completion_outcome") not in {
            "evidence_review_completed", "formal_thesis_update_logged", "followup_no_longer_required",
        }:
            raise ValueError("Follow-up completion requires a bounded operational outcome")
        if not row.get("evidence_summary") or not row.get("reviewed_followup_hash"):
            raise ValueError("Follow-up completion requires an evidence summary and reviewed follow-up hash")
        references = row.get("evidence_references") or []
        if not references:
            raise ValueError("Follow-up completion requires at least one evidence reference")
        reference_ids: set[str] = set()
        for reference in references:
            evidence_id = str(reference.get("evidence_id") or "")
            if not evidence_id or evidence_id in reference_ids:
                raise ValueError("Completion evidence references require unique identities")
            if not reference.get("source_type") or not reference.get("source_reference") or not reference.get("limitation"):
                raise ValueError("Completion evidence reference requires type, location, and limitation")
            reference_ids.add(evidence_id)
        if row.get("completion_scope") != "operational_review_only":
            raise ValueError("Follow-up completion cannot expand beyond operational review")
        if row.get("automatic_position_action_allowed") is not False:
            raise ValueError("Follow-up completion cannot authorize position action")
        ids.add(completion_id)
        keys.add(alert_key)


def followup_review_hash(followup: dict[str, Any]) -> str:
    reviewed = {
        field: followup.get(field)
        for field in (
            "followup_id", "alert_key", "review_id", "ticker", "status", "assigned_by",
            "owner", "assigned_at", "due_at", "completion_criteria", "acknowledgement_review_hash",
        )
    }
    canonical = json.dumps(reviewed, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def complete_company_review_alert_followup(
    alert_key: str, followups: list[dict[str, Any]], expected_followup_hash: str,
    completed_by: str, completion_outcome: str, evidence_summary: str,
    evidence_references: list[dict[str, Any]], confirmation: str,
    existing_completions: list[dict[str, Any]] | None = None,
    completed_at: str | None = None,
) -> tuple[dict[str, Any], list[dict[str, Any]], dict[str, Any]]:
    if confirmation != CONFIRMATION_PHRASE:
        raise ValueError(f"Actual completion requires the exact confirmation phrase {CONFIRMATION_PHRASE}")
    if not str(completed_by or "").strip() or not str(evidence_summary or "").strip():
        raise ValueError("Follow-up completion requires a named owner and evidence summary")
    validate_followup_registry(followups)
    followup = next((row for row in followups if row.get("alert_key") == alert_key), None)
    if followup is None:
        raise ValueError("Completion requires an assigned open follow-up")
    actual_hash = followup_review_hash(followup)
    if expected_followup_hash != actual_hash:
        raise ValueError("Expected follow-up hash does not match the current assignment")
    timestamp = completed_at or datetime.now(timezone.utc).isoformat()
    _aware_datetime(timestamp)
    completions = copy.deepcopy(existing_completions or [])
    validate_completion_registry(completions)
    if any(row.get("alert_key") == alert_key for row in completions):
        raise ValueError("This follow-up is already completed")
    completion = {
        "completion_id": f"completion:{alert_key}", "alert_key": alert_key,
        "followup_id": followup["followup_id"], "review_id": followup["review_id"],
        "ticker": followup["ticker"], "status": "completed_with_evidence",
        "completed_by": completed_by.strip(), "completed_at": timestamp,
        "completion_outcome": completion_outcome, "evidence_summary": evidence_summary.strip(),
        "evidence_references": copy.deepcopy(evidence_references),
        "reviewed_followup_hash": actual_hash,
        "completion_scope": "operational_review_only",
        "automatic_position_action_allowed": False,
    }
    validate_completion_registry([completion])
    completions.append(completion)
    receipt = {
        "schema_version": "company_review_alert_followup_completion_receipt.v1",
        "alert_key": alert_key, "followup_id": followup["followup_id"],
        "ticker": followup["ticker"], "completed_by": completed_by.strip(),
        "completed_at": timestamp, "reviewed_followup_hash": actual_hash,
        "registry_record_count_after_append": len(completions),
        "operational_followup_completed": True,
        "security_or_position_action_approved": False,
    }
    return completion, completions, receipt


def _atomic_write(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    temporary.replace(path)


def main() -> None:
    parser = argparse.ArgumentParser(description="Explicitly close an assigned company review alert follow-up")
    parser.add_argument("--date", required=True)
    parser.add_argument("--followup-registry-file")
    parser.add_argument("--completion-registry-file")
    parser.add_argument("--list-open", action="store_true")
    parser.add_argument("--alert-key")
    parser.add_argument("--show-followup-hash", action="store_true")
    parser.add_argument("--completed-by")
    parser.add_argument("--completion-outcome", choices=("evidence_review_completed", "formal_thesis_update_logged", "followup_no_longer_required"))
    parser.add_argument("--evidence-summary")
    parser.add_argument("--evidence-reference-file", help="JSON list of evidence references")
    parser.add_argument("--expected-followup-hash")
    parser.add_argument("--confirm-completion", default="")
    parser.add_argument("--receipt-file")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    followup_path = Path(args.followup_registry_file) if args.followup_registry_file else ROOT / "company_review_alert_followup_registry.json"
    completion_path = Path(args.completion_registry_file) if args.completion_registry_file else ROOT / "company_review_alert_followup_completion_registry.json"
    for label, path in (("follow-up registry", followup_path), ("completion registry", completion_path)):
        if not path.exists():
            raise SystemExit(f"Company review alert {label} does not exist: {path}")
    followups = json.loads(followup_path.read_text(encoding="utf-8"))
    completions = json.loads(completion_path.read_text(encoding="utf-8"))
    validate_followup_registry(followups)
    validate_completion_registry(completions)
    completed_keys = {row.get("alert_key") for row in completions}
    open_followups = [row for row in followups if row.get("alert_key") not in completed_keys]
    if args.list_open:
        print(json.dumps([
            {
                "alert_key": row["alert_key"], "ticker": row["ticker"], "owner": row["owner"],
                "due_at": row["due_at"], "completion_criteria": row["completion_criteria"],
                "followup_hash": followup_review_hash(row),
            }
            for row in open_followups
        ], ensure_ascii=False, indent=2))
        return
    if not args.alert_key:
        raise SystemExit("--alert-key is required unless --list-open is used")
    selected = next((row for row in open_followups if row.get("alert_key") == args.alert_key), None)
    if selected is None:
        raise SystemExit("--alert-key is not an assigned open follow-up")
    if args.show_followup_hash:
        print(json.dumps({
            "alert_key": selected["alert_key"], "ticker": selected["ticker"],
            "followup_hash": followup_review_hash(selected), "completion_executed": False,
        }, ensure_ascii=False, indent=2))
        return
    if not args.evidence_reference_file:
        raise SystemExit("--evidence-reference-file is required for completion")
    evidence_path = Path(args.evidence_reference_file)
    if not evidence_path.exists():
        raise SystemExit(f"Evidence reference file does not exist: {evidence_path}")
    evidence_references = json.loads(evidence_path.read_text(encoding="utf-8"))
    for name, value in (
        ("--completed-by", args.completed_by), ("--completion-outcome", args.completion_outcome),
        ("--evidence-summary", args.evidence_summary), ("--expected-followup-hash", args.expected_followup_hash),
    ):
        if not value:
            raise SystemExit(f"{name} is required for follow-up completion")
    confirmation = args.confirm_completion if not args.dry_run else CONFIRMATION_PHRASE
    completion, updated_completions, receipt = complete_company_review_alert_followup(
        args.alert_key, followups, args.expected_followup_hash, args.completed_by,
        args.completion_outcome, args.evidence_summary, evidence_references,
        confirmation, completions,
    )
    print(json.dumps({
        "alert_key": completion["alert_key"], "ticker": completion["ticker"],
        "status": completion["status"], "completion_outcome": completion["completion_outcome"],
        "security_or_position_action_approved": False, "dry_run": args.dry_run,
    }, ensure_ascii=False, indent=2))
    if args.dry_run:
        print("Dry run complete. Registry was not modified.")
        return
    _atomic_write(completion_path, updated_completions)
    receipt_path = (
        Path(args.receipt_file) if args.receipt_file else
        ROOT / "workspace" / "company_review_alert_followup_completions" / args.date /
        f"{completion['alert_key']}_completion_receipt.json"
    )
    _atomic_write(receipt_path, receipt)
    print(f"Follow-up completion appended: {completion_path}")
    print(f"Follow-up completion receipt saved: {receipt_path}")


if __name__ == "__main__":
    main()
