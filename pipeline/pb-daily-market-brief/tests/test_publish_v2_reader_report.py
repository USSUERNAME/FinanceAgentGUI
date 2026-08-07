from __future__ import annotations

import contextlib
import io
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import publish_v2_reader_report
from compose_v2_reader_report import build_v2_reader_report
from publish_v2_reader_report import (
    TEST_TITLE_PREFIX,
    build_notion_payload,
    notion_page_title,
    v2_report_blocks,
)


class PublishV2ReaderReportTests(unittest.TestCase):
    def intelligence(self, *, verified: bool = False) -> dict:
        event = {
            "event_id": "event-1",
            "event_type": "policy",
            "title": "UNVERIFIED EVENT TITLE",
            "verification": {
                "primary_fact_confirmed": verified,
                "publication_eligible_as_fact": verified,
            },
            "common_facts": (
                [{"claim": "공식 정책 문서가 발표됐다."}]
                if verified
                else []
            ),
            "official_sources": (
                [
                    {
                        "source_id": "official",
                        "title": "Official policy",
                        "url": "https://example.gov/policy",
                        "published_at": "2026-07-24",
                    }
                ]
                if verified
                else []
            ),
            "expectation_gap": {},
            "impact_analysis": {},
            "market_reaction": {
                "causal_attribution_permitted": False,
            },
        }
        return {
            "schema_version": "daily_market_intelligence.v2",
            "report_date": "2026-07-24",
            "market": {
                "data_cutoff": {"latest_price_as_of": "2026-07-23"},
                "regime": {"label": "selective_rotation"},
                "scoreboard": {
                    "breadth": {"rsp_vs_spy_5d_pct": 0.8},
                    "volatility": {
                        "vix": {
                            "series_id": "VIXCLS",
                            "label": "CBOE VIX",
                            "value": 17.0,
                            "as_of": "2026-07-23",
                        },
                        "vix_term_ratio": 0.88,
                    },
                    "credit": {},
                    "rates": {
                        "real_10y": {
                            "series_id": "DFII10",
                            "label": "US 10-Year Real Yield",
                            "value": 2.3,
                            "change_5_sessions": 0.02,
                            "as_of": "2026-07-23",
                        }
                    },
                    "rule_based_signal": {
                        "participation": {
                            "qqq_vs_spy_5d_pct": -0.4,
                            "iwm_vs_spy_5d_pct": 0.2,
                        }
                    },
                },
                "day_over_day_changes": {},
                "top_risks": [],
                "korea_transmission_inputs": {
                    "transmission_gate": {
                        "status": "insufficient_verified_korea_data"
                    },
                    "metrics": {},
                },
            },
            "events": {"items": [event]},
            "source_state": {"data_warnings": []},
        }

    def report(self, *, verified: bool = False) -> dict:
        broker_research = {
            "schema_version": "broker_research_digest.v1",
            "report_date": "2026-07-24",
            "reports": [
                {
                    "report_id": "broker-1",
                    "publisher": "미래에셋증권",
                    "analyst": "김영건",
                    "title": "반도체 리서치",
                    "summary": "메모리 수급 개선 가능성을 점검했다.",
                    "key_claims": ["DRAM 가격 흐름을 핵심 변수로 제시했다."],
                    "catalysts": ["빅테크 설비투자"],
                    "risks": ["NAND 가격 하락"],
                    "raw_text": "NOTION MUST NOT EXPOSE THIS RAW TEXT",
                    "source": {"reference": "USER-SUPPLIED", "url": ""},
                    "processing": {
                        "structured_analysis_available": True,
                    },
                    "rights": {
                        "publication_policy": "private_analysis_only",
                        "redistribution_allowed": False,
                        "full_text_included": False,
                    },
                }
            ],
        }
        return build_v2_reader_report(
            self.intelligence(verified=verified),
            broker_research=broker_research,
            generated_at="2026-07-24T08:00:00+09:00",
        )

    def test_payload_creates_only_a_new_test_child_page(self) -> None:
        payload = build_notion_payload(
            self.report(),
            parent_page_id="parent-test",
        )
        self.assertEqual(
            payload["parent"],
            {"type": "page_id", "page_id": "parent-test"},
        )
        title = payload["properties"]["title"]["title"][0]["text"]["content"]
        self.assertTrue(title.startswith(TEST_TITLE_PREFIX))
        serialized = json.dumps(payload, ensure_ascii=False)
        self.assertNotIn("archived", serialized)
        self.assertNotIn("in_trash", serialized)
        self.assertNotIn("page_id_to_update", serialized)

    def test_unverified_event_title_never_reaches_notion_blocks(self) -> None:
        serialized = json.dumps(
            v2_report_blocks(self.report()),
            ensure_ascii=False,
        )
        self.assertNotIn("UNVERIFIED EVENT TITLE", serialized)
        self.assertIn("미확인 기사와 관점은 제외", serialized)

    def test_verified_event_has_fact_and_link(self) -> None:
        serialized = json.dumps(
            v2_report_blocks(self.report(verified=True)),
            ensure_ascii=False,
        )
        self.assertIn("공식 정책 문서가 발표됐다", serialized)
        self.assertIn("https://example.gov/policy", serialized)

    def test_analyst_research_summary_reaches_notion_without_raw_text(self) -> None:
        serialized = json.dumps(
            v2_report_blocks(self.report()),
            ensure_ascii=False,
        )
        self.assertIn("애널리스트 리서치", serialized)
        self.assertIn("반도체 리서치", serialized)
        self.assertIn("NAND 가격 하락", serialized)
        self.assertNotIn("NOTION MUST NOT EXPOSE", serialized)

    def test_missing_parent_fails_closed(self) -> None:
        with self.assertRaises(ValueError):
            build_notion_payload(self.report(), parent_page_id="")

    def test_dry_run_never_calls_http_or_requires_token(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "reader_report.json"
            path.write_text(
                json.dumps(self.report(), ensure_ascii=False),
                encoding="utf-8",
            )
            output = io.StringIO()
            argv = [
                "publish_v2_reader_report.py",
                "--report-json",
                str(path),
                "--dry-run",
            ]
            environment = {
                "NOTION_V2_TEST_PARENT_PAGE_ID": "parent-test",
            }
            with (
                patch.object(sys, "argv", argv),
                patch.dict(os.environ, environment, clear=True),
                patch(
                    "publish_v2_reader_report.load_dotenv"
                ),
                patch(
                    "publish_v2_reader_report.notion_api_json",
                    side_effect=AssertionError("HTTP must not be called"),
                ),
                contextlib.redirect_stdout(output),
            ):
                publish_v2_reader_report.main()
            receipt = json.loads(output.getvalue())
            self.assertEqual(receipt["status"], "validated")
            self.assertFalse(receipt["http_called"])
            self.assertFalse(receipt["existing_page_mutated"])

    def test_confirm_publish_creates_one_page_and_emits_separate_output(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "reader_report.json"
            path.write_text(
                json.dumps(self.report(), ensure_ascii=False),
                encoding="utf-8",
            )
            github_output = Path(temporary) / "github_output.txt"
            argv = [
                "publish_v2_reader_report.py",
                "--report-json",
                str(path),
                "--confirm-publish",
            ]
            environment = {
                "NOTION_V2_TEST_PARENT_PAGE_ID": "parent-test",
                "NOTION_TOKEN": "test-token",
                "GITHUB_OUTPUT": str(github_output),
            }
            with (
                patch.object(sys, "argv", argv),
                patch.dict(os.environ, environment, clear=True),
                patch("publish_v2_reader_report.load_dotenv"),
                patch(
                    "publish_v2_reader_report.notion_api_json",
                    return_value={"url": "https://notion.so/v2-test"},
                ) as api,
            ):
                publish_v2_reader_report.main()
            api.assert_called_once()
            self.assertEqual(api.call_args.args[1], "POST")
            self.assertIn(
                "notion_v2_test_url=https://notion.so/v2-test",
                github_output.read_text(encoding="utf-8"),
            )

    def test_page_title_is_bounded_and_explicitly_test_only(self) -> None:
        title = notion_page_title(self.report())
        self.assertEqual(title, "[V2 TEST] 07.24 Daily Market Intelligence")
        self.assertLess(len(title), 100)


if __name__ == "__main__":
    unittest.main()
