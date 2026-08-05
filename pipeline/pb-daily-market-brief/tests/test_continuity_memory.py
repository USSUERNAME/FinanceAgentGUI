import copy
import unittest

from build_continuity_memory import (
    build_continuity_memory,
    validate_continuity_memory,
)


class ContinuityMemoryTests(unittest.TestCase):
    def build(self, previous=None, report_date="2026-07-24", **overrides):
        inputs = {
            "hypothesis_history": {"records": [{
                "id": "2026-07-24-H1",
                "created_report_date": "2026-07-24",
                "metric_key": "vix_term_ratio",
                "metric_label": "VIX/VIX3M",
                "expected_direction": "decrease",
                "minimum_change": 0.03,
                "claim": "Volatility term structure remains supportive",
                "status": "pending",
            }]},
            "sector_history": {"daily_records": [], "transition_events": []},
            "company_history": {"daily_records": [], "transition_events": []},
            "event_clusters": {"clusters": []},
            "event_source_matches": {"events": []},
            "cross_source_events": {"events": []},
        }
        inputs.update(overrides)
        return build_continuity_memory(previous or {}, report_date, **inputs)

    def test_same_metric_and_direction_keep_continuity_id(self) -> None:
        first, _ = self.build()
        changed = copy.deepcopy(first)
        hypothesis = {
            "records": [{
                "id": "2026-07-25-H1",
                "created_report_date": "2026-07-25",
                "metric_key": "vix_term_ratio",
                "expected_direction": "decrease",
                "minimum_change": 0.03,
                "claim": "Updated wording for the same test",
                "status": "hit",
                "resolution_reason": "Threshold reached",
            }]
        }
        second, _ = self.build(
            changed,
            report_date="2026-07-25",
            hypothesis_history=hypothesis,
        )
        self.assertEqual(len(second["entries"]), 1)
        row = second["entries"][0]
        self.assertEqual(row["first_seen_date"], "2026-07-24")
        self.assertEqual(row["last_seen_date"], "2026-07-25")
        self.assertEqual(row["last_confirmed_date"], "2026-07-25")
        self.assertEqual(row["monitoring_state"], "confirmed")
        self.assertEqual(len(row["observations"]), 2)

    def test_unseen_nonterminal_entry_moves_to_easing_after_two_days(self) -> None:
        first, _ = self.build()
        second, _ = self.build(
            first,
            report_date="2026-07-26",
            hypothesis_history={"records": []},
        )
        self.assertEqual(second["entries"][0]["monitoring_state"], "easing")
        self.assertIn("monitoring decay", second["entries"][0]["state_reason"])

    def test_event_requires_primary_match_for_confirmed_state(self) -> None:
        clusters = {"clusters": [{
            "event_id": "event-1",
            "event_type": "monetary_policy",
            "representative_title": "Federal Reserve policy update",
            "entities": ["Federal Reserve"],
            "topic_tags": ["rates"],
            "record_ids": ["radar-1"],
        }]}
        unverified, _ = self.build(
            hypothesis_history={"records": []},
            event_clusters=clusters,
            event_source_matches={"events": [{
                "event_id": "event-1",
                "resolution_status": "search_required",
                "matched_sources": [],
            }]},
        )
        self.assertEqual(unverified["entries"][0]["monitoring_state"], "unverified")
        confirmed, _ = self.build(
            hypothesis_history={"records": []},
            event_clusters=clusters,
            event_source_matches={"events": [{
                "event_id": "event-1",
                "resolution_status": "origin_primary_matched",
                "matched_sources": [{"record_id": "fed-1"}],
            }]},
        )
        self.assertEqual(confirmed["entries"][0]["monitoring_state"], "confirmed")
        self.assertEqual(confirmed["entries"][0]["evidence"]["filing"], ["fed-1"])

    def test_cross_source_roles_accumulate_without_confirming_unverified_event(self) -> None:
        clusters = {"clusters": [{
            "event_id": "event-1",
            "event_type": "earnings_guidance",
            "representative_title": "NVIDIA guidance update",
            "entities": ["NVDA"],
            "topic_tags": ["earnings", "guidance"],
            "record_ids": ["rss-1"],
        }]}
        cross_source = {"events": [{
            "event_id": "event-1",
            "cross_source_status": "multi_source_unverified",
            "source_mix": {
                "international_news": 1,
                "telegram_commentary": 1,
                "broker_research": 1,
            },
            "official_sources": [{"record_id": "sec-context-1"}],
            "attributed_research": [{
                "report_id": "report-1",
                "monitoring_conditions": ["Next-quarter guidance is maintained"],
            }],
            "discovery_sources": [
                {"record_id": "rss-1"},
                {"record_id": "telegram-1"},
            ],
        }]}
        memory, _ = self.build(
            hypothesis_history={"records": []},
            event_clusters=clusters,
            event_source_matches={"events": [{
                "event_id": "event-1",
                "resolution_status": "search_required",
                "matched_sources": [],
            }]},
            cross_source_events=cross_source,
        )
        row = memory["entries"][0]
        self.assertEqual(row["monitoring_state"], "unverified")
        self.assertEqual(row["verification_state"], "cross_source_unverified")
        self.assertEqual(row["evidence"]["research"], ["report-1"])
        self.assertEqual(row["evidence"]["filing"], [])
        self.assertEqual(row["evidence"]["official_context"], ["sec-context-1"])
        self.assertIn("telegram-1", row["evidence"]["news"])
        self.assertEqual(row["last_evidence_expansion_date"], "2026-07-24")
        self.assertIn(
            "Next-quarter guidance is maintained",
            row["confirmation_conditions"],
        )

    def test_sector_and_company_evidence_are_separated(self) -> None:
        sector = {
            "daily_records": [{
                "record_id": "sector-row",
                "report_date": "2026-07-24",
                "revision": 1,
                "thesis_id": "sector:semis",
                "sector_id": "semis",
                "name_ko": "반도체",
                "dimensions": {"market_confirmation": {"score": 70}},
                "evidence_source_ids": ["sector-source"],
            }],
            "transition_events": [],
        }
        company = {
            "daily_records": [{
                "record_id": "company-row",
                "report_date": "2026-07-24",
                "revision": 1,
                "thesis_id": "company:NVDA",
                "ticker": "NVDA",
                "company_name": "NVIDIA",
                "company_thesis_status": "untested",
                "source_index": [{"source_id": "sec-8k"}],
                "pillars": [],
                "action_rules": [],
            }],
            "transition_events": [],
        }
        memory, _ = self.build(
            hypothesis_history={"records": []},
            sector_history=sector,
            company_history=company,
        )
        rows = {row["kind"]: row for row in memory["entries"]}
        self.assertEqual(rows["sector_thesis"]["evidence"]["research"], ["sector-source"])
        self.assertEqual(rows["company_thesis"]["evidence"]["filing"], ["sec-8k"])

    def test_validator_rejects_model_mutation_permission(self) -> None:
        memory, _ = self.build()
        memory["policy"]["model_automatic_mutation_allowed"] = True
        with self.assertRaisesRegex(ValueError, "must remain disabled"):
            validate_continuity_memory(memory)

    def test_model_suggestions_are_read_only_and_bounded(self) -> None:
        previous = {
            "suggestions": [
                {"suggestion_id": f"S{index}", "status": "watching"}
                for index in range(105)
            ]
        }
        memory, _ = self.build(previous)
        self.assertEqual(len(memory["suggestions"]), 100)
        self.assertTrue(memory["policy"]["model_change_suggestions_allowed"])
        self.assertFalse(memory["policy"]["model_suggestion_application_allowed"])
        self.assertEqual(memory["summary"]["pending_suggestion_count"], 100)
        memory["policy"]["model_suggestion_application_allowed"] = True
        with self.assertRaisesRegex(ValueError, "cannot apply themselves"):
            validate_continuity_memory(memory)


if __name__ == "__main__":
    unittest.main()
