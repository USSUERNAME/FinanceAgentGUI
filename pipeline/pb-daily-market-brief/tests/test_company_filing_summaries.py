from __future__ import annotations

import unittest

from analyze_company_filings import (
    build_artifact,
    build_inputs,
    validate_artifact,
)


SEC_URL = "https://www.sec.gov/Archives/edgar/data/1/000000000126000001/index.html"


def queue() -> dict:
    return {"candidates": [{
        "ticker": "TEST",
        "company_name": "Test Corp",
        "market": "US",
        "selection_reason": "공식근거 분석 후보",
    }]}


def facts() -> dict:
    return {"companies": [{
        "ticker": "TEST",
        "company_name": "Test Corp",
        "reported_metrics": [
            {
                "metric_id": "revenue", "value": 100, "unit": "USD",
                "period_start": "2026-04-01", "period_end": "2026-06-30",
                "filed_date": "2026-08-01", "form": "10-Q",
                "fiscal_year": 2026, "fiscal_period": "Q2",
                "accession_number": "0000000001-26-000001", "source_url": SEC_URL,
                "evidence_label": "fact_source_reported",
                "prior_year_comparison": {
                    "status": "available_exact_period_and_unit", "value": 80,
                    "period_start": "2025-04-01", "period_end": "2025-06-30",
                    "change_pct": 25.0,
                },
            },
            {
                "metric_id": "operating_income", "value": 20, "unit": "USD",
                "period_start": "2026-04-01", "period_end": "2026-06-30",
                "filed_date": "2026-08-01", "form": "10-Q",
                "fiscal_year": 2026, "fiscal_period": "Q2",
                "accession_number": "0000000001-26-000001", "source_url": SEC_URL,
                "evidence_label": "fact_source_reported",
                "prior_year_comparison": {
                    "status": "available_exact_period_and_unit", "value": 16,
                    "period_start": "2025-04-01", "period_end": "2025-06-30",
                    "change_pct": 25.0,
                },
            },
            {
                "metric_id": "net_income", "value": 10, "unit": "USD",
                "period_start": "2026-01-01", "period_end": "2026-03-31",
                "filed_date": "2026-05-01", "form": "10-Q",
                "fiscal_year": 2026, "fiscal_period": "Q1",
                "accession_number": "0000000001-26-000000", "source_url": SEC_URL,
                "evidence_label": "fact_source_reported",
            },
        ],
        "long_term_financials": {"summary": {"revenue_cagr_pct": 12.5}},
        "segment_financials": {
            "status": "single_reportable_segment",
            "rows": [{
                "segment_id": "test:CloudSegmentMember",
                "segment_label": "Cloud Segment",
                "axis": "us-gaap:StatementBusinessSegmentsAxis",
                "breakdown_type": "reportable_segment",
                "metric_id": "revenue",
                "unit": "USD",
                "current_value": 60,
                "prior_value": 50,
                "change_pct": 20.0,
                "current_period_start": "2026-04-01",
                "current_period_end": "2026-06-30",
                "prior_period_start": "2025-04-01",
                "prior_period_end": "2025-06-30",
                "source_url": SEC_URL,
                "evidence_label": "fact_source_reported_dimensioned",
            }],
        },
    }]}


class CompanyFilingSummaryTests(unittest.TestCase):
    def test_inputs_use_latest_sec_accession_and_us_candidates_only(self) -> None:
        rows = build_inputs(queue(), facts(), {}, {})
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["filing_key"], "TEST:0000000001-26-000001")
        self.assertEqual(len(rows[0]["reported_metrics"]), 2)
        self.assertEqual(rows[0]["reported_metrics"][0]["label_ko"], "매출")
        self.assertEqual(rows[0]["financial_comparison"]["rows"][0]["change_pct"], 25.0)
        self.assertEqual(rows[0]["financial_comparison"]["ratios"][0]["value"], 20.0)
        self.assertEqual(rows[0]["financial_comparison"]["segment_rows"][0]["segment_label"], "Cloud Segment")

    def test_missing_api_key_keeps_official_facts_and_blocks_thesis_mutation(self) -> None:
        artifact = build_artifact("2026-08-10", build_inputs(queue(), facts(), {}, {}))
        self.assertEqual(artifact["status"], "facts_only_missing_api_key")
        company = artifact["companies"][0]
        self.assertEqual(company["analysis"]["thesis_effect"], "insufficient_evidence")
        self.assertTrue(company["review_gate"]["thesis_change_requires_approval"])
        self.assertFalse(company["review_gate"]["automatic_position_action"])

    def test_model_analysis_is_attached_but_still_requires_review(self) -> None:
        def requester(inputs, **_kwargs):
            return ({"companies": [{
                "filing_key": inputs[0]["filing_key"],
                "summary_ko": "매출과 영업이익을 공식 공시에서 확인했습니다.",
                "financial_takeaways_ko": ["영업이익률은 계산 전 원시 수치 기준입니다."],
                "business_takeaways_ko": [],
                "risks_ko": ["연차보고서 위험 기준선 확인 필요"],
                "thesis_effect": "mixed",
                "thesis_effect_reason_ko": "수치와 위험 신호가 혼재합니다.",
                "monitoring_points_ko": ["다음 분기 동일 기간 비교"],
                "financial_change_reasons_ko": ["동일 기간 매출과 영업이익이 모두 25% 증가했습니다."],
                "industry_analysis_ko": {
                    "market_dynamics_ko": [], "competitive_positioning_ko": [],
                    "growth_drivers_ko": [], "outlook_1_2y_ko": [],
                },
                "recent_news_ko": [],
            }]}, {"input_tokens": 10})

        artifact = build_artifact(
            "2026-08-10",
            build_inputs(queue(), facts(), {}, {}),
            api_key="test-key",
            requester=requester,
        )
        self.assertEqual(artifact["status"], "complete")
        self.assertEqual(artifact["companies"][0]["analysis"]["thesis_effect"], "mixed")
        self.assertTrue(artifact["companies"][0]["review_gate"]["thesis_change_requires_approval"])
        validate_artifact(artifact)

    def test_validator_rejects_automatic_position_action(self) -> None:
        artifact = build_artifact("2026-08-10", build_inputs(queue(), facts(), {}, {}))
        artifact["companies"][0]["review_gate"]["automatic_position_action"] = True
        with self.assertRaises(ValueError):
            validate_artifact(artifact)


if __name__ == "__main__":
    unittest.main()
