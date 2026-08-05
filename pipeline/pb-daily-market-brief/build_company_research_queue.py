"""Map persistence-qualified sectors to evidence-gated listed-company research candidates."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from collectors.common import ROOT
from collect_sector_fundamentals import load_fundamental_registry
from sector_master import load_sector_master

SCHEMA_VERSION = "company_research_queue.v1"
MAX_WATCHLIST_SECTORS = 5
MAX_QUEUE_ROWS = 24


def root_path(value: str | None, default: Path) -> Path:
    path = Path(value) if value else default
    return path if path.is_absolute() else ROOT / path


def _security_key(sector_id: str, market: str, ticker: str) -> tuple[str, str, str]:
    return sector_id, market.upper(), ticker.upper()


def _selected_sectors(radar: dict[str, Any]) -> list[dict[str, Any]]:
    funnel = radar.get("funnel", {})
    selected: list[dict[str, Any]] = []
    seen: set[str] = set()
    for bucket, limit in (
        ("advance_to_deeper_work", None),
        ("reunderwrite", None),
        ("watchlist", MAX_WATCHLIST_SECTORS),
    ):
        rows = list(funnel.get(bucket, []))
        if limit is not None:
            rows = rows[:limit]
        for row in rows:
            if row["sector_id"] in seen:
                continue
            seen.add(row["sector_id"])
            selected.append({**row, "radar_bucket": bucket})
    return selected


def _verified_exposure_map(registry: dict[str, Any]) -> dict[tuple[str, str, str], dict[str, Any]]:
    result: dict[tuple[str, str, str], dict[str, Any]] = {}
    for row in registry.get("verified_exposures", []):
        if row.get("primary_source_confirmed") is not True:
            continue
        if not str(row.get("source_url") or "").startswith("https://"):
            continue
        if not str(row.get("body_location") or "").strip():
            continue
        result[_security_key(row["sector_id"], row["market"], row["ticker"])] = row
    return result


def _fundamental_maps(
    fundamentals: dict[str, Any],
) -> tuple[dict[tuple[str, str, str], dict[str, Any]], dict[tuple[str, str, str], list[dict[str, Any]]]]:
    estimates = {
        _security_key(row["sector_id"], row["market"], row["ticker"]): row
        for row in fundamentals.get("estimate_observations", [])
    }
    operating: dict[tuple[str, str, str], list[dict[str, Any]]] = {}
    for row in fundamentals.get("operating_observations", []):
        key = _security_key(row["sector_id"], row["market"], row["ticker"])
        operating.setdefault(key, []).append(row)
    return estimates, operating


def _queue_stage(
    radar_bucket: str,
    exposure: dict[str, Any] | None,
    estimate: dict[str, Any] | None,
    operating: list[dict[str, Any]],
) -> str:
    if radar_bucket == "reunderwrite":
        return "sector_reunderwrite"
    if radar_bucket != "advance_to_deeper_work":
        return "sector_watchlist_only"
    if exposure is None:
        return "needs_exposure_attribution"
    has_estimate_signal = bool(
        estimate
        and estimate.get("eligible_for_sector_score") is True
        and isinstance(estimate.get("score"), (int, float))
    )
    has_operating_signal = any(
        row.get("eligible_for_sector_score") is True
        and isinstance(row.get("score"), (int, float))
        for row in operating
    )
    if not has_estimate_signal and not has_operating_signal:
        return "verified_exposure_needs_financial_signal"
    return "valuation_expectations_gated"


def _candidate_row(
    sector: dict[str, Any],
    radar_row: dict[str, Any],
    company: dict[str, Any],
    exposure: dict[str, Any] | None,
    estimate: dict[str, Any] | None,
    operating: list[dict[str, Any]],
) -> dict[str, Any]:
    stage = _queue_stage(radar_row["radar_bucket"], exposure, estimate, operating)
    estimate_eligible = bool(
        estimate
        and estimate.get("eligible_for_sector_score") is True
        and isinstance(estimate.get("score"), (int, float))
    )
    accepted_operating = [
        row for row in operating
        if row.get("eligible_for_sector_score") is True and isinstance(row.get("score"), (int, float))
    ]
    source_urls = sorted({
        str(url) for url in [
            exposure.get("source_url") if exposure else None,
            estimate.get("source_url") if estimate_eligible and estimate else None,
            *[row.get("source_url") for row in accepted_operating],
        ] if url
    })
    if stage == "valuation_expectations_gated":
        actionability = "advance_to_company_diligence"
        next_workflow = "company_tearsheet_then_expectations_and_valuation"
        first_rejection = "Current price, valuation, liquidity, and priced-in expectations are not collected."
    elif stage == "needs_exposure_attribution":
        actionability = "wait_for_proof"
        next_workflow = "primary_company_exposure_mapping"
        first_rejection = "Representative-company membership is not primary-source exposure proof."
    elif stage == "verified_exposure_needs_financial_signal":
        actionability = "wait_for_proof"
        next_workflow = "collect_company_estimate_or_operating_signal"
        first_rejection = "Business exposure is verified but no eligible estimate, order, backlog, or CAPEX signal exists."
    elif stage == "sector_reunderwrite":
        actionability = "reunderwrite_sector_first"
        next_workflow = "sector_thesis_reunderwrite"
        first_rejection = "The sector leadership thesis is weakening or lost score readiness."
    else:
        actionability = "sector_watchlist"
        next_workflow = "continue_sector_monitoring"
        first_rejection = "The sector has not advanced through the persistence-aware research funnel."
    return {
        "candidate_id": f"{sector['sector_id']}:{company['market']}:{company['ticker']}",
        "sector_id": sector["sector_id"],
        "sector_name_ko": sector["name_ko"],
        "sector_radar_stage": radar_row.get("stage"),
        "sector_radar_bucket": radar_row["radar_bucket"],
        "sector_leadership_score": radar_row.get("latest_leadership_score"),
        "market": company["market"],
        "ticker": company["ticker"],
        "company_name": company["name"],
        "instrument_type": company["instrument_type"],
        "queue_stage": stage,
        "actionability": actionability,
        "exposure_status": "verified_primary" if exposure else "candidate_unverified",
        "exposure_source_url": exposure.get("source_url") if exposure else None,
        "exposure_body_location": exposure.get("body_location") if exposure else None,
        "exposure_evidence_summary": exposure.get("evidence_summary") if exposure else None,
        "beneficiary_pathways": [{
            "pathway_id": row["pathway_id"],
            "label_ko": row["label_ko"],
            "attribution_status": "sector_context_not_company_attribution",
        } for row in sector["beneficiary_pathways"]],
        "estimate_signal": ({
            "status": estimate.get("status"),
            "score": estimate.get("score"),
            "score_candidate": estimate.get("score_candidate"),
            "as_of": estimate.get("as_of"),
            "source_provider": estimate.get("source_provider"),
            "source_grade": estimate.get("source_grade"),
            "source_url": estimate.get("source_url"),
            "eligible": estimate_eligible,
        } if estimate else None),
        "operating_signals": [{
            "record_id": row.get("record_id"),
            "metric_type": row.get("metric_type"),
            "change_pct": row.get("change_pct"),
            "score": row.get("score"),
            "source_date": row.get("source_date"),
            "source_url": row.get("source_url"),
            "body_location": row.get("body_location"),
        } for row in accepted_operating],
        "source_urls": source_urls,
        "why_now": (
            f"Sector stage is {radar_row.get('stage')}; company evidence stage is {stage}."
        ),
        "variant_wedge": "Not established; current valuation and priced-in expectations are unavailable.",
        "priced_in_status": "data_gap",
        "valuation_status": "not_collected",
        "market_data_as_of": None,
        "liquidity_status": "not_collected",
        "positioning_status": "not_collected",
        "first_rejection": first_rejection,
        "what_would_make_it_investable": (
            "Verify current price, valuation, liquidity, consensus freshness, company guidance, and the financial magnitude of sector exposure."
        ),
        "what_would_kill_it": (
            "Loss of verified exposure, reversal of company estimate or operating evidence, or sector reunderwrite status."
        ),
        "next_workflow": next_workflow,
        "posture": "research_candidate_not_investment_recommendation",
    }


def validate_company_research_queue(payload: dict[str, Any]) -> None:
    if payload.get("schema_version") != SCHEMA_VERSION:
        raise ValueError("Unexpected company research queue schema")
    ids: set[str] = set()
    for row in payload.get("candidates", []):
        if row["candidate_id"] in ids:
            raise ValueError(f"Duplicate company candidate: {row['candidate_id']}")
        ids.add(row["candidate_id"])
        if row["queue_stage"] == "valuation_expectations_gated":
            if row["exposure_status"] != "verified_primary" or not row.get("exposure_source_url"):
                raise ValueError("Advanced company diligence requires primary exposure proof")
            if not (
                bool((row.get("estimate_signal") or {}).get("eligible"))
                or bool(row.get("operating_signals"))
            ):
                raise ValueError("Advanced company diligence requires an estimate or operating signal")
        if row.get("valuation_status") != "not_collected" or row.get("priced_in_status") != "data_gap":
            raise ValueError("Queue cannot infer valuation or priced-in status")
        if any(not str(url).startswith("https://") for url in row.get("source_urls", [])):
            raise ValueError("Company queue source URLs must be https")


def build_company_research_queue(
    report_date: str,
    radar: dict[str, Any],
    master: dict[str, Any],
    registry: dict[str, Any],
    fundamentals: dict[str, Any],
) -> dict[str, Any]:
    sectors = {row["sector_id"]: row for row in master["sectors"]}
    exposure_map = _verified_exposure_map(registry)
    estimates, operating = _fundamental_maps(fundamentals)
    candidates: list[dict[str, Any]] = []
    for radar_row in _selected_sectors(radar):
        sector = sectors.get(radar_row["sector_id"])
        if not sector:
            continue
        for company in sector["representative_companies"]:
            key = _security_key(sector["sector_id"], company["market"], company["ticker"])
            candidates.append(_candidate_row(
                sector, radar_row, company, exposure_map.get(key), estimates.get(key), operating.get(key, []),
            ))
    stage_priority = {
        "valuation_expectations_gated": 0,
        "verified_exposure_needs_financial_signal": 1,
        "needs_exposure_attribution": 2,
        "sector_reunderwrite": 3,
        "sector_watchlist_only": 4,
    }
    candidates.sort(key=lambda row: (
        stage_priority[row["queue_stage"]],
        -float(row.get("sector_leadership_score") or -1),
        row["market"], row["ticker"],
    ))
    candidates = candidates[:MAX_QUEUE_ROWS]
    funnel = {
        "advance_to_company_diligence": [
            row for row in candidates if row["queue_stage"] == "valuation_expectations_gated"
        ],
        "verified_exposure_needs_signal": [
            row for row in candidates if row["queue_stage"] == "verified_exposure_needs_financial_signal"
        ],
        "exposure_not_proven": [
            row for row in candidates if row["queue_stage"] == "needs_exposure_attribution"
        ],
        "deprioritized_or_reunderwrite": [
            row for row in candidates if row["queue_stage"] in {"sector_reunderwrite", "sector_watchlist_only"}
        ],
    }
    result = {
        "schema_version": SCHEMA_VERSION,
        "report_date": report_date,
        "source_radar_schema": radar.get("schema_version"),
        "selected_sector_count": len({row["sector_id"] for row in candidates}),
        "candidate_count": len(candidates),
        "advance_count": len(funnel["advance_to_company_diligence"]),
        "funnel": funnel,
        "candidates": candidates,
        "methodology": {
            "advanced_sector_required_for_company_advance": True,
            "primary_exposure_proof_required": True,
            "company_estimate_or_operating_signal_required": True,
            "valuation_and_priced_in_gate_present": False,
            "posture": "research_priority_not_investment_recommendation",
        },
        "data_gaps": [
            "Current price, valuation, liquidity, ownership, positioning, and benchmark context are not collected.",
            "Consensus signals are provider-derived and do not replace company filings or guidance.",
            "Sector beneficiary pathways are context until company-specific financial attribution is verified.",
        ],
    }
    validate_company_research_queue(result)
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description="Build an evidence-gated company research queue")
    parser.add_argument("--date", required=True)
    parser.add_argument("--radar-file")
    parser.add_argument("--fundamentals-file")
    parser.add_argument("--output-file")
    args = parser.parse_args()
    radar_path = root_path(
        args.radar_file,
        ROOT / "workspace" / "history" / "sector_radar" / f"{args.date}.json",
    )
    fundamentals_path = root_path(
        args.fundamentals_file,
        ROOT / "workspace" / "sector_fundamentals" / args.date / "sector_fundamentals.json",
    )
    if not radar_path.exists():
        raise SystemExit(f"Sector leadership radar does not exist: {radar_path}")
    if not fundamentals_path.exists():
        raise SystemExit(f"Sector fundamentals do not exist: {fundamentals_path}")
    payload = build_company_research_queue(
        args.date,
        json.loads(radar_path.read_text(encoding="utf-8")),
        load_sector_master(),
        load_fundamental_registry(),
        json.loads(fundamentals_path.read_text(encoding="utf-8")),
    )
    output = root_path(
        args.output_file,
        ROOT / "workspace" / "company_research_queue" / args.date / "company_research_queue.json",
    )
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Company research queue saved: {output.relative_to(ROOT)}")
    print(f"Company research queue status: candidates={payload['candidate_count']} | advance={payload['advance_count']}")


if __name__ == "__main__":
    main()
