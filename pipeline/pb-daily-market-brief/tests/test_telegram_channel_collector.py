from __future__ import annotations

import json
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from candidate_pipeline import deduplicate_candidate_records
from collectors import telegram_channels


class TelegramRegistryTests(unittest.TestCase):
    def test_registry_contains_twenty_two_unique_public_channels(self) -> None:
        registry = telegram_channels.load_registry()
        usernames = [item["username"].casefold() for item in registry["channels"]]
        self.assertEqual(len(usernames), 22)
        self.assertEqual(len(set(usernames)), 22)
        self.assertIn("woosanxnnn", usernames)
        self.assertIn("hanaresearch", usernames)
        self.assertIn("darthacking", usernames)
        self.assertIn("kiwoomresearch", usernames)
        self.assertIn("shinhanresearch", usernames)
        self.assertIn("shicglobal", usernames)
        self.assertIn("hanwhastrategy", usernames)
        self.assertIn("hmsecresearch", usernames)
        self.assertIn("sk_smallcap", usernames)
        self.assertIn("sksresearch", usernames)
        self.assertIn("leadingr", usernames)

        attachment_channels = {
            item["username"].casefold()
            for item in registry["channels"]
            if item.get("attachment_collection_allowed") is True
        }
        self.assertTrue(
            {
                "kiwoomresearch",
                "shinhanresearch",
                "shicglobal",
                "hanwhastrategy",
                "hmsecresearch",
                "sk_smallcap",
                "sksresearch",
                "leadingr",
            }.issubset(attachment_channels)
        )

    def test_registry_rejects_duplicate_usernames(self) -> None:
        payload = {
            "schema_version": "telegram_channel_registry.v1",
            "collection_policy": {},
            "channels": [
                {
                    "username": "SameName",
                    "publication_policy": "discovery_only",
                    "rights_label": "link only",
                },
                {
                    "username": "samename",
                    "publication_policy": "discovery_only",
                    "rights_label": "link only",
                },
            ],
        }
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "channels.json"
            path.write_text(json.dumps(payload), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "Duplicate"):
                telegram_channels.load_registry(path)

    def test_session_loader_uses_ignored_local_secret_file_as_fallback(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "telegram_session_string.txt"
            path.write_text("local-session-value", encoding="utf-8")
            with patch.dict("os.environ", {"TELEGRAM_SESSION_STRING": ""}, clear=False):
                self.assertEqual(
                    telegram_channels.load_session_string(path),
                    "local-session-value",
                )

    def test_session_loader_prefers_environment_without_reading_file(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "telegram_session_string.txt"
            path.write_text("local-session-value", encoding="utf-8")
            with patch.dict(
                "os.environ",
                {"TELEGRAM_SESSION_STRING": "environment-session-value"},
                clear=False,
            ):
                self.assertEqual(
                    telegram_channels.load_session_string(path),
                    "environment-session-value",
                )


class TelegramMessageTests(unittest.TestCase):
    def test_bounded_failure_is_single_line_and_limited(self) -> None:
        failure = telegram_channels.bounded_failure(
            RuntimeError("download failed\n" + ("x" * 400)),
            limit=24,
        )

        self.assertEqual(failure, "RuntimeError:download failed xxxxxxxx")
        self.assertNotIn("\n", failure)

    def channel(self, policy: str = "internal_summary_with_attribution") -> dict:
        return {
            "username": "test_market",
            "name": "테스트 시장 채널",
            "category": "market_commentary",
            "origin": "test",
            "priority": 1,
            "publication_policy": policy,
            "rights_label": "bounded internal summary with attribution",
        }

    def test_message_is_forced_to_discovery_only_evidence_posture(self) -> None:
        item = telegram_channels.message_item(
            self.channel(),
            message_id=101,
            published_at=datetime(2026, 7, 23, 1, 0, tzinfo=timezone.utc),
            text="연준 금리 전망 변화 https://example.com/fed?utm_source=telegram",
        )
        self.assertEqual(item["source_type"], "telegram_commentary")
        self.assertEqual(item["source_grade"], "D")
        self.assertFalse(item["primary_source_confirmed"])
        self.assertEqual(item["evidence_label"], "discovery_lead_only")
        self.assertEqual(item["url"], "https://t.me/test_market/101")
        self.assertEqual(item["linked_urls"], ["https://example.com/fed?utm_source=telegram"])
        self.assertEqual(item["canonical_url"], "https://t.me/test_market/101")

    def test_message_extracts_only_explicit_us_ticker_markers(self) -> None:
        item = telegram_channels.message_item(
            self.channel(),
            message_id=111,
            published_at=datetime(2026, 7, 23, 1, 0, tzinfo=timezone.utc),
            text="관심 종목 $ONDS, NASDAQ:NVDA, 티커 PLTR 검토. (CPI)는 거시지표.",
        )
        self.assertEqual(item["tickers"], ["NVDA", "ONDS", "PLTR"])

    def test_no_republication_policy_stores_only_topic_title(self) -> None:
        text = "중요 공시 요약\n" + ("상세한 원문 문장 " * 100)
        item = telegram_channels.message_item(
            self.channel("link_only_no_republication"),
            message_id=102,
            published_at=datetime(2026, 7, 23, 1, 0, tzinfo=timezone.utc),
            text=text,
        )
        self.assertEqual(item["raw_text"], "중요 공시 요약")
        self.assertEqual(item["telegram"]["publication_policy"], "link_only_no_republication")

    def test_shared_outbound_article_collapses_cross_channel_duplicates(self) -> None:
        left = telegram_channels.message_item(
            self.channel(),
            message_id=103,
            published_at=datetime(2026, 7, 23, 1, 0, tzinfo=timezone.utc),
            text="첫 번째 관점 https://example.com/story?utm_source=one",
        )
        right_channel = {**self.channel(), "username": "other_market", "name": "다른 채널"}
        right = telegram_channels.message_item(
            right_channel,
            message_id=104,
            published_at=datetime(2026, 7, 23, 1, 5, tzinfo=timezone.utc),
            text="완전히 다른 제목 https://example.com/story?utm_source=two",
        )
        deduplicated, count = deduplicate_candidate_records([left, right])
        self.assertEqual(count, 1)
        self.assertEqual(len(deduplicated), 1)
        self.assertIn(
            "shared_linked_source_url",
            deduplicated[0]["deduplication"]["match_reasons"],
        )
        represented_publishers = {
            deduplicated[0]["publisher"],
            *deduplicated[0]["deduplication"]["alternate_publishers"],
        }
        represented_urls = {
            deduplicated[0]["url"],
            *deduplicated[0]["deduplication"]["alternate_urls"],
        }
        self.assertEqual(represented_publishers, {"테스트 시장 채널", "다른 채널"})
        self.assertEqual(
            represented_urls,
            {"https://t.me/test_market/103", "https://t.me/other_market/104"},
        )

    def test_missing_session_returns_configuration_notice_without_network(self) -> None:
        with patch.dict(
            "os.environ",
            {
                "TELEGRAM_API_ID": "",
                "TELEGRAM_API_HASH": "",
                "TELEGRAM_SESSION_STRING": "",
            },
            clear=False,
        ):
            rows, notice = telegram_channels.collect({})
        self.assertEqual(rows, [])
        self.assertIn("not configured", str(notice))

    def test_partial_collection_notice_exposes_bounded_failure_reasons(self) -> None:
        with (
            patch.dict(
                "os.environ",
                {
                    "TELEGRAM_API_ID": "12345",
                    "TELEGRAM_API_HASH": "configured-hash",
                    "TELEGRAM_SESSION_STRING": "configured-session",
                },
                clear=False,
            ),
            patch.object(
                telegram_channels,
                "collect_async",
                return_value=(
                    [{"id": "telegram-record"}],
                    [
                        "broken_channel:ValueError",
                        "official_broker:205:attachment_TypeError",
                    ],
                ),
            ),
        ):
            rows, notice = telegram_channels.collect({})

        self.assertEqual(len(rows), 1)
        self.assertIn("2 failure(s)", str(notice))
        self.assertIn("broken_channel:ValueError", str(notice))
        self.assertIn("official_broker:205:attachment_TypeError", str(notice))

    def test_allowlisted_broker_pdf_exposes_metadata_without_downloading(self) -> None:
        broker_channel = {
            **self.channel("link_only_bounded_summary"),
            "username": "official_broker",
            "category": "broker_research",
            "attachment_collection_allowed": True,
        }
        message = SimpleNamespace(
            id=205,
            file=SimpleNamespace(
                name="20260730_반도체_데일리.pdf",
                mime_type="application/pdf",
                size=123_456,
            ),
            document=SimpleNamespace(id=987654321),
        )
        attachment = telegram_channels.attachment_for_message(
            broker_channel,
            message,
        )
        self.assertIsNotNone(attachment)
        self.assertTrue(attachment["is_pdf"])
        self.assertEqual(attachment["filename"], "20260730_반도체_데일리.pdf")
        self.assertEqual(attachment["post_url"], "https://t.me/official_broker/205")
        self.assertEqual(len(attachment["attachment_key"]), 64)

    def test_non_broker_channel_cannot_expose_pdf_attachment(self) -> None:
        message = SimpleNamespace(
            id=206,
            file=SimpleNamespace(
                name="private_report.pdf",
                mime_type="application/pdf",
                size=100,
            ),
            document=SimpleNamespace(id=123),
        )
        self.assertIsNone(
            telegram_channels.attachment_for_message(self.channel(), message)
        )

    def test_broker_channel_image_without_filename_is_not_a_pdf(self) -> None:
        broker_channel = {
            "username": "official_broker",
            "category": "broker_research",
            "attachment_collection_allowed": True,
        }
        message = SimpleNamespace(
            id=207,
            file=SimpleNamespace(
                name=None,
                mime_type="image/jpeg",
                size=12_345,
            ),
            document=None,
        )
        self.assertIsNone(
            telegram_channels.attachment_for_message(broker_channel, message)
        )

    def test_invalid_attachment_approval_registry_fails_closed(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "attachments.json"
            path.write_text("{invalid", encoding="utf-8")
            decisions, notice = telegram_channels.load_attachment_approvals(path)
        self.assertEqual(decisions, {})
        self.assertIn("downloads were blocked", str(notice))

    def test_approved_attachment_registry_exposes_targeted_backfill(self) -> None:
        payload = {
            "schema_version": "telegram_research_attachment_approvals.v1",
            "decisions": [
                {
                    "attachment_key": "a" * 64,
                    "decision": "approved",
                    "channel_username": "OfficialBroker",
                    "message_id": 321,
                },
                {
                    "attachment_key": "b" * 64,
                    "decision": "excluded",
                    "channel_username": "OfficialBroker",
                    "message_id": 322,
                },
            ],
        }
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "attachments.json"
            path.write_text(json.dumps(payload), encoding="utf-8")
            decisions, targets, notice = (
                telegram_channels.load_attachment_approval_registry(path)
            )
        self.assertIsNone(notice)
        self.assertEqual(decisions["a" * 64], "approved")
        self.assertEqual(decisions["b" * 64], "excluded")
        self.assertEqual(targets, [{
            "attachment_key": "a" * 64,
            "message_id": 321,
            "channel_username": "OfficialBroker",
        }])

    def test_approved_backfill_channels_and_ids_are_prioritized(self) -> None:
        registry = {
            "channels": [
                {"username": "general_feed", "priority": 1},
                {"username": "ApprovedBroker", "priority": 3},
                {"username": "second_feed", "priority": 2},
            ],
        }
        targets = [
            {"channel_username": "@approvedbroker", "message_id": 202},
            {"channel_username": "ApprovedBroker", "message_id": 101},
            {"channel_username": "approvedbroker", "message_id": 202},
        ]

        message_ids = telegram_channels.approved_message_ids_by_channel(targets)
        ordered = telegram_channels.ordered_enabled_channels(registry, message_ids)

        self.assertEqual(message_ids, {"approvedbroker": [101, 202]})
        self.assertEqual(
            [channel["username"] for channel in ordered],
            ["ApprovedBroker", "general_feed", "second_feed"],
        )


if __name__ == "__main__":
    unittest.main()
