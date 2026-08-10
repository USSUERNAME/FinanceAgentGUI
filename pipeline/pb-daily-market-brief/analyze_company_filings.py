"""Build bounded, US-first SEC filing summaries for notable company candidates."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any, Callable
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo

from collectors.common import ROOT, load_dotenv


SCHEMA_VERSION = "company_filing_summaries.v1"
PROMPT_VERSION = "company_filing_summary.2026-08-10.v1"
MAX_COMPANIES = 4
MAX_METRICS = 13
MAX_EXCERPT_CHARS = 2_500
MAX_NEWS_ITEMS = 6
THESIS_EFFECTS = {"supports", "challenges", "mixed", "insufficient_evidence"}

METRIC_LABELS_KO = {
    "revenue": "매출",
    "operating_income": "영업이익",
    "net_income": "순이익",
    "operating_cash_flow": "영업현금흐름",
    "capital_expenditures": "설비투자",
    "share_repurchases": "자사주 매입",
    "share_issuance": "주식 발행",
    "diluted_shares": "희석주식수",
    "assets": "자산총계",
    "liabilities": "부채총계",
    "current_assets": "유동자산",
    "current_liabilities": "유동부채",
    "stockholders_equity": "자본총계",
}

INSTRUCTIONS = """당신은 미국 상장기업 공시 분석가다. 제공된 SEC 공시 근거만 사용해 한국어로 요약한다.
- XBRL 수치는 사실로 취급하되 form, filed_date, period_start/end, unit을 유지한다.
- 서로 다른 기간의 수치를 성장률로 비교하지 않는다.
- 전년동기 증감률은 prior_year_comparison.status가 available_exact_period_and_unit인 수치만 사용한다.
- 재무비율은 financial_comparison에 표시된 공식 수치 기반 계산만 사용하고 ROE·ROA를 임의 연환산하지 않는다.
- annual_business_baseline과 annual_risk_baseline은 최신 10-Q의 변화가 아니라 최근 10-K의 기준선이다.
- 산업 동향은 industry_context의 회사 공시 기준선과 검증 상태를 구분한다. 회사 주장만으로 시장점유율이나 경쟁우위를 확정하지 않는다.
- 최근 뉴스는 recent_news_evidence의 source_id만 인용하고 날짜·출처를 유지한다. 근거가 없으면 빈 목록으로 둔다.
- 회사가 주장한 경쟁우위는 회사 주장으로 표시하고 독립적으로 검증됐다고 말하지 않는다.
- 사실, 계산, 해석을 구분하고 근거가 없으면 '확인 불가'로 둔다.
- 매수·매도·비중조절을 지시하지 않는다. thesis_effect는 분석가 검토 후보일 뿐 자동 투자판단 변경이 아니다.
- 간결하고 자연스러운 한국어를 사용한다."""


def _load(path: Path, *, required: bool = True) -> dict[str, Any]:
    if not path.exists():
        if required:
            raise FileNotFoundError(path)
        return {}
    value = json.loads(path.read_text(encoding="utf-8-sig"))
    if not isinstance(value, dict):
        raise ValueError(f"Expected JSON object: {path}")
    return value


def _text(value: Any, limit: int) -> str:
    return " ".join(str(value or "").split())[:limit]


def _latest_filing_metrics(company: dict[str, Any]) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    rows = [row for row in company.get("reported_metrics") or [] if isinstance(row, dict)]
    filing_rows = [row for row in rows if row.get("filed_date") and row.get("accession_number")]
    if not filing_rows:
        return {}, []
    latest = max(
        filing_rows,
        key=lambda row: (
            str(row.get("filed_date") or ""),
            1 if str(row.get("form") or "") in {"10-Q", "10-K"} else 0,
        ),
    )
    accession = str(latest.get("accession_number") or "")
    selected = [row for row in filing_rows if str(row.get("accession_number") or "") == accession]
    selected.sort(key=lambda row: list(METRIC_LABELS_KO).index(row.get("metric_id")) if row.get("metric_id") in METRIC_LABELS_KO else 99)
    filing = {
        "form": str(latest.get("form") or ""),
        "filed_date": str(latest.get("filed_date") or ""),
        "fiscal_year": latest.get("fiscal_year"),
        "fiscal_period": str(latest.get("fiscal_period") or ""),
        "period_end": str(latest.get("period_end") or ""),
        "accession_number": accession,
        "source_url": str(latest.get("source_url") or ""),
    }
    return filing, selected[:MAX_METRICS]


def _ratio_row(
    metric_id: str,
    label_ko: str,
    numerator: dict[str, Any] | None,
    denominator: dict[str, Any] | None,
) -> dict[str, Any] | None:
    if not numerator or not denominator:
        return None
    if numerator.get("period_end") != denominator.get("period_end") or numerator.get("unit") != denominator.get("unit"):
        return None
    try:
        numerator_value = float(numerator.get("value"))
        denominator_value = float(denominator.get("value"))
    except (TypeError, ValueError):
        return None
    if denominator_value == 0:
        return None
    prior_num = numerator.get("prior_year_comparison") or {}
    prior_den = denominator.get("prior_year_comparison") or {}
    prior_value = None
    change_pct = None
    if (
        prior_num.get("status") == "available_exact_period_and_unit"
        and prior_den.get("status") == "available_exact_period_and_unit"
        and prior_num.get("period_end") == prior_den.get("period_end")
    ):
        try:
            prior_denominator = float(prior_den.get("value"))
            if prior_denominator:
                prior_value = round(float(prior_num.get("value")) / prior_denominator * 100, 2)
        except (TypeError, ValueError):
            prior_value = None
    value = round(numerator_value / denominator_value * 100, 2)
    if prior_value not in {None, 0}:
        change_pct = round(value - prior_value, 2)
    return {
        "metric_id": metric_id,
        "label_ko": label_ko,
        "value": value,
        "unit": "pct",
        "period_end": str(numerator.get("period_end") or ""),
        "prior_value": prior_value,
        "prior_period_end": str(prior_num.get("period_end") or "") if prior_value is not None else "",
        "change_pct_point": change_pct,
        "evidence_label": "derived_calculation",
        "source_url": str(numerator.get("source_url") or denominator.get("source_url") or ""),
    }


def _financial_comparison(
    metrics: list[dict[str, Any]], segment_financials: dict[str, Any] | None = None,
) -> dict[str, Any]:
    by_id = {str(row.get("metric_id") or ""): row for row in metrics}
    rows: list[dict[str, Any]] = []
    for metric_id in ("revenue", "operating_income", "net_income", "operating_cash_flow"):
        metric = by_id.get(metric_id)
        if not metric:
            continue
        prior = metric.get("prior_year_comparison") or {}
        rows.append({
            "metric_id": metric_id,
            "label_ko": METRIC_LABELS_KO[metric_id],
            "value": metric.get("value"),
            "unit": metric.get("unit"),
            "period_start": metric.get("period_start"),
            "period_end": metric.get("period_end"),
            "prior_value": prior.get("value") if prior.get("status") == "available_exact_period_and_unit" else None,
            "prior_period_start": prior.get("period_start") if prior.get("status") == "available_exact_period_and_unit" else "",
            "prior_period_end": prior.get("period_end") if prior.get("status") == "available_exact_period_and_unit" else "",
            "change_pct": prior.get("change_pct") if prior.get("status") == "available_exact_period_and_unit" else None,
            "comparison_status": prior.get("status") or "not_available",
            "evidence_label": metric.get("evidence_label"),
            "source_url": metric.get("source_url"),
        })
    ratios = [
        _ratio_row("operating_margin", "영업이익률", by_id.get("operating_income"), by_id.get("revenue")),
        _ratio_row("debt_ratio", "부채비율", by_id.get("liabilities"), by_id.get("stockholders_equity")),
        _ratio_row("current_ratio", "유동비율", by_id.get("current_assets"), by_id.get("current_liabilities")),
    ]
    segments = segment_financials or {}
    segment_rows = [dict(row) for row in (segments.get("rows") or [])[:24] if isinstance(row, dict)]
    segment_status = str(segments.get("status") or "not_requested")
    if segment_rows:
        segment_note = "SEC 인라인 XBRL의 동일기간 사업부문·제품군 차원값입니다."
    elif segment_status == "not_disclosed_for_exact_period":
        segment_note = "최신 공시에서 동일기간 사업부문·제품군 XBRL 수치가 확인되지 않았습니다."
    elif segment_status == "collection_failed":
        segment_note = "SEC 사업부문 표 수집이 실패해 다음 실행에서 재시도합니다."
    else:
        segment_note = "사업부문 표 수집이 아직 실행되지 않았습니다."
    return {
        "rows": rows,
        "ratios": [row for row in ratios if row],
        "unavailable_ratios": [
            {"metric_id": "roe", "label_ko": "ROE", "reason_ko": "동일 기준 평균자본과 연환산 순이익 근거가 부족해 계산하지 않았습니다."},
            {"metric_id": "roa", "label_ko": "ROA", "reason_ko": "동일 기준 평균자산과 연환산 순이익 근거가 부족해 계산하지 않았습니다."},
        ],
        "segment_status": segment_status,
        "segment_rows": segment_rows,
        "segment_note_ko": segment_note,
        "calculation_basis_ko": "SEC 동일 기간·동일 단위 공시값 기준. 비율은 표시된 원시 수치에서 계산했습니다.",
    }


def _recent_news_evidence(
    snapshot: dict[str, Any], ticker: str, company_name: str, report_date: str,
) -> list[dict[str, Any]]:
    try:
        cutoff = date.fromisoformat(report_date) - timedelta(days=92)
    except ValueError:
        cutoff = date.min
    legal_tokens = {"inc", "inc.", "corp", "corporation", "class", "technology", "technologies", "the"}
    name_parts = [part.lower().strip(".,/") for part in company_name.split() if part.lower().strip(".,/") not in legal_tokens]
    if name_parts and name_parts[0] in {"trade", "united", "general", "american"}:
        name_phrase = " ".join(name_parts[:2])
    else:
        name_phrase = name_parts[0] if name_parts else ""
    found: list[dict[str, Any]] = []
    for row in snapshot.get("records") or []:
        if not isinstance(row, dict):
            continue
        published = str(row.get("published_at") or row.get("release_date") or row.get("observation_date") or "")[:10]
        try:
            if date.fromisoformat(published) < cutoff:
                continue
        except ValueError:
            continue
        tickers = {str(value).upper() for value in row.get("tickers") or []}
        entities = {str(value).upper() for value in (row.get("triage") or {}).get("entities") or []}
        haystack = f"{row.get('title') or ''} {row.get('raw_text') or ''}".lower()
        if ticker not in tickers and ticker not in entities and (not name_phrase or name_phrase not in haystack):
            continue
        if not (row.get("primary_source_confirmed") is True or str(row.get("source_grade") or "") in {"A", "B", "C"}):
            continue
        source_url = str(row.get("canonical_url") or row.get("url") or "")
        if not source_url.startswith("https://"):
            continue
        found.append({
            "source_id": str(row.get("id") or row.get("source_reference") or ""),
            "date": published,
            "title": _text(row.get("title"), 240),
            "publisher": _text(row.get("publisher") or row.get("source_id"), 100),
            "source_url": source_url,
            "source_type": str(row.get("source_type") or ""),
            "source_grade": str(row.get("source_grade") or ""),
            "evidence_label": str(row.get("evidence_label") or ""),
            "excerpt": _text(row.get("raw_text"), 700),
        })
    found.sort(key=lambda row: row["date"], reverse=True)
    unique: list[dict[str, Any]] = []
    seen: set[str] = set()
    for row in found:
        key = row["source_url"]
        if key in seen:
            continue
        seen.add(key)
        unique.append(row)
    return unique[:MAX_NEWS_ITEMS]


def build_inputs(
    queue: dict[str, Any],
    primary_facts: dict[str, Any],
    primary_narratives: dict[str, Any],
    long_term_profiles: dict[str, Any],
    *,
    snapshot: dict[str, Any] | None = None,
    report_date: str = "",
    max_companies: int = MAX_COMPANIES,
) -> list[dict[str, Any]]:
    queue_by_ticker = {
        str(row.get("ticker") or "").upper(): row
        for row in queue.get("candidates") or []
        if isinstance(row, dict) and str(row.get("market") or "").upper() == "US"
    }
    narrative_by_ticker = {
        str(row.get("ticker") or "").upper(): row
        for row in primary_narratives.get("companies") or []
        if isinstance(row, dict)
    }
    profile_by_ticker = {
        str(row.get("ticker") or "").upper(): row
        for row in long_term_profiles.get("profiles") or []
        if isinstance(row, dict)
    }
    results: list[dict[str, Any]] = []
    for company in primary_facts.get("companies") or []:
        if not isinstance(company, dict):
            continue
        ticker = str(company.get("ticker") or "").upper()
        if not ticker or ticker not in queue_by_ticker:
            continue
        filing, metrics = _latest_filing_metrics(company)
        if not filing:
            continue
        narrative = narrative_by_ticker.get(ticker, {})
        profile = profile_by_ticker.get(ticker, {})
        annual = narrative.get("annual_filing") or {}
        filing_key = f"{ticker}:{filing['accession_number']}"
        normalized_metrics = [{
            "metric_id": str(row.get("metric_id") or ""),
            "label_ko": METRIC_LABELS_KO.get(str(row.get("metric_id") or ""), _text(row.get("label"), 100)),
            "value": row.get("value"),
            "unit": str(row.get("unit") or ""),
            "period_start": str(row.get("period_start") or ""),
            "period_end": str(row.get("period_end") or ""),
            "filed_date": str(row.get("filed_date") or ""),
            "form": str(row.get("form") or ""),
            "evidence_label": str(row.get("evidence_label") or ""),
            "source_url": str(row.get("source_url") or ""),
            "prior_year_comparison": dict(row.get("prior_year_comparison") or {}),
        } for row in metrics]
        competitive = profile.get("competitive_advantage") or {}
        business_exposure = profile.get("business_exposure") or {}
        monitoring = profile.get("monitoring_framework") or {}
        results.append({
            "filing_key": filing_key,
            "ticker": ticker,
            "company_name": _text(company.get("company_name") or queue_by_ticker[ticker].get("company_name"), 180),
            "selection_reason": _text(
                queue_by_ticker[ticker].get("selection_reason")
                or queue_by_ticker[ticker].get("candidate_origin")
                or "미국 개별주 공식근거 분석 후보",
                300,
            ),
            "latest_financial_filing": filing,
            "reported_metrics": normalized_metrics,
            "financial_comparison": _financial_comparison(
                normalized_metrics, company.get("segment_financials") or {},
            ),
            "long_term_financial_summary": dict(
                (profile.get("long_term_financials") or company.get("long_term_financials") or {}).get("summary") or {}
            ),
            "annual_business_baseline": {
                "form": str(annual.get("form") or ""),
                "filing_date": str(annual.get("filing_date") or ""),
                "body_location": str((narrative.get("business_model") or {}).get("body_location") or ""),
                "excerpt": _text((narrative.get("business_model") or {}).get("excerpt"), MAX_EXCERPT_CHARS),
                "source_url": str(annual.get("source_url") or ""),
            },
            "annual_risk_baseline": {
                "body_location": str((narrative.get("risk_factors") or {}).get("body_location") or ""),
                "excerpt": _text((narrative.get("risk_factors") or {}).get("excerpt"), MAX_EXCERPT_CHARS),
                "source_url": str(annual.get("source_url") or ""),
            },
            "industry_context": {
                "status": "issuer_baseline_and_research_gate",
                "market_dynamics_ko": [value for value in [
                    _text(business_exposure.get("evidence_summary"), 500),
                ] if value],
                "competitive_positioning_ko": [value for value in [
                    _text(competitive.get("reason"), 500),
                ] if value],
                "growth_drivers_ko": [value for value in [
                    _text(monitoring.get("why_now"), 500),
                    _text(monitoring.get("proof_trigger"), 500),
                ] if value],
                "source_urls": [url for url in {
                    str(business_exposure.get("source_url") or ""),
                    str(annual.get("source_url") or ""),
                } if url.startswith("https://")],
                "limitation_ko": "회사 공시 기준선 중심이며 독립 시장점유율·수급·경쟁사 실적 비교가 없으면 확정하지 않습니다.",
            },
            "recent_news_evidence": _recent_news_evidence(
                snapshot or {}, ticker, str(company.get("company_name") or ""), report_date,
            ) if report_date else [],
        })
        if len(results) >= max_companies:
            break
    return results


def _analysis_schema(filing_keys: list[str]) -> dict[str, Any]:
    string_list = {"type": "array", "items": {"type": "string"}, "maxItems": 4}
    industry_analysis = {
        "type": "object",
        "additionalProperties": False,
        "required": ["market_dynamics_ko", "competitive_positioning_ko", "growth_drivers_ko", "outlook_1_2y_ko"],
        "properties": {
            "market_dynamics_ko": string_list,
            "competitive_positioning_ko": string_list,
            "growth_drivers_ko": string_list,
            "outlook_1_2y_ko": string_list,
        },
    }
    news_item = {
        "type": "object",
        "additionalProperties": False,
        "required": ["source_id", "date", "category", "summary_ko"],
        "properties": {
            "source_id": {"type": "string"},
            "date": {"type": "string"},
            "category": {"type": "string", "enum": ["실적", "전략", "투자", "리스크", "기타"]},
            "summary_ko": {"type": "string"},
        },
    }
    return {
        "type": "object",
        "additionalProperties": False,
        "required": ["companies"],
        "properties": {
            "companies": {
                "type": "array",
                "minItems": len(filing_keys),
                "maxItems": len(filing_keys),
                "items": {
                    "type": "object",
                    "additionalProperties": False,
                    "required": [
                        "filing_key", "summary_ko", "financial_takeaways_ko",
                        "business_takeaways_ko", "risks_ko", "thesis_effect",
                        "thesis_effect_reason_ko", "monitoring_points_ko",
                        "financial_change_reasons_ko", "industry_analysis_ko", "recent_news_ko",
                    ],
                    "properties": {
                        "filing_key": {"type": "string", "enum": filing_keys},
                        "summary_ko": {"type": "string"},
                        "financial_takeaways_ko": string_list,
                        "business_takeaways_ko": string_list,
                        "risks_ko": string_list,
                        "thesis_effect": {"type": "string", "enum": sorted(THESIS_EFFECTS)},
                        "thesis_effect_reason_ko": {"type": "string"},
                        "monitoring_points_ko": string_list,
                        "financial_change_reasons_ko": string_list,
                        "industry_analysis_ko": industry_analysis,
                        "recent_news_ko": {"type": "array", "items": news_item, "maxItems": MAX_NEWS_ITEMS},
                    },
                },
            },
        },
    }


def _response_text(payload: dict[str, Any]) -> str:
    for item in payload.get("output") or []:
        for content in item.get("content") or []:
            if content.get("type") == "output_text" and content.get("text"):
                return str(content["text"])
    return ""


def request_analysis(inputs: list[dict[str, Any]], *, api_key: str, model: str) -> tuple[dict[str, Any], dict[str, Any]]:
    filing_keys = [row["filing_key"] for row in inputs]
    body = json.dumps({
        "model": model,
        "instructions": INSTRUCTIONS,
        "input": json.dumps({"companies": inputs}, ensure_ascii=False),
        "reasoning": {"effort": "minimal"},
        "text": {"format": {
            "type": "json_schema",
            "name": "company_filing_summaries",
            "description": "Evidence-bounded Korean summaries of notable US company filings.",
            "strict": True,
            "schema": _analysis_schema(filing_keys),
        }},
        "max_output_tokens": 5000,
        "store": False,
    }, ensure_ascii=False).encode("utf-8")
    request = Request(
        "https://api.openai.com/v1/responses",
        method="POST",
        data=body,
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
    )
    with urlopen(request, timeout=120) as response:
        raw = json.loads(response.read().decode("utf-8"))
    if raw.get("status") == "incomplete":
        reason = (raw.get("incomplete_details") or {}).get("reason", "unknown")
        raise RuntimeError(f"OpenAI company filing analysis incomplete ({reason})")
    text = _response_text(raw)
    if not text:
        raise RuntimeError("OpenAI returned no company filing analysis")
    result = json.loads(text)
    validate_model_analysis(result, filing_keys, inputs)
    return result, dict(raw.get("usage") or {})


def validate_model_analysis(payload: dict[str, Any], filing_keys: list[str], inputs: list[dict[str, Any]] | None = None) -> None:
    rows = payload.get("companies")
    if not isinstance(rows, list) or len(rows) != len(filing_keys):
        raise ValueError("Company filing analysis count mismatch")
    actual = [str(row.get("filing_key") or "") for row in rows if isinstance(row, dict)]
    if sorted(actual) != sorted(filing_keys) or len(actual) != len(set(actual)):
        raise ValueError("Company filing analysis keys do not match authorized inputs")
    for row in rows:
        if row.get("thesis_effect") not in THESIS_EFFECTS:
            raise ValueError("Unsupported company filing thesis effect")
    if inputs is not None:
        allowed = {
            item["filing_key"]: {
                str(news.get("source_id") or "") for news in item.get("recent_news_evidence") or []
            }
            for item in inputs
        }
        for row in rows:
            for news in row.get("recent_news_ko") or []:
                if str(news.get("source_id") or "") not in allowed.get(str(row.get("filing_key") or ""), set()):
                    raise ValueError("Company news analysis cites an unauthorized source ID")


def _facts_only_analysis(row: dict[str, Any]) -> dict[str, Any]:
    filing = row["latest_financial_filing"]
    metrics = row.get("reported_metrics") or []
    metric_names = "·".join(str(metric.get("label_ko") or "") for metric in metrics[:4] if metric.get("label_ko"))
    return {
        "filing_key": row["filing_key"],
        "summary_ko": f"{filing.get('filed_date')} 제출 {filing.get('form')}에서 {metric_names or '공식 재무수치'}를 확인했습니다. 해석 요약은 분석 모델 실행 후 보강됩니다.",
        "financial_takeaways_ko": [],
        "business_takeaways_ko": [],
        "risks_ko": [],
        "thesis_effect": "insufficient_evidence",
        "thesis_effect_reason_ko": "공식 수치는 수집됐지만 문서 해석이 완료되지 않아 투자 가설 영향 판단을 보류합니다.",
        "monitoring_points_ko": ["다음 SEC 제출문서와 동일 기간 수치의 변화를 확인합니다."],
        "financial_change_reasons_ko": [],
        "industry_analysis_ko": {
            "market_dynamics_ko": list((row.get("industry_context") or {}).get("market_dynamics_ko") or [])[:4],
            "competitive_positioning_ko": list((row.get("industry_context") or {}).get("competitive_positioning_ko") or [])[:4],
            "growth_drivers_ko": list((row.get("industry_context") or {}).get("growth_drivers_ko") or [])[:4],
            "outlook_1_2y_ko": [],
        },
        "recent_news_ko": [{
            "source_id": news.get("source_id"),
            "date": news.get("date"),
            "category": "기타",
            "summary_ko": news.get("title"),
        } for news in (row.get("recent_news_evidence") or [])[:MAX_NEWS_ITEMS]],
    }


def build_artifact(
    report_date: str,
    inputs: list[dict[str, Any]],
    *,
    api_key: str = "",
    model: str = "gpt-5-mini",
    dry_run: bool = False,
    requester: Callable[..., tuple[dict[str, Any], dict[str, Any]]] = request_analysis,
) -> dict[str, Any]:
    identity_payload = {
        "prompt_version": PROMPT_VERSION,
        "model": model,
        "filing_keys": [row["filing_key"] for row in inputs],
    }
    batch_key = hashlib.sha256(json.dumps(identity_payload, sort_keys=True).encode()).hexdigest()
    status = "no_eligible_companies"
    usage: dict[str, Any] = {}
    notice = ""
    analysis_rows: list[dict[str, Any]] = []
    if inputs:
        if dry_run:
            status = "dry_run_facts_only"
            notice = "공식 SEC 근거를 검증했으며 모델 호출은 생략했습니다."
            analysis_rows = [_facts_only_analysis(row) for row in inputs]
        elif not api_key:
            status = "facts_only_missing_api_key"
            notice = "OPENAI_API_KEY가 없어 공식 수치만 반영했습니다."
            analysis_rows = [_facts_only_analysis(row) for row in inputs]
        else:
            try:
                result, usage = requester(inputs, api_key=api_key, model=model)
                validate_model_analysis(result, [row["filing_key"] for row in inputs], inputs)
                analysis_rows = result["companies"]
                status = "complete"
            except Exception as exc:
                status = "facts_only_analysis_failed"
                notice = f"문서 해석 실패({type(exc).__name__}); 공식 수치는 유지했습니다."
                analysis_rows = [_facts_only_analysis(row) for row in inputs]
    analysis_by_key = {row["filing_key"]: row for row in analysis_rows}
    companies = []
    for row in inputs:
        analysis = analysis_by_key[row["filing_key"]]
        companies.append({
            **row,
            "analysis_status": "complete" if status == "complete" else "facts_only",
            "analysis": analysis,
            "review_gate": {
                "facts_auto_published": True,
                "interpretation_auto_published": status == "complete",
                "thesis_change_requires_approval": True,
                "automatic_position_action": False,
            },
        })
    artifact = {
        "schema_version": SCHEMA_VERSION,
        "report_date": report_date,
        "status": status,
        "company_count": len(companies),
        "companies": companies,
        "analysis_identity": {**identity_payload, "batch_key": batch_key},
        "usage": usage,
        "notice": notice,
        "policy": {
            "market_scope": "US",
            "official_sources_only": True,
            "facts_calculations_interpretations_separated": True,
            "thesis_change_requires_approval": True,
            "automatic_position_actions_allowed": False,
        },
    }
    validate_artifact(artifact)
    return artifact


def validate_artifact(payload: dict[str, Any]) -> None:
    if payload.get("schema_version") != SCHEMA_VERSION:
        raise ValueError("Unexpected company filing summary schema")
    rows = payload.get("companies") or []
    if int(payload.get("company_count") or 0) != len(rows):
        raise ValueError("Company filing summary count mismatch")
    keys: set[str] = set()
    for row in rows:
        key = str(row.get("filing_key") or "")
        if not key or key in keys:
            raise ValueError("Company filing summaries require unique filing keys")
        keys.add(key)
        filing = row.get("latest_financial_filing") or {}
        if filing.get("form") not in {"10-Q", "10-K", "20-F", "6-K"}:
            raise ValueError("Unsupported primary filing form")
        if not str(filing.get("source_url") or "").startswith("https://www.sec.gov/"):
            raise ValueError("Company filing summary requires an SEC source URL")
        if (row.get("review_gate") or {}).get("automatic_position_action"):
            raise ValueError("Company filing summary cannot authorize a position action")


def main() -> None:
    parser = argparse.ArgumentParser(description="Analyze notable US company SEC filings")
    parser.add_argument("--date", required=True)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--max-companies", type=int, default=MAX_COMPANIES)
    args = parser.parse_args()
    load_dotenv()
    workspace = ROOT / "workspace"
    inputs = build_inputs(
        _load(workspace / "company_research_queue" / args.date / "company_research_queue.json"),
        _load(workspace / "company_primary_facts" / args.date / "company_primary_facts.json"),
        _load(workspace / "company_primary_narratives" / args.date / "company_primary_narratives.json", required=False),
        _load(workspace / "company_long_term_profiles" / args.date / "company_long_term_profiles.json", required=False),
        snapshot=_load(workspace / "snapshots" / args.date / "daily_snapshot.json", required=False),
        report_date=args.date,
        max_companies=max(1, min(args.max_companies, 8)),
    )
    artifact = build_artifact(
        args.date,
        inputs,
        api_key=os.getenv("OPENAI_API_KEY", "").strip(),
        model=os.getenv("OPENAI_COMPANY_FILING_MODEL", os.getenv("OPENAI_ANALYSIS_MODEL", "gpt-5-mini")).strip(),
        dry_run=args.dry_run,
    )
    artifact["generated_at"] = datetime.now(ZoneInfo(os.getenv("BRIEF_TIMEZONE", "Asia/Seoul"))).isoformat()
    output = workspace / "company_filing_summaries" / args.date / "company_filing_summaries.json"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(artifact, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Company filing summaries saved: {output.relative_to(ROOT)}")
    print(f"Company filing summaries status: {artifact['status']} | companies={artifact['company_count']}")


if __name__ == "__main__":
    main()
