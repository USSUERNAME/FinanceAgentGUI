"""Build deterministic sector monitoring scores with strict evidence gates."""

from __future__ import annotations

import argparse
import json
from collections import Counter
from datetime import date
from pathlib import Path
from statistics import median
from typing import Any

from collectors.common import ROOT
from sector_classifier import annotate_market_payload, classify_records
from sector_master import load_sector_master

SCHEMA_VERSION = "sector_market_snapshot.v1"
MINIMUM_SCORING_COVERAGE_WEIGHT = 60
REQUIRED_SCORING_DIMENSIONS = {
    "industry_leading_data", "earnings_revisions", "market_confirmation",
}


def _clamp(value: float, low: float, high: float) -> float:
    return max(low, min(value, high))


def _relative_return(numerator_pct: float, denominator_pct: float) -> float:
    return ((1 + numerator_pct / 100) / (1 + denominator_pct / 100) - 1) * 100


def market_confirmation_score(
    sector_id: str,
    market_payload: dict[str, Any],
) -> dict[str, Any]:
    """Score available ETF price confirmation; never infer missing proxies."""
    items = market_payload.get("items", [])
    benchmark = next((item for item in items if item.get("ticker") == "SPY"), None)
    proxies = [
        item for item in items
        if item.get("ticker") != "SPY" and sector_id in item.get("sector_ids", [])
    ]
    observations: list[dict[str, Any]] = []
    for item in proxies:
        row: dict[str, Any] = {
            "ticker": item.get("ticker"),
            "as_of": item.get("as_of"),
            "return_5d_pct": item.get("return_5d_pct"),
            "return_20d_pct": item.get("return_20d_pct"),
        }
        if benchmark:
            for horizon in ("5d", "20d"):
                field = f"return_{horizon}_pct"
                if isinstance(item.get(field), (int, float)) and isinstance(benchmark.get(field), (int, float)):
                    row[f"vs_spy_{horizon}_pct"] = round(
                        _relative_return(float(item[field]), float(benchmark[field])), 4,
                    )
        observations.append(row)

    relative_5d = [
        float(item["vs_spy_5d_pct"]) for item in observations
        if isinstance(item.get("vs_spy_5d_pct"), (int, float))
    ]
    relative_20d = [
        float(item["vs_spy_20d_pct"]) for item in observations
        if isinstance(item.get("vs_spy_20d_pct"), (int, float))
    ]
    if not relative_5d and not relative_20d:
        return {
            "score": None,
            "status": "missing_market_proxy_or_benchmark",
            "confidence": "none",
            "proxy_count": len(proxies),
            "benchmark": "SPY",
            "observations": observations,
            "formula_version": "market_confirmation.v1",
        }

    median_5d = median(relative_5d) if relative_5d else None
    median_20d = median(relative_20d) if relative_20d else None
    score = 50.0
    if median_5d is not None:
        score += _clamp(median_5d * 8, -20, 20)
        breadth = sum(value > 0 for value in relative_5d) / len(relative_5d)
        score += (breadth - 0.5) * 20
    else:
        breadth = None
    if median_20d is not None:
        score += _clamp(median_20d * 4, -20, 20)
    score = round(_clamp(score, 0, 100), 2)
    confidence = "medium" if len(proxies) >= 2 and relative_5d and relative_20d else "low"
    return {
        "score": score,
        "status": "available",
        "confidence": confidence,
        "proxy_count": len(proxies),
        "benchmark": "SPY",
        "median_vs_spy_5d_pct": round(median_5d, 4) if median_5d is not None else None,
        "median_vs_spy_20d_pct": round(median_20d, 4) if median_20d is not None else None,
        "positive_5d_proxy_share": round(breadth, 4) if breadth is not None else None,
        "observations": observations,
        "formula_version": "market_confirmation.v1",
        "note": "Price confirmation only; it does not establish industry or earnings leadership.",
    }


def industry_leading_data_score(
    sector_id: str,
    sector_metrics: dict[str, Any],
) -> dict[str, Any]:
    """Aggregate only validated, fresh operating proxies for one sector."""
    accepted = [
        item for item in sector_metrics.get("metrics", [])
        if item.get("sector_id") == sector_id
        and item.get("dimension_id") == "industry_leading_data"
        and item.get("status") == "available"
        and isinstance(item.get("score"), (int, float))
        and item.get("source_grade") == "A"
        and item.get("primary_source_confirmed") is True
    ]
    if not accepted:
        return {
            "score": None,
            "status": "awaiting_structured_indicator_values",
            "confidence": "none",
            "metric_count": 0,
            "observations": [],
            "formula_version": "industry_leading_data.v1",
        }
    scores = [float(item["score"]) for item in accepted]
    observations = [{
        key: item.get(key)
        for key in (
            "metric_id", "label_ko", "series_id", "source_url", "observation_date",
            "latest_value", "change_1_period_pct", "change_3_period_pct",
            "change_12_period_pct", "score", "geographic_scope", "proxy_scope",
            "limitation_ko", "source_grade", "primary_source_confirmed",
        )
    } for item in accepted]
    return {
        "score": round(median(scores), 2),
        "status": "available",
        "confidence": "medium" if len(accepted) >= 2 else "low",
        "metric_count": len(accepted),
        "observations": observations,
        "formula_version": "industry_leading_data.v1",
        "note": "Official operating proxies only; this does not establish earnings or order leadership.",
    }


def fundamental_dimension_score(
    sector_id: str,
    dimension_id: str,
    fundamentals: dict[str, Any],
) -> dict[str, Any]:
    """Accept only dimension rows that passed company and source coverage gates."""
    row = next((
        item for item in fundamentals.get("dimension_scores", [])
        if item.get("sector_id") == sector_id and item.get("dimension_id") == dimension_id
    ), None)
    if not row or row.get("status") != "available" or not isinstance(row.get("score"), (int, float)):
        return {
            "score": None,
            "status": row.get("status") if row else (
                "awaiting_structured_estimate_revisions"
                if dimension_id == "earnings_revisions"
                else "awaiting_verified_orders_capex_backlog"
            ),
            "confidence": "none",
            "company_count": int(row.get("company_count", 0)) if row else 0,
            "candidate_company_count": int(row.get("candidate_company_count", 0)) if row else 0,
            "observations": row.get("observation_ids", []) if row else [],
            "source_urls": row.get("source_urls", []) if row else [],
        }
    return {
        "score": round(float(row["score"]), 2),
        "status": "available",
        "confidence": row.get("confidence", "medium"),
        "company_count": row.get("company_count"),
        "candidate_company_count": row.get("candidate_company_count"),
        "minimum_company_count": row.get("minimum_company_count"),
        "independent_source_count": row.get("independent_source_count"),
        "observations": row.get("observation_ids", []),
        "source_urls": row.get("source_urls", []),
        "formula_version": f"{dimension_id}.v1",
        "note": "Verified company coverage gate passed; still a research-priority input, not a recommendation.",
    }


def driver_dimension_score(
    sector_id: str,
    dimension_id: str,
    drivers: dict[str, Any],
) -> dict[str, Any]:
    """Accept only pre-validated primary driver rows from the dedicated collector."""
    row = next((
        item for item in drivers.get("dimension_scores", [])
        if item.get("sector_id") == sector_id and item.get("dimension_id") == dimension_id
    ), None)
    missing_status = (
        "awaiting_primary_policy_or_demand_evidence"
        if dimension_id == "structural_driver"
        else "awaiting_dated_catalyst_and_persistence_evidence"
    )
    if not row or row.get("status") != "available" or not isinstance(row.get("score"), (int, float)):
        return {
            "score": None,
            "status": row.get("status") if row else missing_status,
            "confidence": "none",
            "independent_source_count": int(row.get("independent_source_count", 0)) if row else 0,
            "minimum_independent_sources": row.get("minimum_independent_sources") if row else None,
            "observations": row.get("evidence_ids", []) if row else [],
            "source_urls": row.get("source_urls", []) if row else [],
        }
    return {
        "score": round(float(row["score"]), 2),
        "status": "available",
        "confidence": row.get("confidence", "medium"),
        "independent_source_count": row.get("independent_source_count"),
        "minimum_independent_sources": row.get("minimum_independent_sources"),
        "observations": row.get("evidence_ids", []),
        "source_urls": row.get("source_urls", []),
        "formula_version": f"{dimension_id}.v1",
        "note": "Dated primary evidence only; durability is not a forecast of sector returns.",
    }


def _dimension_templates(
    sector: dict[str, Any],
    scoring_dimensions: list[dict[str, Any]],
    industry_score: dict[str, Any],
    fundamental_scores: dict[str, dict[str, Any]],
    driver_scores: dict[str, dict[str, Any]],
    market_score: dict[str, Any],
) -> dict[str, dict[str, Any]]:
    weights = {item["dimension_id"]: item for item in scoring_dimensions}
    missing_contracts = {
        "industry_leading_data": {
            "status": "awaiting_structured_indicator_values",
            "required_inputs": [item["indicator_id"] for item in sector["leading_indicators"]],
        },
        "earnings_revisions": {
            "status": "awaiting_structured_estimate_revisions",
            "required_inputs": ["revenue_estimate_revision", "eps_estimate_revision", "company_guidance_change"],
        },
        "orders_capex_backlog": {
            "status": "awaiting_verified_orders_capex_backlog",
            "required_inputs": ["new_orders_growth", "backlog_growth", "capex_guidance_change"],
        },
        "structural_driver": {
            "status": "awaiting_primary_policy_or_demand_evidence",
            "required_inputs": ["primary_policy_support", "multi_year_demand_commitment"],
        },
        "catalyst_durability": {
            "status": "awaiting_dated_catalyst_and_persistence_evidence",
            "required_inputs": ["confirmed_catalyst_date", "expected_duration", "invalidation_condition"],
        },
    }
    result: dict[str, dict[str, Any]] = {}
    for dimension_id, definition in weights.items():
        if dimension_id == "industry_leading_data":
            result[dimension_id] = {
                "weight": definition["weight"],
                "label_ko": definition["label_ko"],
                "required_inputs": missing_contracts[dimension_id]["required_inputs"],
                **industry_score,
            }
        elif dimension_id in fundamental_scores:
            result[dimension_id] = {
                "weight": definition["weight"],
                "label_ko": definition["label_ko"],
                "required_inputs": missing_contracts[dimension_id]["required_inputs"],
                **fundamental_scores[dimension_id],
            }
        elif dimension_id in driver_scores:
            result[dimension_id] = {
                "weight": definition["weight"],
                "label_ko": definition["label_ko"],
                "required_inputs": missing_contracts[dimension_id]["required_inputs"],
                **driver_scores[dimension_id],
            }
        elif dimension_id == "market_confirmation":
            result[dimension_id] = {
                "weight": definition["weight"],
                "label_ko": definition["label_ko"],
                **market_score,
            }
        else:
            result[dimension_id] = {
                "weight": definition["weight"],
                "label_ko": definition["label_ko"],
                "score": None,
                "confidence": "none",
                **missing_contracts[dimension_id],
            }
    return result


def composite_score(
    dimensions: dict[str, dict[str, Any]],
    evidence: dict[str, Any],
) -> dict[str, Any]:
    available = {
        dimension_id: item for dimension_id, item in dimensions.items()
        if isinstance(item.get("score"), (int, float))
    }
    coverage = sum(int(item["weight"]) for item in available.values())
    missing_required = sorted(REQUIRED_SCORING_DIMENSIONS - set(available))
    source_gate = int(evidence.get("independent_source_count", 0)) >= 2
    primary_gate = int(
        evidence.get("primary_confirmed_evidence_count", evidence.get("primary_confirmed_record_count", 0))
    ) >= 1
    blockers: list[str] = []
    if coverage < MINIMUM_SCORING_COVERAGE_WEIGHT:
        blockers.append("dimension_coverage_below_60")
    if missing_required:
        blockers.append("missing_required_dimensions")
    if not source_gate:
        blockers.append("fewer_than_two_independent_sources")
    if not primary_gate:
        blockers.append("no_primary_confirmed_record")
    if blockers:
        return {
            "leadership_score": None,
            "ranking_bucket": "unscored",
            "score_status": "insufficient_evidence",
            "available_dimension_weight_pct": coverage,
            "missing_required_dimensions": missing_required,
            "blockers": blockers,
        }
    weighted = sum(float(item["score"]) * int(item["weight"]) for item in available.values()) / coverage
    score = round(weighted, 2)
    bucket = "A" if score >= 75 else "B" if score >= 60 else "C"
    return {
        "leadership_score": score,
        "ranking_bucket": bucket,
        "score_status": "scored_research_priority",
        "available_dimension_weight_pct": coverage,
        "missing_required_dimensions": [],
        "blockers": [],
    }


def _sector_evidence(
    sector_id: str,
    records: list[dict[str, Any]],
    sector_metrics: dict[str, Any],
    sector_fundamentals: dict[str, Any],
    sector_drivers: dict[str, Any],
) -> dict[str, Any]:
    accepted = [record for record in records if sector_id in record.get("sector_ids", [])]
    candidates = [
        record for record in records
        if sector_id in record.get("sector_candidate_ids", []) and sector_id not in record.get("sector_ids", [])
    ]
    record_source_ids = sorted({
        str(record.get("publisher") or record.get("source_id"))
        for record in accepted
        if record.get("publisher") or record.get("source_id")
    })
    accepted_metrics = [
        item for item in sector_metrics.get("metrics", [])
        if item.get("sector_id") == sector_id
        and item.get("status") == "available"
        and isinstance(item.get("score"), (int, float))
    ]
    metric_source_ids = sorted({
        str(item.get("upstream_source") or item.get("provider"))
        for item in accepted_metrics
        if item.get("upstream_source") or item.get("provider")
    })
    accepted_estimates = [
        item for item in sector_fundamentals.get("estimate_observations", [])
        if item.get("sector_id") == sector_id and item.get("eligible_for_sector_score") is True
    ]
    accepted_operating = [
        item for item in sector_fundamentals.get("operating_observations", [])
        if item.get("sector_id") == sector_id and item.get("eligible_for_sector_score") is True
    ]
    fundamental_source_ids = sorted({
        str(item.get("source_provider") or item.get("source_url"))
        for item in [*accepted_estimates, *accepted_operating]
        if item.get("source_provider") or item.get("source_url")
    })
    accepted_drivers = [
        item for item in sector_drivers.get("observations", [])
        if item.get("sector_id") == sector_id and item.get("eligible_for_score") is True
    ]
    driver_source_ids = sorted({
        str(item.get("source_owner")) for item in accepted_drivers if item.get("source_owner")
    })
    source_ids = sorted(
        set(record_source_ids) | set(metric_source_ids) | set(fundamental_source_ids) | set(driver_source_ids)
    )
    primary_record_count = sum(bool(record.get("primary_source_confirmed")) for record in accepted)
    primary_metric_count = sum(bool(item.get("primary_source_confirmed")) for item in accepted_metrics)
    primary_fundamental_count = sum(
        bool(item.get("primary_source_confirmed")) for item in [*accepted_estimates, *accepted_operating]
    )
    primary_driver_count = sum(bool(item.get("primary_source_confirmed")) for item in accepted_drivers)
    return {
        "accepted_record_count": len(accepted),
        "candidate_only_record_count": len(candidates),
        "accepted_structured_metric_count": len(accepted_metrics),
        "accepted_fundamental_observation_count": len(accepted_estimates) + len(accepted_operating),
        "accepted_driver_observation_count": len(accepted_drivers),
        "independent_source_count": len(source_ids),
        "independent_source_ids": source_ids,
        "record_source_ids": record_source_ids,
        "structured_metric_source_ids": metric_source_ids,
        "fundamental_source_ids": fundamental_source_ids,
        "driver_source_ids": driver_source_ids,
        "primary_confirmed_record_count": primary_record_count,
        "primary_confirmed_structured_metric_count": primary_metric_count,
        "primary_confirmed_fundamental_count": primary_fundamental_count,
        "primary_confirmed_driver_count": primary_driver_count,
        "primary_confirmed_evidence_count": (
            primary_record_count + primary_metric_count + primary_fundamental_count + primary_driver_count
        ),
        "records_by_grade": dict(sorted(Counter(str(record.get("source_grade") or "unknown") for record in accepted).items())),
        "accepted_record_ids": [record.get("id") for record in accepted if record.get("id")],
        "note": "Connection counts do not establish direction or economic exposure.",
    }


def create_sector_snapshot(
    report_date: str,
    daily_snapshot: dict[str, Any],
    master: dict[str, Any],
) -> dict[str, Any]:
    records = classify_records(daily_snapshot.get("records", []), master)
    market_payload = annotate_market_payload(daily_snapshot.get("etf_metrics", {}), master)
    sector_metrics = daily_snapshot.get("sector_metrics", {})
    sector_fundamentals = daily_snapshot.get("sector_fundamentals", {})
    sector_drivers = daily_snapshot.get("sector_drivers", {})
    sectors: list[dict[str, Any]] = []
    for sector in master["sectors"]:
        evidence = _sector_evidence(
            sector["sector_id"], records, sector_metrics, sector_fundamentals, sector_drivers,
        )
        industry_score = industry_leading_data_score(sector["sector_id"], sector_metrics)
        fundamental_scores = {
            dimension_id: fundamental_dimension_score(
                sector["sector_id"], dimension_id, sector_fundamentals,
            )
            for dimension_id in ("earnings_revisions", "orders_capex_backlog")
        }
        driver_scores = {
            dimension_id: driver_dimension_score(sector["sector_id"], dimension_id, sector_drivers)
            for dimension_id in ("structural_driver", "catalyst_durability")
        }
        market_score = market_confirmation_score(sector["sector_id"], market_payload)
        dimensions = _dimension_templates(
            sector, master["scoring_dimensions"], industry_score, fundamental_scores, driver_scores, market_score,
        )
        score_result = composite_score(dimensions, evidence)
        if score_result["score_status"] == "scored_research_priority":
            research_state = "scored_research_candidate"
        elif industry_score["score"] is not None and market_score["score"] is not None:
            research_state = "operating_and_market_signals_unscored"
        elif industry_score["score"] is not None:
            research_state = "operating_signal_only"
        elif market_score["score"] is not None:
            research_state = "market_signal_only"
        elif evidence["accepted_record_count"]:
            research_state = "evidence_connected_not_directional"
        else:
            research_state = "no_current_signal"
        sectors.append({
            "sector_id": sector["sector_id"],
            "name_ko": sector["name_ko"],
            "name_en": sector["name_en"],
            "classification": sector["classification"],
            "beneficiary_pathways": [
                {"pathway_id": item["pathway_id"], "label_ko": item["label_ko"]}
                for item in sector["beneficiary_pathways"]
            ],
            "research_state": research_state,
            "evidence_readiness": evidence,
            "dimension_scores": dimensions,
            **score_result,
        })
    sectors.sort(key=lambda item: item["sector_id"])
    scored = [item for item in sectors if item["leadership_score"] is not None]
    ranked = sorted(scored, key=lambda item: (-item["leadership_score"], item["sector_id"]))
    result = {
        "schema_version": SCHEMA_VERSION,
        "report_date": report_date,
        "generated_from": daily_snapshot.get("schema_version"),
        "source_snapshot_generated_at": daily_snapshot.get("generated_at"),
        "sector_master_version": master["version_date"],
        "score_policy": {
            "minimum_dimension_coverage_weight_pct": MINIMUM_SCORING_COVERAGE_WEIGHT,
            "required_dimensions": sorted(REQUIRED_SCORING_DIMENSIONS),
            "minimum_independent_sources": 2,
            "primary_confirmation_required": True,
            "ranking_buckets": {"A": ">=75", "B": "60-74.99", "C": "<60"},
            "posture": "research_priority_not_investment_recommendation",
        },
        "summary": {
            "total_sector_count": len(sectors),
            "scored_sector_count": len(scored),
            "operating_and_market_signals_unscored_count": sum(
                item["research_state"] == "operating_and_market_signals_unscored" for item in sectors
            ),
            "operating_signal_only_count": sum(item["research_state"] == "operating_signal_only" for item in sectors),
            "market_signal_only_count": sum(item["research_state"] == "market_signal_only" for item in sectors),
            "evidence_connected_not_directional_count": sum(
                item["research_state"] == "evidence_connected_not_directional" for item in sectors
            ),
            "no_current_signal_count": sum(item["research_state"] == "no_current_signal" for item in sectors),
            "top_scored_sectors": [
                {
                    "sector_id": item["sector_id"],
                    "name_ko": item["name_ko"],
                    "leadership_score": item["leadership_score"],
                    "ranking_bucket": item["ranking_bucket"],
                }
                for item in ranked[:5]
            ],
        },
        "sectors": sectors,
    }
    validate_sector_snapshot(result, master)
    return result


def compact_sector_snapshot(snapshot: dict[str, Any]) -> dict[str, Any]:
    operating_observations = [
        {
            "sector_id": item["sector_id"],
            "name_ko": item["name_ko"],
            "industry_leading_data_score": item["dimension_scores"]["industry_leading_data"]["score"],
            "industry_confidence": item["dimension_scores"]["industry_leading_data"]["confidence"],
            "research_state": item["research_state"],
            "leadership_score": item["leadership_score"],
        }
        for item in snapshot["sectors"]
        if item["dimension_scores"]["industry_leading_data"]["score"] is not None
    ]
    operating_observations.sort(
        key=lambda item: (-float(item["industry_leading_data_score"]), item["sector_id"]),
    )
    market_observations = [
        {
            "sector_id": item["sector_id"],
            "name_ko": item["name_ko"],
            "market_confirmation_score": item["dimension_scores"]["market_confirmation"]["score"],
            "market_confidence": item["dimension_scores"]["market_confirmation"]["confidence"],
            "research_state": item["research_state"],
            "leadership_score": item["leadership_score"],
        }
        for item in snapshot["sectors"]
        if item["dimension_scores"]["market_confirmation"]["score"] is not None
    ]
    market_observations.sort(
        key=lambda item: (-float(item["market_confirmation_score"]), item["sector_id"]),
    )
    fundamental_observations: list[dict[str, Any]] = []
    fundamental_gaps: list[dict[str, Any]] = []
    for item in snapshot["sectors"]:
        for dimension_id in ("earnings_revisions", "orders_capex_backlog"):
            dimension = item["dimension_scores"][dimension_id]
            compact = {
                "sector_id": item["sector_id"],
                "name_ko": item["name_ko"],
                "dimension_id": dimension_id,
                "status": dimension.get("status"),
                "score": dimension.get("score"),
                "verified_company_count": dimension.get("company_count", 0),
                "candidate_company_count": dimension.get("candidate_company_count", 0),
                "leadership_score": item["leadership_score"],
            }
            if dimension.get("score") is not None:
                fundamental_observations.append(compact)
            elif int(dimension.get("candidate_company_count", 0) or 0) > 0:
                fundamental_gaps.append(compact)
    fundamental_observations.sort(
        key=lambda item: (-float(item["score"]), item["sector_id"], item["dimension_id"]),
    )
    fundamental_gaps.sort(key=lambda item: (item["sector_id"], item["dimension_id"]))
    driver_observations: list[dict[str, Any]] = []
    driver_gaps: list[dict[str, Any]] = []
    for item in snapshot["sectors"]:
        for dimension_id in ("structural_driver", "catalyst_durability"):
            dimension = item["dimension_scores"][dimension_id]
            compact = {
                "sector_id": item["sector_id"],
                "name_ko": item["name_ko"],
                "dimension_id": dimension_id,
                "status": dimension.get("status"),
                "score": dimension.get("score"),
                "independent_source_count": dimension.get("independent_source_count", 0),
                "evidence_ids": dimension.get("observations", []),
                "leadership_score": item["leadership_score"],
            }
            (driver_observations if dimension.get("score") is not None else driver_gaps).append(compact)
    driver_observations.sort(key=lambda item: (-float(item["score"]), item["sector_id"], item["dimension_id"]))
    driver_gaps.sort(key=lambda item: (item["sector_id"], item["dimension_id"]))
    return {
        "schema_version": snapshot["schema_version"],
        "sector_master_version": snapshot["sector_master_version"],
        "score_policy": snapshot["score_policy"],
        "summary": snapshot["summary"],
        "industry_leading_data_observations": operating_observations,
        "market_confirmation_observations": market_observations,
        "fundamental_dimension_observations": fundamental_observations,
        "fundamental_coverage_gaps": fundamental_gaps,
        "driver_dimension_observations": driver_observations,
        "driver_coverage_gaps": driver_gaps,
        "note": "Operating and market observations are not a sector-leadership ranking unless leadership_score is present.",
    }


def validate_sector_snapshot(snapshot: dict[str, Any], master: dict[str, Any]) -> None:
    if snapshot.get("schema_version") != SCHEMA_VERSION:
        raise ValueError(f"Unexpected sector snapshot schema: {snapshot.get('schema_version')}")
    expected = {sector["sector_id"] for sector in master["sectors"]}
    actual = {sector.get("sector_id") for sector in snapshot.get("sectors", [])}
    if actual != expected or len(snapshot.get("sectors", [])) != len(expected):
        raise ValueError("Sector snapshot must contain every master sector exactly once")
    for sector in snapshot["sectors"]:
        result = composite_score(sector["dimension_scores"], sector["evidence_readiness"])
        if sector.get("leadership_score") != result["leadership_score"]:
            raise ValueError(f"Invalid leadership score gate for {sector['sector_id']}")
        if sector.get("ranking_bucket") != result["ranking_bucket"]:
            raise ValueError(f"Invalid ranking bucket for {sector['sector_id']}")


def write_sector_snapshot(
    report_date: str,
    daily_snapshot: dict[str, Any],
    master: dict[str, Any],
) -> tuple[dict[str, Any], Path]:
    snapshot = create_sector_snapshot(report_date, daily_snapshot, master)
    output_dir = ROOT / "workspace" / "snapshots" / report_date
    output_dir.mkdir(parents=True, exist_ok=True)
    output = output_dir / "sector_snapshot.json"
    output.write_text(json.dumps(snapshot, ensure_ascii=False, indent=2), encoding="utf-8")
    return snapshot, output


def main() -> None:
    parser = argparse.ArgumentParser(description="Build the daily deterministic sector snapshot")
    parser.add_argument("--date", default=date.today().isoformat())
    parser.add_argument("--snapshot-file")
    args = parser.parse_args()
    source = Path(args.snapshot_file) if args.snapshot_file else ROOT / "workspace" / "snapshots" / args.date / "daily_snapshot.json"
    if not source.exists():
        raise SystemExit(f"Daily snapshot does not exist: {source}")
    daily_snapshot = json.loads(source.read_text(encoding="utf-8"))
    snapshot, output = write_sector_snapshot(args.date, daily_snapshot, load_sector_master())
    print(f"Sector snapshot saved: {output.relative_to(ROOT)}")
    print(
        "Sector score status: "
        f"scored={snapshot['summary']['scored_sector_count']} | "
        f"market_signal_only={snapshot['summary']['market_signal_only_count']}"
    )


if __name__ == "__main__":
    main()
