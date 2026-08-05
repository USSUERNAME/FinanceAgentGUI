from __future__ import annotations

import copy
import unittest

from build_company_earnings_deep_dive import (
    build_company_earnings_deep_dive,
    merge_targeted_reviews,
    validate_company_earnings_deep_dive,
)
from collect_company_earnings_results import collect_company_earnings_results, validate_result_record
from compose_daily_brief import source_section
from test_company_earnings_results import RESULT_URL, result_record, scenario_payload, verified_result
from datetime import date


MARKET_URL = "https://www.alphavantage.co/documentation/"


def market_context() -> dict:
    return {
        "contexts": [{
            "ticker": "GEV",
            "market_data": {"price": 650.0, "price_as_of": "2026-10-30", "currency": "USD"},
            "source": {
                "source_url": MARKET_URL,
                "provider": "Alpha Vantage",
                "retrieved_at": "2026-10-31T00:00:00+00:00",
            },
        }]
    }


def valuation_context() -> dict:
    return {
        "companies": [{
            "ticker": "GEV",
            "valuation_screen": {"relative_valuation_status": "premium_to_watchlist_peer_median"},
            "priced_in_status": "not_established",
        }]
    }


def ready_pack(result: dict | None = None) -> dict:
    return collect_company_earnings_results(
        "2026-10-31", scenario_payload(), [result or verified_result()]
    )


class CompanyEarningsDeepDiveTests(unittest.TestCase):
    def test_ticker_filter_requires_exact_available_company(self) -> None:
        payload = build_company_earnings_deep_dive(
            "2026-10-31",
            ready_pack(),
            market_context(),
            valuation_context(),
            tickers={"GEV"},
        )
        self.assertEqual(
            [row["ticker"] for row in payload["reviews"]],
            ["GEV"],
        )
        with self.assertRaisesRegex(ValueError, "unavailable"):
            build_company_earnings_deep_dive(
                "2026-10-31",
                ready_pack(),
                market_context(),
                valuation_context(),
                tickers={"MISSING"},
            )

    def test_targeted_review_merge_replaces_without_duplication(self) -> None:
        existing = build_company_earnings_deep_dive(
            "2026-10-31",
            ready_pack(),
            market_context(),
            valuation_context(),
        )
        targeted = copy.deepcopy(existing)
        targeted["reviews"][0]["next_workflow"] = "targeted_refresh"
        merged = merge_targeted_reviews(
            existing,
            targeted,
            tickers={"GEV"},
        )
        self.assertEqual(merged["company_count"], 1)
        self.assertEqual(
            merged["reviews"][0]["next_workflow"],
            "targeted_refresh",
        )

    def test_strengthening_research_signal_does_not_promote_thesis_or_action(self) -> None:
        payload = build_company_earnings_deep_dive(
            "2026-10-31", ready_pack(), market_context(), valuation_context()
        )
        review = payload["reviews"][0]
        self.assertEqual(review["bottom_line"]["research_case_signal"], "strengthening_evidence")
        self.assertEqual(review["company_thesis_status"], "untested")
        self.assertEqual(review["security_thesis_readiness"], "not_decision_grade")
        self.assertEqual(review["position_action"], "wait_for_proof")
        self.assertFalse(review["model_update_packet"]["model_update_applied"])

    def test_weaker_headline_or_kpi_produces_weakening_signal(self) -> None:
        pack = ready_pack()
        pack["companies"][0]["headline_result_case"] = "weaker_evidence"
        payload = build_company_earnings_deep_dive("2026-10-31", pack, market_context(), valuation_context())
        self.assertEqual(payload["reviews"][0]["bottom_line"]["research_case_signal"], "weakening_evidence")

    def test_triggered_eps_bridge_produces_mixed_signal_with_source_lineage(self) -> None:
        row = result_record()
        row["eps_quality"] = {
            "status": "expanded_bridge_required",
            "note": "Tax item requires recurring-EPS bridge review.",
            "bridge_items": [{
                "label": "Tax benefit", "amount": 50_000_000, "unit": "USD",
                "treatment": "exclude_from_recurring_eps_review",
                "source_type": "company_earnings_release", "source_url": RESULT_URL,
                "source_date": "2026-10-30", "body_location": "EPS reconciliation table",
                "primary_source_confirmed": True, "body_verified": True,
            }],
        }
        normalized = validate_result_record(row, date.fromisoformat("2026-10-31"))
        payload = build_company_earnings_deep_dive(
            "2026-10-31", ready_pack(normalized), market_context(), valuation_context()
        )
        review = payload["reviews"][0]
        self.assertEqual(review["bottom_line"]["research_case_signal"], "mixed_evidence")
        self.assertIn(review["eps_quality_screen"]["bridge_items"][0]["source_id"], {
            source["source_id"] for source in review["source_index"]
        })

    def test_guidance_and_transcript_limits_are_explicit(self) -> None:
        review = build_company_earnings_deep_dive(
            "2026-10-31", ready_pack(), market_context(), valuation_context()
        )["reviews"][0]
        self.assertEqual(review["guidance_review"]["rows"][0]["evidence_label"], "issuer_management_claim")
        self.assertEqual(review["guidance_review"]["rows"][0]["estimate_delta_status"], "not_calculated_missing_exact_updated_estimate")
        self.assertEqual(review["transcript_review"]["limitation"], "transcript not provided")
        self.assertEqual(review["transcript_review"]["quote_or_qa_map"], [])

    def test_market_price_preserves_as_of_and_provider_source(self) -> None:
        review = build_company_earnings_deep_dive(
            "2026-10-31", ready_pack(), market_context(), valuation_context()
        )["reviews"][0]
        self.assertEqual(review["security_context"]["current_price"], 650.0)
        self.assertEqual(review["security_context"]["price_as_of"], "2026-10-30")
        self.assertEqual(review["security_context"]["priced_in_status"], "not_established")
        self.assertTrue(review["security_context"]["source_id"].startswith("MARKET-GEV-"))

    def test_missing_verified_pack_stays_blocked(self) -> None:
        waiting = collect_company_earnings_results("2026-10-31", scenario_payload(), [])
        review = build_company_earnings_deep_dive(
            "2026-10-31", waiting, market_context(), valuation_context()
        )["reviews"][0]
        self.assertEqual(review["review_status"], "blocked_missing_verified_post_earnings_input_pack")
        self.assertEqual(review["research_case_signal"], "untested")

    def test_validator_rejects_thesis_action_or_unresolved_source(self) -> None:
        payload = build_company_earnings_deep_dive(
            "2026-10-31", ready_pack(), market_context(), valuation_context()
        )
        for field, value in (
            ("company_thesis_status", "strengthening"),
            ("position_action", "add"),
        ):
            tampered = copy.deepcopy(payload)
            tampered["reviews"][0][field] = value
            with self.assertRaises(ValueError):
                validate_company_earnings_deep_dive(tampered)
        tampered = copy.deepcopy(payload)
        tampered["reviews"][0]["headline_vs_pre_event_bar"]["source_id"] = "MISSING"
        with self.assertRaisesRegex(ValueError, "source lineage"):
            validate_company_earnings_deep_dive(tampered)

    def test_report_source_inventory_deduplicates_result_and_market_urls(self) -> None:
        payload = build_company_earnings_deep_dive(
            "2026-10-31", ready_pack(), market_context(), valuation_context()
        )
        rendered = source_section([], {
            "company_earnings_results": ready_pack(),
            "company_earnings_deep_dive": payload,
            "source_quality": {"evidence_posture": "research_grade"},
        })
        self.assertEqual(rendered.count(RESULT_URL), 1)
        self.assertEqual(rendered.count(MARKET_URL), 1)


if __name__ == "__main__":
    unittest.main()
