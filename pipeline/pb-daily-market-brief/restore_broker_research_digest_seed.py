"""Restore rights-safe broker digest history from a repository secret."""

from __future__ import annotations

import base64
import gzip
import json
import os
from datetime import date
from pathlib import Path
from typing import Any

from collectors.common import ROOT

SEED_SCHEMA = "broker_research_digest_seed.v1"
DIGEST_SCHEMA = "broker_research_digest.v1"
PUBLICATION_POLICIES = {"private_analysis_only", "summary_and_link_only"}


def _validated_digest(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict) or value.get("schema_version") != DIGEST_SCHEMA:
        raise ValueError("Broker digest seed contains an unsupported digest")
    report_date = str(value.get("report_date") or "")
    try:
        date.fromisoformat(report_date)
    except ValueError as exc:
        raise ValueError("Broker digest seed has an invalid report date") from exc
    reports = value.get("reports")
    if not isinstance(reports, list):
        raise ValueError("Broker digest seed reports must be a list")
    for report in reports:
        rights = report.get("rights") if isinstance(report, dict) else None
        if (
            not isinstance(report, dict)
            or "raw_text" in report
            or not isinstance(rights, dict)
            or rights.get("redistribution_allowed") is not False
            or rights.get("full_text_included") is not False
            or rights.get("publication_policy") not in PUBLICATION_POLICIES
        ):
            raise ValueError("Broker digest seed contains a non-rights-safe report")
    return value


def restore_seed(encoded: str, *, workspace_root: Path | None = None) -> int:
    value = encoded.strip()
    if not value:
        return 0
    try:
        payload = json.loads(gzip.decompress(base64.b64decode(value, validate=True)))
    except (ValueError, OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ValueError("Broker digest seed secret is invalid") from exc
    if payload.get("schema_version") != SEED_SCHEMA:
        raise ValueError("Broker digest seed schema is unsupported")
    workspace = workspace_root or ROOT / "workspace"
    restored = 0
    for value in payload.get("digests") or []:
        digest = _validated_digest(value)
        destination = (
            workspace / "broker_research_digest" / digest["report_date"] /
            "broker_research_digest.json"
        )
        if destination.exists():
            continue
        destination.parent.mkdir(parents=True, exist_ok=True)
        temporary = destination.with_suffix(".tmp")
        temporary.write_text(
            json.dumps(digest, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        temporary.replace(destination)
        restored += 1
    return restored


def main() -> None:
    restored = restore_seed(os.getenv("BROKER_RESEARCH_DIGEST_HISTORY_GZIP_BASE64", ""))
    print(f"Restored {restored} broker research digest seed file(s).")


if __name__ == "__main__":
    main()
