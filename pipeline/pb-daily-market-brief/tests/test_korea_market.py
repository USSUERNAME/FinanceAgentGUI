from __future__ import annotations

import unittest
from datetime import date

from collect_korea_market import (
    build_korea_market,
    collect_krx_index,
    collect_usdkrw,
    validate_krx_input,
)


def official_input() -> dict:
    return {
        "schema_version": "krx_official_market_input.v1",
        "report_date": "2026-07-23",
        "source_provider": "Korea Exchange",
        "source_url": "https://openapi.krx.co.kr/",
        "source_grade": "A",
        "primary_source_confirmed": True,
        "metrics": {
            "kospi": {
                "value": 2800.5,
                "unit": "index points",
                "as_of": "2026-07-23",
                "change_1d_pct": 0.7,
                "change_5d_pct": 1.2,
            },
            "kosdaq": {
                "value": 850.2,
                "unit": "index points",
                "as_of": "2026-07-23",
                "change_1d_pct": -0.2,
                "change_5d_pct": 0.4,
            },
        },
    }


class KoreaMarketContractTests(unittest.TestCase):
    @staticmethod
    def krx_response(market: str, bas_dd: str = "20260723") -> dict:
        return {
            "OutBlock_1": [
                {
                    "BAS_DD": bas_dd,
                    "IDX_NM": "코스피" if market == "kospi" else "코스닥",
                    "CLSPRC_IDX": "2,800.50" if market == "kospi" else "850.20",
                    "FLUC_RT": "0.70" if market == "kospi" else "-0.20",
                }
            ]
        }

    def test_krx_index_parser_uses_exact_main_index_row(self) -> None:
        closes = {
            "20260723": ("2,800.50", "0.70"),
            "20260722": ("2,790.00", "0.20"),
            "20260721": ("2,780.00", "0.10"),
            "20260720": ("2,770.00", "-0.10"),
            "20260717": ("2,760.00", "0.30"),
            "20260716": ("2,750.00", "0.40"),
        }

        def fetcher(_url: str, _key: str, bas_dd: str) -> dict:
            if bas_dd not in closes:
                return {"OutBlock_1": []}
            close, change = closes[bas_dd]
            return {
                "OutBlock_1": [{
                    "BAS_DD": bas_dd,
                    "IDX_NM": "코스피",
                    "CLSPRC_IDX": close,
                    "FLUC_RT": change,
                }]
            }

        metric = collect_krx_index(
            "2026-07-23",
            "kospi",
            "secret-key",
            fetcher=fetcher,
        )
        self.assertEqual(metric["status"], "available")
        self.assertEqual(metric["value"], 2800.5)
        self.assertEqual(metric["change_1d_pct"], 0.7)
        self.assertEqual(metric["as_of"], "2026-07-23")
        self.assertEqual(metric["change_5d_pct"], 1.8364)
        self.assertEqual(metric["change_5d_base_as_of"], "2026-07-16")
        self.assertEqual(metric["history_observation_count"], 6)
        self.assertEqual(metric["source_provider"], "Korea Exchange")

    def test_krx_index_requires_an_exact_main_index_name(self) -> None:
        metric = collect_krx_index(
            "2026-07-23",
            "kospi",
            "secret-key",
            fetcher=lambda _url, _key, _date: {
                "OutBlock_1": [{
                    "BAS_DD": "20260723",
                    "IDX_NM": "코스피 200",
                    "CLSPRC_IDX": "400.00",
                    "FLUC_RT": "0.10",
                }]
            },
        )
        self.assertEqual(metric["status"], "main_index_not_found")

    def test_krx_index_backscan_skips_non_trading_days(self) -> None:
        requested: list[str] = []

        def fetcher(_url: str, _key: str, bas_dd: str) -> dict:
            requested.append(bas_dd)
            if bas_dd == "20260720":
                return self.krx_response("kosdaq", bas_dd)
            return {"OutBlock_1": []}

        metric = collect_krx_index(
            "2026-07-21",
            "kosdaq",
            "secret-key",
            fetcher=fetcher,
        )
        self.assertEqual(metric["status"], "available")
        self.assertEqual(metric["as_of"], "2026-07-20")
        self.assertEqual(requested[:2], ["20260721", "20260720"])
        self.assertEqual(len(requested), 16)
        self.assertIsNone(metric["change_5d_pct"])
        self.assertEqual(
            metric["change_5d_status"],
            "insufficient_recent_trading_observations",
        )

    def test_krx_provider_error_does_not_expose_secret_or_response(self) -> None:
        secret = "do-not-log-this"

        def failing_fetcher(_url: str, _key: str, _date: str) -> dict:
            raise RuntimeError(f"remote body accidentally contained {secret}")

        metric = collect_krx_index(
            "2026-07-23",
            "kospi",
            secret,
            fetcher=failing_fetcher,
        )
        rendered = str(metric)
        self.assertEqual(metric["status"], "provider_or_authorization_error")
        self.assertEqual(metric["error_type"], "RuntimeError")
        self.assertNotIn(secret, rendered)
        self.assertNotIn("remote body", rendered)

    def test_usdkrw_uses_only_observations_available_by_report_date(self) -> None:
        values = [
            (date(2026, 7, 16), 1370.0),
            (date(2026, 7, 17), 1372.0),
            (date(2026, 7, 20), 1375.0),
            (date(2026, 7, 21), 1380.0),
            (date(2026, 7, 22), 1378.0),
            (date(2026, 7, 23), 1382.0),
            (date(2026, 7, 24), 1400.0),
        ]
        metric = collect_usdkrw(
            "2026-07-23",
            "test-key",
            fetcher=lambda _series, _key, _start: values,
        )
        self.assertEqual(metric["status"], "available")
        self.assertEqual(metric["value"], 1382.0)
        self.assertEqual(metric["as_of"], "2026-07-23")
        self.assertEqual(metric["change_1d_pct"], 0.2903)
        self.assertEqual(metric["change_5d_pct"], 0.8759)
        self.assertEqual(metric["source_grade"], "A")

    def test_missing_fred_key_is_explicit(self) -> None:
        metric = collect_usdkrw("2026-07-23", "")
        self.assertEqual(metric["status"], "missing_fred_api_key")
        self.assertIsNone(metric["value"])

    def test_stale_usdkrw_is_not_treated_as_current(self) -> None:
        metric = collect_usdkrw(
            "2026-07-23",
            "test-key",
            fetcher=lambda _series, _key, _start: [
                (date(2026, 7, 16), 1370.0),
                (date(2026, 7, 17), 1372.0),
            ],
        )
        self.assertEqual(metric["status"], "stale")
        self.assertEqual(metric["age_days"], 6)

    def test_official_krx_input_requires_primary_lineage(self) -> None:
        payload = official_input()
        validate_krx_input(payload, "2026-07-23")
        payload["source_url"] = "https://example.com/kospi"
        with self.assertRaisesRegex(ValueError, "official KRX URL"):
            validate_krx_input(payload, "2026-07-23")

    def test_korea_contract_keeps_unavailable_flows_null(self) -> None:
        values = [
            (date(2026, 7, 21), 1380.0),
            (date(2026, 7, 22), 1378.0),
            (date(2026, 7, 23), 1382.0),
        ]
        payload = build_korea_market(
            "2026-07-23",
            "test-key",
            official_krx_input=official_input(),
            fred_fetcher=lambda _series, _key, _start: values,
        )
        self.assertEqual(payload["collection_status"], "partial")
        self.assertEqual(payload["metrics"]["kospi"]["status"], "available")
        self.assertEqual(payload["metrics"]["kosdaq"]["status"], "available")
        self.assertEqual(
            payload["metrics"]["foreign_kospi_cash_net_buy_krw"]["status"],
            "not_supplied_by_verified_input",
        )
        self.assertEqual(
            payload["transmission_gate"]["status"],
            "partial_price_transmission_no_verified_flows",
        )

    def test_krx_indices_are_fetched_when_key_is_present(self) -> None:
        values = [
            (date(2026, 7, 22), 1378.0),
            (date(2026, 7, 23), 1382.0),
        ]

        def krx_fetcher(url: str, _key: str, _date: str) -> dict:
            market = "kospi" if "kospi_" in url else "kosdaq"
            return self.krx_response(market)

        payload = build_korea_market(
            "2026-07-23",
            "test-key",
            krx_auth_key="krx-key",
            fred_fetcher=lambda _series, _key, _start: values,
            krx_fetcher=krx_fetcher,
        )
        self.assertEqual(payload["metrics"]["kospi"]["status"], "available")
        self.assertEqual(payload["metrics"]["kosdaq"]["status"], "available")
        self.assertEqual(
            payload["metrics"]["foreign_kospi_cash_net_buy_krw"]["status"],
            "not_available_in_connected_krx_index_services",
        )
        self.assertEqual(
            payload["transmission_gate"]["status"],
            "partial_price_transmission_no_verified_flows",
        )

    def test_verified_input_overrides_krx_api(self) -> None:
        calls: list[str] = []
        payload = build_korea_market(
            "2026-07-23",
            "test-key",
            official_krx_input=official_input(),
            krx_auth_key="krx-key",
            fred_fetcher=lambda _series, _key, _start: [
                (date(2026, 7, 22), 1378.0),
                (date(2026, 7, 23), 1382.0),
            ],
            krx_fetcher=lambda url, _key, _date: calls.append(url) or {},
        )
        self.assertEqual(payload["metrics"]["kospi"]["value"], 2800.5)
        self.assertEqual(payload["metrics"]["kosdaq"]["value"], 850.2)
        self.assertEqual(calls, [])

    def test_without_krx_authorization_transmission_remains_blocked(self) -> None:
        values = [
            (date(2026, 7, 22), 1378.0),
            (date(2026, 7, 23), 1382.0),
        ]
        payload = build_korea_market(
            "2026-07-23",
            "test-key",
            fred_fetcher=lambda _series, _key, _start: values,
        )
        self.assertEqual(
            payload["metrics"]["kospi"]["status"],
            "missing_krx_open_api_authorization",
        )
        self.assertEqual(
            payload["transmission_gate"]["status"],
            "insufficient_verified_korea_data",
        )
        self.assertIn("kospi", payload["transmission_gate"]["missing_metrics"])


if __name__ == "__main__":
    unittest.main()
