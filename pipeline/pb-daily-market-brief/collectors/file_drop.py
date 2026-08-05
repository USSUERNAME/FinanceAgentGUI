"""Ingest operator-authorized broker reports without browser scraping."""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

from broker_research_policy import (
    DOCUMENT_TEXT_CACHE_DIR,
    SUPPORTED_DOCUMENT_SUFFIXES,
    report_record,
)
from collectors.common import ROOT

DROP_DIR = ROOT / "workspace" / "incoming_reports"


def configured_drop_dir() -> Path:
    """Resolve after `.env` is loaded while preserving test overrides."""
    configured = os.getenv("BROKER_REPORT_INBOX_DIR", "").strip()
    return Path(configured) if configured else DROP_DIR


def load_sidecar(path: Path) -> dict[str, Any]:
    """Load lineage and rights metadata from `<report>.meta.json`."""
    sidecar = path.with_suffix(".meta.json")
    if not sidecar.exists():
        return {}
    payload = json.loads(sidecar.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError(f"Report metadata must be a JSON object: {sidecar.name}")
    return payload


def collect(_: dict[str, Any]) -> tuple[list[dict[str, Any]], str | None]:
    drop_dir = configured_drop_dir()
    drop_dir.mkdir(parents=True, exist_ok=True)
    items: list[dict[str, Any]] = []
    rejected = 0
    paths = sorted(
        path for path in drop_dir.iterdir()
        if path.is_file() and path.suffix.lower() in SUPPORTED_DOCUMENT_SUFFIXES
    )
    for path in paths:
        try:
            metadata = load_sidecar(path)
            if not metadata:
                raise ValueError(f"Missing rights sidecar: {path.stem}.meta.json")
            items.append(report_record(
                source_id="authorized_report_drop",
                file_name=path.name,
                payload=path.read_bytes(),
                metadata=metadata,
                document_text_cache_dir=DOCUMENT_TEXT_CACHE_DIR,
            ))
        except (OSError, RuntimeError, ValueError, json.JSONDecodeError):
            # Fail closed per file. Only a count reaches workflow logs, so private
            # filenames and report titles are not exposed on rejection.
            rejected += 1
    notice = (
        f"{rejected} report(s) rejected by the rights or document gate"
        if rejected else None
    )
    return items, notice
