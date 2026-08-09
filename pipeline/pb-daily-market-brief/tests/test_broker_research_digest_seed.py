from __future__ import annotations

import base64
import gzip
import json
import tempfile
import unittest
from pathlib import Path

from restore_broker_research_digest_seed import restore_seed


def encoded_seed(*, include_raw_text: bool = False) -> str:
    report = {
        "report_id": "drive-report",
        "rights": {
            "publication_policy": "summary_and_link_only",
            "redistribution_allowed": False,
            "full_text_included": False,
        },
    }
    if include_raw_text:
        report["raw_text"] = "must not be restored"
    payload = {
        "schema_version": "broker_research_digest_seed.v1",
        "digests": [{
            "schema_version": "broker_research_digest.v1",
            "report_date": "2026-08-07",
            "reports": [report],
        }],
    }
    return base64.b64encode(
        gzip.compress(json.dumps(payload).encode("utf-8"))
    ).decode("ascii")


class BrokerResearchDigestSeedTests(unittest.TestCase):
    def test_restores_rights_safe_digest_without_overwriting_existing_file(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            workspace = Path(directory)
            restored = restore_seed(encoded_seed(), workspace_root=workspace)
            second = restore_seed(encoded_seed(), workspace_root=workspace)
            output = (
                workspace / "broker_research_digest" / "2026-08-07" /
                "broker_research_digest.json"
            )
            payload = json.loads(output.read_text(encoding="utf-8"))
        self.assertEqual(restored, 1)
        self.assertEqual(second, 0)
        self.assertEqual(payload["reports"][0]["report_id"], "drive-report")

    def test_rejects_seed_containing_source_text(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaisesRegex(ValueError, "non-rights-safe"):
                restore_seed(
                    encoded_seed(include_raw_text=True),
                    workspace_root=Path(directory),
                )


if __name__ == "__main__":
    unittest.main()
