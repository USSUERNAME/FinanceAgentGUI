"""Refresh Telegram discovery intelligence without running the full daily brief."""

from __future__ import annotations

import json
import os
import re
import sys
from datetime import datetime
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

from candidate_pipeline import deduplicate_candidate_records, filter_candidate_records
from collectors import telegram_channels
from collectors.common import ROOT, load_dotenv, load_source_config
from sector_classifier import classify_records
from sector_master import load_sector_master
from triage_news_candidates import build_event_clusters, triage_record

SCHEMA_VERSION = "telegram_intelligence_refresh.v1"
OUTPUT_ROOT = ROOT / "workspace" / "telegram_refresh"
MEANINGFUL_TEXT = re.compile(r"[A-Za-z가-힣0-9]")
TIMESTAMP_ONLY = re.compile(
    r"^\s*(?:\d{4}[./-]\d{1,2}[./-]\d{1,2})?"
    r"\s*\d{1,2}:\d{2}(?::\d{2})?\s*$"
)


def clean_text(value: Any, limit: int = 1000) -> str:
    return " ".join(str(value or "").split())[:limit]


def refresh_title(record: dict[str, Any]) -> str:
    candidates = [
        *str(record.get("raw_text") or "").splitlines(),
        str(record.get("title") or ""),
    ]
    for candidate in candidates:
        value = clean_text(candidate.strip(" #*-•\t"), 240)
        meaningful_count = len(MEANINGFUL_TEXT.findall(value))
        if meaningful_count >= 3 and not TIMESTAMP_ONLY.fullmatch(value):
            return value
    return ""


def clean_refresh_triage(record: dict[str, Any]) -> dict[str, Any]:
    triage = record.get("triage", {})
    event_type = clean_text(triage.get("event_type"), 80)
    triage["topic_tags"] = [
        topic
        for topic in triage.get("topic_tags", [])
        if (
            clean_text(topic, 100) not in {
                event_type,
                "telegram",
                "market",
                "market_commentary",
                "broker_research",
                "official_disclosure_relay",
                "breaking_news",
            }
            and not clean_text(topic, 100).startswith("telegram_priority_")
        )
    ]
    return record


def gui_cluster(
    cluster: dict[str, Any],
    records_by_id: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    members = [
        records_by_id[record_id]
        for record_id in cluster.get("record_ids", [])
        if record_id in records_by_id
    ]
    duplicate_lineage = [
        lineage
        for item in members
        for lineage in item.get("deduplication", {}).get("duplicate_lineage", [])
        if isinstance(lineage, dict)
    ]
    channels = sorted({
        clean_text(
            item.get("telegram", {}).get("channel_name")
            or item.get("telegram", {}).get("channel_username")
            or item.get("publisher"),
            160,
        )
        for item in members
        if (
            item.get("telegram", {}).get("channel_name")
            or item.get("telegram", {}).get("channel_username")
            or item.get("publisher")
        )
    } | {
        clean_text(item.get("publisher") or item.get("source_id"), 160)
        for item in duplicate_lineage
        if item.get("publisher") or item.get("source_id")
    })
    post_urls = [
        str(item.get("url") or "")
        for item in members
        if str(item.get("url") or "").startswith("https://t.me/")
    ] + [
        str(item.get("url") or "")
        for item in duplicate_lineage
        if str(item.get("url") or "").startswith("https://t.me/")
    ]
    source_post_count = sum(
        1 + int(item.get("deduplication", {}).get("duplicate_count") or 0)
        for item in members
    )
    return {
        "event_id": clean_text(cluster.get("event_id"), 160),
        "title": clean_text(cluster.get("representative_title"), 240),
        "event_type": clean_text(cluster.get("event_type"), 80),
        "verification_status": clean_text(cluster.get("verification_status"), 80),
        "latest_published_at": clean_text(cluster.get("published_to"), 80),
        "post_count": source_post_count,
        "channels": channels[:8],
        "post_urls": list(dict.fromkeys(post_urls))[:4],
    }


def build_refresh_payload(
    rows: list[dict[str, Any]],
    *,
    generated_at: datetime,
    notice: str | None,
    settings: dict[str, Any],
    sector_master: dict[str, Any],
) -> dict[str, Any]:
    pdf_attachments = []
    attachment_candidates: dict[str, dict[str, Any]] = {}
    seen_attachment_keys: set[str] = set()
    for row in rows:
        telegram = row.get("telegram") or {}
        for attachment in telegram.get("attachments") or []:
            key = clean_text(attachment.get("attachment_key"), 128)
            if not key or key in seen_attachment_keys or attachment.get("is_pdf") is not True:
                continue
            seen_attachment_keys.add(key)
            candidate = {
                "attachment_key": key,
                "filename": clean_text(attachment.get("filename"), 500),
                "mime_type": clean_text(attachment.get("mime_type"), 120),
                "size": max(0, int(attachment.get("size") or 0)),
                "channel_username": clean_text(
                    attachment.get("channel_username")
                    or telegram.get("channel_username"),
                    80,
                ),
                "channel_name": clean_text(
                    attachment.get("channel_name")
                    or telegram.get("channel_name"),
                    160,
                ),
                "message_id": int(
                    attachment.get("message_id")
                    or telegram.get("message_id")
                    or 0
                ),
                "post_url": clean_text(attachment.get("post_url") or row.get("url"), 500),
                "published_at": clean_text(row.get("published_at"), 80),
                "title": clean_text(row.get("title"), 240),
                "duplicate_source_count": 0,
                "source_posts": [
                    clean_text(attachment.get("post_url") or row.get("url"), 500)
                ],
            }
            filename = str(candidate["filename"]).casefold()
            size = int(candidate["size"])
            signature = f"{filename}:{size}" if filename and size else key
            existing = attachment_candidates.get(signature)
            if existing:
                existing["duplicate_source_count"] += 1
                post_url = str(candidate["post_url"])
                if post_url and post_url not in existing["source_posts"]:
                    existing["source_posts"].append(post_url)
                continue
            attachment_candidates[signature] = candidate
            pdf_attachments.append(candidate)
    deduplicated, duplicate_count = deduplicate_candidate_records(rows, settings)
    filtered, filter_summary = filter_candidate_records(
        deduplicated,
        settings,
        now=generated_at,
    )
    classified = classify_records(filtered, sector_master)
    triaged = []
    for item in classified:
        title = refresh_title(item)
        if not title:
            continue
        item["title"] = title
        resolved = triage_record(item)
        triage = resolved.get("triage", {})
        if triage.get("decision") == "needs_more_text":
            triage["decision"] = "keep"
            triage["confidence"] = min(float(triage.get("confidence") or 0.5), 0.58)
            triage["reason_codes"] = [
                *list(triage.get("reason_codes") or []),
                "telegram_discovery_refresh_retained",
            ]
        triaged.append(clean_refresh_triage(resolved))
    clusters = build_event_clusters(triaged, settings)
    records_by_id = {
        str(item.get("id") or ""): item
        for item in triaged
        if str(item.get("id") or "")
    }
    return {
        "schema_version": SCHEMA_VERSION,
        "generated_at": generated_at.isoformat(),
        "status": "partial" if notice and rows else "ok" if rows else "empty",
        "notice_category": "channel_partial_failure" if notice else None,
        "raw_post_count": len(rows),
        "deduplicated_post_count": len(deduplicated),
        "duplicate_post_count": duplicate_count,
        "filtered_post_count": len(filtered),
        "event_cluster_count": len(clusters),
        "represented_channel_count": len({
            clean_text(
                item.get("telegram", {}).get("channel_username")
                or item.get("publisher"),
                160,
            )
            for item in triaged
            if (
                item.get("telegram", {}).get("channel_username")
                or item.get("publisher")
            )
        }),
        "pdf_attachment_count": len(pdf_attachments),
        "pdf_attachments": pdf_attachments[:100],
        "candidate_filter": filter_summary,
        "clusters": [
            gui_cluster(cluster, records_by_id)
            for cluster in clusters[:20]
        ],
    }


def write_payload(payload: dict[str, Any], output_root: Path = OUTPUT_ROOT) -> Path:
    report_date = str(payload["generated_at"])[:10]
    output_dir = output_root / report_date
    output_dir.mkdir(parents=True, exist_ok=True)
    output_path = output_dir / "telegram_intelligence.json"
    temporary_path = output_path.with_suffix(".json.tmp")
    temporary_path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    temporary_path.replace(output_path)
    return output_path


def main() -> None:
    print(f"Python runtime: {sys.executable}", flush=True)
    load_dotenv()
    timezone = ZoneInfo(os.getenv("BRIEF_TIMEZONE", "Asia/Seoul"))
    generated_at = datetime.now(timezone)
    settings = load_source_config().get("candidate_pipeline", {})
    rows, notice = telegram_channels.collect({})
    telegram_rows = [
        row
        for row in rows
        if row.get("source_type") == "telegram_commentary"
    ]
    payload = build_refresh_payload(
        telegram_rows,
        generated_at=generated_at,
        notice=notice,
        settings=settings,
        sector_master=load_sector_master(),
    )
    output_path = write_payload(payload)
    print(
        "Telegram refresh complete: "
        f"raw={payload['raw_post_count']}, "
        f"deduplicated={payload['deduplicated_post_count']}, "
        f"clusters={payload['event_cluster_count']}",
        flush=True,
    )
    print(f"Saved: {output_path.relative_to(ROOT)}", flush=True)
    if notice:
        print(f"Collector notice: {clean_text(notice, 1000)}", flush=True)


if __name__ == "__main__":
    main()
