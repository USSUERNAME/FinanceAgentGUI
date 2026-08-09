"""Compose compact, cited company baselines from the evidence-gated company pipeline."""

from __future__ import annotations

import argparse
import json
from datetime import date
from pathlib import Path
from typing import Any

from collectors.common import ROOT
from collect_company_market_context import _number, root_path

SCHEMA_VERSION = "company_tearsheets.v1"
MAX_TEARSHEETS = 4
MAX_METRICS = 5
MAX_DRIVERS = 3
FORBIDDEN_CONCLUSIONS = {
    "cheap", "expensive", "fair_value", "undervalued", "overvalued",
    "priced_in", "decision_grade", "buy", "sell",
}


def _by_candidate(payload: dict[str, Any], field: str) -> dict[str, dict[str, Any]]:
    return {
        str(row.get("candidate_id")): row
        for row in payload.get(field, [])
        if row.get("candidate_id")
    }


def _freshness(report_date: str, as_of: str | None) -> tuple[str, int | None]:
    if not as_of:
        return "unknown", None
    gap = (date.fromisoformat(report_date) - date.fromisoformat(as_of)).days
    if gap < 0:
        return "future_date_rejected", gap
    return ("current_or_latest_close" if gap <= 3 else "stale"), gap


def _market_source(context: dict[str, Any]) -> dict[str, Any] | None:
    source = context.get("source") or {}
    source_id = source.get("source_id")
    if not source_id:
        return None
    return {
        "source_id": source_id,
        "source_name": "Alpha Vantage quote and company overview",
        "source_type": "provider",
        "owner_or_provider": source.get("provider") or "Alpha Vantage",
        "as_of_date": source.get("as_of_date"),
        "retrieved_at": source.get("retrieved_at"),
        "period_covered": source.get("as_of_date"),
        "source_location": source.get("source_url"),
        "freshness_status": source.get("freshness_status") or "unknown",
        "notes": "Provider-standardized market data and raw multiples; not a primary filing.",
    }


def _metric(
    metric_id: str, label: str, value: Any, period: str | None, period_type: str | None,
    currency: str | None, units: str | None, evidence_label: str, confidence: str,
    source_id: str, source_location: str | None, freshness_status: str, note: str,
) -> dict[str, Any]:
    return {
        "metric_id": metric_id,
        "label": label,
        "value": _number(value),
        "period": period,
        "period_type": period_type,
        "currency": currency,
        "units": units,
        "evidence_label": evidence_label,
        "confidence": confidence,
        "source_id": source_id,
        "source_location": source_location,
        "freshness_status": freshness_status,
        "note": note,
    }


def _metric_strip(
    report_date: str, context: dict[str, Any], operating: dict[str, Any], source_ids: set[str],
) -> list[dict[str, Any]]:
    metrics: list[dict[str, Any]] = []
    market = context.get("market_data") or {}
    market_source = context.get("source") or {}
    market_source_id = str(market_source.get("source_id") or "")
    freshness, _ = _freshness(report_date, market.get("price_as_of"))
    if market.get("price") is not None and market_source_id in source_ids:
        metrics.append(_metric(
            "share_price", "Share Price", market.get("price"), market.get("price_as_of"),
            "point_in_time", market.get("currency"), f"{market.get('currency') or 'currency'} per share",
            "fact_provider_standardized", "medium", market_source_id,
            market_source.get("source_url"), freshness, "Latest provider close; timestamp controls freshness.",
        ))
    if market.get("market_cap") is not None and market_source_id in source_ids:
        metrics.append(_metric(
            "market_cap", "Market Capitalization", market.get("market_cap"), market.get("price_as_of"),
            "point_in_time", market.get("currency"), market.get("currency"),
            "fact_provider_standardized", "medium", market_source_id,
            market_source.get("source_url"), freshness, "Provider-standardized market capitalization.",
        ))

    priority = {
        "revenue": 0, "operating_income": 1, "operating_cash_flow": 2,
        "capital_expenditures": 3, "company_kpi.backlog": 4,
    }
    rows = [
        row for row in operating.get("normalized_financials_long", [])
        if row.get("source_id") in source_ids and _number(row.get("normalized_value")) is not None
    ]
    rows.sort(key=lambda row: str(row.get("period_end") or ""), reverse=True)
    rows.sort(key=lambda row: priority.get(str(row.get("line_item_id")), 20))
    seen: set[str] = set()
    for row in rows:
        line_id = str(row.get("line_item_id"))
        if line_id in seen:
            continue
        seen.add(line_id)
        metrics.append(_metric(
            line_id,
            str(row.get("line_item_standard") or row.get("line_item_original") or line_id),
            row.get("normalized_value"), row.get("period_end"), row.get("period_type"),
            row.get("currency"), row.get("units"), row.get("evidence_label") or "unknown",
            row.get("confidence") or "low", str(row.get("source_id")), row.get("source_location"),
            "acceptable_for_period", str(row.get("normalization_note") or ""),
        ))
        if len(metrics) >= MAX_METRICS:
            break
    return metrics[:MAX_METRICS]


def _drivers(operating: dict[str, Any]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for evidence in operating.get("operating_evidence", [])[:MAX_DRIVERS]:
        rows.append({
            "driver_id": evidence.get("metric_id") or evidence.get("record_id"),
            "definition": evidence.get("definition") or "Company-defined operating KPI; definition review remains required.",
            "metric_basis": evidence.get("metric_basis") or "reported",
            "current_value": _number(evidence.get("current_value")),
            "prior_value": _number(evidence.get("prior_value")),
            "current_period": evidence.get("current_period"),
            "prior_period": evidence.get("prior_period"),
            "units": evidence.get("unit"),
            "currency": evidence.get("currency"),
            "change_pct": _number(evidence.get("change_pct")),
            "comparison_status": evidence.get("comparison_status") or "comparable",
            "source_id": evidence.get("source_id"),
            "source_url": evidence.get("source_url"),
            "body_location": evidence.get("body_location"),
            "transmission_status": evidence.get("transmission_status"),
            "interpretation_limit": "Operating evidence is not causal proof of the sector theme.",
        })
    return rows


def _clamp(value: float, lower: float, upper: float) -> float:
    return max(lower, min(upper, value))


def _independent_quality_evidence(
    primary: dict[str, Any], narrative: dict[str, Any],
) -> tuple[dict[str, Any], dict[str, Any]]:
    long_term = primary.get("long_term_financials") or {}
    summary = long_term.get("summary") or {}
    gate = long_term.get("quality_gate") or {}
    periods = long_term.get("periods") or []
    first_margin = _number((periods[0] if periods else {}).get("operating_margin_pct"))
    latest_margin = _number(summary.get("latest_operating_margin_pct"))
    complete_years = int(gate.get("complete_core_years") or 0)
    required_years = int(gate.get("required_core_years") or 5)
    moat_checks = {
        "official_business_model": (narrative.get("business_model") or {}).get("status") == "verified_primary",
        "five_year_core_financials": gate.get("status") == "ready" and complete_years >= required_years,
        "revenue_compounding": (_number(summary.get("revenue_cagr_pct")) or -999) >= 5,
        "persistent_operating_profit": int(summary.get("positive_operating_income_years") or 0) >= required_years,
        "persistent_free_cash_flow": int(summary.get("positive_fcf_years") or 0) >= required_years,
        "margin_durability": (
            latest_margin is not None and latest_margin >= 10
            and first_margin is not None and latest_margin >= first_margin - 2
        ),
    }
    moat_verified = all(moat_checks.values())
    issuer_claims = narrative.get("competitive_advantage") or {}
    competitive = {
        **issuer_claims,
        "status": (
            "supported_by_multi_year_primary_financial_pattern"
            if moat_verified else issuer_claims.get("status") or "not_verified"
        ),
        "verified": moat_verified,
        "verification_scope": "quantitative_indirect_evidence_not_direct_customer_or_market_share_proof",
        "independent_checks": moat_checks,
        "reason": (
            "5개년 매출·영업흑자·FCF·마진 지속성이 회사의 경쟁우위 설명과 일치합니다. "
            "고객 유지율이나 시장점유율을 직접 검증한 결과는 아닙니다."
            if moat_verified else
            "사업 설명은 확인했지만 5개년 성장·수익성·현금흐름 패턴이 해자를 독립적으로 뒷받침하지 못했습니다."
        ),
    }
    management_checks = {
        "five_year_core_financials": gate.get("status") == "ready" and complete_years >= required_years,
        "operating_income_growth": (_number(summary.get("operating_income_cagr_pct")) or -999) > 0,
        "free_cash_flow_growth": (_number(summary.get("fcf_cagr_pct")) or -999) > 0,
        "capital_allocation_observed": gate.get("capital_allocation_available") is True,
        "dilution_observed": gate.get("dilution_available") is True,
        "per_share_discipline": (
            _number(summary.get("diluted_share_count_change_pct")) is not None
            and (_number(summary.get("diluted_share_count_change_pct")) or 0) <= 5
        ),
    }
    management_verified = all(management_checks.values())
    management = {
        "status": "supported_by_multi_year_primary_outcomes" if management_verified else "not_verified",
        "verified": management_verified,
        "verification_scope": "multi_year_financial_and_per_share_outcomes",
        "independent_checks": management_checks,
        "reason": (
            "5개년 영업이익·FCF 성장과 자본배분·희석 결과가 함께 확인됐습니다."
            if management_verified else
            "5개년 실행 결과, 자본배분 또는 주당가치 규율 중 하나 이상이 부족해 경영진 실행력 판단을 보류합니다."
        ),
    }
    return competitive, management


def _scenario_valuation(
    report_date: str, context: dict[str, Any], primary: dict[str, Any],
) -> dict[str, Any]:
    long_term = primary.get("long_term_financials") or {}
    summary = long_term.get("summary") or {}
    gate = long_term.get("quality_gate") or {}
    periods = [row for row in long_term.get("periods", []) if isinstance(row, dict)]
    latest = periods[-1] if periods else {}
    market = context.get("market_data") or {}
    price = _number(market.get("price"))
    price_freshness, _ = _freshness(report_date, market.get("price_as_of"))
    revenue = _number(latest.get("revenue"))
    fcf = _number(latest.get("fcf"))
    shares = _number(latest.get("diluted_shares"))
    if (
        gate.get("status") != "ready" or int(gate.get("complete_core_years") or 0) < 5
        or price is None or price <= 0 or price_freshness != "current_or_latest_close"
        or revenue is None or revenue <= 0 or fcf is None or fcf <= 0 or shares is None or shares <= 0
    ):
        return {
            "status": "not_supported",
            "selected_valuation_range_status": "not_supported",
            "priced_in_status": "not_established",
            "reason": "최신 가격과 5개년 핵심 재무, 최근 FCF·희석주식수가 모두 필요합니다.",
            "scenarios": [],
        }
    revenue_cagr = _number(summary.get("revenue_cagr_pct")) or 0.0
    latest_fcf_margin = _number(summary.get("latest_fcf_margin_pct"))
    if latest_fcf_margin is None:
        latest_fcf_margin = fcf / revenue * 100
    latest_operating_margin = _number(summary.get("latest_operating_margin_pct")) or 0.0
    base_growth = _clamp(revenue_cagr * 0.5, -3.0, 18.0)
    base_multiple = _clamp(12.0 + max(base_growth, 0.0) * 0.6, 10.0, 24.0)
    assumptions = (
        ("bear", _clamp(base_growth - 6.0, -10.0, 12.0), max(1.0, latest_fcf_margin * 0.8), max(0.0, latest_operating_margin * 0.8), max(8.0, base_multiple - 5.0)),
        ("base", base_growth, latest_fcf_margin, latest_operating_margin, base_multiple),
        ("bull", _clamp(base_growth + 6.0, 3.0, 28.0), min(60.0, latest_fcf_margin * 1.1), min(70.0, latest_operating_margin * 1.1), min(30.0, base_multiple + 5.0)),
    )
    horizon_years = 5
    required_return_pct = 10.0
    scenarios = []
    for name, growth, fcf_margin, operating_margin, terminal_multiple in assumptions:
        terminal_revenue = revenue * ((1 + growth / 100) ** horizon_years)
        terminal_fcf = terminal_revenue * fcf_margin / 100
        terminal_fcf_per_share = terminal_fcf / shares
        terminal_value = terminal_fcf_per_share * terminal_multiple
        present_value = terminal_value / ((1 + required_return_pct / 100) ** horizon_years)
        scenarios.append({
            "scenario": name,
            "revenue_growth_pct": round(growth, 2),
            "operating_margin_pct": round(operating_margin, 2),
            "fcf_margin_pct": round(fcf_margin, 2),
            "terminal_price_to_fcf": round(terminal_multiple, 2),
            "terminal_fcf_per_share": round(terminal_fcf_per_share, 4),
            "terminal_value_per_share": round(terminal_value, 2),
            "present_value_per_share": round(present_value, 2),
            "upside_downside_pct": round((present_value / price - 1) * 100, 2),
        })
    current_fcf_per_share = fcf / shares
    required_terminal_fcf_per_share = price * ((1 + required_return_pct / 100) ** horizon_years) / base_multiple
    implied_fcf_growth_pct = ((required_terminal_fcf_per_share / current_fcf_per_share) ** (1 / horizon_years) - 1) * 100
    base_terminal_fcf_per_share = scenarios[1]["terminal_fcf_per_share"]
    base_fcf_growth_pct = ((base_terminal_fcf_per_share / current_fcf_per_share) ** (1 / horizon_years) - 1) * 100
    expectation_label = (
        "requires_growth_above_base_case" if implied_fcf_growth_pct > base_fcf_growth_pct + 3
        else "requires_growth_below_base_case" if implied_fcf_growth_pct < base_fcf_growth_pct - 3
        else "requires_growth_near_base_case"
    )
    present_values = [row["present_value_per_share"] for row in scenarios]
    return {
        "status": "supported_screening_model",
        "selected_valuation_range_status": "supported",
        "priced_in_status": "calculated_scenario_implied_growth",
        "model": "five_year_revenue_fcf_margin_terminal_multiple",
        "evidence_class": "derived_calculation_from_primary_financials_and_dated_market_price",
        "horizon_years": horizon_years,
        "required_return_pct": required_return_pct,
        "current_price": price,
        "price_as_of": market.get("price_as_of"),
        "current_fcf_per_share": round(current_fcf_per_share, 4),
        "fair_value_range": {"low": min(present_values), "high": max(present_values), "currency": market.get("currency")},
        "implied_fcf_growth_pct": round(implied_fcf_growth_pct, 2),
        "base_case_fcf_growth_pct": round(base_fcf_growth_pct, 2),
        "current_price_expectation": expectation_label,
        "scenarios": scenarios,
        "assumption_limits": [
            "희석주식수는 최근 연차보고서 수준으로 고정했습니다.",
            "종착 P/FCF는 장기 성장률에 연동한 분석 가정이며 시장 합의나 목표주가가 아닙니다.",
            "순현금·순부채와 중간 배당은 별도로 더하지 않았습니다.",
        ],
    }


def _valuation_context(
    report_date: str, context: dict[str, Any], valuation: dict[str, Any], primary: dict[str, Any],
) -> dict[str, Any]:
    screen = valuation.get("valuation_screen") or {}
    bar = valuation.get("expectations_bar") or {}
    scenario = _scenario_valuation(report_date, context, primary)
    return {
        "heading": "Valuation Context",
        "raw_multiples": context.get("valuation_context") or {},
        "relative_valuation_status": screen.get("relative_valuation_status") or "insufficient_usable_peers",
        "primary_metric": screen.get("primary_metric"),
        "primary_premium_discount_pct": _number(screen.get("primary_premium_discount_pct")),
        "peer_set_status": screen.get("peer_set_status") or "not_configured",
        "peer_selection_evidence_label": screen.get("peer_selection_evidence_label"),
        "historical_valuation_band_status": screen.get("historical_valuation_band_status") or "not_collected",
        "expectations_status": bar.get("status") or "insufficient_estimate_detail",
        "revision_direction": bar.get("revision_direction") or "insufficient_detail",
        "estimate_as_of": bar.get("estimate_as_of"),
        "estimate_evidence_label": bar.get("evidence_label") or "missing_required_source",
        "guidance_comparison_status": bar.get("company_guidance_comparison_status") or "not_collected",
        "priced_in_status": scenario["priced_in_status"],
        "selected_valuation_range_status": scenario["selected_valuation_range_status"],
        "scenario_valuation": scenario,
        "decision_limit": "Scenario values are transparent calculations, not a target price or investment recommendation.",
    }


def _evidence_gaps(
    context: dict[str, Any], operating: dict[str, Any], valuation: dict[str, Any],
    primary: dict[str, Any], narrative: dict[str, Any], competitive: dict[str, Any],
    management: dict[str, Any], valuation_context: dict[str, Any],
) -> list[dict[str, Any]]:
    gaps: list[dict[str, Any]] = []
    gaps.append({
        "area": "issuer_identity", "severity": "medium", "status": "partially_sourced",
        "required_source": "Verify exchange, CIK and fiscal year-end against the latest filing and listing record.",
    })
    if not (context.get("market_data") or {}).get("price"):
        gaps.append({"area": "market_data", "severity": "high", "status": "not_yet_sourced", "required_source": "Current market-data provider pull"})
    for area, required in (
        ("liquidity", "ADV and turnover source with as-of date"),
        ("ownership_positioning", "Float, holders, short interest, borrow and factor source"),
        ("historical_valuation", "Historical multiple series with consistent denominator definitions"),
        ("consensus", "Timestamped contributor-methodology estimate set"),
    ):
        gaps.append({"area": area, "severity": "medium", "status": "not_yet_sourced", "required_source": required})
    if not primary.get("guidance"):
        gaps.append({"area": "company_guidance", "severity": "medium", "status": "not_yet_sourced", "required_source": "Body-verified company guidance with exact period and units"})
    if (narrative.get("business_model") or {}).get("status") != "verified_primary":
        gaps.append({"area": "business_model", "severity": "high", "status": "not_yet_sourced", "required_source": "Latest annual filing Item 1 business description"})
    if competitive.get("verified") is not True:
        gaps.append({"area": "competitive_advantage", "severity": "high", "status": "issuer_claim_or_not_sourced", "required_source": "Customer, retention, pricing, share, or ecosystem evidence that independently tests issuer claims"})
    if management.get("verified") is not True:
        gaps.append({"area": "management_execution", "severity": "high", "status": "not_yet_verified", "required_source": "Multi-year strategy, reinvestment, acquisition, and per-share outcome bridge"})
    if valuation_context.get("selected_valuation_range_status") != "supported":
        gaps.append({"area": "scenario_valuation", "severity": "high", "status": "not_supported", "required_source": "Current price plus five-year revenue, FCF margin and diluted-share history"})
    for flag in operating.get("qa_flags", []):
        if flag.get("status") == "open":
            gaps.append({
                "area": flag.get("area"), "severity": flag.get("severity"), "status": "open_qa_flag",
                "required_source": flag.get("recommended_fix"), "impact": flag.get("impact"),
            })
    return gaps[:8]


def _tearsheet(
    report_date: str, candidate: dict[str, Any], context: dict[str, Any], valuation: dict[str, Any],
    primary: dict[str, Any], operating: dict[str, Any], narrative: dict[str, Any],
) -> dict[str, Any]:
    sources = {row.get("source_id"): dict(row) for row in operating.get("source_index", []) if row.get("source_id")}
    market_source = _market_source(context)
    if market_source:
        sources[market_source["source_id"]] = market_source
    annual_filing = narrative.get("annual_filing") or {}
    business_model = narrative.get("business_model") or {}
    narrative_source_id = annual_filing.get("source_id")
    narrative_url = str(annual_filing.get("source_url") or "")
    if (
        business_model.get("status") == "verified_primary"
        and narrative_source_id
        and narrative_url.startswith("https://www.sec.gov/")
    ):
        sources[narrative_source_id] = {
            "source_id": narrative_source_id,
            "source_name": f"{candidate.get('ticker')} {annual_filing.get('form')} Item 1 Business",
            "source_type": "filing",
            "owner_or_provider": "SEC EDGAR",
            "as_of_date": annual_filing.get("filing_date"),
            "retrieved_at": report_date,
            "period_covered": "annual business description",
            "source_location": narrative_url,
            "freshness_status": "latest_annual_filing_available_for_report_date",
            "notes": business_model.get("body_location"),
        }
    exposure_source_id = narrative_source_id if narrative_source_id in sources else None
    exposure_url = narrative_url if exposure_source_id else str(candidate.get("exposure_source_url") or "")
    if not exposure_source_id and candidate.get("exposure_status") == "verified_primary" and exposure_url.startswith("https://"):
        exposure_source_id = f"EXPOSURE-{candidate.get('ticker')}-{candidate.get('sector_id')}"
        sources[exposure_source_id] = {
            "source_id": exposure_source_id,
            "source_name": f"{candidate.get('ticker')} primary business-exposure disclosure",
            "source_type": "primary_public_source",
            "owner_or_provider": candidate.get("company_name"),
            "as_of_date": report_date,
            "retrieved_at": report_date,
            "period_covered": "business exposure",
            "source_location": exposure_url,
            "freshness_status": "acceptable_for_profile_baseline",
            "notes": candidate.get("exposure_body_location"),
        }
    source_ids = set(sources)
    metrics = _metric_strip(report_date, context, operating, source_ids)
    drivers = _drivers(operating)
    price_freshness, price_gap = _freshness(report_date, (context.get("market_data") or {}).get("price_as_of"))
    transmission = operating.get("transmission_status") or "company_operating_transmission_not_verified"
    exposure = business_model.get("status") == "verified_primary" or candidate.get("exposure_status") == "verified_primary"
    exchange = (context.get("market_data") or {}).get("exchange")
    cik = primary.get("cik")
    identity_status = (
        "ticker_exchange_cik_crosschecked" if exchange and cik
        else "ticker_exchange_provider_crosscheck_sec_identity_incomplete" if exchange
        else "partial_identity_needs_exchange_and_sec_crosscheck"
    )
    competitive_advantage, management_execution = _independent_quality_evidence(primary, narrative)
    valuation_context = _valuation_context(report_date, context, valuation, primary)
    if business_model.get("status") == "verified_primary":
        investor_read = (
            f"{candidate.get('company_name')} ({candidate.get('ticker')})의 최신 연차보고서에서 "
            "사업모델 설명을 확인했지만, 경쟁우위와 사건의 장기 실적 전환은 아직 검증되지 않았습니다."
        )
    else:
        investor_read = (
            f"{candidate.get('company_name')} ({candidate.get('ticker')}) has primary-source exposure to "
            f"{candidate.get('sector_name_ko') or candidate.get('sector_id')}; "
            + ("a company operating signal is verified, but causality and valuation remain unproven."
               if transmission == "verified_company_operating_signal_not_causal_attribution"
               else "company operating transmission and valuation remain unproven.")
        )
    readiness = "screen_grade" if exposure and metrics else "not_research_ready"
    return {
        "candidate_id": candidate.get("candidate_id"),
        "profile_type": "public_company",
        "as_of_date": report_date,
        "identity": {
            "company_name": candidate.get("company_name"),
            "ticker": candidate.get("ticker"),
            "market": candidate.get("market"),
            "exchange": exchange,
            "cik": cik,
            "sector_id": candidate.get("sector_id"),
            "sector_name_ko": candidate.get("sector_name_ko"),
            "fiscal_year_end": None,
            "identity_status": identity_status,
        },
        "investor_read": investor_read,
        "business_exposure": {
            "status": "verified_primary" if business_model.get("status") == "verified_primary" else candidate.get("exposure_status"),
            "evidence_summary": (
                f"{annual_filing.get('form')} Item 1에서 사업모델과 핵심 수익원 설명을 확인했습니다."
                if business_model.get("status") == "verified_primary"
                else candidate.get("exposure_evidence_summary")
            ),
            "source_id": exposure_source_id,
            "source_url": exposure_url or None,
            "body_location": business_model.get("body_location") or candidate.get("exposure_body_location"),
            "issuer_excerpt": business_model.get("excerpt"),
            "evidence_class": business_model.get("evidence_class"),
        },
        "competitive_advantage": competitive_advantage,
        "management_execution": management_execution,
        "risk_factors": narrative.get("risk_factors") or {
            "status": "not_collected", "excerpt": None,
        },
        "security_context": {
            "price": (context.get("market_data") or {}).get("price"),
            "currency": (context.get("market_data") or {}).get("currency"),
            "price_as_of": (context.get("market_data") or {}).get("price_as_of"),
            "price_freshness_status": price_freshness,
            "calendar_gap_days": price_gap,
            "market_cap": (context.get("market_data") or {}).get("market_cap"),
            "liquidity_status": "not_collected",
            "ownership_positioning_status": "not_collected",
        },
        "key_metrics": metrics,
        "earnings_drivers": drivers,
        "valuation_context": valuation_context,
        "monitoring_framework": {
            "why_now": candidate.get("why_now"),
            "proof_trigger": candidate.get("what_would_make_it_investable"),
            "falsifier": candidate.get("what_would_kill_it"),
            "first_rejection": valuation.get("first_rejection") or candidate.get("first_rejection"),
            "action": "wait_for_proof",
        },
        "evidence_gaps": _evidence_gaps(
            context, operating, valuation, primary, narrative,
            competitive_advantage, management_execution, valuation_context,
        ),
        "source_index": list(sources.values()),
        "source_count": len(sources),
        "readiness": readiness,
        "scope_limit": "Baseline profile only; no recommendation, target price, fair-value conclusion, or causal attribution.",
        "next_workflow": "earnings_driver_review_then_initiating_coverage_or_thesis_tracker",
    }


def build_company_tearsheets(
    report_date: str, queue: dict[str, Any], market_context: dict[str, Any],
    valuation_expectations: dict[str, Any], primary_facts: dict[str, Any],
    operating_bridge: dict[str, Any], primary_narratives: dict[str, Any] | None = None,
    max_tearsheets: int = MAX_TEARSHEETS,
) -> dict[str, Any]:
    contexts = _by_candidate(market_context, "contexts")
    valuations = _by_candidate(valuation_expectations, "companies")
    primary = _by_candidate(primary_facts, "companies")
    operating = _by_candidate(operating_bridge, "companies")
    narratives = _by_candidate(primary_narratives or {}, "companies")
    candidates = [
        row for row in queue.get("candidates", [])
        if row.get("queue_stage") == "valuation_expectations_gated"
    ][:max_tearsheets]
    tearsheets = [
        _tearsheet(
            report_date, row, contexts.get(str(row.get("candidate_id")), {}),
            valuations.get(str(row.get("candidate_id")), {}),
            primary.get(str(row.get("candidate_id")), {}),
            operating.get(str(row.get("candidate_id")), {}),
            narratives.get(str(row.get("candidate_id")), {}),
        )
        for row in candidates
    ]
    result = {
        "schema_version": SCHEMA_VERSION,
        "report_date": report_date,
        "profile_count": len(tearsheets),
        "profiles": tearsheets,
        "methodology": {
            "profile_type": "public_company",
            "maximum_profiles": max_tearsheets,
            "source_backed_metrics_only": True,
            "recommendations_allowed": False,
            "priced_in_calculations_allowed": True,
            "priced_in_conclusions_allowed": False,
            "scenario_valuations_allowed": True,
            "causal_attribution_allowed": False,
        },
        "support_handoff": {
            "owning_workflow": "company_tearsheet",
            "decision_impact": "Creates a consistent issuer baseline and makes missing decision inputs explicit.",
            "readiness_effect": "screen_grade",
            "artifact_role": "embedded_support_artifact",
            "hidden_unless_requested": True,
        },
        "posture": "issuer_baseline_not_investment_recommendation",
    }
    validate_company_tearsheets(result)
    return result


def validate_company_tearsheets(payload: dict[str, Any]) -> None:
    if payload.get("schema_version") != SCHEMA_VERSION:
        raise ValueError("Unexpected company tearsheet schema")
    if int(payload.get("profile_count", -1)) != len(payload.get("profiles", [])):
        raise ValueError("Profile count does not match tearsheets")
    if len(payload.get("profiles", [])) > MAX_TEARSHEETS:
        raise ValueError("Company tearsheet output exceeds the bounded profile count")
    for profile in payload.get("profiles", []):
        source_ids = {row.get("source_id") for row in profile.get("source_index", [])}
        exposure = profile.get("business_exposure") or {}
        if exposure.get("status") == "verified_primary":
            if exposure.get("source_id") not in source_ids:
                raise ValueError("Verified business exposure requires a source index entry")
            if not str(exposure.get("source_url") or "").startswith("https://") or not exposure.get("body_location"):
                raise ValueError("Verified business exposure requires an HTTPS source and body location")
        for metric in profile.get("key_metrics", []):
            if metric.get("source_id") not in source_ids:
                raise ValueError("Every tearsheet metric requires a source index entry")
            if metric.get("value") is None or not metric.get("period") or not metric.get("units"):
                raise ValueError("Every tearsheet metric requires value, period, and units")
            if not metric.get("evidence_label") or not metric.get("confidence"):
                raise ValueError("Every tearsheet metric requires evidence and confidence labels")
        valuation = profile.get("valuation_context") or {}
        if valuation.get("priced_in_status") not in {
            "not_established", "calculated_scenario_implied_growth",
        }:
            raise ValueError("A tearsheet cannot assert what is priced in without a bounded calculation")
        scenario = valuation.get("scenario_valuation") or {}
        if valuation.get("selected_valuation_range_status") == "supported":
            rows = scenario.get("scenarios") or []
            if scenario.get("status") != "supported_screening_model":
                raise ValueError("A supported valuation range requires a screening model")
            if [row.get("scenario") for row in rows] != ["bear", "base", "bull"]:
                raise ValueError("A supported valuation range requires bear, base, and bull scenarios")
            if any(
                _number(row.get(field)) is None
                for row in rows
                for field in (
                    "revenue_growth_pct", "operating_margin_pct", "fcf_margin_pct",
                    "terminal_price_to_fcf", "present_value_per_share",
                )
            ):
                raise ValueError("Every valuation scenario requires explicit growth, margin, multiple, and value assumptions")
            if scenario.get("priced_in_status") != "calculated_scenario_implied_growth":
                raise ValueError("A supported valuation range requires a current-price implication calculation")
        elif valuation.get("selected_valuation_range_status") != "not_supported":
            raise ValueError("Unsupported valuation range status")
        if profile.get("readiness") == "decision_grade":
            raise ValueError("A baseline tearsheet cannot be decision grade")
        if profile.get("monitoring_framework", {}).get("action") != "wait_for_proof":
            raise ValueError("A baseline tearsheet cannot issue a trading action")
        serialized = json.dumps(profile, ensure_ascii=False).lower()
        if any(f'"{term}"' in serialized for term in FORBIDDEN_CONCLUSIONS):
            raise ValueError("Unsupported investment or valuation conclusion in tearsheet")
        if profile.get("security_context", {}).get("price_freshness_status") == "future_date_rejected":
            raise ValueError("Future-dated market data cannot enter a tearsheet")


def main() -> None:
    parser = argparse.ArgumentParser(description="Build compact cited public-company tearsheets")
    parser.add_argument("--date", required=True)
    parser.add_argument("--queue-file")
    parser.add_argument("--market-context-file")
    parser.add_argument("--valuation-expectations-file")
    parser.add_argument("--primary-facts-file")
    parser.add_argument("--operating-bridge-file")
    parser.add_argument("--primary-narratives-file")
    parser.add_argument("--output-file")
    args = parser.parse_args()
    paths = {
        "queue": root_path(args.queue_file, ROOT / "workspace" / "company_research_queue" / args.date / "company_research_queue.json"),
        "market": root_path(args.market_context_file, ROOT / "workspace" / "company_market_context" / args.date / "company_market_context.json"),
        "valuation": root_path(args.valuation_expectations_file, ROOT / "workspace" / "company_valuation_expectations" / args.date / "company_valuation_expectations.json"),
        "primary": root_path(args.primary_facts_file, ROOT / "workspace" / "company_primary_facts" / args.date / "company_primary_facts.json"),
        "operating": root_path(args.operating_bridge_file, ROOT / "workspace" / "company_operating_bridge" / args.date / "company_operating_bridge.json"),
        "narratives": root_path(args.primary_narratives_file, ROOT / "workspace" / "company_primary_narratives" / args.date / "company_primary_narratives.json"),
    }
    for label, path in paths.items():
        if not path.exists():
            raise SystemExit(f"Company tearsheet input does not exist ({label}): {path}")
    payload = build_company_tearsheets(
        args.date,
        json.loads(paths["queue"].read_text(encoding="utf-8")),
        json.loads(paths["market"].read_text(encoding="utf-8")),
        json.loads(paths["valuation"].read_text(encoding="utf-8")),
        json.loads(paths["primary"].read_text(encoding="utf-8")),
        json.loads(paths["operating"].read_text(encoding="utf-8")),
        json.loads(paths["narratives"].read_text(encoding="utf-8")),
    )
    output = root_path(
        args.output_file,
        ROOT / "workspace" / "company_tearsheets" / args.date / "company_tearsheets.json",
    )
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Company tearsheets saved: {output.relative_to(ROOT)}")
    print(f"Company tearsheet status: profiles={payload['profile_count']} | screen-grade baseline")


if __name__ == "__main__":
    main()
