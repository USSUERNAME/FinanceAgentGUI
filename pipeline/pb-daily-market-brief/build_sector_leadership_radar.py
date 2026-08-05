"""Build a persistence-aware sector research funnel from append-only thesis history."""

from __future__ import annotations

import argparse
import json
from datetime import date
from pathlib import Path
from statistics import median
from typing import Any

from collectors.common import ROOT

SCHEMA_VERSION = "sector_leadership_radar.v1"
LOOKBACK_REPORTS = 5
MINIMUM_HISTORY_REPORTS = 3
PERSISTENT_MINIMUM_REPORTS = 5
ADVERSE_TRANSITIONS = {"score_lost", "thesis_weakening", "evidence_contracting"}


def root_path(value: str | None, default: Path) -> Path:
    path = Path(value) if value else default
    return path if path.is_absolute() else ROOT / path


def latest_daily_records(history: dict[str, Any], through_date: str) -> dict[str, list[dict[str, Any]]]:
    """Return one latest revision per sector/report date, bounded by the requested date."""
    records = [
        row for row in history.get("daily_records", [])
        if row.get("report_date") and row["report_date"] <= through_date
    ]
    revisions: dict[str, int] = {}
    for row in records:
        report_date = row["report_date"]
        revisions[report_date] = max(revisions.get(report_date, 0), int(row.get("revision", 1)))
    by_sector: dict[str, list[dict[str, Any]]] = {}
    for row in records:
        if int(row.get("revision", 1)) != revisions[row["report_date"]]:
            continue
        by_sector.setdefault(row["sector_id"], []).append(row)
    for rows in by_sector.values():
        rows.sort(key=lambda row: row["report_date"])
    return by_sector


def latest_transition_events(history: dict[str, Any], through_date: str) -> dict[tuple[str, str], dict[str, Any]]:
    revisions: dict[str, int] = {}
    events = [
        row for row in history.get("transition_events", [])
        if row.get("report_date") and row["report_date"] <= through_date
    ]
    for row in events:
        report_date = row["report_date"]
        revisions[report_date] = max(revisions.get(report_date, 0), int(row.get("revision", 1)))
    return {
        (row["sector_id"], row["report_date"]): row for row in events
        if int(row.get("revision", 1)) == revisions[row["report_date"]]
    }


def _stage_and_reason(
    observations: list[dict[str, Any]],
    transitions: list[str],
) -> tuple[str, str]:
    latest = observations[-1]
    report_count = len(observations)
    latest_score = latest.get("leadership_score")
    scored = [row for row in observations if isinstance(row.get("leadership_score"), (int, float))]
    non_market_count = len(latest.get("non_market_available_dimensions", []))
    recent_adverse = any(item in ADVERSE_TRANSITIONS for item in transitions[-3:])
    latest_transition = transitions[-1] if transitions else "baseline_created"

    if report_count < MINIMUM_HISTORY_REPORTS:
        return "insufficient_history", "At least three distinct report dates are required."
    if latest_transition in ADVERSE_TRANSITIONS or (latest_score is None and scored):
        return "fading_reunderwrite", "The latest record lost score readiness or non-market evidence weakened."
    if (
        report_count >= PERSISTENT_MINIMUM_REPORTS
        and len(scored) / report_count >= 0.8
        and median(float(row["leadership_score"]) for row in scored) >= 70
        and isinstance(latest_score, (int, float)) and float(latest_score) >= 65
        and non_market_count >= 3
        and not recent_adverse
    ):
        return "persistent_research_candidate", "Score readiness persisted with broad non-market evidence."
    if (
        isinstance(latest_score, (int, float))
        and (len(scored) >= 2 or latest_transition == "newly_scored")
        and non_market_count >= 3
        and latest_transition in {"thesis_strengthening", "newly_scored"}
        and not any(item in ADVERSE_TRANSITIONS for item in transitions[-2:])
    ):
        return "emerging_research_candidate", "A non-market thesis improvement opened or strengthened score readiness."
    if isinstance(latest_score, (int, float)):
        return "watchlist_needs_trigger", "The sector is scored but persistence or evidence-breadth gates remain incomplete."
    if non_market_count >= 2:
        return "evidence_building", "Multiple non-market dimensions exist but the composite gate is not open."
    return "insufficient_evidence", "The current evidence set is too thin for leadership triage."


def build_sector_leadership_radar(
    report_date: str,
    history: dict[str, Any],
) -> dict[str, Any]:
    by_sector = latest_daily_records(history, report_date)
    events = latest_transition_events(history, report_date)
    rows: list[dict[str, Any]] = []
    for sector_id, all_rows in sorted(by_sector.items()):
        observations = all_rows[-LOOKBACK_REPORTS:]
        transitions = [
            (events.get((sector_id, row["report_date"])) or {}).get("transition", "baseline_created")
            for row in observations
        ]
        stage, reason = _stage_and_reason(observations, transitions)
        latest = observations[-1]
        scored_values = [
            float(row["leadership_score"]) for row in observations
            if isinstance(row.get("leadership_score"), (int, float))
        ]
        first_score = next((
            float(row["leadership_score"]) for row in observations
            if isinstance(row.get("leadership_score"), (int, float))
        ), None)
        latest_score = latest.get("leadership_score")
        score_change = (
            round(float(latest_score) - first_score, 2)
            if isinstance(latest_score, (int, float)) and first_score is not None else None
        )
        if stage in {"persistent_research_candidate", "emerging_research_candidate"}:
            actionability = "advance_to_deeper_work"
        elif stage == "fading_reunderwrite":
            actionability = "reunderwrite"
        else:
            actionability = "wait_for_proof"
        rows.append({
            "thesis_id": latest["thesis_id"],
            "sector_id": sector_id,
            "name_ko": latest.get("name_ko"),
            "stage": stage,
            "stage_reason": reason,
            "observed_report_count": len(observations),
            "required_minimum_reports": MINIMUM_HISTORY_REPORTS,
            "scored_report_count": len(scored_values),
            "scored_report_share": round(len(scored_values) / len(observations), 3),
            "latest_leadership_score": latest_score,
            "median_scored_leadership_score": round(median(scored_values), 2) if scored_values else None,
            "score_change_from_first_scored_report": score_change,
            "latest_transition": transitions[-1],
            "recent_transitions": transitions,
            "actionability": actionability,
            "why_now": f"{reason} Latest transition: {transitions[-1]}.",
            "variant_wedge": "Not established; priced-in expectations and valuation are unavailable.",
            "priced_in_status": "data_gap",
            "what_would_make_it_investable": (
                "Verify company-level financial exposure, current estimates, valuation, liquidity, and expectations."
            ),
            "what_would_kill_it": (
                "Loss of the composite evidence gate together with deterioration in a non-market dimension."
            ),
            "non_market_available_dimensions": latest.get("non_market_available_dimensions", []),
            "non_market_dimension_count": len(latest.get("non_market_available_dimensions", [])),
            "independent_source_count": len(latest.get("evidence_source_ids", [])),
            "missing_required_dimensions": latest.get("missing_required_dimensions", []),
            "blockers": latest.get("blockers", []),
            "first_rejection": (
                "Valuation, priced-in expectations, and security-level exposure are not included."
                if stage in {"persistent_research_candidate", "emerging_research_candidate"}
                else reason
            ),
            "next_workflow": (
                "company_exposure_and_expectations_diligence"
                if stage in {"persistent_research_candidate", "emerging_research_candidate"}
                else "continue_sector_monitoring"
            ),
        })

    stage_priority = {
        "fading_reunderwrite": 0,
        "persistent_research_candidate": 1,
        "emerging_research_candidate": 2,
        "watchlist_needs_trigger": 3,
        "evidence_building": 4,
        "insufficient_history": 5,
        "insufficient_evidence": 6,
    }
    priority = sorted(
        rows,
        key=lambda row: (
            stage_priority[row["stage"]],
            -float(row["latest_leadership_score"] or -1),
            row["sector_id"],
        ),
    )
    funnel = {
        "advance_to_deeper_work": [
            row for row in priority
            if row["stage"] in {"persistent_research_candidate", "emerging_research_candidate"}
        ],
        "reunderwrite": [row for row in priority if row["stage"] == "fading_reunderwrite"],
        "watchlist": [
            row for row in priority
            if row["stage"] in {"watchlist_needs_trigger", "evidence_building"}
        ],
        "not_ready": [
            row for row in priority
            if row["stage"] in {"insufficient_history", "insufficient_evidence"}
        ],
    }
    return {
        "schema_version": SCHEMA_VERSION,
        "report_date": report_date,
        "lookback_reports": LOOKBACK_REPORTS,
        "minimum_history_reports": MINIMUM_HISTORY_REPORTS,
        "persistent_candidate_minimum_reports": PERSISTENT_MINIMUM_REPORTS,
        "candidate_count": len(funnel["advance_to_deeper_work"]),
        "reunderwrite_count": len(funnel["reunderwrite"]),
        "funnel": funnel,
        "sectors": rows,
        "methodology": {
            "price_only_transition_can_create_emerging_candidate": False,
            "persistent_candidate_requires_non_market_dimension_count": 3,
            "persistent_candidate_minimum_scored_share": 0.8,
            "persistent_candidate_minimum_median_score": 70,
            "posture": "research_priority_not_investment_recommendation",
        },
        "data_gaps": [
            "No valuation or priced-in-expectations gate.",
            "No portfolio, benchmark-weight, liquidity, ownership, or positioning context.",
            "Sector evidence does not prove every representative company's financial exposure.",
        ],
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Build a persistence-aware sector leadership radar")
    parser.add_argument("--date", default=date.today().isoformat())
    parser.add_argument("--history-file")
    parser.add_argument("--output-file")
    args = parser.parse_args()
    history_path = root_path(
        args.history_file,
        ROOT / "workspace" / "history" / "sector_thesis_history.json",
    )
    if not history_path.exists():
        raise SystemExit(f"Sector thesis history does not exist: {history_path}")
    history = json.loads(history_path.read_text(encoding="utf-8"))
    radar = build_sector_leadership_radar(args.date, history)
    output = root_path(
        args.output_file,
        ROOT / "workspace" / "history" / "sector_radar" / f"{args.date}.json",
    )
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(radar, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Sector leadership radar saved: {output.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
