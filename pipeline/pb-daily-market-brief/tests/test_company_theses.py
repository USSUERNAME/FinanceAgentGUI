from __future__ import annotations

import copy
import unittest

from build_company_earnings_scenarios import build_company_earnings_scenarios
from build_company_earnings_deep_dive import build_company_earnings_deep_dive
from build_company_thesis_update import build_company_thesis_update
from collect_company_earnings_results import collect_company_earnings_results
from compose_daily_brief import source_section
from test_company_earnings_driver_review import GUIDANCE_URL
from test_company_earnings_events import IR_URL
from test_company_earnings_scenarios import ready_review
from test_company_earnings_results import verified_result
from test_company_earnings_deep_dive import market_context, valuation_context
from test_company_thesis_update import registry as underwriting_registry
from track_company_theses import update_company_thesis_history, validate_company_thesis_history


def scenarios() -> dict:
    return build_company_earnings_scenarios("2026-07-30", ready_review())


class CompanyThesisHistoryTests(unittest.TestCase):
    def test_first_run_creates_untested_append_only_baseline(self) -> None:
        history, review = update_company_thesis_history({}, "2026-07-30", scenarios())
        record = history["daily_records"][0]
        self.assertEqual(record["company_thesis_status"], "untested")
        self.assertEqual(record["security_thesis_readiness"], "not_decision_grade")
        self.assertEqual(record["position_action"], "wait_for_proof")
        self.assertEqual(review["current_company_states"][0]["transition"], "baseline_created")

    def test_trigger_rules_are_unapproved_drafts_with_source_lineage(self) -> None:
        history, _ = update_company_thesis_history({}, "2026-07-30", scenarios())
        record = history["daily_records"][0]
        source_ids = {row["source_id"] for row in record["source_index"]}
        self.assertEqual(len(record["action_rules"]), 3)
        self.assertTrue(all(row["threshold_origin"] == "Draft threshold for PM confirmation" for row in record["action_rules"]))
        self.assertTrue(all(row["threshold_approval_status"] == "unapproved" for row in record["action_rules"]))
        self.assertTrue(all(set(row["source_ids"]).issubset(source_ids) for row in record["action_rules"]))

    def test_same_input_is_idempotent_and_changed_input_appends_revision(self) -> None:
        payload = scenarios()
        history, _ = update_company_thesis_history({}, "2026-07-30", payload)
        history, rerun = update_company_thesis_history(history, "2026-07-30", copy.deepcopy(payload))
        self.assertTrue(rerun["is_idempotent_rerun"])
        self.assertEqual(len(history["daily_records"]), 1)
        changed = copy.deepcopy(payload)
        changed["companies"][0]["conditional_scenarios"][0]["threshold_low"] += 1
        history, revision = update_company_thesis_history(history, "2026-07-30", changed)
        self.assertFalse(revision["is_idempotent_rerun"])
        self.assertEqual(revision["revision"], 2)
        self.assertEqual(len(history["daily_records"]), 2)

    def test_gate_open_and_loss_are_process_transitions_not_fundamental_calls(self) -> None:
        blocked = scenarios()
        company = blocked["companies"][0]
        company["scenario_gate_status"] = "blocked_missing_exact_event_bar_or_driver"
        company["conditional_scenarios"] = []
        company["scenario_count"] = 0
        company["gate_gaps"] = [{"area": "guidance", "severity": "blocker", "required": "verified guidance"}]
        history, _ = update_company_thesis_history({}, "2026-10-29", blocked)
        history, opened = update_company_thesis_history(history, "2026-10-30", scenarios())
        event = opened["material_changes"][0]
        self.assertEqual(event["transition"], "pre_event_trigger_pack_ready")
        self.assertEqual(event["company_thesis_status"], "untested")
        history, lost = update_company_thesis_history(history, "2026-10-31", blocked)
        event = lost["material_changes"][0]
        self.assertEqual(event["transition"], "evidence_gate_lost")
        self.assertEqual(event["company_thesis_status"], "untested")

    def test_post_earnings_pack_appends_process_transition_without_thesis_promotion(self) -> None:
        frozen = scenarios()
        history, _ = update_company_thesis_history({}, "2026-10-30", frozen)
        results = collect_company_earnings_results(
            "2026-10-31", {"companies": []}, [verified_result()], company_thesis_history=history,
        )
        history, review = update_company_thesis_history(history, "2026-10-31", {"companies": []}, results)
        event = review["material_changes"][0]
        state = review["current_company_states"][0]
        self.assertEqual(event["transition"], "post_earnings_input_pack_ready")
        self.assertEqual(state["company_thesis_status"], "untested")
        self.assertEqual(state["security_thesis_readiness"], "not_decision_grade")
        self.assertEqual(state["position_action"], "wait_for_proof")

    def test_deep_dive_appends_research_signal_without_formal_thesis_promotion(self) -> None:
        frozen = scenarios()
        history, _ = update_company_thesis_history({}, "2026-10-30", frozen)
        results = collect_company_earnings_results(
            "2026-10-31", {"companies": []}, [verified_result()], company_thesis_history=history,
        )
        deep_dive = build_company_earnings_deep_dive(
            "2026-10-31", results, market_context(), valuation_context(),
        )
        history, review = update_company_thesis_history(
            history, "2026-10-31", {"companies": []}, results, deep_dive,
        )
        event = review["material_changes"][0]
        state = review["current_company_states"][0]
        self.assertEqual(event["transition"], "post_earnings_deep_dive_ready")
        self.assertEqual(state["post_earnings_research_case_signal"], "strengthening_evidence")
        self.assertEqual(state["company_thesis_status"], "untested")
        self.assertEqual(state["security_thesis_readiness"], "not_decision_grade")
        self.assertEqual(state["position_action"], "wait_for_proof")

    def test_approved_underwriting_unlocks_formal_company_status_only(self) -> None:
        frozen = scenarios()
        history, _ = update_company_thesis_history({}, "2026-10-30", frozen)
        results = collect_company_earnings_results(
            "2026-10-31", {"companies": []}, [verified_result()], company_thesis_history=history,
        )
        deep_dive = build_company_earnings_deep_dive(
            "2026-10-31", results, market_context(), valuation_context(),
        )
        formal = build_company_thesis_update(
            "2026-10-31", underwriting_registry(), deep_dive,
        )
        history, review = update_company_thesis_history(
            history, "2026-10-31", {"companies": []}, results, deep_dive, formal,
        )
        state = review["current_company_states"][0]
        event = review["material_changes"][0]
        self.assertEqual(event["transition"], "formal_company_thesis_updated")
        self.assertEqual(state["company_thesis_status"], "strengthening")
        self.assertEqual(state["security_thesis_readiness"], "not_decision_grade")
        self.assertEqual(state["position_action"], "wait_for_proof")

    def test_validator_blocks_status_readiness_action_and_rule_approval_escalation(self) -> None:
        for field, value, message in (
            ("company_thesis_status", "strengthening", "cannot promote company"),
            ("security_thesis_readiness", "ready", "cannot promote security"),
            ("position_action", "add", "cannot issue"),
        ):
            history, review = update_company_thesis_history({}, "2026-07-30", scenarios())
            history["daily_records"][0][field] = value
            with self.assertRaisesRegex(ValueError, message):
                validate_company_thesis_history(history, review)
        history, review = update_company_thesis_history({}, "2026-07-30", scenarios())
        history["daily_records"][0]["action_rules"][0]["threshold_approval_status"] = "approved"
        with self.assertRaisesRegex(ValueError, "unapproved drafts"):
            validate_company_thesis_history(history, review)

    def test_tracker_sources_are_deduplicated_in_report_inventory(self) -> None:
        _, review = update_company_thesis_history({}, "2026-07-30", scenarios())
        # The daily review deliberately stays compact; the scenario source index
        # remains the controlling deterministic bibliography input.
        rendered = source_section([], {
            "company_earnings_scenarios": scenarios(),
            "company_thesis_review": review,
            "source_quality": {"evidence_posture": "research_grade"},
        })
        self.assertEqual(rendered.count(GUIDANCE_URL), 1)
        self.assertEqual(rendered.count(IR_URL), 1)


if __name__ == "__main__":
    unittest.main()
