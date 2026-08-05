"""Combine company, peer, and estimate evidence into a screening-only valuation gate."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from statistics import median
from typing import Any

from collectors.common import ROOT
from collect_company_market_context import _number, root_path

SCHEMA_VERSION = "company_valuation_expectations.v1"
MULTIPLE_ORDER = (
    "forward_pe", "ev_to_ebitda", "price_to_sales_ttm",
    "trailing_pe", "ev_to_revenue", "price_to_book",
)
RELATIVE_STATUSES = {
    "premium_to_watchlist_peer_median",
    "discount_to_watchlist_peer_median",
    "near_watchlist_peer_median",
    "insufficient_usable_peers",
}


def _estimate_map(fundamentals: dict[str, Any]) -> dict[tuple[str, str, str], dict[str, Any]]:
    return {
        (
            str(row.get("sector_id")),
            str(row.get("market")).upper(),
            str(row.get("ticker")).upper(),
        ): row
        for row in fundamentals.get("estimate_observations", [])
    }


def _expectations_bar(context: dict[str, Any], estimate: dict[str, Any] | None) -> dict[str, Any]:
    rows = []
    for row in (estimate or {}).get("rows", []):
        rows.append({
            "horizon": row.get("horizon"),
            "fiscal_period_end": row.get("fiscal_period_end"),
            "eps_estimate_average": _number(row.get("eps_estimate_average")),
            "eps_estimate_30d_ago": _number(row.get("eps_estimate_average_30_days_ago")),
            "eps_revision_pct_30d": _number(row.get("revision_pct")),
            "revision_up_30d": _number(row.get("revision_up_30d")),
            "revision_down_30d": _number(row.get("revision_down_30d")),
            "eps_analyst_count": _number(row.get("eps_estimate_analyst_count")),
            "revenue_estimate_average": _number(row.get("revenue_estimate_average")),
            "revenue_analyst_count": _number(row.get("revenue_estimate_analyst_count")),
            "provider_score": _number(row.get("score")),
        })
    scores = [row["provider_score"] for row in rows if row["provider_score"] is not None]
    if scores:
        score = round(median(scores), 2)
        direction = "positive_revision" if score >= 60 else "negative_revision" if score <= 40 else "mixed_revision"
        status = "third_party_forward_estimates_available"
    else:
        score = _number((context.get("expectations_context") or {}).get("score"))
        direction = "insufficient_detail"
        status = "insufficient_estimate_detail"
    return {
        "status": status,
        "revision_direction": direction,
        "provider_score": score,
        "estimate_as_of": (estimate or {}).get("as_of") or (context.get("expectations_context") or {}).get("as_of"),
        "source_provider": (estimate or {}).get("source_provider") or (context.get("expectations_context") or {}).get("source_provider"),
        "evidence_label": "third_party_forward_estimate" if rows else "missing_required_source",
        "rows": rows,
        "company_guidance_comparison_status": "not_collected",
        "expectation_bar_status": "revision_direction_only_not_full_market_bar",
        "note": "Provider estimates and revision history are not labeled consensus without contributor methodology and a verified estimate-set timestamp.",
    }


def _derived_forward_pe(
    report_date: str,
    context: dict[str, Any],
    estimate: dict[str, Any] | None,
) -> dict[str, Any] | None:
    if _number((context.get("valuation_context") or {}).get("forward_pe")) is not None:
        return None
    price = _number((context.get("market_data") or {}).get("price"))
    if price is None or price <= 0:
        return None
    annual_rows = sorted(
        (
            row
            for row in (estimate or {}).get("rows", [])
            if str(row.get("horizon") or "").lower() == "fiscal year"
            and str(row.get("fiscal_period_end") or "") >= report_date
            and (_number(row.get("eps_estimate_average")) or 0) > 0
        ),
        key=lambda row: str(row.get("fiscal_period_end") or ""),
    )
    if not annual_rows:
        return None
    row = annual_rows[0]
    eps = _number(row.get("eps_estimate_average"))
    if eps is None or eps <= 0:
        return None
    return {
        "metric": "forward_pe",
        "value": round(price / eps, 4),
        "price": price,
        "price_as_of": (context.get("market_data") or {}).get("price_as_of"),
        "eps_estimate": eps,
        "fiscal_period_end": row.get("fiscal_period_end"),
        "estimate_as_of": (estimate or {}).get("as_of"),
        "source_provider": (estimate or {}).get("source_provider"),
        "evidence_label": "derived_screening_calculation",
        "comparability_limit": (
            "Target P/E uses the nearest positive fiscal-year EPS estimate, while "
            "provider peer ForwardPE periods may not align exactly."
        ),
    }


def _valuation_screen(
    context: dict[str, Any], target_set: dict[str, Any] | None, peer_profiles: dict[str, dict[str, Any]], minimum_peers: int,
) -> dict[str, Any]:
    target_values = context.get("valuation_context") or {}
    configured = (target_set or {}).get("selected_peers", [])
    comparisons: list[dict[str, Any]] = []
    for metric in MULTIPLE_ORDER:
        target_value = _number(target_values.get(metric))
        peer_rows = []
        for peer in configured:
            profile = peer_profiles.get(str(peer.get("ticker")).upper())
            value = _number((profile or {}).get("valuation_multiples", {}).get(metric))
            if value is not None and value > 0:
                peer_rows.append({
                    "ticker": peer.get("ticker"),
                    "role": peer.get("role"),
                    "value": value,
                    "selection_rationale": peer.get("rationale"),
                })
        usable = target_value is not None and target_value > 0 and len(peer_rows) >= minimum_peers
        peer_median = round(median(row["value"] for row in peer_rows), 4) if usable else None
        premium_discount = round((target_value / peer_median - 1) * 100, 2) if usable and peer_median else None
        comparisons.append({
            "metric": metric,
            "target_value": target_value,
            "peer_median": peer_median,
            "premium_discount_pct": premium_discount,
            "usable_peer_count": len(peer_rows),
            "minimum_peer_count": minimum_peers,
            "peer_values": peer_rows,
            "status": "available_screening_only" if usable else "insufficient_usable_peers",
        })
    primary = next((row for row in comparisons if row["status"] == "available_screening_only"), None)
    if primary:
        relative = (
            "premium_to_watchlist_peer_median" if primary["premium_discount_pct"] > 10
            else "discount_to_watchlist_peer_median" if primary["premium_discount_pct"] < -10
            else "near_watchlist_peer_median"
        )
    else:
        relative = "insufficient_usable_peers"
    return {
        "status": "screening_available" if primary else "insufficient_peer_data",
        "relative_valuation_status": relative,
        "primary_metric": primary["metric"] if primary else None,
        "primary_premium_discount_pct": primary["premium_discount_pct"] if primary else None,
        "comparisons": comparisons,
        "peer_set_status": (target_set or {}).get("planning_status", "not_configured"),
        "peer_selection_evidence_label": "analyst_assumption_needs_review",
        "historical_valuation_band_status": "not_collected",
        "selected_valuation_range_status": "not_supported",
        "note": "Premium or discount is relative to a small manually configured watchlist peer set; it is not a cheap, expensive, or fair-value conclusion.",
    }


def build_company_valuation_expectations(
    report_date: str,
    market_context: dict[str, Any],
    peer_context: dict[str, Any],
    fundamentals: dict[str, Any],
) -> dict[str, Any]:
    profiles = {str(row["ticker"]).upper(): row for row in peer_context.get("peer_profiles", [])}
    target_sets = {
        str(row.get("candidate_id")): row for row in peer_context.get("target_peer_sets", [])
    }
    estimates = _estimate_map(fundamentals)
    minimum_peers = int((peer_context.get("methodology") or {}).get("minimum_usable_peers", 2))
    rows: list[dict[str, Any]] = []
    for context in market_context.get("contexts", []):
        key = (
            str(context.get("sector_id")),
            str(context.get("market")).upper(),
            str(context.get("ticker")).upper(),
        )
        estimate = estimates.get(key)
        derived_forward_pe = _derived_forward_pe(report_date, context, estimate)
        screen_context = {
            **context,
            "valuation_context": dict(context.get("valuation_context") or {}),
        }
        if derived_forward_pe:
            screen_context["valuation_context"]["forward_pe"] = derived_forward_pe["value"]
        valuation = _valuation_screen(
            screen_context,
            target_sets.get(str(context.get("candidate_id"))),
            profiles,
            minimum_peers,
        )
        expectations = _expectations_bar(context, estimate)
        rows.append({
            "candidate_id": context.get("candidate_id"),
            "sector_id": context.get("sector_id"),
            "market": context.get("market"),
            "ticker": context.get("ticker"),
            "company_name": context.get("company_name"),
            "current_price": (context.get("market_data") or {}).get("price"),
            "price_as_of": (context.get("market_data") or {}).get("price_as_of"),
            "currency": (context.get("market_data") or {}).get("currency"),
            "valuation_screen": valuation,
            "derived_valuation": derived_forward_pe,
            "expectations_bar": expectations,
            "priced_in_status": "not_established",
            "current_price_implication_status": "not_backsolved",
            "security_readiness": "screening_only_wait_for_peer_and_expectations_review",
            "first_rejection": (
                "Historical valuation bands, primary financial denominator tie-outs, company guidance, liquidity, and positioning are not complete."
            ),
            "next_workflow": "review_peer_set_then_company_tearsheet_or_comps_valuation",
            "posture": "wait_for_proof_not_investment_recommendation",
        })
    result = {
        "schema_version": SCHEMA_VERSION,
        "report_date": report_date,
        "company_count": len(rows),
        "companies": rows,
        "methodology": {
            "minimum_usable_peers": minimum_peers,
            "premium_discount_threshold_pct": 10,
            "peer_statistic": "median",
            "primary_metric_order": list(MULTIPLE_ORDER),
            "historical_band_required_for_cycle_conclusion": True,
            "consensus_label_requires_verified_methodology": True,
        },
        "data_gaps": [
            "Historical valuation bands are not collected.",
            "Peer roles are analyst screening assumptions pending primary business-model review.",
            "Provider forward estimates are not treated as full consensus without methodology and timestamp verification.",
            "Liquidity, ownership, positioning, factor exposure, and portfolio context are not collected.",
        ],
        "posture": "screening_only_not_selected_valuation_or_recommendation",
    }
    validate_company_valuation_expectations(result)
    return result


def validate_company_valuation_expectations(payload: dict[str, Any]) -> None:
    if payload.get("schema_version") != SCHEMA_VERSION:
        raise ValueError("Unexpected company valuation expectations schema")
    for row in payload.get("companies", []):
        valuation = row.get("valuation_screen") or {}
        if valuation.get("relative_valuation_status") not in RELATIVE_STATUSES:
            raise ValueError("Unsupported relative valuation status")
        if row.get("priced_in_status") != "not_established":
            raise ValueError("Screening comps cannot establish what is priced in")
        if row.get("security_readiness") == "decision_grade":
            raise ValueError("Small peer screens and provider estimates cannot create decision-grade research")
        if valuation.get("selected_valuation_range_status") != "not_supported":
            raise ValueError("A selected valuation range is not supported")
        if valuation.get("relative_valuation_status") != "insufficient_usable_peers":
            primary = valuation.get("primary_metric")
            matching = [item for item in valuation.get("comparisons", []) if item.get("metric") == primary]
            if not matching or matching[0].get("usable_peer_count", 0) < matching[0].get("minimum_peer_count", 2):
                raise ValueError("Relative valuation requires the minimum usable peer count")


def main() -> None:
    parser = argparse.ArgumentParser(description="Build company valuation and expectations screening gate")
    parser.add_argument("--date", required=True)
    parser.add_argument("--market-context-file")
    parser.add_argument("--peer-context-file")
    parser.add_argument("--fundamentals-file")
    parser.add_argument("--output-file")
    args = parser.parse_args()
    market_path = root_path(
        args.market_context_file,
        ROOT / "workspace" / "company_market_context" / args.date / "company_market_context.json",
    )
    peer_path = root_path(
        args.peer_context_file,
        ROOT / "workspace" / "company_peer_context" / args.date / "company_peer_context.json",
    )
    fundamentals_path = root_path(
        args.fundamentals_file,
        ROOT / "workspace" / "sector_fundamentals" / args.date / "sector_fundamentals.json",
    )
    for label, path in (
        ("Company market context", market_path),
        ("Company peer context", peer_path),
        ("Sector fundamentals", fundamentals_path),
    ):
        if not path.exists():
            raise SystemExit(f"{label} does not exist: {path}")
    payload = build_company_valuation_expectations(
        args.date,
        json.loads(market_path.read_text(encoding="utf-8")),
        json.loads(peer_path.read_text(encoding="utf-8")),
        json.loads(fundamentals_path.read_text(encoding="utf-8")),
    )
    output = root_path(
        args.output_file,
        ROOT / "workspace" / "company_valuation_expectations" / args.date / "company_valuation_expectations.json",
    )
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Company valuation expectations saved: {output.relative_to(ROOT)}")
    print(f"Company valuation expectations status: companies={payload['company_count']} | screening-only")


if __name__ == "__main__":
    main()
