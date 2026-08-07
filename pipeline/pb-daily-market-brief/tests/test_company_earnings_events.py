from __future__ import annotations

import copy
import unittest
from datetime import date

from build_company_earnings_driver_review import build_company_earnings_driver_review
from collect_company_earnings_events import (
    collect_company_earnings_events,
    validate_company_earnings_events,
    validate_primary_event_record,
)
from compose_daily_brief import source_section
from test_company_earnings_driver_review import bundle


IR_URL = "https://investor.gevernova.com/events/quarterly-results"
AV_URL = "https://www.alphavantage.co/documentation/"


def provider_csv(event_date: str = "2026-07-29") -> str:
    return (
        "symbol,name,reportDate,fiscalDateEnding,estimate,currency\n"
        f"GEV,GE Vernova,{event_date},2026-06-30,1.50,USD\n"
        "OTHER,Other Company,2026-08-01,2026-06-30,2.00,USD\n"
    )


def confirmed_event(event_date: str = "2026-07-30") -> dict:
    return {
        "event_id": "gev-2026q2-earnings",
        "ticker": "GEV",
        "issuer": "GE Vernova",
        "reported_period": "2026 Q2",
        "fiscal_period_end": "2026-06-30",
        "event_date": event_date,
        "time_of_day": "before_market",
        "time_zone": "America/New_York",
        "source_type": "company_ir_calendar",
        "source_url": IR_URL,
        "source_date": "2026-07-18",
        "body_location": "Events page, Q2 2026 results row",
        "primary_source_confirmed": True,
        "body_verified": True,
    }


def tearsheets() -> dict:
    return bundle()[0]


class CompanyEarningsEventTests(unittest.TestCase):
    def test_provider_calendar_is_one_global_call_and_expected_only(self) -> None:
        calls = []
        payload = collect_company_earnings_events(
            "2026-07-20", tearsheets(), "secret",
            fetcher=lambda key, horizon: calls.append((key, horizon)) or provider_csv(),
        )
        company = payload["companies"][0]
        self.assertEqual(calls, [("secret", "3month")])
        self.assertEqual(payload["request_count"], 1)
        self.assertEqual(company["event_gate_status"], "provider_expected_needs_primary_confirmation")
        self.assertIsNone(company["selected_event"])
        self.assertEqual(company["provider_expected_events"][0]["confidence"], "expected")
        self.assertEqual(company["provider_expected_events"][0]["date_type"], "soft_date")

    def test_missing_key_is_nonfatal_and_makes_no_provider_call(self) -> None:
        calls = []
        payload = collect_company_earnings_events(
            "2026-07-20", tearsheets(), "",
            fetcher=lambda *args: calls.append(args) or provider_csv(),
        )
        self.assertEqual(payload["collection_status"], "missing_provider_key_and_primary_inputs")
        self.assertEqual(payload["request_count"], 0)
        self.assertEqual(calls, [])

    def test_body_verified_company_date_unlocks_preview_input_pack(self) -> None:
        record = validate_primary_event_record(confirmed_event(), date.fromisoformat("2026-07-20"))
        payload = collect_company_earnings_events(
            "2026-07-20", tearsheets(), "", primary_inputs=[record],
        )
        company = payload["companies"][0]
        self.assertEqual(company["event_gate_status"], "confirmed_primary_exact_date")
        self.assertEqual(company["selected_event"]["event_date"], "2026-07-30")
        self.assertEqual(company["readiness"], "eligible_for_pre_event_preview_input_pack")

    def test_primary_date_controls_provider_conflict(self) -> None:
        record = validate_primary_event_record(confirmed_event(), date.fromisoformat("2026-07-20"))
        payload = collect_company_earnings_events(
            "2026-07-20", tearsheets(), "secret",
            fetcher=lambda *_: provider_csv("2026-07-29"), primary_inputs=[record],
        )
        company = payload["companies"][0]
        self.assertEqual(company["selected_event"]["event_date"], "2026-07-30")
        self.assertEqual(company["conflicts"][0]["type"], "provider_primary_date_conflict")

    def test_unverified_or_non_company_event_source_is_rejected(self) -> None:
        row = confirmed_event()
        row["source_type"] = "news_article"
        with self.assertRaisesRegex(ValueError, "company-owned primary source"):
            validate_primary_event_record(row, date.fromisoformat("2026-07-20"))
        row = confirmed_event()
        row["body_verified"] = False
        with self.assertRaisesRegex(ValueError, "body verification"):
            validate_primary_event_record(row, date.fromisoformat("2026-07-20"))

    def test_confirmed_event_promotes_driver_review_input_readiness(self) -> None:
        tear_payload, valuation_payload, primary_payload = bundle()
        record = validate_primary_event_record(confirmed_event(), date.fromisoformat("2026-07-20"))
        events = collect_company_earnings_events(
            "2026-07-20", tear_payload, "", primary_inputs=[record],
        )
        review = build_company_earnings_driver_review(
            "2026-07-20", tear_payload, valuation_payload, primary_payload, events,
        )["reviews"][0]
        self.assertEqual(review["review_mode"], "pre_event_preview_ready_input_pack")
        self.assertEqual(review["event_setup"]["event_date_status"], "confirmed_primary")
        self.assertEqual(review["event_setup"]["event_date"], "2026-07-30")
        self.assertFalse(review["reaction_framework"]["bull_base_bear_generated"])

    def test_validator_blocks_provider_date_promotion(self) -> None:
        payload = collect_company_earnings_events(
            "2026-07-20", tearsheets(), "secret", fetcher=lambda *_: provider_csv(),
        )
        tampered = copy.deepcopy(payload)
        company = tampered["companies"][0]
        company["selected_event"] = company["provider_expected_events"][0]
        company["event_gate_status"] = "confirmed_primary_exact_date"
        company["readiness"] = "eligible_for_pre_event_preview_input_pack"
        with self.assertRaisesRegex(ValueError, "primary hard date"):
            validate_company_earnings_events(tampered)

    def test_event_sources_are_deduplicated_in_report(self) -> None:
        record = validate_primary_event_record(confirmed_event(), date.fromisoformat("2026-07-20"))
        payload = collect_company_earnings_events(
            "2026-07-20", tearsheets(), "secret",
            fetcher=lambda *_: provider_csv(), primary_inputs=[record],
        )
        rendered = source_section([], {
            "company_earnings_events": payload,
            "source_quality": {"evidence_posture": "research_grade"},
        })
        self.assertEqual(rendered.count(IR_URL), 1)
        self.assertEqual(rendered.count(AV_URL), 1)


if __name__ == "__main__":
    unittest.main()
