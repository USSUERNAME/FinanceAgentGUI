from __future__ import annotations

import contextlib
import io
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import publish_visual_brief


class PublishVisualBriefDryRunTests(unittest.TestCase):
    def test_dry_run_validates_inputs_without_notion_credentials_or_http(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            brief = root / "brief.md"
            brief.write_text("# 2026-11-08 리포트\n\n## 오늘의 결론\n\n검증용 본문\n", encoding="utf-8")
            images = []
            for name in ("pulse.png", "macro.png", "etf.png", "heatmap.png"):
                path = root / name
                path.write_bytes(b"not-an-image-but-present")
                images.append(path)
            argv = [
                "publish_visual_brief.py", str(brief), "--pulse-image", str(images[0]),
                "--macro-image", str(images[1]), "--etf-image", str(images[2]),
                "--etf-heatmap-image", str(images[3]), "--dry-run",
            ]
            output = io.StringIO()
            with patch.object(sys, "argv", argv), patch("publish_visual_brief.load_dotenv"), patch("publish_visual_brief.api_json", side_effect=AssertionError("Notion must not be called")):
                with contextlib.redirect_stdout(output):
                    publish_visual_brief.main()
            self.assertIn("Dry run validated", output.getvalue())


if __name__ == "__main__":
    unittest.main()
