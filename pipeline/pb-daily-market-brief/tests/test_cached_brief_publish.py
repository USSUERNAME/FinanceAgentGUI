from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from publish_cached_brief import available_report_dates, cached_publish_command


class CachedBriefPublishTests(unittest.TestCase):
    def build_bundle(self, root: Path, report_date: str = "2026-07-23") -> None:
        briefs = root / "workspace" / "briefs"
        charts = root / "workspace" / "charts"
        briefs.mkdir(parents=True, exist_ok=True)
        charts.mkdir(parents=True, exist_ok=True)
        (briefs / f"{report_date}_리포트.md").write_text(
            "# report\n\n<!-- REPORT_COMPLETE -->\n",
            encoding="utf-8",
        )
        for suffix in (
            "market_pulse.png",
            "macro_dashboard.png",
            "etf_dashboard_labeled.png",
            "etf_relative_strength.png",
            "international_news_01.png",
        ):
            (charts / f"{report_date}_{suffix}").write_bytes(b"png")
        (charts / f"{report_date}_international_news_manifest.json").write_text(
            json.dumps({
                "images": [
                    f"workspace/charts/{report_date}_international_news_01.png"
                ]
            }),
            encoding="utf-8",
        )

    def test_cached_bundle_builds_publish_command_without_collection(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.build_bundle(root)
            command = cached_publish_command("2026-07-23", root=root)
        self.assertIn("publish_visual_brief.py", command)
        self.assertNotIn("run_daily_report.py", command)
        self.assertNotIn("--dry-run", command)

    def test_dry_run_flag_is_forwarded(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.build_bundle(root)
            command = cached_publish_command("2026-07-23", root=root, dry_run=True)
        self.assertEqual(command[-1], "--dry-run")

    def test_incomplete_cached_bundle_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "workspace" / "briefs").mkdir(parents=True)
            with self.assertRaises(FileNotFoundError):
                cached_publish_command("2026-07-23", root=root)

    def test_latest_cached_report_date_is_discovered(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.build_bundle(root, "2026-07-22")
            self.build_bundle(root, "2026-07-23")
            self.assertEqual(
                available_report_dates(root),
                ["2026-07-22", "2026-07-23"],
            )


if __name__ == "__main__":
    unittest.main()
