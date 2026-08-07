"""Build a read-only operations manifest for a future PB control console."""

from __future__ import annotations

import argparse
import json
from datetime import datetime
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

from collectors.common import ROOT

FINAL_MARKER = "<!-- REPORT_COMPLETE -->"
SCHEMA_VERSION = "pb_operations_manifest.v1"
QUEUE_SPECS = (
    (
        "company_research",
        "company_research_queue",
        "company_research_queue.json",
        ("advance_count", "candidate_count"),
    ),
    (
        "operating_review",
        "company_review_operating_review_queue",
        "company_review_operating_review_queue.json",
        ("ready_count", "blocked_count"),
    ),
    (
        "operations_attention",
        "company_review_operations_monitor",
        "company_review_operations_monitor.json",
        ("attention_count", "critical_count"),
    ),
    (
        "followup_owner",
        "company_review_alert_owner_queue",
        "company_review_alert_owner_queue.json",
        ("unresolved_count", "critical_count"),
    ),
    (
        "external_evidence",
        "company_review_alert_external_evidence_backlog",
        "company_review_alert_external_evidence_backlog.json",
        ("pending_count", "critical_count"),
    ),
)


def load_json(path: Path) -> dict[str, Any] | list[Any]:
    return json.loads(path.read_text(encoding="utf-8-sig"))


def relative_path(path: Path, root: Path) -> str:
    return path.relative_to(root).as_posix()


def latest_file(directory: Path, pattern: str = "*.json") -> Path | None:
    files = list(directory.glob(pattern))
    return max(files, key=lambda path: path.stat().st_mtime) if files else None


def cached_bundle_status(report_date: str, root: Path) -> dict[str, Any]:
    brief = root / "workspace" / "briefs" / f"{report_date}_리포트.md"
    chart_dir = root / "workspace" / "charts"
    required = (
        brief,
        chart_dir / f"{report_date}_market_pulse.png",
        chart_dir / f"{report_date}_macro_dashboard.png",
        chart_dir / f"{report_date}_etf_dashboard_labeled.png",
        chart_dir / f"{report_date}_etf_relative_strength.png",
        chart_dir / f"{report_date}_international_news_manifest.json",
    )
    missing = [relative_path(path, root) for path in required if not path.exists()]
    complete_marker = (
        brief.exists()
        and brief.read_text(encoding="utf-8-sig").rstrip().endswith(FINAL_MARKER)
    )
    if brief.exists() and not complete_marker:
        missing.append("report_completion_marker")
    return {
        "available": not missing,
        "brief_path": relative_path(brief, root),
        "brief_available": brief.exists(),
        "completion_marker_present": complete_marker,
        "missing": missing,
    }


def source_status(report_date: str, root: Path) -> dict[str, Any]:
    status_file = latest_file(root / "workspace" / "source_status" / report_date)
    if status_file is None:
        return {
            "available": False,
            "path": None,
            "generated_at": None,
            "summary": {},
            "sources": [],
        }
    payload = load_json(status_file)
    if not isinstance(payload, dict):
        raise ValueError(f"Source status must be an object: {status_file}")
    sources = []
    for item in payload.get("sources", []):
        if not isinstance(item, dict):
            continue
        sources.append({
            "source_id": item.get("source_id"),
            "status": item.get("status"),
            "item_count": int(item.get("item_count") or 0),
            "notice_category": item.get("notice_category"),
            "elapsed_seconds": item.get("elapsed_seconds"),
            "timeout_seconds": item.get("timeout_seconds"),
        })
    counts: dict[str, int] = {}
    for item in sources:
        status = str(item.get("status") or "unknown")
        counts[status] = counts.get(status, 0) + 1
    return {
        "available": True,
        "path": relative_path(status_file, root),
        "generated_at": payload.get("generated_at"),
        "summary": {
            "source_count": len(sources),
            "status_counts": counts,
            "collected_record_count": int(payload.get("collected_record_count") or 0),
            "canonical_record_count": int(payload.get("canonical_record_count") or 0),
            "filtered_record_count": int(payload.get("filtered_record_count") or 0),
            "duplicate_record_count": int(payload.get("duplicate_record_count") or 0),
        },
        "sources": sources,
    }


def review_queues(report_date: str, root: Path) -> dict[str, Any]:
    queues = []
    total_active = 0
    total_critical = 0
    for queue_id, directory, filename, count_fields in QUEUE_SPECS:
        path = root / "workspace" / directory / report_date / filename
        if not path.exists():
            queues.append({
                "queue_id": queue_id,
                "available": False,
                "path": relative_path(path, root),
                "counts": {},
                "active_count": 0,
            })
            continue
        payload = load_json(path)
        if not isinstance(payload, dict):
            raise ValueError(f"Review queue must be an object: {path}")
        counts = {
            field: int(payload.get(field) or 0)
            for field in count_fields
        }
        active_count = counts[count_fields[0]]
        critical_count = int(payload.get("critical_count") or 0)
        total_active += active_count
        total_critical += critical_count
        queues.append({
            "queue_id": queue_id,
            "available": True,
            "path": relative_path(path, root),
            "counts": counts,
            "active_count": active_count,
        })
    return {
        "active_count": total_active,
        "critical_count": total_critical,
        "queues": queues,
    }


def radar_status(report_date: str, root: Path) -> dict[str, Any]:
    triage_dir = root / "workspace" / "triaged" / report_date
    audit_path = triage_dir / "triage_audit.json"
    clusters_path = triage_dir / "event_clusters.json"
    matches_path = (
        root
        / "workspace"
        / "event_evidence"
        / report_date
        / "event_source_matches.json"
    )
    audit = load_json(audit_path) if audit_path.exists() else {}
    clusters_payload = load_json(clusters_path) if clusters_path.exists() else {}
    matches_payload = load_json(matches_path) if matches_path.exists() else {}
    audit = audit if isinstance(audit, dict) else {}
    clusters_payload = clusters_payload if isinstance(clusters_payload, dict) else {}
    matches_payload = matches_payload if isinstance(matches_payload, dict) else {}
    discovery_clusters = [
        item
        for item in clusters_payload.get("clusters", [])
        if isinstance(item, dict)
        and item.get("verification_status") == "discovery_metadata_only"
    ]
    resolution_counts = {
        str(key): int(value or 0)
        for key, value in (matches_payload.get("resolution_counts") or {}).items()
    }
    return {
        "available": audit_path.exists() or clusters_path.exists(),
        "publication_blocked_candidate_count": len(
            audit.get("publication_blocked_record_ids") or []
        ),
        "discovery_only_cluster_count": len(discovery_clusters),
        "source_resolution_counts": resolution_counts,
        "requires_primary_source_count": resolution_counts.get("search_required", 0),
        "paths": {
            "triage_audit": relative_path(audit_path, root),
            "event_clusters": relative_path(clusters_path, root),
            "event_source_matches": relative_path(matches_path, root),
        },
    }


def continuity_memory_status(root: Path) -> dict[str, Any]:
    path = root / "workspace" / "history" / "continuity_memory.json"
    if not path.exists():
        return {
            "available": False,
            "path": relative_path(path, root),
            "updated_report_date": None,
            "entry_count": 0,
            "state_counts": {},
            "kind_counts": {},
            "automatic_model_mutation_allowed": False,
        }
    payload = load_json(path)
    if not isinstance(payload, dict):
        raise ValueError(f"Continuity memory must be an object: {path}")
    summary = payload.get("summary") or {}
    policy = payload.get("policy") or {}
    return {
        "available": True,
        "path": relative_path(path, root),
        "updated_report_date": payload.get("updated_report_date"),
        "entry_count": int(summary.get("entry_count") or 0),
        "state_counts": {
            str(key): int(value or 0)
            for key, value in (summary.get("state_counts") or {}).items()
        },
        "kind_counts": {
            str(key): int(value or 0)
            for key, value in (summary.get("kind_counts") or {}).items()
        },
        "automatic_model_mutation_allowed": bool(
            policy.get("model_automatic_mutation_allowed", False)
        ),
    }


def broker_research_cache_status(
    report_date: str,
    root: Path,
) -> dict[str, Any]:
    path = (
        root
        / "workspace"
        / "broker_research_analysis"
        / report_date
        / "broker_research_analysis.json"
    )
    unavailable = {
        "available": False,
        "path": relative_path(path, root),
        "generated_at": None,
        "analysis_status": "not_available",
        "report_count": 0,
        "cache_hit_count": 0,
        "cache_miss_count": 0,
        "cache_write_count": 0,
        "all_reports_reused": False,
        "api_request_performed": False,
        "api_total_tokens": 0,
        "model": None,
        "prompt_version": None,
        "source_text_cached": False,
    }
    if not path.exists():
        return unavailable
    payload = load_json(path)
    if not isinstance(payload, dict):
        raise ValueError(f"Broker research analysis must be an object: {path}")
    cache = payload.get("cache") or {}
    usage = payload.get("usage") or {}
    report_count = int(payload.get("report_count") or 0)
    hits = int(cache.get("hit_count") or 0)
    misses = int(cache.get("miss_count") or 0)
    writes = int(cache.get("write_count") or 0)
    total_tokens = int(usage.get("total_tokens") or 0)
    return {
        "available": True,
        "path": relative_path(path, root),
        "generated_at": payload.get("generated_at"),
        "analysis_status": str(payload.get("status") or "unknown"),
        "report_count": report_count,
        "cache_hit_count": hits,
        "cache_miss_count": misses,
        "cache_write_count": writes,
        "all_reports_reused": (
            payload.get("status") == "complete"
            and report_count > 0
            and hits == report_count
            and misses == 0
        ),
        "api_request_performed": misses > 0 or total_tokens > 0,
        "api_total_tokens": total_tokens,
        "model": cache.get("model"),
        "prompt_version": cache.get("prompt_version"),
        "source_text_cached": bool(cache.get("source_text_cached", False)),
    }


def report_catalog(root: Path, limit: int = 30) -> list[dict[str, Any]]:
    records = []
    specs = (
        (
            "v2_reader",
            root / "workspace" / "v2_reader_reports",
            "*/reader_report.md",
        ),
        ("reader", root / "workspace" / "briefs", "*_리포트.md"),
        ("operations", root / "workspace" / "operations_reports", "*_operations.md"),
        (
            "intelligence",
            root / "workspace" / "intelligence",
            "*/daily_intelligence.json",
        ),
    )
    for audience, directory, pattern in specs:
        for path in directory.glob(pattern):
            report_date = (
                path.parent.name
                if audience in {"intelligence", "v2_reader"}
                else path.name[:10]
            )
            try:
                datetime.fromisoformat(report_date)
            except ValueError:
                continue
            records.append({
                "report_date": report_date,
                "audience": audience,
                "format": path.suffix.lstrip("."),
                "title": (
                    f"{report_date} PB 시장 리포트"
                    if audience == "reader"
                    else (
                        f"{report_date} 내부 운영 로그"
                        if audience == "operations"
                        else f"{report_date} Daily Intelligence"
                    )
                ),
                "path": relative_path(path, root),
                "size_bytes": path.stat().st_size,
            })
            if audience == "v2_reader":
                records[-1]["title"] = (
                    f"{report_date} V2 Daily Market Intelligence"
                )
    return sorted(
        records,
        key=lambda item: (item["report_date"], item["audience"]),
        reverse=True,
    )[:limit]


def build_manifest(
    report_date: str,
    *,
    run_mode: str,
    root: Path = ROOT,
    generated_at: str | None = None,
) -> dict[str, Any]:
    bundle = cached_bundle_status(report_date, root)
    sources = source_status(report_date, root)
    queues = review_queues(report_date, root)
    operations_path = (
        root / "workspace" / "operations_reports" / f"{report_date}_operations.md"
    )
    intelligence_path = (
        root
        / "workspace"
        / "intelligence"
        / report_date
        / "daily_intelligence.json"
    )
    task_plan_path = intelligence_path.parent / "research_task_plan.json"
    execution_pack_path = intelligence_path.parent / "research_execution_pack.json"
    v2_reader_path = (
        root
        / "workspace"
        / "v2_reader_reports"
        / report_date
        / "reader_report.md"
    )
    task_plan = (
        load_json(task_plan_path)
        if task_plan_path.exists()
        else {}
    )
    task_plan = task_plan if isinstance(task_plan, dict) else {}
    execution_pack = (
        load_json(execution_pack_path)
        if execution_pack_path.exists()
        else {}
    )
    execution_pack = execution_pack if isinstance(execution_pack, dict) else {}
    if not bundle["available"]:
        run_status = "incomplete"
    elif queues["critical_count"] > 0:
        run_status = "review_required"
    else:
        run_status = "ready"
    return {
        "schema_version": SCHEMA_VERSION,
        "report_date": report_date,
        "generated_at": generated_at or datetime.now(ZoneInfo("Asia/Seoul")).isoformat(),
        "run": {
            "mode": run_mode,
            "status": run_status,
            "publication_eligible": bundle["available"],
        },
        "artifacts": {
            "publication_bundle": bundle,
            "operations_report": {
                "available": operations_path.exists(),
                "path": relative_path(operations_path, root),
            },
            "daily_intelligence": {
                "available": intelligence_path.exists(),
                "path": relative_path(intelligence_path, root),
            },
            "research_task_plan": {
                "available": task_plan_path.exists(),
                "path": relative_path(task_plan_path, root),
                "summary": task_plan.get("summary") or {},
            },
            "research_execution_pack": {
                "available": execution_pack_path.exists(),
                "path": relative_path(execution_pack_path, root),
                "summary": execution_pack.get("summary") or {},
            },
            "v2_reader_report": {
                "available": v2_reader_path.exists(),
                "path": relative_path(v2_reader_path, root),
            },
        },
        "source_status": sources,
        "broker_research_cache": broker_research_cache_status(
            report_date,
            root,
        ),
        "breaking_news_radar": radar_status(report_date, root),
        "continuity_memory": continuity_memory_status(root),
        "review_queues": queues,
        "report_catalog": report_catalog(root),
        "allowed_actions": [
            {
                "action_id": "open_reader_report",
                "enabled": bundle["brief_available"],
                "mutates_external_state": False,
            },
            {
                "action_id": "open_operations_report",
                "enabled": operations_path.exists(),
                "mutates_external_state": False,
            },
            {
                "action_id": "open_daily_intelligence",
                "enabled": intelligence_path.exists(),
                "mutates_external_state": False,
            },
            {
                "action_id": "open_research_task_plan",
                "enabled": task_plan_path.exists(),
                "mutates_external_state": False,
            },
            {
                "action_id": "open_research_execution_pack",
                "enabled": execution_pack_path.exists(),
                "mutates_external_state": False,
            },
            {
                "action_id": "open_v2_reader_report",
                "enabled": v2_reader_path.exists(),
                "mutates_external_state": False,
            },
            {
                "action_id": "publish_cached",
                "enabled": bundle["available"],
                "mutates_external_state": True,
                "requires_operator_confirmation": True,
            },
        ],
        "policy": {
            "read_only_manifest": True,
            "contains_report_body": False,
            "contains_secret_values": False,
            "automatic_publication": False,
            "reader_and_operations_artifacts_separated": True,
        },
    }


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Build the read-only PB operations manifest"
    )
    parser.add_argument("--date", required=True)
    parser.add_argument(
        "--run-mode",
        choices=("publish", "dry_run", "verification_dry_run", "publish_cached"),
        default="publish",
    )
    args = parser.parse_args()
    manifest = build_manifest(args.date, run_mode=args.run_mode)
    output = (
        ROOT
        / "workspace"
        / "operations_manifest"
        / args.date
        / "operations_manifest.json"
    )
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"Operations manifest saved: {output.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
