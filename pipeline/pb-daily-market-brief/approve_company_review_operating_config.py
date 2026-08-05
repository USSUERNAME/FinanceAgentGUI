"""Explicitly approve and append one company thesis-review operating configuration."""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any

from collectors.common import ROOT
from collect_company_review_operating_config import (
    PLACEHOLDER_PREFIX,
    validate_operating_config_record,
)

CONFIRMATION_PHRASE = "APPROVE_COMPANY_REVIEW_OPERATIONS"


def operating_config_review_hash(record: dict[str, Any]) -> str:
    """Hash only the user-reviewed operating substance, excluding approval metadata."""
    reviewed = {
        field: copy.deepcopy(record.get(field))
        for field in (
            "operating_config_id", "ticker", "company_name", "version",
            "effective_from", "owners", "review_policy",
            "automatic_position_action_allowed",
        )
    }
    canonical = json.dumps(reviewed, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def validate_reviewed_operating_config(record: dict[str, Any]) -> None:
    required = ("operating_config_id", "ticker", "company_name", "version", "effective_from")
    if any(not record.get(field) for field in required):
        raise ValueError("Reviewed operating configuration is missing identity or version fields")
    ticker = str(record["ticker"]).upper()
    if ticker != record["ticker"]:
        raise ValueError("Reviewed operating configuration ticker must be normalized uppercase")
    if record["operating_config_id"] != f"company:{ticker}:review-operations:v{int(record['version'])}":
        raise ValueError("Operating configuration ID must match its ticker and version")
    owners = record.get("owners") or {}
    for field in (
        "decision_authority", "pm_owner", "analyst_owner", "evidence_owner",
        "kpi_owner", "model_owner", "decision_log_owner",
    ):
        value = str(owners.get(field) or "").strip()
        if not value or value.startswith(PLACEHOLDER_PREFIX):
            raise ValueError(f"Approval requires a reviewed {field}")
    policy = record.get("review_policy") or {}
    if not policy.get("cadence"):
        raise ValueError("Approval requires a reviewed cadence")
    if not policy.get("prep_lead_time") or not policy.get("post_event_update_sla"):
        raise ValueError("Approval requires reviewed preparation lead time and post-event SLA")
    if not policy.get("escalation_triggers"):
        raise ValueError("Approval requires reviewed escalation triggers")
    if record.get("automatic_position_action_allowed") is not False:
        raise ValueError("Operating approval cannot authorize automatic position action")


def _read_registry(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, list):
        raise ValueError("Company review operating registry must contain a JSON list")
    return payload


def approve_company_review_operating_config(
    reviewed_record: dict[str, Any], expected_review_hash: str,
    approved_by: str, approval_note: str, confirmation: str,
    existing_registry: list[dict[str, Any]] | None = None,
    approved_at: str | None = None,
) -> tuple[dict[str, Any], list[dict[str, Any]], dict[str, Any]]:
    if confirmation != CONFIRMATION_PHRASE:
        raise ValueError(f"Actual approval requires the exact confirmation phrase {CONFIRMATION_PHRASE}")
    if not str(approved_by or "").strip() or not str(approval_note or "").strip():
        raise ValueError("Approval requires an approver identity and approval note")
    validate_reviewed_operating_config(reviewed_record)
    actual_hash = operating_config_review_hash(reviewed_record)
    if expected_review_hash != actual_hash:
        raise ValueError("Expected review hash does not match the current operating configuration")

    record = copy.deepcopy(reviewed_record)
    timestamp = approved_at or datetime.now(timezone.utc).isoformat()
    approved_time = datetime.fromisoformat(timestamp)
    if approved_time.utcoffset() is None:
        raise ValueError("Approval timestamp must include a timezone offset")
    approved_day = approved_time.date()
    ticker = str(record["ticker"]).upper()
    version = int(record["version"])
    if date.fromisoformat(str(record["effective_from"])) > approved_day:
        raise ValueError("Operating configuration cannot become effective after approval")

    registry = copy.deepcopy(existing_registry or [])
    existing_versions: list[int] = []
    for existing in registry:
        validate_operating_config_record(existing, approved_day)
        if str(existing.get("ticker") or "").upper() == ticker:
            existing_versions.append(int(existing["version"]))
    expected_version = max(existing_versions, default=0) + 1
    if version != expected_version:
        raise ValueError(f"Append-only operating configuration for {ticker} requires version {expected_version}")

    record["approval"] = {
        "status": "approved_by_user_or_pm",
        "approved_by": approved_by.strip(),
        "approved_at": timestamp,
        "approval_note": approval_note.strip(),
        "reviewed_record_hash": actual_hash,
    }
    source_id = f"OPS-{ticker}-V{version}"
    sources = {
        str(source.get("source_id")): dict(source)
        for source in record.get("source_index", [])
        if source.get("source_id") and str(source.get("source_id")) != source_id
    }
    sources[source_id] = {
        "source_id": source_id,
        "source_name": f"{ticker} approved review operating configuration v{version}",
        "source_type": "user_provided_internal_operating_policy",
        "as_of_date": approved_day.isoformat(),
        "source_location": "company_review_operating_registry.json",
        "reliability": "explicit_user_or_pm_approval",
        "limitation": "Operating policy only; not a public-company fact or investment action.",
    }
    record["source_index"] = list(sources.values())
    normalized = validate_operating_config_record(record, approved_day)
    registry.append(normalized)
    receipt = {
        "schema_version": "company_review_operating_approval_receipt.v1",
        "ticker": ticker,
        "operating_config_id": normalized["operating_config_id"],
        "version": version,
        "approved_by": approved_by.strip(),
        "approved_at": timestamp,
        "reviewed_record_hash": actual_hash,
        "registry_record_count_after_append": len(registry),
        "company_thesis_review_operations_approved": True,
        "security_or_position_action_approved": False,
    }
    return normalized, registry, receipt


def _atomic_write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    temporary.replace(path)


def main() -> None:
    parser = argparse.ArgumentParser(description="Explicitly approve company thesis-review operating settings")
    parser.add_argument("--date", required=True)
    parser.add_argument("--reviewed-config-file", required=True)
    parser.add_argument("--show-review-hash", action="store_true")
    parser.add_argument("--approved-by")
    parser.add_argument("--approval-note")
    parser.add_argument("--expected-review-hash")
    parser.add_argument("--confirm-approval", default="")
    parser.add_argument("--registry-file")
    parser.add_argument("--receipt-file")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    reviewed_path = Path(args.reviewed_config_file)
    if not reviewed_path.exists():
        raise SystemExit(f"Reviewed operating configuration does not exist: {reviewed_path}")
    reviewed = json.loads(reviewed_path.read_text(encoding="utf-8"))
    validate_reviewed_operating_config(reviewed)
    review_hash = operating_config_review_hash(reviewed)
    if args.show_review_hash:
        print(json.dumps({
            "ticker": reviewed["ticker"], "version": reviewed["version"],
            "operating_config_id": reviewed["operating_config_id"],
            "review_hash": review_hash,
            "approval_executed": False,
        }, ensure_ascii=False, indent=2))
        return
    for name, value in (
        ("--approved-by", args.approved_by), ("--approval-note", args.approval_note),
        ("--expected-review-hash", args.expected_review_hash),
    ):
        if not value:
            raise SystemExit(f"{name} is required for approval preview or execution")

    registry_path = Path(args.registry_file) if args.registry_file else ROOT / "company_review_operating_registry.json"
    confirmation = args.confirm_approval if not args.dry_run else CONFIRMATION_PHRASE
    record, registry, receipt = approve_company_review_operating_config(
        reviewed, args.expected_review_hash, args.approved_by, args.approval_note,
        confirmation, _read_registry(registry_path),
    )
    print(json.dumps({
        "ticker": record["ticker"], "version": record["version"],
        "operating_config_id": record["operating_config_id"],
        "approval_status": record["approval"]["status"],
        "reviewed_record_hash": receipt["reviewed_record_hash"],
        "security_or_position_action_approved": False,
        "dry_run": args.dry_run,
    }, ensure_ascii=False, indent=2))
    if args.dry_run:
        print("Dry run complete. Registry was not modified.")
        return

    _atomic_write_json(registry_path, registry)
    receipt_path = (
        Path(args.receipt_file) if args.receipt_file else
        ROOT / "workspace" / "company_review_operating_approvals" / args.date /
        f"{record['ticker']}_v{record['version']}_approval_receipt.json"
    )
    _atomic_write_json(receipt_path, receipt)
    registry_label = registry_path.relative_to(ROOT) if registry_path.is_relative_to(ROOT) else registry_path
    receipt_label = receipt_path.relative_to(ROOT) if receipt_path.is_relative_to(ROOT) else receipt_path
    print(f"Approved operating configuration appended: {registry_label}")
    print(f"Approval receipt saved: {receipt_label}")


if __name__ == "__main__":
    main()
