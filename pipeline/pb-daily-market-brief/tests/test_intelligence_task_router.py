import unittest

from route_intelligence_tasks import (
    SCHEMA_VERSION,
    build_research_task_plan,
    validate_research_task_plan,
)


class IntelligenceTaskRouterTests(unittest.TestCase):
    def packet(self) -> dict:
        return {
            "schema_version": "daily_market_intelligence.v2",
            "report_date": "2026-07-24",
            "market": {
                "regime": {"label": "mixed"},
                "korea_transmission_inputs": {"status": "available"},
            },
            "events": {
                "items": [
                    {
                        "event_id": "earnings-nvda",
                        "event_type": "earnings_guidance",
                        "title": "NVIDIA raises guidance",
                        "entities": ["NVDA"],
                        "listed_entities": ["NVDA"],
                        "topic_tags": ["earnings"],
                        "verification": {
                            "primary_fact_confirmed": True,
                        },
                    },
                    {
                        "event_id": "policy-one",
                        "event_type": "regulation_policy",
                        "title": "New policy",
                        "entities": [],
                        "verification": {
                            "primary_fact_confirmed": False,
                        },
                    },
                ]
            },
            "continuity": {
                "active_entries": [{"continuity_id": "event:nvda"}]
            },
        }

    def event_task(self, plan: dict, event_id: str) -> dict:
        return next(
            task
            for task in plan["tasks"]
            if task.get("event_id") == event_id
        )

    def test_verified_earnings_routes_to_deep_dive(self) -> None:
        plan = build_research_task_plan(
            self.packet(),
            generated_at="2026-07-24T08:00:00+09:00",
        )
        task = self.event_task(plan, "earnings-nvda")
        self.assertEqual(plan["schema_version"], SCHEMA_VERSION)
        self.assertEqual(task["lead_workflow"], "earnings-deep-dive")
        self.assertEqual(task["readiness"], "ready_for_research")
        self.assertEqual(
            task["existing_executor"],
            "build_company_earnings_deep_dive.py",
        )
        self.assertFalse(task["automatic_execution_allowed"])

    def test_unverified_event_requires_evidence(self) -> None:
        plan = build_research_task_plan(self.packet())
        task = self.event_task(plan, "policy-one")
        self.assertEqual(task["lead_workflow"], "economic-impact-report")
        self.assertEqual(task["readiness"], "needs_evidence")
        self.assertIn("primary_fact_not_confirmed", task["reason_codes"])

    def test_verified_company_event_requires_entity_mapping(self) -> None:
        packet = self.packet()
        packet["events"]["items"][0]["listed_entities"] = []
        plan = build_research_task_plan(packet)
        task = self.event_task(plan, "earnings-nvda")
        self.assertEqual(task["readiness"], "needs_entity_mapping")

    def test_other_event_routes_to_idea_generation(self) -> None:
        packet = self.packet()
        packet["events"]["items"] = [
            {
                "event_id": "other-one",
                "event_type": "other",
                "title": "Emerging theme",
                "entities": [],
                "verification": {"primary_fact_confirmed": True},
            }
        ]
        plan = build_research_task_plan(packet)
        task = self.event_task(plan, "other-one")
        self.assertEqual(task["lead_workflow"], "idea-generation")
        self.assertEqual(task["readiness"], "ready_for_research")

    def test_task_ids_are_stable(self) -> None:
        first = build_research_task_plan(
            self.packet(),
            generated_at="2026-07-24T08:00:00+09:00",
        )
        second = build_research_task_plan(
            self.packet(),
            generated_at="2026-07-24T09:00:00+09:00",
        )
        self.assertEqual(
            [task["task_id"] for task in first["tasks"]],
            [task["task_id"] for task in second["tasks"]],
        )

    def test_validation_rejects_execution_authority(self) -> None:
        plan = build_research_task_plan(self.packet())
        plan["tasks"][0]["automatic_execution_allowed"] = True
        with self.assertRaises(ValueError):
            validate_research_task_plan(plan)

    def test_event_task_limit_is_enforced(self) -> None:
        packet = self.packet()
        packet["events"]["items"] = [
            {
                "event_id": f"event-{index}",
                "event_type": "other",
                "verification": {"primary_fact_confirmed": True},
            }
            for index in range(9)
        ]
        with self.assertRaises(ValueError):
            build_research_task_plan(packet, max_event_tasks=9)


if __name__ == "__main__":
    unittest.main()
