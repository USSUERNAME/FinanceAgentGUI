"""Attach deterministic prior-report changes and archive a compact daily market state."""

from __future__ import annotations

import argparse
import json
from datetime import date
from pathlib import Path
from typing import Any

from collectors.common import ROOT

SCHEMA_VERSION = "daily_market_history_state.v1"


def _number(value: Any) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def tracking_metrics(snapshot: dict[str, Any]) -> dict[str, float | None]:
    scoreboard = snapshot.get("market_scoreboard") or {}
    etf_items = {
        item.get("ticker"): item
        for item in (snapshot.get("etf_metrics") or {}).get("items", [])
    }
    return {
        "rsp_vs_spy_5d_pct": (scoreboard.get("breadth") or {}).get("rsp_vs_spy_5d_pct"),
        "vix_term_ratio": (scoreboard.get("volatility") or {}).get("vix_term_ratio"),
        "high_yield_oas": (
            (scoreboard.get("credit") or {}).get("high_yield_oas") or {}
        ).get("value"),
        "nominal_10y": (
            (scoreboard.get("rates") or {}).get("nominal_10y") or {}
        ).get("value"),
        "real_10y": (
            (scoreboard.get("rates") or {}).get("real_10y") or {}
        ).get("value"),
        "spy_return_5d_pct": (etf_items.get("SPY") or {}).get("return_5d_pct"),
    }


def compact_market_state(snapshot: dict[str, Any]) -> dict[str, Any]:
    internals = snapshot.get("us_market_internals") or {}
    sector_5d = (internals.get("sector_leadership") or {}).get("5d") or {}
    candidate_screen = snapshot.get("us_equity_candidate_screen") or {}
    etfs = {}
    for item in (snapshot.get("etf_metrics") or {}).get("items", []):
        ticker = str(item.get("ticker") or "").upper()
        if not ticker:
            continue
        etfs[ticker] = {
            "as_of": item.get("as_of"),
            "close": _number(item.get("close")),
            "return_1d_pct": _number(item.get("return_1d_pct")),
            "return_5d_pct": _number(item.get("return_5d_pct")),
            "return_20d_pct": _number(item.get("return_20d_pct")),
        }
    return {
        "schema_version": SCHEMA_VERSION,
        "report_date": snapshot.get("report_date"),
        "generated_at": snapshot.get("generated_at"),
        "tracking_metrics": tracking_metrics(snapshot),
        "etfs": etfs,
        "market_structure": {
            "classification": (internals.get("market_structure") or {}).get("classification"),
            "reason": (internals.get("market_structure") or {}).get("reason"),
            "coverage": internals.get("coverage"),
            "sector_leaders_5d": [
                row.get("ticker")
                for row in sector_5d.get("leaders", [])
                if row.get("ticker")
            ],
        },
        "research_candidates": [
            {
                "ticker": row.get("ticker"),
                "selection_score": row.get("selection_score"),
                "deep_analysis_eligible": row.get("deep_analysis_eligible"),
            }
            for row in candidate_screen.get("candidates", [])[:10]
            if row.get("ticker")
        ],
        "korea_market": {
            "collection_status": (snapshot.get("korea_market") or {}).get("collection_status"),
            "transmission_gate": (snapshot.get("korea_market") or {}).get("transmission_gate"),
        },
        "posture": "historical_observation_not_investment_recommendation",
    }


def load_previous_state(history_dir: Path, report_date: str) -> dict[str, Any] | None:
    current = date.fromisoformat(report_date)
    candidates = []
    if history_dir.exists():
        for path in history_dir.glob("*.json"):
            try:
                candidate_date = date.fromisoformat(path.stem)
            except ValueError:
                continue
            if candidate_date < current:
                candidates.append((candidate_date, path))
    if not candidates:
        return None
    return json.loads(max(candidates, key=lambda pair: pair[0])[1].read_text(encoding="utf-8"))


def compare_market_states(
    current: dict[str, Any],
    previous: dict[str, Any] | None,
) -> dict[str, Any]:
    if previous is None:
        return {
            "status": "no_previous_report",
            "previous_report_date": None,
            "tracking_metric_changes": {},
            "etf_close_changes_pct": {},
            "market_structure_change": None,
            "sector_leader_changes": None,
            "candidate_changes": None,
        }
    metric_changes = {}
    for key, current_value in (current.get("tracking_metrics") or {}).items():
        previous_value = (previous.get("tracking_metrics") or {}).get(key)
        current_number = _number(current_value)
        previous_number = _number(previous_value)
        if current_number is None or previous_number is None:
            continue
        metric_changes[key] = {
            "previous": previous_number,
            "current": current_number,
            "change": round(current_number - previous_number, 6),
        }
    close_changes = {}
    for ticker, current_row in (current.get("etfs") or {}).items():
        previous_row = (previous.get("etfs") or {}).get(ticker) or {}
        current_close = _number(current_row.get("close"))
        previous_close = _number(previous_row.get("close"))
        if current_close is None or previous_close in {None, 0}:
            continue
        close_changes[ticker] = round((current_close / previous_close - 1) * 100, 4)
    current_structure = (current.get("market_structure") or {}).get("classification")
    previous_structure = (previous.get("market_structure") or {}).get("classification")
    current_leaders = set(
        (current.get("market_structure") or {}).get("sector_leaders_5d") or []
    )
    previous_leaders = set(
        (previous.get("market_structure") or {}).get("sector_leaders_5d") or []
    )
    current_candidates = {
        row.get("ticker")
        for row in current.get("research_candidates", [])
        if row.get("ticker")
    }
    previous_candidates = {
        row.get("ticker")
        for row in previous.get("research_candidates", [])
        if row.get("ticker")
    }
    return {
        "status": "compared",
        "previous_report_date": previous.get("report_date"),
        "tracking_metric_changes": metric_changes,
        "etf_close_changes_pct": close_changes,
        "market_structure_change": {
            "previous": previous_structure,
            "current": current_structure,
            "changed": current_structure != previous_structure,
        },
        "sector_leader_changes": {
            "added": sorted(current_leaders - previous_leaders),
            "removed": sorted(previous_leaders - current_leaders),
            "current": sorted(current_leaders),
        },
        "candidate_changes": {
            "added": sorted(current_candidates - previous_candidates),
            "removed": sorted(previous_candidates - current_candidates),
            "current": sorted(current_candidates),
        },
    }


def record_daily_market_history(
    snapshot_path: Path,
    history_dir: Path,
) -> tuple[dict[str, Any], Path]:
    snapshot = json.loads(snapshot_path.read_text(encoding="utf-8"))
    report_date = str(snapshot.get("report_date") or "")
    date.fromisoformat(report_date)
    previous = load_previous_state(history_dir, report_date)
    current = compact_market_state(snapshot)
    snapshot["previous_market_state"] = previous
    snapshot["day_over_day_changes"] = compare_market_states(current, previous)
    snapshot_path.write_text(
        json.dumps(snapshot, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    history_dir.mkdir(parents=True, exist_ok=True)
    output = history_dir / f"{report_date}.json"
    output.write_text(json.dumps(current, ensure_ascii=False, indent=2), encoding="utf-8")
    return snapshot, output


def main() -> None:
    parser = argparse.ArgumentParser(description="Record compact daily market history")
    parser.add_argument("--date", required=True)
    parser.add_argument("--snapshot-file")
    parser.add_argument("--history-dir")
    args = parser.parse_args()
    snapshot_path = (
        Path(args.snapshot_file)
        if args.snapshot_file
        else ROOT / "workspace" / "snapshots" / args.date / "daily_snapshot.json"
    )
    history_dir = (
        Path(args.history_dir)
        if args.history_dir
        else ROOT / "workspace" / "history" / "daily_market_snapshots"
    )
    if not snapshot_path.is_absolute():
        snapshot_path = ROOT / snapshot_path
    if not history_dir.is_absolute():
        history_dir = ROOT / history_dir
    if not snapshot_path.exists():
        raise SystemExit(f"Daily snapshot does not exist: {snapshot_path}")
    snapshot, output = record_daily_market_history(snapshot_path, history_dir)
    changes = snapshot["day_over_day_changes"]
    print(f"Daily market history saved: {output.relative_to(ROOT)}")
    print(
        f"Previous-report comparison status: {changes['status']} | "
        f"previous={changes['previous_report_date']}"
    )


if __name__ == "__main__":
    main()
