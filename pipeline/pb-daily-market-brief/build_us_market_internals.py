"""Build a deterministic U.S. market breadth, style, and sector snapshot."""

from __future__ import annotations

import argparse
import json
from datetime import date
from pathlib import Path
from typing import Any

from build_us_equity_universe import root_path
from build_us_constituent_breadth import SCHEMA_VERSION as CONSTITUENT_BREADTH_SCHEMA
from collectors.common import ROOT
from screen_us_equity_candidates import normalize_market_row, validate_market_input
from us_market_panel import REQUIRED_TICKERS, SECTOR_ETFS, STYLE_PAIRS

SCHEMA_VERSION = "us_market_internals.v1"
HORIZONS = {
    "1d": "return_1d_pct",
    "5d": "return_5d_pct",
    "20d": "return_20d_pct",
}
def relative_return(asset_return: float | None, benchmark_return: float | None) -> float | None:
    if asset_return is None or benchmark_return is None:
        return None
    return round(
        ((1 + float(asset_return) / 100) / (1 + float(benchmark_return) / 100) - 1) * 100,
        4,
    )


def empty_market_internals(report_date: str, status: str) -> dict[str, Any]:
    return {
        "schema_version": SCHEMA_VERSION,
        "report_date": report_date,
        "collection_status": status,
        "market_source": None,
        "coverage": {
            "required_ticker_count": len(REQUIRED_TICKERS),
            "available_ticker_count": 0,
            "missing_tickers": sorted(REQUIRED_TICKERS),
        },
        "market_structure": {
            "classification": "insufficient_data",
            "reason": "No current authorized batch market snapshot is available.",
        },
        "breadth_and_size": [],
        "constituent_breadth": None,
        "style_pairs": [],
        "sector_leadership": {},
        "data_gaps": [
            "A current authorized batch market snapshot is required for U.S. market internals."
        ],
        "posture": "market_structure_observation_not_investment_recommendation",
    }


def compact_comparison(
    rows: dict[str, dict[str, Any]],
    ticker: str,
    benchmark: str,
) -> dict[str, Any] | None:
    asset = rows.get(ticker)
    base = rows.get(benchmark)
    if not asset or not base:
        return None
    relative = {
        horizon: relative_return(asset.get(field), base.get(field))
        for horizon, field in HORIZONS.items()
    }
    return {
        "ticker": ticker,
        "benchmark": benchmark,
        "relative_returns_pct_point": relative,
    }


def style_pair_rows(rows: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    result = []
    for pair_id, (first, second) in STYLE_PAIRS.items():
        comparison = compact_comparison(rows, first, second)
        if not comparison:
            continue
        spreads = comparison["relative_returns_pct_point"]
        five_day = spreads.get("5d")
        result.append({
            "pair_id": pair_id,
            "first_ticker": first,
            "second_ticker": second,
            "relative_returns_pct_point": spreads,
            "five_day_leader": (
                first if five_day is not None and five_day > 0 else
                second if five_day is not None and five_day < 0 else
                "tie"
            ),
        })
    return result


def sector_leadership(
    rows: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    spy = rows.get("SPY")
    if not spy:
        return {}
    result: dict[str, Any] = {}
    for horizon, field in HORIZONS.items():
        observations = []
        for ticker, name in SECTOR_ETFS.items():
            item = rows.get(ticker)
            if not item or item.get(field) is None:
                continue
            observations.append({
                "ticker": ticker,
                "sector": name,
                "return_pct": round(float(item[field]), 4),
                "vs_spy_pct_point": relative_return(item.get(field), spy.get(field)),
            })
        observations.sort(key=lambda row: float(row["return_pct"]), reverse=True)
        relative_values = [
            float(row["vs_spy_pct_point"])
            for row in observations
            if row.get("vs_spy_pct_point") is not None
        ]
        result[horizon] = {
            "leaders": observations[:3],
            "laggards": observations[-3:],
            "all_sectors": observations,
            "positive_return_count": sum(row["return_pct"] > 0 for row in observations),
            "outperforming_spy_count": sum(value > 0 for value in relative_values),
            "covered_sector_count": len(observations),
            "dispersion_pct_point": (
                round(observations[0]["return_pct"] - observations[-1]["return_pct"], 4)
                if len(observations) >= 2 else None
            ),
        }
    return result


def classify_structure(
    breadth_rows: list[dict[str, Any]],
    sectors: dict[str, Any],
    constituent_breadth: dict[str, Any] | None = None,
) -> dict[str, Any]:
    five_day = {
        row["ticker"]: row["relative_returns_pct_point"].get("5d")
        for row in breadth_rows
    }
    sector_5d = sectors.get("5d") or {}
    covered = int(sector_5d.get("covered_sector_count") or 0)
    outperforming = int(sector_5d.get("outperforming_spy_count") or 0)
    participation = [
        five_day.get("RSP"),
        five_day.get("IWM"),
        five_day.get("MDY"),
    ]
    available = [value for value in participation if value is not None]
    positive = sum(value > 0.25 for value in available)
    negative = sum(value < -0.25 for value in available)
    true_breadth = (
        constituent_breadth.get("breadth") or {}
        if constituent_breadth
        and constituent_breadth.get("collection_status") == "ready"
        else {}
    )
    advance_pct = true_breadth.get("advance_decline", {}).get("advance_pct")
    above_50d_pct = true_breadth.get("moving_averages", {}).get("50d", {}).get("above_pct")
    true_breadth_ready = advance_pct is not None and above_50d_pct is not None
    if true_breadth_ready and covered >= 6:
        if advance_pct >= 55 and above_50d_pct >= 55 and outperforming >= 6:
            label = "broadening"
            reason = (
                "Constituent participation, 50-day trend breadth, and sector "
                "leadership confirm broadening."
            )
        elif advance_pct <= 45 and above_50d_pct <= 45 and outperforming <= 5:
            label = "narrowing"
            reason = (
                "Constituent participation and 50-day trend breadth confirm "
                "narrowing."
            )
        else:
            label = "mixed_rotation"
            reason = (
                "Constituent breadth and sector participation do not confirm "
                "one broad direction."
            )
    elif len(available) < 2 or covered < 6:
        label = "insufficient_data"
        reason = "Breadth/size proxies or sector coverage are incomplete."
    elif positive >= 2 and outperforming >= 7:
        label = "broadening"
        reason = "At least two breadth/size proxies and seven sectors outperform SPY."
    elif negative >= 2 and outperforming <= 4:
        label = "narrowing"
        reason = "At least two breadth/size proxies lag and four or fewer sectors outperform SPY."
    else:
        label = "mixed_rotation"
        reason = "Breadth, size, and sector participation do not confirm one broad direction."
    return {
        "classification": label,
        "reason": reason,
        "five_day_participation": {
            "rsp_vs_spy_pct_point": five_day.get("RSP"),
            "iwm_vs_spy_pct_point": five_day.get("IWM"),
            "mdy_vs_spy_pct_point": five_day.get("MDY"),
            "sector_outperforming_spy_count": outperforming,
            "sector_coverage_count": covered,
        },
        "constituent_confirmation": {
            "status": (
                constituent_breadth.get("collection_status")
                if constituent_breadth else "missing"
            ),
            "advance_pct": advance_pct,
            "above_50d_pct": above_50d_pct,
        },
    }


def build_us_market_internals(
    report_date: str,
    market_input: dict[str, Any] | None,
    constituent_breadth: dict[str, Any] | None = None,
) -> dict[str, Any]:
    if market_input is None:
        return empty_market_internals(report_date, "missing_market_snapshot_input")
    validate_market_input(market_input, report_date)
    age_days = (
        date.fromisoformat(report_date) - date.fromisoformat(str(market_input["as_of"]))
    ).days
    freshness = "current" if age_days <= 4 else "stale"
    rows = {
        normalized["ticker"]: normalized
        for normalized in (
            normalize_market_row(row)
            for row in market_input.get("benchmarks", [])
        )
    }
    available = REQUIRED_TICKERS.intersection(rows)
    missing = REQUIRED_TICKERS - available
    breadth = [
        comparison
        for ticker in ("RSP", "IWM", "MDY")
        if (comparison := compact_comparison(rows, ticker, "SPY")) is not None
    ]
    styles = style_pair_rows(rows)
    sectors = sector_leadership(rows)
    market_collection = market_input.get("collection") or {}
    if constituent_breadth is not None:
        if constituent_breadth.get("schema_version") != CONSTITUENT_BREADTH_SCHEMA:
            raise ValueError("Unexpected constituent breadth schema")
        if constituent_breadth.get("report_date") != report_date:
            raise ValueError("Constituent breadth report date does not match")
    structure = classify_structure(breadth, sectors, constituent_breadth)
    if freshness == "stale":
        status = "stale_market_snapshot"
    elif not rows.get("SPY"):
        status = "missing_spy_benchmark"
    elif missing:
        status = "partial_coverage"
    else:
        status = "ready"
    return {
        "schema_version": SCHEMA_VERSION,
        "report_date": report_date,
        "collection_status": status,
        "market_source": {
            "provider": market_input.get("source_provider"),
            "source_url": market_input.get("source_url"),
            "source_grade": market_input.get("source_grade"),
            "rights_label": market_input.get("rights_label"),
            "as_of": market_input.get("as_of"),
            "age_days": age_days,
            "freshness_status": freshness,
            "market_cutoff": market_input.get("market_cutoff"),
            "provider_configuration": {
                "alpaca_batch_enabled": bool(
                    market_collection.get("alpaca_batch_enabled")
                ),
                "alpaca_feed": market_collection.get("alpaca_feed"),
                "alpaca_configuration_status": market_collection.get(
                    "alpaca_configuration_status"
                ),
            },
        },
        "coverage": {
            "required_ticker_count": len(REQUIRED_TICKERS),
            "available_ticker_count": len(available),
            "missing_tickers": sorted(missing),
        },
        "market_structure": structure,
        "breadth_and_size": breadth,
        "constituent_breadth": constituent_breadth,
        "style_pairs": styles,
        "sector_leadership": sectors,
        "data_gaps": [
            *(
                ["Market snapshot is stale; observations are not current."]
                if freshness == "stale" else []
            ),
            *(
                [f"Missing market-internals tickers: {', '.join(sorted(missing))}"]
                if missing else []
            ),
            *(
                ["Constituent breadth is unavailable or below its coverage gate."]
                if not constituent_breadth
                or constituent_breadth.get("collection_status") != "ready"
                else []
            ),
            *(
                [
                    str(value)
                    for value in (constituent_breadth or {}).get("data_gaps", [])
                    if str(value).strip()
                ]
            ),
            *(
                [
                    "Local Alpaca credentials are not configured; the complete "
                    "19-ticker market panel cannot be collected."
                ]
                if missing
                and market_collection.get("alpaca_configuration_status")
                == "missing_credentials"
                else []
            ),
            "Returns describe price action, not event causality or expected returns.",
        ],
        "posture": "market_structure_observation_not_investment_recommendation",
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Build U.S. market internals")
    parser.add_argument("--date", required=True)
    parser.add_argument("--market-input")
    parser.add_argument("--constituent-breadth-input")
    parser.add_argument("--output-file")
    args = parser.parse_args()
    market_path = root_path(
        args.market_input,
        ROOT / "workspace" / "us_equity_market_inputs" / args.date / "market_snapshot.json",
    )
    market_input = (
        json.loads(market_path.read_text(encoding="utf-8"))
        if market_path.exists() else None
    )
    constituent_path = root_path(
        args.constituent_breadth_input,
        ROOT / "workspace" / "us_constituent_breadth" / args.date / "constituent_breadth.json",
    )
    constituent_breadth = (
        json.loads(constituent_path.read_text(encoding="utf-8"))
        if constituent_path.exists() else None
    )
    payload = build_us_market_internals(
        args.date,
        market_input,
        constituent_breadth,
    )
    output = root_path(
        args.output_file,
        ROOT / "workspace" / "us_market_internals" / args.date / "market_internals.json",
    )
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"U.S. market internals saved: {output.relative_to(ROOT)}")
    print(
        f"U.S. market internals status: {payload['collection_status']} | "
        f"structure={payload['market_structure']['classification']}"
    )


if __name__ == "__main__":
    main()
