"""Build reader-safe long-term company cards from verified pipeline evidence."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from collectors.common import ROOT
from company_judgment_policy import (
    conditional_action,
    evaluate_judgment_gates,
    load_judgment_policy,
)


SCHEMA_VERSION = "company_long_term_profiles.v2"


def _ticker_map(payload: dict[str, Any], field: str) -> dict[str, dict[str, Any]]:
    return {
        str(row.get("ticker") or row.get("identity", {}).get("ticker") or "").upper(): row
        for row in payload.get(field, [])
        if isinstance(row, dict)
        and str(row.get("ticker") or row.get("identity", {}).get("ticker") or "").strip()
    }


def _score_operating(summary: dict[str, Any], periods: list[dict[str, Any]]) -> int | None:
    growth = summary.get("operating_income_cagr_pct")
    if not isinstance(growth, (int, float)) or len(periods) < 5:
        return None
    growth_points = 12 if growth >= 20 else 10 if growth >= 10 else 7 if growth >= 5 else 4 if growth >= 0 else 1
    positive = min(5, int(summary.get("positive_operating_income_years") or 0))
    margins = [row.get("operating_margin_pct") for row in periods if isinstance(row.get("operating_margin_pct"), (int, float))]
    margin_points = 0 if len(margins) < 2 else 3 if margins[-1] >= margins[0] else 1
    return min(20, growth_points + positive + margin_points)


def _score_fcf(summary: dict[str, Any], periods: list[dict[str, Any]]) -> int | None:
    growth = summary.get("fcf_cagr_pct")
    if not isinstance(growth, (int, float)) or len(periods) < 5:
        return None
    growth_points = 8 if growth >= 15 else 6 if growth >= 8 else 4 if growth >= 0 else 1
    conversion = summary.get("median_fcf_conversion_pct")
    conversion_points = 4 if isinstance(conversion, (int, float)) and conversion >= 80 else 3 if isinstance(conversion, (int, float)) and conversion >= 50 else 1
    stability_points = min(3, round(int(summary.get("positive_fcf_years") or 0) * 3 / 5))
    return min(15, growth_points + conversion_points + stability_points)


def _score_capital_allocation(summary: dict[str, Any], gate: dict[str, Any]) -> int | None:
    if not gate.get("capital_allocation_available") or not gate.get("dilution_available"):
        return None
    return_to_fcf = summary.get("cumulative_returns_to_fcf_pct")
    dilution = summary.get("diluted_share_count_change_pct")
    sustainable = 5 if isinstance(return_to_fcf, (int, float)) and 0 <= return_to_fcf <= 100 else 2
    share_points = 4 if isinstance(dilution, (int, float)) and dilution < 0 else 2 if dilution == 0 else 0
    return min(15, sustainable + share_points + 3)


def _financial_verdict(
    summary: dict[str, Any], gate: dict[str, Any], judgment_gate: dict[str, Any],
) -> dict[str, Any]:
    if gate.get("status") != "ready":
        return {
            "status": "evaluation_withheld",
            "label": "평가 보류",
            "reason": "5개년 매출·영업이익·FCF 정규화가 완성되지 않았습니다.",
        }
    operating_growth = summary.get("operating_income_cagr_pct")
    positive_fcf = int(summary.get("positive_fcf_years") or 0)
    dilution = summary.get("diluted_share_count_change_pct")
    if isinstance(operating_growth, (int, float)) and operating_growth >= 10 and positive_fcf >= 4:
        status = "financial_compounding_supported"
        label = "재무 복리 확인"
    elif isinstance(operating_growth, (int, float)) and operating_growth < 0 or positive_fcf <= 2:
        status = "financial_quality_caution"
        label = "현금창출 경계"
    else:
        status = "financial_quality_mixed"
        label = "재무 품질 혼재"
    reason = f"영업이익 5년 CAGR {operating_growth if operating_growth is not None else '확인 불가'}%, FCF 흑자 {positive_fcf}/5년"
    if isinstance(dilution, (int, float)):
        reason += f", 희석주식수 변화 {dilution:+.2f}%"
    missing = int(judgment_gate.get("required_count") or 0) - int(judgment_gate.get("met_count") or 0)
    if missing > 0 and status == "financial_compounding_supported":
        label = "재무 복리 확인·질 평가 보류"
        reason += f". 다만 기업의 질 필수 근거 {missing}개가 남아 종합 판정은 보류합니다."
    return {
        "status": status,
        "label": label,
        "reason": reason,
        "judgment_status": judgment_gate.get("status"),
    }


def _valuation_verdict(
    valuation: dict[str, Any], judgment_gate: dict[str, Any],
) -> dict[str, Any]:
    screen = valuation.get("valuation_screen") or {}
    if screen.get("status") != "screening_available":
        return {
            "status": "evaluation_withheld",
            "label": "평가 보류",
            "reason": "비교 가능한 피어 또는 역사적 밸류에이션 근거가 부족합니다.",
        }
    relative = screen.get("relative_valuation_status")
    labels = {
        "premium_to_watchlist_peer_median": "피어 대비 프리미엄",
        "discount_to_watchlist_peer_median": "피어 대비 할인",
        "near_watchlist_peer_median": "피어 중앙값 부근",
    }
    return {
        "status": "screening_only",
        "label": labels.get(relative, "상대가치 선별"),
        "reason": (
            "피어 중앙값 비교는 선별 근거입니다. 역사적 범위·3개 시나리오·가격에 반영된 기대가 "
            "완성되기 전에는 적정가치나 기대수익 결론으로 사용하지 않습니다."
        ),
        "relative_status": relative,
        "premium_discount_pct": screen.get("primary_premium_discount_pct"),
        "judgment_status": judgment_gate.get("status"),
    }


def _portfolio_verdict(
    queue_row: dict[str, Any], judgment_gate: dict[str, Any],
) -> dict[str, Any]:
    sources = set(queue_row.get("direct_input_sources") or [])
    if "portfolio" in sources:
        reason = "보유종목으로 확인됐지만 현재 비중·중복 노출·투자기간 정보가 없어 적합성 점수를 보류합니다."
    else:
        reason = "관심종목 등록만으로는 기존 비중과 집중 위험을 판단할 수 없어 적합성 점수를 보류합니다."
    return {
        "status": "evaluation_withheld",
        "label": "평가 보류",
        "score": None,
        "reason": reason,
        "judgment_status": judgment_gate.get("status"),
    }


def _profile(
    report_date: str,
    primary: dict[str, Any],
    valuation: dict[str, Any],
    tearsheet: dict[str, Any],
    queue_row: dict[str, Any],
    policy: dict[str, Any],
) -> dict[str, Any]:
    long_term = primary.get("long_term_financials") or {}
    summary = long_term.get("summary") or {}
    periods = long_term.get("periods") or []
    gate = long_term.get("quality_gate") or {}
    components = {
        "operating_income": {"score": _score_operating(summary, periods), "max": 20},
        "fcf": {"score": _score_fcf(summary, periods), "max": 15},
        "capital_allocation": {"score": _score_capital_allocation(summary, gate), "max": 15},
        "moat": {"score": None, "max": 20},
        "management_growth": {"score": None, "max": 15},
        "valuation_risk_return": {"score": None, "max": 15},
    }
    scored = [row for row in components.values() if isinstance(row["score"], int)]
    source_urls = []
    for metric_rows in (primary.get("annual_reported_metrics") or {}).values():
        for row in metric_rows:
            url = str(row.get("source_url") or "")
            if url.startswith("https://") and url not in source_urls:
                source_urls.append(url)
    judgment_framework = evaluate_judgment_gates(
        policy, primary, valuation, tearsheet, queue_row,
    )
    action = conditional_action(
        policy,
        judgment_framework,
        [
            queue_row.get("what_would_make_it_investable"),
            (tearsheet.get("monitoring_framework") or {}).get("proof_trigger"),
        ],
        [
            queue_row.get("what_would_kill_it"),
            (tearsheet.get("monitoring_framework") or {}).get("falsifier"),
        ],
    )
    return {
        "ticker": primary.get("ticker"),
        "company_name": primary.get("company_name"),
        "as_of_date": report_date,
        "candidate_origin": queue_row.get("candidate_origin") or "sector_research",
        "company_quality": _financial_verdict(
            summary, gate, judgment_framework["company_quality"],
        ),
        "stock_attractiveness": _valuation_verdict(
            valuation, judgment_framework["stock_attractiveness"],
        ),
        "portfolio_fit": _portfolio_verdict(
            queue_row, judgment_framework["portfolio_fit"],
        ),
        "judgment_framework": judgment_framework,
        "long_term_financials": long_term,
        "scorecard": {
            "status": "withheld_incomplete_evidence",
            "overall_score": None,
            "scored_points": sum(row["score"] for row in scored),
            "scored_max": sum(row["max"] for row in scored),
            "components": components,
            "missing_components": [name for name, row in components.items() if row["score"] is None],
            "reason": "해자·경영진·완전한 밸류에이션 근거가 없으므로 100점 환산을 하지 않습니다.",
        },
        "action": action,
        "source_urls": source_urls[:12],
        "evidence_policy": {
            "facts_calculations_judgments_separated": True,
            "missing_values_inferred": False,
            "company_quality_stock_attractiveness_portfolio_fit_separated": True,
        },
    }


def build_company_long_term_profiles(
    report_date: str,
    primary_facts: dict[str, Any],
    valuation_expectations: dict[str, Any],
    tearsheets: dict[str, Any],
    queue: dict[str, Any],
    policy: dict[str, Any] | None = None,
) -> dict[str, Any]:
    judgment_policy = policy or load_judgment_policy()
    primary_map = _ticker_map(primary_facts, "companies")
    valuation_map = _ticker_map(valuation_expectations, "companies")
    tearsheet_map = _ticker_map(tearsheets, "profiles")
    queue_map = _ticker_map(queue, "candidates")
    profiles = [
        _profile(
            report_date,
            primary_map[ticker],
            valuation_map.get(ticker, {}),
            tearsheet_map.get(ticker, {}),
            queue_map.get(ticker, {}),
            judgment_policy,
        )
        for ticker in sorted(primary_map)
    ]
    payload = {
        "schema_version": SCHEMA_VERSION,
        "report_date": report_date,
        "profile_count": len(profiles),
        "profiles": profiles,
        "policy": {
            "schema_version": judgment_policy["schema_version"],
            "decision_sequence": judgment_policy["decision_sequence"],
            "overall_score_requires_complete_evidence": True,
            "portfolio_fit_requires_user_context": True,
            "automatic_position_actions_allowed": False,
        },
    }
    validate_company_long_term_profiles(payload)
    return payload


def validate_company_long_term_profiles(payload: dict[str, Any]) -> None:
    if payload.get("schema_version") != SCHEMA_VERSION:
        raise ValueError("Unexpected long-term company profile schema")
    if int(payload.get("profile_count", -1)) != len(payload.get("profiles", [])):
        raise ValueError("Long-term company profile count mismatch")
    for profile in payload.get("profiles", []):
        scorecard = profile.get("scorecard") or {}
        if scorecard.get("status") != "withheld_incomplete_evidence" or scorecard.get("overall_score") is not None:
            raise ValueError("Incomplete long-term evidence cannot produce an overall score")
        if (profile.get("portfolio_fit") or {}).get("score") is not None:
            raise ValueError("Portfolio fit cannot be scored without explicit portfolio context")
        framework = profile.get("judgment_framework") or {}
        if framework.get("decision_sequence") != [
            "company_quality", "stock_attractiveness", "portfolio_fit", "conditional_action",
        ]:
            raise ValueError("Judgment framework decisions are missing or out of order")
        if (profile.get("action") or {}).get("grade") not in {"매수 검토", "분할매수", "보유", "관망", "축소 검토", "논리 훼손"}:
            raise ValueError("Unexpected conditional action grade")


def _load(path: Path) -> dict[str, Any]:
    if not path.exists():
        raise SystemExit(f"Required company input does not exist: {path}")
    return json.loads(path.read_text(encoding="utf-8-sig"))


def main() -> None:
    parser = argparse.ArgumentParser(description="Build long-term company profiles")
    parser.add_argument("--date", required=True)
    args = parser.parse_args()
    roots = {
        "primary_facts": ROOT / "workspace" / "company_primary_facts" / args.date / "company_primary_facts.json",
        "valuation_expectations": ROOT / "workspace" / "company_valuation_expectations" / args.date / "company_valuation_expectations.json",
        "tearsheets": ROOT / "workspace" / "company_tearsheets" / args.date / "company_tearsheets.json",
        "queue": ROOT / "workspace" / "company_research_queue" / args.date / "company_research_queue.json",
    }
    payload = build_company_long_term_profiles(args.date, **{key: _load(path) for key, path in roots.items()})
    output = ROOT / "workspace" / "company_long_term_profiles" / args.date
    output.mkdir(parents=True, exist_ok=True)
    path = output / "company_long_term_profiles.json"
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Long-term company profiles saved: {path.relative_to(ROOT)} ({payload['profile_count']})")


if __name__ == "__main__":
    main()
