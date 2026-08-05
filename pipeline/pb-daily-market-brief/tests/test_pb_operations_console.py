import json
import tempfile
import unittest
from pathlib import Path

from pb_operations_console import (
    INDEX_HTML,
    load_daily_intelligence,
    load_manifest,
    load_research_execution_pack,
    load_research_execution_status,
    manifest_dates,
    safe_report_path,
)


class PBOperationsConsoleTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.date = "2026-07-24"
        manifest = (
            self.root
            / "workspace"
            / "operations_manifest"
            / self.date
            / "operations_manifest.json"
        )
        manifest.parent.mkdir(parents=True)
        manifest.write_text(
            json.dumps({
                "schema_version": "pb_operations_manifest.v1",
                "report_date": self.date,
                "run": {"status": "ready"},
            }),
            encoding="utf-8",
        )
        brief = self.root / "workspace" / "briefs" / f"{self.date}_리포트.md"
        brief.parent.mkdir(parents=True)
        brief.write_text("# reader brief", encoding="utf-8")
        v2_reader = (
            self.root
            / "workspace"
            / "v2_reader_reports"
            / self.date
            / "reader_report.md"
        )
        v2_reader.parent.mkdir(parents=True)
        v2_reader.write_text("# V2 reader", encoding="utf-8")
        intelligence = (
            self.root
            / "workspace"
            / "intelligence"
            / self.date
            / "daily_intelligence.json"
        )
        intelligence.parent.mkdir(parents=True)
        intelligence.write_text(
            json.dumps(
                {
                    "schema_version": "daily_market_intelligence.v2",
                    "report_date": self.date,
                    "events": {"items": []},
                }
            ),
            encoding="utf-8",
        )
        research_pack = intelligence.parent / "research_execution_pack.json"
        research_pack.write_text(
            json.dumps(
                {
                    "schema_version": "research_execution_pack.v1",
                    "report_date": self.date,
                    "summary": {
                        "planned_task_count": 2,
                        "eligible_task_count": 1,
                        "work_item_count": 1,
                        "blocked_task_count": 1,
                    },
                    "work_items": [],
                    "blocked_tasks": [],
                }
            ),
            encoding="utf-8",
        )

    def tearDown(self) -> None:
        self.temp.cleanup()

    def test_latest_manifest_dates_and_schema_are_loaded(self) -> None:
        self.assertEqual(manifest_dates(self.root), [self.date])
        self.assertEqual(load_manifest(self.date, self.root)["run"]["status"], "ready")
        self.assertEqual(
            load_daily_intelligence(self.date, self.root)["report_date"],
            self.date,
        )
        self.assertEqual(
            load_research_execution_pack(self.date, self.root)["report_date"],
            self.date,
        )

    def test_report_access_is_limited_to_report_roots(self) -> None:
        relative = f"workspace/briefs/{self.date}_리포트.md"
        self.assertEqual(safe_report_path(relative, self.root).name, f"{self.date}_리포트.md")
        intelligence = (
            self.root
            / "workspace"
            / "intelligence"
            / self.date
            / "daily_intelligence.json"
        )
        self.assertEqual(
            safe_report_path(
                (
                    f"workspace/intelligence/{self.date}/"
                    "daily_intelligence.json"
                ),
                self.root,
            ),
            intelligence,
        )
        v2_reader = (
            self.root
            / "workspace"
            / "v2_reader_reports"
            / self.date
            / "reader_report.md"
        )
        self.assertEqual(
            safe_report_path(
                (
                    f"workspace/v2_reader_reports/{self.date}/"
                    "reader_report.md"
                ),
                self.root,
            ),
            v2_reader,
        )
        analysis = (
            self.root
            / "workspace"
            / "analysis"
            / self.date
            / "event_impact_synthesis.json"
        )
        analysis.parent.mkdir(parents=True)
        analysis.write_text("{}", encoding="utf-8")
        self.assertEqual(
            safe_report_path(
                (
                    f"workspace/analysis/{self.date}/"
                    "event_impact_synthesis.json"
                ),
                self.root,
            ),
            analysis,
        )
        secret = self.root / "workspace" / "local_secrets" / "token.txt"
        secret.parent.mkdir(parents=True)
        secret.write_text("secret", encoding="utf-8")
        with self.assertRaises(PermissionError):
            safe_report_path("workspace/local_secrets/token.txt", self.root)
        with self.assertRaises(PermissionError):
            safe_report_path("workspace/briefs/../../local_secrets/token.txt", self.root)

    def test_absolute_paths_and_unsupported_formats_are_blocked(self) -> None:
        with self.assertRaises(ValueError):
            safe_report_path(str(self.root / "workspace" / "briefs"), self.root)
        image = self.root / "workspace" / "briefs" / "chart.png"
        image.write_bytes(b"png")
        with self.assertRaises(PermissionError):
            safe_report_path("workspace/briefs/chart.png", self.root)

    def test_console_has_no_mutating_action_controls(self) -> None:
        self.assertIn("읽기 전용 콘솔", INDEX_HTML)
        self.assertIn("사건 인텔리전스", INDEX_HTML)
        self.assertIn("/api/intelligence", INDEX_HTML)
        self.assertIn("/api/research-pack", INDEX_HTML)
        self.assertIn("/api/research-executions", INDEX_HTML)
        self.assertIn("Research Workflow", INDEX_HTML)
        self.assertIn("Approved Execution", INDEX_HTML)
        self.assertIn("증권사 리서치 분석 캐시", INDEX_HTML)
        self.assertIn("cache_hit_count", INDEX_HTML)
        self.assertIn("이번 실행 토큰", INDEX_HTML)
        self.assertIn("source_text_cached", INDEX_HTML)
        self.assertIn(".cache-metrics", INDEX_HTML)
        self.assertIn("승인형 전문 분석 실행 추적", INDEX_HTML)
        self.assertIn("리서치 작업 상태", INDEX_HTML)
        self.assertIn("공식 원문 사실 추출 미완료", INDEX_HTML)
        self.assertNotIn("/api/publish", INDEX_HTML)
        self.assertNotIn("/api/rerun", INDEX_HTML)

    def test_execution_status_suppresses_completed_input_and_sanitizes_receipt(
        self,
    ) -> None:
        intelligence_dir = (
            self.root
            / "workspace"
            / "intelligence"
            / self.date
        )
        pack_path = intelligence_dir / "research_execution_pack.json"
        pack_path.write_text(
            json.dumps(
                {
                    "schema_version": "research_execution_pack.v1",
                    "report_date": self.date,
                    "summary": {},
                    "work_items": [
                        {
                            "task_id": "event-policy",
                            "scope": "event",
                            "event_id": "policy",
                            "lead_workflow": "economic-impact-report",
                            "execution_status": "prepared_for_specialist",
                            "input_hash": "hash-1",
                            "decision_limits": {
                                "research_support_only": True,
                                "investment_recommendation": False,
                                "position_action": False,
                                "automatic_publication": False,
                            },
                        }
                    ],
                    "blocked_tasks": [{"task_id": "blocked"}],
                    "policy": {
                        "model_invocation_performed": False,
                        "external_action_performed": False,
                        "automatic_publication": False,
                        "automatic_memory_mutation": False,
                        "position_actions_allowed": False,
                        "human_facing_hero_artifact": False,
                    },
                }
            ),
            encoding="utf-8",
        )
        output = (
            self.root
            / "workspace"
            / "analysis"
            / self.date
            / "event_impact_synthesis.json"
        )
        output.parent.mkdir(parents=True)
        output.write_text("{}", encoding="utf-8")
        receipt_dir = intelligence_dir / "execution_receipts"
        receipt_dir.mkdir()
        (receipt_dir / "completed.json").write_text(
            json.dumps(
                {
                    "schema_version": (
                        "research_task_execution_receipt.v1"
                    ),
                    "report_date": self.date,
                    "task_id": "event-policy",
                    "event_id": "policy",
                    "scope": "event",
                    "lead_workflow": "economic-impact-report",
                    "input_hash": "hash-1",
                    "requested_by": "operator",
                    "execution_note": "verified event",
                    "executed_at": "2026-07-24T09:00:00+09:00",
                    "outcome": "completed",
                    "command_results": [
                        {
                            "command_id": "specialist",
                            "stdout_tail": "must not reach API",
                        }
                    ],
                    "expected_outputs": [
                        (
                            f"workspace/analysis/{self.date}/"
                            "event_impact_synthesis.json"
                        )
                    ],
                }
            ),
            encoding="utf-8",
        )
        (receipt_dir / "invalid.json").write_text(
            '{"schema_version":"wrong"}',
            encoding="utf-8",
        )
        status = load_research_execution_status(
            self.date,
            self.root,
        )
        self.assertEqual(status["summary"]["executable_task_count"], 0)
        self.assertEqual(status["summary"]["completed_receipt_count"], 1)
        self.assertEqual(status["summary"]["blocked_task_count"], 1)
        self.assertEqual(status["summary"]["invalid_receipt_count"], 1)
        self.assertTrue(status["receipts"][0]["outputs"][0]["available"])
        self.assertNotIn(
            "stdout_tail",
            json.dumps(status, ensure_ascii=False),
        )
        self.assertFalse(status["policy"]["execution_endpoint_available"])

    def test_invalid_intelligence_schema_is_rejected(self) -> None:
        intelligence = (
            self.root
            / "workspace"
            / "intelligence"
            / self.date
            / "daily_intelligence.json"
        )
        intelligence.write_text(
            json.dumps(
                {
                    "schema_version": "daily_market_intelligence.v1",
                    "report_date": self.date,
                }
            ),
            encoding="utf-8",
        )
        with self.assertRaises(ValueError):
            load_daily_intelligence(self.date, self.root)

    def test_invalid_research_pack_schema_is_rejected(self) -> None:
        research_pack = (
            self.root
            / "workspace"
            / "intelligence"
            / self.date
            / "research_execution_pack.json"
        )
        research_pack.write_text(
            json.dumps(
                {
                    "schema_version": "research_execution_pack.v0",
                    "report_date": self.date,
                }
            ),
            encoding="utf-8",
        )
        with self.assertRaises(ValueError):
            load_research_execution_pack(self.date, self.root)


if __name__ == "__main__":
    unittest.main()
