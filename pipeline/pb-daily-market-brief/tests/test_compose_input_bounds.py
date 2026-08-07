from __future__ import annotations

import json
import unittest
from io import BytesIO
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import Request

from compose_daily_brief import bounded_source_records, request_openai_json


class FakeResponse:
    def __init__(self, payload: dict) -> None:
        self.payload = payload

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def read(self) -> bytes:
        return json.dumps(self.payload).encode("utf-8")


class ComposeInputBoundTests(unittest.TestCase):
    def telegram_record(
        self,
        index: int,
        *,
        cluster: str,
        article_count: int,
        priority: int,
        linked: bool = True,
    ) -> dict:
        return {
            "id": f"telegram-{index}",
            "source_type": "telegram_commentary",
            "published_at": f"2026-07-24T00:{index:02d}:00+00:00",
            "tags": [f"telegram_priority_{priority}"],
            "linked_urls": ["https://example.com/article"] if linked else [],
            "event_cluster": {
                "event_id": cluster,
                "article_count": article_count,
            },
        }

    def test_only_three_telegram_cluster_representatives_reach_llm_input(self) -> None:
        official = {"id": "fred", "source_type": "macro_data"}
        records = [
            official,
            self.telegram_record(1, cluster="a", article_count=5, priority=2),
            self.telegram_record(2, cluster="a", article_count=5, priority=1),
            self.telegram_record(3, cluster="b", article_count=4, priority=1),
            self.telegram_record(4, cluster="c", article_count=3, priority=1),
            self.telegram_record(5, cluster="d", article_count=2, priority=1),
        ]

        bounded, audit = bounded_source_records(records, telegram_cluster_limit=3)

        self.assertEqual(bounded[0], official)
        selected_ids = {record["id"] for record in bounded[1:]}
        self.assertEqual(selected_ids, {"telegram-2", "telegram-3", "telegram-4"})
        self.assertEqual(audit["archived_record_count"], 6)
        self.assertEqual(audit["archived_telegram_record_count"], 5)
        self.assertEqual(audit["telegram_cluster_count"], 4)
        self.assertEqual(audit["selected_telegram_cluster_count"], 3)
        self.assertEqual(audit["input_record_count"], 4)

    def test_broker_reports_require_rights_and_are_bounded(self) -> None:
        records = [{"id": "fred", "source_type": "macro_data"}]
        for index in range(7):
            records.append({
                "id": f"broker-{index}",
                "source_type": "broker_report",
                "published_at": f"2026-07-{10 + index:02d}T00:00:00+00:00",
                "raw_text": "x" * 100,
                "research_rights": {
                    "analysis_allowed": True,
                    "redistribution_allowed": False,
                    "publication_policy": "summary_and_link_only",
                },
            })
        records.append({
            "id": "broker-rejected",
            "source_type": "broker_report",
            "published_at": "2026-07-24T00:00:00+00:00",
            "raw_text": "must not reach the model",
            "research_rights": {
                "analysis_allowed": True,
                "redistribution_allowed": True,
                "publication_policy": "summary_and_link_only",
            },
        })

        bounded, audit = bounded_source_records(
            records,
            broker_report_limit=3,
            broker_report_chars=12,
        )

        selected = [row for row in bounded if row.get("source_type") == "broker_report"]
        self.assertEqual([row["id"] for row in selected], ["broker-6", "broker-5", "broker-4"])
        self.assertTrue(all(len(row["raw_text"]) == 12 for row in selected))
        self.assertEqual(audit["archived_broker_report_count"], 8)
        self.assertEqual(audit["eligible_broker_report_count"], 7)
        self.assertEqual(audit["selected_broker_report_count"], 3)

    def test_timeout_is_retried_once_then_returns_payload(self) -> None:
        request = Request("https://example.com", data=b"{}")
        expected = {"status": "completed"}
        with patch(
            "compose_daily_brief.urlopen",
            side_effect=[TimeoutError("slow"), FakeResponse(expected)],
        ) as mocked_urlopen, patch("compose_daily_brief.time.sleep") as mocked_sleep:
            result = request_openai_json(
                request,
                timeout_seconds=120,
                max_attempts=2,
                backoff_seconds=2,
            )

        self.assertEqual(result, expected)
        self.assertEqual(mocked_urlopen.call_count, 2)
        mocked_sleep.assert_called_once_with(2)

    def test_final_timeout_has_clear_failure_message(self) -> None:
        request = Request("https://example.com", data=b"{}")
        with patch(
            "compose_daily_brief.urlopen",
            side_effect=[TimeoutError("slow"), TimeoutError("still slow")],
        ), patch("compose_daily_brief.time.sleep"):
            with self.assertRaisesRegex(
                SystemExit,
                r"timed out after 2 attempt\(s\) at 120s each",
            ):
                request_openai_json(
                    request,
                    timeout_seconds=120,
                    max_attempts=2,
                    backoff_seconds=0,
                )

    def test_transient_openai_520_is_retried(self) -> None:
        request = Request("https://example.com", data=b"{}")
        expected = {"status": "completed"}
        error = HTTPError(
            request.full_url,
            520,
            "temporary upstream error",
            {},
            BytesIO(b'{"error":"temporary"}'),
        )
        with patch(
            "compose_daily_brief.urlopen",
            side_effect=[error, FakeResponse(expected)],
        ) as mocked_urlopen, patch("compose_daily_brief.time.sleep") as mocked_sleep:
            result = request_openai_json(
                request,
                timeout_seconds=120,
                max_attempts=2,
                backoff_seconds=2,
            )

        self.assertEqual(result, expected)
        self.assertEqual(mocked_urlopen.call_count, 2)
        mocked_sleep.assert_called_once_with(2)

    def test_non_retryable_openai_401_fails_immediately(self) -> None:
        request = Request("https://example.com", data=b"{}")
        error = HTTPError(
            request.full_url,
            401,
            "unauthorized",
            {},
            BytesIO(b'{"error":"unauthorized"}'),
        )
        with patch(
            "compose_daily_brief.urlopen",
            side_effect=error,
        ) as mocked_urlopen, patch("compose_daily_brief.time.sleep") as mocked_sleep:
            with self.assertRaises(HTTPError):
                request_openai_json(
                    request,
                    timeout_seconds=120,
                    max_attempts=3,
                    backoff_seconds=2,
                )

        self.assertEqual(mocked_urlopen.call_count, 1)
        mocked_sleep.assert_not_called()


if __name__ == "__main__":
    unittest.main()
