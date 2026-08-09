from __future__ import annotations

import json
import unittest
from email.message import Message
from unittest.mock import patch

from collectors.common import make_item
from prepare_event_evidence import (
    build_evidence_packets,
    evidence_record,
    extract_visible_text,
    fetch_official_text,
    select_representatives,
)
from resolve_event_sources import load_registry, resolve_event


def record(
    *,
    record_id_source: str,
    title: str,
    url: str,
    source_type: str = "international_news",
    grade: str = "D",
    primary: bool = False,
    tier: str = "general",
) -> dict:
    item = make_item(
        source_id=record_id_source,
        source_type=source_type,
        published_at="2026-07-23T10:00:00+00:00",
        title=title,
        url=url,
        tickers=[],
        tags=["rates"],
        raw_text=f"{title}. Description.",
        rights_label="metadata only",
        source_grade=grade,
        primary_source_confirmed=primary,
        publisher=record_id_source,
        source_url_kind="primary_source" if primary else "publisher_article",
    )
    item["candidate_filter"] = {"source_tier": tier}
    return item


def event_for(records: list[dict], event_type: str = "monetary_policy") -> dict:
    return {
        "event_id": "event_20260723_test",
        "event_type": event_type,
        "representative_title": "Federal Reserve interest rate outlook",
        "record_ids": [item["id"] for item in records],
        "article_count": len(records),
        "published_from": "2026-07-23T09:00:00+00:00",
        "published_to": "2026-07-23T11:00:00+00:00",
        "entities": ["federal reserve"],
        "topic_tags": ["interest rate", "monetary_policy"],
    }


class SourceResolutionTests(unittest.TestCase):
    def test_registry_is_valid(self) -> None:
        registry = load_registry()
        self.assertIn("monetary_policy", registry["routes"])
        self.assertIn("other", registry["routes"])

    def test_matching_official_record_is_origin_primary(self) -> None:
        official = record(
            record_id_source="fed_speeches",
            title="Federal Reserve governor discusses interest rate outlook",
            url="https://www.federalreserve.gov/newsevents/speech/test.htm",
            grade="A",
            primary=True,
            tier="primary",
        )
        event = event_for([official])
        resolved = resolve_event(event, [official], load_registry())
        self.assertEqual(resolved["resolution_status"], "origin_primary_matched")
        self.assertEqual(resolved["matched_sources"][0]["source_role"], "origin_primary")
        self.assertIsNone(resolved["search_plan"])

    def test_missing_primary_emits_search_plan_without_fake_evidence_url(self) -> None:
        publisher = record(
            record_id_source="publisher",
            title="Markets debate the Federal Reserve outlook",
            url="https://publisher.example/fed",
            tier="trusted",
        )
        resolved = resolve_event(event_for([publisher]), [publisher], load_registry())
        self.assertEqual(resolved["resolution_status"], "search_required")
        self.assertEqual(resolved["matched_sources"], [])
        self.assertIn("federalreserve.gov", resolved["search_plan"]["official_domains"])
        self.assertNotIn("evidence_url", resolved["search_plan"])

    def test_verified_discovery_record_links_back_to_its_event(self) -> None:
        publisher = record(
            record_id_source="publisher",
            title="기업 공시 검증 대기",
            url="https://publisher.example/filing",
            tier="trusted",
        )
        event = event_for([publisher], event_type="corporate_action")
        event["representative_title"] = "기업명: 셀피글로벌"
        event["entities"] = []
        event["topic_tags"] = ["유상증자"]
        discovered = record(
            record_id_source="official_event_discovery",
            title="DART filing 20260723000001",
            url="https://dart.fss.or.kr/dsaf001/main.do?rcpNo=20260723000001",
            source_type="official_release",
            grade="A",
            primary=True,
            tier="primary",
        )
        discovered["discovery_event_id"] = event["event_id"]
        discovered["raw_text"] = "앞부분 일반 공시 문구"

        resolved = resolve_event(event, [publisher, discovered], load_registry())

        self.assertEqual(resolved["resolution_status"], "origin_primary_matched")
        self.assertIn(
            "verified_discovery_event_link",
            resolved["matched_sources"][0]["match_reasons"],
        )

    def test_verified_discovery_record_does_not_link_to_another_event(self) -> None:
        publisher = record(
            record_id_source="publisher",
            title="기업 공시 검증 대기",
            url="https://publisher.example/filing",
            tier="trusted",
        )
        event = event_for([publisher], event_type="corporate_action")
        event["representative_title"] = "기업명: 셀피글로벌"
        event["entities"] = []
        event["topic_tags"] = ["유상증자"]
        discovered = record(
            record_id_source="official_event_discovery",
            title="DART filing 20260723000001",
            url="https://dart.fss.or.kr/dsaf001/main.do?rcpNo=20260723000001",
            source_type="official_release",
            grade="A",
            primary=True,
            tier="primary",
        )
        discovered["discovery_event_id"] = "different_event"
        discovered["raw_text"] = "앞부분 일반 공시 문구"

        resolved = resolve_event(event, [publisher, discovered], load_registry())

        self.assertEqual(resolved["resolution_status"], "search_required")


class OfficialBodyExtractionTests(unittest.TestCase):
    def test_visible_text_excludes_scripts_navigation_and_footer(self) -> None:
        html = """
        <html><header>Menu</header><body><h1>Policy decision</h1>
        <script>secret()</script><p>The committee maintained its target range.</p>
        <nav>Links</nav><footer>Footer</footer></body></html>
        """
        text = extract_visible_text(html, 1000)
        self.assertIn("Policy decision", text)
        self.assertIn("maintained its target range", text)
        self.assertNotIn("secret", text)
        self.assertNotIn("Menu", text)

    def test_fetch_rejects_non_official_domain_before_network(self) -> None:
        result = fetch_official_text(
            "https://publisher.example/story",
            ["federalreserve.gov"],
        )
        self.assertEqual(result["status"], "not_permitted_non_official_domain")

    def test_fetch_accepts_official_html_and_rechecks_redirect_domain(self) -> None:
        response_headers = Message()
        response_headers["Content-Type"] = "text/html; charset=utf-8"

        class FakeResponse:
            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return None

            def geturl(self):
                return "https://www.federalreserve.gov/newsevents/test.htm"

            def read(self, _limit):
                return b"<html><body><h1>Decision</h1><p>Official text.</p></body></html>"

        FakeResponse.headers = response_headers
        with patch("prepare_event_evidence.urlopen", return_value=FakeResponse()):
            result = fetch_official_text(
                "https://www.federalreserve.gov/newsevents/test.htm",
                ["federalreserve.gov"],
            )
        self.assertEqual(result["status"], "official_body_extracted")
        self.assertIn("Official text", result["text"])

    def test_verified_discovery_body_is_reused_without_another_network_fetch(self) -> None:
        discovered = record(
            record_id_source="official_event_discovery",
            title="DART filing 20260723000001",
            url="https://dart.fss.or.kr/dsaf001/main.do?rcpNo=20260723000001",
            source_type="official_release",
            grade="A",
            primary=True,
            tier="primary",
        )
        discovered["evidence_scope"] = "official_body_extracted"
        discovered["raw_text"] = "셀피글로벌 유상증자 공식 공시 본문"
        event = event_for([discovered], event_type="corporate_action")
        source_match = {
            "event_id": event["event_id"],
            "resolution_status": "origin_primary_matched",
            "evidence_posture": "research_grade_primary_available",
            "matched_sources": [{
                "record_id": discovered["id"],
                "source_role": "origin_primary",
            }],
            "official_route": {"origin_domains": ["dart.fss.or.kr"]},
            "search_plan": None,
        }

        with patch("prepare_event_evidence.fetch_official_text") as fetch:
            payload = build_evidence_packets(
                [event],
                [source_match],
                [discovered],
                {
                    "max_events": 10,
                    "max_representatives_per_event": 2,
                    "max_official_fetches": 3,
                    "max_official_body_chars": 12000,
                },
            )

        self.assertEqual(payload["official_fetches_used"], 0)
        evidence = payload["events"][0]["representatives"][0]
        self.assertEqual(evidence["evidence_label"], "fact_source_reported")
        self.assertTrue(
            evidence["body_extraction"]["reused_verified_discovery_body"]
        )
        fetch.assert_not_called()

    def test_primary_matched_event_is_prioritized_inside_evidence_budget(self) -> None:
        generic_events = []
        generic_matches = []
        generic_records = []
        for index in range(10):
            secondary = record(
                record_id_source=f"publisher-{index}",
                title=f"Generic market event {index}",
                url=f"https://publisher.example/{index}",
                tier="trusted",
            )
            generic_records.append(secondary)
            generic_event = event_for([secondary])
            generic_event["event_id"] = f"generic-{index}"
            generic_events.append(generic_event)
            generic_matches.append({
                "event_id": generic_event["event_id"],
                "resolution_status": "search_required",
                "evidence_posture": "missing_required_source",
                "matched_sources": [],
                "official_route": {"origin_domains": []},
                "search_plan": None,
            })

        discovered = record(
            record_id_source="official_event_discovery",
            title="DART filing 20260723000001",
            url="https://dart.fss.or.kr/dsaf001/main.do?rcpNo=20260723000001",
            source_type="official_release",
            grade="A",
            primary=True,
            tier="primary",
        )
        discovered["evidence_scope"] = "official_body_extracted"
        discovered["raw_text"] = "알테오젠 순이익 공식 공시 본문"
        verified_event = event_for([discovered], event_type="earnings_guidance")
        verified_event["event_id"] = "verified-late-event"
        verified_match = {
            "event_id": verified_event["event_id"],
            "resolution_status": "origin_primary_matched",
            "evidence_posture": "research_grade_primary_available",
            "matched_sources": [{
                "record_id": discovered["id"],
                "source_role": "origin_primary",
            }],
            "official_route": {"origin_domains": ["dart.fss.or.kr"]},
            "search_plan": None,
        }

        payload = build_evidence_packets(
            [*generic_events, verified_event],
            [*generic_matches, verified_match],
            [*generic_records, discovered],
            {
                "max_events": 10,
                "max_representatives_per_event": 2,
                "max_official_fetches": 3,
                "max_official_body_chars": 12000,
            },
        )

        event_ids = [row["event_id"] for row in payload["events"]]
        self.assertEqual(event_ids[0], "verified-late-event")
        self.assertEqual(len(event_ids), 10)
        self.assertNotIn("generic-9", event_ids)

    def test_nonmember_official_record_outside_event_window_does_not_match(self) -> None:
        official = record(
            record_id_source="fed_speeches",
            title="Federal Reserve interest rate outlook",
            url="https://federalreserve.gov/old-speech.htm",
            grade="A",
            primary=True,
            tier="primary",
        )
        official["published_at"] = "2026-07-15T10:00:00+00:00"
        publisher = record(
            record_id_source="publisher",
            title="Federal Reserve interest rate outlook",
            url="https://publisher.example/fed",
            tier="trusted",
        )
        resolved = resolve_event(event_for([publisher]), [publisher, official], load_registry())
        self.assertEqual(resolved["resolution_status"], "search_required")

    def test_unrelated_official_record_is_not_matched_on_one_generic_term(self) -> None:
        official = record(
            record_id_source="sec_inbox",
            title="Tesla submits Form 8-K",
            url="https://sec.gov/Archives/edgar/data/1318605/test.htm",
            grade="A",
            primary=True,
            tier="primary",
        )
        official["tags"] = ["market"]
        publisher = record(
            record_id_source="publisher",
            title="OpenAI security incident prompts congressional debate",
            url="https://publisher.example/openai",
            tier="trusted",
        )
        event = event_for([publisher], event_type="other")
        event["entities"] = ["OpenAI", "Congress"]
        event["topic_tags"] = ["market", "regulation"]

        resolved = resolve_event(
            event,
            [publisher, official],
            load_registry(),
        )

        self.assertEqual(resolved["resolution_status"], "search_required")
        self.assertEqual(resolved["matched_sources"], [])


class RepresentativeSelectionTests(unittest.TestCase):
    def test_primary_then_trusted_representatives_are_selected(self) -> None:
        official = record(
            record_id_source="fed_speeches",
            title="Federal Reserve interest rate outlook",
            url="https://federalreserve.gov/speech.htm",
            grade="A",
            primary=True,
            tier="primary",
        )
        trusted = record(
            record_id_source="trusted",
            title="Markets react to Federal Reserve outlook",
            url="https://reuters.com/markets/fed",
            tier="trusted",
        )
        event = event_for([trusted])
        source_match = {
            "matched_sources": [{
                "record_id": official["id"],
                "source_role": "origin_primary",
            }],
        }
        selected = select_representatives(
            event,
            source_match,
            {official["id"]: official, trusted["id"]: trusted},
            limit=2,
        )
        self.assertEqual([item["source_id"] for item in selected], ["fed_speeches", "trusted"])

    def test_secondary_body_is_never_fetched(self) -> None:
        trusted = record(
            record_id_source="trusted",
            title="Markets react to policy",
            url="https://reuters.com/markets/policy",
            tier="trusted",
        )
        with patch("prepare_event_evidence.fetch_official_text") as fetch:
            evidence = evidence_record(
                trusted,
                ["federalreserve.gov"],
                fetch_body=True,
                max_body_chars=12000,
            )
        fetch.assert_not_called()
        self.assertEqual(evidence["body_extraction"]["status"], "not_permitted_metadata_only")
        self.assertEqual(evidence["evidence_label"], "secondary_metadata_unverified")

    def test_packet_preserves_missing_source_posture(self) -> None:
        publisher = record(
            record_id_source="publisher",
            title="Markets debate policy",
            url="https://publisher.example/policy",
        )
        event = event_for([publisher])
        matches = [{
            "event_id": event["event_id"],
            "resolution_status": "search_required",
            "evidence_posture": "missing_required_source",
            "matched_sources": [],
            "search_plan": {"status": "search_required"},
            "official_route": {"origin_domains": ["federalreserve.gov"]},
        }]
        payload = build_evidence_packets(
            [event],
            matches,
            [publisher],
            {
                "max_events": 10,
                "max_representatives_per_event": 2,
                "max_official_fetches": 0,
            },
        )
        self.assertEqual(payload["events"][0]["evidence_posture"], "missing_required_source")
        self.assertEqual(
            payload["events"][0]["representatives"][0]["body_extraction"]["status"],
            "not_permitted_metadata_only",
        )


if __name__ == "__main__":
    unittest.main()
