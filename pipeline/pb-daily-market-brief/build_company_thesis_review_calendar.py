"""Build a source-backed review calendar for explicitly approved company theses."""

from __future__ import annotations

import argparse
import json
from datetime import date, timedelta
from pathlib import Path
from typing import Any

from collectors.common import ROOT
from collect_company_market_context import root_path
from collect_company_review_operating_config import validate_company_review_operating_config

SCHEMA_VERSION = "company_thesis_review_calendar.v1"


def _by_ticker(payload: dict[str, Any], key: str = "companies") -> dict[str, dict[str, Any]]:
    return {
        str(row.get("ticker") or "").upper(): row
        for row in payload.get(key, []) if row.get("ticker")
    }


def _source_map(*rows: dict[str, Any]) -> list[dict[str, Any]]:
    sources: dict[str, dict[str, Any]] = {}
    for row in rows:
        for source in row.get("source_index", []):
            if source.get("source_id"):
                sources[str(source["source_id"])] = dict(source)
    return list(sources.values())


def _formal_status(update: dict[str, Any]) -> str:
    if update.get("update_status") == "formal_company_thesis_update_available":
        return str(update.get("company_thesis_status") or "untested")
    return "approved_baseline_awaiting_source_verified_update"


def _prep_due_date(event_date: str, prep: dict[str, Any]) -> str:
    target = date.fromisoformat(event_date)
    remaining = int(prep["value"])
    if prep["unit"] == "calendar_days":
        return (target - timedelta(days=remaining)).isoformat()
    while remaining:
        target -= timedelta(days=1)
        if target.weekday() < 5:
            remaining -= 1
    return target.isoformat()


def _company_calendar(
    report_date: str, company: dict[str, Any], event_gate: dict[str, Any],
    thesis_update: dict[str, Any], operating_config_row: dict[str, Any],
) -> dict[str, Any]:
    underwriting = company["selected_underwriting"]
    operating_config = (
        operating_config_row.get("selected_config")
        if operating_config_row.get("configuration_status") == "approved_operating_config_available"
        else None
    ) or {}
    owners = operating_config.get("owners") or {}
    review_policy = operating_config.get("review_policy") or {}
    ticker = str(company["ticker"]).upper()
    source_index = _source_map(underwriting, event_gate, thesis_update, operating_config)
    source_ids = {str(row.get("source_id")) for row in source_index}
    pillar_ids = [str(row.get("pillar_id")) for row in underwriting.get("pillars", [])]
    dated_reviews: list[dict[str, Any]] = []
    selected = event_gate.get("selected_event")
    if event_gate.get("event_gate_status") == "confirmed_primary_exact_date" and selected:
        event_source_id = str(selected.get("source_id") or "")
        prep = review_policy.get("prep_lead_time") or None
        sla = review_policy.get("post_event_update_sla") or None
        dated_reviews.append({
            "review_id": f"review:{ticker}:earnings:{selected.get('event_id')}",
            "ticker": ticker,
            "event_category": "earnings_and_guidance",
            "event_name": f"{ticker} earnings thesis review",
            "reported_period": selected.get("reported_period"),
            "date_type": "hard_date",
            "event_date": selected.get("event_date"),
            "time_of_day": selected.get("time_of_day"),
            "time_zone": selected.get("time_zone"),
            "confidence": "confirmed",
            "source_id": event_source_id,
            "source_date": selected.get("source_date"),
            "thesis_pillar_ids": pillar_ids,
            "what_could_change": "Company-thesis pillar and approved kill-criterion status after source-verified results.",
            "prep_required": [
                "Freeze the pre-event evidence bar and confirm exact period, units, and accounting basis.",
                "Prepare body-verified result, KPI quality, guidance, and transcript source slots.",
            ],
            "prep_owner": owners.get("analyst_owner"),
            "prep_due_date": _prep_due_date(str(selected.get("event_date")), prep) if prep else None,
            "prep_due_date_basis": prep.get("unit") if prep else None,
            "post_event_update_sla": sla,
            "post_event_handoff": [
                "collect_company_earnings_results",
                "build_company_earnings_deep_dive",
                "build_company_thesis_update",
            ],
            "decision_implication": "company_thesis_review_only",
            "security_or_position_action_allowed": False,
        })

    soft_date_candidates = [{
        "event_id": row.get("event_id"),
        "ticker": ticker,
        "event_category": "earnings_and_guidance",
        "event_name": f"{ticker} expected earnings date candidate",
        "date_type": "soft_date",
        "event_date": row.get("event_date"),
        "confidence": "expected",
        "source_id": row.get("source_id"),
        "decision_limit": "Primary company confirmation is required before this becomes an exact review date.",
    } for row in event_gate.get("provider_expected_events", [])]

    undated_proof_queue = [{
        "proof_id": f"proof:{ticker}:{pillar.get('pillar_id')}",
        "ticker": ticker,
        "pillar_id": pillar.get("pillar_id"),
        "pillar_name": pillar.get("pillar_name"),
        "priority": pillar.get("priority"),
        "next_proof_point": pillar.get("next_proof_point"),
        "source_ids": list(pillar.get("source_ids", [])),
        "date_status": "undated_requires_source_or_owner_cadence",
        "owner": owners.get("evidence_owner"),
        "review_cadence": review_policy.get("cadence"),
    } for pillar in underwriting.get("pillars", []) if pillar.get("next_proof_point")]

    next_scheduled_review_date = review_policy.get("next_scheduled_review_date")
    if next_scheduled_review_date:
        next_scheduled_review_status = (
            "upcoming_approved_internal_date"
            if date.fromisoformat(str(next_scheduled_review_date)) >= date.fromisoformat(report_date)
            else "past_date_requires_config_refresh"
        )
    else:
        next_scheduled_review_status = "not_supplied"
    if dated_reviews:
        status = "confirmed_review_date_available"
        next_review_gate = dated_reviews[0]["event_date"]
    elif next_scheduled_review_date and date.fromisoformat(str(next_scheduled_review_date)) >= date.fromisoformat(report_date):
        status = "approved_internal_review_date_available"
        next_review_gate = next_scheduled_review_date
    elif soft_date_candidates:
        status = "soft_date_needs_primary_confirmation"
        next_review_gate = "confirm_company_owned_event_date"
    else:
        status = "approved_thesis_undated_proof_queue_only"
        next_review_gate = "assign_source_backed_date_or_review_cadence"

    missing_operating_model = [
        field for field, value in {
            "decision_authority": owners.get("decision_authority"),
            "pm_owner": owners.get("pm_owner"),
            "analyst_owner": owners.get("analyst_owner"),
            "evidence_owner": owners.get("evidence_owner"),
            "kpi_owner": owners.get("kpi_owner"),
            "model_owner": owners.get("model_owner"),
            "decision_log_owner": owners.get("decision_log_owner"),
            "review_cadence": review_policy.get("cadence"),
            "prep_lead_time": review_policy.get("prep_lead_time"),
            "post_event_update_sla": review_policy.get("post_event_update_sla"),
        }.items() if not value
    ]
    referenced_source_ids = [
        str(review.get("source_id")) for review in dated_reviews if review.get("source_id")
    ]
    referenced_source_ids.extend(
        str(candidate.get("source_id")) for candidate in soft_date_candidates if candidate.get("source_id")
    )
    referenced_source_ids.extend(
        str(source_id) for proof in undated_proof_queue for source_id in proof.get("source_ids", [])
    )
    if operating_config:
        referenced_source_ids.append(f"OPS-{ticker}-V{int(operating_config['version'])}")
    row = {
        "ticker": ticker,
        "company_name": company.get("company_name"),
        "calendar_status": status,
        "underwriting_id": underwriting.get("underwriting_id"),
        "underwriting_version": underwriting.get("version"),
        "approved_by": (underwriting.get("approval") or {}).get("approved_by"),
        "approved_at": (underwriting.get("approval") or {}).get("approved_at"),
        "company_thesis_status": _formal_status(thesis_update),
        "security_thesis_readiness": "not_decision_grade",
        "position_action": "wait_for_proof",
        "dated_reviews": dated_reviews,
        "soft_date_candidates": soft_date_candidates,
        "undated_proof_queue": undated_proof_queue,
        "event_conflicts": list(event_gate.get("conflicts", [])),
        "next_review_gate": next_review_gate,
        "operating_config_status": (
            "approved_operating_config_applied" if operating_config else "missing_approved_operating_config"
        ),
        "operating_config_id": operating_config.get("operating_config_id"),
        "operating_config_version": operating_config.get("version"),
        "next_scheduled_review_date": next_scheduled_review_date,
        "next_scheduled_review_status": next_scheduled_review_status,
        "operating_model": {
            **owners,
            "review_cadence": review_policy.get("cadence"),
            "prep_lead_time": review_policy.get("prep_lead_time"),
            "post_event_update_sla": review_policy.get("post_event_update_sla"),
            "escalation_triggers": review_policy.get("escalation_triggers", []),
        },
        "missing_operating_model_fields": missing_operating_model,
        "source_index": source_index,
        "source_resolution_complete": all(source_id in source_ids for source_id in referenced_source_ids),
        "decision_limit": "Calendar schedules company-thesis review only; it cannot create a valuation or position action.",
    }
    return row


def build_company_thesis_review_calendar(
    report_date: str, underwriting_registry: dict[str, Any],
    earnings_events: dict[str, Any], thesis_updates: dict[str, Any],
    operating_configs: dict[str, Any] | None = None,
) -> dict[str, Any]:
    if operating_configs is not None:
        validate_company_review_operating_config(operating_configs)
    event_map = _by_ticker(earnings_events)
    update_map = _by_ticker(thesis_updates, "updates")
    operating_map = _by_ticker(operating_configs or {})
    approved = [
        row for row in underwriting_registry.get("companies", [])
        if row.get("underwriting_status") == "approved_original_underwriting_available"
        and row.get("formal_thesis_update_allowed") is True
        and row.get("selected_underwriting")
    ]
    companies = [
        _company_calendar(report_date, row, event_map.get(str(row["ticker"]).upper(), {}),
                          update_map.get(str(row["ticker"]).upper(), {}),
                          operating_map.get(str(row["ticker"]).upper(), {}))
        for row in approved
    ]
    if not companies:
        status = "blocked_no_approved_underwriting"
    elif any(row["dated_reviews"] for row in companies):
        status = "confirmed_review_dates_available"
    elif any(row["soft_date_candidates"] for row in companies):
        status = "expected_dates_need_primary_confirmation"
    else:
        status = "approved_underwriting_without_dated_review"
    payload = {
        "schema_version": SCHEMA_VERSION,
        "report_date": report_date,
        "calendar_status": status,
        "company_count": len(companies),
        "confirmed_review_count": sum(len(row["dated_reviews"]) for row in companies),
        "soft_date_candidate_count": sum(len(row["soft_date_candidates"]) for row in companies),
        "undated_proof_count": sum(len(row["undated_proof_queue"]) for row in companies),
        "approved_operating_config_count": sum(
            row["operating_config_status"] == "approved_operating_config_applied" for row in companies
        ),
        "companies": companies,
        "methodology": {
            "approved_underwriting_required": True,
            "primary_source_required_for_hard_date": True,
            "expected_dates_exported_as_hard_dates": False,
            "undated_thesis_critical_proof_retained": True,
            "prep_dates_or_sla_inferred": False,
            "operating_config_must_be_explicitly_approved": True,
            "automatic_position_action_allowed": False,
        },
        "posture": "company_thesis_review_schedule_not_investment_action",
    }
    validate_company_thesis_review_calendar(payload)
    return payload


def validate_company_thesis_review_calendar(payload: dict[str, Any]) -> None:
    if payload.get("schema_version") != SCHEMA_VERSION:
        raise ValueError("Unexpected company thesis review calendar schema")
    companies = payload.get("companies", [])
    if int(payload.get("company_count", -1)) != len(companies):
        raise ValueError("Company count does not match thesis review calendar")
    if int(payload.get("confirmed_review_count", -1)) != sum(len(row.get("dated_reviews", [])) for row in companies):
        raise ValueError("Confirmed review count does not match calendar rows")
    if int(payload.get("soft_date_candidate_count", -1)) != sum(len(row.get("soft_date_candidates", [])) for row in companies):
        raise ValueError("Soft-date count does not match calendar rows")
    if int(payload.get("undated_proof_count", -1)) != sum(len(row.get("undated_proof_queue", [])) for row in companies):
        raise ValueError("Undated proof count does not match calendar rows")
    report_day = date.fromisoformat(str(payload["report_date"]))
    for company in companies:
        if company.get("security_thesis_readiness") != "not_decision_grade" or company.get("position_action") != "wait_for_proof":
            raise ValueError("Review calendar cannot promote security readiness or position action")
        source_ids = {str(row.get("source_id")) for row in company.get("source_index", [])}
        review_ids = [str(row.get("review_id")) for row in company.get("dated_reviews", [])]
        if len(review_ids) != len(set(review_ids)):
            raise ValueError("Duplicate stable review ID in calendar")
        for review in company.get("dated_reviews", []):
            if review.get("date_type") != "hard_date" or review.get("confidence") != "confirmed":
                raise ValueError("Exact review dates require confirmed hard-date evidence")
            if date.fromisoformat(str(review.get("event_date"))) < report_day:
                raise ValueError("Confirmed review date cannot precede the report date")
            if review.get("source_id") not in source_ids:
                raise ValueError("Confirmed review date source does not resolve")
            if review.get("security_or_position_action_allowed") is not False:
                raise ValueError("Review event cannot authorize a security or position action")
            config_applied = company.get("operating_config_status") == "approved_operating_config_applied"
            if config_applied:
                operating_model = company.get("operating_model") or {}
                if review.get("prep_due_date") is None or review.get("prep_owner") != operating_model.get("analyst_owner"):
                    raise ValueError("Approved operating configuration must control prep owner and due date")
                if review.get("post_event_update_sla") != operating_model.get("post_event_update_sla"):
                    raise ValueError("Approved operating configuration must control the post-event SLA")
            elif review.get("prep_due_date") is not None or review.get("post_event_update_sla") is not None:
                raise ValueError("Prep date and post-event SLA require explicit user or PM input")
        for candidate in company.get("soft_date_candidates", []):
            if candidate.get("date_type") != "soft_date" or candidate.get("confidence") != "expected":
                raise ValueError("Provider event candidates must remain expected soft dates")
            if date.fromisoformat(str(candidate.get("event_date"))) < report_day:
                raise ValueError("Expected event candidate cannot precede the report date")
            if candidate.get("source_id") not in source_ids:
                raise ValueError("Expected event candidate source does not resolve")
        if company.get("source_resolution_complete") is not True:
            raise ValueError("Calendar has unresolved confirmed-date sources")
        if company.get("operating_config_status") == "approved_operating_config_applied":
            if not company.get("operating_config_id") or company.get("missing_operating_model_fields"):
                raise ValueError("Applied operating configuration must be complete and versioned")
            expected_source_id = f"OPS-{company['ticker']}-V{int(company['operating_config_version'])}"
            if expected_source_id not in source_ids:
                raise ValueError("Applied operating configuration source does not resolve")
        scheduled_date = company.get("next_scheduled_review_date")
        scheduled_status = company.get("next_scheduled_review_status")
        if scheduled_date:
            expected_status = (
                "upcoming_approved_internal_date"
                if date.fromisoformat(str(scheduled_date)) >= report_day
                else "past_date_requires_config_refresh"
            )
            if scheduled_status != expected_status:
                raise ValueError("Scheduled internal review freshness status is inconsistent")
        elif scheduled_status != "not_supplied":
            raise ValueError("Missing scheduled internal review date must remain not supplied")
    if payload.get("methodology", {}).get("automatic_position_action_allowed") is not False:
        raise ValueError("Calendar methodology cannot allow automatic position actions")


def main() -> None:
    parser = argparse.ArgumentParser(description="Build approved company-thesis review calendar")
    parser.add_argument("--date", required=True)
    parser.add_argument("--company-underwriting-file")
    parser.add_argument("--company-earnings-events-file")
    parser.add_argument("--company-thesis-updates-file")
    parser.add_argument("--company-review-operating-config-file")
    parser.add_argument("--output-file")
    args = parser.parse_args()
    underwriting_path = root_path(
        args.company_underwriting_file,
        ROOT / "workspace" / "company_underwriting" / args.date / "company_underwriting.json",
    )
    events_path = root_path(
        args.company_earnings_events_file,
        ROOT / "workspace" / "company_earnings_events" / args.date / "company_earnings_events.json",
    )
    updates_path = root_path(
        args.company_thesis_updates_file,
        ROOT / "workspace" / "company_thesis_updates" / args.date / "company_thesis_update.json",
    )
    operating_path = root_path(
        args.company_review_operating_config_file,
        ROOT / "workspace" / "company_review_operating_config" / args.date / "company_review_operating_config.json",
    )
    for label, path in (
        ("underwriting", underwriting_path), ("earnings events", events_path),
        ("thesis updates", updates_path), ("review operating configuration", operating_path),
    ):
        if not path.exists():
            raise SystemExit(f"Company {label} does not exist: {path}")
    payload = build_company_thesis_review_calendar(
        args.date,
        json.loads(underwriting_path.read_text(encoding="utf-8")),
        json.loads(events_path.read_text(encoding="utf-8")),
        json.loads(updates_path.read_text(encoding="utf-8")),
        json.loads(operating_path.read_text(encoding="utf-8")),
    )
    output = root_path(
        args.output_file,
        ROOT / "workspace" / "company_thesis_review_calendar" / args.date / "company_thesis_review_calendar.json",
    )
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Company thesis review calendar saved: {output.relative_to(ROOT)}")
    print(f"Confirmed review dates: {payload['confirmed_review_count']}/{payload['company_count']}")


if __name__ == "__main__":
    main()
