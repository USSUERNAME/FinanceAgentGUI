"""Append a bounded human review decision for an external-evidence backlog item."""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from collectors.common import ROOT

CONFIRMATION_PHRASE = "REVIEW_COMPANY_REVIEW_ALERT_EXTERNAL_EVIDENCE_BACKLOG"
DECISIONS = {"deferred_pending_recheck", "alternate_evidence_requested", "reference_no_longer_relevant"}


def _aware_datetime(value: str) -> datetime:
    parsed = datetime.fromisoformat(value)
    if parsed.utcoffset() is None:
        raise ValueError("External evidence backlog review timestamps must include a timezone offset")
    return parsed


def backlog_item_review_hash(item: dict[str, Any]) -> str:
    material = {key: item.get(key) for key in (
        "item_key", "completion_id", "alert_key", "ticker", "evidence_id", "reference_hash", "first_pending_report_date",
    )}
    return hashlib.sha256(json.dumps(material, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()


def validate_external_evidence_backlog_review_registry(records: list[dict[str, Any]]) -> None:
    identifiers: set[str] = set()
    for row in records:
        review_id = str(row.get("review_id") or "")
        if not review_id or review_id in identifiers:
            raise ValueError("External evidence backlog reviews require unique stable identities")
        if not row.get("item_key") or not row.get("completion_id") or not row.get("evidence_id") or not row.get("reference_hash"):
            raise ValueError("External evidence backlog review requires an exact reference identity")
        if row.get("decision") not in DECISIONS or not str(row.get("reviewed_by") or "").strip() or not str(row.get("note") or "").strip():
            raise ValueError("External evidence backlog review requires a bounded decision, reviewer, and note")
        _aware_datetime(str(row.get("reviewed_at")))
        reviewed_hash = str(row.get("reviewed_backlog_hash") or "")
        if len(reviewed_hash) != 64 or any(character not in "0123456789abcdef" for character in reviewed_hash):
            raise ValueError("External evidence backlog review requires a valid reviewed backlog hash")
        deferred_until = row.get("deferred_until")
        if row["decision"] == "deferred_pending_recheck":
            if not deferred_until:
                raise ValueError("Deferred external evidence backlog review requires a recheck date")
            datetime.fromisoformat(f"{deferred_until}T00:00:00+00:00")
        elif deferred_until is not None:
            raise ValueError("Only deferred external evidence backlog reviews can carry a recheck date")
        if row.get("review_scope") != "operational_backlog_only" or row.get("automatic_position_action_allowed") is not False:
            raise ValueError("External evidence backlog review cannot expand into investment action")
        identifiers.add(review_id)


def review_company_review_alert_external_evidence_backlog(
    item_key: str, backlog: dict[str, Any], expected_backlog_hash: str, reviewed_by: str,
    decision: str, note: str, confirmation: str, existing_records: list[dict[str, Any]] | None = None,
    deferred_until: str | None = None, reviewed_at: str | None = None,
) -> tuple[dict[str, Any], list[dict[str, Any]], dict[str, Any]]:
    if confirmation != CONFIRMATION_PHRASE:
        raise ValueError(f"Actual backlog review requires the exact confirmation phrase {CONFIRMATION_PHRASE}")
    from build_company_review_alert_external_evidence_backlog import validate_company_review_alert_external_evidence_backlog
    validate_company_review_alert_external_evidence_backlog(backlog)
    if decision not in DECISIONS or not str(reviewed_by or "").strip() or not str(note or "").strip():
        raise ValueError("Backlog review requires a bounded decision, named reviewer, and note")
    if decision == "deferred_pending_recheck" and not deferred_until:
        raise ValueError("Deferred backlog review requires --deferred-until")
    if decision != "deferred_pending_recheck" and deferred_until is not None:
        raise ValueError("--deferred-until is only valid for a deferred backlog review")
    selected = next((row for row in backlog.get("queue", []) if row.get("item_key") == item_key), None)
    if selected is None:
        raise ValueError("Backlog review requires a current unresolved external evidence item")
    actual_hash = backlog_item_review_hash(selected)
    if expected_backlog_hash != actual_hash:
        raise ValueError("Expected backlog hash does not match the current backlog item")
    timestamp = reviewed_at or datetime.now(timezone.utc).isoformat()
    _aware_datetime(timestamp)
    records = copy.deepcopy(existing_records or [])
    validate_external_evidence_backlog_review_registry(records)
    record = {
        "review_id": f"external-evidence-backlog-review:{item_key}:{timestamp}",
        "item_key": item_key, "completion_id": selected["completion_id"], "alert_key": selected["alert_key"],
        "ticker": selected["ticker"], "evidence_id": selected["evidence_id"], "reference_hash": selected["reference_hash"],
        "first_pending_report_date": selected["first_pending_report_date"], "decision": decision,
        "reviewed_by": reviewed_by.strip(), "reviewed_at": timestamp, "note": note.strip(),
        "deferred_until": deferred_until, "reviewed_backlog_hash": actual_hash,
        "review_scope": "operational_backlog_only", "automatic_position_action_allowed": False,
    }
    validate_external_evidence_backlog_review_registry([record])
    records.append(record)
    receipt = {
        "schema_version": "company_review_alert_external_evidence_backlog_review_receipt.v1",
        "review_id": record["review_id"], "item_key": item_key, "ticker": record["ticker"],
        "decision": decision, "reviewed_by": record["reviewed_by"], "reviewed_at": timestamp,
        "reviewed_backlog_hash": actual_hash, "security_or_position_action_approved": False,
        "registry_record_count_after_append": len(records),
    }
    return record, records, receipt


def _atomic_write(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    temporary.replace(path)


def main() -> None:
    parser = argparse.ArgumentParser(description="Record a bounded human decision for an external evidence backlog item")
    parser.add_argument("--date", required=True); parser.add_argument("--backlog-file"); parser.add_argument("--registry-file")
    parser.add_argument("--list-open", action="store_true"); parser.add_argument("--item-key"); parser.add_argument("--show-backlog-hash", action="store_true")
    parser.add_argument("--reviewed-by"); parser.add_argument("--decision", choices=sorted(DECISIONS)); parser.add_argument("--note"); parser.add_argument("--deferred-until")
    parser.add_argument("--expected-backlog-hash"); parser.add_argument("--confirm-review", default=""); parser.add_argument("--receipt-file"); parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    backlog_path = Path(args.backlog_file) if args.backlog_file else ROOT / "workspace" / "company_review_alert_external_evidence_backlog" / args.date / "company_review_alert_external_evidence_backlog.json"
    registry_path = Path(args.registry_file) if args.registry_file else ROOT / "company_review_alert_external_evidence_backlog_review_registry.json"
    for label, path in (("backlog", backlog_path), ("review registry", registry_path)):
        if not path.exists(): raise SystemExit(f"Company review alert external evidence {label} does not exist: {path}")
    backlog = json.loads(backlog_path.read_text(encoding="utf-8")); records = json.loads(registry_path.read_text(encoding="utf-8"))
    from build_company_review_alert_external_evidence_backlog import validate_company_review_alert_external_evidence_backlog
    validate_company_review_alert_external_evidence_backlog(backlog); validate_external_evidence_backlog_review_registry(records)
    if args.list_open:
        print(json.dumps([{**{key: row.get(key) for key in ("item_key", "ticker", "evidence_id", "pending_age_days", "queue_status")}, "backlog_hash": backlog_item_review_hash(row)} for row in backlog.get("queue", [])], ensure_ascii=False, indent=2)); return
    if not args.item_key: raise SystemExit("--item-key is required unless --list-open is used")
    selected = next((row for row in backlog.get("queue", []) if row.get("item_key") == args.item_key), None)
    if selected is None: raise SystemExit("--item-key is not a current unresolved backlog item")
    if args.show_backlog_hash:
        print(json.dumps({"item_key": args.item_key, "ticker": selected["ticker"], "backlog_hash": backlog_item_review_hash(selected), "review_executed": False}, ensure_ascii=False, indent=2)); return
    for name, value in (("--reviewed-by", args.reviewed_by), ("--decision", args.decision), ("--note", args.note), ("--expected-backlog-hash", args.expected_backlog_hash)):
        if not value: raise SystemExit(f"{name} is required for backlog review")
    confirmation = args.confirm_review if not args.dry_run else CONFIRMATION_PHRASE
    record, updated, receipt = review_company_review_alert_external_evidence_backlog(args.item_key, backlog, args.expected_backlog_hash, args.reviewed_by, args.decision, args.note, confirmation, records, args.deferred_until)
    print(json.dumps({"item_key": record["item_key"], "decision": record["decision"], "security_or_position_action_approved": False, "dry_run": args.dry_run}, ensure_ascii=False, indent=2))
    if args.dry_run: print("Dry run complete. Registry was not modified."); return
    _atomic_write(registry_path, updated)
    receipt_path = Path(args.receipt_file) if args.receipt_file else ROOT / "workspace" / "company_review_alert_external_evidence_backlog_reviews" / args.date / f"{hashlib.sha256(record['review_id'].encode()).hexdigest()}_review_receipt.json"
    _atomic_write(receipt_path, receipt); print(f"External evidence backlog review appended: {registry_path}"); print(f"External evidence backlog review receipt saved: {receipt_path}")


if __name__ == "__main__": main()
