"""Collect and analyze the private Gmail/Drive research inbox only.

This focused runner deliberately avoids the unrelated market-data pipeline. It
never publishes externally and reuses the broker-research analysis cache.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path
from typing import Any, Callable

from collectors.common import ROOT, load_dotenv


RESEARCH_SOURCES = ("gmail_research", "google_drive_research_inbox")
ALLOWED_SOURCE_STATUSES = {"ok", "partial"}
MAX_COLLECTION_ATTEMPTS = 2


def load_env_file(path: Path) -> None:
    """Load an additional local env file without overriding process settings."""
    if not path.exists():
        return
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"'))


def inbox_snapshot(root: Path = ROOT) -> dict[Path, int]:
    base = root / "workspace" / "normalized"
    return {
        path: path.stat().st_mtime_ns
        for path in base.glob("*/inbox_*.json")
        if path.is_file()
    }


def updated_inbox(before: dict[Path, int], root: Path = ROOT) -> Path:
    after = inbox_snapshot(root)
    changed = [path for path, modified in after.items() if before.get(path) != modified]
    if not changed:
        raise RuntimeError("Research collection did not create a normalized inbox")
    return max(changed, key=lambda path: after[path])


def source_status_path(inbox: Path, root: Path = ROOT) -> Path:
    suffix = inbox.stem.removeprefix("inbox_")
    return (
        root
        / "workspace"
        / "source_status"
        / inbox.parent.name
        / f"source_status_{suffix}.json"
    )


def validate_collection_status(payload: dict[str, Any]) -> dict[str, int]:
    statuses = {
        str(row.get("source_id")): row
        for row in payload.get("sources", [])
        if isinstance(row, dict)
    }
    failures: list[str] = []
    counts: dict[str, int] = {}
    for source_id in RESEARCH_SOURCES:
        row = statuses.get(source_id)
        status = str((row or {}).get("status") or "missing")
        counts[source_id] = int((row or {}).get("item_count") or 0)
        if status not in ALLOWED_SOURCE_STATUSES:
            failures.append(f"{source_id}={status}")
    if failures:
        raise RuntimeError(
            "Research collection was incomplete; existing analysis was preserved: "
            + ", ".join(failures)
        )
    return counts


def run_command(
    *args: str,
    env: dict[str, str] | None = None,
    root: Path = ROOT,
) -> None:
    print("+", " ".join(args), flush=True)
    subprocess.run([sys.executable, *args], cwd=root, env=env, check=True)


def relative(path: Path, root: Path = ROOT) -> str:
    return path.relative_to(root).as_posix()


def load_json(path: Path) -> dict[str, Any]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise RuntimeError(f"Expected a JSON object: {path}")
    return payload


def main(command_runner: Callable[..., None] = run_command) -> None:
    load_dotenv()
    # The local web app keeps shared provider credentials in the repository env.
    load_env_file(ROOT.parents[1] / ".env")

    inbox: Path | None = None
    counts: dict[str, int] | None = None
    for attempt in range(1, MAX_COLLECTION_ATTEMPTS + 1):
        before = inbox_snapshot()
        command_runner(
            "collect_all.py",
            "--sources",
            *RESEARCH_SOURCES,
            "--include-seen",
            "--source-timeout-seconds",
            "300",
        )
        inbox = updated_inbox(before)
        status_file = source_status_path(inbox)
        if not status_file.exists():
            raise RuntimeError(
                f"Collection status was not created: {relative(status_file)}"
            )
        try:
            counts = validate_collection_status(load_json(status_file))
            break
        except RuntimeError:
            if attempt >= MAX_COLLECTION_ATTEMPTS:
                raise
            print(
                "Research collection was incomplete; retrying once before analysis",
                flush=True,
            )

    if inbox is None or counts is None:
        raise RuntimeError("Research collection did not complete")
    report_date = inbox.parent.name
    print(
        "Research inbox collected: "
        f"Gmail={counts['gmail_research']}, "
        f"Drive={counts['google_drive_research_inbox']}",
        flush=True,
    )

    analysis_env = os.environ.copy()
    # Gmail (up to 40) and Drive (up to 60) share the analyzer's explicit hard cap.
    analysis_env["OPENAI_BROKER_RESEARCH_MAX_REPORTS"] = "100"
    inbox_arg = relative(inbox)
    command_runner(
        "analyze_broker_research.py",
        "--date",
        report_date,
        "--inbox-file",
        inbox_arg,
        env=analysis_env,
    )

    analysis = (
        ROOT
        / "workspace"
        / "broker_research_analysis"
        / report_date
        / "broker_research_analysis.json"
    )
    analysis_payload = load_json(analysis)
    analysis_status = str(analysis_payload.get("status") or "missing")
    if analysis_status not in {"complete", "no_eligible_reports"}:
        raise RuntimeError(f"Broker research analysis did not complete: {analysis_status}")

    analysis_arg = relative(analysis)
    command_runner(
        "build_broker_research_digest.py",
        "--date",
        report_date,
        "--inbox-file",
        inbox_arg,
        "--analysis-file",
        analysis_arg,
    )

    clusters = ROOT / "workspace" / "triaged" / report_date / "event_clusters.json"
    snapshot = ROOT / "workspace" / "snapshots" / report_date / "daily_snapshot.json"
    market_analysis = ROOT / "workspace" / "analysis" / report_date / "market_analysis.json"
    intelligence = ROOT / "workspace" / "intelligence" / report_date / "daily_intelligence.json"

    if clusters.exists():
        command_runner(
            "build_cross_source_events.py",
            "--date",
            report_date,
            "--inbox-file",
            inbox_arg,
            "--clusters-file",
            relative(clusters),
            "--analysis-file",
            analysis_arg,
        )
    else:
        print("Cross-source refresh skipped: event clusters are not available", flush=True)

    if clusters.exists() and snapshot.exists() and market_analysis.exists():
        command_runner("build_daily_intelligence.py", "--date", report_date)
    else:
        print("Daily Intelligence refresh skipped: market prerequisites are not available", flush=True)

    if intelligence.exists():
        command_runner("compose_v2_reader_report.py", "--date", report_date)

    print(
        f"Research inbox analysis complete for {report_date}; external publishing disabled",
        flush=True,
    )


if __name__ == "__main__":
    main()
