"""Maintain an append-only history of deterministic sector-thesis states."""

from __future__ import annotations

import argparse
import hashlib
import json
from collections import Counter
from datetime import date
from pathlib import Path
from typing import Any

from collectors.common import ROOT

SCHEMA_VERSION = "sector_thesis_history.v1"
REVIEW_SCHEMA_VERSION = "daily_sector_thesis_review.v1"
NON_MARKET_DIMENSIONS = (
    "industry_leading_data",
    "earnings_revisions",
    "orders_capex_backlog",
    "structural_driver",
    "catalyst_durability",
)
MATERIAL_SCORE_CHANGE = 5.0
MATERIAL_DIMENSION_CHANGE = 5.0


def root_path(value: str | None, default: Path) -> Path:
    path = Path(value) if value else default
    return path if path.is_absolute() else ROOT / path


def _dimension_state(sector: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {
        dimension_id: {
            "score": row.get("score"),
            "status": row.get("status"),
            "confidence": row.get("confidence"),
            "weight": row.get("weight"),
        }
        for dimension_id, row in sector.get("dimension_scores", {}).items()
    }


def _record_from_sector(report_date: str, revision: int, sector: dict[str, Any]) -> dict[str, Any]:
    dimensions = _dimension_state(sector)
    non_market_available = [
        dimension_id for dimension_id in NON_MARKET_DIMENSIONS
        if isinstance((dimensions.get(dimension_id) or {}).get("score"), (int, float))
    ]
    required_missing = list(sector.get("missing_required_dimensions", []))
    return {
        "record_id": f"{report_date}:R{revision}:{sector['sector_id']}",
        "thesis_id": f"sector:{sector['sector_id']}",
        "report_date": report_date,
        "revision": revision,
        "sector_id": sector["sector_id"],
        "name_ko": sector.get("name_ko"),
        "research_state": sector.get("research_state"),
        "leadership_score": sector.get("leadership_score"),
        "ranking_bucket": sector.get("ranking_bucket"),
        "score_status": sector.get("score_status"),
        "available_dimension_weight_pct": sector.get("available_dimension_weight_pct", 0),
        "missing_required_dimensions": required_missing,
        "blockers": list(sector.get("blockers", [])),
        "dimensions": dimensions,
        "non_market_available_dimensions": non_market_available,
        "evidence_source_ids": list(
            (sector.get("evidence_readiness") or {}).get("independent_source_ids", [])
        ),
        "threshold_origin": "draft_system_monitoring_rule",
    }


def _content_hash(records: list[dict[str, Any]]) -> str:
    material = [{key: value for key, value in row.items() if key not in {"record_id", "revision"}} for row in records]
    encoded = json.dumps(material, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _numeric_delta(current: Any, previous: Any) -> float | None:
    if not isinstance(current, (int, float)) or not isinstance(previous, (int, float)):
        return None
    return round(float(current) - float(previous), 2)


def _dimension_changes(current: dict[str, Any], previous: dict[str, Any]) -> tuple[list[str], list[str]]:
    improved: list[str] = []
    deteriorated: list[str] = []
    for dimension_id in NON_MARKET_DIMENSIONS:
        current_score = ((current.get("dimensions") or {}).get(dimension_id) or {}).get("score")
        previous_score = ((previous.get("dimensions") or {}).get(dimension_id) or {}).get("score")
        if isinstance(current_score, (int, float)) and not isinstance(previous_score, (int, float)):
            (improved if float(current_score) >= 50 else deteriorated).append(dimension_id)
            continue
        if not isinstance(current_score, (int, float)) and isinstance(previous_score, (int, float)):
            deteriorated.append(dimension_id)
            continue
        delta = _numeric_delta(current_score, previous_score)
        if delta is not None and delta >= MATERIAL_DIMENSION_CHANGE:
            improved.append(dimension_id)
        elif delta is not None and delta <= -MATERIAL_DIMENSION_CHANGE:
            deteriorated.append(dimension_id)
    return improved, deteriorated


def _transition(current: dict[str, Any], previous: dict[str, Any] | None) -> dict[str, Any]:
    if previous is None:
        return {
            "transition": "baseline_created",
            "company_thesis_status": "untested",
            "leadership_readiness": (
                "scored_research_candidate" if current.get("leadership_score") is not None else "evidence_building"
            ),
            "leadership_score_change": None,
            "improved_non_market_dimensions": [],
            "deteriorated_non_market_dimensions": [],
            "reason": "No prior sector snapshot is available.",
        }

    current_score = current.get("leadership_score")
    previous_score = previous.get("leadership_score")
    score_delta = _numeric_delta(current_score, previous_score)
    improved, deteriorated = _dimension_changes(current, previous)
    weight_delta = int(current.get("available_dimension_weight_pct", 0)) - int(
        previous.get("available_dimension_weight_pct", 0)
    )

    if previous_score is None and current_score is not None:
        transition = "newly_scored"
        company_status = "strengthening" if improved else "intact"
        reason = "The composite evidence gate opened for the first time."
    elif previous_score is not None and current_score is None:
        transition = "score_lost"
        company_status = "watch"
        reason = "The composite evidence gate no longer passes."
    elif deteriorated:
        transition = "thesis_weakening"
        company_status = "impaired" if len(deteriorated) >= 2 else "watch"
        reason = "One or more non-market evidence dimensions deteriorated."
    elif improved:
        transition = "thesis_strengthening"
        company_status = "strengthening"
        reason = "One or more non-market evidence dimensions improved."
    elif score_delta is not None and score_delta >= MATERIAL_SCORE_CHANGE:
        transition = "market_confirmation_only"
        company_status = "intact"
        reason = "The composite score rose without material non-market evidence improvement."
    elif score_delta is not None and score_delta <= -MATERIAL_SCORE_CHANGE:
        transition = "market_weakness_only"
        company_status = "intact"
        reason = "The composite score fell without material non-market evidence deterioration."
    elif weight_delta > 0:
        transition = "evidence_expanding"
        company_status = "intact"
        reason = "Evidence coverage expanded but did not meet a material dimension-change rule."
    elif weight_delta < 0:
        transition = "evidence_contracting"
        company_status = "watch"
        reason = "Evidence coverage contracted but did not meet a material dimension-change rule."
    else:
        transition = "unchanged"
        company_status = "intact" if current_score is not None else "untested"
        reason = "No material deterministic thesis change was detected."

    return {
        "transition": transition,
        "company_thesis_status": company_status,
        "leadership_readiness": (
            "scored_research_candidate" if current_score is not None else "evidence_building"
        ),
        "leadership_score_change": score_delta,
        "improved_non_market_dimensions": improved,
        "deteriorated_non_market_dimensions": deteriorated,
        "reason": reason,
    }


def _latest_prior_records(history: dict[str, Any], report_date: str) -> dict[str, dict[str, Any]]:
    prior_dates = sorted({
        row.get("report_date") for row in history.get("daily_records", [])
        if row.get("report_date") and row["report_date"] < report_date
    })
    if not prior_dates:
        return {}
    prior_date = prior_dates[-1]
    prior_revision = max(
        int(row.get("revision", 1)) for row in history["daily_records"] if row.get("report_date") == prior_date
    )
    return {
        row["sector_id"]: row for row in history["daily_records"]
        if row.get("report_date") == prior_date and int(row.get("revision", 1)) == prior_revision
    }


def summarize(history: dict[str, Any]) -> dict[str, Any]:
    events = history.get("transition_events", [])
    latest_dates = sorted({row.get("report_date") for row in history.get("daily_records", []) if row.get("report_date")})
    return {
        "tracked_report_count": len(latest_dates),
        "transition_counts": dict(sorted(Counter(event.get("transition", "unknown") for event in events).items())),
        "latest_report_date": latest_dates[-1] if latest_dates else None,
        "note": "Transition counts are process monitoring, not investment performance.",
    }


def update_sector_thesis_history(
    history: dict[str, Any], report_date: str, sector_snapshot: dict[str, Any],
) -> tuple[dict[str, Any], dict[str, Any]]:
    daily_records = history.setdefault("daily_records", [])
    transition_events = history.setdefault("transition_events", [])
    same_day_revisions = [
        int(row.get("revision", 1)) for row in daily_records if row.get("report_date") == report_date
    ]
    candidate_revision = max(same_day_revisions, default=0) + 1
    candidates = [
        _record_from_sector(report_date, candidate_revision, sector)
        for sector in sorted(sector_snapshot.get("sectors", []), key=lambda item: item["sector_id"])
    ]
    candidate_hash = _content_hash(candidates)
    existing_runs = [run for run in history.get("runs", []) if run.get("report_date") == report_date]
    existing = next((run for run in existing_runs if run.get("content_hash") == candidate_hash), None)
    if existing:
        revision = int(existing["revision"])
        current_records = [
            row for row in daily_records
            if row.get("report_date") == report_date and int(row.get("revision", 1)) == revision
        ]
        current_events = [
            row for row in transition_events
            if row.get("report_date") == report_date and int(row.get("revision", 1)) == revision
        ]
    else:
        revision = candidate_revision
        current_records = candidates
        prior = _latest_prior_records(history, report_date)
        current_events = []
        for row in current_records:
            state = _transition(row, prior.get(row["sector_id"]))
            event = {
                "event_id": f"{row['record_id']}:transition",
                "report_date": report_date,
                "revision": revision,
                "thesis_id": row["thesis_id"],
                "sector_id": row["sector_id"],
                "name_ko": row.get("name_ko"),
                "threshold_origin": "draft_system_monitoring_rule",
                "review_cadence": "each_successful_daily_report",
                "next_proof_points": [
                    *[f"confirm_persistence:{item}" for item in state["improved_non_market_dimensions"]],
                    *[f"revalidate_or_restore:{item}" for item in state["deteriorated_non_market_dimensions"]],
                    *[f"restore_required_dimension:{item}" for item in row["missing_required_dimensions"]],
                ] or ["recheck_same_evidence_dimensions_next_report"],
                "draft_kill_criterion": (
                    "Composite score gate is lost with non-market evidence deterioration."
                ),
                **state,
            }
            row.update({
                "company_thesis_status": state["company_thesis_status"],
                "leadership_readiness": state["leadership_readiness"],
                "transition": state["transition"],
            })
            current_events.append(event)
        daily_records.extend(current_records)
        transition_events.extend(current_events)
        history.setdefault("runs", []).append({
            "report_date": report_date,
            "revision": revision,
            "content_hash": candidate_hash,
            "record_count": len(current_records),
            "supersedes_revision": revision - 1 if revision > 1 else None,
        })

    material = [event for event in current_events if event["transition"] not in {"baseline_created", "unchanged"}]
    priority = sorted(
        material,
        key=lambda item: (
            0 if item["transition"] in {"score_lost", "thesis_weakening"} else 1,
            -abs(float(item.get("leadership_score_change") or 0)),
            item["sector_id"],
        ),
    )
    scored_watchlist = sorted(
        [row for row in current_records if isinstance(row.get("leadership_score"), (int, float))],
        key=lambda row: (-float(row["leadership_score"]), row["sector_id"]),
    )
    history.update({
        "schema_version": SCHEMA_VERSION,
        "updated_report_date": report_date,
        "summary": summarize(history),
    })
    review = {
        "schema_version": REVIEW_SCHEMA_VERSION,
        "report_date": report_date,
        "revision": revision,
        "is_idempotent_rerun": existing is not None,
        "material_changes": priority,
        "priority_watchlist": [{
            key: row.get(key) for key in (
                "thesis_id", "sector_id", "name_ko", "company_thesis_status",
                "leadership_readiness", "transition", "leadership_score",
                "ranking_bucket", "available_dimension_weight_pct",
            )
        } for row in scored_watchlist[:5]],
        "current_sector_states": [{
            key: row.get(key) for key in (
                "thesis_id", "sector_id", "name_ko", "company_thesis_status",
                "leadership_readiness", "transition", "leadership_score",
                "ranking_bucket", "available_dimension_weight_pct",
                "missing_required_dimensions", "blockers",
            )
        } for row in current_records],
        "monitoring_rules": {
            "material_score_change": MATERIAL_SCORE_CHANGE,
            "material_dimension_change": MATERIAL_DIMENSION_CHANGE,
            "threshold_origin": "draft_system_monitoring_rule",
            "price_only_change_cannot_strengthen_company_thesis": True,
        },
        "cumulative_summary": history["summary"],
        "decision_limit": "Sector research prioritization only; valuation, expectations and portfolio context are absent.",
    }
    return history, review


def main() -> None:
    parser = argparse.ArgumentParser(description="Track deterministic sector theses across daily reports")
    parser.add_argument("--date", default=date.today().isoformat())
    parser.add_argument("--sector-snapshot-file")
    parser.add_argument("--history-file")
    args = parser.parse_args()
    snapshot_path = root_path(
        args.sector_snapshot_file,
        ROOT / "workspace" / "snapshots" / args.date / "sector_snapshot.json",
    )
    history_path = root_path(
        args.history_file,
        ROOT / "workspace" / "history" / "sector_thesis_history.json",
    )
    if not snapshot_path.exists():
        raise SystemExit(f"Sector snapshot does not exist: {snapshot_path}")
    snapshot = json.loads(snapshot_path.read_text(encoding="utf-8"))
    history = json.loads(history_path.read_text(encoding="utf-8")) if history_path.exists() else {}
    history, review = update_sector_thesis_history(history, args.date, snapshot)
    history_path.parent.mkdir(parents=True, exist_ok=True)
    history_path.write_text(json.dumps(history, ensure_ascii=False, indent=2), encoding="utf-8")
    review_dir = history_path.parent / "sector_reviews"
    review_dir.mkdir(parents=True, exist_ok=True)
    review_path = review_dir / f"{args.date}.json"
    review_path.write_text(json.dumps(review, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Sector thesis history saved: {history_path.relative_to(ROOT)}")
    print(f"Daily sector thesis review saved: {review_path.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
