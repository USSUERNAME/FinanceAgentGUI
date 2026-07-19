from __future__ import annotations

import importlib.util
import json
import sys
import unittest
from datetime import timezone
from pathlib import Path
from unittest import mock


ROOT = Path(__file__).resolve().parents[1]
SCRIPT_PATH = ROOT / "scripts" / "analyze_market.py"
SPEC = importlib.util.spec_from_file_location("analyze_market", SCRIPT_PATH)
assert SPEC and SPEC.loader
analyze_market = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = analyze_market
SPEC.loader.exec_module(analyze_market)


class AnalyzeMarketFeedTest(unittest.TestCase):
    def test_world_memory_breaking_news_uses_four_named_rss_feeds(self) -> None:
        self.assertEqual(
            analyze_market.RSS_FEEDS,
            [
                ("First Squawk", "https://rss.app/feeds/d68ow40E3dkwaEvN.xml", -540),
                ("unusual_whales", "https://rss.app/feeds/nikLNBATmLDuprRz.xml", -540),
                ("FinancialJuice", "https://rss.app/feeds/5VaycMAa8SwPhOAP.xml", 0),
                ("*Walter Bloomberg", "https://rss.app/feeds/YcRRdWN5eSO3o2LP.xml", 0),
            ],
        )

    def test_news_feed_defaults_ship_the_same_four_rss_app_sources(self) -> None:
        defaults = json.loads((ROOT / "config" / "news-feeds.defaults.json").read_text())
        configured = [
            (feed["title"], feed["url"], feed.get("publishedAtOffsetMinutes", 0))
            for feed in defaults["feeds"]
        ]

        self.assertEqual(configured, analyze_market.RSS_FEEDS[2:] + analyze_market.RSS_FEEDS[:2])
        self.assertTrue(all(feed["enabled"] for feed in defaults["feeds"]))

    def test_rss_app_xml_is_parsed_with_rfc_2822_timestamp_and_source_name(self) -> None:
        xml = """<?xml version="1.0" encoding="UTF-8"?>
        <rss version="2.0"><channel><item>
          <title><![CDATA[Fed keeps rates unchanged]]></title>
          <link>https://x.com/example/status/1</link>
          <pubDate>Sun, 19 Jul 2026 16:04:00 GMT</pubDate>
        </item></channel></rss>"""
        with mock.patch.object(analyze_market, "_fetch_url_text", return_value=xml):
            rows = analyze_market.fetch_rss_feed(
                "First Squawk",
                "https://rss.app/feeds/example.xml",
                timeout=5,
                published_at_offset_minutes=-540,
            )

        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0].source, "First Squawk")
        self.assertEqual(rows[0].feed_type, "rss")
        self.assertEqual(rows[0].channel, "https://rss.app/feeds/example.xml")
        self.assertEqual(rows[0].published_at.tzinfo, timezone.utc)
        self.assertEqual(rows[0].published_at.isoformat(), "2026-07-19T07:04:00+00:00")

    def test_fetch_news_requests_each_rss_feed_independently(self) -> None:
        requested: list[tuple[str, str]] = []

        def fake_fetch(
            source_name: str,
            url: str,
            timeout: int,
            published_at_offset_minutes: int = 0,
        ):
            requested.append((source_name, url, published_at_offset_minutes))
            return []

        with mock.patch.object(analyze_market, "fetch_rss_feed", side_effect=fake_fetch):
            rows, errors = analyze_market.fetch_news(timeout=5, max_items=20)

        self.assertEqual(rows, [])
        self.assertEqual(errors, [])
        self.assertEqual(requested, analyze_market.RSS_FEEDS)


if __name__ == "__main__":
    unittest.main()
