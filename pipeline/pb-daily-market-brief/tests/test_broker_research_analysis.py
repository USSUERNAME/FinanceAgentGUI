import json
import tempfile
import unittest
from pathlib import Path

from analyze_broker_research import (
    SCHEMA_VERSION,
    reusable_complete_artifact,
)


class BrokerResearchAnalysisTests(unittest.TestCase):
    def artifact(self) -> dict:
        return {
            "schema_version": SCHEMA_VERSION,
            "report_date": "2026-07-25",
            "status": "complete",
            "analysis_identity": {"batch_key": "batch-one"},
            "reports": [
                {
                    "report_id": "report-1",
                    "analyst": "",
                    "report_type": "sector",
                    "stance": "positive",
                    "summary": "수요 전망이 개선됐다.",
                    "key_claims": ["수요 추정치가 상향됐다."],
                    "catalysts": ["다음 실적 발표"],
                    "risks": ["밸류에이션"],
                    "sectors": ["semiconductor"],
                    "tickers": ["NVDA"],
                    "rating": "",
                    "previous_rating": "",
                    "target_price": None,
                    "previous_target_price": None,
                    "currency": "",
                    "monitoring_conditions": ["후속 실적 확인"],
                }
            ],
        }

    def test_matching_complete_artifact_is_reusable(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "analysis.json"
            path.write_text(
                json.dumps(self.artifact()),
                encoding="utf-8",
            )
            result = reusable_complete_artifact(
                path,
                report_date="2026-07-25",
                report_ids=["report-1"],
            )
            self.assertIsNotNone(result)
            self.assertEqual(result["status"], "complete")

    def test_changed_report_set_is_not_reused(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "analysis.json"
            path.write_text(
                json.dumps(self.artifact()),
                encoding="utf-8",
            )
            result = reusable_complete_artifact(
                path,
                report_date="2026-07-25",
                report_ids=["report-2"],
            )
            self.assertIsNone(result)

    def test_changed_analysis_input_is_not_reused(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "analysis.json"
            path.write_text(
                json.dumps(self.artifact()),
                encoding="utf-8",
            )
            result = reusable_complete_artifact(
                path,
                report_date="2026-07-25",
                report_ids=["report-1"],
                batch_key="batch-two",
            )
            self.assertIsNone(result)

    def test_dry_run_artifact_is_not_reusable(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "analysis.json"
            payload = self.artifact()
            payload["status"] = "dry_run"
            path.write_text(json.dumps(payload), encoding="utf-8")
            result = reusable_complete_artifact(
                path,
                report_date="2026-07-25",
                report_ids=["report-1"],
            )
            self.assertIsNone(result)


if __name__ == "__main__":
    unittest.main()
