from __future__ import annotations

import json
import os
import unittest
from unittest.mock import patch

from structure_event_evidence import (
    assemble_payload,
    bounded_model_input,
    build_evidence_ledger,
    extract_with_openai,
    fallback_extraction,
    market_reaction_context,
    sanitize_extraction_by_event,
    validate_extraction,
)


def primary() -> dict:
    return {
        "record_id": "primary-1",
        "title": "Official release",
        "publisher": "Official agency",
        "url": "https://official.example/release",
        "published_at": "2026-07-23T10:00:00+00:00",
        "source_grade": "A",
        "source_role": "origin_primary",
        "evidence_label": "fact_source_reported",
        "existing_excerpt": "Official metadata.",
        "body_extraction": {
            "status": "official_body_extracted",
            "text": "The agency reported an actual value of 3.0 percent.",
        },
    }


def secondary() -> dict:
    return {
        "record_id": "secondary-1",
        "title": "Publisher report",
        "publisher": "Publisher",
        "url": "https://publisher.example/report",
        "published_at": "2026-07-23T10:05:00+00:00",
        "source_grade": "B",
        "source_role": "representative_secondary",
        "evidence_label": "secondary_metadata_unverified",
        "existing_excerpt": "Analysts described the result as stronger than expected.",
        "body_extraction": {"status": "not_permitted_metadata_only", "text": None},
    }


def packet() -> dict:
    return {
        "event_id": "event_20260723_test",
        "event_type": "economic_data",
        "representative_title": "Economic release",
        "evidence_posture": "research_grade",
        "representatives": [primary(), secondary()],
    }


def valid_extraction() -> dict:
    return {
        "events": [{
            "event_id": "event_20260723_test",
            "extraction_status": "structured",
            "facts": [{
                "claim": "공식 기관은 실제값 3.0%를 발표했다.",
                "evidence_ids": ["event_20260723_test:evidence:01"],
                "fact_status": "verified_primary",
            }],
            "reported_claims": [{
                "claim": "일부 분석가는 예상보다 강하다고 평가했다.",
                "evidence_ids": ["event_20260723_test:evidence:02"],
                "status": "reported_secondary_unverified",
            }],
            "expectation_gap": {
                "actual_text": "3.0%",
                "consensus_text": None,
                "previous_text": None,
                "revised_previous_text": None,
                "surprise_text": None,
                "narrative_gap": None,
                "status": "verified_primary",
                "evidence_ids": ["event_20260723_test:evidence:01"],
            },
            "interpretation_candidates": [{
                "statement": "시장 기대보다 강했을 가능성은 추가 확인이 필요하다.",
                "evidence_ids": ["event_20260723_test:evidence:02"],
                "confidence": 0.3,
                "status": "hypothesis",
            }],
            "conflicts": [],
        }],
    }


class EvidenceLedgerTests(unittest.TestCase):
    def test_ids_are_stable_and_body_text_is_preferred(self) -> None:
        ledger = build_evidence_ledger(packet())
        self.assertEqual(ledger[0]["evidence_id"], "event_20260723_test:evidence:01")
        self.assertEqual(ledger[1]["evidence_id"], "event_20260723_test:evidence:02")
        self.assertIn("actual value", ledger[0]["text"])
        self.assertIn("stronger than expected", ledger[1]["text"])

    def test_bounded_input_does_not_ask_model_to_create_urls(self) -> None:
        events, _ = bounded_model_input([packet()])
        evidence = events[0]["evidence"][0]
        self.assertNotIn("url", evidence)
        self.assertIn("evidence_id", evidence)


class ExtractionValidationTests(unittest.TestCase):
    def ledgers(self) -> dict:
        _, ledgers = bounded_model_input([packet()])
        return ledgers

    def test_valid_primary_fact_and_secondary_report_pass(self) -> None:
        validate_extraction(valid_extraction(), self.ledgers())

    def test_hallucinated_evidence_id_is_rejected(self) -> None:
        extracted = valid_extraction()
        extracted["events"][0]["facts"][0]["evidence_ids"] = ["invented:evidence"]
        with self.assertRaisesRegex(ValueError, "unknown evidence"):
            validate_extraction(extracted, self.ledgers())

    def test_secondary_source_cannot_verify_fact(self) -> None:
        extracted = valid_extraction()
        extracted["events"][0]["facts"][0]["evidence_ids"] = [
            "event_20260723_test:evidence:02"
        ]
        with self.assertRaisesRegex(ValueError, "not supported by extracted primary"):
            validate_extraction(extracted, self.ledgers())

    def test_primary_source_cannot_be_labeled_secondary_report(self) -> None:
        extracted = valid_extraction()
        extracted["events"][0]["reported_claims"][0]["evidence_ids"] = [
            "event_20260723_test:evidence:01"
        ]
        with self.assertRaisesRegex(ValueError, "lacks secondary evidence"):
            validate_extraction(extracted, self.ledgers())

    def test_unknown_or_missing_event_is_rejected(self) -> None:
        extracted = valid_extraction()
        extracted["events"][0]["event_id"] = "event_unknown"
        with self.assertRaisesRegex(ValueError, "missing or unknown"):
            validate_extraction(extracted, self.ledgers())

    def test_unavailable_expectation_cannot_contain_invented_values(self) -> None:
        extracted = valid_extraction()
        gap = extracted["events"][0]["expectation_gap"]
        gap["status"] = "not_available"
        gap["consensus_text"] = "invented consensus"
        gap["evidence_ids"] = []
        with self.assertRaisesRegex(ValueError, "unsupported content"):
            validate_extraction(extracted, self.ledgers())

    def test_verified_expectation_requires_evidence(self) -> None:
        extracted = valid_extraction()
        extracted["events"][0]["expectation_gap"]["evidence_ids"] = []
        with self.assertRaisesRegex(ValueError, "no supporting evidence"):
            validate_extraction(extracted, self.ledgers())

    def test_invalid_event_is_downgraded_without_discarding_valid_sibling(self) -> None:
        valid_packet = packet()
        invalid_packet = packet()
        invalid_packet["event_id"] = "event_20260723_invalid"
        _, ledgers = bounded_model_input([valid_packet, invalid_packet])

        valid_event = valid_extraction()["events"][0]
        invalid_event = json.loads(json.dumps(valid_event))
        invalid_event["event_id"] = "event_20260723_invalid"
        invalid_event["facts"][0]["evidence_ids"] = [
            "event_20260723_invalid:evidence:02"
        ]
        invalid_event["reported_claims"][0]["evidence_ids"] = [
            "event_20260723_invalid:evidence:02"
        ]
        invalid_event["expectation_gap"]["evidence_ids"] = [
            "event_20260723_invalid:evidence:01"
        ]
        invalid_event["interpretation_candidates"][0]["evidence_ids"] = [
            "event_20260723_invalid:evidence:02"
        ]

        sanitized, warnings = sanitize_extraction_by_event(
            {"events": [valid_event, invalid_event]},
            ledgers,
        )

        self.assertEqual(sanitized["events"][0]["extraction_status"], "structured")
        self.assertEqual(
            sanitized["events"][1]["extraction_status"],
            "insufficient_evidence",
        )
        self.assertEqual(sanitized["events"][1]["facts"], [])
        self.assertEqual(warnings[0]["event_id"], "event_20260723_invalid")


class MarketReactionContextTests(unittest.TestCase):
    @staticmethod
    def etfs(as_of: str) -> dict:
        return {
            "items": [{
                "ticker": "SPY", "as_of": as_of,
                "return_1d_pct": 0.5, "return_5d_pct": 1.2,
            }, {
                "ticker": "QQQ", "as_of": as_of,
                "return_1d_pct": 0.8, "return_5d_pct": 2.0,
            }],
        }

    def test_same_session_is_explicitly_noncausal(self) -> None:
        result = market_reaction_context(
            "economic_data", "2026-07-23T10:00:00+00:00", self.etfs("2026-07-23")
        )
        self.assertEqual(result["status"], "same_session_context_not_causal")
        self.assertFalse(result["causal_attribution_permitted"])
        self.assertIn("post_5m", result["required_event_window_measurements"])

    def test_adjacent_close_is_not_called_event_reaction(self) -> None:
        result = market_reaction_context(
            "economic_data", "2026-07-23T10:00:00+00:00", self.etfs("2026-07-22")
        )
        self.assertEqual(result["status"], "adjacent_close_context_not_causal")

    def test_stale_prices_are_not_measured(self) -> None:
        result = market_reaction_context(
            "economic_data", "2026-07-23T10:00:00+00:00", self.etfs("2026-07-18")
        )
        self.assertEqual(result["status"], "not_measured_stale_or_unaligned")


class StructuredOutputTests(unittest.TestCase):
    def test_dry_run_fallback_keeps_ledger_and_no_facts(self) -> None:
        extracted, ledgers = fallback_extraction([packet()], reason="dry_run")
        event = extracted["events"][0]
        self.assertEqual(event["extraction_status"], "not_run")
        self.assertEqual(event["facts"], [])
        self.assertEqual(len(ledgers[event["event_id"]]), 2)

    def test_responses_request_uses_strict_schema_and_validates_ids(self) -> None:
        response_payload = json.dumps({
            "output_text": json.dumps(valid_extraction(), ensure_ascii=False),
            "usage": {"input_tokens": 20, "output_tokens": 30},
        }).encode("utf-8")

        class FakeResponse:
            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return False

            def read(self):
                return response_payload

        captured = {}

        def fake_urlopen(request, timeout):
            captured["body"] = json.loads(request.data.decode("utf-8"))
            captured["timeout"] = timeout
            return FakeResponse()

        with patch.dict(os.environ, {"OPENAI_API_KEY": "test-key"}, clear=False), \
                patch("structure_event_evidence.urlopen", side_effect=fake_urlopen):
            extracted, ledgers, usage = extract_with_openai([packet()])
        self.assertEqual(extracted["events"][0]["facts"][0]["fact_status"], "verified_primary")
        self.assertIn("event_20260723_test", ledgers)
        self.assertEqual(usage["output_tokens"], 30)
        self.assertTrue(captured["body"]["text"]["format"]["strict"])

    def test_payload_maps_ids_back_to_urls_outside_model_output(self) -> None:
        _, ledgers = bounded_model_input([packet()])
        snapshot = {
            "report_date": "2026-07-23",
            "news_event_clusters": {"clusters": [{
                "event_id": "event_20260723_test",
                "event_type": "economic_data",
                "published_from": "2026-07-23T10:00:00+00:00",
            }]},
            "etf_metrics": {"items": []},
        }
        payload = assemble_payload(
            {"events": [packet()]}, snapshot, valid_extraction(), ledgers
        )
        self.assertEqual(
            payload["events"][0]["evidence_ledger"][0]["url"],
            "https://official.example/release",
        )


if __name__ == "__main__":
    unittest.main()
