import unittest

from compose_v2_reader_report import (
    FINAL_MARKER,
    SCHEMA_VERSION,
    build_v2_reader_report,
    render_v2_reader_markdown,
    validate_v2_reader_report,
)


class V2ReaderReportTests(unittest.TestCase):
    def broker_research(self, *, safe: bool = True) -> dict:
        return {
            "schema_version": "broker_research_digest.v1",
            "report_date": "2026-07-24",
            "reports": [
                {
                    "report_id": "broker-1",
                    "publisher": "미래에셋증권",
                    "analyst": "김영건",
                    "title": "반도체: 비중확대 의견",
                    "published_at": "2026-07-23T00:00:00+09:00",
                    "report_type": "sector",
                    "stance": "positive",
                    "tickers": ["000660", "005930"],
                    "sectors": ["반도체", "메모리"],
                    "summary": (
                        "DRAM 가격과 빅테크 설비투자를 긍정적으로 평가하고 "
                        "목표주가를 유지했다."
                    ),
                    "key_claims": ["DRAM 가격 상승이 이어질 것으로 전망했다."],
                    "catalysts": ["빅테크 설비투자 가이던스"],
                    "risks": ["NAND 가격 하락"],
                    "raw_text": "THIS RAW TEXT MUST NEVER BE PUBLISHED",
                    "source": {
                        "reference": "USER-SUPPLIED-SEMICONDUCTOR",
                        "url": "",
                    },
                    "processing": {
                        "structured_analysis_available": True,
                    },
                    "rights": {
                        "publication_policy": "private_analysis_only",
                        "redistribution_allowed": False if safe else True,
                        "full_text_included": False,
                    },
                }
            ],
        }

    def intelligence(self, *, verified: bool = True) -> dict:
        event = {
            "event_id": "event-1",
            "event_type": "earnings_guidance",
            "title": "NVDA raises revenue guidance",
            "verification": {
                "primary_fact_confirmed": verified,
                "publication_eligible_as_fact": verified,
            },
            "common_facts": [
                {"claim": "회사는 분기 매출 가이던스를 상향했다."}
            ],
            "official_sources": [
                {
                    "source_id": "sec_edgar",
                    "title": "NVDA 8-K",
                    "url": "https://sec.gov/Archives/nvda-8k.htm",
                    "published_at": "2026-07-24",
                }
            ],
            "expectation_gap": {
                "status": "available",
                "narrative_gap": "기존 회사 전망보다 상단이 높아졌다.",
            },
            "impact_analysis": {
                "bottom_line": "반도체 수요 가시성의 추가 확인이 필요하다."
            },
            "market_reaction": {
                "causal_attribution_permitted": False,
                "note": "Do not attribute daily returns to this event.",
            },
        }
        return {
            "schema_version": "daily_market_intelligence.v2",
            "report_date": "2026-07-24",
            "market": {
                "data_cutoff": {"latest_price_as_of": "2026-07-23"},
                "regime": {"label": "selective_rotation"},
                "day_over_day_changes": {
                    "status": "compared",
                    "market_structure_change": {
                        "previous": "broadening",
                        "current": "mixed_rotation",
                        "changed": True,
                    },
                    "sector_leader_changes": {
                        "added": ["XLE"],
                        "removed": ["XLK"],
                    },
                    "etf_close_changes_pct": {"SPY": 0.4, "QQQ": -0.7},
                },
                "scoreboard": {
                    "breadth": {"rsp_vs_spy_5d_pct": 0.86},
                    "volatility": {
                        "vix": {
                            "series_id": "VIXCLS",
                            "label": "CBOE VIX",
                            "value": 17.05,
                            "as_of": "2026-07-23",
                        },
                        "vix3m": {
                            "series_id": "VXVCLS",
                            "label": "CBOE 3-Month VIX",
                            "value": 19.59,
                            "as_of": "2026-07-23",
                        },
                        "vix_term_ratio": 0.87,
                    },
                    "credit": {
                        "high_yield_oas": {
                            "series_id": "BAMLH0A0HYM2",
                            "label": "US High Yield OAS",
                            "value": 2.69,
                            "change_5_sessions": -0.03,
                            "as_of": "2026-07-23",
                        }
                    },
                    "rates": {
                        "nominal_10y": {
                            "series_id": "DGS10",
                            "label": "US 10-Year Treasury Yield",
                            "value": 4.63,
                            "as_of": "2026-07-23",
                        },
                        "real_10y": {
                            "series_id": "DFII10",
                            "label": "US 10-Year Real Yield",
                            "value": 2.37,
                            "change_5_sessions": 0.04,
                            "as_of": "2026-07-23",
                        },
                    },
                    "rule_based_signal": {
                        "participation": {
                            "qqq_vs_spy_5d_pct": -0.75,
                            "iwm_vs_spy_5d_pct": 0.31,
                        }
                    },
                },
                "top_risks": ["실질금리 추가 상승"],
                "korea_transmission_inputs": {
                    "transmission_gate": {
                        "status": "insufficient_verified_korea_data"
                    },
                    "metrics": {},
                },
            },
            "events": {
                "items": [event],
                "verified_primary_fact_count": 1 if verified else 0,
            },
            "source_state": {"data_warnings": []},
            "policy": {
                "automatic_publication": False,
                "position_actions_allowed": False,
            },
        }

    def test_verified_event_is_included_with_official_source(self) -> None:
        report = build_v2_reader_report(
            self.intelligence(),
            generated_at="2026-07-24T08:00:00+09:00",
        )
        self.assertEqual(report["schema_version"], SCHEMA_VERSION)
        self.assertEqual(len(report["verified_events"]), 1)
        self.assertEqual(
            report["verified_events"][0]["facts"],
            ["회사는 분기 매출 가이던스를 상향했다."],
        )
        self.assertIn(
            "https://sec.gov/Archives/nvda-8k.htm",
            [item["url"] for item in report["sources"]],
        )

    def test_unverified_event_is_excluded_completely(self) -> None:
        packet = self.intelligence(verified=False)
        packet["events"]["items"][0]["title"] = "UNVERIFIED SECRET TITLE"
        report = build_v2_reader_report(packet)
        rendered = render_v2_reader_markdown(report)
        self.assertEqual(report["verified_events"], [])
        self.assertNotIn("UNVERIFIED SECRET TITLE", rendered)
        self.assertIn("미확인 뉴스 해석은 독자 본문에서 제외", rendered)

    def test_non_causal_daily_return_note_is_not_rendered(self) -> None:
        rendered = render_v2_reader_markdown(
            build_v2_reader_report(self.intelligence())
        )
        self.assertNotIn("Do not attribute", rendered)
        self.assertNotIn("측정된 시장 반응", rendered)

    def test_operations_fields_do_not_leak(self) -> None:
        packet = self.intelligence()
        packet["task_id"] = "task-market"
        packet["input_hash"] = "abc123"
        rendered = render_v2_reader_markdown(build_v2_reader_report(packet))
        self.assertNotIn("task_id", rendered)
        self.assertNotIn("input_hash", rendered)
        self.assertNotIn("execution_status", rendered)

    def test_korea_gap_is_visible_without_directional_inference(self) -> None:
        report = build_v2_reader_report(self.intelligence())
        self.assertEqual(report["korea_connection"]["status"], "insufficient")
        self.assertIn(
            "방향성으로 단정하지 않는다",
            report["korea_connection"]["summary"],
        )

    def test_validation_rejects_position_authority(self) -> None:
        report = build_v2_reader_report(self.intelligence())
        report["policy"]["position_actions_allowed"] = True
        with self.assertRaises(ValueError):
            validate_v2_reader_report(report)

    def test_markdown_has_reader_spine_and_completion_marker(self) -> None:
        rendered = render_v2_reader_markdown(
            build_v2_reader_report(self.intelligence())
        )
        self.assertIn("## 30초 결론", rendered)
        self.assertIn("## 시장과 섹터 흐름", rendered)
        self.assertIn("## 오늘 달라진 것", rendered)
        self.assertIn("XLE", rendered)
        self.assertIn("## 검증된 핵심 사건", rendered)
        self.assertIn("## 한국시장 연결", rendered)
        self.assertIn("## 다음 24~72시간 확인사항", rendered)
        self.assertTrue(rendered.rstrip().endswith(FINAL_MARKER))

    def test_earnings_watch_separates_estimate_guidance_and_actual(self) -> None:
        packet = self.intelligence()
        packet["earnings"] = {
            "status": "ready",
            "summary": {"company_count": 1},
            "companies": [{
                "ticker": "NVDA",
                "company_name": "NVIDIA",
                "upcoming_event": {
                    "event_date": "2026-08-20",
                    "confidence": "confirmed",
                },
                "estimate_revision": {
                    "status": "third_party_estimate_bar_available",
                    "freeze_as_of": "2026-07-24",
                    "revision_direction": "positive_revision",
                    "rows": [{
                        "metric_id": "diluted_eps",
                        "period_end": "2026-07-31",
                        "value": 1.25,
                        "units": "USD per share",
                        "revision_pct_30d": 4.2,
                        "evidence_label": "third_party_forward_estimate",
                    }],
                },
                "guidance": [{
                    "metric_id": "revenue",
                    "period_end": "2026-07-31",
                    "midpoint": 50_000_000_000,
                    "units": "USD",
                    "evidence_label": "issuer_management_claim",
                }],
                "historical_surprises": [{
                    "reported_date": "2026-05-20",
                    "surprise_pct": 10.0,
                    "reaction_pct": 4.5,
                }],
                "latest_verified_result": {
                    "status": "verified_primary_input_pack",
                },
                "post_result_estimate_revision": {
                    "status":
                        "not_established_missing_refreshed_estimates_and_model",
                    "model_update_applied": False,
                },
                "source_index": [],
            }],
        }
        report = build_v2_reader_report(packet)
        rendered = render_v2_reader_markdown(report)
        self.assertEqual(len(report["earnings_watch"]["companies"]), 1)
        self.assertIn("## 실적·가이던스·추정치 변화", rendered)
        self.assertIn("제3자 전망치 변화", rendered)
        self.assertIn("회사 가이던스", rendered)
        self.assertIn("인과관계로 단정하지 않음", rendered)
        self.assertIn("동일 기간 갱신 전망치 대기", rendered)

    def test_safe_analyst_research_is_summarized_without_raw_text(self) -> None:
        report = build_v2_reader_report(
            self.intelligence(),
            broker_research=self.broker_research(),
        )
        rendered = render_v2_reader_markdown(report)
        self.assertEqual(len(report["analyst_research"]), 1)
        self.assertIn("## 애널리스트 리서치", rendered)
        self.assertIn("반도체: 긍정적 업종 의견", rendered)
        self.assertIn("가치평가 기준", rendered)
        self.assertNotIn("비중확대", rendered)
        self.assertNotIn("목표주가", rendered)
        self.assertIn("NAND 가격 하락", rendered)
        self.assertNotIn("THIS RAW TEXT", rendered)
        self.assertNotIn("raw_text", str(report))

    def test_unsafe_analyst_research_is_excluded(self) -> None:
        report = build_v2_reader_report(
            self.intelligence(),
            broker_research=self.broker_research(safe=False),
        )
        self.assertEqual(report["analyst_research"], [])

    def test_mismatched_digest_date_is_excluded(self) -> None:
        digest = self.broker_research()
        digest["report_date"] = "2026-07-25"
        report = build_v2_reader_report(
            self.intelligence(),
            broker_research=digest,
        )
        self.assertEqual(report["analyst_research"], [])

    def test_mojibake_analysis_text_is_not_reused(self) -> None:
        packet = self.intelligence()
        packet["market"]["top_risks"] = ["??쒖옣 ?ㅼ쭏湲덈━ ??"]
        rendered = render_v2_reader_markdown(build_v2_reader_report(packet))
        self.assertNotIn("??쒖옣", rendered)

    def test_internal_market_structure_status_has_reader_label(self) -> None:
        packet = self.intelligence()
        packet["market"]["day_over_day_changes"][
            "market_structure_change"
        ]["current"] = "insufficient_data"
        rendered = render_v2_reader_markdown(
            build_v2_reader_report(packet)
        )
        self.assertIn("자료 불충분", rendered)
        self.assertNotIn("insufficient_data", rendered)

    def test_missing_rsp_never_claims_market_participation_broadened(self) -> None:
        packet = self.intelligence()
        packet["market"]["scoreboard"]["breadth"] = {}
        rendered = render_v2_reader_markdown(
            build_v2_reader_report(packet)
        )
        self.assertIn(
            "동일가중 브레드스가 없어 시장 확산은 판정할 수 없다",
            rendered,
        )
        self.assertNotIn("시장 참여는 넓어졌지만", rendered)


if __name__ == "__main__":
    unittest.main()
