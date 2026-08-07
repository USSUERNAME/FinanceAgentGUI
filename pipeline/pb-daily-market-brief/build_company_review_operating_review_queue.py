"""Build a deterministic review queue for unapproved company operating settings."""

from __future__ import annotations

import argparse
import json
from collections import Counter
from datetime import date
from pathlib import Path
from typing import Any

from approve_company_review_operating_config import (
    CONFIRMATION_PHRASE,
    approve_company_review_operating_config,
    operating_config_review_hash,
    validate_reviewed_operating_config,
)
from collectors.common import ROOT
from collect_company_review_operating_config import validate_operating_config_record
from generate_company_review_operating_drafts import OWNER_FIELDS, validate_generated_operating_draft

SCHEMA_VERSION = "company_review_operating_review_queue.v1"


def _read_registry(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, list):
        raise ValueError("Company review operating registry must contain a JSON list")
    return payload


def load_review_inputs(input_root: Path) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    records: list[dict[str, Any]] = []
    errors: list[dict[str, Any]] = []
    if not input_root.exists():
        return records, errors
    for path in sorted(input_root.rglob("*.json")):
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
            rows = payload if isinstance(payload, list) else [payload]
            for row in rows:
                if not isinstance(row, dict):
                    errors.append({"input_file": str(path), "error": "Review input must be a JSON object"})
                    continue
                records.append({"input_file": str(path), "draft_record": row})
        except Exception as exc:
            errors.append({"input_file": str(path), "error": str(exc)})
    return records, errors


def build_company_review_operating_review_queue(
    report_date: str, inputs: list[dict[str, Any]], approved_registry: list[dict[str, Any]],
    input_errors: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    report_day = date.fromisoformat(report_date)
    for approved in approved_registry:
        validate_operating_config_record(approved, report_day)
    approved_by_key = {
        (str(row.get("ticker") or "").upper(), int(row.get("version", 0))): row
        for row in approved_registry
    }
    keys: list[tuple[str, int]] = []
    for item in inputs:
        record = item.get("draft_record") or {}
        try:
            version = int(record.get("version", 0))
        except (TypeError, ValueError):
            version = -1
        keys.append((str(record.get("ticker") or "").upper(), version))
    duplicate_keys = {key for key, count in Counter(keys).items() if key != ("", 0) and count > 1}
    rows: list[dict[str, Any]] = []
    for item, key in zip(inputs, keys):
        record = item.get("draft_record") or {}
        row = {
            "ticker": key[0] or record.get("ticker"),
            "company_name": record.get("company_name"),
            "version": key[1] or record.get("version"),
            "input_file": item.get("input_file"),
            "review_status": "blocked_review_input",
            "review_hash": None,
            "draft_record": record,
            "block_reason": None,
            "missing_completion_fields": [],
            "approval_executed": False,
            "security_or_position_action_approved": False,
        }
        try:
            if key in duplicate_keys:
                raise ValueError(f"Duplicate review input for {key[0]} version {key[1]}")
            metadata = record.get("draft_metadata") or {}
            missing_completion_fields = [
                field for field in OWNER_FIELDS
                if str((record.get("owners") or {}).get(field) or "").startswith("REPLACE_WITH_")
            ]
            if metadata.get("generated_by") == "generate_company_review_operating_drafts.py" and missing_completion_fields:
                validate_generated_operating_draft(record, report_day)
                row["review_status"] = "generated_requires_user_or_pm_completion"
                row["missing_completion_fields"] = missing_completion_fields
                rows.append(row)
                continue
            validate_reviewed_operating_config(record)
            review_hash = operating_config_review_hash(record)
            row["review_hash"] = review_hash
            approved = approved_by_key.get(key)
            if approved:
                approved_hash = str((approved.get("approval") or {}).get("reviewed_record_hash") or "")
                if approved_hash == review_hash:
                    row["review_status"] = "already_approved_same_hash"
                else:
                    raise ValueError("Ticker/version is already approved with different reviewed content")
            else:
                approve_company_review_operating_config(
                    record, review_hash, "review_queue_preview_only",
                    "Validation-only preview; no approval was executed.", CONFIRMATION_PHRASE,
                    approved_registry, approved_at=f"{report_day.isoformat()}T00:00:00+00:00",
                )
                row["review_status"] = "ready_for_user_or_pm_review"
        except Exception as exc:
            row["block_reason"] = str(exc)
        rows.append(row)
    for error in input_errors or []:
        rows.append({
            "ticker": error.get("ticker"), "company_name": None, "version": None,
            "input_file": error.get("input_file"), "review_status": "blocked_review_input",
            "review_hash": None, "draft_record": None, "block_reason": error.get("error"),
            "missing_completion_fields": [],
            "approval_executed": False, "security_or_position_action_approved": False,
        })
    payload = {
        "schema_version": SCHEMA_VERSION,
        "report_date": report_date,
        "ready_count": sum(row["review_status"] == "ready_for_user_or_pm_review" for row in rows),
        "blocked_count": sum(row["review_status"] == "blocked_review_input" for row in rows),
        "already_approved_count": sum(row["review_status"] == "already_approved_same_hash" for row in rows),
        "completion_required_count": sum(
            row["review_status"] == "generated_requires_user_or_pm_completion" for row in rows
        ),
        "companies": rows,
        "methodology": {
            "exact_review_hash_required": True,
            "explicit_user_or_pm_approval_required": True,
            "daily_workflow_executes_approval": False,
            "automatic_position_action_allowed": False,
        },
        "posture": "operating_policy_review_queue_not_approval_or_investment_action",
    }
    validate_company_review_operating_review_queue(payload)
    return payload


def validate_company_review_operating_review_queue(payload: dict[str, Any]) -> None:
    if payload.get("schema_version") != SCHEMA_VERSION:
        raise ValueError("Unexpected company review operating review queue schema")
    report_day = date.fromisoformat(str(payload["report_date"]))
    rows = payload.get("companies", [])
    counts = {
        "ready_count": "ready_for_user_or_pm_review",
        "blocked_count": "blocked_review_input",
        "already_approved_count": "already_approved_same_hash",
        "completion_required_count": "generated_requires_user_or_pm_completion",
    }
    for count_field, status in counts.items():
        if int(payload.get(count_field, -1)) != sum(row.get("review_status") == status for row in rows):
            raise ValueError(f"{count_field} does not match operating review queue")
    for row in rows:
        if row.get("approval_executed") is not False or row.get("security_or_position_action_approved") is not False:
            raise ValueError("Review queue cannot execute approval or authorize a position action")
        if row.get("review_status") == "ready_for_user_or_pm_review":
            record = row.get("draft_record") or {}
            validate_reviewed_operating_config(record)
            if row.get("review_hash") != operating_config_review_hash(record):
                raise ValueError("Ready operating review hash does not match its record")
            if row.get("block_reason") is not None:
                raise ValueError("Ready operating review cannot retain a block reason")
        elif row.get("review_status") == "blocked_review_input" and not row.get("block_reason"):
            raise ValueError("Blocked operating review requires a reason")
        elif row.get("review_status") == "generated_requires_user_or_pm_completion":
            validate_generated_operating_draft(row.get("draft_record") or {}, report_day)
            if not row.get("missing_completion_fields") or row.get("review_hash") is not None:
                raise ValueError("Generated operating review must retain missing fields and no approval hash")
    methodology = payload.get("methodology") or {}
    if methodology.get("daily_workflow_executes_approval") is not False:
        raise ValueError("Daily operating review queue cannot execute approval")
    if methodology.get("automatic_position_action_allowed") is not False:
        raise ValueError("Operating review queue cannot authorize position action")


def main() -> None:
    parser = argparse.ArgumentParser(description="Build company review operating approval queue")
    parser.add_argument("--date", required=True)
    parser.add_argument("--input-root")
    parser.add_argument("--registry-file")
    parser.add_argument("--output-file")
    args = parser.parse_args()
    input_root = Path(args.input_root) if args.input_root else ROOT / "workspace" / "company_review_operating_inputs"
    registry_path = Path(args.registry_file) if args.registry_file else ROOT / "company_review_operating_registry.json"
    inputs, errors = load_review_inputs(input_root)
    payload = build_company_review_operating_review_queue(
        args.date, inputs, _read_registry(registry_path), errors,
    )
    output = (
        Path(args.output_file) if args.output_file else
        ROOT / "workspace" / "company_review_operating_review_queue" / args.date /
        "company_review_operating_review_queue.json"
    )
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Company review operating queue saved: {output.relative_to(ROOT)}")
    print(f"Ready: {payload['ready_count']} · blocked: {payload['blocked_count']}")


if __name__ == "__main__":
    main()
