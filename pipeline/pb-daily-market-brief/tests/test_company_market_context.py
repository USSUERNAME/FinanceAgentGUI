from __future__ import annotations

import copy
import unittest
from datetime import date

from collect_company_market_context import (
    ALPACA_MARKET_DATA_DOCS_URL,
    ALPHA_VANTAGE_DOCS_URL,
    collect_company_market_context,
    validate_company_market_context,
)
from compose_daily_brief import source_section


def candidate(market: str = "US", ticker: str = "NVDA") -> dict:
    return {
        "candidate_id": f"semiconductors_ai_compute:{market}:{ticker}",
        "sector_id": "semiconductors_ai_compute",
        "market": market,
        "ticker": ticker,
        "company_name": "NVIDIA" if ticker == "NVDA" else "Samsung Electronics",
        "queue_stage": "valuation_expectations_gated",
        "estimate_signal": {
            "score": 72.0,
            "as_of": "2026-07-20",
            "source_provider": "Alpha Vantage",
        },
    }


def queue(*rows: dict) -> dict:
    return {"schema_version": "company_research_queue.v1", "candidates": list(rows)}


def fallback_market(ticker: str = "NVDA") -> dict:
    return {
        "schema_version": "us_equity_candidate_screen.v1",
        "candidates": [{
            "ticker": ticker,
            "market_reaction": {
                "close": 197.05,
                "return_1d_pct": -1.5,
                "volume": 5_832_667,
            },
            "market_source": {"as_of": "2026-07-28"},
        }],
    }


def fake_fetcher(function: str, ticker: str, api_key: str) -> dict:
    assert ticker == "NVDA"
    assert api_key == "secret"
    if function == "GLOBAL_QUOTE":
        return {"Global Quote": {
            "01. symbol": "NVDA",
            "05. price": "190.50",
            "06. volume": "12345678",
            "07. latest trading day": "2026-07-17",
            "08. previous close": "188.00",
            "10. change percent": "1.3298%",
        }}
    return {
        "Symbol": "NVDA",
        "Exchange": "NASDAQ",
        "Currency": "USD",
        "Sector": "TECHNOLOGY",
        "Industry": "SEMICONDUCTORS",
        "MarketCapitalization": "4650000000000",
        "TrailingPE": "45.1",
        "ForwardPE": "31.2",
        "PriceToSalesRatioTTM": "24.2",
        "PriceToBookRatio": "39.0",
        "EVToRevenue": "23.8",
        "EVToEBITDA": "40.2",
    }


class CompanyMarketContextTests(unittest.TestCase):
    def test_no_eligible_candidates_is_nonfatal_and_makes_no_calls(self) -> None:
        calls = []
        payload = collect_company_market_context(
            "2026-07-20", queue(), "secret",
            fetcher=lambda *args: calls.append(args) or {},
        )
        self.assertEqual(payload["collection_status"], "no_eligible_candidates")
        self.assertEqual(payload["request_count"], 0)
        self.assertEqual(calls, [])

    def test_missing_key_is_explicit_and_nonfatal(self) -> None:
        payload = collect_company_market_context("2026-07-20", queue(candidate()), "")
        self.assertEqual(payload["collection_status"], "missing_alpha_vantage_api_key")
        self.assertEqual(payload["eligible_candidate_count"], 1)
        self.assertEqual(payload["contexts"], [])

    def test_missing_key_reuses_bounded_alpaca_candidate_price(self) -> None:
        payload = collect_company_market_context(
            "2026-07-29",
            queue(candidate()),
            "",
            fallback_market=fallback_market(),
        )
        self.assertEqual(payload["collection_status"], "fallback_available")
        self.assertEqual(payload["collected_candidate_count"], 1)
        row = payload["contexts"][0]
        self.assertEqual(row["market_data"]["price"], 197.05)
        self.assertEqual(row["market_data"]["price_as_of"], "2026-07-28")
        self.assertEqual(row["valuation_context"]["multiple_count"], 0)
        self.assertEqual(row["source"]["source_url"], ALPACA_MARKET_DATA_DOCS_URL)
        self.assertEqual(row["context_status"], "partial_unbenchmarked")

    def test_provider_failure_falls_back_without_inventing_multiples(self) -> None:
        payload = collect_company_market_context(
            "2026-07-29",
            queue(candidate()),
            "secret",
            fallback_market=fallback_market(),
            fetcher=lambda *args: {"Note": "rate limit"},
        )
        self.assertEqual(payload["collection_status"], "partial")
        self.assertEqual(payload["request_count"], 1)
        self.assertEqual(payload["errors"][0]["recovered_by"], "alpaca_candidate_screen_fallback")
        row = payload["contexts"][0]
        self.assertIsNone(row["valuation_context"]["forward_pe"])
        self.assertEqual(row["expectations_context"]["score"], 72.0)

    def test_missing_candidate_screen_price_uses_direct_alpaca_batch(self) -> None:
        calls = []

        def alpaca_fetcher(tickers, key, secret, report_date, **kwargs):
            calls.append((tickers, key, secret, report_date, kwargs))
            return {"NVDA": [
                {"date": date(2026, 7, 17), "close": 188.0, "volume": 10_000_000},
                {"date": date(2026, 7, 18), "close": 190.5, "volume": 12_000_000},
            ]}

        payload = collect_company_market_context(
            "2026-07-20", queue(candidate()), "",
            alpaca_api_key_id="alpaca-key",
            alpaca_secret_key="alpaca-secret",
            alpaca_fetcher=alpaca_fetcher,
        )
        self.assertEqual(payload["collection_status"], "fallback_available")
        self.assertEqual(payload["collected_candidate_count"], 1)
        row = payload["contexts"][0]
        self.assertEqual(row["market_data"]["price"], 190.5)
        self.assertEqual(row["market_data"]["price_as_of"], "2026-07-18")
        self.assertAlmostEqual(row["market_data"]["change_pct"], 1.329787, places=6)
        self.assertEqual(row["source"]["source_url"], ALPACA_MARKET_DATA_DOCS_URL)
        self.assertEqual(calls[0][0], ["NVDA"])
        self.assertEqual(calls[0][4]["adjustment"], "all")

    def test_fourth_candidate_uses_fallback_without_expanding_provider_budget(self) -> None:
        rows = [candidate(ticker=ticker) for ticker in ("NVDA", "AMD", "AVGO", "TTD")]
        fallback = fallback_market("TTD")
        payload = collect_company_market_context(
            "2026-07-29", queue(*rows), "secret",
            fallback_market=fallback,
            fetcher=lambda *args: {"Note": "rate limit"},
            max_candidates=3,
        )
        self.assertEqual(payload["eligible_candidate_count"], 4)
        self.assertEqual(payload["request_count"], 3)
        self.assertEqual([row["ticker"] for row in payload["contexts"]], ["TTD"])

    def test_quote_and_raw_multiples_remain_unbenchmarked(self) -> None:
        sleeps = []
        payload = collect_company_market_context(
            "2026-07-20", queue(candidate()), "secret", fake_fetcher,
            sleeper=sleeps.append, delay_seconds=13,
        )
        row = payload["contexts"][0]
        self.assertEqual(payload["request_count"], 2)
        self.assertEqual(sleeps, [13])
        self.assertEqual(row["market_data"]["price"], 190.5)
        self.assertEqual(row["market_data"]["price_as_of"], "2026-07-17")
        self.assertEqual(row["valuation_context"]["forward_pe"], 31.2)
        self.assertEqual(row["valuation_context"]["relative_valuation_status"], "unbenchmarked")
        self.assertEqual(row["security_readiness"], "market_context_collected_not_decision_grade")
        self.assertEqual(row["source"]["source_url"], ALPHA_VANTAGE_DOCS_URL)
        self.assertNotIn("secret", str(payload))

    def test_provider_none_values_are_not_numeric(self) -> None:
        def fetcher(function: str, ticker: str, api_key: str) -> dict:
            if function == "GLOBAL_QUOTE":
                return {"Global Quote": {
                    "05. price": "10.0", "07. latest trading day": "2026-07-17",
                }}
            return {"Currency": "USD", "PERatio": "None", "ForwardPE": "-"}

        payload = collect_company_market_context(
            "2026-07-20", queue(candidate()), "secret", fetcher,
        )
        row = payload["contexts"][0]
        self.assertEqual(row["context_status"], "partial_unbenchmarked")
        self.assertEqual(row["valuation_context"]["multiple_count"], 0)

    def test_non_us_candidate_is_skipped_without_provider_call(self) -> None:
        calls = []
        payload = collect_company_market_context(
            "2026-07-20", queue(candidate("KR", "005930")), "secret",
            fetcher=lambda *args: calls.append(args) or {},
        )
        self.assertEqual(payload["collection_status"], "no_eligible_candidates")
        self.assertEqual(payload["skipped"][0]["status"], "unsupported_market")
        self.assertEqual(calls, [])

    def test_validator_rejects_unsupported_valuation_classification(self) -> None:
        payload = collect_company_market_context(
            "2026-07-20", queue(candidate()), "secret", fake_fetcher,
        )
        tampered = copy.deepcopy(payload)
        tampered["contexts"][0]["valuation_context"]["relative_valuation_status"] = "cheap"
        with self.assertRaisesRegex(ValueError, "without a benchmark"):
            validate_company_market_context(tampered)

    def test_provider_documentation_is_in_deterministic_source_inventory_once(self) -> None:
        rendered = source_section([], {
            "company_market_context": {"contexts": [{
                "source": {"source_url": ALPHA_VANTAGE_DOCS_URL},
            }]},
            "source_quality": {"evidence_posture": "research_grade"},
        })
        self.assertEqual(rendered.count(ALPHA_VANTAGE_DOCS_URL), 1)


if __name__ == "__main__":
    unittest.main()
