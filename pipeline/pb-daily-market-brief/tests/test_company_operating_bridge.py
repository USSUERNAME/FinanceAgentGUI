from __future__ import annotations

import copy
import unittest
from datetime import date

from build_company_operating_bridge import (
    build_company_operating_bridge,
    validate_company_operating_bridge,
    validate_manual_operating_record,
)
from compose_daily_brief import source_section


SEC_URL = (
    "https://www.sec.gov/Archives/edgar/data/1996810/"
    "000199681026000015/0001996810-26-000015-index.html"
)


def primary_facts() -> dict:
    return {"companies": [{
        "candidate_id": "grid_electrification:US:GEV",
        "sector_id": "grid_electrification",
        "ticker": "GEV",
        "company_name": "GE Vernova",
        "reported_metrics": [{
            "metric_id": "revenue",
            "taxonomy": "us-gaap",
            "concept": "RevenueFromContractWithCustomerExcludingAssessedTax",
            "label": "Revenue",
            "value": 9000000000,
            "unit": "USD",
            "period_start": "2026-01-01",
            "period_end": "2026-03-31",
            "filed_date": "2026-04-25",
            "form": "10-Q",
            "fiscal_period": "Q1",
            "accession_number": "0001996810-26-000015",
            "source_url": SEC_URL,
            "confidence": "high",
        }, {
            "metric_id": "capital_expenditures",
            "taxonomy": "us-gaap",
            "concept": "PaymentsToAcquirePropertyPlantAndEquipment",
            "label": "Capital expenditures",
            "value": 300000000,
            "unit": "USD",
            "period_start": "2026-01-01",
            "period_end": "2026-03-31",
            "filed_date": "2026-04-25",
            "form": "10-Q",
            "fiscal_period": "Q1",
            "accession_number": "0001996810-26-000015",
            "source_url": SEC_URL,
            "confidence": "high",
        }],
    }]}


def sector_fundamentals() -> dict:
    return {"operating_observations": [{
        "record_id": "gev-electrification-rpo-2025",
        "sector_id": "grid_electrification",
        "ticker": "GEV",
        "metric_type": "backlog",
        "current_value": 34667,
        "prior_value": 23453,
        "unit": "USD millions",
        "currency": "USD",
        "current_period": "2025-12-31",
        "prior_period": "2024-12-31",
        "source_date": "2026-01-29",
        "source_url": SEC_URL,
        "body_location": "Electrification RPO table",
        "exposure_source_url": SEC_URL,
        "eligible_for_sector_score": True,
        "change_pct": 47.8158,
    }]}


def manual_segment(metric_basis: str = "reported") -> dict:
    row = {
        "record_id": "gev-electrification-revenue-2026q1",
        "sector_id": "grid_electrification",
        "ticker": "GEV",
        "company_name": "GE Vernova",
        "statement": "segment",
        "line_item_original": "Electrification revenue",
        "line_item_standard": "Electrification Revenue",
        "line_item_id": "segment.electrification.revenue",
        "metric_basis": metric_basis,
        "definition": "Revenue reported for the Electrification segment.",
        "current_value": 2200,
        "prior_value": 1800,
        "current_period_start": "2026-01-01",
        "current_period_end": "2026-03-31",
        "current_period_label": "Q1 2026",
        "prior_period_start": "2025-01-01",
        "prior_period_end": "2025-03-31",
        "prior_period_label": "Q1 2025",
        "period_type": "quarterly",
        "currency": "USD",
        "units": "USD millions",
        "source_type": "company_filing",
        "source_url": SEC_URL,
        "source_date": "2026-04-25",
        "body_location": "Segment results table, Electrification revenue",
        "primary_source_confirmed": True,
        "body_verified": True,
        "exposure_verified": True,
        "exposure_source_url": SEC_URL,
        "exposure_body_location": "Business section, Electrification",
        "comparison_status": "comparable",
        "model_treatment": "audit_only_pending_full_segment_schedule",
    }
    return row


class CompanyOperatingBridgeTests(unittest.TestCase):
    def test_primary_rows_preserve_source_and_normalize_capex_sign(self) -> None:
        payload = build_company_operating_bridge(
            "2026-07-20", primary_facts(), {"operating_observations": []},
        )
        company = payload["companies"][0]
        capex = next(row for row in company["normalized_financials_long"] if row["line_item_id"] == "capital_expenditures")
        self.assertEqual(capex["source_value"], 300000000)
        self.assertEqual(capex["normalized_value"], -300000000)
        self.assertEqual(capex["normalization_method"], "cash_flow_sign_normalized")
        self.assertTrue(all(source["retrieved_at"] == "2026-07-20" for source in company["source_index"]))

    def test_verified_backlog_creates_noncausal_operating_transmission(self) -> None:
        payload = build_company_operating_bridge(
            "2026-07-20", primary_facts(), sector_fundamentals(),
        )
        company = payload["companies"][0]
        self.assertEqual(company["transmission_status"], "verified_company_operating_signal_not_causal_attribution")
        self.assertEqual(company["operating_evidence"][0]["metric_id"], "backlog")
        self.assertEqual(company["operating_evidence"][0]["change_pct"], 47.8158)
        backlog_rows = [row for row in company["normalized_financials_long"] if row["line_item_id"] == "company_kpi.backlog"]
        self.assertEqual(len(backlog_rows), 2)

    def test_segment_input_removes_segment_gap_and_calculates_comparable_change(self) -> None:
        record = validate_manual_operating_record(manual_segment(), date.fromisoformat("2026-07-20"))
        payload = build_company_operating_bridge(
            "2026-07-20", primary_facts(), {"operating_observations": []}, [record], [],
        )
        company = payload["companies"][0]
        self.assertFalse(any(flag["area"] == "segment" for flag in company["qa_flags"]))
        summary = company["operating_evidence"][0]
        self.assertEqual(summary["change_pct"], 22.2222)
        self.assertEqual(summary["comparison_status"], "comparable")

    def test_adjusted_metric_without_reconciliation_is_rejected(self) -> None:
        row = manual_segment("management_adjusted")
        with self.assertRaisesRegex(ValueError, "reconciliation record"):
            validate_manual_operating_record(row, date.fromisoformat("2026-07-20"))

    def test_future_operating_period_is_rejected(self) -> None:
        row = manual_segment()
        row["current_period_end"] = "2026-08-01"
        with self.assertRaisesRegex(ValueError, "period end is after report date"):
            validate_manual_operating_record(row, date.fromisoformat("2026-07-20"))

    def test_missing_operating_evidence_remains_partial_with_qa_flag(self) -> None:
        payload = build_company_operating_bridge(
            "2026-07-20", primary_facts(), {"operating_observations": []},
        )
        company = payload["companies"][0]
        self.assertEqual(company["transmission_status"], "company_operating_transmission_not_verified")
        self.assertTrue(any(flag["area"] == "kpi_schedule" for flag in company["qa_flags"]))
        self.assertEqual(company["model_load_status"], "audit_only_not_full_model_schedule")

    def test_every_normalized_row_has_a_source_validation_check(self) -> None:
        payload = build_company_operating_bridge(
            "2026-07-20", primary_facts(), sector_fundamentals(),
        )
        company = payload["companies"][0]
        self.assertEqual(len(company["normalized_financials_long"]), len(company["validation_checks"]))
        self.assertTrue(all(check["result"] == "pass" for check in company["validation_checks"]))

    def test_validator_rejects_causal_or_model_ready_escalation(self) -> None:
        payload = build_company_operating_bridge(
            "2026-07-20", primary_facts(), sector_fundamentals(),
        )
        causal = copy.deepcopy(payload)
        causal["companies"][0]["transmission_status"] = "causal_attribution_confirmed"
        with self.assertRaisesRegex(ValueError, "cannot prove"):
            validate_company_operating_bridge(causal)
        model_ready = copy.deepcopy(payload)
        model_ready["companies"][0]["model_load_status"] = "model_ready"
        with self.assertRaisesRegex(ValueError, "cannot be labeled model-ready"):
            validate_company_operating_bridge(model_ready)

    def test_operating_evidence_primary_url_enters_source_inventory_once(self) -> None:
        rendered = source_section([], {
            "company_operating_bridge": {"companies": [{
                "ticker": "GEV",
                "operating_evidence": [{"source_url": SEC_URL}, {"source_url": SEC_URL}],
            }]},
            "source_quality": {"evidence_posture": "research_grade"},
        })
        self.assertEqual(rendered.count(SEC_URL), 1)


if __name__ == "__main__":
    unittest.main()
