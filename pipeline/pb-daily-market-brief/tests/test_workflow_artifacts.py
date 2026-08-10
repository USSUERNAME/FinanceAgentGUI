from __future__ import annotations

import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
WORKFLOW = ROOT / ".github" / "workflows" / "daily-brief.yml"
APP_WORKFLOW = ROOT.parents[1] / ".github" / "workflows" / "daily-brief.yml"
TELEGRAM_WORKFLOW = ROOT / ".github" / "workflows" / "telegram-refresh.yml"
APP_TELEGRAM_WORKFLOW = (
    ROOT.parents[1] / ".github" / "workflows" / "telegram-refresh.yml"
)


class WorkflowArtifactTests(unittest.TestCase):
    def test_telegram_refresh_runs_every_three_hours_and_preserves_results(self) -> None:
        for path in (TELEGRAM_WORKFLOW, APP_TELEGRAM_WORKFLOW):
            workflow = path.read_text(encoding="utf-8")
            self.assertIn('cron: "17 */3 * * *"', workflow)
            self.assertIn("python refresh_telegram_intelligence.py", workflow)
            self.assertIn("actions/upload-artifact@v4", workflow)
            self.assertIn("telegram-refresh-v1", workflow)
            self.assertIn("Validate collection result", workflow)
            self.assertIn("steps.validate.outcome == 'success'", workflow)
            self.assertNotIn("run_daily_report.py", workflow)
            self.assertNotIn("OPENAI_API_KEY", workflow)

    def test_daily_workflow_restores_latest_telegram_refresh(self) -> None:
        for path in (WORKFLOW, APP_WORKFLOW):
            workflow = path.read_text(encoding="utf-8")
            self.assertIn("Restore latest Telegram intelligence", workflow)
            self.assertIn("telegram-refresh-v1", workflow)
            self.assertIn("workspace/telegram_refresh/", workflow)

    def test_app_workflow_accepts_remote_runner_correlation_id(self) -> None:
        workflow = APP_WORKFLOW.read_text(encoding="utf-8")
        self.assertIn("client_request_id:", workflow)
        self.assertIn("inputs.client_request_id", workflow)

    def test_daily_artifact_preserves_market_input_and_provider_budget(self) -> None:
        workflow = WORKFLOW.read_text(encoding="utf-8")
        self.assertIn("workspace/provider_budget/", workflow)
        self.assertIn("workspace/us_equity_market_inputs/", workflow)
        self.assertIn("workspace/briefs/", workflow)
        self.assertIn("workspace/charts/", workflow)
        self.assertIn("workspace/company_long_term_profiles/", workflow)
        self.assertIn("workspace/company_filing_summaries/", workflow)
        self.assertIn("workspace/candidate_official_evidence/", workflow)
        self.assertIn("workspace/company_primary_narratives/", workflow)

    def test_private_reader_publishes_sanitized_company_candidates(self) -> None:
        workflow = APP_WORKFLOW.read_text(encoding="utf-8")
        self.assertGreaterEqual(
            workflow.count(
                "--companies pipeline/pb-daily-market-brief/workspace/company_long_term_profiles"
            ),
            2,
        )
        self.assertGreaterEqual(
            workflow.count(
                "--candidate-screens pipeline/pb-daily-market-brief/workspace/us_equity_candidate_screen"
            ),
            2,
        )

    def test_candidate_official_evidence_enrichment_runs_before_final_screen(self) -> None:
        pipeline = (ROOT / "run_daily_report.py").read_text(encoding="utf-8")
        first_screen = pipeline.index('"screen_us_equity_candidates.py"')
        enrichment = pipeline.index('"enrich_us_equity_candidate_evidence.py"')
        second_screen = pipeline.index('"screen_us_equity_candidates.py"', first_screen + 1)
        self.assertLess(first_screen, enrichment)
        self.assertLess(enrichment, second_screen)
        self.assertIn('candidate_evidence_args.append("--no-network")', pipeline)
        self.assertIn('"--additional-inbox-file"', pipeline)

    def test_company_primary_narratives_run_after_queue_and_are_offline_safe(self) -> None:
        pipeline = (ROOT / "run_daily_report.py").read_text(encoding="utf-8")
        queue = pipeline.index('"build_company_research_queue.py"')
        narratives = pipeline.index('"collect_company_primary_narratives.py"')
        tearsheets = pipeline.index('"build_company_tearsheets.py"')
        self.assertLess(queue, narratives)
        self.assertLess(narratives, tearsheets)
        self.assertIn('narrative_args.append("--no-network")', pipeline)

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
        self.assertIn("Restore Drive ingestion fingerprint state", workflow)
        self.assertIn("Save Drive ingestion fingerprint state", workflow)
        self.assertGreaterEqual(
            workflow.count("workspace/broker_research_cache/drive_ingestion_state.json"),
            2,
        )
        self.assertIn("drive-ingestion-v1", workflow)
        self.assertNotIn("drive-ingestion-v2", workflow)
        self.assertIn('GOOGLE_DRIVE_RESEARCH_MAX_FILES: "60"', workflow)
        self.assertIn("Restore broker research digest history", workflow)
        self.assertIn("Save broker research digest history", workflow)
        self.assertGreaterEqual(
            workflow.count("path: workspace/broker_research_digest"),
            2,
        )
        self.assertIn(
            "${{ runner.os }}-broker-research-digest-v1-${{ github.run_id }}",
            workflow,
        )
        self.assertIn("Restore rights-safe broker research digest seed", workflow)
        self.assertIn(
            "secrets.BROKER_RESEARCH_DIGEST_HISTORY_GZIP_BASE64",
            workflow,
        )
        self.assertIn("python restore_broker_research_digest_seed.py", workflow)

    def test_broker_research_cold_ocr_has_bounded_actions_timeout(self) -> None:
        workflow = WORKFLOW.read_text(encoding="utf-8")
        requirements = (ROOT / "requirements.txt").read_text(encoding="utf-8")
        self.assertIn(
            'COLLECTOR_TIMEOUT_AUTHORIZED_REPORT_DROP_SECONDS: "300"',
            workflow,
        )
        self.assertIn(
            'COLLECTOR_TIMEOUT_GOOGLE_DRIVE_RESEARCH_INBOX_SECONDS: "300"',
            workflow,
        )
        self.assertIn(
            'COLLECTOR_TIMEOUT_TELEGRAM_CHANNELS_SECONDS: "300"',
            workflow,
        )
        app_workflow = APP_WORKFLOW.read_text(encoding="utf-8")
        self.assertIn(
            'COLLECTOR_TIMEOUT_TELEGRAM_CHANNELS_SECONDS: "300"',
            app_workflow,
        )
        self.assertIn("cryptography>=3.1", requirements)

    def test_korea_market_credentials_are_forwarded_to_actions(self) -> None:
        workflow = APP_WORKFLOW.read_text(encoding="utf-8")
        self.assertIn(
            "BOK_ECOS_API_KEY: ${{ secrets.BOK_ECOS_API_KEY || secrets.ECOS_API_KEY }}",
            workflow,
        )
        self.assertIn("KIS_APP_KEY: ${{ secrets.KIS_APP_KEY }}", workflow)
        self.assertIn("KIS_APP_SECRET: ${{ secrets.KIS_APP_SECRET }}", workflow)

    def test_drive_approval_registry_is_restored_and_removed_ephemerally(self) -> None:
        workflow = APP_WORKFLOW.read_text(encoding="utf-8")
        self.assertIn("Restore Drive approval registry", workflow)
        self.assertIn(
            "secrets.GOOGLE_DRIVE_APPROVALS_GZIP_BASE64",
            workflow,
        )
        self.assertIn(
            'google_drive_broker_research_approvals.v1',
            workflow,
        )
        self.assertIn(
            'workspace/broker_research_approvals/google_drive.json',
            workflow,
        )

    def test_telegram_approval_registry_is_restored_validated_and_removed(self) -> None:
        workflow = APP_WORKFLOW.read_text(encoding="utf-8")
        self.assertIn("Restore Telegram PDF approval registry", workflow)
        self.assertIn(
            "secrets.TELEGRAM_RESEARCH_APPROVALS_GZIP_BASE64",
            workflow,
        )
        self.assertIn("telegram_research_attachment_approvals.v1", workflow)
        self.assertIn("python validate_telegram_research_run.py", workflow)
        self.assertIn(
            "workspace/telegram_research_approvals/attachments.json",
            workflow,
        )
        self.assertIn("Remove ephemeral approval registries", workflow)
        cleanup = workflow.index("Remove ephemeral approval registries")
        preserve = workflow.index("Preserve structured evidence and analysis")
        self.assertLess(cleanup, preserve)

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
        self.assertIn(
            'OPENAI_EVENT_SYNTHESIS_MAX_OUTPUT_TOKENS: "8000"',
            workflow,
        )
        self.assertIn(
            'OPENAI_EVENT_SYNTHESIS_TIMEOUT_SECONDS: "240"',
            workflow,
        )
        self.assertIn('OPENAI_BRIEF_TIMEOUT_SECONDS: "180"', workflow)
        self.assertIn('OPENAI_BRIEF_MAX_ATTEMPTS: "2"', workflow)
        self.assertIn('OPENAI_ANALYSIS_TIMEOUT_SECONDS: "90"', workflow)
        self.assertIn('OPENAI_ANALYSIS_MAX_ATTEMPTS: "2"', workflow)
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
        evidence_command = pipeline[preparation:pipeline.index("]", preparation)]
        self.assertIn('"--additional-sources-file"', evidence_command)
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
