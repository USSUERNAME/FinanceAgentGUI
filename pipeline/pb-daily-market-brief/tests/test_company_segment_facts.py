from __future__ import annotations

import unittest

from collect_company_segment_facts import parse_segment_facts, primary_document_url


SOURCE_URL = "https://www.sec.gov/Archives/edgar/data/1/000000000126000001/test-20260630.htm"


def context(context_id: str, start: str, end: str, member: str) -> str:
    return f"""
    <xbrli:context id="{context_id}">
      <xbrli:entity><xbrli:segment>
        <xbrldi:explicitMember dimension="us-gaap:StatementBusinessSegmentsAxis">test:{member}</xbrldi:explicitMember>
      </xbrli:segment></xbrli:entity>
      <xbrli:period><xbrli:startDate>{start}</xbrli:startDate><xbrli:endDate>{end}</xbrli:endDate></xbrli:period>
    </xbrli:context>
    """


class CompanySegmentFactTests(unittest.TestCase):
    def test_exact_period_segment_revenue_and_operating_income_are_compared(self) -> None:
        source = "".join([
            context("current", "2026-04-01", "2026-06-30", "CloudSegmentMember"),
            context("prior", "2025-04-01", "2025-06-30", "CloudSegmentMember"),
            '<ix:nonFraction name="us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax" contextRef="current" unitRef="USD" scale="6">120</ix:nonFraction>',
            '<ix:nonFraction name="us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax" contextRef="prior" unitRef="USD" scale="6">100</ix:nonFraction>',
            '<ix:nonFraction name="us-gaap:OperatingIncomeLoss" contextRef="current" unitRef="USD" scale="6">30</ix:nonFraction>',
            '<ix:nonFraction name="us-gaap:OperatingIncomeLoss" contextRef="prior" unitRef="USD" scale="6">20</ix:nonFraction>',
        ])
        result = parse_segment_facts(
            source,
            ticker="TEST",
            accession="0000000001-26-000001",
            source_url=SOURCE_URL,
            target_period_start="2026-04-01",
            target_period_end="2026-06-30",
        )
        self.assertEqual(result["status"], "single_reportable_segment")
        revenue = next(row for row in result["rows"] if row["metric_id"] == "revenue")
        self.assertEqual(revenue["segment_label"], "Cloud Segment")
        self.assertEqual(revenue["current_value"], 120000000)
        self.assertEqual(revenue["prior_value"], 100000000)
        self.assertEqual(revenue["change_pct"], 20.0)

    def test_non_exact_duration_and_unrecognized_axis_are_excluded(self) -> None:
        source = context("ytd", "2026-01-01", "2026-06-30", "CloudSegmentMember") + (
            '<ix:nonFraction name="us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax" '
            'contextRef="ytd" unitRef="USD" scale="6">250</ix:nonFraction>'
        )
        result = parse_segment_facts(
            source,
            ticker="TEST",
            accession="0000000001-26-000001",
            source_url=SOURCE_URL,
            target_period_start="2026-04-01",
            target_period_end="2026-06-30",
        )
        self.assertEqual(result["status"], "not_disclosed_for_exact_period")
        self.assertEqual(result["rows"], [])

    def test_primary_document_url_uses_matching_accession(self) -> None:
        payload = {"filings": {"recent": {
            "accessionNumber": ["0000000001-26-000001"],
            "primaryDocument": ["test-20260630.htm"],
        }}}
        url = primary_document_url(
            "0000000001",
            "0000000001-26-000001",
            "operator test@example.com",
            json_fetcher=lambda *_args: payload,
        )
        self.assertEqual(url, SOURCE_URL)


if __name__ == "__main__":
    unittest.main()
