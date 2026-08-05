"""Resolve event clusters against available official-source records.

This stage never invents a primary URL.  It either links an already collected,
eligible official record or emits a bounded search plan using registry-owned
official domains and landing pages.
"""

from __future__ import annotations

import argparse
import json
import os
import re
from datetime import datetime
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

from candidate_pipeline import domain_for_url, domain_matches, parse_timestamp
from collectors.common import ROOT, load_dotenv

REGISTRY_PATH = ROOT / "official_source_registry.json"
GENERIC_MATCH_TERMS = {
    "and", "company", "filed", "for", "from", "global", "into", "key",
    "level", "market", "markets", "news", "report", "risk", "shares",
    "stock", "stocks", "that", "the", "this", "trading", "update", "with",
}


def load_registry(path: Path = REGISTRY_PATH) -> dict[str, Any]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if payload.get("schema_version") != "official_source_registry.v1":
        raise ValueError("Unsupported official source registry schema")
    routes = payload.get("routes")
    if not isinstance(routes, dict) or "other" not in routes:
        raise ValueError("Official source registry requires routes and an other fallback")
    for event_type, route in routes.items():
        for field in ("origin_domains", "provider_domains", "preferred_source_ids", "landing_pages"):
            if not isinstance(route.get(field), list):
                raise ValueError(f"{event_type}.{field} must be a list")
    return payload


def route_for_event(registry: dict[str, Any], event_type: str) -> dict[str, Any]:
    return registry["routes"].get(event_type, registry["routes"]["other"])


def normalized_terms(values: list[Any]) -> set[str]:
    terms: set[str] = set()
    for value in values:
        terms.update(
            token
            for token in re.findall(r"[0-9a-z가-힣.-]+", str(value).casefold())
            if len(token) >= 3
        )
    return terms


def event_terms(event: dict[str, Any]) -> set[str]:
    return normalized_terms([
        event.get("representative_title", ""),
        *event.get("entities", []),
        *event.get("topic_tags", []),
    ])


def record_terms(record: dict[str, Any]) -> set[str]:
    return normalized_terms([
        record.get("title", ""),
        record.get("raw_text", ""),
        *record.get("tickers", []),
        *record.get("tags", []),
    ])


def source_role(record: dict[str, Any], route: dict[str, Any]) -> str | None:
    url = str(record.get("canonical_url") or record.get("url") or "")
    domain = domain_for_url(url)
    source_id = str(record.get("source_id") or "")
    if (
        bool(record.get("primary_source_confirmed"))
        and domain_matches(domain, list(route["origin_domains"]))
    ):
        return "origin_primary"
    if domain_matches(domain, list(route["provider_domains"])) or source_id in route["preferred_source_ids"]:
        if str(record.get("source_grade") or "") == "A":
            return "official_provider"
    return None


def publication_window_matches(record: dict[str, Any], event: dict[str, Any], max_hours: float = 72) -> bool:
    record_time = parse_timestamp(record.get("published_at"))
    event_time = parse_timestamp(event.get("published_from") or event.get("published_to"))
    if not record_time or not event_time:
        return True
    return abs((record_time - event_time).total_seconds()) <= max_hours * 3600


def match_score(
    record: dict[str, Any],
    event: dict[str, Any],
    route: dict[str, Any],
) -> tuple[int, list[str], str | None]:
    role = source_role(record, route)
    if not role:
        return 0, [], None
    reasons: list[str] = []
    score = 0
    if role == "origin_primary":
        score += 60
        reasons.append("origin_domain_and_primary_confirmation")
    else:
        score += 30
        reasons.append("official_provider_record")
    if record.get("id") in set(event.get("record_ids", [])):
        score += 30
        reasons.append("event_cluster_member")
    elif not publication_window_matches(record, event):
        return 0, [], None
    else:
        reasons.append("publication_window_match")
    record_term_set = record_terms(record)
    overlap = event_terms(event) & record_term_set
    meaningful_overlap = overlap - GENERIC_MATCH_TERMS
    entity_overlap = normalized_terms(event.get("entities", [])) & record_term_set
    if (
        "event_cluster_member" not in reasons
        and not entity_overlap
        and len(meaningful_overlap) < 3
    ):
        return 0, [], None
    if overlap:
        score += min(len(overlap), 5) * 6
        reasons.append("event_term_overlap")
    if entity_overlap:
        score += min(len(entity_overlap), 3) * 8
        reasons.append("event_entity_overlap")
    source_id = str(record.get("source_id") or "")
    if source_id in route["preferred_source_ids"]:
        score += 10
        reasons.append("preferred_source_adapter")
    return score, reasons, role


def search_plan(event: dict[str, Any], route: dict[str, Any]) -> dict[str, Any]:
    query_terms = sorted(event_terms(event))[:12]
    return {
        "status": "search_required",
        "official_domains": list(route["origin_domains"]),
        "official_landing_pages": list(route["landing_pages"]),
        "query_terms": query_terms,
        "required_match": [
            "event_entity_or_topic",
            "publication_time_window",
            "official_domain",
        ],
        "note": "Landing pages are discovery routes, not evidence for the event until a matching primary document is found.",
    }


def resolve_event(
    event: dict[str, Any],
    records: list[dict[str, Any]],
    registry: dict[str, Any],
) -> dict[str, Any]:
    event_type = str(event.get("event_type") or "other")
    route = route_for_event(registry, event_type)
    matches: list[dict[str, Any]] = []
    for record in records:
        score, reasons, role = match_score(record, event, route)
        if not score:
            continue
        matches.append({
            "record_id": record.get("id"),
            "source_id": record.get("source_id"),
            "title": record.get("title"),
            "url": record.get("canonical_url") or record.get("url"),
            "published_at": record.get("published_at"),
            "source_role": role,
            "source_grade": record.get("source_grade"),
            "match_score": score,
            "match_reasons": reasons,
        })
    matches.sort(
        key=lambda item: (
            item["source_role"] == "origin_primary",
            item["match_score"],
            str(item.get("published_at") or ""),
        ),
        reverse=True,
    )
    origin_matches = [item for item in matches if item["source_role"] == "origin_primary"]
    provider_matches = [item for item in matches if item["source_role"] == "official_provider"]
    if origin_matches:
        status = "origin_primary_matched"
        posture = "research_grade_primary_available"
    elif provider_matches:
        status = "official_provider_only"
        posture = "preliminary_origin_source_required"
    else:
        status = "search_required"
        posture = "missing_required_source"
    return {
        "event_id": event.get("event_id"),
        "event_type": event_type,
        "representative_title": event.get("representative_title"),
        "resolution_status": status,
        "evidence_posture": posture,
        "matched_sources": matches[:5],
        "search_plan": search_plan(event, route) if not origin_matches else None,
        "official_route": {
            "origin_domains": list(route["origin_domains"]),
            "provider_domains": list(route["provider_domains"]),
        },
    }


def resolve_events(
    clusters: list[dict[str, Any]],
    records: list[dict[str, Any]],
    registry: dict[str, Any],
) -> dict[str, Any]:
    resolved = [resolve_event(event, records, registry) for event in clusters]
    counts: dict[str, int] = {}
    for item in resolved:
        status = item["resolution_status"]
        counts[status] = counts.get(status, 0) + 1
    readiness = "needs_targeted_fixes" if counts.get("search_required") else "research_grade"
    return {
        "schema_version": "event_source_matches.v1",
        "support_context": {
            "owning_workflow": "economic-impact-report",
            "decision_impact": "Controls whether event claims can enter the equity brief as sourced facts.",
            "readiness_effect": readiness,
            "artifact_role": "embedded_support_artifact",
            "hidden_unless_requested": True,
        },
        "event_count": len(resolved),
        "resolution_counts": counts,
        "events": resolved,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Resolve event clusters against collected official-source records.")
    parser.add_argument("--date", required=True)
    parser.add_argument("--inbox-file", required=True)
    parser.add_argument("--clusters-file", required=True)
    parser.add_argument(
        "--additional-sources-file",
        help="Optional discovered_official_sources.v1 artifact whose records are merged into the inbox.",
    )
    args = parser.parse_args()
    load_dotenv()

    inbox_path = Path(args.inbox_file)
    clusters_path = Path(args.clusters_file)
    if not inbox_path.exists() or not clusters_path.exists():
        raise SystemExit("Triaged inbox and event cluster files are required.")
    records = json.loads(inbox_path.read_text(encoding="utf-8"))
    if args.additional_sources_file:
        additional_path = Path(args.additional_sources_file)
        if not additional_path.exists():
            raise SystemExit(f"Additional source file does not exist: {additional_path}")
        additional_payload = json.loads(additional_path.read_text(encoding="utf-8"))
        if additional_payload.get("schema_version") != "discovered_official_sources.v1":
            raise SystemExit("Unsupported additional source schema")
        records.extend(additional_payload.get("records", []))
    clusters_payload = json.loads(clusters_path.read_text(encoding="utf-8"))
    payload = resolve_events(clusters_payload.get("clusters", []), records, load_registry())
    payload["report_date"] = args.date
    payload["generated_at"] = datetime.now(
        ZoneInfo(os.getenv("BRIEF_TIMEZONE", "Asia/Seoul"))
    ).isoformat()

    output_dir = ROOT / "workspace" / "event_evidence" / args.date
    output_dir.mkdir(parents=True, exist_ok=True)
    output = output_dir / "event_source_matches.json"
    output.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Event source matches saved: {output.relative_to(ROOT)}")
    print("Source resolution:", ", ".join(f"{key}={value}" for key, value in sorted(payload["resolution_counts"].items())))


if __name__ == "__main__":
    main()
