"""Cross-check the external-evidence integrity, backlog, human reviews, and summary."""

from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from build_company_review_alert_external_evidence_backlog import validate_company_review_alert_external_evidence_backlog
from build_company_review_alert_external_evidence_review_summary import validate_company_review_alert_external_evidence_review_summary
from collectors.common import ROOT
from complete_company_review_alert_followup import validate_completion_registry
from review_company_review_alert_external_evidence_backlog import validate_external_evidence_backlog_review_registry
from validate_company_review_alert_completion_evidence import validate_completion_evidence_integrity
from verify_company_review_alert_completion_evidence import validate_external_evidence_verification_registry

SCHEMA_VERSION = "company_review_alert_external_evidence_operation_audit.v1"


def _aware_datetime(value: str) -> datetime:
    parsed = datetime.fromisoformat(value)
    if parsed.utcoffset() is None:
        raise ValueError("External evidence operation audit timestamps must include a timezone offset")
    return parsed


def audit_company_review_alert_external_evidence_operation(
    integrity: dict[str, Any], backlog: dict[str, Any], summary: dict[str, Any], completions: list[dict[str, Any]],
    verifications: list[dict[str, Any]], reviews: list[dict[str, Any]], *, observed_at: str | None = None,
) -> dict[str, Any]:
    validate_completion_evidence_integrity(integrity); validate_company_review_alert_external_evidence_backlog(backlog)
    validate_company_review_alert_external_evidence_review_summary(summary); validate_completion_registry(completions)
    validate_external_evidence_verification_registry(verifications, completions); validate_external_evidence_backlog_review_registry(reviews)
    if integrity["report_date"] != backlog["report_date"] or backlog["report_date"] != summary["report_date"]:
        raise ValueError("External evidence operation audit requires one shared report date")
    pending_reference_count = sum(
        reference.get("status") == "external_reference_unverified"
        for row in integrity.get("rows", []) for reference in row.get("references", [])
    )
    verified_reference_count = sum(
        reference.get("status") == "external_reference_verified_by_user_or_pm"
        for row in integrity.get("rows", []) for reference in row.get("references", [])
    )
    tracked_pending_count = int(backlog["pending_count"]) + int(backlog["reviewed_no_longer_relevant_excluded_count"])
    if tracked_pending_count != pending_reference_count:
        raise ValueError("External evidence backlog does not reconcile to unverified integrity references")
    active_keys = {str(row["item_key"]) for row in backlog.get("queue", [])}
    excluded_keys = {str(row["item_key"]) for row in backlog.get("reviewed_no_longer_relevant_excluded_items", [])}
    stale_reviews = [
        {"review_id": row["review_id"], "item_key": row["item_key"], "decision": row["decision"], "reviewed_at": row["reviewed_at"]}
        for row in reviews if row["item_key"] not in active_keys | excluded_keys
    ]
    active = summary.get("active_backlog") or {}
    if int(active.get("pending_count", -1)) != int(backlog["pending_count"]):
        raise ValueError("External evidence review summary does not reconcile to backlog count")
    if int(active.get("reviewed_no_longer_relevant_excluded_count", -1)) != int(backlog["reviewed_no_longer_relevant_excluded_count"]):
        raise ValueError("External evidence review summary does not reconcile to excluded backlog count")
    timestamp = observed_at or datetime.now(timezone.utc).isoformat(); _aware_datetime(timestamp)
    payload = {
        "schema_version": SCHEMA_VERSION, "report_date": integrity["report_date"], "observed_at": timestamp,
        "status": "attention_manual_review_refresh_required" if stale_reviews else "pass",
        "reconciliation": {
            "unverified_external_reference_count": pending_reference_count,
            "tracked_pending_backlog_count": tracked_pending_count,
            "human_verified_external_reference_count": verified_reference_count,
            "manual_verification_registry_count": len(verifications),
            "backlog_review_registry_count": len(reviews),
            "stale_backlog_review_count": len(stale_reviews),
        },
        "stale_backlog_reviews": stale_reviews,
        "methodology": {"cross_artifact_reconciliation": True, "external_urls_not_fetched": True, "attention_is_not_automatic_remediation": True, "automatic_notification_sent": False, "automatic_position_action_allowed": False},
        "posture": "operational_external_evidence_audit_not_investment_action",
    }
    validate_company_review_alert_external_evidence_operation_audit(payload)
    return payload


def validate_company_review_alert_external_evidence_operation_audit(payload: dict[str, Any]) -> None:
    if payload.get("schema_version") != SCHEMA_VERSION or payload.get("status") not in {"pass", "attention_manual_review_refresh_required"}:
        raise ValueError("Unexpected external evidence operation audit schema or status")
    _aware_datetime(str(payload["observed_at"]))
    counts = payload.get("reconciliation") or {}
    if int(counts.get("tracked_pending_backlog_count", -1)) != int(counts.get("unverified_external_reference_count", -2)):
        raise ValueError("External evidence operation audit reconciliation does not match")
    stale = payload.get("stale_backlog_reviews", [])
    if int(counts.get("stale_backlog_review_count", -1)) != len(stale):
        raise ValueError("External evidence operation audit stale-review count does not match")
    if (payload["status"] == "pass") != (not stale):
        raise ValueError("External evidence operation audit status does not match stale reviews")
    methodology = payload.get("methodology") or {}
    if methodology.get("cross_artifact_reconciliation") is not True or methodology.get("external_urls_not_fetched") is not True or methodology.get("attention_is_not_automatic_remediation") is not True:
        raise ValueError("External evidence operation audit must disclose its non-network non-remediating limits")
    if methodology.get("automatic_notification_sent") is not False or methodology.get("automatic_position_action_allowed") is not False:
        raise ValueError("External evidence operation audit cannot send or execute unapproved actions")


def _atomic_write(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True); temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8"); temporary.replace(path)


def main() -> None:
    parser = argparse.ArgumentParser(description="Cross-check the external evidence operational review chain")
    parser.add_argument("--date", required=True); parser.add_argument("--integrity-file"); parser.add_argument("--backlog-file"); parser.add_argument("--summary-file"); parser.add_argument("--completion-registry-file"); parser.add_argument("--verification-registry-file"); parser.add_argument("--review-registry-file"); parser.add_argument("--output-file")
    args = parser.parse_args()
    paths = {
        "integrity": Path(args.integrity_file) if args.integrity_file else ROOT / "workspace" / "company_review_alert_completion_evidence_integrity" / args.date / "company_review_alert_completion_evidence_integrity.json",
        "backlog": Path(args.backlog_file) if args.backlog_file else ROOT / "workspace" / "company_review_alert_external_evidence_backlog" / args.date / "company_review_alert_external_evidence_backlog.json",
        "summary": Path(args.summary_file) if args.summary_file else ROOT / "workspace" / "company_review_alert_external_evidence_review_summary" / args.date / "company_review_alert_external_evidence_review_summary.json",
        "completions": Path(args.completion_registry_file) if args.completion_registry_file else ROOT / "company_review_alert_followup_completion_registry.json",
        "verifications": Path(args.verification_registry_file) if args.verification_registry_file else ROOT / "company_review_alert_completion_evidence_verification_registry.json",
        "reviews": Path(args.review_registry_file) if args.review_registry_file else ROOT / "company_review_alert_external_evidence_backlog_review_registry.json",
    }
    for label, path in paths.items():
        if not path.exists(): raise SystemExit(f"External evidence operation audit {label} does not exist: {path}")
    payload = audit_company_review_alert_external_evidence_operation(
        json.loads(paths["integrity"].read_text(encoding="utf-8")), json.loads(paths["backlog"].read_text(encoding="utf-8")), json.loads(paths["summary"].read_text(encoding="utf-8")), json.loads(paths["completions"].read_text(encoding="utf-8")), json.loads(paths["verifications"].read_text(encoding="utf-8")), json.loads(paths["reviews"].read_text(encoding="utf-8")),
    )
    output = Path(args.output_file) if args.output_file else ROOT / "workspace" / "company_review_alert_external_evidence_operation_audit" / args.date / "company_review_alert_external_evidence_operation_audit.json"
    _atomic_write(output, payload); print(f"External evidence operation audit saved: {output.relative_to(ROOT)} · {payload['status']}")


if __name__ == "__main__": main()
