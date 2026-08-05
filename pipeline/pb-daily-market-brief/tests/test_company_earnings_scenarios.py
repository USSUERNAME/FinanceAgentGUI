from __future__ import annotations

import copy
import unittest
from datetime import date

from build_company_earnings_driver_review import build_company_earnings_driver_review
from build_company_earnings_scenarios import (
    build_company_earnings_scenarios,
    validate_company_earnings_scenarios,
)
from collect_company_earnings_reaction_context import (
    collect_company_earnings_reaction_context,
    validate_option_snapshot,
)
from compose_daily_brief import source_section
from test_company_earnings_driver_review import GUIDANCE_URL, bundle
from collect_company_earnings_events import collect_company_earnings_events, validate_primary_event_record
from test_company_earnings_events import IR_URL, confirmed_event
from test_company_earnings_reaction_context import fetcher, option_snapshot


def ready_review() -> dict:
    tearsheets, valuation, primary = bundle()
    event = confirmed_event("2026-10-30")
    event["reported_period"] = "2026 Q3"
    event["fiscal_period_end"] = "2026-09-30"
    verified_event = validate_primary_event_record(event, date.fromisoformat("2026-10-20"))
    events = collect_company_earnings_events(
        "2026-10-20", tearsheets, "", primary_inputs=[verified_event],
    )
    option_row = option_snapshot("2026-10-27", "2026-10-31")
    option_row["event_date"] = "2026-10-30"
    option = validate_option_snapshot(option_row, date.fromisoformat("2026-10-30"))
    reaction = collect_company_earnings_reaction_context(
        "2026-10-30", tearsheets, events, "secret", fetcher=fetcher, option_inputs=[option],
    )
    return build_company_earnings_driver_review(
        "2026-10-30", tearsheets, valuation, primary, events, reaction,
    )


class CompanyEarningsScenarioTests(unittest.TestCase):
    def build(self) -> dict:
        return build_company_earnings_scenarios("2026-10-30", ready_review())

    def test_ready_gate_creates_three_evidence_cases(self) -> None:
        company = self.build()["companies"][0]
        self.assertEqual(company["scenario_gate_status"], "conditional_thesis_triggers_available")
        self.assertEqual(
            [row["scenario"] for row in company["conditional_scenarios"]],
            ["stronger_evidence", "within_verified_range", "weaker_evidence"],
        )
        self.assertEqual(company["action"], "wait_for_proof")
        self.assertFalse(company["probabilities_generated"])
        self.assertFalse(company["price_targets_generated"])

    def test_thresholds_preserve_guidance_period_unit_and_estimate_freeze(self) -> None:
        rows = self.build()["companies"][0]["conditional_scenarios"]
        self.assertEqual(rows[0]["threshold_low"], 10_500_000_000)
        self.assertEqual(rows[1]["threshold_low"], 9_500_000_000)
        self.assertEqual(rows[1]["threshold_high"], 10_500_000_000)
        self.assertEqual(rows[2]["threshold_low"], 9_500_000_000)
        self.assertTrue(all(row["period_end"] == "2026-09-30" for row in rows))
        self.assertTrue(all(row["units"] == "USD" for row in rows))
        self.assertTrue(all(row["estimate_freeze_as_of"] == "2026-07-20" for row in rows))

    def test_every_threshold_and_cross_check_resolves_to_source_index(self) -> None:
        company = self.build()["companies"][0]
        source_ids = {row["source_id"] for row in company["source_index"]}
        for scenario in company["conditional_scenarios"]:
            self.assertTrue(set(scenario["source_ids"]).issubset(source_ids))
            self.assertTrue(scenario["operating_cross_checks"])
            self.assertTrue(all(row["source_id"] in source_ids for row in scenario["operating_cross_checks"]))

    def test_unconfirmed_event_blocks_all_cases(self) -> None:
        review = ready_review()
        review["reviews"][0]["review_mode"] = "earnings_driver_monitoring_not_pre_event_preview"
        review["reviews"][0]["event_setup"].update({
            "event_date": None, "event_source_id": None, "event_date_status": "provider_expected_needs_primary_confirmation",
        })
        company = build_company_earnings_scenarios("2026-10-30", review)["companies"][0]
        self.assertEqual(company["conditional_scenarios"], [])
        self.assertIn("event_date", {row["area"] for row in company["gate_gaps"]})

    def test_missing_guidance_or_comparable_driver_blocks_cases(self) -> None:
        for field in ("company_guidance", "earnings_drivers"):
            review = ready_review()
            review["reviews"][0][field] = []
            company = build_company_earnings_scenarios("2026-10-30", review)["companies"][0]
            self.assertEqual(company["conditional_scenarios"], [])

    def test_event_fiscal_period_must_match_guidance_and_estimate_period(self) -> None:
        review = ready_review()
        review["reviews"][0]["event_setup"]["fiscal_period_end"] = "2026-06-30"
        company = build_company_earnings_scenarios("2026-10-30", review)["companies"][0]
        self.assertEqual(company["conditional_scenarios"], [])
        self.assertIn("fiscal_period", {row["area"] for row in company["gate_gaps"]})

    def test_validator_rejects_probability_price_or_position_escalation(self) -> None:
        for field, value in (("probability", 0.5), ("price_target", 700), ("action", "add")):
            payload = self.build()
            payload["companies"][0][field] = value
            with self.assertRaises(ValueError):
                validate_company_earnings_scenarios(payload)

    def test_validator_rejects_unresolved_confirmed_event_source(self) -> None:
        payload = self.build()
        payload["companies"][0]["event_source_id"] = "missing-source"
        with self.assertRaisesRegex(ValueError, "event requires source lineage"):
            validate_company_earnings_scenarios(payload)

    def test_reaction_hurdle_is_explicitly_nondirectional(self) -> None:
        hurdle = self.build()["companies"][0]["reaction_hurdle_context"]
        self.assertEqual(hurdle["implied_move_status"], "event_hurdle_candidate_not_forecast")
        self.assertFalse(hurdle["directional_use_allowed"])

    def test_scenario_sources_are_deduplicated_in_report_inventory(self) -> None:
        rendered = source_section([], {
            "company_earnings_scenarios": self.build(),
            "source_quality": {"evidence_posture": "research_grade"},
        })
        self.assertEqual(rendered.count(GUIDANCE_URL), 1)
        self.assertEqual(rendered.count(IR_URL), 1)


if __name__ == "__main__":
    unittest.main()
