"""Materialize eligible research tasks without invoking a model or external action."""

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

SCHEMA_VERSION = "research_execution_pack.v1"
MAX_WORK_ITEMS = 11
ELIGIBLE_READINESS = {"ready_for_research"}
ALLOWED_EXECUTION_STATUSES = {
    "existing_output_attached",
    "prepared_for_specialist",
    "awaiting_matching_output",
}


def load_json(path: Path, *, required: bool = True) -> dict[str, Any]:
    if not path.exists():
        if required:
            raise FileNotFoundError(path)
        return {}
    payload = json.loads(path.read_text(encoding="utf-8-sig"))
    if not isinstance(payload, dict):
        raise ValueError(f"Expected a JSON object: {path}")
    return payload


def _stable_input_hash(payload: dict[str, Any]) -> str:
    canonical = json.dumps(
        payload,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return hashlib.sha256(canonical).hexdigest()


def _event_by_id(daily_intelligence: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {
        str(event.get("event_id")): event
        for event in (daily_intelligence.get("events") or {}).get("items") or []
        if isinstance(event, dict) and event.get("event_id")
    }


def _reviews_by_ticker(
    earnings_deep_dive: dict[str, Any],
) -> dict[str, dict[str, Any]]:
    return {
        str(review.get("ticker") or "").upper(): review
        for review in earnings_deep_dive.get("reviews") or []
        if isinstance(review, dict) and review.get("ticker")
    }


def _market_input(daily_intelligence: dict[str, Any]) -> dict[str, Any]:
    market = daily_intelligence.get("market") or {}
    return {
        "regime": deepcopy(market.get("regime") or {}),
        "key_drivers": deepcopy((market.get("key_drivers") or [])[:3]),
        "conflicting_signals": deepcopy(
            (market.get("conflicting_signals") or [])[:5]
        ),
        "top_risks": deepcopy((market.get("top_risks") or [])[:5]),
        "scoreboard": deepcopy(market.get("scoreboard") or {}),
        "day_over_day_changes": deepcopy(
            market.get("day_over_day_changes") or {}
        ),
        "data_cutoff": deepcopy(market.get("data_cutoff") or {}),
    }


def _korea_input(daily_intelligence: dict[str, Any]) -> dict[str, Any]:
    return deepcopy(
        (daily_intelligence.get("market") or {}).get(
            "korea_transmission_inputs"
        )
        or {}
    )


def _event_input(event: dict[str, Any]) -> dict[str, Any]:
    verification = event.get("verification") or {}
    if not verification.get("primary_fact_confirmed"):
        raise ValueError("Unverified event cannot enter a research execution pack")
    return {
        "event_id": event.get("event_id"),
        "event_type": event.get("event_type"),
        "title": event.get("title"),
        "listed_entities": deepcopy(event.get("listed_entities") or []),
        "topic_tags": deepcopy(event.get("topic_tags") or []),
        "event_window": deepcopy(event.get("event_window") or {}),
        "common_facts": deepcopy(event.get("common_facts") or []),
        "official_sources": deepcopy(event.get("official_sources") or []),
        "expectation_gap": deepcopy(event.get("expectation_gap") or {}),
        "market_reaction": deepcopy(event.get("market_reaction") or {}),
        "impact_analysis": deepcopy(event.get("impact_analysis") or {}),
        "conflicting_claims": deepcopy(
            (event.get("conflicting_claims") or [])[:8]
        ),
        "verification": {
            "primary_fact_confirmed": True,
            "extraction_status": verification.get("extraction_status"),
            "evidence_posture": verification.get("evidence_posture"),
        },
    }


def _materialize_task(
    task: dict[str, Any],
    *,
    daily_intelligence: dict[str, Any],
    events: dict[str, dict[str, Any]],
    earnings_reviews: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    scope = str(task.get("scope") or "")
    workflow = str(task.get("lead_workflow") or "")
    source_paths: list[str] = [
        (
            "workspace/intelligence/"
            f"{daily_intelligence.get('report_date')}/daily_intelligence.json"
        )
    ]
    attached_outputs: dict[str, Any] = {}

    if scope == "market":
        prepared_input = _market_input(daily_intelligence)
        status = "existing_output_attached"
        attached_outputs["market_analysis"] = deepcopy(prepared_input)
        source_paths.append(
            "workspace/analysis/"
            f"{daily_intelligence.get('report_date')}/market_analysis.json"
        )
    elif scope == "korea_transmission":
        prepared_input = _korea_input(daily_intelligence)
        status = "existing_output_attached"
        attached_outputs["korea_market_inputs"] = deepcopy(prepared_input)
    elif scope == "event":
        event_id = str(task.get("event_id") or "")
        if event_id not in events:
            raise ValueError(f"Routed event is absent from Daily Intelligence: {event_id}")
        prepared_input = _event_input(events[event_id])
        if workflow == "earnings-deep-dive":
            tickers = [
                str(value).upper()
                for value in task.get("listed_entities") or []
                if value
            ]
            matched = [
                deepcopy(earnings_reviews[ticker])
                for ticker in tickers
                if ticker in earnings_reviews
            ]
            if matched:
                status = "existing_output_attached"
                attached_outputs["earnings_deep_dive_reviews"] = matched
                source_paths.append(
                    "workspace/company_earnings_deep_dive/"
                    f"{daily_intelligence.get('report_date')}/"
                    "company_earnings_deep_dive.json"
                )
            else:
                status = "awaiting_matching_output"
        elif (
            workflow == "economic-impact-report"
            and prepared_input.get("impact_analysis")
        ):
            status = "existing_output_attached"
            attached_outputs["economic_impact_analysis"] = deepcopy(
                prepared_input["impact_analysis"]
            )
            source_paths.append(
                "workspace/analysis/"
                f"{daily_intelligence.get('report_date')}/"
                "event_impact_synthesis.json"
            )
        else:
            status = "prepared_for_specialist"
    else:
        raise ValueError(f"Unsupported eligible research task scope: {scope}")

    work_item = {
        "task_id": task.get("task_id"),
        "scope": scope,
        "event_id": task.get("event_id"),
        "lead_workflow": workflow,
        "execution_status": status,
        "prepared_input": prepared_input,
        "attached_outputs": attached_outputs,
        "source_paths": sorted(set(source_paths)),
        "decision_limits": {
            "research_support_only": True,
            "investment_recommendation": False,
            "position_action": False,
            "automatic_publication": False,
        },
    }
    work_item["input_hash"] = _stable_input_hash(prepared_input)
    return work_item


def build_research_execution_pack(
    task_plan: dict[str, Any],
    daily_intelligence: dict[str, Any],
    *,
    earnings_deep_dive: dict[str, Any] | None = None,
    generated_at: str | None = None,
) -> dict[str, Any]:
    if task_plan.get("schema_version") != "research_task_plan.v1":
        raise ValueError("Unsupported research task plan input schema")
    if daily_intelligence.get("schema_version") != "daily_market_intelligence.v2":
        raise ValueError("Unsupported Daily Intelligence input schema")
    report_date = str(task_plan.get("report_date") or "")
    if not report_date or daily_intelligence.get("report_date") != report_date:
        raise ValueError("Research task plan and Daily Intelligence dates differ")

    tasks = task_plan.get("tasks") or []
    eligible_tasks = [
        task
        for task in tasks
        if isinstance(task, dict)
        and task.get("readiness") in ELIGIBLE_READINESS
    ][:MAX_WORK_ITEMS]
    events = _event_by_id(daily_intelligence)
    earnings_reviews = _reviews_by_ticker(earnings_deep_dive or {})
    work_items = [
        _materialize_task(
            task,
            daily_intelligence=daily_intelligence,
            events=events,
            earnings_reviews=earnings_reviews,
        )
        for task in eligible_tasks
    ]
    status_counts: dict[str, int] = {}
    for item in work_items:
        status = str(item["execution_status"])
        status_counts[status] = status_counts.get(status, 0) + 1
    blocked_tasks = [
        {
            "task_id": task.get("task_id"),
            "scope": task.get("scope"),
            "event_id": task.get("event_id"),
            "lead_workflow": task.get("lead_workflow"),
            "readiness": task.get("readiness"),
            "reason_codes": deepcopy(task.get("reason_codes") or []),
        }
        for task in tasks
        if isinstance(task, dict)
        and task.get("readiness") not in ELIGIBLE_READINESS
    ]

    pack = {
        "schema_version": SCHEMA_VERSION,
        "report_date": report_date,
        "generated_at": generated_at
        or datetime.now(ZoneInfo("Asia/Seoul")).isoformat(),
        "input_task_plan_schema": task_plan.get("schema_version"),
        "summary": {
            "planned_task_count": len(tasks),
            "eligible_task_count": len(eligible_tasks),
            "work_item_count": len(work_items),
            "blocked_task_count": len(blocked_tasks),
            "execution_status_counts": status_counts,
        },
        "work_items": work_items,
        "blocked_tasks": blocked_tasks,
        "policy": {
            "existing_outputs_only": True,
            "model_invocation_performed": False,
            "external_action_performed": False,
            "automatic_publication": False,
            "automatic_memory_mutation": False,
            "position_actions_allowed": False,
            "human_facing_hero_artifact": False,
        },
    }
    validate_research_execution_pack(pack)
    return pack


def validate_research_execution_pack(pack: dict[str, Any]) -> None:
    if pack.get("schema_version") != SCHEMA_VERSION:
        raise ValueError("Unsupported research execution pack schema")
    work_items = pack.get("work_items") or []
    if len(work_items) > MAX_WORK_ITEMS:
        raise ValueError("Research execution pack work item limit exceeded")
    task_ids = [str(item.get("task_id") or "") for item in work_items]
    if not all(task_ids) or len(task_ids) != len(set(task_ids)):
        raise ValueError("Work item task IDs must be present and unique")
    for item in work_items:
        if item.get("execution_status") not in ALLOWED_EXECUTION_STATUSES:
            raise ValueError("Unsupported research execution status")
        limits = item.get("decision_limits") or {}
        if (
            limits.get("investment_recommendation")
            or limits.get("position_action")
            or limits.get("automatic_publication")
        ):
            raise ValueError("Research pack cannot authorize an investment action")
    policy = pack.get("policy") or {}
    if (
        policy.get("model_invocation_performed")
        or policy.get("external_action_performed")
        or policy.get("automatic_publication")
        or policy.get("automatic_memory_mutation")
        or policy.get("position_actions_allowed")
        or policy.get("human_facing_hero_artifact")
    ):
        raise ValueError("Research execution pack must remain a support artifact")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Materialize eligible research tasks from existing outputs"
    )
    parser.add_argument("--date", required=True)
    args = parser.parse_args()
    intelligence_dir = ROOT / "workspace" / "intelligence" / args.date
    pack = build_research_execution_pack(
        load_json(intelligence_dir / "research_task_plan.json"),
        load_json(intelligence_dir / "daily_intelligence.json"),
        earnings_deep_dive=load_json(
            ROOT
            / "workspace"
            / "company_earnings_deep_dive"
            / args.date
            / "company_earnings_deep_dive.json",
            required=False,
        ),
    )
    output = intelligence_dir / "research_execution_pack.json"
    output.write_text(
        json.dumps(pack, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"Research execution pack saved: {output.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
