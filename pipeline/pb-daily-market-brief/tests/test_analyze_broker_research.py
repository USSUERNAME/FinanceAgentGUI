from __future__ import annotations

import json
import tempfile
import unittest
from io import BytesIO
from pathlib import Path
from unittest.mock import patch

from analyze_broker_research import (
    analyze_reports_with_cache,
    analysis_schema,
    bounded_reports,
    cached_report_analysis,
    request_analysis,
    validate_analysis,
    write_report_analysis_cache,
)


def record() -> dict:
    return {
        "id": "report-1",
        "source_type": "broker_report",
        "publisher": "Example Securities",
        "title": "Semiconductor outlook",
        "published_at": "2026-07-24T08:00:00+09:00",
        "tickers": ["NVDA"],
        "tags": ["semiconductor"],
        "raw_text": "Authorized internal report text.",
        "research_rights": {
            "analysis_allowed": True,
            "redistribution_allowed": False,
            "publication_policy": "summary_and_link_only",
        },
    }


class FakeResponse:
    def __init__(self, payload: dict):
        self.payload = payload

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def read(self):
        return json.dumps(self.payload).encode("utf-8")


class AnalyzeBrokerResearchTests(unittest.TestCase):
    def structured_report(self, report_id: str = "report-1") -> dict:
        return {
            "report_id": report_id,
            "analyst": "",
            "report_type": "sector",
            "stance": "positive",
            "summary": "수요 전망이 개선됐다.",
            "key_claims": ["수요 추정치가 상향됐다."],
            "catalysts": ["다음 실적 발표"],
            "risks": ["밸류에이션"],
            "sectors": ["semiconductor"],
            "tickers": ["NVDA"],
            "rating": "",
            "previous_rating": "",
            "target_price": None,
            "previous_target_price": None,
            "currency": "",
            "monitoring_conditions": ["후속 실적 확인"],
        }

    def test_bounded_reports_excludes_unauthorized_input(self) -> None:
        unsafe = record()
        unsafe["id"] = "unsafe"
        unsafe["research_rights"]["analysis_allowed"] = False
        rows = bounded_reports([record(), unsafe])
        self.assertEqual([row["report_id"] for row in rows], ["report-1"])

    def test_bounded_reports_can_queue_more_than_one_api_batch(self) -> None:
        records = []
        for index in range(12):
            item = record()
            item["id"] = f"report-{index:02d}"
            item["published_at"] = f"2026-07-{index + 1:02d}T08:00:00+09:00"
            records.append(item)
        rows = bounded_reports(records, max_reports=12)
        self.assertEqual(len(rows), 12)
        self.assertEqual(rows[0]["report_id"], "report-11")

    def test_schema_requires_each_authorized_report_once(self) -> None:
        schema = analysis_schema(["a", "b"])
        reports = schema["properties"]["reports"]
        self.assertEqual(reports["minItems"], 2)
        self.assertEqual(reports["maxItems"], 2)
        self.assertEqual(reports["items"]["properties"]["report_id"]["enum"], ["a", "b"])

    def test_request_uses_strict_responses_schema(self) -> None:
        model_result = {
            "reports": [{
                "report_id": "report-1",
                "analyst": "",
                "report_type": "sector",
                "stance": "positive",
                "summary": "수요 전망이 개선됐다.",
                "key_claims": ["수요 추정치가 상향됐다."],
                "catalysts": ["다음 실적 발표"],
                "risks": ["밸류에이션"],
                "sectors": ["semiconductor"],
                "tickers": ["NVDA"],
                "rating": "",
                "previous_rating": "",
                "target_price": None,
                "previous_target_price": None,
                "currency": "",
                "monitoring_conditions": ["후속 실적 확인"],
            }],
        }
        response = FakeResponse({"output_text": json.dumps(model_result), "usage": {"input_tokens": 10}})
        with patch("analyze_broker_research.urlopen", return_value=response) as mocked:
            payload, usage = request_analysis(
                bounded_reports([record()]),
                api_key="test-key",
                model="gpt-5-mini",
            )
        request = mocked.call_args.args[0]
        body = json.loads(request.data.decode("utf-8"))
        self.assertEqual(body["text"]["format"]["type"], "json_schema")
        self.assertTrue(body["text"]["format"]["strict"])
        self.assertFalse(body["store"])
        self.assertEqual(payload["reports"][0]["report_id"], "report-1")
        self.assertEqual(usage["input_tokens"], 10)

    def test_validation_rejects_unknown_report_id(self) -> None:
        with self.assertRaisesRegex(ValueError, "do not match"):
            validate_analysis(
                {"reports": [{"report_id": "different", "stance": "neutral"}]},
                ["report-1"],
            )

    def test_cache_reuses_same_semantic_report_with_new_id(self) -> None:
        report = bounded_reports([record()])[0]
        with tempfile.TemporaryDirectory() as temporary:
            cache_dir = Path(temporary)
            write_report_analysis_cache(
                report,
                self.structured_report(),
                model="gpt-5-mini",
                cache_dir=cache_dir,
            )
            renamed = dict(report)
            renamed["report_id"] = "renamed-report"
            cached, _ = cached_report_analysis(
                renamed,
                model="gpt-5-mini",
                cache_dir=cache_dir,
            )
        self.assertIsNotNone(cached)
        self.assertEqual(cached["report_id"], "renamed-report")

    def test_cache_invalidates_on_text_or_model_change(self) -> None:
        report = bounded_reports([record()])[0]
        with tempfile.TemporaryDirectory() as temporary:
            cache_dir = Path(temporary)
            write_report_analysis_cache(
                report,
                self.structured_report(),
                model="gpt-5-mini",
                cache_dir=cache_dir,
            )
            changed = dict(report)
            changed["report_text"] = "Changed authorized report text."
            text_result, _ = cached_report_analysis(
                changed,
                model="gpt-5-mini",
                cache_dir=cache_dir,
            )
            model_result, _ = cached_report_analysis(
                report,
                model="gpt-5.1",
                cache_dir=cache_dir,
            )
        self.assertIsNone(text_result)
        self.assertIsNone(model_result)

    def test_corrupt_structured_cache_is_treated_as_miss(self) -> None:
        report = bounded_reports([record()])[0]
        with tempfile.TemporaryDirectory() as temporary:
            cache_dir = Path(temporary)
            key = write_report_analysis_cache(
                report,
                self.structured_report(),
                model="gpt-5-mini",
                cache_dir=cache_dir,
            )
            (cache_dir / f"{key}.json").write_text("{broken", encoding="utf-8")
            cached, resolved_key = cached_report_analysis(
                report,
                model="gpt-5-mini",
                cache_dir=cache_dir,
            )
        self.assertIsNone(cached)
        self.assertEqual(resolved_key, key)

    def test_schema_incomplete_structured_cache_is_treated_as_miss(self) -> None:
        report = bounded_reports([record()])[0]
        with tempfile.TemporaryDirectory() as temporary:
            cache_dir = Path(temporary)
            incomplete = self.structured_report()
            incomplete.pop("risks")
            write_report_analysis_cache(
                report,
                incomplete,
                model="gpt-5-mini",
                cache_dir=cache_dir,
            )
            cached, _ = cached_report_analysis(
                report,
                model="gpt-5-mini",
                cache_dir=cache_dir,
            )
        self.assertIsNone(cached)

    def test_mixed_cache_requests_only_missing_reports(self) -> None:
        first = bounded_reports([record()])[0]
        second = dict(first)
        second["report_id"] = "report-2"
        second["title"] = "Power equipment outlook"
        second["report_text"] = "Authorized power equipment report."
        generated_second = self.structured_report("report-2")
        generated_second["sectors"] = ["power_equipment"]
        with tempfile.TemporaryDirectory() as temporary:
            cache_dir = Path(temporary)
            write_report_analysis_cache(
                first,
                self.structured_report(),
                model="gpt-5-mini",
                cache_dir=cache_dir,
            )
            with patch(
                "analyze_broker_research.request_analysis",
                return_value=({"reports": [generated_second]}, {"input_tokens": 25}),
            ) as request:
                result, usage, cache = analyze_reports_with_cache(
                    [first, second],
                    api_key="test-key",
                    model="gpt-5-mini",
                    cache_dir=cache_dir,
                )
        self.assertEqual(
            [row["report_id"] for row in result["reports"]],
            ["report-1", "report-2"],
        )
        self.assertEqual(request.call_args.args[0], [second])
        self.assertEqual(usage["input_tokens"], 25)
        self.assertEqual(cache["hit_count"], 1)
        self.assertEqual(cache["miss_count"], 1)
        self.assertEqual(cache["write_count"], 1)
        self.assertFalse(cache["source_text_cached"])

    def test_all_cache_hits_skip_openai_request(self) -> None:
        report = bounded_reports([record()])[0]
        with tempfile.TemporaryDirectory() as temporary:
            cache_dir = Path(temporary)
            write_report_analysis_cache(
                report,
                self.structured_report(),
                model="gpt-5-mini",
                cache_dir=cache_dir,
            )
            with patch("analyze_broker_research.request_analysis") as request:
                result, usage, cache = analyze_reports_with_cache(
                    [report],
                    api_key="test-key",
                    model="gpt-5-mini",
                    cache_dir=cache_dir,
                )
        request.assert_not_called()
        self.assertEqual(result["reports"][0]["report_id"], "report-1")
        self.assertEqual(usage, {})
        self.assertEqual(cache["hit_count"], 1)
        self.assertEqual(cache["miss_count"], 0)

    def test_cache_misses_are_analyzed_in_bounded_batches(self) -> None:
        reports = []
        for index in range(12):
            item = bounded_reports([record()])[0]
            item["report_id"] = f"report-{index}"
            item["title"] = f"Report {index}"
            item["report_text"] = f"Authorized report text {index}"
            reports.append(item)

        calls = []

        def request_batch(batch, **_kwargs):
            calls.append([item["report_id"] for item in batch])
            return (
                {
                    "reports": [
                        self.structured_report(item["report_id"])
                        for item in batch
                    ]
                },
                {
                    "input_tokens": len(batch) * 10,
                    "output_tokens": len(batch) * 5,
                },
            )

        with tempfile.TemporaryDirectory() as temporary:
            with patch(
                "analyze_broker_research.request_analysis",
                side_effect=request_batch,
            ):
                result, usage, cache = analyze_reports_with_cache(
                    reports,
                    api_key="test-key",
                    model="gpt-5-mini",
                    cache_dir=Path(temporary),
                )

        self.assertEqual([len(batch) for batch in calls], [5, 5, 2])
        self.assertEqual(len(result["reports"]), 12)
        self.assertEqual(usage["input_tokens"], 120)
        self.assertEqual(usage["output_tokens"], 60)
        self.assertEqual(cache["request_count"], 3)
        self.assertEqual(cache["write_count"], 12)


if __name__ == "__main__":
    unittest.main()
