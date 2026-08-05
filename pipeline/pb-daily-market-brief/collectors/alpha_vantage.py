"""Collect licensed API news, not web-scraped finance-site pages."""

from __future__ import annotations

import os
from datetime import datetime
from typing import Any
from urllib.parse import urlencode

from collectors.common import get_json, make_item


def _published_at(value: str) -> str:
    try:
        return datetime.strptime(value, "%Y%m%dT%H%M%S").isoformat() + "+00:00"
    except ValueError:
        return value


def collect(config: dict[str, Any]) -> tuple[list[dict[str, Any]], str | None]:
    api_key = os.getenv("ALPHAVANTAGE_API_KEY", "").strip()
    if not api_key:
        return [], "ALPHAVANTAGE_API_KEY not set"

    settings = config.get("alpha_vantage", {})
    query = urlencode({
        "function": "NEWS_SENTIMENT",
        "tickers": ",".join(config.get("watchlist", [])),
        "topics": ",".join(settings.get("topics", [])),
        "limit": settings.get("limit", 25),
        "apikey": api_key,
    })
    payload = get_json(f"https://www.alphavantage.co/query?{query}")
    if "Information" in payload or "Note" in payload:
        return [], "Alpha Vantage returned a rate-limit or provider notice"

    items: list[dict[str, Any]] = []
    for row in payload.get("feed", []):
        ticker_sentiment = row.get("ticker_sentiment", [])
        tickers = [entry.get("ticker", "") for entry in ticker_sentiment]
        topics = [entry.get("topic", "") for entry in row.get("topics", [])]
        published_at = _published_at(row.get("time_published", ""))
        items.append(make_item(
            source_id="alpha_vantage",
            source_type="market_news",
            published_at=published_at,
            title=row.get("title", "Untitled market news"),
            url=row.get("url", ""),
            tickers=tickers,
            tags=["news", *topics],
            raw_text=row.get("summary", ""),
            rights_label="Alpha Vantage API content; link out to the original publisher and do not republish full articles.",
            observation_date=published_at[:10] or None,
            release_date=published_at or None,
            market_cutoff="provider_metadata_at_collection",
            source_grade="C",
            primary_source_confirmed=False,
            evidence_scope="provider_summary",
            evidence_label="unknown",
            freshness_state="current_metadata",
            publisher=str(row.get("source") or "Alpha Vantage publisher"),
            source_url_kind="publisher_article",
            link_required=True,
        ))
    return items, None
