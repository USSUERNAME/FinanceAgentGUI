from __future__ import annotations

import unittest

from compose_daily_brief import (
    EVENT_EVIDENCE_HEADING,
    FINAL_MARKER,
    REQUIRED_HEADINGS,
    event_evidence_reader_section,
    finalize_brief,
    source_section,
    validate_event_reader_gate,
)
from publish_to_notion import markdown_blocks


EVENT_ID = "event_20260723_test"
PRIMARY_ID = f"{EVENT_ID}:evidence:01"
SECONDARY_ID = f"{EVENT_ID}:evidence:02"


def snapshot() -> dict:
    return {
        "structured_event_evidence": {
            "events": [{
                "event_id": EVENT_ID,
                "representative_title": "Official inflation release",
                "evidence_ledger": [{
                    "evidence_id": PRIMARY_ID,
                    "title": "Official release",
                    "publisher": "Official Agency",
                    "url": "https://official.example/release",
                    "published_at": "2026-07-23T12:30:00+00:00",
                    "source_grade": "A",
                    "source_role": "origin_primary",
                    "evidence_label": "fact_source_reported",
                }, {
                    "evidence_id": SECONDARY_ID,
                    "title": "Publisher report",
                    "publisher": "Publisher",
                    "url": "https://publisher.example/report",
                    "published_at": "2026-07-23T12:35:00+00:00",
                    "source_grade": "B",
                    "source_role": "representative_secondary",
                    "evidence_label": "secondary_metadata_unverified",
                }],
                "facts": [{
                    "claim": "공식 기관이 물가 수치를 발표했다.",
                    "evidence_ids": [PRIMARY_ID],
                    "fact_status": "verified_primary",
                }],
                "reported_claims": [{
                    "claim": "매체는 예상보다 높다고 보도했다.",
                    "evidence_ids": [SECONDARY_ID],
                    "status": "reported_secondary_unverified",
                }],
            }],
        },
        "event_impact_synthesis": {
            "synthesis_status": "completed",
            "selected_event_ids": [EVENT_ID],
            "event_ranking": [{
                "event_id": EVENT_ID,
                "priority_score": 83,
                "evidence_readiness_score": 35,
            }],
            "events": [{
                "event_id": EVENT_ID,
                "synthesis_status": "complete",
                "bottom_line": "금리 민감 업종의 확인이 필요하다.",
                "what_is_new": {
                    "status": "verified_change",
                    "summary": "공식 수치가 새로 발표됐다.",
                    "evidence_ids": [PRIMARY_ID],
                },
                "transmission_channels": [{
                    "channel": "물가에서 실질금리로 전달",
                    "first_repricing_variable": "실질금리",
                    "sector_id": "semiconductors_ai_compute",
                    "first_affected_line_item": "밸류에이션 멀티플",
                    "direction": "negative",
                    "timing": "near_term",
                    "evidence_ids": [PRIMARY_ID],
                    "sector_context_status": "candidate_unverified",
                }],
                "priced_in_assessment": {
                    "status": "context_only",
                    "conclusion": "일별 수익률만으로 반영 여부를 판단할 수 없다.",
                },
                "strongest_counterargument": "세부 물가는 둔화됐을 수 있다.",
                "monitoring_signals": [{
                    "signal": "실질금리와 성장주 상대강도",
                    "role": "both",
                    "evidence_ids": [PRIMARY_ID],
                }],
                "action_posture": "wait_for_proof",
                "data_gaps": ["발표 전후 가격 반응"],
            }],
        },
        "source_quality": {
            "evidence_posture": "research_grade",
            "link_coverage_pct": 100.0,
            "unique_canonical_url_count": 2,
            "duplicate_canonical_url_record_count": 0,
        },
    }


def complete_text() -> str:
    parts = ["# draft"]
    for heading in REQUIRED_HEADINGS:
        parts.extend([f"## {heading}", "- 내용"])
    parts.append(FINAL_MARKER)
    return "\n".join(parts)


class EventReaderRenderingTests(unittest.TestCase):
    def test_reader_separates_fact_report_and_hypothesis_with_inline_links(self) -> None:
        section = event_evidence_reader_section(snapshot())
        self.assertIn(f"### {EVENT_EVIDENCE_HEADING}", section)
        self.assertIn("확인된 사실 [공식 원문]", section)
        self.assertIn("보도된 주장 [미검증]", section)
        self.assertIn("전달 경로 [가설·노출 검증 전 후보]", section)
        self.assertIn("[Official Agency·등급 A](https://official.example/release)", section)
        self.assertIn("[Publisher·등급 B](https://publisher.example/report)", section)
        self.assertIn("비인과적 시장 맥락", section)

    def test_reader_shows_explicit_nonpublication_when_synthesis_failed(self) -> None:
        payload = snapshot()
        payload["event_impact_synthesis"] = {
            "synthesis_status": "not_run",
            "fallback_reason": "dry_run",
        }
        section = event_evidence_reader_section(payload)
        self.assertIn("사건 종합 상태: 미완료", section)
        self.assertIn("사실이나 시장 영향을 확정하지 않습니다", section)

    def test_finalizer_inserts_reader_section_under_international_news(self) -> None:
        result = finalize_brief(complete_text(), [], "2026-07-23", snapshot())
        international_heading = f"## {REQUIRED_HEADINGS[8]}"
        self.assertIn(f"### {EVENT_EVIDENCE_HEADING}", result)
        self.assertLess(
            result.index(international_heading),
            result.index(f"### {EVENT_EVIDENCE_HEADING}"),
        )
        self.assertTrue(result.rstrip().endswith(FINAL_MARKER))

    def test_notion_renderer_keeps_event_heading_and_event_card(self) -> None:
        result = finalize_brief(complete_text(), [], "2026-07-23", snapshot())
        _, blocks = markdown_blocks(result)

        event_heading = next(
            block["heading_3"]
            for block in blocks
            if block["type"] == "heading_3"
            and block["heading_3"]["rich_text"][0]["text"]["content"]
            == EVENT_EVIDENCE_HEADING
        )
        event_card = next(
            block["callout"]
            for block in blocks
            if block["type"] == "callout"
            and "1. Official inflation release"
            in block["callout"]["rich_text"][0]["text"]["content"]
        )

        self.assertEqual(
            event_heading["rich_text"][0]["text"]["content"],
            EVENT_EVIDENCE_HEADING,
        )
        self.assertEqual(event_card["icon"]["emoji"], "📰")
        self.assertEqual(event_card["color"], "yellow_background")


class EventReaderGateTests(unittest.TestCase):
    def test_complete_event_passes_reader_gate(self) -> None:
        validate_event_reader_gate(snapshot())

    def test_missing_url_blocks_completed_event(self) -> None:
        payload = snapshot()
        payload["structured_event_evidence"]["events"][0]["evidence_ledger"][0]["url"] = ""
        with self.assertRaisesRegex(ValueError, "missing a reader URL"):
            validate_event_reader_gate(payload)

    def test_unknown_evidence_id_blocks_completed_event(self) -> None:
        payload = snapshot()
        payload["event_impact_synthesis"]["events"][0]["what_is_new"]["evidence_ids"] = ["invented"]
        with self.assertRaisesRegex(ValueError, "unknown evidence IDs"):
            validate_event_reader_gate(payload)

    def test_missing_sector_status_blocks_completed_event(self) -> None:
        payload = snapshot()
        del payload["event_impact_synthesis"]["events"][0]["transmission_channels"][0][
            "sector_context_status"
        ]
        with self.assertRaisesRegex(ValueError, "sector verification status"):
            validate_event_reader_gate(payload)

    def test_failed_synthesis_does_not_block_daily_report(self) -> None:
        payload = snapshot()
        payload["event_impact_synthesis"] = {
            "synthesis_status": "not_run",
            "fallback_reason": "RuntimeError",
        }
        validate_event_reader_gate(payload)


class EventSourceInventoryTests(unittest.TestCase):
    def test_event_sources_precede_and_deduplicate_general_inventory(self) -> None:
        duplicate_item = {
            "source_id": "official",
            "publisher": "Official Agency",
            "source_grade": "A",
            "source_url_kind": "primary_source",
            "title": "Official release",
            "url": "https://official.example/release",
            "canonical_url": "https://official.example/release",
        }
        section = source_section([duplicate_item], snapshot())
        self.assertEqual(section.count("https://official.example/release"), 1)
        self.assertIn("공식 원문 본문 확인", section)
        self.assertIn(f"`{PRIMARY_ID}`", section)
        self.assertIn("2차 보도·본문 미검증", section)


if __name__ == "__main__":
    unittest.main()
