import datetime as dt
import json
import argparse
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from zoneinfo import ZoneInfo

from scripts import world_memory_cli as wm


class FakeEmbedder:
    def __init__(self) -> None:
        self.calls: list[list[str]] = []

    def encode(self, texts: list[str]) -> list[list[float]]:
        self.calls.append(list(texts))
        return [[float(idx + 1), 1.0] for idx, _ in enumerate(texts)]


class WorldMemoryCliTests(unittest.TestCase):
    def _sources(self) -> list[dict[str, str]]:
        return [{"name": "Test Source", "url": "https://example.com"}]

    def test_market_subject_alias_normalizes_to_market_actor(self) -> None:
        self.assertEqual(wm._normalize_subject_type("market"), "market_actor")

    def _make_issue_payload(
        self,
        *,
        as_of: dt.datetime,
        title: str,
        summary: str,
        story: str,
    ) -> dict:
        return wm._build_issue_payload(
            as_of=as_of,
            category="stock_bond",
            region="GLOBAL",
            importance="medium",
            entry_mode="issue",
            title=title,
            summary=summary,
            why_it_matters="",
            portfolio_link="",
            horizon="수일~수주",
            tickers=["SPY"],
            tags=["rates"],
            subjects=[],
            industries=["capital_markets"],
            event_kind="capital_markets",
            sources=self._sources(),
            story=story,
            story_key="",
            story_family="",
            story_thesis="",
            story_checkpoint="",
            story_relation="",
            related_story="",
            story_note="",
            story_confidence=0.55,
            state_key="",
            state_label="",
            state_status="",
            state_bias="",
            net_effect="",
            derive_state=True,
            dedupe_key="",
        )

    def _make_brief_payload(
        self,
        *,
        as_of: dt.datetime,
        title: str,
        summary: str,
        story: str,
        story_family: str = "",
        story_thesis: str = "",
        story_checkpoint: str = "",
        manual_story_override: bool = False,
        tags: list[str] | None = None,
        subjects: list[dict[str, str]] | None = None,
        industries: list[str] | None = None,
    ) -> dict:
        payload = wm._build_issue_payload(
            as_of=as_of,
            category="stock_bond",
            region="GLOBAL",
            importance="medium",
            entry_mode="brief",
            title=title,
            summary=summary,
            why_it_matters="",
            portfolio_link="",
            horizon="수일~수주",
            tickers=["ITA"],
            tags=tags or ["defense", "ipo", "europe"],
            subjects=subjects
            or [{"name": "European Defense Industry", "type": "market_actor"}],
            industries=industries or ["defense", "capital_markets", "manufacturing"],
            event_kind="industry_trend",
            sources=self._sources(),
            story=story,
            story_key="",
            story_family=story_family,
            story_thesis=story_thesis,
            story_checkpoint=story_checkpoint,
            story_relation="",
            related_story="",
            story_note="",
            story_confidence=0.55,
            state_key="",
            state_label="",
            state_status="",
            state_bias="",
            net_effect="",
            derive_state=False,
            dedupe_key="",
        )
        if manual_story_override:
            payload["manual_story_override"] = True
        return payload

    def test_treasury_story_rule_requires_us_signal(self) -> None:
        japan_story = wm._infer_story_metadata_by_rules(
            {
                "title": "장기 JGB 금리 급등으로 일본 금리 변동성 재상향",
                "summary": "일본 장기채 금리와 환율 변동성이 다시 확대됐다.",
                "tags": ["japan", "jgb", "rates", "duration", "volatility"],
                "subjects": [{"name": "Japanese Government", "type": "institution"}],
                "industries": ["public_finance", "capital_markets"],
                "tickers": ["EWJ", "TLT", "IEF"],
                "region": "GLOBAL",
                "event_kind": "capital_markets",
            }
        )
        self.assertIsNotNone(japan_story)
        self.assertEqual(japan_story["story"], "글로벌 금리·FX 방어")

        boj_hike_story = wm._infer_story_metadata_by_rules(
            {
                "title": "BOJ 6월 금리 인상 검토 신호가 글로벌 듀레이션 압력을 키움",
                "summary": "Bank of Japan이 정책금리를 1%로 올릴 수 있다는 전망이 커졌다.",
                "tags": ["boj", "rates", "rate_hike", "duration"],
                "subjects": [{"name": "Bank of Japan", "type": "institution"}],
                "industries": ["public_finance", "capital_markets"],
                "tickers": ["EWJ", "TLT", "USDJPY=X"],
                "region": "GLOBAL",
                "event_kind": "policy_signal",
            }
        )
        self.assertIsNotNone(boj_hike_story)
        self.assertEqual(boj_hike_story["story"], "선진국 금리 재인상 경계")

        bok_hike_story = wm._infer_story_metadata_by_rules(
            {
                "title": "한국은행 총재가 물가 불안 시 금리를 제때 올려야 한다고 발언",
                "summary": "Bank of Korea는 에너지 물가와 원화 약세가 이어지면 금리 인상 가능성을 배제하기 어렵다.",
                "tags": ["bok", "rates", "inflation"],
                "subjects": [{"name": "Bank of Korea", "type": "institution"}],
                "industries": ["public_finance", "capital_markets", "banking"],
                "tickers": ["EWY", "KRW=X"],
                "region": "KR",
                "event_kind": "policy_signal",
            }
        )
        self.assertIsNotNone(bok_hike_story)
        self.assertEqual(bok_hike_story["story"], "선진국 금리 재인상 경계")

        treasury_story = wm._infer_story_metadata_by_rules(
            {
                "title": "미국 3·6개월물 입찰에서 응찰 강도 유지",
                "summary": "미국 재무부 단기물 입찰 수요가 유지됐다.",
                "tags": ["treasury", "auction", "rates", "us"],
                "subjects": [{"name": "U.S. Treasury", "type": "institution"}],
                "industries": ["public_finance", "capital_markets"],
                "tickers": ["TLT", "IEF", "^TNX"],
                "region": "US",
                "event_kind": "capital_markets",
            }
        )
        self.assertIsNotNone(treasury_story)
        self.assertEqual(treasury_story["story"], "재무부 공급·바이백 조합")

    def test_ai_story_rules_split_model_software_from_physical_infra(self) -> None:
        ipo_story = wm._infer_story_metadata_by_rules(
            {
                "title": "OpenAI의 비공개 S-1 제출이 AI 비상장기업의 공개시장 진입 경쟁을 공식화",
                "summary": "OpenAI와 Anthropic, SpaceX의 IPO 파이프라인이 초대형 비상장 AI 프리미엄의 공개시장 흡수력을 시험한다.",
                "tags": ["openai", "ipo", "s_1", "ai", "private_markets", "public_markets", "valuation"],
                "subjects": [{"name": "OpenAI", "type": "company"}],
                "industries": ["artificial_intelligence", "software", "capital_markets"],
                "tickers": ["MSFT", "QQQ"],
                "region": "US",
                "event_kind": "capital_markets",
            }
        )
        self.assertIsNotNone(ipo_story)
        self.assertEqual(ipo_story["story"], "초대형 IPO와 공개시장 흡수력")
        self.assertEqual(ipo_story["story_family"], "초대형 IPO와 공개시장 흡수력")

        infra_story = wm._infer_story_metadata_by_rules(
            {
                "title": "AI 데이터센터 냉각과 HBM 공급망 투자 확대",
                "summary": "GPU, 전력망, 냉각수, 유리기판과 광통신 부품까지 AI 설비투자 병목으로 재가격된다.",
                "tags": ["ai", "data_centers", "semiconductors", "cooling", "water", "capex"],
                "subjects": [{"name": "U.S. AI Infrastructure Market", "type": "market_actor"}],
                "industries": ["artificial_intelligence", "semiconductors", "utilities", "materials"],
                "tickers": ["NVDA", "SOXX", "XLU"],
                "region": "GLOBAL",
                "event_kind": "industry_trend",
            }
        )
        self.assertIsNotNone(infra_story)
        self.assertEqual(infra_story["story"], "AI 물리 인프라 비즈니스")
        self.assertEqual(infra_story["story_family"], "AI 물리 인프라 비즈니스")

        model_story = wm._infer_story_metadata_by_rules(
            {
                "title": "프론티어 모델 API 가격 경쟁과 기업용 AI 에이전트 도입",
                "summary": "OpenAI와 Anthropic의 추론비용, 구독 매출, 기업용 API 채택이 AI 소프트웨어 수익성을 좌우한다.",
                "tags": ["ai", "llm", "api", "software", "subscription"],
                "subjects": [{"name": "OpenAI", "type": "company"}],
                "industries": ["artificial_intelligence", "software", "internet"],
                "tickers": ["MSFT", "GOOGL"],
                "region": "GLOBAL",
                "event_kind": "industry_trend",
            }
        )
        self.assertIsNotNone(model_story)
        self.assertEqual(model_story["story"], "AI 모델·소프트웨어 비즈니스")
        self.assertEqual(model_story["story_family"], "AI 모델·소프트웨어 비즈니스")

        software_only_story = wm._infer_story_metadata_by_rules(
            {
                "title": "일반 SaaS 기업 실적 호조",
                "summary": "클라우드 소프트웨어 매출이 증가했지만 특정 자동화 수요와 직접 연결된 신호는 없다.",
                "tags": ["software", "earnings"],
                "subjects": [{"name": "U.S. Software Sector", "type": "market_actor"}],
                "industries": ["software", "internet"],
                "tickers": ["IGV"],
                "region": "GLOBAL",
                "event_kind": "earnings",
            }
        )
        self.assertIsNone(software_only_story)

        catalog_match = wm._route_story_from_catalog(
            {
                "title": "일반 SaaS 기업 실적 호조",
                "summary": "클라우드 소프트웨어 매출이 증가했다.",
                "tags": ["software", "earnings"],
                "subjects": [{"name": "U.S. Software Sector", "type": "market_actor"}],
                "industries": ["software", "internet"],
                "tickers": ["IGV"],
                "region": "GLOBAL",
                "event_kind": "earnings",
            },
            [
                {
                    "story": "AI 모델·소프트웨어 비즈니스",
                    "story_key": "ai_모델_소프트웨어_비즈니스",
                    "story_family": "AI 모델·소프트웨어 비즈니스",
                    "story_family_key": "ai_모델_소프트웨어_비즈니스",
                    "story_thesis": "",
                    "story_checkpoint": "",
                    "event_count": 3,
                    "latest_as_of": "2026-05-01T00:00:00+09:00",
                    "tags": {"software", "earnings"},
                    "industries": {"software", "internet"},
                    "tickers": {"IGV"},
                    "subjects": {"u.s. software sector"},
                    "event_kinds": {"earnings"},
                }
            ],
        )
        self.assertIsNone(catalog_match)

    def test_derived_state_requires_repeated_issue_story(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            db_path = Path(tmpdir) / "world_issue_log.sqlite3"
            as_of = dt.datetime(2026, 4, 9, 9, 0, tzinfo=ZoneInfo(wm.DEFAULT_TZ))
            with wm._connect_db(db_path) as conn:
                wm._init_db(conn)

                first_payload = wm._prepare_payload_for_storage(
                    conn,
                    self._make_issue_payload(
                        as_of=as_of,
                        title="첫 번째 스토리 이벤트",
                        summary="첫 번째 반복 전 이벤트",
                        story="반복 전 스토리",
                    ),
                    story_catalog=[],
                )
                wm._upsert_sqlite_payload(conn, first_payload)
                self.assertIsNone(wm._upsert_derived_state_for_issue(conn, first_payload))

                second_payload = wm._prepare_payload_for_storage(
                    conn,
                    self._make_issue_payload(
                        as_of=as_of + dt.timedelta(days=1),
                        title="두 번째 스토리 이벤트",
                        summary="두 번째 이벤트로 반복 스토리 성립",
                        story="반복 전 스토리",
                    ),
                    story_catalog=[],
                )
                wm._upsert_sqlite_payload(conn, second_payload)
                derived_state = wm._upsert_derived_state_for_issue(conn, second_payload)

                self.assertIsNotNone(derived_state)
                self.assertEqual(derived_state["state_key"], "반복_전_스토리")

    def test_brief_with_stale_story_thesis_can_become_orphan(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            db_path = Path(tmpdir) / "world_issue_log.sqlite3"
            as_of = dt.datetime(2026, 5, 6, 9, 0, tzinfo=ZoneInfo(wm.DEFAULT_TZ))
            with wm._connect_db(db_path) as conn:
                wm._init_db(conn)
                payload = self._make_brief_payload(
                    as_of=as_of,
                    title="일반 미디어 기업 실적 호조",
                    summary="스트리밍과 파크 수익성이 실적을 지지했다.",
                    story="AI 투자 레짐",
                    story_family="AI 투자 레짐",
                    story_thesis="과거 issue용 논지가 잘못 남아 있다.",
                    story_checkpoint="cleanup 때 제거돼야 한다.",
                    tags=["earnings", "media", "consumer"],
                    subjects=[{"name": "Disney", "type": "company"}],
                    industries=["media", "consumer", "software"],
                )
                normalized = wm._prepare_payload_for_storage(conn, payload, story_catalog=[])

            self.assertNotIn("story", normalized)
            self.assertNotIn("story_family", normalized)
            self.assertNotIn("story_thesis", normalized)
            self.assertNotIn("story_checkpoint", normalized)

    def test_normalize_story_links_canonicalizes_family_aliases(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            db_path = Path(tmpdir) / "world_issue_log.sqlite3"
            now = dt.datetime(2026, 4, 9, 9, 0, tzinfo=ZoneInfo(wm.DEFAULT_TZ)).isoformat()
            payload_json = json.dumps(
                {
                    "link_id": "link-1",
                    "story_key": "유가_중심_금리_재가격",
                    "story_label": "유가 중심 금리 재가격",
                    "related_story_key": "중동_리스크와_에너지_가격",
                    "related_story_label": "중동 리스크와 에너지 가격",
                    "relation_type": "branches_from",
                    "story_family_key": "중동_에너지_충격_tlt_energy",
                    "story_family_label": "중동 에너지 충격 - TLT / energy",
                    "source_event_id": "",
                    "source_kind": "manual",
                    "note": "기존 branch 기록",
                    "confidence": 0.7,
                    "created_at": now,
                    "updated_at": now,
                },
                ensure_ascii=False,
            )
            with wm._connect_db(db_path) as conn:
                wm._init_db(conn)
                conn.execute(
                    """
                    INSERT INTO world_issue_story_links (
                        link_id, story_key, story_label, related_story_key, related_story_label,
                        relation_type, story_family_key, story_family_label, source_event_id,
                        source_kind, note, confidence, created_at, updated_at, payload_json
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        "link-1",
                        "유가_중심_금리_재가격",
                        "유가 중심 금리 재가격",
                        "중동_리스크와_에너지_가격",
                        "중동 리스크와 에너지 가격",
                        "branches_from",
                        "중동_에너지_충격_tlt_energy",
                        "중동 에너지 충격 - TLT / energy",
                        "",
                        "manual",
                        "기존 branch 기록",
                        0.7,
                        now,
                        now,
                        payload_json,
                    ),
                )

                updated = wm._normalize_story_links(conn)
                row = conn.execute(
                    "SELECT story_family_key, story_family_label FROM world_issue_story_links WHERE link_id = ?",
                    ("link-1",),
                ).fetchone()

                self.assertEqual(updated, 1)
                self.assertEqual(row["story_family_key"], "중동_리스크와_에너지_가격")
                self.assertEqual(row["story_family_label"], "중동 리스크와 에너지 가격")

    def test_cleanup_dry_run_rolls_back_changes(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            db_path = Path(tmpdir) / "world_issue_log.sqlite3"
            as_of = dt.datetime(2026, 4, 10, 9, 0, tzinfo=ZoneInfo(wm.DEFAULT_TZ))
            with wm._connect_db(db_path) as conn:
                wm._init_db(conn)
                payload = wm._prepare_payload_for_storage(
                    conn,
                    self._make_issue_payload(
                        as_of=as_of,
                        title="정상 제목",
                        summary="cleanup dry-run 롤백 검증",
                        story="테스트 스토리",
                    ),
                    story_catalog=[],
                )
                wm._upsert_sqlite_payload(conn, payload)
                conn.execute(
                    "UPDATE world_issue_entries SET title = ? WHERE event_id = ?",
                    ("BROKEN_TITLE", payload["event_id"]),
                )
                conn.commit()

            dry_run_args = argparse.Namespace(
                base_dir=tmpdir,
                db_file="world_issue_log.sqlite3",
                dry_run=True,
            )
            wm._handle_cleanup(dry_run_args)

            with wm._connect_db(db_path) as conn:
                row = conn.execute(
                    "SELECT title FROM world_issue_entries WHERE event_id = ?",
                    (payload["event_id"],),
                ).fetchone()
                self.assertIsNotNone(row)
                self.assertEqual(row["title"], "BROKEN_TITLE")

            run_args = argparse.Namespace(
                base_dir=tmpdir,
                db_file="world_issue_log.sqlite3",
                dry_run=False,
            )
            wm._handle_cleanup(run_args)

            with wm._connect_db(db_path) as conn:
                row = conn.execute(
                    "SELECT title FROM world_issue_entries WHERE event_id = ?",
                    (payload["event_id"],),
                ).fetchone()
                self.assertIsNotNone(row)
                self.assertEqual(row["title"], "정상 제목")

    def test_manual_story_override_preserves_brief_story_during_cleanup(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            db_path = Path(tmpdir) / "world_issue_log.sqlite3"
            as_of = dt.datetime(2026, 4, 20, 9, 0, tzinfo=ZoneInfo(wm.DEFAULT_TZ))
            with wm._connect_db(db_path) as conn:
                wm._init_db(conn)

                competing_issue = wm._prepare_payload_for_storage(
                    conn,
                    self._make_issue_payload(
                        as_of=as_of,
                        title="AI 인프라 자본조달 병목 심화",
                        summary="유사 태그가 있어도 manual brief story가 우선해야 한다.",
                        story="데이터센터 수요 → 전력 병목",
                    ),
                    story_catalog=[],
                )
                wm._upsert_sqlite_payload(conn, competing_issue)

                manual_brief = wm._prepare_payload_for_storage(
                    conn,
                    self._make_brief_payload(
                        as_of=as_of + dt.timedelta(hours=1),
                        title="유럽 방산 IPO 가속",
                        summary="manual story를 부여한 brief가 cleanup 후에도 유지돼야 한다.",
                        story="글로벌 방산 붐",
                        story_family="글로벌 방산 붐",
                        story_thesis="brief에는 저장되면 안 되는 issue용 필드",
                        story_checkpoint="cleanup 시 제거돼야 한다.",
                        manual_story_override=True,
                    ),
                )
                self.assertEqual(manual_brief["story"], "글로벌 방산 붐")
                self.assertEqual(manual_brief["story_family"], "글로벌 방산 붐")
                self.assertNotIn("story_thesis", manual_brief)
                self.assertNotIn("story_checkpoint", manual_brief)

                wm._upsert_sqlite_payload(conn, manual_brief)
                conn.commit()

            with wm._connect_db(db_path) as conn:
                wm._init_db(conn)
                scanned, updated, skipped = wm._cleanup_world_issue_entries(conn)
                self.assertEqual(scanned, 2)
                self.assertEqual(skipped, 0)
                self.assertEqual(updated, 0)

                row = conn.execute(
                    "SELECT payload_json FROM world_issue_entries WHERE event_id = ?",
                    (manual_brief["event_id"],),
                ).fetchone()
                self.assertIsNotNone(row)
                stored = json.loads(str(row["payload_json"]))
                self.assertEqual(stored["story"], "글로벌 방산 붐")
                self.assertEqual(stored["story_family"], "글로벌 방산 붐")

    def test_brief_story_backfill_sets_manual_override_for_orphan_brief(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            db_path = Path(tmpdir) / "world_issue_log.sqlite3"
            as_of = dt.datetime(2026, 4, 20, 9, 0, tzinfo=ZoneInfo(wm.DEFAULT_TZ))
            with wm._connect_db(db_path) as conn:
                wm._init_db(conn)
                orphan_brief = wm._prepare_payload_for_storage(
                    conn,
                    self._make_brief_payload(
                        as_of=as_of,
                        title="BOJ 발언과 엔화 변동성 확대",
                        summary="일본 금리와 엔화 경계가 커졌다.",
                        story="",
                        tags=["boj", "jpy", "rates"],
                        subjects=[{"name": "Bank of Japan", "type": "institution"}],
                        industries=["fx", "rates", "public_finance"],
                    ),
                    story_catalog=[],
                )
                orphan_brief.pop("story", None)
                orphan_brief.pop("story_key", None)
                orphan_brief.pop("story_family", None)
                orphan_brief.pop("story_family_key", None)
                wm._upsert_sqlite_payload(conn, orphan_brief)
                conn.commit()

            run_args = argparse.Namespace(
                base_dir=tmpdir,
                db_file="world_issue_log.sqlite3",
                event_id=[orphan_brief["event_id"]],
                story="일본 금리·엔화 변동성",
                story_family="글로벌 금리·FX 방어",
                note="사용자 승인 backfill",
                confidence=0.8,
                replace_existing=False,
                format="json",
                embedding_mode="off",
                engine=wm.DEFAULT_EMBEDDING_ENGINE,
                model=wm.DEFAULT_EMBEDDING_MODEL,
                batch_size=wm.DEFAULT_EMBEDDING_BATCH_SIZE,
                device="",
                max_seq_length=wm.DEFAULT_EMBEDDING_MAX_SEQ_LENGTH,
                verbose_model_load=False,
                dry_run=False,
            )
            wm._handle_brief_story_backfill(run_args)

            with wm._connect_db(db_path) as conn:
                row = conn.execute(
                    "SELECT payload_json FROM world_issue_entries WHERE event_id = ?",
                    (orphan_brief["event_id"],),
                ).fetchone()
                self.assertIsNotNone(row)
                stored = json.loads(str(row["payload_json"]))
                self.assertEqual(stored["story"], "일본 금리·엔화 변동성")
                self.assertEqual(stored["story_family"], "글로벌 금리·FX 방어")
                self.assertTrue(stored["manual_story_override"])
                self.assertEqual(stored["manual_story_confidence"], 0.8)

                scanned, updated, skipped = wm._cleanup_world_issue_entries(conn)
                self.assertEqual(scanned, 1)
                self.assertEqual(skipped, 0)
                self.assertEqual(updated, 0)

    def test_world_issue_embeddings_are_sidecar_and_skip_stale_rows(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            db_path = Path(tmpdir) / "world_issue_log.sqlite3"
            as_of = dt.datetime(2026, 4, 20, 9, 0, tzinfo=ZoneInfo(wm.DEFAULT_TZ))
            with wm._connect_db(db_path) as conn:
                wm._init_db(conn)
                oil_payload = wm._prepare_payload_for_storage(
                    conn,
                    self._make_issue_payload(
                        as_of=as_of,
                        title="중동 긴장으로 유가 급등",
                        summary="호르무즈 리스크가 원유와 인플레이션 기대를 자극했다.",
                        story="중동 리스크와 에너지 가격",
                    ),
                    story_catalog=[],
                )
                ai_payload = wm._prepare_payload_for_storage(
                    conn,
                    self._make_issue_payload(
                        as_of=as_of,
                        title="AI 데이터센터 투자 확대",
                        summary="전력과 반도체 공급망 투자가 다시 늘었다.",
                        story="AI 물리 인프라 비즈니스",
                    ),
                    story_catalog=[],
                )
                wm._upsert_sqlite_payload(conn, oil_payload)
                wm._upsert_sqlite_payload(conn, ai_payload)

                oil_text = wm._payload_embedding_text(oil_payload)
                ai_text = wm._payload_embedding_text(ai_payload)
                wm._upsert_world_embedding(
                    conn,
                    event_id=oil_payload["event_id"],
                    engine=wm.DEFAULT_EMBEDDING_ENGINE,
                    model=wm.DEFAULT_EMBEDDING_MODEL,
                    text_hash=wm._embedding_text_hash(oil_text),
                    embedded_text=oil_text,
                    vector=[1.0, 0.0],
                )
                wm._upsert_world_embedding(
                    conn,
                    event_id=ai_payload["event_id"],
                    engine=wm.DEFAULT_EMBEDDING_ENGINE,
                    model=wm.DEFAULT_EMBEDDING_MODEL,
                    text_hash="stale",
                    embedded_text=ai_text,
                    vector=[0.0, 1.0],
                )

                scored, missing, stale = wm._collect_semantic_search_candidates(
                    conn,
                    rows=[oil_payload, ai_payload],
                    engine=wm.DEFAULT_EMBEDDING_ENGINE,
                    model=wm.DEFAULT_EMBEDDING_MODEL,
                    query_vector=[1.0, 0.0],
                )

                self.assertEqual(missing, 0)
                self.assertEqual(stale, 1)
                self.assertEqual(len(scored), 1)
                self.assertEqual(scored[0]["event_id"], oil_payload["event_id"])

                wm._upsert_world_embedding(
                    conn,
                    event_id=ai_payload["event_id"],
                    engine=wm.DEFAULT_EMBEDDING_ENGINE,
                    model=wm.DEFAULT_EMBEDDING_MODEL,
                    text_hash=wm._embedding_text_hash(ai_text),
                    embedded_text=ai_text,
                    vector=[0.0, 1.0],
                )
                scored, missing, stale = wm._collect_semantic_search_candidates(
                    conn,
                    rows=[oil_payload, ai_payload],
                    engine=wm.DEFAULT_EMBEDDING_ENGINE,
                    model=wm.DEFAULT_EMBEDDING_MODEL,
                    query_vector=[0.0, 1.0],
                )

                self.assertEqual(missing, 0)
                self.assertEqual(stale, 0)
                self.assertEqual(scored[0]["event_id"], ai_payload["event_id"])

    def test_write_embeddings_refreshes_only_changed_payloads(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            db_path = Path(tmpdir) / "world_issue_log.sqlite3"
            as_of = dt.datetime(2026, 4, 20, 9, 0, tzinfo=ZoneInfo(wm.DEFAULT_TZ))
            with wm._connect_db(db_path) as conn:
                wm._init_db(conn)
                payload = wm._prepare_payload_for_storage(
                    conn,
                    self._make_issue_payload(
                        as_of=as_of,
                        title="AI 데이터센터 전력 투자",
                        summary="전력망과 반도체 투자가 함께 늘었다.",
                        story="AI 물리 인프라 비즈니스",
                    ),
                    story_catalog=[],
                )
                wm._upsert_sqlite_payload(conn, payload)

                fake = FakeEmbedder()
                first = wm._write_embeddings_for_payloads(
                    conn,
                    [payload],
                    engine=wm.DEFAULT_EMBEDDING_ENGINE,
                    model="test-model",
                    embedder=fake,
                    batch_size=8,
                )
                self.assertEqual(first["embedded"], 1)
                self.assertEqual(first["unchanged"], 0)
                self.assertEqual(len(fake.calls), 1)

                second = wm._write_embeddings_for_payloads(
                    conn,
                    [payload],
                    engine=wm.DEFAULT_EMBEDDING_ENGINE,
                    model="test-model",
                    embedder=fake,
                    batch_size=8,
                )
                self.assertEqual(second["embedded"], 0)
                self.assertEqual(second["unchanged"], 1)
                self.assertEqual(len(fake.calls), 1)

                changed = dict(payload)
                changed["summary"] = "전력망 병목과 메모리 투자 사이의 연결이 더 뚜렷해졌다."
                wm._upsert_sqlite_payload(conn, changed)
                third = wm._write_embeddings_for_payloads(
                    conn,
                    [changed],
                    engine=wm.DEFAULT_EMBEDDING_ENGINE,
                    model="test-model",
                    embedder=fake,
                    batch_size=8,
                )
                self.assertEqual(third["embedded"], 1)
                self.assertEqual(third["unchanged"], 0)
                self.assertEqual(len(fake.calls), 2)

    def test_brief_import_skip_duplicate_by_dedupe_key(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            db_path = Path(tmpdir) / "world_issue_log.sqlite3"
            with wm._connect_db(db_path) as conn:
                wm._init_db(conn)

            import_path = Path(tmpdir) / "brief_rows.json"
            import_payload = [
                {
                    "as_of": "2026-04-12T08:00:00+09:00",
                    "category": "stock_bond",
                    "region": "GLOBAL",
                    "importance": "medium",
                    "title": "중복 테스트 브리프",
                    "summary": "dedupe_key 중복 방지 검증",
                    "horizon": "수일~수주",
                    "tickers": ["SPY"],
                    "tags": ["test"],
                    "subjects": [{"name": "Test Subject", "type": "institution"}],
                    "industries": ["capital_markets"],
                    "event_kind": "capital_markets",
                    "dedupe_key": "brief_duplicate_case",
                    "sources": [{"name": "Test Source", "url": "https://example.com"}],
                }
            ]
            import_path.write_text(json.dumps(import_payload, ensure_ascii=False), encoding="utf-8")

            args = argparse.Namespace(
                base_dir=tmpdir,
                db_file="world_issue_log.sqlite3",
                from_file=str(import_path),
                category="emerging",
                region="GLOBAL",
                importance="low",
                horizon="수일~수주",
                skip_if_duplicate=True,
                dedupe_days=30,
                dry_run=False,
            )
            first_code = wm._handle_brief_import(args)
            second_code = wm._handle_brief_import(args)

            self.assertEqual(first_code, 0)
            self.assertEqual(second_code, 0)
            self.assertEqual(wm._count_sqlite_rows(db_path), 1)

    def test_brief_import_writes_embeddings_when_enabled(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            db_path = Path(tmpdir) / "world_issue_log.sqlite3"
            with wm._connect_db(db_path) as conn:
                wm._init_db(conn)

            import_path = Path(tmpdir) / "brief_rows.json"
            import_payload = [
                {
                    "as_of": "2026-04-12T08:00:00+09:00",
                    "category": "emerging",
                    "region": "GLOBAL",
                    "importance": "low",
                    "title": "임베딩 자동 저장 테스트",
                    "summary": "brief-import가 저장 직후 sidecar 임베딩을 함께 만든다.",
                    "horizon": "수일~수주",
                    "tags": ["test"],
                    "subjects": [{"name": "Test Industry", "type": "industry"}],
                    "industries": ["capital_markets"],
                    "event_kind": "industry_trend",
                    "dedupe_key": "brief_embedding_case",
                    "sources": [{"name": "Test Source", "url": "https://example.com"}],
                }
            ]
            import_path.write_text(json.dumps(import_payload, ensure_ascii=False), encoding="utf-8")

            args = argparse.Namespace(
                base_dir=tmpdir,
                db_file="world_issue_log.sqlite3",
                from_file=str(import_path),
                category="emerging",
                region="GLOBAL",
                importance="low",
                horizon="수일~수주",
                skip_if_duplicate=True,
                dedupe_days=30,
                embedding_mode="require",
                engine=wm.DEFAULT_EMBEDDING_ENGINE,
                model="test-model",
                batch_size=8,
                device="",
                max_seq_length=wm.DEFAULT_EMBEDDING_MAX_SEQ_LENGTH,
                verbose_model_load=False,
                dry_run=False,
            )
            with patch.object(wm, "_resolve_embedder", return_value=FakeEmbedder()):
                code = wm._handle_brief_import(args)

            self.assertEqual(code, 0)
            with wm._connect_db(db_path) as conn:
                row = conn.execute(
                    "SELECT COUNT(*) AS count FROM world_issue_embeddings WHERE embedding_model = ?",
                    ("test-model",),
                ).fetchone()
                self.assertIsNotNone(row)
                self.assertEqual(int(row["count"]), 1)


if __name__ == "__main__":
    unittest.main()
