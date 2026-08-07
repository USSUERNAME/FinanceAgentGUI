#!/usr/bin/env python3
"""Scan the standalone Git publish set without printing detected secret values."""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any


APP_ROOT = Path(__file__).resolve().parents[1]
MAX_TEXT_BYTES = 2_000_000
MAX_ISSUES = 500
ALLOWED_DATA_FILES = {
    "data/magazine/.gitkeep",
    "data/notifications/.gitkeep",
    "data/portfolio/.gitkeep",
    "data/reports/.gitkeep",
    "data/shared-memory/.gitkeep",
    "data/tossinvest/.gitkeep",
    "data/world-memory/.gitkeep",
    "data/invest-simulator/.gitkeep",
}
# This cache contains only deterministic public-feed output. It remains forbidden
# in the current publish set, but its already-public historical blob is accepted.
# Content signatures are still scanned even when the historical path is allowed.
ALLOWED_HISTORICAL_RUNTIME_PATHS = {"data/news-feed.json"}
PRIVATE_SUFFIXES = (
    ".pem",
    ".p12",
    ".pfx",
    ".key",
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
PLACEHOLDER_MARKERS = (
    "example",
    "placeholder",
    "replace-me",
    "replace_me",
    "your-",
    "your_",
    "dummy",
    "fake",
    "mock",
    "fixture",
    "sample",
    "paced-token",
    "saved-token",
    "stored-token",
    "legacy-token",
    "test-",
    "test_",
    "redacted",
    "changeme",
    "change-me",
    "<",
    "${",
    "{",
)


@dataclass(frozen=True)
class FindingPattern:
    code: str
    level: str
    regex: re.Pattern[str]
    value_group: int | None = None


CONTENT_PATTERNS = (
    FindingPattern(
        "private-key-material",
        "error",
        re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----"),
    ),
    FindingPattern("openai-api-key", "error", re.compile(r"\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b")),
    FindingPattern("github-token", "error", re.compile(r"\bgh[opusr]_[A-Za-z0-9]{20,}\b")),
    FindingPattern("aws-access-key", "error", re.compile(r"\b(?:AKIA|ASIA)[A-Z0-9]{16}\b")),
    FindingPattern("google-api-key", "error", re.compile(r"\bAIza[0-9A-Za-z_-]{30,}\b")),
    FindingPattern("slack-token", "error", re.compile(r"\bxox[baprs]-[A-Za-z0-9-]{16,}\b")),
    FindingPattern(
        "bearer-token-literal",
        "error",
        re.compile(r"(?i)\bBearer\s+([A-Za-z0-9._~+/-]{20,}=*)"),
        value_group=1,
    ),
    FindingPattern(
        "credential-literal",
        "error",
        re.compile(
            r"(?i)(?:api[_-]?key|client[_-]?secret|access[_-]?token|refresh[_-]?token|password|cookie)"
            r"\s*[=:]\s*[\"']([^\"'\r\n]{8,})[\"']"
        ),
        value_group=1,
    ),
    FindingPattern(
        "personal-macos-home-path",
        "error",
        re.compile(r"/Users/((?!Shared(?:/|\b)|USER(?:/|\b)|<)[A-Za-z0-9._-][^/\s\"']*)/"),
        value_group=1,
    ),
    FindingPattern(
        "personal-windows-home-path",
        "error",
        re.compile(r"(?i)C:\\Users\\((?!Public(?:\\|\b)|USER(?:\\|\b)|<)[A-Za-z0-9._-][^\\\s\"']*)\\"),
        value_group=1,
    ),
    FindingPattern(
        "korean-resident-registration-number",
        "error",
        re.compile(r"(?<!\d)\d{6}-[1-4]\d{6}(?!\d)"),
    ),
    FindingPattern(
        "email-address",
        "warning",
        re.compile(r"\b[A-Za-z0-9._%+-]+@([A-Za-z0-9.-]+\.[A-Za-z]{2,})\b"),
        value_group=1,
    ),
)


def run_git(root: Path, args: list[str], *, text: bool = False) -> subprocess.CompletedProcess[Any]:
    return subprocess.run(
        ["git", "-C", str(root), *args],
        capture_output=True,
        text=text,
        check=False,
    )


def normalize_git_path(path: str) -> str:
    normalized = path.replace("\\", "/")
    while normalized.startswith("./"):
        normalized = normalized[2:]
    normalized = normalized.lstrip("/")
    if normalized.startswith("GuiBuild/"):
        return normalized[len("GuiBuild/") :]
    return normalized


def is_forbidden_tracked_path(path: str) -> str | None:
    normalized = normalize_git_path(path)
    lowered = normalized.lower()
    if normalized in ALLOWED_DATA_FILES:
        return None
    if lowered == ".env.example":
        return None
    if lowered == ".env" or lowered.startswith(".env."):
        return "environment-file-tracked"
    if lowered.startswith("data/"):
        return "runtime-data-tracked"
    if lowered.startswith("logs/"):
        return "runtime-log-tracked"
    if lowered.startswith("config/") and lowered.endswith(".user.json"):
        return "user-config-tracked"
    if lowered.endswith(PRIVATE_SUFFIXES):
        return "private-artifact-tracked"
    return None


def is_placeholder(value: str) -> bool:
    lowered = value.strip().lower()
    if not lowered or len(lowered) < 8:
        return True
    if any(marker in lowered for marker in PLACEHOLDER_MARKERS):
        return True
    if re.fullmatch(r"[a-z]+(?:-[a-z]+)+", lowered) and any(
        word in lowered.split("-") for word in ("token", "secret", "mock", "test", "fake")
    ):
        return True
    compact = re.sub(r"[^a-z0-9]", "", lowered)
    return len(set(compact)) < 4


def pattern_is_allowed(pattern: FindingPattern, match: re.Match[str]) -> bool:
    if pattern.value_group is None:
        return False
    value = match.group(pattern.value_group)
    if pattern.code == "email-address":
        domain = value.lower()
        reserved_domains = ("example.com", "example.org", "example.net")
        return domain == "localhost.local" or any(
            domain == reserved or domain.endswith(f".{reserved}")
            for reserved in reserved_domains
        )
    if pattern.code in {"personal-macos-home-path", "personal-windows-home-path"}:
        return value.lower() in {"you", "user", "username", "example", "test", "runner"}
    return is_placeholder(value)


def scan_text(text: str, *, path: str, source: str, object_id: str = "") -> list[dict[str, Any]]:
    issues: list[dict[str, Any]] = []
    for pattern in CONTENT_PATTERNS:
        for match in pattern.regex.finditer(text):
            if pattern_is_allowed(pattern, match):
                continue
            line = text.count("\n", 0, match.start()) + 1
            issue = {
                "level": pattern.level,
                "code": pattern.code,
                "path": normalize_git_path(path),
                "line": line,
                "source": source,
                "message": "Sensitive value suppressed; inspect and rotate/remove it before publishing.",
            }
            if object_id:
                issue["object"] = object_id[:12]
            issues.append(issue)
            if len(issues) >= MAX_ISSUES:
                return issues
    return issues


def publish_candidate_paths(root: Path) -> list[str]:
    result = run_git(root, ["ls-files", "-z", "--cached", "--others", "--exclude-standard"])
    if result.returncode != 0:
        raise RuntimeError("Git tracked-file listing failed")
    return [item.decode("utf-8") for item in result.stdout.split(b"\0") if item]


def scan_current(root: Path) -> dict[str, Any]:
    issues: list[dict[str, Any]] = []
    paths = publish_candidate_paths(root)
    for path in paths:
        normalized = normalize_git_path(path)
        forbidden_code = is_forbidden_tracked_path(normalized)
        if forbidden_code:
            issues.append(
                {
                    "level": "error",
                    "code": forbidden_code,
                    "path": normalized,
                    "source": "tracked-path",
                    "message": "Private/runtime artifact is part of the Git publish set.",
                }
            )
            continue
        file_path = root / normalized
        if not file_path.is_file() or file_path.stat().st_size > MAX_TEXT_BYTES:
            continue
        data = file_path.read_bytes()
        if b"\0" in data:
            continue
        text = data.decode("utf-8", errors="replace")
        issues.extend(scan_text(text, path=normalized, source="current"))
        if len(issues) >= MAX_ISSUES:
            break
    return {"publishCandidateFileCount": len(paths), "issues": issues[:MAX_ISSUES]}


def history_blob_entries(root: Path) -> list[tuple[str, str]]:
    result = run_git(root, ["rev-list", "--objects", "--all", "--", "."], text=True)
    if result.returncode != 0:
        raise RuntimeError("Git history object listing failed")
    entries: list[tuple[str, str]] = []
    seen: set[tuple[str, str]] = set()
    for line in result.stdout.splitlines():
        if " " not in line:
            continue
        object_id, path = line.split(" ", 1)
        path = path.strip()
        if not path:
            continue
        key = (object_id, path)
        if key not in seen:
            entries.append(key)
            seen.add(key)
    return entries


def read_git_objects(root: Path, object_ids: list[str]) -> dict[str, bytes]:
    if not object_ids:
        return {}
    request = "".join(f"{object_id}\n" for object_id in object_ids).encode("ascii")
    result = subprocess.run(
        ["git", "-C", str(root), "cat-file", "--batch"],
        input=request,
        capture_output=True,
        check=False,
    )
    if result.returncode != 0:
        raise RuntimeError("Git history batch object read failed")
    objects: dict[str, bytes] = {}
    output = result.stdout
    cursor = 0
    while cursor < len(output):
        header_end = output.find(b"\n", cursor)
        if header_end < 0:
            raise RuntimeError("Malformed Git batch object header")
        header = output[cursor:header_end].decode("ascii", errors="replace").split()
        cursor = header_end + 1
        if len(header) != 3 or header[1] != "blob":
            raise RuntimeError("Unexpected Git batch object response")
        object_id, _, raw_size = header
        size = int(raw_size)
        objects[object_id] = output[cursor : cursor + size]
        cursor += size + 1
    return objects


def scan_history(root: Path) -> dict[str, Any]:
    issues: list[dict[str, Any]] = []
    entries = history_blob_entries(root)
    object_paths: dict[str, list[str]] = {}
    for object_id, path in entries:
        object_paths.setdefault(object_id, []).append(path)
    metadata_request = "".join(f"{object_id}\n" for object_id in object_paths).encode("ascii")
    metadata = subprocess.run(
        [
            "git",
            "-C",
            str(root),
            "cat-file",
            "--batch-check=%(objectname) %(objecttype) %(objectsize)",
        ],
        input=metadata_request,
        capture_output=True,
        check=False,
    )
    if metadata.returncode != 0:
        raise RuntimeError("Git history batch metadata read failed")
    blob_sizes: dict[str, int] = {}
    for line in metadata.stdout.decode("ascii", errors="replace").splitlines():
        fields = line.split()
        if len(fields) == 3 and fields[1] == "blob":
            blob_sizes[fields[0]] = int(fields[2])
    eligible_ids = [
        object_id
        for object_id, size in blob_sizes.items()
        if size <= MAX_TEXT_BYTES
    ]
    object_contents = read_git_objects(root, eligible_ids)
    for object_id, paths in object_paths.items():
        if object_id not in blob_sizes:
            continue
        for path in paths:
            normalized = normalize_git_path(path)
            forbidden_code = is_forbidden_tracked_path(normalized)
            if forbidden_code and normalized not in ALLOWED_HISTORICAL_RUNTIME_PATHS:
                sensitive_history_path = (
                    normalized.startswith(("data/secrets/", "data/arca-browser-profile/", "data/backups/"))
                    or normalized.lower().endswith(PRIVATE_SUFFIXES)
                    or forbidden_code in {
                        "environment-file-tracked",
                        "user-config-tracked",
                        "private-artifact-tracked",
                    }
                )
                issues.append(
                    {
                        "level": "error" if sensitive_history_path else "warning",
                        "code": f"historical-{forbidden_code}",
                        "path": normalized,
                        "source": "history-path",
                        "object": object_id[:12],
                        "message": "Sensitive/runtime path exists in reachable Git history.",
                    }
                )
        data = object_contents.get(object_id)
        if not data or b"\0" in data:
            continue
        text = data.decode("utf-8", errors="replace")
        issues.extend(
            scan_text(text, path=paths[0], source="history-content", object_id=object_id)
        )
        if len(issues) >= MAX_ISSUES:
            break
    return {
        "objectPathCount": len(entries),
        "uniqueBlobCount": len(blob_sizes),
        "issues": issues[:MAX_ISSUES],
    }


def inspect_ignore_guards(root: Path) -> dict[str, Any]:
    probes = {
        "environment": ".env",
        "userConfig": "config/example.user.json",
        "secrets": "data/secrets/example.json",
        "browserProfile": "data/arca-browser-profile/Default/Cookies",
        "worldMemoryDb": "data/world-memory/world_issue_log.sqlite3",
        "tossLedgerDb": "data/tossinvest/tossinvest-ledger.sqlite3",
        "simulatorDb": "data/invest-simulator/simulator.sqlite3",
        "magazineIndexDb": "data/magazine/event-signature-index.sqlite3",
        "sqliteBackup": "data/backups/sqlite/example.sqlite3",
        "logs": "logs/example.log",
    }
    coverage: dict[str, bool] = {}
    issues: list[dict[str, Any]] = []
    for label, path in probes.items():
        ignored = run_git(root, ["check-ignore", "-q", "--", path]).returncode == 0
        coverage[label] = ignored
        if not ignored:
            issues.append(
                {
                    "level": "error",
                    "code": "sensitive-path-not-ignored",
                    "path": path,
                    "source": "gitignore",
                    "message": f"Missing ignore protection for {label}.",
                }
            )
    return {"ok": not issues, "coverage": coverage, "issues": issues}


def build_report(root: Path, *, include_history: bool) -> dict[str, Any]:
    current = scan_current(root)
    history = scan_history(root) if include_history else None
    ignore_guards = inspect_ignore_guards(root)
    issues = [*current["issues"], *ignore_guards["issues"]]
    if history:
        issues.extend(history["issues"])
    error_count = sum(1 for issue in issues if issue["level"] == "error")
    warning_count = sum(1 for issue in issues if issue["level"] == "warning")
    return {
        "ok": error_count == 0,
        "valuesSuppressed": True,
        "historyScanned": include_history,
        "summary": {"errors": error_count, "warnings": warning_count},
        "current": current,
        "history": history,
        "ignoreGuards": ignore_guards,
        "issues": issues[:MAX_ISSUES],
    }


def print_text(report: dict[str, Any]) -> None:
    print("FinanceAgentGUI release safety check (matched values are suppressed)")
    for issue in report["issues"]:
        location = issue["path"]
        if issue.get("line"):
            location += f":{issue['line']}"
        if issue.get("object"):
            location += f" object={issue['object']}"
        print(f"- [{issue['level']}] {issue['code']}: {location}")
    summary = report["summary"]
    print(f"Result: errors={summary['errors']} warnings={summary['warnings']}")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Check Git-published files and optional history for secrets/private data without printing values."
    )
    parser.add_argument("--root", default=str(APP_ROOT), help=argparse.SUPPRESS)
    parser.add_argument("--history", action="store_true", help="Scan all reachable Git blobs as well as current tracked files")
    parser.add_argument("--strict", action="store_true", help="Treat privacy warnings as failures")
    parser.add_argument("--json", action="store_true")
    return parser


def main() -> int:
    args = build_parser().parse_args()
    report = build_report(Path(args.root).resolve(), include_history=args.history)
    if args.json:
        print(json.dumps(report, ensure_ascii=False, indent=2))
    else:
        print_text(report)
    warning_failure = args.strict and report["summary"]["warnings"] > 0
    return 0 if report["ok"] and not warning_failure else 1


if __name__ == "__main__":
    sys.exit(main())
