"""Build a source-bounded U.S. equity screening universe."""

from __future__ import annotations

import argparse
import json
import re
from datetime import date
from pathlib import Path
from typing import Any

from collectors.common import ROOT
from sector_master import load_sector_master

SCHEMA_VERSION = "us_equity_universe.v1"
MEMBERSHIP_SCHEMA_VERSION = "us_index_membership_input.v1"
INDEX_IDS = {"sp500", "nasdaq100"}
MEMBERSHIP_SCOPES = {"index_constituents", "fund_holdings_proxy"}
ALLOWED_RIGHTS_LABELS = {
    "licensed_internal_use",
    "provider_permitted_internal_research",
    "user_supplied_authorized",
}
MINIMUM_COMPLETE_COUNTS = {"sp500": 450, "nasdaq100": 90}
TICKER_PATTERN = re.compile(r"^[A-Z][A-Z0-9.-]{0,9}$")

SECTOR_RESEARCH_ID_BY_ETF = {
    "XLC": "media_gaming_entertainment",
    "XLY": "consumer_discretionary_retail",
    "XLP": "consumer_staples_food_beverage",
    "XLE": "energy_oil_gas",
    "XLF": "financials_capital_markets",
    "XLV": "healthcare_services_medtech",
    "XLI": "industrials_machinery",
    "XLB": "metals_critical_materials",
    "XLRE": "real_estate_general",
    "XLK": "technology_hardware_services",
    "XLU": "utilities_power",
}


def root_path(value: str | None, default: Path) -> Path:
    path = Path(value) if value else default
    return path if path.is_absolute() else ROOT / path


def normalize_ticker(value: Any) -> str:
    ticker = str(value or "").strip().upper()
    return ticker if TICKER_PATTERN.fullmatch(ticker) else ""


def validate_membership_input(payload: dict[str, Any], report_date: str) -> None:
    if payload.get("schema_version") != MEMBERSHIP_SCHEMA_VERSION:
        raise ValueError("Unexpected U.S. index membership input schema")
    if payload.get("report_date") != report_date:
        raise ValueError("U.S. index membership report date does not match")
    report_day = date.fromisoformat(report_date)
    sources = payload.get("sources")
    members = payload.get("members")
    if not isinstance(sources, list) or not isinstance(members, list):
        raise ValueError("Membership input sources and members must be arrays")
    source_map: dict[str, dict[str, Any]] = {}
    for source in sources:
        source_id = str(source.get("source_id") or "").strip()
        if not source_id or source_id in source_map:
            raise ValueError("Membership sources require unique source_id values")
        if source.get("universe_id") not in INDEX_IDS:
            raise ValueError("Membership source has an unsupported universe_id")
        if source.get("membership_scope") not in MEMBERSHIP_SCOPES:
            raise ValueError("Membership source has an unsupported membership_scope")
        if source.get("primary_source_confirmed") is not True:
            raise ValueError("Membership source must retain primary-source lineage")
        if source.get("source_grade") not in {"A", "B"}:
            raise ValueError("Membership source must be grade A or B")
        if source.get("rights_label") not in ALLOWED_RIGHTS_LABELS:
            raise ValueError("Membership source is missing an accepted automation-rights label")
        if not str(source.get("source_url") or "").startswith("https://"):
            raise ValueError("Membership source URL must use https")
        as_of = date.fromisoformat(str(source.get("as_of") or ""))
        if as_of > report_day:
            raise ValueError("Membership source cannot be dated after the report")
        refresh_days = int(source.get("expected_refresh_days", 0))
        if refresh_days < 1 or refresh_days > 45:
            raise ValueError("Membership source expected_refresh_days must be between 1 and 45")
        source_map[source_id] = source
    seen: set[str] = set()
    for member in members:
        ticker = normalize_ticker(member.get("ticker"))
        if not ticker:
            raise ValueError("Membership member requires a valid ticker")
        if ticker in seen:
            raise ValueError(f"Duplicate membership ticker: {ticker}")
        seen.add(ticker)
        source_ids = member.get("source_ids")
        if not isinstance(source_ids, list) or not source_ids:
            raise ValueError(f"Membership member {ticker} requires source_ids")
        if any(str(source_id) not in source_map for source_id in source_ids):
            raise ValueError(f"Membership member {ticker} has an unresolved source_id")


def membership_rows(
    payload: dict[str, Any] | None,
    report_date: str,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    if payload is None:
        return [], []
    validate_membership_input(payload, report_date)
    report_day = date.fromisoformat(report_date)
    sources = {str(row["source_id"]): row for row in payload["sources"]}
    source_status: list[dict[str, Any]] = []
    for source in sources.values():
        age_days = (report_day - date.fromisoformat(str(source["as_of"]))).days
        source_status.append({
            **source,
            "age_days": age_days,
            "freshness_status": (
                "current"
                if age_days <= int(source["expected_refresh_days"]) else
                "stale"
            ),
        })
    rows: list[dict[str, Any]] = []
    for member in payload["members"]:
        source_ids = [str(value) for value in member["source_ids"]]
        linked = [sources[source_id] for source_id in source_ids]
        rows.append({
            "ticker": normalize_ticker(member["ticker"]),
            "company_name": member.get("company_name"),
            "exchange": member.get("exchange"),
            "cik": member.get("cik"),
            "index_memberships": sorted({str(source["universe_id"]) for source in linked}),
            "membership_scopes": sorted({str(source["membership_scope"]) for source in linked}),
            "source_ids": source_ids,
            "selection_reasons": ["verified_index_membership"],
        })
    return rows, source_status


def sector_membership_rows(
    payload: dict[str, Any] | None,
    report_date: str,
) -> list[dict[str, Any]]:
    """Translate official sector-fund holdings into auditable broad-sector IDs."""
    if payload is None:
        return []
    if payload.get("schema_version") != "us_sector_holdings_proxy.v1":
        raise ValueError("Unexpected U.S. sector holdings schema")
    report_day = date.fromisoformat(report_date)
    holdings_day = date.fromisoformat(str(payload.get("report_date") or ""))
    if holdings_day > report_day:
        raise ValueError("U.S. sector holdings cannot be dated after the report")
    rows: list[dict[str, Any]] = []
    for sector in payload.get("sectors", []):
        sector_ticker = normalize_ticker(sector.get("sector_ticker"))
        sector_id = SECTOR_RESEARCH_ID_BY_ETF.get(sector_ticker)
        if not sector_id:
            continue
        if sector.get("primary_source_confirmed") is not True:
            continue
        if sector.get("source_grade") not in {"A", "B"}:
            continue
        as_of = date.fromisoformat(str(sector.get("as_of") or ""))
        if as_of > report_day:
            raise ValueError("Sector holdings cannot be dated after the report")
        for member in sector.get("members", []):
            ticker = normalize_ticker(member.get("ticker"))
            if not ticker:
                continue
            rows.append({
                "ticker": ticker,
                "company_name": member.get("company_name"),
                "sector_ids": [sector_id],
                "sector_proxy_tickers": [sector_ticker],
                "selection_reasons": ["verified_sector_fund_membership"],
                "source_ids": [f"state_street_{sector_ticker.lower()}_daily_holdings"],
            })
    return rows


def latest_valid_sector_holdings(report_date: str) -> dict[str, Any] | None:
    """Return the newest non-empty official sector snapshot on or before the report date."""
    report_day = date.fromisoformat(report_date)
    holdings_root = ROOT / "workspace" / "us_sector_holdings"
    if not holdings_root.exists():
        return None
    for artifact in sorted(holdings_root.glob("*/sector_holdings.json"), reverse=True):
        try:
            payload = json.loads(artifact.read_text(encoding="utf-8"))
            artifact_day = date.fromisoformat(str(payload.get("report_date") or ""))
        except (OSError, ValueError, TypeError, json.JSONDecodeError):
            continue
        if artifact_day > report_day:
            continue
        if payload.get("schema_version") != "us_sector_holdings_proxy.v1":
            continue
        if not payload.get("sectors"):
            continue
        return payload
    return None


def configured_rows(
    targets: dict[str, Any],
    master: dict[str, Any],
    inbox: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for target in targets.get("targets", []):
        ticker = normalize_ticker(target.get("ticker"))
        if ticker:
            rows.append({
                "ticker": ticker,
                "company_name": target.get("name"),
                "cik": target.get("cik"),
                "selection_reasons": ["configured_watchlist"],
                "source_ids": ["internal:targets.json"],
            })
    for sector in master.get("sectors", []):
        for company in sector.get("representative_companies", []):
            if str(company.get("market") or "").upper() != "US":
                continue
            if str(company.get("instrument_type") or "").upper() != "EQUITY":
                continue
            ticker = normalize_ticker(company.get("ticker"))
            if ticker:
                rows.append({
                    "ticker": ticker,
                    "company_name": company.get("name"),
                    "sector_ids": [sector.get("sector_id")],
                    "selection_reasons": ["sector_representative"],
                    "source_ids": ["internal:sector_master.json"],
                })
    for record in inbox:
        if (
            record.get("source_id") != "sec_edgar"
            or record.get("primary_source_confirmed") is not True
            or record.get("source_grade") != "A"
        ):
            continue
        for value in record.get("tickers", []):
            ticker = normalize_ticker(value)
            if ticker:
                rows.append({
                    "ticker": ticker,
                    "company_name": None,
                    "selection_reasons": ["current_sec_filing"],
                    "source_ids": [str(record.get("id") or "sec_edgar")],
                    "event_source_urls": [record.get("url")] if record.get("url") else [],
                })
    return rows


def merge_rows(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    merged: dict[str, dict[str, Any]] = {}
    list_fields = {
        "index_memberships",
        "membership_scopes",
        "sector_ids",
        "selection_reasons",
        "source_ids",
        "event_source_urls",
        "sector_proxy_tickers",
    }
    for row in rows:
        ticker = row["ticker"]
        current = merged.setdefault(ticker, {
            "ticker": ticker,
            "company_name": None,
            "exchange": None,
            "cik": None,
            **{field: [] for field in sorted(list_fields)},
        })
        for field in ("company_name", "exchange", "cik"):
            if not current.get(field) and row.get(field):
                current[field] = row[field]
        for field in list_fields:
            values = row.get(field, [])
            current[field] = sorted({
                *current.get(field, []),
                *(str(value) for value in values if value),
            })
    reason_priority = {
        "current_sec_filing": 0,
        "configured_watchlist": 1,
        "verified_index_membership": 2,
        "sector_representative": 3,
    }
    return sorted(
        merged.values(),
        key=lambda row: (
            min((reason_priority.get(reason, 9) for reason in row["selection_reasons"]), default=9),
            row["ticker"],
        ),
    )


def build_us_equity_universe(
    report_date: str,
    targets: dict[str, Any],
    master: dict[str, Any],
    inbox: list[dict[str, Any]],
    membership_input: dict[str, Any] | None = None,
    sector_holdings: dict[str, Any] | None = None,
) -> dict[str, Any]:
    index_rows, source_status = membership_rows(membership_input, report_date)
    securities = merge_rows([
        *index_rows,
        *sector_membership_rows(sector_holdings, report_date),
        *configured_rows(targets, master, inbox),
    ])
    membership_counts = {
        index_id: sum(index_id in row["index_memberships"] for row in securities)
        for index_id in sorted(INDEX_IDS)
    }
    current_sources = {
        row["universe_id"]
        for row in source_status
        if row["freshness_status"] == "current"
    }
    full_scan_ready = all(
        index_id in current_sources
        and membership_counts[index_id] >= MINIMUM_COMPLETE_COUNTS[index_id]
        for index_id in INDEX_IDS
    )
    status = (
        "complete"
        if full_scan_ready else
        "partial"
        if securities else
        "blocked"
    )
    result = {
        "schema_version": SCHEMA_VERSION,
        "report_date": report_date,
        "collection_status": status,
        "full_index_scan_ready": full_scan_ready,
        "security_count": len(securities),
        "membership_counts": membership_counts,
        "selection_reason_counts": {
            reason: sum(reason in row["selection_reasons"] for row in securities)
            for reason in (
                "current_sec_filing",
                "configured_watchlist",
                "verified_index_membership",
                "sector_representative",
            )
        },
        "membership_sources": source_status,
        "securities": securities,
        "gates": {
            "sp500_minimum_count": MINIMUM_COMPLETE_COUNTS["sp500"],
            "nasdaq100_minimum_count": MINIMUM_COMPLETE_COUNTS["nasdaq100"],
            "current_membership_source_required": True,
            "price_and_volume_snapshot_connected": False,
            "decision_limit": (
                "This artifact defines the screening population only. It does not "
                "rank stocks or create an investment recommendation."
            ),
        },
        "data_gaps": [
            *(
                []
                if full_scan_ready else
                ["A current, authorized S&P 500 and Nasdaq-100 membership input is incomplete or absent."]
            ),
            "A licensed batch price and volume source is not connected to this universe yet.",
            "Index membership does not prove company-specific investment merit.",
        ],
        "posture": "screening_universe_not_investment_recommendation",
    }
    validate_us_equity_universe(result)
    return result


def validate_us_equity_universe(payload: dict[str, Any]) -> None:
    if payload.get("schema_version") != SCHEMA_VERSION:
        raise ValueError("Unexpected U.S. equity universe schema")
    securities = payload.get("securities", [])
    if int(payload.get("security_count", -1)) != len(securities):
        raise ValueError("U.S. equity universe security count does not match")
    tickers = [row.get("ticker") for row in securities]
    if len(tickers) != len(set(tickers)):
        raise ValueError("U.S. equity universe contains duplicate tickers")
    if any(not normalize_ticker(ticker) for ticker in tickers):
        raise ValueError("U.S. equity universe contains an invalid ticker")
    if payload.get("full_index_scan_ready") is True:
        for index_id, minimum in MINIMUM_COMPLETE_COUNTS.items():
            if int(payload.get("membership_counts", {}).get(index_id, 0)) < minimum:
                raise ValueError("Full index scan cannot be ready with incomplete membership")


def main() -> None:
    parser = argparse.ArgumentParser(description="Build the U.S. equity screening universe")
    parser.add_argument("--date", required=True)
    parser.add_argument("--inbox-file")
    parser.add_argument("--membership-input")
    parser.add_argument("--sector-holdings-file")
    parser.add_argument("--output-file")
    args = parser.parse_args()
    inbox_path = root_path(
        args.inbox_file,
        ROOT / "workspace" / "triaged" / args.date / "triaged_inbox.json",
    )
    membership_path = root_path(
        args.membership_input,
        ROOT / "workspace" / "us_equity_universe_inputs" / args.date / "index_membership.json",
    )
    if not inbox_path.exists():
        raise SystemExit(f"Triaged inbox does not exist: {inbox_path}")
    membership_input = (
        json.loads(membership_path.read_text(encoding="utf-8"))
        if membership_path.exists() else None
    )
    if args.sector_holdings_file:
        sector_holdings_path = root_path(args.sector_holdings_file, ROOT)
        sector_holdings = (
            json.loads(sector_holdings_path.read_text(encoding="utf-8"))
            if sector_holdings_path.exists() else None
        )
    else:
        sector_holdings = latest_valid_sector_holdings(args.date)
    payload = build_us_equity_universe(
        args.date,
        json.loads((ROOT / "targets.json").read_text(encoding="utf-8")),
        load_sector_master(),
        json.loads(inbox_path.read_text(encoding="utf-8")),
        membership_input,
        sector_holdings,
    )
    output = root_path(
        args.output_file,
        ROOT / "workspace" / "us_equity_universe" / args.date / "us_equity_universe.json",
    )
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"U.S. equity universe saved: {output.relative_to(ROOT)}")
    print(
        f"U.S. equity universe status: {payload['collection_status']} | "
        f"securities={payload['security_count']} | "
        f"full_scan_ready={payload['full_index_scan_ready']}"
    )


if __name__ == "__main__":
    main()
