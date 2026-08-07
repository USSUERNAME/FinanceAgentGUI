from __future__ import annotations

import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

from collectors import official_research_documents


class OfficialResearchDocumentTests(unittest.TestCase):
    def source(self) -> dict:
        return {
            "id": "example_weekly",
            "publisher": "Example Asset Management",
            "title": "Weekly Market Recap",
            "document_url": "https://research.example.com/weekly.txt",
            "landing_page_url": "https://research.example.com/weekly",
            "official_domains": ["research.example.com"],
            "file_name": "weekly.txt",
            "market_scope": "US",
            "issuer_country": "US",
            "original_language": "en",
            "base_currency": "USD",
            "research_path": ["US", "Market Strategy"],
            "sectors": ["market strategy"],
        }

    def test_collect_builds_attributed_public_research_record(self) -> None:
        fetched = (
            b"Official weekly market commentary with style and sector returns.",
            "https://research.example.com/weekly.txt",
            {"last-modified": "Mon, 27 Jul 2026 12:00:00 GMT"},
        )
        with tempfile.TemporaryDirectory() as directory, patch.object(
            official_research_documents,
            "DOCUMENT_TEXT_CACHE_DIR",
            Path(directory),
        ):
            records, notice = official_research_documents.collect(
                {"official_research_documents": [self.source()]},
                fetcher=lambda *_args, **_kwargs: fetched,
                now=datetime(2026, 7, 28, tzinfo=timezone.utc),
            )
        self.assertIsNone(notice)
        self.assertEqual(len(records), 1)
        record = records[0]
        self.assertEqual(record["source_type"], "broker_report")
        self.assertEqual(record["source_grade"], "B")
        self.assertTrue(record["primary_source_confirmed"])
        self.assertEqual(
            record["evidence_scope"],
            "official_institutional_commentary_document",
        )
        self.assertEqual(record["market_scope"], "US")
        self.assertEqual(record["research_rights"]["publication_policy"], "summary_and_link_only")
        self.assertFalse(record["research_rights"]["redistribution_allowed"])
        self.assertEqual(record["published_at"], "2026-07-27T12:00:00+00:00")

    def test_collect_rejects_redirect_outside_official_domain(self) -> None:
        records, notice = official_research_documents.collect(
            {"official_research_documents": [self.source()]},
            fetcher=lambda *_args, **_kwargs: (
                b"unexpected",
                "https://untrusted.example.net/weekly.txt",
                {},
            ),
            now=datetime(2026, 7, 28, tzinfo=timezone.utc),
        )
        self.assertEqual(records, [])
        self.assertIn("1 official research document", notice)

    def test_collect_rejects_invalid_pdf_signature(self) -> None:
        source = self.source()
        source["document_url"] = "https://research.example.com/weekly.pdf"
        source["file_name"] = "weekly.pdf"
        records, notice = official_research_documents.collect(
            {"official_research_documents": [source]},
            fetcher=lambda *_args, **_kwargs: (
                b"<html>blocked</html>",
                "https://research.example.com/weekly.pdf",
                {},
            ),
            now=datetime(2026, 7, 28, tzinfo=timezone.utc),
        )
        self.assertEqual(records, [])
        self.assertIn("1 official research document", notice)


if __name__ == "__main__":
    unittest.main()
