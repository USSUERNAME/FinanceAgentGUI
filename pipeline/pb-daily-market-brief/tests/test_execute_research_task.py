import subprocess
import unittest

from execute_research_task import (
    CONFIRMATION_PHRASE,
    build_execution_plan,
    execute_plan,
    list_executable_tasks,
)


class ResearchTaskExecutorTests(unittest.TestCase):
    def pack(
        self,
        *,
        workflow: str = "economic-impact-report",
        status: str = "prepared_for_specialist",
    ) -> dict:
        return {
            "schema_version": "research_execution_pack.v1",
            "report_date": "2026-07-24",
            "work_items": [
                {
                    "task_id": "event-policy-one",
                    "scope": "event",
                    "event_id": "policy-one",
                    "lead_workflow": workflow,
                    "execution_status": status,
                    "input_hash": "abc123",
                    "prepared_input": {
                        "listed_entities": ["NVDA"],
                    },
                    "decision_limits": {
                        "research_support_only": True,
                        "investment_recommendation": False,
                        "position_action": False,
                        "automatic_publication": False,
                    },
                }
            ],
            "policy": {
                "existing_outputs_only": True,
                "model_invocation_performed": False,
                "external_action_performed": False,
                "automatic_publication": False,
                "automatic_memory_mutation": False,
                "position_actions_allowed": False,
                "human_facing_hero_artifact": False,
            },
        }

    def plan(self, **overrides) -> dict:
        arguments = {
            "task_id": "event-policy-one",
            "expected_input_hash": "abc123",
            "requested_by": "operator",
            "execution_note": "Run verified policy impact analysis",
            "confirmation": CONFIRMATION_PHRASE,
        }
        arguments.update(overrides)
        return build_execution_plan(self.pack(), **arguments)

    def test_lists_only_allowlisted_executable_tasks(self) -> None:
        self.assertEqual(
            list_executable_tasks(self.pack())[0]["task_id"],
            "event-policy-one",
        )
        self.assertEqual(
            list_executable_tasks(
                self.pack(status="existing_output_attached")
            ),
            [],
        )
        self.assertEqual(
            list_executable_tasks(self.pack(workflow="idea-generation")),
            [],
        )
        self.assertEqual(
            list_executable_tasks(
                self.pack(),
                prior_receipts=[
                    {
                        "schema_version": (
                            "research_task_execution_receipt.v1"
                        ),
                        "task_id": "event-policy-one",
                        "input_hash": "abc123",
                        "outcome": "completed",
                    }
                ],
            ),
            [],
        )

    def test_builds_only_fixed_allowlisted_commands(self) -> None:
        plan = self.plan()
        self.assertEqual(plan["lead_workflow"], "economic-impact-report")
        self.assertEqual(len(plan["commands"]), 4)
        self.assertTrue(
            plan["commands"][0]["argv"][1].endswith(
                "synthesize_event_impacts.py"
            )
        )
        self.assertEqual(
            plan["commands"][0]["argv"][-4:],
            ["--date", "2026-07-24", "--event-id", "policy-one"],
        )
        self.assertTrue(plan["model_invocation_possible"])
        self.assertFalse(plan["decision_limits"]["position_action"])

    def test_earnings_route_is_filtered_to_the_task_ticker(self) -> None:
        plan = build_execution_plan(
            self.pack(
                workflow="earnings-deep-dive",
                status="awaiting_matching_output",
            ),
            task_id="event-policy-one",
            expected_input_hash="abc123",
            requested_by="operator",
            execution_note="Run verified post-earnings review",
            confirmation=CONFIRMATION_PHRASE,
        )
        self.assertEqual(
            plan["commands"][0]["argv"][-4:],
            ["--date", "2026-07-24", "--ticker", "NVDA"],
        )

    def test_wrong_confirmation_is_rejected(self) -> None:
        with self.assertRaises(ValueError):
            self.plan(confirmation="yes")

    def test_wrong_hash_is_rejected(self) -> None:
        with self.assertRaises(ValueError):
            self.plan(expected_input_hash="stale")

    def test_attached_output_cannot_be_executed(self) -> None:
        with self.assertRaises(ValueError):
            build_execution_plan(
                self.pack(status="existing_output_attached"),
                task_id="event-policy-one",
                expected_input_hash="abc123",
                requested_by="operator",
                execution_note="rerun",
                confirmation=CONFIRMATION_PHRASE,
            )

    def test_unimplemented_workflow_is_rejected(self) -> None:
        with self.assertRaises(ValueError):
            build_execution_plan(
                self.pack(workflow="idea-generation"),
                task_id="event-policy-one",
                expected_input_hash="abc123",
                requested_by="operator",
                execution_note="run screen",
                confirmation=CONFIRMATION_PHRASE,
            )

    def test_duplicate_successful_execution_is_rejected(self) -> None:
        prior = [
            {
                "schema_version": "research_task_execution_receipt.v1",
                "task_id": "event-policy-one",
                "input_hash": "abc123",
                "outcome": "completed",
            }
        ]
        with self.assertRaises(ValueError):
            self.plan(prior_receipts=prior)

    def test_dry_run_never_invokes_runner(self) -> None:
        plan = self.plan(
            requested_by="",
            execution_note="",
            confirmation="",
            dry_run=True,
        )

        def forbidden_runner(*args, **kwargs):
            raise AssertionError("runner must not be invoked in dry run")

        receipt = execute_plan(plan, runner=forbidden_runner)
        self.assertEqual(receipt["outcome"], "validated_only")
        self.assertEqual(receipt["command_results"], [])
        self.assertFalse(receipt["position_action_approved"])

    def test_actual_execution_runs_one_specialist_then_three_refreshes(self) -> None:
        calls = []

        def fake_runner(argv, **kwargs):
            calls.append((argv, kwargs))
            return subprocess.CompletedProcess(
                argv,
                0,
                stdout="ok",
                stderr="",
            )

        receipt = execute_plan(
            self.plan(),
            runner=fake_runner,
            executed_at="2026-07-24T09:00:00+09:00",
        )
        self.assertEqual(receipt["outcome"], "completed")
        self.assertEqual(len(calls), 4)
        self.assertEqual(
            [call[1]["shell"] for call in calls],
            [False, False, False, False],
        )
        self.assertTrue(
            calls[0][0][1].endswith("synthesize_event_impacts.py")
        )
        self.assertTrue(
            calls[-1][0][1].endswith("build_research_execution_pack.py")
        )
        self.assertFalse(receipt["automatic_publication"])
        self.assertFalse(receipt["automatic_memory_mutation"])

    def test_runner_failure_propagates_without_success_receipt(self) -> None:
        def failed_runner(argv, **kwargs):
            raise subprocess.CalledProcessError(1, argv)

        with self.assertRaises(subprocess.CalledProcessError):
            execute_plan(self.plan(), runner=failed_runner)

    def test_duplicate_task_ids_are_rejected_by_pack_validation(self) -> None:
        pack = self.pack()
        pack["work_items"].append(dict(pack["work_items"][0]))
        with self.assertRaises(ValueError):
            build_execution_plan(
                pack,
                task_id="event-policy-one",
                expected_input_hash="abc123",
                requested_by="operator",
                execution_note="run",
                confirmation=CONFIRMATION_PHRASE,
            )


if __name__ == "__main__":
    unittest.main()
