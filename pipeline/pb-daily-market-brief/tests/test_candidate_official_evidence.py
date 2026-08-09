from __future__ import annotations

import unittest

from enrich_us_equity_candidate_evidence import (
    collect_candidate_official_evidence,
    extract_ir_facts,
)
from screen_us_equity_candidates import event_evidence


def candidate_screen() -> dict:
    return {
        "schema_version": "us_equity_candidate_screen.v1",
        "report_date": "2026-08-09",
        "candidates": [{
            "ticker": "NVDA",
            "company_name": "NVIDIA",
            "selection_score": 35,
            "deep_analysis_eligible": False,
        }],
    }


def company_map() -> dict:
    return {"0": {"ticker": "NVDA", "cik_str": 1045810, "title": "NVIDIA CORP"}}


def submissions() -> dict:
    return {
        "name": "NVIDIA CORP",
        "investorWebsite": "https://investor.nvidia.com/",
        "filings": {"recent": {
            "form": ["8-K"],
            "filingDate": ["2026-08-08"],
            "accessionNumber": ["0001045810-26-000001"],
            "primaryDocument": ["nvda-20260808.htm"],
        }},
    }


class CandidateOfficialEvidenceTests(unittest.TestCase):
    def test_offline_mode_is_explicit_and_never_fetches(self) -> None:
        payload = collect_candidate_official_evidence(
            "2026-08-09",
            candidate_screen(),
            user_agent="Researcher research@example.com",
            no_network=True,
        )
        self.assertFalse(payload["network_enabled"])
        self.assertEqual(payload["candidate_count"], 1)
        self.assertEqual(payload["verified_record_count"], 0)

    def test_recent_sec_body_with_exact_fact_creates_verified_record(self) -> None:
        payload = collect_candidate_official_evidence(
            "2026-08-09",
            candidate_screen(),
            user_agent="Researcher research@example.com",
            company_map_payload=company_map(),
            submissions_fetcher=lambda _cik: submissions(),
            document_fetcher=lambda *_args, **_kwargs: {
                "status": "filing_body_extracted",
                "text": "Item 2.02 Results of Operations. Revenue was $100 million.",
            },
        )
        self.assertEqual(payload["status"], "verified_records_ready")
        self.assertEqual(payload["verified_record_count"], 1)
        record = payload["records"][0]
        self.assertEqual(record["source_id"], "sec_edgar")
        self.assertNotIn("raw_text", record)
        self.assertTrue(record["filing_facts"]["facts"])
        evidence = event_evidence([record])["NVDA"]
        self.assertEqual(evidence["official_material_score"], 10)
        self.assertTrue(evidence["events"][0]["verified_facts"])

    def test_sec_body_without_supported_fact_does_not_promote(self) -> None:
        payload = collect_candidate_official_evidence(
            "2026-08-09",
            candidate_screen(),
            user_agent="Researcher research@example.com",
            company_map_payload=company_map(),
            submissions_fetcher=lambda _cik: {**submissions(), "investorWebsite": ""},
            document_fetcher=lambda *_args, **_kwargs: {
                "status": "filing_body_extracted",
                "text": "This filing contains no supported numeric fact excerpt.",
            },
        )
        self.assertEqual(payload["verified_record_count"], 0)
        self.assertEqual(
            payload["candidate_audit"][0]["official_sources"][0]["status"],
            "filing_body_without_supported_facts",
        )

    def test_ir_fact_extraction_keeps_exact_context_and_source(self) -> None:
        url = "https://investor.example.com/news/2026-08-08-results"
        facts = extract_ir_facts(
            "Quarterly revenue was $250 million and operating margin was 21%.",
            url,
        )
        self.assertTrue(facts)
        self.assertTrue(all(item["source_url"] == url for item in facts))
        self.assertTrue(all(item["evidence_status"] == "exact_official_ir_excerpt" for item in facts))

    def test_sec_declared_ir_release_can_supply_verified_facts(self) -> None:
        no_filings = submissions()
        no_filings["filings"] = {"recent": {"form": []}}

        def fetch_page(url: str, _user_agent: str) -> dict:
            if url.rstrip("/") == "https://investor.nvidia.com":
                return {
                    "status": "html_fetched",
                    "url": "https://investor.nvidia.com/",
                    "html": '<a href="/news/2026-08-08-financial-results">Quarterly financial results</a>',
                }
            return {
                "status": "html_fetched",
                "url": url,
                "html": (
                    '<html><head><title>NVIDIA quarterly results</title>'
                    '<meta property="article:published_time" content="2026-08-08T08:00:00Z">'
                    '</head><body><p>Quarterly revenue was $250 million and '
                    'operating margin was 21%.</p></body></html>'
                ),
            }

        payload = collect_candidate_official_evidence(
            "2026-08-09",
            candidate_screen(),
            user_agent="Researcher research@example.com",
            company_map_payload=company_map(),
            submissions_fetcher=lambda _cik: no_filings,
            ir_page_fetcher=fetch_page,
        )
        self.assertEqual(payload["verified_record_count"], 1)
        record = payload["records"][0]
        self.assertEqual(record["source_id"], "company_ir")
        self.assertTrue(record["verified_facts"])
        evidence = event_evidence([record])["NVDA"]
        self.assertEqual(evidence["official_material_score"], 10)


if __name__ == "__main__":
    unittest.main()
