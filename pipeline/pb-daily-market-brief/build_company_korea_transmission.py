"""Build evidence-gated U.S. company to Korean equity transmission candidates."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from collectors.common import ROOT


SCHEMA_VERSION = "company_korea_transmission.v1"
POLICY_SCHEMA = "company_korea_transmission_policy.v1"
DEFAULT_POLICY_PATH = ROOT.parents[1] / "config" / "company-korea-transmission-policy.json"
DEFAULT_SECTOR_MASTER_PATH = ROOT / "sector_master.json"


def _load(path: Path, *, required: bool = True) -> dict[str, Any]:
    if not path.exists():
        if required:
            raise SystemExit(f"Required Korea transmission input does not exist: {path}")
        return {}
    value = json.loads(path.read_text(encoding="utf-8-sig"))
    if not isinstance(value, dict):
        raise ValueError(f"Expected JSON object: {path}")
    return value


def load_policy(path: Path | None = None) -> dict[str, Any]:
    policy = _load(path or DEFAULT_POLICY_PATH)
    if policy.get("schema_version") != POLICY_SCHEMA:
        raise ValueError("Unexpected company Korea transmission policy schema")
    if policy.get("automatic_beneficiary_label_allowed") is not False:
        raise ValueError("Automatic beneficiary labels must remain disabled")
    if policy.get("automatic_position_actions_allowed") is not False:
        raise ValueError("Automatic position actions must remain disabled")
    return policy


def _ticker_map(payload: dict[str, Any], field: str) -> dict[str, dict[str, Any]]:
    return {
        str(row.get("ticker") or "").upper(): row
        for row in payload.get(field, [])
        if isinstance(row, dict) and str(row.get("ticker") or "").strip()
    }


def _transmission_sources(
    queue: dict[str, Any],
    long_term_profiles: dict[str, Any],
    sectors: dict[str, dict[str, Any]],
) -> list[dict[str, Any]]:
    """Merge queue candidates with already-verified profile coverage.

    Profile-only tickers are admitted only when the sector master explicitly lists
    the U.S. security. This prevents free-form sector inference from creating a
    Korean beneficiary claim while preserving durable watchlist coverage.
    """
    sector_by_us_ticker: dict[str, str] = {}
    for sector_id, sector in sectors.items():
        for company in sector.get("representative_companies", []):
            if not isinstance(company, dict) or str(company.get("market") or "").upper() != "US":
                continue
            ticker = str(company.get("ticker") or "").upper()
            if ticker:
                sector_by_us_ticker[ticker] = sector_id

    sources: dict[str, dict[str, Any]] = {}
    for source in queue.get("candidates", []):
        if not isinstance(source, dict) or str(source.get("market") or "").upper() != "US":
            continue
        ticker = str(source.get("ticker") or "").upper()
        if not ticker:
            continue
        sector_id = str(source.get("sector_id") or "")
        if sector_id not in sectors:
            sector_id = sector_by_us_ticker.get(ticker, "")
        if sector_id:
            sources[ticker] = {
                **source,
                "ticker": ticker,
                "sector_id": sector_id,
                "transmission_source_origin": "company_research_queue",
            }

    for profile in long_term_profiles.get("profiles", []):
        if not isinstance(profile, dict):
            continue
        ticker = str(profile.get("ticker") or "").upper()
        if not ticker or ticker in sources:
            continue
        sector_id = str(profile.get("sector_id") or "")
        if sector_id not in sectors:
            sector_id = sector_by_us_ticker.get(ticker, "")
        if not sector_id:
            continue
        sources[ticker] = {
            "market": "US",
            "ticker": ticker,
            "company_name": profile.get("company_name") or ticker,
            "sector_id": sector_id,
            "candidate_origin": profile.get("candidate_origin") or "long_term_profile",
            "transmission_source_origin": "company_long_term_profile",
        }
    return list(sources.values())


def _classify_target(
    target: dict[str, Any], source_ticker: str, pathway_ids: set[str],
) -> tuple[str, str]:
    relationship = target.get("relationship_evidence") or {}
    related_sources = {
        str(value).upper() for value in relationship.get("source_tickers", [])
    }
    target_exposure = str(target.get("exposure_status") or "")
    verified_pathways = {
        str(value) for value in target.get("verified_pathway_ids", []) if value
    }
    if (
        relationship.get("status") == "verified_primary"
        and source_ticker in related_sources
        and target_exposure == "verified_primary"
    ):
        return "direct", "1차 자료로 기업 간 관계와 국내 기업의 매출·수주 노출이 함께 확인됐습니다."
    if target_exposure == "verified_primary" and bool(pathway_ids & verified_pathways):
        return "industry", "동일 산업 경로와 국내 기업의 사업 노출은 확인됐지만 직접 거래관계는 확인되지 않았습니다."
    if target.get("ticker") and target.get("name"):
        return "watch_candidate", "동일 섹터 대표기업이지만 국내 기업의 매출·수주 민감도는 아직 검증되지 않았습니다."
    return "rejected", "종목 식별자 또는 사업 노출 근거가 부족합니다."


def _target_row(
    target: dict[str, Any], source_ticker: str, pathways: list[dict[str, Any]],
    market_ready: bool, policy: dict[str, Any],
) -> dict[str, Any]:
    pathway_ids = {
        str(row.get("pathway_id"))
        for row in pathways
        if isinstance(row, dict) and row.get("pathway_id")
    }
    classification, reason = _classify_target(target, source_ticker, pathway_ids)
    labels = policy.get("classifications") or {}
    verified_relationship = classification == "direct"
    verified_exposure = classification in {"direct", "industry"}
    evidence_sources = [
        row for row in (
            list(target.get("exposure_evidence") or [])
            + list((target.get("relationship_evidence") or {}).get("sources") or [])
        )
        if isinstance(row, dict) and row.get("status") == "verified_primary"
    ]
    return {
        "market": "KR",
        "ticker": target.get("ticker"),
        "company_name": target.get("name"),
        "classification": classification,
        "classification_label": (labels.get(classification) or {}).get("label_ko"),
        "reason": reason,
        "pathways": [
            {
                "pathway_id": row.get("pathway_id"),
                "label_ko": row.get("label_ko"),
                "status": "sector_hypothesis_not_company_attribution",
            }
            for row in pathways[:4]
        ],
        "evidence_gates": {
            "verified_primary_relationship": verified_relationship,
            "verified_target_revenue_or_order_exposure": verified_exposure,
            "korea_market_confirmation": market_ready,
        },
        "market_confirmation_status": "confirmed" if market_ready else "not_confirmed",
        "actionability": (
            "analyst_review_only"
            if classification in {"direct", "industry"} and market_ready
            else "research_watchlist_only"
            if classification == "watch_candidate"
            else "blocked_pending_market_confirmation"
            if classification in {"direct", "industry"}
            else "excluded"
        ),
        "next_required_evidence": [
            value for value, needed in (
                ("기업 간 고객·공급 관계를 확인하는 공시·IR", not verified_relationship),
                ("국내 기업의 관련 매출·수주·가격·마진 민감도", not verified_exposure),
                ("KRX 종목 가격과 외국인 현물·선물 수급", not market_ready),
            ) if needed
        ],
        "source_urls": list(dict.fromkeys(
            str(row.get("url")) for row in evidence_sources if row.get("url")
        ))[:6],
        "automatic_beneficiary_label": False,
    }


def build_company_korea_transmission(
    report_date: str,
    *,
    queue: dict[str, Any],
    long_term_profiles: dict[str, Any],
    sector_master: dict[str, Any],
    korea_market: dict[str, Any],
    korea_company_exposure: dict[str, Any] | None = None,
    policy: dict[str, Any] | None = None,
) -> dict[str, Any]:
    active_policy = policy or load_policy()
    profiles = _ticker_map(long_term_profiles, "profiles")
    sectors = {
        str(row.get("sector_id")): row
        for row in sector_master.get("sectors", [])
        if isinstance(row, dict) and row.get("sector_id")
    }
    exposure_map = _ticker_map(korea_company_exposure or {}, "companies")
    market_gate = korea_market.get("transmission_gate") or {}
    acceptable_market_statuses = set(
        (active_policy.get("market_confirmation") or {}).get(
            "acceptable_gate_statuses",
            [
                "ready_for_korea_transmission",
                "ready_for_korea_transmission_with_source_lag",
            ],
        )
    )
    market_ready = market_gate.get("status") in acceptable_market_statuses
    transmissions = []
    for source in _transmission_sources(queue, long_term_profiles, sectors):
        ticker = str(source.get("ticker") or "").upper()
        sector = sectors.get(str(source.get("sector_id") or "")) or {}
        pathways = source.get("beneficiary_pathways") or sector.get("beneficiary_pathways") or []
        targets = []
        for row in sector.get("representative_companies", []):
            if not isinstance(row, dict) or str(row.get("market") or "").upper() != "KR":
                continue
            evidence = exposure_map.get(str(row.get("ticker") or "").upper(), {})
            targets.append(_target_row(
                {**row, **evidence}, ticker, pathways, market_ready, active_policy,
            ))
        if not targets:
            continue
        profile = profiles.get(ticker, {})
        quality = profile.get("company_quality") or {}
        transmissions.append({
            "source_market": "US",
            "source_ticker": ticker,
            "source_company_name": source.get("company_name") or profile.get("company_name"),
            "sector_id": source.get("sector_id"),
            "sector_name_ko": source.get("sector_name_ko") or sector.get("name_ko"),
            "source_origin": source.get("transmission_source_origin"),
            "source_signal": {
                "status": quality.get("status") or "not_available",
                "label": quality.get("label") or "기업 판단 대기",
                "scope": "company_evidence_not_korea_causality",
            },
            "pathways": pathways[:4],
            "market_confirmation": {
                "status": "ready" if market_ready else "blocked",
                "source_gate_status": market_gate.get("status") or "not_available",
                "missing_metrics": list(market_gate.get("missing_metrics") or [])[:8],
            },
            "targets": targets,
        })
    counts = {name: 0 for name in active_policy.get("classification_order", [])}
    for transmission in transmissions:
        for target in transmission["targets"]:
            counts[target["classification"]] = counts.get(target["classification"], 0) + 1
    payload = {
        "schema_version": SCHEMA_VERSION,
        "report_date": report_date,
        "status": (
            "available_with_market_confirmation"
            if transmissions and market_ready
            else "research_candidates_market_confirmation_blocked"
            if transmissions
            else "no_company_transmission_candidates"
        ),
        "summary": {
            "source_company_count": len(transmissions),
            "target_count": sum(counts.values()),
            "classification_counts": counts,
        },
        "transmissions": transmissions,
        "policy": {
            "schema_version": active_policy["schema_version"],
            "classification_order": active_policy["classification_order"],
            "automatic_beneficiary_label_allowed": False,
            "automatic_position_actions_allowed": False,
        },
    }
    validate_company_korea_transmission(payload)
    return payload


def validate_company_korea_transmission(payload: dict[str, Any]) -> None:
    if payload.get("schema_version") != SCHEMA_VERSION:
        raise ValueError("Unexpected company Korea transmission schema")
    for transmission in payload.get("transmissions", []):
        for target in transmission.get("targets", []):
            gates = target.get("evidence_gates") or {}
            if target.get("automatic_beneficiary_label") is not False:
                raise ValueError("Korean beneficiary labels cannot be automatic")
            if target.get("classification") == "direct" and not (
                gates.get("verified_primary_relationship")
                and gates.get("verified_target_revenue_or_order_exposure")
            ):
                raise ValueError("Direct Korea link requires verified relationship and exposure")
            if target.get("classification") == "industry" and not gates.get(
                "verified_target_revenue_or_order_exposure"
            ):
                raise ValueError("Industry Korea link requires verified target exposure")


def main() -> None:
    parser = argparse.ArgumentParser(description="Build company-to-Korea transmission candidates")
    parser.add_argument("--date", required=True)
    args = parser.parse_args()
    payload = build_company_korea_transmission(
        args.date,
        queue=_load(ROOT / "workspace" / "company_research_queue" / args.date / "company_research_queue.json"),
        long_term_profiles=_load(ROOT / "workspace" / "company_long_term_profiles" / args.date / "company_long_term_profiles.json", required=False),
        sector_master=_load(DEFAULT_SECTOR_MASTER_PATH),
        korea_market=_load(ROOT / "workspace" / "korea_market" / args.date / "korea_market.json", required=False),
        korea_company_exposure=_load(
            ROOT / "workspace" / "korea_company_exposure" / args.date / "korea_company_exposure.json",
            required=False,
        ),
    )
    output = ROOT / "workspace" / "company_korea_transmission" / args.date / "company_korea_transmission.json"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(
        f"Company Korea transmission saved: {output.relative_to(ROOT)} "
        f"({payload['summary']['target_count']})"
    )


if __name__ == "__main__":
    main()
