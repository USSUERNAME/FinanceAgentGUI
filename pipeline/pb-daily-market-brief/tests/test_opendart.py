from __future__ import annotations

import os
import unittest
from unittest.mock import patch

from collectors import opendart


class OpenDartCollectorTests(unittest.TestCase):
    def test_missing_key_skips_cleanly(self) -> None:
        with patch.dict(os.environ, {}, clear=True):
            items, notice = opendart.collect({})
        self.assertEqual(items, [])
        self.assertEqual(notice, "OPENDART_API_KEY not set")

    def test_collects_and_prioritizes_major_disclosure_metadata(self) -> None:
        responses = {
            "B": {
                "status": "000",
                "list": [{
                    "corp_cls": "Y", "corp_name": "테스트전자", "stock_code": "123456",
                    "report_nm": "주요사항보고서(유상증자결정)", "rcept_no": "20260718000001",
                    "flr_nm": "테스트전자", "rcept_dt": "20260718",
                }],
            },
            "A": {
                "status": "000",
                "list": [{
                    "corp_cls": "Y", "corp_name": "테스트전자", "stock_code": "123456",
                    "report_nm": "분기보고서", "rcept_no": "20260718000002",
                    "flr_nm": "테스트전자", "rcept_dt": "20260718",
                }],
            },
        }

        def fake_get_json(url: str) -> dict:
            disclosure_type = "B" if "pblntf_ty=B" in url else "A"
            return responses[disclosure_type]

        config = {"opendart": {"max_items": 1, "disclosure_types": ["A", "B"]}}
        with patch.dict(os.environ, {"OPENDART_API_KEY": "x" * 40}, clear=True), patch.object(
            opendart, "get_json", side_effect=fake_get_json
        ):
            items, notice = opendart.collect(config)

        self.assertIsNone(notice)
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]["source_type"], "korean_filing")
        self.assertEqual(items[0]["tickers"], ["123456"])
        self.assertIn("유상증자", items[0]["title"])
        self.assertTrue(items[0]["url"].endswith("20260718000001"))
        self.assertEqual(items[0]["evidence_scope"], "filing_metadata_only")

    def test_body_excerpt_upgrades_evidence_scope_without_claiming_full_review(self) -> None:
        response = {
            "status": "000",
            "list": [{
                "corp_cls": "Y", "corp_name": "테스트전자", "stock_code": "123456",
                "report_nm": "주요사항보고서(유상증자결정)", "rcept_no": "20260718000001",
                "flr_nm": "테스트전자", "rcept_dt": "20260718",
            }],
        }
        config = {
            "opendart": {
                "max_items": 1,
                "disclosure_types": ["B"],
                "fetch_bodies": True,
                "max_body_fetches": 1,
                "max_body_chars": 6000,
                "body_request_delay_seconds": 0,
            },
        }
        with patch.dict(os.environ, {"OPENDART_API_KEY": "x" * 40}, clear=True), patch.object(
            opendart, "get_json", return_value=response,
        ), patch.object(
            opendart,
            "fetch_dart_document",
            return_value={
                "status": "filing_body_extracted",
                "text": "신주의 종류 보통주식 수 1,000주 자금조달의 목적 시설자금",
                "text_chars": 36,
                "archive_entry_count": 1,
            },
        ):
            items, notice = opendart.collect(config)

        self.assertIsNone(notice)
        self.assertEqual(items[0]["evidence_scope"], "filing_body_excerpt")
        self.assertEqual(items[0]["evidence_label"], "verified_primary_body_excerpt")
        self.assertIn("시설자금", items[0]["raw_text"])
        self.assertNotIn("text", items[0]["filing_body"])
        self.assertEqual(items[0]["filing_body"]["status"], "filing_body_extracted")


if __name__ == "__main__":
    unittest.main()
