from __future__ import annotations

import copy
import unittest

from build_company_thesis_review_calendar import (
    build_company_thesis_review_calendar,
    validate_company_thesis_review_calendar,
)
from test_company_review_operating_config import collected_config
from test_company_thesis_update import registry


def confirmed_events() -> dict:
    return {"companies": [{
        "ticker": "GEV", "issuer": "GE Vernova",
        "event_gate_status": "confirmed_primary_exact_date",
        "selected_event": {
            "event_id": "gev-2026q4", "ticker": "GEV", "reported_period": "2026 Q4",
            "event_date": "2026-11-05", "time_of_day": "before_market",
            "time_zone": "America/New_York", "confidence": "confirmed",
            "date_type": "hard_date", "source_id": "EVENT-GEV-gev-2026q4",
            "source_date": "2026-10-20",
        },
        "provider_expected_events": [], "conflicts": [],
        "source_index": [{
            "source_id": "EVENT-GEV-gev-2026q4", "source_name": "GEV earnings event confirmation",
            "source_type": "primary_public_source", "as_of_date": "2026-10-20",
            "source_location": "https://investor.gevernova.com/events",
        }],
    }]}


def expected_events() -> dict:
    return {"companies": [{
        "ticker": "GEV", "issuer": "GE Vernova",
        "event_gate_status": "provider_expected_needs_primary_confirmation",
        "selected_event": None,
        "provider_expected_events": [{
            "event_id": "provider-earnings-GEV-2026-11-04", "ticker": "GEV",
            "event_date": "2026-11-04", "confidence": "expected", "date_type": "soft_date",
            "source_id": "alpha_vantage:earnings_calendar",
        }],
        "conflicts": [],
        "source_index": [{
            "source_id": "alpha_vantage:earnings_calendar", "source_name": "Alpha Vantage Earnings Calendar",
            "source_type": "provider", "as_of_date": "2026-10-31",
            "source_location": "https://www.alphavantage.co/documentation/",
        }],
    }]}


class CompanyThesisReviewCalendarTests(unittest.TestCase):
    def test_approved_underwriting_and_primary_date_create_confirmed_review(self) -> None:
        payload = build_company_thesis_review_calendar(
            "2026-10-31", registry(), confirmed_events(), {"updates": []},
        )
        company = payload["companies"][0]
        review = company["dated_reviews"][0]
        self.assertEqual(payload["calendar_status"], "confirmed_review_dates_available")
        self.assertEqual(review["event_date"], "2026-11-05")
        self.assertEqual(review["confidence"], "confirmed")
        self.assertIsNone(review["prep_due_date"])
        self.assertIsNone(review["post_event_update_sla"])
        self.assertEqual(company["position_action"], "wait_for_proof")

    def test_approved_operating_config_populates_owner_prep_and_sla(self) -> None:
        payload = build_company_thesis_review_calendar(
            "2026-10-31", registry(), confirmed_events(), {"updates": []}, collected_config(),
        )
        company = payload["companies"][0]
        review = company["dated_reviews"][0]
        self.assertEqual(payload["approved_operating_config_count"], 1)
        self.assertEqual(company["operating_config_status"], "approved_operating_config_applied")
        self.assertEqual(company["missing_operating_model_fields"], [])
        self.assertEqual(review["prep_owner"], "research_analyst")
        self.assertEqual(review["prep_due_date"], "2026-10-31")
        self.assertEqual(review["post_event_update_sla"]["value"], 24)
        self.assertEqual(company["next_scheduled_review_status"], "upcoming_approved_internal_date")
        self.assertTrue(all(
            row["owner"] == "research_analyst" and row["review_cadence"] == "event_driven"
            for row in company["undated_proof_queue"]
        ))

    def test_past_internal_review_date_is_marked_for_config_refresh(self) -> None:
        config = collected_config()
        config["companies"][0]["selected_config"]["review_policy"]["next_scheduled_review_date"] = "2026-10-30"
        payload = build_company_thesis_review_calendar(
            "2026-10-31", registry(), confirmed_events(), {"updates": []}, config,
        )
        company = payload["companies"][0]
        self.assertEqual(company["next_scheduled_review_status"], "past_date_requires_config_refresh")

    def test_provider_expected_date_stays_soft_and_out_of_confirmed_reviews(self) -> None:
        payload = build_company_thesis_review_calendar(
            "2026-10-31", registry(), expected_events(), {"updates": []},
        )
        company = payload["companies"][0]
        self.assertEqual(company["dated_reviews"], [])
        self.assertEqual(company["soft_date_candidates"][0]["date_type"], "soft_date")
        self.assertEqual(company["next_review_gate"], "confirm_company_owned_event_date")

    def test_no_approved_underwriting_creates_no_company_schedule(self) -> None:
        underwriting = copy.deepcopy(registry())
        underwriting["companies"] = []
        underwriting["company_count"] = 0
        underwriting["approved_count"] = 0
        payload = build_company_thesis_review_calendar(
            "2026-10-31", underwriting, confirmed_events(), {"updates": []},
        )
        self.assertEqual(payload["calendar_status"], "blocked_no_approved_underwriting")
        self.assertEqual(payload["companies"], [])

    def test_undated_pillar_proof_points_are_retained(self) -> None:
        payload = build_company_thesis_review_calendar(
            "2026-10-31", registry(), {"companies": []}, {"updates": []},
        )
        company = payload["companies"][0]
        self.assertEqual(len(company["undated_proof_queue"]), 2)
        self.assertTrue(all(row["review_cadence"] is None for row in company["undated_proof_queue"]))
        self.assertEqual(company["calendar_status"], "approved_thesis_undated_proof_queue_only")

    def test_validator_rejects_unconfirmed_hard_date_or_position_action(self) -> None:
        payload = build_company_thesis_review_calendar(
            "2026-10-31", registry(), confirmed_events(), {"updates": []},
        )
        tampered = copy.deepcopy(payload)
        tampered["companies"][0]["dated_reviews"][0]["confidence"] = "expected"
        with self.assertRaisesRegex(ValueError, "confirmed hard-date"):
            validate_company_thesis_review_calendar(tampered)
        tampered = copy.deepcopy(payload)
        tampered["companies"][0]["position_action"] = "buy"
        with self.assertRaisesRegex(ValueError, "position action"):
            validate_company_thesis_review_calendar(tampered)

    def test_confirmed_review_source_must_resolve(self) -> None:
        payload = build_company_thesis_review_calendar(
            "2026-10-31", registry(), confirmed_events(), {"updates": []},
        )
        tampered = copy.deepcopy(payload)
        tampered["companies"][0]["dated_reviews"][0]["source_id"] = "missing"
        with self.assertRaisesRegex(ValueError, "source does not resolve"):
            validate_company_thesis_review_calendar(tampered)


if __name__ == "__main__":
    unittest.main()
