"""Maintain append-only company thesis baselines from evidence-gated earnings triggers."""

from __future__ import annotations

import argparse
import hashlib
import json
from collections import Counter
from datetime import date
from pathlib import Path
from typing import Any

from collectors.common import ROOT
from collect_company_market_context import root_path

SCHEMA_VERSION = "company_thesis_history.v1"
REVIEW_SCHEMA_VERSION = "daily_company_thesis_review.v1"
ALLOWED_GATE_STATES = {
    "conditional_thesis_triggers_available",
    "blocked_missing_exact_event_bar_or_driver",
}
ALLOWED_TRANSITIONS = {
    "baseline_created", "unchanged", "pre_event_trigger_pack_ready",
    "evidence_gate_lost", "gate_inputs_changed", "post_earnings_input_pack_ready",
    "post_earnings_deep_dive_ready", "formal_company_thesis_updated",
}
ALLOWED_COMPANY_THESIS_STATUSES = {
    "strengthening", "intact", "watch", "impaired", "broken", "changed", "untested", "retired",
}


def _rule(scenario: dict[str, Any]) -> dict[str, Any]:
    return {
        "rule_id": f"earnings:{scenario.get('scenario')}:{scenario.get('driver')}:{scenario.get('period_end')}",
        "scenario": scenario.get("scenario"),
        "metric_id": scenario.get("driver"),
        "period_end": scenario.get("period_end"),
        "units": scenario.get("units"),
        "operator": scenario.get("operator"),
        "threshold_low": scenario.get("threshold_low"),
        "threshold_high": scenario.get("threshold_high"),
        "threshold_origin": "Draft threshold for PM confirmation",
        "threshold_approval_status": "unapproved",
        "required_source": "Body-verified earnings release and comparable KPI disclosure",
        "research_implication": scenario.get("thesis_effect"),
        "position_action_allowed": False,
        "next_review": "after_source_verified_earnings_deep_dive",
        "source_ids": list(scenario.get("source_ids", [])),
    }


def _pillars(company: dict[str, Any]) -> list[dict[str, Any]]:
    scenarios = company.get("conditional_scenarios", [])
    pillars: list[dict[str, Any]] = []
    if scenarios:
        reference = scenarios[0]
        pillars.append({
            "pillar_id": f"earnings_range:{reference.get('driver')}:{reference.get('period_end')}",
            "pillar_name": "Verified earnings-range outcome",
            "claim": "Reported result must be compared with the body-verified company range before the thesis is updated.",
            "priority": "core",
            "weighting_origin": "qualitative_no_score",
            "current_status": "untested",
            "signal": "untested",
            "metric_id": reference.get("driver"),
            "period_end": reference.get("period_end"),
            "units": reference.get("units"),
            "next_proof_point": "Body-verified reported result for the exact period and units",
            "source_ids": list(reference.get("source_ids", [])),
        })
        seen: set[str] = set()
        for cross_check in reference.get("operating_cross_checks", []):
            driver_id = str(cross_check.get("driver_id") or "")
            if not driver_id or driver_id in seen:
                continue
            seen.add(driver_id)
            pillars.append({
                "pillar_id": f"operating_driver:{driver_id}",
                "pillar_name": driver_id,
                "claim": cross_check.get("confirmation_condition"),
                "priority": "core",
                "weighting_origin": "qualitative_no_score",
                "current_status": "untested",
                "signal": "untested",
                "prior_expected_trend": cross_check.get("trend_status"),
                "warning_or_break_condition": cross_check.get("falsifier"),
                "next_proof_point": f"Next body-verified comparable {driver_id} disclosure",
                "source_ids": [cross_check.get("source_id")],
            })
    return pillars


def _record(
    report_date: str, revision: int, company: dict[str, Any], post_earnings: dict[str, Any] | None = None,
) -> dict[str, Any]:
    ticker = str(company.get("ticker") or "unknown")
    gate = str(company.get("scenario_gate_status") or "blocked_missing_exact_event_bar_or_driver")
    ready = gate == "conditional_thesis_triggers_available"
    post_earnings = post_earnings or {}
    sources = {str(row.get("source_id")): dict(row) for row in company.get("source_index", []) if row.get("source_id")}
    for source in post_earnings.get("source_index", []):
        if source.get("source_id"):
            sources[str(source["source_id"])] = dict(source)
    post_ready = post_earnings.get("pack_status") == "ready_for_post_earnings_deep_dive"
    post_gaps = ([{
        "area": "post_earnings_deep_dive",
        "severity": "blocker",
        "required": item,
    } for item in post_earnings.get("missing_artifacts", [])] if post_ready else [{
        "area": "post_earnings_actuals",
        "severity": "blocker",
        "required": "Body-verified earnings release and comparable KPI result",
    }])
    return {
        "record_id": f"{report_date}:R{revision}:{ticker}",
        "thesis_id": f"company:{company.get('candidate_id') or ticker}",
        "report_date": report_date,
        "revision": revision,
        "candidate_id": company.get("candidate_id"),
        "ticker": ticker,
        "company_name": company.get("company_name"),
        "event_date": company.get("event_date"),
        "event_source_id": company.get("event_source_id"),
        "scenario_gate_status": gate,
        "company_thesis_status": "untested",
        "security_thesis_readiness": "not_decision_grade",
        "position_action": "wait_for_proof",
        "original_underwriting_status": "not_supplied",
        "scenario_mode": company.get("scenario_mode"),
        "pillars": _pillars(company),
        "action_rules": [_rule(row) for row in company.get("conditional_scenarios", [])],
        "post_earnings_pack_status": post_earnings.get("pack_status") or "not_available",
        "post_earnings_evidence": ({
            "result_id": post_earnings.get("result_id"),
            "headline_result_case": post_earnings.get("headline_result_case"),
            "reported_metric_comparison": post_earnings.get("reported_metric_comparison"),
            "operating_kpi_checks": list(post_earnings.get("operating_kpi_checks", [])),
            "eps_quality": post_earnings.get("eps_quality"),
            "transcript_status": post_earnings.get("transcript_status"),
            "evidence_posture": "input_pack_only_not_deep_dive_conclusion",
        } if post_earnings else None),
        "evidence_gaps": [
            *list(company.get("gate_gaps", [])),
            *post_gaps,
            {"area": "model_and_valuation", "severity": "decision_blocker", "required": "Current model, valuation and downside framework"},
            {"area": "portfolio_context", "severity": "decision_blocker", "required": "Position, benchmark, active weight and risk budget"},
        ],
        "source_index": list(sources.values()),
        "next_review_gate": (
            "complete_source_verified_post_earnings_deep_dive" if post_ready
            else "source_verified_post_earnings_deep_dive" if ready
            else "complete_missing_pre_event_evidence_gate"
        ),
        "review_cadence": "each_successful_daily_report_and_after_confirmed_earnings",
        "post_catalyst_update_sla": "next_successful_report_after_primary_results_are_available",
        "decision_limit": "This is an untested research baseline. It cannot approve a position action or a security conclusion.",
    }


def _record_from_prior_with_post_earnings(
    report_date: str, revision: int, previous: dict[str, Any], post_earnings: dict[str, Any],
) -> dict[str, Any]:
    row = json.loads(json.dumps(previous, ensure_ascii=False))
    row.update({
        "record_id": f"{report_date}:R{revision}:{previous.get('ticker')}",
        "report_date": report_date,
        "revision": revision,
        "post_earnings_pack_status": post_earnings.get("pack_status"),
        "post_earnings_evidence": {
            "result_id": post_earnings.get("result_id"),
            "headline_result_case": post_earnings.get("headline_result_case"),
            "reported_metric_comparison": post_earnings.get("reported_metric_comparison"),
            "operating_kpi_checks": list(post_earnings.get("operating_kpi_checks", [])),
            "eps_quality": post_earnings.get("eps_quality"),
            "transcript_status": post_earnings.get("transcript_status"),
            "evidence_posture": "input_pack_only_not_deep_dive_conclusion",
        },
        "company_thesis_status": "untested",
        "security_thesis_readiness": "not_decision_grade",
        "position_action": "wait_for_proof",
        "next_review_gate": "complete_source_verified_post_earnings_deep_dive",
    })
    sources = {str(source.get("source_id")): source for source in row.get("source_index", []) if source.get("source_id")}
    for source in post_earnings.get("source_index", []):
        if source.get("source_id"):
            sources[str(source["source_id"])] = dict(source)
    row["source_index"] = list(sources.values())
    row["evidence_gaps"] = [
        gap for gap in row.get("evidence_gaps", []) if gap.get("area") != "post_earnings_actuals"
    ] + [{
        "area": "post_earnings_deep_dive",
        "severity": "blocker",
        "required": item,
    } for item in post_earnings.get("missing_artifacts", [])]
    return row


def _attach_post_earnings_deep_dive(row: dict[str, Any], deep_dive: dict[str, Any] | None) -> dict[str, Any]:
    if not deep_dive:
        return row
    result = json.loads(json.dumps(row, ensure_ascii=False))
    reviewed = deep_dive.get("review_status") == "source_verified_partial_post_earnings_deep_dive"
    bottom_line = deep_dive.get("bottom_line") or {}
    result.update({
        "post_earnings_deep_dive_status": deep_dive.get("review_status"),
        "post_earnings_research_case_signal": bottom_line.get(
            "research_case_signal", deep_dive.get("research_case_signal", "untested")
        ),
        "post_earnings_deep_dive": ({
            "result_id": deep_dive.get("result_id"),
            "research_case_signal": bottom_line.get("research_case_signal"),
            "rationale": bottom_line.get("rationale"),
            "headline_vs_pre_event_bar": deep_dive.get("headline_vs_pre_event_bar"),
            "quality_of_print": deep_dive.get("quality_of_print"),
            "eps_quality_screen": deep_dive.get("eps_quality_screen"),
            "guidance_review": deep_dive.get("guidance_review"),
            "transcript_review": deep_dive.get("transcript_review"),
            "model_update_packet": deep_dive.get("model_update_packet"),
            "security_context": deep_dive.get("security_context"),
            "evidence_posture": "research_direction_only_not_formal_thesis_change",
        } if reviewed else None),
        "company_thesis_status": "untested",
        "security_thesis_readiness": "not_decision_grade",
        "position_action": "wait_for_proof",
        "next_review_gate": (
            "attach_approved_original_underwriting_then_review_formal_thesis"
            if reviewed else result.get("next_review_gate")
        ),
    })
    sources = {str(source.get("source_id")): source for source in result.get("source_index", []) if source.get("source_id")}
    for source in deep_dive.get("source_index", []):
        if source.get("source_id"):
            sources[str(source["source_id"])] = dict(source)
    result["source_index"] = list(sources.values())
    if reviewed:
        result["evidence_gaps"] = [
            gap for gap in result.get("evidence_gaps", []) if gap.get("area") != "post_earnings_deep_dive"
        ] + [{
            "area": "formal_thesis_update",
            "severity": "blocker",
            "required": item,
        } for item in deep_dive.get("blockers", [])]
    return result


def _attach_formal_thesis_update(row: dict[str, Any], formal_update: dict[str, Any] | None) -> dict[str, Any]:
    if not formal_update or formal_update.get("update_status") != "formal_company_thesis_update_available":
        return row
    result = json.loads(json.dumps(row, ensure_ascii=False))
    result.update({
        "original_underwriting_status": "approved_by_user_or_pm",
        "formal_thesis_update_status": formal_update.get("update_status"),
        "formal_thesis_update": {
            "underwriting_id": formal_update.get("underwriting_id"),
            "underwriting_version": formal_update.get("underwriting_version"),
            "underwriting_approval": formal_update.get("underwriting_approval"),
            "post_earnings_research_case_signal": formal_update.get("post_earnings_research_case_signal"),
            "status_reason": formal_update.get("status_reason"),
            "pillar_updates": formal_update.get("pillar_updates"),
            "kill_criteria_checks": formal_update.get("kill_criteria_checks"),
            "security_decision_gaps": formal_update.get("security_decision_gaps"),
        },
        "company_thesis_status": formal_update.get("company_thesis_status"),
        "security_thesis_readiness": "not_decision_grade",
        "position_action": "wait_for_proof",
        "next_review_gate": formal_update.get("next_review_gate"),
    })
    sources = {str(source.get("source_id")): source for source in result.get("source_index", []) if source.get("source_id")}
    for source in formal_update.get("source_index", []):
        if source.get("source_id"):
            sources[str(source["source_id"])] = dict(source)
    result["source_index"] = list(sources.values())
    result["evidence_gaps"] = [
        gap for gap in result.get("evidence_gaps", []) if gap.get("area") != "formal_thesis_update"
    ] + [{
        "area": "security_decision",
        "severity": "decision_blocker",
        "required": item,
    } for item in formal_update.get("security_decision_gaps", [])]
    return result


def _content_hash(records: list[dict[str, Any]]) -> str:
    material = [{k: v for k, v in row.items() if k not in {"record_id", "revision"}} for row in records]
    encoded = json.dumps(material, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _latest_prior(history: dict[str, Any], report_date: str) -> dict[str, dict[str, Any]]:
    dates = sorted({
        row.get("report_date") for row in history.get("daily_records", [])
        if row.get("report_date") and row["report_date"] < report_date
    })
    if not dates:
        return {}
    latest = dates[-1]
    revision = max(
        int(row.get("revision", 1)) for row in history.get("daily_records", [])
        if row.get("report_date") == latest
    )
    return {
        row["thesis_id"]: row for row in history.get("daily_records", [])
        if row.get("report_date") == latest and int(row.get("revision", 1)) == revision
    }


def _transition(current: dict[str, Any], previous: dict[str, Any] | None) -> dict[str, Any]:
    if previous is None:
        transition = "baseline_created"
        reason = "No prior company thesis baseline is available."
    elif current.get("formal_thesis_update_status") == "formal_company_thesis_update_available" and (
        previous.get("company_thesis_status") != current.get("company_thesis_status")
        or previous.get("formal_thesis_update_status") != current.get("formal_thesis_update_status")
    ):
        transition = "formal_company_thesis_updated"
        reason = (current.get("formal_thesis_update") or {}).get("status_reason") or "Approved original underwriting was compared with source-verified evidence."
    elif previous.get("post_earnings_deep_dive_status") != "source_verified_partial_post_earnings_deep_dive" and current.get("post_earnings_deep_dive_status") == "source_verified_partial_post_earnings_deep_dive":
        transition = "post_earnings_deep_dive_ready"
        reason = "A source-verified research-direction review is available; formal thesis status remains untested until original underwriting is attached."
    elif previous.get("post_earnings_pack_status") != "ready_for_post_earnings_deep_dive" and current.get("post_earnings_pack_status") == "ready_for_post_earnings_deep_dive":
        transition = "post_earnings_input_pack_ready"
        reason = "Exact source-verified results and a comparable KPI are ready for deep-dive review; no thesis conclusion is implied."
    elif previous.get("scenario_gate_status") != current.get("scenario_gate_status"):
        if current.get("scenario_gate_status") == "conditional_thesis_triggers_available":
            transition = "pre_event_trigger_pack_ready"
            reason = "The exact event, expectation bar, guidance and operating-driver gate is now complete."
        else:
            transition = "evidence_gate_lost"
            reason = "A required pre-event evidence gate is no longer complete; this is not a fundamental deterioration claim."
    elif previous.get("action_rules") != current.get("action_rules") or previous.get("pillars") != current.get("pillars"):
        transition = "gate_inputs_changed"
        reason = "The sourced trigger or operating-proof inputs changed and require a fresh deep-dive baseline."
    else:
        transition = "unchanged"
        reason = "No material deterministic change to the pre-event thesis baseline was detected."
    return {
        "transition": transition,
        "reason": reason,
        "company_thesis_status": current.get("company_thesis_status", "untested"),
        "security_thesis_readiness": current.get("security_thesis_readiness", "not_decision_grade"),
        "position_action": current.get("position_action", "wait_for_proof"),
    }


def _summary(history: dict[str, Any]) -> dict[str, Any]:
    dates = sorted({row.get("report_date") for row in history.get("daily_records", []) if row.get("report_date")})
    return {
        "tracked_report_count": len(dates),
        "latest_report_date": dates[-1] if dates else None,
        "transition_counts": dict(sorted(Counter(
            row.get("transition", "unknown") for row in history.get("transition_events", [])
        ).items())),
        "note": "Counts monitor research-process state, not investment performance.",
    }


def validate_company_thesis_history(history: dict[str, Any], review: dict[str, Any]) -> None:
    if history.get("schema_version") != SCHEMA_VERSION or review.get("schema_version") != REVIEW_SCHEMA_VERSION:
        raise ValueError("Unexpected company thesis tracker schema")
    seen_records: set[str] = set()
    for row in history.get("daily_records", []):
        if row.get("record_id") in seen_records:
            raise ValueError("Company thesis history must be append-only with unique record IDs")
        seen_records.add(str(row.get("record_id")))
        if row.get("scenario_gate_status") not in ALLOWED_GATE_STATES:
            raise ValueError("Unsupported company thesis evidence gate")
        formal = row.get("formal_thesis_update") or {}
        if row.get("company_thesis_status") not in ALLOWED_COMPANY_THESIS_STATUSES:
            raise ValueError("Unsupported company thesis status")
        if row.get("company_thesis_status") != "untested":
            approval = formal.get("underwriting_approval") or {}
            if row.get("formal_thesis_update_status") != "formal_company_thesis_update_available" or approval.get("status") != "approved_by_user_or_pm":
                raise ValueError("Tracker cannot promote company thesis status without an approved formal thesis update")
        if row.get("security_thesis_readiness") != "not_decision_grade":
            raise ValueError("Pre-event tracker cannot promote security thesis readiness")
        if row.get("position_action") != "wait_for_proof":
            raise ValueError("Pre-event tracker cannot issue a position action")
        source_ids = {source.get("source_id") for source in row.get("source_index", [])}
        for rule in row.get("action_rules", []):
            if rule.get("threshold_origin") != "Draft threshold for PM confirmation" or rule.get("threshold_approval_status") != "unapproved":
                raise ValueError("System-generated thresholds must remain unapproved drafts")
            if rule.get("position_action_allowed") is not False:
                raise ValueError("Draft earnings rules cannot authorize position actions")
            if not rule.get("source_ids") or any(source_id not in source_ids for source_id in rule.get("source_ids", [])):
                raise ValueError("Every company thesis rule requires source lineage")
        for pillar in row.get("pillars", []):
            if pillar.get("weighting_origin") != "qualitative_no_score" or pillar.get("current_status") != "untested":
                raise ValueError("Pre-event pillars must remain qualitative and untested")
            if any(source_id not in source_ids for source_id in pillar.get("source_ids", [])):
                raise ValueError("Every company thesis pillar requires source lineage")
        post = row.get("post_earnings_evidence") or {}
        metric = post.get("reported_metric_comparison") or {}
        if metric and metric.get("source_id") not in source_ids:
            raise ValueError("Post-earnings metric requires source lineage")
        for kpi in post.get("operating_kpi_checks", []):
            if kpi.get("source_id") not in source_ids:
                raise ValueError("Post-earnings KPI requires source lineage")
        deep_dive = row.get("post_earnings_deep_dive") or {}
        if deep_dive:
            if row.get("post_earnings_research_case_signal") not in {
                "strengthening_evidence", "within_range_evidence", "mixed_evidence",
                "weakening_evidence", "untested",
            }:
                raise ValueError("Unsupported tracked post-earnings research signal")
            deep_metric = deep_dive.get("headline_vs_pre_event_bar") or {}
            if deep_metric.get("source_id") not in source_ids:
                raise ValueError("Tracked post-earnings deep dive requires source lineage")
        if formal:
            for pillar in formal.get("pillar_updates", []):
                if any(source_id not in source_ids for source_id in pillar.get("underwriting_source_ids", [])):
                    raise ValueError("Tracked formal thesis pillar requires underwriting source lineage")
                for check in pillar.get("checks", []):
                    if any(source_id not in source_ids for source_id in check.get("source_ids", [])):
                        raise ValueError("Tracked formal thesis pillar requires evidence source lineage")
    for event in history.get("transition_events", []):
        if event.get("transition") not in ALLOWED_TRANSITIONS:
            raise ValueError("Unsupported company thesis transition")


def update_company_thesis_history(
    history: dict[str, Any], report_date: str, earnings_scenarios: dict[str, Any],
    post_earnings_results: dict[str, Any] | None = None,
    post_earnings_deep_dive: dict[str, Any] | None = None,
    formal_thesis_updates: dict[str, Any] | None = None,
) -> tuple[dict[str, Any], dict[str, Any]]:
    daily_records = history.setdefault("daily_records", [])
    transition_events = history.setdefault("transition_events", [])
    same_day = [int(row.get("revision", 1)) for row in daily_records if row.get("report_date") == report_date]
    candidate_revision = max(same_day, default=0) + 1
    prior = _latest_prior(history, report_date)
    post_by_ticker = {
        str(row.get("ticker") or "").upper(): row
        for row in (post_earnings_results or {}).get("companies", [])
    }
    deep_dive_by_ticker = {
        str(row.get("ticker") or "").upper(): row
        for row in (post_earnings_deep_dive or {}).get("reviews", [])
    }
    formal_by_ticker = {
        str(row.get("ticker") or "").upper(): row
        for row in (formal_thesis_updates or {}).get("updates", [])
    }
    current_companies = {
        str(company.get("ticker") or "").upper(): company
        for company in earnings_scenarios.get("companies", [])
    }
    prior_by_ticker = {str(row.get("ticker") or "").upper(): row for row in prior.values()}
    tickers = sorted(set(current_companies) | set(post_by_ticker) | set(formal_by_ticker))
    candidates: list[dict[str, Any]] = []
    for ticker in tickers:
        post = post_by_ticker.get(ticker)
        previous = prior_by_ticker.get(ticker)
        if post and post.get("pack_status") == "ready_for_post_earnings_deep_dive" and previous:
            candidates.append(_attach_formal_thesis_update(
                _attach_post_earnings_deep_dive(
                    _record_from_prior_with_post_earnings(report_date, candidate_revision, previous, post),
                    deep_dive_by_ticker.get(ticker),
                ), formal_by_ticker.get(ticker),
            ))
        elif ticker in current_companies:
            candidates.append(_attach_formal_thesis_update(
                _attach_post_earnings_deep_dive(
                    _record(report_date, candidate_revision, current_companies[ticker], post),
                    deep_dive_by_ticker.get(ticker),
                ), formal_by_ticker.get(ticker),
            ))
    content_hash = _content_hash(candidates)
    existing = next((
        run for run in history.get("runs", [])
        if run.get("report_date") == report_date and run.get("content_hash") == content_hash
    ), None)
    if existing:
        revision = int(existing["revision"])
        current = [
            row for row in daily_records
            if row.get("report_date") == report_date and int(row.get("revision", 1)) == revision
        ]
        events = [
            row for row in transition_events
            if row.get("report_date") == report_date and int(row.get("revision", 1)) == revision
        ]
    else:
        revision = candidate_revision
        current = candidates
        events = []
        for row in current:
            state = _transition(row, prior.get(row["thesis_id"]))
            row["transition"] = state["transition"]
            events.append({
                "event_id": f"{row['record_id']}:transition",
                "report_date": report_date,
                "revision": revision,
                "thesis_id": row["thesis_id"],
                "ticker": row["ticker"],
                "event_date": row.get("event_date"),
                "next_review_gate": row.get("next_review_gate"),
                **state,
            })
        daily_records.extend(current)
        transition_events.extend(events)
        history.setdefault("runs", []).append({
            "report_date": report_date,
            "revision": revision,
            "content_hash": content_hash,
            "record_count": len(current),
            "supersedes_revision": revision - 1 if revision > 1 else None,
        })

    history.update({
        "schema_version": SCHEMA_VERSION,
        "updated_report_date": report_date,
        "summary": _summary(history),
    })
    review = {
        "schema_version": REVIEW_SCHEMA_VERSION,
        "report_date": report_date,
        "revision": revision,
        "is_idempotent_rerun": existing is not None,
        "material_changes": [row for row in events if row.get("transition") not in {"baseline_created", "unchanged"}],
        "current_company_states": [{
            key: row.get(key) for key in (
                "thesis_id", "candidate_id", "ticker", "company_name", "event_date",
                "scenario_gate_status", "company_thesis_status", "security_thesis_readiness",
                "position_action", "transition", "next_review_gate", "evidence_gaps",
                "post_earnings_pack_status",
                "post_earnings_deep_dive_status", "post_earnings_research_case_signal",
                "formal_thesis_update_status",
            )
        } for row in current],
        "operating_model": {
            "pm_owner": "not_supplied",
            "analyst_owner": "daily_report_pipeline",
            "evidence_owner": "primary_source_collectors",
            "kpi_owner": "not_supplied",
            "model_owner": "not_supplied",
            "decision_authority": "not_supplied",
            "review_cadence": "each_successful_daily_report_and_after_confirmed_earnings",
            "post_catalyst_update_sla": "next_successful_report_after_primary_results_are_available",
            "decision_log_owner": "append_only_company_thesis_history",
        },
        "cumulative_summary": history["summary"],
        "decision_limit": "Pre-event baseline only: no thesis promotion, valuation conclusion, or position action without a source-verified post-earnings deep dive.",
    }
    validate_company_thesis_history(history, review)
    return history, review


def main() -> None:
    parser = argparse.ArgumentParser(description="Track append-only company thesis baselines")
    parser.add_argument("--date", default=date.today().isoformat())
    parser.add_argument("--earnings-scenarios-file")
    parser.add_argument("--post-earnings-results-file")
    parser.add_argument("--post-earnings-deep-dive-file")
    parser.add_argument("--formal-thesis-updates-file")
    parser.add_argument("--history-file")
    args = parser.parse_args()
    scenario_path = root_path(
        args.earnings_scenarios_file,
        ROOT / "workspace" / "company_earnings_scenarios" / args.date / "company_earnings_scenarios.json",
    )
    history_path = root_path(
        args.history_file,
        ROOT / "workspace" / "history" / "company_thesis_history.json",
    )
    if not scenario_path.exists():
        raise SystemExit(f"Company earnings scenarios do not exist: {scenario_path}")
    results_path = root_path(
        args.post_earnings_results_file,
        ROOT / "workspace" / "company_earnings_results" / args.date / "company_earnings_results.json",
    )
    if not results_path.exists():
        raise SystemExit(f"Company post-earnings results do not exist: {results_path}")
    deep_dive_path = root_path(
        args.post_earnings_deep_dive_file,
        ROOT / "workspace" / "company_earnings_deep_dive" / args.date / "company_earnings_deep_dive.json",
    )
    if not deep_dive_path.exists():
        raise SystemExit(f"Company post-earnings deep dive does not exist: {deep_dive_path}")
    formal_updates_path = root_path(
        args.formal_thesis_updates_file,
        ROOT / "workspace" / "company_thesis_updates" / args.date / "company_thesis_update.json",
    )
    if not formal_updates_path.exists():
        raise SystemExit(f"Formal company thesis updates do not exist: {formal_updates_path}")
    scenarios = json.loads(scenario_path.read_text(encoding="utf-8"))
    history = json.loads(history_path.read_text(encoding="utf-8")) if history_path.exists() else {}
    results = json.loads(results_path.read_text(encoding="utf-8"))
    deep_dive = json.loads(deep_dive_path.read_text(encoding="utf-8"))
    formal_updates = json.loads(formal_updates_path.read_text(encoding="utf-8"))
    history, review = update_company_thesis_history(history, args.date, scenarios, results, deep_dive, formal_updates)
    history_path.parent.mkdir(parents=True, exist_ok=True)
    history_path.write_text(json.dumps(history, ensure_ascii=False, indent=2), encoding="utf-8")
    review_dir = history_path.parent / "company_thesis_reviews"
    review_dir.mkdir(parents=True, exist_ok=True)
    review_path = review_dir / f"{args.date}.json"
    review_path.write_text(json.dumps(review, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Company thesis history saved: {history_path.relative_to(ROOT)}")
    print(f"Daily company thesis review saved: {review_path.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
