"""Combine news, Telegram, broker research, and primary records by event.

The event layer keeps evidence roles separate:

* primary records may support facts;
* broker research is attributed analysis only;
* RSS/news/Telegram records remain discovery or secondary context.

Raw broker-report text is never copied into the output.
"""

from __future__ import annotations

import argparse
import json
import re
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from candidate_pipeline import parse_timestamp
from collectors.common import ROOT

PRIMARY_SOURCE_TYPES = {
    "filing",
    "official_release",
    "official_release_metadata",
    "disclosure",
    "economic_release",
}
DISCOVERY_SOURCE_TYPES = {
    "international_news",
    "market_news",
    "news_discovery",
    "telegram_commentary",
    "market_commentary",
    "institutional_research_metadata",
    "policy_signal",
}
BROAD_REPORT_TYPES = {"macro", "strategy", "other"}
GENERIC_EVENT_TITLE_MARKERS = {
    "briefing", "daily news", "news digest", "market wrap",
    "브리핑", "데일리 뉴스", "뉴스 다이제스트", "시장 요약",
}
GENERIC_TOKENS = {
    "market", "markets", "daily", "weekly", "report", "research", "update",
    "outlook", "analysis", "stock", "stocks", "미국", "한국", "시장", "주식",
    "리포트", "리서치", "데일리", "위클리", "전망", "분석", "업종", "전체시장",
}


def load_json(path: Path, *, required: bool = True) -> Any:
    if not path.exists():
        if required:
            raise FileNotFoundError(path)
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


def normalized_tokens(*values: Any) -> set[str]:
    tokens: set[str] = set()
    for value in values:
        if isinstance(value, list):
            tokens.update(normalized_tokens(*value))
            continue
        text = str(value or "").casefold()
        for token in re.findall(r"[a-z0-9가-힣][a-z0-9가-힣._+-]{1,39}", text):
            cleaned = token.strip("._+-")
            if cleaned and cleaned not in GENERIC_TOKENS and not cleaned.isdigit():
                tokens.add(cleaned)
    return tokens


def record_tickers(record: dict[str, Any]) -> set[str]:
    return {str(item).upper() for item in record.get("tickers", []) if str(item).strip()}


def record_tokens(record: dict[str, Any]) -> set[str]:
    triage = record.get("triage") or {}
    return normalized_tokens(
        record.get("title"),
        record.get("tags") or [],
        record.get("tickers") or [],
        triage.get("entities") or [],
        triage.get("topic_tags") or [],
    )


def cluster_context(
    cluster: dict[str, Any],
    records_by_id: dict[str, dict[str, Any]],
) -> tuple[set[str], set[str]]:
    members = [
        records_by_id[record_id]
        for record_id in cluster.get("record_ids", [])
        if record_id in records_by_id
    ]
    tickers = set().union(*(record_tickers(item) for item in members)) if members else set()
    tokens = normalized_tokens(
        cluster.get("representative_title"),
        cluster.get("entities") or [],
        cluster.get("topic_tags") or [],
    )
    for item in members:
        tokens.update(record_tokens(item))
    return tickers, tokens


def source_role(record: dict[str, Any]) -> str:
    source_type = str(record.get("source_type") or "")
    if record.get("primary_source_confirmed") is True:
        return "primary_fact"
    if source_type == "telegram_commentary":
        return "telegram_viewpoint"
    if source_type == "institutional_research_metadata":
        return "institutional_metadata"
    if source_type in DISCOVERY_SOURCE_TYPES:
        return "discovery_or_secondary"
    return "other"


def within_days(cluster: dict[str, Any], record: dict[str, Any], days: int) -> bool:
    cluster_time = parse_timestamp(cluster.get("published_to") or cluster.get("published_from"))
    record_time = parse_timestamp(record.get("published_at"))
    if not cluster_time or not record_time:
        return False
    return abs((cluster_time - record_time).total_seconds()) <= days * 86_400


def official_match_score(
    cluster: dict[str, Any],
    record: dict[str, Any],
    records_by_id: dict[str, dict[str, Any]],
) -> int:
    if record.get("primary_source_confirmed") is not True:
        return 0
    if str(record.get("source_type") or "") not in PRIMARY_SOURCE_TYPES:
        return 0
    if not within_days(cluster, record, 7):
        return 0
    tickers, tokens = cluster_context(cluster, records_by_id)
    ticker_overlap = tickers & record_tickers(record)
    token_overlap = tokens & record_tokens(record)
    if ticker_overlap:
        return 100 + len(token_overlap)
    if len(token_overlap) >= 3:
        return 30 + len(token_overlap)
    return 0


def research_match_score(
    cluster: dict[str, Any],
    analysis: dict[str, Any],
    records_by_id: dict[str, dict[str, Any]],
) -> int:
    tickers, tokens = cluster_context(cluster, records_by_id)
    report_tickers = {
        str(item).upper() for item in analysis.get("tickers", []) if str(item).strip()
    }
    report_tokens = normalized_tokens(
        analysis.get("summary"),
        analysis.get("key_claims") or [],
        analysis.get("sectors") or [],
        analysis.get("tickers") or [],
    )
    ticker_overlap = tickers & report_tickers
    token_overlap = tokens & report_tokens
    entity_overlap = (
        normalized_tokens(cluster.get("entities") or []) & report_tokens
    )
    sector_topic_overlap = (
        normalized_tokens(cluster.get("topic_tags") or [])
        & normalized_tokens(analysis.get("sectors") or [])
    )
    report_type = str(analysis.get("report_type") or "other")
    if ticker_overlap and token_overlap:
        return 100 + len(ticker_overlap) * 10 + min(len(token_overlap), 9)
    representative_title = str(cluster.get("representative_title") or "").casefold()
    if any(marker in representative_title for marker in GENERIC_EVENT_TITLE_MARKERS):
        return 0
    if report_type not in BROAD_REPORT_TYPES and sector_topic_overlap and len(token_overlap) >= 3:
        return 60 + len(sector_topic_overlap) * 5 + min(len(token_overlap), 9)
    if report_type not in BROAD_REPORT_TYPES and entity_overlap and len(token_overlap) >= 3:
        return 50 + len(entity_overlap) * 5 + min(len(token_overlap), 9)
    if report_type not in BROAD_REPORT_TYPES and len(token_overlap) >= 7:
        return 30 + min(len(token_overlap), 9)
    if report_type in BROAD_REPORT_TYPES and cluster.get("event_type") != "other":
        if entity_overlap and len(token_overlap) >= 6:
            return 20 + len(entity_overlap) * 5 + min(len(token_overlap), 9)
    return 0


def compact_discovery(record: dict[str, Any]) -> dict[str, Any]:
    return {
        "record_id": record.get("id"),
        "source_type": record.get("source_type"),
        "publisher": record.get("publisher") or record.get("source_id"),
        "title": record.get("title"),
        "url": record.get("canonical_url") or record.get("url") or None,
        "role": source_role(record),
    }


def compact_official(record: dict[str, Any]) -> dict[str, Any]:
    return {
        "record_id": record.get("id"),
        "source_type": record.get("source_type"),
        "publisher": record.get("publisher") or record.get("source_id"),
        "title": record.get("title"),
        "url": record.get("canonical_url") or record.get("url") or None,
        "tickers": sorted(record_tickers(record)),
        "evidence_scope": record.get("evidence_scope"),
        "primary_source_confirmed": True,
    }


def compact_research(
    analysis: dict[str, Any],
    source_record: dict[str, Any] | None,
) -> dict[str, Any]:
    return {
        "report_id": analysis.get("report_id"),
        "publisher": (
            (source_record or {}).get("publisher")
            or (source_record or {}).get("source_id")
            or "unknown"
        ),
        "analyst": analysis.get("analyst") or None,
        "report_type": analysis.get("report_type"),
        "stance": analysis.get("stance"),
        "summary": analysis.get("summary"),
        "key_claims": list(analysis.get("key_claims") or [])[:3],
        "tickers": list(analysis.get("tickers") or []),
        "sectors": list(analysis.get("sectors") or []),
        "monitoring_conditions": list(
            analysis.get("monitoring_conditions") or []
        )[:3],
        "source_reference": (source_record or {}).get("source_reference"),
        "evidence_role": "attributed_analysis_only",
        "redistribution_allowed": False,
    }


def build_cross_source_events(
    *,
    report_date: str,
    records: list[dict[str, Any]],
    clusters_payload: dict[str, Any],
    broker_analysis_payload: dict[str, Any] | None = None,
    generated_at: str | None = None,
) -> dict[str, Any]:
    records_by_id = {
        str(item.get("id")): item for item in records if item.get("id")
    }
    report_records = {
        str(item.get("id")): item
        for item in records
        if item.get("source_type") == "broker_report" and item.get("id")
    }
    analyses = list((broker_analysis_payload or {}).get("reports") or [])
    official_records = [
        item for item in records
        if item.get("primary_source_confirmed") is True
        and str(item.get("source_type") or "") in PRIMARY_SOURCE_TYPES
    ]
    events: list[dict[str, Any]] = []
    matched_reports: set[str] = set()
    matched_official: set[str] = set()
    clusters = list(clusters_payload.get("clusters") or [])

    official_assignments: dict[str, list[dict[str, Any]]] = {}
    for item in official_records:
        ranked = sorted(
            (
                (official_match_score(cluster, item, records_by_id), cluster)
                for cluster in clusters
            ),
            key=lambda pair: (pair[0], str(pair[1].get("event_id") or "")),
            reverse=True,
        )
        if ranked and ranked[0][0] > 0:
            event_id = str(ranked[0][1].get("event_id") or "")
            official_assignments.setdefault(event_id, []).append(item)

    research_assignments: dict[str, list[dict[str, Any]]] = {}
    for item in analyses:
        ranked = sorted(
            (
                (research_match_score(cluster, item, records_by_id), cluster)
                for cluster in clusters
            ),
            key=lambda pair: (pair[0], str(pair[1].get("event_id") or "")),
            reverse=True,
        )
        if ranked and ranked[0][0] > 0:
            event_id = str(ranked[0][1].get("event_id") or "")
            research_assignments.setdefault(event_id, []).append(item)

    for cluster in clusters:
        member_records = [
            records_by_id[record_id]
            for record_id in cluster.get("record_ids", [])
            if record_id in records_by_id
        ]
        discovery = [
            compact_discovery(item)
            for item in member_records
            if source_role(item) != "primary_fact"
        ]
        event_id = str(cluster.get("event_id") or "")
        official_ranked = sorted(
            official_assignments.get(event_id, []),
            key=lambda item: str(item.get("id") or ""),
        )
        official = []
        for item in official_ranked:
            official.append(compact_official(item))
            matched_official.add(str(item.get("id")))
            if len(official) >= 3:
                break

        research_ranked = sorted(
            research_assignments.get(event_id, []),
            key=lambda item: str(item.get("report_id") or ""),
        )
        research = []
        for item in research_ranked:
            report_id = str(item.get("report_id") or "")
            research.append(compact_research(item, report_records.get(report_id)))
            matched_reports.add(report_id)
            if len(research) >= 3:
                break

        source_types = Counter(
            str(item.get("source_type") or "unknown") for item in member_records
        )
        source_types.update({"official_primary": len(official)})
        source_types.update({"broker_research": len(research)})
        has_primary = bool(official) or any(
            item.get("primary_source_confirmed") is True for item in member_records
        )
        events.append({
            **cluster,
            "source_mix": {
                key: value for key, value in sorted(source_types.items()) if value
            },
            "official_sources": official,
            "attributed_research": research,
            "discovery_sources": discovery,
            "cross_source_status": (
                "primary_verified_with_context"
                if has_primary and (research or discovery)
                else "primary_verified"
                if has_primary
                else "multi_source_unverified"
                if len(source_types) > 1
                else "single_source_unverified"
            ),
            "publication_rule": (
                "Facts require official_sources or an existing primary-confirmed member. "
                "Broker research remains attributed analysis; Telegram/RSS remains discovery."
            ),
        })

    unmatched_research = [
        compact_research(item, report_records.get(str(item.get("report_id") or "")))
        for item in analyses
        if str(item.get("report_id") or "") not in matched_reports
    ]
    unmatched_official = [
        compact_official(item)
        for item in official_records
        if str(item.get("id") or "") not in matched_official
    ]
    return {
        "schema_version": "cross_source_events.v1",
        "report_date": report_date,
        "generated_at": generated_at or datetime.now(timezone.utc).isoformat(),
        "event_count": len(events),
        "events_with_primary_sources": sum(
            bool(item.get("official_sources"))
            or item.get("verification_status") == "primary_source_available"
            for item in events
        ),
        "events_with_attributed_research": sum(
            bool(item.get("attributed_research")) for item in events
        ),
        "events": events,
        "unmatched_research_context": unmatched_research,
        "unmatched_official_sources": unmatched_official,
        "policy": {
            "primary_sources_support_facts": True,
            "broker_research_is_attributed_analysis": True,
            "telegram_and_rss_are_discovery": True,
            "raw_broker_text_included": False,
        },
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Build cross-source event intelligence.")
    parser.add_argument("--date", required=True)
    parser.add_argument("--inbox-file", required=True)
    parser.add_argument("--clusters-file", required=True)
    parser.add_argument("--analysis-file", required=True)
    parser.add_argument("--output-file", default="")
    args = parser.parse_args()

    output_path = (
        Path(args.output_file)
        if args.output_file
        else ROOT / "workspace" / "cross_source_events" / args.date / "cross_source_events.json"
    )
    if not output_path.is_absolute():
        output_path = ROOT / output_path
    payload = build_cross_source_events(
        report_date=args.date,
        records=load_json(ROOT / args.inbox_file),
        clusters_payload=load_json(ROOT / args.clusters_file),
        broker_analysis_payload=load_json(ROOT / args.analysis_file, required=False),
    )
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Cross-source events saved: {output_path.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
