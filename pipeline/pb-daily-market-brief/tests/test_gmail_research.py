from __future__ import annotations

import base64
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from collectors import gmail_research


def encoded(value: str) -> str:
    return base64.urlsafe_b64encode(value.encode("utf-8")).decode("ascii").rstrip("=")


class GmailResearchTests(unittest.TestCase):
    def config(self) -> dict:
        return {
            "gmail_research": {
                "label_name": "Stocks",
                "sender_sources": [{
                    "id": "example_newsletter",
                    "publisher": "Example Research",
                    "sender_domains": ["research.example.com"],
                    "market_scope": "US",
                    "issuer_country": "US",
                    "original_language": "en",
                    "base_currency": "USD",
                    "research_path": ["US", "Strategy"],
                    "sectors": ["market strategy"],
                }],
            },
        }

    def message(self, *, sender: str = "Research <weekly@research.example.com>") -> dict:
        return {
            "id": "message-1",
            "internalDate": "1785232800000",
            "payload": {
                "mimeType": "multipart/mixed",
                "headers": [
                    {"name": "From", "value": sender},
                    {"name": "Subject", "value": "Weekly market outlook"},
                    {"name": "Date", "value": "Mon, 27 Jul 2026 12:00:00 GMT"},
                    {
                        "name": "Authentication-Results",
                        "value": (
                            "mx.google.com; dkim=pass "
                            "header.i=@research.example.com "
                            "header.d=research.example.com; "
                            "dmarc=pass header.from=research.example.com"
                        ),
                    },
                ],
                "parts": [
                    {
                        "mimeType": "text/html",
                        "body": {"data": encoded("<p>Rates rose while value stocks led.</p>")},
                    },
                    {
                        "mimeType": "application/pdf",
                        "filename": "appendix.pdf",
                        "body": {"attachmentId": "attachment-1"},
                    },
                ],
            },
        }

    def test_message_text_falls_back_to_html(self) -> None:
        text = gmail_research.message_text(self.message()["payload"])
        self.assertEqual(text, "Rates rose while value stocks led.")

    def test_collect_reads_only_allowlisted_sender_and_marks_pdf_review(self) -> None:
        env = {
            "GOOGLE_GMAIL_CLIENT_ID": "client",
            "GOOGLE_GMAIL_CLIENT_SECRET": "secret",
            "GOOGLE_GMAIL_REFRESH_TOKEN": "refresh",
        }
        with tempfile.TemporaryDirectory() as directory, patch.dict(
            "os.environ",
            env,
            clear=False,
        ), patch.object(
            gmail_research,
            "DOCUMENT_TEXT_CACHE_DIR",
            Path(directory),
        ), patch.object(
            gmail_research,
            "refresh_access_token",
            return_value="token",
        ), patch.object(
            gmail_research,
            "resolve_label_id",
            return_value="Label_Stocks",
        ), patch.object(
            gmail_research,
            "list_message_ids",
            return_value=["message-1"],
        ), patch.object(
            gmail_research,
            "get_message",
            return_value=self.message(),
        ):
            records, notice = gmail_research.collect(self.config())
        self.assertEqual(len(records), 1)
        self.assertIn("1 PDF attachment", notice)
        record = records[0]
        self.assertEqual(record["publisher"], "Example Research")
        self.assertEqual(record["market_scope"], "US")
        self.assertEqual(record["research_rights"]["acquisition_mode"], "official_email")
        self.assertTrue(record["gmail_message"]["attachment_review_required"])
        self.assertFalse(record["gmail_message"]["attachment_downloaded"])
        self.assertEqual(
            record["gmail_message"]["attachments"][0]["approval_state"],
            "pending",
        )
        self.assertNotIn(
            "provider_attachment_id",
            record["gmail_message"]["attachments"][0],
        )
        self.assertNotIn("weekly@research.example.com", json.dumps(record))

    def test_collect_downloads_only_explicitly_approved_pdf(self) -> None:
        env = {
            "GOOGLE_GMAIL_CLIENT_ID": "client",
            "GOOGLE_GMAIL_CLIENT_SECRET": "secret",
            "GOOGLE_GMAIL_REFRESH_TOKEN": "refresh",
        }
        message = self.message()
        attachment = gmail_research._attachments(message["payload"], "message-1")[0]

        def fake_report_record(**kwargs):
            return {
                "publisher": kwargs["metadata"]["publisher"],
                "title": kwargs["metadata"]["title"],
                "source_reference": kwargs["metadata"]["source_reference"],
                "file_name": kwargs["file_name"],
            }

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            approval_path = root / "attachments.json"
            approval_path.write_text(
                json.dumps({
                    "schema_version": gmail_research.GMAIL_ATTACHMENT_APPROVALS_SCHEMA,
                    "decisions": [{
                        "attachment_key": attachment["attachment_key"],
                        "decision": "approved",
                    }],
                }),
                encoding="utf-8",
            )
            with patch.dict("os.environ", env, clear=False), patch.object(
                gmail_research,
                "GMAIL_ATTACHMENT_APPROVALS_PATH",
                approval_path,
            ), patch.object(
                gmail_research,
                "refresh_access_token",
                return_value="token",
            ), patch.object(
                gmail_research,
                "resolve_label_id",
                return_value="Label_Stocks",
            ), patch.object(
                gmail_research,
                "list_message_ids",
                return_value=["message-1"],
            ), patch.object(
                gmail_research,
                "get_message",
                return_value=message,
            ), patch.object(
                gmail_research,
                "get_attachment",
                return_value=b"%PDF-approved",
            ) as download, patch.object(
                gmail_research,
                "report_record",
                side_effect=fake_report_record,
            ):
                records, _ = gmail_research.collect(self.config())

        self.assertEqual(len(records), 2)
        download.assert_called_once()
        self.assertTrue(records[0]["gmail_message"]["attachment_downloaded"])
        self.assertEqual(records[1]["file_name"], "appendix.pdf")
        self.assertEqual(
            records[1]["gmail_attachment"]["approval_state"],
            "approved",
        )

    def test_invalid_approval_registry_blocks_attachment_download(self) -> None:
        env = {
            "GOOGLE_GMAIL_CLIENT_ID": "client",
            "GOOGLE_GMAIL_CLIENT_SECRET": "secret",
            "GOOGLE_GMAIL_REFRESH_TOKEN": "refresh",
        }
        with tempfile.TemporaryDirectory() as directory:
            approval_path = Path(directory) / "attachments.json"
            approval_path.write_text("{invalid", encoding="utf-8")
            with patch.dict("os.environ", env, clear=False), patch.object(
                gmail_research,
                "GMAIL_ATTACHMENT_APPROVALS_PATH",
                approval_path,
            ), patch.object(
                gmail_research,
                "DOCUMENT_TEXT_CACHE_DIR",
                Path(directory),
            ), patch.object(
                gmail_research,
                "refresh_access_token",
                return_value="token",
            ), patch.object(
                gmail_research,
                "resolve_label_id",
                return_value="Label_Stocks",
            ), patch.object(
                gmail_research,
                "list_message_ids",
                return_value=["message-1"],
            ), patch.object(
                gmail_research,
                "get_message",
                return_value=self.message(),
            ), patch.object(
                gmail_research,
                "get_attachment",
            ) as download:
                records, notice = gmail_research.collect(self.config())

        self.assertEqual(len(records), 1)
        download.assert_not_called()
        self.assertIn("downloads were blocked", notice)

    def test_collect_rejects_sender_outside_allowlist(self) -> None:
        env = {
            "GOOGLE_GMAIL_CLIENT_ID": "client",
            "GOOGLE_GMAIL_CLIENT_SECRET": "secret",
            "GOOGLE_GMAIL_REFRESH_TOKEN": "refresh",
        }
        with patch.dict("os.environ", env, clear=False), patch.object(
            gmail_research,
            "refresh_access_token",
            return_value="token",
        ), patch.object(
            gmail_research,
            "resolve_label_id",
            return_value="Label_Stocks",
        ), patch.object(
            gmail_research,
            "list_message_ids",
            return_value=["message-1"],
        ), patch.object(
            gmail_research,
            "get_message",
            return_value=self.message(sender="Unknown <mail@untrusted.example.net>"),
        ):
            records, notice = gmail_research.collect(self.config())
        self.assertEqual(records, [])
        self.assertIn("1 Gmail message", notice)

    def test_collect_is_optional_without_credentials(self) -> None:
        env = {
            "GOOGLE_GMAIL_CLIENT_ID": "",
            "GOOGLE_GMAIL_CLIENT_SECRET": "",
            "GOOGLE_GMAIL_REFRESH_TOKEN": "",
        }
        with patch.dict("os.environ", env, clear=False):
            records, notice = gmail_research.collect(self.config())
        self.assertEqual(records, [])
        self.assertEqual(notice, "Gmail research inbox not configured")


if __name__ == "__main__":
    unittest.main()
