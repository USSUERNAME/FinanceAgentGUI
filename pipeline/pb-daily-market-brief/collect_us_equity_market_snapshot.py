"""Build a bounded, authorized U.S. market snapshot from existing and supplemental data."""

from __future__ import annotations

import argparse
import json
import os
import time
from datetime import date
from pathlib import Path
from typing import Any, Callable
from urllib.parse import urlencode

from build_us_equity_universe import normalize_ticker, root_path
from collectors.common import ROOT, get_json, load_dotenv
from collectors.alpaca_market import (
    ALPACA_DOCUMENTATION_URL,
    fetch_daily_series_batch,
)
from screen_us_equity_candidates import (
    MARKET_INPUT_SCHEMA_VERSION,
    validate_market_input,
)
from us_market_panel import CORE_MARKET_BENCHMARKS

SOURCE_URL = "https://www.alphavantage.co/documentation/"
RIGHTS_LABEL = "provider_permitted_internal_research"
DEFAULT_REQUEST_BUDGET = 7
DEFAULT_MAX_EVENT_SECURITIES = 2
DEFAULT_MAX_SCREEN_SECURITIES = 650
DEFAULT_ALPACA_FEED = "iex"

# Two breadth proxies and at least six sector ETFs make the current deterministic
# market-structure classifier useful even when the full 19-ticker panel is absent.
SUPPLEMENTAL_BENCHMARK_PRIORITY = [
    "RSP",
    "MDY",
    "XLC",
    "XLY",
    "XLP",
    "IWF",
    "IWD",
    "MTUM",
    "USMV",
    "XLV",
    "XLI",
    "XLB",
    "XLRE",
    "XLU",
]

SECTOR_ETF_BY_SECTOR_ID = {
    "semiconductors_ai_compute": "SMH",
    "electric_vehicles_autonomy": "XLY",
    "cloud_saas_cybersecurity": "XLK",
    "banks_capital_markets": "XLF",
    "energy_oil_gas": "XLE",
    "healthcare_biotech": "XLV",
    "industrials_automation": "XLI",
    "materials_chemicals": "XLB",
    "consumer_discretionary": "XLY",
    "consumer_staples": "XLP",
    "communications_media": "XLC",
    "utilities_power_grid": "XLU",
    "real_estate_reits": "XLRE",
}


def _number(value: Any) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def reference_close(close: float, return_pct: Any) -> float | None:
    value = _number(return_pct)
    denominator = 1 + value / 100 if value is not None else None
    if denominator in {None, 0}:
        return None
    return round(close / denominator, 8)


def benchmark_rows_from_etf_metrics(payload: dict[str, Any]) -> list[dict[str, Any]]:
    """Convert the already-collected ETF output into the market-input contract."""
    result = []
    for item in payload.get("items", []):
        ticker = normalize_ticker(item.get("ticker"))
        close = _number(item.get("close"))
        if not ticker or close is None or close <= 0:
            continue
        previous = _number(item.get("previous_close"))
        five_day = _number(item.get("close_5_sessions_ago"))
        twenty_day = _number(item.get("close_20_sessions_ago"))
        row = {
            "ticker": ticker,
            "as_of": item.get("as_of"),
            "close": close,
            "previous_close": previous or reference_close(close, item.get("return_1d_pct")),
            "close_5_sessions_ago": five_day or reference_close(close, item.get("return_5d_pct")),
            "close_20_sessions_ago": twenty_day or reference_close(close, item.get("return_20d_pct")),
            "lineage": "reused_daily_etf_metrics",
        }
        if row["previous_close"] and row["close_5_sessions_ago"] and row["close_20_sessions_ago"]:
            result.append(row)
    return result


def event_security_plan(
    universe: dict[str, Any],
    maximum: int = DEFAULT_MAX_EVENT_SECURITIES,
) -> list[dict[str, Any]]:
    result = []
    for security in universe.get("securities", []):
        if "current_sec_filing" not in security.get("selection_reasons", []):
            continue
        ticker = normalize_ticker(security.get("ticker"))
        if not ticker:
            continue
        sector_etf = next(
            (
                SECTOR_ETF_BY_SECTOR_ID[sector_id]
                for sector_id in security.get("sector_ids", [])
                if sector_id in SECTOR_ETF_BY_SECTOR_ID
            ),
            None,
        )
        result.append({
            "kind": "security",
            "ticker": ticker,
            "company_name": security.get("company_name"),
            "sector_etf": sector_etf,
        })
        if len(result) >= maximum:
            break
    return result


def supplemental_request_plan(
    universe: dict[str, Any],
    existing_benchmarks: list[dict[str, Any]],
    request_budget: int,
    maximum_event_securities: int = DEFAULT_MAX_EVENT_SECURITIES,
) -> list[dict[str, Any]]:
    """Prioritize current SEC events, breadth, then missing sector coverage."""
    if request_budget <= 0:
        return []
    existing = {row["ticker"] for row in existing_benchmarks}
    plan = event_security_plan(universe, maximum_event_securities)
    planned_tickers = {row["ticker"] for row in plan}
    for ticker in SUPPLEMENTAL_BENCHMARK_PRIORITY:
        if len(plan) >= request_budget:
            break
        if ticker in existing or ticker in planned_tickers:
            continue
        plan.append({"kind": "benchmark", "ticker": ticker})
        planned_tickers.add(ticker)
    return plan[:request_budget]


def alpaca_batch_request_plan(
    universe: dict[str, Any],
    existing_benchmarks: list[dict[str, Any]],
    maximum_event_securities: int = DEFAULT_MAX_EVENT_SECURITIES,
    maximum_screen_securities: int = DEFAULT_MAX_SCREEN_SECURITIES,
) -> list[dict[str, Any]]:
    """Request the market panel plus the bounded authorized equity universe."""
    existing = {row["ticker"] for row in existing_benchmarks}
    plan = [
        {"kind": "benchmark", "ticker": ticker}
        for ticker in CORE_MARKET_BENCHMARKS
        if ticker not in existing
    ]
    planned = {row["ticker"] for row in plan} | existing
    for request in event_security_plan(universe, maximum_event_securities):
        if request["ticker"] in planned:
            continue
        plan.append(request)
        planned.add(request["ticker"])
    screening_rows = sorted(
        (
            security
            for security in universe.get("securities", [])
            if normalize_ticker(security.get("ticker"))
        ),
        key=lambda security: (
            0
            if "verified_index_membership" in security.get("selection_reasons", [])
            else 1,
            0
            if "configured_watchlist" in security.get("selection_reasons", [])
            else 1,
            normalize_ticker(security.get("ticker")),
        ),
    )
    screening_count = 0
    for security in screening_rows:
        if screening_count >= max(int(maximum_screen_securities), 0):
            break
        ticker = normalize_ticker(security.get("ticker"))
        if ticker in planned:
            continue
        sector_etf = next(
            (
                SECTOR_ETF_BY_SECTOR_ID[sector_id]
                for sector_id in security.get("sector_ids", [])
                if sector_id in SECTOR_ETF_BY_SECTOR_ID
            ),
            None,
        )
        plan.append({
            "kind": "security",
            "ticker": ticker,
            "company_name": security.get("company_name"),
            "sector_etf": sector_etf,
        })
        planned.add(ticker)
        screening_count += 1
    return plan


def fetch_daily_series(ticker: str, api_key: str) -> list[dict[str, Any]]:
    query = urlencode({
        "function": "TIME_SERIES_DAILY",
        "symbol": ticker,
        "outputsize": "compact",
        "apikey": api_key,
    })
    payload = get_json(f"https://www.alphavantage.co/query?{query}")
    if payload.get("Information") or payload.get("Note") or payload.get("Error Message"):
        raise RuntimeError(f"{ticker}: provider limit or response error")
    values = []
    for day, row in payload.get("Time Series (Daily)", {}).items():
        values.append({
            "date": date.fromisoformat(day),
            "close": float(row["4. close"]),
            "volume": float(row["5. volume"]),
        })
    values.sort(key=lambda row: row["date"])
    if len(values) < 21:
        raise RuntimeError(f"{ticker}: insufficient daily observations")
    return values[-63:]


def market_row(
    request: dict[str, Any],
    series: list[dict[str, Any]],
) -> dict[str, Any]:
    volumes = [float(row["volume"]) for row in series[-20:]]
    result = {
        "ticker": request["ticker"],
        "as_of": series[-1]["date"].isoformat(),
        "close": series[-1]["close"],
        "previous_close": series[-2]["close"],
        "close_5_sessions_ago": series[-6]["close"],
        "close_20_sessions_ago": series[-21]["close"],
        "lineage": "supplemental_alpha_vantage_daily",
    }
    if request["kind"] == "security":
        result.update({
            "company_name": request.get("company_name"),
            "sector_etf": request.get("sector_etf"),
            "volume": series[-1]["volume"],
            "avg_volume_20d": sum(volumes) / len(volumes),
        })
    return result


def collect_market_snapshot(
    report_date: str,
    universe: dict[str, Any],
    etf_metrics: dict[str, Any],
    api_key: str,
    *,
    request_budget: int = DEFAULT_REQUEST_BUDGET,
    maximum_event_securities: int = DEFAULT_MAX_EVENT_SECURITIES,
    maximum_screen_securities: int = DEFAULT_MAX_SCREEN_SECURITIES,
    delay_seconds: float = 0,
    fetcher: Callable[[str, str], list[dict[str, Any]]] = fetch_daily_series,
    alpaca_api_key_id: str = "",
    alpaca_secret_key: str = "",
    alpaca_feed: str = DEFAULT_ALPACA_FEED,
    alpaca_fetcher: Callable[..., dict[str, list[dict[str, Any]]]] = fetch_daily_series_batch,
) -> dict[str, Any]:
    benchmarks = benchmark_rows_from_etf_metrics(etf_metrics)
    securities: list[dict[str, Any]] = []
    errors = []
    alpaca_plan = alpaca_batch_request_plan(
        universe,
        benchmarks,
        maximum_event_securities,
        maximum_screen_securities,
    )
    alpaca_rows: dict[str, list[dict[str, Any]]] = {}
    alpaca_used = False
    if alpaca_plan and alpaca_api_key_id and alpaca_secret_key:
        try:
            alpaca_rows = alpaca_fetcher(
                [request["ticker"] for request in alpaca_plan],
                alpaca_api_key_id,
                alpaca_secret_key,
                report_date,
                feed=alpaca_feed,
            )
            for request in alpaca_plan:
                series = alpaca_rows.get(request["ticker"]) or []
                if len(series) < 21:
                    continue
                row = market_row(request, series)
                row["lineage"] = f"alpaca_{alpaca_feed}_raw_daily"
                if request["kind"] == "benchmark":
                    benchmarks.append(row)
                else:
                    securities.append(row)
            alpaca_used = bool(alpaca_rows)
        except Exception as exc:
            errors.append({
                "ticker": None,
                "provider": "alpaca",
                "error_type": type(exc).__name__,
            })

    plan = supplemental_request_plan(
        universe,
        benchmarks,
        max(request_budget, 0),
        maximum_event_securities,
    )
    available_tickers = {
        row["ticker"]
        for row in [*benchmarks, *securities]
    }
    plan = [request for request in plan if request["ticker"] not in available_tickers]
    request_count = 0
    if api_key:
        for index, request in enumerate(plan):
            try:
                row = market_row(request, fetcher(request["ticker"], api_key))
                if request["kind"] == "benchmark":
                    benchmarks.append(row)
                else:
                    securities.append(row)
            except Exception as exc:
                errors.append({
                    "ticker": request["ticker"],
                    "error_type": type(exc).__name__,
                })
            request_count += 1
            if index < len(plan) - 1 and delay_seconds > 0:
                time.sleep(delay_seconds)
    elif plan:
        errors.append({"ticker": None, "error_type": "missing_api_key"})

    all_rows = [*benchmarks, *securities]
    as_of_values = [
        str(row.get("as_of"))
        for row in all_rows
        if row.get("as_of")
    ]
    if not as_of_values:
        raise ValueError("No reusable or supplemental U.S. market rows are available")
    benchmark_tickers = {row["ticker"] for row in benchmarks}
    required_tickers = set(CORE_MARKET_BENCHMARKS)
    missing_required = sorted(required_tickers - benchmark_tickers)
    expected_event_tickers = {
        row["ticker"]
        for row in event_security_plan(universe, maximum_event_securities)
    }
    available_security_tickers = {row["ticker"] for row in securities}
    missing_event_tickers = sorted(expected_event_tickers - available_security_tickers)
    requested_tickers = [row["ticker"] for row in plan]
    provider_names = ["Alpha Vantage TIME_SERIES_DAILY"]
    source_url = SOURCE_URL
    if alpaca_used:
        provider_names.insert(0, f"Alpaca Historical Bars ({alpaca_feed})")
        source_url = ALPACA_DOCUMENTATION_URL
    payload = {
        "schema_version": MARKET_INPUT_SCHEMA_VERSION,
        "report_date": report_date,
        "source_provider": " + ".join(provider_names),
        "source_url": source_url,
        "source_grade": "B",
        "rights_label": RIGHTS_LABEL,
        "as_of": min(as_of_values),
        "market_cutoff": "official_close",
        "benchmarks": sorted(benchmarks, key=lambda row: row["ticker"]),
        "securities": sorted(securities, key=lambda row: row["ticker"]),
        "collection_status": (
            "complete_for_plan"
            if not errors and not missing_event_tickers
            else "partial"
        ),
        "collection": {
            "request_budget": max(request_budget, 0),
            "request_count": request_count,
            "requested_tickers": requested_tickers,
            "alpaca_batch_enabled": bool(alpaca_api_key_id and alpaca_secret_key),
            "alpaca_feed": alpaca_feed if alpaca_api_key_id and alpaca_secret_key else None,
            "alpaca_configuration_status": (
                "ready"
                if alpaca_api_key_id and alpaca_secret_key
                else "missing_credentials"
            ),
            "alpaca_requested_tickers": [row["ticker"] for row in alpaca_plan],
            "alpaca_available_tickers": sorted(alpaca_rows),
            "screening_security_limit": max(int(maximum_screen_securities), 0),
            "screening_security_requested_count": sum(
                request["kind"] == "security"
                for request in alpaca_plan
            ),
            "reused_benchmark_count": len(benchmark_rows_from_etf_metrics(etf_metrics)),
            "available_benchmark_count": len(benchmarks),
            "required_benchmark_count": len(required_tickers),
            "available_required_benchmark_count": len(required_tickers & benchmark_tickers),
            "missing_required_benchmarks": missing_required,
            "market_internals_ready": not missing_required,
            "available_security_count": len(securities),
            "missing_event_securities": missing_event_tickers,
            "missing_priority_benchmarks": [
                ticker
                for ticker in SUPPLEMENTAL_BENCHMARK_PRIORITY
                if ticker not in benchmark_tickers
            ],
            "errors": errors,
        },
        "lineage_note": (
            "Derived close and volume fields only. Existing daily ETF metrics are reused; "
            "Alpaca multi-symbol raw bars fill the required market panel when authorized; "
            "raw provider time series are not redistributed."
        ),
        "posture": "research_input_not_investment_recommendation",
    }
    validate_market_input(payload, report_date)
    return payload


def main() -> None:
    parser = argparse.ArgumentParser(description="Collect a bounded U.S. market snapshot")
    parser.add_argument("--date", required=True)
    parser.add_argument("--universe-file")
    parser.add_argument("--etf-metrics-file")
    parser.add_argument("--output-file")
    parser.add_argument("--request-budget", type=int)
    args = parser.parse_args()
    load_dotenv()
    universe_path = root_path(
        args.universe_file,
        ROOT / "workspace" / "us_equity_universe" / args.date / "us_equity_universe.json",
    )
    etf_path = root_path(
        args.etf_metrics_file,
        ROOT / "workspace" / "market_data" / args.date / "etf_metrics.json",
    )
    if not universe_path.exists() or not etf_path.exists():
        raise SystemExit("U.S. equity universe and ETF metrics are required")
    request_budget = (
        args.request_budget
        if args.request_budget is not None
        else int(os.getenv("US_MARKET_DATA_REQUEST_BUDGET", str(DEFAULT_REQUEST_BUDGET)))
    )
    payload = collect_market_snapshot(
        args.date,
        json.loads(universe_path.read_text(encoding="utf-8")),
        json.loads(etf_path.read_text(encoding="utf-8")),
        os.getenv("ALPHAVANTAGE_API_KEY", "").strip(),
        request_budget=request_budget,
        maximum_event_securities=int(os.getenv(
            "US_MARKET_DATA_MAX_EVENT_SECURITIES",
            str(DEFAULT_MAX_EVENT_SECURITIES),
        )),
        maximum_screen_securities=int(os.getenv(
            "US_MARKET_DATA_MAX_SCREEN_SECURITIES",
            str(DEFAULT_MAX_SCREEN_SECURITIES),
        )),
        delay_seconds=float(os.getenv("ALPHAVANTAGE_REQUEST_DELAY_SECONDS", "13")),
        alpaca_api_key_id=(
            os.getenv("APCA_API_KEY_ID", "").strip()
            or os.getenv("ALPACA_API_KEY", "").strip()
        ),
        alpaca_secret_key=(
            os.getenv("APCA_API_SECRET_KEY", "").strip()
            or os.getenv("ALPACA_SECRET_KEY", "").strip()
        ),
        alpaca_feed=os.getenv(
            "ALPACA_MARKET_DATA_FEED",
            DEFAULT_ALPACA_FEED,
        ).strip().lower(),
    )
    output = root_path(
        args.output_file,
        ROOT / "workspace" / "us_equity_market_inputs" / args.date / "market_snapshot.json",
    )
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"U.S. equity market snapshot saved: {output.relative_to(ROOT)}")
    print(
        f"U.S. equity market snapshot status: {payload['collection_status']} | "
        f"benchmarks={len(payload['benchmarks'])} | securities={len(payload['securities'])} | "
        f"required={payload['collection']['available_required_benchmark_count']}/"
        f"{payload['collection']['required_benchmark_count']} | "
        f"fallback_requests={payload['collection']['request_count']}"
    )


if __name__ == "__main__":
    main()
