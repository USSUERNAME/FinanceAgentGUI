"""Run the full Korea-time daily brief pipeline in a local or GitHub Actions environment."""

from __future__ import annotations

import os
import argparse
import json
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from collectors.common import ROOT, load_dotenv

DEFAULT_ALPHA_VANTAGE_DAILY_LIMIT = 25
ETF_DASHBOARD_REQUESTS = 10
DEFAULT_SECTOR_FUNDAMENTAL_REQUESTS = 8


def run_mode_policy(
    *,
    dry_run: bool = False,
    verification_dry_run: bool = False,
) -> dict[str, bool | str]:
    """Separate offline validation from evidence-backed unpublished validation."""
    if dry_run and verification_dry_run:
        raise ValueError("dry_run and verification_dry_run are mutually exclusive")
    if verification_dry_run:
        return {
            "name": "verification_dry_run",
            "blocks_publication": True,
            "blocks_alert_delivery": True,
            "allows_official_evidence_network": True,
            "runs_structured_event_analysis": True,
        }
    if dry_run:
        return {
            "name": "dry_run",
            "blocks_publication": True,
            "blocks_alert_delivery": True,
            "allows_official_evidence_network": False,
            "runs_structured_event_analysis": False,
        }
    return {
        "name": "publish",
        "blocks_publication": False,
        "blocks_alert_delivery": False,
        "allows_official_evidence_network": True,
        "runs_structured_event_analysis": True,
    }


def run(*args: str) -> None:
    print("+", " ".join(args), flush=True)
    subprocess.run([sys.executable, *args], cwd=ROOT, check=True)


def collect_market_membership_inputs(report_date: str) -> None:
    """Refresh read-only market membership proxies in every run mode."""
    run("collect_spy_holdings_membership.py", "--date", report_date)
    run("collect_sector_spdr_holdings.py", "--date", report_date)


def pause_between_alpha_vantage_stages() -> None:
    """Keep the configured provider cadence across separate Python processes."""
    if os.getenv("ALPHAVANTAGE_API_KEY", "").strip():
        delay = float(os.getenv("ALPHAVANTAGE_REQUEST_DELAY_SECONDS", "13"))
        if delay > 0:
            time.sleep(delay)


def alpha_vantage_daily_plan() -> dict[str, int | bool]:
    """Reserve a deterministic cross-stage provider budget before any calls."""
    daily_limit = int(os.getenv(
        "ALPHAVANTAGE_DAILY_REQUEST_LIMIT",
        str(DEFAULT_ALPHA_VANTAGE_DAILY_LIMIT),
    ))
    market_requested = max(int(os.getenv("US_MARKET_DATA_REQUEST_BUDGET", "7")), 0)
    sector_requested = max(int(os.getenv(
        "SECTOR_FUNDAMENTAL_REQUEST_BUDGET",
        str(DEFAULT_SECTOR_FUNDAMENTAL_REQUESTS),
    )), 0)
    if 0 < daily_limit < ETF_DASHBOARD_REQUESTS:
        raise ValueError(
            "ALPHAVANTAGE_DAILY_REQUEST_LIMIT must be 0 (unlimited) or at least "
            f"{ETF_DASHBOARD_REQUESTS} for the fixed ETF dashboard"
        )
    if daily_limit <= 0:
        return {
            "limited": False,
            "daily_limit": daily_limit,
            "etf_dashboard": ETF_DASHBOARD_REQUESTS,
            "us_market_snapshot": market_requested,
            "sector_fundamentals": sector_requested,
            "remaining_for_later_stages": -1,
        }
    remaining = max(daily_limit - ETF_DASHBOARD_REQUESTS, 0)
    market_budget = min(market_requested, remaining)
    remaining -= market_budget
    sector_budget = min(sector_requested, remaining)
    remaining -= sector_budget
    return {
        "limited": True,
        "daily_limit": daily_limit,
        "etf_dashboard": ETF_DASHBOARD_REQUESTS,
        "us_market_snapshot": market_budget,
        "sector_fundamentals": sector_budget,
        "remaining_for_later_stages": remaining,
    }


def write_alpha_vantage_plan(report_date: str, plan: dict[str, int | bool]) -> Path:
    output = ROOT / "workspace" / "provider_budget" / report_date / "alpha_vantage_plan.json"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps({
        "schema_version": "alpha_vantage_daily_plan.v1",
        "report_date": report_date,
        **plan,
        "policy": (
            "Static upper-bound allocation. Provider notices and unused requests are "
            "not reassigned during the same run."
        ),
    }, ensure_ascii=False, indent=2), encoding="utf-8")
    return output


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the daily market brief pipeline")
    run_modes = parser.add_mutually_exclusive_group()
    run_modes.add_argument(
        "--dry-run",
        action="store_true",
        help=(
            "Build and validate artifacts without Notion publishing, alert delivery, "
            "official-body network fetches, or structured event analysis"
        ),
    )
    run_modes.add_argument(
        "--verification-dry-run",
        action="store_true",
        help=(
            "Run official-source evidence fetches and structured event analysis, "
            "but never publish to Notion or deliver alerts"
        ),
    )
    args = parser.parse_args()
    policy = run_mode_policy(
        dry_run=args.dry_run,
        verification_dry_run=args.verification_dry_run,
    )
    validation_only = bool(policy["blocks_publication"])
    offline_validation = not bool(policy["allows_official_evidence_network"])
    structured_event_analysis = bool(policy["runs_structured_event_analysis"])
    load_dotenv()
    timezone_name = os.getenv("BRIEF_TIMEZONE", "Asia/Seoul")
    report_date = datetime.now(ZoneInfo(timezone_name)).date().isoformat()
    alpha_vantage_plan = alpha_vantage_daily_plan()
    plan_path = write_alpha_vantage_plan(report_date, alpha_vantage_plan)
    print(
        f"Alpha Vantage request plan saved: {plan_path.relative_to(ROOT)} | "
        f"limit={alpha_vantage_plan['daily_limit']} | "
        f"ETF={alpha_vantage_plan['etf_dashboard']} | "
        f"US market={alpha_vantage_plan['us_market_snapshot']} | "
        f"sector fundamentals={alpha_vantage_plan['sector_fundamentals']}",
        flush=True,
    )

    # GitHub-hosted runners are stateless. A short lookback keeps the report
    # useful without relying on a local state file surviving between runs.
    # The offline dry run must not make the official SEC request promised by
    # verification mode; existing local SEC inbox rows remain available below.
    if offline_validation:
        print("Offline dry run: skipped SEC official-body network refresh.", flush=True)
    else:
        run("fetch_sec_filings.py")
    run(
        "collect_all.py", "--sources",
        "fred", "newsapi", "gdelt", "rss_candidates", "institutional_insights",
        "official_research_documents", "gmail_research", "opendart", "sec_inbox",
        "authorized_report_drop", "google_drive_research_inbox", "telegram_channels",
        "--include-seen",
    )
    discovery_args = (
        ("discover_qualitative_candidates.py", "--dry-run")
        if validation_only
        else ("discover_qualitative_candidates.py",)
    )
    run(*discovery_args)

    inbox_dir = ROOT / "workspace" / "normalized" / report_date
    inboxes = sorted(inbox_dir.glob("inbox_*.json"), key=lambda path: path.stat().st_mtime)
    if not inboxes:
        raise SystemExit(f"No normalized inbox was created for {report_date}.")
    inbox = inboxes[-1]
    run(
        "triage_news_candidates.py", "--date", report_date,
        "--inbox-file", str(inbox.relative_to(ROOT)),
    )
    triaged_inbox = ROOT / "workspace" / "triaged" / report_date / "triaged_inbox.json"
    if not triaged_inbox.exists():
        raise SystemExit(f"Triaged inbox was not created for {report_date}.")
    collect_market_membership_inputs(report_date)
    run(
        "build_us_equity_universe.py", "--date", report_date,
        "--inbox-file", str(triaged_inbox.relative_to(ROOT)),
    )
    event_clusters = ROOT / "workspace" / "triaged" / report_date / "event_clusters.json"
    event_evidence_dir = ROOT / "workspace" / "event_evidence" / report_date
    event_source_matches = event_evidence_dir / "event_source_matches.json"
    run(
        "resolve_event_sources.py", "--date", report_date,
        "--inbox-file", str(triaged_inbox.relative_to(ROOT)),
        "--clusters-file", str(event_clusters.relative_to(ROOT)),
    )
    discovered_official_sources = event_evidence_dir / "discovered_official_sources.json"
    discovery_args = [
        "discover_official_event_sources.py", "--date", report_date,
        "--source-matches-file", str(event_source_matches.relative_to(ROOT)),
        "--clusters-file", str(event_clusters.relative_to(ROOT)),
        "--inbox-file", str(triaged_inbox.relative_to(ROOT)),
    ]
    if offline_validation:
        discovery_args.append("--no-network")
    run(*discovery_args)
    run(
        "resolve_event_sources.py", "--date", report_date,
        "--inbox-file", str(triaged_inbox.relative_to(ROOT)),
        "--clusters-file", str(event_clusters.relative_to(ROOT)),
        "--additional-sources-file", str(discovered_official_sources.relative_to(ROOT)),
    )
    evidence_args = [
        "prepare_event_evidence.py", "--date", report_date,
        "--inbox-file", str(triaged_inbox.relative_to(ROOT)),
        "--clusters-file", str(event_clusters.relative_to(ROOT)),
        "--source-matches-file", str(event_source_matches.relative_to(ROOT)),
        "--additional-sources-file", str(discovered_official_sources.relative_to(ROOT)),
    ]
    if offline_validation:
        evidence_args.append("--no-network")
    run(*evidence_args)

    run("generate_market_pulse.py", "--date", report_date)
    run("generate_macro_chart.py", "--date", report_date)
    run("generate_etf_chart.py", "--date", report_date)
    run("label_etf_chart.py", "--date", report_date)
    pause_between_alpha_vantage_stages()
    run(
        "collect_us_equity_market_snapshot.py", "--date", report_date,
        "--request-budget", str(alpha_vantage_plan["us_market_snapshot"]),
    )
    run("build_us_constituent_breadth.py", "--date", report_date)
    run(
        "screen_us_equity_candidates.py", "--date", report_date,
        "--inbox-file", str(triaged_inbox.relative_to(ROOT)),
    )
    candidate_evidence_args = [
        "enrich_us_equity_candidate_evidence.py", "--date", report_date,
        "--candidate-screen-file",
        f"workspace/us_equity_candidate_screen/{report_date}/candidate_screen.json",
    ]
    if offline_validation:
        candidate_evidence_args.append("--no-network")
    run(*candidate_evidence_args)
    run(
        "screen_us_equity_candidates.py", "--date", report_date,
        "--inbox-file", str(triaged_inbox.relative_to(ROOT)),
        "--additional-inbox-file",
        f"workspace/candidate_official_evidence/{report_date}/candidate_official_evidence.json",
    )
    run("build_us_market_internals.py", "--date", report_date)
    run("collect_sector_metrics.py", "--date", report_date)
    pause_between_alpha_vantage_stages()
    run(
        "collect_sector_fundamentals.py", "--date", report_date,
        "--max-companies", str(alpha_vantage_plan["sector_fundamentals"]),
    )
    if (
        alpha_vantage_plan["limited"]
        and int(alpha_vantage_plan["remaining_for_later_stages"]) <= 0
    ):
        # Prevent later optional company adapters from repeatedly hitting a
        # provider limit. Their existing missing-key paths retain explicit gaps.
        os.environ["ALPHAVANTAGE_API_KEY"] = ""
        print(
            "Alpha Vantage daily plan exhausted; later optional provider stages "
            "will emit explicit unavailable statuses.",
            flush=True,
        )
    pause_between_alpha_vantage_stages()
    run("collect_sector_drivers.py", "--date", report_date)
    run("collect_official_market_calendar.py", "--date", report_date)
    run("collect_korea_market.py", "--date", report_date)
    run(
        "build_daily_snapshot.py", "--date", report_date,
        "--inbox-file", str(triaged_inbox.relative_to(ROOT)),
        "--official-calendar-file", f"workspace/market_calendar/{report_date}/official_market_calendar.json",
        "--korea-market-file", f"workspace/korea_market/{report_date}/korea_market.json",
        "--us-equity-candidate-screen-file",
        f"workspace/us_equity_candidate_screen/{report_date}/candidate_screen.json",
        "--us-market-internals-file",
        f"workspace/us_market_internals/{report_date}/market_internals.json",
        "--us-market-input-file",
        f"workspace/us_equity_market_inputs/{report_date}/market_snapshot.json",
    )
    run("record_daily_market_history.py", "--date", report_date)
    structure_args = ["structure_event_evidence.py", "--date", report_date]
    if not structured_event_analysis:
        structure_args.append("--dry-run")
    run(*structure_args)
    synthesis_args = ["synthesize_event_impacts.py", "--date", report_date]
    if not structured_event_analysis:
        synthesis_args.append("--dry-run")
    run(*synthesis_args)
    run("track_sector_theses.py", "--date", report_date)
    run("build_sector_leadership_radar.py", "--date", report_date)
    run("build_company_research_queue.py", "--date", report_date)
    narrative_args = ["collect_company_primary_narratives.py", "--date", report_date]
    if offline_validation:
        narrative_args.append("--no-network")
    run(*narrative_args)
    run("collect_company_market_context.py", "--date", report_date)
    pause_between_alpha_vantage_stages()
    run("collect_company_peer_context.py", "--date", report_date)
    run("build_company_valuation_expectations.py", "--date", report_date)
    run("collect_company_primary_facts.py", "--date", report_date)
    run("build_company_operating_bridge.py", "--date", report_date)
    run("build_company_tearsheets.py", "--date", report_date)
    run("build_company_long_term_profiles.py", "--date", report_date)
    run("collect_korea_company_exposure.py", "--date", report_date)
    run("build_company_korea_transmission.py", "--date", report_date)
    pause_between_alpha_vantage_stages()
    run("collect_company_earnings_events.py", "--date", report_date)
    pause_between_alpha_vantage_stages()
    run("collect_company_earnings_reaction_context.py", "--date", report_date)
    run("build_company_earnings_driver_review.py", "--date", report_date)
    run("build_company_earnings_scenarios.py", "--date", report_date)
    run("collect_company_earnings_results.py", "--date", report_date)
    run("build_company_earnings_deep_dive.py", "--date", report_date)
    run("build_earnings_intelligence.py", "--date", report_date)
    run("collect_company_underwriting.py", "--date", report_date)
    run("generate_company_review_operating_drafts.py", "--date", report_date, "--materialize-inputs")
    run("build_company_underwriting_drafts.py", "--date", report_date)
    run("build_company_thesis_update.py", "--date", report_date)
    run("build_company_review_operating_review_queue.py", "--date", report_date)
    run("collect_company_review_operating_config.py", "--date", report_date)
    run("build_company_thesis_review_calendar.py", "--date", report_date)
    run("monitor_company_review_operations.py", "--date", report_date)
    dispatch_args = (
        ("dispatch_company_review_alerts.py", "--date", report_date, "--dry-run")
        if bool(policy["blocks_alert_delivery"])
        else ("dispatch_company_review_alerts.py", "--date", report_date)
    )
    run(*dispatch_args)
    run("monitor_company_review_alert_followups.py", "--date", report_date)
    run("validate_company_review_alert_completion_evidence.py", "--date", report_date)
    run("build_company_review_alert_external_evidence_backlog.py", "--date", report_date)
    run("build_company_review_alert_external_evidence_review_summary.py", "--date", report_date)
    run("audit_company_review_alert_external_evidence_operation.py", "--date", report_date)
    run("build_company_review_alert_sla_summary.py", "--date", report_date)
    run("track_company_review_alert_sla_history.py", "--date", report_date)
    run("build_company_review_alert_owner_queue.py", "--date", report_date)
    run(
        "track_company_theses.py", "--date", report_date,
        "--post-earnings-results-file", f"workspace/company_earnings_results/{report_date}/company_earnings_results.json",
        "--post-earnings-deep-dive-file", f"workspace/company_earnings_deep_dive/{report_date}/company_earnings_deep_dive.json",
        "--formal-thesis-updates-file", f"workspace/company_thesis_updates/{report_date}/company_thesis_update.json",
    )
    market_analysis_args = ["analyze_market_snapshot.py", "--date", report_date]
    if offline_validation:
        market_analysis_args.append("--dry-run")
    run(*market_analysis_args)
    if offline_validation:
        print(
            "Daily brief offline dry run complete. Collection, deterministic build "
            "stages, and the market-analysis request schema were validated. No OpenAI "
            "request, report write, Notion page, or alert was created.",
            flush=True,
        )
        return
    run("track_daily_hypotheses.py", "--date", report_date)
    broker_analysis_args = (
        "analyze_broker_research.py",
        "--date", report_date,
        "--inbox-file", str(triaged_inbox.relative_to(ROOT)),
        *(("--dry-run",) if not structured_event_analysis else ()),
    )
    run(*broker_analysis_args)
    run(
        "build_broker_research_digest.py",
        "--date", report_date,
        "--inbox-file", str(triaged_inbox.relative_to(ROOT)),
        "--analysis-file",
        f"workspace/broker_research_analysis/{report_date}/broker_research_analysis.json",
    )
    run(
        "build_cross_source_events.py",
        "--date", report_date,
        "--inbox-file", str(triaged_inbox.relative_to(ROOT)),
        "--clusters-file", str(event_clusters.relative_to(ROOT)),
        "--analysis-file",
        f"workspace/broker_research_analysis/{report_date}/broker_research_analysis.json",
    )
    run("build_continuity_memory.py", "--date", report_date)
    run("build_daily_intelligence.py", "--date", report_date)
    run("route_intelligence_tasks.py", "--date", report_date)
    run("build_research_execution_pack.py", "--date", report_date)
    run("compose_v2_reader_report.py", "--date", report_date)
    compose_args = [
        "compose_daily_brief.py", "--date", report_date,
        "--inbox-file", str(triaged_inbox.relative_to(ROOT)),
        "--snapshot-file", f"workspace/snapshots/{report_date}/daily_snapshot.json",
        "--analysis-file", f"workspace/analysis/{report_date}/market_analysis.json",
        "--history-review-file", f"workspace/history/reviews/{report_date}.json",
        "--sector-review-file", f"workspace/history/sector_reviews/{report_date}.json",
        "--sector-radar-file", f"workspace/history/sector_radar/{report_date}.json",
        "--company-queue-file", f"workspace/company_research_queue/{report_date}/company_research_queue.json",
        "--company-market-context-file", f"workspace/company_market_context/{report_date}/company_market_context.json",
        "--company-valuation-expectations-file", f"workspace/company_valuation_expectations/{report_date}/company_valuation_expectations.json",
        "--company-primary-facts-file", f"workspace/company_primary_facts/{report_date}/company_primary_facts.json",
        "--company-operating-bridge-file", f"workspace/company_operating_bridge/{report_date}/company_operating_bridge.json",
        "--company-tearsheets-file", f"workspace/company_tearsheets/{report_date}/company_tearsheets.json",
        "--company-earnings-events-file", f"workspace/company_earnings_events/{report_date}/company_earnings_events.json",
        "--company-earnings-reaction-context-file", f"workspace/company_earnings_reaction_context/{report_date}/company_earnings_reaction_context.json",
        "--company-earnings-driver-review-file", f"workspace/company_earnings_driver_review/{report_date}/company_earnings_driver_review.json",
        "--company-earnings-scenarios-file", f"workspace/company_earnings_scenarios/{report_date}/company_earnings_scenarios.json",
        "--company-earnings-results-file", f"workspace/company_earnings_results/{report_date}/company_earnings_results.json",
        "--company-earnings-deep-dive-file", f"workspace/company_earnings_deep_dive/{report_date}/company_earnings_deep_dive.json",
        "--company-underwriting-file", f"workspace/company_underwriting/{report_date}/company_underwriting.json",
        "--company-underwriting-drafts-file", f"workspace/company_underwriting_drafts/{report_date}/company_underwriting_drafts.json",
        "--company-review-operating-review-queue-file", f"workspace/company_review_operating_review_queue/{report_date}/company_review_operating_review_queue.json",
        "--company-review-operations-monitor-file", f"workspace/company_review_operations_monitor/{report_date}/company_review_operations_monitor.json",
        "--company-review-alert-delivery-plan-file", f"workspace/company_review_alert_delivery_plans/{report_date}/company_review_alert_delivery_plan.json",
        "--company-review-alert-followup-monitor-file", f"workspace/company_review_alert_followup_monitor/{report_date}/company_review_alert_followup_monitor.json",
        "--company-review-alert-sla-summary-file", f"workspace/company_review_alert_sla_summary/{report_date}/company_review_alert_weekly_sla_summary.json",
        "--company-review-alert-owner-queue-file", f"workspace/company_review_alert_owner_queue/{report_date}/company_review_alert_owner_queue.json",
        "--company-review-alert-sla-trend-file", f"workspace/company_review_alert_sla_trend/{report_date}/company_review_alert_sla_trend.json",
        "--company-review-alert-completion-evidence-file", f"workspace/company_review_alert_completion_evidence_integrity/{report_date}/company_review_alert_completion_evidence_integrity.json",
        "--company-review-alert-external-evidence-backlog-file", f"workspace/company_review_alert_external_evidence_backlog/{report_date}/company_review_alert_external_evidence_backlog.json",
        "--company-review-alert-external-evidence-review-summary-file", f"workspace/company_review_alert_external_evidence_review_summary/{report_date}/company_review_alert_external_evidence_review_summary.json",
        "--company-thesis-update-file", f"workspace/company_thesis_updates/{report_date}/company_thesis_update.json",
        "--company-thesis-review-calendar-file", f"workspace/company_thesis_review_calendar/{report_date}/company_thesis_review_calendar.json",
        "--company-thesis-review-file", f"workspace/history/company_thesis_reviews/{report_date}.json",
    ]
    if offline_validation:
        compose_args.append("--dry-run")
    run(*compose_args)
    if offline_validation:
        print(
            "Daily brief offline dry run complete. Inputs were validated; no OpenAI "
            "request, report write, Notion page, or alert was created.",
            flush=True,
        )
        return
    brief = f"workspace/briefs/{report_date}_리포트.md"
    display_date = datetime.now(ZoneInfo(timezone_name))
    run(
        "append_qualitative_analysis.py", brief,
        "--date", f"{display_date.month}월 {display_date.day}일",
    )
    run("generate_news_card.py", brief, "--date", report_date)
    news_manifest = ROOT / "workspace" / "charts" / f"{report_date}_international_news_manifest.json"
    news_images = json.loads(news_manifest.read_text(encoding="utf-8")).get("images", [])
    run(
        "build_operations_manifest.py",
        "--date", report_date,
        "--run-mode", str(policy["name"]),
    )
    publish_args = [
        "publish_visual_brief.py", brief,
        "--pulse-image", f"workspace/charts/{report_date}_market_pulse.png",
        "--macro-image", f"workspace/charts/{report_date}_macro_dashboard.png",
        "--etf-image", f"workspace/charts/{report_date}_etf_dashboard_labeled.png",
        "--etf-heatmap-image", f"workspace/charts/{report_date}_etf_relative_strength.png",
        "--news-images", *news_images,
    ]
    if validation_only:
        publish_args.append("--dry-run")
    run(*publish_args)
    if args.dry_run:
        print("Daily brief dry run complete. No Notion page or Telegram alert was created.")
    elif args.verification_dry_run:
        print(
            "Daily brief verification dry run complete. Official evidence and "
            "structured event analysis were executed; no Notion page or Telegram "
            "alert was created."
        )


if __name__ == "__main__":
    main()
