from __future__ import annotations

import json
from pathlib import Path


ROOT = Path(__file__).resolve().parent
APPROVAL_PATH = ROOT / "workspace" / "telegram_research_approvals" / "attachments.json"
DIGEST_ROOT = ROOT / "workspace" / "broker_research_digest"
SOURCE_STATUS_ROOT = ROOT / "workspace" / "source_status"


def latest_telegram_source_status(
    source_status_root: Path = SOURCE_STATUS_ROOT,
) -> dict | None:
    for path in sorted(source_status_root.glob("*/source_status_*.json"), reverse=True):
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, UnicodeDecodeError, json.JSONDecodeError):
            continue
        for source in payload.get("sources", []):
            if (
                isinstance(source, dict)
                and source.get("source_id") == "telegram_channels"
            ):
                return source
    return None


def validate_telegram_research_run(
    approval_path: Path = APPROVAL_PATH,
    digest_root: Path = DIGEST_ROOT,
    source_status_root: Path = SOURCE_STATUS_ROOT,
) -> tuple[int, int]:
    if not approval_path.exists():
        print("Telegram PDF approval registry is not configured; validation skipped.")
        return 0, 0
    payload = json.loads(approval_path.read_text(encoding="utf-8"))
    if payload.get("schema_version") != "telegram_research_attachment_approvals.v1":
        raise RuntimeError("Telegram PDF approval registry schema is unsupported")
    approved_keys = {
        str(item.get("attachment_key") or "").strip().lower()
        for item in payload.get("decisions", [])
        if isinstance(item, dict)
        and item.get("decision") == "approved"
        and int(item.get("message_id") or 0) > 0
    }
    approved_keys.discard("")
    if not approved_keys:
        print("No backfill-ready approved Telegram PDFs; validation skipped.")
        return 0, 0

    digest_paths = sorted(digest_root.glob("*/broker_research_digest.json"), reverse=True)
    if not digest_paths:
        raise RuntimeError("Approved Telegram PDFs exist, but no broker research digest was produced")
    digest = json.loads(digest_paths[0].read_text(encoding="utf-8"))
    analyzed_keys: set[str] = set()
    for report in digest.get("reports", []):
        if not isinstance(report, dict):
            continue
        reference = str(report.get("source", {}).get("reference") or "")
        marker = ":attachment:"
        if marker not in reference:
            continue
        key = reference.rsplit(marker, 1)[-1].strip().lower()
        processing = report.get("processing", {})
        if key in approved_keys and processing.get("structured_analysis_available") is True:
            analyzed_keys.add(key)

    print(
        "Telegram approved PDF analysis: "
        f"{len(analyzed_keys)}/{len(approved_keys)} backfill-ready approval(s) structured."
    )
    if not analyzed_keys:
        telegram_status = latest_telegram_source_status(source_status_root)
        if telegram_status and telegram_status.get("status") == "timeout":
            timeout_seconds = telegram_status.get("timeout_seconds")
            timeout_label = (
                f" after {float(timeout_seconds):g}s"
                if isinstance(timeout_seconds, (int, float))
                else ""
            )
            raise RuntimeError(
                "Approved Telegram PDFs were not analyzed because the "
                f"telegram_channels collector timed out{timeout_label}; retry or increase "
                "COLLECTOR_TIMEOUT_TELEGRAM_CHANNELS_SECONDS"
            )
        raise RuntimeError(
            "Approved Telegram PDFs were not analyzed; check approval restore, message access, and PDF processing logs"
        )
    return len(approved_keys), len(analyzed_keys)


if __name__ == "__main__":
    validate_telegram_research_run()
