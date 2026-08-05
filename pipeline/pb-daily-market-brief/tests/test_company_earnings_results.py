from __future__ import annotations

import copy
import unittest
from datetime import date

from build_company_earnings_scenarios import build_company_earnings_scenarios
from collect_company_earnings_results import (
    collect_company_earnings_results,
    validate_company_earnings_results,
    validate_result_record,
)
from compose_daily_brief import source_section
from test_company_earnings_scenarios import ready_review
from track_company_theses import update_company_thesis_history


RESULT_URL = "https://investor.gevernova.com/2026-q3-results"


def scenario_payload() -> dict:
    return build_company_earnings_scenarios("2026-10-30", ready_review())


def result_record() -> dict:
    scenario = scenario_payload()["companies"][0]["conditional_scenarios"][0]
    driver_id = scenario["operating_cross_checks"][0]["driver_id"]
    return {
        "result_id": "gev-2026q3-results",
        "ticker": "GEV",
        "issuer": "GE Vernova",
        "event_date": "2026-10-30",
        "reported_period": "2026 Q3",
        "source_type": "company_earnings_release",
        "source_url": RESULT_URL,
        "source_date": "2026-10-30",
        "body_location": "Q3 financial tables and operating highlights",
        "primary_source_confirmed": True,
        "body_verified": True,
        "reported_metrics": [{
            "metric_id": "revenue", "label": "Revenue", "value": 10_600_000_000,
            "unit": "USD", "period_start": "2026-07-01", "period_end": "2026-09-30",
            "basis": "gaap", "source_type": "company_earnings_release",
            "source_url": RESULT_URL, "source_date": "2026-10-30",
            "body_location": "Financial results table, revenue row",
            "primary_source_confirmed": True, "body_verified": True,
        }],
        "operating_kpis": [{
            "driver_id": driver_id, "label": "Tracked operating KPI",
            "current_value": 120, "prior_value": 100, "unit": "USD",
            "current_period_end": "2026-09-30", "prior_period_end": "2026-06-30",
            "definition": "Same company-defined KPI and scope as the prior disclosure",
            "comparison_status": "comparable", "basis": "company_defined",
            "source_type": "company_earnings_release", "source_url": RESULT_URL,
            "source_date": "2026-10-30", "body_location": "Operating KPI table",
            "primary_source_confirmed": True, "body_verified": True,
        }],
        "guidance_updates": [{
            "metric_id": "revenue", "period_end": "2026-12-31",
            "value_low": 10_800_000_000, "value_high": 11_200_000_000,
            "unit": "USD", "basis": "gaap", "assumptions": "Company stated outlook assumptions",
            "source_type": "company_earnings_release", "source_url": RESULT_URL,
            "source_date": "2026-10-30", "body_location": "Outlook table, revenue row",
            "primary_source_confirmed": True, "body_verified": True,
        }],
        "eps_quality": {
            "status": "no_material_trigger_identified_from_available_sources",
            "bridge_items": [], "note": "Filing tie-out remains pending.",
        },
        "transcript_status": "not_provided",
    }


def verified_result() -> dict:
    return validate_result_record(result_record(), date.fromisoformat("2026-10-31"))


class CompanyEarningsResultTests(unittest.TestCase):
    def test_verified_exact_result_and_kpi_unlock_deep_dive_input_pack(self) -> None:
        payload = collect_company_earnings_results("2026-10-31", scenario_payload(), [verified_result()])
        company = payload["companies"][0]
        self.assertEqual(company["pack_status"], "ready_for_post_earnings_deep_dive")
        self.assertEqual(company["headline_result_case"], "stronger_evidence")
        self.assertEqual(company["reported_metric_comparison"]["reported_value"], 10_600_000_000)
        self.assertEqual(company["operating_kpi_checks"][0]["evidence_signal"], "confirming")
        self.assertEqual(company["guidance_updates"][0]["midpoint"], 11_000_000_000)
        self.assertFalse(company["thesis_update_allowed"])
        self.assertFalse(company["position_action_allowed"])

    def test_missing_input_is_nonfatal_waiting_state(self) -> None:
        payload = collect_company_earnings_results("2026-10-31", scenario_payload(), [])
        self.assertEqual(payload["ready_count"], 0)
        self.assertEqual(payload["companies"][0]["pack_status"], "not_available_no_verified_result_input")

    def test_next_day_result_uses_frozen_pre_event_history_not_refreshed_estimates(self) -> None:
        frozen_scenarios = scenario_payload()
        history, _ = update_company_thesis_history({}, "2026-10-30", frozen_scenarios)
        payload = collect_company_earnings_results(
            "2026-10-31", {"companies": []}, [verified_result()], company_thesis_history=history,
        )
        company = payload["companies"][0]
        self.assertEqual(company["pack_status"], "ready_for_post_earnings_deep_dive")
        self.assertEqual(company["headline_result_case"], "stronger_evidence")

    def test_result_without_frozen_pre_event_baseline_is_visible_and_blocked(self) -> None:
        payload = collect_company_earnings_results("2026-10-31", {"companies": []}, [verified_result()])
        company = payload["companies"][0]
        self.assertEqual(company["pack_status"], "blocked_incomplete_post_earnings_evidence")
        self.assertIn("frozen pre-event trigger baseline from append-only history", company["missing_artifacts"])

    def test_event_or_exact_unit_mismatch_blocks_pack(self) -> None:
        for field, value in (("event_date", "2026-10-29"), ("unit", "USD_millions")):
            row = verified_result()
            if field == "unit":
                row["reported_metrics"][0][field] = value
            else:
                row[field] = value
            payload = collect_company_earnings_results("2026-10-31", scenario_payload(), [row])
            self.assertEqual(payload["companies"][0]["pack_status"], "blocked_incomplete_post_earnings_evidence")

    def test_unverified_future_or_non_gaap_without_reconciliation_is_rejected(self) -> None:
        unverified = result_record()
        unverified["body_verified"] = False
        with self.assertRaisesRegex(ValueError, "body verification"):
            validate_result_record(unverified, date.fromisoformat("2026-10-31"))
        future = result_record()
        future["source_date"] = "2026-11-01"
        with self.assertRaisesRegex(ValueError, "after report date"):
            validate_result_record(future, date.fromisoformat("2026-10-31"))
        non_gaap = result_record()
        non_gaap["reported_metrics"][0]["basis"] = "non_gaap"
        with self.assertRaisesRegex(ValueError, "Non-GAAP metric"):
            validate_result_record(non_gaap, date.fromisoformat("2026-10-31"))

    def test_triggered_eps_quality_requires_bridge_items(self) -> None:
        row = result_record()
        row["eps_quality"]["status"] = "expanded_bridge_required"
        with self.assertRaisesRegex(ValueError, "requires bridge items"):
            validate_result_record(row, date.fromisoformat("2026-10-31"))
        row["eps_quality"]["bridge_items"] = [{"label": "Tax benefit", "amount": 1.0}]
        with self.assertRaisesRegex(ValueError, "bridge item missing fields"):
            validate_result_record(row, date.fromisoformat("2026-10-31"))

    def test_validator_blocks_thesis_or_position_promotion(self) -> None:
        payload = collect_company_earnings_results("2026-10-31", scenario_payload(), [verified_result()])
        for field in ("thesis_update_allowed", "position_action_allowed"):
            tampered = copy.deepcopy(payload)
            tampered["companies"][0][field] = True
            with self.assertRaisesRegex(ValueError, "cannot update thesis or position"):
                validate_company_earnings_results(tampered)

    def test_result_source_is_deduplicated_in_report_inventory(self) -> None:
        payload = collect_company_earnings_results("2026-10-31", scenario_payload(), [verified_result()])
        rendered = source_section([], {
            "company_earnings_results": payload,
            "source_quality": {"evidence_posture": "research_grade"},
        })
        self.assertEqual(rendered.count(RESULT_URL), 1)


if __name__ == "__main__":
    unittest.main()
