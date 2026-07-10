#!/usr/bin/env python3
"""Read-only diagnostics for every FinanceAgentGUI-owned SQLite store."""

from __future__ import annotations

import argparse
import json
import sqlite3
import subprocess
import sys
from pathlib import Path
from typing import Any


APP_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_REGISTRY = Path("config/sqlite-stores.json")
RUNTIME_DB_SUFFIXES = (
    ".sqlite",
    ".sqlite3",
    ".db",
    ".sqlite-wal",
    ".sqlite-shm",
    ".sqlite3-wal",
    ".sqlite3-shm",
    ".db-wal",
    ".db-shm",
)


def load_registry(root: Path) -> dict[str, Any]:
    path = root / DEFAULT_REGISTRY
    payload = json.loads(path.read_text(encoding="utf-8"))
    stores = payload.get("stores")
    if not isinstance(stores, list) or not stores:
        raise ValueError(f"SQLite store registry has no stores: {path}")
    return payload


def selected_stores(registry: dict[str, Any], requested: list[str]) -> list[dict[str, Any]]:
    stores = [row for row in registry["stores"] if isinstance(row, dict)]
    if not requested or "all" in requested:
        return stores
    requested_set = set(requested)
    known = {str(row.get("id") or "") for row in stores}
    unknown = sorted(requested_set - known)
    if unknown:
        raise ValueError(f"Unknown SQLite store id(s): {', '.join(unknown)}")
    return [row for row in stores if row.get("id") in requested_set]


def quote_identifier(value: str) -> str:
    return '"' + value.replace('"', '""') + '"'


def schema_blueprint(root: Path, store: dict[str, Any]) -> dict[str, Any]:
    schema_path = root / str(store["schemaPath"])
    sql = schema_path.read_text(encoding="utf-8")
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    try:
        conn.executescript(sql)
        objects = {
            str(row["name"]): str(row["type"])
            for row in conn.execute(
                """
                SELECT type, name
                FROM sqlite_master
                WHERE type IN ('table', 'index')
                  AND name NOT LIKE 'sqlite_autoindex_%'
                  AND name NOT LIKE 'sqlite_%'
                ORDER BY type, name
                """
            )
        }
        columns = {
            name: [
                str(row["name"])
                for row in conn.execute(f"PRAGMA table_info({quote_identifier(name)})")
            ]
            for name, object_type in objects.items()
            if object_type == "table"
        }
        user_version = int(conn.execute("PRAGMA user_version").fetchone()[0])
        return {
            "schemaPath": str(store["schemaPath"]),
            "objects": objects,
            "columns": columns,
            "userVersion": user_version,
        }
    finally:
        conn.close()


def readonly_connection(path: Path) -> sqlite3.Connection:
    conn = sqlite3.connect(f"{path.resolve().as_uri()}?mode=ro", uri=True, timeout=5)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA query_only = ON")
    return conn


def inspect_store(root: Path, store: dict[str, Any], *, require_initialized: bool = False) -> dict[str, Any]:
    db_path = root / str(store["dbPath"])
    result: dict[str, Any] = {
        "id": store["id"],
        "label": store["label"],
        "dbPath": store["dbPath"],
        "schemaPath": store["schemaPath"],
        "ownerScript": store["ownerScript"],
        "initCommand": store["initCommand"],
        "dataClass": store["dataClass"],
        "rebuildable": bool(store.get("rebuildable")),
        "exists": db_path.is_file(),
        "status": "missing",
        "ok": not require_initialized,
        "issues": [],
        "tableRowCounts": {},
    }
    try:
        blueprint = schema_blueprint(root, store)
    except Exception as error:
        result["status"] = "error"
        result["ok"] = False
        result["issues"].append(
            {"level": "error", "code": "schema-blueprint-invalid", "message": str(error)}
        )
        return result

    result["expectedUserVersion"] = store.get("schemaVersion")
    result["requiredTables"] = sorted(
        name for name, object_type in blueprint["objects"].items() if object_type == "table"
    )
    if not db_path.is_file():
        result["issues"].append(
            {
                "level": "error" if require_initialized else "info",
                "code": "store-not-initialized",
                "message": "Runtime DB is absent; use the owner init command instead of copying a seed DB.",
            }
        )
        return result

    try:
        conn = readonly_connection(db_path)
        try:
            quick_rows = [str(row[0]) for row in conn.execute("PRAGMA quick_check")]
            if quick_rows != ["ok"]:
                result["issues"].append(
                    {
                        "level": "error",
                        "code": "quick-check-failed",
                        "message": "; ".join(quick_rows[:10]),
                    }
                )

            foreign_key_rows = conn.execute("PRAGMA foreign_key_check").fetchall()
            if foreign_key_rows:
                result["issues"].append(
                    {
                        "level": "error",
                        "code": "foreign-key-check-failed",
                        "message": f"{len(foreign_key_rows)} foreign-key violation(s)",
                    }
                )

            actual_objects = {
                str(row["name"]): str(row["type"])
                for row in conn.execute(
                    """
                    SELECT type, name
                    FROM sqlite_master
                    WHERE type IN ('table', 'index')
                      AND name NOT LIKE 'sqlite_autoindex_%'
                      AND name NOT LIKE 'sqlite_%'
                    ORDER BY type, name
                    """
                )
            }
            missing_objects = sorted(set(blueprint["objects"]) - set(actual_objects))
            if missing_objects:
                result["issues"].append(
                    {
                        "level": "error",
                        "code": "schema-objects-missing",
                        "message": ", ".join(missing_objects),
                    }
                )

            missing_columns: list[str] = []
            for table_name, expected_columns in blueprint["columns"].items():
                if actual_objects.get(table_name) != "table":
                    continue
                actual_columns = {
                    str(row["name"])
                    for row in conn.execute(
                        f"PRAGMA table_info({quote_identifier(table_name)})"
                    )
                }
                missing_columns.extend(
                    f"{table_name}.{column}"
                    for column in expected_columns
                    if column not in actual_columns
                )
                result["tableRowCounts"][table_name] = int(
                    conn.execute(f"SELECT COUNT(*) FROM {quote_identifier(table_name)}").fetchone()[0]
                )
            if missing_columns:
                result["issues"].append(
                    {
                        "level": "error",
                        "code": "schema-columns-missing",
                        "message": ", ".join(missing_columns),
                    }
                )

            actual_version = int(conn.execute("PRAGMA user_version").fetchone()[0])
            result["userVersion"] = actual_version
            expected_version = store.get("schemaVersion")
            if isinstance(expected_version, int):
                if actual_version > expected_version:
                    result["issues"].append(
                        {
                            "level": "error",
                            "code": "schema-version-newer-than-app",
                            "message": f"DB version {actual_version} is newer than supported {expected_version}; do not migrate or replace it.",
                        }
                    )
                elif actual_version < expected_version:
                    result["issues"].append(
                        {
                            "level": "warning",
                            "code": "schema-migration-available",
                            "message": f"DB version {actual_version} can be migrated to {expected_version} by the owner init command.",
                        }
                    )
        finally:
            conn.close()
    except Exception as error:
        result["issues"].append(
            {"level": "error", "code": "database-unreadable", "message": str(error)}
        )

    error_count = sum(1 for issue in result["issues"] if issue["level"] == "error")
    warning_count = sum(1 for issue in result["issues"] if issue["level"] == "warning")
    result["status"] = "error" if error_count else "warning" if warning_count else "ready"
    result["ok"] = error_count == 0
    return result


def is_runtime_database_path(path: str) -> bool:
    lowered = path.lower()
    return lowered.startswith("data/") and lowered.endswith(RUNTIME_DB_SUFFIXES)


def inspect_git_protection(root: Path, stores: list[dict[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {
        "available": False,
        "ok": True,
        "trackedRuntimeDatabases": [],
        "ignoreCoverage": {},
        "issues": [],
    }
    probe = subprocess.run(
        ["git", "-C", str(root), "rev-parse", "--is-inside-work-tree"],
        capture_output=True,
        text=True,
        check=False,
    )
    if probe.returncode != 0:
        result["issues"].append(
            {
                "level": "info",
                "code": "git-metadata-unavailable",
                "message": "Git metadata is unavailable; release tracking protection was not checked.",
            }
        )
        return result

    result["available"] = True
    tracked = subprocess.run(
        ["git", "-C", str(root), "ls-files", "-z", "--", "data"],
        capture_output=True,
        check=False,
    )
    tracked_paths = [item.decode("utf-8") for item in tracked.stdout.split(b"\0") if item]
    result["trackedRuntimeDatabases"] = sorted(
        path for path in tracked_paths if is_runtime_database_path(path)
    )
    if result["trackedRuntimeDatabases"]:
        result["ok"] = False
        result["issues"].append(
            {
                "level": "error",
                "code": "runtime-database-tracked",
                "message": ", ".join(result["trackedRuntimeDatabases"]),
            }
        )

    for store in stores:
        db_path = str(store["dbPath"])
        ignored = subprocess.run(
            ["git", "-C", str(root), "check-ignore", "-q", "--", db_path],
            check=False,
        ).returncode == 0
        result["ignoreCoverage"][store["id"]] = ignored
        if not ignored:
            result["ok"] = False
            result["issues"].append(
                {
                    "level": "error",
                    "code": "runtime-database-not-ignored",
                    "message": db_path,
                }
            )
    return result


def build_report(
    root: Path,
    stores: list[dict[str, Any]],
    *,
    require_initialized: bool = False,
    check_git: bool = True,
) -> dict[str, Any]:
    results = [
        inspect_store(root, store, require_initialized=require_initialized)
        for store in stores
    ]
    git_result = inspect_git_protection(root, stores) if check_git else None
    ok = all(result["ok"] for result in results) and (git_result is None or git_result["ok"])
    return {
        "ok": ok,
        "root": ".",
        "policy": {
            "runtimeDatabasesShipped": False,
            "emptySeedDatabasesShipped": False,
            "diagnosticMode": "read-only",
        },
        "stores": results,
        "gitProtection": git_result,
    }


def print_text_report(report: dict[str, Any], *, strict_warning_failure: bool = False) -> None:
    print("FinanceAgentGUI SQLite doctor (read-only)")
    for store in report["stores"]:
        print(f"- {store['id']}: {store['status']} ({store['dbPath']})")
        for issue in store["issues"]:
            print(f"  [{issue['level']}] {issue['code']}: {issue['message']}")
    git_result = report.get("gitProtection")
    if git_result:
        label = "ready" if git_result["ok"] else "error"
        print(f"- git-protection: {label}")
        for issue in git_result["issues"]:
            print(f"  [{issue['level']}] {issue['code']}: {issue['message']}")
    ready = report["ok"] and not strict_warning_failure
    print(f"Result: {'ready' if ready else 'attention required'}")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Read-only integrity, schema, and Git-protection checks for local SQLite stores."
    )
    parser.add_argument("--root", default=str(APP_ROOT), help=argparse.SUPPRESS)
    parser.add_argument("--store", action="append", default=[], help="Store id or all (repeatable)")
    parser.add_argument("--require-initialized", action="store_true")
    parser.add_argument("--strict", action="store_true", help="Treat warnings as a failing exit status")
    parser.add_argument("--no-git-check", action="store_true")
    parser.add_argument("--json", action="store_true")
    return parser


def main() -> int:
    args = build_parser().parse_args()
    root = Path(args.root).resolve()
    registry = load_registry(root)
    stores = selected_stores(registry, args.store)
    report = build_report(
        root,
        stores,
        require_initialized=args.require_initialized,
        check_git=not args.no_git_check,
    )
    has_warning = any(
        issue["level"] == "warning"
        for store in report["stores"]
        for issue in store["issues"]
    )
    strict_warning_failure = args.strict and has_warning
    if args.json:
        report["strictOk"] = report["ok"] and not strict_warning_failure
        print(json.dumps(report, ensure_ascii=False, indent=2))
    else:
        print_text_report(report, strict_warning_failure=strict_warning_failure)
    return 1 if not report["ok"] or strict_warning_failure else 0


if __name__ == "__main__":
    sys.exit(main())
