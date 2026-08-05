"""Summarize the human review workload for external completion-evidence backlog items."""

from __future__ import annotations

import argparse
import json
from datetime import date
from pathlib import Path
from typing import Any

from build_company_review_alert_external_evidence_backlog import validate_company_review_alert_external_evidence_backlog
from collectors.common import ROOT
from review_company_review_alert_external_evidence_backlog import DECISIONS, validate_external_evidence_backlog_review_registry

SCHEMA_VERSION = "company_review_alert_external_evidence_review_summary.v1"


def build_company_review_alert_external_evidence_review_summary(
    backlog: dict[str, Any], review_records: list[dict[str, Any]], *, window_days: int = 7,
) -> dict[str, Any]:
    if window_days < 1:
        raise ValueError("External evidence review summary window must be at least one day")
    validate_company_review_alert_external_evidence_backlog(backlog)
    validate_external_evidence_backlog_review_registry(review_records)
    report_day = date.fromisoformat(str(backlog["report_date"]))
    window_start = report_day.fromordinal(report_day.toordinal() - window_days + 1)
    in_window = [row for row in review_records if window_start <= date.fromisoformat(str(row["reviewed_at"])[:10]) <= report_day]
    rows = backlog.get("queue") or []
    decision_counts = {decision: sum(row.get("decision") == decision for row in in_window) for decision in sorted(DECISIONS)}
    latest_by_item: dict[str, dict[str, Any]] = {}
    for row in sorted(review_records, key=lambda item: str(item["reviewed_at"])):
        latest_by_item[row["item_key"]] = row
    active_decision_counts = {
        "deferred_pending_recheck": sum(row.get("queue_status") == "deferred_pending_recheck" for row in rows),
        "alternate_evidence_requested": sum(row.get("queue_status") == "alternate_evidence_requested" for row in rows),
    }
    payload = {
        "schema_version": SCHEMA_VERSION, "report_date": backlog["report_date"], "observed_at": backlog["observed_at"],
        "window": {"days": window_days, "start_date": window_start.isoformat(), "end_date": report_day.isoformat()},
        "active_backlog": {
            "pending_count": backlog["pending_count"], "weekly_manual_review_due_count": backlog["weekly_manual_review_due_count"],
            "unreviewed_weekly_manual_review_due_count": sum(row.get("queue_status") == "weekly_manual_review_due" and not row.get("latest_manual_review_decision") for row in rows),
            "deferred_pending_recheck_count": active_decision_counts["deferred_pending_recheck"],
            "alternate_evidence_requested_count": active_decision_counts["alternate_evidence_requested"],
            "reviewed_no_longer_relevant_excluded_count": backlog.get("reviewed_no_longer_relevant_excluded_count", 0),
        },
        "review_flow": {"recorded_in_window_count": len(in_window), "decision_counts": decision_counts, "distinct_reviewers_in_window": len({str(row["reviewed_by"]) for row in in_window})},
        "methodology": {"review_records_append_only": True, "external_urls_not_fetched": True, "backlog_status_only": True, "automatic_notification_sent": False, "automatic_position_action_allowed": False},
        "posture": "operational_external_evidence_review_summary_not_investment_action",
    }
    validate_company_review_alert_external_evidence_review_summary(payload)
    return payload


def validate_company_review_alert_external_evidence_review_summary(payload: dict[str, Any]) -> None:
    if payload.get("schema_version") != SCHEMA_VERSION:
        raise ValueError("Unexpected external evidence review summary schema")
    window = payload.get("window") or {}
    if int(window.get("days", 0)) < 1:
        raise ValueError("External evidence review summary requires a positive window")
    start, end = date.fromisoformat(str(window["start_date"])), date.fromisoformat(str(window["end_date"]))
    if start > end or end != date.fromisoformat(str(payload["report_date"])):
        raise ValueError("External evidence review summary window is inconsistent")
    flow = payload.get("review_flow") or {}
    decision_counts = flow.get("decision_counts") or {}
    if set(decision_counts) != DECISIONS or int(flow.get("recorded_in_window_count", -1)) != sum(int(value) for value in decision_counts.values()):
        raise ValueError("External evidence review summary decision counts do not reconcile")
    active = payload.get("active_backlog") or {}
    if int(active.get("unreviewed_weekly_manual_review_due_count", -1)) > int(active.get("weekly_manual_review_due_count", -1)):
        raise ValueError("External evidence review summary cannot exceed its weekly-due backlog")
    methodology = payload.get("methodology") or {}
    if methodology.get("review_records_append_only") is not True or methodology.get("external_urls_not_fetched") is not True:
        raise ValueError("External evidence review summary must disclose its append-only non-network limits")
    if methodology.get("automatic_notification_sent") is not False or methodology.get("automatic_position_action_allowed") is not False:
        raise ValueError("External evidence review summary cannot send or execute unapproved actions")


def _atomic_write(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    temporary.replace(path)


def main() -> None:
    parser = argparse.ArgumentParser(description="Build weekly operational summary for external evidence backlog reviews")
    parser.add_argument("--date", required=True); parser.add_argument("--backlog-file"); parser.add_argument("--review-registry-file"); parser.add_argument("--output-file"); parser.add_argument("--window-days", type=int, default=7)
    args = parser.parse_args()
    backlog_path = Path(args.backlog_file) if args.backlog_file else ROOT / "workspace" / "company_review_alert_external_evidence_backlog" / args.date / "company_review_alert_external_evidence_backlog.json"
    registry_path = Path(args.review_registry_file) if args.review_registry_file else ROOT / "company_review_alert_external_evidence_backlog_review_registry.json"
    output_path = Path(args.output_file) if args.output_file else ROOT / "workspace" / "company_review_alert_external_evidence_review_summary" / args.date / "company_review_alert_external_evidence_review_summary.json"
    for label, path in (("backlog", backlog_path), ("review registry", registry_path)):
        if not path.exists(): raise SystemExit(f"Company review alert external evidence {label} does not exist: {path}")
    payload = build_company_review_alert_external_evidence_review_summary(json.loads(backlog_path.read_text(encoding="utf-8")), json.loads(registry_path.read_text(encoding="utf-8")), window_days=args.window_days)
    _atomic_write(output_path, payload)
    print(f"External evidence review summary saved: {output_path.relative_to(ROOT)}")


if __name__ == "__main__": main()
