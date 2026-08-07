"""Build a deterministic, non-executing research task plan from Daily Intelligence."""

from __future__ import annotations

import argparse
import hashlib
import json
from copy import deepcopy
from datetime import datetime
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

from collectors.common import ROOT

SCHEMA_VERSION = "research_task_plan.v1"
MAX_EVENT_TASKS = 8
SUPPORTED_WORKFLOWS = {
    "economic-impact-report",
    "earnings-deep-dive",
    "event-driven-analyzer",
    "idea-generation",
    "thesis-tracker",
}

EVENT_ROUTES = {
    "monetary_policy": ("economic-impact-report", "analyze_market_snapshot.py"),
    "economic_data": ("economic-impact-report", "analyze_market_snapshot.py"),
    "regulation_policy": ("economic-impact-report", None),
    "commodity_supply": ("economic-impact-report", None),
    "geopolitics": ("economic-impact-report", None),
    "market_structure": ("economic-impact-report", None),
    "earnings_guidance": (
        "earnings-deep-dive",
        "build_company_earnings_deep_dive.py",
    ),
    "corporate_action": ("event-driven-analyzer", None),
    "other": ("idea-generation", None),
}


def load_json(path: Path) -> dict[str, Any]:
    payload = json.loads(path.read_text(encoding="utf-8-sig"))
    if not isinstance(payload, dict):
        raise ValueError(f"Expected a JSON object: {path}")
    return payload


def _stable_task_id(scope: str, event_id: str | None, workflow: str) -> str:
    raw = f"{scope}|{event_id or 'global'}|{workflow}".encode("utf-8")
    return f"task-{hashlib.sha256(raw).hexdigest()[:16]}"


def _event_route(event_type: Any) -> tuple[str, str | None]:
    normalized = str(event_type or "other").strip().casefold()
    return EVENT_ROUTES.get(normalized, EVENT_ROUTES["other"])


def _event_readiness(
    event: dict[str, Any],
    *,
    workflow: str,
) -> tuple[str, list[str]]:
    verification = event.get("verification") or {}
    confirmed = bool(verification.get("primary_fact_confirmed"))
    listed_entities = [
        value for value in event.get("listed_entities") or [] if value
    ]
    reasons: list[str] = []

    if not confirmed:
        reasons.append("primary_fact_not_confirmed")
    if (
        workflow in {"earnings-deep-dive", "event-driven-analyzer"}
        and not listed_entities
    ):
        reasons.append("listed_entity_not_mapped")

    if "primary_fact_not_confirmed" in reasons:
        return "needs_evidence", reasons
    if "listed_entity_not_mapped" in reasons:
        return "needs_entity_mapping", reasons
    return "ready_for_research", ["minimum_inputs_available"]


def _event_task(event: dict[str, Any]) -> dict[str, Any]:
    event_id = str(event.get("event_id") or "")
    workflow, executor = _event_route(event.get("event_type"))
    readiness, reasons = _event_readiness(event, workflow=workflow)
    return {
        "task_id": _stable_task_id("event", event_id, workflow),
        "scope": "event",
        "event_id": event_id,
        "event_type": event.get("event_type") or "other",
        "title": event.get("title"),
        "entity_candidates": deepcopy(event.get("entities") or []),
        "listed_entities": deepcopy(event.get("listed_entities") or []),
        "topic_tags": deepcopy(event.get("topic_tags") or []),
        "lead_workflow": workflow,
        "existing_executor": executor,
        "readiness": readiness,
        "reason_codes": reasons,
        "source_requirements": {
            "primary_fact_required": True,
            "primary_fact_confirmed": bool(
                (event.get("verification") or {}).get("primary_fact_confirmed")
            ),
            "listed_entity_required": workflow
            in {"earnings-deep-dive", "event-driven-analyzer"},
        },
        "automatic_execution_allowed": False,
        "requires_operator_confirmation": True,
        "position_action_allowed": False,
    }


def _global_tasks(packet: dict[str, Any]) -> list[dict[str, Any]]:
    market = packet.get("market") or {}
    korea = market.get("korea_transmission_inputs") or {}
    korea_available = str(korea.get("status") or "").casefold() in {
        "available",
        "complete",
        "completed",
        "ok",
    }
    continuity = packet.get("continuity") or {}
    active_entries = continuity.get("active_entries") or []
    return [
        {
            "task_id": _stable_task_id(
                "market", None, "economic-impact-report"
            ),
            "scope": "market",
            "event_id": None,
            "lead_workflow": "economic-impact-report",
            "existing_executor": "analyze_market_snapshot.py",
            "readiness": (
                "ready_for_research"
                if market.get("regime")
                else "needs_market_snapshot"
            ),
            "reason_codes": [
                "market_analysis_available"
                if market.get("regime")
                else "market_analysis_missing"
            ],
            "automatic_execution_allowed": False,
            "requires_operator_confirmation": True,
            "position_action_allowed": False,
        },
        {
            "task_id": _stable_task_id(
                "korea_transmission", None, "economic-impact-report"
            ),
            "scope": "korea_transmission",
            "event_id": None,
            "lead_workflow": "economic-impact-report",
            "existing_executor": "collect_korea_market.py",
            "readiness": (
                "ready_for_research"
                if korea_available
                else "needs_korea_market_inputs"
            ),
            "reason_codes": [
                "korea_market_inputs_available"
                if korea_available
                else "korea_market_inputs_incomplete"
            ],
            "automatic_execution_allowed": False,
            "requires_operator_confirmation": True,
            "position_action_allowed": False,
        },
        {
            "task_id": _stable_task_id(
                "continuity", None, "thesis-tracker"
            ),
            "scope": "continuity",
            "event_id": None,
            "lead_workflow": "thesis-tracker",
            "existing_executor": "build_continuity_memory.py",
            "readiness": (
                "ready_for_review" if active_entries else "no_active_entries"
            ),
            "reason_codes": [
                "active_continuity_entries_present"
                if active_entries
                else "active_continuity_entries_absent"
            ],
            "automatic_execution_allowed": False,
            "requires_operator_confirmation": True,
            "position_action_allowed": False,
        },
    ]


def build_research_task_plan(
    daily_intelligence: dict[str, Any],
    *,
    generated_at: str | None = None,
    max_event_tasks: int = MAX_EVENT_TASKS,
) -> dict[str, Any]:
    if daily_intelligence.get("schema_version") != "daily_market_intelligence.v2":
        raise ValueError("Unsupported Daily Intelligence input schema")
    if max_event_tasks < 1 or max_event_tasks > MAX_EVENT_TASKS:
        raise ValueError(
            f"max_event_tasks must be between 1 and {MAX_EVENT_TASKS}"
        )

    event_items = (daily_intelligence.get("events") or {}).get("items") or []
    event_tasks = [
        _event_task(event)
        for event in event_items[:max_event_tasks]
        if isinstance(event, dict) and event.get("event_id")
    ]
    tasks = _global_tasks(daily_intelligence) + event_tasks
    readiness_counts: dict[str, int] = {}
    workflow_counts: dict[str, int] = {}
    for task in tasks:
        readiness = str(task["readiness"])
        workflow = str(task["lead_workflow"])
        readiness_counts[readiness] = readiness_counts.get(readiness, 0) + 1
        workflow_counts[workflow] = workflow_counts.get(workflow, 0) + 1

    plan = {
        "schema_version": SCHEMA_VERSION,
        "report_date": daily_intelligence.get("report_date"),
        "generated_at": generated_at
        or datetime.now(ZoneInfo("Asia/Seoul")).isoformat(),
        "input_schema_version": daily_intelligence.get("schema_version"),
        "summary": {
            "task_count": len(tasks),
            "event_task_count": len(event_tasks),
            "readiness_counts": readiness_counts,
            "workflow_counts": workflow_counts,
        },
        "tasks": tasks,
        "policy": {
            "deterministic_routing_only": True,
            "automatic_execution": False,
            "automatic_publication": False,
            "automatic_memory_mutation": False,
            "position_actions_allowed": False,
            "operator_confirmation_required": True,
        },
    }
    validate_research_task_plan(plan)
    return plan


def validate_research_task_plan(plan: dict[str, Any]) -> None:
    if plan.get("schema_version") != SCHEMA_VERSION:
        raise ValueError("Unsupported research task plan schema")
    tasks = plan.get("tasks") or []
    task_ids = [str(task.get("task_id") or "") for task in tasks]
    if not all(task_ids) or len(task_ids) != len(set(task_ids)):
        raise ValueError("Research task IDs must be present and unique")
    for task in tasks:
        if task.get("lead_workflow") not in SUPPORTED_WORKFLOWS:
            raise ValueError("Unsupported public-equity research workflow")
        if task.get("automatic_execution_allowed"):
            raise ValueError("Research routing cannot authorize execution")
        if task.get("position_action_allowed"):
            raise ValueError("Research routing cannot authorize position actions")
    policy = plan.get("policy") or {}
    if (
        policy.get("automatic_execution")
        or policy.get("automatic_publication")
        or policy.get("automatic_memory_mutation")
        or policy.get("position_actions_allowed")
    ):
        raise ValueError("Research task plan cannot authorize external actions")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Build a non-executing research task plan"
    )
    parser.add_argument("--date", required=True)
    parser.add_argument(
        "--max-event-tasks",
        type=int,
        default=MAX_EVENT_TASKS,
    )
    args = parser.parse_args()
    input_path = (
        ROOT
        / "workspace"
        / "intelligence"
        / args.date
        / "daily_intelligence.json"
    )
    plan = build_research_task_plan(
        load_json(input_path),
        max_event_tasks=args.max_event_tasks,
    )
    output = input_path.parent / "research_task_plan.json"
    output.write_text(
        json.dumps(plan, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"Research task plan saved: {output.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
