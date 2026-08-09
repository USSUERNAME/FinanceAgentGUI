"""Build bounded event evidence packets with strict body-fetch rights gates."""

from __future__ import annotations

import argparse
import json
import re
from html.parser import HTMLParser
from pathlib import Path
from typing import Any
from urllib.request import Request, urlopen

from candidate_pipeline import domain_for_url, domain_matches, record_rank
from collectors.common import ROOT, load_dotenv, load_source_config


class VisibleTextParser(HTMLParser):
    BLOCKED = {"script", "style", "noscript", "svg", "nav", "footer", "header", "form"}
    ALLOWED = {"h1", "h2", "h3", "p", "li", "blockquote"}

    def __init__(self) -> None:
        super().__init__()
        self.blocked_depth = 0
        self.capture_depth = 0
        self.current: list[str] = []
        self.parts: list[str] = []

    def handle_starttag(self, tag: str, _attrs: list[tuple[str, str | None]]) -> None:
        lowered = tag.lower()
        if lowered in self.BLOCKED:
            self.blocked_depth += 1
        elif not self.blocked_depth and lowered in self.ALLOWED:
            self.capture_depth += 1
            if self.capture_depth == 1:
                self.current = []

    def handle_endtag(self, tag: str) -> None:
        lowered = tag.lower()
        if lowered in self.BLOCKED and self.blocked_depth:
            self.blocked_depth -= 1
        elif not self.blocked_depth and lowered in self.ALLOWED and self.capture_depth:
            self.capture_depth -= 1
            if self.capture_depth == 0:
                text = re.sub(r"\s+", " ", " ".join(self.current)).strip()
                if text and (not self.parts or self.parts[-1] != text):
                    self.parts.append(text)
                self.current = []

    def handle_data(self, data: str) -> None:
        if not self.blocked_depth and self.capture_depth:
            self.current.append(data)


def extract_visible_text(html: str, max_chars: int) -> str:
    parser = VisibleTextParser()
    parser.feed(html)
    return "\n\n".join(parser.parts)[:max_chars]


def fetch_official_text(
    url: str,
    allowed_domains: list[str],
    *,
    max_chars: int = 12000,
    max_bytes: int = 1_000_000,
) -> dict[str, Any]:
    domain = domain_for_url(url)
    if not domain_matches(domain, allowed_domains):
        return {"status": "not_permitted_non_official_domain", "text": None}
    request = Request(url, headers={
        "User-Agent": "PB-Daily-Market-Brief/1.0 (official-source evidence extraction)",
    })
    try:
        with urlopen(request, timeout=30) as response:
            final_url = response.geturl()
            final_domain = domain_for_url(final_url)
            if not domain_matches(final_domain, allowed_domains):
                return {"status": "redirected_outside_official_domain", "text": None}
            content_type = str(response.headers.get("Content-Type") or "").lower()
            if "text/html" not in content_type:
                return {
                    "status": "unsupported_content_type",
                    "content_type": content_type or None,
                    "text": None,
                }
            raw = response.read(max_bytes + 1)
            truncated_bytes = len(raw) > max_bytes
            raw = raw[:max_bytes]
            charset = response.headers.get_content_charset() or "utf-8"
            text = extract_visible_text(raw.decode(charset, errors="replace"), max_chars)
            if not text:
                return {"status": "no_visible_body_text", "text": None}
            return {
                "status": "official_body_extracted",
                "final_url": final_url,
                "content_type": content_type,
                "text": text,
                "text_chars": len(text),
                "byte_limit_reached": truncated_bytes,
            }
    except Exception as exc:
        return {
            "status": "official_body_fetch_failed",
            "error_type": type(exc).__name__,
            "text": None,
        }


def representative_score(record: dict[str, Any]) -> tuple[Any, ...]:
    tier = str(record.get("candidate_filter", {}).get("source_tier") or "general")
    return (
        bool(record.get("primary_source_confirmed")),
        tier == "trusted",
        len(str(record.get("raw_text") or "")),
        record_rank(record),
    )


def select_representatives(
    event: dict[str, Any],
    source_match: dict[str, Any],
    records_by_id: dict[str, dict[str, Any]],
    *,
    limit: int = 2,
) -> list[dict[str, Any]]:
    member_records = [
        records_by_id[record_id]
        for record_id in event.get("record_ids", [])
        if record_id in records_by_id
    ]
    matched_primary_ids = [
        item.get("record_id")
        for item in source_match.get("matched_sources", [])
        if item.get("source_role") == "origin_primary"
    ]
    selected: list[dict[str, Any]] = []
    used_ids: set[str] = set()

    for record_id in matched_primary_ids:
        if record_id in records_by_id and record_id not in used_ids:
            selected.append(records_by_id[record_id])
            used_ids.add(str(record_id))
            break
    for record in sorted(member_records, key=representative_score, reverse=True):
        record_id = str(record.get("id") or "")
        if record_id in used_ids:
            continue
        selected.append(record)
        used_ids.add(record_id)
        if len(selected) >= limit:
            break
    return selected[:limit]


def evidence_record(
    record: dict[str, Any],
    allowed_domains: list[str],
    *,
    fetch_body: bool,
    max_body_chars: int,
) -> dict[str, Any]:
    url = str(record.get("canonical_url") or record.get("url") or "")
    official = (
        bool(record.get("primary_source_confirmed"))
        and str(record.get("source_url_kind") or "") == "primary_source"
        and domain_matches(domain_for_url(url), allowed_domains)
    )
    reusable_body = (
        official
        and str(record.get("evidence_scope") or "") == "official_body_extracted"
        and bool(str(record.get("raw_text") or "").strip())
    )
    if reusable_body:
        text = str(record.get("raw_text") or "")[:max_body_chars]
        extraction = {
            "status": "official_body_extracted",
            "final_url": url,
            "content_type": "text/html; reused=verified_discovery",
            "text": text,
            "text_chars": len(text),
            "byte_limit_reached": False,
            "reused_verified_discovery_body": True,
        }
    elif official and fetch_body:
        extraction = fetch_official_text(url, allowed_domains, max_chars=max_body_chars)
    elif official:
        extraction = {"status": "official_fetch_budget_exhausted", "text": None}
    else:
        extraction = {"status": "not_permitted_metadata_only", "text": None}
    existing_text = str(record.get("raw_text") or "")[:2000]
    return {
        "record_id": record.get("id"),
        "title": record.get("title"),
        "publisher": record.get("publisher"),
        "url": url,
        "published_at": record.get("published_at"),
        "source_grade": record.get("source_grade"),
        "source_role": "origin_primary" if official else "representative_secondary",
        "evidence_label": (
            "fact_source_reported"
            if official and extraction.get("status") == "official_body_extracted"
            else "primary_source_metadata"
            if official
            else "secondary_metadata_unverified"
        ),
        "existing_excerpt": existing_text,
        "body_extraction": extraction,
        "review_status": (
            "requires_structured_fact_review"
            if official
            else "link_and_metadata_only_do_not_treat_as_confirmed_fact"
        ),
    }


def build_evidence_packets(
    clusters: list[dict[str, Any]],
    source_matches: list[dict[str, Any]],
    records: list[dict[str, Any]],
    settings: dict[str, Any],
) -> dict[str, Any]:
    records_by_id = {str(item.get("id") or ""): item for item in records}
    matches_by_event = {str(item.get("event_id") or ""): item for item in source_matches}
    max_events = int(settings.get("max_events", 10))
    max_representatives = int(settings.get("max_representatives_per_event", 2))
    max_official_fetches = int(settings.get("max_official_fetches", 3))
    max_body_chars = int(settings.get("max_official_body_chars", 12000))
    fetches_used = 0
    packets: list[dict[str, Any]] = []
    prioritized_clusters = [
        event
        for _index, event in sorted(
            enumerate(clusters),
            key=lambda pair: (
                matches_by_event.get(
                    str(pair[1].get("event_id") or ""), {}
                ).get("resolution_status") == "origin_primary_matched",
                -pair[0],
            ),
            reverse=True,
        )
    ]

    for event in prioritized_clusters[:max_events]:
        event_id = str(event.get("event_id") or "")
        source_match = matches_by_event.get(event_id, {
            "resolution_status": "search_required",
            "evidence_posture": "missing_required_source",
            "matched_sources": [],
            "search_plan": None,
            "official_route": {"origin_domains": [], "provider_domains": []},
        })
        allowed_domains = list(source_match.get("official_route", {}).get("origin_domains", []))
        representatives = select_representatives(
            event,
            source_match,
            records_by_id,
            limit=max_representatives,
        )
        evidence: list[dict[str, Any]] = []
        for record in representatives:
            reusable_body = (
                bool(record.get("primary_source_confirmed"))
                and str(record.get("evidence_scope") or "") == "official_body_extracted"
                and bool(str(record.get("raw_text") or "").strip())
            )
            eligible_fetch = (
                fetches_used < max_official_fetches
                and not reusable_body
                and bool(record.get("primary_source_confirmed"))
                and domain_matches(
                    domain_for_url(str(record.get("canonical_url") or record.get("url") or "")),
                    allowed_domains,
                )
            )
            row = evidence_record(
                record,
                allowed_domains,
                fetch_body=eligible_fetch,
                max_body_chars=max_body_chars,
            )
            if eligible_fetch:
                fetches_used += 1
            evidence.append(row)
        packets.append({
            "event_id": event_id,
            "event_type": event.get("event_type"),
            "representative_title": event.get("representative_title"),
            "article_count": event.get("article_count"),
            "source_resolution_status": source_match.get("resolution_status"),
            "evidence_posture": source_match.get("evidence_posture"),
            "official_search_plan": source_match.get("search_plan"),
            "representatives": evidence,
        })
    return {
        "schema_version": "event_evidence_packets.v1",
        "support_context": {
            "owning_workflow": "economic-impact-report",
            "decision_impact": "Supplies bounded primary and representative evidence for structured event analysis.",
            "readiness_effect": (
                "needs_targeted_fixes"
                if any(item["evidence_posture"] == "missing_required_source" for item in packets)
                else "research_grade"
            ),
            "artifact_role": "embedded_support_artifact",
            "hidden_unless_requested": True,
        },
        "event_count": len(packets),
        "official_fetches_used": fetches_used,
        "unprocessed_event_count": max(0, len(clusters) - max_events),
        "events": packets,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Prepare bounded event evidence packets.")
    parser.add_argument("--date", required=True)
    parser.add_argument("--inbox-file", required=True)
    parser.add_argument("--clusters-file", required=True)
    parser.add_argument("--source-matches-file", required=True)
    parser.add_argument(
        "--additional-sources-file",
        help="Optional discovered_official_sources.v1 artifact merged into the evidence inbox.",
    )
    parser.add_argument("--no-network", action="store_true")
    args = parser.parse_args()
    load_dotenv()

    records = json.loads(Path(args.inbox_file).read_text(encoding="utf-8"))
    if args.additional_sources_file:
        additional_path = Path(args.additional_sources_file)
        if not additional_path.exists():
            raise SystemExit(f"Additional source file does not exist: {additional_path}")
        additional_payload = json.loads(additional_path.read_text(encoding="utf-8"))
        if additional_payload.get("schema_version") != "discovered_official_sources.v1":
            raise SystemExit("Unsupported additional source schema")
        records.extend(additional_payload.get("records", []))
    clusters_payload = json.loads(Path(args.clusters_file).read_text(encoding="utf-8"))
    matches_payload = json.loads(Path(args.source_matches_file).read_text(encoding="utf-8"))
    settings = dict(load_source_config().get("event_evidence", {}))
    if args.no_network:
        settings["max_official_fetches"] = 0
    payload = build_evidence_packets(
        clusters_payload.get("clusters", []),
        matches_payload.get("events", []),
        records,
        settings,
    )
    payload["report_date"] = args.date

    output_dir = ROOT / "workspace" / "event_evidence" / args.date
    output_dir.mkdir(parents=True, exist_ok=True)
    output = output_dir / "event_evidence_packets.json"
    output.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Event evidence packets saved: {output.relative_to(ROOT)}")
    print(
        f"Evidence events={payload['event_count']}, "
        f"official_fetches={payload['official_fetches_used']}, "
        f"unprocessed={payload['unprocessed_event_count']}"
    )


if __name__ == "__main__":
    main()
