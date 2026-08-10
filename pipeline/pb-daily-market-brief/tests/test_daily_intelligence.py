import unittest

from build_daily_intelligence import (
    SCHEMA_VERSION,
    build_daily_intelligence,
    validate_daily_intelligence,
)


class DailyIntelligenceTests(unittest.TestCase):
    report_date = "2026-07-24"

    def snapshot(self) -> dict:
        return {
            "report_date": self.report_date,
            "data_cutoff": {"market": "2026-07-23"},
            "official_market_calendar": {
                "collection_status": "complete",
                "source_count": 2,
            },
            "upcoming_events": [{
                "event_id": "cpi-2026-07",
                "date": "2026-07-24",
                "time": "08:30 ET",
                "title": "Consumer Price Index",
                "source_url": "https://www.bls.gov/schedule/",
                "primary_source_confirmed": True,
            }],
            "market_scoreboard": {"rates": {"us10y": 4.4}},
            "day_over_day_changes": {"status": "available"},
            "korea_market": {"status": "available"},
            "source_summary": {"record_count": 12},
            "source_quality": {"grade_counts": {"A": 1, "D": 11}},
            "calculation_warnings": [],
            "news_event_clusters": {
                "cluster_count": 2,
                "clusters": [
                    {
                        "event_id": "event-low",
                        "event_type": "news",
                        "representative_title": "Low priority",
                        "article_count": 4,
                        "publisher_count": 3,
                        "source_urls": ["https://example.com/low"],
                        "verification_status": "discovery_metadata_only",
                    },
                    {
                        "event_id": "event-primary",
                        "event_type": "earnings",
                        "representative_title": "Primary event",
                        "entities": ["NVDA"],
                        "listed_entities": ["NVDA"],
                        "topic_tags": ["earnings", "semiconductors"],
                        "article_count": 2,
                        "publisher_count": 2,
                        "source_urls": ["https://sec.gov/primary"],
                        "verification_status": "primary_source_available",
                    },
                ],
            },
            "event_source_matches": {
                "events": [
                    {
                        "event_id": "event-primary",
                        "resolution_status": "origin_primary_matched",
                        "evidence_posture": "research_grade_primary_available",
                        "matched_sources": [
                            {
                                "source_role": "origin_primary",
                                "source_grade": "A",
                                "url": "https://sec.gov/primary",
                            }
                        ],
                    }
                ]
            },
            "structured_event_evidence": {
                "events": [
                    {
                        "event_id": "event-primary",
                        "extraction_status": "completed",
                        "evidence_posture": "research_grade_primary_available",
                        "facts": [
                            {
                                "claim": "Revenue guidance was raised",
                                "evidence_ids": ["evidence-1"],
                            }
                        ],
                        "reported_claims": [],
                        "interpretation_candidates": [
                            {"claim": "Sector demand may improve"}
                        ],
                        "conflicts": [],
                    }
                ]
            },
            "event_impact_synthesis": {
                "synthesis_status": "completed",
                "selected_event_ids": ["event-primary"],
                "event_ranking": [
                    {
                        "event_id": "event-primary",
                        "priority_score": 80,
                        "impact_priority_score": 70,
                    },
                    {
                        "event_id": "event-low",
                        "priority_score": 5,
                        "impact_priority_score": 10,
                    },
                ],
                "events": [
                    {
                        "event_id": "event-primary",
                        "bottom_line": "Verified earnings update",
                    }
                ],
            },
        }

    def analysis(self) -> dict:
        return {
            "report_date": self.report_date,
            "analysis": {
                "market_regime": {"label": "mixed"},
                "key_drivers": [
                    {"observation": "first"},
                    {"observation": "second"},
                    {"observation": "third"},
                    {"observation": "bounded out"},
                ],
                "conflicting_signals": ["rates and breadth conflict"],
                "top_risks": ["real yield shock"],
                "data_warnings": ["Korea flow input unavailable"],
            },
        }

    def review(self) -> dict:
        return {
            "summary": {"entry_count": 1},
            "active_entries": [
                {
                    "continuity_id": "event:1",
                    "kind": "market_event",
                    "monitoring_state": "confirmed",
                }
            ],
        }

    def test_builds_event_centered_contract_with_verified_fact_gate(self) -> None:
        packet = build_daily_intelligence(
            self.report_date,
            snapshot=self.snapshot(),
            analysis_payload=self.analysis(),
            continuity_review=self.review(),
            generated_at="2026-07-24T08:00:00+09:00",
        )
        self.assertEqual(packet["schema_version"], SCHEMA_VERSION)
        self.assertEqual(packet["events"]["items"][0]["event_id"], "event-primary")
        self.assertEqual(packet["events"]["items"][0]["entities"], ["NVDA"])
        self.assertEqual(
            packet["events"]["items"][0]["listed_entities"],
            ["NVDA"],
        )
        self.assertEqual(
            packet["events"]["items"][0]["topic_tags"],
            ["earnings", "semiconductors"],
        )
        self.assertEqual(packet["events"]["verified_primary_fact_count"], 1)
        self.assertTrue(
            packet["events"]["items"][0]["verification"][
                "publication_eligible_as_fact"
            ]
        )
        self.assertEqual(len(packet["market"]["key_drivers"]), 3)
        self.assertEqual(
            packet["market"]["official_calendar"]["collection_status"],
            "complete",
        )
        self.assertEqual(packet["market"]["upcoming_events"][0]["event_id"], "cpi-2026-07")
        self.assertEqual(
            packet["market"]["conflicting_signals"],
            ["rates and breadth conflict"],
        )
        self.assertEqual(
            packet["source_state"]["data_warnings"],
            ["Korea flow input unavailable"],
        )
        self.assertFalse(packet["policy"]["automatic_publication"])

    def test_matched_primary_without_extracted_fact_is_not_confirmed(self) -> None:
        snapshot = self.snapshot()
        snapshot["structured_event_evidence"]["events"][0]["facts"] = []
        packet = build_daily_intelligence(
            self.report_date,
            snapshot=snapshot,
            analysis_payload=self.analysis(),
            continuity_review=self.review(),
        )
        primary = packet["events"]["items"][0]
        self.assertTrue(
            primary["verification"]["origin_primary_source_available"]
        )
        self.assertFalse(primary["verification"]["primary_fact_confirmed"])
        self.assertFalse(primary["verification"]["publication_eligible_as_fact"])
        self.assertEqual(primary["common_facts"], [])

    def test_structured_primary_fact_stays_confirmed_when_impact_synthesis_falls_back(self) -> None:
        snapshot = self.snapshot()
        snapshot["structured_event_evidence"]["events"][0][
            "extraction_status"
        ] = "structured"
        snapshot["event_impact_synthesis"].update({
            "synthesis_status": "not_run",
            "fallback_reason": "RuntimeError",
            "events": [],
        })

        packet = build_daily_intelligence(
            self.report_date,
            snapshot=snapshot,
            analysis_payload=self.analysis(),
            continuity_review=self.review(),
        )

        self.assertEqual(packet["events"]["verified_primary_fact_count"], 1)
        primary = packet["events"]["items"][0]
        self.assertTrue(primary["verification"]["primary_fact_confirmed"])
        self.assertEqual(primary["verification"]["extraction_status"], "structured")
        self.assertEqual(len(primary["common_facts"]), 1)

    def test_unverified_discovery_cluster_remains_visible_but_not_fact(self) -> None:
        packet = build_daily_intelligence(
            self.report_date,
            snapshot=self.snapshot(),
            analysis_payload=self.analysis(),
            continuity_review=self.review(),
        )
        discovery = packet["events"]["items"][1]
        self.assertEqual(discovery["event_id"], "event-low")
        self.assertFalse(discovery["verification"]["primary_fact_confirmed"])
        self.assertEqual(discovery["common_facts"], [])

    def test_validation_rejects_action_authority(self) -> None:
        packet = build_daily_intelligence(
            self.report_date,
            snapshot=self.snapshot(),
            analysis_payload=self.analysis(),
            continuity_review=self.review(),
        )
        packet["policy"]["position_actions_allowed"] = True
        with self.assertRaises(ValueError):
            validate_daily_intelligence(packet)

    def test_preserves_earnings_evidence_labels_for_reader_contract(self) -> None:
        earnings = {
            "schema_version": "earnings_intelligence.v1",
            "status": "ready",
            "summary": {"company_count": 1},
            "companies": [{
                "ticker": "NVDA",
                "estimate_revision": {
                    "rows": [{
                        "metric_id": "diluted_eps",
                        "evidence_label": "third_party_forward_estimate",
                    }],
                },
                "guidance": [{
                    "metric_id": "revenue",
                    "evidence_label": "issuer_management_claim",
                }],
            }],
            "policy": {"position_actions_allowed": False},
        }
        packet = build_daily_intelligence(
            self.report_date,
            snapshot=self.snapshot(),
            analysis_payload=self.analysis(),
            continuity_review=self.review(),
            earnings_intelligence=earnings,
        )
        self.assertEqual(packet["earnings"]["status"], "ready")
        self.assertEqual(
            packet["earnings"]["companies"][0]["estimate_revision"]["rows"][0][
                "evidence_label"
            ],
            "third_party_forward_estimate",
        )

    def test_report_date_mismatch_fails(self) -> None:
        snapshot = self.snapshot()
        snapshot["report_date"] = "2026-07-23"
        with self.assertRaises(ValueError):
            build_daily_intelligence(
                self.report_date,
                snapshot=snapshot,
                analysis_payload=self.analysis(),
                continuity_review=self.review(),
            )


if __name__ == "__main__":
    unittest.main()
