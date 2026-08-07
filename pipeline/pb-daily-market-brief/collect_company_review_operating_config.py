"""Collect versioned user/PM-approved company thesis-review operating settings."""

from __future__ import annotations

import argparse
import json
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any

from collectors.common import ROOT
from collect_company_market_context import root_path

SCHEMA_VERSION = "company_review_operating_config.v1"
CADENCES = {"event_driven", "weekly", "biweekly", "monthly", "quarterly", "custom"}
PREP_UNITS = {"calendar_days", "weekdays_excluding_weekends_only"}
PLACEHOLDER_PREFIX = "REPLACE_WITH_"


def validate_operating_config_record(record: dict[str, Any], report_day: date) -> dict[str, Any]:
    required = ("operating_config_id", "ticker", "company_name", "version", "effective_from")
    if any(not record.get(field) for field in required):
        raise ValueError("Operating configuration is missing required identity or version fields")
    ticker = str(record["ticker"]).upper()
    if ticker != record["ticker"] or not ticker.replace(".", "").replace("-", "").isalnum():
        raise ValueError("Operating configuration ticker must be normalized uppercase")
    if int(record["version"]) < 1:
        raise ValueError("Operating configuration version must be positive")
    if date.fromisoformat(str(record["effective_from"])) > report_day:
        raise ValueError("Operating configuration cannot become effective after the report date")
    approval = record.get("approval") or {}
    if approval.get("status") != "approved_by_user_or_pm":
        raise ValueError("Operating configuration requires explicit user or PM approval")
    if not approval.get("approved_by") or not approval.get("approved_at") or not approval.get("approval_note"):
        raise ValueError("Operating configuration approval requires identity, timestamp, and note")
    if datetime.fromisoformat(str(approval["approved_at"])).date() > report_day:
        raise ValueError("Operating configuration approval cannot be future-dated")

    owners = record.get("owners") or {}
    owner_fields = (
        "decision_authority", "pm_owner", "analyst_owner", "evidence_owner",
        "kpi_owner", "model_owner", "decision_log_owner",
    )
    for field in owner_fields:
        value = str(owners.get(field) or "").strip()
        if not value or value.startswith(PLACEHOLDER_PREFIX):
            raise ValueError(f"Operating configuration requires a real {field}")

    policy = record.get("review_policy") or {}
    if policy.get("cadence") not in CADENCES:
        raise ValueError("Operating configuration cadence is invalid")
    next_review = policy.get("next_scheduled_review_date")
    if next_review:
        date.fromisoformat(str(next_review))
    prep = policy.get("prep_lead_time") or {}
    if prep.get("unit") not in PREP_UNITS or not isinstance(prep.get("value"), int) or not 0 <= prep["value"] <= 60:
        raise ValueError("Preparation lead time requires 0-60 approved days and a supported basis")
    sla = policy.get("post_event_update_sla") or {}
    if sla.get("unit") != "hours" or not isinstance(sla.get("value"), int) or not 1 <= sla["value"] <= 168:
        raise ValueError("Post-event update SLA requires 1-168 approved hours")
    if sla.get("start_condition") != "verified_primary_results_available":
        raise ValueError("Post-event SLA must start from verified primary results availability")
    triggers = policy.get("escalation_triggers") or []
    if not triggers or any(not str(value).strip() for value in triggers):
        raise ValueError("Operating configuration requires explicit escalation triggers")
    if record.get("automatic_position_action_allowed") is not False:
        raise ValueError("Operating configuration cannot authorize automatic position action")
    expected_source_id = f"OPS-{ticker}-V{int(record['version'])}"
    sources = {str(row.get("source_id")): row for row in record.get("source_index", [])}
    if expected_source_id not in sources:
        raise ValueError("Operating configuration requires versioned internal source lineage")
    source = sources[expected_source_id]
    if source.get("source_type") != "user_provided_internal_operating_policy":
        raise ValueError("Operating configuration source must remain internal operating policy")
    return record


def load_operating_config_inputs(
    report_date: str, input_root: Path | None = None,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    report_day = date.fromisoformat(report_date)
    paths = [ROOT / "company_review_operating_registry.json"]
    if input_root and input_root.exists():
        paths.extend(sorted(input_root.rglob("*.json")))
    records: list[dict[str, Any]] = []
    errors: list[dict[str, Any]] = []
    for path in paths:
        if not path.exists():
            continue
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
            rows = payload if isinstance(payload, list) else [payload]
            for row in rows:
                if (row.get("approval") or {}).get("status") == "draft_pending_user_or_pm_approval":
                    # Draft completion and approval readiness are owned by the
                    # deterministic review queue, not the approved collector.
                    continue
                try:
                    records.append(validate_operating_config_record(row, report_day))
                except Exception as exc:
                    errors.append({"file": str(path), "ticker": row.get("ticker"), "error": str(exc)})
        except Exception as exc:
            errors.append({"file": str(path), "error": str(exc)})
    return records, errors


def collect_company_review_operating_config(
    report_date: str, records: list[dict[str, Any]], input_errors: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    report_day = date.fromisoformat(report_date)
    seen: set[tuple[str, int]] = set()
    grouped: dict[str, list[dict[str, Any]]] = {}
    for record in records:
        validate_operating_config_record(record, report_day)
        key = (str(record["ticker"]).upper(), int(record["version"]))
        if key in seen:
            raise ValueError(f"Duplicate company review operating configuration {key[0]} version {key[1]}")
        seen.add(key)
        grouped.setdefault(key[0], []).append(record)
    companies: list[dict[str, Any]] = []
    for ticker, versions in sorted(grouped.items()):
        versions.sort(key=lambda row: (int(row["version"]), str(row["effective_from"])))
        selected = versions[-1]
        companies.append({
            "ticker": ticker,
            "company_name": selected.get("company_name"),
            "configuration_status": "approved_operating_config_available",
            "selected_config": selected,
            "available_version_count": len(versions),
        })
    payload = {
        "schema_version": SCHEMA_VERSION,
        "report_date": report_date,
        "collected_at": datetime.now(timezone.utc).isoformat(),
        "company_count": len(companies),
        "companies": companies,
        "input_errors": input_errors or [],
        "methodology": {
            "append_only_version_selection": True,
            "explicit_user_or_pm_approval_required": True,
            "owners_or_timing_inferred": False,
            "automatic_position_action_allowed": False,
        },
        "posture": "approved_review_operations_not_investment_action",
    }
    validate_company_review_operating_config(payload)
    return payload


def validate_company_review_operating_config(payload: dict[str, Any]) -> None:
    if payload.get("schema_version") != SCHEMA_VERSION:
        raise ValueError("Unexpected company review operating configuration schema")
    companies = payload.get("companies", [])
    if int(payload.get("company_count", -1)) != len(companies):
        raise ValueError("Company count does not match operating configurations")
    tickers: set[str] = set()
    report_day = date.fromisoformat(str(payload["report_date"]))
    for company in companies:
        ticker = str(company.get("ticker") or "")
        if ticker in tickers:
            raise ValueError("Duplicate selected operating configuration ticker")
        tickers.add(ticker)
        if company.get("configuration_status") != "approved_operating_config_available":
            raise ValueError("Only approved operating configurations may be selected")
        validate_operating_config_record(company.get("selected_config") or {}, report_day)
    if payload.get("methodology", {}).get("automatic_position_action_allowed") is not False:
        raise ValueError("Operating configuration collection cannot authorize position action")


def main() -> None:
    parser = argparse.ArgumentParser(description="Collect approved company review operating settings")
    parser.add_argument("--date", required=True)
    parser.add_argument("--input-root")
    parser.add_argument("--output-file")
    args = parser.parse_args()
    input_root = root_path(args.input_root, ROOT / "workspace" / "company_review_operating_inputs") if args.input_root else None
    records, errors = load_operating_config_inputs(args.date, input_root)
    payload = collect_company_review_operating_config(args.date, records, errors)
    output = root_path(
        args.output_file,
        ROOT / "workspace" / "company_review_operating_config" / args.date / "company_review_operating_config.json",
    )
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Company review operating configuration saved: {output.relative_to(ROOT)}")
    print(f"Approved configurations: {payload['company_count']}")
    if errors:
        print(f"Rejected configuration inputs: {len(errors)}")


if __name__ == "__main__":
    main()
