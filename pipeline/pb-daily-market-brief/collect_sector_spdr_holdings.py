"""Collect official Select Sector SPDR holdings as sector membership proxies."""

from __future__ import annotations

import argparse
import json
from datetime import date
from pathlib import Path
from typing import Any, Callable

from build_us_equity_universe import normalize_ticker, root_path
from collect_spy_holdings_membership import (
    fetch_binary,
    parse_as_of,
    workbook_rows,
)
from collectors.common import ROOT
from us_market_panel import SECTOR_ETFS

SCHEMA_VERSION = "us_sector_holdings_proxy.v1"
MINIMUM_SECTOR_HOLDINGS = 15
HOLDINGS_URL_TEMPLATE = (
    "https://www.ssga.com/library-content/products/fund-data/etfs/us/"
    "holdings-daily-us-en-{ticker}.xlsx"
)
PRODUCT_URL_TEMPLATE = "https://www.ssga.com/mainfund/{ticker}"


def parse_sector_holdings(
    content: bytes,
    sector_ticker: str,
) -> tuple[str, list[dict[str, Any]]]:
    rows = workbook_rows(content)
    as_of = ""
    header_index = -1
    headers: dict[str, int] = {}
    for index, row in enumerate(rows):
        if len(row) >= 2 and str(row[0]).strip().casefold() == "holdings:":
            as_of = parse_as_of(row[1])
        normalized = {
            str(value).strip().casefold(): position
            for position, value in enumerate(row)
        }
        if "ticker" in normalized and "name" in normalized and "weight" in normalized:
            header_index = index
            headers = normalized
            break
    if not as_of or header_index < 0:
        raise ValueError(
            f"{sector_ticker} holdings workbook is missing its as-of date or header"
        )

    members: list[dict[str, Any]] = []
    seen: set[str] = set()
    for row in rows[header_index + 1:]:
        ticker_position = headers["ticker"]
        if ticker_position >= len(row):
            continue
        ticker = normalize_ticker(row[ticker_position])
        if not ticker or ticker in seen:
            continue
        currency_position = headers.get("local currency")
        if (
            currency_position is not None
            and currency_position < len(row)
            and row[currency_position]
            and row[currency_position].upper() != "USD"
        ):
            continue
        try:
            weight = float(row[headers["weight"]])
        except (IndexError, TypeError, ValueError):
            continue
        if weight <= 0:
            continue
        name_position = headers["name"]
        seen.add(ticker)
        members.append({
            "ticker": ticker,
            "company_name": (
                row[name_position].strip()
                if name_position < len(row)
                else None
            ),
            "weight_pct": round(weight, 6),
        })
    if len(members) < MINIMUM_SECTOR_HOLDINGS:
        raise ValueError(
            f"{sector_ticker} holdings proxy is incomplete: "
            f"{len(members)} < {MINIMUM_SECTOR_HOLDINGS}"
        )
    return as_of, members


def collect_sector_memberships(
    report_date: str,
    *,
    fetcher: Callable[[str], bytes] = fetch_binary,
) -> dict[str, Any]:
    sectors = []
    failures = []
    for ticker, sector_name in SECTOR_ETFS.items():
        holdings_url = HOLDINGS_URL_TEMPLATE.format(ticker=ticker.lower())
        try:
            as_of, members = parse_sector_holdings(fetcher(holdings_url), ticker)
            if date.fromisoformat(as_of) > date.fromisoformat(report_date):
                raise ValueError("holdings cannot be dated after the report")
            sectors.append({
                "sector_ticker": ticker,
                "sector_name": sector_name,
                "membership_scope": "select_sector_fund_holdings_proxy",
                "provider": "State Street SPDR",
                "source_url": PRODUCT_URL_TEMPLATE.format(ticker=ticker),
                "download_url": holdings_url,
                "source_grade": "A",
                "primary_source_confirmed": True,
                "as_of": as_of,
                "members": members,
            })
        except Exception as exc:
            failures.append({
                "sector_ticker": ticker,
                "error_type": type(exc).__name__,
            })
    covered = len(sectors)
    return {
        "schema_version": SCHEMA_VERSION,
        "report_date": report_date,
        "collection_status": (
            "ready"
            if covered == len(SECTOR_ETFS)
            else "partial"
            if covered
            else "blocked"
        ),
        "coverage": {
            "required_sector_count": len(SECTOR_ETFS),
            "available_sector_count": covered,
            "missing_sector_tickers": sorted(
                set(SECTOR_ETFS) - {row["sector_ticker"] for row in sectors}
            ),
        },
        "sectors": sectors,
        "failures": failures,
        "lineage_note": (
            "Select Sector SPDR daily holdings are explicit fund proxies for "
            "the eleven S&P 500 sectors. Raw workbooks are not redistributed."
        ),
    }


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Collect official Select Sector SPDR holdings proxies"
    )
    parser.add_argument("--date", required=True)
    parser.add_argument("--output-file")
    args = parser.parse_args()
    payload = collect_sector_memberships(args.date)
    output = root_path(
        args.output_file,
        ROOT / "workspace" / "us_sector_holdings" / args.date
        / "sector_holdings.json",
    )
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(
        f"Sector SPDR holdings saved: {output.relative_to(ROOT)} | "
        f"status={payload['collection_status']} | "
        f"coverage={payload['coverage']['available_sector_count']}/"
        f"{payload['coverage']['required_sector_count']}"
    )


if __name__ == "__main__":
    main()
