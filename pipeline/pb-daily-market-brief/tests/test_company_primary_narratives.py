from __future__ import annotations

import unittest
from datetime import date

from collect_company_primary_narratives import (
    collect_company_primary_narratives,
    extract_annual_narratives,
    latest_annual_filing,
)


def queue() -> dict:
    return {"candidates": [{
        "candidate_id": "event_screen:US:ABNB",
        "queue_stage": "valuation_expectations_gated",
        "market": "US",
        "ticker": "ABNB",
        "company_name": "Airbnb",
    }]}


def company_map() -> dict:
    return {"0": {"ticker": "ABNB", "cik_str": 1559720, "title": "AIRBNB INC"}}


def submissions() -> dict:
    return {
        "name": "AIRBNB INC",
        "filings": {"recent": {
            "form": ["10-Q", "10-K", "10-K/A"],
            "filingDate": ["2026-05-01", "2026-02-15", "2025-03-01"],
            "accessionNumber": [
                "0001559720-26-000020", "0001559720-26-000004", "0001559720-25-000008",
            ],
            "primaryDocument": ["abnb-20260331.htm", "abnb-20251231.htm", "abnb-20241231x10ka.htm"],
        }},
    }


def annual_body() -> str:
    business = (
        "We operate a global marketplace that connects hosts and guests. "
        "Our platform benefits from network effects as more hosts expand selection and more guests increase demand. "
        "We earn service fees from reservations and invest in trust, safety, payments, and customer support. "
        "Competition includes online travel agencies, hotels, and other accommodation platforms. "
    )
    risks = (
        "Our business may be harmed if hosts or guests reduce use of the platform. "
        "Regulatory requirements, safety incidents, payment failures, and intense competition may adversely affect results. "
        "Changes in travel demand and macroeconomic conditions may also reduce bookings and revenue. "
    )
    return f"Table of Contents ITEM 1. BUSINESS short index ITEM 1A. RISK FACTORS index ITEM 1. BUSINESS {business} ITEM 1A. RISK FACTORS {risks} ITEM 2. PROPERTIES offices"


class CompanyPrimaryNarrativeTests(unittest.TestCase):
    def test_latest_non_amended_annual_filing_is_selected(self) -> None:
        filing = latest_annual_filing(submissions(), date(2026, 8, 9))
        self.assertIsNotNone(filing)
        self.assertEqual(filing["form"], "10-K")
        self.assertEqual(filing["filing_date"], "2026-02-15")

    def test_business_risk_and_issuer_claims_are_bounded_and_separate(self) -> None:
        result = extract_annual_narratives(annual_body())
        self.assertIn("global marketplace", result["business_excerpt"])
        self.assertIn("Regulatory requirements", result["risk_excerpt"])
        self.assertTrue(any("network effects" in row for row in result["competitive_claims"]))
        self.assertLessEqual(len(result["business_excerpt"]), 2000)
        self.assertLessEqual(len(result["risk_excerpt"]), 2000)

    def test_offline_mode_never_collects_or_promotes(self) -> None:
        payload = collect_company_primary_narratives(
            "2026-08-09", queue(), user_agent="Researcher research@example.com", no_network=True,
        )
        self.assertEqual(payload["collection_status"], "offline")
        self.assertEqual(payload["collected_company_count"], 0)
        self.assertFalse(payload["network_enabled"])

    def test_sec_annual_body_creates_business_evidence_but_not_verified_moat(self) -> None:
        payload = collect_company_primary_narratives(
            "2026-08-09",
            queue(),
            user_agent="Researcher research@example.com",
            company_map_payload=company_map(),
            submissions_fetcher=lambda _cik: submissions(),
            document_fetcher=lambda *_args, **_kwargs: {
                "status": "filing_body_extracted",
                "text": annual_body(),
            },
        )
        self.assertEqual(payload["collection_status"], "available")
        self.assertEqual(payload["collected_company_count"], 1)
        company = payload["companies"][0]
        self.assertEqual(company["business_model"]["status"], "verified_primary")
        self.assertEqual(company["annual_filing"]["form"], "10-K")
        self.assertFalse(company["competitive_advantage"]["verified"])
        self.assertEqual(
            company["competitive_advantage"]["status"],
            "issuer_claims_available_not_independently_verified",
        )
        self.assertFalse(company["management_execution"]["verified"])


if __name__ == "__main__":
    unittest.main()
