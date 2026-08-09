from __future__ import annotations

import copy
import unittest

from build_company_tearsheets import build_company_tearsheets, validate_company_tearsheets
from compose_daily_brief import source_section


SEC_URL = "https://www.sec.gov/Archives/edgar/data/1/filing-index.html"
AV_URL = "https://www.alphavantage.co/documentation/"


def queue(stage: str = "valuation_expectations_gated") -> dict:
    return {"candidates": [{
        "candidate_id": "grid_electrification:US:GEV",
        "sector_id": "grid_electrification",
        "sector_name_ko": "전력망·전기화",
        "market": "US",
        "ticker": "GEV",
        "company_name": "GE Vernova",
        "queue_stage": stage,
        "exposure_status": "verified_primary",
        "exposure_evidence_summary": "Electrification segment exposure is disclosed.",
        "exposure_source_url": SEC_URL,
        "exposure_body_location": "Business section",
        "why_now": "Sector and operating evidence passed the research gate.",
        "what_would_make_it_investable": "Verify segment growth, margins, valuation and expectations.",
        "what_would_kill_it": "Backlog reversal or loss of verified exposure.",
    }]}


def market(price_as_of: str = "2026-07-17") -> dict:
    return {"contexts": [{
        "candidate_id": "grid_electrification:US:GEV",
        "market_data": {
            "price": 640.0, "price_as_of": price_as_of, "currency": "USD",
            "market_cap": 175000000000, "exchange": "NYSE",
        },
        "valuation_context": {"forward_pe": 42.0, "relative_valuation_status": "unbenchmarked"},
        "source": {
            "source_id": "alpha_vantage:GEV:quote_overview",
            "provider": "Alpha Vantage", "source_url": AV_URL,
            "as_of_date": price_as_of, "retrieved_at": "2026-07-20T00:00:00Z",
            "freshness_status": "current_or_latest_close",
        },
    }]}


def valuation() -> dict:
    return {"companies": [{
        "candidate_id": "grid_electrification:US:GEV",
        "valuation_screen": {
            "relative_valuation_status": "premium_to_watchlist_peer_median",
            "primary_metric": "forward_pe", "primary_premium_discount_pct": 18.0,
            "peer_set_status": "planned", "peer_selection_evidence_label": "analyst_assumption_needs_review",
            "historical_valuation_band_status": "not_collected",
        },
        "expectations_bar": {
            "status": "third_party_forward_estimates_available",
            "revision_direction": "positive_revision", "estimate_as_of": "2026-07-20",
            "evidence_label": "third_party_forward_estimate",
            "company_guidance_comparison_status": "not_collected",
        },
        "first_rejection": "Historical valuation and guidance are incomplete.",
    }]}


def primary() -> dict:
    return {"companies": [{
        "candidate_id": "grid_electrification:US:GEV", "cik": "0001996810", "guidance": [],
    }]}


def operating() -> dict:
    sec_source = {
        "source_id": "SRC-GEV-FILING", "source_name": "GEV 10-Q filing",
        "source_type": "filing", "owner_or_provider": "SEC",
        "period_covered": "2026-01-01 to 2026-03-31", "as_of_date": "2026-04-25",
        "retrieved_at": "2026-07-20", "file_tab_page_url_or_location": SEC_URL,
        "freshness_status": "acceptable_for_period", "notes": "SEC XBRL fact",
    }
    backlog_source = {
        "source_id": "SRC-GEV-BACKLOG", "source_name": "GEV backlog disclosure",
        "source_type": "filing", "owner_or_provider": "GE Vernova",
        "period_covered": "2024 and 2025", "as_of_date": "2026-01-29",
        "retrieved_at": "2026-07-20", "file_tab_page_url_or_location": f"{SEC_URL} | backlog table",
        "freshness_status": "acceptable_for_period", "notes": "Body-verified KPI",
    }
    base = {
        "entity": "GE Vernova", "ticker": "GEV", "statement": "income_statement",
        "currency": "USD", "evidence_label": "fact_source_reported", "confidence": "high",
        "comparison_status": "comparable", "normalization_note": "Exact source period and units preserved.",
    }
    return {"companies": [{
        "candidate_id": "grid_electrification:US:GEV",
        "source_index": [sec_source, backlog_source],
        "normalized_financials_long": [{
            **base, "source_id": "SRC-GEV-FILING", "line_item_id": "revenue",
            "line_item_standard": "Revenue", "period_start": "2026-01-01",
            "period_end": "2026-03-31", "period_type": "quarterly", "units": "USD",
            "normalized_value": 9000000000, "source_location": SEC_URL,
        }, {
            **base, "source_id": "SRC-GEV-BACKLOG", "statement": "kpi_schedule",
            "line_item_id": "company_kpi.backlog", "line_item_standard": "Backlog",
            "period_start": None, "period_end": "2025-12-31", "period_type": "annual",
            "units": "USD millions", "normalized_value": 34667,
            "source_location": f"{SEC_URL} | backlog table",
        }, {
            **base, "source_id": "SRC-GEV-BACKLOG", "statement": "kpi_schedule",
            "line_item_id": "company_kpi.backlog", "line_item_standard": "Backlog",
            "period_start": None, "period_end": "2024-12-31", "period_type": "annual",
            "units": "USD millions", "normalized_value": 23453,
            "source_location": f"{SEC_URL} | backlog table",
        }],
        "operating_evidence": [{
            "record_id": "gev-backlog", "metric_id": "backlog", "current_value": 34667,
            "prior_value": 23453, "current_period": "2025-12-31", "prior_period": "2024-12-31",
            "unit": "USD millions", "currency": "USD", "change_pct": 47.8158,
            "source_id": "SRC-GEV-BACKLOG", "source_url": SEC_URL,
            "body_location": "Backlog table", "comparison_status": "comparable",
            "transmission_status": "verified_company_operating_signal_not_causal_attribution",
        }],
        "qa_flags": [{
            "area": "segment", "severity": "medium", "status": "open",
            "recommended_fix": "Add segment schedule.", "impact": "Segment attribution is unavailable.",
        }],
        "transmission_status": "verified_company_operating_signal_not_causal_attribution",
    }]}


def decision_evidence_primary() -> dict:
    payload = primary()
    periods = []
    for year, revenue, operating_income, fcf, shares in zip(
        range(2021, 2026),
        [20_000, 23_000, 27_000, 32_000, 38_000],
        [2_400, 3_000, 3_800, 4_900, 6_200],
        [2_000, 2_500, 3_200, 4_100, 5_200],
        [280, 278, 276, 274, 272],
    ):
        periods.append({
            "period": f"{year}-12-31",
            "revenue": revenue,
            "operating_income": operating_income,
            "fcf": fcf,
            "diluted_shares": shares,
            "operating_margin_pct": operating_income / revenue * 100,
            "fcf_margin_pct": fcf / revenue * 100,
        })
    payload["companies"][0]["long_term_financials"] = {
        "periods": periods,
        "summary": {
            "revenue_cagr_pct": 17.42,
            "operating_income_cagr_pct": 26.78,
            "fcf_cagr_pct": 26.98,
            "latest_operating_margin_pct": 16.32,
            "latest_fcf_margin_pct": 13.68,
            "positive_operating_income_years": 5,
            "positive_fcf_years": 5,
            "diluted_share_count_change_pct": -2.86,
        },
        "quality_gate": {
            "status": "ready",
            "required_core_years": 5,
            "complete_core_years": 5,
            "capital_allocation_available": True,
            "dilution_available": True,
        },
    }
    return payload


def primary_narratives() -> dict:
    return {"companies": [{
        "candidate_id": "grid_electrification:US:GEV",
        "annual_filing": {
            "form": "10-K",
            "filing_date": "2026-02-20",
            "source_id": "SEC-ANNUAL-GEV",
            "source_url": SEC_URL,
        },
        "business_model": {
            "status": "verified_primary",
            "body_location": "10-K Item 1 Business",
            "excerpt": "The company provides power generation and electrification equipment and services.",
            "evidence_class": "issuer_disclosed_fact_and_claim",
        },
        "risk_factors": {
            "status": "verified_primary",
            "body_location": "10-K Item 1A Risk Factors",
            "excerpt": "Execution and supply-chain risks may affect results.",
        },
        "competitive_advantage": {
            "status": "issuer_claims_available_not_independently_verified",
            "verified": False,
            "issuer_claims": ["The company states that its installed base provides scale."],
        },
        "management_execution": {"status": "not_verified", "verified": False},
    }]}


class CompanyTearsheetTests(unittest.TestCase):
    def build(self, price_as_of: str = "2026-07-17") -> dict:
        return build_company_tearsheets(
            "2026-07-20", queue(), market(price_as_of), valuation(), primary(), operating(),
        )

    def test_builds_compact_source_backed_profile(self) -> None:
        payload = self.build()
        profile = payload["profiles"][0]
        self.assertEqual(profile["profile_type"], "public_company")
        self.assertEqual(profile["readiness"], "screen_grade")
        self.assertEqual(profile["identity"]["identity_status"], "ticker_exchange_cik_crosschecked")
        self.assertLessEqual(len(profile["key_metrics"]), 5)
        source_ids = {row["source_id"] for row in profile["source_index"]}
        self.assertTrue(all(row["source_id"] in source_ids for row in profile["key_metrics"]))

    def test_latest_backlog_period_is_selected_for_metric_strip(self) -> None:
        profile = self.build()["profiles"][0]
        backlog = next(row for row in profile["key_metrics"] if row["metric_id"] == "company_kpi.backlog")
        self.assertEqual(backlog["period"], "2025-12-31")
        self.assertEqual(backlog["value"], 34667.0)

    def test_operating_driver_remains_noncausal(self) -> None:
        driver = self.build()["profiles"][0]["earnings_drivers"][0]
        self.assertEqual(driver["transmission_status"], "verified_company_operating_signal_not_causal_attribution")
        self.assertIn("not causal", driver["interpretation_limit"])

    def test_old_market_price_is_flagged_stale(self) -> None:
        profile = self.build("2026-07-10")["profiles"][0]
        self.assertEqual(profile["security_context"]["price_freshness_status"], "stale")
        self.assertEqual(profile["security_context"]["calendar_gap_days"], 10)

    def test_future_market_price_is_rejected(self) -> None:
        with self.assertRaisesRegex(ValueError, "Future-dated"):
            self.build("2026-07-21")

    def test_validator_blocks_priced_in_escalation(self) -> None:
        payload = self.build()
        tampered = copy.deepcopy(payload)
        tampered["profiles"][0]["valuation_context"]["priced_in_status"] = "established"
        with self.assertRaisesRegex(ValueError, "priced in"):
            validate_company_tearsheets(tampered)

    def test_non_advanced_candidate_does_not_create_tearsheet(self) -> None:
        payload = build_company_tearsheets(
            "2026-07-20", queue("sector_watchlist_only"), market(), valuation(), primary(), operating(),
        )
        self.assertEqual(payload["profile_count"], 0)

    def test_annual_narrative_supplies_business_source_without_promoting_moat(self) -> None:
        source_queue = queue()
        source_queue["candidates"][0]["exposure_status"] = "verified_primary_event"
        payload = build_company_tearsheets(
            "2026-07-20", source_queue, market(), valuation(), primary(), operating(),
            primary_narratives(),
        )
        profile = payload["profiles"][0]
        self.assertEqual(profile["business_exposure"]["status"], "verified_primary")
        self.assertEqual(profile["business_exposure"]["source_id"], "SEC-ANNUAL-GEV")
        self.assertIn("Item 1", profile["business_exposure"]["body_location"])
        self.assertFalse(profile["competitive_advantage"]["verified"])
        self.assertEqual(profile["management_execution"]["status"], "not_verified")

    def test_multi_year_primary_outcomes_support_quality_and_three_scenarios(self) -> None:
        payload = build_company_tearsheets(
            "2026-07-20", queue(), market(), valuation(), decision_evidence_primary(), operating(),
            primary_narratives(),
        )
        profile = payload["profiles"][0]
        self.assertTrue(profile["competitive_advantage"]["verified"])
        self.assertEqual(
            profile["competitive_advantage"]["verification_scope"],
            "quantitative_indirect_evidence_not_direct_customer_or_market_share_proof",
        )
        self.assertTrue(profile["management_execution"]["verified"])
        scenario = profile["valuation_context"]["scenario_valuation"]
        self.assertEqual(scenario["status"], "supported_screening_model")
        self.assertEqual([row["scenario"] for row in scenario["scenarios"]], ["bear", "base", "bull"])
        self.assertEqual(profile["valuation_context"]["priced_in_status"], "calculated_scenario_implied_growth")

    def test_supported_scenario_requires_all_three_cases(self) -> None:
        payload = build_company_tearsheets(
            "2026-07-20", queue(), market(), valuation(), decision_evidence_primary(), operating(),
            primary_narratives(),
        )
        tampered = copy.deepcopy(payload)
        tampered["profiles"][0]["valuation_context"]["scenario_valuation"]["scenarios"].pop()
        with self.assertRaisesRegex(ValueError, "bear, base, and bull"):
            validate_company_tearsheets(tampered)

    def test_tearsheet_source_inventory_is_deduplicated_in_report(self) -> None:
        rendered = source_section([], {
            "company_tearsheets": self.build(),
            "source_quality": {"evidence_posture": "research_grade"},
        })
        self.assertEqual(rendered.count(SEC_URL), 1)
        self.assertEqual(rendered.count(AV_URL), 1)


if __name__ == "__main__":
    unittest.main()
