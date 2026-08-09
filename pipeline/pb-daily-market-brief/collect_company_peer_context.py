"""Collect a bounded provider snapshot for manually reviewed watchlist peers."""

from __future__ import annotations

import argparse
import copy
import json
import os
import time
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any, Callable

from collectors.common import ROOT, load_dotenv
from collect_company_market_context import (
    ALPHA_VANTAGE_DOCS_URL,
    DEFAULT_MAX_CANDIDATES,
    _number,
    _provider_error,
    eligible_candidates,
    fetch_alpha_vantage,
    root_path,
)

SCHEMA_VERSION = "company_peer_context.v1"
REGISTRY_PATH = ROOT / "company_peer_registry.json"
USABLE_ROLES = {"core_peer", "secondary_peer"}
ALLOWED_ROLES = USABLE_ROLES | {"negative_peer", "not_clean_comp", "excluded_close_peer"}
MAX_CACHED_PROFILE_AGE_DAYS = 3


def load_peer_registry(path: Path = REGISTRY_PATH) -> dict[str, Any]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    validate_peer_registry(payload)
    return payload


def validate_peer_registry(payload: dict[str, Any]) -> None:
    if payload.get("schema_version") != "company_peer_registry.v1":
        raise ValueError("Unexpected company peer registry schema")
    targets: set[tuple[str, str]] = set()
    for row in payload.get("target_peer_sets", []):
        key = (str(row.get("sector_id")), str(row.get("target_ticker")).upper())
        if key in targets:
            raise ValueError(f"Duplicate target peer set: {key}")
        targets.add(key)
        peer_tickers: set[str] = set()
        for peer in row.get("peers", []):
            ticker = str(peer.get("ticker") or "").upper()
            if not ticker or ticker == key[1] or ticker in peer_tickers:
                raise ValueError(f"Invalid or duplicate peer ticker for {key}")
            peer_tickers.add(ticker)
            if peer.get("role") not in ALLOWED_ROLES:
                raise ValueError(f"Unsupported peer role for {ticker}")
            if not str(peer.get("rationale") or "").strip():
                raise ValueError(f"Peer rationale is required for {ticker}")
        usable = [peer for peer in row.get("peers", []) if peer.get("role") in USABLE_ROLES]
        if len(usable) < int(payload.get("minimum_usable_peers", 2)):
            raise ValueError(f"Target peer set needs at least two usable peers: {key}")


def _registry_map(registry: dict[str, Any]) -> dict[tuple[str, str], dict[str, Any]]:
    return {
        (str(row["sector_id"]), str(row["target_ticker"]).upper()): row
        for row in registry.get("target_peer_sets", [])
    }


def plan_peer_requests(
    queue: dict[str, Any], registry: dict[str, Any], max_requests: int,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]]]:
    candidates, _ = eligible_candidates(queue, max_candidates=DEFAULT_MAX_CANDIDATES)
    registry_rows = _registry_map(registry)
    requests: list[dict[str, Any]] = []
    target_sets: list[dict[str, Any]] = []
    skipped: list[dict[str, Any]] = []
    planned: set[str] = set()
    minimum = int(registry["minimum_usable_peers"])
    for candidate in candidates:
        key = (str(candidate.get("sector_id")), str(candidate.get("ticker")).upper())
        configured = registry_rows.get(key)
        if not configured:
            skipped.append({
                "candidate_id": candidate.get("candidate_id"),
                "ticker": candidate.get("ticker"),
                "status": "peer_set_not_configured",
            })
            continue
        usable = [peer for peer in configured["peers"] if peer["role"] in USABLE_ROLES]
        selected: list[dict[str, Any]] = []
        for peer in usable:
            ticker = peer["ticker"].upper()
            if ticker not in planned and len(planned) >= max_requests:
                continue
            selected.append({**peer, "ticker": ticker})
            if ticker not in planned:
                planned.add(ticker)
                requests.append({**peer, "ticker": ticker})
            if len(selected) >= minimum:
                break
        exclusions = [peer for peer in configured["peers"] if peer["role"] not in USABLE_ROLES]
        target_sets.append({
            "candidate_id": candidate.get("candidate_id"),
            "sector_id": candidate.get("sector_id"),
            "target_ticker": candidate.get("ticker"),
            "selected_peers": selected,
            "excluded_or_context_only_peers": exclusions,
            "planning_status": "planned" if len(selected) >= minimum else "insufficient_request_budget",
        })
    return requests, target_sets, skipped


def normalize_peer_profile(peer: dict[str, Any], overview: dict[str, Any], collected_at: str) -> dict[str, Any]:
    multiples = {
        "trailing_pe": _number(overview.get("TrailingPE") or overview.get("PERatio")),
        "forward_pe": _number(overview.get("ForwardPE")),
        "price_to_sales_ttm": _number(overview.get("PriceToSalesRatioTTM")),
        "price_to_book": _number(overview.get("PriceToBookRatio")),
        "ev_to_revenue": _number(overview.get("EVToRevenue")),
        "ev_to_ebitda": _number(overview.get("EVToEBITDA")),
    }
    return {
        "ticker": peer["ticker"],
        "company_name": peer.get("company_name"),
        "market": "US",
        "role": peer.get("role"),
        "selection_rationale": peer.get("rationale"),
        "selection_evidence_label": "analyst_assumption_needs_review",
        "exchange": overview.get("Exchange") or None,
        "currency": overview.get("Currency") or None,
        "market_cap": _number(overview.get("MarketCapitalization")),
        "sector": overview.get("Sector") or None,
        "industry": overview.get("Industry") or None,
        "valuation_multiples": multiples,
        "multiple_count": sum(value is not None for value in multiples.values()),
        "source": {
            "provider": "Alpha Vantage",
            "function": "OVERVIEW",
            "source_url": ALPHA_VANTAGE_DOCS_URL,
            "retrieved_at": collected_at,
            "evidence_label": "fact_provider_standardized",
            "freshness_status": "latest_company_overview_unknown_exact_as_of",
        },
    }


def load_recent_peer_profiles(
    report_date: str,
    history_root: Path,
    max_age_days: int = MAX_CACHED_PROFILE_AGE_DAYS,
) -> dict[str, dict[str, Any]]:
    target_date = date.fromisoformat(report_date)
    cached: dict[str, dict[str, Any]] = {}
    if not history_root.exists():
        return cached
    dated_paths: list[tuple[date, Path]] = []
    for directory in history_root.iterdir():
        if not directory.is_dir():
            continue
        try:
            source_date = date.fromisoformat(directory.name)
        except ValueError:
            continue
        age = (target_date - source_date).days
        if 0 <= age <= max_age_days:
            path = directory / "company_peer_context.json"
            if path.exists():
                dated_paths.append((source_date, path))
    for source_date, path in sorted(dated_paths, reverse=True):
        try:
            payload = json.loads(path.read_text(encoding="utf-8-sig"))
        except (OSError, json.JSONDecodeError):
            continue
        age = (target_date - source_date).days
        for row in payload.get("peer_profiles", []):
            ticker = str(row.get("ticker") or "").upper()
            if not ticker or ticker in cached or int(row.get("multiple_count") or 0) <= 0:
                continue
            profile = copy.deepcopy(row)
            profile["cache"] = {
                "status": "reused_recent_profile",
                "source_report_date": source_date.isoformat(),
                "age_calendar_days": age,
                "max_age_calendar_days": max_age_days,
            }
            source = profile.setdefault("source", {})
            source["freshness_status"] = "cached_previous_profile"
            cached[ticker] = profile
    return cached


def collect_company_peer_context(
    report_date: str,
    queue: dict[str, Any],
    registry: dict[str, Any],
    api_key: str,
    fetcher: Callable[[str, str, str], dict[str, Any]] = fetch_alpha_vantage,
    sleeper: Callable[[float], None] = time.sleep,
    delay_seconds: float = 0.0,
    max_requests: int | None = None,
    cached_profiles: dict[str, dict[str, Any]] | None = None,
) -> dict[str, Any]:
    validate_peer_registry(registry)
    request_limit = max_requests or int(registry["maximum_provider_peer_requests"])
    requests, target_sets, skipped = plan_peer_requests(queue, registry, request_limit)
    collected_at = datetime.now(timezone.utc).isoformat()
    profiles: list[dict[str, Any]] = []
    errors: list[dict[str, Any]] = []
    cached_profiles = cached_profiles or {}
    request_count = 0
    if api_key:
        for peer in requests:
            cached = cached_profiles.get(peer["ticker"])
            if cached:
                recovered = copy.deepcopy(cached)
                recovered["role"] = peer.get("role")
                recovered["selection_rationale"] = peer.get("rationale")
                profiles.append(recovered)
                continue
            try:
                if request_count and delay_seconds > 0:
                    sleeper(delay_seconds)
                request_count += 1
                payload = fetcher("OVERVIEW", peer["ticker"], api_key)
                if _provider_error(payload):
                    raise ValueError("provider_notice_or_unavailable_symbol")
                profiles.append(normalize_peer_profile(peer, payload, collected_at))
            except Exception as exc:
                error = {"ticker": peer["ticker"], "error": str(exc)}
                errors.append(error)
    else:
        for peer in requests:
            cached = cached_profiles.get(peer["ticker"])
            if not cached:
                continue
            recovered = copy.deepcopy(cached)
            recovered["role"] = peer.get("role")
            recovered["selection_rationale"] = peer.get("rationale")
            profiles.append(recovered)
    if not requests:
        status = "no_configured_peer_requests"
    elif not api_key and profiles:
        status = "cached_available"
    elif not api_key:
        status = "missing_alpha_vantage_api_key"
    elif profiles and errors:
        status = "partial"
    elif profiles:
        status = "available"
    else:
        status = "failed"
    result = {
        "schema_version": SCHEMA_VERSION,
        "report_date": report_date,
        "collection_status": status,
        "request_count": request_count,
        "request_limit": request_limit,
        "target_peer_sets": target_sets,
        "peer_profiles": profiles,
        "skipped": skipped,
        "errors": errors,
        "methodology": {
            "minimum_usable_peers": int(registry["minimum_usable_peers"]),
            "maximum_target_candidates": DEFAULT_MAX_CANDIDATES,
            "provider_function": "OVERVIEW",
            "provider_documentation_url": ALPHA_VANTAGE_DOCS_URL,
            "peer_selection_posture": "manual_watchlist_needs_primary_business_model_review",
            "cache_max_age_calendar_days": MAX_CACHED_PROFILE_AGE_DAYS,
            "cache_policy": (
                "A recent provider profile may fill a failed request, but its source "
                "date and age remain explicit and it never changes peer selection."
            ),
        },
        "posture": "screening_peer_context_not_selected_valuation_range",
    }
    validate_company_peer_context(result)
    return result


def validate_company_peer_context(payload: dict[str, Any]) -> None:
    if payload.get("schema_version") != SCHEMA_VERSION:
        raise ValueError("Unexpected company peer context schema")
    if int(payload.get("request_count", -1)) > int(payload.get("request_limit", -1)):
        raise ValueError("Peer provider request limit was exceeded")
    tickers: set[str] = set()
    for row in payload.get("peer_profiles", []):
        if row["ticker"] in tickers:
            raise ValueError("Duplicate peer profile")
        tickers.add(row["ticker"])
        if row.get("role") not in USABLE_ROLES:
            raise ValueError("Context-only peer cannot enter the screening benchmark")
        if (row.get("source") or {}).get("source_url") != ALPHA_VANTAGE_DOCS_URL:
            raise ValueError("Peer context must retain provider documentation URL")
        cache = row.get("cache")
        if cache and (
            cache.get("status") != "reused_recent_profile"
            or int(cache.get("age_calendar_days", -1)) < 0
            or int(cache.get("age_calendar_days", -1)) > MAX_CACHED_PROFILE_AGE_DAYS
        ):
            raise ValueError("Cached peer profile is stale or malformed")


def main() -> None:
    parser = argparse.ArgumentParser(description="Collect bounded company peer context")
    parser.add_argument("--date", required=True)
    parser.add_argument("--queue-file")
    parser.add_argument("--registry-file")
    parser.add_argument("--output-file")
    parser.add_argument("--max-requests", type=int)
    args = parser.parse_args()
    load_dotenv()
    queue_path = root_path(
        args.queue_file,
        ROOT / "workspace" / "company_research_queue" / args.date / "company_research_queue.json",
    )
    registry_path = root_path(args.registry_file, REGISTRY_PATH)
    if not queue_path.exists():
        raise SystemExit(f"Company research queue does not exist: {queue_path}")
    history_root = ROOT / "workspace" / "company_peer_context"
    cached_profiles = load_recent_peer_profiles(args.date, history_root)
    payload = collect_company_peer_context(
        args.date,
        json.loads(queue_path.read_text(encoding="utf-8")),
        load_peer_registry(registry_path),
        os.getenv("ALPHAVANTAGE_API_KEY", "").strip(),
        delay_seconds=float(os.getenv("ALPHAVANTAGE_REQUEST_DELAY_SECONDS", "13")),
        max_requests=args.max_requests,
        cached_profiles=cached_profiles,
    )
    output = root_path(
        args.output_file,
        ROOT / "workspace" / "company_peer_context" / args.date / "company_peer_context.json",
    )
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Company peer context saved: {output.relative_to(ROOT)}")
    print(
        f"Company peer context status: {payload['collection_status']} | "
        f"profiles={len(payload['peer_profiles'])} | requests={payload['request_count']}"
    )


if __name__ == "__main__":
    main()
