"""Create schema-constrained, rights-safe analysis of authorized broker reports."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from copy import deepcopy
from datetime import datetime
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo

from broker_research_policy import RESEARCH_STANCES
from collectors.common import ROOT, load_dotenv

SCHEMA_VERSION = "broker_research_analysis.v1"
ANALYSIS_CACHE_SCHEMA = "broker_research_structured_cache.v1"
ANALYSIS_PROMPT_VERSION = "broker_research_prompt.v1"
ANALYSIS_CACHE_DIR = (
    ROOT / "workspace" / "broker_research_cache" / "structured_analysis"
)
MAX_REPORTS_PER_REQUEST = 5
MAX_REPORTS_PER_RUN = 25
HARD_MAX_REPORTS_PER_RUN = 40
MAX_INPUT_CHARS = 8_000
ANALYSIS_INSTRUCTIONS = """You analyze operator-authorized sell-side research for a private Korean PB workflow.
Use only the supplied report text and metadata. Produce concise Korean paraphrases; never copy long passages, tables, charts, or distinctive wording. Separate the analyst's stated view from facts verified elsewhere. A broker opinion is attributed analysis, not a confirmed company fact.

Extract the central thesis, key claims, catalysts, risks, covered tickers and sectors, and monitoring conditions. Use positive/neutral/cautious/negative only when the report supports that posture; otherwise use not_stated. Extract ratings and target prices only when explicitly present. Do not invent consensus, estimates, prices, investment advice, or causal market reactions. Return every supplied report_id exactly once."""

REPORT_ANALYSIS_SCHEMA = {
    "type": "object",
    "properties": {
        "report_id": {"type": "string"},
        "analyst": {"type": "string"},
        "report_type": {
            "type": "string",
            "enum": ["earnings", "company", "sector", "strategy", "macro", "other"],
        },
        "stance": {
            "type": "string",
            "enum": sorted(RESEARCH_STANCES),
        },
        "summary": {"type": "string"},
        "key_claims": {
            "type": "array",
            "items": {"type": "string"},
            "maxItems": 6,
        },
        "catalysts": {
            "type": "array",
            "items": {"type": "string"},
            "maxItems": 5,
        },
        "risks": {
            "type": "array",
            "items": {"type": "string"},
            "maxItems": 5,
        },
        "sectors": {
            "type": "array",
            "items": {"type": "string"},
            "maxItems": 6,
        },
        "tickers": {
            "type": "array",
            "items": {"type": "string"},
            "maxItems": 10,
        },
        "rating": {"type": "string"},
        "previous_rating": {"type": "string"},
        "target_price": {"type": ["number", "null"]},
        "previous_target_price": {"type": ["number", "null"]},
        "currency": {"type": "string"},
        "monitoring_conditions": {
            "type": "array",
            "items": {"type": "string"},
            "maxItems": 5,
        },
    },
    "required": [
        "report_id",
        "analyst",
        "report_type",
        "stance",
        "summary",
        "key_claims",
        "catalysts",
        "risks",
        "sectors",
        "tickers",
        "rating",
        "previous_rating",
        "target_price",
        "previous_target_price",
        "currency",
        "monitoring_conditions",
    ],
    "additionalProperties": False,
}


def _eligible(record: dict[str, Any]) -> bool:
    rights = record.get("research_rights") or {}
    return (
        record.get("source_type") == "broker_report"
        and rights.get("analysis_allowed") is True
        and rights.get("redistribution_allowed") is False
        and rights.get("publication_policy")
        in {"private_analysis_only", "summary_and_link_only"}
    )


def bounded_reports(
    records: list[dict[str, Any]],
    *,
    max_reports: int = MAX_REPORTS_PER_RUN,
) -> list[dict[str, Any]]:
    eligible = [record for record in records if isinstance(record, dict) and _eligible(record)]
    eligible.sort(
        key=lambda record: str(record.get("published_at") or ""),
        reverse=True,
    )
    output: list[dict[str, Any]] = []
    safe_limit = max(0, min(int(max_reports), HARD_MAX_REPORTS_PER_RUN))
    for record in eligible[:safe_limit]:
        output.append({
            "report_id": str(record.get("id") or record.get("source_reference") or ""),
            "publisher": str(record.get("publisher") or ""),
            "title": str(record.get("title") or ""),
            "published_at": str(record.get("published_at") or ""),
            "known_tickers": [str(value) for value in record.get("tickers") or []][:12],
            "known_tags": [str(value) for value in record.get("tags") or []][:20],
            "market_scope": str(record.get("market_scope") or "UNKNOWN"),
            "issuer_country": str(record.get("issuer_country") or ""),
            "original_language": str(record.get("original_language") or ""),
            "base_currency": str(record.get("base_currency") or ""),
            "report_text": str(record.get("raw_text") or "")[:MAX_INPUT_CHARS],
        })
    return output


def analysis_schema(report_ids: list[str]) -> dict[str, Any]:
    item_schema = json.loads(json.dumps(REPORT_ANALYSIS_SCHEMA))
    item_schema["properties"]["report_id"]["enum"] = report_ids or ["NO_ELIGIBLE_REPORT"]
    return {
        "type": "object",
        "properties": {
            "reports": {
                "type": "array",
                "items": item_schema,
                "minItems": len(report_ids),
                "maxItems": len(report_ids),
            },
        },
        "required": ["reports"],
        "additionalProperties": False,
    }


def response_text(payload: dict[str, Any]) -> str:
    if payload.get("output_text"):
        return str(payload["output_text"]).strip()
    parts: list[str] = []
    for output in payload.get("output", []):
        for content in output.get("content", []):
            if content.get("type") == "output_text":
                parts.append(str(content.get("text") or ""))
    return "\n".join(parts).strip()


def validate_analysis(payload: dict[str, Any], report_ids: list[str]) -> None:
    rows = payload.get("reports")
    if not isinstance(rows, list):
        raise ValueError("Broker analysis requires a reports array")
    actual_ids = [str(row.get("report_id") or "") for row in rows if isinstance(row, dict)]
    if sorted(actual_ids) != sorted(report_ids):
        raise ValueError("Broker analysis report IDs do not match the authorized input")
    if len(actual_ids) != len(set(actual_ids)):
        raise ValueError("Broker analysis report IDs must be unique")
    required = set(REPORT_ANALYSIS_SCHEMA["required"])
    allowed_report_types = set(
        REPORT_ANALYSIS_SCHEMA["properties"]["report_type"]["enum"]
    )
    for row in rows:
        if not isinstance(row, dict) or set(row) != required:
            raise ValueError("Broker analysis report shape does not match the schema")
        if row.get("report_type") not in allowed_report_types:
            raise ValueError("Broker analysis returned an unsupported report type")
        if row.get("stance") not in RESEARCH_STANCES:
            raise ValueError("Broker analysis returned an unsupported stance")
        for field in (
            "report_id",
            "analyst",
            "summary",
            "rating",
            "previous_rating",
            "currency",
        ):
            if not isinstance(row.get(field), str):
                raise ValueError(f"Broker analysis {field} must be a string")
        for field in (
            "key_claims",
            "catalysts",
            "risks",
            "sectors",
            "tickers",
            "monitoring_conditions",
        ):
            values = row.get(field)
            maximum = REPORT_ANALYSIS_SCHEMA["properties"][field]["maxItems"]
            if (
                not isinstance(values, list)
                or len(values) > maximum
                or any(not isinstance(value, str) for value in values)
            ):
                raise ValueError(f"Broker analysis {field} does not match the schema")
        for field in ("target_price", "previous_target_price"):
            value = row.get(field)
            if value is not None and (
                isinstance(value, bool) or not isinstance(value, (int, float))
            ):
                raise ValueError(f"Broker analysis {field} must be numeric or null")


def request_analysis(
    reports: list[dict[str, Any]],
    *,
    api_key: str,
    model: str,
) -> tuple[dict[str, Any], dict[str, Any]]:
    report_ids = [row["report_id"] for row in reports]
    body = json.dumps({
        "model": model,
        "instructions": ANALYSIS_INSTRUCTIONS,
        "input": json.dumps({"reports": reports}, ensure_ascii=False),
        "reasoning": {"effort": "minimal"},
        "text": {"format": {
            "type": "json_schema",
            "name": "broker_research_analysis",
            "description": "Rights-safe structured analysis of authorized broker reports.",
            "strict": True,
            "schema": analysis_schema(report_ids),
        }},
        "max_output_tokens": 5000,
        "store": False,
    }, ensure_ascii=False).encode("utf-8")
    request = Request(
        "https://api.openai.com/v1/responses",
        method="POST",
        data=body,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
    )
    with urlopen(request, timeout=120) as response:
        raw = json.loads(response.read().decode("utf-8"))
    if raw.get("status") == "incomplete":
        reason = (raw.get("incomplete_details") or {}).get("reason", "unknown")
        raise RuntimeError(f"OpenAI broker research analysis incomplete ({reason})")
    text = response_text(raw)
    if not text:
        raise RuntimeError("OpenAI returned no broker research analysis")
    payload = json.loads(text)
    validate_analysis(payload, report_ids)
    return payload, raw.get("usage") or {}


def analysis_cache_key(
    report: dict[str, Any],
    *,
    model: str,
    prompt_version: str = ANALYSIS_PROMPT_VERSION,
) -> str:
    """Key only the bounded semantic input and analysis contract."""
    semantic_input = {
        key: value
        for key, value in report.items()
        if key != "report_id"
    }
    payload = {
        "cache_schema_version": ANALYSIS_CACHE_SCHEMA,
        "analysis_schema_version": SCHEMA_VERSION,
        "prompt_version": prompt_version,
        "model": model,
        "reasoning_effort": "minimal",
        "max_output_tokens": 5000,
        "report_schema": REPORT_ANALYSIS_SCHEMA,
        "report": semantic_input,
    }
    encoded = json.dumps(
        payload,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def cached_report_analysis(
    report: dict[str, Any],
    *,
    model: str,
    cache_dir: Path,
    prompt_version: str = ANALYSIS_PROMPT_VERSION,
) -> tuple[dict[str, Any] | None, str]:
    cache_key = analysis_cache_key(
        report,
        model=model,
        prompt_version=prompt_version,
    )
    cache_path = cache_dir / f"{cache_key}.json"
    if not cache_path.exists():
        return None, cache_key
    try:
        cached = json.loads(cache_path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError):
        return None, cache_key
    if (
        not isinstance(cached, dict)
        or cached.get("cache_schema_version") != ANALYSIS_CACHE_SCHEMA
        or cached.get("cache_key") != cache_key
        or cached.get("analysis_schema_version") != SCHEMA_VERSION
        or cached.get("prompt_version") != prompt_version
        or cached.get("model") != model
        or not isinstance(cached.get("analysis"), dict)
    ):
        return None, cache_key
    analysis = deepcopy(cached["analysis"])
    analysis["report_id"] = report["report_id"]
    try:
        validate_analysis({"reports": [analysis]}, [report["report_id"]])
    except ValueError:
        return None, cache_key
    return analysis, cache_key


def write_report_analysis_cache(
    report: dict[str, Any],
    analysis: dict[str, Any],
    *,
    model: str,
    cache_dir: Path,
    prompt_version: str = ANALYSIS_PROMPT_VERSION,
) -> str:
    cache_key = analysis_cache_key(
        report,
        model=model,
        prompt_version=prompt_version,
    )
    cache_dir.mkdir(parents=True, exist_ok=True)
    cache_path = cache_dir / f"{cache_key}.json"
    cached_analysis = deepcopy(analysis)
    cached_analysis.pop("report_id", None)
    payload = {
        "cache_schema_version": ANALYSIS_CACHE_SCHEMA,
        "cache_key": cache_key,
        "analysis_schema_version": SCHEMA_VERSION,
        "prompt_version": prompt_version,
        "model": model,
        "analysis": cached_analysis,
        "created_at": datetime.now(ZoneInfo("Asia/Seoul")).isoformat(),
    }
    temporary = cache_path.with_suffix(".tmp")
    temporary.write_text(
        json.dumps(payload, ensure_ascii=False),
        encoding="utf-8",
    )
    temporary.replace(cache_path)
    return cache_key


def analyze_reports_with_cache(
    reports: list[dict[str, Any]],
    *,
    api_key: str,
    model: str,
    cache_dir: Path = ANALYSIS_CACHE_DIR,
    prompt_version: str = ANALYSIS_PROMPT_VERSION,
    batch_size: int = MAX_REPORTS_PER_REQUEST,
) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any]]:
    cached_by_id: dict[str, dict[str, Any]] = {}
    misses: list[dict[str, Any]] = []
    for report in reports:
        cached, _ = cached_report_analysis(
            report,
            model=model,
            cache_dir=cache_dir,
            prompt_version=prompt_version,
        )
        if cached is None:
            misses.append(report)
        else:
            cached_by_id[report["report_id"]] = cached

    usage: dict[str, Any] = {}
    generated_by_id: dict[str, dict[str, Any]] = {}
    request_count = 0
    if misses:
        resolved_batch_size = max(1, min(int(batch_size), MAX_REPORTS_PER_REQUEST))
        for offset in range(0, len(misses), resolved_batch_size):
            batch = misses[offset:offset + resolved_batch_size]
            generated, batch_usage = request_analysis(
                batch,
                api_key=api_key,
                model=model,
            )
            request_count += 1
            for key, value in batch_usage.items():
                if isinstance(value, (int, float)) and not isinstance(value, bool):
                    usage[key] = usage.get(key, 0) + value
                elif key not in usage:
                    usage[key] = value
            batch_results = {
                row["report_id"]: row
                for row in generated["reports"]
            }
            generated_by_id.update(batch_results)
            for report in batch:
                write_report_analysis_cache(
                    report,
                    batch_results[report["report_id"]],
                    model=model,
                    cache_dir=cache_dir,
                    prompt_version=prompt_version,
                )

    combined = [
        cached_by_id.get(report["report_id"])
        or generated_by_id[report["report_id"]]
        for report in reports
    ]
    result = {"reports": combined}
    validate_analysis(result, [report["report_id"] for report in reports])
    return result, usage, {
        "schema_version": ANALYSIS_CACHE_SCHEMA,
        "prompt_version": prompt_version,
        "model": model,
        "hit_count": len(cached_by_id),
        "miss_count": len(misses),
        "write_count": len(generated_by_id),
        "request_count": request_count,
        "batch_size": max(1, min(int(batch_size), MAX_REPORTS_PER_REQUEST)),
        "source_text_cached": False,
    }


def analysis_batch_key(
    reports: list[dict[str, Any]],
    *,
    model: str,
    prompt_version: str = ANALYSIS_PROMPT_VERSION,
) -> str:
    keys = [
        analysis_cache_key(
            report,
            model=model,
            prompt_version=prompt_version,
        )
        for report in reports
    ]
    return hashlib.sha256("\n".join(keys).encode("ascii")).hexdigest()


def analysis_artifact(
    report_date: str,
    *,
    status: str,
    reports: list[dict[str, Any]],
    usage: dict[str, Any] | None = None,
    cache: dict[str, Any] | None = None,
    analysis_identity: dict[str, Any] | None = None,
    notice: str = "",
) -> dict[str, Any]:
    return {
        "schema_version": SCHEMA_VERSION,
        "report_date": report_date,
        "generated_at": datetime.now(ZoneInfo("Asia/Seoul")).isoformat(),
        "status": status,
        "report_count": len(reports),
        "reports": reports,
        "usage": usage or {},
        "cache": cache or {},
        "analysis_identity": analysis_identity or {},
        "notice": notice,
        "policy": {
            "operator_authorized_only": True,
            "source_text_redistributed": False,
            "broker_views_are_attributed_analysis": True,
        },
    }


def load_records(path: Path) -> list[dict[str, Any]]:
    payload = json.loads(path.read_text(encoding="utf-8-sig"))
    if not isinstance(payload, list):
        raise ValueError(f"Expected a JSON array: {path}")
    return [row for row in payload if isinstance(row, dict)]


def reusable_complete_artifact(
    path: Path,
    *,
    report_date: str,
    report_ids: list[str],
    batch_key: str | None = None,
) -> dict[str, Any] | None:
    if not path.exists():
        return None
    try:
        payload = json.loads(path.read_text(encoding="utf-8-sig"))
    except (OSError, ValueError, json.JSONDecodeError):
        return None
    if not isinstance(payload, dict):
        return None
    if payload.get("schema_version") != SCHEMA_VERSION:
        return None
    if payload.get("status") != "complete":
        return None
    if str(payload.get("report_date") or "") != report_date:
        return None
    rows = payload.get("reports")
    if not isinstance(rows, list):
        return None
    actual_ids = sorted(
        str(row.get("report_id") or "")
        for row in rows
        if isinstance(row, dict)
    )
    if actual_ids != sorted(report_ids):
        return None
    if batch_key is not None:
        identity = payload.get("analysis_identity") or {}
        if identity.get("batch_key") != batch_key:
            return None
    try:
        validate_analysis(payload, report_ids)
    except ValueError:
        return None
    return payload


def main() -> None:
    parser = argparse.ArgumentParser(description="Analyze authorized broker research")
    parser.add_argument("--date", required=True)
    parser.add_argument("--inbox-file", required=True)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    load_dotenv()
    configured_limit = int(
        os.getenv("OPENAI_BROKER_RESEARCH_MAX_REPORTS", str(MAX_REPORTS_PER_RUN))
    )
    reports = bounded_reports(
        load_records(ROOT / args.inbox_file),
        max_reports=configured_limit,
    )
    model = os.getenv(
        "OPENAI_BROKER_RESEARCH_MODEL",
        os.getenv("OPENAI_ANALYSIS_MODEL", "gpt-5-mini"),
    ).strip()
    batch_key = analysis_batch_key(reports, model=model) if reports else ""
    analysis_identity = {
        "batch_key": batch_key,
        "prompt_version": ANALYSIS_PROMPT_VERSION,
        "model": model,
    }
    output = (
        ROOT
        / "workspace"
        / "broker_research_analysis"
        / args.date
        / "broker_research_analysis.json"
    )
    output.parent.mkdir(parents=True, exist_ok=True)

    if not reports:
        artifact = analysis_artifact(
            args.date,
            status="no_eligible_reports",
            reports=[],
        )
    elif args.dry_run:
        analysis_schema([row["report_id"] for row in reports])
        existing = reusable_complete_artifact(
            output,
            report_date=args.date,
            report_ids=[row["report_id"] for row in reports],
            batch_key=batch_key,
        )
        if existing is not None:
            print(
                "Broker research analysis preserved: "
                f"{output.relative_to(ROOT)} (complete)"
            )
            return
        artifact = analysis_artifact(
            args.date,
            status="dry_run",
            reports=[],
            notice=f"{len(reports)} authorized report(s) validated; no model request made",
            analysis_identity=analysis_identity,
        )
    else:
        api_key = os.getenv("OPENAI_API_KEY", "").strip()
        if not api_key:
            artifact = analysis_artifact(
                args.date,
                status="skipped_missing_api_key",
                reports=[],
                notice="OPENAI_API_KEY is not configured",
            )
        else:
            try:
                result, usage, cache = analyze_reports_with_cache(
                    reports,
                    api_key=api_key,
                    model=model,
                )
                artifact = analysis_artifact(
                    args.date,
                    status="complete",
                    reports=result["reports"],
                    usage=usage,
                    cache=cache,
                    analysis_identity=analysis_identity,
                )
            except (HTTPError, URLError, TimeoutError, RuntimeError, ValueError, json.JSONDecodeError) as exc:
                artifact = analysis_artifact(
                    args.date,
                    status="failed_non_blocking",
                    reports=[],
                    notice=f"{type(exc).__name__}: analysis unavailable",
                )
    output.write_text(json.dumps(artifact, ensure_ascii=False, indent=2), encoding="utf-8")
    print(
        "Broker research analysis saved: "
        f"{output.relative_to(ROOT)} ({artifact['status']})"
    )


if __name__ == "__main__":
    main()
