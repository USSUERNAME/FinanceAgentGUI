from __future__ import annotations

import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from collectors import common


class DotenvLoadingTests(unittest.TestCase):
    def test_pipeline_env_has_priority_and_repository_env_fills_missing_values(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            repo_root = Path(temp_dir)
            pipeline_root = repo_root / "pipeline" / "pb-daily-market-brief"
            pipeline_root.mkdir(parents=True)
            (repo_root / ".env").write_text(
                "ROOT_ONLY=root-value\nSHARED_SETTING=root-value\n",
                encoding="utf-8",
            )
            (pipeline_root / ".env").write_text(
                "PIPELINE_ONLY=pipeline-value\nSHARED_SETTING=pipeline-value\n",
                encoding="utf-8",
            )

            with patch.object(common, "ROOT", pipeline_root), patch.dict(
                os.environ,
                {},
                clear=True,
            ):
                common.load_dotenv()
                self.assertEqual(os.environ["ROOT_ONLY"], "root-value")
                self.assertEqual(os.environ["PIPELINE_ONLY"], "pipeline-value")
                self.assertEqual(os.environ["SHARED_SETTING"], "pipeline-value")


if __name__ == "__main__":
    unittest.main()
