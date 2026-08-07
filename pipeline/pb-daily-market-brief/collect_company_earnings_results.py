"""Collect body-verified post-earnings facts into a bounded deep-dive input pack."""

from __future__ import annotations

import argparse
import hashlib
import json
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any

from collectors.common import ROOT
from collect_company_market_context import _number, root_path

SCHEMA_VERSION = "company_post_earnings_input_pack.v1"
MAX_COMPANIES = 4
ALLOWED_SOURCE_TYPES = {
    "company_earnings_release", "company_ir_presentation", "company_prepared_remarks",
    "sec_filing", "sec_filing_exhibit",
}
ALLOWED_BASES = {"gaap", "reported", "company_defined", "non_gaap"}
EPS_QUALITY_STATES = {
    "no_material_trigger_identified_from_available_sources",
    "expanded_bridge_required",
    "source_not_provided",
}


def _validate_source(row: dict[str, Any], report_day: date, label: str) -> None:
    if row.get("source_type") not in ALLOWED_SOURCE_TYPES:
        raise ValueError(f"{label} requires a permitted company or SEC primary source")
    if row.get("primary_source_confirmed") is not True or row.get("body_verified") is not True:
        raise ValueError(f"{label} requires primary-source body verification")
    if not str(row.get("source_url") or "").startswith("https://") or not str(row.get("body_location") or "").strip():
        raise ValueError(f"{label} requires HTTPS source URL and exact body location")
    if date.fromisoformat(str(row.get("source_date"))) > report_day:
        raise ValueError(f"{label} source date is after report date")


def _validate_metric(row: dict[str, Any], report_day: date) -> dict[str, Any]:
    required = {"metric_id", "label", "value", "unit", "period_end", "basis", "source_type", "source_url", "source_date", "body_location", "primary_source_confirmed", "body_verified"}
    missing = sorted(required - set(row))
    if missing:
        raise ValueError(f"Reported metric missing fields: {missing}")
    _validate_source(row, report_day, "Reported metric")
    value = _number(row.get("value"))
    if value is None or not str(row.get("metric_id") or "").strip() or not str(row.get("unit") or "").strip():
        raise ValueError("Reported metric requires numeric value, metric ID and unit")
    if date.fromisoformat(str(row["period_end"])) > report_day:
        raise ValueError("Reported metric period is after report date")
    if row.get("basis") not in ALLOWED_BASES:
        raise ValueError("Reported metric has unsupported accounting basis")
    if row.get("basis") == "non_gaap" and (
        not str(row.get("closest_gaap_metric_id") or "").strip()
        or row.get("reconciliation_body_verified") is not True
    ):
        raise ValueError("Non-GAAP metric requires closest GAAP comparable and body-verified reconciliation")
    return {**row, "value": value, "evidence_label": "fact_source_reported"}


def _validate_kpi(row: dict[str, Any], report_day: date) -> dict[str, Any]:
    required = {
        "driver_id", "label", "current_value", "prior_value", "unit", "current_period_end",
        "prior_period_end", "definition", "comparison_status", "basis", "source_type",
        "source_url", "source_date", "body_location", "primary_source_confirmed", "body_verified",
    }
    missing = sorted(required - set(row))
    if missing:
        raise ValueError(f"Operating KPI missing fields: {missing}")
    _validate_source(row, report_day, "Operating KPI")
    current = _number(row.get("current_value"))
    prior = _number(row.get("prior_value"))
    if current is None or prior is None:
        raise ValueError("Operating KPI requires numeric current and prior values")
    current_period = date.fromisoformat(str(row["current_period_end"]))
    prior_period = date.fromisoformat(str(row["prior_period_end"]))
    if current_period > report_day or prior_period >= current_period:
        raise ValueError("Operating KPI periods must be historical and ordered")
    if row.get("comparison_status") not in {"comparable", "comparable_rounded", "recast_comparable"}:
        raise ValueError("Operating KPI must be explicitly comparable")
    if row.get("basis") not in ALLOWED_BASES:
        raise ValueError("Operating KPI has unsupported basis")
    if row.get("basis") == "non_gaap" and (
        not str(row.get("closest_gaap_metric_id") or "").strip()
        or row.get("reconciliation_body_verified") is not True
    ):
        raise ValueError("Non-GAAP KPI requires closest GAAP comparable and body-verified reconciliation")
    change_pct = ((current / prior) - 1) * 100 if prior != 0 else None
    return {
        **row,
        "current_value": current,
        "prior_value": prior,
        "change_pct": round(change_pct, 4) if change_pct is not None else None,
        "evidence_label": "fact_source_reported",
    }


def _validate_guidance_update(row: dict[str, Any], report_day: date) -> dict[str, Any]:
    required = {
        "metric_id", "period_end", "unit", "basis", "source_type", "source_url",
        "source_date", "body_location", "primary_source_confirmed", "body_verified",
    }
    missing = sorted(required - set(row))
    if missing:
        raise ValueError(f"Guidance update missing fields: {missing}")
    _validate_source(row, report_day, "Guidance update")
    low = _number(row.get("value_low"))
    high = _number(row.get("value_high"))
    point = _number(row.get("value"))
    if point is None and (low is None or high is None):
        raise ValueError("Guidance update requires a point value or complete low/high range")
    if low is not None and high is not None and low > high:
        raise ValueError("Guidance update low cannot exceed high")
    if row.get("basis") not in ALLOWED_BASES:
        raise ValueError("Guidance update has unsupported basis")
    if row.get("basis") == "non_gaap" and (
        not str(row.get("closest_gaap_metric_id") or "").strip()
        or row.get("reconciliation_body_verified") is not True
    ):
        raise ValueError("Non-GAAP guidance requires closest GAAP comparable and body-verified reconciliation")
    midpoint = point if point is not None else (low + high) / 2
    return {
        **row,
        "value": point,
        "value_low": low,
        "value_high": high,
        "midpoint": round(float(midpoint), 6),
        "evidence_label": "issuer_management_claim",
    }


def validate_result_record(row: dict[str, Any], report_day: date) -> dict[str, Any]:
    required = {
        "result_id", "ticker", "issuer", "event_date", "reported_period", "source_type",
        "source_url", "source_date", "body_location", "primary_source_confirmed", "body_verified",
        "reported_metrics", "operating_kpis", "eps_quality", "transcript_status",
    }
    missing = sorted(required - set(row))
    if missing:
        raise ValueError(f"Post-earnings result record missing fields: {missing}")
    _validate_source(row, report_day, "Post-earnings result")
    event_day = date.fromisoformat(str(row["event_date"]))
    if event_day > report_day:
        raise ValueError("Post-earnings result cannot precede the confirmed event")
    metrics = [_validate_metric(metric, report_day) for metric in row.get("reported_metrics", [])]
    kpis = [_validate_kpi(kpi, report_day) for kpi in row.get("operating_kpis", [])]
    guidance_updates = [_validate_guidance_update(item, report_day) for item in row.get("guidance_updates", [])]
    eps_quality = row.get("eps_quality") or {}
    if eps_quality.get("status") not in EPS_QUALITY_STATES:
        raise ValueError("Every post-earnings result requires an EPS quality screen status")
    if eps_quality.get("status") == "expanded_bridge_required" and not eps_quality.get("bridge_items"):
        raise ValueError("Triggered EPS quality screen requires bridge items")
    normalized_bridge: list[dict[str, Any]] = []
    for item in eps_quality.get("bridge_items", []):
        required_bridge = {
            "label", "amount", "unit", "treatment", "source_type", "source_url",
            "source_date", "body_location", "primary_source_confirmed", "body_verified",
        }
        missing_bridge = sorted(required_bridge - set(item))
        if missing_bridge:
            raise ValueError(f"EPS quality bridge item missing fields: {missing_bridge}")
        _validate_source(item, report_day, "EPS quality bridge item")
        amount = _number(item.get("amount"))
        if amount is None or not str(item.get("unit") or "").strip():
            raise ValueError("EPS quality bridge item requires numeric amount and unit")
        normalized_bridge.append({**item, "amount": amount, "evidence_label": "fact_source_reported"})
    eps_quality = {**eps_quality, "bridge_items": normalized_bridge}
    if row.get("transcript_status") not in {"not_provided", "source_not_found", "available_separate_source"}:
        raise ValueError("Unsupported transcript status")
    return {
        **row,
        "ticker": str(row["ticker"]).upper(),
        "reported_metrics": metrics,
        "operating_kpis": kpis,
        "guidance_updates": guidance_updates,
        "eps_quality": eps_quality,
        "evidence_label": "fact_source_reported",
    }


def load_result_inputs(report_date: str) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    directory = ROOT / "workspace" / "company_earnings_result_inputs" / report_date
    if not directory.exists():
        return [], []
    report_day = date.fromisoformat(report_date)
    accepted: list[dict[str, Any]] = []
    errors: list[dict[str, Any]] = []
    seen: set[str] = set()
    for path in sorted(directory.glob("*.json")):
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
            records = payload if isinstance(payload, list) else payload.get("records", [])
        except Exception as exc:
            errors.append({"file": str(path.relative_to(ROOT)), "error": str(exc)})
            continue
        for row in records:
            try:
                if row.get("result_id") in seen:
                    raise ValueError("Duplicate post-earnings result ID")
                validated = validate_result_record(row, report_day)
                accepted.append(validated)
                seen.add(str(validated["result_id"]))
            except Exception as exc:
                errors.append({
                    "file": str(path.relative_to(ROOT)),
                    "result_id": row.get("result_id"),
                    "error": str(exc),
                })
    return accepted, errors


def _source_id(ticker: str, source_url: str) -> str:
    digest = hashlib.sha256(source_url.encode("utf-8")).hexdigest()[:12]
    return f"RESULT-{ticker}-{digest}"


def _source_index(ticker: str, result: dict[str, Any], collected_at: str) -> tuple[list[dict[str, Any]], dict[str, str]]:
    rows = [
        result,
        *result.get("reported_metrics", []),
        *result.get("operating_kpis", []),
        *result.get("guidance_updates", []),
        *(result.get("eps_quality") or {}).get("bridge_items", []),
    ]
    sources: dict[str, dict[str, Any]] = {}
    url_to_id: dict[str, str] = {}
    for row in rows:
        url = str(row.get("source_url") or "")
        if not url or url in url_to_id:
            continue
        source_id = _source_id(ticker, url)
        url_to_id[url] = source_id
        sources[source_id] = {
            "source_id": source_id,
            "source_name": f"{ticker} post-earnings primary evidence",
            "source_type": "primary_public_source",
            "owner_or_provider": result.get("issuer") or ticker,
            "as_of_date": row.get("source_date"),
            "retrieved_at": collected_at,
            "period_covered": result.get("reported_period"),
            "source_location": url,
            "freshness_status": "current_post_earnings_source",
            "notes": row.get("body_location"),
        }
    return list(sources.values()), url_to_id


def _classify_result(actual: float, cases: list[dict[str, Any]]) -> str | None:
    for case in cases:
        low = _number(case.get("threshold_low"))
        high = _number(case.get("threshold_high"))
        if case.get("operator") == "greater_than" and low is not None and actual > low:
            return str(case.get("scenario"))
        if case.get("operator") == "between_inclusive" and low is not None and high is not None and low <= actual <= high:
            return str(case.get("scenario"))
        if case.get("operator") == "less_than" and low is not None and actual < low:
            return str(case.get("scenario"))
    return None


def _kpi_signal(expected: str, current: float, prior: float) -> str:
    if current == prior:
        actual = "unchanged_vs_prior"
    elif current > prior:
        actual = "increased_vs_prior"
    else:
        actual = "decreased_vs_prior"
    return "confirming" if actual == expected else "neutral" if actual == "unchanged_vs_prior" else "weakening"


def _company_pack(company: dict[str, Any], result: dict[str, Any] | None, collected_at: str) -> dict[str, Any]:
    ticker = str(company.get("ticker") or "").upper()
    if not result:
        return {
            "candidate_id": company.get("candidate_id"), "ticker": ticker,
            "company_name": company.get("company_name"), "event_date": company.get("event_date"),
            "pack_status": "not_available_no_verified_result_input", "headline_result_case": None,
            "reported_metric_comparison": None, "operating_kpi_checks": [], "eps_quality": {"status": "source_not_provided"},
            "transcript_status": "not_provided", "source_index": [],
            "missing_artifacts": ["body-verified earnings release or SEC exhibit", "comparable company KPI result", "earnings transcript"],
            "thesis_update_allowed": False, "position_action_allowed": False,
            "next_workflow": "collect_primary_post_earnings_sources",
        }
    source_index, url_to_id = _source_index(ticker, result, collected_at)
    merged_sources = {
        str(row.get("source_id")): dict(row)
        for row in [*company.get("source_index", []), *source_index]
        if row.get("source_id")
    }
    source_index = list(merged_sources.values())
    cases = company.get("conditional_scenarios", [])
    reference = cases[0] if cases else {}
    metric = next((
        row for row in result.get("reported_metrics", [])
        if row.get("metric_id") == reference.get("driver")
        and row.get("period_end") == reference.get("period_end")
        and row.get("unit") == reference.get("units")
    ), None)
    event_match = result.get("event_date") == company.get("event_date")
    headline_case = _classify_result(float(metric["value"]), cases) if metric and event_match else None
    expected_checks = {
        str(row.get("driver_id")): row
        for row in reference.get("operating_cross_checks", []) if row.get("driver_id")
    }
    kpi_checks: list[dict[str, Any]] = []
    for kpi in result.get("operating_kpis", []):
        expected = expected_checks.get(str(kpi.get("driver_id")))
        if not expected:
            continue
        kpi_checks.append({
            "driver_id": kpi.get("driver_id"),
            "current_value": kpi.get("current_value"), "prior_value": kpi.get("prior_value"),
            "unit": kpi.get("unit"), "current_period_end": kpi.get("current_period_end"),
            "prior_period_end": kpi.get("prior_period_end"), "change_pct": kpi.get("change_pct"),
            "prior_expected_trend": expected.get("trend_status"),
            "evidence_signal": _kpi_signal(str(expected.get("trend_status")), float(kpi["current_value"]), float(kpi["prior_value"])),
            "source_id": url_to_id.get(str(kpi.get("source_url"))),
            "evidence_label": "derived_comparison_of_source_reported_kpi",
        })
    ready = (
        company.get("scenario_gate_status") == "conditional_thesis_triggers_available"
        and event_match and metric is not None and headline_case is not None and bool(kpi_checks)
        and (result.get("eps_quality") or {}).get("status") != "source_not_provided"
    )
    gaps: list[str] = []
    if not event_match:
        gaps.append("result event date does not match the confirmed event")
    if not metric:
        gaps.append("exact-period and exact-unit reported metric matching the trigger table")
    if not kpi_checks:
        gaps.append("comparable source-verified operating KPI matching a tracked driver")
    if not cases:
        gaps.append("frozen pre-event trigger baseline from append-only history")
    if (result.get("eps_quality") or {}).get("status") == "source_not_provided":
        gaps.append("EPS quality screen tied to primary-source evidence")
    if result.get("transcript_status") != "available_separate_source":
        gaps.append("earnings transcript")
    gaps.extend(["current model and valuation update", "portfolio and positioning context"])
    return {
        "candidate_id": company.get("candidate_id"), "ticker": ticker,
        "company_name": company.get("company_name"), "event_date": company.get("event_date"),
        "result_id": result.get("result_id"),
        "pack_status": "ready_for_post_earnings_deep_dive" if ready else "blocked_incomplete_post_earnings_evidence",
        "headline_result_case": headline_case,
        "reported_metric_comparison": ({
            "metric_id": metric.get("metric_id"), "reported_value": metric.get("value"),
            "period_end": metric.get("period_end"), "units": metric.get("unit"),
            "basis": metric.get("basis"), "scenario_case": headline_case,
            "source_id": url_to_id.get(str(metric.get("source_url"))),
            "pre_event_source_ids": list(reference.get("source_ids", [])),
            "evidence_label": "derived_comparison_to_pre_event_trigger",
        } if metric else None),
        "operating_kpi_checks": kpi_checks,
        "guidance_updates": [{
            **row,
            "source_id": url_to_id.get(str(row.get("source_url"))),
        } for row in result.get("guidance_updates", [])],
        "eps_quality": {
            **(result.get("eps_quality") or {}),
            "source_id": url_to_id.get(str(result.get("source_url"))),
            "bridge_items": [{
                **row,
                "source_id": url_to_id.get(str(row.get("source_url"))),
            } for row in (result.get("eps_quality") or {}).get("bridge_items", [])],
        },
        "transcript_status": result.get("transcript_status"),
        "source_index": source_index,
        "missing_artifacts": gaps,
        "thesis_update_allowed": False,
        "position_action_allowed": False,
        "next_workflow": "build_source_verified_post_earnings_deep_dive",
        "decision_limit": "The pack classifies source-backed inputs only; a deep dive must assess quality, guidance, transcript, model and security implications.",
    }


def _history_company(record: dict[str, Any]) -> dict[str, Any]:
    operating_checks = [{
        "driver_id": pillar.get("pillar_name"),
        "trend_status": pillar.get("prior_expected_trend"),
        "confirmation_condition": pillar.get("claim"),
        "falsifier": pillar.get("warning_or_break_condition"),
        "source_id": (pillar.get("source_ids") or [None])[0],
    } for pillar in record.get("pillars", []) if str(pillar.get("pillar_id") or "").startswith("operating_driver:")]
    cases = [{
        "scenario": rule.get("scenario"),
        "driver": rule.get("metric_id"),
        "period_end": rule.get("period_end"),
        "units": rule.get("units"),
        "operator": rule.get("operator"),
        "threshold_low": rule.get("threshold_low"),
        "threshold_high": rule.get("threshold_high"),
        "thesis_effect": rule.get("research_implication"),
        "source_ids": list(rule.get("source_ids", [])),
        "operating_cross_checks": operating_checks,
    } for rule in record.get("action_rules", [])]
    return {
        "candidate_id": record.get("candidate_id"),
        "ticker": record.get("ticker"),
        "company_name": record.get("company_name"),
        "event_date": record.get("event_date"),
        "event_source_id": record.get("event_source_id"),
        "scenario_gate_status": "conditional_thesis_triggers_available" if cases else record.get("scenario_gate_status"),
        "scenario_mode": "frozen_pre_event_baseline_from_append_only_history",
        "conditional_scenarios": cases,
        "source_index": list(record.get("source_index", [])),
    }


def _latest_history_company(history: dict[str, Any], ticker: str, event_date: str) -> dict[str, Any] | None:
    matches = [
        row for row in history.get("daily_records", [])
        if str(row.get("ticker") or "").upper() == ticker
        and row.get("event_date") == event_date
        and row.get("action_rules")
    ]
    if not matches:
        return None
    matches.sort(key=lambda row: (str(row.get("report_date") or ""), int(row.get("revision", 1))), reverse=True)
    return _history_company(matches[0])


def collect_company_earnings_results(
    report_date: str, earnings_scenarios: dict[str, Any], result_inputs: list[dict[str, Any]] | None = None,
    input_errors: list[dict[str, Any]] | None = None, company_thesis_history: dict[str, Any] | None = None,
) -> dict[str, Any]:
    collected_at = datetime.now(timezone.utc).isoformat()
    by_ticker: dict[str, dict[str, Any]] = {}
    for row in result_inputs or []:
        ticker = str(row.get("ticker") or "").upper()
        if ticker in by_ticker:
            raise ValueError(f"Duplicate post-earnings company record: {ticker}")
        by_ticker[ticker] = row
    current = {
        str(company.get("ticker") or "").upper(): company
        for company in earnings_scenarios.get("companies", [])[:MAX_COMPANIES]
    }
    candidates = dict(current)
    for ticker, result in by_ticker.items():
        current_company = candidates.get(ticker)
        if not current_company or current_company.get("scenario_gate_status") != "conditional_thesis_triggers_available":
            frozen = _latest_history_company(company_thesis_history or {}, ticker, str(result.get("event_date") or ""))
            if frozen:
                candidates[ticker] = frozen
            elif not current_company:
                candidates[ticker] = {
                    "candidate_id": None,
                    "ticker": ticker,
                    "company_name": result.get("issuer"),
                    "event_date": result.get("event_date"),
                    "event_source_id": None,
                    "scenario_gate_status": "blocked_missing_exact_event_bar_or_driver",
                    "scenario_mode": "missing_frozen_pre_event_baseline",
                    "conditional_scenarios": [],
                    "source_index": [],
                }
    companies = [
        _company_pack(company, by_ticker.get(ticker), collected_at)
        for ticker, company in sorted(candidates.items())[:MAX_COMPANIES]
    ]
    payload = {
        "schema_version": SCHEMA_VERSION,
        "report_date": report_date,
        "collected_at": collected_at,
        "collection_status": "ready" if companies and all(row["pack_status"] == "ready_for_post_earnings_deep_dive" for row in companies) else "partial_or_waiting",
        "company_count": len(companies),
        "ready_count": sum(row["pack_status"] == "ready_for_post_earnings_deep_dive" for row in companies),
        "companies": companies,
        "input_errors": input_errors or [],
        "methodology": {
            "primary_body_verification_required": True,
            "exact_period_and_unit_trigger_match_required": True,
            "comparable_operating_kpi_required": True,
            "eps_quality_screen_required": True,
            "thesis_or_position_update_allowed": False,
        },
        "posture": "post_earnings_source_pack_not_investment_conclusion",
    }
    validate_company_earnings_results(payload)
    return payload


def validate_company_earnings_results(payload: dict[str, Any]) -> None:
    if payload.get("schema_version") != SCHEMA_VERSION:
        raise ValueError("Unexpected post-earnings input-pack schema")
    if int(payload.get("company_count", -1)) != len(payload.get("companies", [])):
        raise ValueError("Company count does not match post-earnings packs")
    for company in payload.get("companies", []):
        if company.get("thesis_update_allowed") is not False or company.get("position_action_allowed") is not False:
            raise ValueError("Post-earnings input pack cannot update thesis or position action")
        if company.get("pack_status") == "ready_for_post_earnings_deep_dive":
            if not company.get("headline_result_case") or not company.get("reported_metric_comparison") or not company.get("operating_kpi_checks"):
                raise ValueError("Ready post-earnings pack requires exact result case and comparable KPI")
        source_ids = {row.get("source_id") for row in company.get("source_index", [])}
        metric = company.get("reported_metric_comparison") or {}
        if metric and metric.get("source_id") not in source_ids:
            raise ValueError("Reported result comparison requires source lineage")
        if metric and any(source_id not in source_ids for source_id in metric.get("pre_event_source_ids", [])):
            raise ValueError("Pre-event trigger comparison requires source lineage")
        for row in company.get("operating_kpi_checks", []):
            if row.get("source_id") not in source_ids:
                raise ValueError("Operating KPI comparison requires source lineage")
        for row in company.get("guidance_updates", []):
            if row.get("source_id") not in source_ids:
                raise ValueError("Guidance update requires source lineage")
        for row in (company.get("eps_quality") or {}).get("bridge_items", []):
            if row.get("source_id") not in source_ids:
                raise ValueError("EPS quality bridge item requires source lineage")
        eps_quality = company.get("eps_quality") or {}
        if eps_quality.get("status") != "source_not_provided" and eps_quality.get("source_id") not in source_ids:
            raise ValueError("EPS quality screen requires source lineage")


def main() -> None:
    parser = argparse.ArgumentParser(description="Collect verified post-earnings deep-dive inputs")
    parser.add_argument("--date", required=True)
    parser.add_argument("--earnings-scenarios-file")
    parser.add_argument("--company-thesis-history-file")
    parser.add_argument("--output-file")
    args = parser.parse_args()
    scenario_path = root_path(
        args.earnings_scenarios_file,
        ROOT / "workspace" / "company_earnings_scenarios" / args.date / "company_earnings_scenarios.json",
    )
    if not scenario_path.exists():
        raise SystemExit(f"Company earnings scenarios do not exist: {scenario_path}")
    result_inputs, input_errors = load_result_inputs(args.date)
    history_path = root_path(
        args.company_thesis_history_file,
        ROOT / "workspace" / "history" / "company_thesis_history.json",
    )
    history = json.loads(history_path.read_text(encoding="utf-8")) if history_path.exists() else {}
    payload = collect_company_earnings_results(
        args.date, json.loads(scenario_path.read_text(encoding="utf-8")), result_inputs, input_errors, history,
    )
    output = root_path(
        args.output_file,
        ROOT / "workspace" / "company_earnings_results" / args.date / "company_earnings_results.json",
    )
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Company post-earnings input pack saved: {output.relative_to(ROOT)}")
    print(f"Post-earnings pack status: ready={payload['ready_count']}/{payload['company_count']}")


if __name__ == "__main__":
    main()
