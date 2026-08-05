"""Run enabled source adapters and write one deduplicated inbox per day."""

from __future__ import annotations

import argparse
import json
import multiprocessing
import os
import time
from datetime import datetime
from pathlib import Path
from typing import Any, Callable
from zoneinfo import ZoneInfo

from collectors.common import ROOT, load_dotenv, load_source_config
from collectors import (
    alpha_vantage,
    file_drop,
    fred,
    gdelt,
    gmail_research,
    google_drive_reports,
    institutional_insights,
    newsapi,
    official_research_documents,
    opendart,
    rss_candidates,
    sec_inbox,
    telegram_channels,
)
from candidate_pipeline import deduplicate_candidate_records, filter_candidate_records
from sector_classifier import CLASSIFICATION_VERSION, classify_records
from sector_master import load_sector_master

NORMALIZED_DIR = ROOT / "workspace" / "normalized"
SOURCE_STATUS_DIR = ROOT / "workspace" / "source_status"
STATE_FILE = ROOT / "workspace" / "seen_normalized_ids.json"
DEFAULT_COLLECTOR_TIMEOUT_SECONDS = 60.0

Adapter = Callable[[dict[str, Any]], tuple[list[dict[str, Any]], str | None]]
ADAPTERS: dict[str, Adapter] = {
    "fred": fred.collect,
    "alpha_vantage": alpha_vantage.collect,
    "newsapi": newsapi.collect,
    "gdelt": gdelt.collect,
    "gmail_research": gmail_research.collect,
    "google_drive_research_inbox": google_drive_reports.collect,
    "institutional_insights": institutional_insights.collect,
    "official_research_documents": official_research_documents.collect,
    "rss_candidates": rss_candidates.collect,
    "opendart": opendart.collect,
    "authorized_report_drop": file_drop.collect,
    "sec_inbox": sec_inbox.collect,
    "telegram_channels": telegram_channels.collect,
}


def _collector_worker(
    adapter: Adapter,
    config: dict[str, Any],
    send_connection: Any,
) -> None:
    """Run one adapter in a killable child process and return a small envelope."""
    try:
        rows, notice = adapter(config)
        send_connection.send({
            "execution_status": "completed",
            "rows": rows,
            "notice": notice,
        })
    except Exception as exc:
        send_connection.send({
            "execution_status": "error",
            "rows": [],
            "notice": f"ERROR: {type(exc).__name__}: {exc}",
            "error_type": type(exc).__name__,
        })
    finally:
        send_connection.close()


def configured_timeout_seconds(
    source_id: str,
    config: dict[str, Any],
    cli_override: float | None = None,
) -> float:
    if cli_override is not None:
        value = cli_override
    else:
        source_env = f"COLLECTOR_TIMEOUT_{source_id.upper()}_SECONDS"
        collection_config = config.get("collector_timeouts", {})
        value = (
            os.getenv(source_env)
            or collection_config.get(source_id)
            or os.getenv("COLLECTOR_TIMEOUT_SECONDS")
            or collection_config.get("default")
            or DEFAULT_COLLECTOR_TIMEOUT_SECONDS
        )
    timeout = float(value)
    if timeout <= 0:
        raise ValueError(f"Collector timeout must be positive for {source_id}")
    return timeout


def run_adapter_isolated(
    source_id: str,
    adapter: Adapter,
    config: dict[str, Any],
    timeout_seconds: float,
    *,
    context: Any | None = None,
) -> dict[str, Any]:
    """Run an adapter with a hard deadline without blocking later sources."""
    started = time.monotonic()
    process_context = context or multiprocessing.get_context("spawn")
    receive_connection, send_connection = process_context.Pipe(duplex=False)
    process = process_context.Process(
        target=_collector_worker,
        args=(adapter, config, send_connection),
        name=f"collector-{source_id}",
    )
    process.start()
    send_connection.close()
    payload: dict[str, Any] | None = None
    try:
        if receive_connection.poll(timeout_seconds):
            try:
                payload = receive_connection.recv()
            except EOFError:
                payload = None
    finally:
        receive_connection.close()

    if payload is None and process.is_alive():
        process.terminate()
        process.join(timeout=3)
        if process.is_alive() and hasattr(process, "kill"):
            process.kill()
            process.join(timeout=3)
        return {
            "execution_status": "timeout",
            "rows": [],
            "notice": f"ERROR: collector exceeded {timeout_seconds:.1f}s deadline",
            "error_type": "CollectorTimeout",
            "elapsed_seconds": round(time.monotonic() - started, 3),
            "timeout_seconds": timeout_seconds,
        }

    process.join(timeout=3)
    if process.is_alive():
        process.terminate()
        process.join(timeout=3)
    if payload is None:
        payload = {
            "execution_status": "error",
            "rows": [],
            "notice": f"ERROR: collector exited without a result (exit_code={process.exitcode})",
            "error_type": "CollectorProcessExit",
        }
    payload["elapsed_seconds"] = round(time.monotonic() - started, 3)
    payload["timeout_seconds"] = timeout_seconds
    return payload


def deduplicate_records(
    records: list[dict[str, Any]],
    settings: dict[str, Any] | None = None,
) -> tuple[list[dict[str, Any]], int]:
    """Backward-compatible entry point for deterministic candidate de-duplication."""
    return deduplicate_candidate_records(records, settings)


def main() -> None:
    parser = argparse.ArgumentParser(description="Collect enabled market-information API sources into one inbox.")
    parser.add_argument("--sources", nargs="+", choices=sorted(ADAPTERS), default=sorted(ADAPTERS), help="Adapters to run")
    parser.add_argument("--include-seen", action="store_true", help="Write duplicates too (diagnostic only)")
    parser.add_argument("--dry-run", action="store_true", help="Show configuration and make no source calls or writes")
    parser.add_argument(
        "--source-timeout-seconds",
        type=float,
        help="Override the per-source hard timeout for this run.",
    )
    args = parser.parse_args()

    load_dotenv()
    config = load_source_config()
    sector_master = load_sector_master()
    timezone = ZoneInfo(os.getenv("BRIEF_TIMEZONE", "Asia/Seoul"))
    run_now = datetime.now(timezone)
    if args.dry_run:
        print("Dry run. Enabled adapters:", ", ".join(args.sources))
        print("Watchlist:", ", ".join(config.get("watchlist", [])))
        print("Sector master:", len(sector_master["sectors"]), "validated sectors")
        print("No API calls or files written.")
        return

    NORMALIZED_DIR.mkdir(parents=True, exist_ok=True)
    STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    seen = set(json.loads(STATE_FILE.read_text(encoding="utf-8"))) if STATE_FILE.exists() else set()
    collected: list[dict[str, Any]] = []
    source_status: list[dict[str, Any]] = []
    for name in args.sources:
        timeout_seconds = configured_timeout_seconds(
            name,
            config,
            args.source_timeout_seconds,
        )
        result = run_adapter_isolated(
            name,
            ADAPTERS[name],
            config,
            timeout_seconds,
        )
        rows = result["rows"]
        notice = result.get("notice")
        execution_status = result["execution_status"]
        if execution_status == "timeout":
            status = "timeout"
            print(
                f"{name}: TIMEOUT after {result['elapsed_seconds']:.1f}s; "
                "continuing with the next source.",
                flush=True,
            )
        elif execution_status == "error":
            status = "error"
            print(f"{name}: ERROR - {notice}", flush=True)
        elif notice:
            print(f"{name}: SKIPPED/NOTICE - {notice}")
            status = (
                "partial" if rows else
                "skipped_or_notice"
            )
        else:
            print(f"{name}: collected {len(rows)} item(s)", flush=True)
            status = "ok"
        source_status.append({
            "source_id": name,
            "status": status,
            "item_count": len(rows),
            "checked_at": run_now.isoformat(),
            "elapsed_seconds": result["elapsed_seconds"],
            "timeout_seconds": result["timeout_seconds"],
            # Store only a category, never a provider response that could echo credentials.
            "notice_category": (
                "timeout" if status == "timeout" else
                "runtime_error" if status == "error" else
                "configuration_or_provider_notice" if notice else None
            ),
        })
        collected.extend(rows)

    candidate_settings = config.get("candidate_pipeline", {})
    deduplicated, duplicate_count = deduplicate_records(collected, candidate_settings)
    filtered, candidate_filter_summary = filter_candidate_records(
        deduplicated,
        candidate_settings,
        now=run_now,
    )
    classified = classify_records(filtered, sector_master)
    output_rows = [row for row in classified if args.include_seen or row["id"] not in seen]
    date_dir = NORMALIZED_DIR / run_now.strftime("%Y-%m-%d")
    date_dir.mkdir(parents=True, exist_ok=True)
    output = date_dir / f"inbox_{run_now.strftime('%H%M%S')}.json"
    output.write_text(json.dumps(output_rows, ensure_ascii=False, indent=2), encoding="utf-8")
    status_dir = SOURCE_STATUS_DIR / run_now.strftime("%Y-%m-%d")
    status_dir.mkdir(parents=True, exist_ok=True)
    status_output = status_dir / f"source_status_{run_now.strftime('%H%M%S')}.json"
    status_output.write_text(json.dumps({
        "report_date": run_now.strftime("%Y-%m-%d"),
        "generated_at": run_now.isoformat(),
        "collected_record_count": len(collected),
        "canonical_record_count": len(deduplicated),
        "filtered_record_count": len(filtered),
        "duplicate_record_count": duplicate_count,
        "candidate_filter": candidate_filter_summary,
        "sector_classification": {
            "classification_version": CLASSIFICATION_VERSION,
            "sector_master_version": sector_master["version_date"],
            "matched_record_count": sum(bool(row.get("sector_ids")) for row in classified),
            "candidate_only_record_count": sum(row.get("sector_classification_status") == "candidate_only" for row in classified),
            "unmatched_record_count": sum(row.get("sector_classification_status") == "unmatched" for row in classified),
        },
        "sources": source_status,
    }, ensure_ascii=False, indent=2), encoding="utf-8")
    seen.update(row["id"] for row in classified)
    STATE_FILE.write_text(json.dumps(sorted(seen), ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Saved {len(output_rows)} new normalized item(s) to {output.relative_to(ROOT)}")
    print(f"Canonical URL de-duplication removed {duplicate_count} duplicate record(s)")
    print(f"Source status saved: {status_output.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
