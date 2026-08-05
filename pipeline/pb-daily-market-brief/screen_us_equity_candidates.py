"""Rank bounded U.S. equity event and market-anomaly research candidates."""

from __future__ import annotations

import argparse
import json
from datetime import date
from pathlib import Path
from typing import Any

from build_us_equity_universe import ALLOWED_RIGHTS_LABELS, normalize_ticker, root_path
from collectors.common import ROOT

SCHEMA_VERSION = "us_equity_candidate_screen.v1"
MARKET_INPUT_SCHEMA_VERSION = "us_equity_market_snapshot_input.v1"
MAX_CANDIDATES = 10
MAX_DEEP_ANALYSIS = 3


def _number(value: Any) -> float | None:
    if value in {None, "", ".", "-", "None", "null", "N/A"}:
        return None
    try:
        return float(str(value).replace(",", "").replace("%", ""))
    except (TypeError, ValueError):
        return None


def return_pct(current: float | None, base: float | None) -> float | None:
    if current is None or base in {None, 0}:
        return None
    return round((current / float(base) - 1) * 100, 4)


def validate_market_input(payload: dict[str, Any], report_date: str) -> None:
    if payload.get("schema_version") != MARKET_INPUT_SCHEMA_VERSION:
        raise ValueError("Unexpected U.S. equity market snapshot input schema")
    if payload.get("report_date") != report_date:
        raise ValueError("U.S. equity market snapshot report date does not match")
    if payload.get("rights_label") not in ALLOWED_RIGHTS_LABELS:
        raise ValueError("Market snapshot is missing an accepted automation-rights label")
    if payload.get("source_grade") not in {"A", "B"}:
        raise ValueError("Market snapshot source must be grade A or B")
    if not str(payload.get("source_url") or "").startswith("https://"):
        raise ValueError("Market snapshot source URL must use https")
    report_day = date.fromisoformat(report_date)
    as_of = date.fromisoformat(str(payload.get("as_of") or ""))
    if as_of > report_day:
        raise ValueError("Market snapshot cannot be dated after the report")
    if payload.get("market_cutoff") not in {"official_close", "licensed_delayed_close"}:
        raise ValueError("Market snapshot requires a supported market_cutoff")
    for field in ("benchmarks", "securities"):
        rows = payload.get(field)
        if not isinstance(rows, list):
            raise ValueError(f"Market snapshot {field} must be an array")
        seen: set[str] = set()
        for row in rows:
            ticker = normalize_ticker(row.get("ticker"))
            if not ticker:
                raise ValueError(f"Market snapshot {field} contains an invalid ticker")
            if ticker in seen:
                raise ValueError(f"Market snapshot {field} contains duplicate ticker {ticker}")
            seen.add(ticker)
            for price_field in ("close", "previous_close"):
                value = _number(row.get(price_field))
                if value is None or value <= 0:
                    raise ValueError(f"Market snapshot {ticker} requires positive {price_field}")
            for optional_price in ("close_5_sessions_ago", "close_20_sessions_ago"):
                value = _number(row.get(optional_price))
                if value is not None and value <= 0:
                    raise ValueError(f"Market snapshot {ticker} has invalid {optional_price}")
            if field == "securities":
                volume = _number(row.get("volume"))
                average = _number(row.get("avg_volume_20d"))
                if volume is None or volume < 0 or average is None or average <= 0:
                    raise ValueError(f"Market snapshot {ticker} requires valid volume fields")


def normalize_market_row(row: dict[str, Any]) -> dict[str, Any]:
    close = _number(row.get("close"))
    previous = _number(row.get("previous_close"))
    five_day = _number(row.get("close_5_sessions_ago"))
    twenty_day = _number(row.get("close_20_sessions_ago"))
    volume = _number(row.get("volume"))
    average = _number(row.get("avg_volume_20d"))
    return {
        "ticker": normalize_ticker(row.get("ticker")),
        "company_name": row.get("company_name"),
        "sector_etf": normalize_ticker(row.get("sector_etf")) or None,
        "close": close,
        "return_1d_pct": return_pct(close, previous),
        "return_5d_pct": return_pct(close, five_day),
        "return_20d_pct": return_pct(close, twenty_day),
        "volume": volume,
        "avg_volume_20d": average,
        "volume_ratio_20d": (
            round(float(volume) / float(average), 4)
            if volume is not None and average not in {None, 0} else None
        ),
    }


def _event_type(record: dict[str, Any]) -> tuple[str, int]:
    tags = {str(tag).upper() for tag in record.get("tags", [])}
    title = str(record.get("title") or "").upper()
    if "10-K" in tags or "10-K" in title:
        return "sec_10k", 24
    if "10-Q" in tags or "10-Q" in title:
        return "sec_10q", 24
    if "8-K" in tags or "8-K" in title:
        return "sec_8k", 20
    if record.get("source_id") == "sec_edgar":
        return "sec_other", 12
    if record.get("primary_source_confirmed") is True:
        lowered = " ".join([title, " ".join(tags)]).casefold()
        if "earnings" in lowered or "guidance" in lowered:
            return "official_earnings_or_guidance", 30
        return "other_primary_event", 15
    if record.get("source_grade") in {"B", "C"}:
        return "secondary_report", 6
    return "discovery_metadata", 0


def event_evidence(inbox: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    grouped: dict[str, list[dict[str, Any]]] = {}
    for record in inbox:
        for value in record.get("tickers", []):
            ticker = normalize_ticker(value)
            if ticker:
                grouped.setdefault(ticker, []).append(record)
    result: dict[str, dict[str, Any]] = {}
    for ticker, records in grouped.items():
        events: list[dict[str, Any]] = []
        for record in records:
            event_type, importance = _event_type(record)
            primary = record.get("primary_source_confirmed") is True
            body_verified = str(record.get("evidence_label") or "") in {
                "verified_primary_body_excerpt",
                "verified_primary_full_text",
            }
            verified_facts = []
            if body_verified:
                for fact in (record.get("filing_facts") or {}).get("facts", [])[:4]:
                    source_url = str(fact.get("source_url") or record.get("url") or "")
                    if not source_url.startswith("https://"):
                        continue
                    verified_facts.append({
                        "fact_id": fact.get("fact_id"),
                        "field": fact.get("field"),
                        "value_text": fact.get("value_text"),
                        "context": str(fact.get("context") or "")[:360],
                        "evidence_status": fact.get("evidence_status"),
                        "evidence_scope": fact.get("evidence_scope"),
                        "source_url": source_url,
                    })
            official_score = 10 if body_verified else 6 if primary else 0
            events.append({
                "record_id": record.get("id"),
                "title": record.get("title"),
                "event_type": event_type,
                "event_importance_score": importance,
                "official_material_score": official_score,
                "source_grade": record.get("source_grade"),
                "primary_source_confirmed": primary,
                "evidence_scope": record.get("evidence_scope"),
                "source_url": record.get("url"),
                "verified_facts": verified_facts,
            })
        events.sort(
            key=lambda row: (
                -int(row["event_importance_score"]),
                -int(row["official_material_score"]),
                str(row.get("record_id") or ""),
            )
        )
        result[ticker] = {
            "event_importance_score": max(
                (int(row["event_importance_score"]) for row in events),
                default=0,
            ),
            "official_material_score": max(
                (int(row["official_material_score"]) for row in events),
                default=0,
            ),
            "events": events[:3],
        }
    return result


def _threshold_score(value: float | None, thresholds: list[tuple[float, int]]) -> int:
    absolute = abs(float(value)) if value is not None else 0.0
    for threshold, score in thresholds:
        if absolute >= threshold:
            return score
    return 0


def candidate_row(
    security: dict[str, Any],
    market: dict[str, Any],
    benchmarks: dict[str, dict[str, Any]],
    evidence: dict[str, Any],
    market_freshness: str,
) -> dict[str, Any]:
    spy = benchmarks.get("SPY", {})
    sector = benchmarks.get(str(market.get("sector_etf") or ""), {})
    relative_1d = (
        round(float(market["return_1d_pct"]) - float(spy["return_1d_pct"]), 4)
        if market.get("return_1d_pct") is not None and spy.get("return_1d_pct") is not None
        else None
    )
    relative_5d = (
        round(float(market["return_5d_pct"]) - float(spy["return_5d_pct"]), 4)
        if market.get("return_5d_pct") is not None and spy.get("return_5d_pct") is not None
        else None
    )
    sector_relative_1d = (
        round(float(market["return_1d_pct"]) - float(sector["return_1d_pct"]), 4)
        if market.get("return_1d_pct") is not None and sector.get("return_1d_pct") is not None
        else None
    )
    price_score = _threshold_score(
        relative_1d,
        [(10.0, 20), (5.0, 15), (3.0, 10), (1.5, 5)],
    )
    volume_ratio = market.get("volume_ratio_20d")
    volume_score = (
        15 if volume_ratio is not None and volume_ratio >= 4 else
        10 if volume_ratio is not None and volume_ratio >= 2 else
        5 if volume_ratio is not None and volume_ratio >= 1.5 else
        0
    )
    sector_relative_score = _threshold_score(
        sector_relative_1d,
        [(5.0, 10), (3.0, 7), (1.5, 4)],
    )
    sector_move_score = _threshold_score(
        sector.get("return_1d_pct"),
        [(2.0, 5), (1.0, 3)],
    )
    sector_influence_score = min(15, sector_relative_score + sector_move_score)
    index_relative_score = _threshold_score(
        relative_5d,
        [(5.0, 10), (3.0, 7), (1.5, 4)],
    )
    breakdown = {
        "event_importance": int(evidence.get("event_importance_score", 0)),
        "abnormal_price_move": price_score,
        "volume_anomaly": volume_score,
        "sector_influence": sector_influence_score,
        "official_material": int(evidence.get("official_material_score", 0)),
        "index_relative_strength": index_relative_score,
    }
    total = sum(breakdown.values())
    reasons: list[str] = []
    if breakdown["event_importance"]:
        reasons.append("material_event")
    if price_score:
        reasons.append("abnormal_spy_relative_move")
    if volume_score:
        reasons.append("volume_anomaly")
    if sector_influence_score:
        reasons.append("sector_or_stock_sector_divergence")
    if index_relative_score:
        reasons.append("five_session_relative_strength")
    material = total >= 15 and bool(reasons)
    deep_analysis_eligible = bool(
        material
        and market_freshness == "current"
        and breakdown["official_material"] == 10
        and any(
            event.get("verified_facts")
            for event in evidence.get("events", [])
        )
        and any(event.get("source_url") for event in evidence.get("events", []))
    )
    return {
        "ticker": security["ticker"],
        "company_name": market.get("company_name") or security.get("company_name"),
        "index_memberships": security.get("index_memberships", []),
        "sector_ids": security.get("sector_ids", []),
        "selection_score": total,
        "score_breakdown": breakdown,
        "material_candidate": material,
        "deep_analysis_eligible": deep_analysis_eligible,
        "selection_reasons": reasons,
        "market_reaction": {
            **market,
            "spy_relative_1d_pct": relative_1d,
            "spy_relative_5d_pct": relative_5d,
            "sector_relative_1d_pct": sector_relative_1d,
            "sector_return_1d_pct": sector.get("return_1d_pct"),
        },
        "event_evidence": evidence.get("events", []),
        "evidence_status": (
            "primary_facts_available"
            if deep_analysis_eligible else
            "primary_body_without_supported_facts"
            if breakdown["official_material"] == 10 else
            "primary_metadata_only"
            if breakdown["official_material"] == 6 else
            "market_anomaly_without_primary_material"
        ),
        "next_workflow": (
            "bounded_company_analysis_card"
            if deep_analysis_eligible else
            "anomaly_watchlist_only"
        ),
        "posture": "research_candidate_not_investment_recommendation",
    }


def empty_screen(report_date: str, universe: dict[str, Any], status: str) -> dict[str, Any]:
    return {
        "schema_version": SCHEMA_VERSION,
        "report_date": report_date,
        "screen_status": status,
        "universe_security_count": universe.get("security_count", 0),
        "market_covered_security_count": 0,
        "material_candidate_count": 0,
        "deep_analysis_count": 0,
        "candidates": [],
        "deep_analysis_shortlist": [],
        "universe_coverage": {
            "full_index_scan_ready": bool(universe.get("full_index_scan_ready")),
            "membership_counts": dict(universe.get("membership_counts") or {}),
            "membership_source_count": len(universe.get("membership_sources") or []),
        },
        "market_source": None,
        "methodology": {
            "maximum_candidates": MAX_CANDIDATES,
            "maximum_deep_analysis": MAX_DEEP_ANALYSIS,
            "verified_primary_body_required_for_deep_analysis": True,
            "verified_primary_fact_required_for_deep_analysis": True,
        },
        "data_gaps": [
            "A current authorized batch market snapshot is required before ranking securities."
        ],
        "posture": "research_screen_not_investment_recommendation",
    }


def screen_us_equity_candidates(
    report_date: str,
    universe: dict[str, Any],
    inbox: list[dict[str, Any]],
    market_input: dict[str, Any] | None,
) -> dict[str, Any]:
    if market_input is None:
        return empty_screen(report_date, universe, "missing_market_snapshot_input")
    validate_market_input(market_input, report_date)
    age_days = (
        date.fromisoformat(report_date) - date.fromisoformat(str(market_input["as_of"]))
    ).days
    freshness = "current" if age_days <= 4 else "stale"
    universe_map = {
        str(row["ticker"]): row for row in universe.get("securities", [])
    }
    benchmarks = {
        row["ticker"]: row
        for row in (
            normalize_market_row(raw)
            for raw in market_input.get("benchmarks", [])
        )
    }
    if "SPY" not in benchmarks:
        return {
            **empty_screen(report_date, universe, "missing_spy_benchmark"),
            "market_source": {
                "provider": market_input.get("source_provider"),
                "source_url": market_input.get("source_url"),
                "as_of": market_input.get("as_of"),
                "freshness_status": freshness,
            },
        }
    evidence_map = event_evidence(inbox)
    rows: list[dict[str, Any]] = []
    for raw in market_input.get("securities", []):
        ticker = normalize_ticker(raw.get("ticker"))
        security = universe_map.get(ticker)
        if not security:
            continue
        market = normalize_market_row(raw)
        rows.append(candidate_row(
            security,
            market,
            benchmarks,
            evidence_map.get(ticker, {}),
            freshness,
        ))
    material = [row for row in rows if row["material_candidate"]]
    material.sort(key=lambda row: (
        -int(row["selection_score"]),
        -abs(float(row["market_reaction"].get("spy_relative_1d_pct") or 0)),
        row["ticker"],
    ))
    candidates = material[:MAX_CANDIDATES]
    deep = [
        row for row in candidates if row["deep_analysis_eligible"]
    ][:MAX_DEEP_ANALYSIS]
    if freshness == "stale":
        status = "stale_market_snapshot"
    elif deep:
        status = "deep_analysis_shortlist_ready"
    elif candidates:
        status = "candidates_without_primary_evidence"
    else:
        status = "no_material_candidates"
    result = {
        "schema_version": SCHEMA_VERSION,
        "report_date": report_date,
        "screen_status": status,
        "universe_security_count": universe.get("security_count", 0),
        "market_covered_security_count": len(rows),
        "material_candidate_count": len(material),
        "deep_analysis_count": len(deep),
        "candidates": candidates,
        "deep_analysis_shortlist": deep,
        "universe_coverage": {
            "full_index_scan_ready": bool(universe.get("full_index_scan_ready")),
            "membership_counts": dict(universe.get("membership_counts") or {}),
            "membership_source_count": len(universe.get("membership_sources") or []),
        },
        "market_source": {
            "provider": market_input.get("source_provider"),
            "source_url": market_input.get("source_url"),
            "source_grade": market_input.get("source_grade"),
            "rights_label": market_input.get("rights_label"),
            "as_of": market_input.get("as_of"),
            "age_days": age_days,
            "freshness_status": freshness,
            "market_cutoff": market_input.get("market_cutoff"),
        },
        "methodology": {
            "score_maximum": 100,
            "score_weights": {
                "event_importance": 30,
                "abnormal_price_move": 20,
                "volume_anomaly": 15,
                "sector_influence": 15,
                "official_material": 10,
                "index_relative_strength": 10,
            },
            "material_candidate_minimum_score": 15,
            "maximum_candidates": MAX_CANDIDATES,
            "maximum_deep_analysis": MAX_DEEP_ANALYSIS,
            "verified_primary_body_required_for_deep_analysis": True,
            "verified_primary_fact_required_for_deep_analysis": True,
            "grade_d_official_material_score": 0,
        },
        "data_gaps": [
            *(
                ["Market snapshot is stale; no candidate is eligible for deep analysis."]
                if freshness == "stale" else []
            ),
            "Consensus revisions, options, ownership, and institutional flow are not scored.",
            "Screen ranking is research prioritization, not a buy or sell recommendation.",
        ],
        "posture": "research_screen_not_investment_recommendation",
    }
    validate_candidate_screen(result)
    return result


def validate_candidate_screen(payload: dict[str, Any]) -> None:
    if payload.get("schema_version") != SCHEMA_VERSION:
        raise ValueError("Unexpected U.S. equity candidate screen schema")
    candidates = payload.get("candidates", [])
    deep = payload.get("deep_analysis_shortlist", [])
    if len(candidates) > MAX_CANDIDATES or len(deep) > MAX_DEEP_ANALYSIS:
        raise ValueError("Candidate screen exceeds bounded output limits")
    if int(payload.get("deep_analysis_count", -1)) != len(deep):
        raise ValueError("Deep-analysis count does not match shortlist")
    if any(row.get("deep_analysis_eligible") is not True for row in deep):
        raise ValueError("Deep-analysis shortlist contains an ineligible security")
    if any(
        int(row.get("score_breakdown", {}).get("official_material", 0)) != 10
        for row in deep
    ):
        raise ValueError("Deep analysis requires a verified primary body")
    if any(
        not any(event.get("verified_facts") for event in row.get("event_evidence", []))
        for row in deep
    ):
        raise ValueError("Deep analysis requires at least one verified primary fact")
    scores = [int(row.get("selection_score", 0)) for row in candidates]
    if scores != sorted(scores, reverse=True):
        raise ValueError("Candidate screen is not sorted by descending score")


def main() -> None:
    parser = argparse.ArgumentParser(description="Screen U.S. equity research candidates")
    parser.add_argument("--date", required=True)
    parser.add_argument("--universe-file")
    parser.add_argument("--inbox-file")
    parser.add_argument("--market-input")
    parser.add_argument("--output-file")
    args = parser.parse_args()
    universe_path = root_path(
        args.universe_file,
        ROOT / "workspace" / "us_equity_universe" / args.date / "us_equity_universe.json",
    )
    inbox_path = root_path(
        args.inbox_file,
        ROOT / "workspace" / "triaged" / args.date / "triaged_inbox.json",
    )
    market_path = root_path(
        args.market_input,
        ROOT / "workspace" / "us_equity_market_inputs" / args.date / "market_snapshot.json",
    )
    if not universe_path.exists() or not inbox_path.exists():
        raise SystemExit("U.S. equity universe and triaged inbox are required")
    market_input = (
        json.loads(market_path.read_text(encoding="utf-8"))
        if market_path.exists() else None
    )
    payload = screen_us_equity_candidates(
        args.date,
        json.loads(universe_path.read_text(encoding="utf-8")),
        json.loads(inbox_path.read_text(encoding="utf-8")),
        market_input,
    )
    output = root_path(
        args.output_file,
        ROOT / "workspace" / "us_equity_candidate_screen" / args.date / "candidate_screen.json",
    )
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"U.S. equity candidate screen saved: {output.relative_to(ROOT)}")
    print(
        f"U.S. equity candidate screen status: {payload['screen_status']} | "
        f"candidates={payload['material_candidate_count']} | "
        f"deep_analysis={payload['deep_analysis_count']}"
    )


if __name__ == "__main__":
    main()
