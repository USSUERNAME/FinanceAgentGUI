"""Collect append-only, user/PM-approved original company underwriting inputs."""

from __future__ import annotations

import argparse
import json
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any

from collectors.common import ROOT
from collect_company_market_context import root_path

SCHEMA_VERSION = "company_underwriting_registry.v1"
APPROVAL_STATES = {"draft_pending_user_approval", "approved_by_user_or_pm", "retired"}
ALLOWED_SELECTORS = {
    "headline_result_case", "eps_quality_status", "guidance_status", "transcript_status",
}


def _valid_selector(value: str) -> bool:
    return value in ALLOWED_SELECTORS or value.startswith("operating_kpi:")


def validate_underwriting_record(row: dict[str, Any], report_day: date) -> dict[str, Any]:
    required = {
        "underwriting_id", "ticker", "company_name", "version", "authored_at",
        "approval", "one_sentence_thesis", "variant_perception", "market_setup",
        "valuation_anchor", "horizon", "pillars", "kill_criteria", "catalysts",
        "open_diligence", "source_index",
    }
    missing = sorted(required - set(row))
    if missing:
        raise ValueError(f"Company underwriting record missing fields: {missing}")
    authored_at = datetime.fromisoformat(str(row["authored_at"]))
    if authored_at.utcoffset() is None:
        raise ValueError("Underwriting authorship timestamp requires an explicit timezone")
    authored_day = authored_at.date()
    if authored_day > report_day:
        raise ValueError("Company underwriting cannot be authored after the report date")
    if not str(row.get("underwriting_id") or "").strip() or int(row.get("version", 0)) < 1:
        raise ValueError("Underwriting requires a stable ID and positive version")
    approval = row.get("approval") or {}
    status = approval.get("status")
    if status not in APPROVAL_STATES:
        raise ValueError("Unsupported underwriting approval status")
    if status == "approved_by_user_or_pm":
        if not str(approval.get("approved_by") or "").strip() or not approval.get("approved_at"):
            raise ValueError("Approved underwriting requires approver and approval timestamp")
        approved_at = datetime.fromisoformat(str(approval["approved_at"]))
        if approved_at.utcoffset() is None:
            raise ValueError("Underwriting approval timestamp requires an explicit timezone")
        if approved_at.date() > report_day:
            raise ValueError("Underwriting approval cannot be after the report date")
        if approved_at < authored_at:
            raise ValueError("Underwriting approval cannot precede authorship")
    source_ids = {source.get("source_id") for source in row.get("source_index", [])}
    if not source_ids or None in source_ids:
        raise ValueError("Underwriting requires a non-empty source index with stable source IDs")
    pillar_ids: set[str] = set()
    for pillar in row.get("pillars", []):
        pillar_id = str(pillar.get("pillar_id") or "")
        if not pillar_id or pillar_id in pillar_ids:
            raise ValueError("Underwriting pillar IDs must be stable and unique")
        pillar_ids.add(pillar_id)
        if pillar.get("priority") not in {"core", "secondary"}:
            raise ValueError("Underwriting pillar priority must be core or secondary")
        if not pillar.get("evidence_rules"):
            raise ValueError("Every underwriting pillar requires at least one evidence rule")
        if any(not _valid_selector(str(rule.get("selector") or "")) for rule in pillar.get("evidence_rules", [])):
            raise ValueError("Unsupported underwriting evidence selector")
        if not pillar.get("source_ids") or any(source_id not in source_ids for source_id in pillar.get("source_ids", [])):
            raise ValueError("Every underwriting pillar requires source lineage")
    kill_ids: set[str] = set()
    for criterion in row.get("kill_criteria", []):
        kill_id = str(criterion.get("kill_id") or "")
        if not kill_id or kill_id in kill_ids:
            raise ValueError("Underwriting kill-criterion IDs must be stable and unique")
        kill_ids.add(kill_id)
        if not _valid_selector(str(criterion.get("selector") or "")) or not criterion.get("match_values"):
            raise ValueError("Kill criterion requires a supported selector and exact match values")
        expected_origin = "Inherited threshold" if status == "approved_by_user_or_pm" else "Draft threshold for PM confirmation"
        expected_rule_status = "Approved monitoring rule" if status == "approved_by_user_or_pm" else "draft_pending_user_approval"
        if criterion.get("threshold_origin") != expected_origin:
            raise ValueError("Kill-criterion threshold origin does not match underwriting approval state")
        if criterion.get("threshold_approval_status") != expected_rule_status:
            raise ValueError("Kill-criterion approval status does not match underwriting approval state")
        if not criterion.get("source_ids") or any(source_id not in source_ids for source_id in criterion.get("source_ids", [])):
            raise ValueError("Every kill criterion requires source lineage")
    return {**row, "ticker": str(row["ticker"]).upper(), "version": int(row["version"])}


def load_underwriting_inputs(report_date: str, input_root: Path | None = None) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    accepted: list[dict[str, Any]] = []
    errors: list[dict[str, Any]] = []
    report_day = date.fromisoformat(report_date)
    sources = [input_root] if input_root else [
        ROOT / "company_underwriting_registry.json",
        ROOT / "workspace" / "company_underwriting_inputs",
    ]
    paths: list[Path] = []
    for source in sources:
        if source and source.is_file():
            paths.append(source)
        elif source and source.exists():
            paths.extend(sorted(source.rglob("*.json")))
    for path in dict.fromkeys(paths):
        try:
            raw = json.loads(path.read_text(encoding="utf-8"))
            records = raw if isinstance(raw, list) else [raw]
            accepted.extend(validate_underwriting_record(record, report_day) for record in records)
        except (ValueError, TypeError, json.JSONDecodeError) as exc:
            errors.append({"input_file": str(path.relative_to(ROOT)), "error": str(exc)})
    return accepted, errors


def collect_company_underwriting(
    report_date: str, deep_dive: dict[str, Any], records: list[dict[str, Any]] | None = None,
    input_errors: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    grouped: dict[str, list[dict[str, Any]]] = {}
    seen_versions: set[tuple[str, int]] = set()
    for row in records or []:
        version_key = (str(row.get("ticker") or "").upper(), int(row.get("version", 0)))
        if version_key in seen_versions:
            raise ValueError(f"Duplicate underwriting ticker/version: {version_key[0]} v{version_key[1]}")
        seen_versions.add(version_key)
        grouped.setdefault(str(row.get("ticker") or "").upper(), []).append(row)
    candidates = {str(row.get("ticker") or "").upper(): row for row in deep_dive.get("reviews", [])}
    companies: list[dict[str, Any]] = []
    for ticker in sorted(set(candidates) | set(grouped)):
        versions = sorted(grouped.get(ticker, []), key=lambda row: (int(row.get("version", 0)), str(row.get("authored_at", ""))), reverse=True)
        retired = bool(versions and (versions[0].get("approval") or {}).get("status") == "retired")
        approved = None if retired else next((row for row in versions if (row.get("approval") or {}).get("status") == "approved_by_user_or_pm"), None)
        selected = approved or (versions[0] if versions else None)
        companies.append({
            "ticker": ticker,
            "company_name": (selected or candidates.get(ticker, {})).get("company_name"),
            "underwriting_status": (
                "approved_original_underwriting_available" if approved
                else "retired" if retired
                else "draft_pending_user_approval" if selected
                else "not_supplied"
            ),
            "selected_underwriting": selected,
            "available_version_count": len(versions),
            "formal_thesis_update_allowed": approved is not None,
            "missing_artifacts": [] if approved else ["user/PM-approved original underwriting and kill criteria"],
        })
    payload = {
        "schema_version": SCHEMA_VERSION,
        "report_date": report_date,
        "collected_at": datetime.now(timezone.utc).isoformat(),
        "company_count": len(companies),
        "approved_count": sum(row["formal_thesis_update_allowed"] for row in companies),
        "companies": companies,
        "input_errors": input_errors or [],
        "methodology": {
            "append_only_input_discovery": True,
            "explicit_user_or_pm_approval_required": True,
            "inferred_underwriting_allowed": False,
            "automatic_position_action_allowed": False,
        },
        "posture": "original_underwriting_registry_not_investment_action",
    }
    validate_company_underwriting_registry(payload)
    return payload


def validate_company_underwriting_registry(payload: dict[str, Any]) -> None:
    if payload.get("schema_version") != SCHEMA_VERSION:
        raise ValueError("Unexpected company underwriting registry schema")
    if int(payload.get("company_count", -1)) != len(payload.get("companies", [])):
        raise ValueError("Company count does not match underwriting registry")
    for company in payload.get("companies", []):
        approved = company.get("underwriting_status") == "approved_original_underwriting_available"
        if company.get("formal_thesis_update_allowed") is not approved:
            raise ValueError("Only explicitly approved original underwriting can unlock a formal thesis update")
        if approved and ((company.get("selected_underwriting") or {}).get("approval") or {}).get("status") != "approved_by_user_or_pm":
            raise ValueError("Approved registry row does not contain explicit approval evidence")


def main() -> None:
    parser = argparse.ArgumentParser(description="Collect user/PM-approved original company underwriting")
    parser.add_argument("--date", required=True)
    parser.add_argument("--company-earnings-deep-dive-file")
    parser.add_argument("--input-root")
    parser.add_argument("--output-file")
    args = parser.parse_args()
    deep_dive_path = root_path(
        args.company_earnings_deep_dive_file,
        ROOT / "workspace" / "company_earnings_deep_dive" / args.date / "company_earnings_deep_dive.json",
    )
    if not deep_dive_path.exists():
        raise SystemExit(f"Company earnings deep dive does not exist: {deep_dive_path}")
    input_root = root_path(args.input_root, ROOT / "workspace" / "company_underwriting_inputs") if args.input_root else None
    records, errors = load_underwriting_inputs(args.date, input_root)
    payload = collect_company_underwriting(
        args.date, json.loads(deep_dive_path.read_text(encoding="utf-8")), records, errors,
    )
    output = root_path(
        args.output_file,
        ROOT / "workspace" / "company_underwriting" / args.date / "company_underwriting.json",
    )
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Company underwriting registry saved: {output.relative_to(ROOT)}")
    print(f"Approved underwriting: {payload['approved_count']}/{payload['company_count']}")


if __name__ == "__main__":
    main()
