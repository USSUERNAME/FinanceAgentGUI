"""Record a human/PM review of one external completion-evidence reference.

This tool deliberately does not fetch URLs.  It records a bounded manual review
against an immutable hash of one already-completed operational follow-up.
"""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from collectors.common import ROOT
from complete_company_review_alert_followup import validate_completion_registry

CONFIRMATION_PHRASE = "VERIFY_COMPANY_REVIEW_ALERT_EXTERNAL_EVIDENCE"
SCHEMA_VERSION = "company_review_alert_completion_evidence_verification.v1"


def _aware_datetime(value: str) -> datetime:
    parsed = datetime.fromisoformat(value)
    if parsed.utcoffset() is None:
        raise ValueError("External evidence verification timestamps must include a timezone offset")
    return parsed


def _is_external_reference(reference: dict[str, Any]) -> bool:
    return str(reference.get("source_reference") or "").strip().startswith(("https://", "http://"))


def external_evidence_review_hash(completion: dict[str, Any], reference: dict[str, Any]) -> str:
    """Hash the exact external reference a person says they reviewed."""
    reviewed = {
        "completion_id": completion.get("completion_id"),
        "alert_key": completion.get("alert_key"),
        "ticker": completion.get("ticker"),
        "completed_at": completion.get("completed_at"),
        "evidence_id": reference.get("evidence_id"),
        "source_type": reference.get("source_type"),
        "source_reference": reference.get("source_reference"),
        "limitation": reference.get("limitation"),
    }
    canonical = json.dumps(reviewed, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _external_candidates(completions: list[dict[str, Any]]) -> dict[tuple[str, str], tuple[dict[str, Any], dict[str, Any]]]:
    validate_completion_registry(completions)
    candidates: dict[tuple[str, str], tuple[dict[str, Any], dict[str, Any]]] = {}
    for completion in completions:
        for reference in completion.get("evidence_references") or []:
            if _is_external_reference(reference):
                candidates[(completion["completion_id"], reference["evidence_id"])] = (completion, reference)
    return candidates


def validate_external_evidence_verification_registry(
    records: list[dict[str, Any]], completions: list[dict[str, Any]] | None = None,
) -> None:
    candidates = _external_candidates(completions) if completions is not None else None
    verification_ids: set[str] = set()
    reviewed_references: set[tuple[str, str]] = set()
    for row in records:
        verification_id = str(row.get("verification_id") or "")
        completion_id = str(row.get("completion_id") or "")
        evidence_id = str(row.get("evidence_id") or "")
        identity = (completion_id, evidence_id)
        if not verification_id or verification_id in verification_ids:
            raise ValueError("External evidence verification requires a unique stable identity")
        if not completion_id or not evidence_id or identity in reviewed_references:
            raise ValueError("An external completion evidence reference can be manually verified only once")
        if row.get("status") != "verified_by_user_or_pm":
            raise ValueError("External evidence verification must use the explicit manual-review status")
        if not row.get("alert_key") or not row.get("ticker") or not str(row.get("verified_by") or "").strip():
            raise ValueError("External evidence verification requires review identity and named verifier")
        _aware_datetime(str(row.get("verified_at")))
        if not str(row.get("verification_note") or "").strip():
            raise ValueError("External evidence verification requires a concise review note")
        reviewed_hash = str(row.get("reviewed_evidence_hash") or "")
        if len(reviewed_hash) != 64 or any(character not in "0123456789abcdef" for character in reviewed_hash):
            raise ValueError("External evidence verification requires a valid reviewed evidence hash")
        if row.get("verification_scope") != "operational_reference_only":
            raise ValueError("External evidence verification cannot expand beyond operational reference review")
        if row.get("automatic_position_action_allowed") is not False:
            raise ValueError("External evidence verification cannot authorize a position action")
        if candidates is not None:
            candidate = candidates.get(identity)
            if candidate is None:
                raise ValueError("External evidence verification does not match a current external completion reference")
            completion, reference = candidate
            if row.get("alert_key") != completion["alert_key"] or row.get("ticker") != completion["ticker"]:
                raise ValueError("External evidence verification identity does not match its completion")
            if reviewed_hash != external_evidence_review_hash(completion, reference):
                raise ValueError("External evidence verification hash does not match the current reference")
        verification_ids.add(verification_id)
        reviewed_references.add(identity)


def list_external_evidence_candidates(
    completions: list[dict[str, Any]], records: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    candidates = _external_candidates(completions)
    validate_external_evidence_verification_registry(records, completions)
    verified = {(row["completion_id"], row["evidence_id"]): row for row in records}
    result: list[dict[str, Any]] = []
    for identity, (completion, reference) in candidates.items():
        verification = verified.get(identity)
        result.append({
            "completion_id": completion["completion_id"], "alert_key": completion["alert_key"],
            "ticker": completion["ticker"], "evidence_id": reference["evidence_id"],
            "source_type": reference["source_type"], "source_reference": reference["source_reference"],
            "limitation": reference["limitation"],
            "reviewed_evidence_hash": external_evidence_review_hash(completion, reference),
            "manual_verification_status": "verified_by_user_or_pm" if verification else "pending_manual_review",
            "verified_by": verification.get("verified_by") if verification else None,
            "verified_at": verification.get("verified_at") if verification else None,
        })
    return result


def verify_company_review_alert_completion_evidence(
    completion_id: str, evidence_id: str, completions: list[dict[str, Any]],
    expected_evidence_hash: str, verified_by: str, verification_note: str, confirmation: str,
    existing_records: list[dict[str, Any]] | None = None, verified_at: str | None = None,
) -> tuple[dict[str, Any], list[dict[str, Any]], dict[str, Any]]:
    if confirmation != CONFIRMATION_PHRASE:
        raise ValueError(f"Actual manual verification requires the exact confirmation phrase {CONFIRMATION_PHRASE}")
    if not str(verified_by or "").strip() or not str(verification_note or "").strip():
        raise ValueError("Manual verification requires a named verifier and review note")
    candidates = _external_candidates(completions)
    selected = candidates.get((completion_id, evidence_id))
    if selected is None:
        raise ValueError("Manual verification requires a current external completion evidence reference")
    completion, reference = selected
    actual_hash = external_evidence_review_hash(completion, reference)
    if expected_evidence_hash != actual_hash:
        raise ValueError("Expected evidence hash does not match the current external reference")
    timestamp = verified_at or datetime.now(timezone.utc).isoformat()
    _aware_datetime(timestamp)
    registry = copy.deepcopy(existing_records or [])
    validate_external_evidence_verification_registry(registry, completions)
    if any(row.get("completion_id") == completion_id and row.get("evidence_id") == evidence_id for row in registry):
        raise ValueError("This external completion evidence reference is already manually verified")
    record = {
        "verification_id": f"external-evidence-verification:{completion_id}:{evidence_id}",
        "completion_id": completion_id, "alert_key": completion["alert_key"], "ticker": completion["ticker"],
        "evidence_id": evidence_id, "status": "verified_by_user_or_pm",
        "verified_by": verified_by.strip(), "verified_at": timestamp, "verification_note": verification_note.strip(),
        "reviewed_evidence_hash": actual_hash, "verification_scope": "operational_reference_only",
        "automatic_position_action_allowed": False,
    }
    validate_external_evidence_verification_registry([record], completions)
    registry.append(record)
    receipt = {
        "schema_version": "company_review_alert_completion_evidence_verification_receipt.v1",
        "completion_id": completion_id, "alert_key": completion["alert_key"], "ticker": completion["ticker"],
        "evidence_id": evidence_id, "verified_by": verified_by.strip(), "verified_at": timestamp,
        "reviewed_evidence_hash": actual_hash, "external_url_fetched_by_automation": False,
        "security_or_position_action_approved": False, "registry_record_count_after_append": len(registry),
    }
    return record, registry, receipt


def _atomic_write(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    temporary.replace(path)


def main() -> None:
    parser = argparse.ArgumentParser(description="Record a manual review of one external completion evidence URL")
    parser.add_argument("--date", required=True)
    parser.add_argument("--completion-registry-file")
    parser.add_argument("--registry-file")
    parser.add_argument("--list-external", action="store_true")
    parser.add_argument("--completion-id")
    parser.add_argument("--evidence-id")
    parser.add_argument("--show-evidence-hash", action="store_true")
    parser.add_argument("--verified-by")
    parser.add_argument("--verification-note")
    parser.add_argument("--expected-evidence-hash")
    parser.add_argument("--confirm-verification", default="")
    parser.add_argument("--receipt-file")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    completion_path = Path(args.completion_registry_file) if args.completion_registry_file else ROOT / "company_review_alert_followup_completion_registry.json"
    registry_path = Path(args.registry_file) if args.registry_file else ROOT / "company_review_alert_completion_evidence_verification_registry.json"
    for label, path in (("completion registry", completion_path), ("manual verification registry", registry_path)):
        if not path.exists():
            raise SystemExit(f"Company review alert {label} does not exist: {path}")
    completions = json.loads(completion_path.read_text(encoding="utf-8"))
    registry = json.loads(registry_path.read_text(encoding="utf-8"))
    candidates = list_external_evidence_candidates(completions, registry)
    if args.list_external:
        print(json.dumps(candidates, ensure_ascii=False, indent=2))
        return
    if not args.completion_id or not args.evidence_id:
        raise SystemExit("--completion-id and --evidence-id are required unless --list-external is used")
    selected = next((row for row in candidates if row["completion_id"] == args.completion_id and row["evidence_id"] == args.evidence_id), None)
    if selected is None:
        raise SystemExit("--completion-id and --evidence-id do not identify a current external reference")
    if args.show_evidence_hash:
        print(json.dumps({**selected, "verification_executed": False}, ensure_ascii=False, indent=2))
        return
    for name, value in (("--verified-by", args.verified_by), ("--verification-note", args.verification_note), ("--expected-evidence-hash", args.expected_evidence_hash)):
        if not value:
            raise SystemExit(f"{name} is required for manual verification")
    confirmation = args.confirm_verification if not args.dry_run else CONFIRMATION_PHRASE
    record, updated_registry, receipt = verify_company_review_alert_completion_evidence(
        args.completion_id, args.evidence_id, completions, args.expected_evidence_hash,
        args.verified_by, args.verification_note, confirmation, registry,
    )
    print(json.dumps({
        "completion_id": record["completion_id"], "ticker": record["ticker"], "evidence_id": record["evidence_id"],
        "status": record["status"], "external_url_fetched_by_automation": False,
        "security_or_position_action_approved": False, "dry_run": args.dry_run,
    }, ensure_ascii=False, indent=2))
    if args.dry_run:
        print("Dry run complete. Registry was not modified.")
        return
    _atomic_write(registry_path, updated_registry)
    receipt_path = Path(args.receipt_file) if args.receipt_file else ROOT / "workspace" / "company_review_alert_completion_evidence_verifications" / args.date / f"{record['completion_id']}_{record['evidence_id']}_verification_receipt.json"
    _atomic_write(receipt_path, receipt)
    print(f"Manual evidence verification appended: {registry_path}")
    print(f"Manual evidence verification receipt saved: {receipt_path}")


if __name__ == "__main__":
    main()
