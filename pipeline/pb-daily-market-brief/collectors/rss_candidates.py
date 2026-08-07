"""Collect link-only candidates from explicitly configured RSS/Atom feeds."""

from __future__ import annotations

import os
from email.utils import parsedate_to_datetime
from typing import Any
from urllib.request import Request, urlopen
from xml.etree import ElementTree

from candidate_pipeline import domain_for_url, domain_matches
from collectors.common import make_item


def normalized_feed_date(value: str) -> str:
    text = value.strip()
    if not text:
        return ""
    try:
        return parsedate_to_datetime(text).isoformat()
    except (TypeError, ValueError, IndexError, OverflowError):
        try:
            return __import__("datetime").datetime.fromisoformat(text.replace("Z", "+00:00")).isoformat()
        except ValueError:
            return ""


def parse_feed_items(payload: bytes) -> list[dict[str, str]]:
    root = ElementTree.fromstring(payload)
    rows: list[dict[str, str]] = []
    for item in root.findall("./channel/item"):
        title = (item.findtext("title") or "").strip()
        url = (item.findtext("link") or "").strip()
        published = (item.findtext("pubDate") or item.findtext("date") or "").strip()
        if title and url:
            rows.append({"title": title, "url": url, "published_at": normalized_feed_date(published)})
    atom_namespace = {"atom": "http://www.w3.org/2005/Atom"}
    for entry in root.findall("./atom:entry", atom_namespace):
        title = (entry.findtext("atom:title", default="", namespaces=atom_namespace) or "").strip()
        link = entry.find("atom:link", atom_namespace)
        url = str(link.get("href") if link is not None else "").strip()
        published = (
            entry.findtext("atom:published", default="", namespaces=atom_namespace)
            or entry.findtext("atom:updated", default="", namespaces=atom_namespace)
            or ""
        ).strip()
        if title and url:
            rows.append({"title": title, "url": url, "published_at": normalized_feed_date(published)})
    return rows


def collect(config: dict[str, Any]) -> tuple[list[dict[str, Any]], str | None]:
    sources = config.get("rss_candidates", [])
    if not sources:
        return [], "No RSS candidate feeds configured"
    items: list[dict[str, Any]] = []
    failures = 0
    for source in sources:
        if not source.get("enabled", True):
            continue
        feed_url_env = str(source.get("feed_url_env") or "").strip()
        feed_url = str(
            os.getenv(feed_url_env, "") if feed_url_env
            else source.get("feed_url") or ""
        ).strip()
        if not feed_url:
            continue
        feed_role = str(source.get("feed_role") or "standard")
        breaking_news_radar = feed_role == "breaking_news_radar"
        request = Request(feed_url, headers={
            "User-Agent": "PB-Daily-Market-Brief/1.0 (link-only RSS candidate discovery)",
        })
        try:
            with urlopen(request, timeout=30) as response:
                feed_rows = parse_feed_items(response.read())
        except Exception:
            failures += 1
            continue
        for row in feed_rows[:int(source.get("max_items", 10))]:
            published_at = row["published_at"]
            official_domains = [str(item) for item in source.get("official_domains", [])]
            primary = (
                not breaking_news_radar
                and
                bool(source.get("primary_source_confirmed", False))
                and bool(official_domains)
                and domain_matches(domain_for_url(row["url"]), official_domains)
            )
            item = make_item(
                source_id=str(source.get("id") or "rss_candidate"),
                source_type=(
                    "news_discovery"
                    if breaking_news_radar
                    else str(source.get("source_type") or "official_release_metadata")
                ),
                published_at=published_at,
                title=row["title"],
                url=row["url"],
                tickers=[],
                tags=["rss", *[str(tag) for tag in source.get("tags", [])]],
                raw_text=row["title"],
                rights_label=str(source.get("rights_label") or "RSS link metadata only; retain the original source URL."),
                observation_date=published_at[:10] or None,
                release_date=published_at or None,
                market_cutoff="rss_metadata_at_collection",
                source_grade=(
                    "D"
                    if breaking_news_radar
                    else str(source.get("source_grade") or "A") if primary
                    else "D"
                ),
                primary_source_confirmed=primary,
                evidence_scope=(
                    "metadata_only"
                    if breaking_news_radar
                    else "official_release_metadata" if primary
                    else "headline_metadata"
                ),
                evidence_label="primary_source_metadata" if primary else "unknown",
                freshness_state="current_metadata" if published_at else "publication_time_unknown",
                publisher=str(source.get("publisher") or source.get("id") or "RSS publisher"),
                source_url_kind="primary_source" if primary else "publisher_article",
                link_required=True,
            )
            if breaking_news_radar:
                item.update({
                    "publication_eligible": False,
                    "verification_status": "discovery_metadata_only",
                    "discovery_role": "breaking_news_radar",
                    "radar": {
                        "feed_id": str(source.get("id") or "rss_candidate"),
                        "feed_url_from_environment": bool(feed_url_env),
                        "requires_primary_source_resolution": True,
                    },
                })
            items.append(item)
    if not items:
        return [], f"RSS candidate discovery produced no usable items ({failures} feed failure(s))"
    return items, None
