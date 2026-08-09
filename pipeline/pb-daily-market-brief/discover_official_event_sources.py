"""Discover event-specific documents from registry-owned official landing pages.

The collector is intentionally bounded and conservative:

* it never searches arbitrary websites;
* a landing page is only a discovery route, never event evidence;
* redirects must remain on the configured official domains;
* a document becomes an A-grade record only when its body is strongly linked
  to the event and a publication timestamp falls inside the event window.
"""

from __future__ import annotations

import argparse
import json
import os
import re
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urljoin, urlsplit
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo

from candidate_pipeline import domain_for_url, domain_matches, parse_timestamp
from collectors.common import ROOT, canonicalize_url, load_dotenv, make_item
from prepare_event_evidence import extract_visible_text
from resolve_event_sources import (
    GENERIC_MATCH_TERMS,
    event_terms,
    load_registry,
    normalized_terms,
    route_for_event,
)

GENERIC_ENTITY_TERMS = {
    "ai", "cnbc", "morningstar", "marketwatch", "reuters", "bloomberg",
    "news", "markets", "report",
}
DATE_META_KEYS = {
    "article:published_time", "date", "datepublished", "dc.date",
    "dcterms.date", "publishdate", "pubdate", "sailthru.date",
}
DEFAULT_SETTINGS: dict[str, int | float] = {
    "max_events": 5,
    "max_landing_pages_per_event": 4,
    "max_candidate_links_per_event": 3,
    "max_document_fetches": 12,
    "timeout_seconds": 20,
    "max_response_bytes": 1_500_000,
    "max_body_chars": 12_000,
    "publication_window_hours": 96,
}
EMBEDDED_URL_PATTERN = re.compile(r"https?://[^\s<>\"'\]\[()]+", re.IGNORECASE)


class DiscoveryHTMLParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.links: list[dict[str, str]] = []
        self.meta_dates: list[str] = []
        self.time_dates: list[str] = []
        self.title_parts: list[str] = []
        self._anchor_href = ""
        self._anchor_parts: list[str] = []
        self._in_title = False

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        values = {str(key).casefold(): str(value or "") for key, value in attrs}
        lowered = tag.casefold()
        if lowered == "a":
            self._anchor_href = values.get("href", "")
            self._anchor_parts = []
        elif lowered == "meta":
            key = (values.get("property") or values.get("name") or values.get("itemprop") or "").casefold()
            if key in DATE_META_KEYS and values.get("content"):
                self.meta_dates.append(values["content"])
        elif lowered == "time" and values.get("datetime"):
            self.time_dates.append(values["datetime"])
        elif lowered == "title":
            self._in_title = True

    def handle_endtag(self, tag: str) -> None:
        lowered = tag.casefold()
        if lowered == "a" and self._anchor_href:
            self.links.append({
                "href": self._anchor_href,
                "text": " ".join(" ".join(self._anchor_parts).split()),
            })
            self._anchor_href = ""
            self._anchor_parts = []
        elif lowered == "title":
            self._in_title = False

    def handle_data(self, data: str) -> None:
        if self._anchor_href:
            self._anchor_parts.append(data)
        if self._in_title:
            self.title_parts.append(data)

    @property
    def title(self) -> str:
        return " ".join(" ".join(self.title_parts).split())

    @property
    def published_at(self) -> str | None:
        for value in [*self.meta_dates, *self.time_dates]:
            parsed = parse_timestamp(value)
            if parsed:
                return parsed.isoformat()
        return None


def fetch_official_html(
    url: str,
    official_domains: list[str],
    *,
    timeout_seconds: int,
    max_response_bytes: int,
) -> dict[str, Any]:
    canonical = canonicalize_url(url)
    if not canonical or not domain_matches(domain_for_url(canonical), official_domains):
        return {"status": "not_permitted_non_official_domain", "url": canonical}
    request = Request(
        canonical,
        headers={
            "User-Agent": os.getenv(
                "PB_REPORT_USER_AGENT",
                "pb-daily-market-brief/1.0 research@example.com",
            ),
            "Accept": "text/html,application/xhtml+xml",
        },
    )
    try:
        with urlopen(request, timeout=timeout_seconds) as response:
            final_url = canonicalize_url(response.geturl())
            if not domain_matches(domain_for_url(final_url), official_domains):
                return {"status": "redirected_outside_official_domain", "url": final_url}
            content_type = str(response.headers.get("Content-Type") or "").casefold()
            if "html" not in content_type:
                return {"status": "unsupported_content_type", "url": final_url}
            raw = response.read(max_response_bytes + 1)
            if len(raw) > max_response_bytes:
                return {"status": "response_too_large", "url": final_url}
            charset = response.headers.get_content_charset() or "utf-8"
            return {
                "status": "html_fetched",
                "url": final_url,
                "html": raw.decode(charset, errors="replace"),
            }
    except Exception as exc:  # Network failures are recorded per source.
        return {
            "status": "fetch_failed",
            "url": canonical,
            "error": f"{type(exc).__name__}: {exc}",
        }


def meaningful_event_terms(event: dict[str, Any]) -> set[str]:
    return event_terms(event) - GENERIC_MATCH_TERMS - GENERIC_ENTITY_TERMS


def strong_event_link(
    event: dict[str, Any],
    text: str,
) -> tuple[bool, list[str], list[str]]:
    document_terms = normalized_terms([text])
    overlap = sorted(meaningful_event_terms(event) & document_terms)
    entities = normalized_terms(event.get("entities", [])) - GENERIC_ENTITY_TERMS
    entity_overlap = sorted(entities & document_terms)
    return bool(entity_overlap or len(overlap) >= 3), overlap, entity_overlap


def publication_window_matches(
    published_at: str | None,
    event: dict[str, Any],
    max_hours: float,
) -> bool:
    document_time = parse_timestamp(published_at)
    event_time = parse_timestamp(event.get("published_from") or event.get("published_to"))
    if not document_time or not event_time:
        return False
    return abs((document_time - event_time).total_seconds()) <= max_hours * 3600


def publication_date_from_official_url(url: str) -> str | None:
    """Read a publication date only from an official identifier with date semantics."""
    parsed = urlsplit(url)
    if domain_matches(parsed.hostname or "", ["dart.fss.or.kr"]):
        receipt = str((parse_qs(parsed.query).get("rcpNo") or [""])[0])
        if re.fullmatch(r"20\d{12}", receipt):
            try:
                return datetime.strptime(receipt[:8], "%Y%m%d").replace(
                    tzinfo=ZoneInfo("Asia/Seoul")
                ).isoformat()
            except ValueError:
                return None
    return None


def candidate_links_from_landing(
    landing_url: str,
    html: str,
    event: dict[str, Any],
    official_domains: list[str],
) -> list[dict[str, Any]]:
    parser = DiscoveryHTMLParser()
    parser.feed(html)
    candidates: dict[str, dict[str, Any]] = {}
    for link in parser.links:
        url = canonicalize_url(urljoin(landing_url, link["href"]))
        if (
            not url
            or url == canonicalize_url(landing_url)
            or not domain_matches(domain_for_url(url), official_domains)
        ):
            continue
        searchable = f"{link['text']} {url}"
        linked, overlap, entity_overlap = strong_event_link(event, searchable)
        if not linked:
            continue
        score = len(overlap) * 4 + len(entity_overlap) * 8
        existing = candidates.get(url)
        candidate = {
            "url": url,
            "anchor_text": link["text"],
            "score": score,
            "term_overlap": overlap,
            "entity_overlap": entity_overlap,
        }
        if not existing or score > existing["score"]:
            candidates[url] = candidate
    return sorted(candidates.values(), key=lambda item: (item["score"], item["url"]), reverse=True)


def embedded_official_urls(
    event: dict[str, Any],
    records_by_id: dict[str, dict[str, Any]],
    official_domains: list[str],
) -> list[str]:
    """Return event-linked URLs only when their domain is explicitly official."""
    discovered: list[str] = []
    seen: set[str] = set()
    for record_id in event.get("record_ids") or []:
        record = records_by_id.get(str(record_id)) or {}
        values: list[str] = [
            str(record.get("canonical_url") or ""),
            str(record.get("url") or ""),
            *(str(value) for value in record.get("linked_urls") or []),
        ]
        values.extend(EMBEDDED_URL_PATTERN.findall(str(record.get("raw_text") or "")))
        for value in values:
            canonical = canonicalize_url(value.rstrip(".,;:!?"))
            if (
                not canonical
                or canonical in seen
                or not domain_matches(domain_for_url(canonical), official_domains)
            ):
                continue
            seen.add(canonical)
            discovered.append(canonical)
    return discovered


def fetch_candidate_documents(
    candidates: list[dict[str, Any]],
    event: dict[str, Any],
    official_domains: list[str],
    settings: dict[str, int | float],
    audit: dict[str, Any],
    remaining_fetches: int,
) -> tuple[list[dict[str, Any]], int]:
    records: list[dict[str, Any]] = []
    for candidate in candidates:
        if remaining_fetches <= 0:
            audit["status"] = "fetch_budget_exhausted"
            break
        result = fetch_official_html(
            candidate["url"],
            official_domains,
            timeout_seconds=int(settings["timeout_seconds"]),
            max_response_bytes=int(settings["max_response_bytes"]),
        )
        remaining_fetches -= 1
        candidate_audit = {
            **candidate,
            "fetch_status": result["status"],
            "accepted": False,
        }
        audit["candidate_documents"].append(candidate_audit)
        if result["status"] != "html_fetched":
            candidate_audit["error"] = result.get("error")
            continue
        parser = DiscoveryHTMLParser()
        parser.feed(result["html"])
        body = extract_visible_text(result["html"], int(settings["max_body_chars"]))
        linked, overlap, entity_overlap = strong_event_link(
            event, f"{parser.title} {body}"
        )
        published_at = parser.published_at or publication_date_from_official_url(
            result["url"]
        )
        time_matches = publication_window_matches(
            published_at,
            event,
            float(settings["publication_window_hours"]),
        )
        candidate_audit.update({
            "title": parser.title,
            "published_at": published_at,
            "published_at_source": (
                "document_metadata" if parser.published_at
                else "official_url_identifier" if published_at
                else "missing"
            ),
            "body_linked": linked,
            "publication_window_match": time_matches,
            "body_term_overlap": overlap,
            "body_entity_overlap": entity_overlap,
        })
        if not (linked and time_matches):
            continue
        discovery_route = str(candidate.get("discovery_route") or "registry_landing_page")
        record = make_item(
            source_id="official_event_discovery",
            source_type="official_release",
            published_at=published_at or "",
            title=parser.title or candidate["anchor_text"] or event.get("representative_title", ""),
            url=result["url"],
            tickers=[],
            tags=[str(event.get("event_type") or "other")],
            raw_text=body,
            rights_label="official public source; automated extraction for research",
            source_grade="A",
            primary_source_confirmed=True,
            evidence_scope="official_body_extracted",
            evidence_label="fact_source_reported",
            freshness_state="current",
            publisher=domain_for_url(result["url"]),
            source_url_kind="primary_source",
            derivation_note=(
                f"Discovered via {discovery_route} for event {event.get('event_id')}; "
                "body and publication window validated."
            ),
        )
        record["discovery_event_id"] = event.get("event_id")
        records.append(record)
        candidate_audit["accepted"] = True
    return records, remaining_fetches


def discover_event(
    event: dict[str, Any],
    source_match: dict[str, Any],
    settings: dict[str, int | float],
    *,
    no_network: bool,
    remaining_fetches: int,
    direct_urls: list[str] | None = None,
) -> tuple[list[dict[str, Any]], dict[str, Any], int]:
    route = source_match.get("official_route") or {}
    official_domains = list(route.get("origin_domains") or [])
    plan = source_match.get("search_plan") or {}
    landing_pages = list(plan.get("official_landing_pages") or [])[
        : int(settings["max_landing_pages_per_event"])
    ]
    audit: dict[str, Any] = {
        "event_id": event.get("event_id"),
        "status": "no_network" if no_network else "searched",
        "landing_pages": [],
        "candidate_documents": [],
        "accepted_record_count": 0,
    }
    if no_network:
        return [], audit, remaining_fetches

    direct_candidates = [
        {
            "url": url,
            "anchor_text": "embedded official source",
            "score": 10_000,
            "term_overlap": [],
            "entity_overlap": [],
            "discovery_route": "embedded_event_url",
        }
        for url in direct_urls or []
    ][: int(settings["max_candidate_links_per_event"])]
    direct_records, remaining_fetches = fetch_candidate_documents(
        direct_candidates,
        event,
        official_domains,
        settings,
        audit,
        remaining_fetches,
    )
    if direct_records:
        audit["accepted_record_count"] = len(direct_records)
        audit["status"] = "verified_embedded_official_document"
        return direct_records, audit, remaining_fetches
    if not landing_pages:
        audit["status"] = (
            "no_verified_document_found" if direct_candidates
            else "no_registered_landing_pages"
        )
        return [], audit, remaining_fetches

    candidates: list[dict[str, Any]] = []
    for landing_url in landing_pages:
        if remaining_fetches <= 0:
            audit["status"] = "fetch_budget_exhausted"
            break
        result = fetch_official_html(
            landing_url,
            official_domains,
            timeout_seconds=int(settings["timeout_seconds"]),
            max_response_bytes=int(settings["max_response_bytes"]),
        )
        remaining_fetches -= 1
        landing_audit = {"url": landing_url, "status": result["status"]}
        audit["landing_pages"].append(landing_audit)
        if result["status"] != "html_fetched":
            landing_audit["error"] = result.get("error")
            continue
        links = candidate_links_from_landing(
            result["url"], result["html"], event, official_domains
        )
        candidates.extend(links)

    unique_candidates: dict[str, dict[str, Any]] = {}
    for candidate in candidates:
        current = unique_candidates.get(candidate["url"])
        if not current or candidate["score"] > current["score"]:
            unique_candidates[candidate["url"]] = candidate
    ranked = sorted(
        unique_candidates.values(),
        key=lambda item: (item["score"], item["url"]),
        reverse=True,
    )[: int(settings["max_candidate_links_per_event"])]

    records, remaining_fetches = fetch_candidate_documents(
        ranked,
        event,
        official_domains,
        settings,
        audit,
        remaining_fetches,
    )
    audit["accepted_record_count"] = len(records)
    if audit["status"] == "searched" and not records:
        audit["status"] = "no_verified_document_found"
    return records, audit, remaining_fetches


def discover_sources(
    matches_payload: dict[str, Any],
    clusters_payload: dict[str, Any],
    *,
    no_network: bool,
    settings: dict[str, int | float] | None = None,
    inbox_records: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    resolved_settings = {**DEFAULT_SETTINGS, **(settings or {})}
    events_by_id = {
        str(item.get("event_id")): item
        for item in clusters_payload.get("clusters", [])
    }
    records_by_id = {
        str(item.get("id")): item
        for item in inbox_records or []
        if isinstance(item, dict) and item.get("id")
    }
    records: list[dict[str, Any]] = []
    audits: list[dict[str, Any]] = []
    remaining_fetches = int(resolved_settings["max_document_fetches"])
    pending_all = [
        item for item in matches_payload.get("events", [])
        if item.get("resolution_status") == "search_required"
    ]
    direct_urls_by_event: dict[str, list[str]] = {}
    for source_match in pending_all:
        event_id = str(source_match.get("event_id") or "")
        event = events_by_id.get(event_id)
        if not event:
            continue
        direct_urls_by_event[event_id] = embedded_official_urls(
            event,
            records_by_id,
            list((source_match.get("official_route") or {}).get("origin_domains") or []),
        )
    pending = [
        item
        for _index, item in sorted(
            enumerate(pending_all),
            key=lambda pair: (
                not bool(direct_urls_by_event.get(str(pair[1].get("event_id") or ""))),
                pair[0],
            ),
        )
    ][: int(resolved_settings["max_events"])]
    for source_match in pending:
        event = events_by_id.get(str(source_match.get("event_id")))
        if not event:
            audits.append({
                "event_id": source_match.get("event_id"),
                "status": "cluster_missing",
                "accepted_record_count": 0,
            })
            continue
        discovered, audit, remaining_fetches = discover_event(
            event,
            source_match,
            resolved_settings,
            no_network=no_network,
            remaining_fetches=remaining_fetches,
            direct_urls=direct_urls_by_event.get(str(source_match.get("event_id") or ""), []),
        )
        records.extend(discovered)
        audits.append(audit)
    return {
        "schema_version": "discovered_official_sources.v1",
        "support_context": {
            "owning_workflow": "economic-impact-report",
            "decision_impact": "Adds only time-matched official documents to event evidence.",
            "readiness_effect": "research_grade" if records else "needs_targeted_fixes",
            "artifact_role": "embedded_support_artifact",
            "hidden_unless_requested": True,
        },
        "network_enabled": not no_network,
        "search_required_event_count": len(pending),
        "discovered_record_count": len(records),
        "fetches_used": int(resolved_settings["max_document_fetches"]) - remaining_fetches,
        "settings": resolved_settings,
        "records": records,
        "event_audit": audits,
    }


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Discover matching official documents for unresolved event clusters."
    )
    parser.add_argument("--date", required=True)
    parser.add_argument("--source-matches-file", required=True)
    parser.add_argument("--clusters-file", required=True)
    parser.add_argument("--inbox-file")
    parser.add_argument("--no-network", action="store_true")
    args = parser.parse_args()
    load_dotenv()

    matches = json.loads(Path(args.source_matches_file).read_text(encoding="utf-8"))
    clusters = json.loads(Path(args.clusters_file).read_text(encoding="utf-8"))
    inbox_records = (
        json.loads(Path(args.inbox_file).read_text(encoding="utf-8"))
        if args.inbox_file else []
    )
    payload = discover_sources(
        matches,
        clusters,
        no_network=args.no_network,
        inbox_records=inbox_records,
    )
    payload["report_date"] = args.date
    payload["generated_at"] = datetime.now(
        ZoneInfo(os.getenv("BRIEF_TIMEZONE", "Asia/Seoul"))
    ).isoformat()

    output_dir = ROOT / "workspace" / "event_evidence" / args.date
    output_dir.mkdir(parents=True, exist_ok=True)
    output = output_dir / "discovered_official_sources.json"
    output.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Official-source discovery saved: {output.relative_to(ROOT)}")
    print(
        "Official discovery:",
        f"events={payload['search_required_event_count']},",
        f"records={payload['discovered_record_count']},",
        f"fetches={payload['fetches_used']}",
    )


if __name__ == "__main__":
    main()
