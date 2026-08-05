from __future__ import annotations

import copy
import unittest
from datetime import date

from build_company_earnings_driver_review import build_company_earnings_driver_review
from collect_company_earnings_events import collect_company_earnings_events, validate_primary_event_record
from collect_company_earnings_reaction_context import (
    collect_company_earnings_reaction_context,
    validate_company_earnings_reaction_context,
    validate_option_snapshot,
)
from compose_daily_brief import source_section
from test_company_earnings_driver_review import bundle
from test_company_earnings_events import confirmed_event


AV_URL = "https://www.alphavantage.co/documentation/"
OPTION_URL = "https://broker.example.com/export/gev-options"


def earnings_payload() -> dict:
    return {"quarterlyEarnings": [{
        "fiscalDateEnding": "2026-03-31", "reportedDate": "2026-06-01",
        "reportedEPS": "2.00", "estimatedEPS": "1.80", "surprise": "0.20",
        "surprisePercentage": "11.1111",
    }, {
        "fiscalDateEnding": "2025-12-31", "reportedDate": "2026-05-01",
        "reportedEPS": "1.50", "estimatedEPS": "1.60", "surprise": "-0.10",
        "surprisePercentage": "-6.25",
    }]}


def daily_payload() -> dict:
    return {"Time Series (Daily)": {
        "2026-06-02": {"4. close": "99"},
        "2026-05-29": {"4. close": "110"},
        "2026-05-04": {"4. close": "110"},
        "2026-04-30": {"4. close": "100"},
    }}


def fetcher(function: str, ticker: str, key: str) -> dict:
    assert ticker == "GEV"
    assert key == "secret"
    return earnings_payload() if function == "EARNINGS" else daily_payload()


def option_snapshot(as_of: str = "2026-07-27", expiration: str = "2026-07-31") -> dict:
    return {
        "record_id": "gev-2026q2-straddle",
        "ticker": "GEV",
        "event_date": "2026-07-30",
        "as_of": as_of,
        "spot": 640.0,
        "expiration": expiration,
        "atm_call_mid": 8.0,
        "atm_put_mid": 7.0,
        "currency": "USD",
        "source_type": "approved_provider_export",
        "source_reference": OPTION_URL,
        "provider": "Licensed Broker",
        "rights_confirmed": True,
    }


def confirmed_events() -> dict:
    tear_payload = bundle()[0]
    record = validate_primary_event_record(confirmed_event(), date.fromisoformat("2026-07-20"))
    return collect_company_earnings_events(
        "2026-07-20", tear_payload, "", primary_inputs=[record],
    )


class CompanyEarningsReactionContextTests(unittest.TestCase):
    def test_two_provider_calls_create_broad_window_history(self) -> None:
        tear_payload = bundle()[0]
        calls = []
        sleeps = []
        payload = collect_company_earnings_reaction_context(
            "2026-07-20", tear_payload, confirmed_events(), "secret",
            fetcher=lambda fn, ticker, key: calls.append((fn, ticker)) or fetcher(fn, ticker, key),
            sleeper=sleeps.append, delay_seconds=13,
        )
        company = payload["companies"][0]
        self.assertEqual(calls, [("EARNINGS", "GEV"), ("TIME_SERIES_DAILY", "GEV")])
        self.assertEqual(sleeps, [13])
        self.assertEqual(payload["request_count"], 2)
        self.assertEqual(company["historical_observation_count"], 2)
        self.assertEqual(company["median_absolute_reaction_pct"], 10.0)
        self.assertTrue(all("not an isolated" in row["interpretation_limit"] for row in company["historical_reactions"]))

    def test_missing_key_is_nonfatal(self) -> None:
        calls = []
        payload = collect_company_earnings_reaction_context(
            "2026-07-20", bundle()[0], confirmed_events(), "",
            fetcher=lambda *args: calls.append(args) or {},
        )
        self.assertEqual(payload["collection_status"], "missing_provider_key_and_option_inputs")
        self.assertEqual(payload["request_count"], 0)
        self.assertEqual(calls, [])

    def test_event_isolating_option_export_is_hurdle_candidate_not_forecast(self) -> None:
        option = validate_option_snapshot(option_snapshot(), date.fromisoformat("2026-07-30"))
        payload = collect_company_earnings_reaction_context(
            "2026-07-30", bundle()[0], confirmed_events(), "", option_inputs=[option],
        )
        company = payload["companies"][0]
        self.assertEqual(company["implied_move_status"], "event_hurdle_candidate_not_forecast")
        self.assertEqual(company["option_context"]["straddle_pct_of_spot"], 2.3438)

    def test_broad_expiry_remains_tenor_volatility_context(self) -> None:
        option = validate_option_snapshot(
            option_snapshot("2026-07-20", "2026-08-07"), date.fromisoformat("2026-07-20"),
        )
        payload = collect_company_earnings_reaction_context(
            "2026-07-20", bundle()[0], confirmed_events(), "", option_inputs=[option],
        )
        company = payload["companies"][0]
        self.assertEqual(company["implied_move_status"], "expiry_tenor_volatility_context")
        self.assertIn("do not label", company["option_context"]["decision_limit"])

    def test_unapproved_option_export_is_rejected(self) -> None:
        row = option_snapshot()
        row["rights_confirmed"] = False
        with self.assertRaisesRegex(ValueError, "usage rights"):
            validate_option_snapshot(row, date.fromisoformat("2026-07-30"))

    def test_reaction_context_flows_into_pre_event_review_without_scenarios(self) -> None:
        tear_payload, valuation_payload, primary_payload = bundle()
        events = confirmed_events()
        option = validate_option_snapshot(option_snapshot(), date.fromisoformat("2026-07-30"))
        reaction = collect_company_earnings_reaction_context(
            "2026-07-30", tear_payload, events, "secret", fetcher=fetcher, option_inputs=[option],
        )
        review = build_company_earnings_driver_review(
            "2026-07-30", tear_payload, valuation_payload, primary_payload, events, reaction,
        )["reviews"][0]
        framework = review["reaction_framework"]
        self.assertEqual(framework["status"], "event_reaction_context_available_not_forecast")
        self.assertEqual(framework["implied_move_status"], "event_hurdle_candidate_not_forecast")
        self.assertFalse(framework["bull_base_bear_generated"])

    def test_validator_blocks_broad_expiry_relabel(self) -> None:
        option = validate_option_snapshot(
            option_snapshot("2026-07-20", "2026-08-07"), date.fromisoformat("2026-07-20"),
        )
        payload = collect_company_earnings_reaction_context(
            "2026-07-20", bundle()[0], confirmed_events(), "", option_inputs=[option],
        )
        tampered = copy.deepcopy(payload)
        tampered["companies"][0]["implied_move_status"] = "event_hurdle_candidate_not_forecast"
        with self.assertRaisesRegex(ValueError, "event-isolating"):
            validate_company_earnings_reaction_context(tampered)

    def test_reaction_sources_are_deduplicated_in_report(self) -> None:
        option = validate_option_snapshot(option_snapshot(), date.fromisoformat("2026-07-30"))
        payload = collect_company_earnings_reaction_context(
            "2026-07-30", bundle()[0], confirmed_events(), "secret",
            fetcher=fetcher, option_inputs=[option],
        )
        rendered = source_section([], {
            "company_earnings_reaction_context": payload,
            "source_quality": {"evidence_posture": "research_grade"},
        })
        self.assertEqual(rendered.count(AV_URL), 1)
        self.assertEqual(rendered.count(OPTION_URL), 1)


if __name__ == "__main__":
    unittest.main()
