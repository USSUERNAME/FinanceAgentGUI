from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from validate_telegram_research_run import validate_telegram_research_run


class ValidateTelegramResearchRunTests(unittest.TestCase):
    def test_accepts_at_least_one_structured_approved_pdf(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            approval_path = root / "attachments.json"
            digest_root = root / "digest"
            digest_path = digest_root / "2026-08-10" / "broker_research_digest.json"
            digest_path.parent.mkdir(parents=True)
            key = "a" * 64
            approval_path.write_text(json.dumps({
                "schema_version": "telegram_research_attachment_approvals.v1",
                "decisions": [{
                    "attachment_key": key,
                    "decision": "approved",
                    "message_id": 101,
                }],
            }), encoding="utf-8")
            digest_path.write_text(json.dumps({
                "reports": [{
                    "source": {"reference": f"telegram:broker:101:attachment:{key}"},
                    "processing": {"structured_analysis_available": True},
                }],
            }), encoding="utf-8")

            self.assertEqual(
                validate_telegram_research_run(approval_path, digest_root),
                (1, 1),
            )

    def test_rejects_zero_structured_approved_pdfs(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            approval_path = root / "attachments.json"
            digest_root = root / "digest"
            digest_path = digest_root / "2026-08-10" / "broker_research_digest.json"
            digest_path.parent.mkdir(parents=True)
            approval_path.write_text(json.dumps({
                "schema_version": "telegram_research_attachment_approvals.v1",
                "decisions": [{
                    "attachment_key": "a" * 64,
                    "decision": "approved",
                    "message_id": 101,
                }],
            }), encoding="utf-8")
            digest_path.write_text(json.dumps({"reports": []}), encoding="utf-8")

            with self.assertRaisesRegex(RuntimeError, "were not analyzed"):
                validate_telegram_research_run(approval_path, digest_root)

    def test_reports_telegram_collector_timeout_explicitly(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            approval_path = root / "attachments.json"
            digest_root = root / "digest"
            source_status_root = root / "source_status"
            digest_path = digest_root / "2026-08-10" / "broker_research_digest.json"
            status_path = source_status_root / "2026-08-10" / "source_status_084424.json"
            digest_path.parent.mkdir(parents=True)
            status_path.parent.mkdir(parents=True)
            approval_path.write_text(json.dumps({
                "schema_version": "telegram_research_attachment_approvals.v1",
                "decisions": [{
                    "attachment_key": "a" * 64,
                    "decision": "approved",
                    "message_id": 101,
                }],
            }), encoding="utf-8")
            digest_path.write_text(json.dumps({"reports": []}), encoding="utf-8")
            status_path.write_text(json.dumps({
                "sources": [{
                    "source_id": "telegram_channels",
                    "status": "timeout",
                    "timeout_seconds": 60.0,
                }],
            }), encoding="utf-8")

            with self.assertRaisesRegex(
                RuntimeError,
                "telegram_channels collector timed out after 60s",
            ):
                validate_telegram_research_run(
                    approval_path,
                    digest_root,
                    source_status_root,
                )
