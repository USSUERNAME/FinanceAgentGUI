from __future__ import annotations

import os
import unittest
from unittest.mock import patch

from run_daily_report import alpha_vantage_daily_plan


class AlphaVantageBudgetPlanTests(unittest.TestCase):
    def test_default_free_plan_allocates_exactly_twenty_five_requests(self) -> None:
        with patch.dict(os.environ, {}, clear=True):
            plan = alpha_vantage_daily_plan()
        self.assertTrue(plan["limited"])
        self.assertEqual(plan["etf_dashboard"], 10)
        self.assertEqual(plan["us_market_snapshot"], 7)
        self.assertEqual(plan["sector_fundamentals"], 8)
        self.assertEqual(plan["remaining_for_later_stages"], 0)

    def test_small_limit_reduces_lower_priority_sector_requests(self) -> None:
        with patch.dict(os.environ, {
            "ALPHAVANTAGE_DAILY_REQUEST_LIMIT": "20",
            "US_MARKET_DATA_REQUEST_BUDGET": "7",
            "SECTOR_FUNDAMENTAL_REQUEST_BUDGET": "8",
        }, clear=True):
            plan = alpha_vantage_daily_plan()
        self.assertEqual(plan["us_market_snapshot"], 7)
        self.assertEqual(plan["sector_fundamentals"], 3)
        self.assertEqual(plan["remaining_for_later_stages"], 0)

    def test_zero_limit_value_selects_unlimited_provider_profile(self) -> None:
        with patch.dict(os.environ, {
            "ALPHAVANTAGE_DAILY_REQUEST_LIMIT": "0",
            "US_MARKET_DATA_REQUEST_BUDGET": "12",
            "SECTOR_FUNDAMENTAL_REQUEST_BUDGET": "11",
        }, clear=True):
            plan = alpha_vantage_daily_plan()
        self.assertFalse(plan["limited"])
        self.assertEqual(plan["us_market_snapshot"], 12)
        self.assertEqual(plan["sector_fundamentals"], 11)
        self.assertEqual(plan["remaining_for_later_stages"], -1)

    def test_limit_below_fixed_dashboard_cost_is_rejected(self) -> None:
        with patch.dict(os.environ, {
            "ALPHAVANTAGE_DAILY_REQUEST_LIMIT": "9",
        }, clear=True):
            with self.assertRaises(ValueError):
                alpha_vantage_daily_plan()


if __name__ == "__main__":
    unittest.main()
