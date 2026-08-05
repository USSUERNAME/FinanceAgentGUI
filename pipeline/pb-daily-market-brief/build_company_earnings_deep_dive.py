"""Build a deterministic post-earnings research review from verified input packs."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any

from collectors.common import ROOT
from collect_company_market_context import root_path

SCHEMA_VERSION = "company_post_earnings_deep_dive.v1"
ALLOWED_SIGNALS = {
    "strengthening_evidence", "within_range_evidence", "mixed_evidence",
    "weakening_evidence", "untested",
}


def _by_ticker(payload: dict[str, Any], key: str) -> dict[str, dict[str, Any]]:
    return {
        str(row.get("ticker") or "").upper(): row
        for row in payload.get(key, [])
        if row.get("ticker")
    }


def _research_signal(company: dict[str, Any]) -> tuple[str, str]:
    headline = company.get("headline_result_case")
    kpi_signals = [row.get("evidence_signal") for row in company.get("operating_kpi_checks", [])]
    eps_status = (company.get("eps_quality") or {}).get("status")
    if headline == "weaker_evidence" or "weakening" in kpi_signals:
        return "weakening_evidence", "The headline trigger or at least one comparable operating KPI weakened."
    if eps_status == "expanded_bridge_required":
        return "mixed_evidence", "The operating evidence must be reconciled with a triggered EPS-quality bridge."
    if headline == "stronger_evidence" and kpi_signals and all(value == "confirming" for value in kpi_signals):
        return "strengthening_evidence", "The exact-period result cleared the upper trigger and all supplied comparable KPIs confirmed their prior direction."
    if headline == "within_verified_range" and all(value != "weakening" for value in kpi_signals):
        return "within_range_evidence", "The exact-period result stayed inside the verified company range without a weakening comparable KPI."
    return "mixed_evidence", "The supplied headline, KPI, or quality evidence does not support one consistent direction."


def _guidance_review(company: dict[str, Any]) -> dict[str, Any]:
    rows = company.get("guidance_updates", [])
    return {
        "status": (
            "issuer_guidance_available_no_exact_updated_estimate_comparison"
            if rows else "not_guided_or_source_not_provided"
        ),
        "rows": [{
            "metric_id": row.get("metric_id"),
            "period_end": row.get("period_end"),
            "value": row.get("value"),
            "value_low": row.get("value_low"),
            "value_high": row.get("value_high"),
            "midpoint": row.get("midpoint"),
            "units": row.get("unit"),
            "basis": row.get("basis"),
            "assumptions": row.get("assumptions"),
            "source_id": row.get("source_id"),
            "evidence_label": "issuer_management_claim",
            "estimate_delta_status": "not_calculated_missing_exact_updated_estimate",
        } for row in rows],
        "decision_limit": "New guidance remains a company claim; direction versus estimates is not inferred without a same-period, same-unit refreshed estimate set.",
    }


def _market_source(market: dict[str, Any]) -> dict[str, Any] | None:
    source = market.get("source") or {}
    url = str(source.get("source_url") or "")
    if not url.startswith(("https://", "http://")):
        return None
    ticker = str(market.get("ticker") or "company")
    digest = hashlib.sha256(url.encode("utf-8")).hexdigest()[:12]
    return {
        "source_id": f"MARKET-{ticker}-{digest}",
        "source_name": "Company market and screening valuation context",
        "source_type": "provider",
        "owner_or_provider": source.get("provider") or "Market data provider",
        "as_of_date": (market.get("market_data") or {}).get("price_as_of"),
        "retrieved_at": source.get("retrieved_at"),
        "period_covered": "current market snapshot",
        "source_location": url,
        "freshness_status": "as_supplied",
        "notes": "Screening context only; not a selected valuation range.",
    }


def _company_review(
    company: dict[str, Any], market: dict[str, Any], valuation: dict[str, Any],
) -> dict[str, Any]:
    ready = company.get("pack_status") == "ready_for_post_earnings_deep_dive"
    if not ready:
        return {
            "candidate_id": company.get("candidate_id"),
            "ticker": company.get("ticker"),
            "company_name": company.get("company_name"),
            "event_date": company.get("event_date"),
            "review_status": "blocked_missing_verified_post_earnings_input_pack",
            "research_case_signal": "untested",
            "company_thesis_status": "untested",
            "security_thesis_readiness": "not_decision_grade",
            "position_action": "wait_for_proof",
            "blockers": list(company.get("missing_artifacts", [])),
            "source_index": list(company.get("source_index", [])),
            "decision_limit": "No post-earnings interpretation is generated until the verified input-pack gate passes.",
        }
    signal, rationale = _research_signal(company)
    metric = company.get("reported_metric_comparison") or {}
    kpis = list(company.get("operating_kpi_checks", []))
    eps = company.get("eps_quality") or {}
    price = market.get("market_data") or {}
    valuation_screen = valuation.get("valuation_screen") or {}
    market_source = _market_source(market)
    sources = {str(row.get("source_id")): dict(row) for row in company.get("source_index", []) if row.get("source_id")}
    if market_source:
        sources[str(market_source["source_id"])] = market_source
    missing = list(dict.fromkeys([
        *company.get("missing_artifacts", []),
        "approved original underwriting and kill criteria",
        "post-result refreshed estimate set",
        "audited model update and valuation/downside framework",
        "portfolio position, benchmark, active weight and risk budget",
    ]))
    return {
        "candidate_id": company.get("candidate_id"),
        "ticker": company.get("ticker"),
        "company_name": company.get("company_name"),
        "event_date": company.get("event_date"),
        "result_id": company.get("result_id"),
        "review_status": "source_verified_partial_post_earnings_deep_dive",
        "source_posture": "Company primary numeric sources reviewed; transcript, model and decision inputs may remain incomplete.",
        "bottom_line": {
            "research_case_signal": signal,
            "rationale": rationale,
            "company_thesis_status": "untested",
            "company_thesis_status_reason": "Original approved underwriting was not supplied, so evidence direction cannot be promoted into a formal thesis-status change.",
            "security_thesis_readiness": "not_decision_grade",
            "position_action": "wait_for_proof",
        },
        "headline_vs_pre_event_bar": {
            **metric,
            "interpretation": company.get("headline_result_case"),
            "decision_limit": "A headline case is not a recurring-earnings, valuation, or stock-reaction conclusion.",
        },
        "quality_of_print": {
            "research_case_signal": signal,
            "source_ids": list(dict.fromkeys(
                row.get("source_id") for row in kpis if row.get("source_id")
            )),
            "evidence_label": "derived_count_from_source_reported_kpis",
            "comparable_kpi_count": len(kpis),
            "confirming_kpi_count": sum(row.get("evidence_signal") == "confirming" for row in kpis),
            "weakening_kpi_count": sum(row.get("evidence_signal") == "weakening" for row in kpis),
            "mixed_or_neutral_kpi_count": sum(row.get("evidence_signal") not in {"confirming", "weakening"} for row in kpis),
            "operating_kpi_checks": kpis,
            "causal_attribution_allowed": False,
        },
        "eps_quality_screen": {
            "status": eps.get("status"),
            "source_id": eps.get("source_id"),
            "bridge_items": list(eps.get("bridge_items", [])),
            "note": eps.get("note"),
            "interpretation": (
                "Expanded recurring-EPS bridge review is required before using headline EPS."
                if eps.get("status") == "expanded_bridge_required"
                else "No material EPS-quality trigger was identified from the supplied primary source, subject to filing tie-out."
            ),
        },
        "guidance_review": _guidance_review(company),
        "transcript_review": {
            "status": company.get("transcript_status"),
            "quote_or_qa_map": [],
            "limitation": (
                "transcript not provided"
                if company.get("transcript_status") == "not_provided"
                else "transcript source not found"
                if company.get("transcript_status") == "source_not_found"
                else "Transcript is recorded as a separate source but no normalized quote/Q&A evidence was supplied."
            ),
        },
        "model_update_packet": {
            "mode": "packet_not_workbook_apply",
            "reported_actual": metric,
            "driver_updates": kpis,
            "guidance_inputs": _guidance_review(company)["rows"],
            "model_update_applied": False,
            "estimate_revision_direction": "not_established_missing_refreshed_estimates_and_model",
        },
        "security_context": {
            "current_price": price.get("price") if market_source else None,
            "price_as_of": price.get("price_as_of") if market_source else None,
            "currency": price.get("currency") if market_source else None,
            "source_id": market_source.get("source_id") if market_source else None,
            "relative_valuation_status": valuation_screen.get("relative_valuation_status") or "not_available",
            "priced_in_status": valuation.get("priced_in_status") or "not_established",
            "security_thesis_readiness": "not_decision_grade",
            "decision_limit": "Price and a screening peer multiple do not establish valuation support, downside, or what is priced in.",
        },
        "debate_map": {
            "confirming_evidence": [
                *(["Exact-period reported result cleared the upper verified trigger."] if company.get("headline_result_case") == "stronger_evidence" else []),
                *[f"Comparable KPI {row.get('driver_id')} confirmed its prior direction." for row in kpis if row.get("evidence_signal") == "confirming"],
            ],
            "disconfirming_evidence": [
                *(["Exact-period reported result fell below the lower verified trigger."] if company.get("headline_result_case") == "weaker_evidence" else []),
                *[f"Comparable KPI {row.get('driver_id')} weakened versus its prior direction." for row in kpis if row.get("evidence_signal") == "weakening"],
            ],
            "unresolved": missing,
        },
        "next_proof_points": [
            "Tie reported numbers to the filed 10-Q, 10-K, 8-K exhibit or equivalent filing.",
            "Normalize transcript prepared remarks and Q&A when available.",
            "Refresh same-period estimates after the print before inferring revisions.",
            "Update the model and valuation/downside framework before a security decision.",
        ],
        "blockers": missing,
        "source_index": list(sources.values()),
        "company_thesis_status": "untested",
        "security_thesis_readiness": "not_decision_grade",
        "position_action": "wait_for_proof",
        "next_workflow": "attach_original_underwriting_then_update_company_thesis_tracker",
        "decision_limit": "Research evidence direction only; no formal thesis promotion, valuation conclusion, or position action.",
    }


def build_company_earnings_deep_dive(
    report_date: str, post_earnings_results: dict[str, Any],
    company_market_context: dict[str, Any] | None = None,
    company_valuation_expectations: dict[str, Any] | None = None,
    tickers: set[str] | None = None,
) -> dict[str, Any]:
    markets = _by_ticker(company_market_context or {}, "contexts")
    valuations = _by_ticker(company_valuation_expectations or {}, "companies")
    companies = post_earnings_results.get("companies", [])
    if tickers is not None:
        requested = {str(ticker).upper() for ticker in tickers}
        companies = [
            company
            for company in companies
            if str(company.get("ticker") or "").upper() in requested
        ]
        found = {
            str(company.get("ticker") or "").upper()
            for company in companies
        }
        if found != requested:
            missing = ", ".join(sorted(requested - found))
            raise ValueError(
                f"Requested post-earnings ticker is unavailable: {missing}"
            )
    reviews = [
        _company_review(
            company,
            markets.get(str(company.get("ticker") or "").upper(), {}),
            valuations.get(str(company.get("ticker") or "").upper(), {}),
        )
        for company in companies
    ]
    payload = {
        "schema_version": SCHEMA_VERSION,
        "report_date": report_date,
        "company_count": len(reviews),
        "reviewed_count": sum(row.get("review_status") == "source_verified_partial_post_earnings_deep_dive" for row in reviews),
        "reviews": reviews,
        "methodology": {
            "headline_and_operating_evidence_separated": True,
            "eps_quality_screen_required": True,
            "guidance_kept_as_issuer_claim": True,
            "transcript_numeric_primacy_allowed": False,
            "original_underwriting_required_for_formal_thesis_change": True,
            "model_and_portfolio_inputs_required_for_security_action": True,
        },
        "posture": "post_earnings_research_review_not_investment_recommendation",
    }
    validate_company_earnings_deep_dive(payload)
    return payload


def merge_targeted_reviews(
    existing: dict[str, Any],
    targeted: dict[str, Any],
    *,
    tickers: set[str],
) -> dict[str, Any]:
    if (
        existing.get("schema_version") != SCHEMA_VERSION
        or existing.get("report_date") != targeted.get("report_date")
    ):
        return targeted
    requested = {str(ticker).upper() for ticker in tickers}
    reviews = [
        row
        for row in existing.get("reviews") or []
        if str(row.get("ticker") or "").upper() not in requested
    ]
    reviews.extend(targeted.get("reviews") or [])
    merged = dict(targeted)
    merged["reviews"] = reviews
    merged["company_count"] = len(reviews)
    merged["reviewed_count"] = sum(
        row.get("review_status")
        == "source_verified_partial_post_earnings_deep_dive"
        for row in reviews
    )
    validate_company_earnings_deep_dive(merged)
    return merged


def validate_company_earnings_deep_dive(payload: dict[str, Any]) -> None:
    if payload.get("schema_version") != SCHEMA_VERSION:
        raise ValueError("Unexpected post-earnings deep-dive schema")
    if int(payload.get("company_count", -1)) != len(payload.get("reviews", [])):
        raise ValueError("Company count does not match post-earnings reviews")
    for review in payload.get("reviews", []):
        if review.get("company_thesis_status") != "untested":
            raise ValueError("Deep dive cannot promote a formal thesis without original underwriting")
        if review.get("security_thesis_readiness") != "not_decision_grade":
            raise ValueError("Deep dive cannot promote security readiness without model and portfolio inputs")
        if review.get("position_action") != "wait_for_proof":
            raise ValueError("Deep dive cannot issue a position action")
        signal = (review.get("bottom_line") or {}).get("research_case_signal", review.get("research_case_signal"))
        if signal not in ALLOWED_SIGNALS:
            raise ValueError("Unsupported post-earnings research signal")
        source_ids = {row.get("source_id") for row in review.get("source_index", [])}
        if review.get("review_status") == "source_verified_partial_post_earnings_deep_dive":
            metric = review.get("headline_vs_pre_event_bar") or {}
            if metric.get("source_id") not in source_ids:
                raise ValueError("Headline result requires source lineage")
            if any(source_id not in source_ids for source_id in metric.get("pre_event_source_ids", [])):
                raise ValueError("Headline pre-event bar requires source lineage")
            if any(source_id not in source_ids for source_id in (review.get("quality_of_print") or {}).get("source_ids", [])):
                raise ValueError("Quality-of-print count requires source lineage")
            for kpi in (review.get("quality_of_print") or {}).get("operating_kpi_checks", []):
                if kpi.get("source_id") not in source_ids:
                    raise ValueError("Deep-dive KPI requires source lineage")
            for row in (review.get("guidance_review") or {}).get("rows", []):
                if row.get("source_id") not in source_ids:
                    raise ValueError("Deep-dive guidance requires source lineage")
            for row in (review.get("eps_quality_screen") or {}).get("bridge_items", []):
                if row.get("source_id") not in source_ids:
                    raise ValueError("Deep-dive EPS bridge requires source lineage")
            eps_screen = review.get("eps_quality_screen") or {}
            if eps_screen.get("status") != "source_not_provided" and eps_screen.get("source_id") not in source_ids:
                raise ValueError("Deep-dive EPS screen requires source lineage")
            security = review.get("security_context") or {}
            if security.get("current_price") is not None and security.get("source_id") not in source_ids:
                raise ValueError("Deep-dive market price requires source lineage")
        serialized = json.dumps(review, ensure_ascii=False).lower()
        if any(f'"{field}"' in serialized for field in ("price_target", "expected_return", "buy", "sell", "add", "trim", "exit", "hedge")):
            raise ValueError("Unsupported price, return, or trading field in post-earnings review")


def main() -> None:
    parser = argparse.ArgumentParser(description="Build source-verified post-earnings research reviews")
    parser.add_argument("--date", required=True)
    parser.add_argument("--post-earnings-results-file")
    parser.add_argument("--company-market-context-file")
    parser.add_argument("--company-valuation-expectations-file")
    parser.add_argument("--output-file")
    parser.add_argument("--ticker", action="append")
    args = parser.parse_args()
    results_path = root_path(
        args.post_earnings_results_file,
        ROOT / "workspace" / "company_earnings_results" / args.date / "company_earnings_results.json",
    )
    market_path = root_path(
        args.company_market_context_file,
        ROOT / "workspace" / "company_market_context" / args.date / "company_market_context.json",
    )
    valuation_path = root_path(
        args.company_valuation_expectations_file,
        ROOT / "workspace" / "company_valuation_expectations" / args.date / "company_valuation_expectations.json",
    )
    for label, path in (("Post-earnings results", results_path), ("Company market context", market_path), ("Company valuation expectations", valuation_path)):
        if not path.exists():
            raise SystemExit(f"{label} does not exist: {path}")
    payload = build_company_earnings_deep_dive(
        args.date,
        json.loads(results_path.read_text(encoding="utf-8")),
        json.loads(market_path.read_text(encoding="utf-8")),
        json.loads(valuation_path.read_text(encoding="utf-8")),
        tickers={ticker.upper() for ticker in args.ticker}
        if args.ticker
        else None,
    )
    output = root_path(
        args.output_file,
        ROOT / "workspace" / "company_earnings_deep_dive" / args.date / "company_earnings_deep_dive.json",
    )
    output.parent.mkdir(parents=True, exist_ok=True)
    if args.ticker and output.exists():
        payload = merge_targeted_reviews(
            json.loads(output.read_text(encoding="utf-8-sig")),
            payload,
            tickers={ticker.upper() for ticker in args.ticker},
        )
    output.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Company post-earnings deep dive saved: {output.relative_to(ROOT)}")
    print(f"Post-earnings reviews: {payload['reviewed_count']}/{payload['company_count']}")


if __name__ == "__main__":
    main()
