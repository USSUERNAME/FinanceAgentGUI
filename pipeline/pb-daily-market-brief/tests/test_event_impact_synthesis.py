from __future__ import annotations

import json
import os
import unittest
from unittest.mock import patch

from synthesize_event_impacts import (
    bounded_synthesis_input,
    canonicalize_synthesis,
    merge_targeted_synthesis,
    rank_events,
    score_event,
    synthesize_with_openai,
    validate_synthesis,
)


EVENT_ID = "event_20260723_macro"
EVIDENCE_PRIMARY = f"{EVENT_ID}:evidence:01"
EVIDENCE_SECONDARY = f"{EVENT_ID}:evidence:02"


def master() -> dict:
    return {
        "sectors": [{
            "sector_id": "semiconductors_ai_compute",
            "name_en": "Semiconductors and AI Compute",
            "classification": "structural_growth",
            "macro_sensitivities": [{"factor_id": "real_yields", "direction": "negative"}],
        }, {
            "sector_id": "energy_oil_gas",
            "name_en": "Energy",
            "classification": "cyclical",
            "macro_sensitivities": [{"factor_id": "oil", "direction": "positive"}],
        }],
    }


def structured_event(
    *,
    extraction_status: str = "structured",
    reaction_status: str = "same_session_context_not_causal",
) -> dict:
    return {
        "event_id": EVENT_ID,
        "event_type": "economic_data",
        "representative_title": "Inflation release",
        "evidence_posture": "research_grade",
        "extraction_status": extraction_status,
        "evidence_ledger": [{
            "evidence_id": EVIDENCE_PRIMARY,
            "record_id": "record-primary",
            "published_at": "2026-07-23T12:30:00+00:00",
            "source_role": "origin_primary",
            "evidence_label": "fact_source_reported",
            "source_grade": "A",
        }, {
            "evidence_id": EVIDENCE_SECONDARY,
            "record_id": "record-secondary",
            "published_at": "2026-07-23T12:35:00+00:00",
            "source_role": "representative_secondary",
            "evidence_label": "secondary_metadata_unverified",
            "source_grade": "B",
        }],
        "facts": [{
            "claim": "공식 기관은 물가 지표를 발표했다.",
            "evidence_ids": [EVIDENCE_PRIMARY],
            "fact_status": "verified_primary",
        }],
        "reported_claims": [{
            "claim": "일부 매체는 예상보다 높다고 보도했다.",
            "evidence_ids": [EVIDENCE_SECONDARY],
            "status": "reported_secondary_unverified",
        }],
        "expectation_gap": {
            "actual_text": "3.0%",
            "consensus_text": "2.8%",
            "previous_text": None,
            "revised_previous_text": None,
            "surprise_text": "+0.2%p",
            "narrative_gap": None,
            "status": "verified_primary",
            "evidence_ids": [EVIDENCE_PRIMARY],
        },
        "market_reaction": {
            "status": reaction_status,
            "observations": [{"ticker": "SPY", "return_1d_pct": 0.5}],
            "causal_attribution_permitted": False,
        },
        "interpretation_candidates": [],
        "conflicts": [],
    }


def snapshot() -> dict:
    return {
        "report_date": "2026-07-23",
        "data_cutoff": {"generated_at": "2026-07-23T18:00:00+09:00"},
        "records": [{
            "id": "record-primary",
            "source_type": "international_news",
            "tickers": [],
            "sector_ids": ["semiconductors_ai_compute"],
            "sector_candidate_ids": [],
        }],
        "sector_snapshot_summary": {
            "market_confirmation_observations": [{
                "sector_id": "semiconductors_ai_compute",
                "market_confirmation_score": 60,
            }],
        },
    }


def selected_score() -> dict:
    return {
        "event_id": EVENT_ID,
        "priority_score": 90,
        "eligible_for_synthesis": True,
    }


def valid_synthesis() -> dict:
    return {
        "cross_event_summary": {
            "dominant_event_id": EVENT_ID,
            "market_logic": "물가 경로와 금리 민감 업종을 확인할 필요가 있다.",
            "confidence": 0.6,
            "conflicting_event_ids": [],
            "why_not_higher_confidence": "발표 전후 가격 반응이 없다.",
        },
        "events": [{
            "event_id": EVENT_ID,
            "synthesis_status": "complete",
            "bottom_line": "금리 민감 업종을 관찰한다.",
            "what_is_new": {
                "status": "verified_change",
                "summary": "공식 수치가 제시됐다.",
                "evidence_ids": [EVIDENCE_PRIMARY],
            },
            "transmission_channels": [{
                "channel": "물가에서 실질금리로 전달",
                "first_repricing_variable": "실질금리",
                "sector_id": "semiconductors_ai_compute",
                "first_affected_line_item": "밸류에이션 멀티플",
                "direction": "negative",
                "timing": "near_term",
                "confidence": 0.6,
                "evidence_ids": [EVIDENCE_PRIMARY],
                "inference_status": "hypothesis",
            }],
            "priced_in_assessment": {
                "status": "context_only",
                "conclusion": "일별 수익률만으로 반영 여부를 판단할 수 없다.",
            },
            "strongest_counterargument": "세부 물가가 둔화됐을 수 있다.",
            "monitoring_signals": [{
                "signal": "실질금리와 성장주 상대강도",
                "role": "both",
                "evidence_ids": [EVIDENCE_PRIMARY],
            }],
            "action_posture": "wait_for_proof",
            "data_gaps": ["발표 전후 가격 반응"],
        }],
    }


class EventScoringTests(unittest.TestCase):
    def test_contextual_daily_return_receives_zero_reaction_points(self) -> None:
        score = score_event(structured_event(), snapshot())
        self.assertEqual(score["components"]["event_window_price_reaction"], 0)
        self.assertFalse(score["event_window_price_reaction_measured"])
        self.assertTrue(score["eligible_for_synthesis"])

    def test_actual_event_window_can_receive_reaction_points(self) -> None:
        score = score_event(
            structured_event(reaction_status="event_window_measured"),
            snapshot(),
        )
        self.assertEqual(score["components"]["event_window_price_reaction"], 20)

    def test_failed_extraction_is_penalized_and_ineligible(self) -> None:
        score = score_event(
            structured_event(extraction_status="not_run"),
            snapshot(),
        )
        reasons = {item["reason"] for item in score["penalties"]}
        self.assertIn("structured_extraction_unavailable", reasons)
        self.assertFalse(score["eligible_for_synthesis"])

    def test_ranking_places_eligible_event_before_ineligible_event(self) -> None:
        eligible = structured_event()
        ineligible = structured_event(extraction_status="not_run")
        ineligible["event_id"] = "event_20260723_unavailable"
        ranked = rank_events({"events": [ineligible, eligible]}, snapshot())
        self.assertEqual(ranked[0]["event_id"], EVENT_ID)


class BoundedInputTests(unittest.TestCase):
    def test_only_top_eligible_events_and_no_source_urls_are_sent(self) -> None:
        structured = {"events": [structured_event()]}
        ranking = rank_events(structured, snapshot())
        model_input, selected = bounded_synthesis_input(
            structured, snapshot(), ranking, master(), max_events=3
        )
        self.assertEqual([item["event_id"] for item in selected], [EVENT_ID])
        serialized = json.dumps(model_input)
        self.assertNotIn("https://", serialized)
        self.assertEqual(model_input["portfolio_context"], "not_provided")

    def test_targeted_synthesis_replaces_only_the_selected_event(self) -> None:
        existing = {
            "schema_version": "event_impact_synthesis.v1",
            "report_date": "2026-07-23",
            "selected_event_ids": ["old", EVENT_ID],
            "cross_event_summary": {"market_logic": "existing summary"},
            "events": [
                {"event_id": "old", "bottom_line": "keep"},
                {"event_id": EVENT_ID, "bottom_line": "stale"},
            ],
        }
        targeted = {
            "schema_version": "event_impact_synthesis.v1",
            "report_date": "2026-07-23",
            "selected_event_ids": [EVENT_ID],
            "synthesis_status": "completed",
            "cross_event_summary": {"market_logic": "target only"},
            "events": [{"event_id": EVENT_ID, "bottom_line": "fresh"}],
        }
        merged = merge_targeted_synthesis(
            existing,
            targeted,
            event_id=EVENT_ID,
        )
        self.assertEqual(
            {row["event_id"]: row["bottom_line"] for row in merged["events"]},
            {"old": "keep", EVENT_ID: "fresh"},
        )
        self.assertEqual(
            merged["cross_event_summary"]["market_logic"],
            "existing summary",
        )


class SynthesisValidationTests(unittest.TestCase):
    def structured(self) -> dict:
        return {"events": [structured_event()]}

    def test_valid_synthesis_passes_and_connection_is_canonicalized(self) -> None:
        synthesis = valid_synthesis()
        validate_synthesis(synthesis, [selected_score()], self.structured(), master())
        canonicalize_synthesis(synthesis, self.structured(), snapshot())
        self.assertEqual(
            synthesis["events"][0]["transmission_channels"][0]["sector_context_status"],
            "evidence_connected",
        )

    def test_unknown_evidence_id_is_rejected(self) -> None:
        synthesis = valid_synthesis()
        synthesis["events"][0]["transmission_channels"][0]["evidence_ids"] = ["invented"]
        with self.assertRaisesRegex(ValueError, "unknown evidence"):
            validate_synthesis(synthesis, [selected_score()], self.structured(), master())

    def test_secondary_evidence_cannot_verify_change(self) -> None:
        synthesis = valid_synthesis()
        synthesis["events"][0]["what_is_new"]["evidence_ids"] = [EVIDENCE_SECONDARY]
        with self.assertRaisesRegex(ValueError, "verified change lacks primary"):
            validate_synthesis(synthesis, [selected_score()], self.structured(), master())

    def test_unknown_sector_is_rejected(self) -> None:
        synthesis = valid_synthesis()
        synthesis["events"][0]["transmission_channels"][0]["sector_id"] = "invented_sector"
        with self.assertRaisesRegex(ValueError, "unknown sector"):
            validate_synthesis(synthesis, [selected_score()], self.structured(), master())

    def test_context_return_cannot_be_promoted_to_priced_in_evidence(self) -> None:
        synthesis = valid_synthesis()
        synthesis["events"][0]["priced_in_assessment"]["status"] = "evidence_supported"
        with self.assertRaisesRegex(ValueError, "overstates priced-in"):
            validate_synthesis(synthesis, [selected_score()], self.structured(), master())

    def test_context_return_can_be_treated_more_conservatively(self) -> None:
        synthesis = valid_synthesis()
        synthesis["events"][0]["priced_in_assessment"]["status"] = "not_assessable"
        validate_synthesis(synthesis, [selected_score()], self.structured(), master())

    def test_unsafe_portfolio_action_is_rejected(self) -> None:
        synthesis = valid_synthesis()
        synthesis["events"][0]["action_posture"] = "add"
        with self.assertRaisesRegex(ValueError, "unauthorized portfolio action"):
            validate_synthesis(synthesis, [selected_score()], self.structured(), master())


class OpenAISynthesisTests(unittest.TestCase):
    def test_one_strict_high_capability_request_is_used(self) -> None:
        response_payload = json.dumps({
            "output_text": json.dumps(valid_synthesis(), ensure_ascii=False),
            "usage": {"input_tokens": 100, "output_tokens": 200},
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

        structured = {"events": [structured_event()]}
        ranking = rank_events(structured, snapshot())
        model_input, selected = bounded_synthesis_input(
            structured, snapshot(), ranking, master()
        )
        with patch.dict(os.environ, {
            "OPENAI_API_KEY": "test-key",
            "OPENAI_EVENT_SYNTHESIS_MODEL": "gpt-5",
        }, clear=False), patch(
            "synthesize_event_impacts.urlopen",
            side_effect=fake_urlopen,
        ):
            synthesis, usage = synthesize_with_openai(
                model_input, selected, structured, master()
            )
        self.assertEqual(synthesis["events"][0]["event_id"], EVENT_ID)
        self.assertEqual(usage["output_tokens"], 200)
        self.assertEqual(captured["body"]["model"], "gpt-5")
        self.assertEqual(captured["body"]["reasoning"]["effort"], "medium")
        self.assertTrue(captured["body"]["text"]["format"]["strict"])


if __name__ == "__main__":
    unittest.main()
