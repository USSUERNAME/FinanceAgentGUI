from __future__ import annotations

import unittest
from datetime import datetime, timezone

from collectors.institutional_insights import collect, parse_sitemap


URLSET = b"""<?xml version="1.0"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://www.example.com/insights/articles/ai-capex</loc>
    <lastmod>2026-07-27T12:00:00Z</lastmod>
  </url>
  <url>
    <loc>https://www.example.com/careers/open-role</loc>
    <lastmod>2026-07-28T12:00:00Z</lastmod>
  </url>
</urlset>"""

INDEX = b"""<?xml version="1.0"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap><loc>https://www.example.com/sitemap-1.xml</loc></sitemap>
</sitemapindex>"""

ARTICLE = b"""<html><head>
<meta property="og:title" content="AI Capex Broadens Beyond Semiconductors">
</head></html>"""


class InstitutionalInsightsTests(unittest.TestCase):
    def test_sitemap_index_resolves_one_level(self) -> None:
        payloads = {
            "https://www.example.com/sitemap.xml": INDEX,
            "https://www.example.com/sitemap-1.xml": URLSET,
        }
        rows = parse_sitemap(
            "https://www.example.com/sitemap.xml",
            fetcher=payloads.__getitem__,
        )
        self.assertEqual(len(rows), 2)

    def test_collect_keeps_only_recent_official_research_metadata(self) -> None:
        payloads = {
            "https://www.example.com/sitemap.xml": URLSET,
            "https://www.example.com/insights/articles/ai-capex": ARTICLE,
        }
        items, notice = collect(
            {
                "institutional_insights": [{
                    "id": "example_public_insights",
                    "publisher": "Example Bank",
                    "sitemap_url": "https://www.example.com/sitemap.xml",
                    "official_domains": ["example.com"],
                    "path_patterns": ["^/insights/articles/"],
                    "max_age_days": 7,
                    "max_items": 5,
                    "market_scope": "US",
                }],
            },
            fetcher=payloads.__getitem__,
            now=datetime(2026, 7, 28, tzinfo=timezone.utc),
        )
        self.assertIsNone(notice)
        self.assertEqual(len(items), 1)
        item = items[0]
        self.assertEqual(
            item["title"],
            "AI Capex Broadens Beyond Semiconductors",
        )
        self.assertEqual(item["source_grade"], "B")
        self.assertTrue(item["primary_source_confirmed"])
        self.assertFalse(item["publication_eligible"])
        self.assertEqual(
            item["verification_status"],
            "official_metadata_requires_content_review",
        )
        self.assertEqual(item["market_scope"], "US")
        self.assertNotIn("ARTICLE", str(item))

    def test_collect_rejects_cross_domain_sitemap_entries(self) -> None:
        cross_domain = URLSET.replace(
            b"https://www.example.com/insights/articles/ai-capex",
            b"https://malicious.example.net/insights/articles/ai-capex",
        )
        items, notice = collect(
            {
                "institutional_insights": [{
                    "id": "example",
                    "sitemap_url": "https://www.example.com/sitemap.xml",
                    "official_domains": ["example.com"],
                    "path_patterns": ["^/insights/articles/"],
                }],
            },
            fetcher=lambda _: cross_domain,
            now=datetime(2026, 7, 28, tzinfo=timezone.utc),
        )
        self.assertEqual(items, [])
        self.assertIn("no recent usable items", notice)

    def test_collect_applies_title_relevance_gate(self) -> None:
        payloads = {
            "https://www.example.com/sitemap.xml": URLSET,
            "https://www.example.com/insights/articles/ai-capex": (
                b'<meta property="og:title" content="Donor-Advised Funds and Philanthropy">'
            ),
        }
        items, notice = collect(
            {
                "institutional_insights": [{
                    "id": "example",
                    "sitemap_url": "https://www.example.com/sitemap.xml",
                    "official_domains": ["example.com"],
                    "path_patterns": ["^/insights/articles/"],
                    "include_title_keywords": ["market", "stock", "AI"],
                    "exclude_title_keywords": ["donor-advised", "philanthrop"],
                }],
            },
            fetcher=payloads.__getitem__,
            now=datetime(2026, 7, 28, tzinfo=timezone.utc),
        )
        self.assertEqual(items, [])
        self.assertIn("no recent usable items", notice)


if __name__ == "__main__":
    unittest.main()
