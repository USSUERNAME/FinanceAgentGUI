"""Check reference integrity for evidence-backed operational follow-up completions."""

from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from collectors.common import ROOT
from complete_company_review_alert_followup import validate_completion_registry
from verify_company_review_alert_completion_evidence import (
    external_evidence_review_hash,
    validate_external_evidence_verification_registry,
)

SCHEMA_VERSION = "company_review_alert_completion_evidence_integrity.v1"


def _aware_datetime(value: str) -> datetime:
    parsed = datetime.fromisoformat(value)
    if parsed.utcoffset() is None:
        raise ValueError("Evidence integrity timestamps must include a timezone offset")
    return parsed


def _reference_status(
    completion: dict[str, Any], reference: dict[str, Any],
    verification_records: dict[tuple[str, str], dict[str, Any]],
) -> tuple[str, str | None, dict[str, Any] | None]:
    value = str(reference.get("source_reference") or "").strip()
    if value.startswith(("https://", "http://")):
        verification = verification_records.get((completion["completion_id"], reference["evidence_id"]))
        if verification and verification.get("reviewed_evidence_hash") == external_evidence_review_hash(completion, reference):
            return "external_reference_verified_by_user_or_pm", "Manual review is recorded; this check did not fetch the URL.", verification
        return "external_reference_unverified", "No network request is made by this integrity check.", None
    if "://" in value:
        return "unsupported_reference_scheme", "Only HTTP(S) URLs or local paths are supported.", None
    path = Path(value)
    resolved = path if path.is_absolute() else ROOT / path
    if resolved.exists():
        return "local_reference_exists", None, None
    return "missing_local_reference", "Local evidence reference does not exist at check time.", None


def validate_company_review_alert_completion_evidence(
    report_date: str, completions: list[dict[str, Any]], *, observed_at: str | None = None,
    external_verifications: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    validate_completion_registry(completions)
    verifications = external_verifications or []
    validate_external_evidence_verification_registry(verifications, completions)
    verification_records = {
        (row["completion_id"], row["evidence_id"]): row
        for row in verifications
    }
    now = _aware_datetime(observed_at or datetime.now(timezone.utc).isoformat())
    rows: list[dict[str, Any]] = []
    for completion in completions:
        references = []
        for reference in completion.get("evidence_references", []):
            status, note, verification = _reference_status(completion, reference, verification_records)
            item = {
                "evidence_id": reference["evidence_id"], "source_type": reference["source_type"],
                "source_reference": reference["source_reference"], "status": status, "note": note,
            }
            if verification:
                item["verified_by"] = verification["verified_by"]
                item["verified_at"] = verification["verified_at"]
                item["verification_scope"] = verification["verification_scope"]
            references.append(item)
        statuses = {row["status"] for row in references}
        if statuses & {"missing_local_reference", "unsupported_reference_scheme"}:
            completion_status = "reference_integrity_issue"
        elif "external_reference_unverified" in statuses:
            completion_status = "external_reference_verification_pending"
        elif "external_reference_verified_by_user_or_pm" in statuses:
            completion_status = "external_references_verified_by_user_or_pm"
        else:
            completion_status = "local_references_available"
        rows.append({
            "completion_id": completion["completion_id"], "alert_key": completion["alert_key"],
            "ticker": completion["ticker"], "completed_at": completion["completed_at"],
            "completion_status": completion_status, "references": references,
            "security_thesis_readiness": "not_decision_grade", "position_action": "wait_for_proof",
            "automatic_notification_sent": False, "automatic_position_action_allowed": False,
        })
    payload = {
        "schema_version": SCHEMA_VERSION, "report_date": report_date, "observed_at": now.isoformat(),
        "completion_count": len(rows),
        "local_references_available_count": sum(row["completion_status"] == "local_references_available" for row in rows),
        "external_reference_verification_pending_count": sum(row["completion_status"] == "external_reference_verification_pending" for row in rows),
        "external_references_verified_by_user_or_pm_count": sum(row["completion_status"] == "external_references_verified_by_user_or_pm" for row in rows),
        "reference_integrity_issue_count": sum(row["completion_status"] == "reference_integrity_issue" for row in rows),
        "rows": rows,
        "methodology": {
            "local_path_existence_checked": True,
            "external_urls_not_fetched": True,
            "external_verifications_are_manual_records_only": True,
            "completion_status_not_modified": True,
            "automatic_notification_sent": False,
            "automatic_position_action_allowed": False,
        },
        "posture": "operational_completion_evidence_integrity_not_investment_action",
    }
    validate_completion_evidence_integrity(payload)
    return payload


def validate_completion_evidence_integrity(payload: dict[str, Any]) -> None:
    if payload.get("schema_version") != SCHEMA_VERSION:
        raise ValueError("Unexpected completion evidence integrity schema")
    rows = payload.get("rows", [])
    if int(payload.get("completion_count", -1)) != len(rows):
        raise ValueError("Completion evidence integrity count does not match rows")
    for field, status in (
        ("local_references_available_count", "local_references_available"),
        ("external_reference_verification_pending_count", "external_reference_verification_pending"),
        ("external_references_verified_by_user_or_pm_count", "external_references_verified_by_user_or_pm"),
        ("reference_integrity_issue_count", "reference_integrity_issue"),
    ):
        if int(payload.get(field, -1)) != sum(row.get("completion_status") == status for row in rows):
            raise ValueError("Completion evidence integrity status count does not match rows")
    _aware_datetime(str(payload["observed_at"]))
    ids: set[str] = set()
    for row in rows:
        completion_id = str(row.get("completion_id") or "")
        if not completion_id or completion_id in ids:
            raise ValueError("Completion evidence integrity requires unique completion identities")
        if row.get("security_thesis_readiness") != "not_decision_grade" or row.get("position_action") != "wait_for_proof":
            raise ValueError("Completion evidence integrity cannot promote security readiness or position action")
        if row.get("automatic_notification_sent") is not False or row.get("automatic_position_action_allowed") is not False:
            raise ValueError("Completion evidence integrity cannot send or execute unapproved actions")
        ids.add(completion_id)
    methodology = payload.get("methodology") or {}
    if (methodology.get("external_urls_not_fetched") is not True
            or methodology.get("external_verifications_are_manual_records_only") is not True
            or methodology.get("completion_status_not_modified") is not True):
        raise ValueError("Completion evidence integrity methodology must disclose its non-mutating limits")


def _atomic_write(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    temporary.replace(path)


def main() -> None:
    parser = argparse.ArgumentParser(description="Check company review alert completion evidence references")
    parser.add_argument("--date", required=True)
    parser.add_argument("--completion-registry-file")
    parser.add_argument("--external-verification-registry-file")
    parser.add_argument("--output-file")
    args = parser.parse_args()
    completion_path = Path(args.completion_registry_file) if args.completion_registry_file else ROOT / "company_review_alert_followup_completion_registry.json"
    if not completion_path.exists():
        raise SystemExit(f"Company review alert completion registry does not exist: {completion_path}")
    verification_path = Path(args.external_verification_registry_file) if args.external_verification_registry_file else ROOT / "company_review_alert_completion_evidence_verification_registry.json"
    if not verification_path.exists():
        raise SystemExit(f"Company review alert external verification registry does not exist: {verification_path}")
    payload = validate_company_review_alert_completion_evidence(
        args.date, json.loads(completion_path.read_text(encoding="utf-8")),
        external_verifications=json.loads(verification_path.read_text(encoding="utf-8")),
    )
    output = Path(args.output_file) if args.output_file else ROOT / "workspace" / "company_review_alert_completion_evidence_integrity" / args.date / "company_review_alert_completion_evidence_integrity.json"
    _atomic_write(output, payload)
    print(f"Company review alert completion evidence integrity saved: {output.relative_to(ROOT)}")
    print(f"Integrity issues: {payload['reference_integrity_issue_count']} · external verification pending: {payload['external_reference_verification_pending_count']} · manually verified external: {payload['external_references_verified_by_user_or_pm_count']}")


if __name__ == "__main__":
    main()
