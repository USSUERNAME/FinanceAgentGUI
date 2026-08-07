import json
import tempfile
import unittest
from pathlib import Path

from build_operations_manifest import FINAL_MARKER, build_manifest


class OperationsManifestTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.report_date = "2026-07-24"
        brief_dir = self.root / "workspace" / "briefs"
        operations_dir = self.root / "workspace" / "operations_reports"
        charts_dir = self.root / "workspace" / "charts"
        brief_dir.mkdir(parents=True)
        operations_dir.mkdir(parents=True)
        charts_dir.mkdir(parents=True)
        (brief_dir / f"{self.report_date}_리포트.md").write_text(
            f"# report\n\n{FINAL_MARKER}\n",
            encoding="utf-8",
        )
        (operations_dir / f"{self.report_date}_operations.md").write_text(
            "# internal operations\n",
            encoding="utf-8",
        )
        intelligence_dir = (
            self.root / "workspace" / "intelligence" / self.report_date
        )
        intelligence_dir.mkdir(parents=True)
        (intelligence_dir / "daily_intelligence.json").write_text(
            json.dumps(
                {
                    "schema_version": "daily_market_intelligence.v2",
                    "report_date": self.report_date,
                }
            ),
            encoding="utf-8",
        )
        (intelligence_dir / "research_task_plan.json").write_text(
            json.dumps(
                {
                    "schema_version": "research_task_plan.v1",
                    "report_date": self.report_date,
                    "summary": {
                        "task_count": 4,
                        "readiness_counts": {
                            "ready_for_research": 1,
                            "needs_evidence": 3,
                        },
                    },
                }
            ),
            encoding="utf-8",
        )
        (intelligence_dir / "research_execution_pack.json").write_text(
            json.dumps(
                {
                    "schema_version": "research_execution_pack.v1",
                    "report_date": self.report_date,
                    "summary": {
                        "eligible_task_count": 1,
                        "work_item_count": 1,
                    },
                }
            ),
            encoding="utf-8",
        )
        v2_reader = (
            self.root
            / "workspace"
            / "v2_reader_reports"
            / self.report_date
            / "reader_report.md"
        )
        v2_reader.parent.mkdir(parents=True)
        v2_reader.write_text(
            "# V2 reader\n\n<!-- V2_READER_REPORT_COMPLETE -->\n",
            encoding="utf-8",
        )
        for suffix in (
            "market_pulse.png",
            "macro_dashboard.png",
            "etf_dashboard_labeled.png",
            "etf_relative_strength.png",
        ):
            (charts_dir / f"{self.report_date}_{suffix}").write_bytes(b"png")
        (charts_dir / f"{self.report_date}_international_news_manifest.json").write_text(
            json.dumps({"images": []}),
            encoding="utf-8",
        )

    def tearDown(self) -> None:
        self.temp.cleanup()

    def write_json(self, relative: str, payload: dict) -> None:
        path = self.root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(payload), encoding="utf-8")

    def test_ready_manifest_exposes_only_relative_artifact_metadata(self) -> None:
        self.write_json(
            f"workspace/source_status/{self.report_date}/source_status_080000.json",
            {
                "generated_at": "2026-07-24T08:00:00+09:00",
                "collected_record_count": 12,
                "canonical_record_count": 10,
                "filtered_record_count": 2,
                "duplicate_record_count": 2,
                "sources": [
                    {
                        "source_id": "fred",
                        "status": "success",
                        "item_count": 5,
                        "elapsed_seconds": 1.25,
                        "timeout_seconds": 60,
                    },
                    {
                        "source_id": "rss_candidates",
                        "status": "skipped_or_notice",
                        "item_count": 0,
                        "notice_category": "provider_notice",
                    },
                ],
            },
        )
        manifest = build_manifest(
            self.report_date,
            run_mode="dry_run",
            root=self.root,
            generated_at="2026-07-24T08:01:00+09:00",
        )
        self.assertEqual(manifest["run"]["status"], "ready")
        self.assertTrue(manifest["run"]["publication_eligible"])
        self.assertEqual(
            manifest["source_status"]["summary"]["status_counts"]["success"],
            1,
        )
        self.assertEqual(
            manifest["source_status"]["sources"][0]["elapsed_seconds"],
            1.25,
        )
        self.assertEqual(len(manifest["report_catalog"]), 4)
        self.assertTrue(manifest["artifacts"]["daily_intelligence"]["available"])
        self.assertTrue(manifest["artifacts"]["v2_reader_report"]["available"])
        task_plan = manifest["artifacts"]["research_task_plan"]
        self.assertTrue(task_plan["available"])
        self.assertEqual(task_plan["summary"]["task_count"], 4)
        execution_pack = manifest["artifacts"]["research_execution_pack"]
        self.assertTrue(execution_pack["available"])
        self.assertEqual(execution_pack["summary"]["work_item_count"], 1)
        open_intelligence = next(
            item
            for item in manifest["allowed_actions"]
            if item["action_id"] == "open_daily_intelligence"
        )
        self.assertTrue(open_intelligence["enabled"])
        open_task_plan = next(
            item
            for item in manifest["allowed_actions"]
            if item["action_id"] == "open_research_task_plan"
        )
        self.assertTrue(open_task_plan["enabled"])
        open_execution_pack = next(
            item
            for item in manifest["allowed_actions"]
            if item["action_id"] == "open_research_execution_pack"
        )
        self.assertTrue(open_execution_pack["enabled"])
        open_v2_reader = next(
            item
            for item in manifest["allowed_actions"]
            if item["action_id"] == "open_v2_reader_report"
        )
        self.assertTrue(open_v2_reader["enabled"])
        serialized = json.dumps(manifest, ensure_ascii=False)
        self.assertNotIn(str(self.root), serialized)
        self.assertNotIn("# internal operations", serialized)
        self.assertTrue(manifest["policy"]["contains_secret_values"] is False)

    def test_manifest_surfaces_radar_candidates_without_report_body(self) -> None:
        self.write_json(
            f"workspace/triaged/{self.report_date}/triage_audit.json",
            {"publication_blocked_record_ids": ["radar-1", "radar-2"]},
        )
        self.write_json(
            f"workspace/triaged/{self.report_date}/event_clusters.json",
            {
                "clusters": [
                    {"verification_status": "discovery_metadata_only"},
                    {"verification_status": "primary_source_available"},
                ]
            },
        )
        self.write_json(
            (
                f"workspace/event_evidence/{self.report_date}/"
                "event_source_matches.json"
            ),
            {"resolution_counts": {"search_required": 1, "origin_primary_matched": 1}},
        )
        manifest = build_manifest(
            self.report_date,
            run_mode="dry_run",
            root=self.root,
            generated_at="2026-07-24T08:01:00+09:00",
        )
        radar = manifest["breaking_news_radar"]
        self.assertEqual(radar["publication_blocked_candidate_count"], 2)
        self.assertEqual(radar["discovery_only_cluster_count"], 1)
        self.assertEqual(radar["requires_primary_source_count"], 1)

    def test_manifest_surfaces_broker_analysis_cache_without_report_body(self) -> None:
        self.write_json(
            (
                f"workspace/broker_research_analysis/{self.report_date}/"
                "broker_research_analysis.json"
            ),
            {
                "schema_version": "broker_research_analysis.v1",
                "report_date": self.report_date,
                "generated_at": "2026-07-24T08:02:00+09:00",
                "status": "complete",
                "report_count": 3,
                "reports": [
                    {
                        "report_id": "private-report",
                        "summary": "must not reach the manifest",
                    }
                ],
                "usage": {},
                "cache": {
                    "model": "gpt-5-mini",
                    "prompt_version": "broker_research_prompt.v1",
                    "hit_count": 3,
                    "miss_count": 0,
                    "write_count": 0,
                    "source_text_cached": False,
                },
            },
        )
        manifest = build_manifest(
            self.report_date,
            run_mode="dry_run",
            root=self.root,
        )
        cache = manifest["broker_research_cache"]
        self.assertTrue(cache["available"])
        self.assertTrue(cache["all_reports_reused"])
        self.assertFalse(cache["api_request_performed"])
        self.assertEqual(cache["cache_hit_count"], 3)
        self.assertEqual(cache["api_total_tokens"], 0)
        self.assertFalse(cache["source_text_cached"])
        serialized = json.dumps(manifest, ensure_ascii=False)
        self.assertNotIn("private-report", serialized)
        self.assertNotIn("must not reach the manifest", serialized)

    def test_manifest_marks_partial_broker_cache_as_api_backed(self) -> None:
        self.write_json(
            (
                f"workspace/broker_research_analysis/{self.report_date}/"
                "broker_research_analysis.json"
            ),
            {
                "status": "complete",
                "report_count": 3,
                "reports": [],
                "usage": {"total_tokens": 1200},
                "cache": {
                    "model": "gpt-5-mini",
                    "prompt_version": "broker_research_prompt.v1",
                    "hit_count": 2,
                    "miss_count": 1,
                    "write_count": 1,
                    "source_text_cached": False,
                },
            },
        )
        manifest = build_manifest(
            self.report_date,
            run_mode="dry_run",
            root=self.root,
        )
        cache = manifest["broker_research_cache"]
        self.assertFalse(cache["all_reports_reused"])
        self.assertTrue(cache["api_request_performed"])
        self.assertEqual(cache["cache_miss_count"], 1)
        self.assertEqual(cache["api_total_tokens"], 1200)

    def test_manifest_surfaces_read_only_continuity_memory_summary(self) -> None:
        self.write_json(
            "workspace/history/continuity_memory.json",
            {
                "updated_report_date": self.report_date,
                "summary": {
                    "entry_count": 3,
                    "state_counts": {"active": 2, "unverified": 1},
                    "kind_counts": {"market_event": 1, "sector_thesis": 2},
                },
                "policy": {"model_automatic_mutation_allowed": False},
            },
        )
        manifest = build_manifest(
            self.report_date,
            run_mode="dry_run",
            root=self.root,
            generated_at="2026-07-24T08:01:00+09:00",
        )
        memory = manifest["continuity_memory"]
        self.assertEqual(memory["entry_count"], 3)
        self.assertEqual(memory["state_counts"]["active"], 2)
        self.assertFalse(memory["automatic_model_mutation_allowed"])

    def test_missing_completion_marker_blocks_cached_publication(self) -> None:
        brief = (
            self.root
            / "workspace"
            / "briefs"
            / f"{self.report_date}_리포트.md"
        )
        brief.write_text("# incomplete report\n", encoding="utf-8")
        manifest = build_manifest(
            self.report_date,
            run_mode="publish",
            root=self.root,
            generated_at="2026-07-24T08:01:00+09:00",
        )
        self.assertEqual(manifest["run"]["status"], "incomplete")
        self.assertFalse(manifest["run"]["publication_eligible"])
        self.assertIn(
            "report_completion_marker",
            manifest["artifacts"]["publication_bundle"]["missing"],
        )
        publish = next(
            item
            for item in manifest["allowed_actions"]
            if item["action_id"] == "publish_cached"
        )
        self.assertFalse(publish["enabled"])

    def test_missing_reader_report_disables_open_action(self) -> None:
        brief = (
            self.root
            / "workspace"
            / "briefs"
            / f"{self.report_date}_리포트.md"
        )
        brief.unlink()
        manifest = build_manifest(
            self.report_date,
            run_mode="dry_run",
            root=self.root,
            generated_at="2026-07-24T08:01:00+09:00",
        )
        open_reader = next(
            item
            for item in manifest["allowed_actions"]
            if item["action_id"] == "open_reader_report"
        )
        self.assertFalse(open_reader["enabled"])

    def test_critical_owner_queue_requires_review_without_mutating_actions(self) -> None:
        self.write_json(
            (
                "workspace/company_review_alert_owner_queue/"
                f"{self.report_date}/company_review_alert_owner_queue.json"
            ),
            {"unresolved_count": 2, "critical_count": 1},
        )
        manifest = build_manifest(
            self.report_date,
            run_mode="publish",
            root=self.root,
            generated_at="2026-07-24T08:01:00+09:00",
        )
        self.assertEqual(manifest["run"]["status"], "review_required")
        self.assertEqual(manifest["review_queues"]["active_count"], 2)
        self.assertEqual(manifest["review_queues"]["critical_count"], 1)
        self.assertTrue(manifest["run"]["publication_eligible"])
        self.assertTrue(manifest["policy"]["automatic_publication"] is False)


if __name__ == "__main__":
    unittest.main()
