import unittest

from build_research_execution_pack import (
    SCHEMA_VERSION,
    build_research_execution_pack,
    validate_research_execution_pack,
)


class ResearchExecutionPackTests(unittest.TestCase):
    report_date = "2026-07-24"

    def intelligence(self) -> dict:
        return {
            "schema_version": "daily_market_intelligence.v2",
            "report_date": self.report_date,
            "market": {
                "regime": {"label": "mixed"},
                "key_drivers": [{"observation": "Rates rose"}],
                "conflicting_signals": ["Breadth improved"],
                "top_risks": ["Real yields"],
                "scoreboard": {"rates": {"us10y": 4.4}},
                "day_over_day_changes": {"status": "compared"},
                "data_cutoff": {"market": "2026-07-23"},
                "korea_transmission_inputs": {"status": "available"},
            },
            "events": {
                "items": [
                    {
                        "event_id": "earnings-nvda",
                        "event_type": "earnings_guidance",
                        "title": "NVIDIA raises guidance",
                        "listed_entities": ["NVDA"],
                        "topic_tags": ["earnings"],
                        "event_window": {},
                        "common_facts": [{"claim": "Guidance raised"}],
                        "official_sources": [
                            {
                                "source_grade": "A",
                                "url": "https://example.com/ir",
                            }
                        ],
                        "expectation_gap": {},
                        "market_reaction": {},
                        "impact_analysis": {},
                        "conflicting_claims": [],
                        "verification": {
                            "primary_fact_confirmed": True,
                            "extraction_status": "completed",
                            "evidence_posture": "research_grade",
                        },
                    },
                    {
                        "event_id": "policy-one",
                        "event_type": "regulation_policy",
                        "title": "Verified policy",
                        "listed_entities": [],
                        "topic_tags": ["policy"],
                        "common_facts": [{"claim": "Rule published"}],
                        "official_sources": [],
                        "verification": {
                            "primary_fact_confirmed": True,
                            "extraction_status": "completed",
                        },
                    },
                ]
            },
        }

    def task_plan(self) -> dict:
        return {
            "schema_version": "research_task_plan.v1",
            "report_date": self.report_date,
            "tasks": [
                {
                    "task_id": "market-task",
                    "scope": "market",
                    "event_id": None,
                    "lead_workflow": "economic-impact-report",
                    "readiness": "ready_for_research",
                    "reason_codes": ["market_analysis_available"],
                },
                {
                    "task_id": "earnings-task",
                    "scope": "event",
                    "event_id": "earnings-nvda",
                    "lead_workflow": "earnings-deep-dive",
                    "listed_entities": ["NVDA"],
                    "readiness": "ready_for_research",
                    "reason_codes": ["minimum_inputs_available"],
                },
                {
                    "task_id": "policy-task",
                    "scope": "event",
                    "event_id": "policy-one",
                    "lead_workflow": "economic-impact-report",
                    "listed_entities": [],
                    "readiness": "ready_for_research",
                    "reason_codes": ["minimum_inputs_available"],
                },
                {
                    "task_id": "blocked-task",
                    "scope": "event",
                    "event_id": "unverified",
                    "lead_workflow": "idea-generation",
                    "readiness": "needs_evidence",
                    "reason_codes": ["primary_fact_not_confirmed"],
                },
            ],
        }

    def earnings(self) -> dict:
        return {
            "schema_version": "company_post_earnings_deep_dive.v1",
            "report_date": self.report_date,
            "reviews": [
                {
                    "ticker": "NVDA",
                    "review_status": (
                        "source_verified_partial_post_earnings_deep_dive"
                    ),
                    "position_action": "wait_for_proof",
                }
            ],
        }

    def item(self, pack: dict, task_id: str) -> dict:
        return next(
            item for item in pack["work_items"] if item["task_id"] == task_id
        )

    def test_materializes_only_ready_tasks_and_attaches_existing_outputs(self) -> None:
        pack = build_research_execution_pack(
            self.task_plan(),
            self.intelligence(),
            earnings_deep_dive=self.earnings(),
            generated_at="2026-07-24T08:00:00+09:00",
        )
        self.assertEqual(pack["schema_version"], SCHEMA_VERSION)
        self.assertEqual(pack["summary"]["eligible_task_count"], 3)
        self.assertEqual(pack["summary"]["blocked_task_count"], 1)
        self.assertEqual(len(pack["work_items"]), 3)
        self.assertEqual(
            self.item(pack, "market-task")["execution_status"],
            "existing_output_attached",
        )
        earnings = self.item(pack, "earnings-task")
        self.assertEqual(
            earnings["execution_status"],
            "existing_output_attached",
        )
        self.assertEqual(
            earnings["attached_outputs"]["earnings_deep_dive_reviews"][0][
                "ticker"
            ],
            "NVDA",
        )
        self.assertEqual(
            self.item(pack, "policy-task")["execution_status"],
            "prepared_for_specialist",
        )
        self.assertFalse(pack["policy"]["model_invocation_performed"])

    def test_missing_company_output_is_not_presented_as_complete(self) -> None:
        pack = build_research_execution_pack(
            self.task_plan(),
            self.intelligence(),
            earnings_deep_dive={},
        )
        item = self.item(pack, "earnings-task")
        self.assertEqual(item["execution_status"], "awaiting_matching_output")
        self.assertEqual(item["attached_outputs"], {})

    def test_existing_event_impact_is_attached_as_completed_support(self) -> None:
        intelligence = self.intelligence()
        intelligence["events"]["items"][1]["impact_analysis"] = {
            "event_id": "policy-one",
            "bottom_line": "Verified policy transmission analysis",
        }
        pack = build_research_execution_pack(
            self.task_plan(),
            intelligence,
            earnings_deep_dive=self.earnings(),
        )
        item = self.item(pack, "policy-task")
        self.assertEqual(
            item["execution_status"],
            "existing_output_attached",
        )
        self.assertEqual(
            item["attached_outputs"]["economic_impact_analysis"][
                "event_id"
            ],
            "policy-one",
        )

    def test_unverified_event_cannot_enter_even_with_ready_route(self) -> None:
        intelligence = self.intelligence()
        intelligence["events"]["items"][1]["verification"][
            "primary_fact_confirmed"
        ] = False
        with self.assertRaises(ValueError):
            build_research_execution_pack(
                self.task_plan(),
                intelligence,
                earnings_deep_dive=self.earnings(),
            )

    def test_input_hash_is_stable_across_generation_times(self) -> None:
        first = build_research_execution_pack(
            self.task_plan(),
            self.intelligence(),
            earnings_deep_dive=self.earnings(),
            generated_at="2026-07-24T08:00:00+09:00",
        )
        second = build_research_execution_pack(
            self.task_plan(),
            self.intelligence(),
            earnings_deep_dive=self.earnings(),
            generated_at="2026-07-24T09:00:00+09:00",
        )
        self.assertEqual(
            [item["input_hash"] for item in first["work_items"]],
            [item["input_hash"] for item in second["work_items"]],
        )

    def test_validation_rejects_position_authority(self) -> None:
        pack = build_research_execution_pack(
            self.task_plan(),
            self.intelligence(),
            earnings_deep_dive=self.earnings(),
        )
        pack["work_items"][0]["decision_limits"]["position_action"] = True
        with self.assertRaises(ValueError):
            validate_research_execution_pack(pack)

    def test_report_date_mismatch_is_rejected(self) -> None:
        intelligence = self.intelligence()
        intelligence["report_date"] = "2026-07-23"
        with self.assertRaises(ValueError):
            build_research_execution_pack(
                self.task_plan(),
                intelligence,
            )


if __name__ == "__main__":
    unittest.main()
