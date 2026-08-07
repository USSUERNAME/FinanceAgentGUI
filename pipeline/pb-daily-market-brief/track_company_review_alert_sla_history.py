"""Append daily rolling-SLA snapshots and build a bounded operational trend view."""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
from datetime import date
from pathlib import Path
from typing import Any

from build_company_review_alert_sla_summary import validate_company_review_alert_sla_summary
from collectors.common import ROOT

HISTORY_SCHEMA_VERSION = "company_review_alert_sla_history.v1"
TREND_SCHEMA_VERSION = "company_review_alert_sla_trend.v1"


def _empty_history() -> dict[str, Any]:
    return {"schema_version": HISTORY_SCHEMA_VERSION, "snapshots": []}


def _snapshot_material(summary: dict[str, Any]) -> dict[str, Any]:
    return {
        "report_date": summary["report_date"], "observed_at": summary["observed_at"],
        "window": copy.deepcopy(summary["window"]), "flow_counts": copy.deepcopy(summary["flow_counts"]),
        "current_backlog": copy.deepcopy(summary["current_backlog"]), "metrics": copy.deepcopy(summary["metrics"]),
    }


def _snapshot_hash(material: dict[str, Any]) -> str:
    encoded = json.dumps(material, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


def validate_company_review_alert_sla_history(history: dict[str, Any]) -> None:
    if history.get("schema_version") != HISTORY_SCHEMA_VERSION:
        raise ValueError("Unexpected company review alert SLA history schema")
    identities: set[str] = set()
    for row in history.get("snapshots", []):
        snapshot_id = str(row.get("snapshot_id") or "")
        if not snapshot_id or snapshot_id in identities:
            raise ValueError("SLA history requires unique append-only snapshot identities")
        material = {key: copy.deepcopy(row.get(key)) for key in (
            "report_date", "observed_at", "window", "flow_counts", "current_backlog", "metrics",
        )}
        if row.get("summary_hash") != _snapshot_hash(material):
            raise ValueError("SLA history snapshot hash does not match its material")
        date.fromisoformat(str(row.get("report_date")))
        if int(row.get("revision", 0)) < 1:
            raise ValueError("SLA history requires positive revisions")
        identities.add(snapshot_id)


def _latest_by_date(history: dict[str, Any]) -> list[dict[str, Any]]:
    latest: dict[str, dict[str, Any]] = {}
    for row in history.get("snapshots", []):
        report_date = str(row["report_date"])
        if report_date not in latest or int(row["revision"]) > int(latest[report_date]["revision"]):
            latest[report_date] = row
    return [latest[key] for key in sorted(latest)]


def update_company_review_alert_sla_history(
    history: dict[str, Any] | None, summary: dict[str, Any], *, trend_limit: int = 8,
) -> tuple[dict[str, Any], dict[str, Any]]:
    if trend_limit < 1:
        raise ValueError("SLA trend limit must be at least one")
    validate_company_review_alert_sla_summary(summary)
    updated = copy.deepcopy(history or _empty_history())
    validate_company_review_alert_sla_history(updated)
    material = _snapshot_material(summary)
    summary_hash = _snapshot_hash(material)
    same_date = [row for row in updated["snapshots"] if row.get("report_date") == summary["report_date"]]
    if not any(row.get("summary_hash") == summary_hash for row in same_date):
        revision = max([int(row.get("revision", 0)) for row in same_date], default=0) + 1
        updated["snapshots"].append({
            "snapshot_id": f"sla:{summary['report_date']}:v{revision}", "revision": revision,
            **material, "summary_hash": summary_hash,
        })
    updated["updated_report_date"] = summary["report_date"]
    validate_company_review_alert_sla_history(updated)
    points = _latest_by_date(updated)[-trend_limit:]
    trend_points = [{
        "report_date": row["report_date"], "window_start": row["window"]["start_date"],
        "window_end": row["window"]["end_date"],
        "completed_in_window": row["flow_counts"]["completed_in_window"],
        "completed_within_due_in_window": row["flow_counts"]["completed_within_due_in_window"],
        "acknowledged_without_assignment": row["current_backlog"]["acknowledged_without_assignment"],
        "active_overdue_followups": row["current_backlog"]["active_overdue_followups"],
        "metrics_status": row["metrics"]["status"],
        "completion_within_due_rate_pct": row["metrics"].get("completion_within_due_rate_pct"),
    } for row in points]
    latest = trend_points[-1] if trend_points else None
    prior = trend_points[-2] if len(trend_points) >= 2 else None
    trend = {
        "schema_version": TREND_SCHEMA_VERSION, "report_date": summary["report_date"],
        "trend_limit": trend_limit, "point_count": len(trend_points), "points": trend_points,
        "latest_backlog_change": {
            "acknowledged_without_assignment_delta": (
                latest["acknowledged_without_assignment"] - prior["acknowledged_without_assignment"]
                if latest and prior else None
            ),
            "active_overdue_followups_delta": (
                latest["active_overdue_followups"] - prior["active_overdue_followups"]
                if latest and prior else None
            ),
        },
        "methodology": {
            "rolling_window_snapshots": True,
            "independent_week_over_week_comparison": False,
            "latest_revision_per_report_date": True,
            "automatic_notification_sent": False,
            "automatic_position_action_allowed": False,
        },
        "posture": "operational_rolling_sla_trend_not_investment_action",
    }
    validate_company_review_alert_sla_trend(trend)
    return updated, trend


def validate_company_review_alert_sla_trend(payload: dict[str, Any]) -> None:
    if payload.get("schema_version") != TREND_SCHEMA_VERSION:
        raise ValueError("Unexpected company review alert SLA trend schema")
    points = payload.get("points", [])
    if int(payload.get("point_count", -1)) != len(points):
        raise ValueError("SLA trend point count does not match rows")
    if len(points) > int(payload.get("trend_limit", 0)):
        raise ValueError("SLA trend exceeds its configured limit")
    dates = [str(row.get("report_date")) for row in points]
    if dates != sorted(dates) or len(dates) != len(set(dates)):
        raise ValueError("SLA trend requires unique chronological report dates")
    methodology = payload.get("methodology") or {}
    if methodology.get("rolling_window_snapshots") is not True or methodology.get("independent_week_over_week_comparison") is not False:
        raise ValueError("SLA trend must disclose rolling-window comparison limits")
    if methodology.get("automatic_notification_sent") is not False or methodology.get("automatic_position_action_allowed") is not False:
        raise ValueError("SLA trend cannot send or execute unapproved actions")
    changes = payload.get("latest_backlog_change") or {}
    if len(points) < 2 and any(value is not None for value in changes.values()):
        raise ValueError("SLA trend cannot claim change without a prior point")


def _atomic_write(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    temporary.replace(path)


def main() -> None:
    parser = argparse.ArgumentParser(description="Track rolling company review alert SLA history")
    parser.add_argument("--date", required=True)
    parser.add_argument("--summary-file")
    parser.add_argument("--history-file")
    parser.add_argument("--output-file")
    parser.add_argument("--trend-limit", type=int, default=8)
    args = parser.parse_args()
    summary_path = Path(args.summary_file) if args.summary_file else ROOT / "workspace" / "company_review_alert_sla_summary" / args.date / "company_review_alert_weekly_sla_summary.json"
    history_path = Path(args.history_file) if args.history_file else ROOT / "workspace" / "history" / "company_review_alert_sla_history.json"
    output_path = Path(args.output_file) if args.output_file else ROOT / "workspace" / "company_review_alert_sla_trend" / args.date / "company_review_alert_sla_trend.json"
    if not summary_path.exists():
        raise SystemExit(f"Company review alert SLA summary does not exist: {summary_path}")
    history = json.loads(history_path.read_text(encoding="utf-8")) if history_path.exists() else _empty_history()
    updated, trend = update_company_review_alert_sla_history(
        history, json.loads(summary_path.read_text(encoding="utf-8")), trend_limit=args.trend_limit,
    )
    _atomic_write(history_path, updated)
    _atomic_write(output_path, trend)
    print(f"Company review alert SLA history saved: {history_path.relative_to(ROOT)}")
    print(f"Company review alert SLA trend saved: {output_path.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
