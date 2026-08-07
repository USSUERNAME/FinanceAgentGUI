from __future__ import annotations

import copy
import unittest
from datetime import date

from collect_company_primary_facts import (
    collect_company_primary_facts,
    company_cik_map,
    compare_guidance_to_estimates,
    latest_reported_metric,
    validate_company_primary_facts,
    validate_guidance_record,
)
from collect_sector_fundamentals import load_fundamental_registry
from compose_daily_brief import source_section


ACCESSION = "0001045810-26-000021"


def fact(label: str, unit: str, value: float, *, filed: str = "2026-05-20", end: str = "2026-04-30") -> dict:
    return {
        "label": label,
        "description": f"Reported {label}",
        "units": {unit: [{
            "start": "2026-02-01",
            "end": end,
            "val": value,
            "accn": ACCESSION,
            "fy": 2027,
            "fp": "Q1",
            "form": "10-Q",
            "filed": filed,
            "frame": "CY2026Q1",
        }]},
    }


def companyfacts_payload() -> dict:
    revenue = fact("Revenue", "USD", 44000000000)
    revenue["units"]["USD"].append({
        "start": "2026-05-01",
        "end": "2026-07-31",
        "val": 99900000000,
        "accn": "0001045810-26-999999",
        "fy": 2027,
        "fp": "Q2",
        "form": "10-Q",
        "filed": "2026-08-20",
    })
    return {
        "cik": 1045810,
        "entityName": "NVIDIA CORP",
        "facts": {"us-gaap": {
            "RevenueFromContractWithCustomerExcludingAssessedTax": revenue,
            "OperatingIncomeLoss": fact("Operating income", "USD", 28000000000),
            "NetIncomeLoss": fact("Net income", "USD", 24000000000),
            "EarningsPerShareDiluted": fact("Diluted EPS", "USD/shares", 1.05),
            "NetCashProvidedByUsedInOperatingActivities": fact("Operating cash flow", "USD", 25000000000),
            "PaymentsToAcquirePropertyPlantAndEquipment": fact("Capital expenditures", "USD", 900000000),
        }},
    }


def valuation_expectations() -> dict:
    return {"companies": [{
        "candidate_id": "semiconductors_ai_compute:US:NVDA",
        "sector_id": "semiconductors_ai_compute",
        "market": "US",
        "ticker": "NVDA",
        "company_name": "NVIDIA",
        "expectations_bar": {"rows": [{
            "fiscal_period_end": "2026-10-31",
            "revenue_estimate_average": 50000000000,
            "eps_estimate_average": 1.25,
        }]},
    }]}


def guidance() -> dict:
    return {
        "record_id": "nvda-revenue-guidance-2026q3",
        "ticker": "NVDA",
        "metric_id": "revenue",
        "period_end": "2026-10-31",
        "value_low": 49000000000,
        "value_high": 51000000000,
        "unit": "USD",
        "currency": "USD",
        "source_type": "company_earnings_release",
        "source_url": "https://investor.nvidia.com/earnings-release",
        "source_date": "2026-07-20",
        "body_location": "Outlook table, revenue row",
        "primary_source_confirmed": True,
        "body_verified": True,
    }


class CompanyPrimaryFactsTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.registry = load_fundamental_registry()

    def test_cik_is_derived_only_from_verified_sec_exposure_url(self) -> None:
        mapping = company_cik_map(self.registry)
        self.assertEqual(mapping[("semiconductors_ai_compute", "NVDA")], "0001045810")

    def test_latest_metric_excludes_filing_after_report_date(self) -> None:
        metric = latest_reported_metric(
            companyfacts_payload(), "revenue", date.fromisoformat("2026-07-20"), "0001045810",
        )
        self.assertEqual(metric["value"], 44000000000)
        self.assertEqual(metric["period_end"], "2026-04-30")
        self.assertIn(ACCESSION, metric["source_url"])
        self.assertEqual(metric["evidence_label"], "fact_source_reported")

    def test_primary_fact_pack_retains_period_unit_tag_and_source(self) -> None:
        payload = collect_company_primary_facts(
            "2026-07-20", valuation_expectations(), self.registry, "operator test@example.com",
            fetcher=lambda cik, agent: companyfacts_payload(),
        )
        company = payload["companies"][0]
        self.assertEqual(payload["request_count"], 1)
        self.assertEqual(company["fact_status"], "available")
        self.assertEqual(company["reported_metric_count"], 6)
        revenue = next(row for row in company["reported_metrics"] if row["metric_id"] == "revenue")
        self.assertEqual(revenue["unit"], "USD")
        self.assertEqual(revenue["concept"], "RevenueFromContractWithCustomerExcludingAssessedTax")
        self.assertEqual(company["security_readiness"], "primary_reported_baseline_not_decision_grade")

    def test_missing_sec_user_agent_is_explicit_and_nonfatal(self) -> None:
        payload = collect_company_primary_facts(
            "2026-07-20", valuation_expectations(), self.registry, "",
        )
        self.assertEqual(payload["collection_status"], "missing_sec_user_agent")
        self.assertEqual(payload["request_count"], 0)

    def test_verified_guidance_compares_only_exact_period_and_unit(self) -> None:
        validated = validate_guidance_record(guidance(), date.fromisoformat("2026-07-20"))
        result = compare_guidance_to_estimates(validated, valuation_expectations()["companies"][0])
        self.assertEqual(result["status"], "available_exact_period_and_unit")
        self.assertEqual(result["guidance_vs_estimate_pct"], 0.0)
        changed = copy.deepcopy(validated)
        changed["period_end"] = "2027-01-31"
        self.assertEqual(
            compare_guidance_to_estimates(changed, valuation_expectations()["companies"][0])["status"],
            "not_comparable_period_or_missing_estimate",
        )

    def test_unverified_guidance_is_rejected(self) -> None:
        row = guidance()
        row["body_verified"] = False
        with self.assertRaisesRegex(ValueError, "body verification"):
            validate_guidance_record(row, date.fromisoformat("2026-07-20"))

    def test_validator_rejects_decision_grade_escalation(self) -> None:
        payload = collect_company_primary_facts(
            "2026-07-20", valuation_expectations(), self.registry, "operator test@example.com",
            fetcher=lambda cik, agent: companyfacts_payload(),
        )
        tampered = copy.deepcopy(payload)
        tampered["companies"][0]["security_readiness"] = "decision_grade"
        with self.assertRaisesRegex(ValueError, "cannot become decision-grade"):
            validate_company_primary_facts(tampered)

    def test_direct_sec_filing_is_added_to_deterministic_sources_once(self) -> None:
        url = (
            "https://www.sec.gov/Archives/edgar/data/1045810/"
            "000104581026000021/0001045810-26-000021-index.html"
        )
        rendered = source_section([], {
            "company_primary_facts": {"companies": [{
                "ticker": "NVDA", "source_urls": [url, url],
            }]},
            "source_quality": {"evidence_posture": "research_grade"},
        })
        self.assertEqual(rendered.count(url), 1)


if __name__ == "__main__":
    unittest.main()
