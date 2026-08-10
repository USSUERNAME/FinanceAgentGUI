from __future__ import annotations

import unittest
from datetime import date

from build_daily_snapshot import (
    fred_macro_indicator,
    parse_ism_manufacturing_indicator,
)


class MacroIndicatorTests(unittest.TestCase):
    def test_inflation_indicator_uses_yoy_rate_not_index_level(self) -> None:
        values = [
            (date(2025 + (month - 1) // 12, (month - 1) % 12 + 1, 1), 100 + month)
            for month in range(1, 15)
        ]
        indicator = fred_macro_indicator(
            "CPIAUCSL",
            "소비자물가 CPI",
            "inflation",
            "BLS",
            "unused",
            date(2026, 8, 10),
            values=values,
        )

        self.assertEqual(indicator["unit"], "% YoY")
        self.assertNotEqual(indicator["value"], values[-1][1])
        self.assertEqual(indicator["provider"], "BLS via FRED")
        self.assertTrue(indicator["primary_source_confirmed"])

    def test_ism_parser_keeps_only_headline_observation_and_direction(self) -> None:
        payload = """
        <h1>Manufacturing PMI® at 55.6%</h1>
        <h1>July 2026 ISM® Manufacturing PMI® Report</h1>
        <p>The Manufacturing PMI registered 55.6 percent in July,
        2.3 percentage points above the June figure.</p>
        """
        indicator = parse_ism_manufacturing_indicator(
            payload,
            "2026-08-10",
            "https://www.ismworld.org/example",
        )

        self.assertEqual(indicator["value"], 55.6)
        self.assertEqual(indicator["change"], 2.3)
        self.assertEqual(indicator["direction"], "accelerating")
        self.assertEqual(indicator["as_of"], "2026-07-01")
        self.assertEqual(indicator["provider"], "ISM")


if __name__ == "__main__":
    unittest.main()
