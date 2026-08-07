from __future__ import annotations

import copy
import unittest

from build_company_earnings_driver_review import (
    build_company_earnings_driver_review,
    validate_company_earnings_driver_review,
)
from build_company_tearsheets import build_company_tearsheets
from compose_daily_brief import source_section
from test_company_tearsheets import AV_URL, SEC_URL, market, operating, primary, queue, valuation


GUIDANCE_URL = "https://investor.gevernova.com/earnings-release"


def valuation_with_estimates() -> dict:
    payload = valuation()
    payload["companies"][0]["expectations_bar"].update({
        "estimate_as_of": "2026-07-20",
        "source_provider": "Alpha Vantage",
        "rows": [{
            "horizon": "fiscal quarter",
            "fiscal_period_end": "2026-09-30",
            "eps_estimate_average": 2.5,
            "eps_revision_pct_30d": 4.0,
            "eps_analyst_count": 12,
            "revenue_estimate_average": 10000000000,
            "revenue_analyst_count": 10,
        }],
    })
    return payload


def primary_with_guidance() -> dict:
    payload = primary()
    company = payload["companies"][0]
    company.update({
        "ticker": "GEV",
        "company_name": "GE Vernova",
        "reported_metrics": [{
            "metric_id": "revenue", "label": "Revenue", "value": 9000000000,
            "period_start": "2026-01-01", "period_end": "2026-03-31", "unit": "USD",
            "form": "10-Q", "filed_date": "2026-04-25", "source_url": SEC_URL,
        }],
        "guidance": [{
            "record_id": "gev-revenue-guide-2026q3", "metric_id": "revenue",
            "period_end": "2026-09-30", "value_low": 9500000000,
            "value_high": 10500000000, "midpoint": 10000000000,
            "unit": "USD", "currency": "USD", "source_date": "2026-04-25",
            "source_url": GUIDANCE_URL, "body_location": "Outlook table, revenue",
            "evidence_label": "issuer_management_claim",
            "estimate_comparison": {
                "status": "available_exact_period_and_unit",
                "third_party_estimate": 10000000000,
                "guidance_midpoint": 10000000000,
                "guidance_vs_estimate_pct": 0.0,
                "period_end": "2026-09-30", "unit": "USD",
                "evidence_label": "derived_calculation",
            },
        }],
    })
    return payload


def bundle() -> tuple[dict, dict, dict]:
    valuation_payload = valuation_with_estimates()
    primary_payload = primary_with_guidance()
    tearsheets = build_company_tearsheets(
        "2026-07-20", queue(), market(), valuation_payload, primary_payload, operating(),
    )
    return tearsheets, valuation_payload, primary_payload


class CompanyEarningsDriverReviewTests(unittest.TestCase):
    def build(self) -> dict:
        tearsheets, valuation_payload, primary_payload = bundle()
        return build_company_earnings_driver_review(
            "2026-07-20", tearsheets, valuation_payload, primary_payload,
        )

    def test_review_remains_monitoring_until_event_date_is_verified(self) -> None:
        review = self.build()["reviews"][0]
        self.assertEqual(review["review_mode"], "earnings_driver_monitoring_not_pre_event_preview")
        self.assertIsNone(review["event_setup"]["event_date"])
        self.assertFalse(review["reaction_framework"]["bull_base_bear_generated"])
        self.assertEqual(review["action"], "wait_for_proof")

    def test_estimate_bar_has_freeze_period_units_and_provider_lineage(self) -> None:
        review = self.build()["reviews"][0]
        rows = review["expectation_bar"]["rows"]
        self.assertEqual({row["metric_id"] for row in rows}, {"diluted_eps", "revenue"})
        self.assertTrue(all(row["estimate_as_of"] == "2026-07-20" for row in rows))
        self.assertTrue(all(row["evidence_label"] == "third_party_forward_estimate" for row in rows))
        self.assertEqual(review["expectation_bar"]["preview_period"], "2026-09-30")

    def test_guidance_is_separate_company_claim_with_exact_comparison(self) -> None:
        review = self.build()["reviews"][0]
        guidance = review["company_guidance"][0]
        self.assertEqual(guidance["evidence_label"], "issuer_management_claim")
        self.assertEqual(guidance["estimate_comparison"]["status"], "available_exact_period_and_unit")
        self.assertIn(guidance["source_id"], {row["source_id"] for row in review["source_index"]})

    def test_eps_quality_watch_surfaces_unverified_basis(self) -> None:
        watch = self.build()["reviews"][0]["eps_quality_watch"]
        self.assertEqual(watch["status"], "incomplete_missing_basis_and_bridge")
        self.assertIn("GAAP versus adjusted EPS basis", watch["watch_items"])

    def test_operating_driver_has_confirmation_falsifier_and_question(self) -> None:
        review = self.build()["reviews"][0]
        driver = review["earnings_drivers"][0]
        self.assertEqual(driver["trend_status"], "increased_vs_prior")
        self.assertTrue(driver["confirmation_condition"])
        self.assertTrue(driver["falsifier"])
        self.assertEqual(review["monitoring_questions"][0]["source_id"], driver["source_id"])

    def test_validator_blocks_false_pre_event_or_consensus_escalation(self) -> None:
        payload = self.build()
        preview = copy.deepcopy(payload)
        preview["reviews"][0]["review_mode"] = "full_pre_event_preview"
        with self.assertRaisesRegex(ValueError, "unverified event"):
            validate_company_earnings_driver_review(preview)
        consensus = copy.deepcopy(payload)
        consensus["reviews"][0]["expectation_bar"]["rows"][0]["evidence_label"] = "estimate_consensus"
        with self.assertRaisesRegex(ValueError, "consensus"):
            validate_company_earnings_driver_review(consensus)

    def test_review_sources_are_deduplicated_in_report_inventory(self) -> None:
        rendered = source_section([], {
            "company_earnings_driver_review": self.build(),
            "source_quality": {"evidence_posture": "research_grade"},
        })
        self.assertEqual(rendered.count(SEC_URL), 1)
        self.assertEqual(rendered.count(AV_URL), 1)
        self.assertEqual(rendered.count(GUIDANCE_URL), 1)


if __name__ == "__main__":
    unittest.main()
