import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from PIL import Image

import generate_etf_chart


class GenerateEtfChartCacheTests(unittest.TestCase):
    def test_provider_failure_reuses_recent_complete_cache(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            charts = root / "workspace" / "charts"
            metrics_dir = root / "workspace" / "market_data" / "2026-07-24"
            charts.mkdir(parents=True)
            metrics_dir.mkdir(parents=True)
            items = [
                {"ticker": f"T{index}", "name": f"ETF {index}"}
                for index in range(10)
            ]
            payload = {
                "report_date": "2026-07-24",
                "source_grade": "B",
                "evidence_label": "fact_provider_standardized",
                "items": [
                    {
                        "ticker": item["ticker"],
                        "name": item["name"],
                        "as_of": "2026-07-23",
                        "close": 100 + index,
                        "source": "Alpha Vantage TIME_SERIES_DAILY close",
                        "market_cutoff": "previous_available_close",
                    }
                    for index, item in enumerate(items)
                ],
            }
            (metrics_dir / "etf_metrics.json").write_text(
                json.dumps(payload),
                encoding="utf-8",
            )
            for suffix in ("etf_dashboard.png", "etf_relative_strength.png"):
                Image.new("RGB", (4, 4), "white").save(
                    charts / f"2026-07-24_{suffix}"
                )

            with patch.object(generate_etf_chart, "ROOT", root):
                dashboard, heatmap, metrics = (
                    generate_etf_chart.reuse_latest_cached_outputs(
                        "2026-07-25",
                        items,
                        reason="SPY: provider rate limit",
                    )
                )

            self.assertTrue(dashboard.exists())
            self.assertTrue(heatmap.exists())
            result = json.loads(metrics.read_text(encoding="utf-8"))
            self.assertEqual(result["report_date"], "2026-07-25")
            self.assertEqual(
                result["cache_status"]["source_report_date"],
                "2026-07-24",
            )
            self.assertEqual(result["cache_status"]["age_calendar_days"], 1)
            self.assertEqual(
                result["items"][0]["market_cutoff"],
                "cached_previous_available_close",
            )
            self.assertNotIn("apikey", json.dumps(result))

    def test_stale_cache_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            metrics_dir = root / "workspace" / "market_data" / "2026-07-20"
            metrics_dir.mkdir(parents=True)
            (metrics_dir / "etf_metrics.json").write_text(
                json.dumps({"items": []}),
                encoding="utf-8",
            )
            with (
                patch.object(generate_etf_chart, "ROOT", root),
                self.assertRaises(RuntimeError),
            ):
                generate_etf_chart.reuse_latest_cached_outputs(
                    "2026-07-25",
                    [{"ticker": "SPY", "name": "S&P 500"}],
                    reason="provider rate limit",
                )

    def test_same_day_cache_reuse_does_not_copy_file_onto_itself(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            charts = root / "workspace" / "charts"
            metrics_dir = root / "workspace" / "market_data" / "2026-07-25"
            charts.mkdir(parents=True)
            metrics_dir.mkdir(parents=True)
            items = [
                {"ticker": f"T{index}", "name": f"ETF {index}"}
                for index in range(10)
            ]
            payload = {
                "report_date": "2026-07-25",
                "items": [
                    {
                        "ticker": item["ticker"],
                        "name": item["name"],
                        "as_of": "2026-07-24",
                        "close": 100 + index,
                        "source": "Alpha Vantage TIME_SERIES_DAILY close",
                    }
                    for index, item in enumerate(items)
                ],
            }
            metrics_path = metrics_dir / "etf_metrics.json"
            metrics_path.write_text(json.dumps(payload), encoding="utf-8")
            for suffix in ("etf_dashboard.png", "etf_relative_strength.png"):
                Image.new("RGB", (4, 4), "white").save(
                    charts / f"2026-07-25_{suffix}"
                )

            with patch.object(generate_etf_chart, "ROOT", root):
                dashboard, heatmap, metrics = (
                    generate_etf_chart.reuse_latest_cached_outputs(
                        "2026-07-25",
                        items,
                        reason="SPY: provider rate limit",
                    )
                )

            self.assertTrue(dashboard.exists())
            self.assertTrue(heatmap.exists())
            result = json.loads(metrics.read_text(encoding="utf-8"))
            self.assertEqual(result["cache_status"]["age_calendar_days"], 0)
            self.assertEqual(
                result["cache_status"]["source_report_date"],
                "2026-07-25",
            )


if __name__ == "__main__":
    unittest.main()
