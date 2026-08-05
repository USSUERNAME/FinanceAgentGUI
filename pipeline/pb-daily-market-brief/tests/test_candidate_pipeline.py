from __future__ import annotations

import unittest
from datetime import datetime, timezone
from unittest.mock import patch

from candidate_pipeline import (
    deduplicate_candidate_records,
    evaluate_candidate,
    filter_candidate_records,
)
from collectors.common import make_item
from collectors import gdelt, rss_candidates


def candidate(
    *,
    source_id: str = "news",
    published_at: str = "2026-07-23T00:00:00+00:00",
    title: str = "Federal Reserve signals patience on interest rates",
    url: str = "https://example.com/story",
    source_grade: str = "D",
    primary: bool = False,
) -> dict:
    return make_item(
        source_id=source_id,
        source_type="international_news",
        published_at=published_at,
        title=title,
        url=url,
        tickers=[],
        tags=["market"],
        raw_text=title,
        rights_label="metadata only",
        source_grade=source_grade,
        primary_source_confirmed=primary,
        publisher=source_id,
        source_url_kind="primary_source" if primary else "publisher_article",
    )


class CandidateDeduplicationTests(unittest.TestCase):
    def test_near_identical_titles_inside_time_window_are_collapsed(self) -> None:
        weak = candidate(
            source_id="aggregator",
            title="Fed signals patience on interest rates, markets react",
            url="https://aggregator.example/story-1",
        )
        strong = candidate(
            source_id="official",
            published_at="2026-07-23T00:30:00+00:00",
            title="Fed signals patience on interest rates as markets react",
            url="https://federalreserve.gov/newsevents/story.htm",
            source_grade="A",
            primary=True,
        )
        records, suppressed = deduplicate_candidate_records([weak, strong])
        self.assertEqual(suppressed, 1)
        self.assertEqual(records[0]["source_id"], "official")
        self.assertIn("title_and_publication_window", records[0]["deduplication"]["match_reasons"])

    def test_similar_title_outside_time_window_is_not_collapsed(self) -> None:
        older = candidate(published_at="2026-07-20T00:00:00+00:00")
        newer = candidate(
            source_id="other",
            published_at="2026-07-23T00:00:00+00:00",
            url="https://other.example/story",
        )
        records, suppressed = deduplicate_candidate_records([older, newer])
        self.assertEqual(suppressed, 0)
        self.assertEqual(len(records), 2)


class CandidateFilterTests(unittest.TestCase):
    SETTINGS = {
        "max_age_hours": 72,
        "primary_domains": ["federalreserve.gov"],
        "trusted_domains": ["reuters.com"],
        "blocked_domains": ["blocked.example"],
        "include_keywords": ["interest rates", "earnings"],
        "hard_exclude_keywords": ["celebrity"],
    }
    NOW = datetime(2026, 7, 23, 12, tzinfo=timezone.utc)

    def test_general_unmatched_item_is_kept_for_local_classification(self) -> None:
        item = candidate(title="A company announces a new product")
        evaluated, retained = evaluate_candidate(item, self.SETTINGS, now=self.NOW)
        self.assertTrue(retained)
        self.assertEqual(evaluated["candidate_filter"]["status"], "needs_local_classification")

    def test_stale_and_blocked_items_are_removed_with_audit_counts(self) -> None:
        stale = candidate(published_at="2026-07-18T00:00:00+00:00")
        blocked = candidate(
            source_id="blocked",
            url="https://blocked.example/story",
            title="Company earnings update",
        )
        kept, summary = filter_candidate_records([stale, blocked], self.SETTINGS, now=self.NOW)
        self.assertEqual(kept, [])
        self.assertEqual(summary["counts"]["discard"], 2)
        self.assertEqual(len(summary["discarded_record_ids"]), 2)

    def test_primary_source_is_eligible_even_without_keyword_match(self) -> None:
        item = candidate(
            url="https://www.federalreserve.gov/newsevents/speech/test.htm",
            title="Governor remarks",
            source_grade="A",
            primary=True,
        )
        evaluated, retained = evaluate_candidate(item, self.SETTINGS, now=self.NOW)
        self.assertTrue(retained)
        self.assertEqual(evaluated["candidate_filter"]["source_tier"], "primary")
        self.assertEqual(evaluated["candidate_filter"]["status"], "eligible")


class CandidateCollectorTests(unittest.TestCase):
    def test_gdelt_collector_emits_link_only_metadata(self) -> None:
        payload = {"articles": [{
            "url": "https://publisher.example/story",
            "title": "Markets digest an inflation surprise",
            "seendate": "20260723T101500Z",
            "domain": "publisher.example",
            "language": "English",
            "sourcecountry": "United States",
        }]}
        with patch("collectors.gdelt.get_json", return_value=payload):
            items, notice = gdelt.collect({"gdelt": {"enabled": True}})
        self.assertIsNone(notice)
        self.assertEqual(items[0]["source_id"], "gdelt")
        self.assertEqual(items[0]["evidence_scope"], "headline_metadata")
        self.assertEqual(items[0]["published_at"], "2026-07-23T10:15:00+00:00")

    def test_rss_parser_supports_rss_and_keeps_link_metadata(self) -> None:
        payload = b"""<?xml version="1.0"?>
        <rss><channel><item><title>Policy outlook</title>
        <link>https://www.federalreserve.gov/example.htm</link>
        <pubDate>Thu, 23 Jul 2026 08:30:00 -0400</pubDate>
        </item></channel></rss>"""
        self.assertEqual(rss_candidates.parse_feed_items(payload), [{
            "title": "Policy outlook",
            "url": "https://www.federalreserve.gov/example.htm",
            "published_at": "2026-07-23T08:30:00-04:00",
        }])

    def test_rss_primary_status_requires_matching_official_domain(self) -> None:
        payload = b"""<?xml version="1.0"?>
        <rss><channel><item><title>Republished policy outlook</title>
        <link>https://publisher.example/fed-story</link>
        <pubDate>Thu, 23 Jul 2026 08:30:00 -0400</pubDate>
        </item></channel></rss>"""

        class FakeResponse:
            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return None

            def read(self):
                return payload

        config = {"rss_candidates": [{
            "id": "fed",
            "feed_url": "https://federalreserve.gov/feed.xml",
            "source_grade": "A",
            "primary_source_confirmed": True,
            "official_domains": ["federalreserve.gov"],
        }]}
        with patch("collectors.rss_candidates.urlopen", return_value=FakeResponse()):
            items, notice = rss_candidates.collect(config)
        self.assertIsNone(notice)
        self.assertFalse(items[0]["primary_source_confirmed"])
        self.assertEqual(items[0]["source_grade"], "D")
        self.assertEqual(items[0]["source_url_kind"], "publisher_article")

    def test_breaking_news_radar_is_forced_to_nonpublication_metadata(self) -> None:
        payload = b"""<?xml version="1.0"?>
        <rss><channel><item><title>Markets react to a policy headline</title>
        <link>https://publisher.example/policy-headline</link>
        <pubDate>Thu, 23 Jul 2026 08:30:00 -0400</pubDate>
        </item></channel></rss>"""

        class FakeResponse:
            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return None

            def read(self):
                return payload

        config = {"rss_candidates": [{
            "id": "fast_radar",
            "feed_url_env": "TEST_RADAR_RSS_URL",
            "feed_role": "breaking_news_radar",
            "source_grade": "A",
            "primary_source_confirmed": True,
            "official_domains": ["publisher.example"],
        }]}
        with (
            patch.dict("os.environ", {"TEST_RADAR_RSS_URL": "https://rss.example/feed"}),
            patch("collectors.rss_candidates.urlopen", return_value=FakeResponse()),
        ):
            items, notice = rss_candidates.collect(config)
        self.assertIsNone(notice)
        self.assertEqual(items[0]["source_type"], "news_discovery")
        self.assertEqual(items[0]["source_grade"], "D")
        self.assertEqual(items[0]["evidence_scope"], "metadata_only")
        self.assertFalse(items[0]["primary_source_confirmed"])
        self.assertFalse(items[0]["publication_eligible"])
        self.assertEqual(items[0]["verification_status"], "discovery_metadata_only")


if __name__ == "__main__":
    unittest.main()
