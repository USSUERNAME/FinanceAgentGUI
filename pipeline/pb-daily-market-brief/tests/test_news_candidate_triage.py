from __future__ import annotations

import json
import unittest
from unittest.mock import patch

from collectors.common import make_item
from triage_news_candidates import (
    build_event_clusters,
    build_triage_outputs,
    call_local_classifier,
    deterministic_triage,
    validate_local_endpoint,
)


def news_item(
    *,
    source_id: str,
    title: str,
    url: str,
    published_at: str = "2026-07-23T10:00:00+00:00",
    source_tier: str = "general",
    matched: list[str] | None = None,
    primary: bool = False,
) -> dict:
    item = make_item(
        source_id=source_id,
        source_type="international_news",
        published_at=published_at,
        title=title,
        url=url,
        tickers=[],
        tags=["market"],
        raw_text=f"{title}. Additional description.",
        rights_label="metadata only",
        source_grade="A" if primary else "D",
        primary_source_confirmed=primary,
        publisher=source_id,
        source_url_kind="primary_source" if primary else "publisher_article",
    )
    item["candidate_filter"] = {
        "source_tier": source_tier,
        "matched_include_keywords": matched or [],
        "status": "eligible" if source_tier != "general" or matched else "needs_local_classification",
    }
    return item


class LocalEndpointTests(unittest.TestCase):
    def test_loopback_endpoint_is_allowed(self) -> None:
        self.assertEqual(
            validate_local_endpoint("http://127.0.0.1:11434/v1/chat/completions"),
            "http://127.0.0.1:11434/v1/chat/completions",
        )

    def test_remote_endpoint_is_rejected(self) -> None:
        with self.assertRaisesRegex(ValueError, "loopback"):
            validate_local_endpoint("https://api.example.com/v1/chat/completions")

    def test_local_classifier_validates_json_contract(self) -> None:
        record = news_item(
            source_id="publisher",
            title="Chip company raises annual guidance",
            url="https://publisher.example/chips",
        )
        response_payload = {
            "choices": [{"message": {"content": json.dumps({
                "decision": "keep",
                "confidence": 0.91,
                "reason_codes": ["guidance_change"],
                "event_type": "earnings_guidance",
                "entities": ["NVIDIA"],
                "topic_tags": ["semiconductor", "guidance"],
            })}}],
        }

        class FakeResponse:
            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return None

            def read(self):
                return json.dumps(response_payload).encode("utf-8")

        with patch("triage_news_candidates.urlopen", return_value=FakeResponse()):
            result = call_local_classifier(
                record,
                "http://127.0.0.1:11434/v1/chat/completions",
                "local-model",
            )
        self.assertEqual(result["decision"], "keep")
        self.assertEqual(result["classifier"], "local_openai_compatible")
        self.assertEqual(result["event_type"], "earnings_guidance")


class DeterministicTriageTests(unittest.TestCase):
    def test_primary_or_keyword_supported_item_is_kept(self) -> None:
        item = news_item(
            source_id="fed",
            title="Federal Reserve governor discusses outlook",
            url="https://federalreserve.gov/speech.htm",
            source_tier="primary",
            primary=True,
        )
        result = deterministic_triage(item)
        self.assertEqual(result["decision"], "keep")
        self.assertIn("Federal Reserve", result["entities"])

    def test_ambiguous_general_item_requests_more_text(self) -> None:
        item = news_item(
            source_id="publisher",
            title="Company announces an update",
            url="https://publisher.example/update",
        )
        result = deterministic_triage(item)
        self.assertEqual(result["decision"], "needs_more_text")

    def test_general_headline_only_item_is_not_kept_on_keyword_alone(self) -> None:
        item = news_item(
            source_id="gdelt",
            title="Markets digest inflation news",
            url="https://publisher.example/inflation",
            matched=["inflation"],
        )
        item["raw_text"] = item["title"]
        result = deterministic_triage(item)
        self.assertEqual(result["decision"], "needs_more_text")

    def test_radar_headline_can_create_event_but_not_enter_report_input(self) -> None:
        radar = news_item(
            source_id="fast_radar",
            title="Federal Reserve signals change to interest rates",
            url="https://relay.example/fed",
            matched=["rates", "federal reserve"],
        )
        radar.update({
            "source_type": "news_discovery",
            "discovery_role": "breaking_news_radar",
            "publication_eligible": False,
            "verification_status": "discovery_metadata_only",
        })
        report, audit, events = build_triage_outputs(
            [radar],
            {
                "cluster_time_window_hours": 48,
                "cluster_title_similarity_threshold": 0.58,
            },
        )
        self.assertEqual(report, [])
        self.assertEqual(audit["decision_counts"]["keep"], 1)
        self.assertEqual(audit["publication_blocked_record_ids"], [radar["id"]])
        self.assertEqual(events["cluster_count"], 1)
        self.assertEqual(
            events["clusters"][0]["verification_status"],
            "discovery_metadata_only",
        )

    def test_institutional_metadata_is_clustered_but_not_published_unreviewed(self) -> None:
        insight = news_item(
            source_id="goldman_sachs_public_insights",
            title="Three New Stock Themes Are in Focus as the AI Trade Gyrates",
            url="https://goldmansachs.com/insights/articles/stock-themes",
            source_tier="trusted",
        )
        insight.update({
            "source_type": "institutional_research_metadata",
            "discovery_role": "institutional_research",
            "publication_eligible": False,
            "verification_status": "official_metadata_requires_content_review",
            "evidence_label": "attributed_analysis",
        })
        report, audit, events = build_triage_outputs(
            [insight],
            {
                "cluster_time_window_hours": 48,
                "cluster_title_similarity_threshold": 0.58,
            },
        )
        self.assertEqual(report, [])
        self.assertEqual(audit["decision_counts"]["keep"], 1)
        self.assertEqual(audit["publication_blocked_record_ids"], [insight["id"]])
        self.assertEqual(events["cluster_count"], 1)
        self.assertEqual(
            events["clusters"][0]["verification_status"],
            "official_institutional_commentary_metadata",
        )


class EventClusteringTests(unittest.TestCase):
    def test_same_entity_topic_and_time_are_clustered(self) -> None:
        left = news_item(
            source_id="one",
            title="Fed signals patience on interest rates after meeting",
            url="https://one.example/fed",
            source_tier="trusted",
        )
        right = news_item(
            source_id="two",
            title="Federal Reserve signals patience on rates after meeting",
            url="https://two.example/fed",
            published_at="2026-07-23T11:00:00+00:00",
            source_tier="trusted",
        )
        for item in (left, right):
            item["triage"] = deterministic_triage(item)
        clusters = build_event_clusters([left, right], {
            "cluster_time_window_hours": 48,
            "cluster_title_similarity_threshold": 0.5,
        })
        self.assertEqual(len(clusters), 1)
        self.assertEqual(clusters[0]["article_count"], 2)
        self.assertEqual(clusters[0]["event_type"], "monetary_policy")
        self.assertEqual(left["event_cluster"]["event_id"], right["event_cluster"]["event_id"])

    def test_different_entities_do_not_cluster_on_generic_market_tag(self) -> None:
        fed = news_item(
            source_id="one",
            title="Federal Reserve discusses interest rates",
            url="https://one.example/fed",
            source_tier="trusted",
        )
        tesla = news_item(
            source_id="two",
            title="Tesla discusses annual vehicle production",
            url="https://two.example/tesla",
            source_tier="trusted",
        )
        for item in (fed, tesla):
            item["triage"] = deterministic_triage(item)
        clusters = build_event_clusters([fed, tesla], {
            "cluster_time_window_hours": 48,
            "cluster_title_similarity_threshold": 0.5,
        })
        self.assertEqual(len(clusters), 2)

    def test_report_inbox_excludes_needs_more_text_but_audit_preserves_it(self) -> None:
        official = news_item(
            source_id="official",
            title="Federal Reserve releases policy update",
            url="https://federalreserve.gov/update.htm",
            source_tier="primary",
            primary=True,
        )
        ambiguous = news_item(
            source_id="unknown",
            title="Company announces an update",
            url="https://unknown.example/update",
        )
        filing = make_item(
            source_id="sec",
            source_type="filing",
            published_at="2026-07-23T09:00:00+00:00",
            title="8-K filing",
            url="https://sec.gov/filing",
            tickers=["NVDA"],
            tags=["filing"],
            raw_text="8-K",
            rights_label="public",
            source_grade="A",
            primary_source_confirmed=True,
        )
        report, audit, events = build_triage_outputs(
            [official, ambiguous, filing],
            {"cluster_time_window_hours": 48, "cluster_title_similarity_threshold": 0.58},
        )
        self.assertEqual({item["source_id"] for item in report}, {"official", "sec"})
        self.assertEqual(audit["decision_counts"]["keep"], 1)
        self.assertEqual(audit["decision_counts"]["needs_more_text"], 1)
        self.assertEqual(events["cluster_count"], 1)


if __name__ == "__main__":
    unittest.main()
