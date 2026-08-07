"""Normalize reported company facts and verified operating KPIs into an auditable bridge."""

from __future__ import annotations

import argparse
import json
from datetime import date
from pathlib import Path
from typing import Any

from collectors.common import ROOT
from collect_company_market_context import _number, root_path

SCHEMA_VERSION = "company_operating_bridge.v1"
ALLOWED_STATEMENTS = {"segment", "kpi_schedule", "adjustment"}
ALLOWED_BASES = {"reported", "company_defined", "management_adjusted"}
COMPARABILITY_STATUSES = {
    "comparable", "comparable_rounded", "recast_comparable", "legacy_only",
    "directional_only", "missing_required_source", "not_comparable",
}
MANUAL_PERIOD_TYPES = {"annual", "quarterly", "monthly", "ytd", "ltm", "pro_forma"}
MANUAL_SOURCE_TYPE_MAP = {
    "company_filing": "filing",
    "company_earnings_release": "earnings_release",
    "company_ir_presentation": "investor_deck",
}


def _period_type(start: str | None, end: str | None, form: str | None = None) -> str:
    if not start or not end:
        return "unknown"
    try:
        days = (date.fromisoformat(end) - date.fromisoformat(start)).days + 1
    except ValueError:
        return "unknown"
    if days <= 120:
        return "quarterly"
    if days <= 280:
        return "ytd"
    if days <= 400:
        return "annual"
    return "other_duration"


def _source_id(ticker: str, accession_or_record: str) -> str:
    token = "".join(character for character in accession_or_record.upper() if character.isalnum())[-18:]
    return f"SRC-{ticker.upper()}-{token}"


def _source_index_row(
    source_id: str, source_name: str, source_type: str, owner: str,
    period: str | None, as_of: str | None, retrieved_at: str, location: str, notes: str,
) -> dict[str, Any]:
    return {
        "source_id": source_id,
        "source_name": source_name,
        "source_type": source_type,
        "owner_or_provider": owner,
        "period_covered": period,
        "as_of_date": as_of,
        "retrieved_at": retrieved_at,
        "file_tab_page_url_or_location": location,
        "source_rank": "primary_public_source",
        "freshness_status": "acceptable_for_period",
        "notes": notes,
    }


def normalize_primary_company(company: dict[str, Any], report_date: str) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    rows: list[dict[str, Any]] = []
    sources: dict[str, dict[str, Any]] = {}
    statement_map = {
        "revenue": ("income_statement", "revenue"),
        "operating_income": ("income_statement", "operating_income"),
        "net_income": ("income_statement", "net_income"),
        "diluted_eps": ("income_statement", "diluted_eps"),
        "operating_cash_flow": ("cash_flow", "operating_cash_flow"),
        "capital_expenditures": ("cash_flow", "capital_expenditures"),
    }
    ticker = str(company.get("ticker") or "")
    entity = company.get("company_name") or company.get("sec_entity_name") or ticker
    for metric in company.get("reported_metrics", []):
        metric_id = str(metric.get("metric_id"))
        if metric_id not in statement_map:
            continue
        statement, line_item_id = statement_map[metric_id]
        accession = str(metric.get("accession_number") or "UNSPECIFIED")
        source_id = _source_id(ticker, accession)
        source_url = str(metric.get("source_url") or "")
        sources[source_id] = _source_index_row(
            source_id,
            f"{ticker} {metric.get('form')} filing",
            "filing",
            "U.S. Securities and Exchange Commission",
            f"{metric.get('period_start') or '?'} to {metric.get('period_end')}",
            metric.get("filed_date"),
            report_date,
            source_url,
            f"SEC XBRL {metric.get('taxonomy')}:{metric.get('concept')}",
        )
        source_value = _number(metric.get("value"))
        normalized_value = -abs(source_value) if metric_id == "capital_expenditures" and source_value is not None else source_value
        source_unit = str(metric.get("unit") or "unknown")
        currency = "USD" if source_unit.startswith("USD") else None
        rows.append({
            "entity": entity,
            "ticker": ticker,
            "source_id": source_id,
            "statement": statement,
            "line_item_original": metric.get("label") or metric.get("concept"),
            "line_item_standard": line_item_id.replace("_", " ").title(),
            "line_item_id": line_item_id,
            "period_end": metric.get("period_end"),
            "period_start": metric.get("period_start"),
            "period_label": f"{metric.get('form')} {metric.get('fiscal_period') or ''}".strip(),
            "period_type": _period_type(metric.get("period_start"), metric.get("period_end"), metric.get("form")),
            "currency": currency,
            "units": source_unit,
            "source_value": source_value,
            "normalized_value": normalized_value,
            "normalization_method": "cash_flow_sign_normalized" if metric_id == "capital_expenditures" else "as_reported",
            "source_location": source_url,
            "evidence_label": "fact_source_reported",
            "confidence": metric.get("confidence") or "high",
            "comparison_status": "comparable",
            "model_treatment": "audit_baseline_only",
            "normalization_note": (
                "Source capex is preserved; normalized cash-flow convention records the outflow as negative."
                if metric_id == "capital_expenditures"
                else "Exact source period and units preserved."
            ),
        })
    return rows, list(sources.values())


def normalize_verified_operating(
    company: dict[str, Any], observations: list[dict[str, Any]], report_date: str,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]]]:
    ticker = str(company.get("ticker") or "")
    sector_id = str(company.get("sector_id") or "")
    entity = company.get("company_name") or ticker
    rows: list[dict[str, Any]] = []
    sources: dict[str, dict[str, Any]] = {}
    summaries: list[dict[str, Any]] = []
    for observation in observations:
        if str(observation.get("ticker")).upper() != ticker.upper() or observation.get("sector_id") != sector_id:
            continue
        if observation.get("eligible_for_sector_score") is not True:
            continue
        record_id = str(observation.get("record_id") or f"{ticker}-{observation.get('metric_type')}")
        source_id = _source_id(ticker, record_id)
        source_url = str(observation.get("source_url") or "")
        source_location = f"{source_url} | {observation.get('body_location')}"
        sources[source_id] = _source_index_row(
            source_id,
            f"{ticker} verified {observation.get('metric_type')} disclosure",
            "filing" if "sec.gov" in source_url else "investor_deck",
            company.get("company_name") or ticker,
            f"{observation.get('prior_period')} and {observation.get('current_period')}",
            observation.get("source_date"),
            report_date,
            source_location,
            "Body-verified operating KPI with separate primary exposure proof.",
        )
        base = {
            "entity": entity,
            "ticker": ticker,
            "source_id": source_id,
            "statement": "kpi_schedule",
            "line_item_original": observation.get("metric_type"),
            "line_item_standard": str(observation.get("metric_type") or "operating KPI").replace("_", " ").title(),
            "line_item_id": f"company_kpi.{observation.get('metric_type')}",
            "currency": observation.get("currency"),
            "units": observation.get("unit"),
            "normalization_method": "as_reported",
            "source_location": source_location,
            "evidence_label": "fact_source_reported",
            "confidence": "high",
            "comparison_status": "comparable",
            "model_treatment": "directional_driver_until_definition_review",
            "normalization_note": "Company-defined operating KPI; source periods and units preserved.",
        }
        for period_role, period_field, value_field in (
            ("current", "current_period", "current_value"),
            ("prior", "prior_period", "prior_value"),
        ):
            value = _number(observation.get(value_field))
            rows.append({
                **base,
                "period_end": observation.get(period_field),
                "period_start": None,
                "period_label": f"{period_role}:{observation.get(period_field)}",
                "period_type": "annual",
                "source_value": value,
                "normalized_value": value,
            })
        summaries.append({
            "record_id": record_id,
            "metric_id": observation.get("metric_type"),
            "current_value": _number(observation.get("current_value")),
            "prior_value": _number(observation.get("prior_value")),
            "unit": observation.get("unit"),
            "currency": observation.get("currency"),
            "current_period": observation.get("current_period"),
            "prior_period": observation.get("prior_period"),
            "change_pct": _number(observation.get("change_pct")),
            "source_id": source_id,
            "source_url": source_url,
            "body_location": observation.get("body_location"),
            "exposure_source_url": observation.get("exposure_source_url"),
            "transmission_status": "verified_company_operating_signal_not_causal_attribution",
        })
    return rows, list(sources.values()), summaries


def validate_manual_operating_record(row: dict[str, Any], report_day: date) -> dict[str, Any]:
    required = {
        "record_id", "sector_id", "ticker", "company_name", "statement",
        "line_item_original", "line_item_standard", "line_item_id", "metric_basis",
        "current_value", "current_period_end", "period_type", "currency", "units",
        "source_type", "source_url", "source_date", "body_location",
        "primary_source_confirmed", "body_verified", "exposure_verified",
        "exposure_source_url", "exposure_body_location", "definition",
        "comparison_status",
    }
    missing = sorted(required - set(row))
    if missing:
        raise ValueError(f"Operating record missing fields: {missing}")
    if row["statement"] not in ALLOWED_STATEMENTS or row["metric_basis"] not in ALLOWED_BASES:
        raise ValueError("Unsupported statement or metric basis")
    if row["comparison_status"] not in COMPARABILITY_STATUSES:
        raise ValueError("Unsupported comparison status")
    if row["period_type"] not in MANUAL_PERIOD_TYPES:
        raise ValueError("Unsupported operating period type")
    if row["source_type"] not in MANUAL_SOURCE_TYPE_MAP:
        raise ValueError("Operating evidence requires a company-owned primary source")
    if not all((row["primary_source_confirmed"], row["body_verified"], row["exposure_verified"])):
        raise ValueError("Operating evidence requires body and exposure verification")
    for field in ("source_url", "exposure_source_url"):
        if not str(row[field]).startswith("https://"):
            raise ValueError("Operating evidence URLs must be HTTPS")
    if not str(row["body_location"]).strip() or not str(row["exposure_body_location"]).strip():
        raise ValueError("Operating evidence requires exact body locations")
    if not str(row["definition"]).strip():
        raise ValueError("Company KPI or segment definition is required")
    for field in ("record_id", "ticker", "company_name", "line_item_original", "line_item_standard", "line_item_id", "currency", "units"):
        if not str(row.get(field) or "").strip():
            raise ValueError(f"Operating evidence requires nonblank {field}")
    if date.fromisoformat(str(row["source_date"])) > report_day:
        raise ValueError("Operating evidence source date is after report date")
    current_period_end = date.fromisoformat(str(row["current_period_end"]))
    if current_period_end > report_day:
        raise ValueError("Operating evidence period end is after report date")
    current = _number(row.get("current_value"))
    prior = _number(row.get("prior_value"))
    if current is None:
        raise ValueError("Current operating value must be numeric")
    if prior is not None and not row.get("prior_period_end"):
        raise ValueError("Prior value requires an explicit period end")
    if prior is not None and date.fromisoformat(str(row["prior_period_end"])) >= current_period_end:
        raise ValueError("Prior period end must precede current period end")
    if row["metric_basis"] == "management_adjusted":
        adjustment_required = {
            "reported_metric_reference", "adjustment_description",
            "reconciliation_status", "reconciliation_location",
        }
        if adjustment_required - set(row):
            raise ValueError("Management-adjusted evidence requires a reconciliation record")
        if (
            row["reconciliation_status"] != "body_verified"
            or not str(row["reconciliation_location"]).strip()
            or not str(row["reported_metric_reference"]).strip()
            or not str(row["adjustment_description"]).strip()
        ):
            raise ValueError("Management-adjusted evidence requires a body-verified reconciliation")
    return {
        **row,
        "ticker": str(row["ticker"]).upper(),
        "current_value": current,
        "prior_value": prior,
        "evidence_label": (
            "management_adjusted" if row["metric_basis"] == "management_adjusted"
            else "fact_source_reported"
        ),
        "confidence": "high",
    }


def load_manual_operating_inputs(report_date: str) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    directory = ROOT / "workspace" / "company_operating_inputs" / report_date
    if not directory.exists():
        return [], []
    accepted: list[dict[str, Any]] = []
    errors: list[dict[str, Any]] = []
    seen: set[str] = set()
    report_day = date.fromisoformat(report_date)
    for path in sorted(directory.glob("*.json")):
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
            rows = payload if isinstance(payload, list) else payload.get("records", [])
        except Exception as exc:
            errors.append({"file": str(path.relative_to(ROOT)), "error": str(exc)})
            continue
        for row in rows:
            try:
                if row.get("record_id") in seen:
                    raise ValueError("Duplicate operating record ID")
                validated = validate_manual_operating_record(row, report_day)
                seen.add(validated["record_id"])
                accepted.append(validated)
            except Exception as exc:
                errors.append({
                    "file": str(path.relative_to(ROOT)),
                    "record_id": row.get("record_id"),
                    "error": str(exc),
                })
    return accepted, errors


def normalize_manual_record(record: dict[str, Any], report_date: str) -> tuple[list[dict[str, Any]], dict[str, Any], dict[str, Any]]:
    ticker = record["ticker"]
    source_id = _source_id(ticker, record["record_id"])
    source_location = f"{record['source_url']} | {record['body_location']}"
    source = _source_index_row(
        source_id,
        f"{ticker} {record['line_item_original']}",
        MANUAL_SOURCE_TYPE_MAP[record["source_type"]],
        record["company_name"],
        f"{record.get('prior_period_end') or '?'} to {record['current_period_end']}",
        record["source_date"],
        report_date,
        source_location,
        f"Definition: {record['definition']}",
    )
    base = {
        "entity": record["company_name"],
        "ticker": ticker,
        "source_id": source_id,
        "statement": record["statement"],
        "line_item_original": record["line_item_original"],
        "line_item_standard": record["line_item_standard"],
        "line_item_id": record["line_item_id"],
        "currency": record["currency"],
        "units": record["units"],
        "normalization_method": "as_reported",
        "source_location": source_location,
        "evidence_label": record["evidence_label"],
        "confidence": record["confidence"],
        "comparison_status": record["comparison_status"],
        "model_treatment": record.get("model_treatment") or "audit_only_pending_full_schedule",
        "normalization_note": f"{record['metric_basis']}; {record['definition']}",
    }
    rows = [{
        **base,
        "period_end": record["current_period_end"],
        "period_start": record.get("current_period_start"),
        "period_label": record.get("current_period_label") or record["current_period_end"],
        "period_type": record["period_type"],
        "source_value": record["current_value"],
        "normalized_value": record["current_value"],
    }]
    if record.get("prior_value") is not None:
        rows.append({
            **base,
            "period_end": record["prior_period_end"],
            "period_start": record.get("prior_period_start"),
            "period_label": record.get("prior_period_label") or record["prior_period_end"],
            "period_type": record["period_type"],
            "source_value": record["prior_value"],
            "normalized_value": record["prior_value"],
        })
    change_pct = None
    if record.get("prior_value") not in {None, 0}:
        change_pct = round((record["current_value"] / record["prior_value"] - 1) * 100, 4)
    summary = {
        "record_id": record["record_id"],
        "metric_id": record["line_item_id"],
        "statement": record["statement"],
        "metric_basis": record["metric_basis"],
        "definition": record["definition"],
        "current_value": record["current_value"],
        "prior_value": record.get("prior_value"),
        "unit": record["units"],
        "currency": record["currency"],
        "current_period": record["current_period_end"],
        "prior_period": record.get("prior_period_end"),
        "change_pct": change_pct,
        "source_id": source_id,
        "source_url": record["source_url"],
        "body_location": record["body_location"],
        "exposure_source_url": record["exposure_source_url"],
        "comparison_status": record["comparison_status"],
        "transmission_status": "verified_company_operating_signal_not_causal_attribution",
    }
    return rows, source, summary


def _company_qa(
    company: dict[str, Any], rows: list[dict[str, Any]], summaries: list[dict[str, Any]], sources: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    ticker = str(company.get("ticker") or "")
    source_ids = {row["source_id"] for row in sources}
    qa_flags: list[dict[str, Any]] = []
    checks: list[dict[str, Any]] = []
    for index, row in enumerate(rows, 1):
        valid_source = row.get("source_id") in source_ids
        checks.append({
            "check_id": f"{ticker}-source-{index}",
            "area": "source_lineage",
            "period": row.get("period_end"),
            "test": "Normalized row source_id exists in Source_Index",
            "expected_value": True,
            "observed_value": valid_source,
            "variance": None,
            "result": "pass" if valid_source else "fail",
            "source_id": row.get("source_id"),
            "notes": row.get("line_item_id"),
        })
        if not valid_source:
            qa_flags.append({
                "flag_id": f"{ticker}-missing-source-{index}",
                "severity": "blocker",
                "entity": company.get("company_name"),
                "period": row.get("period_end"),
                "area": "source_lineage",
                "issue": "Normalized row has no matching source index entry.",
                "impact": "Cannot use the row downstream.",
                "recommended_fix": "Add the missing primary source entry.",
                "source_id": row.get("source_id"),
                "status": "open",
            })
    if not any(row.get("statement") == "segment" for row in rows):
        qa_flags.append({
            "flag_id": f"{ticker}-segment-gap",
            "severity": "medium",
            "entity": company.get("company_name"),
            "period": None,
            "area": "segment",
            "issue": "No body-verified segment schedule is available.",
            "impact": "Sector-to-company revenue and margin transmission cannot be quantified.",
            "recommended_fix": "Add the latest filing or IR segment table with current and comparable prior periods.",
            "source_id": None,
            "status": "open",
        })
    if not summaries:
        qa_flags.append({
            "flag_id": f"{ticker}-kpi-gap",
            "severity": "medium",
            "entity": company.get("company_name"),
            "period": None,
            "area": "kpi_schedule",
            "issue": "No comparable company operating KPI is verified.",
            "impact": "Industry signals are not yet tied to a company operating measure.",
            "recommended_fix": "Add a body-verified orders, bookings, backlog, volume, capacity, or segment KPI series.",
            "source_id": None,
            "status": "open",
        })
    return qa_flags, checks


def build_company_operating_bridge(
    report_date: str,
    primary_facts: dict[str, Any],
    sector_fundamentals: dict[str, Any],
    manual_inputs: list[dict[str, Any]] | None = None,
    manual_errors: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    manual_inputs = manual_inputs or []
    manual_errors = manual_errors or []
    companies: list[dict[str, Any]] = []
    for company in primary_facts.get("companies", []):
        primary_rows, primary_sources = normalize_primary_company(company, report_date)
        operating_rows, operating_sources, summaries = normalize_verified_operating(
            company, sector_fundamentals.get("operating_observations", []), report_date,
        )
        manual_rows: list[dict[str, Any]] = []
        manual_sources: list[dict[str, Any]] = []
        manual_summaries: list[dict[str, Any]] = []
        for record in manual_inputs:
            if (
                record["ticker"] != str(company.get("ticker")).upper()
                or record["sector_id"] != company.get("sector_id")
            ):
                continue
            rows, source, summary = normalize_manual_record(record, report_date)
            manual_rows.extend(rows)
            manual_sources.append(source)
            manual_summaries.append(summary)
        source_map = {
            row["source_id"]: row
            for row in [*primary_sources, *operating_sources, *manual_sources]
        }
        rows = [*primary_rows, *operating_rows, *manual_rows]
        all_summaries = [*summaries, *manual_summaries]
        sources = list(source_map.values())
        qa_flags, checks = _company_qa(company, rows, all_summaries, sources)
        has_blocker = any(row["severity"] == "blocker" and row["status"] == "open" for row in qa_flags)
        companies.append({
            "candidate_id": company.get("candidate_id"),
            "sector_id": company.get("sector_id"),
            "ticker": company.get("ticker"),
            "company_name": company.get("company_name"),
            "normalized_financials_long": rows,
            "source_index": sources,
            "operating_evidence": all_summaries,
            "qa_flags": qa_flags,
            "validation_checks": checks,
            "transmission_status": (
                "verified_company_operating_signal_not_causal_attribution"
                if all_summaries else "company_operating_transmission_not_verified"
            ),
            "downstream_readiness": "not_ready" if has_blocker else "partial",
            "model_load_status": "audit_only_not_full_model_schedule",
            "decision_limit": "Company operating evidence does not prove that the sector theme caused the result.",
            "next_workflow": "complete_segment_and_kpi_schedule_then_earnings_driver_review",
        })
    result = {
        "schema_version": SCHEMA_VERSION,
        "report_date": report_date,
        "company_count": len(companies),
        "companies": companies,
        "manual_input_errors": manual_errors,
        "methodology": {
            "primary_reported_facts_normalized": True,
            "verified_sector_operating_evidence_reused": True,
            "management_adjusted_requires_reconciliation": True,
            "segment_and_kpi_definition_required": True,
            "causal_attribution_allowed": False,
        },
        "support_handoff": {
            "owning_workflow": "company_tearsheet",
            "decision_impact": "Improves the company operating baseline while preserving gaps in segment attribution and KPI comparability.",
            "readiness_effect": "screen_grade",
            "artifact_role": "embedded_support_artifact",
            "hidden_unless_requested": True,
        },
        "posture": "operating_evidence_bridge_not_investment_recommendation",
    }
    validate_company_operating_bridge(result)
    return result


def validate_company_operating_bridge(payload: dict[str, Any]) -> None:
    if payload.get("schema_version") != SCHEMA_VERSION:
        raise ValueError("Unexpected company operating bridge schema")
    if int(payload.get("company_count", -1)) != len(payload.get("companies", [])):
        raise ValueError("Company count does not match operating bridge")
    for company in payload.get("companies", []):
        source_ids = {row["source_id"] for row in company.get("source_index", [])}
        if any(row.get("source_id") not in source_ids for row in company.get("normalized_financials_long", [])):
            raise ValueError("Every normalized row requires a source index entry")
        if company.get("model_load_status") == "model_ready":
            raise ValueError("A partial company bridge cannot be labeled model-ready")
        if company.get("transmission_status") == "causal_attribution_confirmed":
            raise ValueError("Company operating evidence cannot prove sector-theme causality")
        for row in company.get("normalized_financials_long", []):
            if row.get("evidence_label") == "management_adjusted" and "management_adjusted" not in str(row.get("normalization_note")):
                raise ValueError("Adjusted metrics must remain visibly separated")


def main() -> None:
    parser = argparse.ArgumentParser(description="Build a normalized company operating evidence bridge")
    parser.add_argument("--date", required=True)
    parser.add_argument("--primary-facts-file")
    parser.add_argument("--sector-fundamentals-file")
    parser.add_argument("--output-file")
    args = parser.parse_args()
    primary_path = root_path(
        args.primary_facts_file,
        ROOT / "workspace" / "company_primary_facts" / args.date / "company_primary_facts.json",
    )
    fundamentals_path = root_path(
        args.sector_fundamentals_file,
        ROOT / "workspace" / "sector_fundamentals" / args.date / "sector_fundamentals.json",
    )
    for label, path in (("Company primary facts", primary_path), ("Sector fundamentals", fundamentals_path)):
        if not path.exists():
            raise SystemExit(f"{label} does not exist: {path}")
    manual_inputs, manual_errors = load_manual_operating_inputs(args.date)
    payload = build_company_operating_bridge(
        args.date,
        json.loads(primary_path.read_text(encoding="utf-8")),
        json.loads(fundamentals_path.read_text(encoding="utf-8")),
        manual_inputs,
        manual_errors,
    )
    output = root_path(
        args.output_file,
        ROOT / "workspace" / "company_operating_bridge" / args.date / "company_operating_bridge.json",
    )
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Company operating bridge saved: {output.relative_to(ROOT)}")
    print(f"Company operating bridge status: companies={payload['company_count']} | audit-only")


if __name__ == "__main__":
    main()
