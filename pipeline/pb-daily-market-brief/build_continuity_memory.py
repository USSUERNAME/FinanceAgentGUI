"""Build a bounded, file-based continuity memory from durable research histories."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from collections import Counter
from datetime import date
from pathlib import Path
from typing import Any

from collectors.common import ROOT

SCHEMA_VERSION = "research_continuity_memory.v1"
REVIEW_SCHEMA_VERSION = "daily_continuity_review.v1"
ALLOWED_STATES = {
    "active",
    "confirmed",
    "strengthening",
    "weakening",
    "easing",
    "refuted",
    "unresolved",
    "unverified",
}
TERMINAL_STATES = {"refuted"}
MAX_OBSERVATIONS = 50


def load_json(path: Path, default: Any) -> Any:
    if not path.exists():
        return default
    return json.loads(path.read_text(encoding="utf-8-sig"))


def continuity_id(kind: str, *parts: Any) -> str:
    normalized = "|".join(
        re.sub(r"\s+", " ", str(part or "").strip().casefold())
        for part in parts
    )
    digest = hashlib.sha256(f"{kind}|{normalized}".encode("utf-8")).hexdigest()[:16]
    return f"{kind}:{digest}"


def latest_daily_records(history: dict[str, Any], report_date: str) -> list[dict[str, Any]]:
    rows = [
        row for row in history.get("daily_records", [])
        if row.get("report_date") == report_date
    ]
    if not rows:
        return []
    revision = max(int(row.get("revision", 1)) for row in rows)
    return [row for row in rows if int(row.get("revision", 1)) == revision]


def event_signature(event: dict[str, Any]) -> tuple[str, str]:
    event_type = str(event.get("event_type") or "other")
    entities = sorted(str(item).casefold() for item in event.get("entities", []) if item)
    topics = sorted(str(item).casefold() for item in event.get("topic_tags", []) if item)
    title_terms = re.findall(
        r"[0-9a-z가-힣.-]+",
        str(event.get("representative_title") or "").casefold(),
    )[:8]
    signature = "|".join([event_type, *entities[:4], *topics[:4], *title_terms])
    return event_type, signature


def hypothesis_state(status: str) -> str:
    return {
        "pending": "active",
        "hit": "confirmed",
        "miss": "refuted",
        "inconclusive": "unresolved",
    }.get(status, "unresolved")


def thesis_state(status: str, transition: str = "") -> str:
    if status in {"refuted"}:
        return "refuted"
    if status in {"strengthening"} or transition in {
        "thesis_strengthening",
        "newly_scored",
        "evidence_expanding",
    }:
        return "strengthening"
    if status in {"impaired", "watch"} or transition in {
        "thesis_weakening",
        "score_lost",
        "evidence_contracting",
    }:
        return "weakening"
    if status in {"untested"}:
        return "unresolved"
    return "active"


def evidence_buckets(**values: list[str]) -> dict[str, list[str]]:
    result = {
        "price": [],
        "news": [],
        "filing": [],
        "official_context": [],
        "research": [],
    }
    for key, items in values.items():
        if key in result:
            result[key] = sorted({str(item) for item in items if item})
    return result


def observation(
    *,
    report_date: str,
    state: str,
    reason: str,
    source_refs: list[str],
) -> dict[str, Any]:
    material = "|".join([report_date, state, reason, *sorted(source_refs)])
    return {
        "observation_id": hashlib.sha256(material.encode("utf-8")).hexdigest()[:20],
        "report_date": report_date,
        "state": state,
        "reason": reason,
        "source_refs": sorted({str(item) for item in source_refs if item}),
    }


def upsert(
    entries: dict[str, dict[str, Any]],
    *,
    continuity_key: str,
    kind: str,
    subject_id: str,
    title: str,
    report_date: str,
    state: str,
    reason: str,
    evidence: dict[str, list[str]],
    confirmation_conditions: list[str],
    invalidation_conditions: list[str],
    source_refs: list[str],
) -> None:
    if state not in ALLOWED_STATES:
        raise ValueError(f"Unsupported continuity state: {state}")
    row = entries.get(continuity_key, {
        "continuity_id": continuity_key,
        "kind": kind,
        "subject_id": subject_id,
        "title": title,
        "first_seen_date": report_date,
        "last_seen_date": report_date,
        "last_confirmed_date": None,
        "monitoring_state": state,
        "state_reason": reason,
        "supersedes_continuity_id": None,
        "evidence": evidence_buckets(),
        "confirmation_conditions": [],
        "invalidation_conditions": [],
        "observations": [],
    })
    row.update({
        "title": title or row.get("title"),
        "last_seen_date": report_date,
        "monitoring_state": state,
        "state_reason": reason,
        "confirmation_conditions": list(confirmation_conditions),
        "invalidation_conditions": list(invalidation_conditions),
    })
    if state == "confirmed":
        row["last_confirmed_date"] = report_date
    for bucket, refs in evidence.items():
        row["evidence"][bucket] = sorted(
            set(row["evidence"].get(bucket, [])) | set(refs)
        )[-100:]
    item = observation(
        report_date=report_date,
        state=state,
        reason=reason,
        source_refs=source_refs,
    )
    if item["observation_id"] not in {
        existing.get("observation_id") for existing in row["observations"]
    }:
        row["observations"].append(item)
        row["observations"] = row["observations"][-MAX_OBSERVATIONS:]
    entries[continuity_key] = row


def build_continuity_memory(
    previous: dict[str, Any],
    report_date: str,
    *,
    hypothesis_history: dict[str, Any],
    sector_history: dict[str, Any],
    company_history: dict[str, Any],
    event_clusters: dict[str, Any],
    event_source_matches: dict[str, Any],
    cross_source_events: dict[str, Any] | None = None,
) -> tuple[dict[str, Any], dict[str, Any]]:
    entries = {
        str(row["continuity_id"]): json.loads(json.dumps(row, ensure_ascii=False))
        for row in previous.get("entries", [])
        if row.get("continuity_id")
    }
    seen: set[str] = set()

    for row in hypothesis_history.get("records", []):
        if str(row.get("created_report_date") or "") > report_date:
            continue
        if not (
            row.get("status") == "pending"
            or row.get("created_report_date") == report_date
            or row.get("resolved_report_date") == report_date
        ):
            continue
        key = continuity_id(
            "hypothesis",
            row.get("metric_key"),
            row.get("expected_direction"),
        )
        seen.add(key)
        threshold = row.get("minimum_change")
        direction = row.get("expected_direction")
        upsert(
            entries,
            continuity_key=key,
            kind="market_hypothesis",
            subject_id=str(row.get("metric_key") or "unknown"),
            title=str(row.get("claim") or row.get("metric_label") or "Market hypothesis"),
            report_date=report_date,
            state=hypothesis_state(str(row.get("status") or "pending")),
            reason=str(row.get("resolution_reason") or "Awaiting predefined metric evaluation."),
            evidence=evidence_buckets(price=[f"metric:{row.get('metric_key')}"]),
            confirmation_conditions=[f"{direction} by at least {threshold}"],
            invalidation_conditions=[f"opposite move by at least {threshold}"],
            source_refs=[f"hypothesis:{row.get('id')}"],
        )

    sector_events = {
        str(row.get("thesis_id")): row
        for row in sector_history.get("transition_events", [])
        if row.get("report_date") == report_date
    }
    for row in latest_daily_records(sector_history, report_date):
        thesis_id = str(row.get("thesis_id") or f"sector:{row.get('sector_id')}")
        transition = sector_events.get(thesis_id, {})
        key = continuity_id("sector", thesis_id)
        seen.add(key)
        upsert(
            entries,
            continuity_key=key,
            kind="sector_thesis",
            subject_id=thesis_id,
            title=str(row.get("name_ko") or row.get("sector_id") or thesis_id),
            report_date=report_date,
            state=thesis_state(
                str(transition.get("company_thesis_status") or "intact"),
                str(transition.get("transition") or ""),
            ),
            reason=str(transition.get("reason") or "Current sector evidence snapshot."),
            evidence=evidence_buckets(
                research=list(row.get("evidence_source_ids", [])),
                price=[
                    f"sector_metric:{row.get('sector_id')}:{dimension_id}"
                    for dimension_id, value in row.get("dimensions", {}).items()
                    if (value or {}).get("score") is not None
                ],
            ),
            confirmation_conditions=list(transition.get("next_proof_points", [])),
            invalidation_conditions=[str(transition.get("draft_kill_criterion") or "")],
            source_refs=[
                str(transition.get("event_id") or row.get("record_id") or "")
            ],
        )

    company_events = {
        str(row.get("thesis_id")): row
        for row in company_history.get("transition_events", [])
        if row.get("report_date") == report_date
    }
    for row in latest_daily_records(company_history, report_date):
        thesis_id = str(row.get("thesis_id") or f"company:{row.get('ticker')}")
        transition = company_events.get(thesis_id, {})
        key = continuity_id("company", thesis_id)
        seen.add(key)
        filing_refs = [
            str(source.get("source_id"))
            for source in row.get("source_index", [])
            if source.get("source_id")
        ]
        upsert(
            entries,
            continuity_key=key,
            kind="company_thesis",
            subject_id=thesis_id,
            title=str(row.get("company_name") or row.get("ticker") or thesis_id),
            report_date=report_date,
            state=thesis_state(
                str(transition.get("company_thesis_status") or row.get("company_thesis_status") or "untested"),
                str(transition.get("transition") or ""),
            ),
            reason=str(transition.get("reason") or "Current company research baseline."),
            evidence=evidence_buckets(filing=filing_refs),
            confirmation_conditions=[
                str(pillar.get("next_proof_point"))
                for pillar in row.get("pillars", [])
                if pillar.get("next_proof_point")
            ],
            invalidation_conditions=[
                str(rule.get("condition"))
                for rule in row.get("action_rules", [])
                if rule.get("condition")
            ],
            source_refs=[str(transition.get("event_id") or row.get("record_id") or "")],
        )

    matches = {
        str(row.get("event_id")): row
        for row in event_source_matches.get("events", [])
    }
    cross_sources = {
        str(row.get("event_id")): row
        for row in (cross_source_events or {}).get("events", [])
        if row.get("event_id")
    }
    for event in event_clusters.get("clusters", []):
        event_type, signature = event_signature(event)
        key = continuity_id("event", signature)
        seen.add(key)
        match = matches.get(str(event.get("event_id") or ""), {})
        cross_source = cross_sources.get(str(event.get("event_id") or ""), {})
        resolution = str(match.get("resolution_status") or "search_required")
        state = (
            "confirmed" if resolution == "origin_primary_matched"
            else "active" if resolution == "official_provider_only"
            else "unverified"
        )
        matched_refs = [
            str(item.get("record_id"))
            for item in match.get("matched_sources", [])
            if item.get("record_id")
        ]
        linked_official_refs = [
            str(item.get("record_id"))
            for item in cross_source.get("official_sources", [])
            if item.get("record_id")
        ]
        research_refs = [
            str(item.get("report_id"))
            for item in cross_source.get("attributed_research", [])
            if item.get("report_id")
        ]
        discovery_refs = [
            str(item.get("record_id"))
            for item in cross_source.get("discovery_sources", [])
            if item.get("record_id")
        ]
        source_mix = dict(cross_source.get("source_mix") or {})
        reason = (
            f"Official-source resolution status: {resolution}; "
            f"cross-source status: "
            f"{cross_source.get('cross_source_status') or 'not_available'}."
        )
        upsert(
            entries,
            continuity_key=key,
            kind="market_event",
            subject_id=event_type,
            title=str(event.get("representative_title") or event_type),
            report_date=report_date,
            state=state,
            reason=reason,
            evidence=evidence_buckets(
                news=sorted(set(event.get("record_ids", [])) | set(discovery_refs)),
                filing=matched_refs if resolution == "origin_primary_matched" else [],
                official_context=linked_official_refs,
                research=research_refs,
            ),
            confirmation_conditions=[
                "matching primary document on an approved official domain",
                *[
                    str(condition)
                    for item in cross_source.get("attributed_research", [])
                    for condition in item.get("monitoring_conditions", [])
                    if str(condition).strip()
                ][:5],
            ],
            invalidation_conditions=[
                "primary source contradicts the discovered headline",
            ],
            source_refs=[
                str(event.get("event_id") or ""),
                *matched_refs,
                *linked_official_refs,
                *research_refs,
                *discovery_refs,
            ],
        )
        memory_row = entries[key]
        previous_mix = dict(memory_row.get("source_role_counts") or {})
        if source_mix and source_mix != previous_mix:
            memory_row["last_evidence_expansion_date"] = report_date
        memory_row["source_role_counts"] = source_mix
        memory_row["cross_source_status"] = (
            cross_source.get("cross_source_status") or "not_available"
        )
        memory_row["verification_state"] = (
            "primary_verified"
            if resolution == "origin_primary_matched"
            else "cross_source_unverified"
            if source_mix
            else "discovery_only"
        )

    for key, row in entries.items():
        if key in seen or row.get("monitoring_state") in TERMINAL_STATES:
            continue
        last_seen = str(row.get("last_seen_date") or report_date)
        age = (date.fromisoformat(report_date) - date.fromisoformat(last_seen)).days
        if age >= 2:
            row["monitoring_state"] = "easing"
            row["state_reason"] = (
                f"Not observed in the current inputs for {age} calendar day(s); "
                "this is a monitoring decay, not factual resolution."
            )

    ordered = sorted(
        entries.values(),
        key=lambda row: (str(row.get("kind")), str(row.get("continuity_id"))),
    )
    state_counts = dict(sorted(Counter(
        str(row.get("monitoring_state") or "unknown") for row in ordered
    ).items()))
    kind_counts = dict(sorted(Counter(
        str(row.get("kind") or "unknown") for row in ordered
    ).items()))
    suggestions = list(previous.get("suggestions", []))[-100:]
    memory = {
        "schema_version": SCHEMA_VERSION,
        "updated_report_date": report_date,
        "entries": ordered,
        "suggestions": suggestions,
        "summary": {
            "entry_count": len(ordered),
            "state_counts": state_counts,
            "kind_counts": kind_counts,
            "pending_suggestion_count": sum(
                row.get("status") == "watching"
                for row in suggestions
            ),
        },
        "policy": {
            "runtime_store": "file_based_derived_index",
            "source_histories_remain_authoritative": True,
            "model_automatic_mutation_allowed": False,
            "model_change_suggestions_allowed": True,
            "model_suggestion_application_allowed": False,
            "position_action_allowed": False,
        },
    }
    review = {
        "schema_version": REVIEW_SCHEMA_VERSION,
        "report_date": report_date,
        "seen_continuity_ids": sorted(seen),
        "active_entries": [
            {
                "continuity_id": row["continuity_id"],
                "kind": row["kind"],
                "title": row["title"],
                "monitoring_state": row["monitoring_state"],
                "last_seen_date": row["last_seen_date"],
            }
            for row in ordered
            if row["monitoring_state"] not in TERMINAL_STATES
        ],
        "summary": memory["summary"],
    }
    validate_continuity_memory(memory)
    return memory, review


def validate_continuity_memory(memory: dict[str, Any]) -> None:
    if memory.get("schema_version") != SCHEMA_VERSION:
        raise ValueError("Unsupported continuity memory schema")
    ids: set[str] = set()
    for row in memory.get("entries", []):
        key = str(row.get("continuity_id") or "")
        if not key or key in ids:
            raise ValueError("Continuity IDs must be present and unique")
        ids.add(key)
        if row.get("monitoring_state") not in ALLOWED_STATES:
            raise ValueError(f"Unsupported monitoring state for {key}")
        if str(row.get("first_seen_date")) > str(row.get("last_seen_date")):
            raise ValueError(f"Invalid continuity date order for {key}")
        if len(row.get("observations", [])) > MAX_OBSERVATIONS:
            raise ValueError(f"Observation history exceeds bound for {key}")
    policy = memory.get("policy") or {}
    if policy.get("model_automatic_mutation_allowed") is not False:
        raise ValueError("Model automatic mutation must remain disabled")
    if policy.get("model_suggestion_application_allowed") is not False:
        raise ValueError("Model suggestions cannot apply themselves")
    if policy.get("position_action_allowed") is not False:
        raise ValueError("Continuity memory cannot authorize position actions")


def main() -> None:
    parser = argparse.ArgumentParser(description="Build bounded research continuity memory")
    parser.add_argument("--date", required=True)
    args = parser.parse_args()
    history_dir = ROOT / "workspace" / "history"
    memory_path = history_dir / "continuity_memory.json"
    previous = load_json(memory_path, {})
    memory, review = build_continuity_memory(
        previous,
        args.date,
        hypothesis_history=load_json(history_dir / "hypothesis_history.json", {}),
        sector_history=load_json(history_dir / "sector_thesis_history.json", {}),
        company_history=load_json(history_dir / "company_thesis_history.json", {}),
        event_clusters=load_json(
            ROOT / "workspace" / "triaged" / args.date / "event_clusters.json",
            {},
        ),
        event_source_matches=load_json(
            ROOT / "workspace" / "event_evidence" / args.date / "event_source_matches.json",
            {},
        ),
        cross_source_events=load_json(
            ROOT
            / "workspace"
            / "cross_source_events"
            / args.date
            / "cross_source_events.json",
            {},
        ),
    )
    memory_path.parent.mkdir(parents=True, exist_ok=True)
    memory_path.write_text(
        json.dumps(memory, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    review_path = history_dir / "continuity_reviews" / f"{args.date}.json"
    review_path.parent.mkdir(parents=True, exist_ok=True)
    review_path.write_text(
        json.dumps(review, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"Continuity memory saved: {memory_path.relative_to(ROOT)}")
    print(f"Daily continuity review saved: {review_path.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
