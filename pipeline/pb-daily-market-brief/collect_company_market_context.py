"""Collect bounded market and valuation context for diligence-ready US companies."""

from __future__ import annotations

import argparse
import json
import os
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable
from urllib.parse import urlencode

from collectors.common import ROOT, get_json, load_dotenv

SCHEMA_VERSION = "company_market_context.v1"
ALPHA_VANTAGE_DOCS_URL = "https://www.alphavantage.co/documentation/"
ALPACA_MARKET_DATA_DOCS_URL = "https://docs.alpaca.markets/docs/about-market-data-api"
DEFAULT_MAX_CANDIDATES = 3


def root_path(value: str | None, default: Path) -> Path:
    path = Path(value) if value else default
    return path if path.is_absolute() else ROOT / path


def _number(value: Any) -> float | None:
    if value in {None, "", ".", "-", "None", "null", "N/A"}:
        return None
    try:
        return float(str(value).replace("%", "").replace(",", ""))
    except (TypeError, ValueError):
        return None


def fetch_alpha_vantage(function: str, ticker: str, api_key: str) -> dict[str, Any]:
    query = urlencode({"function": function, "symbol": ticker, "apikey": api_key})
    return get_json(f"https://www.alphavantage.co/query?{query}")


def eligible_candidates(queue: dict[str, Any], max_candidates: int) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    eligible: list[dict[str, Any]] = []
    skipped: list[dict[str, Any]] = []
    for row in queue.get("candidates", []):
        if row.get("queue_stage") != "valuation_expectations_gated":
            continue
        if str(row.get("market") or "").upper() != "US":
            skipped.append({
                "candidate_id": row.get("candidate_id"),
                "ticker": row.get("ticker"),
                "market": row.get("market"),
                "status": "unsupported_market",
                "reason": "The configured market-context provider route is limited to US candidates.",
            })
            continue
        eligible.append(row)
        if len(eligible) >= max_candidates:
            break
    return eligible, skipped


def _provider_error(payload: dict[str, Any]) -> str | None:
    for key in ("Error Message", "Information", "Note"):
        if payload.get(key):
            return "provider_notice_or_unavailable_symbol"
    return None


def _expectations_signal(candidate: dict[str, Any]) -> dict[str, Any]:
    signal = candidate.get("estimate_signal") or {}
    score = _number(signal.get("score"))
    direction = "not_collected"
    if score is not None:
        direction = "positive" if score >= 60 else "negative" if score <= 40 else "mixed"
    return {
        "direction": direction,
        "score": score,
        "as_of": signal.get("as_of"),
        "source_provider": signal.get("source_provider"),
        "evidence_label": "fact_provider_standardized" if score is not None else "missing_required_source",
        "note": "Direction is a provider-derived revision signal, not a full consensus expectation bar.",
    }


def _fallback_market_map(payload: dict[str, Any] | None) -> dict[str, dict[str, Any]]:
    return {
        str(row.get("ticker") or "").upper(): row
        for row in (payload or {}).get("candidates", [])
        if isinstance(row, dict) and str(row.get("ticker") or "").strip()
    }


def normalize_fallback_company_context(
    candidate: dict[str, Any],
    fallback_candidate: dict[str, Any],
    collected_at: str,
    report_date: str,
) -> dict[str, Any]:
    reaction = fallback_candidate.get("market_reaction") or {}
    price = _number(reaction.get("close"))
    return_1d = _number(reaction.get("return_1d_pct"))
    previous_close = None
    if price is not None and return_1d is not None and return_1d > -100:
        previous_close = round(price / (1 + return_1d / 100), 6)
    price_as_of = (
        ((fallback_candidate.get("market_source") or {}).get("as_of"))
        or fallback_candidate.get("price_as_of")
        or report_date
    )
    status = "partial_unbenchmarked" if price is not None else "missing"
    return {
        "candidate_id": candidate.get("candidate_id"),
        "sector_id": candidate.get("sector_id"),
        "market": candidate.get("market"),
        "ticker": candidate.get("ticker"),
        "company_name": candidate.get("company_name"),
        "context_status": status,
        "security_readiness": (
            "market_context_collected_not_decision_grade"
            if status != "missing" else "not_collected"
        ),
        "market_data": {
            "price": price,
            "currency": "USD" if str(candidate.get("market")).upper() == "US" else None,
            "price_as_of": price_as_of,
            "previous_close": previous_close,
            "change_pct": return_1d,
            "volume": _number(reaction.get("volume")),
            "market_cap": None,
            "exchange": None,
            "evidence_label": "fact_provider_standardized",
        },
        "valuation_context": {
            "trailing_pe": None,
            "forward_pe": None,
            "price_to_sales_ttm": None,
            "price_to_book": None,
            "ev_to_revenue": None,
            "ev_to_ebitda": None,
            "multiple_count": 0,
            "relative_valuation_status": "unbenchmarked",
            "evidence_label": "missing_required_source",
            "note": (
                "Alpaca close and volume were reused after the company-overview "
                "provider failed; valuation multiples remain unavailable."
            ),
        },
        "expectations_context": _expectations_signal(candidate),
        "company_classification": {
            "sector": None,
            "industry": None,
        },
        "source": {
            "source_id": f"alpaca:{candidate.get('ticker')}:candidate_screen_fallback",
            "provider": "Alpaca Historical Bars via US equity candidate screen",
            "functions": ["historical_bars"],
            "source_url": ALPACA_MARKET_DATA_DOCS_URL,
            "source_grade": "B",
            "evidence_label": "fact_provider_standardized",
            "as_of_date": price_as_of,
            "retrieved_at": collected_at,
            "freshness_status": "current_or_latest_close" if price_as_of else "unknown",
            "rights_label": "licensed_api_derived_metrics_only",
        },
        "data_gaps": [
            "Company overview and valuation multiples were unavailable from the primary provider route.",
            "Peer and historical valuation benchmarks are not collected.",
            "A full current consensus expectation bar and company guidance comparison are not collected.",
            "Liquidity benchmark, ownership, short interest, positioning, and factor context are not collected.",
        ],
        "posture": "research_context_not_investment_recommendation",
    }


def normalize_company_context(
    candidate: dict[str, Any], quote_payload: dict[str, Any], overview: dict[str, Any], collected_at: str,
) -> dict[str, Any]:
    quote = quote_payload.get("Global Quote") or {}
    price = _number(quote.get("05. price"))
    price_as_of = quote.get("07. latest trading day") or None
    multiples = {
        "trailing_pe": _number(overview.get("TrailingPE") or overview.get("PERatio")),
        "forward_pe": _number(overview.get("ForwardPE")),
        "price_to_sales_ttm": _number(overview.get("PriceToSalesRatioTTM")),
        "price_to_book": _number(overview.get("PriceToBookRatio")),
        "ev_to_revenue": _number(overview.get("EVToRevenue")),
        "ev_to_ebitda": _number(overview.get("EVToEBITDA")),
    }
    multiple_count = sum(value is not None for value in multiples.values())
    if price is not None and multiple_count:
        status = "available_unbenchmarked"
    elif price is not None or multiple_count:
        status = "partial_unbenchmarked"
    else:
        status = "missing"
    return {
        "candidate_id": candidate.get("candidate_id"),
        "sector_id": candidate.get("sector_id"),
        "market": candidate.get("market"),
        "ticker": candidate.get("ticker"),
        "company_name": candidate.get("company_name"),
        "context_status": status,
        "security_readiness": "market_context_collected_not_decision_grade" if status != "missing" else "not_collected",
        "market_data": {
            "price": price,
            "currency": overview.get("Currency") or None,
            "price_as_of": price_as_of,
            "previous_close": _number(quote.get("08. previous close")),
            "change_pct": _number(quote.get("10. change percent")),
            "volume": _number(quote.get("06. volume")),
            "market_cap": _number(overview.get("MarketCapitalization")),
            "exchange": overview.get("Exchange") or None,
            "evidence_label": "fact_provider_standardized",
        },
        "valuation_context": {
            **multiples,
            "multiple_count": multiple_count,
            "relative_valuation_status": "unbenchmarked",
            "evidence_label": "fact_provider_standardized" if multiple_count else "missing_required_source",
            "note": "Raw provider multiples only; no peer or historical benchmark is attached.",
        },
        "expectations_context": _expectations_signal(candidate),
        "company_classification": {
            "sector": overview.get("Sector") or None,
            "industry": overview.get("Industry") or None,
        },
        "source": {
            "source_id": f"alpha_vantage:{candidate.get('ticker')}:quote_overview",
            "provider": "Alpha Vantage",
            "functions": ["GLOBAL_QUOTE", "OVERVIEW"],
            "source_url": ALPHA_VANTAGE_DOCS_URL,
            "source_grade": "B",
            "evidence_label": "fact_provider_standardized",
            "as_of_date": price_as_of,
            "retrieved_at": collected_at,
            "freshness_status": "current_or_latest_close" if price_as_of else "unknown",
            "rights_label": "licensed_api_derived_metrics_only",
        },
        "data_gaps": [
            "Peer and historical valuation benchmarks are not collected.",
            "A full current consensus expectation bar and company guidance comparison are not collected.",
            "Liquidity benchmark, ownership, short interest, positioning, and factor context are not collected.",
        ],
        "posture": "research_context_not_investment_recommendation",
    }


def collect_company_market_context(
    report_date: str,
    queue: dict[str, Any],
    api_key: str,
    fetcher: Callable[[str, str, str], dict[str, Any]] = fetch_alpha_vantage,
    sleeper: Callable[[float], None] = time.sleep,
    delay_seconds: float = 0.0,
    max_candidates: int = DEFAULT_MAX_CANDIDATES,
    fallback_market: dict[str, Any] | None = None,
) -> dict[str, Any]:
    candidates, skipped = eligible_candidates(queue, max_candidates)
    fallback_by_ticker = _fallback_market_map(fallback_market)
    collected_at = datetime.now(timezone.utc).isoformat()
    contexts: list[dict[str, Any]] = []
    errors: list[dict[str, Any]] = []
    request_count = 0
    if api_key:
        for candidate in candidates:
            payloads: dict[str, dict[str, Any]] = {}
            try:
                for function in ("GLOBAL_QUOTE", "OVERVIEW"):
                    if request_count and delay_seconds > 0:
                        sleeper(delay_seconds)
                    request_count += 1
                    payload = fetcher(function, candidate["ticker"], api_key)
                    provider_error = _provider_error(payload)
                    if provider_error:
                        raise ValueError(provider_error)
                    payloads[function] = payload
                contexts.append(normalize_company_context(
                    candidate, payloads["GLOBAL_QUOTE"], payloads["OVERVIEW"], collected_at,
                ))
            except Exception as exc:
                error = {
                    "candidate_id": candidate.get("candidate_id"),
                    "ticker": candidate.get("ticker"),
                    "error": str(exc),
                }
                fallback = fallback_by_ticker.get(str(candidate.get("ticker") or "").upper())
                if fallback:
                    contexts.append(normalize_fallback_company_context(
                        candidate, fallback, collected_at, report_date,
                    ))
                    error["recovered_by"] = "alpaca_candidate_screen_fallback"
                errors.append(error)
    else:
        for candidate in candidates:
            fallback = fallback_by_ticker.get(str(candidate.get("ticker") or "").upper())
            if fallback:
                contexts.append(normalize_fallback_company_context(
                    candidate, fallback, collected_at, report_date,
                ))
    if not candidates:
        collection_status = "no_eligible_candidates"
    elif not api_key and contexts:
        collection_status = "fallback_available"
    elif not api_key:
        collection_status = "missing_alpha_vantage_api_key"
    elif contexts and errors:
        collection_status = "partial"
    elif contexts:
        collection_status = "available"
    else:
        collection_status = "failed"
    result = {
        "schema_version": SCHEMA_VERSION,
        "report_date": report_date,
        "collection_status": collection_status,
        "eligible_candidate_count": len(candidates),
        "collected_candidate_count": len(contexts),
        "request_count": request_count,
        "max_candidates": max_candidates,
        "contexts": contexts,
        "skipped": skipped,
        "errors": errors,
        "methodology": {
            "eligible_queue_stage": "valuation_expectations_gated",
            "supported_markets": ["US"],
            "relative_valuation_requires_benchmark": True,
            "decision_grade_without_consensus_liquidity_positioning": False,
            "source_url": ALPHA_VANTAGE_DOCS_URL,
            "fallback_source_url": ALPACA_MARKET_DATA_DOCS_URL,
            "fallback_policy": (
                "Reuse the already-collected candidate-screen close and volume only; "
                "never infer missing valuation multiples."
            ),
        },
        "posture": "market_context_only_not_investment_recommendation",
    }
    validate_company_market_context(result)
    return result


def validate_company_market_context(payload: dict[str, Any]) -> None:
    if payload.get("schema_version") != SCHEMA_VERSION:
        raise ValueError("Unexpected company market context schema")
    if int(payload.get("collected_candidate_count", -1)) != len(payload.get("contexts", [])):
        raise ValueError("Collected candidate count does not match contexts")
    for row in payload.get("contexts", []):
        valuation = row.get("valuation_context") or {}
        if valuation.get("relative_valuation_status") != "unbenchmarked":
            raise ValueError("Relative valuation cannot be classified without a benchmark")
        if row.get("security_readiness") == "decision_grade":
            raise ValueError("Raw quote and overview data cannot create decision-grade security research")
        source = row.get("source") or {}
        if source.get("source_url") not in {
            ALPHA_VANTAGE_DOCS_URL,
            ALPACA_MARKET_DATA_DOCS_URL,
        }:
            raise ValueError("Company market context must retain an approved provider documentation URL")
        market = row.get("market_data") or {}
        if row.get("context_status") == "available_unbenchmarked" and (
            market.get("price") is None or not market.get("price_as_of")
        ):
            raise ValueError("Available market context requires a price and as-of date")


def main() -> None:
    parser = argparse.ArgumentParser(description="Collect bounded company market and valuation context")
    parser.add_argument("--date", required=True)
    parser.add_argument("--queue-file")
    parser.add_argument("--fallback-market-file")
    parser.add_argument("--output-file")
    parser.add_argument("--max-candidates", type=int)
    args = parser.parse_args()
    load_dotenv()
    queue_path = root_path(
        args.queue_file,
        ROOT / "workspace" / "company_research_queue" / args.date / "company_research_queue.json",
    )
    if not queue_path.exists():
        raise SystemExit(f"Company research queue does not exist: {queue_path}")
    fallback_market_path = root_path(
        args.fallback_market_file,
        ROOT / "workspace" / "us_equity_candidate_screen" / args.date / "candidate_screen.json",
    )
    fallback_market = (
        json.loads(fallback_market_path.read_text(encoding="utf-8-sig"))
        if fallback_market_path.exists() else {}
    )
    max_candidates = args.max_candidates or int(os.getenv(
        "COMPANY_CONTEXT_MAX_CANDIDATES", str(DEFAULT_MAX_CANDIDATES),
    ))
    payload = collect_company_market_context(
        args.date,
        json.loads(queue_path.read_text(encoding="utf-8")),
        os.getenv("ALPHAVANTAGE_API_KEY", "").strip(),
        fallback_market=fallback_market,
        delay_seconds=float(os.getenv("ALPHAVANTAGE_REQUEST_DELAY_SECONDS", "0")),
        max_candidates=max_candidates,
    )
    output = root_path(
        args.output_file,
        ROOT / "workspace" / "company_market_context" / args.date / "company_market_context.json",
    )
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Company market context saved: {output.relative_to(ROOT)}")
    print(
        f"Company market context status: {payload['collection_status']} | "
        f"collected={payload['collected_candidate_count']}/{payload['eligible_candidate_count']} | "
        f"requests={payload['request_count']}"
    )


if __name__ == "__main__":
    main()
