"""Collect a compact, link-out-only set of international market-news candidates."""

from __future__ import annotations

import os
from typing import Any
from urllib.parse import urlencode

from collectors.common import get_json, make_item


def collect(config: dict[str, Any]) -> tuple[list[dict[str, Any]], str | None]:
    api_key = os.getenv("NEWSAPI_KEY", "").strip()
    if not api_key:
        return [], "NEWSAPI_KEY not set"

    settings = config.get("newsapi", {})
    if settings.get("endpoint") == "top_headlines":
        endpoint = "https://newsapi.org/v2/top-headlines"
        params = {
            "country": settings.get("country", "us"),
            "category": settings.get("category", "business"),
            "pageSize": settings.get("page_size", 12),
            "apiKey": api_key,
        }
    else:
        endpoint = "https://newsapi.org/v2/everything"
        params = {
            "q": settings.get("query", "markets OR economy"),
            "language": settings.get("language", "en"),
            "sortBy": settings.get("sort_by", "popularity"),
            "pageSize": settings.get("page_size", 12),
            "apiKey": api_key,
        }
    query = urlencode(params)
    try:
        payload = get_json(f"{endpoint}?{query}")
    except Exception as exc:
        # Do not expose provider response bodies: they can contain request details.
        return [], f"NewsAPI request failed ({type(exc).__name__})"
    if payload.get("status") != "ok":
        return [], "NewsAPI returned a provider or plan error"

    candidates = payload.get("articles", [])
    items: list[dict[str, Any]] = []
    for row in candidates:
        source = row.get("source") or {}
        title = (row.get("title") or "Untitled international market news").strip()
        description = (row.get("description") or row.get("content") or "").strip()
        if not description or title == "[Removed]":
            continue
        items.append(make_item(
            source_id="newsapi",
            source_type="international_news",
            published_at=row.get("publishedAt", ""),
            title=title,
            url=row.get("url", ""),
            tickers=[],
            tags=["news", "international", str(source.get("name", ""))],
            raw_text=description,
            rights_label="NewsAPI metadata only; link to the original publisher and do not republish article text or images.",
            observation_date=(row.get("publishedAt") or "")[:10] or None,
            release_date=row.get("publishedAt") or None,
            market_cutoff="provider_metadata_at_collection",
            source_grade="D",
            primary_source_confirmed=False,
            evidence_scope="headline_and_description_metadata",
            evidence_label="unknown",
            freshness_state="current_metadata",
            publisher=str(source.get("name") or "NewsAPI publisher"),
            source_url_kind="publisher_article",
            link_required=True,
        ))
    if not items:
        return [], f"NewsAPI returned {len(candidates)} candidate article(s), but none had usable link-out metadata"
    return items, None
