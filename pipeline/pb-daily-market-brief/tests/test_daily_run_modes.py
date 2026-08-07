from __future__ import annotations

import unittest
from unittest.mock import call, patch

from run_daily_report import collect_market_membership_inputs, run_mode_policy


class DailyRunModePolicyTests(unittest.TestCase):
    def test_market_membership_proxies_refresh_in_every_run_mode(self) -> None:
        with patch("run_daily_report.run") as runner:
            collect_market_membership_inputs("2026-07-29")

        self.assertEqual(
            runner.call_args_list,
            [
                call(
                    "collect_spy_holdings_membership.py",
                    "--date",
                    "2026-07-29",
                ),
                call(
                    "collect_sector_spdr_holdings.py",
                    "--date",
                    "2026-07-29",
                ),
            ],
        )

    def test_offline_dry_run_disables_evidence_network_and_analysis(self) -> None:
        policy = run_mode_policy(dry_run=True)
        self.assertEqual(policy["name"], "dry_run")
        self.assertTrue(policy["blocks_publication"])
        self.assertTrue(policy["blocks_alert_delivery"])
        self.assertFalse(policy["allows_official_evidence_network"])
        self.assertFalse(policy["runs_structured_event_analysis"])

    def test_verification_dry_run_runs_research_but_blocks_outputs(self) -> None:
        policy = run_mode_policy(verification_dry_run=True)
        self.assertEqual(policy["name"], "verification_dry_run")
        self.assertTrue(policy["blocks_publication"])
        self.assertTrue(policy["blocks_alert_delivery"])
        self.assertTrue(policy["allows_official_evidence_network"])
        self.assertTrue(policy["runs_structured_event_analysis"])

    def test_publish_runs_research_and_allows_outputs(self) -> None:
        policy = run_mode_policy()
        self.assertEqual(policy["name"], "publish")
        self.assertFalse(policy["blocks_publication"])
        self.assertFalse(policy["blocks_alert_delivery"])
        self.assertTrue(policy["allows_official_evidence_network"])
        self.assertTrue(policy["runs_structured_event_analysis"])

    def test_modes_are_mutually_exclusive_at_policy_boundary(self) -> None:
        with self.assertRaisesRegex(ValueError, "mutually exclusive"):
            run_mode_policy(dry_run=True, verification_dry_run=True)


if __name__ == "__main__":
    unittest.main()
