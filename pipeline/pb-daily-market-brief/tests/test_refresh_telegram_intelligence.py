from __future__ import annotations

import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

from collectors import telegram_channels
from refresh_telegram_intelligence import build_refresh_payload, write_payload
from sector_master import load_sector_master


def channel(username: str, name: str) -> dict:
    return {
        "username": username,
        "name": name,
        "category": "market_commentary",
        "priority": 1,
        "origin": "operator",
        "publication_policy": "link_only_bounded_summary",
        "rights_label": "Bounded internal paraphrase only.",
    }


class TelegramRefreshTests(unittest.TestCase):
    def test_refresh_builds_cross_channel_event_clusters(self) -> None:
        published_at = datetime(2026, 7, 27, 1, 0, tzinfo=timezone.utc)
        rows = [
            telegram_channels.message_item(
                channel("alpha_room", "Alpha"),
                message_id=1,
                published_at=published_at,
                text="NVIDIA 실적 가이던스 상향과 데이터센터 매출 전망",
            ),
            telegram_channels.message_item(
                channel("beta_room", "Beta"),
                message_id=2,
                published_at=published_at,
                text="데이터센터 전망 개선으로 NVIDIA가 실적 가이던스를 높였다는 관점",
            ),
        ]
        payload = build_refresh_payload(
            rows,
            generated_at=published_at,
            notice=None,
            settings={
                "cluster_time_window_hours": 48,
                "cluster_title_similarity_threshold": 0.5,
                "include_keywords": ["실적", "가이던스", "매출"],
                "max_age_hours": 168,
            },
            sector_master=load_sector_master(),
        )
        self.assertEqual(payload["schema_version"], "telegram_intelligence_refresh.v1")
        self.assertEqual(payload["raw_post_count"], 2)
        self.assertEqual(payload["event_cluster_count"], 1)
        self.assertEqual(payload["clusters"][0]["post_count"], 2)
        self.assertEqual(payload["clusters"][0]["channels"], ["Alpha", "Beta"])

    def test_write_payload_uses_date_partition_and_atomic_target(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            output = write_payload(
                {
                    "schema_version": "telegram_intelligence_refresh.v1",
                    "generated_at": "2026-07-27T12:00:00+09:00",
                    "clusters": [],
                },
                Path(directory),
            )
            self.assertEqual(
                output,
                Path(directory) / "2026-07-27" / "telegram_intelligence.json",
            )
            self.assertTrue(output.is_file())
            self.assertFalse(output.with_suffix(".json.tmp").exists())

    def test_refresh_hides_symbol_only_posts(self) -> None:
        published_at = datetime(2026, 7, 27, 1, 0, tzinfo=timezone.utc)
        rows = [
            telegram_channels.message_item(
                channel("alpha_room", "Alpha"),
                message_id=3,
                published_at=published_at,
                text="⚡️⚡️⚡️⚡️⚡️",
            ),
        ]
        payload = build_refresh_payload(
            rows,
            generated_at=published_at,
            notice=None,
            settings={"max_age_hours": 168},
            sector_master=load_sector_master(),
        )
        self.assertEqual(payload["event_cluster_count"], 0)
        self.assertEqual(payload["clusters"], [])

    def test_refresh_exposes_unique_broker_pdf_approval_candidates(self) -> None:
        published_at = datetime(2026, 7, 30, 1, 0, tzinfo=timezone.utc)
        attachment = {
            "attachment_key": "a" * 64,
            "filename": "20260730_미국주식전략.pdf",
            "mime_type": "application/pdf",
            "size": 456_789,
            "is_pdf": True,
            "channel_username": "official_broker",
            "channel_name": "공식 증권사 리서치",
            "message_id": 301,
            "post_url": "https://t.me/official_broker/301",
        }
        row = telegram_channels.message_item(
            channel("official_broker", "공식 증권사 리서치"),
            message_id=301,
            published_at=published_at,
            text="미국 주식 전략 PDF",
            attachments=[attachment, attachment],
        )
        duplicate_attachment = {
            **attachment,
            "attachment_key": "b" * 64,
            "channel_username": "second_official_broker",
            "channel_name": "두 번째 공식 증권사",
            "message_id": 302,
            "post_url": "https://t.me/second_official_broker/302",
        }
        duplicate_row = telegram_channels.message_item(
            channel("second_official_broker", "두 번째 공식 증권사"),
            message_id=302,
            published_at=published_at,
            text="같은 미국 주식 전략 PDF",
            attachments=[duplicate_attachment],
        )
        payload = build_refresh_payload(
            [row, duplicate_row],
            generated_at=published_at,
            notice=None,
            settings={"max_age_hours": 168},
            sector_master=load_sector_master(),
        )
        self.assertEqual(payload["pdf_attachment_count"], 1)
        self.assertEqual(
            payload["pdf_attachments"][0]["filename"],
            "20260730_미국주식전략.pdf",
        )
        self.assertEqual(
            payload["pdf_attachments"][0]["post_url"],
            "https://t.me/official_broker/301",
        )
        self.assertEqual(
            payload["pdf_attachments"][0]["duplicate_source_count"],
            1,
        )
        self.assertEqual(
            payload["pdf_attachments"][0]["source_posts"],
            [
                "https://t.me/official_broker/301",
                "https://t.me/second_official_broker/302",
            ],
        )


if __name__ == "__main__":
    unittest.main()
