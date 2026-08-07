from __future__ import annotations

import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from collectors import sec_inbox
from collectors.filing_body import extract_filing_text, fetch_sec_document, sec_exhibit_links
from collectors.filing_facts import extract_filing_facts


class FilingBodyAndSecInboxTests(unittest.TestCase):
    def test_filing_text_extractor_keeps_table_facts_and_drops_scripts(self) -> None:
        markup = """
        <html><script>ignore me</script><body>
        <h1>Item 2.02 Results of Operations</h1>
        <table><tr><th>Revenue</th><td>$100 million</td></tr></table>
        </body></html>
        """
        text = extract_filing_text(markup, 6000)
        self.assertIn("Item 2.02 Results of Operations", text)
        self.assertIn("Revenue", text)
        self.assertIn("$100 million", text)
        self.assertNotIn("ignore me", text)

    def test_sec_fetch_rejects_non_sec_domain_before_network(self) -> None:
        result = fetch_sec_document(
            "https://example.com/filing.htm",
            "Research User research@example.com",
        )
        self.assertEqual(result["status"], "not_permitted_non_sec_domain")

    def test_sec_exhibit_links_allow_only_official_exhibit_99(self) -> None:
        markup = """
        <a href="tsla-exhibit991pressrelease.htm">EX-99.1</a>
        <a href="https://example.com/exhibit99.htm">Exhibit 99 external</a>
        <a href="primary.htm">8-K primary document</a>
        """
        links = sec_exhibit_links(
            markup,
            "https://www.sec.gov/Archives/edgar/data/1/filing.htm",
        )
        self.assertEqual(links, [{
            "url": "https://www.sec.gov/Archives/edgar/data/1/tsla-exhibit991pressrelease.htm",
            "label": "EX-99.1",
        }])

    def test_sec_8k_focus_starts_at_first_item(self) -> None:
        from email.message import Message

        class FakeResponse:
            def __init__(self) -> None:
                self.headers = Message()
                self.headers["Content-Type"] = "text/html; charset=utf-8"

            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return False

            def geturl(self) -> str:
                return "https://www.sec.gov/Archives/test.htm"

            def read(self, _size: int) -> bytes:
                return (
                    b"<html><body><h1>FORM 8-K COVER PAGE</h1>"
                    b"<p>Item 2.02 Results of Operations</p><p>Revenue was $100 million.</p>"
                    b"</body></html>"
                )

        with patch("collectors.filing_body.urlopen", return_value=FakeResponse()):
            result = fetch_sec_document(
                "https://www.sec.gov/Archives/test.htm",
                "Research User research@example.com",
                form="8-K",
            )
        self.assertEqual(result["status"], "filing_body_extracted")
        self.assertTrue(result["text"].startswith("Item 2.02"))
        self.assertNotIn("COVER PAGE", result["text"])

    def test_sec_8k_fetches_bounded_official_exhibit_99(self) -> None:
        from email.message import Message

        class FakeResponse:
            def __init__(self, body: bytes, url: str) -> None:
                self.body = body
                self.url = url
                self.headers = Message()
                self.headers["Content-Type"] = "text/html; charset=utf-8"

            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return False

            def geturl(self) -> str:
                return self.url

            def read(self, _size: int) -> bytes:
                return self.body

        primary_url = "https://www.sec.gov/Archives/edgar/data/1/filing.htm"
        exhibit_url = "https://www.sec.gov/Archives/edgar/data/1/ex991.htm"
        primary = FakeResponse(
            b'<html><body><p>Item 2.02 Results.</p><a href="ex991.htm">EX-99.1</a></body></html>',
            primary_url,
        )
        exhibit = FakeResponse(
            b"<html><body><h1>Quarterly Results</h1><p>Revenue was $100 million.</p></body></html>",
            exhibit_url,
        )
        with patch("collectors.filing_body.urlopen", side_effect=[primary, exhibit]):
            result = fetch_sec_document(
                primary_url,
                "Research User research@example.com",
                form="8-K",
            )
        self.assertEqual(len(result["attachments"]), 1)
        self.assertEqual(result["attachments"][0]["url"], exhibit_url)
        self.assertEqual(result["attachments"][0]["status"], "filing_body_extracted")
        self.assertIn("[EX-99.1]", result["text"])
        self.assertIn("$100 million", result["text"])

    def test_sec_inbox_body_excerpt_is_bounded_and_deduplicated(self) -> None:
        row = {
            "ticker": "TEST",
            "company": "Test Corp",
            "form": "8-K",
            "filing_date": "2026-07-22",
            "report_date": "2026-07-22",
            "accession_number": "0000000000-26-000001",
            "source_url": "https://www.sec.gov/Archives/edgar/data/1/test.htm",
        }
        with tempfile.TemporaryDirectory() as temp_dir:
            inbox = Path(temp_dir)
            (inbox / "sec_filings_20260723_010000.json").write_text(
                json.dumps([row]), encoding="utf-8",
            )
            (inbox / "sec_filings_20260723_020000.json").write_text(
                json.dumps([row]), encoding="utf-8",
            )
            config = {
                "sec_filings": {
                    "fetch_bodies": True,
                    "max_body_fetches": 1,
                    "max_body_chars": 6000,
                },
            }
            with patch.object(sec_inbox, "SEC_INBOX", inbox), patch.dict(
                os.environ,
                {"SEC_USER_AGENT": "Research User research@example.com"},
                clear=True,
            ), patch.object(
                sec_inbox,
                "fetch_sec_document",
                return_value={
                    "status": "filing_body_extracted",
                    "text": "Item 2.02. Revenue was $100 million.",
                    "text_chars": 37,
                    "byte_limit_reached": False,
                },
            ) as fetch:
                items, notice = sec_inbox.collect(config)

        self.assertIsNone(notice)
        self.assertEqual(len(items), 1)
        self.assertEqual(fetch.call_count, 1)
        self.assertEqual(items[0]["evidence_scope"], "filing_body_excerpt")
        self.assertEqual(items[0]["filing_accession_number"], row["accession_number"])
        self.assertIn("$100 million", items[0]["raw_text"])
        self.assertNotIn("text", items[0]["filing_body"])
        self.assertEqual(
            items[0]["filing_facts"]["facts"][0]["field"],
            "sec_item",
        )

    def test_dart_facts_require_explicit_label_value_pairs(self) -> None:
        record = {
            "id": "dart-1",
            "source_id": "opendart",
            "evidence_scope": "filing_body_excerpt",
            "filing_receipt_no": "202607230001",
            "url": "https://dart.fss.or.kr/dsaf001/main.do?rcpNo=202607230001",
            "raw_text": (
                "OpenDART 공시 본문 발췌\n"
                "전환가액\n12,500원\n"
                "자금조달의 목적\n시설자금 및 운영자금\n"
                "투자자에게 중요할 수 있다"
            ),
        }
        result = extract_filing_facts(record)
        facts = {item["field"]: item for item in result["facts"]}
        self.assertEqual(result["extraction_status"], "fact_candidates_available")
        self.assertEqual(facts["conversion_price"]["value_text"], "12,500원")
        self.assertEqual(
            facts["use_of_proceeds"]["value_text"],
            "시설자금 및 운영자금",
        )
        self.assertEqual(result["materiality_status"], "not_computable")
        self.assertNotIn("투자자에게 중요", json.dumps(result, ensure_ascii=False))

    def test_sec_amount_keeps_candidate_semantics_and_exact_context(self) -> None:
        record = {
            "id": "sec-1",
            "source_id": "sec_edgar",
            "evidence_scope": "filing_body_excerpt",
            "filing_accession_number": "0001",
            "url": "https://www.sec.gov/Archives/test.htm",
            "raw_text": (
                "Item 2.02 Results of Operations. "
                "Revenue for the quarter was $100 million. "
                "The company made no statement about materiality."
            ),
        }
        result = extract_filing_facts(record)
        amounts = [
            item for item in result["facts"]
            if item["field"] == "reported_revenue_amount_candidate"
        ]
        self.assertEqual(amounts[0]["value_text"], "$100 million")
        self.assertIn("Revenue for the quarter", amounts[0]["context"])
        self.assertEqual(result["materiality_status"], "not_computable")


if __name__ == "__main__":
    unittest.main()
