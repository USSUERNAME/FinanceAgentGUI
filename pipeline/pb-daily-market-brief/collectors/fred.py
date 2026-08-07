"""Collect the latest configured FRED observations as macro context."""

from __future__ import annotations

import os
from typing import Any
from urllib.parse import urlencode

from collectors.common import get_json, make_item


def collect(config: dict[str, Any]) -> tuple[list[dict[str, Any]], str | None]:
    api_key = os.getenv("FRED_API_KEY", "").strip()
    if not api_key:
        return [], "FRED_API_KEY not set"

    items: list[dict[str, Any]] = []
    for series in config.get("fred_series", []):
        series_id = series["id"]
        query = urlencode({
            "series_id": series_id,
            "api_key": api_key,
            "file_type": "json",
            "sort_order": "desc",
            "limit": 2,
        })
        payload = get_json(f"https://api.stlouisfed.org/fred/series/observations?{query}")
        observations = [row for row in payload.get("observations", []) if row.get("value") not in {".", ""}]
        if not observations:
            continue
        latest = observations[0]
        previous = observations[1] if len(observations) > 1 else None
        change = ""
        if previous:
            change = f" Previous observation: {previous['value']} on {previous['date']}."
        items.append(make_item(
            source_id="fred",
            source_type="macro_data",
            published_at=f"{latest['date']}T00:00:00+00:00",
            title=f"FRED | {series['label']} ({series_id})",
            url=f"https://fred.stlouisfed.org/series/{series_id}",
            tickers=[],
            tags=["macro", series_id, series.get("unit", "")],
            raw_text=(f"Latest observation: {latest['value']} on {latest['date']}." + change),
            rights_label="FRED API data; retain the source link and applicable FRED terms.",
            observation_date=latest["date"],
            release_date=None,
            market_cutoff="latest_available_observation",
            source_grade="A",
            primary_source_confirmed=True,
            evidence_scope="observation_value",
            evidence_label="fact_provider_standardized",
            freshness_state="period_date_only",
            publisher="FRED",
            source_url_kind="primary_source",
            link_required=True,
        ))
    return items, None
