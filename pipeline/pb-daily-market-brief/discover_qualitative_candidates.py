"""Discover link-only candidates from approved source domains through NewsAPI metadata."""

from __future__ import annotations

import json
import os
import argparse
from email.utils import parsedate_to_datetime
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from xml.etree import ElementTree

from collectors.common import ROOT, get_json, load_dotenv
from qualitative_inbox import create_candidate, existing_urls, token_and_source_id


def normalize_feed_date(value: str) -> str:
    """Return an ISO timestamp when an RSS date is parseable, otherwise keep it blank."""
    try:
        return parsedate_to_datetime(value).isoformat()
    except (TypeError, ValueError, IndexError, OverflowError):
        return ""


def parse_rss_items(payload: bytes) -> list[dict[str, str]]:
    """Read RSS 2.0 link metadata only; article bodies are never fetched."""
    root = ElementTree.fromstring(payload)
    rows: list[dict[str, str]] = []
    for item in root.findall("./channel/item"):
        title = (item.findtext("title") or "").strip()
        url = (item.findtext("link") or "").strip()
        published_at = normalize_feed_date((item.findtext("pubDate") or "").strip())
        if title and url:
            rows.append({"title": title, "url": url, "published_at": published_at})
    return rows


def fetch_rss_candidates(source: dict) -> list[dict[str, str]]:
    feed_url = str(source.get("feed_url") or "").strip()
    if not feed_url:
        return []
    request = Request(feed_url, headers={"User-Agent": "PB-Daily-Market-Brief/1.0 (link-only candidate discovery)"})
    with urlopen(request, timeout=30) as response:
        return parse_rss_items(response.read())


def candidate_reason(source: dict) -> str:
    kind = str(source.get("candidate_kind") or "market_commentary")
    themes = ", ".join(source.get("themes", []))
    if kind == "official_policy_signal":
        return f"공식 정책 발언 후보 | 사실 검증용 · {themes}"
    return f"공개 시장 견해 후보 | {themes}"


def main() -> None:
    parser = argparse.ArgumentParser(description="Discover link-only qualitative-research candidates.")
    parser.add_argument("--dry-run", action="store_true", help="Discover candidates without creating Notion Inbox rows.")
    args = parser.parse_args()
    load_dotenv()
    api_key = os.getenv("NEWSAPI_KEY", "").strip()
    if not api_key:
        print("Qualitative discovery skipped: NEWSAPI_KEY is not set.")
        return
    try:
        token, data_source_id = token_and_source_id()
    except SystemExit as exc:
        print(f"Qualitative discovery skipped: {exc}")
        return
    config = json.loads((ROOT / "qualitative_sources.json").read_text(encoding="utf-8"))
    known_urls = existing_urls(token, data_source_id)
    created = 0
    for source in config.get("sources", []):
        mode = str(source.get("discovery_mode") or "newsapi_metadata")
        if mode == "rss":
            try:
                candidates = fetch_rss_candidates(source)
            except Exception as exc:
                print(f"{source['name']}: RSS discovery skipped ({type(exc).__name__})")
                continue
            for article in candidates[:int(source.get("max_items", 5))]:
                url = article["url"]
                if url in known_urls:
                    continue
                if not args.dry_run:
                    create_candidate(token, data_source_id, {
                        "title": article["title"], "url": url, "source": source["name"],
                        "published_at": article["published_at"], "themes": source.get("themes", []),
                        "reason": candidate_reason(source),
                    })
                known_urls.add(url)
                created += 1
            continue
        if mode != "newsapi_metadata":
            print(f"{source['name']}: unsupported discovery mode ({mode})")
            continue
        settings = config.get("newsapi", {})
        query = urlencode({
            "q": source.get("query") or settings.get("query", "technology OR market"),
            "domains": ",".join(source.get("domains", [])),
            "sortBy": "publishedAt",
            "pageSize": settings.get("page_size_per_source", 5),
            "apiKey": api_key,
        })
        try:
            payload = get_json(f"https://newsapi.org/v2/everything?{query}")
        except Exception as exc:
            print(f"{source['name']}: discovery skipped ({type(exc).__name__})")
            continue
        if payload.get("status") != "ok":
            print(f"{source['name']}: NewsAPI returned no usable metadata")
            continue
        for article in payload.get("articles", []):
            url = (article.get("url") or "").strip()
            title = (article.get("title") or "").strip()
            if not url or not title or title == "[Removed]" or url in known_urls:
                continue
            if not args.dry_run:
                create_candidate(token, data_source_id, {
                    "title": title,
                    "url": url,
                    "source": source["name"],
                    "published_at": article.get("publishedAt", ""),
                    "themes": source.get("themes", []),
                    "reason": candidate_reason(source),
                })
            known_urls.add(url)
            created += 1
    outcome = "discovered (dry run; no Inbox rows created)" if args.dry_run else "added"
    print(f"Qualitative candidates {outcome}: {created}")


if __name__ == "__main__":
    main()
