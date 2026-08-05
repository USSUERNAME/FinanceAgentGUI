"""Compare approved original underwriting with a source-verified post-earnings review."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from collectors.common import ROOT
from collect_company_market_context import root_path

SCHEMA_VERSION = "company_formal_thesis_update.v1"
COMPANY_STATUSES = {"strengthening", "intact", "watch", "impaired", "broken", "untested"}


def _by_ticker(payload: dict[str, Any], key: str) -> dict[str, dict[str, Any]]:
    return {str(row.get("ticker") or "").upper(): row for row in payload.get(key, []) if row.get("ticker")}


def _selector_value(review: dict[str, Any], selector: str) -> tuple[Any, list[str]]:
    if selector == "headline_result_case":
        row = review.get("headline_vs_pre_event_bar") or {}
        return row.get("interpretation") or row.get("scenario_case"), [
            source_id for source_id in [row.get("source_id"), *row.get("pre_event_source_ids", [])] if source_id
        ]
    if selector.startswith("operating_kpi:"):
        driver_id = selector.split(":", 1)[1]
        row = next((item for item in (review.get("quality_of_print") or {}).get("operating_kpi_checks", []) if item.get("driver_id") == driver_id), {})
        return row.get("evidence_signal"), [row.get("source_id")] if row.get("source_id") else []
    if selector == "eps_quality_status":
        row = review.get("eps_quality_screen") or {}
        return row.get("status"), list(dict.fromkeys([
            source_id for source_id in [row.get("source_id"), *[item.get("source_id") for item in row.get("bridge_items", [])]] if source_id
        ]))
    if selector == "guidance_status":
        row = review.get("guidance_review") or {}
        return row.get("status"), [item.get("source_id") for item in row.get("rows", []) if item.get("source_id")]
    if selector == "transcript_status":
        return (review.get("transcript_review") or {}).get("status"), []
    return None, []


def _pillar_result(pillar: dict[str, Any], review: dict[str, Any]) -> dict[str, Any]:
    checks: list[dict[str, Any]] = []
    for rule in pillar.get("evidence_rules", []):
        selector = str(rule.get("selector") or "")
        actual, source_ids = _selector_value(review, selector)
        if actual in rule.get("break_values", []):
            signal = "invalidating_or_break"
        elif actual in rule.get("warning_values", []):
            signal = "warning"
        elif actual in rule.get("confirming_values", []):
            signal = "confirming"
        elif actual is None:
            signal = "untested"
        else:
            signal = "mixed_or_unmapped"
        checks.append({
            "selector": selector, "actual_value": actual, "signal": signal,
            "source_ids": source_ids, "threshold_origin": "Inherited threshold",
            "threshold_approval_status": "Approved monitoring rule",
        })
    signals = {row["signal"] for row in checks}
    status = (
        "impaired" if "invalidating_or_break" in signals
        else "watch" if signals & {"warning", "mixed_or_unmapped"}
        else "confirming" if signals == {"confirming"}
        else "untested"
    )
    return {
        "pillar_id": pillar.get("pillar_id"), "pillar_name": pillar.get("pillar_name"),
        "claim": pillar.get("claim"), "priority": pillar.get("priority"),
        "prior_status": "original_underwriting_baseline", "current_status": status,
        "checks": checks, "next_proof_point": pillar.get("next_proof_point"),
        "underwriting_source_ids": list(pillar.get("source_ids", [])),
    }


def _formal_status(pillars: list[dict[str, Any]], kill_hits: list[dict[str, Any]], research_signal: str) -> tuple[str, str]:
    core = [row for row in pillars if row.get("priority") == "core"]
    if kill_hits:
        return "broken", "At least one explicitly approved inherited kill criterion matched source-verified evidence."
    if any(row.get("current_status") == "impaired" for row in core):
        return "impaired", "At least one approved core pillar is impaired; no Watch override is allowed without explicit PM rationale."
    if any(row.get("current_status") == "watch" for row in core):
        return "watch", "At least one approved core pillar has warning or unmapped evidence."
    if core and all(row.get("current_status") == "confirming" for row in core):
        if research_signal == "strengthening_evidence":
            return "strengthening", "All approved core pillars confirmed and the bounded post-earnings research signal strengthened."
        return "intact", "All approved core pillars confirmed without a strengthening post-earnings signal."
    return "untested", "The approved core pillars do not yet have complete mapped evidence."


def _company_update(underwriting_row: dict[str, Any], review: dict[str, Any]) -> dict[str, Any]:
    approved = underwriting_row.get("formal_thesis_update_allowed") is True
    underwriting = underwriting_row.get("selected_underwriting") or {}
    reviewed = review.get("review_status") == "source_verified_partial_post_earnings_deep_dive"
    if not approved or not reviewed:
        return {
            "ticker": underwriting_row.get("ticker") or review.get("ticker"),
            "company_name": underwriting_row.get("company_name") or review.get("company_name"),
            "update_status": "blocked_missing_approved_underwriting_or_verified_deep_dive",
            "company_thesis_status": "untested", "security_thesis_readiness": "not_decision_grade",
            "position_action": "wait_for_proof", "pillar_updates": [], "kill_criteria_checks": [],
            "blockers": list(dict.fromkeys([
                *underwriting_row.get("missing_artifacts", []), *review.get("blockers", []),
            ])),
            "source_index": list(review.get("source_index", [])),
            "decision_limit": "A formal company-thesis update requires both explicitly approved original underwriting and a source-verified deep dive.",
        }
    source_map = {str(row.get("source_id")): dict(row) for row in [*underwriting.get("source_index", []), *review.get("source_index", [])] if row.get("source_id")}
    pillars = [_pillar_result(pillar, review) for pillar in underwriting.get("pillars", [])]
    kill_checks: list[dict[str, Any]] = []
    for criterion in underwriting.get("kill_criteria", []):
        actual, evidence_source_ids = _selector_value(review, str(criterion.get("selector") or ""))
        hit = actual in criterion.get("match_values", []) and bool(evidence_source_ids)
        kill_checks.append({
            "kill_id": criterion.get("kill_id"), "claim": criterion.get("claim"),
            "selector": criterion.get("selector"), "actual_value": actual,
            "match_values": list(criterion.get("match_values", [])), "criterion_hit": hit,
            "threshold_origin": criterion.get("threshold_origin"),
            "threshold_approval_status": criterion.get("threshold_approval_status"),
            "underwriting_source_ids": list(criterion.get("source_ids", [])),
            "evidence_source_ids": evidence_source_ids,
        })
    research_signal = (review.get("bottom_line") or {}).get("research_case_signal", "untested")
    status, reason = _formal_status(pillars, [row for row in kill_checks if row["criterion_hit"]], research_signal)
    return {
        "ticker": underwriting_row.get("ticker"), "company_name": underwriting_row.get("company_name"),
        "underwriting_id": underwriting.get("underwriting_id"), "underwriting_version": underwriting.get("version"),
        "underwriting_approval": underwriting.get("approval"),
        "update_status": "formal_company_thesis_update_available",
        "original_underwriting": {
            key: underwriting.get(key) for key in (
                "one_sentence_thesis", "variant_perception", "market_setup",
                "valuation_anchor", "horizon", "catalysts", "open_diligence",
            )
        },
        "post_earnings_research_case_signal": research_signal,
        "company_thesis_status": status, "status_reason": reason,
        "pillar_updates": pillars, "kill_criteria_checks": kill_checks,
        "security_thesis_readiness": "not_decision_grade",
        "position_action": "wait_for_proof",
        "security_decision_gaps": [
            "post-result refreshed estimate set", "audited model and valuation/downside framework",
            "portfolio position, benchmark, active weight and risk budget",
        ],
        "next_review_gate": "complete_model_valuation_and_portfolio_context_for_security_decision",
        "source_index": list(source_map.values()),
        "decision_limit": "The approved company thesis may update; security readiness and position action remain blocked.",
    }


def build_company_thesis_update(
    report_date: str, underwriting_registry: dict[str, Any], deep_dive: dict[str, Any],
) -> dict[str, Any]:
    underwriting = _by_ticker(underwriting_registry, "companies")
    reviews = _by_ticker(deep_dive, "reviews")
    updates = [_company_update(underwriting.get(ticker, {"ticker": ticker}), reviews.get(ticker, {"ticker": ticker})) for ticker in sorted(set(underwriting) | set(reviews))]
    payload = {
        "schema_version": SCHEMA_VERSION, "report_date": report_date,
        "company_count": len(updates),
        "formal_update_count": sum(row["update_status"] == "formal_company_thesis_update_available" for row in updates),
        "updates": updates,
        "methodology": {
            "approved_original_underwriting_required": True,
            "exact_selector_matching_only": True,
            "kill_criteria_override": True,
            "company_and_security_thesis_separated": True,
            "automatic_position_action_allowed": False,
        },
        "posture": "formal_company_thesis_gate_not_security_or_position_decision",
    }
    validate_company_thesis_update(payload)
    return payload


def validate_company_thesis_update(payload: dict[str, Any]) -> None:
    if payload.get("schema_version") != SCHEMA_VERSION:
        raise ValueError("Unexpected formal company thesis update schema")
    if int(payload.get("company_count", -1)) != len(payload.get("updates", [])):
        raise ValueError("Company count does not match formal thesis updates")
    for update in payload.get("updates", []):
        if update.get("company_thesis_status") not in COMPANY_STATUSES:
            raise ValueError("Unsupported formal company thesis status")
        if update.get("security_thesis_readiness") != "not_decision_grade" or update.get("position_action") != "wait_for_proof":
            raise ValueError("Formal company-thesis gate cannot issue a security or position decision")
        if update.get("update_status") == "formal_company_thesis_update_available":
            approval = update.get("underwriting_approval") or {}
            if approval.get("status") != "approved_by_user_or_pm" or not approval.get("approved_by"):
                raise ValueError("Formal thesis update requires explicit underwriting approval")
            source_ids = {row.get("source_id") for row in update.get("source_index", [])}
            for pillar in update.get("pillar_updates", []):
                if any(source_id not in source_ids for source_id in pillar.get("underwriting_source_ids", [])):
                    raise ValueError("Formal pillar update requires underwriting source lineage")
                for check in pillar.get("checks", []):
                    if any(source_id not in source_ids for source_id in check.get("source_ids", [])):
                        raise ValueError("Formal pillar update requires evidence source lineage")
            for check in update.get("kill_criteria_checks", []):
                if any(source_id not in source_ids for source_id in [*check.get("underwriting_source_ids", []), *check.get("evidence_source_ids", [])]):
                    raise ValueError("Kill-criterion check requires complete source lineage")


def main() -> None:
    parser = argparse.ArgumentParser(description="Build formal company-thesis updates from approved underwriting")
    parser.add_argument("--date", required=True)
    parser.add_argument("--company-underwriting-file")
    parser.add_argument("--company-earnings-deep-dive-file")
    parser.add_argument("--output-file")
    args = parser.parse_args()
    underwriting_path = root_path(args.company_underwriting_file, ROOT / "workspace" / "company_underwriting" / args.date / "company_underwriting.json")
    deep_dive_path = root_path(args.company_earnings_deep_dive_file, ROOT / "workspace" / "company_earnings_deep_dive" / args.date / "company_earnings_deep_dive.json")
    for label, path in (("Company underwriting", underwriting_path), ("Company earnings deep dive", deep_dive_path)):
        if not path.exists():
            raise SystemExit(f"{label} does not exist: {path}")
    payload = build_company_thesis_update(
        args.date,
        json.loads(underwriting_path.read_text(encoding="utf-8")),
        json.loads(deep_dive_path.read_text(encoding="utf-8")),
    )
    output = root_path(args.output_file, ROOT / "workspace" / "company_thesis_updates" / args.date / "company_thesis_update.json")
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Formal company thesis update saved: {output.relative_to(ROOT)}")
    print(f"Formal updates: {payload['formal_update_count']}/{payload['company_count']}")


if __name__ == "__main__":
    main()
