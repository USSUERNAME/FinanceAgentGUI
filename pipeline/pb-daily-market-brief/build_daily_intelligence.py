"""Build the event-centered, channel-neutral Daily Intelligence contract."""

from __future__ import annotations

import argparse
import json
from copy import deepcopy
from datetime import datetime
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

from collectors.common import ROOT

SCHEMA_VERSION = "daily_market_intelligence.v2"
MAX_EVENTS = 8
MAX_CONTINUITY_ENTRIES = 12
MAX_EARNINGS_COMPANIES = 12


def load_json(path: Path, *, required: bool = True) -> dict[str, Any]:
    if not path.exists():
        if required:
            raise FileNotFoundError(path)
        return {}
    payload = json.loads(path.read_text(encoding="utf-8-sig"))
    if not isinstance(payload, dict):
        raise ValueError(f"Expected a JSON object: {path}")
    return payload


def _dict_rows(value: Any, *, limit: int) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []
    return [
        deepcopy(row)
        for row in value
        if isinstance(row, dict)
    ][:limit]


def _bounded_list(value: Any, *, limit: int) -> list[Any]:
    if not isinstance(value, list):
        return []
    return deepcopy(value[:limit])


def _earnings_section(payload: dict[str, Any] | None) -> dict[str, Any]:
    source = payload or {}
    if source.get("schema_version") != "earnings_intelligence.v1":
        return {
            "status": "not_available",
            "summary": {
                "company_count": 0,
                "confirmed_event_count": 0,
                "estimate_revision_count": 0,
                "guidance_count": 0,
                "verified_result_count": 0,
            },
            "companies": [],
        }
    return {
        "status": source.get("status") or "not_available",
        "summary": deepcopy(source.get("summary") or {}),
        "companies": _dict_rows(
            source.get("companies"),
            limit=MAX_EARNINGS_COMPANIES,
        ),
        "policy": deepcopy(source.get("policy") or {}),
    }


def _event_order(
    clusters: list[dict[str, Any]],
    synthesis: dict[str, Any],
    *,
    limit: int,
) -> list[str]:
    available = {
        str(row.get("event_id") or "")
        for row in clusters
        if row.get("event_id")
    }
    ordered: list[str] = []

    def add(event_id: Any) -> None:
        key = str(event_id or "")
        if key in available and key not in ordered and len(ordered) < limit:
            ordered.append(key)

    for event_id in synthesis.get("selected_event_ids") or []:
        add(event_id)
    rankings = sorted(
        _dict_rows(synthesis.get("event_ranking"), limit=1000),
        key=lambda row: (
            int(row.get("priority_score") or 0),
            int(row.get("impact_priority_score") or 0),
            str(row.get("event_id") or ""),
        ),
        reverse=True,
    )
    for row in rankings:
        add(row.get("event_id"))
    remaining = sorted(
        clusters,
        key=lambda row: (
            int(row.get("article_count") or 0),
            int(row.get("publisher_count") or 0),
            str(row.get("published_to") or ""),
            str(row.get("event_id") or ""),
        ),
        reverse=True,
    )
    for row in remaining:
        add(row.get("event_id"))
    return ordered


def _event_card(
    event_id: str,
    *,
    cluster: dict[str, Any],
    source_match: dict[str, Any],
    structured: dict[str, Any],
    synthesis: dict[str, Any],
    ranking: dict[str, Any],
    cross_source: dict[str, Any] | None = None,
) -> dict[str, Any]:
    cross = cross_source or {}
    matched_sources = _dict_rows(source_match.get("matched_sources"), limit=5)
    origin_sources = [
        row
        for row in matched_sources
        if row.get("source_role") == "origin_primary"
        and row.get("source_grade") == "A"
    ]
    facts = _dict_rows(structured.get("facts"), limit=12)
    extraction_status = str(structured.get("extraction_status") or "not_available")
    primary_fact_confirmed = bool(
        origin_sources
        and facts
        and extraction_status in {"complete", "completed"}
    )
    return {
        "event_id": event_id,
        "event_type": cluster.get("event_type") or structured.get("event_type"),
        "entities": _bounded_list(cluster.get("entities"), limit=12),
        "listed_entities": _bounded_list(
            cluster.get("listed_entities"),
            limit=12,
        ),
        "topic_tags": _bounded_list(cluster.get("topic_tags"), limit=12),
        "title": (
            cluster.get("representative_title")
            or structured.get("representative_title")
            or source_match.get("representative_title")
        ),
        "event_window": {
            "published_from": cluster.get("published_from"),
            "published_to": cluster.get("published_to"),
        },
        "source_summary": {
            "message_count": int(cluster.get("article_count") or 0),
            "publisher_count": int(cluster.get("publisher_count") or 0),
            "source_urls": _bounded_list(cluster.get("source_urls"), limit=10),
            "source_mix": deepcopy(cross.get("source_mix") or {}),
            "cross_source_status": cross.get("cross_source_status"),
        },
        "verification": {
            "cluster_status": cluster.get("verification_status"),
            "resolution_status": source_match.get("resolution_status"),
            "evidence_posture": (
                structured.get("evidence_posture")
                or source_match.get("evidence_posture")
            ),
            "extraction_status": extraction_status,
            "origin_primary_source_available": bool(origin_sources),
            "primary_fact_confirmed": primary_fact_confirmed,
            "publication_eligible_as_fact": primary_fact_confirmed,
        },
        "official_sources": origin_sources,
        "linked_official_context": _dict_rows(
            cross.get("official_sources"),
            limit=5,
        ),
        "attributed_research": _dict_rows(
            cross.get("attributed_research"),
            limit=3,
        ),
        "discovery_sources": _dict_rows(
            cross.get("discovery_sources"),
            limit=12,
        ),
        "common_facts": facts if primary_fact_confirmed else [],
        "reported_claims": _dict_rows(
            structured.get("reported_claims"),
            limit=12,
        ),
        "unique_angles": _dict_rows(
            structured.get("interpretation_candidates"),
            limit=8,
        ),
        "conflicting_claims": _dict_rows(structured.get("conflicts"), limit=8),
        "expectation_gap": deepcopy(structured.get("expectation_gap") or {}),
        "market_reaction": deepcopy(structured.get("market_reaction") or {}),
        "impact_analysis": deepcopy(synthesis),
        "ranking": deepcopy(ranking),
    }


def build_daily_intelligence(
    report_date: str,
    *,
    snapshot: dict[str, Any],
    analysis_payload: dict[str, Any],
    continuity_review: dict[str, Any],
    earnings_intelligence: dict[str, Any] | None = None,
    cross_source_events: dict[str, Any] | None = None,
    generated_at: str | None = None,
    max_events: int = MAX_EVENTS,
) -> dict[str, Any]:
    if max_events < 1 or max_events > MAX_EVENTS:
        raise ValueError(f"max_events must be between 1 and {MAX_EVENTS}")
    if snapshot.get("report_date") not in {None, report_date}:
        raise ValueError("Snapshot report date does not match")
    if analysis_payload.get("report_date") not in {None, report_date}:
        raise ValueError("Analysis report date does not match")

    analysis = analysis_payload.get("analysis") or {}
    clusters_payload = snapshot.get("news_event_clusters") or {}
    source_payload = snapshot.get("event_source_matches") or {}
    structured_payload = snapshot.get("structured_event_evidence") or {}
    synthesis_payload = snapshot.get("event_impact_synthesis") or {}

    clusters = _dict_rows(clusters_payload.get("clusters"), limit=1000)
    clusters_by_id = {
        str(row.get("event_id")): row
        for row in clusters
        if row.get("event_id")
    }
    source_by_id = {
        str(row.get("event_id")): row
        for row in _dict_rows(source_payload.get("events"), limit=1000)
        if row.get("event_id")
    }
    structured_by_id = {
        str(row.get("event_id")): row
        for row in _dict_rows(structured_payload.get("events"), limit=1000)
        if row.get("event_id")
    }
    synthesis_by_id = {
        str(row.get("event_id")): row
        for row in _dict_rows(synthesis_payload.get("events"), limit=1000)
        if row.get("event_id")
    }
    cross_source_by_id = {
        str(row.get("event_id")): row
        for row in _dict_rows(
            (cross_source_events or {}).get("events"),
            limit=1000,
        )
        if row.get("event_id")
    }
    ranking_by_id = {
        str(row.get("event_id")): row
        for row in _dict_rows(synthesis_payload.get("event_ranking"), limit=1000)
        if row.get("event_id")
    }

    event_ids = _event_order(clusters, synthesis_payload, limit=max_events)
    event_cards = [
        _event_card(
            event_id,
            cluster=clusters_by_id[event_id],
            source_match=source_by_id.get(event_id, {}),
            structured=structured_by_id.get(event_id, {}),
            synthesis=synthesis_by_id.get(event_id, {}),
            ranking=ranking_by_id.get(event_id, {}),
            cross_source=cross_source_by_id.get(event_id, {}),
        )
        for event_id in event_ids
    ]
    verified_count = sum(
        bool(row["verification"]["primary_fact_confirmed"])
        for row in event_cards
    )
    review_summary = continuity_review.get("summary") or {}

    packet = {
        "schema_version": SCHEMA_VERSION,
        "report_date": report_date,
        "generated_at": generated_at
        or datetime.now(ZoneInfo("Asia/Seoul")).isoformat(),
        "audience": "research_reader",
        "market": {
            "data_cutoff": deepcopy(snapshot.get("data_cutoff") or {}),
            "regime": deepcopy(analysis.get("market_regime") or {}),
            "key_drivers": _dict_rows(analysis.get("key_drivers"), limit=3),
            "conflicting_signals": _bounded_list(
                analysis.get("conflicting_signals"),
                limit=5,
            ),
            "top_risks": _bounded_list(analysis.get("top_risks"), limit=5),
            "scoreboard": deepcopy(snapshot.get("market_scoreboard") or {}),
            "day_over_day_changes": deepcopy(
                snapshot.get("day_over_day_changes") or {}
            ),
            "korea_transmission_inputs": deepcopy(
                snapshot.get("korea_market") or {}
            ),
        },
        "events": {
            "cluster_count": int(
                clusters_payload.get("cluster_count") or len(clusters)
            ),
            "selected_count": len(event_cards),
            "verified_primary_fact_count": verified_count,
            "synthesis_status": synthesis_payload.get("synthesis_status"),
            "fallback_reason": synthesis_payload.get("fallback_reason"),
            "items": event_cards,
        },
        "continuity": {
            "summary": deepcopy(review_summary),
            "active_entries": _dict_rows(
                continuity_review.get("active_entries"),
                limit=MAX_CONTINUITY_ENTRIES,
            ),
        },
        "earnings": _earnings_section(earnings_intelligence),
        "cross_source_summary": {
            "event_count": int((cross_source_events or {}).get("event_count") or 0),
            "events_with_primary_sources": int(
                (cross_source_events or {}).get("events_with_primary_sources") or 0
            ),
            "events_with_attributed_research": int(
                (cross_source_events or {}).get("events_with_attributed_research") or 0
            ),
            "unmatched_research_context_count": len(
                (cross_source_events or {}).get("unmatched_research_context") or []
            ),
        },
        "source_state": {
            "summary": deepcopy(snapshot.get("source_summary") or {}),
            "quality": deepcopy(snapshot.get("source_quality") or {}),
            "data_warnings": _bounded_list(
                analysis.get("data_warnings"),
                limit=10,
            ),
            "calculation_warnings": _bounded_list(
                snapshot.get("calculation_warnings"),
                limit=10,
            ),
        },
        "policy": {
            "event_centered": True,
            "channel_neutral": True,
            "reader_operations_separated": True,
            "unverified_claims_are_not_facts": True,
            "automatic_memory_mutation": False,
            "automatic_publication": False,
            "position_actions_allowed": False,
        },
    }
    validate_daily_intelligence(packet)
    return packet


def validate_daily_intelligence(packet: dict[str, Any]) -> None:
    if packet.get("schema_version") != SCHEMA_VERSION:
        raise ValueError("Unsupported Daily Intelligence schema")
    if packet.get("audience") != "research_reader":
        raise ValueError("Daily Intelligence must remain a reader artifact")
    events = (packet.get("events") or {}).get("items") or []
    if len(events) > MAX_EVENTS:
        raise ValueError("Daily Intelligence event limit exceeded")
    event_ids = [str(row.get("event_id") or "") for row in events]
    if not all(event_ids) or len(event_ids) != len(set(event_ids)):
        raise ValueError("Daily Intelligence event IDs must be present and unique")
    for event in events:
        verification = event.get("verification") or {}
        if (
            verification.get("publication_eligible_as_fact")
            and not verification.get("primary_fact_confirmed")
        ):
            raise ValueError("Unconfirmed event cannot be eligible as fact")
        if (
            not verification.get("primary_fact_confirmed")
            and event.get("common_facts")
        ):
            raise ValueError("Unconfirmed event cannot expose common facts")
    earnings = packet.get("earnings") or {}
    if len(earnings.get("companies") or []) > MAX_EARNINGS_COMPANIES:
        raise ValueError("Daily Intelligence earnings company limit exceeded")
    for company in earnings.get("companies") or []:
        for row in (company.get("estimate_revision") or {}).get("rows", []):
            if row.get("evidence_label") != "third_party_forward_estimate":
                raise ValueError("Reader estimate row changed evidence posture")
        for row in company.get("guidance") or []:
            if row.get("evidence_label") != "issuer_management_claim":
                raise ValueError("Reader guidance row changed evidence posture")
    policy = packet.get("policy") or {}
    if (
        policy.get("automatic_publication")
        or policy.get("automatic_memory_mutation")
        or policy.get("position_actions_allowed")
    ):
        raise ValueError("Daily Intelligence cannot authorize external actions")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Build the event-centered Daily Intelligence artifact"
    )
    parser.add_argument("--date", required=True)
    parser.add_argument("--max-events", type=int, default=MAX_EVENTS)
    args = parser.parse_args()

    snapshot_path = (
        ROOT / "workspace" / "snapshots" / args.date / "daily_snapshot.json"
    )
    analysis_path = (
        ROOT / "workspace" / "analysis" / args.date / "market_analysis.json"
    )
    continuity_path = (
        ROOT
        / "workspace"
        / "history"
        / "continuity_reviews"
        / f"{args.date}.json"
    )
    earnings_path = (
        ROOT
        / "workspace"
        / "earnings_intelligence"
        / args.date
        / "earnings_intelligence.json"
    )
    cross_source_path = (
        ROOT
        / "workspace"
        / "cross_source_events"
        / args.date
        / "cross_source_events.json"
    )
    packet = build_daily_intelligence(
        args.date,
        snapshot=load_json(snapshot_path),
        analysis_payload=load_json(analysis_path),
        continuity_review=load_json(continuity_path, required=False),
        earnings_intelligence=load_json(earnings_path, required=False),
        cross_source_events=load_json(cross_source_path, required=False),
        max_events=args.max_events,
    )
    output = (
        ROOT
        / "workspace"
        / "intelligence"
        / args.date
        / "daily_intelligence.json"
    )
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(
        json.dumps(packet, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"Daily Intelligence saved: {output.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
