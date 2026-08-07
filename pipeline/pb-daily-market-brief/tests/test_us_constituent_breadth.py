from __future__ import annotations

import unittest
from datetime import date, timedelta

from build_us_constituent_breadth import (
    MINIMUM_SP500_MEMBERS,
    build_constituent_breadth,
    collect_constituent_breadth,
)
from collect_sector_spdr_holdings import SCHEMA_VERSION as SECTOR_HOLDINGS_SCHEMA
from us_market_panel import SECTOR_ETFS


def universe(member_count: int = MINIMUM_SP500_MEMBERS) -> dict:
    return {
        "report_date": "2026-07-27",
        "securities": [
            {
                "ticker": f"T{index:03d}",
                "index_memberships": ["sp500"],
                "membership_scopes": ["fund_holdings_proxy"],
            }
            for index in range(member_count)
        ],
    }


def history(rising: bool) -> list[dict]:
    start = date(2025, 11, 10)
    return [
        {
            "date": start + timedelta(days=index),
            "close": (
                100 + index * 0.1
                if rising else
                200 - index * 0.1
            ),
            "volume": 1000 + index,
        }
        for index in range(260)
    ]


def sector_membership() -> dict:
    return {
        "schema_version": SECTOR_HOLDINGS_SCHEMA,
        "report_date": "2026-07-27",
        "collection_status": "ready",
        "sectors": [
            {
                "sector_ticker": ticker,
                "membership_scope": "select_sector_fund_holdings_proxy",
                "as_of": "2026-07-23",
                "members": [
                    {"ticker": f"T{index:03d}"}
                    for index in range(30)
                ],
            }
            for ticker in SECTOR_ETFS
        ],
    }


class UsConstituentBreadthTests(unittest.TestCase):
    def test_builds_true_advance_decline_and_moving_average_breadth(self) -> None:
        series = {
            f"T{index:03d}": history(index < 300)
            for index in range(MINIMUM_SP500_MEMBERS)
        }
        payload = build_constituent_breadth(
            "2026-07-27",
            universe(),
            series,
        )
        self.assertEqual(payload["collection_status"], "ready")
        self.assertEqual(payload["coverage"]["daily_price_pct"], 100.0)
        advance_decline = payload["breadth"]["advance_decline"]
        self.assertEqual(advance_decline["advances"], 300)
        self.assertEqual(advance_decline["declines"], 150)
        self.assertEqual(advance_decline["advance_pct"], 66.67)
        self.assertEqual(
            payload["breadth"]["moving_averages"]["50d"]["above_pct"],
            66.67,
        )
        self.assertEqual(
            payload["breadth"]["highs_lows_52w"]["net_new_highs"],
            150,
        )

    def test_builds_eleven_sector_internal_breadth_rows(self) -> None:
        series = {
            f"T{index:03d}": history(index < 20)
            for index in range(MINIMUM_SP500_MEMBERS)
        }
        payload = build_constituent_breadth(
            "2026-07-27",
            universe(),
            series,
            sector_membership=sector_membership(),
        )
        sector_breadth = payload["sector_breadth"]
        self.assertEqual(sector_breadth["collection_status"], "ready")
        self.assertEqual(len(sector_breadth["sectors"]), len(SECTOR_ETFS))
        first = sector_breadth["sectors"][0]
        self.assertEqual(first["coverage"]["daily_price_pct"], 100.0)
        self.assertEqual(first["breadth"]["advance_decline"]["advance_pct"], 66.67)
        self.assertEqual(
            first["breadth"]["moving_averages"]["50d"]["above_pct"],
            66.67,
        )

    def test_collection_uses_one_bounded_multi_symbol_request(self) -> None:
        calls = []

        def fetcher(
            tickers: list[str],
            api_key_id: str,
            secret_key: str,
            report_date: str,
            *,
            feed: str,
            lookback_days: int,
            max_bars: int,
            adjustment: str,
        ) -> dict[str, list[dict]]:
            calls.append((
                len(tickers),
                api_key_id,
                secret_key,
                report_date,
                feed,
                lookback_days,
                max_bars,
                adjustment,
            ))
            return {ticker: history(True) for ticker in tickers}

        payload = collect_constituent_breadth(
            "2026-07-27",
            universe(),
            "key-id",
            "secret",
            fetcher=fetcher,
        )
        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0][0], MINIMUM_SP500_MEMBERS)
        self.assertEqual(calls[0][-3:], (400, 260, "split"))
        self.assertEqual(payload["collection_status"], "ready")

    def test_missing_credentials_fail_closed(self) -> None:
        payload = collect_constituent_breadth(
            "2026-07-27",
            universe(),
            "",
            "",
        )
        self.assertEqual(payload["collection_status"], "blocked")
        self.assertEqual(payload["breadth"], {})


if __name__ == "__main__":
    unittest.main()
