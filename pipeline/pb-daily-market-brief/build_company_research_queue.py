"""Map persistence-qualified sectors to evidence-gated listed-company research candidates."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from collectors.common import ROOT
from collect_sector_fundamentals import load_fundamental_registry
from sector_master import load_sector_master

SCHEMA_VERSION = "company_research_queue.v1"
MAX_WATCHLIST_SECTORS = 5
MAX_QUEUE_ROWS = 24
TRANSACTION_SETTINGS_PATH = ROOT.parents[1] / "config" / "transaction-status.user.json"


def root_path(value: str | None, default: Path) -> Path:
    path = Path(value) if value else default
    return path if path.is_absolute() else ROOT / path


def _security_key(sector_id: str, market: str, ticker: str) -> tuple[str, str, str]:
    return sector_id, market.upper(), ticker.upper()


def load_direct_company_inputs(path: Path = TRANSACTION_SETTINGS_PATH) -> list[dict[str, Any]]:
    """Reuse the user's local watchlist and holdings as explicit research inputs."""
    if not path.exists():
        return []
    payload = json.loads(path.read_text(encoding="utf-8-sig"))
    if not isinstance(payload, dict):
        return []
    rows: dict[str, dict[str, Any]] = {}

    def add(value: Any, *, source: str, company_name: Any = None) -> None:
        ticker = str(value or "").strip().upper()
        if not ticker or ticker.isdigit() or len(ticker) > 12:
            return
        if any(character not in "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.-" for character in ticker):
            return
        current = rows.setdefault(ticker, {
            "ticker": ticker,
            "company_name": str(company_name or "").strip() or None,
            "market": "US",
            "sources": [],
        })
        if not current.get("company_name") and company_name:
            current["company_name"] = str(company_name).strip() or None
        if source not in current["sources"]:
            current["sources"].append(source)

    for group in payload.get("watchlistGroups", []) or []:
        if not isinstance(group, dict):
            continue
        for ticker in group.get("symbols", []) or []:
            add(ticker, source="watchlist")
        for instrument in group.get("instruments", []) or []:
            if isinstance(instrument, dict):
                add(
                    instrument.get("ticker") or instrument.get("symbol") or instrument.get("code"),
                    source="watchlist",
                    company_name=instrument.get("name") or instrument.get("label"),
                )
    for holding in payload.get("portfolioHoldings", []) or []:
        if isinstance(holding, dict):
            add(
                holding.get("ticker") or holding.get("symbol") or holding.get("code"),
                source="portfolio",
                company_name=holding.get("name") or holding.get("label"),
            )
    return sorted(rows.values(), key=lambda row: row["ticker"])


def _selected_sectors(radar: dict[str, Any]) -> list[dict[str, Any]]:
    funnel = radar.get("funnel", {})
    selected: list[dict[str, Any]] = []
    seen: set[str] = set()
    for bucket, limit in (
        ("advance_to_deeper_work", None),
        ("reunderwrite", None),
        ("watchlist", MAX_WATCHLIST_SECTORS),
    ):
        rows = list(funnel.get(bucket, []))
        if limit is not None:
            rows = rows[:limit]
        for row in rows:
            if row["sector_id"] in seen:
                continue
            seen.add(row["sector_id"])
            selected.append({**row, "radar_bucket": bucket})
    return selected


def _verified_exposure_map(registry: dict[str, Any]) -> dict[tuple[str, str, str], dict[str, Any]]:
    result: dict[tuple[str, str, str], dict[str, Any]] = {}
    for row in registry.get("verified_exposures", []):
        if row.get("primary_source_confirmed") is not True:
            continue
        if not str(row.get("source_url") or "").startswith("https://"):
            continue
        if not str(row.get("body_location") or "").strip():
            continue
        result[_security_key(row["sector_id"], row["market"], row["ticker"])] = row
    return result


def _fundamental_maps(
    fundamentals: dict[str, Any],
) -> tuple[dict[tuple[str, str, str], dict[str, Any]], dict[tuple[str, str, str], list[dict[str, Any]]]]:
    estimates = {
        _security_key(row["sector_id"], row["market"], row["ticker"]): row
        for row in fundamentals.get("estimate_observations", [])
    }
    operating: dict[tuple[str, str, str], list[dict[str, Any]]] = {}
    for row in fundamentals.get("operating_observations", []):
        key = _security_key(row["sector_id"], row["market"], row["ticker"])
        operating.setdefault(key, []).append(row)
    return estimates, operating


def _queue_stage(
    radar_bucket: str,
    exposure: dict[str, Any] | None,
    estimate: dict[str, Any] | None,
    operating: list[dict[str, Any]],
) -> str:
    if radar_bucket == "reunderwrite":
        return "sector_reunderwrite"
    if radar_bucket != "advance_to_deeper_work":
        return "sector_watchlist_only"
    if exposure is None:
        return "needs_exposure_attribution"
    has_estimate_signal = bool(
        estimate
        and estimate.get("eligible_for_sector_score") is True
        and isinstance(estimate.get("score"), (int, float))
    )
    has_operating_signal = any(
        row.get("eligible_for_sector_score") is True
        and isinstance(row.get("score"), (int, float))
        for row in operating
    )
    if not has_estimate_signal and not has_operating_signal:
        return "verified_exposure_needs_financial_signal"
    return "valuation_expectations_gated"


def _candidate_row(
    sector: dict[str, Any],
    radar_row: dict[str, Any],
    company: dict[str, Any],
    exposure: dict[str, Any] | None,
    estimate: dict[str, Any] | None,
    operating: list[dict[str, Any]],
) -> dict[str, Any]:
    stage = _queue_stage(radar_row["radar_bucket"], exposure, estimate, operating)
    estimate_eligible = bool(
        estimate
        and estimate.get("eligible_for_sector_score") is True
        and isinstance(estimate.get("score"), (int, float))
    )
    accepted_operating = [
        row for row in operating
        if row.get("eligible_for_sector_score") is True and isinstance(row.get("score"), (int, float))
    ]
    source_urls = sorted({
        str(url) for url in [
            exposure.get("source_url") if exposure else None,
            estimate.get("source_url") if estimate_eligible and estimate else None,
            *[row.get("source_url") for row in accepted_operating],
        ] if url
    })
    if stage == "valuation_expectations_gated":
        actionability = "advance_to_company_diligence"
        next_workflow = "company_tearsheet_then_expectations_and_valuation"
        first_rejection = "Current price, valuation, liquidity, and priced-in expectations are not collected."
    elif stage == "needs_exposure_attribution":
        actionability = "wait_for_proof"
        next_workflow = "primary_company_exposure_mapping"
        first_rejection = "Representative-company membership is not primary-source exposure proof."
    elif stage == "verified_exposure_needs_financial_signal":
        actionability = "wait_for_proof"
        next_workflow = "collect_company_estimate_or_operating_signal"
        first_rejection = "Business exposure is verified but no eligible estimate, order, backlog, or CAPEX signal exists."
    elif stage == "sector_reunderwrite":
        actionability = "reunderwrite_sector_first"
        next_workflow = "sector_thesis_reunderwrite"
        first_rejection = "The sector leadership thesis is weakening or lost score readiness."
    else:
        actionability = "sector_watchlist"
        next_workflow = "continue_sector_monitoring"
        first_rejection = "The sector has not advanced through the persistence-aware research funnel."
    return {
        "candidate_id": f"{sector['sector_id']}:{company['market']}:{company['ticker']}",
        "sector_id": sector["sector_id"],
        "sector_name_ko": sector["name_ko"],
        "sector_radar_stage": radar_row.get("stage"),
        "sector_radar_bucket": radar_row["radar_bucket"],
        "sector_leadership_score": radar_row.get("latest_leadership_score"),
        "market": company["market"],
        "ticker": company["ticker"],
        "company_name": company["name"],
        "instrument_type": company["instrument_type"],
        "queue_stage": stage,
        "actionability": actionability,
        "exposure_status": "verified_primary" if exposure else "candidate_unverified",
        "exposure_source_url": exposure.get("source_url") if exposure else None,
        "exposure_body_location": exposure.get("body_location") if exposure else None,
        "exposure_evidence_summary": exposure.get("evidence_summary") if exposure else None,
        "beneficiary_pathways": [{
            "pathway_id": row["pathway_id"],
            "label_ko": row["label_ko"],
            "attribution_status": "sector_context_not_company_attribution",
        } for row in sector["beneficiary_pathways"]],
        "estimate_signal": ({
            "status": estimate.get("status"),
            "score": estimate.get("score"),
            "score_candidate": estimate.get("score_candidate"),
            "as_of": estimate.get("as_of"),
            "source_provider": estimate.get("source_provider"),
            "source_grade": estimate.get("source_grade"),
            "source_url": estimate.get("source_url"),
            "eligible": estimate_eligible,
        } if estimate else None),
        "operating_signals": [{
            "record_id": row.get("record_id"),
            "metric_type": row.get("metric_type"),
            "change_pct": row.get("change_pct"),
            "score": row.get("score"),
            "source_date": row.get("source_date"),
            "source_url": row.get("source_url"),
            "body_location": row.get("body_location"),
        } for row in accepted_operating],
        "source_urls": source_urls,
        "why_now": (
            f"Sector stage is {radar_row.get('stage')}; company evidence stage is {stage}."
        ),
        "variant_wedge": "Not established; current valuation and priced-in expectations are unavailable.",
        "priced_in_status": "data_gap",
        "valuation_status": "not_collected",
        "market_data_as_of": None,
        "liquidity_status": "not_collected",
        "positioning_status": "not_collected",
        "first_rejection": first_rejection,
        "what_would_make_it_investable": (
            "Verify current price, valuation, liquidity, consensus freshness, company guidance, and the financial magnitude of sector exposure."
        ),
        "what_would_kill_it": (
            "Loss of verified exposure, reversal of company estimate or operating evidence, or sector reunderwrite status."
        ),
        "next_workflow": next_workflow,
        "posture": "research_candidate_not_investment_recommendation",
    }


def _direct_candidate_rows(
    direct_inputs: list[dict[str, Any]],
    master: dict[str, Any],
    exposure_map: dict[tuple[str, str, str], dict[str, Any]],
    estimates: dict[tuple[str, str, str], dict[str, Any]],
    operating: dict[tuple[str, str, str], list[dict[str, Any]]],
) -> list[dict[str, Any]]:
    representative_map: dict[tuple[str, str], tuple[dict[str, Any], dict[str, Any]]] = {}
    for sector in master.get("sectors", []):
        for company in sector.get("representative_companies", []):
            representative_map[(str(company.get("market") or "").upper(), str(company.get("ticker") or "").upper())] = (
                sector,
                company,
            )
    rows: list[dict[str, Any]] = []
    for direct in direct_inputs:
        market = str(direct.get("market") or "US").upper()
        ticker = str(direct.get("ticker") or "").upper()
        mapped = representative_map.get((market, ticker))
        if mapped:
            sector, company = mapped
            key = _security_key(sector["sector_id"], market, ticker)
            row = _candidate_row(
                sector,
                {
                    "radar_bucket": "advance_to_deeper_work",
                    "stage": "direct_user_research",
                    "latest_leadership_score": None,
                },
                company,
                exposure_map.get(key),
                estimates.get(key),
                operating.get(key, []),
            )
        else:
            row = {
                "candidate_id": f"direct:{market}:{ticker}",
                "sector_id": "direct_watchlist",
                "sector_name_ko": "직접 등록 기업",
                "sector_radar_stage": "not_required_for_direct_research",
                "sector_radar_bucket": "direct_user_research",
                "sector_leadership_score": None,
                "market": market,
                "ticker": ticker,
                "company_name": direct.get("company_name") or ticker,
                "instrument_type": "equity",
                "exposure_status": "not_required_for_direct_research",
                "exposure_source_url": None,
                "exposure_body_location": None,
                "exposure_evidence_summary": None,
                "beneficiary_pathways": [],
                "estimate_signal": None,
                "operating_signals": [],
                "source_urls": [],
            }
        row.update({
            "queue_stage": "valuation_expectations_gated",
            "actionability": "advance_to_company_diligence",
            "candidate_origin": "direct_user_watchlist",
            "direct_input_sources": list(direct.get("sources") or []),
            "why_now": "사용자가 관심종목 또는 보유종목으로 직접 등록해 장기 기업분석을 요청했습니다.",
            "variant_wedge": "장기 재무와 현재 기대를 수집하기 전에는 확정하지 않습니다.",
            "priced_in_status": "data_gap",
            "valuation_status": "not_collected",
            "market_data_as_of": None,
            "liquidity_status": "not_collected",
            "positioning_status": "not_collected",
            "first_rejection": "5개년 재무, 현재 밸류에이션, 사업 노출과 반증 조건을 확인하기 전에는 투자 판단으로 승격하지 않습니다.",
            "what_would_make_it_investable": "5개년 영업이익·FCF, 자본배분, 현재 가격과 밸류에이션, 핵심 사업 근거를 확인합니다.",
            "what_would_kill_it": "현금창출력 악화, 지속적 주식 희석, 경쟁력 훼손 또는 과도한 시장 기대가 확인되면 장기 논리를 재검토합니다.",
            "next_workflow": "collect_long_term_company_facts_then_quality_valuation_review",
            "posture": "user_selected_research_input_not_investment_recommendation",
        })
        rows.append(row)
    return rows


def validate_company_research_queue(payload: dict[str, Any]) -> None:
    if payload.get("schema_version") != SCHEMA_VERSION:
        raise ValueError("Unexpected company research queue schema")
    ids: set[str] = set()
    for row in payload.get("candidates", []):
        if row["candidate_id"] in ids:
            raise ValueError(f"Duplicate company candidate: {row['candidate_id']}")
        ids.add(row["candidate_id"])
        if row["queue_stage"] == "valuation_expectations_gated":
            direct = row.get("candidate_origin") == "direct_user_watchlist"
            if not direct and (row["exposure_status"] != "verified_primary" or not row.get("exposure_source_url")):
                raise ValueError("Advanced company diligence requires primary exposure proof")
            if not direct and not (
                bool((row.get("estimate_signal") or {}).get("eligible"))
                or bool(row.get("operating_signals"))
            ):
                raise ValueError("Advanced company diligence requires an estimate or operating signal")
        if row.get("valuation_status") != "not_collected" or row.get("priced_in_status") != "data_gap":
            raise ValueError("Queue cannot infer valuation or priced-in status")
        if any(not str(url).startswith("https://") for url in row.get("source_urls", [])):
            raise ValueError("Company queue source URLs must be https")


def build_company_research_queue(
    report_date: str,
    radar: dict[str, Any],
    master: dict[str, Any],
    registry: dict[str, Any],
    fundamentals: dict[str, Any],
    direct_inputs: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    sectors = {row["sector_id"]: row for row in master["sectors"]}
    exposure_map = _verified_exposure_map(registry)
    estimates, operating = _fundamental_maps(fundamentals)
    candidates: list[dict[str, Any]] = []
    for radar_row in _selected_sectors(radar):
        sector = sectors.get(radar_row["sector_id"])
        if not sector:
            continue
        for company in sector["representative_companies"]:
            key = _security_key(sector["sector_id"], company["market"], company["ticker"])
            candidates.append(_candidate_row(
                sector, radar_row, company, exposure_map.get(key), estimates.get(key), operating.get(key, []),
            ))
    direct_rows = _direct_candidate_rows(
        direct_inputs or [], master, exposure_map, estimates, operating,
    )
    direct_tickers = {(row["market"], row["ticker"]) for row in direct_rows}
    candidates = [
        row for row in candidates
        if (row["market"], row["ticker"]) not in direct_tickers
    ]
    candidates.extend(direct_rows)
    stage_priority = {
        "valuation_expectations_gated": 0,
        "verified_exposure_needs_financial_signal": 1,
        "needs_exposure_attribution": 2,
        "sector_reunderwrite": 3,
        "sector_watchlist_only": 4,
    }
    candidates.sort(key=lambda row: (
        stage_priority[row["queue_stage"]],
        -float(row.get("sector_leadership_score") or -1),
        row["market"], row["ticker"],
    ))
    candidates = candidates[:MAX_QUEUE_ROWS]
    funnel = {
        "advance_to_company_diligence": [
            row for row in candidates if row["queue_stage"] == "valuation_expectations_gated"
        ],
        "verified_exposure_needs_signal": [
            row for row in candidates if row["queue_stage"] == "verified_exposure_needs_financial_signal"
        ],
        "exposure_not_proven": [
            row for row in candidates if row["queue_stage"] == "needs_exposure_attribution"
        ],
        "deprioritized_or_reunderwrite": [
            row for row in candidates if row["queue_stage"] in {"sector_reunderwrite", "sector_watchlist_only"}
        ],
    }
    result = {
        "schema_version": SCHEMA_VERSION,
        "report_date": report_date,
        "source_radar_schema": radar.get("schema_version"),
        "selected_sector_count": len({row["sector_id"] for row in candidates}),
        "candidate_count": len(candidates),
        "advance_count": len(funnel["advance_to_company_diligence"]),
        "funnel": funnel,
        "candidates": candidates,
        "methodology": {
            "advanced_sector_required_for_company_advance": True,
            "direct_user_research_bypasses_sector_radar": True,
            "primary_exposure_proof_required": True,
            "company_estimate_or_operating_signal_required": True,
            "valuation_and_priced_in_gate_present": False,
            "posture": "research_priority_not_investment_recommendation",
        },
        "data_gaps": [
            "Current price, valuation, liquidity, ownership, positioning, and benchmark context are not collected.",
            "Consensus signals are provider-derived and do not replace company filings or guidance.",
            "Sector beneficiary pathways are context until company-specific financial attribution is verified.",
        ],
    }
    validate_company_research_queue(result)
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description="Build an evidence-gated company research queue")
    parser.add_argument("--date", required=True)
    parser.add_argument("--radar-file")
    parser.add_argument("--fundamentals-file")
    parser.add_argument("--direct-input-file")
    parser.add_argument("--output-file")
    args = parser.parse_args()
    radar_path = root_path(
        args.radar_file,
        ROOT / "workspace" / "history" / "sector_radar" / f"{args.date}.json",
    )
    fundamentals_path = root_path(
        args.fundamentals_file,
        ROOT / "workspace" / "sector_fundamentals" / args.date / "sector_fundamentals.json",
    )
    if not radar_path.exists():
        raise SystemExit(f"Sector leadership radar does not exist: {radar_path}")
    if not fundamentals_path.exists():
        raise SystemExit(f"Sector fundamentals do not exist: {fundamentals_path}")
    payload = build_company_research_queue(
        args.date,
        json.loads(radar_path.read_text(encoding="utf-8")),
        load_sector_master(),
        load_fundamental_registry(),
        json.loads(fundamentals_path.read_text(encoding="utf-8")),
        load_direct_company_inputs(
            root_path(args.direct_input_file, TRANSACTION_SETTINGS_PATH)
        ),
    )
    output = root_path(
        args.output_file,
        ROOT / "workspace" / "company_research_queue" / args.date / "company_research_queue.json",
    )
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Company research queue saved: {output.relative_to(ROOT)}")
    print(f"Company research queue status: candidates={payload['candidate_count']} | advance={payload['advance_count']}")


if __name__ == "__main__":
    main()
