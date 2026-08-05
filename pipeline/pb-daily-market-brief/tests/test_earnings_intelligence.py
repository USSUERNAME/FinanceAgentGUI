from __future__ import annotations

import unittest

from build_earnings_intelligence import (
    build_earnings_intelligence,
    validate_earnings_intelligence,
)


class EarningsIntelligenceTests(unittest.TestCase):
    def test_empty_inputs_wait_for_company_profiles(self) -> None:
        payload = build_earnings_intelligence(
            "2026-07-28",
            events={},
            reactions={},
            reviews={},
            results={},
            deep_dives={},
            generated_at="2026-07-28T08:00:00+09:00",
        )
        self.assertEqual(payload["status"], "awaiting_company_profiles")
        self.assertEqual(payload["summary"]["company_count"], 0)

    def test_aggregates_surprise_guidance_and_revisions_without_upgrading_labels(
        self,
    ) -> None:
        payload = build_earnings_intelligence(
            "2026-07-28",
            events={
                "companies": [{
                    "ticker": "NVDA",
                    "issuer": "NVIDIA",
                    "selected_event": {
                        "event_date": "2026-08-20",
                        "time_of_day": "after_market",
                        "source_id": "event-source",
                    },
                    "source_index": [{
                        "source_id": "event-source",
                        "source_name": "NVIDIA IR calendar",
                        "source_location": "https://investor.nvidia.com/events",
                        "as_of_date": "2026-07-28",
                    }],
                }],
            },
            reactions={
                "companies": [{
                    "ticker": "NVDA",
                    "company_name": "NVIDIA",
                    "historical_reactions": [{
                        "reported_date": "2026-05-20",
                        "fiscal_period_end": "2026-04-30",
                        "reported_eps": 1.1,
                        "estimated_eps": 1.0,
                        "surprise_pct": 10.0,
                        "reaction_pct": 4.5,
                        "window_start": "2026-05-19",
                        "window_end": "2026-05-21",
                        "evidence_label": "derived_calculation",
                        "interpretation_limit": "Broad close window only.",
                    }],
                }],
            },
            reviews={
                "reviews": [{
                    "ticker": "NVDA",
                    "company_name": "NVIDIA",
                    "expectation_bar": {
                        "status": "third_party_estimate_bar_available",
                        "freeze_as_of": "2026-07-28",
                        "revision_direction": "positive_revision",
                        "rows": [{
                            "metric_id": "diluted_eps",
                            "period_end": "2026-07-31",
                            "value": 1.25,
                            "units": "USD per share",
                            "estimate_as_of": "2026-07-28",
                            "analyst_count": 40,
                            "revision_pct_30d": 4.2,
                            "evidence_label": "third_party_forward_estimate",
                            "source_id": "estimate-source",
                        }],
                    },
                    "valuation_screen": {
                        "status": "screening_available",
                        "relative_valuation_status": "discount_to_watchlist_peer_median",
                        "primary_metric": "forward_pe",
                        "target_value": 21.9,
                        "peer_median": 47.3,
                        "premium_discount_pct": -53.7,
                        "usable_peer_count": 2,
                        "minimum_peer_count": 2,
                        "evidence_label": "derived_screening_calculation",
                    },
                    "company_guidance": [{
                        "metric_id": "revenue",
                        "period_end": "2026-07-31",
                        "midpoint": 50_000_000_000,
                        "units": "USD",
                        "evidence_label": "issuer_management_claim",
                        "source_id": "guidance-source",
                    }],
                    "source_index": [{
                        "source_id": "estimate-source",
                        "source_name": "Estimate provider",
                        "source_location": "https://example.com/estimates",
                        "as_of_date": "2026-07-28",
                    }, {
                        "source_id": "guidance-source",
                        "source_name": "NVIDIA guidance",
                        "source_location": "https://investor.nvidia.com/results",
                        "as_of_date": "2026-05-20",
                    }],
                }],
            },
            results={
                "companies": [{
                    "ticker": "NVDA",
                    "company_name": "NVIDIA",
                    "pack_status": "ready_for_post_earnings_deep_dive",
                    "headline_result_case": "stronger_evidence",
                    "reported_metric_comparison": {
                        "metric_id": "revenue",
                        "reported_value": 46_000_000_000,
                        "period_end": "2026-04-30",
                        "units": "USD",
                        "source_id": "result-source",
                    },
                    "guidance_updates": [],
                    "source_index": [{
                        "source_id": "result-source",
                        "source_name": "NVIDIA earnings release",
                        "source_location": "https://investor.nvidia.com/results",
                        "as_of_date": "2026-05-20",
                    }],
                }],
            },
            deep_dives={
                "reviews": [{
                    "ticker": "NVDA",
                    "model_update_packet": {
                        "estimate_revision_direction":
                            "not_established_missing_refreshed_estimates_and_model",
                        "model_update_applied": False,
                    },
                }],
            },
            generated_at="2026-07-28T08:00:00+09:00",
        )
        company = payload["companies"][0]
        self.assertEqual(company["upcoming_event"]["confidence"], "confirmed")
        self.assertEqual(
            company["estimate_revision"]["rows"][0]["evidence_label"],
            "third_party_forward_estimate",
        )
        self.assertEqual(
            company["guidance"][0]["evidence_label"],
            "issuer_management_claim",
        )
        self.assertEqual(company["historical_surprises"][0]["surprise_pct"], 10.0)
        self.assertEqual(
            company["valuation_screen"]["relative_valuation_status"],
            "discount_to_watchlist_peer_median",
        )
        self.assertEqual(
            company["latest_verified_result"]["status"],
            "verified_primary_input_pack",
        )
        self.assertFalse(
            company["post_result_estimate_revision"]["model_update_applied"]
        )

    def test_rejects_relabelled_estimate_as_consensus(self) -> None:
        payload = build_earnings_intelligence(
            "2026-07-28",
            events={},
            reactions={},
            reviews={
                "reviews": [{
                    "ticker": "NVDA",
                    "expectation_bar": {
                        "rows": [{
                            "metric_id": "diluted_eps",
                            "evidence_label": "third_party_forward_estimate",
                        }],
                    },
                }],
            },
            results={},
            deep_dives={},
        )
        payload["companies"][0]["estimate_revision"]["rows"][0][
            "evidence_label"
        ] = "consensus"
        with self.assertRaisesRegex(ValueError, "third-party estimates"):
            validate_earnings_intelligence(payload)


if __name__ == "__main__":
    unittest.main()
