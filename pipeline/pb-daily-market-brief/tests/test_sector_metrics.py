from __future__ import annotations

import unittest
from datetime import date

from collect_sector_metrics import (
    build_metric_observation,
    collect_sector_metrics,
    load_metric_registry,
    monthly_momentum_score,
)


class SectorMetricTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.registry = load_metric_registry()

    def test_registry_contains_verified_first_five_series(self) -> None:
        series = {item["series_id"] for item in self.registry["metrics"]}
        self.assertEqual(series, {"IPG3344S", "IPG3353S", "IPN221113S", "IPG3364S", "IPG3366S"})
        self.assertTrue(all(item["dimension_id"] == "industry_leading_data" for item in self.registry["metrics"]))

    def test_momentum_score_is_directional_and_bounded(self) -> None:
        self.assertGreater(monthly_momentum_score(1, 3, 10), 50)
        self.assertLess(monthly_momentum_score(-1, -3, -10), 50)
        self.assertEqual(monthly_momentum_score(100, 100, 100), 100)
        self.assertEqual(monthly_momentum_score(-100, -100, -100), 0)

    def test_observation_excludes_future_dates_and_flags_stale(self) -> None:
        metric = self.registry["metrics"][0]
        values = [
            (date(2025, 6, 1), 90.0),
            (date(2026, 5, 1), 100.0),
            (date(2026, 6, 1), 110.0),
            (date(2026, 8, 1), 999.0),
        ]
        result = build_metric_observation(metric, date(2026, 7, 20), values)
        self.assertEqual(result["observation_date"], "2026-06-01")
        self.assertEqual(result["latest_value"], 110.0)
        self.assertEqual(result["status"], "available")

        stale = build_metric_observation(metric, date(2027, 1, 20), values[:-1])
        self.assertEqual(stale["status"], "stale")
        self.assertIsNone(stale["score"])

    def test_collection_is_testable_without_network(self) -> None:
        def fake_fetcher(series_id: str, api_key: str, start: str):
            self.assertEqual(api_key, "test-key")
            return [
                (date(2025, month, 1), 90.0 + month) for month in range(1, 13)
            ] + [
                (date(2026, month, 1), 102.0 + month) for month in range(1, 7)
            ]

        payload = collect_sector_metrics("2026-07-20", "test-key", self.registry, fake_fetcher)
        self.assertEqual(payload["collection_status"], "complete")
        self.assertEqual(payload["metric_count"], 5)
        self.assertEqual(payload["available_metric_count"], 5)
        self.assertTrue(all(item["source_grade"] == "A" for item in payload["metrics"]))

    def test_missing_api_key_is_nonfatal_and_never_fabricates_data(self) -> None:
        payload = collect_sector_metrics("2026-07-20", "", self.registry)
        self.assertEqual(payload["collection_status"], "missing_fred_api_key")
        self.assertEqual(payload["metric_count"], 0)
        self.assertEqual(payload["available_metric_count"], 0)


if __name__ == "__main__":
    unittest.main()
