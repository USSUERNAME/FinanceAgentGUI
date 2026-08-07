from __future__ import annotations

import copy
import unittest

from collect_sector_drivers import (
    build_driver_observations,
    load_driver_registry,
    validate_driver_registry,
)
from sector_master import load_sector_master


class SectorDriverTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.registry = load_driver_registry()
        cls.master = load_sector_master()

    def test_registry_is_primary_dated_and_dimension_exclusive(self) -> None:
        validate_driver_registry(self.registry, self.master)
        records = self.registry["records"]
        self.assertEqual(len({item["evidence_id"] for item in records}), len(records))
        self.assertTrue(all(item["source_grade"] == "A" for item in records))
        self.assertTrue(all(item["primary_source_confirmed"] is True for item in records))
        self.assertTrue(all(item["invalidation_condition"] for item in records))

    def test_evidence_id_reuse_is_rejected_even_with_another_dimension(self) -> None:
        registry = copy.deepcopy(self.registry)
        duplicate = copy.deepcopy(registry["records"][0])
        duplicate["dimension_id"] = "structural_driver"
        registry["records"].append(duplicate)
        with self.assertRaisesRegex(ValueError, "Evidence reuse"):
            validate_driver_registry(registry, self.master)

    def test_expired_records_do_not_score(self) -> None:
        registry = copy.deepcopy(self.registry)
        record = registry["records"][0]
        record["horizon_end"] = "2026-01-01"
        payload = build_driver_observations("2026-07-20", registry, self.master)
        excluded = next(item for item in payload["excluded_observations"] if item["evidence_id"] == record["evidence_id"])
        self.assertIn("evidence_horizon_expired", excluded["exclusion_reasons"])

    def test_independent_primary_sources_unlock_only_supported_dimensions(self) -> None:
        payload = build_driver_observations("2026-07-20", self.registry, self.master)
        dimensions = {
            (item["sector_id"], item["dimension_id"]): item
            for item in payload["dimension_scores"]
        }
        grid = dimensions[("grid_electrification", "structural_driver")]
        self.assertEqual(grid["status"], "available")
        self.assertGreaterEqual(grid["independent_source_count"], 2)
        self.assertIsNotNone(grid["score"])

        semis = dimensions[("semiconductors_ai_compute", "structural_driver")]
        self.assertEqual(semis["status"], "insufficient_independent_primary_sources")
        self.assertIsNone(semis["score"])

        semis_catalyst = dimensions[("semiconductors_ai_compute", "catalyst_durability")]
        self.assertEqual(semis_catalyst["status"], "available")
        self.assertIsNotNone(semis_catalyst["score"])


if __name__ == "__main__":
    unittest.main()
