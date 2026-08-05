"""Generate source-bounded original-underwriting drafts for explicit user/PM review."""

from __future__ import annotations

import argparse
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from collectors.common import ROOT
from collect_company_market_context import root_path
from collect_company_underwriting import validate_underwriting_record

SCHEMA_VERSION = "company_underwriting_drafts.v1"
MAX_COMPANIES = 4


def underwriting_draft_hash(draft: dict[str, Any]) -> str:
    encoded = json.dumps(draft, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _diligence_gap_text(value: Any) -> str:
    """Keep structured diligence gaps readable instead of stringifying dicts."""
    if isinstance(value, dict):
        area = str(value.get("area") or value.get("status") or "diligence").strip()
        requirement = str(value.get("required_source") or value.get("impact") or "").strip()
        return f"{area}: {requirement}" if requirement else area
    return str(value).strip()


def _by_ticker(payload: dict[str, Any], key: str, nested: tuple[str, ...] = ()) -> dict[str, dict[str, Any]]:
    rows: dict[str, dict[str, Any]] = {}
    for row in payload.get(key, []):
        value: Any = None
        if nested:
            value = row
            for part in nested:
                value = (value or {}).get(part)
        ticker = str(value if nested else row.get("ticker") or "").upper()
        if ticker:
            rows[ticker] = row
    return rows


def _sources(*rows: dict[str, Any]) -> list[dict[str, Any]]:
    merged: dict[str, dict[str, Any]] = {}
    for row in rows:
        for source in row.get("source_index", []):
            if source.get("source_id"):
                merged[str(source["source_id"])] = dict(source)
    return list(merged.values())


def _scenario_pillars(scenario: dict[str, Any]) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    cases = scenario.get("conditional_scenarios", [])
    if scenario.get("scenario_gate_status") != "conditional_thesis_triggers_available" or not cases:
        return [], []
    reference = cases[0]
    lower = next((row for row in cases if row.get("scenario") == "weaker_evidence"), {})
    metric = str(reference.get("driver") or "reported metric")
    period = reference.get("period_end")
    units = reference.get("units")
    pillars = [{
        "pillar_id": f"earnings_range:{metric}:{period}",
        "pillar_name": f"{metric} execution",
        "claim": f"The exact-period {metric} result should remain within or above the source-verified company range.",
        "priority": "core",
        "baseline": {
            "period_end": period, "units": units,
            "range_low": reference.get("threshold_low") if reference.get("scenario") == "within_verified_range" else lower.get("threshold_low"),
            "range_high": next((row.get("threshold_low") for row in cases if row.get("scenario") == "stronger_evidence"), None),
            "estimate_freeze_as_of": reference.get("estimate_freeze_as_of"),
        },
        "expected_path": "At or above the verified company range; operating quality must confirm separately.",
        "evidence_rules": [{
            "selector": "headline_result_case",
            "confirming_values": ["stronger_evidence", "within_verified_range"],
            "warning_values": [], "break_values": ["weaker_evidence"],
            "threshold_origin": "Draft threshold for PM confirmation",
            "threshold_approval_status": "draft_pending_user_approval",
        }],
        "next_proof_point": f"Body-verified {metric} result for {period} in {units}.",
        "source_ids": list(dict.fromkeys(reference.get("source_ids", []))),
    }]
    for cross_check in reference.get("operating_cross_checks", [])[:2]:
        driver_id = str(cross_check.get("driver_id") or "")
        if not driver_id or not cross_check.get("source_id"):
            continue
        pillars.append({
            "pillar_id": f"operating_driver:{driver_id}", "pillar_name": driver_id,
            "claim": cross_check.get("confirmation_condition") or f"Comparable {driver_id} should maintain its prior direction.",
            "priority": "core", "baseline": "Latest comparable company-reported KPI",
            "expected_path": cross_check.get("trend_status") or "requires PM definition",
            "evidence_rules": [{
                "selector": f"operating_kpi:{driver_id}", "confirming_values": ["confirming"],
                "warning_values": ["neutral"], "break_values": ["weakening"],
                "threshold_origin": "Draft threshold for PM confirmation",
                "threshold_approval_status": "draft_pending_user_approval",
            }],
            "next_proof_point": f"Next body-verified comparable {driver_id} disclosure.",
            "source_ids": [cross_check.get("source_id")],
        })
    kill_criteria = [{
        "kill_id": f"draft_break:{metric}:{period}",
        "claim": f"Draft re-underwrite condition: the exact-period {metric} result falls below the verified lower range.",
        "selector": "headline_result_case", "match_values": ["weaker_evidence"],
        "threshold_origin": "Draft threshold for PM confirmation",
        "threshold_approval_status": "draft_pending_user_approval",
        "required_source_type": "body_verified_primary_company_result",
        "source_ids": list(dict.fromkeys(lower.get("source_ids", reference.get("source_ids", [])))),
    }]
    return pillars, kill_criteria


def _driver_pillars(review: dict[str, Any]) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    pillars: list[dict[str, Any]] = []
    for driver in review.get("earnings_drivers", [])[:3]:
        driver_id = str(driver.get("driver_id") or "")
        if not driver_id or not driver.get("source_id"):
            continue
        pillars.append({
            "pillar_id": f"operating_driver:{driver_id}", "pillar_name": driver_id,
            "claim": driver.get("confirmation_condition") or f"Comparable {driver_id} should maintain its prior direction.",
            "priority": "core", "baseline": {
                "value": driver.get("current_value"), "prior_value": driver.get("prior_value"),
                "period": driver.get("current_period"), "units": driver.get("units"),
            },
            "expected_path": driver.get("trend_status") or "requires PM definition",
            "evidence_rules": [{
                "selector": f"operating_kpi:{driver_id}", "confirming_values": ["confirming"],
                "warning_values": ["neutral"], "break_values": ["weakening"],
                "threshold_origin": "Draft threshold for PM confirmation",
                "threshold_approval_status": "draft_pending_user_approval",
            }],
            "next_proof_point": f"Next comparable {driver_id} disclosure.",
            "source_ids": [driver.get("source_id")],
        })
    kill = ([{
        "kill_id": f"draft_break:{pillars[0]['pillar_name']}",
        "claim": f"Draft re-underwrite condition: comparable {pillars[0]['pillar_name']} weakens versus its approved expected path.",
        "selector": pillars[0]["evidence_rules"][0]["selector"], "match_values": ["weakening"],
        "threshold_origin": "Draft threshold for PM confirmation",
        "threshold_approval_status": "draft_pending_user_approval",
        "required_source_type": "body_verified_primary_company_kpi",
        "source_ids": list(pillars[0]["source_ids"]),
    }] if pillars else [])
    return pillars, kill


def _draft_record(
    report_date: str, profile: dict[str, Any], review: dict[str, Any], scenario: dict[str, Any],
    registry_row: dict[str, Any],
) -> dict[str, Any] | None:
    identity = profile.get("identity") or {}
    ticker = str(identity.get("ticker") or review.get("ticker") or scenario.get("ticker") or "").upper()
    company_name = identity.get("company_name") or review.get("company_name") or scenario.get("company_name")
    pillars, kill = _scenario_pillars(scenario)
    if not pillars:
        pillars, kill = _driver_pillars(review)
    source_index = _sources(profile, review, scenario)
    source_ids = {row.get("source_id") for row in source_index}
    pillars = [row for row in pillars if row.get("source_ids") and set(row["source_ids"]).issubset(source_ids)]
    kill = [row for row in kill if row.get("source_ids") and set(row["source_ids"]).issubset(source_ids)]
    if not ticker or not pillars or not kill:
        return None
    selected = registry_row.get("selected_underwriting") or {}
    version = int(selected.get("version", 0)) + 1
    sector = identity.get("sector_name_ko") or identity.get("sector_id") or "the monitored sector"
    driver_names = ", ".join(str(row.get("pillar_name")) for row in pillars[:3])
    valuation = profile.get("valuation_context") or {}
    event = review.get("event_setup") or {}
    catalysts = [
        f"Confirmed earnings event on {event.get('event_date')}" if event.get("event_date_status") == "confirmed_primary" else "Next body-verified company earnings event",
    ]
    why_now = (profile.get("monitoring_framework") or {}).get("why_now")
    if isinstance(why_now, list):
        catalysts.extend(str(value) for value in why_now if value)
    elif why_now:
        catalysts.append(str(why_now))
    gaps = [
        str(row.get("required_source") or row.get("impact"))
        for row in profile.get("evidence_gaps", []) if row.get("required_source") or row.get("impact")
    ]
    gaps.extend(
        text for value in review.get("missing_evidence", [])
        if (text := _diligence_gap_text(value))
    )
    return {
        "underwriting_id": f"company:{ticker}:draft:{report_date}",
        "ticker": ticker, "company_name": company_name, "version": version,
        "authored_at": datetime.now(timezone.utc).isoformat(),
        "approval": {
            "status": "draft_pending_user_approval", "approved_by": None, "approved_at": None,
            "approval_note": "Machine-generated source-bounded draft. Edit claims and thresholds, then approve explicitly; do not approve unchanged by default.",
        },
        "one_sentence_thesis": f"Draft: {company_name} has monitored exposure to {sector}; the company case requires joint confirmation from {driver_names}.",
        "variant_perception": "not_established_requires_user_or_pm_view",
        "market_setup": (
            f"Screening context: {valuation.get('relative_valuation_status', 'not_available')}; "
            f"priced-in status remains {valuation.get('priced_in_status', 'not_established')}."
        ),
        "valuation_anchor": {
            "status": valuation.get("selected_valuation_range_status") or "not_supported",
            "text": "No approved valuation anchor; peer screening and current price cannot establish fair value.",
            "as_of": (profile.get("security_context") or {}).get("price_as_of"),
        },
        "horizon": "requires_user_or_pm_input",
        "pillars": pillars, "kill_criteria": kill,
        "catalysts": list(dict.fromkeys(catalysts)),
        "open_diligence": list(dict.fromkeys([
            "Define the actual variant perception and what the market already prices in.",
            "Approve or replace every proposed core pillar and draft break condition.",
            "Supply model, valuation/downside, position, benchmark and risk-budget context.",
            *gaps,
        ]))[:12],
        "source_index": source_index,
        "draft_metadata": {
            "generated_from": ["company_tearsheets", "company_earnings_driver_review", "company_earnings_scenarios"],
            "claim_label": "analyst_generated_draft_requires_user_or_pm_approval",
            "numeric_score_generated": False, "position_action_generated": False,
        },
    }


def build_company_underwriting_drafts(
    report_date: str, tearsheets: dict[str, Any], driver_review: dict[str, Any],
    scenarios: dict[str, Any], underwriting_registry: dict[str, Any],
) -> dict[str, Any]:
    profiles = _by_ticker(tearsheets, "profiles", ("identity", "ticker"))
    reviews = _by_ticker(driver_review, "reviews")
    scenario_map = _by_ticker(scenarios, "companies")
    registry = _by_ticker(underwriting_registry, "companies")
    rows: list[dict[str, Any]] = []
    for ticker in sorted(set(profiles) | set(reviews) | set(scenario_map))[:MAX_COMPANIES]:
        existing = registry.get(ticker, {})
        if existing.get("formal_thesis_update_allowed") is True:
            rows.append({
                "ticker": ticker, "company_name": existing.get("company_name"),
                "draft_status": "skipped_existing_approved_underwriting", "draft_record": None,
                "reason": "Approved original underwriting already controls the formal thesis gate.",
            })
            continue
        draft = _draft_record(report_date, profiles.get(ticker, {}), reviews.get(ticker, {}), scenario_map.get(ticker, {}), existing)
        if draft:
            validate_underwriting_record(draft, datetime.fromisoformat(report_date).date())
        rows.append({
            "ticker": ticker, "company_name": (draft or existing).get("company_name"),
            "draft_status": "ready_for_user_or_pm_review" if draft else "blocked_insufficient_falsifiable_evidence",
            "draft_record": draft,
            "draft_hash": underwriting_draft_hash(draft) if draft else None,
            "reason": (
                "Source-bounded draft generated; all thresholds remain unapproved."
                if draft else "No source-linked pillar and draft break condition could be generated."
            ),
        })
    payload = {
        "schema_version": SCHEMA_VERSION, "report_date": report_date,
        "company_count": len(rows), "review_ready_count": sum(row["draft_status"] == "ready_for_user_or_pm_review" for row in rows),
        "companies": rows,
        "methodology": {
            "source_bounded_drafts_only": True, "variant_perception_inference_allowed": False,
            "thresholds_auto_approved": False, "registry_auto_mutation_allowed": False,
            "numeric_scores_generated": False, "position_actions_generated": False,
        },
        "posture": "draft_underwriting_for_explicit_review_not_original_house_view",
    }
    validate_company_underwriting_drafts(payload)
    return payload


def validate_company_underwriting_drafts(payload: dict[str, Any]) -> None:
    if payload.get("schema_version") != SCHEMA_VERSION:
        raise ValueError("Unexpected company underwriting draft schema")
    if int(payload.get("company_count", -1)) != len(payload.get("companies", [])):
        raise ValueError("Company count does not match underwriting drafts")
    for row in payload.get("companies", []):
        draft = row.get("draft_record")
        if row.get("draft_status") == "ready_for_user_or_pm_review":
            if not draft or (draft.get("approval") or {}).get("status") != "draft_pending_user_approval":
                raise ValueError("Review-ready underwriting must remain an unapproved draft")
            if row.get("draft_hash") != underwriting_draft_hash(draft):
                raise ValueError("Underwriting draft hash does not match the review payload")
            for criterion in draft.get("kill_criteria", []):
                if criterion.get("threshold_origin") != "Draft threshold for PM confirmation" or criterion.get("threshold_approval_status") != "draft_pending_user_approval":
                    raise ValueError("Generated kill criteria cannot masquerade as inherited or approved rules")
            if draft.get("variant_perception") != "not_established_requires_user_or_pm_view":
                raise ValueError("Generated draft cannot invent a variant perception")
            if (draft.get("draft_metadata") or {}).get("position_action_generated") is not False:
                raise ValueError("Generated underwriting draft cannot create a position action")
        elif draft is not None or row.get("draft_hash") is not None:
            raise ValueError("Blocked or skipped underwriting rows cannot contain a draft record")


def main() -> None:
    parser = argparse.ArgumentParser(description="Build source-bounded company underwriting drafts")
    parser.add_argument("--date", required=True)
    parser.add_argument("--company-tearsheets-file")
    parser.add_argument("--earnings-driver-review-file")
    parser.add_argument("--earnings-scenarios-file")
    parser.add_argument("--company-underwriting-file")
    parser.add_argument("--output-file")
    args = parser.parse_args()
    paths = {
        "tearsheets": root_path(args.company_tearsheets_file, ROOT / "workspace" / "company_tearsheets" / args.date / "company_tearsheets.json"),
        "driver_review": root_path(args.earnings_driver_review_file, ROOT / "workspace" / "company_earnings_driver_review" / args.date / "company_earnings_driver_review.json"),
        "scenarios": root_path(args.earnings_scenarios_file, ROOT / "workspace" / "company_earnings_scenarios" / args.date / "company_earnings_scenarios.json"),
        "underwriting": root_path(args.company_underwriting_file, ROOT / "workspace" / "company_underwriting" / args.date / "company_underwriting.json"),
    }
    for label, path in paths.items():
        if not path.exists():
            raise SystemExit(f"{label} does not exist: {path}")
    payload = build_company_underwriting_drafts(
        args.date, *[json.loads(paths[key].read_text(encoding="utf-8")) for key in ("tearsheets", "driver_review", "scenarios", "underwriting")],
    )
    output = root_path(args.output_file, ROOT / "workspace" / "company_underwriting_drafts" / args.date / "company_underwriting_drafts.json")
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Company underwriting drafts saved: {output.relative_to(ROOT)}")
    print(f"Drafts ready for review: {payload['review_ready_count']}/{payload['company_count']}")


if __name__ == "__main__":
    main()
