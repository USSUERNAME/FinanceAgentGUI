"""Collect source-backed company financial baselines from SEC Company Facts."""

from __future__ import annotations

import argparse
import json
import os
import re
import time
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any, Callable
from urllib.request import Request, urlopen

from collectors.common import ROOT, load_dotenv
from company_long_term_metrics import LONG_TERM_METRIC_IDS, build_long_term_metrics
from collect_company_market_context import _number, root_path
from collect_sector_fundamentals import load_fundamental_registry

SCHEMA_VERSION = "company_primary_facts.v1"
SEC_API_DOCS_URL = "https://www.sec.gov/search-filings/edgar-application-programming-interfaces"
SEC_TICKERS_URL = "https://www.sec.gov/files/company_tickers.json"
ACCEPTED_FORMS = {"10-Q", "10-Q/A", "10-K", "10-K/A", "20-F", "20-F/A", "6-K", "6-K/A"}
DEFAULT_MAX_COMPANIES = 6
CIK_PATTERN = re.compile(r"/Archives/edgar/data/(\d+)/", re.IGNORECASE)

METRIC_CONCEPTS = {
    "revenue": [
        ("us-gaap", "RevenueFromContractWithCustomerExcludingAssessedTax"),
        ("us-gaap", "SalesRevenueNet"),
        ("us-gaap", "Revenues"),
        ("ifrs-full", "Revenue"),
    ],
    "operating_income": [
        ("us-gaap", "OperatingIncomeLoss"),
        ("ifrs-full", "ProfitLossFromOperatingActivities"),
    ],
    "net_income": [
        ("us-gaap", "NetIncomeLoss"),
        ("ifrs-full", "ProfitLoss"),
    ],
    "diluted_eps": [
        ("us-gaap", "EarningsPerShareDiluted"),
        ("ifrs-full", "DilutedEarningsLossPerShare"),
    ],
    "operating_cash_flow": [
        ("us-gaap", "NetCashProvidedByUsedInOperatingActivities"),
        ("ifrs-full", "CashFlowsFromUsedInOperatingActivities"),
    ],
    "capital_expenditures": [
        ("us-gaap", "PaymentsToAcquireProductiveAssets"),
        ("us-gaap", "PaymentsToAcquirePropertyPlantAndEquipment"),
        ("ifrs-full", "PurchaseOfPropertyPlantAndEquipment"),
    ],
    "dividends_paid": [
        ("us-gaap", "PaymentsOfDividendsCommonStock"),
        ("us-gaap", "PaymentsOfDividends"),
        ("ifrs-full", "DividendsPaid"),
    ],
    "share_repurchases": [
        ("us-gaap", "PaymentsForRepurchaseOfCommonStock"),
        ("us-gaap", "PaymentsForRepurchaseOfEquity"),
    ],
    "share_issuance": [
        ("us-gaap", "ProceedsFromStockOptionsExercised"),
        ("us-gaap", "ProceedsFromIssuanceOfCommonStock"),
        ("us-gaap", "ProceedsFromIssuanceOrSaleOfEquity"),
    ],
    "diluted_shares": [
        ("us-gaap", "WeightedAverageNumberOfDilutedSharesOutstanding"),
        ("ifrs-full", "AdjustedWeightedAverageShares"),
    ],
}


def sec_companyfacts(cik: str, user_agent: str) -> dict[str, Any]:
    url = f"https://data.sec.gov/api/xbrl/companyfacts/CIK{cik.zfill(10)}.json"
    request = Request(url, headers={"User-Agent": user_agent, "Accept": "application/json"})
    with urlopen(request, timeout=30) as response:
        return json.loads(response.read().decode("utf-8"))


def sec_company_tickers(user_agent: str) -> dict[str, str]:
    request = Request(SEC_TICKERS_URL, headers={"User-Agent": user_agent, "Accept": "application/json"})
    with urlopen(request, timeout=30) as response:
        payload = json.loads(response.read().decode("utf-8"))
    rows = payload.values() if isinstance(payload, dict) else []
    return {
        str(row.get("ticker") or "").upper(): str(row.get("cik_str") or "").zfill(10)
        for row in rows if isinstance(row, dict) and row.get("ticker") and row.get("cik_str")
    }


def company_cik_map(registry: dict[str, Any]) -> dict[tuple[str, str], str]:
    result: dict[tuple[str, str], str] = {}
    for row in registry.get("verified_exposures", []):
        if str(row.get("market")).upper() != "US" or row.get("primary_source_confirmed") is not True:
            continue
        match = CIK_PATTERN.search(str(row.get("source_url") or ""))
        if match:
            result[(str(row.get("sector_id")), str(row.get("ticker")).upper())] = match.group(1).zfill(10)
    return result


def _filing_index_url(cik: str, accession: str) -> str | None:
    if not accession or not re.fullmatch(r"\d{10}-\d{2}-\d{6}", accession):
        return None
    return (
        f"https://www.sec.gov/Archives/edgar/data/{int(cik)}/"
        f"{accession.replace('-', '')}/{accession}-index.html"
    )


def _all_metric_records(payload: dict[str, Any], metric_id: str, report_day: date) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    facts = payload.get("facts") or {}
    for taxonomy, concept in METRIC_CONCEPTS[metric_id]:
        fact = (facts.get(taxonomy) or {}).get(concept) or {}
        for unit, unit_rows in (fact.get("units") or {}).items():
            for row in unit_rows:
                filed = str(row.get("filed") or "")
                if row.get("form") not in ACCEPTED_FORMS or not filed:
                    continue
                try:
                    if date.fromisoformat(filed) > report_day:
                        continue
                except ValueError:
                    continue
                value = _number(row.get("val"))
                if value is None or not row.get("end") or not row.get("accn"):
                    continue
                records.append({
                    "metric_id": metric_id,
                    "taxonomy": taxonomy,
                    "concept": concept,
                    "label": fact.get("label") or concept,
                    "description": fact.get("description") or None,
                    "value": value,
                    "unit": unit,
                    "period_start": row.get("start"),
                    "period_end": row.get("end"),
                    "filed_date": filed,
                    "form": row.get("form"),
                    "fiscal_year": row.get("fy"),
                    "fiscal_period": row.get("fp"),
                    "frame": row.get("frame"),
                    "accession_number": row.get("accn"),
                })
    return records


def latest_reported_metric(payload: dict[str, Any], metric_id: str, report_day: date, cik: str) -> dict[str, Any] | None:
    rows = _all_metric_records(payload, metric_id, report_day)
    if not rows:
        return None
    rows.sort(key=lambda row: (
        str(row.get("filed_date") or ""),
        str(row.get("period_end") or ""),
        str(row.get("period_start") or ""),
        1 if row.get("form") in {"10-Q", "20-F", "6-K"} else 0,
    ), reverse=True)
    selected = rows[0]
    return {
        **selected,
        "source_url": _filing_index_url(cik, str(selected["accession_number"])),
        "evidence_label": "fact_source_reported",
        "confidence": "high",
        "period_note": "Use the exact start/end and form; quarterly filings may contain year-to-date duration facts.",
    }


def annual_reported_metrics(
    payload: dict[str, Any], metric_id: str, report_day: date, cik: str, limit: int = 5,
) -> list[dict[str, Any]]:
    """Select comparable annual duration facts, keeping exact filing lineage."""
    annual: list[dict[str, Any]] = []
    for row in _all_metric_records(payload, metric_id, report_day):
        if row.get("form") not in {"10-K", "10-K/A", "20-F", "20-F/A"}:
            continue
        start = row.get("period_start")
        end = row.get("period_end")
        if not start or not end:
            continue
        try:
            duration = (date.fromisoformat(str(end)) - date.fromisoformat(str(start))).days
        except ValueError:
            continue
        if duration < 300 or duration > 390:
            continue
        annual.append(row)
    annual.sort(key=lambda row: (
        str(row.get("period_end") or ""),
        str(row.get("filed_date") or ""),
    ), reverse=True)
    selected_by_period: dict[str, dict[str, Any]] = {}
    for row in annual:
        selected_by_period.setdefault(str(row["period_end"]), row)
    selected = sorted(selected_by_period.values(), key=lambda row: str(row["period_end"]))[-limit:]
    return [{
        **row,
        "source_url": _filing_index_url(cik, str(row["accession_number"])),
        "evidence_label": "fact_source_reported_annual",
        "confidence": "high",
        "period_note": "Annual duration fact selected from a 10-K/20-F; exact start/end and unit remain controlling.",
    } for row in selected]


def _guidance_input_dir(report_date: str) -> Path:
    return ROOT / "workspace" / "company_guidance_inputs" / report_date


def validate_guidance_record(row: dict[str, Any], report_day: date) -> dict[str, Any]:
    required = {
        "record_id", "ticker", "metric_id", "period_end", "unit", "currency",
        "source_type", "source_url", "source_date", "body_location",
        "primary_source_confirmed", "body_verified",
    }
    missing = sorted(required - set(row))
    if missing:
        raise ValueError(f"Guidance record missing fields: {missing}")
    if row["metric_id"] not in {"revenue", "diluted_eps"}:
        raise ValueError("Only revenue and diluted EPS guidance are supported")
    if row["source_type"] not in {"company_earnings_release", "company_ir_presentation", "company_filing"}:
        raise ValueError("Guidance requires a company-owned primary source")
    if not str(row["source_url"]).startswith("https://") or not str(row["body_location"]).strip():
        raise ValueError("Guidance requires an HTTPS source and exact body location")
    if row["primary_source_confirmed"] is not True or row["body_verified"] is not True:
        raise ValueError("Guidance requires primary-source body verification")
    if date.fromisoformat(str(row["source_date"])) > report_day:
        raise ValueError("Guidance source date is after the report date")
    low = _number(row.get("value_low"))
    high = _number(row.get("value_high"))
    point = _number(row.get("value"))
    if point is None and (low is None or high is None):
        raise ValueError("Guidance requires a point value or complete low/high range")
    if low is not None and high is not None and low > high:
        raise ValueError("Guidance low cannot exceed high")
    return {
        **row,
        "ticker": str(row["ticker"]).upper(),
        "value": point,
        "value_low": low,
        "value_high": high,
        "midpoint": point if point is not None else round((low + high) / 2, 6),
        "evidence_label": "issuer_management_claim",
        "confidence": "high",
    }


def load_guidance_inputs(report_date: str) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    directory = _guidance_input_dir(report_date)
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
                    raise ValueError("Duplicate guidance record ID")
                validated = validate_guidance_record(row, report_day)
                seen.add(validated["record_id"])
                accepted.append(validated)
            except Exception as exc:
                errors.append({
                    "file": str(path.relative_to(ROOT)),
                    "record_id": row.get("record_id"),
                    "error": str(exc),
                })
    return accepted, errors


def compare_guidance_to_estimates(guidance: dict[str, Any], valuation_row: dict[str, Any]) -> dict[str, Any]:
    metric_map = {"revenue": "revenue_estimate_average", "diluted_eps": "eps_estimate_average"}
    estimate_field = metric_map[guidance["metric_id"]]
    matches = [
        row for row in (valuation_row.get("expectations_bar") or {}).get("rows", [])
        if row.get("fiscal_period_end") == guidance.get("period_end")
        and _number(row.get(estimate_field)) is not None
    ]
    if not matches:
        return {
            "status": "not_comparable_period_or_missing_estimate",
            "reason": "No provider estimate with the exact same fiscal period end is available.",
        }
    if guidance["metric_id"] == "revenue" and not (
        guidance.get("currency") == "USD" and guidance.get("unit") == "USD"
    ):
        return {"status": "not_comparable_unit", "reason": "Revenue units or currency do not match the provider estimate."}
    if guidance["metric_id"] == "diluted_eps" and guidance.get("unit") != "USD_per_share":
        return {"status": "not_comparable_unit", "reason": "EPS guidance is not in USD per share."}
    estimate_value = _number(matches[0][estimate_field])
    midpoint = _number(guidance.get("midpoint"))
    gap_pct = ((midpoint / estimate_value) - 1) * 100 if estimate_value and midpoint is not None else None
    return {
        "status": "available_exact_period_and_unit",
        "estimate_value": estimate_value,
        "guidance_midpoint": midpoint,
        "guidance_vs_estimate_pct": round(gap_pct, 4) if gap_pct is not None else None,
        "period_end": guidance.get("period_end"),
        "evidence_label": "derived_calculation",
        "formula": "(guidance_midpoint / third_party_estimate - 1) * 100",
    }


def collect_company_primary_facts(
    report_date: str,
    valuation_expectations: dict[str, Any],
    registry: dict[str, Any],
    user_agent: str,
    fetcher: Callable[[str, str], dict[str, Any]] = sec_companyfacts,
    sleeper: Callable[[float], None] = time.sleep,
    delay_seconds: float = 0.0,
    max_companies: int = DEFAULT_MAX_COMPANIES,
    guidance_inputs: list[dict[str, Any]] | None = None,
    guidance_errors: list[dict[str, Any]] | None = None,
    ticker_cik_fetcher: Callable[[str], dict[str, str]] = sec_company_tickers,
    research_queue: dict[str, Any] | None = None,
) -> dict[str, Any]:
    candidate_map: dict[str, dict[str, Any]] = {}
    for candidate in valuation_expectations.get("companies", []):
        ticker = str(candidate.get("ticker") or "").upper()
        if ticker:
            candidate_map[ticker] = candidate
    for candidate in (research_queue or {}).get("candidates", []):
        if candidate.get("queue_stage") != "valuation_expectations_gated":
            continue
        ticker = str(candidate.get("ticker") or "").upper()
        if ticker and ticker not in candidate_map:
            candidate_map[ticker] = candidate
    candidates = list(candidate_map.values())[:max_companies]
    cik_map = company_cik_map(registry)
    guidance_inputs = guidance_inputs or []
    guidance_errors = guidance_errors or []
    companies: list[dict[str, Any]] = []
    skipped: list[dict[str, Any]] = []
    errors: list[dict[str, Any]] = []
    request_count = 0
    ticker_cik_requests = 0
    collected_at = datetime.now(timezone.utc).isoformat()
    if user_agent:
        missing_tickers = [
            str(candidate.get("ticker") or "").upper()
            for candidate in candidates
            if not cik_map.get((str(candidate.get("sector_id")), str(candidate.get("ticker") or "").upper()))
        ]
        ticker_cik_map: dict[str, str] = {}
        if missing_tickers:
            try:
                ticker_cik_map = ticker_cik_fetcher(user_agent)
                ticker_cik_requests = 1
            except Exception as exc:
                errors.append({"status": "sec_ticker_map_failed", "error": str(exc)})
        for candidate in candidates:
            key = (str(candidate.get("sector_id")), str(candidate.get("ticker")).upper())
            cik = cik_map.get(key) or ticker_cik_map.get(str(candidate.get("ticker") or "").upper())
            if not cik:
                skipped.append({
                    "candidate_id": candidate.get("candidate_id"),
                    "ticker": candidate.get("ticker"),
                    "status": "verified_sec_cik_not_available",
                })
                continue
            try:
                if request_count and delay_seconds > 0:
                    sleeper(delay_seconds)
                request_count += 1
                payload = fetcher(cik, user_agent)
                metrics = [
                    value for metric_id in METRIC_CONCEPTS
                    if (value := latest_reported_metric(payload, metric_id, date.fromisoformat(report_date), cik))
                ]
                annual_metrics = {
                    metric_id: annual_reported_metrics(
                        payload, metric_id, date.fromisoformat(report_date), cik,
                    )
                    for metric_id in LONG_TERM_METRIC_IDS
                }
                long_term = build_long_term_metrics(annual_metrics)
                company_guidance = [
                    row for row in guidance_inputs if row["ticker"] == str(candidate.get("ticker")).upper()
                ]
                guidance_rows = [{
                    **row,
                    "estimate_comparison": compare_guidance_to_estimates(row, candidate),
                } for row in company_guidance]
                source_urls = sorted({str(row["source_url"]) for row in metrics if row.get("source_url")})
                source_urls.extend(
                    url for url in sorted({str(row["source_url"]) for row in guidance_rows}) if url not in source_urls
                )
                companies.append({
                    "candidate_id": candidate.get("candidate_id"),
                    "sector_id": candidate.get("sector_id"),
                    "ticker": candidate.get("ticker"),
                    "company_name": candidate.get("company_name") or payload.get("entityName"),
                    "sec_entity_name": payload.get("entityName"),
                    "cik": cik,
                    "fact_status": "available" if len(metrics) >= 3 else "partial",
                    "reported_metrics": metrics,
                    "reported_metric_count": len(metrics),
                    "annual_reported_metrics": annual_metrics,
                    "long_term_financials": long_term,
                    "guidance_status": "body_verified_primary" if guidance_rows else "not_collected",
                    "guidance": guidance_rows,
                    "source_urls": source_urls,
                    "source_inventory": {
                        "source_name": "SEC Company Facts and linked EDGAR filings",
                        "source_type": "primary_public_filing",
                        "provider_or_owner": "U.S. Securities and Exchange Commission",
                        "source_url": SEC_API_DOCS_URL,
                        "retrieved_at": collected_at,
                        "freshness_status": "latest_filed_fact_available_by_metric",
                        "notes": "Standard taxonomy facts only; company extension facts and non-XBRL guidance are not inferred.",
                    },
                    "security_readiness": "primary_reported_baseline_not_decision_grade",
                    "data_gaps": [
                        "Reported metrics may cover different durations; exact start/end dates control comparability.",
                        "Company guidance is absent unless a body-verified company source was supplied.",
                        "Custom XBRL extension KPIs, segment detail, adjustments, and transcript commentary are not collected.",
                        *(["Five comparable annual core periods are not yet available."] if long_term["quality_gate"]["status"] != "ready" else []),
                    ],
                    "posture": "reported_fact_baseline_not_investment_recommendation",
                })
            except Exception as exc:
                errors.append({
                    "candidate_id": candidate.get("candidate_id"),
                    "ticker": candidate.get("ticker"),
                    "error": str(exc),
                })
    if not candidates:
        status = "no_eligible_companies"
    elif not user_agent:
        status = "missing_sec_user_agent"
    elif companies and errors:
        status = "partial"
    elif companies:
        status = "available"
    else:
        status = "failed_or_unmapped"
    result = {
        "schema_version": SCHEMA_VERSION,
        "report_date": report_date,
        "collection_status": status,
        "candidate_count": len(candidates),
        "company_count": len(companies),
        "request_count": request_count,
        "ticker_cik_request_count": ticker_cik_requests,
        "max_companies": max_companies,
        "companies": companies,
        "skipped": skipped,
        "errors": errors,
        "guidance_input_errors": guidance_errors,
        "methodology": {
            "source": "SEC Company Facts API and linked EDGAR filing index",
            "source_url": SEC_API_DOCS_URL,
            "accepted_forms": sorted(ACCEPTED_FORMS),
            "standard_taxonomies_only": ["us-gaap", "ifrs-full"],
            "annual_duration_days": [300, 390],
            "long_term_history_years": 5,
            "fcf_definition": "operating_cash_flow_minus_absolute_capital_expenditures",
            "exact_period_and_unit_required_for_guidance_comparison": True,
            "no_cross_period_actual_estimate_comparison": True,
        },
        "posture": "primary_fact_gate_not_investment_recommendation",
    }
    validate_company_primary_facts(result)
    return result


def validate_company_primary_facts(payload: dict[str, Any]) -> None:
    if payload.get("schema_version") != SCHEMA_VERSION:
        raise ValueError("Unexpected company primary facts schema")
    if int(payload.get("company_count", -1)) != len(payload.get("companies", [])):
        raise ValueError("Company count does not match fact packs")
    for company in payload.get("companies", []):
        if company.get("security_readiness") == "decision_grade":
            raise ValueError("Reported baseline cannot become decision-grade research")
        for metric in company.get("reported_metrics", []):
            if metric.get("evidence_label") != "fact_source_reported":
                raise ValueError("SEC metrics must remain source-reported facts")
            if not metric.get("period_end") or not metric.get("filed_date") or not metric.get("unit"):
                raise ValueError("Reported metrics require period, filing date, and unit")
            if not str(metric.get("source_url") or "").startswith("https://www.sec.gov/Archives/"):
                raise ValueError("Reported metrics require a direct EDGAR filing URL")
        for guidance in company.get("guidance", []):
            if guidance.get("evidence_label") != "issuer_management_claim":
                raise ValueError("Guidance must remain an issuer management claim")
            comparison = guidance.get("estimate_comparison") or {}
            if comparison.get("status") == "available_exact_period_and_unit" and comparison.get("evidence_label") != "derived_calculation":
                raise ValueError("Guidance comparison must be labeled as a derived calculation")


def main() -> None:
    parser = argparse.ArgumentParser(description="Collect primary company fact baselines from SEC XBRL")
    parser.add_argument("--date", required=True)
    parser.add_argument("--valuation-expectations-file")
    parser.add_argument("--queue-file")
    parser.add_argument("--output-file")
    parser.add_argument("--max-companies", type=int)
    args = parser.parse_args()
    load_dotenv()
    valuation_path = root_path(
        args.valuation_expectations_file,
        ROOT / "workspace" / "company_valuation_expectations" / args.date / "company_valuation_expectations.json",
    )
    if not valuation_path.exists():
        raise SystemExit(f"Company valuation expectations does not exist: {valuation_path}")
    guidance, guidance_errors = load_guidance_inputs(args.date)
    queue_path = root_path(
        args.queue_file,
        ROOT / "workspace" / "company_research_queue" / args.date / "company_research_queue.json",
    )
    payload = collect_company_primary_facts(
        args.date,
        json.loads(valuation_path.read_text(encoding="utf-8")),
        load_fundamental_registry(),
        os.getenv("SEC_USER_AGENT", "").strip(),
        delay_seconds=float(os.getenv("SEC_REQUEST_DELAY_SECONDS", "0.25")),
        max_companies=args.max_companies or DEFAULT_MAX_COMPANIES,
        guidance_inputs=guidance,
        guidance_errors=guidance_errors,
        research_queue=(
            json.loads(queue_path.read_text(encoding="utf-8")) if queue_path.exists() else {}
        ),
    )
    output = root_path(
        args.output_file,
        ROOT / "workspace" / "company_primary_facts" / args.date / "company_primary_facts.json",
    )
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Company primary facts saved: {output.relative_to(ROOT)}")
    print(
        f"Company primary facts status: {payload['collection_status']} | "
        f"companies={payload['company_count']} | requests={payload['request_count']}"
    )


if __name__ == "__main__":
    main()
