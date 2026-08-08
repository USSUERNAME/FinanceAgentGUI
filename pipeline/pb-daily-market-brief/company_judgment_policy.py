"""Evaluate long-term company evidence against an explicit judgment policy."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from collectors.common import ROOT


DEFAULT_POLICY_PATH = ROOT.parents[1] / "config" / "company-judgment-policy.json"
EXPECTED_SCHEMA = "company_judgment_policy.v1"


def load_judgment_policy(path: Path | None = None) -> dict[str, Any]:
    policy_path = path or DEFAULT_POLICY_PATH
    policy = json.loads(policy_path.read_text(encoding="utf-8-sig"))
    validate_judgment_policy(policy)
    return policy


def validate_judgment_policy(policy: dict[str, Any]) -> None:
    if policy.get("schema_version") != EXPECTED_SCHEMA:
        raise ValueError("Unexpected company judgment policy schema")
    sequence = policy.get("decision_sequence") or []
    if sequence != [
        "company_quality", "stock_attractiveness", "portfolio_fit", "conditional_action",
    ]:
        raise ValueError("Company judgment decisions must stay separate and ordered")
    if (policy.get("conditional_action") or {}).get("automatic_position_actions_allowed") is not False:
        raise ValueError("Automatic position actions must remain disabled")
    if (policy.get("portfolio_fit") or {}).get("score_without_explicit_context") is not False:
        raise ValueError("Portfolio fit cannot be scored without explicit context")


def _gate(gate_id: str, label: str, met: bool, evidence: str, missing: str) -> dict[str, Any]:
    return {
        "gate_id": gate_id,
        "label": label,
        "status": "met" if met else "missing",
        "evidence": evidence if met else None,
        "missing_evidence": None if met else missing,
    }


def _gate_summary(gates: list[dict[str, Any]]) -> dict[str, Any]:
    met = [row for row in gates if row["status"] == "met"]
    missing = [row for row in gates if row["status"] != "met"]
    return {
        "status": "complete" if not missing else "partial" if met else "withheld",
        "met_count": len(met),
        "required_count": len(gates),
        "gates": gates,
        "missing_gate_ids": [row["gate_id"] for row in missing],
    }


def _portfolio_context(queue_row: dict[str, Any]) -> dict[str, Any]:
    value = queue_row.get("portfolio_context")
    return value if isinstance(value, dict) else {}


def evaluate_judgment_gates(
    policy: dict[str, Any],
    primary: dict[str, Any],
    valuation: dict[str, Any],
    tearsheet: dict[str, Any],
    queue_row: dict[str, Any],
) -> dict[str, Any]:
    validate_judgment_policy(policy)
    long_term = primary.get("long_term_financials") or {}
    quality_gate = long_term.get("quality_gate") or {}
    business = tearsheet.get("business_exposure") or {}
    evidence_gaps = {
        str(row.get("area")): row
        for row in tearsheet.get("evidence_gaps", [])
        if isinstance(row, dict)
    }
    quality_requirements = policy["company_quality"]
    required_years = int(quality_requirements.get("required_core_years") or 5)
    complete_years = int(quality_gate.get("complete_core_years") or 0)
    quality_gates = [
        _gate(
            "five_year_financials", "5개년 영업이익·FCF",
            quality_gate.get("status") == "ready" and complete_years >= required_years,
            f"정규화된 핵심 재무 {complete_years}개년",
            f"같은 기준의 핵심 재무 {required_years}개년",
        ),
        _gate(
            "business_model_primary_evidence", "사업모델 1차 근거",
            business.get("status") == "verified_primary" and bool(business.get("source_url")),
            str(business.get("evidence_summary") or "1차 자료 사업 노출 확인"),
            "공시·IR 기반 사업모델과 핵심 수익원",
        ),
        _gate(
            "capital_allocation_and_dilution", "자본배분·실제 희석",
            bool(quality_gate.get("capital_allocation_available"))
            and bool(quality_gate.get("dilution_available")),
            "현금환원·신주발행·분할조정 희석주식수 확인",
            "신주발행·주식보상과 분할조정 희석주식수",
        ),
        _gate(
            "moat_evidence", "해자 검증",
            bool((tearsheet.get("competitive_advantage") or {}).get("verified")),
            "전환비용·생태계·가격결정력의 1차 근거 확인",
            "전환비용·생태계·가격결정력을 수치로 검증할 근거",
        ),
        _gate(
            "management_execution_evidence", "경영진 실행력",
            bool((tearsheet.get("management_execution") or {}).get("verified")),
            "전략·재투자·인수 성과를 장기 수치로 확인",
            "전략·재투자·인수 결과와 영업이익·FCF의 연결 근거",
        ),
    ]

    screen = valuation.get("valuation_screen") or {}
    comparisons = screen.get("comparisons") or []
    primary_comparison = next(
        (row for row in comparisons if row.get("status") == "available_screening_only"),
        {},
    )
    price = valuation.get("current_price")
    price_as_of = valuation.get("price_as_of")
    valuation_gates = [
        _gate(
            "dated_current_price", "기준일 있는 현재 가격",
            isinstance(price, (int, float)) and price > 0 and bool(price_as_of),
            f"{price_as_of} 기준 {price} {valuation.get('currency') or ''}".strip(),
            "가격·통화·거래일",
        ),
        _gate(
            "comparable_peer_screen", "비교 가능한 피어 선별",
            screen.get("status") == "screening_available"
            and int(primary_comparison.get("usable_peer_count") or 0)
            >= int(primary_comparison.get("minimum_peer_count") or 2),
            "최소 피어 수를 충족한 상대 멀티플 선별",
            "정의가 맞는 비교기업 멀티플",
        ),
        _gate(
            "historical_valuation_band", "역사적 밸류에이션 범위",
            screen.get("historical_valuation_band_status") in {"available", "verified"},
            "동일 분모 기준 역사적 범위 확인",
            "동일 분모 기준 역사적 멀티플 범위",
        ),
        _gate(
            "three_scenario_valuation", "약세·기준·강세 시나리오",
            screen.get("selected_valuation_range_status") in {"available", "supported"},
            "매출·마진·FCF·종착 멀티플 가정 확인",
            "약세·기준·강세의 매출·마진·FCF·종착 멀티플",
        ),
        _gate(
            "priced_in_expectations", "현재 가격에 반영된 기대",
            (tearsheet.get("valuation_context") or {}).get("priced_in_status")
            in {"established", "verified"},
            "현재 가격이 요구하는 성장·마진 가정 확인",
            "현재 가격이 요구하는 성장·마진과 기대수익 근거",
        ),
    ]

    context = _portfolio_context(queue_row)
    portfolio_gates = [
        _gate(
            "current_position_weight", "현재 종목 비중",
            isinstance(context.get("position_weight_pct"), (int, float)),
            f"현재 비중 {context.get('position_weight_pct')}%",
            "현재 종목 비중",
        ),
        _gate(
            "overlap_and_concentration", "중복 노출·집중 위험",
            context.get("overlap_reviewed") is True,
            "사업·요인 중복 노출 검토 완료",
            "주요 보유종목과 사업·요인 중복 검토",
        ),
        _gate(
            "cash_and_staging_capacity", "현금·분할매수 여력",
            isinstance(context.get("cash_weight_pct"), (int, float))
            or context.get("staging_capacity_reviewed") is True,
            "현금 또는 분할집행 여력 확인",
            "현금 비중 또는 분할집행 여력",
        ),
        _gate(
            "investment_horizon_and_loss_tolerance", "투자기간·손실 감내",
            bool(context.get("investment_horizon"))
            and bool(context.get("loss_tolerance")),
            "투자기간과 손실 감내 범위 확인",
            "투자기간과 감내 가능한 변동·손실 범위",
        ),
    ]
    return {
        "policy_schema_version": policy["schema_version"],
        "policy_name": policy.get("policy_name"),
        "decision_sequence": list(policy["decision_sequence"]),
        "evidence_classes": list(policy.get("evidence_classes") or []),
        "company_quality": _gate_summary(quality_gates),
        "stock_attractiveness": _gate_summary(valuation_gates),
        "portfolio_fit": _gate_summary(portfolio_gates),
        "source_gap_count": len(evidence_gaps),
    }


def conditional_action(
    policy: dict[str, Any], framework: dict[str, Any],
    confirmation_conditions: list[Any], invalidation_conditions: list[Any],
) -> dict[str, Any]:
    decisions = [framework[name] for name in (
        "company_quality", "stock_attractiveness", "portfolio_fit",
    )]
    incomplete = [name for name in (
        "company_quality", "stock_attractiveness", "portfolio_fit",
    ) if framework[name]["status"] != "complete"]
    action_policy = policy.get("conditional_action") or {}
    grade = action_policy.get("default_when_any_decision_is_incomplete", "관망")
    if incomplete:
        reason = "기업의 질·현재 가격·포트폴리오 적합성 중 미완성 판단이 있어 관망합니다."
    else:
        reason = "세 판단의 필수 근거가 충족됐습니다. 자동 매매 지시 없이 담당자 조건부 검토를 기다립니다."
    missing_labels = [
        gate["label"]
        for decision in decisions
        for gate in decision["gates"]
        if gate["status"] != "met"
    ]
    return {
        "grade": grade,
        "reason": reason,
        "incomplete_decisions": incomplete,
        "next_required_evidence": missing_labels[:8],
        "confirmation_conditions": _unique_text(confirmation_conditions),
        "invalidation_conditions": _unique_text(invalidation_conditions),
        "automatic_position_action": False,
        "ready_for_analyst_review": not incomplete,
    }


def _unique_text(values: list[Any]) -> list[str]:
    result = []
    for value in values:
        text = str(value or "").strip()
        if text and text not in result:
            result.append(text)
    return result
