"""Build evidence-gated earnings thesis triggers without price forecasts."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from collectors.common import ROOT
from collect_company_market_context import _number, root_path

SCHEMA_VERSION = "company_earnings_scenarios.v1"
MAX_COMPANIES = 4
ALLOWED_SCENARIOS = {"stronger_evidence", "within_verified_range", "weaker_evidence"}
FORBIDDEN_FIELDS = {
    "probability", "expected_return", "price_target", "implied_price",
    "buy", "sell", "add", "trim", "exit", "hedge",
}


def _matching_estimate(review: dict[str, Any], guidance: dict[str, Any]) -> dict[str, Any] | None:
    return next((
        row for row in review.get("expectation_bar", {}).get("rows", [])
        if row.get("metric_id") == guidance.get("metric_id")
        and row.get("period_end") == guidance.get("period_end")
        and (
            row.get("units") == guidance.get("units")
            or guidance.get("metric_id") == "revenue"
            and row.get("units") == guidance.get("currency") == guidance.get("units")
        )
    ), None)


def _eligible_guidance(review: dict[str, Any]) -> tuple[dict[str, Any] | None, dict[str, Any] | None]:
    for guidance in review.get("company_guidance", []):
        comparison = guidance.get("estimate_comparison") or {}
        if comparison.get("status") != "available_exact_period_and_unit":
            continue
        estimate = _matching_estimate(review, guidance)
        if estimate and _number(guidance.get("value_low")) is not None and _number(guidance.get("value_high")) is not None:
            return guidance, estimate
    return None, None


def _comparable_drivers(review: dict[str, Any]) -> list[dict[str, Any]]:
    return [
        row for row in review.get("earnings_drivers", [])
        if row.get("comparison_status") in {"comparable", "comparable_rounded", "recast_comparable"}
        and row.get("source_id")
    ][:3]


def _gate_gaps(
    review: dict[str, Any], guidance: dict[str, Any] | None, estimate: dict[str, Any] | None,
    drivers: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    gaps: list[dict[str, Any]] = []
    event = review.get("event_setup") or {}
    if review.get("review_mode") != "pre_event_preview_ready_input_pack" or event.get("event_date_status") != "confirmed_primary":
        gaps.append({"area": "event_date", "severity": "blocker", "required": "Body-verified primary earnings date"})
    if guidance and event.get("fiscal_period_end") != guidance.get("period_end"):
        gaps.append({"area": "fiscal_period", "severity": "blocker", "required": "Confirmed event fiscal period end must exactly match the guidance and estimate period"})
    if not guidance:
        gaps.append({"area": "guidance", "severity": "blocker", "required": "Body-verified guidance with low/high range and exact period/unit comparison"})
    if not estimate:
        gaps.append({"area": "expectation_bar", "severity": "blocker", "required": "Same-period and same-unit third-party estimate with freeze time"})
    if not drivers:
        gaps.append({"area": "operating_driver", "severity": "blocker", "required": "At least one comparable body-verified company KPI"})
    return gaps


def _threshold(
    scenario: str, guidance: dict[str, Any], estimate: dict[str, Any], drivers: list[dict[str, Any]],
) -> dict[str, Any]:
    low = _number(guidance.get("value_low"))
    high = _number(guidance.get("value_high"))
    if scenario == "stronger_evidence":
        operator = "greater_than"
        threshold_low = high
        threshold_high = None
        interpretation = "Reported result exceeds the top of the body-verified company range."
        thesis_effect = "strengthen_only_after_driver_and_quality_review"
    elif scenario == "within_verified_range":
        operator = "between_inclusive"
        threshold_low = low
        threshold_high = high
        interpretation = "Reported result falls inside the body-verified company range."
        thesis_effect = "maintain_pending_operating_driver_confirmation"
    else:
        operator = "less_than"
        threshold_low = low
        threshold_high = None
        interpretation = "Reported result falls below the bottom of the body-verified company range."
        thesis_effect = "reunderwrite_company_case"
    return {
        "scenario": scenario,
        "setup_type": "earnings",
        "module": guidance.get("metric_id"),
        "driver": guidance.get("metric_id"),
        "period_end": guidance.get("period_end"),
        "units": guidance.get("units"),
        "operator": operator,
        "threshold_low": threshold_low,
        "threshold_high": threshold_high,
        "guidance_midpoint": _number(guidance.get("midpoint")),
        "third_party_estimate": _number(estimate.get("value")),
        "estimate_freeze_as_of": estimate.get("estimate_as_of"),
        "source_ids": [guidance.get("source_id"), estimate.get("source_id")],
        "evidence_label": "derived_trigger_from_issuer_claim_and_third_party_estimate",
        "condition_interpretation": interpretation,
        "thesis_effect": thesis_effect,
        "operating_cross_checks": [{
            "driver_id": row.get("driver_id"),
            "trend_status": row.get("trend_status"),
            "confirmation_condition": row.get("confirmation_condition"),
            "falsifier": row.get("falsifier"),
            "source_id": row.get("source_id"),
        } for row in drivers],
        "next_action": "wait_for_reported_result_then_earnings_deep_dive",
        "decision_limit": "This threshold changes research posture only after source-verified results and KPI-quality review; it is not a stock-price forecast.",
    }


def _company_scenarios(review: dict[str, Any]) -> dict[str, Any]:
    guidance, estimate = _eligible_guidance(review)
    drivers = _comparable_drivers(review)
    gaps = _gate_gaps(review, guidance, estimate, drivers)
    ready = not gaps
    source_ids = {row.get("source_id") for row in review.get("source_index", [])}
    scenarios = [
        _threshold(name, guidance, estimate, drivers)
        for name in ("stronger_evidence", "within_verified_range", "weaker_evidence")
    ] if ready and guidance and estimate else []
    reaction = review.get("reaction_framework") or {}
    return {
        "candidate_id": review.get("candidate_id"),
        "ticker": review.get("ticker"),
        "company_name": review.get("company_name"),
        "event_date": review.get("event_setup", {}).get("event_date"),
        "event_source_id": review.get("event_setup", {}).get("event_source_id"),
        "fiscal_period_end": review.get("event_setup", {}).get("fiscal_period_end"),
        "scenario_mode": "thesis_trigger_table_not_price_scenario",
        "scenario_gate_status": (
            "conditional_thesis_triggers_available" if ready
            else "blocked_missing_exact_event_bar_or_driver"
        ),
        "base_case_source": {
            "guidance_source_id": guidance.get("source_id") if guidance else None,
            "estimate_source_id": estimate.get("source_id") if estimate else None,
            "estimate_freeze_as_of": estimate.get("estimate_as_of") if estimate else None,
            "period_end": guidance.get("period_end") if guidance else None,
            "units": guidance.get("units") if guidance else None,
            "source_posture": "issuer_guidance_claim_plus_third_party_estimate",
        },
        "conditional_scenarios": scenarios,
        "scenario_count": len(scenarios),
        "reaction_hurdle_context": {
            "historical_observation_count": reaction.get("historical_observation_count", 0),
            "median_absolute_reaction_pct": reaction.get("median_absolute_reaction_pct"),
            "implied_move_status": reaction.get("implied_move_status") or "not_collected",
            "directional_use_allowed": False,
        },
        "gate_gaps": gaps,
        "source_index": review.get("source_index", []),
        "source_ids_available": sorted(str(value) for value in source_ids if value),
        "probabilities_generated": False,
        "price_targets_generated": False,
        "action": "wait_for_proof",
        "next_workflow": "earnings_deep_dive_then_thesis_tracker",
        "decision_limit": "Scenarios classify evidence outcomes only; they do not predict price direction, expected return, or position action.",
    }


def build_company_earnings_scenarios(
    report_date: str, earnings_driver_review: dict[str, Any], max_companies: int = MAX_COMPANIES,
) -> dict[str, Any]:
    companies = [
        _company_scenarios(review)
        for review in earnings_driver_review.get("reviews", [])[:max_companies]
    ]
    result = {
        "schema_version": SCHEMA_VERSION,
        "report_date": report_date,
        "company_count": len(companies),
        "ready_count": sum(row["scenario_gate_status"] == "conditional_thesis_triggers_available" for row in companies),
        "companies": companies,
        "methodology": {
            "table_type": "thesis_trigger_table",
            "confirmed_event_required": True,
            "exact_guidance_estimate_period_and_unit_required": True,
            "comparable_operating_driver_required": True,
            "probabilities_allowed": False,
            "price_targets_allowed": False,
            "directional_forecasts_allowed": False,
        },
        "posture": "conditional_research_triggers_not_investment_recommendation",
    }
    validate_company_earnings_scenarios(result)
    return result


def validate_company_earnings_scenarios(payload: dict[str, Any]) -> None:
    if payload.get("schema_version") != SCHEMA_VERSION:
        raise ValueError("Unexpected company earnings scenario schema")
    if int(payload.get("company_count", -1)) != len(payload.get("companies", [])):
        raise ValueError("Company count does not match scenario rows")
    for company in payload.get("companies", []):
        scenarios = company.get("conditional_scenarios", [])
        if company.get("scenario_gate_status") == "conditional_thesis_triggers_available":
            if not company.get("event_date") or not company.get("event_source_id"):
                raise ValueError("Scenario readiness requires a confirmed event date")
            if {row.get("scenario") for row in scenarios} != ALLOWED_SCENARIOS:
                raise ValueError("Ready earnings scenarios require the three bounded evidence cases")
            if len(scenarios) != 3:
                raise ValueError("Ready earnings scenario table must contain exactly three cases")
        elif scenarios:
            raise ValueError("Blocked scenario gate cannot contain generated cases")
        source_ids = {row.get("source_id") for row in company.get("source_index", [])}
        if company.get("scenario_gate_status") == "conditional_thesis_triggers_available":
            if company.get("event_source_id") not in source_ids:
                raise ValueError("Confirmed earnings event requires source lineage")
            base_sources = company.get("base_case_source") or {}
            if base_sources.get("guidance_source_id") not in source_ids or base_sources.get("estimate_source_id") not in source_ids:
                raise ValueError("Scenario base case requires guidance and estimate source lineage")
        for row in scenarios:
            if not row.get("source_ids") or any(source_id not in source_ids for source_id in row.get("source_ids", [])):
                raise ValueError("Every earnings scenario threshold requires source lineage")
            if row.get("operator") not in {"greater_than", "between_inclusive", "less_than"}:
                raise ValueError("Unsupported scenario threshold operator")
            if row.get("period_end") is None or row.get("units") is None or row.get("estimate_freeze_as_of") is None:
                raise ValueError("Scenario thresholds require period, units, and estimate freeze time")
            for cross_check in row.get("operating_cross_checks", []):
                if cross_check.get("source_id") not in source_ids:
                    raise ValueError("Operating cross-check requires source lineage")
        if company.get("probabilities_generated") is not False or company.get("price_targets_generated") is not False:
            raise ValueError("Earnings thesis triggers cannot generate probabilities or price targets")
        if company.get("action") != "wait_for_proof":
            raise ValueError("Earnings thesis triggers cannot issue a position action")
        serialized = json.dumps(company, ensure_ascii=False).lower()
        if any(f'"{field}"' in serialized for field in FORBIDDEN_FIELDS):
            raise ValueError("Unsupported price, probability, or trading field in earnings scenarios")


def main() -> None:
    parser = argparse.ArgumentParser(description="Build conditional earnings thesis-trigger scenarios")
    parser.add_argument("--date", required=True)
    parser.add_argument("--earnings-driver-review-file")
    parser.add_argument("--output-file")
    args = parser.parse_args()
    review_path = root_path(
        args.earnings_driver_review_file,
        ROOT / "workspace" / "company_earnings_driver_review" / args.date / "company_earnings_driver_review.json",
    )
    if not review_path.exists():
        raise SystemExit(f"Company earnings driver review does not exist: {review_path}")
    payload = build_company_earnings_scenarios(
        args.date,
        json.loads(review_path.read_text(encoding="utf-8")),
    )
    output = root_path(
        args.output_file,
        ROOT / "workspace" / "company_earnings_scenarios" / args.date / "company_earnings_scenarios.json",
    )
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Company earnings scenarios saved: {output.relative_to(ROOT)}")
    print(f"Company earnings scenario status: ready={payload['ready_count']}/{payload['company_count']} | thesis triggers only")


if __name__ == "__main__":
    main()
