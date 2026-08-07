"""Track and rank manually-unverified external completion-evidence references."""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
from datetime import date
from pathlib import Path
from typing import Any

from collectors.common import ROOT
from complete_company_review_alert_followup import validate_completion_registry
from validate_company_review_alert_completion_evidence import validate_completion_evidence_integrity
from verify_company_review_alert_completion_evidence import external_evidence_review_hash
from review_company_review_alert_external_evidence_backlog import (
    backlog_item_review_hash,
    validate_external_evidence_backlog_review_registry,
)

HISTORY_SCHEMA_VERSION = "company_review_alert_external_evidence_backlog_history.v1"
SCHEMA_VERSION = "company_review_alert_external_evidence_backlog.v1"


def _empty_history() -> dict[str, Any]:
    return {"schema_version": HISTORY_SCHEMA_VERSION, "snapshots": []}


def _snapshot_hash(material: dict[str, Any]) -> str:
    return hashlib.sha256(json.dumps(material, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()


def _latest_by_date(history: dict[str, Any]) -> list[dict[str, Any]]:
    latest: dict[str, dict[str, Any]] = {}
    for row in history.get("snapshots", []):
        report_date = str(row["report_date"])
        if report_date not in latest or int(row["revision"]) > int(latest[report_date]["revision"]):
            latest[report_date] = row
    return [latest[key] for key in sorted(latest)]


def validate_company_review_alert_external_evidence_backlog_history(history: dict[str, Any]) -> None:
    if history.get("schema_version") != HISTORY_SCHEMA_VERSION:
        raise ValueError("Unexpected external evidence backlog history schema")
    identifiers: set[str] = set()
    for row in history.get("snapshots", []):
        snapshot_id = str(row.get("snapshot_id") or "")
        if not snapshot_id or snapshot_id in identifiers or int(row.get("revision", 0)) < 1:
            raise ValueError("External evidence backlog history requires unique positive-revision snapshots")
        date.fromisoformat(str(row.get("report_date")))
        material = {key: copy.deepcopy(row.get(key)) for key in ("report_date", "observed_at", "pending_items")}
        if row.get("snapshot_hash") != _snapshot_hash(material):
            raise ValueError("External evidence backlog snapshot hash does not match its material")
        item_keys: set[str] = set()
        for item in row.get("pending_items", []):
            key = str(item.get("item_key") or "")
            if not key or key in item_keys or not item.get("source_reference"):
                raise ValueError("External evidence backlog snapshot requires unique complete items")
            item_keys.add(key)
        identifiers.add(snapshot_id)


def _pending_items(integrity: dict[str, Any], completions: list[dict[str, Any]]) -> list[dict[str, Any]]:
    validate_completion_evidence_integrity(integrity)
    validate_completion_registry(completions)
    completion_map = {row["completion_id"]: row for row in completions}
    pending: list[dict[str, Any]] = []
    for row in integrity.get("rows", []):
        completion = completion_map.get(row.get("completion_id"))
        if completion is None:
            raise ValueError("External evidence backlog integrity row does not match a completion")
        reference_map = {ref["evidence_id"]: ref for ref in completion.get("evidence_references", [])}
        for reference_state in row.get("references", []):
            if reference_state.get("status") != "external_reference_unverified":
                continue
            reference = reference_map.get(reference_state.get("evidence_id"))
            if reference is None:
                raise ValueError("External evidence backlog reference does not match completion evidence")
            evidence_hash = external_evidence_review_hash(completion, reference)
            pending.append({
                "item_key": f"external-evidence:{completion['completion_id']}:{reference['evidence_id']}:{evidence_hash}",
                "completion_id": completion["completion_id"], "alert_key": completion["alert_key"],
                "ticker": completion["ticker"], "completed_by": completion["completed_by"],
                "completed_at": completion["completed_at"], "evidence_id": reference["evidence_id"],
                "source_type": reference["source_type"], "source_reference": reference["source_reference"],
                "limitation": reference["limitation"], "reference_hash": evidence_hash,
            })
    return sorted(pending, key=lambda item: (item["completed_at"], item["ticker"], item["evidence_id"]))


def update_company_review_alert_external_evidence_backlog(
    history: dict[str, Any] | None, integrity: dict[str, Any], completions: list[dict[str, Any]], *, weekly_review_days: int = 7,
    review_records: list[dict[str, Any]] | None = None,
) -> tuple[dict[str, Any], dict[str, Any]]:
    if weekly_review_days < 1:
        raise ValueError("External evidence backlog weekly review days must be at least one")
    updated = copy.deepcopy(history or _empty_history())
    validate_company_review_alert_external_evidence_backlog_history(updated)
    reviews = review_records or []
    validate_external_evidence_backlog_review_registry(reviews)
    pending = _pending_items(integrity, completions)
    material = {"report_date": integrity["report_date"], "observed_at": integrity["observed_at"], "pending_items": pending}
    snapshot_hash = _snapshot_hash(material)
    same_date = [row for row in updated["snapshots"] if row["report_date"] == integrity["report_date"]]
    if not any(row["snapshot_hash"] == snapshot_hash for row in same_date):
        revision = max([int(row["revision"]) for row in same_date], default=0) + 1
        updated["snapshots"].append({"snapshot_id": f"external-evidence:{integrity['report_date']}:v{revision}", "revision": revision, **material, "snapshot_hash": snapshot_hash})
    updated["updated_report_date"] = integrity["report_date"]
    validate_company_review_alert_external_evidence_backlog_history(updated)
    first_seen: dict[str, str] = {}
    for snapshot in _latest_by_date(updated):
        for item in snapshot["pending_items"]:
            first_seen.setdefault(item["item_key"], snapshot["report_date"])
    report_day = date.fromisoformat(integrity["report_date"])
    latest_reviews: dict[str, dict[str, Any]] = {}
    for review in sorted(reviews, key=lambda row: str(row["reviewed_at"])):
        latest_reviews[review["item_key"]] = review
    queue: list[dict[str, Any]] = []
    excluded_count = 0
    excluded_items: list[dict[str, Any]] = []
    for item in pending:
        first_date = first_seen[item["item_key"]]
        age_days = (report_day - date.fromisoformat(first_date)).days
        priority, rank = ("critical", 1) if age_days >= weekly_review_days else (("high", 2) if age_days >= 3 else ("normal", 3))
        row = {
            **item, "first_pending_report_date": first_date, "pending_age_days": age_days,
            "owner": "unassigned", "owner_assignment_required": True,
            "queue_status": "weekly_manual_review_due" if age_days >= weekly_review_days else "manual_review_pending",
            "priority": priority, "priority_rank": rank,
            "required_next_action": "user_or_pm_reviews_external_reference_and_records_hash_bound_verification",
            "security_thesis_readiness": "not_decision_grade", "position_action": "wait_for_proof",
            "automatic_notification_sent": False, "automatic_position_action_allowed": False,
        }
        review = latest_reviews.get(item["item_key"])
        if review and review.get("reviewed_backlog_hash") == backlog_item_review_hash(row):
            row["latest_manual_review_decision"] = review["decision"]
            row["latest_manual_reviewed_at"] = review["reviewed_at"]
            if review["decision"] == "reference_no_longer_relevant":
                excluded_count += 1
                excluded_items.append({
                    "item_key": row["item_key"], "ticker": row["ticker"], "evidence_id": row["evidence_id"],
                    "reference_hash": row["reference_hash"], "review_id": review["review_id"],
                    "reviewed_at": review["reviewed_at"], "reviewed_backlog_hash": review["reviewed_backlog_hash"],
                })
                continue
            if review["decision"] == "alternate_evidence_requested":
                row.update({"queue_status": "alternate_evidence_requested", "priority": "high", "priority_rank": 2, "required_next_action": "supply_alternate_evidence_or_record_manual_external_verification"})
            if review["decision"] == "deferred_pending_recheck" and str(review["deferred_until"]) >= integrity["report_date"]:
                row.update({"queue_status": "deferred_pending_recheck", "priority": "normal", "priority_rank": 3, "required_next_action": "wait_until_manual_recheck_date"})
                row["deferred_until"] = review["deferred_until"]
        queue.append(row)
    queue.sort(key=lambda row: (row["priority_rank"], -row["pending_age_days"], row["ticker"], row["evidence_id"]))
    payload = {
        "schema_version": SCHEMA_VERSION, "report_date": integrity["report_date"], "observed_at": integrity["observed_at"],
        "weekly_review_days": weekly_review_days, "pending_count": len(queue), "reviewed_no_longer_relevant_excluded_count": excluded_count, "reviewed_no_longer_relevant_excluded_items": excluded_items,
        "weekly_manual_review_due_count": sum(row["queue_status"] == "weekly_manual_review_due" for row in queue),
        "critical_count": sum(row["priority"] == "critical" for row in queue), "high_count": sum(row["priority"] == "high" for row in queue),
        "normal_count": sum(row["priority"] == "normal" for row in queue), "queue": queue,
        "methodology": {"latest_revision_per_report_date": True, "external_urls_not_fetched": True, "manual_verification_required": True, "manual_review_decisions_append_only": True, "automatic_notification_sent": False, "automatic_position_action_allowed": False},
        "posture": "operational_external_evidence_backlog_not_investment_action",
    }
    validate_company_review_alert_external_evidence_backlog(payload)
    return updated, payload


def validate_company_review_alert_external_evidence_backlog(payload: dict[str, Any]) -> None:
    if payload.get("schema_version") != SCHEMA_VERSION:
        raise ValueError("Unexpected external evidence backlog schema")
    rows = payload.get("queue", [])
    if int(payload.get("pending_count", -1)) != len(rows):
        raise ValueError("External evidence backlog count does not match queue")
    for field, priority in (("critical_count", "critical"), ("high_count", "high"), ("normal_count", "normal")):
        if int(payload.get(field, -1)) != sum(row.get("priority") == priority for row in rows):
            raise ValueError("External evidence backlog priority count does not match queue")
    if int(payload.get("weekly_manual_review_due_count", -1)) != sum(row.get("queue_status") == "weekly_manual_review_due" for row in rows):
        raise ValueError("External evidence backlog weekly-review count does not match queue")
    excluded_items = payload.get("reviewed_no_longer_relevant_excluded_items", [])
    if int(payload.get("reviewed_no_longer_relevant_excluded_count", -1)) != len(excluded_items):
        raise ValueError("External evidence backlog excluded count does not match items")
    excluded_keys = [str(row.get("item_key") or "") for row in excluded_items]
    if not all(excluded_keys) or len(excluded_keys) != len(set(excluded_keys)):
        raise ValueError("External evidence backlog excluded items require unique identities")
    seen: set[str] = set()
    prior: tuple[int, int, str, str] | None = None
    for row in rows:
        key = str(row.get("item_key") or "")
        sort_key = (int(row.get("priority_rank", 99)), -int(row.get("pending_age_days", -1)), str(row.get("ticker")), str(row.get("evidence_id")))
        if not key or key in seen or (prior and sort_key < prior):
            raise ValueError("External evidence backlog requires unique deterministic queue items")
        if row.get("owner") != "unassigned" or row.get("owner_assignment_required") is not True:
            raise ValueError("External evidence backlog cannot infer a human owner")
        if row.get("security_thesis_readiness") != "not_decision_grade" or row.get("position_action") != "wait_for_proof":
            raise ValueError("External evidence backlog cannot promote security readiness or position action")
        if row.get("automatic_notification_sent") is not False or row.get("automatic_position_action_allowed") is not False:
            raise ValueError("External evidence backlog cannot send or execute unapproved actions")
        seen.add(key); prior = sort_key
    methodology = payload.get("methodology") or {}
    if (methodology.get("external_urls_not_fetched") is not True or methodology.get("manual_verification_required") is not True
            or methodology.get("manual_review_decisions_append_only") is not True):
        raise ValueError("External evidence backlog must disclose manual non-network review limits")


def _atomic_write(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    temporary.replace(path)


def main() -> None:
    parser = argparse.ArgumentParser(description="Build weekly queue for unverified external completion evidence")
    parser.add_argument("--date", required=True); parser.add_argument("--integrity-file"); parser.add_argument("--completion-registry-file")
    parser.add_argument("--history-file"); parser.add_argument("--output-file"); parser.add_argument("--weekly-review-days", type=int, default=7)
    parser.add_argument("--review-registry-file")
    args = parser.parse_args()
    integrity_path = Path(args.integrity_file) if args.integrity_file else ROOT / "workspace" / "company_review_alert_completion_evidence_integrity" / args.date / "company_review_alert_completion_evidence_integrity.json"
    completion_path = Path(args.completion_registry_file) if args.completion_registry_file else ROOT / "company_review_alert_followup_completion_registry.json"
    history_path = Path(args.history_file) if args.history_file else ROOT / "workspace" / "history" / "company_review_alert_external_evidence_backlog_history.json"
    review_path = Path(args.review_registry_file) if args.review_registry_file else ROOT / "company_review_alert_external_evidence_backlog_review_registry.json"
    output_path = Path(args.output_file) if args.output_file else ROOT / "workspace" / "company_review_alert_external_evidence_backlog" / args.date / "company_review_alert_external_evidence_backlog.json"
    for label, path in (("integrity", integrity_path), ("completion registry", completion_path), ("review registry", review_path)):
        if not path.exists(): raise SystemExit(f"Company review alert {label} does not exist: {path}")
    history = json.loads(history_path.read_text(encoding="utf-8")) if history_path.exists() else _empty_history()
    updated, payload = update_company_review_alert_external_evidence_backlog(history, json.loads(integrity_path.read_text(encoding="utf-8")), json.loads(completion_path.read_text(encoding="utf-8")), weekly_review_days=args.weekly_review_days, review_records=json.loads(review_path.read_text(encoding="utf-8")))
    _atomic_write(history_path, updated); _atomic_write(output_path, payload)
    print(f"External evidence backlog history saved: {history_path.relative_to(ROOT)}")
    print(f"External evidence backlog saved: {output_path.relative_to(ROOT)}")


if __name__ == "__main__": main()
