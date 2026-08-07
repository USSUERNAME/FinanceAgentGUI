"""Discover recent public institutional research from official sitemaps.

Only publisher metadata is retained here. Article bodies and paywalled research
are deliberately outside this adapter's scope.
"""

from __future__ import annotations

import json
import re
from datetime import datetime, timedelta, timezone
from html import unescape
from typing import Any, Callable
from urllib.parse import urlsplit
from urllib.request import Request, urlopen
from xml.etree import ElementTree

from candidate_pipeline import domain_for_url, domain_matches
from collectors.common import make_item

SITEMAP_NAMESPACE = {"sm": "http://www.sitemaps.org/schemas/sitemap/0.9"}
TITLE_PATTERNS = (
    re.compile(
        r'<meta[^>]+property=["\']og:title["\'][^>]+content=["\']([^"\']+)',
        re.IGNORECASE,
    ),
    re.compile(
        r'<meta[^>]+content=["\']([^"\']+)["\'][^>]+property=["\']og:title["\']',
        re.IGNORECASE,
    ),
    re.compile(r"<title[^>]*>(.*?)</title>", re.IGNORECASE | re.DOTALL),
)


def _request_bytes(url: str, *, timeout: int = 30) -> bytes:
    request = Request(
        url,
        headers={
            "User-Agent": (
                "PB-Daily-Market-Brief/1.0 "
                "(official institutional insight metadata discovery)"
            ),
        },
    )
    with urlopen(request, timeout=timeout) as response:
        return response.read()


def _sitemap_rows(payload: bytes) -> tuple[list[dict[str, str]], list[str]]:
    root = ElementTree.fromstring(payload)
    rows = []
    for node in root.findall("sm:url", SITEMAP_NAMESPACE):
        url = (node.findtext("sm:loc", default="", namespaces=SITEMAP_NAMESPACE) or "").strip()
        last_modified = (
            node.findtext("sm:lastmod", default="", namespaces=SITEMAP_NAMESPACE) or ""
        ).strip()
        if url:
            rows.append({"url": url, "last_modified": last_modified})
    indexes = [
        (node.findtext("sm:loc", default="", namespaces=SITEMAP_NAMESPACE) or "").strip()
        for node in root.findall("sm:sitemap", SITEMAP_NAMESPACE)
    ]
    return rows, [url for url in indexes if url]


def parse_sitemap(
    sitemap_url: str,
    *,
    fetcher: Callable[[str], bytes] = _request_bytes,
) -> list[dict[str, str]]:
    rows, indexes = _sitemap_rows(fetcher(sitemap_url))
    if rows:
        return rows
    output: list[dict[str, str]] = []
    for child_url in indexes[:5]:
        child_rows, _ = _sitemap_rows(fetcher(child_url))
        output.extend(child_rows)
    return output


def _parsed_time(value: str) -> datetime | None:
    text = str(value or "").strip()
    if not text:
        return None
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _path_matches(url: str, patterns: list[str]) -> bool:
    path = urlsplit(url).path.lower()
    return any(re.search(pattern, path, flags=re.IGNORECASE) for pattern in patterns)


def _page_title(payload: bytes, url: str) -> str:
    text = payload.decode("utf-8", errors="replace")
    for pattern in TITLE_PATTERNS:
        match = pattern.search(text)
        if match:
            title = unescape(re.sub(r"\s+", " ", match.group(1))).strip()
            if title:
                return title[:300]
    slug = urlsplit(url).path.rstrip("/").split("/")[-1]
    return re.sub(r"[-_]+", " ", slug).strip().title()[:300]


def _title_is_relevant(title: str, source: dict[str, Any]) -> bool:
    normalized = title.casefold()
    excluded = [
        str(value).strip().casefold()
        for value in source.get("exclude_title_keywords") or []
        if str(value).strip()
    ]
    if any(keyword in normalized for keyword in excluded):
        return False
    required = [
        str(value).strip().casefold()
        for value in source.get("include_title_keywords") or []
        if str(value).strip()
    ]
    return not required or any(keyword in normalized for keyword in required)


def collect(
    config: dict[str, Any],
    *,
    fetcher: Callable[[str], bytes] = _request_bytes,
    now: datetime | None = None,
) -> tuple[list[dict[str, Any]], str | None]:
    sources = config.get("institutional_insights") or []
    if not sources:
        return [], "No institutional insight sources configured"
    reference_time = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
    items: list[dict[str, Any]] = []
    failures = 0
    for source in sources:
        if not source.get("enabled", True):
            continue
        sitemap_url = str(source.get("sitemap_url") or "").strip()
        official_domains = [str(value) for value in source.get("official_domains") or []]
        path_patterns = [str(value) for value in source.get("path_patterns") or []]
        if not sitemap_url or not official_domains or not path_patterns:
            failures += 1
            continue
        try:
            rows = parse_sitemap(sitemap_url, fetcher=fetcher)
        except Exception:
            failures += 1
            continue
        max_age_days = max(1, min(int(source.get("max_age_days", 14)), 90))
        cutoff = reference_time - timedelta(days=max_age_days)
        eligible = []
        for row in rows:
            modified = _parsed_time(row["last_modified"])
            if (
                modified is None
                or modified < cutoff
                or not domain_matches(domain_for_url(row["url"]), official_domains)
                or not _path_matches(row["url"], path_patterns)
            ):
                continue
            eligible.append((modified, row["url"]))
        eligible.sort(reverse=True)
        for modified, url in eligible[: max(1, min(int(source.get("max_items", 8)), 20))]:
            try:
                title = _page_title(fetcher(url), url)
            except Exception:
                failures += 1
                continue
            if not _title_is_relevant(title, source):
                continue
            item = make_item(
                source_id=str(source.get("id") or "institutional_insight"),
                source_type="institutional_research_metadata",
                published_at=modified.isoformat(),
                title=title,
                url=url,
                tickers=[],
                tags=[
                    "institutional_research",
                    "attributed_analysis",
                    *[str(value) for value in source.get("tags") or []],
                ],
                raw_text=title,
                rights_label=str(
                    source.get("rights_label")
                    or "Official publisher title, date, and link metadata only."
                ),
                observation_date=modified.date().isoformat(),
                release_date=modified.isoformat(),
                market_cutoff="official_sitemap_last_modified",
                source_grade="B",
                primary_source_confirmed=True,
                evidence_scope="official_institutional_commentary_metadata",
                evidence_label="attributed_analysis",
                freshness_state="current_metadata",
                publisher=str(source.get("publisher") or source.get("id") or ""),
                source_url_kind="primary_source",
                link_required=True,
            )
            item.update({
                "publication_eligible": False,
                "verification_status": "official_metadata_requires_content_review",
                "discovery_role": "institutional_research",
                "market_scope": str(source.get("market_scope") or "GLOBAL"),
            })
            items.append(item)
    if not items:
        return [], (
            "Institutional insight discovery produced no recent usable items "
            f"({failures} source or page failure(s))"
        )
    return items, None
