"""Aggregate earnings surprises, guidance, and estimate revisions for readers."""

from __future__ import annotations

import argparse
import json
from datetime import datetime
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

from collectors.common import ROOT

SCHEMA_VERSION = "earnings_intelligence.v1"
MAX_COMPANIES = 12
MAX_ESTIMATE_ROWS = 4
MAX_HISTORY_ROWS = 4
MAX_GUIDANCE_ROWS = 4


def _load(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    payload = json.loads(path.read_text(encoding="utf-8-sig"))
    return payload if isinstance(payload, dict) else {}


def _ticker_map(payload: dict[str, Any], field: str) -> dict[str, dict[str, Any]]:
    return {
        str(row.get("ticker") or "").upper(): row
        for row in payload.get(field, [])
        if isinstance(row, dict) and str(row.get("ticker") or "").strip()
    }


def _source_rows(*records: dict[str, Any]) -> list[dict[str, Any]]:
    sources: dict[str, dict[str, Any]] = {}
    for record in records:
        for row in record.get("source_index", []) if isinstance(record, dict) else []:
            if not isinstance(row, dict):
                continue
            source_id = str(row.get("source_id") or "").strip()
            url = str(row.get("source_location") or row.get("source_url") or "").strip()
            if not source_id or not url.startswith(("https://", "http://")):
                continue
            sources[source_id] = {
                "source_id": source_id,
                "title": str(row.get("source_name") or source_id),
                "url": url,
                "as_of": row.get("as_of_date"),
            }
    return list(sources.values())


def _event_summary(event: dict[str, Any]) -> dict[str, Any]:
    selected = event.get("selected_event") or {}
    expected = [
        row for row in event.get("provider_expected_events", [])
        if isinstance(row, dict)
    ]
    if selected:
        return {
            "status": "confirmed_primary",
            "event_date": selected.get("event_date"),
            "time_of_day": selected.get("time_of_day"),
            "confidence": "confirmed",
            "source_id": selected.get("source_id"),
        }
    if expected:
        row = expected[0]
        return {
            "status": "provider_expected",
            "event_date": row.get("event_date"),
            "time_of_day": row.get("time_of_day"),
            "confidence": "expected",
            "source_id": row.get("source_id"),
        }
    return {
        "status": "not_available",
        "event_date": None,
        "time_of_day": None,
        "confidence": "not_available",
        "source_id": None,
    }


def _estimate_summary(review: dict[str, Any]) -> dict[str, Any]:
    bar = review.get("expectation_bar") or {}
    rows = [
        {
            "metric_id": row.get("metric_id"),
            "period_end": row.get("period_end"),
            "value": row.get("value"),
            "units": row.get("units"),
            "estimate_as_of": row.get("estimate_as_of"),
            "analyst_count": row.get("analyst_count"),
            "revision_pct_30d": row.get("revision_pct_30d"),
            "evidence_label": row.get("evidence_label"),
            "source_id": row.get("source_id"),
        }
        for row in bar.get("rows", [])
        if isinstance(row, dict)
        and row.get("evidence_label") == "third_party_forward_estimate"
    ][:MAX_ESTIMATE_ROWS]
    return {
        "status": bar.get("status") or "not_available",
        "freeze_as_of": bar.get("freeze_as_of"),
        "revision_direction": (
            bar.get("revision_direction") if rows else "not_available"
        ),
        "rows": rows,
        "evidence_label": "third_party_forward_estimate" if rows else None,
        "decision_limit": (
            "제공업체 전망치이며 기여자 구성과 동결 시각이 검증된 전체 컨센서스로 표현하지 않는다."
        ),
    }


def _guidance_rows(
    review: dict[str, Any],
    result: dict[str, Any],
) -> list[dict[str, Any]]:
    candidates = [
        *review.get("company_guidance", []),
        *result.get("guidance_updates", []),
    ]
    rows: list[dict[str, Any]] = []
    seen: set[tuple[Any, ...]] = set()
    for row in candidates:
        if not isinstance(row, dict):
            continue
        if row.get("evidence_label") != "issuer_management_claim":
            continue
        key = (
            row.get("metric_id"),
            row.get("period_end"),
            row.get("midpoint"),
            row.get("source_id"),
        )
        if key in seen:
            continue
        seen.add(key)
        rows.append({
            "metric_id": row.get("metric_id"),
            "period_end": row.get("period_end"),
            "value_low": row.get("value_low"),
            "value_high": row.get("value_high"),
            "midpoint": row.get("midpoint"),
            "units": row.get("units") or row.get("unit"),
            "currency": row.get("currency"),
            "estimate_comparison": row.get("estimate_comparison"),
            "evidence_label": "issuer_management_claim",
            "source_id": row.get("source_id"),
        })
        if len(rows) >= MAX_GUIDANCE_ROWS:
            break
    return rows


def _historical_surprises(reaction: dict[str, Any]) -> list[dict[str, Any]]:
    return [
        {
            "reported_date": row.get("reported_date"),
            "fiscal_period_end": row.get("fiscal_period_end"),
            "reported_eps": row.get("reported_eps"),
            "estimated_eps": row.get("estimated_eps"),
            "surprise_pct": row.get("surprise_pct"),
            "reaction_pct": row.get("reaction_pct"),
            "window_start": row.get("window_start"),
            "window_end": row.get("window_end"),
            "evidence_label": row.get("evidence_label"),
            "interpretation_limit": row.get("interpretation_limit"),
        }
        for row in reaction.get("historical_reactions", [])
        if isinstance(row, dict)
    ][:MAX_HISTORY_ROWS]


def _company_row(
    ticker: str,
    event: dict[str, Any],
    reaction: dict[str, Any],
    review: dict[str, Any],
    result: dict[str, Any],
    deep_dive: dict[str, Any],
) -> dict[str, Any]:
    estimates = _estimate_summary(review)
    guidance = _guidance_rows(review, result)
    historical = _historical_surprises(reaction)
    reported = result.get("reported_metric_comparison") or {}
    post_result_ready = (
        result.get("pack_status") == "ready_for_post_earnings_deep_dive"
    )
    model_update = deep_dive.get("model_update_packet") or {}
    return {
        "ticker": ticker,
        "company_name": (
            review.get("company_name")
            or reaction.get("company_name")
            or result.get("company_name")
            or event.get("issuer")
        ),
        "upcoming_event": _event_summary(event),
        "estimate_revision": estimates,
        "valuation_screen": dict(review.get("valuation_screen") or {}),
        "guidance": guidance,
        "historical_surprises": historical,
        "latest_verified_result": {
            "status": (
                "verified_primary_input_pack"
                if post_result_ready else result.get("pack_status") or "not_available"
            ),
            "headline_case": result.get("headline_result_case"),
            "metric_id": reported.get("metric_id"),
            "reported_value": reported.get("reported_value"),
            "period_end": reported.get("period_end"),
            "units": reported.get("units"),
            "source_id": reported.get("source_id"),
        },
        "post_result_estimate_revision": {
            "status": (
                model_update.get("estimate_revision_direction")
                or "not_established_missing_refreshed_estimates"
            ),
            "model_update_applied": bool(model_update.get("model_update_applied")),
        },
        "source_index": _source_rows(event, reaction, review, result, deep_dive),
        "decision_limits": [
            "과거 EPS 서프라이즈와 가격 반응은 반복 가능한 인과관계를 의미하지 않는다.",
            "회사 가이던스는 경영진 주장으로 유지한다.",
            "실적 발표 후 동일 기간 전망치가 갱신되기 전에는 추정치 변화 방향을 확정하지 않는다.",
        ],
    }


def build_earnings_intelligence(
    report_date: str,
    *,
    events: dict[str, Any],
    reactions: dict[str, Any],
    reviews: dict[str, Any],
    results: dict[str, Any],
    deep_dives: dict[str, Any],
    generated_at: str | None = None,
) -> dict[str, Any]:
    event_map = _ticker_map(events, "companies")
    reaction_map = _ticker_map(reactions, "companies")
    review_map = _ticker_map(reviews, "reviews")
    result_map = _ticker_map(results, "companies")
    deep_map = _ticker_map(deep_dives, "reviews")
    tickers = sorted(
        set(event_map) | set(reaction_map) | set(review_map) | set(result_map)
        | set(deep_map)
    )[:MAX_COMPANIES]
    companies = [
        _company_row(
            ticker,
            event_map.get(ticker, {}),
            reaction_map.get(ticker, {}),
            review_map.get(ticker, {}),
            result_map.get(ticker, {}),
            deep_map.get(ticker, {}),
        )
        for ticker in tickers
    ]
    payload = {
        "schema_version": SCHEMA_VERSION,
        "report_date": report_date,
        "generated_at": generated_at
        or datetime.now(ZoneInfo("Asia/Seoul")).isoformat(),
        "status": "ready" if companies else "awaiting_company_profiles",
        "summary": {
            "company_count": len(companies),
            "confirmed_event_count": sum(
                row["upcoming_event"]["status"] == "confirmed_primary"
                for row in companies
            ),
            "estimate_revision_count": sum(
                bool(row["estimate_revision"]["rows"]) for row in companies
            ),
            "guidance_count": sum(bool(row["guidance"]) for row in companies),
            "verified_result_count": sum(
                row["latest_verified_result"]["status"]
                == "verified_primary_input_pack"
                for row in companies
            ),
        },
        "companies": companies,
        "policy": {
            "provider_estimates_are_not_full_consensus": True,
            "guidance_kept_as_issuer_claim": True,
            "primary_source_required_for_reported_results": True,
            "post_result_revision_requires_refreshed_estimates": True,
            "position_actions_allowed": False,
        },
    }
    validate_earnings_intelligence(payload)
    return payload


def validate_earnings_intelligence(payload: dict[str, Any]) -> None:
    if payload.get("schema_version") != SCHEMA_VERSION:
        raise ValueError("Unexpected earnings intelligence schema")
    if int((payload.get("summary") or {}).get("company_count", -1)) != len(
        payload.get("companies", [])
    ):
        raise ValueError("Earnings intelligence company count mismatch")
    for company in payload.get("companies", []):
        for row in (company.get("estimate_revision") or {}).get("rows", []):
            if row.get("evidence_label") != "third_party_forward_estimate":
                raise ValueError("Estimate rows must remain third-party estimates")
        for row in company.get("guidance", []):
            if row.get("evidence_label") != "issuer_management_claim":
                raise ValueError("Guidance rows must remain issuer claims")
        valuation = company.get("valuation_screen") or {}
        if valuation.get("status") == "screening_available" and (
            valuation.get("evidence_label") != "derived_screening_calculation"
            or int(valuation.get("usable_peer_count") or 0)
            < int(valuation.get("minimum_peer_count") or 2)
        ):
            raise ValueError("Valuation screen requires labeled minimum peer support")
        result = company.get("latest_verified_result") or {}
        if result.get("status") == "verified_primary_input_pack" and not result.get(
            "source_id"
        ):
            raise ValueError("Verified result requires primary source lineage")
    if (payload.get("policy") or {}).get("position_actions_allowed") is not False:
        raise ValueError("Earnings intelligence cannot authorize position actions")


def main() -> None:
    parser = argparse.ArgumentParser(description="Build earnings intelligence")
    parser.add_argument("--date", required=True)
    args = parser.parse_args()
    roots = {
        "events": ROOT / "workspace" / "company_earnings_events" / args.date
        / "company_earnings_events.json",
        "reactions": ROOT / "workspace" / "company_earnings_reaction_context"
        / args.date / "company_earnings_reaction_context.json",
        "reviews": ROOT / "workspace" / "company_earnings_driver_review"
        / args.date / "company_earnings_driver_review.json",
        "results": ROOT / "workspace" / "company_earnings_results" / args.date
        / "company_earnings_results.json",
        "deep_dives": ROOT / "workspace" / "company_earnings_deep_dive"
        / args.date / "company_earnings_deep_dive.json",
    }
    payload = build_earnings_intelligence(
        args.date,
        **{key: _load(path) for key, path in roots.items()},
    )
    output = ROOT / "workspace" / "earnings_intelligence" / args.date
    output.mkdir(parents=True, exist_ok=True)
    path = output / "earnings_intelligence.json"
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(
        f"Earnings intelligence saved: {path.relative_to(ROOT)} "
        f"({payload['status']})"
    )


if __name__ == "__main__":
    main()
