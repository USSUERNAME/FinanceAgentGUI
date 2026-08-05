"""Collect link-only event candidates from the public GDELT DOC 2.0 API."""

from __future__ import annotations

from typing import Any
from urllib.parse import urlencode

from candidate_pipeline import parse_timestamp
from collectors.common import get_json, make_item

ENDPOINT = "https://api.gdeltproject.org/api/v2/doc/doc"


def normalized_seen_date(value: str) -> str:
    parsed = parse_timestamp(value)
    return parsed.isoformat() if parsed else ""


def collect(config: dict[str, Any]) -> tuple[list[dict[str, Any]], str | None]:
    settings = config.get("gdelt", {})
    if not settings.get("enabled", False):
        return [], "GDELT discovery disabled"
    params = {
        "query": settings.get(
            "query",
            '("stock market" OR inflation OR "interest rates" OR earnings)',
        ),
        "mode": "artlist",
        "format": "json",
        "sort": settings.get("sort", "datedesc"),
        "maxrecords": min(int(settings.get("max_records", 25)), 250),
        "timespan": settings.get("timespan", "24h"),
    }
    try:
        payload = get_json(f"{ENDPOINT}?{urlencode(params)}")
    except Exception as exc:
        return [], f"GDELT request failed ({type(exc).__name__})"

    rows = payload.get("articles", [])
    items: list[dict[str, Any]] = []
    for row in rows:
        url = str(row.get("url") or "").strip()
        title = str(row.get("title") or "").strip()
        if not url or not title:
            continue
        published_at = normalized_seen_date(str(row.get("seendate") or ""))
        publisher = str(row.get("domain") or "GDELT-discovered publisher").strip()
        language = str(row.get("language") or "").strip()
        country = str(row.get("sourcecountry") or "").strip()
        items.append(make_item(
            source_id="gdelt",
            source_type="news_discovery",
            published_at=published_at,
            title=title,
            url=url,
            tickers=[],
            tags=["news", "gdelt", language, country],
            raw_text=title,
            rights_label="GDELT discovery metadata only; retain the publisher link and do not republish article text or images.",
            observation_date=published_at[:10] or None,
            release_date=published_at or None,
            market_cutoff="gdelt_metadata_at_collection",
            source_grade="D",
            primary_source_confirmed=False,
            evidence_scope="headline_metadata",
            evidence_label="unknown",
            freshness_state="current_metadata",
            publisher=publisher,
            source_url_kind="publisher_article",
            link_required=True,
        ))
    if not items:
        return [], f"GDELT returned {len(rows)} article candidate(s), but none had usable URL/title metadata"
    return items, None
