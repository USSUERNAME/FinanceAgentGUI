"""Explicitly approve one reviewed underwriting draft and append it to the tracked registry."""

from __future__ import annotations

import argparse
import copy
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from collectors.common import ROOT
from build_company_underwriting_drafts import underwriting_draft_hash
from collect_company_underwriting import validate_underwriting_record

CONFIRMATION_PHRASE = "APPROVE_ORIGINAL_UNDERWRITING"


def _find_draft(payload: dict[str, Any], ticker: str) -> dict[str, Any]:
    matches = [
        row for row in payload.get("companies", [])
        if str(row.get("ticker") or "").upper() == ticker.upper()
        and row.get("draft_status") == "ready_for_user_or_pm_review"
        and row.get("draft_record")
    ]
    if len(matches) != 1:
        raise ValueError(f"Exactly one review-ready underwriting draft is required for {ticker.upper()}")
    row = matches[0]
    actual_hash = underwriting_draft_hash(row["draft_record"])
    if row.get("draft_hash") != actual_hash:
        raise ValueError("Stored underwriting draft hash is invalid")
    return row


def _read_registry(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, list):
        raise ValueError("Company underwriting registry must contain a JSON list")
    return payload


def _substantive_review(record: dict[str, Any]) -> None:
    if str(record.get("one_sentence_thesis") or "").strip().lower().startswith("draft:"):
        raise ValueError("Approval requires a reviewed one-sentence thesis without the generated Draft prefix")
    if record.get("variant_perception") == "not_established_requires_user_or_pm_view":
        raise ValueError("Approval requires an explicit variant perception or an explicit no-variant PM conclusion")
    if record.get("horizon") == "requires_user_or_pm_input":
        raise ValueError("Approval requires an explicit investment horizon")
    if not record.get("pillars") or not record.get("kill_criteria"):
        raise ValueError("Approval requires reviewed pillars and kill criteria")


def approve_underwriting_draft(
    draft_payload: dict[str, Any], ticker: str, expected_draft_hash: str,
    approved_by: str, approval_note: str, confirmation: str,
    existing_registry: list[dict[str, Any]] | None = None,
    reviewed_record: dict[str, Any] | None = None,
    one_sentence_thesis: str | None = None, variant_perception: str | None = None,
    horizon: str | None = None, approved_at: str | None = None,
) -> tuple[dict[str, Any], list[dict[str, Any]], dict[str, Any]]:
    if confirmation != CONFIRMATION_PHRASE:
        raise ValueError(f"Actual approval requires the exact confirmation phrase {CONFIRMATION_PHRASE}")
    if not str(approved_by or "").strip() or not str(approval_note or "").strip():
        raise ValueError("Approval requires an approver identity and approval note")
    source_row = _find_draft(draft_payload, ticker)
    if source_row["draft_hash"] != expected_draft_hash:
        raise ValueError("Expected draft hash does not match the current review-ready draft")
    source_record = source_row["draft_record"]
    record = copy.deepcopy(reviewed_record or source_record)
    if str(record.get("ticker") or "").upper() != str(source_record.get("ticker") or "").upper():
        raise ValueError("Reviewed record ticker does not match the source draft")
    if int(record.get("version", 0)) != int(source_record.get("version", 0)):
        raise ValueError("Reviewed record version does not match the source draft")
    if one_sentence_thesis is not None:
        record["one_sentence_thesis"] = one_sentence_thesis.strip()
    if variant_perception is not None:
        record["variant_perception"] = variant_perception.strip()
    if horizon is not None:
        record["horizon"] = horizon.strip()
    _substantive_review(record)
    reviewed_record_hash = underwriting_draft_hash(record)
    timestamp = approved_at or datetime.now(timezone.utc).isoformat()
    approved_day = datetime.fromisoformat(timestamp).date()
    version = int(record["version"])
    ticker_upper = str(record["ticker"]).upper()
    approval_source_id = f"UW-{ticker_upper}-V{version}"
    record.update({
        "underwriting_id": f"company:{ticker_upper}:original:{approved_day.isoformat()}",
        "approval": {
            "status": "approved_by_user_or_pm", "approved_by": approved_by.strip(),
            "approved_at": timestamp, "approval_note": approval_note.strip(),
            "source_draft_hash": expected_draft_hash,
        },
        "approval_lineage": {
            "source_schema_version": draft_payload.get("schema_version"),
            "source_report_date": draft_payload.get("report_date"),
            "source_draft_hash": expected_draft_hash,
            "reviewed_record_hash_before_approval": reviewed_record_hash,
        },
    })
    sources = {str(row.get("source_id")): dict(row) for row in record.get("source_index", []) if row.get("source_id")}
    sources[approval_source_id] = {
        "source_id": approval_source_id,
        "source_name": f"{ticker_upper} user/PM-approved original underwriting v{version}",
        "source_type": "user_provided_internal_research",
        "as_of_date": approved_day.isoformat(),
        "source_location": "company_underwriting_registry.json",
        "reliability": "explicit_user_or_pm_approval",
        "limitation": "Approved internal judgment and monitoring rules; not a verified public-company fact.",
    }
    record["source_index"] = list(sources.values())
    for pillar in record.get("pillars", []):
        pillar["source_ids"] = list(dict.fromkeys([*pillar.get("source_ids", []), approval_source_id]))
        for rule in pillar.get("evidence_rules", []):
            rule["threshold_origin"] = "Inherited threshold"
            rule["threshold_approval_status"] = "Approved monitoring rule"
    for criterion in record.get("kill_criteria", []):
        criterion["source_ids"] = list(dict.fromkeys([*criterion.get("source_ids", []), approval_source_id]))
        criterion["threshold_origin"] = "Inherited threshold"
        criterion["threshold_approval_status"] = "Approved monitoring rule"
    record.setdefault("draft_metadata", {})["approval_conversion"] = "explicit_user_or_pm_reviewed"
    normalized = validate_underwriting_record(record, approved_day)
    registry = copy.deepcopy(existing_registry or [])
    for existing in registry:
        validate_underwriting_record(existing, approved_day)
        if str(existing.get("ticker") or "").upper() == ticker_upper and int(existing.get("version", 0)) == version:
            raise ValueError(f"Registry already contains {ticker_upper} underwriting version {version}")
    registry.append(normalized)
    receipt = {
        "schema_version": "company_underwriting_approval_receipt.v1",
        "ticker": ticker_upper, "underwriting_id": normalized["underwriting_id"],
        "version": version, "approved_by": approved_by.strip(), "approved_at": timestamp,
        "source_draft_hash": expected_draft_hash,
        "registry_record_count_after_append": len(registry),
        "company_thesis_update_allowed": True,
        "security_or_position_action_approved": False,
    }
    return normalized, registry, receipt


def _atomic_write_registry(path: Path, registry: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(registry, ensure_ascii=False, indent=2), encoding="utf-8")
    temporary.replace(path)


def main() -> None:
    parser = argparse.ArgumentParser(description="Explicitly approve and append one company underwriting draft")
    parser.add_argument("--date", required=True)
    parser.add_argument("--ticker", required=True)
    parser.add_argument("--approved-by", required=True)
    parser.add_argument("--approval-note", required=True)
    parser.add_argument("--expected-draft-hash", required=True)
    parser.add_argument("--confirm-approval", default="")
    parser.add_argument("--one-sentence-thesis")
    parser.add_argument("--variant-perception")
    parser.add_argument("--horizon")
    parser.add_argument("--reviewed-draft-file")
    parser.add_argument("--drafts-file")
    parser.add_argument("--registry-file")
    parser.add_argument("--receipt-file")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    drafts_path = Path(args.drafts_file) if args.drafts_file else ROOT / "workspace" / "company_underwriting_drafts" / args.date / "company_underwriting_drafts.json"
    registry_path = Path(args.registry_file) if args.registry_file else ROOT / "company_underwriting_registry.json"
    if not drafts_path.exists():
        raise SystemExit(f"Company underwriting drafts do not exist: {drafts_path}")
    reviewed = None
    if args.reviewed_draft_file:
        reviewed_path = Path(args.reviewed_draft_file)
        if not reviewed_path.exists():
            raise SystemExit(f"Reviewed underwriting draft does not exist: {reviewed_path}")
        reviewed = json.loads(reviewed_path.read_text(encoding="utf-8"))
    confirmation = args.confirm_approval if not args.dry_run else CONFIRMATION_PHRASE
    record, registry, receipt = approve_underwriting_draft(
        json.loads(drafts_path.read_text(encoding="utf-8")), args.ticker,
        args.expected_draft_hash, args.approved_by, args.approval_note, confirmation,
        _read_registry(registry_path), reviewed, args.one_sentence_thesis,
        args.variant_perception, args.horizon,
    )
    print(json.dumps({
        "ticker": record["ticker"], "version": record["version"],
        "underwriting_id": record["underwriting_id"], "approval_status": record["approval"]["status"],
        "source_draft_hash": receipt["source_draft_hash"], "dry_run": args.dry_run,
    }, ensure_ascii=False, indent=2))
    if args.dry_run:
        print("Dry run complete. Registry was not modified.")
        return
    _atomic_write_registry(registry_path, registry)
    receipt_path = Path(args.receipt_file) if args.receipt_file else ROOT / "workspace" / "company_underwriting_approvals" / args.date / f"{record['ticker']}_approval_receipt.json"
    receipt_path.parent.mkdir(parents=True, exist_ok=True)
    receipt_path.write_text(json.dumps(receipt, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Approved underwriting appended: {registry_path.relative_to(ROOT) if registry_path.is_relative_to(ROOT) else registry_path}")
    print(f"Approval receipt saved: {receipt_path.relative_to(ROOT) if receipt_path.is_relative_to(ROOT) else receipt_path}")


if __name__ == "__main__":
    main()
