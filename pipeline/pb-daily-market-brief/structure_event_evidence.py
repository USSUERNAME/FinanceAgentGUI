"""Turn bounded event evidence into validated facts, claims, and hypotheses."""

from __future__ import annotations

import argparse
import json
import os
from datetime import date, datetime
from pathlib import Path
from typing import Any
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from collectors.common import ROOT, load_dotenv


NULLABLE_TEXT = {"type": ["string", "null"]}

FACT_SCHEMA = {
    "type": "object",
    "properties": {
        "claim": {"type": "string"},
        "evidence_ids": {"type": "array", "items": {"type": "string"}, "minItems": 1},
        "fact_status": {"type": "string", "enum": ["verified_primary"]},
    },
    "required": ["claim", "evidence_ids", "fact_status"],
    "additionalProperties": False,
}

REPORTED_CLAIM_SCHEMA = {
    "type": "object",
    "properties": {
        "claim": {"type": "string"},
        "evidence_ids": {"type": "array", "items": {"type": "string"}, "minItems": 1},
        "status": {"type": "string", "enum": ["reported_secondary_unverified"]},
    },
    "required": ["claim", "evidence_ids", "status"],
    "additionalProperties": False,
}

EXPECTATION_GAP_SCHEMA = {
    "type": "object",
    "properties": {
        "actual_text": NULLABLE_TEXT,
        "consensus_text": NULLABLE_TEXT,
        "previous_text": NULLABLE_TEXT,
        "revised_previous_text": NULLABLE_TEXT,
        "surprise_text": NULLABLE_TEXT,
        "narrative_gap": NULLABLE_TEXT,
        "status": {
            "type": "string",
            "enum": ["verified_primary", "partially_supported", "not_available"],
        },
        "evidence_ids": {"type": "array", "items": {"type": "string"}},
    },
    "required": [
        "actual_text", "consensus_text", "previous_text", "revised_previous_text",
        "surprise_text", "narrative_gap", "status", "evidence_ids",
    ],
    "additionalProperties": False,
}

INTERPRETATION_SCHEMA = {
    "type": "object",
    "properties": {
        "statement": {"type": "string"},
        "evidence_ids": {"type": "array", "items": {"type": "string"}, "minItems": 1},
        "confidence": {"type": "number", "minimum": 0, "maximum": 1},
        "status": {"type": "string", "enum": ["hypothesis"]},
    },
    "required": ["statement", "evidence_ids", "confidence", "status"],
    "additionalProperties": False,
}

CONFLICT_SCHEMA = {
    "type": "object",
    "properties": {
        "description": {"type": "string"},
        "evidence_ids": {"type": "array", "items": {"type": "string"}, "minItems": 1},
    },
    "required": ["description", "evidence_ids"],
    "additionalProperties": False,
}

EVENT_EXTRACTION_SCHEMA = {
    "type": "object",
    "properties": {
        "events": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "event_id": {"type": "string"},
                    "extraction_status": {
                        "type": "string",
                        "enum": ["structured", "insufficient_evidence"],
                    },
                    "facts": {"type": "array", "items": FACT_SCHEMA},
                    "reported_claims": {"type": "array", "items": REPORTED_CLAIM_SCHEMA},
                    "expectation_gap": EXPECTATION_GAP_SCHEMA,
                    "interpretation_candidates": {
                        "type": "array",
                        "items": INTERPRETATION_SCHEMA,
                    },
                    "conflicts": {"type": "array", "items": CONFLICT_SCHEMA},
                },
                "required": [
                    "event_id", "extraction_status", "facts", "reported_claims",
                    "expectation_gap", "interpretation_candidates", "conflicts",
                ],
                "additionalProperties": False,
            },
        },
    },
    "required": ["events"],
    "additionalProperties": False,
}

ASSET_MAP = {
    "monetary_policy": ["SPY", "QQQ", "TLT", "GLD"],
    "economic_data": ["SPY", "QQQ", "TLT", "GLD"],
    "earnings_guidance": ["SPY", "QQQ"],
    "corporate_action": ["SPY", "QQQ"],
    "regulation_policy": ["SPY", "QQQ"],
    "market_structure": ["SPY", "QQQ"],
    "commodity_supply": ["XLE", "GLD", "SPY"],
    "geopolitics": ["SPY", "XLE", "GLD"],
    "other": ["SPY"],
}


def response_text(payload: dict[str, Any]) -> str:
    if payload.get("output_text"):
        return str(payload["output_text"]).strip()
    parts: list[str] = []
    for output in payload.get("output", []):
        for content in output.get("content", []):
            if content.get("type") == "output_text":
                parts.append(str(content.get("text") or ""))
    return "\n".join(parts).strip()


def evidence_text(item: dict[str, Any]) -> str:
    extraction = item.get("body_extraction") or {}
    if extraction.get("status") == "official_body_extracted":
        return str(extraction.get("text") or "")[:12000]
    return str(item.get("existing_excerpt") or "")[:2000]


def build_evidence_ledger(packet: dict[str, Any]) -> list[dict[str, Any]]:
    event_id = str(packet.get("event_id") or "")
    ledger: list[dict[str, Any]] = []
    for index, item in enumerate(packet.get("representatives", []), start=1):
        ledger.append({
            "evidence_id": f"{event_id}:evidence:{index:02d}",
            "record_id": item.get("record_id"),
            "title": item.get("title"),
            "publisher": item.get("publisher"),
            "url": item.get("url"),
            "published_at": item.get("published_at"),
            "source_grade": item.get("source_grade"),
            "source_role": item.get("source_role"),
            "evidence_label": item.get("evidence_label"),
            "extraction_status": (item.get("body_extraction") or {}).get("status"),
            "text": evidence_text(item),
        })
    return ledger


def bounded_model_input(
    packets: list[dict[str, Any]],
    *,
    max_events: int = 5,
) -> tuple[list[dict[str, Any]], dict[str, list[dict[str, Any]]]]:
    events: list[dict[str, Any]] = []
    ledgers: dict[str, list[dict[str, Any]]] = {}
    for packet in packets[:max_events]:
        event_id = str(packet.get("event_id") or "")
        ledger = build_evidence_ledger(packet)
        ledgers[event_id] = ledger
        events.append({
            "event_id": event_id,
            "event_type": packet.get("event_type"),
            "representative_title": packet.get("representative_title"),
            "evidence_posture": packet.get("evidence_posture"),
            "evidence": [{
                "evidence_id": item["evidence_id"],
                "source_role": item["source_role"],
                "evidence_label": item["evidence_label"],
                "title": item["title"],
                "text": item["text"],
            } for item in ledger],
        })
    return events, ledgers


def validate_extraction(
    extracted: dict[str, Any],
    ledgers: dict[str, list[dict[str, Any]]],
) -> None:
    expected_event_ids = set(ledgers)
    returned_event_ids = [str(item.get("event_id") or "") for item in extracted.get("events", [])]
    if len(returned_event_ids) != len(set(returned_event_ids)):
        raise ValueError("Structured event extraction returned duplicate event IDs")
    if set(returned_event_ids) != expected_event_ids:
        raise ValueError("Structured event extraction returned missing or unknown event IDs")

    for event in extracted.get("events", []):
        event_id = str(event["event_id"])
        ledger_by_id = {item["evidence_id"]: item for item in ledgers[event_id]}

        def require_known(ids: list[str]) -> list[dict[str, Any]]:
            unknown = set(ids) - set(ledger_by_id)
            if unknown:
                raise ValueError(
                    f"{event_id} references unknown evidence IDs: {', '.join(sorted(unknown))}"
                )
            return [ledger_by_id[item_id] for item_id in ids]

        for fact in event.get("facts", []):
            sources = require_known(fact.get("evidence_ids", []))
            if not sources or any(
                item.get("source_role") != "origin_primary"
                or item.get("evidence_label") != "fact_source_reported"
                for item in sources
            ):
                raise ValueError(f"{event_id} verified fact is not supported by extracted primary evidence")
        for claim in event.get("reported_claims", []):
            sources = require_known(claim.get("evidence_ids", []))
            if not sources or not any(
                item.get("source_role") == "representative_secondary" for item in sources
            ):
                raise ValueError(f"{event_id} reported claim lacks secondary evidence")
        expectation = event.get("expectation_gap", {})
        expectation_sources = require_known(expectation.get("evidence_ids", []))
        expectation_status = expectation.get("status")
        expectation_fields = [
            expectation.get("actual_text"),
            expectation.get("consensus_text"),
            expectation.get("previous_text"),
            expectation.get("revised_previous_text"),
            expectation.get("surprise_text"),
            expectation.get("narrative_gap"),
        ]
        if expectation_status == "not_available":
            if expectation_sources or any(value is not None for value in expectation_fields):
                raise ValueError(f"{event_id} unavailable expectation gap contains unsupported content")
        elif not expectation_sources:
            raise ValueError(f"{event_id} expectation gap has no supporting evidence")
        elif expectation_status == "verified_primary" and any(
            item.get("source_role") != "origin_primary"
            or item.get("evidence_label") != "fact_source_reported"
            for item in expectation_sources
        ):
            raise ValueError(f"{event_id} expectation gap overstates primary verification")
        for item in event.get("interpretation_candidates", []):
            require_known(item.get("evidence_ids", []))
        for item in event.get("conflicts", []):
            require_known(item.get("evidence_ids", []))


def sanitize_extraction_by_event(
    extracted: dict[str, Any],
    ledgers: dict[str, list[dict[str, Any]]],
) -> tuple[dict[str, Any], list[dict[str, str]]]:
    """Keep valid model events when a sibling event overstates its evidence."""
    expected_event_ids = set(ledgers)
    returned_event_ids = [
        str(item.get("event_id") or "")
        for item in extracted.get("events", [])
    ]
    if len(returned_event_ids) != len(set(returned_event_ids)):
        raise ValueError("Structured event extraction returned duplicate event IDs")
    if set(returned_event_ids) != expected_event_ids:
        raise ValueError("Structured event extraction returned missing or unknown event IDs")

    sanitized_events: list[dict[str, Any]] = []
    warnings: list[dict[str, str]] = []
    for event in extracted.get("events", []):
        event_id = str(event.get("event_id") or "")
        try:
            validate_extraction(
                {"events": [event]},
                {event_id: ledgers[event_id]},
            )
            sanitized_events.append(event)
        except ValueError as exc:
            sanitized_events.append({
                "event_id": event_id,
                "extraction_status": "insufficient_evidence",
                "fallback_reason": "event_validation_failed",
                "validation_error": str(exc),
                "facts": [],
                "reported_claims": [],
                "expectation_gap": empty_expectation_gap(),
                "interpretation_candidates": [],
                "conflicts": [],
            })
            warnings.append({
                "event_id": event_id,
                "reason": str(exc),
            })
    return {"events": sanitized_events}, warnings


def parse_iso_date(value: Any) -> date | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00")).date()
    except ValueError:
        try:
            return date.fromisoformat(str(value)[:10])
        except ValueError:
            return None


def market_reaction_context(
    event_type: str,
    published_at: Any,
    etf_payload: dict[str, Any],
) -> dict[str, Any]:
    event_date = parse_iso_date(published_at)
    available = {
        str(item.get("ticker") or ""): item
        for item in etf_payload.get("items", [])
        if item.get("ticker")
    }
    observations: list[dict[str, Any]] = []
    gaps: list[int] = []
    for ticker in ASSET_MAP.get(event_type, ASSET_MAP["other"]):
        item = available.get(ticker)
        if not item:
            continue
        price_date = parse_iso_date(item.get("as_of"))
        gap = abs((price_date - event_date).days) if price_date and event_date else None
        if gap is not None:
            gaps.append(gap)
        observations.append({
            "ticker": ticker,
            "as_of": item.get("as_of"),
            "return_1d_pct": item.get("return_1d_pct"),
            "return_5d_pct": item.get("return_5d_pct"),
            "calendar_gap_days": gap,
        })

    if observations and gaps and max(gaps) == 0:
        status = "same_session_context_not_causal"
    elif observations and gaps and max(gaps) <= 1:
        status = "adjacent_close_context_not_causal"
    else:
        status = "not_measured_stale_or_unaligned"
    return {
        "status": status,
        "observations": observations,
        "causal_attribution_permitted": False,
        "note": (
            "Daily and five-session returns are context only. They are not an "
            "announcement-window reaction and must not be described as caused by this event."
        ),
        "required_event_window_measurements": [
            "announcement_timestamp", "pre_30m", "post_5m", "post_1h",
            "session_close", "next_session_close",
        ],
    }


def empty_expectation_gap() -> dict[str, Any]:
    return {
        "actual_text": None,
        "consensus_text": None,
        "previous_text": None,
        "revised_previous_text": None,
        "surprise_text": None,
        "narrative_gap": None,
        "status": "not_available",
        "evidence_ids": [],
    }


def fallback_extraction(
    packets: list[dict[str, Any]],
    *,
    reason: str,
    max_events: int = 5,
) -> tuple[dict[str, Any], dict[str, list[dict[str, Any]]]]:
    _, ledgers = bounded_model_input(packets, max_events=max_events)
    return {
        "events": [{
            "event_id": event_id,
            "extraction_status": "not_run",
            "fallback_reason": reason,
            "facts": [],
            "reported_claims": [],
            "expectation_gap": empty_expectation_gap(),
            "interpretation_candidates": [],
            "conflicts": [],
        } for event_id in ledgers]
    }, ledgers


def extract_with_openai(
    packets: list[dict[str, Any]],
    *,
    max_events: int = 5,
) -> tuple[dict[str, Any], dict[str, list[dict[str, Any]]], dict[str, Any]]:
    api_key = os.getenv("OPENAI_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY is missing")
    model = (
        os.getenv("OPENAI_EVENT_EXTRACTION_MODEL", "").strip()
        or os.getenv("OPENAI_ANALYSIS_MODEL", "gpt-5-mini").strip()
    )
    events, ledgers = bounded_model_input(packets, max_events=max_events)
    instructions = """You structure evidence for a Korean public-equity market brief.
Use only the supplied evidence text and copy event_id and evidence_id exactly.

Rules:
- facts may contain only claims explicitly stated in evidence whose source_role is origin_primary and evidence_label is fact_source_reported.
- reported_claims may contain only claims explicitly present in representative_secondary evidence. They remain unverified reports.
- Never turn metadata, a headline, an excerpt label, or secondary reporting into a verified fact.
- expectation_gap fields must remain null unless the supplied evidence explicitly gives the corresponding actual, consensus, previous, revision, surprise, or narrative comparison.
- interpretation_candidates are hypotheses, not facts or recommendations.
- Do not infer market reaction, prices, causality, URLs, or facts outside the evidence.
- If evidence is insufficient, return empty arrays and not_available fields.
- Write concise Korean strings."""
    body = json.dumps({
        "model": model,
        "instructions": instructions,
        "input": json.dumps({"events": events}, ensure_ascii=False),
        "reasoning": {"effort": "minimal"},
        "text": {"format": {
            "type": "json_schema",
            "name": "structured_event_evidence",
            "description": "Evidence-bound event facts, reports, gaps, and hypotheses.",
            "strict": True,
            "schema": EVENT_EXTRACTION_SCHEMA,
        }},
        "max_output_tokens": 3500,
        "store": False,
    }, ensure_ascii=False).encode("utf-8")
    request = Request("https://api.openai.com/v1/responses", method="POST", data=body, headers={
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    })
    try:
        with urlopen(request, timeout=90) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"OpenAI event extraction returned HTTP {exc.code}: {detail}") from exc
    if payload.get("status") == "incomplete":
        reason = (payload.get("incomplete_details") or {}).get("reason", "unknown")
        raise RuntimeError(f"OpenAI event extraction was incomplete ({reason})")
    text = response_text(payload)
    if not text:
        raise RuntimeError("OpenAI returned no structured event evidence")
    extracted = json.loads(text)
    extracted, validation_warnings = sanitize_extraction_by_event(
        extracted,
        ledgers,
    )
    if validation_warnings:
        print(
            "Structured event validation downgraded "
            f"{len(validation_warnings)} event(s) without discarding valid siblings."
        )
    return extracted, ledgers, payload.get("usage", {})


def assemble_payload(
    packets_payload: dict[str, Any],
    snapshot: dict[str, Any],
    extracted: dict[str, Any],
    ledgers: dict[str, list[dict[str, Any]]],
    *,
    usage: dict[str, Any] | None = None,
) -> dict[str, Any]:
    packets_by_id = {
        str(item.get("event_id") or ""): item
        for item in packets_payload.get("events", [])
    }
    clusters_by_id = {
        str(item.get("event_id") or ""): item
        for item in (snapshot.get("news_event_clusters") or {}).get("clusters", [])
    }
    events: list[dict[str, Any]] = []
    for extraction in extracted.get("events", []):
        event_id = str(extraction.get("event_id") or "")
        packet = packets_by_id.get(event_id, {})
        cluster = clusters_by_id.get(event_id, {})
        published_at = cluster.get("published_from")
        if not published_at and ledgers.get(event_id):
            published_at = ledgers[event_id][0].get("published_at")
        events.append({
            "event_id": event_id,
            "event_type": packet.get("event_type") or cluster.get("event_type") or "other",
            "representative_title": packet.get("representative_title"),
            "evidence_posture": packet.get("evidence_posture"),
            "extraction_status": extraction.get("extraction_status"),
            "fallback_reason": extraction.get("fallback_reason"),
            "evidence_ledger": ledgers.get(event_id, []),
            "facts": extraction.get("facts", []),
            "reported_claims": extraction.get("reported_claims", []),
            "expectation_gap": extraction.get("expectation_gap", empty_expectation_gap()),
            "market_reaction": market_reaction_context(
                str(packet.get("event_type") or cluster.get("event_type") or "other"),
                published_at,
                snapshot.get("etf_metrics") or {},
            ),
            "interpretation_candidates": extraction.get("interpretation_candidates", []),
            "conflicts": extraction.get("conflicts", []),
        })
    return {
        "schema_version": "structured_event_evidence.v1",
        "report_date": snapshot.get("report_date"),
        "support_context": {
            "owning_workflow": "economic-impact-report",
            "decision_impact": "Separates verified facts, reported claims, expectation gaps, and hypotheses.",
            "readiness_effect": (
                "research_grade"
                if events and all(item["extraction_status"] == "structured" for item in events)
                else "needs_targeted_fixes"
            ),
            "artifact_role": "embedded_support_artifact",
            "hidden_unless_requested": True,
        },
        "event_count": len(events),
        "usage": usage or {},
        "events": events,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Structure and validate event evidence.")
    parser.add_argument("--date", required=True)
    parser.add_argument("--packets-file")
    parser.add_argument("--snapshot-file")
    parser.add_argument("--dry-run", action="store_true", help="Skip OpenAI and emit an explicit fallback")
    args = parser.parse_args()
    load_dotenv()

    packets_path = Path(args.packets_file) if args.packets_file else (
        ROOT / "workspace" / "event_evidence" / args.date / "event_evidence_packets.json"
    )
    snapshot_path = Path(args.snapshot_file) if args.snapshot_file else (
        ROOT / "workspace" / "snapshots" / args.date / "daily_snapshot.json"
    )
    packets_payload = json.loads(packets_path.read_text(encoding="utf-8"))
    snapshot = json.loads(snapshot_path.read_text(encoding="utf-8"))
    max_events = int(os.getenv("EVENT_EXTRACTION_MAX_EVENTS", "5"))
    packet_events = packets_payload.get("events", [])

    if not packet_events:
        extracted, ledgers = fallback_extraction(
            [],
            reason="no_events",
            max_events=max_events,
        )
        usage = {}
    elif args.dry_run:
        extracted, ledgers = fallback_extraction(
            packet_events,
            reason="dry_run",
            max_events=max_events,
        )
        usage: dict[str, Any] = {}
    else:
        try:
            extracted, ledgers, usage = extract_with_openai(
                packet_events,
                max_events=max_events,
            )
        except Exception as exc:
            extracted, ledgers = fallback_extraction(
                packet_events,
                reason=type(exc).__name__,
                max_events=max_events,
            )
            usage = {}
            print(f"Event evidence extraction fallback: {type(exc).__name__}: {exc}")

    payload = assemble_payload(packets_payload, snapshot, extracted, ledgers, usage=usage)
    output_dir = ROOT / "workspace" / "event_evidence" / args.date
    output_dir.mkdir(parents=True, exist_ok=True)
    output = output_dir / "structured_event_evidence.json"
    output.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    snapshot["structured_event_evidence"] = payload
    snapshot_path.write_text(json.dumps(snapshot, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Structured event evidence saved: {output.relative_to(ROOT)}")
    print(f"Structured events={payload['event_count']}")


if __name__ == "__main__":
    main()
