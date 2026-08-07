import tempfile
import unittest
from pathlib import Path

from run_research_inbox_analysis import (
    source_status_path,
    updated_inbox,
    validate_collection_status,
)


class ResearchInboxAnalysisRunnerTests(unittest.TestCase):
    def test_updated_inbox_selects_the_file_changed_by_collection(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            date_dir = root / "workspace" / "normalized" / "2026-08-06"
            date_dir.mkdir(parents=True)
            old = date_dir / "inbox_100000.json"
            old.write_text("[]", encoding="utf-8")
            before = {old: old.stat().st_mtime_ns}
            new = date_dir / "inbox_100001.json"
            new.write_text("[]", encoding="utf-8")

            self.assertEqual(updated_inbox(before, root), new)

    def test_collection_status_requires_both_research_sources(self):
        payload = {
            "sources": [
                {"source_id": "gmail_research", "status": "ok", "item_count": 6},
                {
                    "source_id": "google_drive_research_inbox",
                    "status": "partial",
                    "item_count": 48,
                },
            ]
        }
        self.assertEqual(
            validate_collection_status(payload),
            {"gmail_research": 6, "google_drive_research_inbox": 48},
        )

    def test_collection_failure_preserves_existing_analysis(self):
        payload = {
            "sources": [
                {"source_id": "gmail_research", "status": "timeout", "item_count": 0},
                {
                    "source_id": "google_drive_research_inbox",
                    "status": "ok",
                    "item_count": 48,
                },
            ]
        }
        with self.assertRaisesRegex(RuntimeError, "existing analysis was preserved"):
            validate_collection_status(payload)

    def test_status_file_matches_the_collected_inbox_timestamp(self):
        root = Path("C:/repo/engine")
        inbox = root / "workspace" / "normalized" / "2026-08-06" / "inbox_123456.json"
        self.assertEqual(
            source_status_path(inbox, root),
            root
            / "workspace"
            / "source_status"
            / "2026-08-06"
            / "source_status_123456.json",
        )


if __name__ == "__main__":
    unittest.main()
