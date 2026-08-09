"""Compose a deterministic, reader-facing V2 market note.

This module deliberately excludes operations state, unverified events, model
execution details, and position authority.  It writes a machine-readable
contract plus the Markdown that a later Notion publisher can consume.
"""

from __future__ import annotations

import argparse
import json
import re
from datetime import datetime
from pathlib import Path
from typing import Any, Iterable
from urllib.parse import urlsplit
from zoneinfo import ZoneInfo

from collectors.common import ROOT

SCHEMA_VERSION = "v2_reader_report.v1"
FINAL_MARKER = "<!-- V2_READER_REPORT_COMPLETE -->"
MAX_EXECUTIVE_SUMMARY_ITEMS = 3
MAX_VERIFIED_EVENTS = 5
MAX_ANALYST_RESEARCH = 3
MAX_NEXT_CHECKS = 5
MAX_EARNINGS_WATCH = 8

REGIME_LABELS = {
    "risk_on": "위험선호",
    "mild_risk_on": "완만한 위험선호",
    "neutral": "중립",
    "mixed": "혼재",
    "selective_rotation": "선별적 순환매",
    "mild_risk_off": "완만한 위험회피",
    "risk_off": "위험회피",
}
MARKET_STRUCTURE_LABELS = {
    "broadening": "상승 확산",
    "narrowing": "상승 집중",
    "mixed_rotation": "혼합 순환매",
    "defensive_rotation": "방어적 순환매",
    "insufficient_data": "자료 불충분",
}

INTERNAL_TERMS = (
    "task_id",
    "input_hash",
    "execution_status",
    "execution receipt",
    "evidence_id",
    "source_grade",
    "workspace/",
    "workspace\\",
    "research_execution_pack",
)

PROHIBITED_ACTION_PHRASES = (
    "매수 추천",
    "매도 추천",
    "목표주가",
    "비중 확대",
    "비중 축소",
    "포지션 진입",
    "포지션 청산",
)
RESEARCH_ACTION_REPLACEMENTS = (
    ("매수 추천", "긍정 평가"),
    ("매도 추천", "부정 평가"),
    ("목표주가", "가치평가 기준"),
    ("비중 확대", "긍정적 업종 의견"),
    ("비중확대", "긍정적 업종 의견"),
    ("비중 축소", "보수적 업종 의견"),
    ("비중축소", "보수적 업종 의견"),
    ("포지션 진입", "확인 조건 충족"),
    ("포지션 청산", "가설 재검토"),
)


def load_json(path: Path, *, required: bool = True) -> dict[str, Any]:
    if not path.exists():
        if required:
            raise FileNotFoundError(path)
        return {}
    payload = json.loads(path.read_text(encoding="utf-8-sig"))
    if not isinstance(payload, dict):
        raise ValueError(f"Expected a JSON object: {path}")
    return payload


def _number(value: Any) -> float | None:
    if isinstance(value, bool):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _pct(value: Any, *, suffix: str = "%p") -> str | None:
    number = _number(value)
    if number is None:
        return None
    return f"{number:+.2f}{suffix}"


def _bp(value: Any) -> str | None:
    number = _number(value)
    if number is None:
        return None
    return f"{number * 100:+.0f}bp"


def _level(value: Any, suffix: str = "") -> str | None:
    number = _number(value)
    if number is None:
        return None
    return f"{number:.2f}{suffix}"


def _is_readable(value: Any) -> bool:
    text = str(value or "").strip()
    if not text:
        return False
    if "\ufffd" in text or "??" in text:
        return False
    # A high density of question marks is a reliable signal for mojibake in
    # legacy Windows-generated Korean artifacts.
    if text.count("?") >= max(2, len(text) // 18):
        return False
    return True


def _clean_text(value: Any) -> str | None:
    if isinstance(value, dict):
        value = (
            value.get("claim")
            or value.get("fact")
            or value.get("summary")
            or value.get("text")
        )
    if not _is_readable(value):
        return None
    return re.sub(r"\s+", " ", str(value).strip())


def _clean_research_text(value: Any) -> str | None:
    text = _clean_text(value)
    if not text:
        return None
    for phrase, replacement in RESEARCH_ACTION_REPLACEMENTS:
        text = text.replace(phrase, replacement)
    return text


def _valid_url(value: Any) -> str | None:
    text = str(value or "").strip()
    parsed = urlsplit(text)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        return None
    return text


def _source(
    *,
    source_id: str,
    title: str,
    url: str,
    as_of: str | None = None,
) -> dict[str, Any]:
    return {
        "source_id": source_id,
        "title": title,
        "url": url,
        "as_of": as_of,
    }


def _dedupe_sources(items: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    seen: set[str] = set()
    for item in items:
        url = _valid_url(item.get("url"))
        if not url or url in seen:
            continue
        seen.add(url)
        result.append({**item, "url": url})
    return result


def _market_summary(market: dict[str, Any]) -> tuple[list[str], list[str]]:
    scoreboard = market.get("scoreboard") or {}
    breadth = scoreboard.get("breadth") or {}
    participation = (scoreboard.get("rule_based_signal") or {}).get(
        "participation"
    ) or {}
    volatility = scoreboard.get("volatility") or {}
    credit = scoreboard.get("credit") or {}
    rates = scoreboard.get("rates") or {}
    nominal = rates.get("nominal_10y") or {}
    real = rates.get("real_10y") or {}
    high_yield = credit.get("high_yield_oas") or {}

    regime_key = str((market.get("regime") or {}).get("label") or "neutral")
    regime = REGIME_LABELS.get(regime_key, "중립")
    rsp_value = _number(breadth.get("rsp_vs_spy_5d_pct"))
    qqq_value = _number(participation.get("qqq_vs_spy_5d_pct"))
    iwm_value = _number(participation.get("iwm_vs_spy_5d_pct"))
    rsp_5d = _pct(rsp_value)
    qqq_5d = _pct(qqq_value)
    iwm_5d = _pct(iwm_value)
    real_level = _level(real.get("value"), "%")
    real_change = _bp(real.get("change_5_sessions"))
    vix_level = _level((volatility.get("vix") or {}).get("value"))
    vix_ratio = _level(volatility.get("vix_term_ratio"))
    hy_change = _bp(high_yield.get("change_5_sessions"))

    evidence = [
        value
        for value in (
            f"RSP/SPY 5일 {rsp_5d}" if rsp_5d else None,
            f"QQQ/SPY 5일 {qqq_5d}" if qqq_5d else None,
            f"IWM/SPY 5일 {iwm_5d}" if iwm_5d else None,
        )
        if value
    ]
    first = f"시장 체제는 **{regime}**로 분류됐다."
    if len(evidence) >= 2:
        first += " " + ", ".join(evidence) + "로 시장 참여의 방향이 엇갈렸다."
    elif evidence:
        first += (
            " 확인 가능한 참여 지표는 "
            + evidence[0]
            + "였으며, 나머지 시장 폭 자료는 부족하다."
        )

    second_parts = [
        f"미국 10년 실질금리 {real_level}({real_change})"
        if real_level and real_change
        else None,
        f"VIX {vix_level}" if vix_level else None,
        f"VIX/3개월물 {vix_ratio}" if vix_ratio else None,
        f"하이일드 스프레드 5일 {hy_change}" if hy_change else None,
    ]
    second_parts = [value for value in second_parts if value]
    second = (
        "금리·변동성·크레딧을 함께 보면 "
        + ", ".join(second_parts)
        + "다."
        if second_parts
        else "금리·변동성·크레딧 비교에 필요한 수치가 충분하지 않다."
    )

    findings = []
    if rsp_5d or qqq_5d or iwm_5d:
        if rsp_value is None:
            participation_title = (
                "동일가중 브레드스가 없어 시장 확산은 판정할 수 없다"
            )
        elif qqq_value is not None and rsp_value > 0 and qqq_value < 0:
            participation_title = "동일가중 확산과 성장주 약세가 엇갈렸다"
        elif rsp_value > 0:
            participation_title = "동일가중 상대강세가 확인됐지만 확산 검증이 더 필요하다"
        elif rsp_value < 0:
            participation_title = "동일가중 상대약세로 시장 확산이 제한됐다"
        else:
            participation_title = "시장 참여 지표만으로 확산 방향을 단정하기 어렵다"
        findings.append(
            {
                "title": participation_title,
                "body": (
                    f"동일가중 대형주의 상대성과는 {rsp_5d or '확인 불가'}, "
                    f"성장주는 {qqq_5d or '확인 불가'}, 소형주는 "
                    f"{iwm_5d or '확인 불가'}였다. 지수 전체의 일방적 "
                    "위험선호보다 자산 내부 순환을 우선 확인할 구간이다."
                ),
            }
        )
    if real_level or vix_level:
        findings.append(
            {
                "title": "높은 실질금리는 성장주 밸류에이션의 제약이다",
                "body": (
                    f"미국 10년 명목금리는 {_level(nominal.get('value'), '%') or '확인 불가'}, "
                    f"실질금리는 {real_level or '확인 불가'}다. "
                    f"다만 VIX는 {vix_level or '확인 불가'}로, 현재 수치만으로 "
                    "광범위한 위험회피를 단정할 수는 없다."
                ),
            }
        )
    return [first, second], findings


def _verified_events(daily_intelligence: dict[str, Any]) -> list[dict[str, Any]]:
    events: list[dict[str, Any]] = []
    for event in (daily_intelligence.get("events") or {}).get("items") or []:
        if not isinstance(event, dict):
            continue
        verification = event.get("verification") or {}
        if not (
            verification.get("primary_fact_confirmed")
            and verification.get("publication_eligible_as_fact")
        ):
            continue
        facts = [
            text
            for text in (
                _clean_text(value) for value in event.get("common_facts") or []
            )
            if text
        ][:6]
        if not facts:
            continue
        event_sources = _dedupe_sources(
            _source(
                source_id=str(item.get("source_id") or "official"),
                title=str(item.get("title") or "공식 원문"),
                url=str(item.get("url") or ""),
                as_of=item.get("published_at"),
            )
            for item in event.get("official_sources") or []
            if isinstance(item, dict)
        )
        impact = event.get("impact_analysis") or {}
        impact_text = next(
            (
                text
                for text in (
                    _clean_text(impact.get(key))
                    for key in (
                        "bottom_line",
                        "market_implication",
                        "korea_implication",
                        "summary",
                    )
                )
                if text
            ),
            None,
        )
        expectation = event.get("expectation_gap") or {}
        expectation_text = next(
            (
                text
                for text in (
                    _clean_text(expectation.get("narrative_gap")),
                    _clean_text(expectation.get("surprise_text")),
                )
                if text
            ),
            None,
        )
        reaction = event.get("market_reaction") or {}
        reaction_text = None
        if reaction.get("causal_attribution_permitted"):
            reaction_text = _clean_text(
                reaction.get("summary") or reaction.get("note")
            )
        events.append(
            {
                "event_id": str(event.get("event_id") or ""),
                "title": _clean_text(event.get("title")) or "검증된 시장 사건",
                "event_type": str(event.get("event_type") or "other"),
                "facts": facts,
                "expectation_gap": expectation_text,
                "impact": impact_text,
                "measured_market_reaction": reaction_text,
                "sources": event_sources,
            }
        )
    return events[:MAX_VERIFIED_EVENTS]


def _korea_section(market: dict[str, Any]) -> dict[str, Any]:
    korea = market.get("korea_transmission_inputs") or {}
    company_payload = market.get("company_korea_transmission") or {}
    gate = korea.get("transmission_gate") or {}
    metrics = korea.get("metrics") or {}
    company_transmissions = []
    for transmission in company_payload.get("transmissions", [])[:6]:
        targets = []
        for target in transmission.get("targets", [])[:8]:
            if target.get("classification") == "rejected":
                continue
            targets.append({
                "ticker": str(target.get("ticker") or ""),
                "company_name": _clean_text(target.get("company_name")),
                "classification": str(target.get("classification") or "watch_candidate"),
                "classification_label": _clean_text(target.get("classification_label")) or "관찰 후보",
                "reason": _clean_text(target.get("reason")),
                "market_confirmation_status": str(target.get("market_confirmation_status") or "not_confirmed"),
                "actionability": str(target.get("actionability") or "research_watchlist_only"),
                "next_required_evidence": [
                    str(item) for item in (target.get("next_required_evidence") or [])[:4]
                    if _clean_text(item)
                ],
                "source_urls": [
                    url for url in (_valid_url(item) for item in (target.get("source_urls") or [])[:6])
                    if url
                ],
            })
        if targets:
            company_transmissions.append({
                "source_ticker": str(transmission.get("source_ticker") or ""),
                "source_company_name": _clean_text(transmission.get("source_company_name")),
                "sector_name_ko": _clean_text(transmission.get("sector_name_ko")),
                "source_signal_label": _clean_text((transmission.get("source_signal") or {}).get("label")),
                "market_confirmation_status": str((transmission.get("market_confirmation") or {}).get("status") or "blocked"),
                "targets": targets,
            })
    if gate.get("status") != "ready":
        return {
            "status": "insufficient",
            "summary": (
                "검증된 KOSPI·KOSDAQ·외국인 수급 데이터가 부족해 "
                "미국 시장 움직임의 국내 전이를 방향성으로 단정하지 않는다. "
                "기업 연결 후보는 수혜주가 아닌 근거 보강용 관찰 목록으로만 표시한다."
            ),
            "metrics": [],
            "company_transmissions": company_transmissions,
        }
    available = []
    for metric in metrics.values():
        if not isinstance(metric, dict):
            continue
        if (
            metric.get("primary_source_confirmed")
            and _number(metric.get("value")) is not None
            and metric.get("status") in {"available", "fresh", "ok"}
        ):
            available.append(
                {
                    "label": _clean_text(metric.get("label"))
                    or str(metric.get("metric_id") or "국내시장 지표"),
                    "value": _number(metric.get("value")),
                    "unit": str(metric.get("unit") or ""),
                    "change_1d_pct": _number(metric.get("change_1d_pct")),
                    "as_of": metric.get("as_of"),
                    "source_url": _valid_url(metric.get("source_url")),
                }
            )
    if not available:
        return {
            "status": "insufficient",
            "summary": "국내시장 전이 판단에 사용할 최신 공식 수치가 없다.",
            "metrics": [],
            "company_transmissions": company_transmissions,
        }
    return {
        "status": "available",
        "summary": (
            "국내시장 연결은 환율·지수·외국인 수급이 같은 방향으로 "
            "확인되는지에 한해 조건부로 해석한다."
        ),
        "metrics": available[:7],
        "company_transmissions": company_transmissions,
    }


def _today_changes(market: dict[str, Any]) -> list[str]:
    changes = market.get("day_over_day_changes") or {}
    if changes.get("status") != "compared":
        return []
    result: list[str] = []
    structure = changes.get("market_structure_change") or {}
    if structure.get("changed"):
        previous_key = str(structure.get("previous") or "")
        current_key = str(structure.get("current") or "")
        previous = MARKET_STRUCTURE_LABELS.get(
            previous_key,
            _clean_text(previous_key) or "이전 분류",
        )
        current = MARKET_STRUCTURE_LABELS.get(
            current_key,
            _clean_text(current_key) or "현재 분류",
        )
        result.append(f"시장 내부 구조가 {previous}에서 {current}로 바뀌었다.")
    leaders = changes.get("sector_leader_changes") or {}
    added = [str(value) for value in leaders.get("added") or [] if value]
    removed = [str(value) for value in leaders.get("removed") or [] if value]
    if added:
        result.append(f"5일 섹터 리더에 {', '.join(added[:4])}가 새로 진입했다.")
    if removed:
        result.append(f"5일 섹터 리더에서 {', '.join(removed[:4])}가 이탈했다.")
    closes = changes.get("etf_close_changes_pct") or {}
    ranked = sorted(
        (
            (str(ticker), number)
            for ticker, value in closes.items()
            if (number := _number(value)) is not None
        ),
        key=lambda pair: abs(pair[1]),
        reverse=True,
    )
    if ranked:
        moves = ", ".join(
            f"{ticker} {value:+.2f}%" for ticker, value in ranked[:3]
        )
        result.append(f"직전 리포트 대비 ETF 종가 변화가 큰 항목은 {moves}다.")
    return result[:5]


def _next_checks(market: dict[str, Any], korea: dict[str, Any]) -> list[str]:
    scoreboard = market.get("scoreboard") or {}
    checks: list[str] = []
    if (scoreboard.get("rates") or {}).get("real_10y"):
        checks.append(
            "미국 10년 실질금리의 추가 상승 여부와 QQQ/SPY 상대강도 반응"
        )
    if (scoreboard.get("breadth") or {}).get("rsp_vs_spy_5d_pct") is not None:
        checks.append(
            "RSP/SPY 상대강세가 1일·5일 구간에서 함께 유지되는지"
        )
    if (scoreboard.get("volatility") or {}).get("vix_term_ratio") is not None:
        checks.append(
            "VIX 단기/3개월물 비율이 1 아래에서 안정적으로 유지되는지"
        )
    if korea.get("status") != "available":
        checks.append(
            "KOSPI·KOSDAQ과 외국인 현물·선물 수급의 최신 공식 데이터 복구"
        )
    for risk in market.get("top_risks") or []:
        text = _clean_text(risk)
        if text and text not in checks:
            checks.append(text)
    return checks[:MAX_NEXT_CHECKS]


def _analyst_research(
    broker_research: dict[str, Any] | None,
    *,
    report_date: str,
) -> list[dict[str, Any]]:
    if not broker_research:
        return []
    if broker_research.get("schema_version") != "broker_research_digest.v1":
        return []
    if str(broker_research.get("report_date") or "") != report_date:
        return []

    results: list[dict[str, Any]] = []
    for item in broker_research.get("reports") or []:
        if not isinstance(item, dict):
            continue
        rights = item.get("rights") or {}
        processing = item.get("processing") or {}
        if rights.get("redistribution_allowed") is not False:
            continue
        if rights.get("full_text_included") is not False:
            continue
        if rights.get("publication_policy") not in {
            "private_analysis_only",
            "summary_and_link_only",
        }:
            continue
        if not processing.get("structured_analysis_available"):
            continue

        title = _clean_research_text(item.get("title"))
        summary = _clean_research_text(item.get("summary"))
        if not title or not summary:
            continue
        source = item.get("source") or {}
        results.append(
            {
                "report_id": str(item.get("report_id") or ""),
                "publisher": _clean_research_text(item.get("publisher"))
                or "증권사 리서치",
                "analyst": _clean_research_text(item.get("analyst")),
                "title": title,
                "published_at": item.get("published_at"),
                "report_type": str(item.get("report_type") or "research"),
                "stance": str(item.get("stance") or "neutral"),
                "tickers": [
                    str(value)
                    for value in item.get("tickers") or []
                    if str(value).strip()
                ][:5],
                "sectors": [
                    str(value)
                    for value in item.get("sectors") or []
                    if _clean_text(value)
                ][:5],
                "summary": summary,
                "key_claims": [
                    text
                    for text in (
                        _clean_research_text(value)
                        for value in item.get("key_claims") or []
                    )
                    if text
                ][:3],
                "catalysts": [
                    text
                    for text in (
                        _clean_research_text(value)
                        for value in item.get("catalysts") or []
                    )
                    if text
                ][:2],
                "risks": [
                    text
                    for text in (
                        _clean_research_text(value)
                        for value in item.get("risks") or []
                    )
                    if text
                ][:2],
                "source": {
                    "reference": _clean_research_text(
                        source.get("reference")
                    ),
                    "url": _valid_url(source.get("url")),
                },
                "rights": {
                    "publication_policy": rights["publication_policy"],
                    "redistribution_allowed": False,
                    "full_text_included": False,
                },
            }
        )
        if len(results) >= MAX_ANALYST_RESEARCH:
            break
    return results


def _earnings_watch(daily_intelligence: dict[str, Any]) -> dict[str, Any]:
    earnings = daily_intelligence.get("earnings") or {}
    companies: list[dict[str, Any]] = []
    for company in earnings.get("companies") or []:
        if not isinstance(company, dict):
            continue
        estimate = company.get("estimate_revision") or {}
        estimate_rows = [
            {
                "metric_id": row.get("metric_id"),
                "period_end": row.get("period_end"),
                "value": row.get("value"),
                "units": row.get("units"),
                "estimate_as_of": row.get("estimate_as_of"),
                "analyst_count": row.get("analyst_count"),
                "revision_pct_30d": row.get("revision_pct_30d"),
                "evidence_label": row.get("evidence_label"),
            }
            for row in estimate.get("rows") or []
            if isinstance(row, dict)
            and row.get("evidence_label") == "third_party_forward_estimate"
        ][:4]
        guidance = [
            {
                "metric_id": row.get("metric_id"),
                "period_end": row.get("period_end"),
                "value_low": row.get("value_low"),
                "value_high": row.get("value_high"),
                "midpoint": row.get("midpoint"),
                "units": row.get("units"),
                "currency": row.get("currency"),
                "estimate_comparison": row.get("estimate_comparison"),
                "evidence_label": row.get("evidence_label"),
            }
            for row in company.get("guidance") or []
            if isinstance(row, dict)
            and row.get("evidence_label") == "issuer_management_claim"
        ][:4]
        historical = [
            {
                "reported_date": row.get("reported_date"),
                "reported_eps": row.get("reported_eps"),
                "estimated_eps": row.get("estimated_eps"),
                "surprise_pct": row.get("surprise_pct"),
                "reaction_pct": row.get("reaction_pct"),
                "window_start": row.get("window_start"),
                "window_end": row.get("window_end"),
            }
            for row in company.get("historical_surprises") or []
            if isinstance(row, dict)
        ][:4]
        companies.append({
            "ticker": str(company.get("ticker") or ""),
            "company_name": _clean_text(company.get("company_name")),
            "upcoming_event": dict(company.get("upcoming_event") or {}),
            "estimate_revision": {
                "status": estimate.get("status"),
                "freeze_as_of": estimate.get("freeze_as_of"),
                "revision_direction": estimate.get("revision_direction"),
                "rows": estimate_rows,
                "label": "제3자 전망치",
            },
            "valuation_screen": dict(company.get("valuation_screen") or {}),
            "guidance": guidance,
            "historical_surprises": historical,
            "latest_verified_result": dict(
                company.get("latest_verified_result") or {}
            ),
            "post_result_estimate_revision": dict(
                company.get("post_result_estimate_revision") or {}
            ),
            "long_term_analysis": dict(company.get("long_term_analysis") or {}),
            "sources": _dedupe_sources(
                _source(
                    source_id=str(row.get("source_id") or "earnings"),
                    title=str(row.get("title") or row.get("source_id") or "실적 근거"),
                    url=str(row.get("url") or ""),
                    as_of=row.get("as_of"),
                )
                for row in company.get("source_index") or []
                if isinstance(row, dict) and _valid_url(row.get("url"))
            ),
        })
        if len(companies) >= MAX_EARNINGS_WATCH:
            break
    return {
        "status": earnings.get("status") or "not_available",
        "summary": dict(earnings.get("summary") or {}),
        "companies": companies,
        "labels": {
            "estimate": "제3자 전망치",
            "guidance": "회사 가이던스",
            "result": "공식 원문 확인 실제치",
        },
    }


def build_v2_reader_report(
    daily_intelligence: dict[str, Any],
    *,
    broker_research: dict[str, Any] | None = None,
    generated_at: str | None = None,
) -> dict[str, Any]:
    if (
        daily_intelligence.get("schema_version")
        != "daily_market_intelligence.v2"
    ):
        raise ValueError("Unsupported Daily Intelligence input schema")
    report_date = str(daily_intelligence.get("report_date") or "")
    datetime.fromisoformat(report_date)
    market = daily_intelligence.get("market") or {}
    events = _verified_events(daily_intelligence)
    analyst_research = _analyst_research(
        broker_research,
        report_date=report_date,
    )
    earnings_watch = _earnings_watch(daily_intelligence)
    executive_summary, findings = _market_summary(market)
    if events:
        executive_summary.append(
            f"공식 원문 사실 확인을 통과한 신규 사건은 {len(events)}건이며, "
            "확인된 사실과 해석을 분리해 제시한다."
        )
    else:
        executive_summary.append(
            "공식 원문 사실 확인을 통과한 신규 사건은 없어, "
            "미확인 뉴스 해석은 독자 본문에서 제외했다."
        )
    korea = _korea_section(market)
    sources: list[dict[str, Any]] = []
    scoreboard = market.get("scoreboard") or {}
    for group in ("rates", "volatility", "credit"):
        for item in (scoreboard.get(group) or {}).values():
            if not isinstance(item, dict) or not item.get("series_id"):
                continue
            series_id = str(item["series_id"])
            sources.append(
                _source(
                    source_id=f"fred:{series_id}",
                    title=str(item.get("label") or series_id),
                    url=f"https://fred.stlouisfed.org/series/{series_id}",
                    as_of=item.get("as_of"),
                )
            )
    for event in events:
        sources.extend(event["sources"])
    for company in earnings_watch["companies"]:
        sources.extend(company["sources"])
    for metric in korea.get("metrics") or []:
        if metric.get("source_url"):
            sources.append(
                _source(
                    source_id=f"korea:{metric['label']}",
                    title=str(metric["label"]),
                    url=str(metric["source_url"]),
                    as_of=metric.get("as_of"),
                )
            )
    for transmission in korea.get("company_transmissions") or []:
        for target in transmission.get("targets") or []:
            for index, url in enumerate(target.get("source_urls") or []):
                sources.append(_source(
                    source_id=f"korea-company:{target.get('ticker')}:{index + 1}",
                    title=f"{target.get('company_name') or target.get('ticker')} 공식 사업·관계 근거",
                    url=str(url),
                ))
    cutoff = market.get("data_cutoff") or {}
    warnings = [
        text
        for text in (
            _clean_text(value)
            for value in (daily_intelligence.get("source_state") or {}).get(
                "data_warnings"
            )
            or []
        )
        if text
    ][:3]
    report = {
        "schema_version": SCHEMA_VERSION,
        "report_date": report_date,
        "generated_at": generated_at
        or datetime.now(ZoneInfo("Asia/Seoul")).isoformat(),
        "title": f"{report_date} Daily Market Intelligence",
        "executive_summary": executive_summary[
            :MAX_EXECUTIVE_SUMMARY_ITEMS
        ],
        "market_findings": findings,
        "today_changes": _today_changes(market),
        "verified_events": events,
        "analyst_research": analyst_research,
        "earnings_watch": earnings_watch,
        "korea_connection": korea,
        "next_checks": _next_checks(market, korea),
        "data_status": {
            "latest_price_as_of": cutoff.get("latest_price_as_of"),
            "verified_event_count": len(events),
            "korea_data_status": korea["status"],
            "warnings": warnings,
        },
        "sources": _dedupe_sources(sources),
        "policy": {
            "reader_facing": True,
            "verified_events_only": True,
            "unverified_claims_excluded": True,
            "model_invocation_performed": False,
            "automatic_publication": False,
            "automatic_memory_mutation": False,
            "position_actions_allowed": False,
        },
    }
    validate_v2_reader_report(report)
    return report


def validate_v2_reader_report(report: dict[str, Any]) -> None:
    if report.get("schema_version") != SCHEMA_VERSION:
        raise ValueError("Unsupported V2 reader report schema")
    datetime.fromisoformat(str(report.get("report_date") or ""))
    if not 1 <= len(report.get("executive_summary") or []) <= 3:
        raise ValueError("V2 reader report requires one to three summary items")
    events = report.get("verified_events") or []
    if len(events) > MAX_VERIFIED_EVENTS:
        raise ValueError("V2 reader event limit exceeded")
    for event in events:
        if not event.get("facts"):
            raise ValueError("Reader events require verified facts")
        if not event.get("sources"):
            raise ValueError("Reader events require official source links")
    analyst_research = report.get("analyst_research") or []
    if len(analyst_research) > MAX_ANALYST_RESEARCH:
        raise ValueError("V2 reader analyst research limit exceeded")
    for item in analyst_research:
        rights = item.get("rights") or {}
        if (
            rights.get("redistribution_allowed") is not False
            or rights.get("full_text_included") is not False
            or rights.get("publication_policy")
            not in {"private_analysis_only", "summary_and_link_only"}
        ):
            raise ValueError("Analyst research violates redistribution policy")
        if "raw_text" in item:
            raise ValueError("Analyst research raw text cannot be published")
        if not item.get("title") or not item.get("summary"):
            raise ValueError("Analyst research requires title and summary")
    earnings = report.get("earnings_watch") or {}
    if len(earnings.get("companies") or []) > MAX_EARNINGS_WATCH:
        raise ValueError("V2 reader earnings watch limit exceeded")
    for company in earnings.get("companies") or []:
        for row in (company.get("estimate_revision") or {}).get("rows", []):
            if row.get("evidence_label") != "third_party_forward_estimate":
                raise ValueError("Reader estimate must remain third-party")
        for row in company.get("guidance") or []:
            if row.get("evidence_label") != "issuer_management_claim":
                raise ValueError("Reader guidance must remain issuer claim")
    analyst_serialized = json.dumps(
        analyst_research,
        ensure_ascii=False,
    )
    for phrase in PROHIBITED_ACTION_PHRASES:
        if phrase in analyst_serialized:
            raise ValueError(
                f"Analyst research contains position-action language: {phrase}"
            )
    for item in report.get("sources") or []:
        if not _valid_url(item.get("url")):
            raise ValueError("Reader source URL must be canonical HTTP(S)")
    policy = report.get("policy") or {}
    if (
        not policy.get("reader_facing")
        or not policy.get("verified_events_only")
        or not policy.get("unverified_claims_excluded")
        or policy.get("model_invocation_performed")
        or policy.get("automatic_publication")
        or policy.get("automatic_memory_mutation")
        or policy.get("position_actions_allowed")
    ):
        raise ValueError("V2 reader report violates publication policy")


def render_v2_reader_markdown(report: dict[str, Any]) -> str:
    validate_v2_reader_report(report)
    lines = [
        f"# {report['title']}",
        "",
        "## 30초 결론",
        "",
    ]
    for item in report["executive_summary"]:
        lines.append(f"- {item}")
    if report.get("market_findings"):
        lines.extend(["", "## 시장과 섹터 흐름", ""])
        for finding in report["market_findings"]:
            lines.extend(
                [
                    f"### {finding['title']}",
                    "",
                    str(finding["body"]),
                    "",
                ]
            )
    if report.get("today_changes"):
        lines.extend(["## 오늘 달라진 것", ""])
        lines.extend(f"- {item}" for item in report["today_changes"])
        lines.append("")
    lines.extend(["## 검증된 핵심 사건", ""])
    if not report["verified_events"]:
        lines.extend(
            [
                "공식 원문 사실 확인과 구조화 추출을 모두 통과한 신규 사건이 "
                "없어 미확인 기사와 관점은 본문에서 제외했다.",
                "",
            ]
        )
    for index, event in enumerate(report["verified_events"], start=1):
        lines.extend([f"### {index}. {event['title']}", "", "**확인된 사실**", ""])
        lines.extend(f"- {fact}" for fact in event["facts"])
        if event.get("expectation_gap"):
            lines.extend(
                ["", f"**예상과 달라진 점:** {event['expectation_gap']}"]
            )
        if event.get("impact"):
            lines.extend(["", f"**시장 의미:** {event['impact']}"])
        if event.get("measured_market_reaction"):
            lines.extend(
                ["", f"**측정된 시장 반응:** {event['measured_market_reaction']}"]
            )
        lines.append("")
    earnings_watch = report.get("earnings_watch") or {}
    if earnings_watch.get("companies"):
        lines.extend(
            [
                "## 실적·가이던스·추정치 변화",
                "",
                "전망치는 제3자 전망치, 가이던스는 회사 주장, 실제치는 "
                "공식 원문 확인 값으로 구분한다.",
                "",
            ]
        )
        revision_labels = {
            "positive_revision": "상향",
            "negative_revision": "하향",
            "mixed_revision": "혼조",
            "insufficient_detail": "판정 자료 부족",
            "not_available": "자료 없음",
        }
        for company in earnings_watch["companies"]:
            heading = " · ".join(
                value for value in (
                    company.get("ticker"),
                    company.get("company_name"),
                ) if value
            )
            lines.extend([f"### {heading or '실적 관찰 종목'}", ""])
            event = company.get("upcoming_event") or {}
            if event.get("event_date"):
                confidence = (
                    "공식 확인"
                    if event.get("confidence") == "confirmed"
                    else "예상 일정"
                )
                lines.append(
                    f"- **다음 실적일:** {event['event_date']} ({confidence})"
                )
            estimate = company.get("estimate_revision") or {}
            if estimate.get("rows"):
                direction = revision_labels.get(
                    str(estimate.get("revision_direction") or ""),
                    "판정 자료 부족",
                )
                lines.append(
                    f"- **제3자 전망치 변화:** {direction} "
                    f"(기준 {estimate.get('freeze_as_of') or '확인 불가'})"
                )
                for row in estimate["rows"][:2]:
                    revision = _number(row.get("revision_pct_30d"))
                    revision_text = (
                        f", 30일 {revision:+.2f}%" if revision is not None else ""
                    )
                    lines.append(
                        f"  - {row.get('metric_id') or '지표'} "
                        f"{row.get('period_end') or ''}: "
                        f"{row.get('value')} {row.get('units') or ''}"
                        f"{revision_text}"
                    )
            for guidance in company.get("guidance") or []:
                midpoint = guidance.get("midpoint")
                value_text = (
                    f"{midpoint:,.2f}" if isinstance(midpoint, (int, float))
                    else "범위 확인"
                )
                lines.append(
                    f"- **회사 가이던스:** "
                    f"{guidance.get('metric_id') or '지표'} "
                    f"{guidance.get('period_end') or ''} "
                    f"{value_text} {guidance.get('units') or ''}"
                )
            history = company.get("historical_surprises") or []
            if history:
                latest = history[0]
                surprise = _number(latest.get("surprise_pct"))
                reaction = _number(latest.get("reaction_pct"))
                lines.append(
                    f"- **최근 과거 실적:** EPS 서프라이즈 "
                    f"{surprise:+.2f}%"
                    if surprise is not None
                    else "- **최근 과거 실적:** EPS 서프라이즈 확인 불가"
                )
                if reaction is not None:
                    lines.append(
                        f"  - 발표 전 종가~다음 거래일 종가 반응 "
                        f"{reaction:+.2f}% (인과관계로 단정하지 않음)"
                    )
            post_revision = company.get("post_result_estimate_revision") or {}
            if (
                str(post_revision.get("status") or "").startswith(
                    "not_established"
                )
            ):
                lines.append(
                    "- **발표 후 추정치 변화:** 동일 기간 갱신 전망치 대기"
                )
            long_term = company.get("long_term_analysis") or {}
            if long_term:
                quality = long_term.get("company_quality") or {}
                valuation = long_term.get("stock_attractiveness") or {}
                portfolio = long_term.get("portfolio_fit") or {}
                summary = (
                    (long_term.get("long_term_financials") or {}).get("summary") or {}
                )
                lines.extend([
                    f"- **기업의 질:** {quality.get('label') or '평가 보류'} — {quality.get('reason') or '근거 보강 대기'}",
                    f"- **현재 주식 매력:** {valuation.get('label') or '평가 보류'} — {valuation.get('reason') or '가격·기대 근거 보강 대기'}",
                    f"- **포트폴리오 적합성:** {portfolio.get('label') or '평가 보류'} — {portfolio.get('reason') or '비중·집중도 정보 대기'}",
                    "- **5개년 핵심 지표:** "
                    f"매출 CAGR {summary.get('revenue_cagr_pct') if summary.get('revenue_cagr_pct') is not None else '확인 불가'}% · "
                    f"영업이익 CAGR {summary.get('operating_income_cagr_pct') if summary.get('operating_income_cagr_pct') is not None else '확인 불가'}% · "
                    f"FCF CAGR {summary.get('fcf_cagr_pct') if summary.get('fcf_cagr_pct') is not None else '확인 불가'}%",
                ])
                scorecard = long_term.get("scorecard") or {}
                if scorecard.get("overall_score") is None:
                    lines.append(
                        f"- **기업 종합점수:** 평가 보류 — {scorecard.get('reason') or '필수 근거 미완성'}"
                    )
                framework = long_term.get("judgment_framework") or {}
                decision_labels = {
                    "company_quality": "기업의 질",
                    "stock_attractiveness": "현재 주식 매력",
                    "portfolio_fit": "포트폴리오 적합성",
                }
                if framework:
                    lines.append("- **판단 원칙 충족도:**")
                    for key in (
                        "company_quality", "stock_attractiveness", "portfolio_fit",
                    ):
                        decision = framework.get(key) or {}
                        lines.append(
                            f"  - {decision_labels[key]} "
                            f"{decision.get('met_count', 0)}/{decision.get('required_count', 0)}"
                        )
                    missing = (long_term.get("action") or {}).get(
                        "next_required_evidence"
                    ) or []
                    if missing:
                        lines.append(
                            f"- **다음 근거:** {' · '.join(str(item) for item in missing[:4])}"
                        )
                action = long_term.get("action") or {}
                if action:
                    lines.append(
                        f"- **조건부 행동:** {action.get('grade') or '관망'} — "
                        f"{action.get('reason') or '담당자 검토 대기'}"
                    )
            lines.append("")
    if report.get("analyst_research"):
        lines.extend(["## 애널리스트 리서치", ""])
        lines.extend(
            [
                "사용자가 제공한 리서치 원문은 재배포하지 않고, "
                "구조화된 요약과 점검 항목만 제시한다.",
                "",
            ]
        )
        stance_labels = {
            "positive": "긍정",
            "neutral": "중립",
            "cautious": "경계",
            "negative": "부정",
        }
        for item in report["analyst_research"]:
            attribution = " · ".join(
                value
                for value in (item.get("publisher"), item.get("analyst"))
                if value
            )
            lines.extend(
                [
                    f"### {attribution} — {item['title']}",
                    "",
                    (
                        f"**관점:** "
                        f"{stance_labels.get(item.get('stance'), '중립')}"
                    ),
                    "",
                    str(item["summary"]),
                    "",
                ]
            )
            if item.get("key_claims"):
                lines.extend(["**핵심 주장**", ""])
                lines.extend(
                    f"- {claim}" for claim in item["key_claims"]
                )
                lines.append("")
            if item.get("catalysts"):
                lines.append(
                    "**촉매:** " + " / ".join(item["catalysts"])
                )
                lines.append("")
            if item.get("risks"):
                lines.append("**위험:** " + " / ".join(item["risks"]))
                lines.append("")
            source = item.get("source") or {}
            if source.get("url"):
                lines.append(
                    f"**출처:** [{source.get('reference') or '원문'}]"
                    f"({source['url']})"
                )
            elif source.get("reference"):
                lines.append(f"**내부 참조:** {source['reference']}")
            lines.append("")
    korea = report["korea_connection"]
    lines.extend(["## 한국시장 연결", "", str(korea["summary"]), ""])
    classification_labels = {
        "direct": "직접 연결",
        "industry": "산업 연결",
        "watch_candidate": "관찰 후보",
        "rejected": "연결 제외",
    }
    for transmission in korea.get("company_transmissions") or []:
        source_name = " · ".join(
            value for value in (
                str(transmission.get("source_ticker") or ""),
                str(transmission.get("source_company_name") or ""),
            ) if value
        )
        lines.append(f"### {source_name} → 한국 {transmission.get('sector_name_ko') or '산업'}")
        lines.append("")
        for target in transmission.get("targets") or []:
            label = classification_labels.get(
                target.get("classification"), target.get("classification_label") or "관찰 후보",
            )
            lines.append(
                f"- **{target.get('ticker')} {target.get('company_name') or ''}: {label}** — "
                f"{target.get('reason') or '근거 보강 대기'}"
            )
        lines.append("")
    if korea["status"] == "available":
        for metric in korea["metrics"]:
            change = _pct(metric.get("change_1d_pct"), suffix="%")
            detail = f"{metric['value']:,.2f} {metric['unit']}".strip()
            if change:
                detail += f" · 1일 {change}"
            lines.append(f"- **{metric['label']}**: {detail}")
        lines.append("")
    lines.extend(["## 다음 24~72시간 확인사항", ""])
    lines.extend(f"- {item}" for item in report["next_checks"])
    status = report["data_status"]
    lines.extend(
        [
            "",
            "## 데이터 상태",
            "",
            (
                f"가격 기준일은 {status.get('latest_price_as_of') or '확인 불가'}, "
                f"공식 사실 확인 사건은 {status['verified_event_count']}건이다. "
                f"한국시장 연결 데이터는 "
                f"{'충분' if status['korea_data_status'] == 'available' else '불충분'}하다."
            ),
            "",
        ]
    )
    if report["sources"]:
        lines.extend(["## 근거 링크", ""])
        for item in report["sources"]:
            as_of = f" · {item['as_of']}" if item.get("as_of") else ""
            lines.append(f"- [{item['title']}]({item['url']}){as_of}")
        lines.append("")
    lines.append(FINAL_MARKER)
    rendered = "\n".join(lines).rstrip() + "\n"
    lowered = rendered.lower()
    for term in INTERNAL_TERMS:
        if term.lower() in lowered:
            raise ValueError(f"Internal term leaked into reader report: {term}")
    for phrase in PROHIBITED_ACTION_PHRASES:
        if phrase in rendered:
            raise ValueError(f"Position-action language is prohibited: {phrase}")
    if not rendered.rstrip().endswith(FINAL_MARKER):
        raise ValueError("V2 reader completion marker is missing")
    return rendered


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Compose the separate V2 reader-facing market report"
    )
    parser.add_argument("--date", required=True)
    args = parser.parse_args()
    intelligence_path = (
        ROOT
        / "workspace"
        / "intelligence"
        / args.date
        / "daily_intelligence.json"
    )
    broker_research_path = (
        ROOT
        / "workspace"
        / "broker_research_digest"
        / args.date
        / "broker_research_digest.json"
    )
    report = build_v2_reader_report(
        load_json(intelligence_path),
        broker_research=load_json(broker_research_path, required=False),
    )
    output_dir = ROOT / "workspace" / "v2_reader_reports" / args.date
    output_dir.mkdir(parents=True, exist_ok=True)
    json_path = output_dir / "reader_report.json"
    markdown_path = output_dir / "reader_report.md"
    json_path.write_text(
        json.dumps(report, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    markdown_path.write_text(
        render_v2_reader_markdown(report),
        encoding="utf-8",
    )
    print(f"V2 reader JSON saved: {json_path.relative_to(ROOT)}")
    print(f"V2 reader Markdown saved: {markdown_path.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
