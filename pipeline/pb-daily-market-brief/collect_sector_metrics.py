"""Collect official sector operating proxies with deterministic lineage and scoring."""

from __future__ import annotations

import argparse
import json
import os
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable
from urllib.parse import urlencode

from collectors.common import ROOT, get_json, load_dotenv
from sector_master import load_sector_master

REGISTRY_PATH = ROOT / "sector_metric_registry.json"
SCHEMA_VERSION = "sector_metric_observations.v1"


def load_metric_registry(path: Path = REGISTRY_PATH) -> dict[str, Any]:
    registry = json.loads(path.read_text(encoding="utf-8"))
    validate_metric_registry(registry)
    return registry


def validate_metric_registry(registry: dict[str, Any]) -> None:
    if registry.get("schema_version") != "sector_metric_registry.v1":
        raise ValueError("Unexpected sector metric registry schema")
    valid_sectors = {item["sector_id"] for item in load_sector_master()["sectors"]}
    metrics = registry.get("metrics", [])
    metric_ids = [item.get("metric_id") for item in metrics]
    if not metrics or len(metric_ids) != len(set(metric_ids)):
        raise ValueError("Metric registry requires unique metric IDs")
    for item in metrics:
        required = {
            "metric_id", "sector_id", "dimension_id", "provider", "series_id",
            "source_url", "frequency", "units", "geographic_scope", "proxy_scope",
            "source_grade", "primary_source_confirmed", "max_age_days", "limitation_ko",
        }
        missing = sorted(required - set(item))
        if missing:
            raise ValueError(f"Metric {item.get('metric_id')} missing fields: {missing}")
        if item["sector_id"] not in valid_sectors:
            raise ValueError(f"Unknown sector ID: {item['sector_id']}")
        if item["dimension_id"] != "industry_leading_data":
            raise ValueError("Automatic official proxies may only populate industry_leading_data")
        if item["provider"] != "FRED" or not item["source_url"].startswith("https://fred.stlouisfed.org/series/"):
            raise ValueError(f"Unsupported metric provider or source URL: {item['metric_id']}")
        if item["source_grade"] != "A" or item["primary_source_confirmed"] is not True:
            raise ValueError(f"Official registry metric must retain grade A lineage: {item['metric_id']}")


def percent_change(values: list[tuple[date, float]], periods: int) -> float | None:
    if len(values) <= periods:
        return None
    current, previous = values[-1][1], values[-1 - periods][1]
    if previous == 0:
        return None
    return round((current / previous - 1) * 100, 4)


def monthly_momentum_score(change_1: float | None, change_3: float | None, change_12: float | None) -> float | None:
    if change_1 is None and change_3 is None and change_12 is None:
        return None
    score = 50.0
    if change_1 is not None:
        score += max(-15.0, min(change_1 * 4.0, 15.0))
    if change_3 is not None:
        score += max(-20.0, min(change_3 * 3.0, 20.0))
    if change_12 is not None:
        score += max(-25.0, min(change_12 * 2.0, 25.0))
    return round(max(0.0, min(score, 100.0)), 2)


def fetch_fred_observations(series_id: str, api_key: str, start: str) -> list[tuple[date, float]]:
    query = urlencode({
        "series_id": series_id,
        "api_key": api_key,
        "file_type": "json",
        "observation_start": start,
        "sort_order": "asc",
    })
    payload = get_json(f"https://api.stlouisfed.org/fred/series/observations?{query}")
    values: list[tuple[date, float]] = []
    for item in payload.get("observations", []):
        if item.get("value") in {None, "", "."}:
            continue
        values.append((date.fromisoformat(item["date"]), float(item["value"])))
    return values


def build_metric_observation(
    metric: dict[str, Any],
    report_date: date,
    values: list[tuple[date, float]],
) -> dict[str, Any]:
    values = sorted((item for item in values if item[0] <= report_date), key=lambda item: item[0])
    base = {
        key: metric[key]
        for key in (
            "metric_id", "sector_id", "dimension_id", "label_ko", "provider",
            "upstream_source", "series_id", "source_url", "frequency", "units",
            "seasonal_adjustment", "geographic_scope", "proxy_scope", "source_grade",
            "primary_source_confirmed", "rights_label", "limitation_ko",
        )
    }
    if not values:
        return {
            **base,
            "status": "missing_observations",
            "score": None,
            "confidence": "none",
            "observation_date": None,
            "collected_at": datetime.now(timezone.utc).isoformat(),
        }
    latest_date, latest_value = values[-1]
    age_days = (report_date - latest_date).days
    change_1 = percent_change(values, 1)
    change_3 = percent_change(values, 3)
    change_12 = percent_change(values, 12)
    is_stale = age_days > int(metric["max_age_days"])
    score = None if is_stale else monthly_momentum_score(change_1, change_3, change_12)
    return {
        **base,
        "status": "stale" if is_stale else "available",
        "score": score,
        "confidence": "low" if score is not None else "none",
        "observation_date": latest_date.isoformat(),
        "latest_value": latest_value,
        "previous_value": values[-2][1] if len(values) > 1 else None,
        "change_1_period_pct": change_1,
        "change_3_period_pct": change_3,
        "change_12_period_pct": change_12,
        "age_days": age_days,
        "max_age_days": metric["max_age_days"],
        "collected_at": datetime.now(timezone.utc).isoformat(),
        "formula_version": "monthly_momentum.v1",
        "derivation_note": "Computed from published monthly observations; release date is not inferred.",
        "vintage_policy": "current_latest_vintage; historical reruns may include revisions",
    }


def collect_sector_metrics(
    report_date: str,
    api_key: str,
    registry: dict[str, Any] | None = None,
    fetcher: Callable[[str, str, str], list[tuple[date, float]]] = fetch_fred_observations,
) -> dict[str, Any]:
    registry = registry or load_metric_registry()
    report_day = date.fromisoformat(report_date)
    observations: list[dict[str, Any]] = []
    errors: list[dict[str, str]] = []
    if api_key:
        start = (report_day - timedelta(days=800)).isoformat()
        for metric in registry["metrics"]:
            try:
                values = fetcher(metric["series_id"], api_key, start)
                observations.append(build_metric_observation(metric, report_day, values))
            except Exception as exc:  # keep one unavailable series from breaking publication
                errors.append({"metric_id": metric["metric_id"], "error": str(exc)})
                observations.append(build_metric_observation(metric, report_day, []))
    return {
        "schema_version": SCHEMA_VERSION,
        "report_date": report_date,
        "registry_version": registry["version_date"],
        "collection_status": "missing_fred_api_key" if not api_key else ("partial" if errors else "complete"),
        "metric_count": len(observations),
        "available_metric_count": sum(item.get("score") is not None for item in observations),
        "errors": errors,
        "metrics": observations,
        "policy_note": "Only industry-leading-data is populated. Earnings revisions and orders/CAPEX/backlog require separate verified inputs.",
        "vintage_note": "Observations after report_date are excluded, but FRED's current latest vintage may revise older values.",
    }


def write_sector_metrics(payload: dict[str, Any]) -> Path:
    output_dir = ROOT / "workspace" / "sector_metrics" / payload["report_date"]
    output_dir.mkdir(parents=True, exist_ok=True)
    output = output_dir / "sector_metrics.json"
    output.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return output


def main() -> None:
    parser = argparse.ArgumentParser(description="Collect official sector operating proxies")
    parser.add_argument("--date", default=date.today().isoformat())
    args = parser.parse_args()
    load_dotenv()
    payload = collect_sector_metrics(args.date, os.getenv("FRED_API_KEY", "").strip())
    output = write_sector_metrics(payload)
    print(f"Sector metrics saved: {output.relative_to(ROOT)}")
    print(
        f"Sector metrics status: {payload['collection_status']} | "
        f"available={payload['available_metric_count']}/{payload['metric_count']}"
    )


if __name__ == "__main__":
    main()
