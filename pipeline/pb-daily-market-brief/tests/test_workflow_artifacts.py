from __future__ import annotations

import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
WORKFLOW = ROOT / ".github" / "workflows" / "daily-brief.yml"


class WorkflowArtifactTests(unittest.TestCase):
    def test_daily_artifact_preserves_market_input_and_provider_budget(self) -> None:
        workflow = WORKFLOW.read_text(encoding="utf-8")
        self.assertIn("workspace/provider_budget/", workflow)
        self.assertIn("workspace/us_equity_market_inputs/", workflow)
        self.assertIn("workspace/briefs/", workflow)
        self.assertIn("workspace/charts/", workflow)

    def test_cached_publish_downloads_prior_artifact_without_collection(self) -> None:
        workflow = WORKFLOW.read_text(encoding="utf-8")
        self.assertIn("publish_cached", workflow)
        self.assertIn("actions/download-artifact@v4", workflow)
        self.assertIn("python publish_cached_brief.py", workflow)
        self.assertIn("source_run_id", workflow)

    def test_history_restore_and_publish_only_save_are_separate(self) -> None:
        workflow = WORKFLOW.read_text(encoding="utf-8")
        self.assertIn("actions/cache/restore@v4", workflow)
        self.assertIn("actions/cache/save@v4", workflow)
        self.assertIn(
            "env.BRIEF_RUN_MODE == 'publish' && steps.brief.outcome == 'success'",
            workflow,
        )

    def test_broker_research_cache_survives_actions_runs_without_blocking(self) -> None:
        workflow = WORKFLOW.read_text(encoding="utf-8")
        self.assertIn(
            "Restore broker research structured analysis cache",
            workflow,
        )
        self.assertIn(
            "Save broker research structured analysis cache",
            workflow,
        )
        self.assertGreaterEqual(
            workflow.count(
                "path: workspace/broker_research_cache/structured_analysis"
            ),
            2,
        )
        self.assertIn(
            "${{ runner.os }}-broker-research-v1-${{ github.run_id }}",
            workflow,
        )
        self.assertIn(
            "env.BRIEF_RUN_MODE != 'publish_cached' && "
            "steps.brief.outcome == 'success'",
            workflow,
        )
        self.assertGreaterEqual(workflow.count("continue-on-error: true"), 4)
        self.assertNotIn(
            "path: workspace/broker_research_cache/document_text",
            workflow,
        )

    def test_broker_research_cold_ocr_has_bounded_actions_timeout(self) -> None:
        workflow = WORKFLOW.read_text(encoding="utf-8")
        self.assertIn(
            'COLLECTOR_TIMEOUT_AUTHORIZED_REPORT_DROP_SECONDS: "300"',
            workflow,
        )
        self.assertIn(
            'COLLECTOR_TIMEOUT_GOOGLE_DRIVE_RESEARCH_INBOX_SECONDS: "300"',
            workflow,
        )

    def test_broker_analysis_artifacts_are_preserved_without_cache_payload(self) -> None:
        workflow = WORKFLOW.read_text(encoding="utf-8")
        self.assertIn("workspace/broker_research_analysis/", workflow)
        self.assertIn("workspace/broker_research_digest/", workflow)
        self.assertIn("workspace/cross_source_events/", workflow)
        artifact_section = workflow.split(
            "- name: Preserve structured evidence and analysis",
            1,
        )[1]
        self.assertNotIn(
            "workspace/broker_research_cache/",
            artifact_section,
        )

    def test_brief_generation_budget_covers_long_research_output(self) -> None:
        workflow = WORKFLOW.read_text(encoding="utf-8")
        self.assertIn('OPENAI_BRIEF_MAX_OUTPUT_TOKENS: "8000"', workflow)
        self.assertIn('OPENAI_BRIEF_TIMEOUT_SECONDS: "180"', workflow)
        self.assertIn('OPENAI_BRIEF_MAX_ATTEMPTS: "2"', workflow)
        self.assertNotIn('OPENAI_BRIEF_MAX_OUTPUT_TOKENS: "5600"', workflow)

    def test_daily_pipeline_keeps_drive_research_optional_and_rights_gated(self) -> None:
        pipeline = (ROOT / "run_daily_report.py").read_text(encoding="utf-8")
        self.assertIn('"google_drive_research_inbox"', pipeline)
        self.assertIn('"authorized_report_drop"', pipeline)
        self.assertIn('"institutional_insights"', pipeline)

    def test_workflow_exposes_unpublished_official_evidence_verification(self) -> None:
        workflow = WORKFLOW.read_text(encoding="utf-8")
        pipeline = (ROOT / "run_daily_report.py").read_text(encoding="utf-8")
        self.assertIn("verification_dry_run", workflow)
        self.assertIn(
            "python run_daily_report.py --verification-dry-run",
            workflow,
        )
        self.assertIn("--verification-dry-run", pipeline)
        self.assertIn("allows_official_evidence_network", pipeline)

    def test_official_discovery_runs_before_evidence_preparation(self) -> None:
        pipeline = (ROOT / "run_daily_report.py").read_text(encoding="utf-8")
        discovery = pipeline.index('"discover_official_event_sources.py"')
        second_resolution = pipeline.index('"--additional-sources-file"')
        preparation = pipeline.index('"prepare_event_evidence.py"')
        self.assertLess(discovery, second_resolution)
        self.assertLess(second_resolution, preparation)
        self.assertIn('discovery_args.append("--no-network")', pipeline)

    def test_cross_source_events_feed_memory_before_reader_intelligence(self) -> None:
        pipeline = (ROOT / "run_daily_report.py").read_text(encoding="utf-8")
        cross_source = pipeline.index('"build_cross_source_events.py"')
        continuity = pipeline.index('"build_continuity_memory.py"')
        intelligence = pipeline.index('"build_daily_intelligence.py"')
        self.assertLess(cross_source, continuity)
        self.assertLess(continuity, intelligence)


if __name__ == "__main__":
    unittest.main()
