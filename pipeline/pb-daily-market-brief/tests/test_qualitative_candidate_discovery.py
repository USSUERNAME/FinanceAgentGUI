import unittest

from discover_qualitative_candidates import candidate_reason, parse_rss_items


class QualitativeCandidateDiscoveryTests(unittest.TestCase):
    def test_rss_parser_returns_link_metadata_and_normalizes_date(self) -> None:
        payload = b'''<?xml version="1.0"?>
        <rss><channel><item><title>Policy outlook</title>
        <link>https://www.federalreserve.gov/example.htm</link>
        <pubDate>Mon, 20 Jul 2026 08:30:00 -0400</pubDate>
        </item></channel></rss>'''
        self.assertEqual(parse_rss_items(payload), [{
            "title": "Policy outlook",
            "url": "https://www.federalreserve.gov/example.htm",
            "published_at": "2026-07-20T08:30:00-04:00",
        }])

    def test_official_policy_candidate_is_visibly_not_market_commentary(self) -> None:
        reason = candidate_reason({
            "candidate_kind": "official_policy_signal",
            "themes": ["통화정책", "금리"],
        })
        self.assertIn("공식 정책 발언 후보", reason)
        self.assertIn("사실 검증용", reason)


if __name__ == "__main__":
    unittest.main()
