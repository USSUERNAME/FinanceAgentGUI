from __future__ import annotations

import json
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import TestCase
from unittest.mock import patch
from urllib.error import HTTPError

from generate_macro_chart import (
    FRED_OBSERVATION_CACHE_SCHEMA,
    observations,
)


class FredObservationFallbackTests(TestCase):
    def test_successful_request_writes_reusable_cache(self) -> None:
        payload = {
            "observations": [
                {"date": "2026-07-28", "value": "4.32"},
                {"date": "2026-07-29", "value": "4.28"},
            ]
        }
        with TemporaryDirectory() as temporary:
            cache_dir = Path(temporary)
            with patch("generate_macro_chart.get_json", return_value=payload):
                rows = observations(
                    "DGS10",
                    "test-key",
                    "2026-07-01",
                    attempts=1,
                    retry_delay_seconds=0,
                    cache_dir=cache_dir,
                )

            self.assertEqual(len(rows), 2)
            cached = json.loads(
                (cache_dir / "DGS10.json").read_text(encoding="utf-8")
            )
            self.assertEqual(
                cached["schema_version"],
                FRED_OBSERVATION_CACHE_SCHEMA,
            )
            self.assertEqual(cached["series_id"], "DGS10")

    def test_transient_http_failure_uses_cached_observations(self) -> None:
        with TemporaryDirectory() as temporary:
            cache_dir = Path(temporary)
            cache_dir.joinpath("DGS10.json").write_text(
                json.dumps(
                    {
                        "schema_version": FRED_OBSERVATION_CACHE_SCHEMA,
                        "series_id": "DGS10",
                        "fetched_at": "2026-07-29T23:00:00+00:00",
                        "observations": [
                            {"date": "2026-07-28", "value": 4.32},
                            {"date": "2026-07-29", "value": 4.28},
                        ],
                    }
                ),
                encoding="utf-8",
            )
            failure = HTTPError(
                "https://api.stlouisfed.org",
                502,
                "Bad Gateway",
                hdrs=None,
                fp=None,
            )
            with patch("generate_macro_chart.get_json", side_effect=failure):
                rows = observations(
                    "DGS10",
                    "test-key",
                    "2026-07-01",
                    attempts=2,
                    retry_delay_seconds=0,
                    cache_dir=cache_dir,
                )

            self.assertEqual([value for _, value in rows], [4.32, 4.28])

    def test_transient_http_failure_without_cache_remains_visible(self) -> None:
        with TemporaryDirectory() as temporary:
            failure = HTTPError(
                "https://api.stlouisfed.org",
                502,
                "Bad Gateway",
                hdrs=None,
                fp=None,
            )
            with patch("generate_macro_chart.get_json", side_effect=failure):
                with self.assertRaises(HTTPError):
                    observations(
                        "DGS10",
                        "test-key",
                        "2026-07-01",
                        attempts=1,
                        retry_delay_seconds=0,
                        cache_dir=Path(temporary),
                    )
