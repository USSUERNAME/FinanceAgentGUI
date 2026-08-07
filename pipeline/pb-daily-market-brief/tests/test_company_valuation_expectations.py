from __future__ import annotations

import copy
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from build_company_valuation_expectations import (
    build_company_valuation_expectations,
    validate_company_valuation_expectations,
)
from collect_company_peer_context import (
    collect_company_peer_context,
    load_recent_peer_profiles,
    load_peer_registry,
    normalize_peer_profile,
    plan_peer_requests,
)
from collect_company_market_context import DEFAULT_MAX_CANDIDATES
from collect_company_earnings_events import MAX_PROVIDER_REQUESTS as EARNINGS_CALENDAR_REQUESTS
from collect_company_earnings_reaction_context import MAX_PROVIDER_REQUESTS as EARNINGS_REACTION_REQUESTS
from collect_sector_fundamentals import load_fundamental_registry


def queue() -> dict:
    return {"candidates": [{
        "candidate_id": "semiconductors_ai_compute:US:NVDA",
        "sector_id": "semiconductors_ai_compute",
        "market": "US",
        "ticker": "NVDA",
        "company_name": "NVIDIA",
        "queue_stage": "valuation_expectations_gated",
    }]}


def overview(ticker: str) -> dict:
    values = {
        "AMD": (32.0, 24.0),
        "AVGO": (28.0, 20.0),
    }
    forward_pe, ev_ebitda = values[ticker]
    return {
        "Symbol": ticker,
        "Exchange": "NASDAQ",
        "Currency": "USD",
        "MarketCapitalization": "100000000000",
        "Sector": "TECHNOLOGY",
        "Industry": "SEMICONDUCTORS",
        "ForwardPE": str(forward_pe),
        "EVToEBITDA": str(ev_ebitda),
        "PriceToSalesRatioTTM": "10.0",
    }


def normalize_cache_profile(ticker: str) -> dict:
    peer = {
        "ticker": ticker,
        "company_name": ticker,
        "role": "core_peer",
        "rationale": "Cached peer test",
    }
    profile = normalize_peer_profile(
        peer,
        overview("AMD" if ticker not in {"AMD", "AVGO"} else ticker),
        "2026-07-20T00:00:00+00:00",
    )
    profile["ticker"] = ticker
    profile["cache"] = {
        "status": "reused_recent_profile",
        "source_report_date": "2026-07-20",
        "age_calendar_days": 1,
        "max_age_calendar_days": 3,
    }
    profile["source"]["freshness_status"] = "cached_previous_profile"
    return profile


def market_context() -> dict:
    return {"contexts": [{
        "candidate_id": "semiconductors_ai_compute:US:NVDA",
        "sector_id": "semiconductors_ai_compute",
        "market": "US",
        "ticker": "NVDA",
        "company_name": "NVIDIA",
        "market_data": {"price": 190.5, "price_as_of": "2026-07-17", "currency": "USD"},
        "valuation_context": {
            "forward_pe": 45.0,
            "ev_to_ebitda": 35.0,
            "price_to_sales_ttm": 22.0,
        },
        "expectations_context": {"score": 72.0, "as_of": "2026-07-20", "source_provider": "Alpha Vantage"},
    }]}


def fundamentals() -> dict:
    return {"estimate_observations": [{
        "sector_id": "semiconductors_ai_compute",
        "market": "US",
        "ticker": "NVDA",
        "as_of": "2026-07-20",
        "source_provider": "Alpha Vantage",
        "rows": [{
            "horizon": "fiscal quarter",
            "fiscal_period_end": "2026-10-31",
            "eps_estimate_average": 1.25,
            "eps_estimate_average_30_days_ago": 1.20,
            "revision_pct": 4.1667,
            "revision_up_30d": 18,
            "revision_down_30d": 2,
            "eps_estimate_analyst_count": 40,
            "revenue_estimate_average": 50000000000,
            "revenue_estimate_analyst_count": 38,
            "score": 76.0,
        }],
    }]}


class CompanyValuationExpectationsTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.registry = load_peer_registry()

    def test_registry_plans_two_usable_peers_and_excludes_supply_chain_context(self) -> None:
        requests, target_sets, skipped = plan_peer_requests(queue(), self.registry, 4)
        self.assertEqual([row["ticker"] for row in requests], ["AMD", "AVGO"])
        self.assertEqual(target_sets[0]["planning_status"], "planned")
        self.assertEqual(target_sets[0]["excluded_or_context_only_peers"][0]["ticker"], "TSM")
        self.assertEqual(skipped, [])

    def test_peer_collection_is_bounded_and_preserves_manual_role(self) -> None:
        sleeps = []
        payload = collect_company_peer_context(
            "2026-07-20", queue(), self.registry, "secret",
            fetcher=lambda function, ticker, key: overview(ticker),
            sleeper=sleeps.append, delay_seconds=13, max_requests=2,
        )
        self.assertEqual(payload["request_count"], 2)
        self.assertEqual(sleeps, [13])
        self.assertEqual(payload["peer_profiles"][0]["selection_evidence_label"], "analyst_assumption_needs_review")
        self.assertNotIn("secret", str(payload))

    def test_missing_key_is_nonfatal(self) -> None:
        payload = collect_company_peer_context("2026-07-20", queue(), self.registry, "")
        self.assertEqual(payload["collection_status"], "missing_alpha_vantage_api_key")
        self.assertEqual(payload["request_count"], 0)

    def test_recent_peer_cache_preserves_provider_budget_for_missing_peers(self) -> None:
        cached = normalize_cache_profile("AMD")
        calls = []
        payload = collect_company_peer_context(
            "2026-07-21",
            queue(),
            self.registry,
            "secret",
            fetcher=lambda *args: calls.append(args) or {"Note": "rate limit"},
            max_requests=2,
            cached_profiles={"AMD": cached},
        )
        self.assertEqual(payload["collection_status"], "partial")
        self.assertEqual([row["ticker"] for row in payload["peer_profiles"]], ["AMD"])
        self.assertEqual(payload["request_count"], 1)
        self.assertEqual([row[1] for row in calls], ["AVGO"])
        self.assertEqual(payload["errors"][0]["ticker"], "AVGO")
        self.assertEqual(
            payload["peer_profiles"][0]["source"]["freshness_status"],
            "cached_previous_profile",
        )

    def test_cache_loader_rejects_profiles_older_than_three_days(self) -> None:
        with TemporaryDirectory() as directory:
            root = Path(directory)
            for report_date, ticker in (
                ("2026-07-19", "OLD"),
                ("2026-07-20", "AMD"),
            ):
                output = root / report_date / "company_peer_context.json"
                output.parent.mkdir(parents=True)
                output.write_text(
                    json.dumps({"peer_profiles": [normalize_cache_profile(ticker)]}),
                    encoding="utf-8",
                )
            cached = load_recent_peer_profiles("2026-07-23", root)
        self.assertEqual(set(cached), {"AMD"})
        self.assertEqual(cached["AMD"]["cache"]["age_calendar_days"], 3)

    def test_two_peers_create_premium_screen_not_cheap_expensive_conclusion(self) -> None:
        peers = collect_company_peer_context(
            "2026-07-20", queue(), self.registry, "secret",
            fetcher=lambda function, ticker, key: overview(ticker), max_requests=2,
        )
        payload = build_company_valuation_expectations(
            "2026-07-20", market_context(), peers, fundamentals(),
        )
        row = payload["companies"][0]
        screen = row["valuation_screen"]
        self.assertEqual(screen["primary_metric"], "forward_pe")
        self.assertEqual(screen["relative_valuation_status"], "premium_to_watchlist_peer_median")
        self.assertEqual(screen["primary_premium_discount_pct"], 50.0)
        self.assertEqual(screen["selected_valuation_range_status"], "not_supported")
        self.assertEqual(row["priced_in_status"], "not_established")

    def test_current_price_and_annual_eps_create_labeled_screening_forward_pe(self) -> None:
        peers = collect_company_peer_context(
            "2026-07-20",
            queue(),
            self.registry,
            "secret",
            fetcher=lambda function, ticker, key: overview(ticker),
            max_requests=2,
        )
        without_provider_multiple = copy.deepcopy(market_context())
        without_provider_multiple["contexts"][0]["valuation_context"]["forward_pe"] = None
        annual = fundamentals()
        annual["estimate_observations"][0]["rows"][0]["horizon"] = "fiscal year"
        payload = build_company_valuation_expectations(
            "2026-07-20",
            without_provider_multiple,
            peers,
            annual,
        )
        row = payload["companies"][0]
        self.assertEqual(row["derived_valuation"]["evidence_label"], "derived_screening_calculation")
        self.assertEqual(row["derived_valuation"]["value"], 152.4)
        self.assertEqual(row["valuation_screen"]["primary_metric"], "forward_pe")
        self.assertEqual(
            row["valuation_screen"]["relative_valuation_status"],
            "premium_to_watchlist_peer_median",
        )

    def test_estimate_rows_are_labeled_third_party_not_full_consensus(self) -> None:
        peers = collect_company_peer_context(
            "2026-07-20", queue(), self.registry, "secret",
            fetcher=lambda function, ticker, key: overview(ticker), max_requests=2,
        )
        payload = build_company_valuation_expectations(
            "2026-07-20", market_context(), peers, fundamentals(),
        )
        bar = payload["companies"][0]["expectations_bar"]
        self.assertEqual(bar["revision_direction"], "positive_revision")
        self.assertEqual(bar["evidence_label"], "third_party_forward_estimate")
        self.assertEqual(bar["company_guidance_comparison_status"], "not_collected")

    def test_fewer_than_two_peers_keeps_valuation_insufficient(self) -> None:
        peers = collect_company_peer_context(
            "2026-07-20", queue(), self.registry, "secret",
            fetcher=lambda function, ticker, key: overview(ticker), max_requests=1,
        )
        payload = build_company_valuation_expectations(
            "2026-07-20", market_context(), peers, fundamentals(),
        )
        screen = payload["companies"][0]["valuation_screen"]
        self.assertEqual(screen["relative_valuation_status"], "insufficient_usable_peers")
        self.assertIsNone(screen["primary_metric"])

    def test_validator_rejects_priced_in_claim(self) -> None:
        peers = collect_company_peer_context(
            "2026-07-20", queue(), self.registry, "secret",
            fetcher=lambda function, ticker, key: overview(ticker), max_requests=2,
        )
        payload = build_company_valuation_expectations(
            "2026-07-20", market_context(), peers, fundamentals(),
        )
        tampered = copy.deepcopy(payload)
        tampered["companies"][0]["priced_in_status"] = "established"
        with self.assertRaisesRegex(ValueError, "cannot establish"):
            validate_company_valuation_expectations(tampered)

    def test_production_provider_budget_stays_below_standard_daily_allowance(self) -> None:
        fundamentals_registry = load_fundamental_registry()
        estimate_calls = (
            len(fundamentals_registry["focus_sector_ids"])
            * int(fundamentals_registry["earnings_revisions"]["max_companies_per_sector"])
        )
        target_calls = DEFAULT_MAX_CANDIDATES * 2
        peer_calls = int(self.registry["maximum_provider_peer_requests"])
        total_calls = (
            estimate_calls + target_calls + peer_calls
            + EARNINGS_CALENDAR_REQUESTS + EARNINGS_REACTION_REQUESTS
        )
        self.assertEqual(total_calls, 25)
        self.assertLessEqual(total_calls, 25)


if __name__ == "__main__":
    unittest.main()
