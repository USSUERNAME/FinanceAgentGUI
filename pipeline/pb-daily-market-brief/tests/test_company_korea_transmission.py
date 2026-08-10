from __future__ import annotations

import copy
import unittest

from build_company_korea_transmission import (
    build_company_korea_transmission,
    validate_company_korea_transmission,
)


class CompanyKoreaTransmissionTests(unittest.TestCase):
    def inputs(self) -> dict:
        return {
            "queue": {"candidates": [{
                "market": "US",
                "ticker": "NVDA",
                "company_name": "NVIDIA",
                "sector_id": "semiconductors_ai_compute",
                "sector_name_ko": "반도체·AI 컴퓨트",
                "beneficiary_pathways": [{
                    "pathway_id": "accelerators_memory",
                    "label_ko": "가속기·HBM",
                }],
            }]},
            "long_term_profiles": {"profiles": [{
                "ticker": "NVDA",
                "company_quality": {
                    "status": "financial_compounding_supported",
                    "label": "재무 복리 확인·질 평가 보류",
                },
            }]},
            "sector_master": {"sectors": [{
                "sector_id": "semiconductors_ai_compute",
                "representative_companies": [{
                    "market": "KR",
                    "ticker": "000660",
                    "name": "SK하이닉스",
                    "exposure_status": "candidate_unverified",
                }],
            }]},
            "korea_market": {"transmission_gate": {
                "status": "insufficient_verified_korea_data",
                "missing_metrics": ["foreign_kospi_cash_net_buy_krw"],
            }},
        }

    def test_unverified_same_sector_target_stays_watch_candidate(self) -> None:
        payload = build_company_korea_transmission("2026-08-09", **self.inputs())
        target = payload["transmissions"][0]["targets"][0]
        self.assertEqual(target["classification"], "watch_candidate")
        self.assertEqual(target["market_confirmation_status"], "not_confirmed")
        self.assertFalse(target["automatic_beneficiary_label"])
        self.assertIn("국내 기업의 관련 매출·수주·가격·마진 민감도", target["next_required_evidence"])

    def test_direct_link_requires_both_relationship_and_target_exposure(self) -> None:
        inputs = self.inputs()
        target = inputs["sector_master"]["sectors"][0]["representative_companies"][0]
        target["exposure_status"] = "verified_primary"
        target["relationship_evidence"] = {
            "status": "verified_primary",
            "source_tickers": ["NVDA"],
        }
        inputs["korea_market"]["transmission_gate"]["status"] = "ready_for_korea_transmission"
        payload = build_company_korea_transmission("2026-08-09", **inputs)
        result = payload["transmissions"][0]["targets"][0]
        self.assertEqual(result["classification"], "direct")
        self.assertEqual(result["actionability"], "analyst_review_only")

    def test_industry_link_requires_verified_matching_pathway(self) -> None:
        inputs = self.inputs()
        target = inputs["sector_master"]["sectors"][0]["representative_companies"][0]
        target["exposure_status"] = "verified_primary"
        target["verified_pathway_ids"] = ["accelerators_memory"]
        payload = build_company_korea_transmission("2026-08-09", **inputs)
        result = payload["transmissions"][0]["targets"][0]
        self.assertEqual(result["classification"], "industry")
        self.assertFalse(result["evidence_gates"]["verified_primary_relationship"])

    def test_one_business_day_market_source_lag_is_still_reviewable(self) -> None:
        inputs = self.inputs()
        inputs["korea_market"]["transmission_gate"]["status"] = (
            "ready_for_korea_transmission_with_source_lag"
        )
        payload = build_company_korea_transmission("2026-08-09", **inputs)
        confirmation = payload["transmissions"][0]["market_confirmation"]
        self.assertEqual(confirmation["status"], "ready")

    def test_profile_only_us_ticker_uses_explicit_sector_master_membership(self) -> None:
        inputs = self.inputs()
        inputs["queue"] = {"candidates": []}
        inputs["long_term_profiles"]["profiles"][0].update({
            "company_name": "NVIDIA",
            "candidate_origin": "direct_user_watchlist",
        })
        inputs["sector_master"]["sectors"][0]["representative_companies"].insert(0, {
            "market": "US",
            "ticker": "NVDA",
            "name": "NVIDIA",
        })
        payload = build_company_korea_transmission("2026-08-09", **inputs)
        self.assertEqual(payload["summary"]["source_company_count"], 1)
        self.assertEqual(
            payload["transmissions"][0]["source_origin"],
            "company_long_term_profile",
        )

    def test_profile_only_unknown_ticker_does_not_get_sector_inferred(self) -> None:
        inputs = self.inputs()
        inputs["queue"] = {"candidates": []}
        inputs["long_term_profiles"]["profiles"][0]["ticker"] = "UNKNOWN"
        payload = build_company_korea_transmission("2026-08-09", **inputs)
        self.assertEqual(payload["summary"]["source_company_count"], 0)

    def test_validator_rejects_invented_direct_link(self) -> None:
        payload = build_company_korea_transmission("2026-08-09", **self.inputs())
        tampered = copy.deepcopy(payload)
        tampered["transmissions"][0]["targets"][0]["classification"] = "direct"
        with self.assertRaisesRegex(ValueError, "Direct Korea link"):
            validate_company_korea_transmission(tampered)


if __name__ == "__main__":
    unittest.main()
