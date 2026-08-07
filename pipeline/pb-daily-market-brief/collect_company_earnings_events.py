"""Collect expected earnings dates and gate exact dates with primary company evidence."""

from __future__ import annotations

import argparse
import csv
import io
import json
import os
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any, Callable
from urllib.parse import urlencode
from urllib.request import urlopen

from collectors.common import ROOT, load_dotenv
from collect_company_market_context import root_path

SCHEMA_VERSION = "company_earnings_events.v1"
ALPHA_VANTAGE_DOCS_URL = "https://www.alphavantage.co/documentation/"
ALPHA_VANTAGE_QUERY_URL = "https://www.alphavantage.co/query"
MAX_PROVIDER_REQUESTS = 1
ALLOWED_PRIMARY_SOURCE_TYPES = {
    "company_ir_calendar", "company_earnings_release", "company_event_page",
}


def fetch_earnings_calendar(api_key: str, horizon: str = "3month") -> str:
    query = urlencode({
        "function": "EARNINGS_CALENDAR",
        "horizon": horizon,
        "apikey": api_key,
    })
    with urlopen(f"{ALPHA_VANTAGE_QUERY_URL}?{query}", timeout=60) as response:
        return response.read().decode("utf-8-sig", errors="replace")


def parse_provider_calendar(text: str, tickers: set[str], report_day: date) -> list[dict[str, Any]]:
    stripped = text.strip()
    if not stripped:
        raise ValueError("Empty earnings calendar response")
    if stripped.startswith("{"):
        payload = json.loads(stripped)
        detail = payload.get("Information") or payload.get("Note") or payload.get("Error Message") or "JSON error response"
        raise ValueError(str(detail))
    rows: list[dict[str, Any]] = []
    for row in csv.DictReader(io.StringIO(stripped)):
        ticker = str(row.get("symbol") or "").upper()
        event_date = str(row.get("reportDate") or "")
        if ticker not in tickers or not event_date:
            continue
        try:
            parsed_date = date.fromisoformat(event_date)
        except ValueError:
            continue
        if parsed_date < report_day:
            continue
        rows.append({
            "event_id": f"provider-earnings-{ticker}-{event_date}",
            "ticker": ticker,
            "issuer": row.get("name"),
            "event_category": "earnings_and_guidance",
            "event_subcategory": "earnings_report",
            "event_name": "Expected earnings report",
            "reported_period": row.get("fiscalDateEnding"),
            "fiscal_period_end": row.get("fiscalDateEnding"),
            "date_type": "soft_date",
            "event_date": event_date,
            "time_of_day": None,
            "time_zone": None,
            "estimate": row.get("estimate") or None,
            "currency": row.get("currency") or None,
            "confidence": "expected",
            "evidence_label": "fact_provider_standardized",
            "source_id": "alpha_vantage:earnings_calendar",
            "source_url": ALPHA_VANTAGE_DOCS_URL,
            "decision_limit": "Provider expected date; primary company confirmation is required before preview promotion.",
        })
    rows.sort(key=lambda row: (row["ticker"], row["event_date"]))
    return rows


def validate_primary_event_record(row: dict[str, Any], report_day: date) -> dict[str, Any]:
    required = {
        "event_id", "ticker", "issuer", "reported_period", "fiscal_period_end", "event_date",
        "time_of_day", "time_zone", "source_type", "source_url", "source_date",
        "body_location", "primary_source_confirmed", "body_verified",
    }
    missing = sorted(required - set(row))
    if missing:
        raise ValueError(f"Earnings event record missing fields: {missing}")
    for field in ("event_id", "ticker", "issuer", "event_date", "source_date", "body_location"):
        if not str(row.get(field) or "").strip():
            raise ValueError(f"Earnings event requires nonblank {field}")
    if row.get("source_type") not in ALLOWED_PRIMARY_SOURCE_TYPES:
        raise ValueError("Confirmed earnings date requires a company-owned primary source")
    if row.get("primary_source_confirmed") is not True or row.get("body_verified") is not True:
        raise ValueError("Confirmed earnings date requires primary-source body verification")
    if not str(row.get("source_url") or "").startswith("https://"):
        raise ValueError("Confirmed earnings date requires an HTTPS source URL")
    event_day = date.fromisoformat(str(row["event_date"]))
    fiscal_period_end = date.fromisoformat(str(row["fiscal_period_end"]))
    source_day = date.fromisoformat(str(row["source_date"]))
    if source_day > report_day:
        raise ValueError("Earnings event source date is after report date")
    if event_day < report_day:
        raise ValueError("Confirmed earnings event is before report date")
    if fiscal_period_end >= event_day:
        raise ValueError("Confirmed earnings fiscal period must end before the event date")
    if row.get("time_of_day") not in {None, "", "before_market", "after_market", "during_market", "unspecified"}:
        raise ValueError("Unsupported earnings event time_of_day")
    if row.get("time_of_day") not in {None, "", "unspecified"} and not str(row.get("time_zone") or "").strip():
        raise ValueError("Market-timed earnings event requires a time zone")
    return {
        **row,
        "ticker": str(row["ticker"]).upper(),
        "event_category": "earnings_and_guidance",
        "event_subcategory": "earnings_report",
        "event_name": "Confirmed company earnings report",
        "date_type": "hard_date",
        "confidence": "confirmed",
        "evidence_label": "fact_source_reported",
    }


def load_primary_event_inputs(report_date: str) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    directory = ROOT / "workspace" / "company_earnings_event_inputs" / report_date
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
                if row.get("event_id") in seen:
                    raise ValueError("Duplicate earnings event ID")
                validated = validate_primary_event_record(row, report_day)
                accepted.append(validated)
                seen.add(validated["event_id"])
            except Exception as exc:
                errors.append({
                    "file": str(path.relative_to(ROOT)),
                    "event_id": row.get("event_id"),
                    "error": str(exc),
                })
    return accepted, errors


def _company_gate(
    report_date: str, profile: dict[str, Any], provider_rows: list[dict[str, Any]],
    primary_rows: list[dict[str, Any]], collected_at: str,
) -> dict[str, Any]:
    ticker = str(profile.get("identity", {}).get("ticker") or "").upper()
    provider = [row for row in provider_rows if row.get("ticker") == ticker]
    primary = [row for row in primary_rows if row.get("ticker") == ticker]
    primary.sort(key=lambda row: (str(row.get("source_date")), str(row.get("event_id"))), reverse=True)
    latest_source_date = primary[0].get("source_date") if primary else None
    latest = [row for row in primary if row.get("source_date") == latest_source_date]
    latest_dates = {row.get("event_date") for row in latest}
    selected = latest[0] if len(latest_dates) == 1 and latest else None
    conflicts: list[dict[str, Any]] = []
    if len(latest_dates) > 1:
        conflicts.append({
            "type": "same_date_primary_source_conflict",
            "dates": sorted(str(value) for value in latest_dates),
            "resolution": "No event selected; refresh company IR source.",
        })
    if selected:
        for row in provider:
            if row.get("event_date") != selected.get("event_date"):
                conflicts.append({
                    "type": "provider_primary_date_conflict",
                    "provider_date": row.get("event_date"),
                    "primary_date": selected.get("event_date"),
                    "resolution": "Primary company date controls; provider row remains expected-only.",
                })
    source_index = [{
        "source_id": "alpha_vantage:earnings_calendar",
        "source_name": "Alpha Vantage Earnings Calendar",
        "source_type": "provider",
        "owner_or_provider": "Alpha Vantage",
        "as_of_date": report_date,
        "retrieved_at": collected_at,
        "period_covered": "next 3 months",
        "source_location": ALPHA_VANTAGE_DOCS_URL,
        "freshness_status": "current_provider_pull",
        "notes": "Expected date only; not primary company confirmation.",
    }] if provider else []
    for row in primary:
        source_index.append({
            "source_id": f"EVENT-{ticker}-{row.get('event_id')}",
            "source_name": f"{ticker} earnings event confirmation",
            "source_type": "primary_public_source",
            "owner_or_provider": row.get("issuer"),
            "as_of_date": row.get("source_date"),
            "retrieved_at": collected_at,
            "period_covered": row.get("reported_period"),
            "source_location": row.get("source_url"),
            "freshness_status": "current_confirmed_event_date",
            "notes": row.get("body_location"),
        })
        row["source_id"] = f"EVENT-{ticker}-{row.get('event_id')}"
    if selected:
        selected = next(row for row in primary if row.get("event_id") == selected.get("event_id"))
        gate_status = "confirmed_primary_exact_date"
        readiness = "eligible_for_pre_event_preview_input_pack"
    elif primary:
        gate_status = "conflicting_primary_dates"
        readiness = "blocked_needs_primary_date_resolution"
    elif provider:
        gate_status = "provider_expected_needs_primary_confirmation"
        readiness = "monitoring_only"
    else:
        gate_status = "no_event_date"
        readiness = "monitoring_only"
    return {
        "candidate_id": profile.get("candidate_id"),
        "ticker": ticker,
        "issuer": profile.get("identity", {}).get("company_name"),
        "event_gate_status": gate_status,
        "selected_event": selected,
        "provider_expected_events": provider,
        "primary_event_records": primary,
        "superseded_primary_records": [row for row in primary if selected and row.get("event_id") != selected.get("event_id")],
        "conflicts": conflicts,
        "source_index": source_index,
        "readiness": readiness,
        "decision_limit": "Only a body-verified company-owned source can unlock an exact-date pre-event input pack.",
    }


def collect_company_earnings_events(
    report_date: str, tearsheets: dict[str, Any], api_key: str,
    fetcher: Callable[[str, str], str] = fetch_earnings_calendar,
    primary_inputs: list[dict[str, Any]] | None = None,
    primary_input_errors: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    profiles = tearsheets.get("profiles", [])
    tickers = {str(row.get("identity", {}).get("ticker") or "").upper() for row in profiles}
    provider_rows: list[dict[str, Any]] = []
    errors: list[dict[str, Any]] = []
    request_count = 0
    collected_at = datetime.now(timezone.utc).isoformat()
    if profiles and api_key:
        try:
            request_count = 1
            provider_rows = parse_provider_calendar(
                fetcher(api_key, "3month"), tickers, date.fromisoformat(report_date),
            )
        except Exception as exc:
            errors.append({"source": "alpha_vantage_earnings_calendar", "error": str(exc)})
    gates = [
        _company_gate(report_date, profile, provider_rows, primary_inputs or [], collected_at)
        for profile in profiles
    ]
    if not profiles:
        status = "no_company_profiles"
    elif gates and all(row["event_gate_status"] == "confirmed_primary_exact_date" for row in gates):
        status = "confirmed"
    elif any(row["event_gate_status"] == "confirmed_primary_exact_date" for row in gates):
        status = "partial"
    elif not api_key and not primary_inputs:
        status = "missing_provider_key_and_primary_inputs"
    elif errors:
        status = "provider_failed_primary_gate_still_applied"
    else:
        status = "monitoring_only"
    result = {
        "schema_version": SCHEMA_VERSION,
        "report_date": report_date,
        "collected_at": collected_at,
        "collection_status": status,
        "company_count": len(gates),
        "confirmed_count": sum(row["event_gate_status"] == "confirmed_primary_exact_date" for row in gates),
        "request_count": request_count,
        "horizon": "3month",
        "companies": gates,
        "provider_errors": errors,
        "primary_input_errors": primary_input_errors or [],
        "methodology": {
            "provider_calendar_source": ALPHA_VANTAGE_DOCS_URL,
            "single_global_provider_request": True,
            "provider_dates_are_expected_only": True,
            "primary_body_verification_required": True,
            "exact_dates_only_for_preview_gate": True,
        },
        "posture": "event_date_gate_not_investment_recommendation",
    }
    validate_company_earnings_events(result)
    return result


def validate_company_earnings_events(payload: dict[str, Any]) -> None:
    if payload.get("schema_version") != SCHEMA_VERSION:
        raise ValueError("Unexpected company earnings event schema")
    if int(payload.get("company_count", -1)) != len(payload.get("companies", [])):
        raise ValueError("Company count does not match event gates")
    for company in payload.get("companies", []):
        selected = company.get("selected_event")
        if company.get("event_gate_status") == "confirmed_primary_exact_date":
            if not selected or selected.get("confidence") != "confirmed" or selected.get("date_type") != "hard_date":
                raise ValueError("Confirmed event gate requires a primary hard date")
            source_ids = {row.get("source_id") for row in company.get("source_index", [])}
            if selected.get("source_id") not in source_ids:
                raise ValueError("Confirmed event requires source index lineage")
            if selected.get("evidence_label") != "fact_source_reported" or not selected.get("body_location"):
                raise ValueError("Confirmed event requires body-verified primary evidence")
        elif selected is not None:
            raise ValueError("Unconfirmed event gate cannot select an exact event")
        for row in company.get("provider_expected_events", []):
            if row.get("confidence") != "expected" or row.get("date_type") != "soft_date":
                raise ValueError("Provider earnings dates must remain expected-only")
        if company.get("readiness") == "eligible_for_pre_event_preview_input_pack" and company.get("event_gate_status") != "confirmed_primary_exact_date":
            raise ValueError("Preview readiness requires a confirmed primary event date")


def main() -> None:
    parser = argparse.ArgumentParser(description="Collect and verify company earnings event dates")
    parser.add_argument("--date", required=True)
    parser.add_argument("--tearsheets-file")
    parser.add_argument("--output-file")
    args = parser.parse_args()
    load_dotenv()
    tearsheets_path = root_path(
        args.tearsheets_file,
        ROOT / "workspace" / "company_tearsheets" / args.date / "company_tearsheets.json",
    )
    if not tearsheets_path.exists():
        raise SystemExit(f"Company tearsheets do not exist: {tearsheets_path}")
    primary_inputs, primary_errors = load_primary_event_inputs(args.date)
    payload = collect_company_earnings_events(
        args.date,
        json.loads(tearsheets_path.read_text(encoding="utf-8")),
        os.getenv("ALPHAVANTAGE_API_KEY", "").strip(),
        primary_inputs=primary_inputs,
        primary_input_errors=primary_errors,
    )
    output = root_path(
        args.output_file,
        ROOT / "workspace" / "company_earnings_events" / args.date / "company_earnings_events.json",
    )
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Company earnings events saved: {output.relative_to(ROOT)}")
    print(
        f"Company earnings event status: {payload['collection_status']} | "
        f"confirmed={payload['confirmed_count']}/{payload['company_count']} | requests={payload['request_count']}"
    )


if __name__ == "__main__":
    main()
