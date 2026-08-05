from __future__ import annotations

import copy
import unittest
from datetime import date

from build_company_earnings_deep_dive import build_company_earnings_deep_dive
from build_company_thesis_update import build_company_thesis_update, validate_company_thesis_update
from collect_company_earnings_results import collect_company_earnings_results
from collect_company_underwriting import (
    collect_company_underwriting,
    validate_company_underwriting_registry,
    validate_underwriting_record,
)
from test_company_earnings_deep_dive import market_context, valuation_context
from test_company_earnings_results import scenario_payload, verified_result


UW_SOURCE_ID = "UW-GEV-V1"


def deep_dive() -> dict:
    results = collect_company_earnings_results("2026-10-31", scenario_payload(), [verified_result()])
    return build_company_earnings_deep_dive("2026-10-31", results, market_context(), valuation_context())


def underwriting_record(approved: bool = True) -> dict:
    driver_id = deep_dive()["reviews"][0]["quality_of_print"]["operating_kpi_checks"][0]["driver_id"]
    return {
        "underwriting_id": "company:GEV:original:2026-10-29",
        "ticker": "GEV", "company_name": "GE Vernova", "version": 1,
        "authored_at": "2026-10-29T12:00:00+09:00",
        "approval": {
            "status": "approved_by_user_or_pm" if approved else "draft_pending_user_approval",
            "approved_by": "portfolio_manager" if approved else None,
            "approved_at": "2026-10-29T13:00:00+09:00" if approved else None,
            "approval_note": "Explicitly reviewed.",
        },
        "one_sentence_thesis": "Revenue and operating execution must confirm together.",
        "variant_perception": "User-approved internal judgment; no market mispricing conclusion implied.",
        "market_setup": "No decision-grade priced-in conclusion supplied.",
        "valuation_anchor": {"status": "not_supplied", "text": "Not supplied", "as_of": None},
        "horizon": "12-24 months",
        "pillars": [
            {
                "pillar_id": "revenue_execution", "pillar_name": "Revenue execution",
                "claim": "Revenue must meet the inherited exact-period bar.", "priority": "core",
                "baseline": "Frozen pre-event range", "expected_path": "At or above verified range",
                "evidence_rules": [{
                    "selector": "headline_result_case",
                    "confirming_values": ["stronger_evidence", "within_verified_range"],
                    "warning_values": [], "break_values": ["weaker_evidence"],
                }],
                "next_proof_point": "Next exact-period result", "source_ids": [UW_SOURCE_ID],
            },
            {
                "pillar_id": "operating_execution", "pillar_name": "Operating execution",
                "claim": "The tracked KPI must keep its prior direction.", "priority": "core",
                "baseline": "Prior comparable KPI", "expected_path": "Increase versus prior",
                "evidence_rules": [{
                    "selector": f"operating_kpi:{driver_id}",
                    "confirming_values": ["confirming"], "warning_values": ["neutral"],
                    "break_values": ["weakening"],
                }],
                "next_proof_point": "Next comparable KPI", "source_ids": [UW_SOURCE_ID],
            },
        ],
        "kill_criteria": [{
            "kill_id": "revenue_range_break", "claim": "Exact-period revenue below the inherited lower bar breaks the thesis.",
            "selector": "headline_result_case", "match_values": ["weaker_evidence"],
            "threshold_origin": "Inherited threshold" if approved else "Draft threshold for PM confirmation",
            "threshold_approval_status": "Approved monitoring rule" if approved else "draft_pending_user_approval",
            "required_source_type": "body_verified_primary_company_result", "source_ids": [UW_SOURCE_ID],
        }],
        "catalysts": ["Next earnings"], "open_diligence": ["Refresh model and valuation"],
        "source_index": [{
            "source_id": UW_SOURCE_ID, "source_name": "Approved original underwriting",
            "source_type": "user_provided_internal_research", "as_of_date": "2026-10-29",
            "source_location": "workspace/company_underwriting_inputs/2026-10-29/GEV.json",
            "reliability": "user_or_pm_approved", "limitation": "Internal judgment, not public fact",
        }],
    }


def registry(approved: bool = True) -> dict:
    record = validate_underwriting_record(underwriting_record(approved), date.fromisoformat("2026-10-31"))
    return collect_company_underwriting("2026-10-31", deep_dive(), [record])


class CompanyThesisUpdateTests(unittest.TestCase):
    def test_draft_underwriting_cannot_unlock_formal_update(self) -> None:
        collected = registry(False)
        self.assertEqual(collected["approved_count"], 0)
        update = build_company_thesis_update("2026-10-31", collected, deep_dive())["updates"][0]
        self.assertEqual(update["company_thesis_status"], "untested")
        self.assertEqual(update["update_status"], "blocked_missing_approved_underwriting_or_verified_deep_dive")

    def test_approved_underwriting_maps_confirming_core_pillars(self) -> None:
        update = build_company_thesis_update("2026-10-31", registry(), deep_dive())["updates"][0]
        self.assertEqual(update["company_thesis_status"], "strengthening")
        self.assertTrue(all(row["current_status"] == "confirming" for row in update["pillar_updates"]))
        self.assertEqual(update["security_thesis_readiness"], "not_decision_grade")
        self.assertEqual(update["position_action"], "wait_for_proof")

    def test_approved_kill_criterion_has_priority_over_other_pillars(self) -> None:
        review = deep_dive()
        review["reviews"][0]["headline_vs_pre_event_bar"]["interpretation"] = "weaker_evidence"
        update = build_company_thesis_update("2026-10-31", registry(), review)["updates"][0]
        self.assertEqual(update["company_thesis_status"], "broken")
        self.assertTrue(update["kill_criteria_checks"][0]["criterion_hit"])
        self.assertEqual(update["position_action"], "wait_for_proof")

    def test_unmapped_approved_pillar_stays_untested(self) -> None:
        row = underwriting_record()
        row["pillars"][1]["evidence_rules"][0]["selector"] = "operating_kpi:not_supplied"
        normalized = validate_underwriting_record(row, date.fromisoformat("2026-10-31"))
        update = build_company_thesis_update(
            "2026-10-31", collect_company_underwriting("2026-10-31", deep_dive(), [normalized]), deep_dive(),
        )["updates"][0]
        self.assertEqual(update["company_thesis_status"], "untested")

    def test_registry_validator_rejects_false_approval_escalation(self) -> None:
        payload = registry(False)
        payload["companies"][0]["formal_thesis_update_allowed"] = True
        with self.assertRaisesRegex(ValueError, "explicitly approved"):
            validate_company_underwriting_registry(payload)

    def test_update_validator_blocks_security_or_position_escalation(self) -> None:
        payload = build_company_thesis_update("2026-10-31", registry(), deep_dive())
        for field, value in (("security_thesis_readiness", "ready"), ("position_action", "add")):
            tampered = copy.deepcopy(payload)
            tampered["updates"][0][field] = value
            with self.assertRaisesRegex(ValueError, "cannot issue"):
                validate_company_thesis_update(tampered)

    def test_underwriting_requires_explicit_approval_identity_and_source_lineage(self) -> None:
        row = underwriting_record()
        row["approval"]["approved_by"] = None
        with self.assertRaisesRegex(ValueError, "approver"):
            validate_underwriting_record(row, date.fromisoformat("2026-10-31"))
        row = underwriting_record()
        row["pillars"][0]["source_ids"] = ["MISSING"]
        with self.assertRaisesRegex(ValueError, "source lineage"):
            validate_underwriting_record(row, date.fromisoformat("2026-10-31"))

    def test_duplicate_underwriting_version_is_rejected(self) -> None:
        row = validate_underwriting_record(underwriting_record(), date.fromisoformat("2026-10-31"))
        with self.assertRaisesRegex(ValueError, "Duplicate underwriting"):
            collect_company_underwriting("2026-10-31", deep_dive(), [row, copy.deepcopy(row)])


if __name__ == "__main__":
    unittest.main()
