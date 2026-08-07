from __future__ import annotations

import time
import unittest

from collect_all import (
    completed_source_status,
    configured_timeout_seconds,
    run_adapter_isolated,
)


def successful_adapter(_config: dict) -> tuple[list[dict], str | None]:
    return [{"id": "row-1"}], None


def slow_adapter(_config: dict) -> tuple[list[dict], str | None]:
    time.sleep(5)
    return [{"id": "too-late"}], None


def failing_adapter(_config: dict) -> tuple[list[dict], str | None]:
    raise RuntimeError("provider unavailable")


class CollectorTimeoutConfigurationTests(unittest.TestCase):
    def test_expected_policy_filter_is_not_a_partial_failure(self) -> None:
        status, category = completed_source_status(
            [{"id": "accepted"}],
            "2 Gmail message(s) rejected by label or sender gate",
        )
        self.assertEqual(status, "ok_with_filtered")
        self.assertEqual(category, "policy_filtered")

    def test_incremental_drive_skip_is_a_healthy_source_state(self) -> None:
        status, category = completed_source_status(
            [],
            "18 unchanged Drive report(s) skipped by incremental cache",
        )
        self.assertEqual(status, "ok_with_filtered")
        self.assertEqual(category, "incremental_unchanged")

    def test_action_required_notice_remains_partial(self) -> None:
        status, category = completed_source_status(
            [{"id": "accepted"}],
            "1 PDF attachment(s) require explicit analysis approval",
        )
        self.assertEqual(status, "partial")
        self.assertEqual(category, "configuration_or_provider_notice")

    def test_cli_override_has_priority(self) -> None:
        self.assertEqual(
            configured_timeout_seconds(
                "fred",
                {"collector_timeouts": {"default": 50, "fred": 40}},
                3.5,
            ),
            3.5,
        )

    def test_source_config_overrides_default(self) -> None:
        self.assertEqual(
            configured_timeout_seconds(
                "fred",
                {"collector_timeouts": {"default": 50, "fred": 12}},
            ),
            12.0,
        )

    def test_non_positive_timeout_is_rejected(self) -> None:
        with self.assertRaisesRegex(ValueError, "must be positive"):
            configured_timeout_seconds("fred", {}, 0)


class CollectorProcessIsolationTests(unittest.TestCase):
    def test_successful_collector_returns_rows(self) -> None:
        result = run_adapter_isolated(
            "success",
            successful_adapter,
            {},
            5,
        )
        self.assertEqual(result["execution_status"], "completed")
        self.assertEqual(result["rows"], [{"id": "row-1"}])
        self.assertLess(result["elapsed_seconds"], 5)

    def test_exception_is_returned_without_raising_in_parent(self) -> None:
        result = run_adapter_isolated(
            "failure",
            failing_adapter,
            {},
            5,
        )
        self.assertEqual(result["execution_status"], "error")
        self.assertEqual(result["error_type"], "RuntimeError")
        self.assertEqual(result["rows"], [])

    def test_slow_collector_is_terminated_at_deadline(self) -> None:
        started = time.monotonic()
        result = run_adapter_isolated(
            "slow",
            slow_adapter,
            {},
            0.25,
        )
        elapsed = time.monotonic() - started
        self.assertEqual(result["execution_status"], "timeout")
        self.assertEqual(result["error_type"], "CollectorTimeout")
        self.assertEqual(result["rows"], [])
        self.assertLess(elapsed, 3)


if __name__ == "__main__":
    unittest.main()
