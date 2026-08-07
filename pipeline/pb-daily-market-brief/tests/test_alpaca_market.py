from __future__ import annotations

import unittest
from urllib.parse import parse_qs, urlsplit

from collectors.alpaca_market import fetch_daily_series_batch


class AlpacaMarketTests(unittest.TestCase):
    def test_fetches_multiple_symbols_with_headers_and_pagination(self) -> None:
        calls = []

        def fetcher(url: str, headers: dict[str, str]) -> dict:
            calls.append((url, headers))
            query = parse_qs(urlsplit(url).query)
            if "page_token" not in query:
                return {
                    "bars": {
                        "SPY": [
                            {"t": "2026-07-22T04:00:00Z", "c": 700, "v": 1000},
                        ],
                    },
                    "next_page_token": "next-token",
                }
            return {
                "bars": {
                    "RSP": [
                        {"t": "2026-07-22T04:00:00Z", "c": 190, "v": 500},
                    ],
                },
                "next_page_token": None,
            }

        result = fetch_daily_series_batch(
            ["SPY", "RSP"],
            "key-id",
            "secret",
            "2026-07-23",
            feed="sip",
            fetcher=fetcher,
        )
        self.assertEqual(len(calls), 2)
        first_query = parse_qs(urlsplit(calls[0][0]).query)
        self.assertEqual(first_query["symbols"], ["RSP,SPY"])
        self.assertEqual(first_query["feed"], ["sip"])
        self.assertEqual(first_query["adjustment"], ["raw"])
        self.assertEqual(calls[0][1]["APCA-API-KEY-ID"], "key-id")
        self.assertEqual(calls[0][1]["APCA-API-SECRET-KEY"], "secret")
        self.assertEqual(result["SPY"][0]["close"], 700)
        self.assertEqual(result["RSP"][0]["volume"], 500)

    def test_respects_requested_history_bound(self) -> None:
        def fetcher(url: str, headers: dict[str, str]) -> dict:
            return {
                "bars": {
                    "SPY": [
                        {
                            "t": f"2026-07-{day:02d}T04:00:00Z",
                            "c": 600 + day,
                            "v": 1000 + day,
                        }
                        for day in range(1, 11)
                    ],
                },
            }

        result = fetch_daily_series_batch(
            ["SPY"],
            "key-id",
            "secret",
            "2026-07-23",
            max_bars=5,
            fetcher=fetcher,
        )
        self.assertEqual(len(result["SPY"]), 5)
        self.assertEqual(result["SPY"][0]["close"], 606)

    def test_rejects_unsupported_feed(self) -> None:
        with self.assertRaises(ValueError):
            fetch_daily_series_batch(
                ["SPY"],
                "key-id",
                "secret",
                "2026-07-23",
                feed="unknown",
            )

    def test_rejects_unsupported_adjustment(self) -> None:
        with self.assertRaises(ValueError):
            fetch_daily_series_batch(
                ["SPY"],
                "key-id",
                "secret",
                "2026-07-23",
                adjustment="estimated",
            )


if __name__ == "__main__":
    unittest.main()
