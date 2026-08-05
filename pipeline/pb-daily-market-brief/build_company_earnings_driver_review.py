"""Build evidence-bounded company earnings-driver monitoring reviews."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from collectors.common import ROOT
from collect_company_market_context import _number, root_path

SCHEMA_VERSION = "company_earnings_driver_review.v1"
MAX_COMPANIES = 4
MAX_EXPECTATION_ROWS = 4
MAX_REPORTED_BASELINES = 4
MAX_DRIVERS = 3


def _map(payload: dict[str, Any], field: str) -> dict[str, dict[str, Any]]:
    return {
        str(row.get("candidate_id")): row
        for row in payload.get(field, [])
        if row.get("candidate_id")
    }


def _provider_source_id(profile: dict[str, Any]) -> str | None:
    for source in profile.get("source_index", []):
        if source.get("source_type") == "provider":
            return str(source.get("source_id"))
    return None


def _expectation_bar(profile: dict[str, Any], valuation: dict[str, Any]) -> dict[str, Any]:
    bar = valuation.get("expectations_bar") or {}
    source_id = _provider_source_id(profile)
    rows: list[dict[str, Any]] = []
    if source_id:
        for row in bar.get("rows", [])[:MAX_EXPECTATION_ROWS]:
            period = row.get("fiscal_period_end")
            if row.get("eps_estimate_average") is not None:
                rows.append({
                    "metric_id": "diluted_eps",
                    "value": _number(row.get("eps_estimate_average")),
                    "period_end": period,
                    "units": "USD per share",
                    "basis": "provider_standardized_basis_not_verified_gaap_or_adjusted",
                    "estimate_as_of": bar.get("estimate_as_of"),
                    "source_id": source_id,
                    "evidence_label": "third_party_forward_estimate",
                    "analyst_count": _number(row.get("eps_analyst_count")),
                    "revision_pct_30d": _number(row.get("eps_revision_pct_30d")),
                })
            if row.get("revenue_estimate_average") is not None:
                rows.append({
                    "metric_id": "revenue",
                    "value": _number(row.get("revenue_estimate_average")),
                    "period_end": period,
                    "units": profile.get("security_context", {}).get("currency") or "currency unknown",
                    "basis": "provider_standardized_forward_estimate",
                    "estimate_as_of": bar.get("estimate_as_of"),
                    "source_id": source_id,
                    "evidence_label": "third_party_forward_estimate",
                    "analyst_count": _number(row.get("revenue_analyst_count")),
                    "revision_pct_30d": None,
                })
    periods = [str(row.get("period_end")) for row in rows if row.get("period_end")]
    return {
        "status": "third_party_estimate_bar_available" if rows else "insufficient_verified_estimate_bar",
        "label": "third_party_forward_estimates_not_verified_full_consensus",
        "freeze_as_of": bar.get("estimate_as_of"),
        "source_provider": bar.get("source_provider"),
        "revision_direction": bar.get("revision_direction") or "insufficient_detail",
        "preview_period": min(periods) if periods else None,
        "rows": rows,
        "whisper_status": "not_collected",
        "dispersion_status": "not_collected",
        "decision_limit": "Provider estimates are not called full consensus without contributor methodology and a verified freeze timestamp.",
    }


def _guidance_rows(primary: dict[str, Any], source_index: dict[str, dict[str, Any]], report_date: str) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    ticker = str(primary.get("ticker") or "")
    for guidance in primary.get("guidance", []):
        source_id = f"GUIDANCE-{ticker}-{guidance.get('record_id')}"
        source_index[source_id] = {
            "source_id": source_id,
            "source_name": f"{ticker} company guidance",
            "source_type": "primary_public_source",
            "owner_or_provider": primary.get("company_name") or ticker,
            "as_of_date": guidance.get("source_date"),
            "retrieved_at": report_date,
            "period_covered": guidance.get("period_end"),
            "source_location": guidance.get("source_url"),
            "freshness_status": "acceptable_for_stated_period",
            "notes": guidance.get("body_location"),
        }
        rows.append({
            "record_id": guidance.get("record_id"),
            "metric_id": guidance.get("metric_id"),
            "period_end": guidance.get("period_end"),
            "value_low": _number(guidance.get("value_low")),
            "value_high": _number(guidance.get("value_high")),
            "midpoint": _number(guidance.get("midpoint")),
            "units": guidance.get("unit"),
            "currency": guidance.get("currency"),
            "source_date": guidance.get("source_date"),
            "source_id": source_id,
            "source_url": guidance.get("source_url"),
            "body_location": guidance.get("body_location"),
            "evidence_label": "issuer_management_claim",
            "estimate_comparison": guidance.get("estimate_comparison") or {
                "status": "not_comparable_period_or_missing_estimate",
            },
        })
    return rows


def _reported_baselines(primary: dict[str, Any], source_index: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    priority = {"revenue": 0, "operating_income": 1, "diluted_eps": 2, "operating_cash_flow": 3}
    rows = sorted(
        primary.get("reported_metrics", []),
        key=lambda row: priority.get(str(row.get("metric_id")), 20),
    )
    output: list[dict[str, Any]] = []
    for row in rows:
        source_url = str(row.get("source_url") or "")
        source_id = next((
            source_id for source_id, source in source_index.items()
            if str(source.get("source_location") or source.get("file_tab_page_url_or_location") or "").split(" | ", 1)[0] == source_url
        ), None)
        if not source_id:
            continue
        output.append({
            "metric_id": row.get("metric_id"),
            "label": row.get("label") or row.get("concept"),
            "value": _number(row.get("value")),
            "period_start": row.get("period_start"),
            "period_end": row.get("period_end"),
            "units": row.get("unit"),
            "form": row.get("form"),
            "filed_date": row.get("filed_date"),
            "source_id": source_id,
            "source_url": source_url,
            "evidence_label": "fact_source_reported",
            "comparison_limit": "Do not compare growth unless duration, period and units match.",
        })
        if len(output) >= MAX_REPORTED_BASELINES:
            break
    return output


def _driver_rows(profile: dict[str, Any]) -> list[dict[str, Any]]:
    drivers: list[dict[str, Any]] = []
    for row in profile.get("earnings_drivers", [])[:MAX_DRIVERS]:
        change = _number(row.get("change_pct"))
        if row.get("comparison_status") not in {"comparable", "comparable_rounded", "recast_comparable"}:
            direction = "not_comparable"
        elif change is None:
            direction = "direction_not_calculated"
        elif change > 0:
            direction = "increased_vs_prior"
        elif change < 0:
            direction = "decreased_vs_prior"
        else:
            direction = "unchanged_vs_prior"
        name = str(row.get("driver_id") or "operating KPI")
        drivers.append({
            **row,
            "trend_status": direction,
            "review_priority": "operating_proof_point_not_stock_reaction_forecast",
            "confirmation_condition": f"The next body-verified comparable {name} disclosure preserves or improves the supplied direction.",
            "falsifier": f"The next comparable {name} disclosure reverses direction, or its definition becomes non-comparable.",
            "listen_for": f"Definition, conversion timing, margin or cash implications, and period comparability for {name}.",
        })
    return drivers


def _eps_quality(expectation_bar: dict[str, Any]) -> dict[str, Any]:
    eps_present = any(row.get("metric_id") == "diluted_eps" for row in expectation_bar.get("rows", []))
    return {
        "status": "incomplete_missing_basis_and_bridge" if eps_present else "not_triggered_no_eps_bar",
        "consensus_basis_status": "not_verified" if eps_present else "not_available",
        "watch_items": (
            ["GAAP versus adjusted EPS basis", "tax rate and below-the-line items", "diluted share count and one-time items"]
            if eps_present else []
        ),
        "decision_limit": "Headline EPS should not drive the review until basis and bridge items are source-verified.",
    }


def _missing_evidence(
    profile: dict[str, Any], expectation_bar: dict[str, Any], guidance: list[dict[str, Any]],
    event_confirmed: bool, reaction_context: dict[str, Any],
) -> list[dict[str, Any]]:
    gaps = [
        {"area": "positioning", "severity": "medium", "required_source": "Current ownership, short interest, borrow and liquidity data with as-of"},
        {"area": "quarterly_trajectory", "severity": "medium", "required_source": "Comparable t, t-1, t-4 and t-8 financial/KPI schedule"},
    ]
    if not reaction_context.get("historical_reactions") and not reaction_context.get("option_context"):
        gaps.insert(0, {"area": "reaction_bar", "severity": "medium", "required_source": "Event-isolating options tenor or sourced historical reaction set"})
    if not event_confirmed:
        gaps.insert(0, {"area": "earnings_event_date", "severity": "high", "required_source": "Company IR event calendar or confirmed earnings release date"})
    if expectation_bar.get("status") != "third_party_estimate_bar_available":
        gaps.append({"area": "estimate_bar", "severity": "high", "required_source": "Timestamped estimate set with contributor methodology"})
    if not guidance:
        gaps.append({"area": "company_guidance", "severity": "medium", "required_source": "Body-verified company guidance with exact period and units"})
    gaps.extend(profile.get("evidence_gaps", [])[:2])
    return gaps[:8]


def _review(
    report_date: str, profile: dict[str, Any], valuation: dict[str, Any], primary: dict[str, Any],
    event_gate: dict[str, Any], reaction_context: dict[str, Any],
) -> dict[str, Any]:
    source_index = {
        str(row.get("source_id")): dict(row)
        for row in profile.get("source_index", [])
        if row.get("source_id")
    }
    for source in event_gate.get("source_index", []):
        if source.get("source_id"):
            source_index[str(source["source_id"])] = dict(source)
    for source in reaction_context.get("source_index", []):
        if source.get("source_id"):
            source_index[str(source["source_id"])] = dict(source)
    expectation = _expectation_bar(profile, valuation)
    valuation_screen = valuation.get("valuation_screen") or {}
    primary_metric = valuation_screen.get("primary_metric")
    primary_comparison = next(
        (
            row
            for row in valuation_screen.get("comparisons", [])
            if row.get("metric") == primary_metric
        ),
        {},
    )
    valuation_summary = {
        "status": valuation_screen.get("status") or "insufficient_peer_data",
        "relative_valuation_status": (
            valuation_screen.get("relative_valuation_status")
            or "insufficient_usable_peers"
        ),
        "primary_metric": primary_metric,
        "target_value": primary_comparison.get("target_value"),
        "peer_median": primary_comparison.get("peer_median"),
        "premium_discount_pct": primary_comparison.get("premium_discount_pct"),
        "usable_peer_count": int(primary_comparison.get("usable_peer_count") or 0),
        "minimum_peer_count": int(primary_comparison.get("minimum_peer_count") or 2),
        "derived_valuation": dict(valuation.get("derived_valuation") or {}),
        "evidence_label": "derived_screening_calculation",
        "decision_limit": (
            "Small manually selected peer set and period-mismatched forward P/E "
            "support screening only, not a fair-value or target-price conclusion."
        ),
    }
    guidance = _guidance_rows(primary, source_index, report_date)
    drivers = _driver_rows(profile)
    event_confirmed = event_gate.get("event_gate_status") == "confirmed_primary_exact_date"
    selected_event = event_gate.get("selected_event") if event_confirmed else None
    return {
        "candidate_id": profile.get("candidate_id"),
        "company_name": profile.get("identity", {}).get("company_name"),
        "ticker": profile.get("identity", {}).get("ticker"),
        "review_mode": (
            "pre_event_preview_ready_input_pack"
            if event_confirmed else "earnings_driver_monitoring_not_pre_event_preview"
        ),
        "as_of_date": report_date,
        "event_setup": {
            "event_date": selected_event.get("event_date") if selected_event else None,
            "event_date_status": "confirmed_primary" if selected_event else event_gate.get("event_gate_status", "not_collected"),
            "event_source_id": selected_event.get("source_id") if selected_event else None,
            "time_of_day": selected_event.get("time_of_day") if selected_event else None,
            "time_zone": selected_event.get("time_zone") if selected_event else None,
            "reported_period": selected_event.get("reported_period") if selected_event else None,
            "fiscal_period_end": selected_event.get("fiscal_period_end") if selected_event else None,
            "preview_period": expectation.get("preview_period"),
            "preview_period_status": "estimate_period_only_not_event_date" if expectation.get("preview_period") else "not_collected",
        },
        "freeze_times": {
            "report_as_of": report_date,
            "price_as_of": profile.get("security_context", {}).get("price_as_of"),
            "estimate_as_of": expectation.get("freeze_as_of"),
            "guidance_as_of": max((str(row.get("source_date")) for row in guidance if row.get("source_date")), default=None),
        },
        "expectation_bar": expectation,
        "valuation_screen": valuation_summary,
        "company_guidance": guidance,
        "last_reported_baseline": _reported_baselines(primary, source_index),
        "earnings_drivers": drivers,
        "eps_quality_watch": _eps_quality(expectation),
        "reaction_framework": {
            "status": (
                "event_reaction_context_available_not_forecast"
                if event_confirmed and (
                    reaction_context.get("historical_observation_count", 0) >= 2
                    or reaction_context.get("option_context")
                )
                else "not_generated_missing_verified_event_and_reaction_bar"
            ),
            "bull_base_bear_generated": False,
            "historical_reaction_status": reaction_context.get("historical_reaction_status") or "not_collected",
            "historical_observation_count": reaction_context.get("historical_observation_count", 0),
            "median_absolute_reaction_pct": reaction_context.get("median_absolute_reaction_pct"),
            "reaction_window_definition": reaction_context.get("reaction_window_definition"),
            "implied_move_status": reaction_context.get("implied_move_status") or "not_collected",
            "option_context": reaction_context.get("option_context"),
            "stock_reaction_claim_allowed": False,
            "decision_limit": reaction_context.get("decision_limit") or "Reaction context is not a direction forecast.",
        },
        "monitoring_questions": [{
            "driver_id": row.get("driver_id"),
            "question": f"What changed in {row.get('driver_id')} versus the comparable prior period?",
            "why_it_matters": "Tests whether the operating proof point is persisting without assuming stock-price causality.",
            "listen_for": row.get("listen_for"),
            "falsifier": row.get("falsifier"),
            "source_id": row.get("source_id"),
        } for row in drivers],
        "missing_evidence": _missing_evidence(profile, expectation, guidance, event_confirmed, reaction_context),
        "source_index": list(source_index.values()),
        "readiness": (
            "pre_event_preview_input_ready_not_position_ready" if event_confirmed and drivers
            else "monitoring_ready_not_event_or_position_ready" if drivers
            else "insufficient_operating_driver_evidence"
        ),
        "action": "wait_for_proof",
        "next_workflow": (
            "earnings_preview_add_reaction_and_positioning_context"
            if event_confirmed else "confirm_event_date_and_full_expectation_bar_then_earnings_preview"
        ),
        "scope_limit": "No event date, reaction forecast, recommendation, sizing action, or claim about what is priced in.",
    }


def build_company_earnings_driver_review(
    report_date: str, tearsheets: dict[str, Any], valuation_expectations: dict[str, Any],
    primary_facts: dict[str, Any], earnings_events: dict[str, Any] | None = None,
    earnings_reaction_context: dict[str, Any] | None = None,
    max_companies: int = MAX_COMPANIES,
) -> dict[str, Any]:
    valuations = _map(valuation_expectations, "companies")
    primary = _map(primary_facts, "companies")
    events = _map(earnings_events or {}, "companies")
    reactions = _map(earnings_reaction_context or {}, "companies")
    profiles = tearsheets.get("profiles", [])[:max_companies]
    reviews = [
        _review(
            report_date, profile,
            valuations.get(str(profile.get("candidate_id")), {}),
            primary.get(str(profile.get("candidate_id")), {}),
            events.get(str(profile.get("candidate_id")), {}),
            reactions.get(str(profile.get("candidate_id")), {}),
        )
        for profile in profiles
    ]
    result = {
        "schema_version": SCHEMA_VERSION,
        "report_date": report_date,
        "review_count": len(reviews),
        "reviews": reviews,
        "methodology": {
            "event_date_required_for_preview": True,
            "full_consensus_label_requires_methodology": True,
            "exact_period_unit_basis_required": True,
            "reaction_scenarios_without_event_bar_allowed": False,
            "recommendations_allowed": False,
        },
        "posture": "earnings_driver_monitoring_not_investment_recommendation",
    }
    validate_company_earnings_driver_review(result)
    return result


def validate_company_earnings_driver_review(payload: dict[str, Any]) -> None:
    if payload.get("schema_version") != SCHEMA_VERSION:
        raise ValueError("Unexpected earnings driver review schema")
    if int(payload.get("review_count", -1)) != len(payload.get("reviews", [])):
        raise ValueError("Review count does not match earnings driver reviews")
    if len(payload.get("reviews", [])) > MAX_COMPANIES:
        raise ValueError("Earnings driver review exceeds the bounded company count")
    for review in payload.get("reviews", []):
        mode = review.get("review_mode")
        event_setup = review.get("event_setup") or {}
        source_ids = {row.get("source_id") for row in review.get("source_index", [])}
        if mode == "pre_event_preview_ready_input_pack":
            if event_setup.get("event_date_status") != "confirmed_primary" or not event_setup.get("event_date"):
                raise ValueError("Pre-event input readiness requires a confirmed primary event date")
            if event_setup.get("event_source_id") not in source_ids:
                raise ValueError("Confirmed event date requires source index lineage")
        elif mode == "earnings_driver_monitoring_not_pre_event_preview":
            if event_setup.get("event_date") is not None:
                raise ValueError("Monitoring-only review cannot select an event date")
        else:
            raise ValueError("An unverified event cannot be labeled a pre-event preview")
        if review.get("action") != "wait_for_proof" or "trade_ready" in str(review.get("readiness")):
            raise ValueError("Earnings driver monitoring cannot issue a trade action")
        reaction = review.get("reaction_framework") or {}
        if reaction.get("bull_base_bear_generated") is not False or reaction.get("stock_reaction_claim_allowed") is not False:
            raise ValueError("Reaction scenarios require a verified event and reaction bar")
        option = reaction.get("option_context")
        if option:
            if option.get("source_id") not in source_ids or not option.get("as_of"):
                raise ValueError("Option reaction context requires source lineage and freeze time")
            if reaction.get("implied_move_status") == "event_hurdle_candidate_not_forecast" and option.get("event_isolation_status") != "event_isolating_tenor_candidate":
                raise ValueError("Only event-isolating option tenor can be an event hurdle candidate")
        for row in review.get("expectation_bar", {}).get("rows", []):
            if row.get("source_id") not in source_ids or not row.get("period_end") or not row.get("units") or not row.get("estimate_as_of"):
                raise ValueError("Every estimate row requires source, period, units, and freeze time")
            if row.get("evidence_label") != "third_party_forward_estimate":
                raise ValueError("Provider estimates cannot be relabeled as consensus")
        valuation = review.get("valuation_screen") or {}
        if valuation.get("status") == "screening_available" and (
            valuation.get("evidence_label") != "derived_screening_calculation"
            or int(valuation.get("usable_peer_count") or 0)
            < int(valuation.get("minimum_peer_count") or 2)
        ):
            raise ValueError("Valuation screening requires labeled minimum peer support")
        for row in review.get("company_guidance", []):
            if row.get("source_id") not in source_ids or row.get("evidence_label") != "issuer_management_claim":
                raise ValueError("Company guidance requires primary-source lineage and claim labeling")
            if not row.get("period_end") or not row.get("units") or not row.get("body_location"):
                raise ValueError("Company guidance requires period, units, and body location")
        for row in review.get("last_reported_baseline", []):
            if row.get("source_id") not in source_ids or row.get("evidence_label") != "fact_source_reported":
                raise ValueError("Reported baselines require primary-source lineage")
            if row.get("value") is None or not row.get("period_end") or not row.get("units"):
                raise ValueError("Reported baselines require value, period, and units")
        for row in review.get("monitoring_questions", []):
            if row.get("source_id") not in source_ids:
                raise ValueError("Driver monitoring questions require source lineage")


def main() -> None:
    parser = argparse.ArgumentParser(description="Build company earnings-driver monitoring reviews")
    parser.add_argument("--date", required=True)
    parser.add_argument("--tearsheets-file")
    parser.add_argument("--valuation-expectations-file")
    parser.add_argument("--primary-facts-file")
    parser.add_argument("--earnings-events-file")
    parser.add_argument("--earnings-reaction-context-file")
    parser.add_argument("--output-file")
    args = parser.parse_args()
    paths = {
        "tearsheets": root_path(args.tearsheets_file, ROOT / "workspace" / "company_tearsheets" / args.date / "company_tearsheets.json"),
        "valuation": root_path(args.valuation_expectations_file, ROOT / "workspace" / "company_valuation_expectations" / args.date / "company_valuation_expectations.json"),
        "primary": root_path(args.primary_facts_file, ROOT / "workspace" / "company_primary_facts" / args.date / "company_primary_facts.json"),
        "events": root_path(args.earnings_events_file, ROOT / "workspace" / "company_earnings_events" / args.date / "company_earnings_events.json"),
        "reaction": root_path(args.earnings_reaction_context_file, ROOT / "workspace" / "company_earnings_reaction_context" / args.date / "company_earnings_reaction_context.json"),
    }
    for label, path in paths.items():
        if not path.exists():
            raise SystemExit(f"Earnings driver input does not exist ({label}): {path}")
    payload = build_company_earnings_driver_review(
        args.date,
        json.loads(paths["tearsheets"].read_text(encoding="utf-8")),
        json.loads(paths["valuation"].read_text(encoding="utf-8")),
        json.loads(paths["primary"].read_text(encoding="utf-8")),
        json.loads(paths["events"].read_text(encoding="utf-8")),
        json.loads(paths["reaction"].read_text(encoding="utf-8")),
    )
    output = root_path(
        args.output_file,
        ROOT / "workspace" / "company_earnings_driver_review" / args.date / "company_earnings_driver_review.json",
    )
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Company earnings driver review saved: {output.relative_to(ROOT)}")
    print(f"Company earnings driver status: reviews={payload['review_count']} | monitoring-only")


if __name__ == "__main__":
    main()
