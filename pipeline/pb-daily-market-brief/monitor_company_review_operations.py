"""Monitor approved company-review preparation and post-event update SLAs."""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from build_company_earnings_scenarios import validate_company_earnings_scenarios
from build_company_thesis_review_calendar import validate_company_thesis_review_calendar
from build_company_thesis_update import validate_company_thesis_update
from collect_company_earnings_results import validate_company_earnings_results
from collectors.common import ROOT

SCHEMA_VERSION = "company_review_operations_monitor.v1"
HISTORY_SCHEMA_VERSION = "company_review_operations_history.v1"


def _by_ticker(payload: dict[str, Any], key: str = "companies") -> dict[str, dict[str, Any]]:
    return {
        str(row.get("ticker") or "").upper(): row
        for row in payload.get(key, []) if row.get("ticker")
    }


def _aware_datetime(value: str) -> datetime:
    parsed = datetime.fromisoformat(value)
    if parsed.utcoffset() is None:
        raise ValueError("Operational observation timestamps must include a timezone offset")
    return parsed


def _empty_history() -> dict[str, Any]:
    return {
        "schema_version": HISTORY_SCHEMA_VERSION,
        "milestones": [],
        "calendar_observations": [],
    }


def _latest_calendar_observation(history: dict[str, Any], review_id: str) -> dict[str, Any] | None:
    rows = [row for row in history.get("calendar_observations", []) if row.get("review_id") == review_id]
    if not rows:
        return None
    return max(rows, key=lambda row: (str(row.get("report_date") or ""), int(row.get("revision", 1))))


def _append_calendar_observation(
    history: dict[str, Any], report_date: str, review: dict[str, Any], operating_version: Any,
) -> tuple[dict[str, Any] | None, dict[str, Any]]:
    review_id = str(review["review_id"])
    prior = _latest_calendar_observation(history, review_id)
    material = {
        "review_id": review_id, "ticker": review.get("ticker"),
        "event_date": review.get("event_date"), "prep_due_date": review.get("prep_due_date"),
        "operating_config_version": operating_version,
    }
    same_day = [
        row for row in history.get("calendar_observations", [])
        if row.get("review_id") == review_id and row.get("report_date") == report_date
    ]
    if same_day and any(all(row.get(key) == value for key, value in material.items()) for row in same_day):
        return prior, max(same_day, key=lambda row: int(row.get("revision", 1)))
    observation = {
        **material, "report_date": report_date,
        "revision": max([int(row.get("revision", 1)) for row in same_day], default=0) + 1,
    }
    encoded = json.dumps(observation, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    observation["observation_hash"] = hashlib.sha256(encoded.encode("utf-8")).hexdigest()
    history.setdefault("calendar_observations", []).append(observation)
    return prior, observation


def _milestone(history: dict[str, Any], review_id: str, milestone_type: str) -> dict[str, Any] | None:
    return next((
        row for row in history.get("milestones", [])
        if row.get("review_id") == review_id and row.get("milestone_type") == milestone_type
    ), None)


def _observe_milestone(
    history: dict[str, Any], review_id: str, ticker: str, milestone_type: str,
    observed_at: str, source_ids: list[str], evidence_status: str,
) -> dict[str, Any]:
    existing = _milestone(history, review_id, milestone_type)
    if existing:
        return existing
    row = {
        "milestone_id": f"milestone:{review_id}:{milestone_type}",
        "review_id": review_id, "ticker": ticker, "milestone_type": milestone_type,
        "first_observed_at": observed_at, "source_ids": list(dict.fromkeys(source_ids)),
        "evidence_status": evidence_status,
    }
    history.setdefault("milestones", []).append(row)
    return row


def _prep_status(report_day: date, review: dict[str, Any], milestone: dict[str, Any] | None) -> str:
    due_value = review.get("prep_due_date")
    if not due_value:
        return "not_monitored_missing_approved_prep_rule"
    due = date.fromisoformat(str(due_value))
    event_day = date.fromisoformat(str(review["event_date"]))
    if milestone:
        observed_day = _aware_datetime(str(milestone["first_observed_at"])).date()
        return "completed_on_time" if observed_day <= due else "completed_late"
    if report_day < due:
        return "scheduled"
    if report_day == due:
        return "due_today_unconfirmed"
    if report_day <= event_day:
        return "overdue_unconfirmed"
    return "missed_or_unconfirmed_after_event"


def _sla_status(
    now: datetime, review: dict[str, Any], result_milestone: dict[str, Any] | None,
    update_milestone: dict[str, Any] | None,
) -> tuple[str, str | None]:
    rule = review.get("post_event_update_sla") or {}
    if not rule:
        return "not_monitored_missing_approved_sla", None
    if not result_milestone:
        return "clock_not_started_waiting_verified_primary_results", None
    started = _aware_datetime(str(result_milestone["first_observed_at"]))
    deadline = started + timedelta(hours=int(rule["value"]))
    if update_milestone:
        completed = _aware_datetime(str(update_milestone["first_observed_at"]))
        status = "completed_within_sla" if completed <= deadline else "completed_after_sla"
    else:
        status = "sla_active" if now <= deadline else "sla_breached_update_unconfirmed"
    return status, deadline.isoformat()


def monitor_company_review_operations(
    report_date: str, calendar: dict[str, Any], scenarios: dict[str, Any],
    results: dict[str, Any], thesis_updates: dict[str, Any],
    history: dict[str, Any] | None = None, observed_at: str | None = None,
) -> tuple[dict[str, Any], dict[str, Any]]:
    validate_company_thesis_review_calendar(calendar)
    validate_company_earnings_scenarios(scenarios)
    validate_company_earnings_results(results)
    validate_company_thesis_update(thesis_updates)
    current_time = _aware_datetime(observed_at or datetime.now(timezone.utc).isoformat())
    report_day = date.fromisoformat(report_date)
    for label, source_payload in (
        ("calendar", calendar), ("scenarios", scenarios),
        ("results", results), ("thesis updates", thesis_updates),
    ):
        if date.fromisoformat(str(source_payload["report_date"])) > report_day:
            raise ValueError(f"Company review operations {label} input cannot be future-dated")
    history_copy = copy.deepcopy(history or _empty_history())
    validate_company_review_operations_history(history_copy)
    scenario_map = _by_ticker(scenarios)
    result_map = _by_ticker(results)
    update_map = _by_ticker(thesis_updates, "updates")
    monitored: list[dict[str, Any]] = []

    for company in calendar.get("companies", []):
        if company.get("operating_config_status") != "approved_operating_config_applied":
            continue
        ticker = str(company["ticker"]).upper()
        for review in company.get("dated_reviews", []):
            review_id = str(review["review_id"])
            prior_calendar, _ = _append_calendar_observation(
                history_copy, report_date, review, company.get("operating_config_version"),
            )
            scenario = scenario_map.get(ticker, {})
            result = result_map.get(ticker, {})
            update = update_map.get(ticker, {})
            prep_milestone = _milestone(history_copy, review_id, "pre_event_trigger_pack_ready")
            if (
                scenario.get("scenario_gate_status") == "conditional_thesis_triggers_available"
                and scenario.get("event_date") == review.get("event_date")
            ):
                prep_milestone = _observe_milestone(
                    history_copy, review_id, ticker, "pre_event_trigger_pack_ready",
                    current_time.isoformat(), [
                        str(source.get("source_id")) for source in scenario.get("source_index", [])
                        if source.get("source_id")
                    ], "source_bounded_pre_event_trigger_pack_available",
                )
            result_milestone = _milestone(history_copy, review_id, "verified_primary_results_available")
            primary_result_sources = [
                str(source.get("source_id")) for source in result.get("source_index", [])
                if source.get("source_id") and source.get("source_type") == "primary_public_source"
            ]
            if (
                result.get("event_date") == review.get("event_date")
                and result.get("result_id") and primary_result_sources
            ):
                result_milestone = _observe_milestone(
                    history_copy, review_id, ticker, "verified_primary_results_available",
                    current_time.isoformat(), primary_result_sources,
                    "body_verified_primary_result_collected",
                )
            update_milestone = _milestone(history_copy, review_id, "formal_company_thesis_update_available")
            if update.get("update_status") == "formal_company_thesis_update_available":
                update_milestone = _observe_milestone(
                    history_copy, review_id, ticker, "formal_company_thesis_update_available",
                    current_time.isoformat(), [
                        str(source.get("source_id")) for source in update.get("source_index", [])
                        if source.get("source_id")
                    ], "approved_underwriting_compared_with_source_verified_evidence",
                )

            prep_status = _prep_status(report_day, review, prep_milestone)
            sla_status, sla_deadline = _sla_status(current_time, review, result_milestone, update_milestone)
            escalation_reasons: list[str] = []
            if prep_status in {"overdue_unconfirmed", "missed_or_unconfirmed_after_event", "completed_late"}:
                escalation_reasons.append("pre_event_preparation_due_date_missed_or_late")
            if sla_status in {"sla_breached_update_unconfirmed", "completed_after_sla"}:
                escalation_reasons.append("post_event_update_sla_missed_or_late")
            if prior_calendar and prior_calendar.get("event_date") != review.get("event_date"):
                escalation_reasons.append("confirmed_event_date_changed")
            if update.get("company_thesis_status") == "broken":
                escalation_reasons.append("approved_kill_criterion_matched")
            if report_day > date.fromisoformat(str(review["event_date"])) and not result_milestone:
                escalation_reasons.append("required_primary_evidence_unavailable_after_event")
            if "post_event_update_sla_missed_or_late" in escalation_reasons or "approved_kill_criterion_matched" in escalation_reasons:
                alert_level = "critical_review_required"
            elif escalation_reasons or prep_status == "due_today_unconfirmed":
                alert_level = "attention_required"
            else:
                alert_level = "normal"
            monitored.append({
                "review_id": review_id, "ticker": ticker, "company_name": company.get("company_name"),
                "event_name": review.get("event_name"), "event_date": review.get("event_date"),
                "operating_config_version": company.get("operating_config_version"),
                "prep_owner": review.get("prep_owner"), "prep_due_date": review.get("prep_due_date"),
                "prep_status": prep_status,
                "prep_first_observed_at": (prep_milestone or {}).get("first_observed_at"),
                "post_event_sla_rule": review.get("post_event_update_sla"),
                "sla_clock_started_at": (result_milestone or {}).get("first_observed_at"),
                "sla_deadline": sla_deadline, "sla_status": sla_status,
                "formal_update_first_observed_at": (update_milestone or {}).get("first_observed_at"),
                "escalation_reasons": escalation_reasons, "alert_level": alert_level,
                "escalation_owner": (company.get("operating_model") or {}).get("decision_authority"),
                "company_thesis_status": company.get("company_thesis_status"),
                "security_thesis_readiness": "not_decision_grade", "position_action": "wait_for_proof",
                "automatic_notification_sent": False, "automatic_position_action_allowed": False,
            })
    payload = {
        "schema_version": SCHEMA_VERSION, "report_date": report_date,
        "observed_at": current_time.isoformat(), "monitored_review_count": len(monitored),
        "attention_count": sum(row["alert_level"] == "attention_required" for row in monitored),
        "critical_count": sum(row["alert_level"] == "critical_review_required" for row in monitored),
        "reviews": monitored,
        "methodology": {
            "approved_operating_config_required": True,
            "milestones_first_observed_append_only": True,
            "sla_starts_only_on_verified_primary_result_observation": True,
            "automatic_notification_sent": False,
            "automatic_position_action_allowed": False,
        },
        "posture": "operational_review_alert_not_investment_action",
    }
    validate_company_review_operations_monitor(payload)
    validate_company_review_operations_history(history_copy)
    return payload, history_copy


def validate_company_review_operations_history(history: dict[str, Any]) -> None:
    if history.get("schema_version") != HISTORY_SCHEMA_VERSION:
        raise ValueError("Unexpected company review operations history schema")
    milestone_ids = [str(row.get("milestone_id")) for row in history.get("milestones", [])]
    if len(milestone_ids) != len(set(milestone_ids)):
        raise ValueError("Company review milestones must be append-only and unique")
    for row in history.get("milestones", []):
        _aware_datetime(str(row.get("first_observed_at")))
        if not row.get("review_id") or not row.get("milestone_type"):
            raise ValueError("Company review milestone requires stable identity")


def validate_company_review_operations_monitor(payload: dict[str, Any]) -> None:
    if payload.get("schema_version") != SCHEMA_VERSION:
        raise ValueError("Unexpected company review operations monitor schema")
    reviews = payload.get("reviews", [])
    if int(payload.get("monitored_review_count", -1)) != len(reviews):
        raise ValueError("Monitored review count does not match rows")
    if int(payload.get("attention_count", -1)) != sum(row.get("alert_level") == "attention_required" for row in reviews):
        raise ValueError("Attention count does not match monitor rows")
    if int(payload.get("critical_count", -1)) != sum(row.get("alert_level") == "critical_review_required" for row in reviews):
        raise ValueError("Critical count does not match monitor rows")
    _aware_datetime(str(payload["observed_at"]))
    review_ids: set[str] = set()
    for row in reviews:
        review_id = str(row.get("review_id") or "")
        if not review_id or review_id in review_ids:
            raise ValueError("Monitor requires unique stable review IDs")
        review_ids.add(review_id)
        if row.get("security_thesis_readiness") != "not_decision_grade" or row.get("position_action") != "wait_for_proof":
            raise ValueError("Operational alert cannot promote security readiness or position action")
        if row.get("automatic_notification_sent") is not False or row.get("automatic_position_action_allowed") is not False:
            raise ValueError("Operational monitor cannot send or execute unapproved actions")
    methodology = payload.get("methodology") or {}
    if methodology.get("automatic_notification_sent") is not False:
        raise ValueError("Operational monitor cannot claim an external notification")
    if methodology.get("automatic_position_action_allowed") is not False:
        raise ValueError("Operational monitor cannot authorize position action")


def _atomic_write(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    temporary.replace(path)


def main() -> None:
    parser = argparse.ArgumentParser(description="Monitor approved company review preparation and SLA status")
    parser.add_argument("--date", required=True)
    parser.add_argument("--calendar-file")
    parser.add_argument("--company-earnings-scenarios-file")
    parser.add_argument("--company-earnings-results-file")
    parser.add_argument("--company-thesis-update-file")
    parser.add_argument("--history-file")
    parser.add_argument("--output-file")
    args = parser.parse_args()
    paths = {
        "calendar": Path(args.calendar_file) if args.calendar_file else ROOT / "workspace" / "company_thesis_review_calendar" / args.date / "company_thesis_review_calendar.json",
        "scenarios": Path(args.company_earnings_scenarios_file) if args.company_earnings_scenarios_file else ROOT / "workspace" / "company_earnings_scenarios" / args.date / "company_earnings_scenarios.json",
        "results": Path(args.company_earnings_results_file) if args.company_earnings_results_file else ROOT / "workspace" / "company_earnings_results" / args.date / "company_earnings_results.json",
        "updates": Path(args.company_thesis_update_file) if args.company_thesis_update_file else ROOT / "workspace" / "company_thesis_updates" / args.date / "company_thesis_update.json",
    }
    for label, path in paths.items():
        if not path.exists():
            raise SystemExit(f"Company review operations {label} input does not exist: {path}")
    history_path = Path(args.history_file) if args.history_file else ROOT / "workspace" / "history" / "company_review_operations_history.json"
    history = json.loads(history_path.read_text(encoding="utf-8")) if history_path.exists() else _empty_history()
    payload, updated_history = monitor_company_review_operations(
        args.date,
        json.loads(paths["calendar"].read_text(encoding="utf-8")),
        json.loads(paths["scenarios"].read_text(encoding="utf-8")),
        json.loads(paths["results"].read_text(encoding="utf-8")),
        json.loads(paths["updates"].read_text(encoding="utf-8")), history,
    )
    output = Path(args.output_file) if args.output_file else ROOT / "workspace" / "company_review_operations_monitor" / args.date / "company_review_operations_monitor.json"
    _atomic_write(history_path, updated_history)
    _atomic_write(output, payload)
    print(f"Company review operations monitor saved: {output.relative_to(ROOT)}")
    print(f"Attention: {payload['attention_count']} · critical: {payload['critical_count']}")


if __name__ == "__main__":
    main()
