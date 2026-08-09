from __future__ import annotations

import copy
import unittest

from build_company_long_term_profiles import (
    build_company_long_term_profiles,
    validate_company_long_term_profiles,
)
from company_judgment_policy import load_judgment_policy, validate_judgment_policy


def long_term_financials() -> dict:
    periods = []
    for year, revenue, operating, fcf, shares in zip(
        range(2021, 2026),
        [100, 120, 145, 170, 210],
        [20, 25, 32, 40, 52],
        [16, 21, 27, 34, 45],
        [100, 99, 98, 97, 96],
    ):
        periods.append({
            "period": str(year),
            "revenue": revenue,
            "operating_income": operating,
            "fcf": fcf,
            "diluted_shares": shares,
            "operating_margin_pct": operating / revenue * 100,
            "gross_shareholder_returns": 4,
            "net_cash_returns_after_issuance": 3,
        })
    return {
        "periods": periods,
        "summary": {
            "operating_income_cagr_pct": 26.98,
            "fcf_cagr_pct": 29.47,
            "median_fcf_conversion_pct": 84.0,
            "positive_operating_income_years": 5,
            "positive_fcf_years": 5,
            "diluted_share_count_change_pct": -4.0,
            "cumulative_returns_to_fcf_pct": 12.0,
        },
        "quality_gate": {
            "status": "ready",
            "complete_core_years": 5,
            "capital_allocation_available": True,
            "dilution_available": True,
            "missing": [],
        },
    }


class CompanyLongTermProfilesTests(unittest.TestCase):
    def test_three_verdicts_stay_separate_and_overall_score_is_withheld(self) -> None:
        payload = build_company_long_term_profiles(
            "2026-08-08",
            primary_facts={"companies": [{
                "ticker": "NVDA",
                "company_name": "NVIDIA",
                "long_term_financials": long_term_financials(),
                "annual_reported_metrics": {},
            }]},
            valuation_expectations={"companies": [{
                "ticker": "NVDA",
                "valuation_screen": {
                    "status": "screening_available",
                    "relative_valuation_status": "premium_to_watchlist_peer_median",
                    "primary_premium_discount_pct": 15.0,
                },
            }]},
            tearsheets={"profiles": [{
                "identity": {"ticker": "NVDA"},
                "business_exposure": {
                    "status": "verified_primary",
                    "source_url": "https://www.sec.gov/example",
                    "evidence_summary": "공시에서 핵심 사업모델 확인",
                },
            }]},
            queue={"candidates": [{
                "ticker": "NVDA",
                "candidate_origin": "direct_user_watchlist",
                "direct_input_sources": ["watchlist"],
                "what_would_make_it_investable": "Confirm durable FCF growth.",
                "what_would_kill_it": "FCF and margins deteriorate.",
            }]},
        )
        profile = payload["profiles"][0]
        self.assertEqual(profile["company_quality"]["status"], "financial_compounding_supported")
        self.assertEqual(profile["stock_attractiveness"]["status"], "screening_only")
        self.assertEqual(profile["portfolio_fit"]["status"], "evaluation_withheld")
        self.assertIsNone(profile["scorecard"]["overall_score"])
        self.assertEqual(profile["action"]["grade"], "관망")
        framework = profile["judgment_framework"]
        self.assertEqual(framework["decision_sequence"][0], "company_quality")
        self.assertEqual(framework["company_quality"]["met_count"], 3)
        self.assertEqual(framework["company_quality"]["required_count"], 5)
        self.assertIn("moat_evidence", framework["company_quality"]["missing_gate_ids"])
        self.assertIn("three_scenario_valuation", framework["stock_attractiveness"]["missing_gate_ids"])
        self.assertEqual(profile["action"]["confirmation_conditions"], ["Confirm durable FCF growth."])
        self.assertTrue(profile["action"]["next_required_evidence"])
        self.assertEqual(profile["official_business_evidence"]["status"], "verified_primary")
        self.assertEqual(profile["official_business_evidence"]["source_url"], "https://www.sec.gov/example")
        self.assertFalse(profile["issuer_competitive_claims"]["verified"])
        self.assertFalse(profile["management_execution_evidence"]["verified"])

    def test_validator_rejects_fabricated_overall_score(self) -> None:
        payload = build_company_long_term_profiles(
            "2026-08-08",
            primary_facts={"companies": [{
                "ticker": "NVDA", "long_term_financials": long_term_financials(),
            }]},
            valuation_expectations={"companies": []},
            tearsheets={"profiles": []},
            queue={"candidates": []},
        )
        tampered = copy.deepcopy(payload)
        tampered["profiles"][0]["scorecard"]["overall_score"] = 88
        with self.assertRaisesRegex(ValueError, "cannot produce an overall score"):
            validate_company_long_term_profiles(tampered)

    def test_policy_rejects_automatic_position_actions(self) -> None:
        policy = load_judgment_policy()
        tampered = copy.deepcopy(policy)
        tampered["conditional_action"]["automatic_position_actions_allowed"] = True
        with self.assertRaisesRegex(ValueError, "Automatic position actions"):
            validate_judgment_policy(tampered)


if __name__ == "__main__":
    unittest.main()
