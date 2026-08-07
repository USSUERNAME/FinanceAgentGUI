"""Build a deterministic daily evidence snapshot and market scoreboard."""

from __future__ import annotations

import argparse
import json
import os
import re
from collections import Counter
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

from collectors.common import ROOT, canonicalize_url, load_dotenv
from collectors.common import load_source_config
from generate_macro_chart import observations
from build_sector_snapshot import compact_sector_snapshot, write_sector_snapshot
from sector_classifier import annotate_market_payload, classify_records, sector_evidence_summary
from sector_master import load_sector_master


def latest_file(directory: Path, pattern: str) -> Path | None:
    paths = sorted(directory.glob(pattern), key=lambda path: path.stat().st_mtime)
    return paths[-1] if paths else None


def load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def relative_return(numerator_pct: float, denominator_pct: float) -> float:
    return ((1 + numerator_pct / 100) / (1 + denominator_pct / 100) - 1) * 100


def percentile_rank(values: list[float], latest: float) -> float | None:
    if not values:
        return None
    return sum(value <= latest for value in values) / len(values) * 100


def fred_metric(series_id: str, label: str, api_key: str, report_date: date) -> dict[str, Any]:
    values = observations(series_id, api_key, (report_date - timedelta(days=180)).isoformat())
    if len(values) < 2:
        raise RuntimeError(f"FRED returned insufficient observations for {series_id}")
    latest_date, latest_value = values[-1]
    previous_value = values[-2][1]
    five_day_value = values[-6][1] if len(values) > 5 else values[0][1]
    recent_values = [value for _, value in values[-60:]]
    return {
        "series_id": series_id,
        "label": label,
        "value": latest_value,
        "as_of": latest_date.isoformat(),
        "change_1d": latest_value - previous_value,
        "change_5_sessions": latest_value - five_day_value,
        "percentile_60_observations": percentile_rank(recent_values, latest_value),
        "source": "FRED latest available observation",
        "source_grade": "A",
        "evidence_label": "fact_provider_standardized",
    }


def signal(label: str, value: float | None, positive_below: float, negative_above: float) -> dict[str, Any]:
    contribution = 0
    if value is not None:
        if value < positive_below:
            contribution = 1
        elif value > negative_above:
            contribution = -1
    return {"label": label, "value": value, "contribution": contribution}


def rule_based_signal(
    scoreboard: dict[str, Any], etf_payload: dict[str, Any] | None = None,
) -> dict[str, Any]:
    breadth = scoreboard.get("breadth", {})
    volatility = scoreboard.get("volatility", {})
    credit = scoreboard.get("credit", {})
    rates = scoreboard.get("rates", {})
    signals = [
        signal("RSP/SPY 5일 상대수익률", breadth.get("rsp_vs_spy_5d_pct"), -0.25, 0.25),
        signal("VIX/VIX3M", volatility.get("vix_term_ratio"), 0.95, 1.05),
        signal("하이일드 스프레드 5일 변화", credit.get("spread_change_5d_pct_point"), -0.05, 0.05),
        signal("10년 실질금리 5일 변화", rates.get("real_yield_change_5d_pct_point"), -0.05, 0.05),
    ]
    # Breadth is risk-positive when relative performance is above zero, unlike
    # the other three indicators where a lower value is risk-positive.
    breadth_value = breadth.get("rsp_vs_spy_5d_pct")
    if breadth_value is not None:
        signals[0]["contribution"] = 1 if breadth_value > 0.25 else -1 if breadth_value < -0.25 else 0
    score = sum(item["contribution"] for item in signals)
    core_label = "mild_risk_on" if score >= 2 else "mild_risk_off" if score <= -2 else "neutral"

    etf_items = {
        item.get("ticker"): item for item in (etf_payload or {}).get("items", [])
        if item.get("ticker")
    }
    spy = etf_items.get("SPY") or {}

    def versus_spy_5d(ticker: str) -> float | None:
        item = etf_items.get(ticker) or {}
        item_return = item.get("return_5d_pct")
        spy_return = spy.get("return_5d_pct")
        if not isinstance(item_return, (int, float)) or not isinstance(spy_return, (int, float)):
            return None
        return relative_return(float(item_return), float(spy_return))

    participation = {
        "qqq_vs_spy_5d_pct": versus_spy_5d("QQQ"),
        "iwm_vs_spy_5d_pct": versus_spy_5d("IWM"),
        "gld_vs_spy_5d_pct": versus_spy_5d("GLD"),
    }
    qqq = participation["qqq_vs_spy_5d_pct"]
    iwm = participation["iwm_vs_spy_5d_pct"]
    gld = participation["gld_vs_spy_5d_pct"]
    breadth_contribution = signals[0]["contribution"]
    volatility_contribution = signals[1]["contribution"]
    credit_contribution = signals[2]["contribution"]
    growth_contribution = 1 if qqq is not None and qqq > 0.25 else -1 if qqq is not None and qqq < -0.25 else 0
    small_cap_contribution = 1 if iwm is not None and iwm > 0.25 else -1 if iwm is not None and iwm < -0.25 else 0
    risk_participation = {
        "breadth": breadth_contribution,
        "growth": growth_contribution,
        "small_caps": small_cap_contribution,
        "credit": credit_contribution,
    }
    broad_positive_count = sum(value > 0 for value in risk_participation.values())
    defensive_negative_count = sum(
        value < 0 for value in (
            breadth_contribution, volatility_contribution, credit_contribution,
        )
    )

    label = core_label
    classification_reason = "core_cross_asset_score"
    if defensive_negative_count >= 2:
        label = "mild_risk_off"
        classification_reason = "breadth_volatility_credit_deterioration"
    elif breadth_contribution > 0 and (
        growth_contribution < 0 or small_cap_contribution < 0
    ):
        label = "selective_rotation"
        classification_reason = "breadth_positive_but_growth_or_small_caps_weak"
    elif (
        gld is not None and gld > 0.50 and broad_positive_count >= 2
        and (growth_contribution <= 0 or small_cap_contribution <= 0)
    ):
        label = "mixed"
        classification_reason = "safe_asset_strength_conflicts_with_risk_participation"
    elif all(value != 0 for value in risk_participation.values()) and broad_positive_count >= 3:
        label = "mild_risk_on"
        classification_reason = "broad_risk_participation"
    return {
        "label": label,
        "score": score,
        "range": [-4, 4],
        "signals": signals,
        "participation": participation,
        "risk_participation": risk_participation,
        "classification_reason": classification_reason,
        "note": "Deterministic monitoring signal only; GPT analysis must discuss conflicts and may lower confidence.",
    }


def market_input_metric(
    market_input: dict[str, Any] | None,
    ticker: str,
) -> dict[str, Any] | None:
    if not market_input:
        return None
    for row in market_input.get("benchmarks", []):
        if row.get("ticker") != ticker:
            continue
        close = row.get("close")
        previous = row.get("previous_close")
        five_day = row.get("close_5_sessions_ago")
        twenty_day = row.get("close_20_sessions_ago")
        if not all(isinstance(value, (int, float)) and value > 0 for value in (
            close, previous, five_day, twenty_day,
        )):
            return None
        return {
            "ticker": ticker,
            "as_of": row.get("as_of") or market_input.get("as_of"),
            "close": close,
            "return_1d_pct": (close / previous - 1) * 100,
            "return_5d_pct": (close / five_day - 1) * 100,
            "return_20d_pct": (close / twenty_day - 1) * 100,
        }
    return None


def build_scoreboard(
    report_date: str,
    etf_payload: dict[str, Any],
    us_market_input: dict[str, Any] | None = None,
) -> tuple[dict[str, Any], list[str]]:
    warnings: list[str] = []
    items = {item["ticker"]: item for item in etf_payload.get("items", [])}
    spy = items.get("SPY")
    rsp = market_input_metric(us_market_input, "RSP")
    if rsp is None:
        warnings.append("RSP unavailable in the managed U.S. market snapshot")

    breadth: dict[str, Any] = {"proxy": "RSP/SPY", "source_grade": "B"}
    if spy and rsp:
        breadth.update({
            "as_of": min(spy["as_of"], rsp["as_of"]),
            "rsp_return_1d_pct": rsp["return_1d_pct"],
            "spy_return_1d_pct": spy["return_1d_pct"],
            "rsp_vs_spy_1d_pct": relative_return(rsp["return_1d_pct"], spy["return_1d_pct"]),
            "rsp_vs_spy_5d_pct": relative_return(rsp["return_5d_pct"], spy["return_5d_pct"]),
            "rsp_vs_spy_20d_pct": relative_return(rsp["return_20d_pct"], spy["return_20d_pct"]),
        })
    else:
        breadth["status"] = "missing_required_source"

    fred_key = os.getenv("FRED_API_KEY", "").strip()
    fred: dict[str, dict[str, Any]] = {}
    if fred_key:
        for series_id, label in (
            ("VIXCLS", "CBOE VIX"),
            ("VXVCLS", "CBOE 3-Month Volatility Index"),
            ("BAMLH0A0HYM2", "US High Yield Option-Adjusted Spread"),
            ("DGS10", "US 10-Year Treasury Yield"),
            ("DFII10", "US 10-Year Real Yield"),
        ):
            try:
                fred[series_id] = fred_metric(series_id, label, fred_key, date.fromisoformat(report_date))
            except Exception as exc:
                warnings.append(f"{series_id} unavailable ({type(exc).__name__})")
    else:
        warnings.append("FRED scoreboard unavailable (FRED_API_KEY missing)")

    vix, vix3m = fred.get("VIXCLS"), fred.get("VXVCLS")
    volatility: dict[str, Any] = {"source_grade": "A", "vix": vix, "vix3m": vix3m}
    if vix and vix3m and vix3m["value"]:
        volatility["vix_term_ratio"] = vix["value"] / vix3m["value"]
        volatility["as_of"] = min(vix["as_of"], vix3m["as_of"])
    else:
        volatility["status"] = "missing_required_source"

    spread = fred.get("BAMLH0A0HYM2")
    credit = {
        "source_grade": "A",
        "high_yield_oas": spread,
        "spread_change_5d_pct_point": spread["change_5_sessions"] if spread else None,
    }
    nominal, real = fred.get("DGS10"), fred.get("DFII10")
    rates = {
        "source_grade": "A",
        "nominal_10y": nominal,
        "real_10y": real,
        "real_yield_change_5d_pct_point": real["change_5_sessions"] if real else None,
    }
    scoreboard = {"breadth": breadth, "volatility": volatility, "credit": credit, "rates": rates}
    scoreboard["rule_based_signal"] = rule_based_signal(scoreboard, etf_payload)
    return scoreboard, warnings


def upcoming_events(
    report_date: str,
    config: dict[str, Any],
    official_calendar: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    start = date.fromisoformat(report_date)
    end = start + timedelta(days=7)
    events: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()
    for item in (official_calendar or {}).get("events", []):
        try:
            event_date = date.fromisoformat(item["date"])
        except (KeyError, TypeError, ValueError):
            continue
        if not start <= event_date <= end:
            continue
        title = str(item.get("title") or "").strip()
        key = (item["date"], re.sub(r"\W+", "", title.casefold()))
        if not title or key in seen:
            continue
        seen.add(key)
        events.append(dict(item))
    for index, item in enumerate(config.get("market_calendar", []), start=1):
        try:
            event_date = date.fromisoformat(item["date"])
        except (KeyError, TypeError, ValueError):
            continue
        if start <= event_date <= end:
            title = str(item.get("title") or "제목 없음").strip()
            key = (item["date"], re.sub(r"\W+", "", title.casefold()))
            if key in seen:
                continue
            seen.add(key)
            events.append({
                "event_id": f"{item['date']}-E{index}",
                "date": item["date"],
                "time": item.get("time"),
                "time_zone": item.get("time_zone"),
                "category": item.get("category", "macro"),
                "title": title,
                "source": item.get("source", "자료 없음"),
                "source_url": item.get("source_url"),
                "consensus": item.get("consensus"),
                "previous": item.get("previous"),
                "date_confidence": item.get("date_confidence", "manual_unverified"),
                "schedule_origin": "manual_calendar",
                "monitoring_assets": item.get("monitoring_assets", []),
                "confirmation_focus": item.get("confirmation_focus"),
            })
    return sorted(events, key=lambda item: (item["date"], item.get("time") or ""))


def source_quality_summary(records: list[dict[str, Any]]) -> dict[str, Any]:
    total = len(records)
    primary = sum(bool(item.get("primary_source_confirmed")) for item in records)
    grade_counts: dict[str, int] = {}
    missing_urls = 0
    missing_url_by_grade: dict[str, int] = {}
    missing_url_by_type: dict[str, int] = {}
    canonical_urls: list[str] = []
    linkage_rows: list[dict[str, Any]] = []
    blocker_codes: list[str] = []
    warning_codes: list[str] = []
    for item in records:
        grade = str(item.get("source_grade") or "unknown")
        source_type = str(item.get("source_type") or "unknown")
        grade_counts[grade] = grade_counts.get(grade, 0) + 1
        canonical_url = canonicalize_url(str(item.get("canonical_url") or item.get("url") or ""))
        if canonical_url:
            canonical_urls.append(canonical_url)
        else:
            missing_urls += 1
            missing_url_by_grade[grade] = missing_url_by_grade.get(grade, 0) + 1
            missing_url_by_type[source_type] = missing_url_by_type.get(source_type, 0) + 1

        link_required = bool(item.get("link_required", source_type != "broker_report"))
        is_primary = bool(item.get("primary_source_confirmed")) or grade == "A"
        acquisition_mode = str(
            (item.get("research_rights") or {}).get("acquisition_mode") or ""
        )
        authenticated_email_reference = (
            source_type == "broker_report"
            and acquisition_mode == "official_email"
            and str(item.get("evidence_label") or "") == "attributed_analysis"
            and bool(str(item.get("source_reference") or "").strip())
        )
        if not canonical_url and authenticated_email_reference:
            warning_codes.append("broker_report_reference_only")
        elif not canonical_url and is_primary:
            blocker_codes.append("primary_source_missing_url")
        elif not canonical_url and source_type == "broker_report":
            warning_codes.append("broker_report_reference_only")
        elif not canonical_url and link_required:
            blocker_codes.append("required_source_missing_url")
        if not str(item.get("rights_label") or "").strip():
            blocker_codes.append("rights_label_missing")
        if not str(item.get("publisher") or "").strip():
            warning_codes.append("publisher_missing")
        is_derived = (
            str(item.get("evidence_label") or "") in {"derived_calculation", "derived_value"}
            or bool(item.get("derived_fields"))
        )
        if is_derived and not str(item.get("derivation_note") or "").strip():
            warning_codes.append("derived_value_without_method")
        linkage_rows.append({
            "record_id": item.get("id"),
            "source_type": source_type,
            "publisher": item.get("publisher") or item.get("source_id"),
            "source_url_kind": item.get("source_url_kind") or ("primary_source" if is_primary else "publisher_article"),
            "canonical_url": canonical_url or None,
            "source_reference": item.get("source_reference"),
            "link_status": "linked" if canonical_url else "reference_only" if item.get("source_reference") else "missing",
        })

    duplicate_counts = Counter(canonical_urls)
    suppressed_duplicates = sum(
        int((item.get("deduplication") or {}).get("duplicate_count") or 0)
        for item in records
    )
    duplicate_url_groups = (
        sum(count > 1 for count in duplicate_counts.values()) +
        sum(bool((item.get("deduplication") or {}).get("duplicate_count")) for item in records)
    )
    duplicate_url_records = (
        sum(count - 1 for count in duplicate_counts.values() if count > 1) +
        suppressed_duplicates
    )
    if duplicate_url_records:
        warning_codes.append("duplicate_canonical_urls")
    blocker_counts = dict(Counter(blocker_codes))
    warning_counts = dict(Counter(warning_codes))
    material_warning_counts = {
        code: count for code, count in warning_counts.items()
        if code != "duplicate_canonical_urls"
    }
    publication_allowed = not blocker_counts
    if not publication_allowed:
        evidence_posture = "insufficient"
    elif material_warning_counts or missing_urls:
        evidence_posture = "monitoring_only"
    else:
        evidence_posture = "research_grade"
    return {
        "record_count": total,
        "primary_source_confirmed_count": primary,
        "primary_confirmation_rate_pct": round(primary / total * 100, 1) if total else None,
        "records_by_grade": grade_counts,
        "missing_url_count": missing_urls,
        "missing_url_by_grade": missing_url_by_grade,
        "missing_url_by_type": missing_url_by_type,
        "linked_record_count": total - missing_urls,
        "link_coverage_pct": round((total - missing_urls) / total * 100, 1) if total else None,
        "unique_canonical_url_count": len(duplicate_counts),
        "duplicate_canonical_url_group_count": duplicate_url_groups,
        "duplicate_canonical_url_record_count": duplicate_url_records,
        "suppressed_duplicate_record_count": suppressed_duplicates,
        "critical_source_link_complete": not any(
            code in blocker_counts for code in ("primary_source_missing_url", "required_source_missing_url")
        ),
        "event_source_links_complete": True,
        "publication_allowed": publication_allowed,
        "blockers": blocker_counts,
        "warnings": warning_counts,
        "material_warnings": material_warning_counts,
        "record_linkage": linkage_rows,
        "evidence_posture": evidence_posture,
    }


def apply_event_link_gate(quality: dict[str, Any], events: list[dict[str, Any]]) -> dict[str, Any]:
    """Merge confirmed-event URL completeness into the publication gate."""
    missing = sum(
        item.get("date_confidence") == "confirmed_primary" and
        not canonicalize_url(str(item.get("source_url") or ""))
        for item in events
    )
    quality["event_source_links_complete"] = missing == 0
    quality["confirmed_event_missing_url_count"] = missing
    if missing:
        blockers = dict(quality.get("blockers") or {})
        blockers["confirmed_event_missing_primary_url"] = missing
        quality["blockers"] = blockers
        quality["publication_allowed"] = False
        quality["evidence_posture"] = "insufficient"
    return quality


def etf_leadership_summary(etf_payload: dict[str, Any]) -> dict[str, Any]:
    """Return a compact, deterministic leadership view for report prose.

    The chart already contains every ETF.  This summary keeps the narrative
    focused on the strongest and weakest observations without asking the
    language model to rank or recalculate returns.
    """
    items = [
        item for item in etf_payload.get("items", [])
        if item.get("ticker") and isinstance(item.get("return_1d_pct"), (int, float))
    ]
    by_ticker = {item["ticker"]: item for item in items}
    spy = by_ticker.get("SPY")
    horizons: dict[str, Any] = {}
    for label, field in (("1d", "return_1d_pct"), ("5d", "return_5d_pct"), ("20d", "return_20d_pct")):
        eligible = [item for item in items if isinstance(item.get(field), (int, float))]
        if not eligible:
            continue
        ranked = sorted(eligible, key=lambda item: item[field], reverse=True)

        def compact(item: dict[str, Any]) -> dict[str, Any]:
            row = {
                "ticker": item["ticker"],
                "name": item.get("name"),
                "return_pct": round(float(item[field]), 2),
                "as_of": item.get("as_of"),
            }
            if spy and isinstance(spy.get(field), (int, float)):
                row["vs_spy_pct"] = round(relative_return(float(item[field]), float(spy[field])), 2)
            return row

        horizons[label] = {
            "leaders": [compact(item) for item in ranked[:2]],
            "laggards": [compact(item) for item in ranked[-2:]],
            "dispersion_pct_point": round(float(ranked[0][field]) - float(ranked[-1][field]), 2),
        }
    return {
        "source": etf_payload.get("source_grade", "B"),
        "basis": "previous_available_close; price return only",
        "horizons": horizons,
    }


def price_freshness(report_date: str, price_dates: list[str]) -> dict[str, Any]:
    latest = max(price_dates) if price_dates else None
    if not latest:
        return {"latest_price_as_of": None, "calendar_gap_days": None, "status": "missing"}
    gap = max((date.fromisoformat(report_date) - date.fromisoformat(latest)).days, 0)
    return {
        "latest_price_as_of": latest,
        "calendar_gap_days": gap,
        "status": "current_report_date" if gap == 0 else "latest_available_close_precedes_report_date",
        "note": "A weekend, holiday, or provider timing can create a calendar-date gap.",
    }


def empty_us_equity_candidate_screen(
    report_date: str,
    status: str,
    gap: str,
) -> dict[str, Any]:
    return {
        "schema_version": "us_equity_candidate_screen.v1",
        "report_date": report_date,
        "screen_status": status,
        "universe_security_count": 0,
        "market_covered_security_count": 0,
        "material_candidate_count": 0,
        "deep_analysis_count": 0,
        "candidates": [],
        "deep_analysis_shortlist": [],
        "market_source": None,
        "methodology": {
            "maximum_candidates": 10,
            "maximum_deep_analysis": 3,
            "verified_primary_body_required_for_deep_analysis": True,
            "verified_primary_fact_required_for_deep_analysis": True,
        },
        "data_gaps": [gap],
        "posture": "research_screen_not_investment_recommendation",
    }


def load_us_equity_candidate_screen(path: Path, report_date: str) -> dict[str, Any]:
    if not path.exists():
        return empty_us_equity_candidate_screen(
            report_date,
            "not_collected",
            "U.S. equity candidate screen was not collected for this report.",
        )
    payload = load_json(path)
    if payload.get("schema_version") != "us_equity_candidate_screen.v1":
        return empty_us_equity_candidate_screen(
            report_date,
            "invalid_schema",
            "U.S. equity candidate screen schema did not pass the snapshot gate.",
        )
    if payload.get("report_date") != report_date:
        return empty_us_equity_candidate_screen(
            report_date,
            "report_date_mismatch",
            "U.S. equity candidate screen belongs to a different report date.",
        )
    return payload


def load_us_market_internals(path: Path, report_date: str) -> dict[str, Any]:
    fallback = {
        "schema_version": "us_market_internals.v1",
        "report_date": report_date,
        "collection_status": "not_collected",
        "market_source": None,
        "coverage": {
            "required_ticker_count": 19,
            "available_ticker_count": 0,
            "missing_tickers": [],
        },
        "market_structure": {
            "classification": "insufficient_data",
            "reason": "U.S. market internals were not collected for this report.",
        },
        "breadth_and_size": [],
        "constituent_breadth": None,
        "style_pairs": [],
        "sector_leadership": {},
        "data_gaps": ["U.S. market internals were not collected for this report."],
        "posture": "market_structure_observation_not_investment_recommendation",
    }
    if not path.exists():
        return fallback
    payload = load_json(path)
    if payload.get("schema_version") != "us_market_internals.v1":
        return {**fallback, "collection_status": "invalid_schema"}
    if payload.get("report_date") != report_date:
        return {**fallback, "collection_status": "report_date_mismatch"}
    return payload


def main() -> None:
    parser = argparse.ArgumentParser(description="Build the daily structured market evidence snapshot.")
    parser.add_argument("--date", default=date.today().isoformat(), help="Report date in YYYY-MM-DD")
    parser.add_argument("--inbox-file")
    parser.add_argument("--official-calendar-file")
    parser.add_argument("--korea-market-file")
    parser.add_argument("--us-equity-candidate-screen-file")
    parser.add_argument("--us-market-internals-file")
    parser.add_argument("--us-market-input-file")
    args = parser.parse_args()
    load_dotenv()

    inbox_path = Path(args.inbox_file) if args.inbox_file else latest_file(
        ROOT / "workspace" / "normalized" / args.date, "inbox_*.json"
    )
    status_path = latest_file(ROOT / "workspace" / "source_status" / args.date, "source_status_*.json")
    etf_path = ROOT / "workspace" / "market_data" / args.date / "etf_metrics.json"
    if not inbox_path or not inbox_path.exists():
        raise SystemExit("No normalized inbox is available for the snapshot.")
    if not etf_path.exists():
        raise SystemExit("ETF metrics are missing; run generate_etf_chart.py first.")

    records = load_json(inbox_path)
    config = load_source_config()
    sector_master = load_sector_master()
    records = classify_records(records, sector_master)
    triage_dir = ROOT / "workspace" / "triaged" / args.date
    triage_audit_path = triage_dir / "triage_audit.json"
    event_clusters_path = triage_dir / "event_clusters.json"
    event_evidence_dir = ROOT / "workspace" / "event_evidence" / args.date
    event_source_matches_path = event_evidence_dir / "event_source_matches.json"
    event_evidence_packets_path = event_evidence_dir / "event_evidence_packets.json"
    structured_event_evidence_path = event_evidence_dir / "structured_event_evidence.json"
    event_impact_synthesis_path = ROOT / "workspace" / "analysis" / args.date / "event_impact_synthesis.json"
    triage_audit = load_json(triage_audit_path) if triage_audit_path.exists() else {
        "schema_version": "candidate_triage_audit.v1",
        "status": "not_available",
    }
    event_clusters = load_json(event_clusters_path) if event_clusters_path.exists() else {
        "schema_version": "event_clusters.v1",
        "status": "not_available",
        "cluster_count": 0,
        "clusters": [],
    }
    event_source_matches = load_json(event_source_matches_path) if event_source_matches_path.exists() else {
        "schema_version": "event_source_matches.v1",
        "status": "not_available",
        "events": [],
    }
    event_evidence_packets = load_json(event_evidence_packets_path) if event_evidence_packets_path.exists() else {
        "schema_version": "event_evidence_packets.v1",
        "status": "not_available",
        "events": [],
    }
    structured_event_evidence = (
        load_json(structured_event_evidence_path)
        if structured_event_evidence_path.exists()
        else {
            "schema_version": "structured_event_evidence.v1",
            "status": "not_available",
            "events": [],
        }
    )
    event_impact_synthesis = (
        load_json(event_impact_synthesis_path)
        if event_impact_synthesis_path.exists()
        else {
            "schema_version": "event_impact_synthesis.v1",
            "status": "not_available",
            "events": [],
        }
    )
    source_status = load_json(status_path) if status_path else {"sources": [], "status": "missing"}
    etf_payload = annotate_market_payload(load_json(etf_path), sector_master)
    us_market_input_path = Path(args.us_market_input_file) if args.us_market_input_file else (
        ROOT / "workspace" / "us_equity_market_inputs" / args.date / "market_snapshot.json"
    )
    us_market_input = (
        load_json(us_market_input_path)
        if us_market_input_path.exists()
        else None
    )
    scoreboard, warnings = build_scoreboard(args.date, etf_payload, us_market_input)
    calendar_path = Path(args.official_calendar_file) if args.official_calendar_file else (
        ROOT / "workspace" / "market_calendar" / args.date / "official_market_calendar.json"
    )
    official_calendar = load_json(calendar_path) if calendar_path.exists() else {
        "schema_version": "official_market_calendar.v1",
        "collection_status": "not_collected",
        "events": [],
    }
    korea_market_path = Path(args.korea_market_file) if args.korea_market_file else (
        ROOT / "workspace" / "korea_market" / args.date / "korea_market.json"
    )
    korea_market = load_json(korea_market_path) if korea_market_path.exists() else {
        "schema_version": "korea_market_snapshot.v1",
        "report_date": args.date,
        "collection_status": "not_collected",
        "metrics": {},
        "transmission_gate": {
            "status": "insufficient_verified_korea_data",
            "available_metrics": [],
            "missing_metrics": [],
        },
    }
    us_equity_candidate_screen_path = (
        Path(args.us_equity_candidate_screen_file)
        if args.us_equity_candidate_screen_file
        else ROOT / "workspace" / "us_equity_candidate_screen" / args.date / "candidate_screen.json"
    )
    us_equity_candidate_screen = load_us_equity_candidate_screen(
        us_equity_candidate_screen_path,
        args.date,
    )
    us_market_internals_path = (
        Path(args.us_market_internals_file)
        if args.us_market_internals_file
        else ROOT / "workspace" / "us_market_internals" / args.date / "market_internals.json"
    )
    us_market_internals = load_us_market_internals(
        us_market_internals_path,
        args.date,
    )
    events = upcoming_events(args.date, config, official_calendar)
    quality = apply_event_link_gate(source_quality_summary(records), events)
    timezone = ZoneInfo(os.getenv("BRIEF_TIMEZONE", "Asia/Seoul"))
    generated_at = datetime.now(timezone).isoformat()
    price_dates = [item.get("as_of") for item in etf_payload.get("items", []) if item.get("as_of")]
    freshness = price_freshness(args.date, price_dates)
    source_counts: dict[str, int] = {}
    grade_counts: dict[str, int] = {}
    type_counts: dict[str, int] = {}
    for item in records:
        source_counts[item.get("source_id", "unknown")] = source_counts.get(item.get("source_id", "unknown"), 0) + 1
        grade_counts[item.get("source_grade", "unknown")] = grade_counts.get(item.get("source_grade", "unknown"), 0) + 1
        type_counts[item.get("source_type", "unknown")] = type_counts.get(item.get("source_type", "unknown"), 0) + 1

    snapshot = {
        "schema_version": "daily_market_snapshot.v1",
        "report_date": args.date,
        "generated_at": generated_at,
        "data_cutoff": {
            "report_timezone": os.getenv("BRIEF_TIMEZONE", "Asia/Seoul"),
            "generated_at": generated_at,
            "price_basis": "previous_available_close",
            **freshness,
            "news_scope": "provider records present in the normalized inbox",
            "monthly_macro_note": "observation_date is a data period; release_date remains null unless independently supplied.",
        },
        "source_status": source_status.get("sources", []),
        "candidate_triage": triage_audit,
        "news_event_clusters": event_clusters,
        "event_source_matches": event_source_matches,
        "event_evidence_packets": event_evidence_packets,
        "structured_event_evidence": structured_event_evidence,
        "event_impact_synthesis": event_impact_synthesis,
        "source_summary": {
            "records_by_source": source_counts,
            "records_by_grade": grade_counts,
            "records_by_type": type_counts,
            "domestic_filing_count": type_counts.get("korean_filing", 0),
            "sec_filing_count": type_counts.get("filing", 0),
        },
        "source_quality": quality,
        "official_market_calendar": {
            key: value for key, value in official_calendar.items() if key != "events"
        },
        "korea_market": korea_market,
        "us_equity_candidate_screen": us_equity_candidate_screen,
        "us_market_internals": us_market_internals,
        "upcoming_events": events,
        "market_scoreboard": scoreboard,
        "etf_metrics": etf_payload,
        "etf_leadership": etf_leadership_summary(etf_payload),
        "sector_evidence_connections": sector_evidence_summary(records, etf_payload, sector_master),
        "sector_metrics": load_json(ROOT / "workspace" / "sector_metrics" / args.date / "sector_metrics.json")
        if (ROOT / "workspace" / "sector_metrics" / args.date / "sector_metrics.json").exists()
        else {
            "schema_version": "sector_metric_observations.v1",
            "report_date": args.date,
            "collection_status": "not_collected",
            "metric_count": 0,
            "available_metric_count": 0,
            "metrics": [],
        },
        "sector_fundamentals": load_json(
            ROOT / "workspace" / "sector_fundamentals" / args.date / "sector_fundamentals.json"
        ) if (ROOT / "workspace" / "sector_fundamentals" / args.date / "sector_fundamentals.json").exists()
        else {
            "schema_version": "sector_fundamental_observations.v1",
            "report_date": args.date,
            "collection_status": "not_collected",
            "estimate_observations": [],
            "operating_observations": [],
            "dimension_scores": [],
        },
        "sector_drivers": load_json(
            ROOT / "workspace" / "sector_drivers" / args.date / "sector_drivers.json"
        ) if (ROOT / "workspace" / "sector_drivers" / args.date / "sector_drivers.json").exists()
        else {
            "schema_version": "sector_driver_observations.v1",
            "report_date": args.date,
            "collection_status": "not_collected",
            "observations": [],
            "dimension_scores": [],
        },
        "records": records,
        "calculation_warnings": warnings,
    }
    output_dir = ROOT / "workspace" / "snapshots" / args.date
    output_dir.mkdir(parents=True, exist_ok=True)
    sector_snapshot, sector_output = write_sector_snapshot(args.date, snapshot, sector_master)
    snapshot["sector_snapshot_summary"] = compact_sector_snapshot(sector_snapshot)
    output = output_dir / "daily_snapshot.json"
    output.write_text(json.dumps(snapshot, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Sector snapshot saved: {sector_output.relative_to(ROOT)}")
    print(f"Daily snapshot saved: {output.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
