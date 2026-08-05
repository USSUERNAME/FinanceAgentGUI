from __future__ import annotations

import json
import os
import tempfile
import unittest
from io import BytesIO
from pathlib import Path
from unittest.mock import patch
from urllib.error import HTTPError

from analyze_market_snapshot import (
    analysis_schema_for,
    analyze,
    bounded_input,
    bounded_us_equity_candidate_screen,
    canonicalize_event_scenarios,
    validate_analysis,
)
from build_daily_snapshot import (
    apply_event_link_gate,
    etf_leadership_summary,
    load_us_equity_candidate_screen,
    price_freshness,
    relative_return,
    rule_based_signal,
    source_quality_summary,
    upcoming_events,
)
from build_company_underwriting_drafts import underwriting_draft_hash
from approve_company_review_operating_config import operating_config_review_hash
from collectors import file_drop
from collectors.common import canonicalize_url, make_item
from collect_all import deduplicate_records
from compose_daily_brief import (
    FINAL_MARKER, FOLLOWUP_MONITOR_HEADING, OPERATING_REVIEW_HEADING, OPERATIONS_MONITOR_HEADING,
    REQUIRED_HEADINGS, THESIS_REVIEW_CALENDAR_HEADING,
    SLA_SUMMARY_HEADING, UNDERWRITING_REVIEW_HEADING, company_thesis_review_calendar_section,
    OWNER_QUEUE_HEADING, company_review_alert_owner_queue_section,
    SLA_TREND_HEADING, company_review_alert_sla_trend_section,
    COMPLETION_EVIDENCE_HEADING, company_review_alert_completion_evidence_section,
    EXTERNAL_EVIDENCE_BACKLOG_HEADING, company_review_alert_external_evidence_backlog_section,
    EXTERNAL_EVIDENCE_REVIEW_SUMMARY_HEADING, company_review_alert_external_evidence_review_summary_section,
    company_review_alert_sla_summary_section,
    company_review_alert_followup_monitor_section, company_review_operations_monitor_section, finalize_brief,
    deterministic_scoreboard_section,
    operations_report,
    reader_hypothesis_review,
    us_stock_analysis_reader_section,
    operating_config_approval_review_section, source_section,
    underwriting_approval_review_section,
    validate_publication_gate,
)
from generate_news_card import parse_cards
from publish_visual_brief import append_blocks, http_error_detail
from publish_to_notion import hero_summary_blocks, markdown_blocks, report_masthead, rich_text, scoreboard_blocks
from track_daily_hypotheses import update_history


class EvidenceMetadataTests(unittest.TestCase):
    def test_common_item_preserves_evidence_fields(self) -> None:
        item = make_item(
            source_id="official", source_type="macro_data",
            published_at="2026-07-18T00:00:00+00:00", title="Test", url="https://example.com",
            tickers=[], tags=["macro"], raw_text="value", rights_label="public",
            observation_date="2026-06-01", release_date=None,
            market_cutoff="latest_available_observation", source_grade="A",
            primary_source_confirmed=True, evidence_scope="observation_value",
            evidence_label="fact_provider_standardized", freshness_state="period_date_only",
        )
        self.assertEqual(item["observation_date"], "2026-06-01")
        self.assertIsNone(item["release_date"])
        self.assertEqual(item["source_grade"], "A")
        self.assertTrue(item["primary_source_confirmed"])
        self.assertIn("collected_at", item)
        self.assertEqual(item["canonical_url"], "https://example.com/")
        self.assertEqual(item["source_url_kind"], "primary_source")

    def test_json_escaped_url_is_cleaned_before_storage_and_canonicalization(self) -> None:
        item = make_item(
            source_id="news", source_type="international_news",
            published_at="2026-07-23T00:00:00+00:00", title="Escaped link",
            url=r"https:\/\/example.com\/story?item\\u003d1\\u0026utm_source\\u003dfeed",
            tickers=[], tags=[], raw_text="metadata", rights_label="metadata only",
        )
        self.assertEqual(item["url"], "https://example.com/story?item=1&utm_source=feed")
        self.assertEqual(item["canonical_url"], "https://example.com/story?item=1")

    def test_canonical_url_removes_tracking_and_fragment(self) -> None:
        self.assertEqual(
            canonicalize_url("https://www.Example.com/article/?utm_source=x&b=2#section"),
            "https://example.com/article?b=2",
        )

    def test_authorized_report_sidecar_preserves_lineage(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            drop = Path(directory)
            (drop / "report.md").write_text("# 반도체 리포트\n허가된 발췌문", encoding="utf-8")
            (drop / "report.meta.json").write_text(json.dumps({
                "publisher": "테스트증권",
                "title": "반도체 리포트",
                "source_url": "https://research.example.com/report/1?utm_source=mail",
                "published_at": "2026-07-20T01:00:00+00:00",
                "source_reference": "TEST-20260720-01",
                "acquisition_mode": "operator_authorized_local",
                "analysis_allowed": True,
                "redistribution_allowed": False,
                "publication_policy": "summary_and_link_only",
                "rights_review_status": "operator_confirmed",
                "tags": ["semiconductor"],
            }, ensure_ascii=False), encoding="utf-8")
            with patch.object(file_drop, "DROP_DIR", drop):
                items, notice = file_drop.collect({})
        self.assertIsNone(notice)
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]["publisher"], "테스트증권")
        self.assertEqual(items[0]["canonical_url"], "https://research.example.com/report/1")
        self.assertEqual(items[0]["source_reference"], "TEST-20260720-01")
        self.assertFalse(items[0]["research_rights"]["redistribution_allowed"])

    def test_canonical_dedup_keeps_stronger_lineage(self) -> None:
        weak = make_item(
            source_id="metadata", source_type="market_news",
            published_at="2026-07-20T00:00:00+00:00", title="Story",
            url="https://example.com/story?utm_source=feed", tickers=[], tags=[],
            raw_text="short", rights_label="metadata only", source_grade="D",
            publisher="Publisher", source_url_kind="publisher_article",
        )
        strong = make_item(
            source_id="official", source_type="official_release",
            published_at="2026-07-20T00:01:00+00:00", title="Story",
            url="https://www.example.com/story", tickers=[], tags=[],
            raw_text="longer primary source text", rights_label="public",
            source_grade="A", primary_source_confirmed=True,
            publisher="Official", source_url_kind="primary_source",
        )
        records, suppressed = deduplicate_records([weak, strong])
        self.assertEqual(suppressed, 1)
        self.assertEqual(len(records), 1)
        self.assertEqual(records[0]["source_id"], "official")
        self.assertEqual(records[0]["deduplication"]["duplicate_count"], 1)
        self.assertEqual(records[0]["deduplication"]["alternate_source_ids"], ["metadata"])


class SnapshotCalculationTests(unittest.TestCase):
    def test_missing_us_equity_screen_has_explicit_nonfatal_status(self) -> None:
        payload = load_us_equity_candidate_screen(
            Path("missing-candidate-screen.json"),
            "2026-07-23",
        )
        self.assertEqual(payload["screen_status"], "not_collected")
        self.assertEqual(payload["candidates"], [])
        self.assertEqual(payload["deep_analysis_shortlist"], [])
        self.assertEqual(
            payload["posture"],
            "research_screen_not_investment_recommendation",
        )

    def test_stale_us_equity_screen_is_not_merged_into_snapshot(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            path = Path(temp_dir) / "candidate_screen.json"
            path.write_text(json.dumps({
                "schema_version": "us_equity_candidate_screen.v1",
                "report_date": "2026-07-22",
                "screen_status": "deep_analysis_shortlist_ready",
                "candidates": [{"ticker": "NVDA"}],
            }), encoding="utf-8")
            payload = load_us_equity_candidate_screen(path, "2026-07-23")
        self.assertEqual(payload["screen_status"], "report_date_mismatch")
        self.assertEqual(payload["candidates"], [])

    def test_us_equity_screen_is_bounded_before_model_input(self) -> None:
        candidates = []
        for index in range(12):
            candidates.append({
                "ticker": f"T{index}",
                "company_name": f"Company {index}",
                "selection_score": 90 - index,
                "score_breakdown": {"official_material": 10},
                "material_candidate": True,
                "deep_analysis_eligible": True,
                "selection_reasons": ["material_event"],
                "market_reaction": {
                    "close": 100 + index,
                    "volume": 1_000_000,
                    "avg_volume_20d": 500_000,
                    "return_1d_pct": 2.0,
                    "return_5d_pct": 3.0,
                    "return_20d_pct": 4.0,
                    "volume_ratio_20d": 2.0,
                    "spy_relative_1d_pct": 1.0,
                    "spy_relative_5d_pct": 1.5,
                    "sector_etf": "XLK",
                    "sector_relative_1d_pct": 0.5,
                    "sector_return_1d_pct": 1.5,
                },
                "event_evidence": [
                    {
                        "record_id": f"event-{index}-{event_index}",
                        "title": "Official filing",
                        "event_type": "sec_8k",
                        "official_material_score": 10,
                        "source_grade": "A",
                        "primary_source_confirmed": True,
                        "evidence_scope": "filing_body",
                        "source_url": "https://www.sec.gov/example",
                        "raw_text": "must not reach model input",
                        "verified_facts": [{
                            "fact_id": f"fact-{index}-{event_index}",
                            "field": "sec_item",
                            "value_text": "2.02",
                            "context": "Item 2.02 Results of Operations.",
                            "evidence_status": "exact_text_excerpt",
                            "evidence_scope": "bounded_filing_body_excerpt",
                            "source_url": "https://www.sec.gov/example",
                            "extra": "must not reach model input",
                        }],
                    }
                    for event_index in range(3)
                ],
                "evidence_status": "primary_facts_available",
                "next_workflow": "bounded_company_analysis_card",
                "posture": "research_candidate_not_investment_recommendation",
            })
        screen = {
            "screen_status": "deep_analysis_shortlist_ready",
            "universe_security_count": 500,
            "market_covered_security_count": 500,
            "material_candidate_count": 12,
            "deep_analysis_count": 4,
            "market_source": {"provider": "licensed"},
            "methodology": {"maximum_candidates": 10},
            "candidates": candidates,
            "deep_analysis_shortlist": candidates[:4],
            "posture": "research_screen_not_investment_recommendation",
        }
        bounded = bounded_us_equity_candidate_screen(
            {"us_equity_candidate_screen": screen}
        )
        self.assertEqual(len(bounded["candidates"]), 10)
        self.assertEqual(bounded["deep_analysis_tickers"], ["T0", "T1", "T2"])
        self.assertEqual(len(bounded["candidates"][0]["event_evidence"]), 2)
        self.assertNotIn("close", bounded["candidates"][0]["market_reaction"])
        self.assertNotIn("volume", bounded["candidates"][0]["market_reaction"])
        self.assertNotIn(
            "raw_text",
            bounded["candidates"][0]["event_evidence"][0],
        )
        verified_fact = (
            bounded["candidates"][0]["event_evidence"][0]["verified_facts"][0]
        )
        self.assertEqual(verified_fact["fact_id"], "fact-0-0")
        self.assertNotIn("extra", verified_fact)

    def test_relative_return_is_ratio_based(self) -> None:
        self.assertAlmostEqual(relative_return(2.0, 1.0), 0.990099, places=5)

    def test_rule_signal_detects_broad_risk_support(self) -> None:
        scoreboard = {
            "breadth": {"rsp_vs_spy_5d_pct": 0.8},
            "volatility": {"vix_term_ratio": 0.9},
            "credit": {"spread_change_5d_pct_point": -0.1},
            "rates": {"real_yield_change_5d_pct_point": -0.1},
        }
        result = rule_based_signal(scoreboard)
        self.assertEqual(result["label"], "mild_risk_on")
        self.assertEqual(result["score"], 4)

    def test_rule_signal_detects_selective_rotation_when_breadth_is_broad_but_growth_is_weak(self) -> None:
        scoreboard = {
            "breadth": {"rsp_vs_spy_5d_pct": 0.8},
            "volatility": {"vix_term_ratio": 0.9},
            "credit": {"spread_change_5d_pct_point": -0.1},
            "rates": {"real_yield_change_5d_pct_point": 0.1},
        }
        etf_payload = {"items": [
            {"ticker": "SPY", "return_5d_pct": 1.0},
            {"ticker": "QQQ", "return_5d_pct": 0.2},
            {"ticker": "IWM", "return_5d_pct": 0.4},
            {"ticker": "GLD", "return_5d_pct": 2.0},
        ]}
        result = rule_based_signal(scoreboard, etf_payload)
        self.assertEqual(result["label"], "selective_rotation")
        self.assertEqual(
            result["classification_reason"],
            "breadth_positive_but_growth_or_small_caps_weak",
        )
        self.assertLess(result["participation"]["qqq_vs_spy_5d_pct"], -0.25)

    def test_rule_signal_requires_broad_participation_for_risk_on(self) -> None:
        scoreboard = {
            "breadth": {"rsp_vs_spy_5d_pct": 0.8},
            "volatility": {"vix_term_ratio": 0.9},
            "credit": {"spread_change_5d_pct_point": -0.1},
            "rates": {"real_yield_change_5d_pct_point": -0.1},
        }
        etf_payload = {"items": [
            {"ticker": "SPY", "return_5d_pct": 1.0},
            {"ticker": "QQQ", "return_5d_pct": 2.0},
            {"ticker": "IWM", "return_5d_pct": 1.8},
            {"ticker": "GLD", "return_5d_pct": 0.2},
        ]}
        result = rule_based_signal(scoreboard, etf_payload)
        self.assertEqual(result["label"], "mild_risk_on")
        self.assertEqual(result["classification_reason"], "broad_risk_participation")

    def test_upcoming_events_and_source_quality_are_bounded(self) -> None:
        events = upcoming_events("2026-07-18", {"market_calendar": [
            {"date": "2026-07-21", "title": "이벤트", "source": "공식"},
            {"date": "2026-08-01", "title": "범위 밖", "source": "공식"},
        ]})
        self.assertEqual(len(events), 1)
        quality = source_quality_summary([{
            "source_grade": "A", "source_type": "macro_data",
            "primary_source_confirmed": True, "url": "https://example.com",
            "publisher": "Official", "rights_label": "public", "link_required": True,
        }])
        self.assertEqual(quality["evidence_posture"], "research_grade")
        self.assertEqual(quality["primary_confirmation_rate_pct"], 100.0)
        self.assertTrue(quality["publication_allowed"])

    def test_source_quality_blocks_missing_news_link(self) -> None:
        quality = source_quality_summary([{
            "source_grade": "D", "source_type": "international_news",
            "primary_source_confirmed": False, "url": "", "publisher": "Publisher",
            "rights_label": "metadata only", "link_required": True,
        }])
        self.assertFalse(quality["publication_allowed"])
        self.assertEqual(quality["evidence_posture"], "insufficient")
        self.assertEqual(quality["blockers"]["required_source_missing_url"], 1)

    def test_authorized_report_without_url_is_monitoring_only(self) -> None:
        quality = source_quality_summary([{
            "source_grade": "INTERNAL", "source_type": "broker_report",
            "primary_source_confirmed": False, "url": "", "publisher": "테스트증권",
            "rights_label": "internal permitted", "link_required": True,
            "source_reference": "TEST-01",
        }])
        self.assertTrue(quality["publication_allowed"])
        self.assertEqual(quality["evidence_posture"], "monitoring_only")
        self.assertEqual(quality["warnings"]["broker_report_reference_only"], 1)

    def test_duplicate_urls_and_confirmed_event_links_are_gated(self) -> None:
        records = [{
            "id": str(index), "source_grade": "C", "source_type": "market_news",
            "primary_source_confirmed": False,
            "url": f"https://example.com/story?utm_source={index}",
            "publisher": "Publisher", "rights_label": "metadata only", "link_required": True,
        } for index in range(2)]
        quality = source_quality_summary(records)
        self.assertEqual(quality["unique_canonical_url_count"], 1)
        self.assertEqual(quality["duplicate_canonical_url_record_count"], 1)
        self.assertTrue(quality["publication_allowed"])
        self.assertEqual(quality["evidence_posture"], "research_grade")
        gated = apply_event_link_gate(quality, [{
            "date_confidence": "confirmed_primary", "source_url": "",
        }])
        self.assertFalse(gated["publication_allowed"])
        self.assertEqual(gated["blockers"]["confirmed_event_missing_primary_url"], 1)

    def test_etf_leadership_is_ranked_without_model_math(self) -> None:
        payload = {"source_grade": "B", "items": [
            {"ticker": "SPY", "name": "S&P 500", "as_of": "2026-07-17", "return_1d_pct": 1.0, "return_5d_pct": 2.0, "return_20d_pct": 3.0},
            {"ticker": "SOXX", "name": "반도체", "as_of": "2026-07-17", "return_1d_pct": 2.0, "return_5d_pct": 4.0, "return_20d_pct": 5.0},
            {"ticker": "XLE", "name": "에너지", "as_of": "2026-07-17", "return_1d_pct": -1.0, "return_5d_pct": -2.0, "return_20d_pct": 1.0},
        ]}
        summary = etf_leadership_summary(payload)
        self.assertEqual(summary["horizons"]["1d"]["leaders"][0]["ticker"], "SOXX")
        self.assertEqual(summary["horizons"]["1d"]["laggards"][0]["ticker"], "SPY")
        self.assertAlmostEqual(summary["horizons"]["5d"]["leaders"][0]["vs_spy_pct"], 1.96, places=2)

    def test_price_freshness_exposes_calendar_gap(self) -> None:
        freshness = price_freshness("2026-07-20", ["2026-07-16", "2026-07-17"])
        self.assertEqual(freshness["latest_price_as_of"], "2026-07-17")
        self.assertEqual(freshness["calendar_gap_days"], 3)
        self.assertEqual(freshness["status"], "latest_available_close_precedes_report_date")


class NotionPublishBatchingTests(unittest.TestCase):
    def test_append_blocks_chunks_requests_at_notion_limit(self) -> None:
        blocks = [{"object": "block", "type": "divider", "divider": {}} for _ in range(205)]
        with patch("publish_visual_brief.api_json", return_value={}) as api_json:
            append_blocks("page-id", blocks, "token")
        self.assertEqual([len(call.args[3]["children"]) for call in api_json.call_args_list], [100, 100, 5])

    def test_http_error_detail_includes_status_and_response(self) -> None:
        error = HTTPError(
            "https://api.notion.com/v1/blocks/page/children",
            400,
            "Bad Request",
            {},
            BytesIO(b'{"code":"validation_error","message":"too many children"}'),
        )
        detail = http_error_detail(error)
        self.assertIn("HTTP 400 Bad Request", detail)
        self.assertIn("too many children", detail)


class NotionEditorialDashboardTests(unittest.TestCase):
    def test_markdown_source_link_becomes_notion_hyperlink(self) -> None:
        fragments = rich_text("출처: [SEC 원문](https://www.sec.gov/example) 확인")
        self.assertEqual(fragments[1]["text"]["content"], "SEC 원문")
        self.assertEqual(fragments[1]["text"]["link"]["url"], "https://www.sec.gov/example")

    def test_hero_uses_conclusion_and_three_signal_cards(self) -> None:
        blocks = hero_summary_blocks([
            "시장 체제: mild risk-on · 65%",
            "오늘의 결론: 시장 폭은 개선됐지만 실질금리를 확인한다.",
            "핵심 변수: RSP/SPY와 실질 10년물",
            "최우선 리스크: 고용 발표 변동성",
        ])
        self.assertEqual([block["type"] for block in blocks], ["callout", "column_list"])
        columns = blocks[1]["column_list"]["children"]
        self.assertEqual(len(columns), 3)
        self.assertIn("시장 체제", columns[0]["column"]["children"][0]["callout"]["rich_text"][0]["text"]["content"])
        self.assertEqual(
            [column["column"]["children"][0]["callout"]["icon"]["emoji"] for column in columns],
            ["📊", "🔎", "⚠️"],
        )
        self.assertEqual(
            [column["column"]["children"][0]["callout"]["color"] for column in columns],
            ["gray_background", "yellow_background", "red_background"],
        )

    def test_masthead_uses_brand_and_as_of_cards(self) -> None:
        masthead = report_masthead("2026-07-20 리포트")
        self.assertEqual(masthead["type"], "column_list")
        columns = masthead["column_list"]["children"]
        self.assertEqual(len(columns), 2)
        left = columns[0]["column"]["children"][0]["callout"]
        right = columns[1]["column"]["children"][0]["callout"]
        self.assertIn("PB RESEARCH", left["rich_text"][0]["text"]["content"])
        self.assertIn("2026-07-20", right["rich_text"][0]["text"]["content"])
        self.assertEqual([left["color"], right["color"]], ["blue_background", "yellow_background"])

    def test_scoreboard_uses_two_column_kpi_rows_and_full_width_signal(self) -> None:
        blocks = scoreboard_blocks(["breadth", "volatility", "credit", "rates", "모니터링 신호: 중립"])
        self.assertEqual([block["type"] for block in blocks], ["column_list", "column_list", "callout"])
        self.assertEqual(len(blocks[0]["column_list"]["children"]), 2)
        self.assertEqual(len(blocks[1]["column_list"]["children"]), 2)
        self.assertIn("모니터링 신호", blocks[2]["callout"]["rich_text"][0]["text"]["content"])
        self.assertEqual(blocks[2]["callout"]["icon"]["emoji"], "🔎")
        first_row_icons = [
            column["column"]["children"][0]["callout"]["icon"]["emoji"]
            for column in blocks[0]["column_list"]["children"]
        ]
        self.assertEqual(first_row_icons, ["📈", "🌡️"])

    def test_markdown_parser_applies_dashboard_sections(self) -> None:
        _, blocks = markdown_blocks("""# 2026-07-20 리포트
## 오늘의 결론
- 시장 체제: neutral · 55%
- 오늘의 결론: 혼조 신호를 확인한다.
- 핵심 변수: 금리와 시장 폭
- 최우선 리스크: 이벤트 변동성
## 데이터 기준과 수집 상태
- 생성 시각 · 가격 기준일 · 가격 지연 · 뉴스 범위
- 지연 데이터 없음
## 시장 스코어보드
- RSP/SPY +0.4%
- VIX 17.2
- 실질금리 2.1%
""")
        column_lists = [block for block in blocks if block["type"] == "column_list"]
        self.assertEqual(len(column_lists), 2)
        scoreboard_cards = [
            column["column"]["children"][0]["callout"]
            for column in column_lists[-1]["column_list"]["children"]
        ]
        self.assertTrue(any("RSP/SPY" in card["rich_text"][0]["text"]["content"] for card in scoreboard_cards))
        final_metric = next(
            block for block in blocks
            if block["type"] == "callout"
            and "실질금리" in block["callout"]["rich_text"][0]["text"]["content"]
        )
        self.assertEqual(final_metric["callout"]["icon"]["emoji"], "💹")
        gray_status = next(block for block in blocks if block["type"] == "callout" and block["callout"]["color"] == "gray_background")
        self.assertIn("생성 시각", gray_status["callout"]["rich_text"][0]["text"]["content"])

    def test_process_sections_render_as_editorial_cards(self) -> None:
        _, blocks = markdown_blocks("""# 2026-07-20 리포트
## 전일 가설 점검
- 반도체 상대강도 가설 · 적중
## 향후 이벤트 시나리오
- 07.21 CPI · 상방/하방 조건
## 가설 누적 성과
- 적중 3 · 실패 1 · 판정 표본 4
## 다음 확인 항목
- 실질금리와 시장 폭 재확인
""")
        cards = [block["callout"] for block in blocks if block["type"] == "callout"]
        self.assertEqual(
            [card["icon"]["emoji"] for card in cards],
            ["🧪", "📅", "✅", "🔎"],
        )
        self.assertEqual(
            [card["color"] for card in cards],
            ["blue_background", "orange_background", "gray_background", "gray_background"],
        )

    def test_underwriting_review_uses_one_card_per_company_and_nested_details(self) -> None:
        _, blocks = markdown_blocks("""# 2026-07-20 리포트
## 언더라이팅 승인 검토
승인 대기 1건입니다.
- GEV · GE Vernova · 승인 전 초안
  - 초안 해시: `abc123`
  - 제안 회사 논리: 검토 필요
""")
        cards = [block["callout"] for block in blocks if block["type"] == "callout"]
        self.assertEqual(len(cards), 1)
        self.assertEqual(cards[0]["icon"]["emoji"], "🧾")
        self.assertEqual(cards[0]["color"], "purple_background")
        nested = [block for block in blocks if block["type"] == "bulleted_list_item"]
        self.assertEqual(len(nested), 2)

    def test_operating_review_uses_blue_gear_card(self) -> None:
        _, blocks = markdown_blocks("""# 2026-07-20 리포트
## 운영 설정 승인 검토
승인 대기 1건입니다.
- GEV · GE Vernova · 승인 전 운영 설정 v1
  - 검토 해시: `abc123`
  - 검토 주기: event_driven
""")
        cards = [block["callout"] for block in blocks if block["type"] == "callout"]
        self.assertEqual(len(cards), 1)
        self.assertEqual(cards[0]["icon"]["emoji"], "⚙️")
        self.assertEqual(cards[0]["color"], "blue_background")

    def test_operations_monitor_uses_yellow_timer_card(self) -> None:
        _, blocks = markdown_blocks("""# 2026-07-20 리포트
## 운영 알림 모니터
검토 1건입니다.
- GEV · 2026-11-05 · 확인 필요
  - 사전 준비: 오늘 마감·완료 미확인
""")
        card = next(block["callout"] for block in blocks if block["type"] == "callout")
        self.assertEqual(card["icon"]["emoji"], "⏱️")
        self.assertEqual(card["color"], "yellow_background")

    def test_company_thesis_calendar_uses_orange_review_cards(self) -> None:
        _, blocks = markdown_blocks("""# 2026-07-20 리포트
## 회사 논리 검토 캘린더
확정 검토 1건입니다.
- GEV · GE Vernova · confirmed_review_date_available
  - 확정 일정 1: 2026-11-05
""")
        card = next(block["callout"] for block in blocks if block["type"] == "callout")
        self.assertEqual(card["icon"]["emoji"], "📅")
        self.assertEqual(card["color"], "orange_background")

    def test_internal_completion_marker_is_not_rendered(self) -> None:
        _, blocks = markdown_blocks("""# 2026-07-20 리포트
## 출처 및 유의사항
- 출처 검증 수준: 연구용 기준 충족
<!-- REPORT_COMPLETE -->
""")
        rendered = str(blocks)
        self.assertNotIn("REPORT_COMPLETE", rendered)
        self.assertIn("연구용 기준 충족", rendered)


class MarketAnalysisValidationTests(unittest.TestCase):
    def analysis(self, evidence: list[str]) -> dict:
        return {
            "market_regime": {
                "label": "neutral", "confidence": 0.5, "summary": "혼조",
                "quantitative_evidence": evidence,
            },
            "key_drivers": [{
                "observation": "관측", "interpretation": "해석",
                "confirmation_condition": "확인", "invalidation_condition": "무효화",
            }],
            "hypotheses": [{
                "claim": "시장 폭 개선", "metric_key": "rsp_vs_spy_5d_pct",
                "expected_direction": "increase", "horizon_reports": 1, "rationale": "확산 확인",
            }],
            "event_scenarios": [],
            "stock_analysis_cards": [],
            "conflicting_signals": [], "top_risks": [], "data_warnings": [],
        }

    def test_analysis_requires_two_quantitative_observations(self) -> None:
        with self.assertRaises(ValueError):
            validate_analysis(self.analysis(["one"]))
        validate_analysis(self.analysis(["one", "two"]))

    def test_analysis_requires_scenarios_for_supplied_events(self) -> None:
        snapshot = {
            "market_scoreboard": {"breadth": {"rsp_vs_spy_5d_pct": 0.2}},
            "etf_metrics": {"items": []},
            "upcoming_events": [{"event_id": "2026-07-21-E1"}],
        }
        with self.assertRaises(ValueError):
            validate_analysis(self.analysis(["one", "two"]), snapshot)

    def test_stock_card_schema_and_validation_follow_verified_shortlist(self) -> None:
        candidate = {
            "ticker": "NVDA",
            "evidence_status": "primary_facts_available",
            "event_evidence": [{
                "verified_facts": [{
                    "fact_id": "fact-1",
                    "source_url": "https://www.sec.gov/example",
                }],
            }],
        }
        snapshot = {
            "market_scoreboard": {"breadth": {"rsp_vs_spy_5d_pct": 0.2}},
            "etf_metrics": {"items": []},
            "upcoming_events": [],
            "us_equity_candidate_screen": {
                "deep_analysis_shortlist": [candidate],
            },
        }
        card_schema = analysis_schema_for(snapshot)["properties"]["stock_analysis_cards"]
        self.assertEqual(card_schema["minItems"], 1)
        self.assertEqual(card_schema["maxItems"], 1)
        self.assertEqual(
            card_schema["items"]["properties"]["ticker"]["enum"],
            ["NVDA"],
        )
        analysis = self.analysis(["one", "two"])
        with self.assertRaisesRegex(ValueError, "verified shortlist"):
            validate_analysis(analysis, snapshot)
        analysis["stock_analysis_cards"] = [{
            "ticker": "NVDA",
            "selection_reason": "공식 공시와 상대수익률 이상이 함께 포착됨",
            "market_reaction_interpretation": "공시 이후 가격 반응의 지속성 확인 필요",
            "sector_read_through": "SOXX 동반 여부 확인 필요",
            "confirmation_condition": "상대강도와 거래량이 함께 유지되는지 확인",
            "invalidation_condition": "섹터가 안정되는 가운데 종목만 약세면 무효화",
            "evidence_status": "verified_primary_facts",
            "action_posture": "deeper_research_candidate",
        }]
        validate_analysis(analysis, snapshot)

    def test_event_baseline_and_source_posture_are_canonical(self) -> None:
        analysis = self.analysis(["one", "two"])
        analysis["event_scenarios"] = [{
            "event_id": "2026-07-21-E1", "baseline": "invented",
            "higher_or_stronger_case": "상방", "lower_or_weaker_case": "하방",
            "monitoring_assets": ["SPY"], "source_posture": "invented",
        }]
        snapshot = {"upcoming_events": [{
            "event_id": "2026-07-21-E1", "consensus": None,
            "date_confidence": "confirmed_primary",
        }]}
        canonicalize_event_scenarios(analysis, snapshot)
        self.assertEqual(analysis["event_scenarios"][0]["baseline"], "컨센서스 자료 없음")
        self.assertEqual(analysis["event_scenarios"][0]["source_posture"], "confirmed_primary")

    def test_responses_request_uses_strict_json_schema_format(self) -> None:
        expected = self.analysis(["breadth 0.5", "VIX ratio 0.9"])
        response_payload = json.dumps({
            "output_text": json.dumps(expected, ensure_ascii=False),
            "usage": {"input_tokens": 10, "output_tokens": 20},
        }).encode("utf-8")

        class FakeResponse:
            def __enter__(self):
                return self

            def __exit__(self, *args):
                return False

            def read(self):
                return response_payload

        captured = {}

        def fake_urlopen(request, timeout):
            captured["body"] = json.loads(request.data.decode("utf-8"))
            captured["timeout"] = timeout
            return FakeResponse()

        with patch.dict(os.environ, {"OPENAI_API_KEY": "test-key", "OPENAI_ANALYSIS_MODEL": "gpt-5-mini"}), \
                patch("analyze_market_snapshot.urlopen", side_effect=fake_urlopen):
            result, usage = analyze({
                "report_date": "2026-07-18", "records": [],
                "market_scoreboard": {"breadth": {"rsp_vs_spy_5d_pct": 0.2}},
                "etf_metrics": {"items": []}, "upcoming_events": [],
            })

        output_format = captured["body"]["text"]["format"]
        self.assertEqual(output_format["type"], "json_schema")
        self.assertTrue(output_format["strict"])
        self.assertEqual(
            output_format["schema"]["properties"]["hypotheses"]["items"]
            ["properties"]["metric_key"]["enum"],
            ["rsp_vs_spy_5d_pct"],
        )
        supplied_input = json.loads(captured["body"]["input"])
        self.assertEqual(
            supplied_input["available_hypothesis_metrics"],
            {"rsp_vs_spy_5d_pct": 0.2},
        )
        self.assertEqual(result, expected)
        self.assertEqual(usage["output_tokens"], 20)

    def test_schema_and_input_exclude_unavailable_hypothesis_metrics(self) -> None:
        snapshot = {
            "market_scoreboard": {
                "breadth": {"rsp_vs_spy_5d_pct": None},
                "volatility": {"vix_term_ratio": 0.91},
            },
            "etf_metrics": {"items": []},
        }
        metric_enum = (
            analysis_schema_for(snapshot)["properties"]["hypotheses"]["items"]
            ["properties"]["metric_key"]["enum"]
        )
        self.assertEqual(metric_enum, ["vix_term_ratio"])
        self.assertEqual(
            bounded_input(snapshot)["available_hypothesis_metrics"],
            {"vix_term_ratio": 0.91},
        )

    def test_invalid_metric_retries_then_uses_deterministic_fallback(self) -> None:
        invalid = self.analysis(["VIX 0.91", "credit 2.8"])
        response_payload = json.dumps({
            "output_text": json.dumps(invalid, ensure_ascii=False),
            "usage": {"input_tokens": 10, "output_tokens": 20},
        }).encode("utf-8")

        class FakeResponse:
            def __enter__(self):
                return self

            def __exit__(self, *args):
                return False

            def read(self):
                return response_payload

        captured_bodies = []

        def fake_urlopen(request, timeout):
            captured_bodies.append(json.loads(request.data.decode("utf-8")))
            return FakeResponse()

        snapshot = {
            "report_date": "2026-07-23",
            "records": [],
            "market_scoreboard": {"volatility": {"vix_term_ratio": 0.91}},
            "etf_metrics": {"items": []},
            "upcoming_events": [],
        }
        with patch.dict(os.environ, {"OPENAI_API_KEY": "test-key"}), \
                patch("analyze_market_snapshot.urlopen", side_effect=fake_urlopen):
            result, _ = analyze(snapshot)

        self.assertEqual(len(captured_bodies), 2)
        self.assertIn("previous response selected", captured_bodies[1]["instructions"])
        self.assertEqual(result["hypotheses"][0]["metric_key"], "vix_term_ratio")
        self.assertIn("저확신 규칙 기반", result["hypotheses"][0]["rationale"])
        self.assertTrue(any(
            "저확신 규칙 기반" in warning for warning in result["data_warnings"]
        ))


class HypothesisTrackingTests(unittest.TestCase):
    def snapshot(self, breadth: float) -> dict:
        return {
            "market_scoreboard": {"breadth": {"rsp_vs_spy_5d_pct": breadth}},
            "etf_metrics": {"items": []},
        }

    def test_hypothesis_is_evaluated_on_next_report(self) -> None:
        analysis = {"hypotheses": [{
            "claim": "시장 폭 개선", "metric_key": "rsp_vs_spy_5d_pct",
            "expected_direction": "increase", "horizon_reports": 1, "rationale": "확산 확인",
        }]}
        history, first_review = update_history({"records": []}, "2026-07-18", self.snapshot(0.1), analysis)
        self.assertEqual(first_review["created_today"][0]["status"], "pending")
        history, second_review = update_history(history, "2026-07-19", self.snapshot(0.5), {"hypotheses": []})
        self.assertEqual(second_review["resolved_today"][0]["status"], "hit")
        self.assertEqual(second_review["cumulative_summary"]["decisive_hit_rate_pct"], 100.0)
        _, rerun_review = update_history(history, "2026-07-19", self.snapshot(0.5), {"hypotheses": []})
        self.assertEqual(rerun_review["resolved_today"][0]["status"], "hit")


class BriefCompletionTests(unittest.TestCase):
    def complete_text(self) -> str:
        parts = ["# 2026-07-18 리포트"]
        for heading in REQUIRED_HEADINGS:
            parts.extend([f"## {heading}", "- 내용"])
        parts.append(FINAL_MARKER)
        return "\n".join(parts)

    def test_finalizer_rejects_missing_completion_marker(self) -> None:
        with self.assertRaises(ValueError):
            finalize_brief(self.complete_text().replace(FINAL_MARKER, ""), [], "2026-07-18", {})

    def test_finalizer_replaces_sources_deterministically(self) -> None:
        item = {
            "source_id": "official", "publisher": "Official Publisher",
            "source_grade": "A", "source_url_kind": "primary_source",
            "title": "원자료", "url": "https://example.com/source",
            "canonical_url": "https://example.com/source",
        }
        snapshot = {"source_quality": {
            "evidence_posture": "research_grade", "link_coverage_pct": 100.0,
            "unique_canonical_url_count": 1, "duplicate_canonical_url_record_count": 0,
        }}
        result = finalize_brief(self.complete_text(), [item], "2026-07-18", snapshot)
        self.assertIn(
            "[Official Publisher · official · 등급 A · primary_source · 원자료](https://example.com/source)",
            result,
        )
        self.assertIn("링크 계보: 연결률 100.0% · 고유 원문 1개 · 중복 레코드 0개", result)
        self.assertIn("출처 검증 수준: 연구용 기준 충족", result)
        self.assertNotIn("증거 상태: research_grade", result)
        self.assertTrue(result.rstrip().endswith(FINAL_MARKER))

    def test_scoreboard_is_replaced_with_fixed_korean_labels(self) -> None:
        snapshot = {
            "market_scoreboard": {
                "breadth": {"rsp_vs_spy_1d_pct": -0.16, "rsp_vs_spy_5d_pct": 0.10, "rsp_vs_spy_20d_pct": 1.81},
                "volatility": {"vix": {"value": 18.77}, "vix3m": {"value": 20.54}, "vix_term_ratio": 0.9146},
                "credit": {"high_yield_oas": {"value": 2.73}, "spread_change_5d_pct_point": 0.04},
                "rates": {
                    "nominal_10y": {"value": 4.38}, "real_10y": {"value": 2.01},
                    "real_yield_change_5d_pct_point": -0.03,
                },
                "rule_based_signal": {"label": "neutral", "score": 0},
            },
        }
        section = deterministic_scoreboard_section(snapshot)
        self.assertIn("시장 폭 · RSP/SPY 상대수익률: 1일 -0.16%p · 5일 +0.10%p · 20일 +1.81%p", section)
        self.assertIn("변동성 · VIX: VIX 18.77 · VIX3M 20.54 · 기간비율 0.91", section)
        self.assertIn("모니터링 신호: 중립 (점수 +0/±4)", section)
        self.assertNotIn("rsp_vs_spy_5d_pct", section)

    def test_verified_stock_card_is_rendered_with_fact_and_watchlist_boundary(self) -> None:
        verified = {
            "ticker": "NVDA",
            "company_name": "NVIDIA",
            "selection_score": 75,
            "selection_reasons": ["material_event", "volume_anomaly"],
            "market_reaction": {
                "return_1d_pct": -6.2,
                "return_5d_pct": -4.0,
                "return_20d_pct": 3.0,
                "spy_relative_1d_pct": -5.8,
                "volume_ratio_20d": 2.7,
            },
            "event_evidence": [{
                "verified_facts": [{
                    "field": "sec_item",
                    "value_text": "5.02",
                    "evidence_status": "exact_text_excerpt",
                    "source_url": "https://www.sec.gov/example",
                }],
            }],
            "evidence_status": "primary_facts_available",
        }
        watch = {
            "ticker": "MSFT",
            "company_name": "Microsoft",
            "selection_score": 30,
            "selection_reasons": ["abnormal_spy_relative_move"],
            "evidence_status": "market_anomaly_without_primary_material",
        }
        snapshot = {"us_equity_candidate_screen": {
            "deep_analysis_shortlist": [verified],
            "candidates": [verified, watch],
        }}
        analysis = {"analysis": {"stock_analysis_cards": [{
            "ticker": "NVDA",
            "market_reaction_interpretation": "가격 반응의 지속 여부를 확인한다.",
            "sector_read_through": "반도체 업종 동반 여부를 확인한다.",
            "confirmation_condition": "상대강도와 거래량이 함께 유지된다.",
            "invalidation_condition": "업종 안정 속 종목만 추가 약세를 보인다.",
        }]}}
        section = us_stock_analysis_reader_section(snapshot, analysis)
        self.assertIn("### 미국 개별주 분석", section)
        self.assertIn("- NVIDIA · NVDA · 심층 조사 후보", section)
        self.assertIn("[sec_item = 5.02 · exact_text_excerpt](https://www.sec.gov/example)", section)
        self.assertIn("시장 반응 [인과 미확정]", section)
        self.assertIn("### 이상 움직임 관찰", section)
        self.assertIn("Microsoft · MSFT", section)
        self.assertIn("투자 추천, 목표가격, 포지션 행동 아님", section)
        _, blocks = markdown_blocks(f"# Test\n## 종목 및 공시\n{section}")
        block_types = [block["type"] for block in blocks]
        self.assertIn("heading_3", block_types)
        self.assertIn("callout", block_types)
        self.assertIn("bulleted_list_item", block_types)

    def test_reader_hypothesis_rate_requires_ten_decisive_results(self) -> None:
        review = {"cumulative_summary": {
            "counts": {"hit": 0, "miss": 1, "inconclusive": 3, "pending": 4},
            "decisive_hit_rate_pct": 0.0,
        }}
        bounded = reader_hypothesis_review(review)
        summary = bounded["cumulative_summary"]
        self.assertNotIn("decisive_hit_rate_pct", summary)
        self.assertEqual(summary["decisive_result_count"], 1)
        self.assertEqual(summary["reader_performance_status"], "minimum_sample_not_met")

        review["cumulative_summary"]["counts"] = {
            "hit": 7, "miss": 3, "inconclusive": 3, "pending": 4,
        }
        review["cumulative_summary"]["decisive_hit_rate_pct"] = 70.0
        public = reader_hypothesis_review(review)["cumulative_summary"]
        self.assertEqual(public["decisive_hit_rate_pct"], 70.0)
        self.assertEqual(public["reader_performance_status"], "available")

    def test_finalizer_keeps_operations_out_of_reader_brief_and_preserves_internal_report(self) -> None:
        draft = {
            "ticker": "GEV", "company_name": "GE Vernova", "version": 1,
            "one_sentence_thesis": "Draft: source-bounded company case",
            "variant_perception": "not_established_requires_user_or_pm_view",
            "horizon": "requires_user_or_pm_input", "market_setup": "not established",
            "pillars": [{"claim": "Revenue execution holds", "next_proof_point": "Next filing"}],
            "kill_criteria": [{
                "claim": "Revenue falls below range", "match_values": ["weaker_evidence"],
                "threshold_approval_status": "draft_pending_user_approval",
            }],
            "source_index": [{
                "source_name": "GEV filing", "source_type": "filing",
                "as_of_date": "2026-07-18", "source_location": "https://www.sec.gov/example",
            }],
            "open_diligence": ["Define variant perception"],
        }
        draft_hash = underwriting_draft_hash(draft)
        snapshot = {
            "company_underwriting_drafts": {"companies": [{
                "ticker": "GEV", "company_name": "GE Vernova",
                "draft_status": "ready_for_user_or_pm_review",
                "draft_hash": draft_hash, "draft_record": draft,
            }]},
            "source_quality": {"evidence_posture": "monitoring_only"},
        }
        result = finalize_brief(self.complete_text(), [], "2026-07-18", snapshot)
        internal = operations_report("2026-07-18", snapshot)
        for heading in (
            THESIS_REVIEW_CALENDAR_HEADING,
            OPERATIONS_MONITOR_HEADING,
            OPERATING_REVIEW_HEADING,
            UNDERWRITING_REVIEW_HEADING,
        ):
            self.assertNotIn(f"## {heading}", result)
            self.assertIn(f"## {heading}", internal)
        self.assertNotIn("`" + draft_hash + "`", result)
        self.assertIn("`" + draft_hash + "`", internal)
        self.assertIn("Revenue execution holds", internal)
        self.assertIn("내부 운영 및 검토 로그", internal)

    def test_empty_underwriting_queue_is_explicit_and_non_approving(self) -> None:
        result = underwriting_approval_review_section({"companies": []})
        self.assertIn("승인 대기 초안이 없습니다", result)
        self.assertIn("자동 승인 없음", result)

    def test_underwriting_review_blocks_tampered_draft_hash(self) -> None:
        result = underwriting_approval_review_section({"companies": [{
            "ticker": "GEV", "draft_status": "ready_for_user_or_pm_review",
            "draft_hash": "0" * 64, "draft_record": {"ticker": "GEV", "version": 1},
        }]})
        self.assertIn("초안 무결성 검사 실패 1건", result)
        self.assertNotIn("`" + "0" * 64 + "`", result)

    def test_operating_review_renders_exact_hash_roles_and_non_approval_limit(self) -> None:
        record = {
            "operating_config_id": "company:GEV:review-operations:v1",
            "ticker": "GEV", "company_name": "GE Vernova", "version": 1,
            "effective_from": "2026-07-18",
            "owners": {
                "decision_authority": "portfolio_manager", "pm_owner": "portfolio_manager",
                "analyst_owner": "research_analyst", "evidence_owner": "research_analyst",
                "kpi_owner": "research_analyst", "model_owner": "model_analyst",
                "decision_log_owner": "portfolio_manager",
            },
            "review_policy": {
                "cadence": "event_driven", "next_scheduled_review_date": "2026-11-05",
                "prep_lead_time": {"value": 5, "unit": "calendar_days"},
                "post_event_update_sla": {
                    "value": 24, "unit": "hours",
                    "start_condition": "verified_primary_results_available",
                },
                "escalation_triggers": ["Confirmed event date changes"],
            },
            "automatic_position_action_allowed": False,
        }
        review_hash = operating_config_review_hash(record)
        result = operating_config_approval_review_section({"companies": [{
            "ticker": "GEV", "company_name": "GE Vernova", "version": 1,
            "review_status": "ready_for_user_or_pm_review", "review_hash": review_hash,
            "draft_record": record, "approval_executed": False,
            "security_or_position_action_approved": False,
        }]})
        self.assertIn("`" + review_hash + "`", result)
        self.assertIn("분석 research_analyst", result)
        self.assertIn("사후 업데이트 SLA: 24시간", result)
        self.assertIn("APPROVE_COMPANY_REVIEW_OPERATIONS", result)
        self.assertIn("포지션 행동 승인 없음", result)

    def test_operating_review_blocks_tampered_hash(self) -> None:
        result = operating_config_approval_review_section({"companies": [{
            "ticker": "GEV", "version": 1,
            "review_status": "ready_for_user_or_pm_review", "review_hash": "0" * 64,
            "draft_record": {"ticker": "GEV", "version": 1},
        }]})
        self.assertIn("검토 해시 불일치 1건", result)
        self.assertNotIn("`" + "0" * 64 + "`", result)

    def test_operating_review_shows_generated_draft_as_completion_work(self) -> None:
        result = operating_config_approval_review_section({"companies": [{
            "ticker": "GEV", "company_name": "GE Vernova", "version": 1,
            "input_file": "workspace/company_review_operating_inputs/GEV_v1.json",
            "review_status": "generated_requires_user_or_pm_completion",
            "review_hash": None,
            "missing_completion_fields": ["pm_owner", "analyst_owner"],
            "draft_record": {
                "ticker": "GEV", "company_name": "GE Vernova", "version": 1,
                "review_policy": {
                    "cadence": "event_driven",
                    "prep_lead_time": {"value": 5, "unit": "calendar_days"},
                    "post_event_update_sla": {
                        "value": 24, "unit": "hours",
                        "start_condition": "verified_primary_results_available",
                    },
                },
            },
        }]})
        self.assertIn("운영 설정 입력 필요 v1", result)
        self.assertIn("pm_owner, analyst_owner", result)
        self.assertIn("다음 일일 실행에서 검토 해시가 생성됨", result)
        self.assertIn("초안은 미승인", result)

    def test_operations_monitor_renders_deadline_escalation_without_external_action(self) -> None:
        result = company_review_operations_monitor_section({
            "monitored_review_count": 1, "attention_count": 0, "critical_count": 1,
            "observed_at": "2026-10-31T13:00:00+00:00",
            "reviews": [{
                "ticker": "GEV", "event_date": "2026-10-30",
                "alert_level": "critical_review_required",
                "prep_status": "completed_on_time", "prep_owner": "research_analyst",
                "prep_due_date": "2026-10-25", "prep_first_observed_at": "2026-10-25T08:00:00+00:00",
                "sla_status": "sla_breached_update_unconfirmed",
                "sla_clock_started_at": "2026-10-30T12:00:00+00:00",
                "sla_deadline": "2026-10-31T12:00:00+00:00",
                "formal_update_first_observed_at": None,
                "escalation_reasons": ["post_event_update_sla_missed_or_late"],
                "escalation_owner": "portfolio_manager", "company_thesis_status": "intact",
            }],
        }, {
            "approved_policy_status": "approved_policy_applied",
            "delivery_enabled": False, "candidate_count": 1,
            "sent_count": 0, "failed_count": 0, "suppressed_count": 0,
        })
        self.assertIn("즉시 검토 필요", result)
        self.assertIn("SLA 경과·업데이트 미확인", result)
        self.assertIn("사후 업데이트 SLA 경과 또는 지연", result)
        self.assertIn("승인 정책 적용 · 발송 스위치 비활성", result)
        self.assertIn("외부 전달은 승인 정책·활성 스위치·중복 및 확인 로그로 별도 통제", result)
        self.assertIn("자동 매수·매도·비중 변경 없음", result)

    def test_acknowledged_alert_followup_monitor_renders_missing_and_overdue_work(self) -> None:
        result = company_review_alert_followup_monitor_section({
            "followup_count": 2, "missing_assignment_count": 1, "overdue_count": 1,
            "observed_at": "2026-10-31T16:00:00+00:00",
            "rows": [
                {
                    "ticker": "GEV", "acknowledged_by": "pm_owner",
                    "acknowledged_at": "2026-10-31T14:00:00+00:00",
                    "status": "acknowledged_followup_assignment_missing", "alert_level": "attention_required",
                    "escalation_reason": "acknowledged_alert_without_followup_assignment",
                    "owner": None, "due_at": None, "completion_criteria": None,
                },
                {
                    "ticker": "GEV", "acknowledged_by": "pm_owner",
                    "acknowledged_at": "2026-10-31T14:00:00+00:00",
                    "status": "assigned_followup_overdue", "alert_level": "critical_review_required",
                    "escalation_reason": "acknowledged_alert_followup_due_date_missed",
                    "owner": "research_analyst", "due_at": "2026-10-31T15:30:00+00:00",
                    "completion_criteria": "Review primary evidence.",
                },
            ],
        })
        self.assertIn(FOLLOWUP_MONITOR_HEADING, result)
        self.assertIn("확인됨·후속조치 미지정", result)
        self.assertIn("후속조치 기한 경과", result)
        self.assertIn("외부 재알림 및 자동 매수·매도·비중 변경 없음", result)

    def test_weekly_sla_summary_hides_metrics_below_minimum_sample(self) -> None:
        result = company_review_alert_sla_summary_section({
            "window": {"start_date": "2026-10-25", "end_date": "2026-10-31", "lookback_days": 7},
            "flow_counts": {
                "acknowledged_in_window": 2, "assigned_in_window": 1, "completed_in_window": 2,
                "completed_within_due_in_window": 1, "completed_after_due_in_window": 1,
            },
            "current_backlog": {
                "acknowledged_without_assignment": 1, "active_open_followups": 1, "active_overdue_followups": 1,
            },
            "metrics": {"status": "insufficient_completion_sample", "minimum_completion_sample": 3},
            "priority_followups": [{
                "ticker": "GEV", "status": "assigned_followup_overdue", "owner": "research_analyst",
                "due_at": "2026-10-31T12:00:00+00:00",
            }],
        })
        self.assertIn(SLA_SUMMARY_HEADING, result)
        self.assertIn("비율 및 소요 시간은 표시하지 않음", result)
        self.assertIn("assigned_followup_overdue", result)
        self.assertIn("자동 매수·매도·비중 변경 없음", result)

    def test_owner_queue_renders_only_unresolved_work_and_deterministic_causes(self) -> None:
        result = company_review_alert_owner_queue_section({
            "unresolved_count": 2, "critical_count": 1, "high_count": 1,
            "normal_count": 0, "completed_excluded_count": 3,
            "owner_summary": [
                {"owner": "research_analyst", "unresolved_count": 1},
                {"owner": "unassigned", "unresolved_count": 1},
            ],
            "root_cause_summary": [
                {"root_cause": "acknowledged_alert_followup_due_date_missed", "count": 1},
                {"root_cause": "acknowledged_alert_without_followup_assignment", "count": 1},
            ],
            "queue": [{
                "ticker": "GEV", "priority": "critical", "queue_status": "followup_overdue",
                "owner": "research_analyst", "due_at": "2026-10-31T12:00:00+00:00",
                "required_next_action": "complete_followup_with_evidence",
                "root_cause": "acknowledged_alert_followup_due_date_missed",
            }],
        })
        self.assertIn(OWNER_QUEUE_HEADING, result)
        self.assertIn("완료 제외 3건", result)
        self.assertIn("research_analyst 1건", result)
        self.assertIn("complete_followup_with_evidence", result)
        self.assertIn("자동 매수·매도·비중 변경 없음", result)

    def test_rolling_sla_trend_discloses_overlapping_window_limit(self) -> None:
        result = company_review_alert_sla_trend_section({
            "point_count": 2, "trend_limit": 8,
            "points": [
                {
                    "report_date": "2026-10-30", "window_start": "2026-10-24", "window_end": "2026-10-30",
                    "completed_in_window": 2, "acknowledged_without_assignment": 1,
                    "active_overdue_followups": 0, "metrics_status": "insufficient_completion_sample",
                },
                {
                    "report_date": "2026-10-31", "window_start": "2026-10-25", "window_end": "2026-10-31",
                    "completed_in_window": 3, "acknowledged_without_assignment": 2,
                    "active_overdue_followups": 1, "metrics_status": "available",
                },
            ],
            "latest_backlog_change": {
                "acknowledged_without_assignment_delta": 1, "active_overdue_followups_delta": 1,
            },
        })
        self.assertIn(SLA_TREND_HEADING, result)
        self.assertIn("독립 주간 비교가 아님", result)
        self.assertIn("미배정 +1건", result)
        self.assertIn("기한 경과 +1건", result)
        self.assertIn("자동 매수·매도·비중 변경 없음", result)

    def test_completion_evidence_section_discloses_unverified_external_and_missing_local(self) -> None:
        result = company_review_alert_completion_evidence_section({
            "completion_count": 2, "local_references_available_count": 0,
            "external_references_verified_by_user_or_pm_count": 0,
            "external_reference_verification_pending_count": 1, "reference_integrity_issue_count": 1,
            "rows": [
                {
                    "ticker": "GEV", "completion_status": "reference_integrity_issue",
                    "references": [{"evidence_id": "note-1", "status": "missing_local_reference"}],
                },
                {
                    "ticker": "GEV", "completion_status": "external_reference_verification_pending",
                    "references": [{"evidence_id": "url-1", "status": "external_reference_unverified"}],
                },
            ],
        })
        self.assertIn(COMPLETION_EVIDENCE_HEADING, result)
        self.assertIn("외부 확인 대기 1건", result)
        self.assertIn("수동 외부 확인 기록 0건", result)
        self.assertIn("missing_local_reference", result)
        self.assertIn("외부 URL은 접속하지 않음", result)
        self.assertIn("자동 매수·매도·비중 변경 없음", result)

    def test_external_evidence_backlog_section_keeps_manual_review_and_no_action_boundary(self) -> None:
        result = company_review_alert_external_evidence_backlog_section({
            "pending_count": 1, "weekly_manual_review_due_count": 1,
            "critical_count": 1, "high_count": 0, "normal_count": 0,
            "queue": [{"ticker": "GEV", "evidence_id": "official-url-001", "pending_age_days": 7, "queue_status": "weekly_manual_review_due"}],
        })
        self.assertIn(EXTERNAL_EVIDENCE_BACKLOG_HEADING, result)
        self.assertIn("주간 수동 검토 대상 1건", result)
        self.assertIn("담당자 미지정", result)
        self.assertIn("URL 자동 접속·자동 배정·자동 매수·매도·비중 변경 없음", result)

    def test_external_evidence_review_summary_separates_review_flow(self) -> None:
        result = company_review_alert_external_evidence_review_summary_section({
            "window": {"days": 7},
            "active_backlog": {"pending_count": 2, "unreviewed_weekly_manual_review_due_count": 1, "deferred_pending_recheck_count": 1, "alternate_evidence_requested_count": 0},
            "review_flow": {"recorded_in_window_count": 2, "decision_counts": {"deferred_pending_recheck": 1, "alternate_evidence_requested": 1, "reference_no_longer_relevant": 0}},
        })
        self.assertIn(EXTERNAL_EVIDENCE_REVIEW_SUMMARY_HEADING, result)
        self.assertIn("주간 검토 미처리 1건", result)
        self.assertIn("운영 검토 흐름만 표시", result)

    def test_company_thesis_review_calendar_separates_date_confidence_and_undated_proof(self) -> None:
        result = company_thesis_review_calendar_section({
            "confirmed_review_count": 1, "soft_date_candidate_count": 1,
            "undated_proof_count": 1,
            "companies": [{
                "ticker": "GEV", "company_name": "GE Vernova",
                "calendar_status": "confirmed_review_date_available",
                "company_thesis_status": "intact", "next_review_gate": "2026-11-05",
                "dated_reviews": [{
                    "event_date": "2026-11-05", "event_name": "GEV earnings thesis review",
                    "time_of_day": "before_market", "time_zone": "America/New_York",
                    "source_id": "EVENT-GEV-Q4", "source_date": "2026-10-20",
                    "prep_required": ["Freeze evidence bar"],
                    "post_event_handoff": ["collect_results", "update_thesis"],
                }],
                "soft_date_candidates": [{"event_date": "2026-11-04"}],
                "undated_proof_queue": [{
                    "pillar_name": "Backlog", "next_proof_point": "Next comparable disclosure",
                }],
                "event_conflicts": [],
                "missing_operating_model_fields": ["analyst_owner", "post_event_update_sla"],
                "source_index": [{
                    "source_id": "EVENT-GEV-Q4", "source_name": "GEV IR calendar",
                    "source_location": "https://investor.gevernova.com/events",
                }],
            }],
        })
        self.assertIn("확정 일정 1: 2026-11-05", result)
        self.assertIn("예상 날짜 후보 1: 2026-11-04 · 정확한 일정으로 사용 금지", result)
        self.assertIn("날짜 미정 증거 1: Backlog", result)
        self.assertIn("담당자 미지정 · 준비 마감 미지정 · 사후 업데이트 SLA 미지정", result)
        self.assertIn("[GEV IR calendar](https://investor.gevernova.com/events)", result)

    def test_company_thesis_review_calendar_renders_approved_operating_config(self) -> None:
        result = company_thesis_review_calendar_section({
            "confirmed_review_count": 1, "soft_date_candidate_count": 0,
            "undated_proof_count": 1,
            "companies": [{
                "ticker": "GEV", "company_name": "GE Vernova",
                "calendar_status": "confirmed_review_date_available",
                "company_thesis_status": "intact", "next_review_gate": "2026-11-05",
                "operating_config_status": "approved_operating_config_applied",
                "operating_config_version": 1,
                "next_scheduled_review_date": "2026-11-05",
                "next_scheduled_review_status": "upcoming_approved_internal_date",
                "operating_model": {
                    "pm_owner": "portfolio_manager", "analyst_owner": "research_analyst",
                    "evidence_owner": "research_analyst", "kpi_owner": "research_analyst",
                    "model_owner": "model_analyst", "decision_log_owner": "portfolio_manager",
                    "review_cadence": "event_driven",
                    "escalation_triggers": ["verified_primary_results_available"],
                },
                "dated_reviews": [{
                    "event_date": "2026-11-05", "event_name": "GEV earnings thesis review",
                    "source_id": "EVENT-GEV-Q4", "source_date": "2026-10-20",
                    "prep_required": ["Freeze evidence bar"], "post_event_handoff": ["update_thesis"],
                    "prep_owner": "research_analyst", "prep_due_date": "2026-10-31",
                    "post_event_update_sla": {
                        "value": 24, "unit": "hours",
                        "start_condition": "verified_primary_results_available",
                    },
                }],
                "soft_date_candidates": [],
                "undated_proof_queue": [{
                    "pillar_name": "Backlog", "next_proof_point": "Next comparable disclosure",
                    "owner": "research_analyst", "review_cadence": "event_driven",
                }],
                "event_conflicts": [], "missing_operating_model_fields": [],
                "source_index": [{
                    "source_id": "EVENT-GEV-Q4", "source_name": "GEV IR calendar",
                    "source_location": "https://investor.gevernova.com/events",
                }],
            }],
        })
        self.assertIn("운영 설정: 승인됨 · v1 · 검토 주기 event_driven", result)
        self.assertIn("분석 research_analyst", result)
        self.assertIn("research_analyst · 2026-10-31 · 사후 업데이트 SLA 24시간", result)
        self.assertIn("시작 조건 verified_primary_results_available", result)
        self.assertIn("담당 research_analyst · 주기 event_driven", result)
        self.assertNotIn("담당자 미지정 · 준비 마감 미지정", result)

    def test_source_section_keeps_internal_reference_without_fake_link(self) -> None:
        result = source_section([{
            "source_id": "authorized_report_drop", "publisher": "테스트증권",
            "source_grade": "INTERNAL", "title": "리포트", "url": "",
            "source_reference": "TEST-01",
        }], {"source_quality": {"evidence_posture": "monitoring_only"}})
        self.assertIn("내부 참조 `TEST-01` · 원문 URL 없음", result)
        self.assertIn("출처 검증 수준: 모니터링용", result)

    def test_publication_gate_reports_blocker_codes(self) -> None:
        with self.assertRaisesRegex(ValueError, "required_source_missing_url=1"):
            validate_publication_gate({"source_quality": {
                "publication_allowed": False,
                "critical_source_link_complete": False,
                "event_source_links_complete": True,
                "blockers": {"required_source_missing_url": 1},
            }})


class NewsCardParsingTests(unittest.TestCase):
    def test_domestic_filings_are_not_parsed_as_overseas_news(self) -> None:
        markdown = """# 보고서
## 해외 뉴스
### 미국 통화정책·시장
1. 해외 기사
- 제한된 요약: 기사 요약
## 국내 공시
1. 국내 회사 공시
- 제한된 요약: 공시 요약
## 종목 및 공시
"""
        self.assertEqual(parse_cards(markdown), [("미국 통화정책·시장", "해외 기사", "기사 요약")])

    def test_new_opening_and_domestic_sections_render_as_cards(self) -> None:
        _, blocks = markdown_blocks("""# 2026-07-18 리포트
## 오늘의 결론
- 중립 체제
- 금리와 시장 폭이 충돌
- 핵심 변수: 금리, 시장 폭
- 최우선 리스크: 변동성
- 관측 → 해석 → 확인 조건 → 무효화 조건
## 국내 공시
1. 테스트전자 주요사항보고
""")
        callouts = [block["callout"] for block in blocks if block["type"] == "callout"]
        self.assertEqual(callouts[0]["color"], "blue_background")
        self.assertIn("중립 체제", callouts[0]["rich_text"][0]["text"]["content"])
        self.assertEqual(callouts[1]["color"], "purple_background")
        detail_bullets = [block for block in blocks if block["type"] == "bulleted_list_item"]
        self.assertEqual(len(detail_bullets), 1)

    def test_empty_sec_state_is_not_rendered_as_red_alert(self) -> None:
        _, blocks = markdown_blocks("""# 2026-07-20 리포트
## 종목 및 공시
- 중요 SEC 공시 없음(수집 범위 기준).
""")
        callout = next(block["callout"] for block in blocks if block["type"] == "callout")
        self.assertEqual(callout["color"], "gray_background")
        self.assertEqual(callout["icon"]["emoji"], "✅")


if __name__ == "__main__":
    unittest.main()
