"""Deterministic stages shared by news-candidate collectors.

This module owns stages 2 and 3 of the event-news pipeline:

* collapse document duplicates by canonical URL or near-identical title/time;
* apply source, freshness, and keyword rules before any model is called.

The filter is deliberately conservative.  A general-source item without a
keyword match is retained for the later local-model triage stage instead of
being silently discarded.
"""

from __future__ import annotations

import re
from datetime import datetime, timezone
from difflib import SequenceMatcher
from email.utils import parsedate_to_datetime
from typing import Any
from urllib.parse import urlsplit

from collectors.common import canonicalize_url

CANDIDATE_SOURCE_TYPES = {
    "international_news",
    "market_news",
    "news_discovery",
    "telegram_commentary",
    "official_release",
    "official_release_metadata",
    "market_commentary",
    "institutional_research_metadata",
    "policy_signal",
}
DEFAULT_SETTINGS: dict[str, Any] = {
    "max_age_hours": 96,
    "title_similarity_threshold": 0.92,
    "title_time_window_hours": 36,
    "primary_domains": [],
    "trusted_domains": [],
    "blocked_domains": [],
    "include_keywords": [],
    "hard_exclude_keywords": [],
}
GRADE_PRIORITY = {"A": 5, "B": 4, "C": 3, "D": 2, "INTERNAL": 1}


def merged_settings(settings: dict[str, Any] | None) -> dict[str, Any]:
    return {**DEFAULT_SETTINGS, **(settings or {})}


def parse_timestamp(value: str | None) -> datetime | None:
    """Parse provider timestamps without inventing a date for missing values."""
    text = str(value or "").strip()
    if not text:
        return None
    candidates = [text]
    if text.endswith("Z"):
        candidates.insert(0, text[:-1] + "+00:00")
    for candidate in candidates:
        try:
            parsed = datetime.fromisoformat(candidate)
            return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
        except ValueError:
            pass
    for pattern in ("%Y%m%dT%H%M%SZ", "%Y%m%d%H%M%S"):
        try:
            return datetime.strptime(text, pattern).replace(tzinfo=timezone.utc)
        except ValueError:
            pass
    try:
        parsed = parsedate_to_datetime(text)
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
    except (TypeError, ValueError, IndexError, OverflowError):
        return None


def domain_for_url(url: str) -> str:
    canonical = canonicalize_url(url)
    return urlsplit(canonical).netloc.lower() if canonical else ""


def domain_matches(domain: str, configured: list[str]) -> bool:
    return any(domain == item.lower() or domain.endswith("." + item.lower()) for item in configured)


def normalized_title(title: str) -> str:
    return " ".join(re.findall(r"[0-9a-z가-힣]+", title.casefold()))


def title_similarity(left: str, right: str) -> float:
    left_value = normalized_title(left)
    right_value = normalized_title(right)
    if not left_value or not right_value:
        return 0.0
    if left_value == right_value:
        return 1.0
    return SequenceMatcher(None, left_value, right_value).ratio()


def is_candidate_record(record: dict[str, Any]) -> bool:
    return str(record.get("source_type") or "") in CANDIDATE_SOURCE_TYPES


def within_time_window(left: dict[str, Any], right: dict[str, Any], hours: float) -> bool:
    left_time = parse_timestamp(left.get("published_at"))
    right_time = parse_timestamp(right.get("published_at"))
    if not left_time or not right_time:
        return False
    return abs((left_time.astimezone(timezone.utc) - right_time.astimezone(timezone.utc)).total_seconds()) <= hours * 3600


def duplicate_reason(left: dict[str, Any], right: dict[str, Any], settings: dict[str, Any]) -> str | None:
    left_url = canonicalize_url(str(left.get("canonical_url") or left.get("url") or ""))
    right_url = canonicalize_url(str(right.get("canonical_url") or right.get("url") or ""))
    if left_url and left_url == right_url:
        return "canonical_url"
    left_links = {
        canonicalize_url(str(item))
        for item in left.get("linked_urls", [])
        if canonicalize_url(str(item))
    }
    right_links = {
        canonicalize_url(str(item))
        for item in right.get("linked_urls", [])
        if canonicalize_url(str(item))
    }
    if left_links & right_links:
        return "shared_linked_source_url"
    if not (is_candidate_record(left) and is_candidate_record(right)):
        return None
    if not within_time_window(left, right, float(settings["title_time_window_hours"])):
        return None
    left_title = normalized_title(str(left.get("title") or ""))
    right_title = normalized_title(str(right.get("title") or ""))
    if len(left_title.split()) < 4 or len(right_title.split()) < 4:
        return None
    if title_similarity(left_title, right_title) >= float(settings["title_similarity_threshold"]):
        return "title_and_publication_window"
    return None


def record_rank(record: dict[str, Any]) -> tuple[Any, ...]:
    return (
        bool(record.get("primary_source_confirmed")),
        GRADE_PRIORITY.get(str(record.get("source_grade") or "D"), 0),
        len(str(record.get("raw_text") or "")),
        str(record.get("published_at") or ""),
    )


def deduplicate_candidate_records(
    records: list[dict[str, Any]],
    settings: dict[str, Any] | None = None,
) -> tuple[list[dict[str, Any]], int]:
    """Collapse URL and title/time duplicates while preserving source lineage."""
    resolved = merged_settings(settings)
    parents = list(range(len(records)))
    reasons: dict[tuple[int, int], str] = {}

    def find(index: int) -> int:
        while parents[index] != index:
            parents[index] = parents[parents[index]]
            index = parents[index]
        return index

    def union(left: int, right: int) -> None:
        left_root, right_root = find(left), find(right)
        if left_root != right_root:
            parents[right_root] = left_root

    for index, record in enumerate(records):
        record["canonical_url"] = canonicalize_url(str(record.get("canonical_url") or record.get("url") or ""))
        for other_index in range(index):
            reason = duplicate_reason(record, records[other_index], resolved)
            if reason:
                union(index, other_index)
                reasons[(min(index, other_index), max(index, other_index))] = reason

    groups: dict[int, list[int]] = {}
    for index in range(len(records)):
        groups.setdefault(find(index), []).append(index)

    winners: list[dict[str, Any]] = []
    suppressed = 0
    for indexes in groups.values():
        candidates = [records[index] for index in indexes]
        ranked = sorted(candidates, key=record_rank, reverse=True)
        winner = ranked[0]
        duplicates = ranked[1:]
        if duplicates:
            suppressed += len(duplicates)
            group_reasons = sorted({
                reason
                for pair, reason in reasons.items()
                if pair[0] in indexes and pair[1] in indexes
            })
            winner["deduplication"] = {
                "duplicate_count": len(duplicates),
                "duplicate_record_ids": [item.get("id") for item in duplicates],
                "alternate_source_ids": sorted({
                    str(item.get("source_id") or "unknown") for item in duplicates
                }),
                "alternate_publishers": sorted({
                    str(item.get("publisher") or item.get("source_id") or "unknown")
                    for item in duplicates
                }),
                "alternate_urls": sorted({
                    str(item.get("url") or "")
                    for item in duplicates
                    if str(item.get("url") or "").strip()
                }),
                "duplicate_lineage": [
                    {
                        "source_id": str(item.get("source_id") or "unknown"),
                        "publisher": str(item.get("publisher") or item.get("source_id") or "unknown"),
                        "url": str(item.get("url") or "") or None,
                        "publication_policy": (
                            (item.get("telegram") or {}).get("publication_policy")
                            if item.get("source_type") == "telegram_commentary"
                            else None
                        ),
                    }
                    for item in duplicates
                ],
                "match_reasons": group_reasons,
            }
        winners.append(winner)
    return sorted(winners, key=lambda item: str(item.get("published_at") or ""), reverse=True), suppressed


def source_tier(record: dict[str, Any], settings: dict[str, Any]) -> str:
    domain = domain_for_url(str(record.get("canonical_url") or record.get("url") or ""))
    if bool(record.get("primary_source_confirmed")) or domain_matches(domain, settings["primary_domains"]):
        return "primary"
    if domain_matches(domain, settings["trusted_domains"]):
        return "trusted"
    return "general"


def keyword_matches(record: dict[str, Any], keywords: list[str]) -> list[str]:
    haystack = " ".join([
        str(record.get("title") or ""),
        str(record.get("raw_text") or ""),
        " ".join(str(tag) for tag in record.get("tags", [])),
    ]).casefold()
    return sorted({keyword for keyword in keywords if keyword.casefold() in haystack})


def evaluate_candidate(
    record: dict[str, Any],
    settings: dict[str, Any] | None = None,
    *,
    now: datetime | None = None,
) -> tuple[dict[str, Any], bool]:
    """Attach deterministic filter evidence and return whether to retain the item."""
    resolved = merged_settings(settings)
    if not is_candidate_record(record):
        return record, True
    current = now or datetime.now(timezone.utc)
    if not current.tzinfo:
        current = current.replace(tzinfo=timezone.utc)
    domain = domain_for_url(str(record.get("canonical_url") or record.get("url") or ""))
    included = keyword_matches(record, list(resolved["include_keywords"]))
    excluded = keyword_matches(record, list(resolved["hard_exclude_keywords"]))
    tier = source_tier(record, resolved)
    published = parse_timestamp(record.get("published_at"))
    age_hours = (
        round((current.astimezone(timezone.utc) - published.astimezone(timezone.utc)).total_seconds() / 3600, 2)
        if published else None
    )
    reasons: list[str] = []
    status = "eligible"
    retained = True
    if not domain:
        status, retained = "discard", False
        reasons.append("missing_or_invalid_url")
    elif domain_matches(domain, list(resolved["blocked_domains"])):
        status, retained = "discard", False
        reasons.append("blocked_domain")
    elif age_hours is not None and age_hours > float(resolved["max_age_hours"]):
        status, retained = "discard", False
        reasons.append("outside_freshness_window")
    elif excluded and not included:
        status, retained = "discard", False
        reasons.append("hard_exclusion_keyword")
    elif tier == "general" and not included:
        status = "needs_local_classification"
        reasons.append("no_deterministic_relevance_match")
    else:
        reasons.append("deterministic_candidate_gate_passed")

    record["candidate_filter"] = {
        "version": "candidate_filter_v1",
        "status": status,
        "retained": retained,
        "source_tier": tier,
        "domain": domain or None,
        "published_age_hours": age_hours,
        "matched_include_keywords": included,
        "matched_exclude_keywords": excluded,
        "reasons": reasons,
    }
    return record, retained


def filter_candidate_records(
    records: list[dict[str, Any]],
    settings: dict[str, Any] | None = None,
    *,
    now: datetime | None = None,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    kept: list[dict[str, Any]] = []
    counts = {"eligible": 0, "needs_local_classification": 0, "discard": 0}
    discarded_ids: list[str] = []
    for record in records:
        evaluated, retained = evaluate_candidate(record, settings, now=now)
        if is_candidate_record(evaluated):
            status = evaluated["candidate_filter"]["status"]
            counts[status] += 1
            if not retained:
                discarded_ids.append(str(evaluated.get("id") or ""))
        if retained:
            kept.append(evaluated)
    return kept, {
        "version": "candidate_filter_v1",
        "counts": counts,
        "discarded_record_ids": discarded_ids,
    }
