"""Explicitly approve and append one company-review alert delivery policy."""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any

from collectors.common import ROOT
from dispatch_company_review_alerts import validate_delivery_policy_registry

CONFIRMATION_PHRASE = "APPROVE_COMPANY_REVIEW_ALERT_DELIVERY"


def delivery_policy_review_hash(policy: dict[str, Any]) -> str:
    reviewed = {
        field: copy.deepcopy(policy.get(field))
        for field in (
            "policy_id", "version", "effective_from", "channel",
            "minimum_alert_level", "allowed_escalation_reasons",
            "repeat_exact_alert", "recipient_scope", "environment_enable_variable",
            "message_scope", "automatic_position_action_allowed",
        )
    }
    canonical = json.dumps(reviewed, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def approve_company_review_alert_delivery_policy(
    reviewed_policy: dict[str, Any], expected_review_hash: str,
    approved_by: str, approval_note: str, confirmation: str,
    existing_registry: list[dict[str, Any]] | None = None,
    approved_at: str | None = None,
) -> tuple[dict[str, Any], list[dict[str, Any]], dict[str, Any]]:
    if confirmation != CONFIRMATION_PHRASE:
        raise ValueError(f"Actual approval requires the exact confirmation phrase {CONFIRMATION_PHRASE}")
    if not str(approved_by or "").strip() or not str(approval_note or "").strip():
        raise ValueError("Approval requires an approver identity and approval note")
    validate_delivery_policy_registry([reviewed_policy])
    actual_hash = delivery_policy_review_hash(reviewed_policy)
    if actual_hash != expected_review_hash:
        raise ValueError("Expected review hash does not match the current delivery policy")
    timestamp = approved_at or datetime.now(timezone.utc).isoformat()
    approved_time = datetime.fromisoformat(timestamp)
    if approved_time.utcoffset() is None:
        raise ValueError("Approval timestamp must include a timezone offset")
    if date.fromisoformat(str(reviewed_policy["effective_from"])) > approved_time.date():
        raise ValueError("Delivery policy cannot become effective after approval")

    registry = copy.deepcopy(existing_registry or [])
    validate_delivery_policy_registry(registry)
    policy_id = str(reviewed_policy["policy_id"])
    existing_versions = [
        int(row["version"]) for row in registry if row.get("policy_id") == policy_id
    ]
    expected_version = max(existing_versions, default=0) + 1
    if int(reviewed_policy["version"]) != expected_version:
        raise ValueError(f"Append-only delivery policy {policy_id} requires version {expected_version}")

    approved = copy.deepcopy(reviewed_policy)
    approved["approval"] = {
        "status": "approved_by_user_or_pm", "approved_by": approved_by.strip(),
        "approved_at": timestamp, "approval_note": approval_note.strip(),
        "reviewed_policy_hash": actual_hash,
    }
    validate_delivery_policy_registry([approved])
    registry.append(approved)
    receipt = {
        "schema_version": "company_review_alert_delivery_policy_approval_receipt.v1",
        "policy_id": policy_id, "version": int(approved["version"]),
        "approved_by": approved_by.strip(), "approved_at": timestamp,
        "reviewed_policy_hash": actual_hash,
        "registry_record_count_after_append": len(registry),
        "external_operational_alert_delivery_approved": True,
        "environment_activation_still_required": True,
        "security_or_position_action_approved": False,
    }
    return approved, registry, receipt


def _atomic_write(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    temporary.replace(path)


def main() -> None:
    parser = argparse.ArgumentParser(description="Explicitly approve company review alert delivery")
    parser.add_argument("--date", required=True)
    parser.add_argument("--reviewed-policy-file", required=True)
    parser.add_argument("--show-review-hash", action="store_true")
    parser.add_argument("--approved-by")
    parser.add_argument("--approval-note")
    parser.add_argument("--expected-review-hash")
    parser.add_argument("--confirm-approval", default="")
    parser.add_argument("--registry-file")
    parser.add_argument("--receipt-file")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    reviewed_path = Path(args.reviewed_policy_file)
    if not reviewed_path.exists():
        raise SystemExit(f"Reviewed delivery policy does not exist: {reviewed_path}")
    reviewed = json.loads(reviewed_path.read_text(encoding="utf-8"))
    validate_delivery_policy_registry([reviewed])
    review_hash = delivery_policy_review_hash(reviewed)
    if args.show_review_hash:
        print(json.dumps({
            "policy_id": reviewed["policy_id"], "version": reviewed["version"],
            "review_hash": review_hash, "approval_executed": False,
        }, ensure_ascii=False, indent=2))
        return
    for name, value in (
        ("--approved-by", args.approved_by), ("--approval-note", args.approval_note),
        ("--expected-review-hash", args.expected_review_hash),
    ):
        if not value:
            raise SystemExit(f"{name} is required for approval preview or execution")
    registry_path = Path(args.registry_file) if args.registry_file else ROOT / "company_review_alert_delivery_policy_registry.json"
    registry = json.loads(registry_path.read_text(encoding="utf-8")) if registry_path.exists() else []
    confirmation = args.confirm_approval if not args.dry_run else CONFIRMATION_PHRASE
    approved, updated_registry, receipt = approve_company_review_alert_delivery_policy(
        reviewed, args.expected_review_hash, args.approved_by, args.approval_note,
        confirmation, registry,
    )
    print(json.dumps({
        "policy_id": approved["policy_id"], "version": approved["version"],
        "approval_status": approved["approval"]["status"],
        "reviewed_policy_hash": receipt["reviewed_policy_hash"],
        "environment_activation_still_required": True,
        "security_or_position_action_approved": False, "dry_run": args.dry_run,
    }, ensure_ascii=False, indent=2))
    if args.dry_run:
        print("Dry run complete. Registry was not modified.")
        return
    _atomic_write(registry_path, updated_registry)
    receipt_path = (
        Path(args.receipt_file) if args.receipt_file else
        ROOT / "workspace" / "company_review_alert_delivery_policy_approvals" / args.date /
        f"{approved['policy_id']}_v{approved['version']}_approval_receipt.json"
    )
    _atomic_write(receipt_path, receipt)
    print(f"Approved alert delivery policy appended: {registry_path}")
    print(f"Approval receipt saved: {receipt_path}")


if __name__ == "__main__":
    main()
