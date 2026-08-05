"""Generate editable, explicitly unapproved company review operating drafts."""

from __future__ import annotations

import argparse
import copy
import json
from datetime import date
from pathlib import Path
from typing import Any

from collectors.common import ROOT
from collect_company_review_operating_config import validate_operating_config_record

SCHEMA_VERSION = "company_review_operating_drafts.v1"
OWNER_FIELDS = (
    "decision_authority", "pm_owner", "analyst_owner", "evidence_owner",
    "kpi_owner", "model_owner", "decision_log_owner",
)


def _by_ticker(payload: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {
        str(row.get("ticker") or "").upper(): row
        for row in payload.get("companies", []) if row.get("ticker")
    }


def _existing_input_keys(input_root: Path) -> set[tuple[str, int]]:
    keys: set[tuple[str, int]] = set()
    if not input_root.exists():
        return keys
    for path in input_root.rglob("*.json"):
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
            rows = payload if isinstance(payload, list) else [payload]
            for row in rows:
                if isinstance(row, dict) and row.get("ticker") and row.get("version"):
                    keys.add((str(row["ticker"]).upper(), int(row["version"])))
        except Exception:
            continue
    return keys


def validate_generated_operating_draft(record: dict[str, Any], report_day: date) -> None:
    approval = record.get("approval") or {}
    if approval.get("status") != "draft_pending_user_or_pm_approval":
        raise ValueError("Generated operating settings must remain an unapproved draft")
    if approval.get("approved_by") is not None or approval.get("approved_at") is not None:
        raise ValueError("Generated operating draft cannot contain approval identity or time")
    if record.get("automatic_position_action_allowed") is not False:
        raise ValueError("Generated operating draft cannot authorize automatic position action")
    metadata = record.get("draft_metadata") or {}
    if metadata.get("generated_by") != "generate_company_review_operating_drafts.py":
        raise ValueError("Generated operating draft requires generator lineage")
    review_copy = copy.deepcopy(record)
    for field in OWNER_FIELDS:
        value = str((review_copy.get("owners") or {}).get(field) or "").strip()
        if not value:
            raise ValueError(f"Generated operating draft is missing {field}")
        if value.startswith("REPLACE_WITH_"):
            review_copy["owners"][field] = "pending_user_or_pm_owner"
    review_copy["approval"] = {
        "status": "approved_by_user_or_pm", "approved_by": "validation_only",
        "approved_at": f"{report_day.isoformat()}T00:00:00+00:00",
        "approval_note": "Validation-only conversion; this draft remains unapproved.",
    }
    validate_operating_config_record(review_copy, report_day)


def build_company_review_operating_drafts(
    report_date: str, underwriting_registry: dict[str, Any], earnings_events: dict[str, Any],
    approved_operating_registry: list[dict[str, Any]],
    existing_input_keys: set[tuple[str, int]] | None = None,
    include_configured: bool = False,
) -> dict[str, Any]:
    report_day = date.fromisoformat(report_date)
    event_map = _by_ticker(earnings_events)
    operating_versions: dict[str, list[int]] = {}
    for record in approved_operating_registry:
        validate_operating_config_record(record, report_day)
        operating_versions.setdefault(str(record["ticker"]).upper(), []).append(int(record["version"]))
    drafts: list[dict[str, Any]] = []
    for company in underwriting_registry.get("companies", []):
        if (
            company.get("underwriting_status") != "approved_original_underwriting_available"
            or company.get("formal_thesis_update_allowed") is not True
            or not company.get("selected_underwriting")
        ):
            continue
        ticker = str(company["ticker"]).upper()
        versions = operating_versions.get(ticker, [])
        if versions and not include_configured:
            continue
        version = max(versions, default=0) + 1
        event_gate = event_map.get(ticker, {})
        selected_event = (
            event_gate.get("selected_event")
            if event_gate.get("event_gate_status") == "confirmed_primary_exact_date"
            else None
        ) or {}
        event_source_id = selected_event.get("source_id")
        source_id = f"OPS-{ticker}-V{version}"
        record = {
            "operating_config_id": f"company:{ticker}:review-operations:v{version}",
            "ticker": ticker,
            "company_name": company.get("company_name"),
            "version": version,
            "effective_from": report_date,
            "approval": {
                "status": "draft_pending_user_or_pm_approval",
                "approved_by": None, "approved_at": None,
                "approval_note": "Replace every owner placeholder and explicitly approve before use.",
            },
            "owners": {field: "REPLACE_WITH_NAME_OR_ROLE" for field in OWNER_FIELDS},
            "review_policy": {
                "cadence": "event_driven",
                "next_scheduled_review_date": selected_event.get("event_date"),
                "prep_lead_time": {"value": 5, "unit": "calendar_days"},
                "post_event_update_sla": {
                    "value": 24, "unit": "hours",
                    "start_condition": "verified_primary_results_available",
                },
                "escalation_triggers": [
                    "Confirmed event date changes",
                    "Source-verified result matches an approved kill criterion",
                    "Required primary evidence is unavailable after the event",
                ],
            },
            "automatic_position_action_allowed": False,
            "source_index": [{
                "source_id": source_id,
                "source_name": f"{ticker} draft review operating configuration v{version}",
                "source_type": "user_provided_internal_operating_policy",
                "as_of_date": report_date,
                "source_location": "company_review_operating_registry.json",
                "reliability": "draft_pending_explicit_user_or_pm_approval",
                "limitation": "Unapproved operating draft; not a public-company fact or investment action.",
            }],
            "draft_metadata": {
                "generated_by": "generate_company_review_operating_drafts.py",
                "generated_on": report_date,
                "source_underwriting_id": company["selected_underwriting"].get("underwriting_id"),
                "suggested_review_date_source_id": event_source_id,
                "suggested_defaults_are_approved": False,
                "fields_requiring_user_or_pm_completion": list(OWNER_FIELDS),
            },
        }
        validate_generated_operating_draft(record, report_day)
        key = (ticker, version)
        drafts.append({
            "ticker": ticker, "company_name": company.get("company_name"), "version": version,
            "draft_status": (
                "existing_input_detected" if key in (existing_input_keys or set())
                else "generated_requires_user_or_pm_completion"
            ),
            "draft_record": record,
            "input_filename": f"{ticker}_v{version}.json",
            "missing_completion_fields": list(OWNER_FIELDS),
            "approval_executed": False,
            "security_or_position_action_approved": False,
        })
    payload = {
        "schema_version": SCHEMA_VERSION,
        "report_date": report_date,
        "draft_count": len(drafts),
        "materialized_count": 0,
        "drafts": drafts,
        "methodology": {
            "approved_underwriting_required": True,
            "configured_company_regenerated_by_default": False,
            "suggested_defaults_are_approved": False,
            "automatic_approval_allowed": False,
            "automatic_position_action_allowed": False,
        },
        "posture": "editable_operating_draft_not_approval_or_investment_action",
    }
    validate_company_review_operating_drafts(payload)
    return payload


def materialize_operating_drafts(payload: dict[str, Any], input_root: Path) -> list[Path]:
    validate_company_review_operating_drafts(payload)
    input_root.mkdir(parents=True, exist_ok=True)
    written: list[Path] = []
    for row in payload.get("drafts", []):
        path = input_root / str(row["input_filename"])
        if path.exists():
            continue
        path.write_text(json.dumps(row["draft_record"], ensure_ascii=False, indent=2), encoding="utf-8")
        row["draft_status"] = "materialized_requires_user_or_pm_completion"
        written.append(path)
    payload["materialized_count"] = sum(
        row.get("draft_status") == "materialized_requires_user_or_pm_completion"
        for row in payload.get("drafts", [])
    )
    validate_company_review_operating_drafts(payload)
    return written


def validate_company_review_operating_drafts(payload: dict[str, Any]) -> None:
    if payload.get("schema_version") != SCHEMA_VERSION:
        raise ValueError("Unexpected company review operating draft schema")
    drafts = payload.get("drafts", [])
    if int(payload.get("draft_count", -1)) != len(drafts):
        raise ValueError("Operating draft count does not match rows")
    if int(payload.get("materialized_count", -1)) != sum(
        row.get("draft_status") == "materialized_requires_user_or_pm_completion" for row in drafts
    ):
        raise ValueError("Materialized operating draft count does not match rows")
    keys: set[tuple[str, int]] = set()
    report_day = date.fromisoformat(str(payload["report_date"]))
    for row in drafts:
        key = (str(row.get("ticker") or "").upper(), int(row.get("version", 0)))
        if key in keys:
            raise ValueError("Duplicate generated operating draft ticker/version")
        keys.add(key)
        if row.get("approval_executed") is not False or row.get("security_or_position_action_approved") is not False:
            raise ValueError("Generated operating draft cannot approve operations or position action")
        validate_generated_operating_draft(row.get("draft_record") or {}, report_day)
    methodology = payload.get("methodology") or {}
    if methodology.get("automatic_approval_allowed") is not False:
        raise ValueError("Operating draft generation cannot allow automatic approval")
    if methodology.get("automatic_position_action_allowed") is not False:
        raise ValueError("Operating draft generation cannot authorize position action")


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate editable company review operating drafts")
    parser.add_argument("--date", required=True)
    parser.add_argument("--company-underwriting-file")
    parser.add_argument("--company-earnings-events-file")
    parser.add_argument("--registry-file")
    parser.add_argument("--input-root")
    parser.add_argument("--output-file")
    parser.add_argument("--include-configured", action="store_true")
    parser.add_argument("--materialize-inputs", action="store_true")
    args = parser.parse_args()
    underwriting_path = Path(args.company_underwriting_file) if args.company_underwriting_file else ROOT / "workspace" / "company_underwriting" / args.date / "company_underwriting.json"
    events_path = Path(args.company_earnings_events_file) if args.company_earnings_events_file else ROOT / "workspace" / "company_earnings_events" / args.date / "company_earnings_events.json"
    registry_path = Path(args.registry_file) if args.registry_file else ROOT / "company_review_operating_registry.json"
    input_root = Path(args.input_root) if args.input_root else ROOT / "workspace" / "company_review_operating_inputs"
    for label, path in (("company underwriting", underwriting_path), ("company earnings events", events_path)):
        if not path.exists():
            raise SystemExit(f"{label} does not exist: {path}")
    registry = json.loads(registry_path.read_text(encoding="utf-8")) if registry_path.exists() else []
    if not isinstance(registry, list):
        raise SystemExit("Company review operating registry must contain a JSON list")
    payload = build_company_review_operating_drafts(
        args.date,
        json.loads(underwriting_path.read_text(encoding="utf-8")),
        json.loads(events_path.read_text(encoding="utf-8")),
        registry, _existing_input_keys(input_root), args.include_configured,
    )
    if args.materialize_inputs:
        materialize_operating_drafts(payload, input_root)
    output = Path(args.output_file) if args.output_file else ROOT / "workspace" / "company_review_operating_drafts" / args.date / "company_review_operating_drafts.json"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Company review operating drafts saved: {output.relative_to(ROOT)}")
    print(f"Drafts: {payload['draft_count']} · materialized: {payload['materialized_count']}")


if __name__ == "__main__":
    main()
