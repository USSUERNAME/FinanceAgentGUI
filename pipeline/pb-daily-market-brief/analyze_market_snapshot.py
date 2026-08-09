"""Use one schema-constrained OpenAI call to interpret the daily market snapshot."""

from __future__ import annotations

import argparse
import copy
import json
import os
import time
from datetime import date
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from collectors.common import ROOT, load_dotenv
from track_daily_hypotheses import metric_values


DRIVER_SCHEMA = {
    "type": "object",
    "properties": {
        "observation": {"type": "string"},
        "interpretation": {"type": "string"},
        "confirmation_condition": {"type": "string"},
        "invalidation_condition": {"type": "string"},
    },
    "required": ["observation", "interpretation", "confirmation_condition", "invalidation_condition"],
    "additionalProperties": False,
}

STOCK_ANALYSIS_CARD_SCHEMA = {
    "type": "object",
    "properties": {
        "ticker": {"type": "string"},
        "selection_reason": {"type": "string"},
        "market_reaction_interpretation": {"type": "string"},
        "sector_read_through": {"type": "string"},
        "confirmation_condition": {"type": "string"},
        "invalidation_condition": {"type": "string"},
        "evidence_status": {
            "type": "string",
            "enum": ["verified_primary_facts"],
        },
        "action_posture": {
            "type": "string",
            "enum": ["deeper_research_candidate"],
        },
    },
    "required": [
        "ticker", "selection_reason", "market_reaction_interpretation",
        "sector_read_through", "confirmation_condition",
        "invalidation_condition", "evidence_status", "action_posture",
    ],
    "additionalProperties": False,
}

HYPOTHESIS_SCHEMA = {
    "type": "object",
    "properties": {
        "claim": {"type": "string"},
        "metric_key": {
            "type": "string",
            "enum": [
                "rsp_vs_spy_5d_pct", "vix_term_ratio", "high_yield_oas",
                "real_10y", "spy_return_5d_pct",
            ],
        },
        "expected_direction": {"type": "string", "enum": ["increase", "decrease"]},
        "horizon_reports": {"type": "integer", "enum": [1, 3, 5]},
        "rationale": {"type": "string"},
    },
    "required": ["claim", "metric_key", "expected_direction", "horizon_reports", "rationale"],
    "additionalProperties": False,
}

EVENT_SCENARIO_SCHEMA = {
    "type": "object",
    "properties": {
        "event_id": {"type": "string"},
        "baseline": {"type": "string"},
        "higher_or_stronger_case": {"type": "string"},
        "lower_or_weaker_case": {"type": "string"},
        "monitoring_assets": {"type": "array", "items": {"type": "string"}},
        "source_posture": {"type": "string"},
    },
    "required": [
        "event_id", "baseline", "higher_or_stronger_case", "lower_or_weaker_case",
        "monitoring_assets", "source_posture",
    ],
    "additionalProperties": False,
}

ANALYSIS_SCHEMA = {
    "type": "object",
    "properties": {
        "market_regime": {
            "type": "object",
            "properties": {
                "label": {
                    "type": "string",
                    "enum": [
                        "risk_on", "mild_risk_on", "selective_rotation", "mixed",
                        "neutral", "mild_risk_off", "risk_off",
                    ],
                },
                "confidence": {"type": "number", "minimum": 0, "maximum": 1},
                "summary": {"type": "string"},
                "quantitative_evidence": {"type": "array", "items": {"type": "string"}},
            },
            "required": ["label", "confidence", "summary", "quantitative_evidence"],
            "additionalProperties": False,
        },
        "key_drivers": {"type": "array", "items": DRIVER_SCHEMA},
        "hypotheses": {"type": "array", "items": HYPOTHESIS_SCHEMA},
        "event_scenarios": {"type": "array", "items": EVENT_SCENARIO_SCHEMA},
        "stock_analysis_cards": {
            "type": "array",
            "items": STOCK_ANALYSIS_CARD_SCHEMA,
            "maxItems": 3,
        },
        "conflicting_signals": {"type": "array", "items": {"type": "string"}},
        "top_risks": {"type": "array", "items": {"type": "string"}},
        "data_warnings": {"type": "array", "items": {"type": "string"}},
    },
    "required": [
        "market_regime", "key_drivers", "hypotheses", "event_scenarios",
        "stock_analysis_cards",
        "conflicting_signals", "top_risks", "data_warnings",
    ],
    "additionalProperties": False,
}

HYPOTHESIS_FALLBACKS = {
    "rsp_vs_spy_5d_pct": ("시장 폭 개선 여부", "increase"),
    "vix_term_ratio": ("변동성 기간구조 정상화 여부", "decrease"),
    "high_yield_oas": ("신용 위험 완화 여부", "decrease"),
    "real_10y": ("실질금리 부담 완화 여부", "decrease"),
    "spy_return_5d_pct": ("미국 주식의 단기 흐름 개선 여부", "increase"),
}


class RetryableMarketAnalysisError(RuntimeError):
    """A temporary OpenAI transport or service failure safe to retry."""


def response_text(payload: dict[str, Any]) -> str:
    if payload.get("output_text"):
        return str(payload["output_text"]).strip()
    parts: list[str] = []
    for output in payload.get("output", []):
        for content in output.get("content", []):
            if content.get("type") == "output_text":
                parts.append(content.get("text", ""))
    return "\n".join(parts).strip()


def available_hypothesis_metrics(snapshot: dict[str, Any]) -> dict[str, float]:
    return {
        key: value for key, value in metric_values(snapshot).items()
        if value is not None
    }


def analysis_schema_for(snapshot: dict[str, Any]) -> dict[str, Any]:
    schema = copy.deepcopy(ANALYSIS_SCHEMA)
    allowed = list(available_hypothesis_metrics(snapshot))
    schema["properties"]["hypotheses"]["items"]["properties"]["metric_key"]["enum"] = allowed
    deep_tickers = [
        str(item.get("ticker"))
        for item in (
            (snapshot.get("us_equity_candidate_screen") or {})
            .get("deep_analysis_shortlist", [])
        )[:3]
        if item.get("ticker")
    ]
    cards = schema["properties"]["stock_analysis_cards"]
    cards["minItems"] = len(deep_tickers)
    cards["maxItems"] = len(deep_tickers)
    cards["items"]["properties"]["ticker"]["enum"] = (
        deep_tickers or ["NO_ELIGIBLE_TICKER"]
    )
    return schema


def bounded_us_equity_candidate_screen(snapshot: dict[str, Any]) -> dict[str, Any]:
    payload = snapshot.get("us_equity_candidate_screen") or {}
    candidates = []
    for item in payload.get("candidates", [])[:10]:
        reaction = item.get("market_reaction") or {}
        evidence = []
        for event in item.get("event_evidence", [])[:2]:
            verified_facts = []
            for fact in event.get("verified_facts", [])[:4]:
                verified_facts.append({
                    "fact_id": fact.get("fact_id"),
                    "field": fact.get("field"),
                    "value_text": fact.get("value_text"),
                    "context": str(fact.get("context") or "")[:360],
                    "evidence_status": fact.get("evidence_status"),
                    "evidence_scope": fact.get("evidence_scope"),
                    "source_url": fact.get("source_url"),
                })
            evidence.append({
                "record_id": event.get("record_id"),
                "title": event.get("title"),
                "event_type": event.get("event_type"),
                "official_material_score": event.get("official_material_score"),
                "source_grade": event.get("source_grade"),
                "primary_source_confirmed": event.get("primary_source_confirmed"),
                "evidence_scope": event.get("evidence_scope"),
                "source_url": event.get("source_url"),
                "verified_facts": verified_facts,
            })
        candidates.append({
            "ticker": item.get("ticker"),
            "company_name": item.get("company_name"),
            "selection_score": item.get("selection_score"),
            "score_breakdown": item.get("score_breakdown"),
            "material_candidate": item.get("material_candidate"),
            "deep_analysis_eligible": item.get("deep_analysis_eligible"),
            "selection_reasons": item.get("selection_reasons", []),
            "market_reaction": {
                "return_1d_pct": reaction.get("return_1d_pct"),
                "return_5d_pct": reaction.get("return_5d_pct"),
                "return_20d_pct": reaction.get("return_20d_pct"),
                "volume_ratio_20d": reaction.get("volume_ratio_20d"),
                "spy_relative_1d_pct": reaction.get("spy_relative_1d_pct"),
                "spy_relative_5d_pct": reaction.get("spy_relative_5d_pct"),
                "sector_etf": reaction.get("sector_etf"),
                "sector_relative_1d_pct": reaction.get("sector_relative_1d_pct"),
                "sector_return_1d_pct": reaction.get("sector_return_1d_pct"),
            },
            "event_evidence": evidence,
            "evidence_status": item.get("evidence_status"),
            "next_workflow": item.get("next_workflow"),
            "posture": item.get("posture"),
        })
    deep_analysis_tickers = [
        item.get("ticker")
        for item in payload.get("deep_analysis_shortlist", [])[:3]
        if item.get("ticker")
    ]
    return {
        "screen_status": payload.get("screen_status"),
        "universe_security_count": payload.get("universe_security_count"),
        "market_covered_security_count": payload.get("market_covered_security_count"),
        "material_candidate_count": payload.get("material_candidate_count"),
        "deep_analysis_count": payload.get("deep_analysis_count"),
        "market_source": payload.get("market_source"),
        "methodology": payload.get("methodology"),
        "deep_analysis_tickers": deep_analysis_tickers,
        "candidates": candidates,
        "posture": payload.get("posture"),
    }


def bounded_us_market_internals(snapshot: dict[str, Any]) -> dict[str, Any]:
    payload = snapshot.get("us_market_internals") or {}
    sector_horizons = {}
    for horizon in ("1d", "5d", "20d"):
        source = (payload.get("sector_leadership") or {}).get(horizon) or {}
        sector_horizons[horizon] = {
            "leaders": source.get("leaders", [])[:3],
            "laggards": source.get("laggards", [])[:3],
            "all_sectors": [
                {
                    "ticker": row.get("ticker"),
                    "sector": row.get("sector"),
                    "return_pct": row.get("return_pct"),
                    "vs_spy_pct_point": row.get("vs_spy_pct_point"),
                }
                for row in source.get("all_sectors", [])[:11]
            ],
            "positive_return_count": source.get("positive_return_count"),
            "outperforming_spy_count": source.get("outperforming_spy_count"),
            "covered_sector_count": source.get("covered_sector_count"),
            "dispersion_pct_point": source.get("dispersion_pct_point"),
        }
    return {
        "collection_status": payload.get("collection_status"),
        "market_source": payload.get("market_source"),
        "coverage": payload.get("coverage"),
        "market_structure": payload.get("market_structure"),
        "breadth_and_size": payload.get("breadth_and_size", [])[:3],
        "constituent_breadth": payload.get("constituent_breadth"),
        "style_pairs": payload.get("style_pairs", [])[:5],
        "sector_leadership": sector_horizons,
        "data_gaps": payload.get("data_gaps", []),
        "posture": payload.get("posture"),
    }


def bounded_input(snapshot: dict[str, Any]) -> dict[str, Any]:
    records = []
    for item in snapshot.get("records", [])[:30]:
        records.append({
            "source_id": item.get("source_id"),
            "source_type": item.get("source_type"),
            "title": item.get("title"),
            "published_at": item.get("published_at"),
            "tickers": item.get("tickers", []),
            "sector_ids": item.get("sector_ids", []),
            "sector_candidate_ids": item.get("sector_candidate_ids", []),
            "sector_matches": item.get("sector_matches", []),
            "raw_text": str(item.get("raw_text", ""))[:1200],
            "source_grade": item.get("source_grade"),
            "primary_source_confirmed": item.get("primary_source_confirmed"),
            "evidence_scope": item.get("evidence_scope"),
            "evidence_label": item.get("evidence_label"),
            "filing_body": item.get("filing_body"),
            "filing_facts": item.get("filing_facts"),
            "url": item.get("url"),
        })
    structured_events = []
    for event in (snapshot.get("structured_event_evidence") or {}).get("events", [])[:5]:
        structured_events.append({
            "event_id": event.get("event_id"),
            "event_type": event.get("event_type"),
            "representative_title": event.get("representative_title"),
            "evidence_posture": event.get("evidence_posture"),
            "extraction_status": event.get("extraction_status"),
            "facts": event.get("facts", [])[:8],
            "reported_claims": event.get("reported_claims", [])[:8],
            "expectation_gap": event.get("expectation_gap"),
            "market_reaction": event.get("market_reaction"),
            "interpretation_candidates": event.get("interpretation_candidates", [])[:5],
            "conflicts": event.get("conflicts", [])[:5],
        })
    impact_payload = snapshot.get("event_impact_synthesis") or {}
    impact_synthesis = {
        "synthesis_status": impact_payload.get("synthesis_status"),
        "selected_event_ids": impact_payload.get("selected_event_ids", [])[:3],
        "cross_event_summary": impact_payload.get("cross_event_summary"),
        "event_ranking": impact_payload.get("event_ranking", [])[:5],
        "events": impact_payload.get("events", [])[:3],
    }
    return {
        "report_date": snapshot.get("report_date"),
        "data_cutoff": snapshot.get("data_cutoff"),
        "source_status": snapshot.get("source_status"),
        "source_summary": snapshot.get("source_summary"),
        "source_quality": snapshot.get("source_quality"),
        "official_market_calendar": snapshot.get("official_market_calendar"),
        "korea_market": snapshot.get("korea_market"),
        "us_equity_candidate_screen": bounded_us_equity_candidate_screen(snapshot),
        "us_market_internals": bounded_us_market_internals(snapshot),
        "day_over_day_changes": snapshot.get("day_over_day_changes"),
        "market_scoreboard": snapshot.get("market_scoreboard"),
        "upcoming_events": snapshot.get("upcoming_events"),
        "etf_metrics": snapshot.get("etf_metrics"),
        "sector_evidence_connections": snapshot.get("sector_evidence_connections"),
        "sector_snapshot_summary": snapshot.get("sector_snapshot_summary"),
        "structured_event_evidence": structured_events,
        "event_impact_synthesis": impact_synthesis,
        "available_hypothesis_metrics": available_hypothesis_metrics(snapshot),
        "calculation_warnings": snapshot.get("calculation_warnings"),
        "records": records,
    }


def validate_analysis(analysis: dict[str, Any], snapshot: dict[str, Any] | None = None) -> None:
    regime = analysis.get("market_regime", {})
    evidence = regime.get("quantitative_evidence", [])
    if len(evidence) < 2:
        raise ValueError("Market regime must cite at least two quantitative observations")
    if not 1 <= len(analysis.get("key_drivers", [])) <= 3:
        raise ValueError("Market analysis must contain one to three key drivers")
    if not 1 <= len(analysis.get("hypotheses", [])) <= 2:
        raise ValueError("Market analysis must contain one or two falsifiable hypotheses")
    if snapshot is not None:
        available_metrics = {key for key, value in metric_values(snapshot).items() if value is not None}
        invalid_metrics = [
            item.get("metric_key") for item in analysis.get("hypotheses", [])
            if item.get("metric_key") not in available_metrics
        ]
        if invalid_metrics:
            raise ValueError("Hypotheses reference unavailable metrics: " + ", ".join(invalid_metrics))
        valid_event_ids = {item.get("event_id") for item in snapshot.get("upcoming_events", [])}
        invalid_event_ids = [
            item.get("event_id") for item in analysis.get("event_scenarios", [])
            if item.get("event_id") not in valid_event_ids
        ]
        if invalid_event_ids:
            raise ValueError("Event scenarios reference unknown events: " + ", ".join(invalid_event_ids))
        returned_event_ids = {item.get("event_id") for item in analysis.get("event_scenarios", [])}
        missing_event_ids = valid_event_ids - returned_event_ids
        if missing_event_ids:
            raise ValueError("Event scenarios are missing supplied events: " + ", ".join(sorted(missing_event_ids)))
        deep_rows = (
            (snapshot.get("us_equity_candidate_screen") or {})
            .get("deep_analysis_shortlist", [])
        )[:3]
        expected_stock_tickers = [
            str(item.get("ticker")) for item in deep_rows if item.get("ticker")
        ]
        returned_stock_tickers = [
            str(item.get("ticker"))
            for item in analysis.get("stock_analysis_cards", [])
        ]
        if returned_stock_tickers != expected_stock_tickers:
            raise ValueError(
                "Stock analysis cards do not match the verified shortlist: "
                + ", ".join(returned_stock_tickers)
            )
        if any(
            row.get("evidence_status") != "primary_facts_available"
            or not any(
                event.get("verified_facts")
                for event in row.get("event_evidence", [])
            )
            for row in deep_rows
        ):
            raise ValueError("Stock analysis shortlist lacks verified primary facts")


def canonicalize_event_scenarios(analysis: dict[str, Any], snapshot: dict[str, Any]) -> None:
    events = {item.get("event_id"): item for item in snapshot.get("upcoming_events", [])}
    for scenario in analysis.get("event_scenarios", []):
        event = events.get(scenario.get("event_id"))
        if not event:
            continue
        consensus = event.get("consensus")
        scenario["baseline"] = str(consensus) if consensus not in (None, "") else "컨센서스 자료 없음"
        scenario["source_posture"] = str(event.get("date_confidence") or "manual_unverified")
        if event.get("monitoring_assets"):
            scenario["monitoring_assets"] = list(event["monitoring_assets"])


def fallback_hypothesis(snapshot: dict[str, Any]) -> dict[str, Any]:
    available = available_hypothesis_metrics(snapshot)
    for metric_key, (label, direction) in HYPOTHESIS_FALLBACKS.items():
        if metric_key in available:
            return {
                "claim": f"다음 리포트에서 {label}를 추적한다.",
                "metric_key": metric_key,
                "expected_direction": direction,
                "horizon_reports": 1,
                "rationale": "모델의 지표 선택 오류 이후 생성한 저확신 규칙 기반 추적 가설이다.",
            }
    raise ValueError("No hypothesis tracking metric is available for deterministic fallback")


def deterministic_fallback_analysis(
    snapshot: dict[str, Any], *, reason: str,
) -> dict[str, Any]:
    """Keep publication available when the optional interpretation call is delayed.

    The fallback deliberately stays low-confidence and only restates structured fields
    already present in the snapshot. It does not create new causal claims.
    """
    available = available_hypothesis_metrics(snapshot)
    evidence = [
        f"{key}={value:g}"
        for key, value in list(available.items())[:2]
    ]
    if len(evidence) < 2:
        evidence.append(f"사용 가능한 가설 추적 지표={len(available)}개")

    rule_signal = (snapshot.get("market_scoreboard") or {}).get("rule_based_signal") or {}
    allowed_labels = set(
        ANALYSIS_SCHEMA["properties"]["market_regime"]["properties"]["label"]["enum"]
    )
    regime_label = str(rule_signal.get("label") or "neutral")
    if regime_label not in allowed_labels:
        regime_label = "neutral"

    scenarios = []
    for event in snapshot.get("upcoming_events", []):
        consensus = event.get("consensus")
        scenarios.append({
            "event_id": str(event.get("event_id") or ""),
            "baseline": str(consensus) if consensus not in (None, "") else "컨센서스 자료 없음",
            "higher_or_stronger_case": "실제 결과가 기준보다 강하면 관련 자산 반응을 확인한다.",
            "lower_or_weaker_case": "실제 결과가 기준보다 약하면 관련 자산 반응을 확인한다.",
            "monitoring_assets": list(event.get("monitoring_assets") or []),
            "source_posture": str(event.get("date_confidence") or "manual_unverified"),
        })

    stock_cards = []
    deep_rows = (
        (snapshot.get("us_equity_candidate_screen") or {})
        .get("deep_analysis_shortlist", [])
    )[:3]
    for row in deep_rows:
        ticker = str(row.get("ticker") or "")
        reaction = row.get("market_reaction") or {}
        observed = []
        for key, label in (
            ("return_1d_pct", "1일 수익률"),
            ("return_5d_pct", "5일 수익률"),
            ("volume_ratio_20d", "20일 대비 거래량 비율"),
        ):
            value = reaction.get(key)
            if isinstance(value, (int, float)) and not isinstance(value, bool):
                observed.append(f"{label} {value:g}")
        reaction_text = ", ".join(observed) or "가격·거래량 관측치 제한"
        sector_etf = str(reaction.get("sector_etf") or "관련 섹터")
        stock_cards.append({
            "ticker": ticker,
            "selection_reason": "공식 1차 자료의 검증 사실이 확보되어 심층 검토 우선순위에 포함됐다.",
            "market_reaction_interpretation": f"{reaction_text}; 공시와 가격 반응의 인과관계는 확정하지 않는다.",
            "sector_read_through": f"{sector_etf} 동행 여부를 조건부로 확인한다.",
            "confirmation_condition": "후속 공식 공시에서 검증 사실이 유지되고 상대강도와 거래량이 함께 확인되는지 본다.",
            "invalidation_condition": "후속 공식 공시가 기존 사실을 뒤집거나 종목 상대강도가 약화되면 우선순위를 재검토한다.",
            "evidence_status": "verified_primary_facts",
            "action_posture": "deeper_research_candidate",
        })

    analysis = {
        "market_regime": {
            "label": regime_label,
            "confidence": 0.2,
            "summary": "모델 응답 지연으로 규칙 기반 신호와 현재 정량 관측치만 표시한다.",
            "quantitative_evidence": evidence,
        },
        "key_drivers": [{
            "observation": evidence[0],
            "interpretation": "단일 관측만으로 방향을 확정하지 않고 후속 데이터와 교차 확인한다.",
            "confirmation_condition": "다음 보고서에서 같은 방향의 정량 지표가 추가로 확인되는지 본다.",
            "invalidation_condition": "후속 관측이 반대 방향으로 전환되면 현재 해석을 폐기한다.",
        }],
        "hypotheses": [fallback_hypothesis(snapshot)],
        "event_scenarios": scenarios,
        "stock_analysis_cards": stock_cards,
        "conflicting_signals": ["모델 해설을 확보하지 못해 신호 간 충돌 평가는 보류한다."],
        "top_risks": ["정량 스냅샷만으로는 사건의 인과관계를 확인할 수 없다."],
        "data_warnings": [
            f"OpenAI 시장 해설 요청이 일시적으로 실패해 저확신 규칙 기반 분석으로 대체했다: {reason}",
        ],
    }
    validate_analysis(analysis, snapshot)
    return analysis


def request_analysis(
    snapshot: dict[str, Any], api_key: str, model: str, instructions: str,
) -> tuple[dict[str, Any], dict[str, Any]]:
    body = json.dumps({
        "model": model,
        "instructions": instructions,
        "input": json.dumps(bounded_input(snapshot), ensure_ascii=False),
        "reasoning": {"effort": "minimal"},
        "text": {"format": {
            "type": "json_schema",
            "name": "daily_market_analysis",
            "description": "Evidence-bound market regime and driver analysis for a Korean daily brief.",
            "strict": True,
            "schema": analysis_schema_for(snapshot),
        }},
        "max_output_tokens": 3600,
        "store": False,
    }, ensure_ascii=False).encode("utf-8")
    request = Request("https://api.openai.com/v1/responses", method="POST", data=body, headers={
        "Authorization": f"Bearer {api_key}", "Content-Type": "application/json",
    })
    timeout_seconds = max(10, int(os.getenv("OPENAI_ANALYSIS_TIMEOUT_SECONDS", "90")))
    try:
        with urlopen(request, timeout=timeout_seconds) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        if exc.code in {408, 409, 429} or exc.code >= 500:
            raise RetryableMarketAnalysisError(
                f"OpenAI market analysis returned retryable HTTP {exc.code}: {detail}"
            ) from exc
        raise SystemExit(f"OpenAI market analysis returned HTTP {exc.code}: {detail}") from exc
    if payload.get("status") == "incomplete":
        reason = (payload.get("incomplete_details") or {}).get("reason", "unknown")
        raise SystemExit(f"OpenAI market analysis was incomplete ({reason}).")
    text = response_text(payload)
    if not text:
        raise SystemExit("OpenAI returned no structured market analysis.")
    return json.loads(text), payload


def analyze(snapshot: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
    api_key = os.getenv("OPENAI_API_KEY", "").strip()
    if not api_key:
        raise SystemExit("Set OPENAI_API_KEY before running market analysis.")
    available_metrics = available_hypothesis_metrics(snapshot)
    if not available_metrics:
        raise SystemExit("No current hypothesis tracking metric is available.")
    model = os.getenv("OPENAI_ANALYSIS_MODEL", "gpt-5-mini").strip()
    instructions = """You are the market-analysis stage of a private Korean securities brief.
Use only the supplied structured snapshot. Do not create prices, economic figures, consensus estimates, causal facts, or article details that are absent from the input.

Interpret the market scoreboard through a public-equity lens. The market regime must cite at least two exact quantitative observations from the supplied scoreboard. Treat the deterministic rule-based signal as one input, not as a conclusion. If breadth, volatility, credit, rates, or ETF signals conflict, record the conflict and reduce confidence.

When day_over_day_changes has status=compared, identify the most decision-relevant
change from the prior report using only its supplied numeric deltas and set changes.
Do not call a missing prior observation unchanged, and do not infer causality from a
day-over-day difference. When status=no_previous_report, omit prior-report claims.

Sector snapshot fields are research-priority inputs, not recommendations. A structural_driver score may be described only as verified policy, rule, forecast, roadmap, or binding-demand support within its stated horizon. A catalyst_durability score measures the confirmed event window, not expected price appreciation. Never reuse either as proof of earnings, orders, market confirmation, or certain future leadership. Call a sector ranked only when leadership_score is non-null.

For each key driver, separate observation, interpretation, confirmation condition, and invalidation condition. Use one to three drivers. Official filings and official data may support facts only within their evidence_scope. NewsAPI metadata is grade D and must not be presented as a confirmed primary-source fact. Do not provide buy/sell advice, targets, or certain predictions. Write all strings in concise Korean."""
    instructions += """

When structured_event_evidence is supplied, preserve its evidence boundaries. Facts marked
verified_primary may be stated as facts; reported_secondary_unverified items must be described
as reports, and interpretation_candidates remain hypotheses. A market_reaction status ending
in context_not_causal is contextual price data only and cannot support causal attribution."""
    instructions += """

When event_impact_synthesis is supplied, treat it as evidence-bound research hypotheses.
Do not promote candidate_unverified sector connections into verified exposure or recommendations.
Preserve watchlist, wait_for_proof, pass, or re_underwrite posture and do not invent issuer names."""
    instructions += """

The U.S. equity candidate screen is a bounded research-prioritization list, not an
investment recommendation or a conviction ranking. Do not describe selection_score
as expected return, quality, or confidence. Only a candidate with
deep_analysis_eligible=true and evidence_status=primary_facts_available may be
discussed as ready for verified company analysis. Metadata-only and grade-D evidence
cannot confirm a company fact. Market-reaction fields are contextual observations and
do not establish that an event caused the price move. Do not create buy/sell advice,
target prices, or unsupported company conclusions.

Return exactly one stock_analysis_card, in supplied shortlist order, for each
deep_analysis_ticker and no card for any other ticker. Use only verified_facts
as the factual baseline. selection_reason explains why research was prioritized,
not why the stock should be owned. market_reaction_interpretation and
sector_read_through must be explicitly conditional hypotheses. Confirmation and
invalidation conditions must use supplied price, relative-return, volume, sector,
or primary-evidence fields and must not invent numeric thresholds. Set
evidence_status to verified_primary_facts and action_posture to
deeper_research_candidate."""
    instructions += """

Use U.S. market internals to distinguish broadening, narrowing, and mixed
rotation. Describe equal-weight, size, and style comparisons by their exact
pair names and supplied 1-day, 5-day, or 20-day relative return; RSP is S&P 500
equal weight and is not direct evidence of mid- or small-cap strength. Sector
leadership is price-return evidence only. Do not infer earnings revisions,
fund flows, investor positioning, or event causality from a sector ranking.
If coverage is partial or stale, state the gap and lower confidence instead of
extrapolating the missing sectors or styles. Treat the deterministic market
structure classification as an observation to test against rates, volatility,
credit, and verified events, not as a standalone conclusion."""
    instructions += """

Create one or two falsifiable hypotheses using only a metric_key whose current value exists in the snapshot. The tracking code supplies the numeric threshold, so do not invent one. Select a 1, 3, or 5-report horizon and state a concise rationale.

Create event scenarios only for supplied upcoming_events. Copy event_id exactly. If consensus is null, baseline must say `컨센서스 자료 없음`; never invent a consensus number. Describe conditional higher/stronger and lower/weaker market transmission, not a certain prediction. If no upcoming event exists, return an empty event_scenarios array."""
    instructions += (
        "\n\nThe only allowed hypothesis metric_key values for this run are: "
        + ", ".join(available_metrics)
        + ". These exact keys and their current values are also supplied in "
        "available_hypothesis_metrics."
    )
    payload: dict[str, Any] = {}
    analysis: dict[str, Any] = {}
    max_attempts = max(1, int(os.getenv("OPENAI_ANALYSIS_MAX_ATTEMPTS", "2")))
    metric_retry = False
    for attempt in range(max_attempts):
        attempt_instructions = instructions
        if metric_retry:
            attempt_instructions += (
                "\n\nYour previous response selected an unavailable hypothesis metric. "
                "Regenerate the full response and select metric_key only from the allowed list."
            )
        try:
            analysis, payload = request_analysis(snapshot, api_key, model, attempt_instructions)
        except (TimeoutError, URLError, RetryableMarketAnalysisError) as exc:
            if attempt + 1 < max_attempts:
                time.sleep(min(2 ** attempt, 4))
                continue
            fallback = deterministic_fallback_analysis(
                snapshot, reason=f"{type(exc).__name__}: {exc}",
            )
            return fallback, {
                "input_tokens": 0,
                "output_tokens": 0,
                "fallback": True,
                "fallback_reason": type(exc).__name__,
                "attempts": max_attempts,
            }
        canonicalize_event_scenarios(analysis, snapshot)
        try:
            validate_analysis(analysis, snapshot)
            return analysis, payload.get("usage", {})
        except ValueError as exc:
            if "Hypotheses reference unavailable metrics" not in str(exc):
                raise
            metric_retry = True

    analysis["hypotheses"] = [fallback_hypothesis(snapshot)]
    warnings = analysis.setdefault("data_warnings", [])
    warnings.append("가설 지표 선택 오류가 반복되어 저확신 규칙 기반 추적 가설로 대체했다.")
    validate_analysis(analysis, snapshot)
    return analysis, payload.get("usage", {})


def main() -> None:
    parser = argparse.ArgumentParser(description="Create schema-constrained market analysis from the daily snapshot.")
    parser.add_argument("--date", default=date.today().isoformat(), help="Report date in YYYY-MM-DD")
    parser.add_argument("--snapshot-file")
    parser.add_argument("--dry-run", action="store_true", help="Validate snapshot and request schema without calling OpenAI")
    args = parser.parse_args()
    load_dotenv()
    snapshot_path = Path(args.snapshot_file) if args.snapshot_file else ROOT / "workspace" / "snapshots" / args.date / "daily_snapshot.json"
    if not snapshot_path.exists():
        raise SystemExit(f"Snapshot does not exist: {snapshot_path}")
    snapshot = json.loads(snapshot_path.read_text(encoding="utf-8"))
    if args.dry_run:
        if snapshot.get("schema_version") != "daily_market_snapshot.v1":
            raise SystemExit("Unexpected snapshot schema version.")
        allowed_metrics = list(available_hypothesis_metrics(snapshot))
        if not allowed_metrics:
            raise SystemExit("No current hypothesis tracking metric is available.")
        analysis_schema_for(snapshot)
        print(
            "Market analysis dry run complete. No OpenAI request was made. "
            f"Allowed hypothesis metrics: {', '.join(allowed_metrics)}"
        )
        return
    analysis, usage = analyze(snapshot)
    output_dir = ROOT / "workspace" / "analysis" / args.date
    output_dir.mkdir(parents=True, exist_ok=True)
    output = output_dir / "market_analysis.json"
    output.write_text(json.dumps({
        "schema_version": "daily_market_analysis.v1",
        "report_date": args.date,
        "analysis": analysis,
        "usage": usage,
    }, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Market analysis saved: {output.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
