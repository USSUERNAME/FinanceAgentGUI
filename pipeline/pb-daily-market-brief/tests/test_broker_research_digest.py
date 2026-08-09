from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from build_broker_research_digest import (
    build_digest,
    load_retained_drive_reports,
    validate_digest,
)


def report(
    report_id: str,
    *,
    publisher: str = "Example Securities",
    stance: str = "positive",
    ticker: str = "NVDA",
    sector: str = "semiconductor",
    structured: bool = True,
    market_scope: str = "US",
) -> dict:
    return {
        "id": report_id,
        "source_id": "authorized_report_drop",
        "source_type": "broker_report",
        "publisher": publisher,
        "title": f"{ticker} earnings review",
        "published_at": "2026-07-24T08:00:00+09:00",
        "market_scope": market_scope,
        "issuer_country": "US" if market_scope == "US" else "KR",
        "original_language": "en" if market_scope == "US" else "ko",
        "base_currency": "USD" if market_scope == "US" else "KRW",
        "source_reference": f"REF-{report_id}",
        "url": f"https://research.example.com/{report_id}",
        "tickers": [ticker],
        "raw_text": "This full report body must never appear in the digest.",
        "research_rights": {
            "analysis_allowed": True,
            "redistribution_allowed": False,
            "publication_policy": "summary_and_link_only",
        },
        "research_metadata": {
            "analyst": "A. Analyst",
            "report_type": "earnings",
            "stance": stance,
            "summary": "Demand remains constructive." if structured else "",
            "key_claims": ["Estimate direction improved."] if structured else [],
            "catalysts": ["Next earnings release"] if structured else [],
            "risks": ["Valuation"] if structured else [],
            "monitoring_conditions": ["Confirm next-quarter demand"] if structured else [],
            "sectors": [sector],
        },
    }


def telegram_event() -> dict:
    return {
        "id": "telegram-1",
        "source_type": "telegram_commentary",
        "publisher": "PB Channel",
        "title": "NVDA earnings demand update",
        "raw_text": "NVDA semiconductor demand remains in focus.",
        "url": "https://t.me/pb/1",
        "tickers": ["NVDA"],
        "sector_ids": ["semiconductor"],
        "event_cluster": {"event_id": "event-nvda"},
        "telegram": {"channel_name": "PB Channel"},
    }


class BrokerResearchDigestTests(unittest.TestCase):
    def test_digest_is_rights_safe_and_tracks_readiness(self) -> None:
        packet = build_digest(
            "2026-07-24",
            [report("one"), report("two", structured=False)],
            generated_at="2026-07-24T09:00:00+09:00",
        )
        self.assertEqual(packet["summary"]["selected_report_count"], 2)
        self.assertEqual(packet["summary"]["structured_report_count"], 1)
        self.assertEqual(packet["summary"]["awaiting_analysis_count"], 1)
        self.assertNotIn("raw_text", packet["reports"][0])
        self.assertNotIn("full report body", str(packet))
        self.assertFalse(packet["reports"][0]["rights"]["redistribution_allowed"])

    def test_consensus_counts_stances_and_disagreement(self) -> None:
        packet = build_digest(
            "2026-07-24",
            [
                report("one", stance="positive"),
                report("two", publisher="Second Securities", stance="cautious"),
            ],
        )
        self.assertEqual(packet["summary"]["stance_counts"]["positive"], 1)
        self.assertEqual(packet["summary"]["stance_counts"]["cautious"], 1)
        self.assertEqual(packet["consensus"]["disagreements"][0]["topic"], "semiconductor")
        sector = packet["consensus"]["sector_assessments"][0]
        self.assertEqual(sector["sector"], "semiconductor")
        self.assertEqual(sector["signal"], "mixed")
        self.assertEqual(sector["report_count"], 2)
        self.assertIn("Next earnings release", sector["catalysts"])
        self.assertIn("Valuation", sector["risks"])
        self.assertIn("Confirm next-quarter demand", sector["monitoring_conditions"])

    def test_digest_separates_domestic_and_overseas_research(self) -> None:
        packet = build_digest(
            "2026-07-24",
            [
                report("us-one", market_scope="US"),
                report("kr-one", market_scope="KR"),
                report("global-one", market_scope="GLOBAL"),
            ],
        )
        self.assertEqual(packet["summary"]["domestic_report_count"], 1)
        self.assertEqual(packet["summary"]["overseas_report_count"], 2)
        self.assertEqual(
            packet["summary"]["market_scope_counts"],
            {"GLOBAL": 1, "KR": 1, "US": 1},
        )
        self.assertEqual(packet["reports"][0]["base_currency"], "USD")

    def test_digest_retains_prior_approved_pdf_card_without_source_text(self) -> None:
        prior = build_digest(
            "2026-07-24",
            [report("kr-prior", market_scope="KR")],
        )
        current = build_digest(
            "2026-07-25",
            [report("us-current", market_scope="US")],
            retained_reports=prior["reports"],
        )
        self.assertEqual(current["summary"]["retained_report_count"], 1)
        self.assertEqual(current["summary"]["domestic_report_count"], 1)
        self.assertEqual(current["summary"]["overseas_report_count"], 1)
        self.assertNotIn("raw_text", str(current["reports"]))

    def test_retained_loader_keeps_only_still_approved_drive_cards(self) -> None:
        prior = build_digest("2026-07-24", [report("kr-prior", market_scope="KR")])
        prior["reports"][0]["source"]["reference"] = "drive:approved-file"
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            digest_path = (
                root / "broker_research_digest" / "2026-07-24" /
                "broker_research_digest.json"
            )
            digest_path.parent.mkdir(parents=True)
            digest_path.write_text(json.dumps(prior), encoding="utf-8")
            approval_path = root / "approvals.json"
            approval_path.write_text(json.dumps({
                "decisions": [
                    {"file_id": "approved-file", "decision": "approved"},
                    {"file_id": "excluded-file", "decision": "excluded"},
                ],
            }), encoding="utf-8")
            retained = load_retained_drive_reports(
                "2026-07-25",
                workspace_root=root,
                approval_path=approval_path,
            )
        self.assertEqual([item["report_id"] for item in retained], ["kr-prior"])
        self.assertNotIn("raw_text", retained[0])

    def test_default_operator_stance_does_not_hide_generated_analysis(self) -> None:
        source = report("generated-stance", stance="not_stated", structured=False)
        packet = build_digest(
            "2026-07-24",
            [source],
            analysis_payload={
                "reports": [{
                    "report_id": "generated-stance",
                    "analyst": "Generated Analyst",
                    "report_type": "sector",
                    "stance": "positive",
                    "summary": "Generated outlook remains constructive.",
                    "key_claims": ["Demand visibility improved."],
                    "catalysts": [],
                    "risks": [],
                    "sectors": ["semiconductor"],
                    "tickers": ["NVDA"],
                    "rating": "",
                    "previous_rating": "",
                    "target_price": None,
                    "previous_target_price": None,
                    "currency": "",
                    "monitoring_conditions": [],
                }],
            },
        )
        self.assertEqual(packet["reports"][0]["stance"], "positive")
        self.assertEqual(
            packet["reports"][0]["summary"],
            "Generated outlook remains constructive.",
        )

    def test_explicit_operator_stance_still_overrides_generated_analysis(self) -> None:
        source = report("operator-stance", stance="cautious")
        packet = build_digest(
            "2026-07-24",
            [source],
            analysis_payload={
                "reports": [{
                    "report_id": "operator-stance",
                    "stance": "positive",
                }],
            },
        )
        self.assertEqual(packet["reports"][0]["stance"], "cautious")

    def test_unauthorized_report_is_excluded(self) -> None:
        unsafe = report("unsafe")
        unsafe["research_rights"]["analysis_allowed"] = False
        packet = build_digest("2026-07-24", [unsafe])
        self.assertEqual(packet["summary"]["selected_report_count"], 0)

    def test_validation_rejects_raw_text(self) -> None:
        packet = build_digest("2026-07-24", [report("one")])
        packet["reports"][0]["raw_text"] = "leak"
        with self.assertRaisesRegex(ValueError, "raw_text"):
            validate_digest(packet)

    def test_report_links_to_matching_telegram_event(self) -> None:
        packet = build_digest("2026-07-24", [report("one"), telegram_event()])
        links = packet["reports"][0]["linked_telegram_events"]
        self.assertEqual(links[0]["event_id"], "event-nvda")
        self.assertIn("ticker:NVDA", links[0]["match_reasons"])
        self.assertEqual(packet["summary"]["telegram_linked_report_count"], 1)


if __name__ == "__main__":
    unittest.main()
