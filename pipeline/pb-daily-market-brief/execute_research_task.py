"""Execute exactly one operator-approved research task through an allowlisted specialist."""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from datetime import date, datetime
from pathlib import Path
from typing import Any, Callable
from zoneinfo import ZoneInfo

from build_research_execution_pack import (
    SCHEMA_VERSION as PACK_SCHEMA_VERSION,
    validate_research_execution_pack,
)
from collectors.common import ROOT

CONFIRMATION_PHRASE = "EXECUTE_RESEARCH_TASK"
RECEIPT_SCHEMA_VERSION = "research_task_execution_receipt.v1"
EXECUTABLE_STATUSES = {
    "prepared_for_specialist",
    "awaiting_matching_output",
}
SUCCESS_OUTCOMES = {"completed"}
MAX_CAPTURE_CHARS = 4000

SPECIALIST_ALLOWLIST: dict[tuple[str, str], dict[str, Any]] = {
    ("event", "economic-impact-report"): {
        "script": "synthesize_event_impacts.py",
        "model_invocation_possible": True,
        "expected_outputs": [
            "workspace/analysis/{date}/event_impact_synthesis.json",
        ],
    },
    ("event", "earnings-deep-dive"): {
        "script": "build_company_earnings_deep_dive.py",
        "model_invocation_possible": False,
        "expected_outputs": [
            (
                "workspace/company_earnings_deep_dive/{date}/"
                "company_earnings_deep_dive.json"
            ),
        ],
    },
}

REFRESH_SCRIPTS = (
    "build_daily_intelligence.py",
    "route_intelligence_tasks.py",
    "build_research_execution_pack.py",
)


def load_json(path: Path) -> dict[str, Any]:
    payload = json.loads(path.read_text(encoding="utf-8-sig"))
    if not isinstance(payload, dict):
        raise ValueError(f"Expected a JSON object: {path}")
    return payload


def list_executable_tasks(
    pack: dict[str, Any],
    *,
    prior_receipts: list[dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    validate_research_execution_pack(pack)
    rows: list[dict[str, Any]] = []
    for item in pack.get("work_items") or []:
        route = (
            str(item.get("scope") or ""),
            str(item.get("lead_workflow") or ""),
        )
        if (
            item.get("execution_status") in EXECUTABLE_STATUSES
            and route in SPECIALIST_ALLOWLIST
            and not _is_duplicate_execution(
                prior_receipts or [],
                task_id=str(item.get("task_id") or ""),
                input_hash=str(item.get("input_hash") or ""),
            )
        ):
            rows.append(
                {
                    "task_id": item.get("task_id"),
                    "scope": route[0],
                    "event_id": item.get("event_id"),
                    "lead_workflow": route[1],
                    "execution_status": item.get("execution_status"),
                    "input_hash": item.get("input_hash"),
                }
            )
    return rows


def _find_task(pack: dict[str, Any], task_id: str) -> dict[str, Any]:
    matches = [
        item
        for item in pack.get("work_items") or []
        if str(item.get("task_id") or "") == str(task_id or "")
    ]
    if len(matches) != 1:
        raise ValueError("Exactly one matching research task is required")
    return matches[0]


def _validate_report_date(value: str) -> str:
    try:
        parsed = date.fromisoformat(value)
    except ValueError as exc:
        raise ValueError("Research task report date must use YYYY-MM-DD") from exc
    return parsed.isoformat()


def _is_duplicate_execution(
    prior_receipts: list[dict[str, Any]],
    *,
    task_id: str,
    input_hash: str,
) -> bool:
    return any(
        receipt.get("schema_version") == RECEIPT_SCHEMA_VERSION
        and receipt.get("task_id") == task_id
        and receipt.get("input_hash") == input_hash
        and receipt.get("outcome") in SUCCESS_OUTCOMES
        for receipt in prior_receipts
        if isinstance(receipt, dict)
    )


def build_execution_plan(
    pack: dict[str, Any],
    *,
    task_id: str,
    expected_input_hash: str,
    requested_by: str,
    execution_note: str,
    confirmation: str,
    prior_receipts: list[dict[str, Any]] | None = None,
    dry_run: bool = False,
) -> dict[str, Any]:
    validate_research_execution_pack(pack)
    if pack.get("schema_version") != PACK_SCHEMA_VERSION:
        raise ValueError("Unsupported research execution pack schema")
    report_date = _validate_report_date(str(pack.get("report_date") or ""))
    item = _find_task(pack, task_id)
    current_hash = str(item.get("input_hash") or "")
    if not current_hash or expected_input_hash != current_hash:
        raise ValueError(
            "Expected input hash does not match the current research work item"
        )
    if item.get("execution_status") not in EXECUTABLE_STATUSES:
        raise ValueError(
            "Research task is not executable in its current status"
        )

    route = (
        str(item.get("scope") or ""),
        str(item.get("lead_workflow") or ""),
    )
    specialist = SPECIALIST_ALLOWLIST.get(route)
    if specialist is None:
        raise ValueError(
            "No allowlisted specialist executor exists for this research task"
        )
    if not dry_run:
        if confirmation != CONFIRMATION_PHRASE:
            raise ValueError(
                "Actual execution requires the exact confirmation phrase "
                f"{CONFIRMATION_PHRASE}"
            )
        if not str(requested_by or "").strip():
            raise ValueError("Actual execution requires a requester identity")
        if not str(execution_note or "").strip():
            raise ValueError("Actual execution requires an execution note")

    if _is_duplicate_execution(
        prior_receipts or [],
        task_id=str(item["task_id"]),
        input_hash=current_hash,
    ):
        raise ValueError(
            "This exact research task input was already executed successfully"
        )

    command_specs = [
        {
            "command_id": f"specialist:{route[1]}",
            "argv": [
                sys.executable,
                str(ROOT / specialist["script"]),
                "--date",
                report_date,
            ],
        }
    ]
    specialist_argv = command_specs[0]["argv"]
    if route == ("event", "economic-impact-report"):
        event_id = str(item.get("event_id") or "")
        if not event_id:
            raise ValueError("Economic-impact execution requires one event ID")
        specialist_argv.extend(["--event-id", event_id])
    elif route == ("event", "earnings-deep-dive"):
        tickers = [
            str(value).upper()
            for value in (item.get("prepared_input") or {}).get(
                "listed_entities"
            )
            or []
            if value
        ]
        if not tickers:
            raise ValueError(
                "Earnings deep-dive execution requires a listed ticker"
            )
        for ticker in sorted(set(tickers)):
            specialist_argv.extend(["--ticker", ticker])
    command_specs.extend(
        {
            "command_id": f"refresh:{script}",
            "argv": [
                sys.executable,
                str(ROOT / script),
                "--date",
                report_date,
            ],
        }
        for script in REFRESH_SCRIPTS
    )
    return {
        "schema_version": "research_task_execution_plan.v1",
        "report_date": report_date,
        "task_id": str(item["task_id"]),
        "event_id": item.get("event_id"),
        "scope": route[0],
        "lead_workflow": route[1],
        "input_hash": current_hash,
        "requested_by": str(requested_by or "").strip() or "dry_run",
        "execution_note": (
            str(execution_note or "").strip() or "validation only"
        ),
        "dry_run": dry_run,
        "commands": command_specs,
        "expected_outputs": [
            path.format(date=report_date)
            for path in specialist["expected_outputs"]
        ],
        "model_invocation_possible": bool(
            specialist["model_invocation_possible"]
        ),
        "decision_limits": {
            "research_support_only": True,
            "automatic_publication": False,
            "automatic_memory_mutation": False,
            "investment_recommendation": False,
            "position_action": False,
        },
    }


def _capture(value: str | None) -> str:
    return str(value or "")[-MAX_CAPTURE_CHARS:]


def execute_plan(
    plan: dict[str, Any],
    *,
    runner: Callable[..., subprocess.CompletedProcess[str]] = subprocess.run,
    executed_at: str | None = None,
) -> dict[str, Any]:
    if plan.get("schema_version") != "research_task_execution_plan.v1":
        raise ValueError("Unsupported research task execution plan")
    if plan.get("dry_run"):
        return _build_receipt(
            plan,
            outcome="validated_only",
            command_results=[],
            executed_at=executed_at,
        )

    command_results: list[dict[str, Any]] = []
    for command in plan.get("commands") or []:
        result = runner(
            command["argv"],
            cwd=ROOT,
            check=True,
            capture_output=True,
            text=True,
            shell=False,
        )
        command_results.append(
            {
                "command_id": command["command_id"],
                "returncode": result.returncode,
                "stdout_tail": _capture(result.stdout),
                "stderr_tail": _capture(result.stderr),
            }
        )
    return _build_receipt(
        plan,
        outcome="completed",
        command_results=command_results,
        executed_at=executed_at,
    )


def _build_receipt(
    plan: dict[str, Any],
    *,
    outcome: str,
    command_results: list[dict[str, Any]],
    executed_at: str | None,
) -> dict[str, Any]:
    return {
        "schema_version": RECEIPT_SCHEMA_VERSION,
        "report_date": plan["report_date"],
        "task_id": plan["task_id"],
        "event_id": plan.get("event_id"),
        "scope": plan["scope"],
        "lead_workflow": plan["lead_workflow"],
        "input_hash": plan["input_hash"],
        "requested_by": plan["requested_by"],
        "execution_note": plan["execution_note"],
        "executed_at": executed_at
        or datetime.now(ZoneInfo("Asia/Seoul")).isoformat(),
        "dry_run": bool(plan["dry_run"]),
        "outcome": outcome,
        "command_results": command_results,
        "expected_outputs": plan["expected_outputs"],
        "model_invocation_possible": plan["model_invocation_possible"],
        "automatic_publication": False,
        "automatic_memory_mutation": False,
        "investment_recommendation_approved": False,
        "position_action_approved": False,
    }


def _load_receipts(directory: Path) -> list[dict[str, Any]]:
    if not directory.exists():
        return []
    receipts: list[dict[str, Any]] = []
    for path in sorted(directory.glob("*.json")):
        try:
            receipts.append(load_json(path))
        except (OSError, ValueError, json.JSONDecodeError):
            continue
    return receipts


def _safe_task_slug(task_id: str) -> str:
    return re.sub(r"[^A-Za-z0-9_.-]+", "-", task_id).strip("-") or "task"


def _write_receipt(path: Path, receipt: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        raise FileExistsError(f"Execution receipt already exists: {path}")
    path.write_text(
        json.dumps(receipt, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def main() -> None:
    parser = argparse.ArgumentParser(
        description="List or execute one explicitly approved research task"
    )
    parser.add_argument("--date", required=True)
    parser.add_argument("--task-id")
    parser.add_argument("--expected-input-hash")
    parser.add_argument("--requested-by", default="")
    parser.add_argument("--execution-note", default="")
    parser.add_argument("--confirm-execution", default="")
    parser.add_argument("--pack-file")
    parser.add_argument("--receipt-file")
    parser.add_argument("--list", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    pack_path = (
        Path(args.pack_file)
        if args.pack_file
        else ROOT
        / "workspace"
        / "intelligence"
        / args.date
        / "research_execution_pack.json"
    )
    pack = load_json(pack_path)
    if str(pack.get("report_date") or "") != args.date:
        raise SystemExit("Execution pack date does not match --date")
    receipt_dir = (
        ROOT
        / "workspace"
        / "intelligence"
        / args.date
        / "execution_receipts"
    )
    prior_receipts = _load_receipts(receipt_dir)

    if args.list:
        tasks = list_executable_tasks(
            pack,
            prior_receipts=prior_receipts,
        )
        print(
            json.dumps(
                {
                    "report_date": args.date,
                    "executable_task_count": len(tasks),
                    "tasks": tasks,
                },
                ensure_ascii=False,
                indent=2,
            )
        )
        return

    if not args.task_id or not args.expected_input_hash:
        parser.error(
            "--task-id and --expected-input-hash are required unless --list is used"
        )
    plan = build_execution_plan(
        pack,
        task_id=args.task_id,
        expected_input_hash=args.expected_input_hash,
        requested_by=args.requested_by,
        execution_note=args.execution_note,
        confirmation=args.confirm_execution,
        prior_receipts=prior_receipts,
        dry_run=args.dry_run,
    )
    receipt = execute_plan(plan)
    print(json.dumps(receipt, ensure_ascii=False, indent=2))
    if args.dry_run:
        print("Dry run complete. No command ran and no receipt was written.")
        return

    if args.receipt_file:
        receipt_path = Path(args.receipt_file)
    else:
        timestamp = datetime.now(ZoneInfo("Asia/Seoul")).strftime(
            "%Y%m%dT%H%M%S%z"
        )
        receipt_path = (
            receipt_dir
            / f"{_safe_task_slug(args.task_id)}_{timestamp}.json"
        )
    _write_receipt(receipt_path, receipt)
    display = (
        receipt_path.relative_to(ROOT)
        if receipt_path.is_relative_to(ROOT)
        else receipt_path
    )
    print(f"Research task execution receipt saved: {display}")


if __name__ == "__main__":
    main()
