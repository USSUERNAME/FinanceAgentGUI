from __future__ import annotations

import copy
import unittest

from build_us_equity_universe import (
    build_us_equity_universe,
    validate_membership_input,
)


def targets() -> dict:
    return {
        "targets": [
            {"ticker": "NVDA", "name": "NVIDIA", "cik": "0001045810"},
            {"ticker": "MSFT", "name": "Microsoft", "cik": "0000789019"},
        ]
    }


def master() -> dict:
    return {
        "sectors": [{
            "sector_id": "semiconductors_ai_compute",
            "representative_companies": [
                {
                    "market": "US",
                    "ticker": "NVDA",
                    "name": "NVIDIA",
                    "instrument_type": "EQUITY",
                },
                {
                    "market": "KR",
                    "ticker": "005930",
                    "name": "Samsung Electronics",
                    "instrument_type": "EQUITY",
                },
            ],
        }]
    }


def membership_input(sp_count: int = 2, nasdaq_count: int = 2) -> dict:
    sources = [
        {
            "source_id": "sp-source",
            "universe_id": "sp500",
            "membership_scope": "fund_holdings_proxy",
            "provider": "Official sponsor",
            "source_url": "https://provider.example/sp500",
            "source_grade": "A",
            "primary_source_confirmed": True,
            "as_of": "2026-07-22",
            "expected_refresh_days": 7,
            "rights_label": "user_supplied_authorized",
        },
        {
            "source_id": "ndx-source",
            "universe_id": "nasdaq100",
            "membership_scope": "index_constituents",
            "provider": "Licensed index source",
            "source_url": "https://provider.example/nasdaq100",
            "source_grade": "A",
            "primary_source_confirmed": True,
            "as_of": "2026-07-22",
            "expected_refresh_days": 7,
            "rights_label": "licensed_internal_use",
        },
    ]
    members = []
    for index in range(sp_count):
        members.append({
            "ticker": f"S{index:03}",
            "company_name": f"S&P Company {index}",
            "source_ids": ["sp-source"],
        })
    for index in range(nasdaq_count):
        ticker = f"N{index:03}"
        members.append({
            "ticker": ticker,
            "company_name": f"Nasdaq Company {index}",
            "source_ids": ["ndx-source"],
        })
    return {
        "schema_version": "us_index_membership_input.v1",
        "report_date": "2026-07-23",
        "sources": sources,
        "members": members,
    }


def sec_record(ticker: str = "TSLA") -> dict:
    return {
        "id": "sec-tsla-8k",
        "source_id": "sec_edgar",
        "source_grade": "A",
        "primary_source_confirmed": True,
        "tickers": [ticker],
        "url": "https://www.sec.gov/Archives/example",
    }


class UsEquityUniverseTests(unittest.TestCase):
    def test_without_index_input_keeps_watchlist_sector_and_sec_candidates(self) -> None:
        payload = build_us_equity_universe(
            "2026-07-23",
            targets(),
            master(),
            [sec_record()],
        )
        by_ticker = {row["ticker"]: row for row in payload["securities"]}
        self.assertEqual(payload["collection_status"], "partial")
        self.assertFalse(payload["full_index_scan_ready"])
        self.assertEqual(set(by_ticker), {"MSFT", "NVDA", "TSLA"})
        self.assertEqual(
            by_ticker["NVDA"]["selection_reasons"],
            ["configured_watchlist", "sector_representative"],
        )
        self.assertEqual(by_ticker["TSLA"]["selection_reasons"], ["current_sec_filing"])

    def test_non_primary_sec_metadata_does_not_enter_event_universe(self) -> None:
        record = sec_record()
        record["primary_source_confirmed"] = False
        payload = build_us_equity_universe(
            "2026-07-23",
            {"targets": []},
            {"sectors": []},
            [record],
        )
        self.assertEqual(payload["security_count"], 0)
        self.assertEqual(payload["collection_status"], "blocked")

    def test_membership_and_internal_reasons_merge_without_duplicate_security(self) -> None:
        payload_input = membership_input()
        payload_input["members"].append({
            "ticker": "NVDA",
            "company_name": "NVIDIA Corporation",
            "source_ids": ["sp-source", "ndx-source"],
        })
        payload = build_us_equity_universe(
            "2026-07-23",
            targets(),
            master(),
            [sec_record("NVDA")],
            payload_input,
        )
        nvda = next(row for row in payload["securities"] if row["ticker"] == "NVDA")
        self.assertEqual(nvda["index_memberships"], ["nasdaq100", "sp500"])
        self.assertEqual(
            nvda["selection_reasons"],
            [
                "configured_watchlist",
                "current_sec_filing",
                "sector_representative",
                "verified_index_membership",
            ],
        )
        self.assertEqual(
            len([row for row in payload["securities"] if row["ticker"] == "NVDA"]),
            1,
        )

    def test_full_scan_requires_both_current_memberships_and_minimum_counts(self) -> None:
        payload = build_us_equity_universe(
            "2026-07-23",
            {"targets": []},
            {"sectors": []},
            [],
            membership_input(sp_count=450, nasdaq_count=90),
        )
        self.assertTrue(payload["full_index_scan_ready"])
        self.assertEqual(payload["collection_status"], "complete")
        self.assertEqual(payload["membership_counts"], {"nasdaq100": 90, "sp500": 450})

    def test_stale_membership_cannot_make_full_scan_ready(self) -> None:
        source = membership_input(sp_count=450, nasdaq_count=90)
        source["sources"][0]["as_of"] = "2026-07-01"
        source["sources"][1]["as_of"] = "2026-07-01"
        payload = build_us_equity_universe(
            "2026-07-23",
            {"targets": []},
            {"sectors": []},
            [],
            source,
        )
        self.assertFalse(payload["full_index_scan_ready"])
        self.assertTrue(all(
            row["freshness_status"] == "stale"
            for row in payload["membership_sources"]
        ))

    def test_membership_validator_rejects_unapproved_rights_label(self) -> None:
        payload = membership_input()
        payload["sources"][0]["rights_label"] = "unknown"
        with self.assertRaisesRegex(ValueError, "automation-rights"):
            validate_membership_input(payload, "2026-07-23")

    def test_membership_validator_rejects_unresolved_source(self) -> None:
        payload = membership_input()
        tampered = copy.deepcopy(payload)
        tampered["members"][0]["source_ids"] = ["missing-source"]
        with self.assertRaisesRegex(ValueError, "unresolved source_id"):
            validate_membership_input(tampered, "2026-07-23")


if __name__ == "__main__":
    unittest.main()
