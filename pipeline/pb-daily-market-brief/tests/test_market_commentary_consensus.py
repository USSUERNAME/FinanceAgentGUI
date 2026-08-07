import unittest

from append_qualitative_analysis import render_section, source_posture, validate_commentary


class MarketCommentaryConsensusTests(unittest.TestCase):
    def setUp(self) -> None:
        self.items = [
            {
                "title": "AI capex note", "source": "Example Research",
                "url": "https://example.com/note", "memo": "",
                "property_excerpt": "Named analyst expects capex to hold.", "page_excerpt": "",
            },
            {
                "title": "Risk note", "source": "Example Macro",
                "url": "", "memo": "경계 의견", "property_excerpt": "", "page_excerpt": "",
            },
        ]
        self.payload = {
            "comments": [
                {
                    "item_index": 0, "stance": "positive", "speaker": "Kim Analyst",
                    "affiliation": "Example Research", "theme": "AI 투자",
                    "summary": "AI 투자 계획 유지가 수요 우려를 낮출 수 있다는 의견.",
                    "confirmation_or_risk": "대형 고객의 투자 계획 확인 필요.",
                },
                {
                    "item_index": 1, "stance": "caution", "speaker": "발언자 미식별",
                    "affiliation": "소속 미식별", "theme": "변동성",
                    "summary": "단기 변동성 확대를 경계한 메모.",
                    "confirmation_or_risk": "원문 링크가 없어 추가 확인 필요.",
                },
            ],
            "consensus": {
                "common_view": "AI 투자 지속 여부가 핵심이라는 선택 의견.",
                "key_confirmation": "공식 투자계획과 실적 확인.",
                "key_risk": "링크 없는 메모의 출처 확인 한계.",
                "coverage_limit": "선택된 Inbox 표본이며 시장 전체 조사가 아님.",
            },
        }

    def test_source_posture_keeps_unlinked_note_out_of_linked_claim(self) -> None:
        self.assertEqual(source_posture(self.items[0]), "linked_excerpt")
        self.assertEqual(source_posture(self.items[1]), "note_only")

    def test_renderer_keeps_counts_and_source_limits_deterministic(self) -> None:
        section = render_section(self.items, self.payload, "7월 21일")
        self.assertIn("## 주요 시장 코멘트 (7월 21일)", section)
        self.assertIn("🟢 긍정 1건 · 🟡 중립 0건 · 🔴 부정·경계 1건", section)
        self.assertIn("[원문 링크 · Example Research](https://example.com/note)", section)
        self.assertIn("원문 링크 미등록 · Example Macro", section)
        self.assertIn("시장 전체 조사가 아님", section)

    def test_validator_rejects_unknown_item(self) -> None:
        broken = dict(self.payload)
        broken["comments"] = [dict(self.payload["comments"][0], item_index=9)]
        with self.assertRaisesRegex(ValueError, "unknown inbox item"):
            validate_commentary(broken, len(self.items))


if __name__ == "__main__":
    unittest.main()
