#!/usr/bin/env python3
"""Plan or apply backed-up, owner-controlled SQLite initialization/migrations."""

from __future__ import annotations

import argparse
import json
import sqlite3
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from sqlite_store_doctor import APP_ROOT, inspect_store, load_registry, selected_stores


BLOCKING_CODES = {
    "schema-blueprint-invalid",
    "quick-check-failed",
    "foreign-key-check-failed",
    "schema-version-newer-than-app",
    "database-unreadable",
}


def timestamp_slug() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")


def relative_or_text(path: Path, root: Path) -> str:
    try:
        return str(path.resolve().relative_to(root.resolve()))
    except ValueError:
        return str(path)


def plan_store(root: Path, store: dict[str, Any], *, initialize_missing: bool) -> dict[str, Any]:
    inspection = inspect_store(root, store)
    blocking = [issue for issue in inspection["issues"] if issue["code"] in BLOCKING_CODES]
    exists = bool(inspection["exists"])
    if blocking:
        action = "blocked"
    elif exists:
        action = "backup-and-migrate"
    elif initialize_missing:
        action = "initialize-missing"
    else:
        action = "skip-missing"
    return {
        "id": store["id"],
        "label": store["label"],
        "dbPath": store["dbPath"],
        "exists": exists,
        "action": action,
        "initCommand": store["initCommand"],
        "backupRequired": exists,
        "rebuildable": bool(store.get("rebuildable")),
        "dataClass": store["dataClass"],
        "blockingIssues": blocking,
        "before": inspection,
    }


def build_plan(root: Path, stores: list[dict[str, Any]], *, initialize_missing: bool) -> dict[str, Any]:
    rows = [plan_store(root, store, initialize_missing=initialize_missing) for store in stores]
    return {
        "ok": all(row["action"] != "blocked" for row in rows),
        "mode": "plan",
        "root": ".",
        "initializeMissing": initialize_missing,
        "safety": {
            "replacesExistingDatabases": False,
            "backsUpBeforeExistingDatabaseMigration": True,
            "usesOwnerInitCommands": True,
        },
        "stores": rows,
    }


def backup_database(source_path: Path, destination_path: Path) -> dict[str, Any]:
    destination_path.parent.mkdir(parents=True, exist_ok=True)
    source = sqlite3.connect(f"{source_path.resolve().as_uri()}?mode=ro", uri=True, timeout=10)
    destination = sqlite3.connect(destination_path)
    try:
        source.backup(destination)
        quick_check = [str(row[0]) for row in destination.execute("PRAGMA quick_check")]
        if quick_check != ["ok"]:
            raise RuntimeError(f"backup quick_check failed: {'; '.join(quick_check[:10])}")
        destination.commit()
        return {"ok": True, "quickCheck": "ok", "bytes": destination_path.stat().st_size}
    finally:
        destination.close()
        source.close()


def owner_command(root: Path, store: dict[str, Any]) -> list[str]:
    raw = [str(item) for item in store["initCommand"]]
    return [sys.executable if item == "python" and index == 0 else item for index, item in enumerate(raw)]


def run_owner_command(root: Path, store: dict[str, Any]) -> dict[str, Any]:
    command = owner_command(root, store)
    completed = subprocess.run(
        command,
        cwd=root,
        capture_output=True,
        text=True,
        check=False,
        timeout=120,
    )
    def sanitized_output(value: str) -> str:
        return value.replace(str(root), ".").replace(str(Path.home()), "~").strip()[-4000:]

    return {
        "ok": completed.returncode == 0,
        "command": ["python", *command[1:]],
        "exitCode": completed.returncode,
        "stdout": sanitized_output(completed.stdout),
        "stderr": sanitized_output(completed.stderr),
    }


def preserved_counts(before: dict[str, Any], after: dict[str, Any]) -> dict[str, Any]:
    before_counts = before.get("tableRowCounts") or {}
    after_counts = after.get("tableRowCounts") or {}
    decreased = {
        table: {"before": count, "after": after_counts.get(table)}
        for table, count in before_counts.items()
        if table in after_counts and int(after_counts[table]) < int(count)
    }
    return {
        "ok": not decreased,
        "before": before_counts,
        "after": after_counts,
        "decreased": decreased,
    }


def apply_plan(
    root: Path,
    stores: list[dict[str, Any]],
    *,
    initialize_missing: bool,
    backup_root: Path,
) -> dict[str, Any]:
    plan = build_plan(root, stores, initialize_missing=initialize_missing)
    results: list[dict[str, Any]] = []
    backup_rows: list[dict[str, Any]] = []
    for store, planned in zip(stores, plan["stores"]):
        row: dict[str, Any] = {
            "id": store["id"],
            "dbPath": store["dbPath"],
            "action": planned["action"],
            "ok": planned["action"] != "blocked",
        }
        if planned["action"] in {"blocked", "skip-missing"}:
            row["blockingIssues"] = planned["blockingIssues"]
            results.append(row)
            continue

        db_path = root / str(store["dbPath"])
        before = planned["before"]
        if db_path.is_file():
            backup_path = backup_root / f"{store['id']}--{db_path.name}"
            try:
                backup_result = backup_database(db_path, backup_path)
            except Exception as error:
                row.update({"ok": False, "backup": {"ok": False, "error": str(error)}})
                results.append(row)
                continue
            row["backup"] = {
                **backup_result,
                "path": relative_or_text(backup_path, root),
            }
            backup_rows.append(
                {
                    "store": store["id"],
                    "source": store["dbPath"],
                    "backup": relative_or_text(backup_path, root),
                    "beforeRowCounts": before.get("tableRowCounts") or {},
                }
            )

        command_result = run_owner_command(root, store)
        row["ownerInit"] = command_result
        if not command_result["ok"]:
            row["ok"] = False
            results.append(row)
            continue

        after = inspect_store(root, store, require_initialized=True)
        row["after"] = after
        row["dataPreservation"] = preserved_counts(before, after)
        row["ok"] = after["ok"] and row["dataPreservation"]["ok"]
        results.append(row)

    backup_manifest = None
    if backup_rows:
        backup_root.mkdir(parents=True, exist_ok=True)
        manifest_path = backup_root / "backup-manifest.json"
        manifest_path.write_text(
            json.dumps(
                {
                    "createdAt": datetime.now(timezone.utc).isoformat(),
                    "policy": "pre-migration SQLite backup; never commit or distribute",
                    "stores": backup_rows,
                },
                ensure_ascii=False,
                indent=2,
            )
            + "\n",
            encoding="utf-8",
        )
        backup_manifest = relative_or_text(manifest_path, root)

    return {
        "ok": all(row["ok"] for row in results),
        "mode": "apply",
        "root": ".",
        "initializeMissing": initialize_missing,
        "backupManifest": backup_manifest,
        "stores": results,
    }


def print_text(payload: dict[str, Any]) -> None:
    print(f"FinanceAgentGUI SQLite setup ({payload['mode']})")
    for row in payload["stores"]:
        label = "ok" if row.get("ok", True) else "blocked"
        print(f"- {row['id']}: {row['action']} [{label}] ({row['dbPath']})")
        backup = row.get("backup")
        if backup and backup.get("path"):
            print(f"  backup: {backup['path']}")
    if payload.get("backupManifest"):
        print(f"Backup manifest: {payload['backupManifest']}")
    print(f"Result: {'ready' if payload['ok'] else 'attention required'}")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Plan or apply non-destructive SQLite initialization and migrations."
    )
    parser.add_argument("command", choices=["plan", "apply"], nargs="?", default="plan")
    parser.add_argument("--root", default=str(APP_ROOT), help=argparse.SUPPRESS)
    parser.add_argument("--store", action="append", default=[], help="Store id or all (repeatable)")
    parser.add_argument(
        "--initialize-missing",
        action="store_true",
        help="Create missing local DBs through owner init commands; no seed DB is copied.",
    )
    parser.add_argument(
        "--confirm",
        action="store_true",
        help="Required with apply after reviewing the plan and stopping the app server.",
    )
    parser.add_argument("--backup-dir", default="")
    parser.add_argument("--json", action="store_true")
    return parser


def main() -> int:
    args = build_parser().parse_args()
    if args.command == "apply" and not args.confirm:
        print("Refusing to write: review plan, stop the app server, then rerun apply with --confirm.", file=sys.stderr)
        return 2
    root = Path(args.root).resolve()
    registry = load_registry(root)
    stores = selected_stores(registry, args.store)
    if args.command == "plan":
        payload = build_plan(root, stores, initialize_missing=args.initialize_missing)
    else:
        backup_root = (
            Path(args.backup_dir).resolve()
            if args.backup_dir
            else root / "data" / "backups" / "sqlite" / timestamp_slug()
        )
        payload = apply_plan(
            root,
            stores,
            initialize_missing=args.initialize_missing,
            backup_root=backup_root,
        )
    if args.json:
        print(json.dumps(payload, ensure_ascii=False, indent=2))
    else:
        print_text(payload)
    return 0 if payload["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
