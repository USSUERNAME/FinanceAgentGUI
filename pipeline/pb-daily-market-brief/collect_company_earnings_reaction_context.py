"""Collect bounded historical earnings reaction context and validate option snapshots."""

from __future__ import annotations

import argparse
import json
import os
import time
from datetime import date, datetime, timezone
from pathlib import Path
from statistics import median
from typing import Any, Callable
from urllib.parse import urlencode
from urllib.request import urlopen

from collectors.common import ROOT, load_dotenv
from collect_company_market_context import _number, root_path

SCHEMA_VERSION = "company_earnings_reaction_context.v1"
ALPHA_VANTAGE_DOCS_URL = "https://www.alphavantage.co/documentation/"
ALPHA_VANTAGE_QUERY_URL = "https://www.alphavantage.co/query"
MAX_REACTION_COMPANIES = 2
MAX_PROVIDER_REQUESTS = MAX_REACTION_COMPANIES * 2
MAX_HISTORICAL_EVENTS = 4
ALLOWED_OPTION_SOURCE_TYPES = {"approved_provider_export", "broker_export", "exchange_export"}


def fetch_alpha_vantage(function: str, ticker: str, api_key: str) -> dict[str, Any]:
    query = urlencode({
        "function": function,
        "symbol": ticker,
        "outputsize": "compact",
        "apikey": api_key,
    })
    with urlopen(f"{ALPHA_VANTAGE_QUERY_URL}?{query}", timeout=60) as response:
        return json.loads(response.read().decode("utf-8"))


def _provider_error(payload: dict[str, Any]) -> str | None:
    return payload.get("Information") or payload.get("Note") or payload.get("Error Message")


def _price_series(payload: dict[str, Any]) -> dict[str, float]:
    raw = payload.get("Time Series (Daily)") or {}
    return {
        day: value
        for day, row in raw.items()
        if (value := _number((row or {}).get("4. close"))) is not None and value > 0
    }


def _historical_reactions(earnings: dict[str, Any], daily: dict[str, Any], report_day: date) -> list[dict[str, Any]]:
    prices = _price_series(daily)
    trading_days = sorted(prices)
    observations: list[dict[str, Any]] = []
    quarterly = sorted(
        earnings.get("quarterlyEarnings", []),
        key=lambda row: str(row.get("reportedDate") or ""),
        reverse=True,
    )
    for row in quarterly:
        reported_date = str(row.get("reportedDate") or "")
        if not reported_date:
            continue
        try:
            event_day = date.fromisoformat(reported_date)
        except ValueError:
            continue
        if event_day >= report_day:
            continue
        before = [day for day in trading_days if day < reported_date]
        after = [day for day in trading_days if day > reported_date]
        if not before or not after:
            continue
        start = before[-1]
        end = after[0]
        reaction = round((prices[end] / prices[start] - 1) * 100, 4)
        observations.append({
            "reported_date": reported_date,
            "fiscal_period_end": row.get("fiscalDateEnding"),
            "reported_eps": _number(row.get("reportedEPS")),
            "estimated_eps": _number(row.get("estimatedEPS")),
            "surprise": _number(row.get("surprise")),
            "surprise_pct": _number(row.get("surprisePercentage")),
            "window_start": start,
            "window_end": end,
            "start_close": prices[start],
            "end_close": prices[end],
            "reaction_pct": reaction,
            "window_label": "pre_event_close_to_first_close_after_report_date",
            "evidence_label": "derived_calculation",
            "source_id": None,
            "interpretation_limit": "Report time is unavailable; this broad close window is context, not an isolated one-day earnings reaction.",
        })
        if len(observations) >= MAX_HISTORICAL_EVENTS:
            break
    return observations


def validate_option_snapshot(row: dict[str, Any], report_day: date) -> dict[str, Any]:
    required = {
        "record_id", "ticker", "event_date", "as_of", "spot", "expiration",
        "atm_call_mid", "atm_put_mid", "currency", "source_type", "source_reference",
        "provider", "rights_confirmed",
    }
    missing = sorted(required - set(row))
    if missing:
        raise ValueError(f"Option snapshot missing fields: {missing}")
    if row.get("source_type") not in ALLOWED_OPTION_SOURCE_TYPES or row.get("rights_confirmed") is not True:
        raise ValueError("Option snapshot requires an approved export with confirmed usage rights")
    for field in ("record_id", "ticker", "event_date", "as_of", "expiration", "source_reference", "provider"):
        if not str(row.get(field) or "").strip():
            raise ValueError(f"Option snapshot requires nonblank {field}")
    as_of = date.fromisoformat(str(row["as_of"]))
    event_day = date.fromisoformat(str(row["event_date"]))
    expiration = date.fromisoformat(str(row["expiration"]))
    if as_of > report_day:
        raise ValueError("Option snapshot as-of is after report date")
    if not (as_of <= event_day <= expiration):
        raise ValueError("Option snapshot must span the earnings event")
    spot = _number(row.get("spot"))
    call = _number(row.get("atm_call_mid"))
    put = _number(row.get("atm_put_mid"))
    if any(value is None or value < 0 for value in (spot, call, put)) or not spot:
        raise ValueError("Option spot and ATM mids must be valid nonnegative numbers")
    days_to_event = (event_day - as_of).days
    days_after_event = (expiration - event_day).days
    event_isolating = days_to_event <= 5 and days_after_event <= 3
    return {
        **row,
        "ticker": str(row["ticker"]).upper(),
        "spot": spot,
        "atm_call_mid": call,
        "atm_put_mid": put,
        "atm_straddle": round(call + put, 6),
        "straddle_pct_of_spot": round((call + put) / spot * 100, 4),
        "days_to_event": days_to_event,
        "days_after_event_in_expiry": days_after_event,
        "event_isolation_status": (
            "event_isolating_tenor_candidate" if event_isolating
            else "expiry_tenor_volatility_context"
        ),
        "evidence_label": "fact_provider_standardized",
        "confidence": "medium" if event_isolating else "low",
        "decision_limit": (
            "No other catalyst-window check is available; treat as an event hurdle candidate, not a forecast."
            if event_isolating
            else "Expiry includes substantial non-event time; do not label this an earnings implied move."
        ),
    }


def load_option_inputs(report_date: str) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    directory = ROOT / "workspace" / "company_option_inputs" / report_date
    if not directory.exists():
        return [], []
    accepted: list[dict[str, Any]] = []
    errors: list[dict[str, Any]] = []
    seen: set[str] = set()
    report_day = date.fromisoformat(report_date)
    for path in sorted(directory.glob("*.json")):
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
            records = payload if isinstance(payload, list) else payload.get("records", [])
        except Exception as exc:
            errors.append({"file": str(path.relative_to(ROOT)), "error": str(exc)})
            continue
        for row in records:
            try:
                if row.get("record_id") in seen:
                    raise ValueError("Duplicate option snapshot ID")
                accepted.append(validate_option_snapshot(row, report_day))
                seen.add(str(row["record_id"]))
            except Exception as exc:
                errors.append({
                    "file": str(path.relative_to(ROOT)),
                    "record_id": row.get("record_id"),
                    "error": str(exc),
                })
    return accepted, errors


def _event_map(events: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {
        str(row.get("candidate_id")): row
        for row in events.get("companies", [])
        if row.get("candidate_id")
    }


def _company_context(
    report_date: str, profile: dict[str, Any], event_gate: dict[str, Any],
    observations: list[dict[str, Any]], option_inputs: list[dict[str, Any]],
    provider_source_id: str | None, collected_at: str,
) -> dict[str, Any]:
    ticker = str(profile.get("identity", {}).get("ticker") or "").upper()
    source_index: list[dict[str, Any]] = []
    if provider_source_id:
        source_index.append({
            "source_id": provider_source_id,
            "source_name": f"Alpha Vantage {ticker} EARNINGS and TIME_SERIES_DAILY",
            "source_type": "provider",
            "owner_or_provider": "Alpha Vantage",
            "as_of_date": report_date,
            "retrieved_at": collected_at,
            "period_covered": "quarterly earnings history and recent 100-session raw daily prices",
            "source_location": ALPHA_VANTAGE_DOCS_URL,
            "freshness_status": "current_provider_pull",
            "notes": "Raw unadjusted closes and provider-standardized EPS history.",
        })
        for row in observations:
            row["source_id"] = provider_source_id
    confirmed_event = (event_gate.get("selected_event") or {}).get("event_date")
    matching_options = [
        row for row in option_inputs
        if row.get("ticker") == ticker and confirmed_event and row.get("event_date") == confirmed_event
    ]
    option_context = None
    if matching_options:
        option_context = sorted(matching_options, key=lambda row: str(row.get("as_of")), reverse=True)[0]
        option_source_id = f"OPTION-{ticker}-{option_context['record_id']}"
        option_context = {**option_context, "source_id": option_source_id}
        source_index.append({
            "source_id": option_source_id,
            "source_name": f"{ticker} option snapshot export",
            "source_type": option_context.get("source_type"),
            "owner_or_provider": option_context.get("provider"),
            "as_of_date": option_context.get("as_of"),
            "retrieved_at": report_date,
            "period_covered": f"{option_context.get('as_of')} to {option_context.get('expiration')}",
            "source_location": option_context.get("source_reference"),
            "freshness_status": "as_of_labeled_snapshot",
            "notes": option_context.get("decision_limit"),
        })
    reactions = [abs(float(row["reaction_pct"])) for row in observations]
    if len(reactions) >= 2:
        history_status = "broad_window_history_available"
        median_abs = round(median(reactions), 4)
    elif observations:
        history_status = "single_observation_insufficient_history"
        median_abs = None
    else:
        history_status = "no_joinable_recent_history"
        median_abs = None
    return {
        "candidate_id": profile.get("candidate_id"),
        "ticker": ticker,
        "company_name": profile.get("identity", {}).get("company_name"),
        "historical_reaction_status": history_status,
        "historical_reactions": observations,
        "historical_observation_count": len(observations),
        "median_absolute_reaction_pct": median_abs,
        "reaction_window_definition": "Close before reported date to first trading close after reported date; raw unadjusted prices.",
        "option_context": option_context,
        "implied_move_status": (
            "event_hurdle_candidate_not_forecast"
            if option_context and option_context.get("event_isolation_status") == "event_isolating_tenor_candidate"
            else "expiry_tenor_volatility_context"
            if option_context else "not_collected"
        ),
        "source_index": source_index,
        "readiness": "reaction_context_partial_not_trade_ready",
        "decision_limit": "Historical windows and option tenor are context only; they do not predict direction or justify a position action.",
    }


def collect_company_earnings_reaction_context(
    report_date: str, tearsheets: dict[str, Any], earnings_events: dict[str, Any], api_key: str,
    fetcher: Callable[[str, str, str], dict[str, Any]] = fetch_alpha_vantage,
    sleeper: Callable[[float], None] = time.sleep,
    delay_seconds: float = 0.0,
    option_inputs: list[dict[str, Any]] | None = None,
    option_input_errors: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    profiles = tearsheets.get("profiles", [])[:MAX_REACTION_COMPANIES]
    events = _event_map(earnings_events)
    collected_at = datetime.now(timezone.utc).isoformat()
    request_count = 0
    errors: list[dict[str, Any]] = []
    companies: list[dict[str, Any]] = []
    for profile in profiles:
        ticker = str(profile.get("identity", {}).get("ticker") or "").upper()
        observations: list[dict[str, Any]] = []
        source_id = None
        if api_key:
            try:
                if request_count and delay_seconds > 0:
                    sleeper(delay_seconds)
                request_count += 1
                earnings = fetcher("EARNINGS", ticker, api_key)
                error = _provider_error(earnings)
                if error:
                    raise ValueError(error)
                if request_count and delay_seconds > 0:
                    sleeper(delay_seconds)
                request_count += 1
                daily = fetcher("TIME_SERIES_DAILY", ticker, api_key)
                error = _provider_error(daily)
                if error:
                    raise ValueError(error)
                observations = _historical_reactions(earnings, daily, date.fromisoformat(report_date))
                source_id = f"alpha_vantage:{ticker}:earnings_daily_reaction"
            except Exception as exc:
                errors.append({"ticker": ticker, "error": str(exc)})
        companies.append(_company_context(
            report_date, profile, events.get(str(profile.get("candidate_id")), {}), observations,
            option_inputs or [], source_id, collected_at,
        ))
    if not profiles:
        status = "no_company_profiles"
    elif not api_key and not option_inputs:
        status = "missing_provider_key_and_option_inputs"
    elif errors and any(row["historical_reactions"] for row in companies):
        status = "partial"
    elif errors:
        status = "provider_failed_option_gate_still_applied"
    else:
        status = "available_or_bounded_gaps"
    result = {
        "schema_version": SCHEMA_VERSION,
        "report_date": report_date,
        "collected_at": collected_at,
        "collection_status": status,
        "company_count": len(companies),
        "request_count": request_count,
        "max_provider_requests": MAX_PROVIDER_REQUESTS,
        "companies": companies,
        "provider_errors": errors,
        "option_input_errors": option_input_errors or [],
        "methodology": {
            "maximum_companies": MAX_REACTION_COMPANIES,
            "provider_functions": ["EARNINGS", "TIME_SERIES_DAILY"],
            "raw_unadjusted_prices": True,
            "historical_window_is_not_isolated_reaction": True,
            "live_options_api_used": False,
            "event_isolating_option_rule": "as_of within 5 days before event and expiry within 3 days after event",
            "directional_forecast_allowed": False,
        },
        "posture": "reaction_context_not_trade_or_direction_forecast",
    }
    validate_company_earnings_reaction_context(result)
    return result


def validate_company_earnings_reaction_context(payload: dict[str, Any]) -> None:
    if payload.get("schema_version") != SCHEMA_VERSION:
        raise ValueError("Unexpected earnings reaction context schema")
    if int(payload.get("company_count", -1)) != len(payload.get("companies", [])):
        raise ValueError("Company count does not match reaction contexts")
    if int(payload.get("request_count", 0)) > MAX_PROVIDER_REQUESTS:
        raise ValueError("Reaction context exceeds provider request budget")
    for company in payload.get("companies", []):
        source_ids = {row.get("source_id") for row in company.get("source_index", [])}
        for row in company.get("historical_reactions", []):
            if row.get("source_id") not in source_ids or row.get("evidence_label") != "derived_calculation":
                raise ValueError("Historical reaction requires provider lineage and derived labeling")
            if not row.get("window_start") or not row.get("window_end") or row.get("reaction_pct") is None:
                raise ValueError("Historical reaction requires an explicit price window and result")
            if row.get("window_label") != "pre_event_close_to_first_close_after_report_date":
                raise ValueError("Historical reaction cannot be presented as an isolated one-day move")
        option = company.get("option_context")
        if option:
            if option.get("source_id") not in source_ids or not option.get("as_of"):
                raise ValueError("Option context requires source lineage and freeze time")
            if company.get("implied_move_status") == "event_hurdle_candidate_not_forecast" and option.get("event_isolation_status") != "event_isolating_tenor_candidate":
                raise ValueError("Only event-isolating tenor can become an event hurdle candidate")
            if option.get("event_isolation_status") == "expiry_tenor_volatility_context" and company.get("implied_move_status") != "expiry_tenor_volatility_context":
                raise ValueError("Broad option expiry must remain tenor volatility context")
        if company.get("readiness") == "trade_ready":
            raise ValueError("Reaction context cannot become trade ready")


def main() -> None:
    parser = argparse.ArgumentParser(description="Collect bounded earnings reaction and option-tenor context")
    parser.add_argument("--date", required=True)
    parser.add_argument("--tearsheets-file")
    parser.add_argument("--earnings-events-file")
    parser.add_argument("--output-file")
    args = parser.parse_args()
    load_dotenv()
    tearsheets_path = root_path(
        args.tearsheets_file,
        ROOT / "workspace" / "company_tearsheets" / args.date / "company_tearsheets.json",
    )
    events_path = root_path(
        args.earnings_events_file,
        ROOT / "workspace" / "company_earnings_events" / args.date / "company_earnings_events.json",
    )
    for label, path in (("Company tearsheets", tearsheets_path), ("Company earnings events", events_path)):
        if not path.exists():
            raise SystemExit(f"{label} does not exist: {path}")
    option_inputs, option_errors = load_option_inputs(args.date)
    payload = collect_company_earnings_reaction_context(
        args.date,
        json.loads(tearsheets_path.read_text(encoding="utf-8")),
        json.loads(events_path.read_text(encoding="utf-8")),
        os.getenv("ALPHAVANTAGE_API_KEY", "").strip(),
        delay_seconds=float(os.getenv("ALPHAVANTAGE_REQUEST_DELAY_SECONDS", "0")),
        option_inputs=option_inputs,
        option_input_errors=option_errors,
    )
    output = root_path(
        args.output_file,
        ROOT / "workspace" / "company_earnings_reaction_context" / args.date / "company_earnings_reaction_context.json",
    )
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Company earnings reaction context saved: {output.relative_to(ROOT)}")
    print(
        f"Company earnings reaction status: {payload['collection_status']} | "
        f"companies={payload['company_count']} | requests={payload['request_count']}"
    )


if __name__ == "__main__":
    main()
