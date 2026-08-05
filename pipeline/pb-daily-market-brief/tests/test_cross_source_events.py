from __future__ import annotations

import unittest

from build_cross_source_events import build_cross_source_events
from collectors.common import make_item
from triage_news_candidates import build_event_clusters, deterministic_triage


def item(
    source_id: str,
    source_type: str,
    title: str,
    *,
    ticker: str = "NVDA",
    primary: bool = False,
) -> dict:
    row = make_item(
        source_id=source_id,
        source_type=source_type,
        published_at="2026-07-28T10:00:00+00:00",
        title=title,
        url=f"https://{source_id}.example/{title.replace(' ', '-')}",
        tickers=[ticker] if ticker else [],
        tags=["semiconductor", "earnings"],
        raw_text=(
            title
            + " bounded description with earnings, revenue, semiconductor demand, "
            + "guidance, and follow-up market context for deterministic triage."
        ),
        rights_label="test",
        source_grade="A" if primary else "D",
        primary_source_confirmed=primary,
        evidence_scope="filing_body_excerpt" if primary else "metadata_only",
        publisher=source_id,
        source_url_kind="primary_source" if primary else "publisher_article",
    )
    if source_type in {"international_news", "telegram_commentary"}:
        row["candidate_filter"] = {
            "source_tier": "trusted" if source_type == "international_news" else "general",
            "matched_include_keywords": ["earnings", "semiconductor"],
            "status": "eligible",
        }
        row["triage"] = deterministic_triage(row)
    return row


class CrossSourceEventTests(unittest.TestCase):
    def test_combines_discovery_research_and_primary_without_promoting_opinion(self) -> None:
        news = item("news", "international_news", "NVIDIA earnings guidance rises")
        telegram = item("telegram", "telegram_commentary", "NVDA guidance rises after earnings")
        filing = item("sec", "filing", "NVDA 8-K earnings filing", primary=True)
        clusters = {
            "clusters": build_event_clusters(
                [news, telegram],
                {
                    "cluster_time_window_hours": 48,
                    "cluster_title_similarity_threshold": 0.3,
                },
            )
        }
        report = item("drive", "broker_report", "NVIDIA earnings review", primary=False)
        analysis = {
            "report_id": report["id"],
            "analyst": "Analyst A",
            "report_type": "company",
            "stance": "positive",
            "summary": "NVIDIA earnings and guidance support semiconductor demand.",
            "key_claims": ["NVDA guidance rose after earnings."],
            "catalysts": [],
            "risks": [],
            "sectors": ["semiconductor"],
            "tickers": ["NVDA"],
        }

        payload = build_cross_source_events(
            report_date="2026-07-28",
            records=[news, telegram, filing, report],
            clusters_payload=clusters,
            broker_analysis_payload={"reports": [analysis]},
            generated_at="2026-07-28T12:00:00+00:00",
        )

        self.assertEqual(payload["event_count"], 1)
        event = payload["events"][0]
        self.assertEqual(len(event["official_sources"]), 1)
        self.assertEqual(len(event["attributed_research"]), 1)
        self.assertEqual(len(event["discovery_sources"]), 2)
        self.assertEqual(event["cross_source_status"], "primary_verified_with_context")
        self.assertEqual(
            event["attributed_research"][0]["evidence_role"],
            "attributed_analysis_only",
        )
        self.assertNotIn("raw_text", event["attributed_research"][0])

    def test_broad_daily_report_does_not_merge_on_generic_market_words(self) -> None:
        news = item("news", "international_news", "NVIDIA earnings guidance rises")
        clusters = {
            "clusters": build_event_clusters(
                [news],
                {"cluster_time_window_hours": 48},
            )
        }
        report = item("drive", "broker_report", "Daily market research", ticker="")
        analysis = {
            "report_id": report["id"],
            "analyst": "Desk",
            "report_type": "other",
            "stance": "not_stated",
            "summary": "Daily market and stock overview.",
            "key_claims": ["Markets were mixed."],
            "catalysts": [],
            "risks": [],
            "sectors": ["전체시장"],
            "tickers": [],
        }
        payload = build_cross_source_events(
            report_date="2026-07-28",
            records=[news, report],
            clusters_payload=clusters,
            broker_analysis_payload={"reports": [analysis]},
        )
        self.assertEqual(payload["events"][0]["attributed_research"], [])
        self.assertEqual(len(payload["unmatched_research_context"]), 1)

    def test_same_inputs_are_deterministic_except_default_timestamp(self) -> None:
        news = item("news", "international_news", "NVIDIA earnings guidance rises")
        clusters = {"clusters": build_event_clusters([news], {})}
        first = build_cross_source_events(
            report_date="2026-07-28",
            records=[news],
            clusters_payload=clusters,
            generated_at="fixed",
        )
        second = build_cross_source_events(
            report_date="2026-07-28",
            records=[news],
            clusters_payload=clusters,
            generated_at="fixed",
        )
        self.assertEqual(first, second)


if __name__ == "__main__":
    unittest.main()
