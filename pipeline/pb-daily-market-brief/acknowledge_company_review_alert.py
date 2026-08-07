"""Explicitly acknowledge one eligible company-review operational alert."""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from collectors.common import ROOT
from dispatch_company_review_alerts import (
    ACKNOWLEDGED_STATUS,
    company_review_alert_key,
    validate_acknowledgement_registry,
    validate_delivery_plan,
)
from monitor_company_review_operations import validate_company_review_operations_monitor

CONFIRMATION_PHRASE = "ACKNOWLEDGE_COMPANY_REVIEW_ALERT"


def _aware_datetime(value: str) -> datetime:
    parsed = datetime.fromisoformat(value)
    if parsed.utcoffset() is None:
        raise ValueError("Acknowledgement timestamps must include a timezone offset")
    return parsed


def _eligible_alerts(monitor: dict[str, Any], plan: dict[str, Any]) -> list[dict[str, Any]]:
    validate_company_review_operations_monitor(monitor)
    validate_delivery_plan(plan)
    candidate_keys = {str(row.get("alert_key")) for row in plan.get("candidates", [])}
    previously_sent_keys = {
        str(row.get("alert_key")) for row in plan.get("suppressions", [])
        if row.get("reason") == "exact_alert_already_sent"
    }
    eligible_keys = candidate_keys | previously_sent_keys
    records: list[dict[str, Any]] = []
    for review in monitor.get("reviews", []):
        alert_key = company_review_alert_key(review)
        if alert_key not in eligible_keys:
            continue
        records.append({
            "alert_key": alert_key, "review_id": review.get("review_id"),
            "ticker": review.get("ticker"), "event_name": review.get("event_name"),
            "event_date": review.get("event_date"), "alert_level": review.get("alert_level"),
            "escalation_reasons": list(review.get("escalation_reasons") or []),
            "policy_id": plan.get("approved_policy_id"),
            "policy_version": plan.get("approved_policy_version"),
            "plan_report_date": plan.get("report_date"),
        })
    return records


def acknowledgement_review_hash(alert: dict[str, Any]) -> str:
    reviewed = {
        field: alert.get(field)
        for field in (
            "alert_key", "review_id", "ticker", "event_name", "event_date",
            "alert_level", "escalation_reasons", "policy_id", "policy_version",
            "plan_report_date",
        )
    }
    canonical = json.dumps(reviewed, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def acknowledge_company_review_alert(
    alert_key: str, monitor: dict[str, Any], plan: dict[str, Any],
    expected_review_hash: str, acknowledged_by: str, note: str, confirmation: str,
    existing_registry: list[dict[str, Any]] | None = None,
    acknowledged_at: str | None = None,
) -> tuple[dict[str, Any], list[dict[str, Any]], dict[str, Any]]:
    if confirmation != CONFIRMATION_PHRASE:
        raise ValueError(f"Actual acknowledgement requires the exact confirmation phrase {CONFIRMATION_PHRASE}")
    if not str(acknowledged_by or "").strip() or not str(note or "").strip():
        raise ValueError("Acknowledgement requires a named owner and note")
    eligible = {str(row["alert_key"]): row for row in _eligible_alerts(monitor, plan)}
    selected = eligible.get(alert_key)
    if selected is None:
        raise ValueError("Alert key is not an eligible current-plan critical alert")
    actual_hash = acknowledgement_review_hash(selected)
    if expected_review_hash != actual_hash:
        raise ValueError("Expected review hash does not match the current alert")
    timestamp = acknowledged_at or datetime.now(timezone.utc).isoformat()
    _aware_datetime(timestamp)
    registry = copy.deepcopy(existing_registry or [])
    validate_acknowledgement_registry(registry)
    if any(str(row.get("alert_key")) == alert_key for row in registry):
        raise ValueError("This exact alert is already acknowledged")
    acknowledgement = {
        "acknowledgement_id": f"ack:{alert_key}", "alert_key": alert_key,
        "review_id": selected["review_id"], "ticker": selected["ticker"],
        "status": ACKNOWLEDGED_STATUS, "acknowledged_by": acknowledged_by.strip(),
        "acknowledged_at": timestamp, "note": note.strip(),
        "reviewed_alert_hash": actual_hash,
        "acknowledgement_scope": "operational_review_only",
        "automatic_position_action_allowed": False,
    }
    validate_acknowledgement_registry([acknowledgement])
    registry.append(acknowledgement)
    receipt = {
        "schema_version": "company_review_alert_acknowledgement_receipt.v1",
        "alert_key": alert_key, "review_id": selected["review_id"],
        "ticker": selected["ticker"], "acknowledged_by": acknowledged_by.strip(),
        "acknowledged_at": timestamp, "reviewed_alert_hash": actual_hash,
        "registry_record_count_after_append": len(registry),
        "operational_alert_acknowledged": True,
        "security_or_position_action_approved": False,
    }
    return acknowledgement, registry, receipt


def _atomic_write(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    temporary.replace(path)


def main() -> None:
    parser = argparse.ArgumentParser(description="Explicitly acknowledge a current company review alert")
    parser.add_argument("--date", required=True)
    parser.add_argument("--monitor-file")
    parser.add_argument("--delivery-plan-file")
    parser.add_argument("--registry-file")
    parser.add_argument("--list-eligible", action="store_true")
    parser.add_argument("--alert-key")
    parser.add_argument("--show-review-hash", action="store_true")
    parser.add_argument("--acknowledged-by")
    parser.add_argument("--note")
    parser.add_argument("--expected-review-hash")
    parser.add_argument("--confirm-acknowledgement", default="")
    parser.add_argument("--receipt-file")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    monitor_path = Path(args.monitor_file) if args.monitor_file else ROOT / "workspace" / "company_review_operations_monitor" / args.date / "company_review_operations_monitor.json"
    plan_path = Path(args.delivery_plan_file) if args.delivery_plan_file else ROOT / "workspace" / "company_review_alert_delivery_plans" / args.date / "company_review_alert_delivery_plan.json"
    registry_path = Path(args.registry_file) if args.registry_file else ROOT / "company_review_alert_acknowledgement_registry.json"
    for label, path in (("monitor", monitor_path), ("delivery plan", plan_path), ("acknowledgement registry", registry_path)):
        if not path.exists():
            raise SystemExit(f"Company review alert {label} does not exist: {path}")
    monitor = json.loads(monitor_path.read_text(encoding="utf-8"))
    plan = json.loads(plan_path.read_text(encoding="utf-8"))
    eligible = _eligible_alerts(monitor, plan)
    if args.list_eligible:
        print(json.dumps([
            {
                "alert_key": row["alert_key"], "ticker": row["ticker"],
                "event_date": row["event_date"], "reasons": row["escalation_reasons"],
                "review_hash": acknowledgement_review_hash(row),
            }
            for row in eligible
        ], ensure_ascii=False, indent=2))
        return
    if not args.alert_key:
        raise SystemExit("--alert-key is required unless --list-eligible is used")
    selected = next((row for row in eligible if row["alert_key"] == args.alert_key), None)
    if selected is None:
        raise SystemExit("--alert-key is not an eligible current-plan critical alert")
    if args.show_review_hash:
        print(json.dumps({
            "alert_key": selected["alert_key"], "ticker": selected["ticker"],
            "review_hash": acknowledgement_review_hash(selected), "acknowledgement_executed": False,
        }, ensure_ascii=False, indent=2))
        return
    for name, value in (
        ("--acknowledged-by", args.acknowledged_by), ("--note", args.note),
        ("--expected-review-hash", args.expected_review_hash),
    ):
        if not value:
            raise SystemExit(f"{name} is required for acknowledgement preview or execution")
    registry = json.loads(registry_path.read_text(encoding="utf-8"))
    confirmation = args.confirm_acknowledgement if not args.dry_run else CONFIRMATION_PHRASE
    acknowledgement, updated_registry, receipt = acknowledge_company_review_alert(
        args.alert_key, monitor, plan, args.expected_review_hash,
        args.acknowledged_by, args.note, confirmation, registry,
    )
    print(json.dumps({
        "alert_key": acknowledgement["alert_key"], "ticker": acknowledgement["ticker"],
        "status": acknowledgement["status"],
        "reviewed_alert_hash": acknowledgement["reviewed_alert_hash"],
        "security_or_position_action_approved": False, "dry_run": args.dry_run,
    }, ensure_ascii=False, indent=2))
    if args.dry_run:
        print("Dry run complete. Registry was not modified.")
        return
    _atomic_write(registry_path, updated_registry)
    receipt_path = (
        Path(args.receipt_file) if args.receipt_file else
        ROOT / "workspace" / "company_review_alert_acknowledgements" / args.date /
        f"{acknowledgement['alert_key']}_acknowledgement_receipt.json"
    )
    _atomic_write(receipt_path, receipt)
    print(f"Acknowledgement appended: {registry_path}")
    print(f"Acknowledgement receipt saved: {receipt_path}")


if __name__ == "__main__":
    main()
