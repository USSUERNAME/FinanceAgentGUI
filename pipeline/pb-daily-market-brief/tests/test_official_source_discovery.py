from __future__ import annotations

import unittest
import zipfile
from email.message import Message
from io import BytesIO
from unittest.mock import patch

from discover_official_event_sources import (
    candidate_links_from_landing,
    discover_sources,
    fetch_dart_filing_html,
    fetch_official_html,
    publication_date_from_official_url,
)


def event() -> dict:
    return {
        "event_id": "event_test",
        "event_type": "geopolitics",
        "representative_title": "Oracle signs Pentagon software contract worth $7 billion",
        "record_ids": ["secondary"],
        "published_from": "2026-07-23T20:00:00+00:00",
        "published_to": "2026-07-23T22:00:00+00:00",
        "entities": ["Oracle", "Pentagon", "CNBC"],
        "topic_tags": ["software", "contract"],
    }


def source_matches() -> dict:
    return {
        "events": [{
            "event_id": "event_test",
            "resolution_status": "search_required",
            "search_plan": {
                "official_landing_pages": ["https://www.defense.gov/News/Contracts/"],
            },
            "official_route": {"origin_domains": ["defense.gov"]},
        }],
    }


class CandidateLinkTests(unittest.TestCase):
    def test_extracts_matching_official_link_and_rejects_external(self) -> None:
        html = """
        <a href="/News/Contracts/Contract/Article/999/oracle-software-contract/">
          Oracle Pentagon software contract
        </a>
        <a href="https://publisher.example/oracle-pentagon-software-contract">Story</a>
        """
        links = candidate_links_from_landing(
            "https://www.defense.gov/News/Contracts/",
            html,
            event(),
            ["defense.gov"],
        )
        self.assertEqual(len(links), 1)
        self.assertEqual(
            links[0]["url"],
            "https://defense.gov/News/Contracts/Contract/Article/999/oracle-software-contract",
        )


class FetchTests(unittest.TestCase):
    def test_dart_filing_uses_document_api_and_synthesizes_publication_metadata(self) -> None:
        archive_buffer = BytesIO()
        with zipfile.ZipFile(archive_buffer, "w") as archive:
            archive.writestr(
                "report.xml",
                "<DOCUMENT><TITLE>셀피글로벌 주요사항보고서</TITLE>"
                "<BODY>셀피글로벌은 전환사채 발행 결정을 공시했다.</BODY></DOCUMENT>",
            )

        class FakeResponse:
            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return None

            def read(self, _limit):
                return archive_buffer.getvalue()

        with patch(
            "discover_official_event_sources.urlopen",
            return_value=FakeResponse(),
        ) as fetch:
            result = fetch_dart_filing_html(
                "https://dart.fss.or.kr/dsaf001/main.do?rcpNo=20260807000778",
                "20260807000778",
                "test-key",
                timeout_seconds=1,
                max_response_bytes=100_000,
            )
        self.assertEqual(result["status"], "html_fetched")
        self.assertEqual(result["transport"], "opendart_document_api")
        self.assertIn("2026-08-07T00:00:00+09:00", result["html"])
        self.assertIn("셀피글로벌", result["html"])
        requested_url = fetch.call_args.args[0].full_url
        self.assertIn("opendart.fss.or.kr/api/document.xml", requested_url)

    def test_redirect_outside_official_domain_is_rejected(self) -> None:
        headers = Message()
        headers["Content-Type"] = "text/html"

        class FakeResponse:
            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return None

            def geturl(self):
                return "https://publisher.example/story"

        FakeResponse.headers = headers
        with patch("discover_official_event_sources.urlopen", return_value=FakeResponse()):
            result = fetch_official_html(
                "https://defense.gov/News/Contracts/",
                ["defense.gov"],
                timeout_seconds=1,
                max_response_bytes=1000,
            )
        self.assertEqual(result["status"], "redirected_outside_official_domain")


class DiscoveryTests(unittest.TestCase):
    def test_dart_receipt_identifier_provides_official_publication_date(self) -> None:
        published_at = publication_date_from_official_url(
            "https://dart.fss.or.kr/dsaf001/main.do?rcpNo=20260807000778"
        )
        self.assertEqual(published_at, "2026-08-07T00:00:00+09:00")

    def test_no_network_writes_explicit_audit_without_records(self) -> None:
        payload = discover_sources(
            source_matches(),
            {"clusters": [event()]},
            no_network=True,
        )
        self.assertEqual(payload["discovered_record_count"], 0)
        self.assertEqual(payload["event_audit"][0]["status"], "no_network")

    def test_matching_time_stamped_official_body_creates_grade_a_record(self) -> None:
        landing = """
        <html><body><a href="/News/Contracts/Contract/Article/999/oracle-software-contract/">
        Oracle Pentagon software contract worth 7 billion</a></body></html>
        """
        document = """
        <html><head><title>Oracle Pentagon software contract</title>
        <meta property="article:published_time" content="2026-07-23T21:00:00Z"></head>
        <body><main><h1>Oracle Pentagon software contract</h1>
        <p>Oracle received a Pentagon software contract worth 7 billion dollars.</p>
        </main></body></html>
        """
        responses = [
            {"status": "html_fetched", "url": "https://defense.gov/News/Contracts/", "html": landing},
            {
                "status": "html_fetched",
                "url": "https://defense.gov/News/Contracts/Contract/Article/999/oracle-software-contract",
                "html": document,
            },
        ]
        with patch(
            "discover_official_event_sources.fetch_official_html",
            side_effect=responses,
        ):
            payload = discover_sources(
                source_matches(),
                {"clusters": [event()]},
                no_network=False,
            )
        self.assertEqual(payload["discovered_record_count"], 1)
        record = payload["records"][0]
        self.assertEqual(record["source_grade"], "A")
        self.assertTrue(record["primary_source_confirmed"])
        self.assertEqual(record["evidence_label"], "fact_source_reported")

    def test_embedded_official_url_is_verified_before_landing_page_search(self) -> None:
        document = """
        <html><head><title>Oracle Pentagon software contract</title>
        <meta property="article:published_time" content="2026-07-23T21:00:00Z"></head>
        <body><main><h1>Oracle Pentagon software contract</h1>
        <p>Oracle received a Pentagon software contract worth 7 billion dollars.</p>
        </main></body></html>
        """
        inbox = [{
            "id": "secondary",
            "url": "https://t.me/example/1",
            "raw_text": (
                "Official document: "
                "https://www.defense.gov/News/Contracts/Contract/Article/999/"
                "oracle-software-contract/ and unrelated "
                "https://publisher.example/story"
            ),
        }]
        with patch(
            "discover_official_event_sources.fetch_official_html",
            return_value={
                "status": "html_fetched",
                "url": (
                    "https://defense.gov/News/Contracts/Contract/Article/999/"
                    "oracle-software-contract"
                ),
                "html": document,
            },
        ) as fetch:
            payload = discover_sources(
                source_matches(),
                {"clusters": [event()]},
                no_network=False,
                inbox_records=inbox,
            )
        self.assertEqual(payload["discovered_record_count"], 1)
        self.assertEqual(payload["fetches_used"], 1)
        self.assertEqual(fetch.call_count, 1)
        audit = payload["event_audit"][0]
        self.assertEqual(audit["status"], "verified_embedded_official_document")
        self.assertEqual(
            audit["candidate_documents"][0]["discovery_route"],
            "embedded_event_url",
        )
        self.assertNotIn("publisher.example", str(audit))

    def test_event_with_embedded_official_url_gets_priority_under_event_budget(self) -> None:
        generic_event = {**event(), "event_id": "generic", "record_ids": ["generic-record"]}
        direct_event = {**event(), "event_id": "direct", "record_ids": ["direct-record"]}
        matches = {
            "events": [
                {
                    "event_id": "generic",
                    "resolution_status": "search_required",
                    "search_plan": {"official_landing_pages": ["https://defense.gov/news/"]},
                    "official_route": {"origin_domains": ["defense.gov"]},
                },
                {
                    "event_id": "direct",
                    "resolution_status": "search_required",
                    "search_plan": {"official_landing_pages": ["https://defense.gov/news/"]},
                    "official_route": {"origin_domains": ["defense.gov"]},
                },
            ],
        }
        document = """
        <html><head><title>Oracle Pentagon software contract</title>
        <meta property="article:published_time" content="2026-07-23T21:00:00Z"></head>
        <body><p>Oracle received a Pentagon software contract worth 7 billion dollars.</p></body>
        </html>
        """
        inbox = [
            {"id": "generic-record", "raw_text": "No official link."},
            {
                "id": "direct-record",
                "raw_text": "https://defense.gov/News/Contracts/oracle-software-contract",
            },
        ]
        with patch(
            "discover_official_event_sources.fetch_official_html",
            return_value={
                "status": "html_fetched",
                "url": "https://defense.gov/News/Contracts/oracle-software-contract",
                "html": document,
            },
        ) as fetch:
            payload = discover_sources(
                matches,
                {"clusters": [generic_event, direct_event]},
                no_network=False,
                inbox_records=inbox,
                settings={"max_events": 1},
            )
        self.assertEqual(payload["event_audit"][0]["event_id"], "direct")
        self.assertEqual(payload["discovered_record_count"], 1)
        self.assertEqual(fetch.call_count, 1)

    def test_unrelated_official_document_is_not_accepted(self) -> None:
        landing = """
        <a href="/News/Contracts/Contract/Article/999/oracle-software-contract/">
        Oracle Pentagon software contract
        </a>
        """
        unrelated = """
        <html><head><title>Personnel update</title>
        <meta property="article:published_time" content="2026-07-23T21:00:00Z"></head>
        <body><p>The department announced routine personnel changes.</p></body></html>
        """
        responses = [
            {"status": "html_fetched", "url": "https://defense.gov/News/Contracts/", "html": landing},
            {
                "status": "html_fetched",
                "url": "https://defense.gov/News/Contracts/Contract/Article/999/oracle-software-contract",
                "html": unrelated,
            },
        ]
        with patch(
            "discover_official_event_sources.fetch_official_html",
            side_effect=responses,
        ):
            payload = discover_sources(
                source_matches(),
                {"clusters": [event()]},
                no_network=False,
            )
        self.assertEqual(payload["discovered_record_count"], 0)
        self.assertFalse(payload["event_audit"][0]["candidate_documents"][0]["accepted"])


if __name__ == "__main__":
    unittest.main()
