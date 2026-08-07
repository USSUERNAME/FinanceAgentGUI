"""Append, evaluate, and summarize falsifiable daily market hypotheses."""

from __future__ import annotations

import argparse
import json
from datetime import date
from pathlib import Path
from typing import Any

from collectors.common import ROOT


METRIC_RULES = {
    "rsp_vs_spy_5d_pct": {"label": "RSP/SPY 5일 상대수익률", "minimum_change": 0.25},
    "vix_term_ratio": {"label": "VIX/VIX3M", "minimum_change": 0.03},
    "high_yield_oas": {"label": "미국 하이일드 OAS", "minimum_change": 0.05},
    "real_10y": {"label": "미국 10년 실질금리", "minimum_change": 0.05},
    "spy_return_5d_pct": {"label": "SPY 5일 수익률", "minimum_change": 0.50},
}


def root_path(value: str | None, default: Path) -> Path:
    path = Path(value) if value else default
    return path if path.is_absolute() else ROOT / path


def metric_values(snapshot: dict[str, Any]) -> dict[str, float | None]:
    scoreboard = snapshot.get("market_scoreboard", {})
    etf_items = {
        item.get("ticker"): item for item in snapshot.get("etf_metrics", {}).get("items", [])
    }
    return {
        "rsp_vs_spy_5d_pct": scoreboard.get("breadth", {}).get("rsp_vs_spy_5d_pct"),
        "vix_term_ratio": scoreboard.get("volatility", {}).get("vix_term_ratio"),
        "high_yield_oas": (
            scoreboard.get("credit", {}).get("high_yield_oas") or {}
        ).get("value"),
        "real_10y": (scoreboard.get("rates", {}).get("real_10y") or {}).get("value"),
        "spy_return_5d_pct": (etf_items.get("SPY") or {}).get("return_5d_pct"),
    }


def outcome(expected_direction: str, baseline: float, current: float, threshold: float) -> str:
    change = current - baseline
    if expected_direction == "increase":
        return "hit" if change >= threshold else "miss" if change <= -threshold else "inconclusive"
    return "hit" if change <= -threshold else "miss" if change >= threshold else "inconclusive"


def summarize(records: list[dict[str, Any]]) -> dict[str, Any]:
    counts = {status: sum(row.get("status") == status for row in records) for status in (
        "hit", "miss", "inconclusive", "pending",
    )}
    decisive = counts["hit"] + counts["miss"]
    by_metric: dict[str, dict[str, int]] = {}
    for row in records:
        metric = row.get("metric_key", "unknown")
        status = row.get("status", "pending")
        bucket = by_metric.setdefault(metric, {"hit": 0, "miss": 0, "inconclusive": 0, "pending": 0})
        bucket[status] = bucket.get(status, 0) + 1
    return {
        "counts": counts,
        "decisive_hit_rate_pct": round(counts["hit"] / decisive * 100, 1) if decisive else None,
        "by_metric": by_metric,
        "note": "Hit rate excludes pending and inconclusive observations and is monitoring QA, not investment performance.",
    }


def update_history(
    history: dict[str, Any], report_date: str, snapshot: dict[str, Any], analysis: dict[str, Any],
) -> tuple[dict[str, Any], dict[str, Any]]:
    values = metric_values(snapshot)
    records = history.setdefault("records", [])
    resolved_today: list[dict[str, Any]] = []
    for row in records:
        if row.get("status") != "pending" or row.get("created_report_date") == report_date:
            continue
        if row.get("last_seen_report_date") == report_date:
            continue
        row["last_seen_report_date"] = report_date
        row["remaining_reports"] = max(0, int(row.get("remaining_reports", 1)) - 1)
        if row["remaining_reports"] > 0:
            continue
        current = values.get(row.get("metric_key"))
        if current is None:
            row["status"] = "inconclusive"
            row["resolution_reason"] = "평가일 지표 자료 없음"
        else:
            row["current_value"] = current
            row["change"] = current - float(row["baseline_value"])
            row["status"] = outcome(
                row["expected_direction"], float(row["baseline_value"]), current,
                float(row["minimum_change"]),
            )
            row["resolution_reason"] = "사전 정의된 지표 변화 기준으로 판정"
        row["resolved_report_date"] = report_date
        resolved_today.append(row.copy())

    existing_ids = {row.get("id") for row in records}
    created_today: list[dict[str, Any]] = []
    for index, item in enumerate(analysis.get("hypotheses", [])[:2], start=1):
        metric_key = item.get("metric_key")
        baseline = values.get(metric_key)
        record_id = f"{report_date}-H{index}"
        if record_id in existing_ids or metric_key not in METRIC_RULES or baseline is None:
            continue
        rule = METRIC_RULES[metric_key]
        row = {
            "id": record_id,
            "created_report_date": report_date,
            "claim": item.get("claim"),
            "rationale": item.get("rationale"),
            "metric_key": metric_key,
            "metric_label": rule["label"],
            "expected_direction": item.get("expected_direction"),
            "baseline_value": baseline,
            "minimum_change": rule["minimum_change"],
            "threshold_origin": "draft_system_monitoring_rule",
            "horizon_reports": int(item.get("horizon_reports", 1)),
            "remaining_reports": int(item.get("horizon_reports", 1)),
            "last_seen_report_date": report_date,
            "status": "pending",
        }
        records.append(row)
        created_today.append(row.copy())

    # Rebuild the daily view from durable records so a same-day rerun is
    # idempotent and does not erase hypotheses resolved or created earlier.
    resolved_today = [row.copy() for row in records if row.get("resolved_report_date") == report_date]
    created_today = [row.copy() for row in records if row.get("created_report_date") == report_date]
    history.update({
        "schema_version": "hypothesis_history.v1",
        "updated_report_date": report_date,
        "summary": summarize(records),
    })
    review = {
        "schema_version": "daily_hypothesis_review.v1",
        "report_date": report_date,
        "resolved_today": resolved_today,
        "created_today": created_today,
        "cumulative_summary": history["summary"],
    }
    return history, review


def main() -> None:
    parser = argparse.ArgumentParser(description="Track daily market hypotheses across report runs.")
    parser.add_argument("--date", default=date.today().isoformat())
    parser.add_argument("--snapshot-file")
    parser.add_argument("--analysis-file")
    parser.add_argument("--history-file")
    args = parser.parse_args()
    snapshot_path = root_path(args.snapshot_file, ROOT / "workspace" / "snapshots" / args.date / "daily_snapshot.json")
    analysis_path = root_path(args.analysis_file, ROOT / "workspace" / "analysis" / args.date / "market_analysis.json")
    history_path = root_path(args.history_file, ROOT / "workspace" / "history" / "hypothesis_history.json")
    snapshot = json.loads(snapshot_path.read_text(encoding="utf-8"))
    analysis_payload = json.loads(analysis_path.read_text(encoding="utf-8"))
    analysis = analysis_payload.get("analysis", analysis_payload)
    history = json.loads(history_path.read_text(encoding="utf-8")) if history_path.exists() else {"records": []}
    history, review = update_history(history, args.date, snapshot, analysis)
    history_path.parent.mkdir(parents=True, exist_ok=True)
    history_path.write_text(json.dumps(history, ensure_ascii=False, indent=2), encoding="utf-8")
    review_dir = history_path.parent / "reviews"
    review_dir.mkdir(parents=True, exist_ok=True)
    review_path = review_dir / f"{args.date}.json"
    review_path.write_text(json.dumps(review, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Hypothesis history saved: {history_path.relative_to(ROOT)}")
    print(f"Daily hypothesis review saved: {review_path.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
