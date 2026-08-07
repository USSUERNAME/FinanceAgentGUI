"""Rank structured events and synthesize bounded public-equity implications."""

from __future__ import annotations

import argparse
import json
import os
from datetime import date
from pathlib import Path
from typing import Any
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from collectors.common import ROOT, load_dotenv
from sector_master import load_sector_master
from structure_event_evidence import parse_iso_date, response_text


EVENT_BREADTH_POINTS = {
    "monetary_policy": 25,
    "economic_data": 23,
    "geopolitics": 22,
    "regulation_policy": 20,
    "commodity_supply": 18,
    "market_structure": 15,
    "earnings_guidance": 14,
    "corporate_action": 12,
    "other": 5,
}

SAFE_ACTIONS = {"watchlist", "wait_for_proof", "pass", "re_underwrite"}


def clamp(value: float, low: float = 0, high: float = 100) -> float:
    return max(low, min(high, value))


def event_published_date(event: dict[str, Any]) -> date | None:
    dates = [
        parse_iso_date(item.get("published_at"))
        for item in event.get("evidence_ledger", [])
        if item.get("published_at")
    ]
    return min((item for item in dates if item is not None), default=None)


def korean_relevance_points(event: dict[str, Any], snapshot: dict[str, Any]) -> tuple[int, list[str]]:
    record_ids = {
        str(item.get("record_id") or "")
        for item in event.get("evidence_ledger", [])
        if item.get("record_id")
    }
    records = [
        item for item in snapshot.get("records", [])
        if str(item.get("id") or "") in record_ids
    ]
    reasons: list[str] = []
    if any(
        item.get("source_type") == "korean_filing"
        or any(str(ticker).isdigit() and len(str(ticker)) == 6 for ticker in item.get("tickers", []))
        for item in records
    ):
        reasons.append("direct_korean_security_or_filing")
        return 15, reasons
    if any(item.get("sector_ids") or item.get("sector_candidate_ids") for item in records):
        reasons.append("sector_connection_present")
        return 10, reasons
    if event.get("event_type") in {
        "monetary_policy", "economic_data", "geopolitics",
        "regulation_policy", "commodity_supply",
    }:
        reasons.append("broad_korean_transmission_requires_confirmation")
        return 5, reasons
    return 0, reasons


def expectation_points(event: dict[str, Any]) -> int:
    gap = event.get("expectation_gap") or {}
    if gap.get("status") == "verified_primary":
        if gap.get("actual_text") and (
            gap.get("consensus_text") or gap.get("surprise_text") or gap.get("narrative_gap")
        ):
            return 15
        return 7
    if gap.get("status") == "partially_supported":
        return 5
    return 0


def source_points(event: dict[str, Any]) -> tuple[int, int]:
    ledger = event.get("evidence_ledger", [])
    official = any(
        item.get("source_role") == "origin_primary"
        and item.get("evidence_label") == "fact_source_reported"
        for item in ledger
    )
    primary_metadata = any(item.get("source_role") == "origin_primary" for item in ledger)
    official_points = 10 if official else 5 if primary_metadata else 0
    grades = {str(item.get("source_grade") or "").upper() for item in ledger}
    quality_points = 10 if "A" in grades else 7 if "B" in grades else 3 if "C" in grades else 0
    return official_points, quality_points


def recency_points(event: dict[str, Any], report_date: str) -> int:
    published = event_published_date(event)
    report = date.fromisoformat(report_date)
    if not published:
        return 0
    gap = (report - published).days
    return 5 if gap == 0 else 3 if gap == 1 else 0


def score_event(event: dict[str, Any], snapshot: dict[str, Any]) -> dict[str, Any]:
    breadth = EVENT_BREADTH_POINTS.get(str(event.get("event_type") or "other"), 5)
    korea, korea_reasons = korean_relevance_points(event, snapshot)
    expectation = expectation_points(event)
    official, quality = source_points(event)
    recency = recency_points(event, str(snapshot.get("report_date")))
    reaction = event.get("market_reaction") or {}
    event_window_measured = reaction.get("status") == "event_window_measured"
    price_reaction = 20 if event_window_measured else 0

    penalties: list[dict[str, Any]] = []
    ledger = event.get("evidence_ledger", [])
    if ledger and all(item.get("evidence_label") == "secondary_metadata_unverified" for item in ledger):
        penalties.append({"reason": "metadata_or_secondary_only", "points": -20})
    if event.get("evidence_posture") == "missing_required_source":
        penalties.append({"reason": "missing_required_primary_source", "points": -15})
    if not event.get("facts"):
        penalties.append({"reason": "no_verified_primary_fact", "points": -10})
    if event.get("extraction_status") != "structured":
        penalties.append({"reason": "structured_extraction_unavailable", "points": -25})

    components = {
        "market_impact_breadth": breadth,
        "event_window_price_reaction": price_reaction,
        "expectation_gap": expectation,
        "korean_market_relevance": korea,
        "official_source_confirmation": official,
        "source_quality": quality,
        "recency": recency,
    }
    total = clamp(sum(components.values()) + sum(item["points"] for item in penalties))
    evidence_readiness = clamp(expectation + official + quality, high=35)
    return {
        "event_id": event.get("event_id"),
        "priority_score": total,
        "maximum_score": 100,
        "impact_priority_score": breadth + korea + recency,
        "evidence_readiness_score": evidence_readiness,
        "event_window_price_reaction_measured": event_window_measured,
        "components": components,
        "penalties": penalties,
        "korean_relevance_reasons": korea_reasons,
        "eligible_for_synthesis": (
            event.get("extraction_status") == "structured"
            and bool(event.get("facts") or event.get("reported_claims"))
        ),
    }


def rank_events(structured: dict[str, Any], snapshot: dict[str, Any]) -> list[dict[str, Any]]:
    scores = [score_event(event, snapshot) for event in structured.get("events", [])]
    return sorted(
        scores,
        key=lambda item: (
            not item["eligible_for_synthesis"],
            -float(item["priority_score"]),
            str(item["event_id"]),
        ),
    )


def sector_context(snapshot: dict[str, Any], master: dict[str, Any]) -> list[dict[str, Any]]:
    summary = snapshot.get("sector_snapshot_summary") or {}
    observations: dict[str, dict[str, Any]] = {}
    for key in (
        "industry_leading_data_observations",
        "market_confirmation_observations",
        "fundamental_dimension_observations",
        "driver_dimension_observations",
    ):
        for item in summary.get(key, [])[:10]:
            sector_id = str(item.get("sector_id") or "")
            observations.setdefault(sector_id, {})[key] = item
    rows: list[dict[str, Any]] = []
    for sector in master.get("sectors", []):
        rows.append({
            "sector_id": sector.get("sector_id"),
            "name_en": sector.get("name_en"),
            "classification": sector.get("classification"),
            "macro_sensitivities": sector.get("macro_sensitivities", []),
            "current_observations": observations.get(str(sector.get("sector_id") or ""), {}),
            "exposure_status": "research_candidate_not_recommendation",
        })
    return rows


def event_sector_connections(event: dict[str, Any], snapshot: dict[str, Any]) -> dict[str, str]:
    record_ids = {
        str(item.get("record_id") or "")
        for item in event.get("evidence_ledger", [])
        if item.get("record_id")
    }
    connections: dict[str, str] = {}
    for record in snapshot.get("records", []):
        if str(record.get("id") or "") not in record_ids:
            continue
        for sector_id in record.get("sector_ids", []):
            connections[str(sector_id)] = "evidence_connected"
        for sector_id in record.get("sector_candidate_ids", []):
            connections.setdefault(str(sector_id), "candidate_unverified")
    return connections


def synthesis_schema(sector_ids: list[str]) -> dict[str, Any]:
    sector_enum = sector_ids or ["unclassified"]
    evidence_ids = {"type": "array", "items": {"type": "string"}}
    transmission = {
        "type": "object",
        "properties": {
            "channel": {"type": "string"},
            "first_repricing_variable": {"type": "string"},
            "sector_id": {"type": "string", "enum": sector_enum},
            "first_affected_line_item": {"type": "string"},
            "direction": {"type": "string", "enum": ["positive", "negative", "mixed", "unclear"]},
            "timing": {"type": "string", "enum": ["immediate", "near_term", "medium_term", "structural"]},
            "confidence": {"type": "number", "minimum": 0, "maximum": 1},
            "evidence_ids": {**evidence_ids, "minItems": 1},
            "inference_status": {"type": "string", "enum": ["hypothesis"]},
        },
        "required": [
            "channel", "first_repricing_variable", "sector_id", "first_affected_line_item",
            "direction", "timing", "confidence", "evidence_ids", "inference_status",
        ],
        "additionalProperties": False,
    }
    monitor = {
        "type": "object",
        "properties": {
            "signal": {"type": "string"},
            "role": {"type": "string", "enum": ["confirm", "falsify", "both"]},
            "evidence_ids": evidence_ids,
        },
        "required": ["signal", "role", "evidence_ids"],
        "additionalProperties": False,
    }
    event_item = {
        "type": "object",
        "properties": {
            "event_id": {"type": "string"},
            "synthesis_status": {"type": "string", "enum": ["complete", "limited"]},
            "bottom_line": {"type": "string"},
            "what_is_new": {
                "type": "object",
                "properties": {
                    "status": {
                        "type": "string",
                        "enum": ["verified_change", "reported_change", "baseline_unknown"],
                    },
                    "summary": {"type": "string"},
                    "evidence_ids": evidence_ids,
                },
                "required": ["status", "summary", "evidence_ids"],
                "additionalProperties": False,
            },
            "transmission_channels": {"type": "array", "items": transmission, "maxItems": 4},
            "priced_in_assessment": {
                "type": "object",
                "properties": {
                    "status": {
                        "type": "string",
                        "enum": ["evidence_supported", "context_only", "not_assessable"],
                    },
                    "conclusion": {"type": "string"},
                },
                "required": ["status", "conclusion"],
                "additionalProperties": False,
            },
            "strongest_counterargument": {"type": "string"},
            "monitoring_signals": {"type": "array", "items": monitor, "maxItems": 5},
            "action_posture": {
                "type": "string",
                "enum": ["watchlist", "wait_for_proof", "pass", "re_underwrite"],
            },
            "data_gaps": {"type": "array", "items": {"type": "string"}},
        },
        "required": [
            "event_id", "synthesis_status", "bottom_line", "what_is_new",
            "transmission_channels", "priced_in_assessment", "strongest_counterargument",
            "monitoring_signals", "action_posture", "data_gaps",
        ],
        "additionalProperties": False,
    }
    return {
        "type": "object",
        "properties": {
            "cross_event_summary": {
                "type": "object",
                "properties": {
                    "dominant_event_id": {"type": "string"},
                    "market_logic": {"type": "string"},
                    "confidence": {"type": "number", "minimum": 0, "maximum": 1},
                    "conflicting_event_ids": {"type": "array", "items": {"type": "string"}},
                    "why_not_higher_confidence": {"type": "string"},
                },
                "required": [
                    "dominant_event_id", "market_logic", "confidence",
                    "conflicting_event_ids", "why_not_higher_confidence",
                ],
                "additionalProperties": False,
            },
            "events": {"type": "array", "items": event_item},
        },
        "required": ["cross_event_summary", "events"],
        "additionalProperties": False,
    }


def bounded_synthesis_input(
    structured: dict[str, Any],
    snapshot: dict[str, Any],
    ranking: list[dict[str, Any]],
    master: dict[str, Any],
    *,
    max_events: int = 3,
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    event_map = {
        str(item.get("event_id") or ""): item
        for item in structured.get("events", [])
    }
    selected_scores = [item for item in ranking if item["eligible_for_synthesis"]][:max_events]
    selected_events: list[dict[str, Any]] = []
    for score in selected_scores:
        event = event_map[str(score["event_id"])]
        selected_events.append({
            "event_id": event.get("event_id"),
            "event_type": event.get("event_type"),
            "representative_title": event.get("representative_title"),
            "evidence_posture": event.get("evidence_posture"),
            "priority": score,
            "facts": event.get("facts", []),
            "reported_claims": event.get("reported_claims", []),
            "expectation_gap": event.get("expectation_gap"),
            "market_reaction_context": event.get("market_reaction"),
            "interpretation_candidates": event.get("interpretation_candidates", []),
            "conflicts": event.get("conflicts", []),
            "existing_sector_connections": event_sector_connections(event, snapshot),
        })
    return {
        "report_date": snapshot.get("report_date"),
        "data_cutoff": snapshot.get("data_cutoff"),
        "portfolio_context": "not_provided",
        "events": selected_events,
        "sector_universe": sector_context(snapshot, master),
    }, selected_scores


def event_evidence_map(structured: dict[str, Any]) -> dict[str, dict[str, dict[str, Any]]]:
    result: dict[str, dict[str, dict[str, Any]]] = {}
    for event in structured.get("events", []):
        result[str(event.get("event_id") or "")] = {
            str(item.get("evidence_id") or ""): item
            for item in event.get("evidence_ledger", [])
        }
    return result


def validate_synthesis(
    synthesis: dict[str, Any],
    selected_scores: list[dict[str, Any]],
    structured: dict[str, Any],
    master: dict[str, Any],
) -> None:
    selected_ids = {str(item["event_id"]) for item in selected_scores}
    returned_ids = [str(item.get("event_id") or "") for item in synthesis.get("events", [])]
    if len(returned_ids) != len(set(returned_ids)) or set(returned_ids) != selected_ids:
        raise ValueError("Event synthesis returned missing, duplicate, or unknown event IDs")
    summary = synthesis.get("cross_event_summary") or {}
    if str(summary.get("dominant_event_id") or "") not in selected_ids:
        raise ValueError("Cross-event summary references an unknown dominant event")
    unknown_conflicts = set(summary.get("conflicting_event_ids", [])) - selected_ids
    if unknown_conflicts:
        raise ValueError("Cross-event summary references unknown conflicting events")

    allowed_sectors = {str(item.get("sector_id") or "") for item in master.get("sectors", [])}
    ledgers = event_evidence_map(structured)
    structured_events = {
        str(item.get("event_id") or ""): item
        for item in structured.get("events", [])
    }
    for event in synthesis.get("events", []):
        event_id = str(event["event_id"])
        ledger = ledgers[event_id]

        def validate_ids(ids: list[str]) -> list[dict[str, Any]]:
            unknown = set(ids) - set(ledger)
            if unknown:
                raise ValueError(
                    f"{event_id} synthesis references unknown evidence IDs: {', '.join(sorted(unknown))}"
                )
            return [ledger[item_id] for item_id in ids]

        new = event.get("what_is_new") or {}
        new_sources = validate_ids(new.get("evidence_ids", []))
        if new.get("status") == "verified_change":
            if not new_sources or any(
                item.get("source_role") != "origin_primary"
                or item.get("evidence_label") != "fact_source_reported"
                for item in new_sources
            ):
                raise ValueError(f"{event_id} verified change lacks primary evidence")
        elif new.get("status") == "reported_change":
            if not any(item.get("source_role") == "representative_secondary" for item in new_sources):
                raise ValueError(f"{event_id} reported change lacks secondary evidence")
        elif new_sources:
            raise ValueError(f"{event_id} baseline_unknown must not cite evidence as a verified change")

        for channel in event.get("transmission_channels", []):
            validate_ids(channel.get("evidence_ids", []))
            if str(channel.get("sector_id") or "") not in allowed_sectors:
                raise ValueError(f"{event_id} references unknown sector")
        for monitor in event.get("monitoring_signals", []):
            validate_ids(monitor.get("evidence_ids", []))
        if event.get("action_posture") not in SAFE_ACTIONS:
            raise ValueError(f"{event_id} contains an unauthorized portfolio action")

        reaction = structured_events[event_id].get("market_reaction") or {}
        reaction_status = reaction.get("status")
        allowed_price_statuses = (
            {"evidence_supported", "context_only", "not_assessable"}
            if reaction_status == "event_window_measured"
            else {"context_only", "not_assessable"}
            if reaction_status in {
                "same_session_context_not_causal",
                "adjacent_close_context_not_causal",
            }
            else {"not_assessable"}
        )
        if (event.get("priced_in_assessment") or {}).get("status") not in allowed_price_statuses:
            raise ValueError(f"{event_id} overstates priced-in evidence")


def canonicalize_synthesis(
    synthesis: dict[str, Any],
    structured: dict[str, Any],
    snapshot: dict[str, Any],
) -> None:
    structured_events = {
        str(item.get("event_id") or ""): item
        for item in structured.get("events", [])
    }
    for event in synthesis.get("events", []):
        event_id = str(event.get("event_id") or "")
        source_event = structured_events.get(event_id, {})
        connections = event_sector_connections(source_event, snapshot)
        for channel in event.get("transmission_channels", []):
            channel["sector_context_status"] = connections.get(
                str(channel.get("sector_id") or ""),
                "candidate_unverified",
            )


def synthesize_with_openai(
    model_input: dict[str, Any],
    selected_scores: list[dict[str, Any]],
    structured: dict[str, Any],
    master: dict[str, Any],
) -> tuple[dict[str, Any], dict[str, Any]]:
    api_key = os.getenv("OPENAI_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY is missing")
    model = os.getenv("OPENAI_EVENT_SYNTHESIS_MODEL", "gpt-5").strip()
    sector_ids = [str(item.get("sector_id") or "") for item in master.get("sectors", [])]
    instructions = """You are the senior public-equity synthesis stage for a Korean PB daily brief.
Use only the supplied structured events and sector universe.

Build event -> transmission channel -> first repricing variable -> sector -> financial line item implications.
Keep verified facts, unverified secondary reports, and hypotheses visibly separate.
Every what-is-new or transmission claim must cite supplied evidence_ids exactly.
Do not create facts, URLs, prices, consensus, dates, issuer exposure, sector IDs, or causal market reactions.
Existing daily returns are context only when marked non-causal. In that case priced-in status must be context_only,
not proof that the event is priced. If price context is absent or stale, use not_assessable.
Sector outputs are research candidates, not recommendations. Do not name issuers.
No portfolio was supplied, so action_posture is limited to watchlist, wait_for_proof, pass, or re_underwrite.
State the strongest counterargument and concrete confirmation/falsification signals.
Write all reader-facing strings in concise Korean."""
    body = json.dumps({
        "model": model,
        "instructions": instructions,
        "input": json.dumps(model_input, ensure_ascii=False),
        "reasoning": {"effort": "medium"},
        "text": {"format": {
            "type": "json_schema",
            "name": "event_impact_synthesis",
            "description": "Evidence-bound public-equity impact synthesis for ranked events.",
            "strict": True,
            "schema": synthesis_schema(sector_ids),
        }},
        "max_output_tokens": 5000,
        "store": False,
    }, ensure_ascii=False).encode("utf-8")
    request = Request("https://api.openai.com/v1/responses", method="POST", data=body, headers={
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    })
    try:
        with urlopen(request, timeout=120) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"OpenAI event synthesis returned HTTP {exc.code}: {detail}") from exc
    if payload.get("status") == "incomplete":
        reason = (payload.get("incomplete_details") or {}).get("reason", "unknown")
        raise RuntimeError(f"OpenAI event synthesis was incomplete ({reason})")
    text = response_text(payload)
    if not text:
        raise RuntimeError("OpenAI returned no event impact synthesis")
    synthesis = json.loads(text)
    validate_synthesis(synthesis, selected_scores, structured, master)
    return synthesis, payload.get("usage", {})


def fallback_synthesis(selected_scores: list[dict[str, Any]], reason: str) -> dict[str, Any]:
    return {
        "status": "not_run",
        "fallback_reason": reason,
        "cross_event_summary": None,
        "events": [],
        "selected_event_ids": [item["event_id"] for item in selected_scores],
    }


def assemble_payload(
    snapshot: dict[str, Any],
    ranking: list[dict[str, Any]],
    selected_scores: list[dict[str, Any]],
    synthesis: dict[str, Any],
    *,
    usage: dict[str, Any] | None = None,
) -> dict[str, Any]:
    completed = bool(synthesis.get("events"))
    return {
        "schema_version": "event_impact_synthesis.v1",
        "report_date": snapshot.get("report_date"),
        "support_context": {
            "owning_workflow": "economic-impact-report",
            "decision_impact": "Ranks events and maps verified evidence into public-equity transmission hypotheses.",
            "readiness_effect": "research_grade" if completed else "needs_targeted_fixes",
            "artifact_role": "embedded_support_artifact",
            "hidden_unless_requested": True,
        },
        "ranking_method": {
            "maximum_score": 100,
            "price_reaction_rule": (
                "No price-reaction points unless an actual announcement-window measurement exists. "
                "Same-session and adjacent-close returns are context only."
            ),
        },
        "event_ranking": ranking,
        "selected_event_ids": [item["event_id"] for item in selected_scores],
        "synthesis_status": "completed" if completed else synthesis.get("status", "not_run"),
        "fallback_reason": synthesis.get("fallback_reason"),
        "cross_event_summary": synthesis.get("cross_event_summary"),
        "events": synthesis.get("events", []),
        "usage": usage or {},
    }


def merge_targeted_synthesis(
    existing: dict[str, Any],
    targeted: dict[str, Any],
    *,
    event_id: str,
) -> dict[str, Any]:
    if (
        existing.get("schema_version") != "event_impact_synthesis.v1"
        or existing.get("report_date") != targeted.get("report_date")
    ):
        return targeted
    old_events = [
        row
        for row in existing.get("events") or []
        if str(row.get("event_id") or "") != event_id
    ]
    new_events = [
        row
        for row in targeted.get("events") or []
        if str(row.get("event_id") or "") == event_id
    ]
    merged = dict(targeted)
    merged["events"] = [*old_events, *new_events]
    merged["selected_event_ids"] = list(
        dict.fromkeys(
            [
                *existing.get("selected_event_ids", []),
                *targeted.get("selected_event_ids", []),
            ]
        )
    )
    if old_events and existing.get("cross_event_summary"):
        merged["cross_event_summary"] = existing["cross_event_summary"]
    merged["synthesis_status"] = (
        "completed" if merged["events"] else targeted["synthesis_status"]
    )
    return merged


def main() -> None:
    parser = argparse.ArgumentParser(description="Rank and synthesize structured event impacts.")
    parser.add_argument("--date", required=True)
    parser.add_argument("--snapshot-file")
    parser.add_argument("--structured-file")
    parser.add_argument("--event-id")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    load_dotenv()

    snapshot_path = Path(args.snapshot_file) if args.snapshot_file else (
        ROOT / "workspace" / "snapshots" / args.date / "daily_snapshot.json"
    )
    structured_path = Path(args.structured_file) if args.structured_file else (
        ROOT / "workspace" / "event_evidence" / args.date / "structured_event_evidence.json"
    )
    snapshot = json.loads(snapshot_path.read_text(encoding="utf-8"))
    structured = json.loads(structured_path.read_text(encoding="utf-8"))
    master = load_sector_master()
    ranking = rank_events(structured, snapshot)
    if args.event_id:
        matching = [
            item
            for item in ranking
            if str(item.get("event_id") or "") == args.event_id
        ]
        if len(matching) != 1:
            raise SystemExit(
                f"Exactly one structured event is required: {args.event_id}"
            )
    max_events = int(os.getenv("EVENT_SYNTHESIS_MAX_EVENTS", "3"))
    if args.event_id:
        if not matching[0]["eligible_for_synthesis"]:
            raise SystemExit(
                f"Event is not eligible for synthesis: {args.event_id}"
            )
        model_input, selected_scores = bounded_synthesis_input(
            structured,
            snapshot,
            matching,
            master,
            max_events=1,
        )
    else:
        model_input, selected_scores = bounded_synthesis_input(
            structured,
            snapshot,
            ranking,
            master,
            max_events=max_events,
        )

    if not selected_scores:
        synthesis = fallback_synthesis([], "no_eligible_events")
        usage: dict[str, Any] = {}
    elif args.dry_run:
        synthesis = fallback_synthesis(selected_scores, "dry_run")
        usage = {}
    else:
        try:
            synthesis, usage = synthesize_with_openai(
                model_input,
                selected_scores,
                structured,
                master,
            )
            canonicalize_synthesis(synthesis, structured, snapshot)
        except Exception as exc:
            synthesis = fallback_synthesis(selected_scores, type(exc).__name__)
            usage = {}
            print(f"Event impact synthesis fallback: {type(exc).__name__}: {exc}")

    payload = assemble_payload(
        snapshot,
        ranking,
        selected_scores,
        synthesis,
        usage=usage,
    )
    output_dir = ROOT / "workspace" / "analysis" / args.date
    output_dir.mkdir(parents=True, exist_ok=True)
    output = output_dir / "event_impact_synthesis.json"
    if args.event_id and output.exists():
        existing = json.loads(output.read_text(encoding="utf-8-sig"))
        payload = merge_targeted_synthesis(
            existing,
            payload,
            event_id=args.event_id,
        )
    output.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    snapshot["event_impact_synthesis"] = payload
    snapshot_path.write_text(json.dumps(snapshot, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Event impact synthesis saved: {output.relative_to(ROOT)}")
    print(
        f"Ranked events={len(ranking)}, selected={len(selected_scores)}, "
        f"status={payload['synthesis_status']}"
    )


if __name__ == "__main__":
    main()
