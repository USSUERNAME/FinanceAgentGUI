"""Collect State Street SPY holdings as an explicit S&P 500 fund proxy."""

from __future__ import annotations

import argparse
import json
import re
from datetime import date, datetime
from io import BytesIO
from pathlib import Path
from typing import Any, Callable
from urllib.request import Request, urlopen
from xml.etree import ElementTree
from zipfile import ZipFile

from build_us_equity_universe import (
    MEMBERSHIP_SCHEMA_VERSION,
    normalize_ticker,
    root_path,
    validate_membership_input,
)
from collectors.common import ROOT

SPY_PRODUCT_URL = (
    "https://www.ssga.com/us/en/intermediary/etfs/"
    "state-street-spdr-sp-500-etf-trust-spy"
)
SPY_HOLDINGS_URL = (
    "https://www.ssga.com/library-content/products/fund-data/etfs/us/"
    "holdings-daily-us-en-spy.xlsx"
)
SOURCE_ID = "state_street_spy_daily_holdings"
MINIMUM_PROXY_HOLDINGS = 450
XML_NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"


def fetch_binary(url: str) -> bytes:
    request = Request(url, headers={"User-Agent": "pb-daily-market-brief/1.0"})
    with urlopen(request, timeout=45) as response:
        return response.read()


def column_index(reference: str) -> int:
    letters = "".join(character for character in reference if character.isalpha())
    result = 0
    for character in letters.upper():
        result = result * 26 + ord(character) - ord("A") + 1
    return max(result - 1, 0)


def shared_strings(archive: ZipFile) -> list[str]:
    try:
        root = ElementTree.fromstring(archive.read("xl/sharedStrings.xml"))
    except KeyError:
        return []
    return [
        "".join(node.text or "" for node in item.iter(f"{XML_NS}t"))
        for item in root.findall(f"{XML_NS}si")
    ]


def cell_text(cell: ElementTree.Element, strings: list[str]) -> str:
    if cell.get("t") == "inlineStr":
        return "".join(node.text or "" for node in cell.iter(f"{XML_NS}t")).strip()
    value = cell.find(f"{XML_NS}v")
    if value is None or value.text is None:
        return ""
    if cell.get("t") == "s":
        return strings[int(value.text)].strip()
    return value.text.strip()


def workbook_rows(content: bytes) -> list[list[str]]:
    with ZipFile(BytesIO(content)) as archive:
        strings = shared_strings(archive)
        sheet = ElementTree.fromstring(archive.read("xl/worksheets/sheet1.xml"))
    rows: list[list[str]] = []
    for row in sheet.iter(f"{XML_NS}row"):
        cells: dict[int, str] = {}
        for cell in row.findall(f"{XML_NS}c"):
            cells[column_index(str(cell.get("r") or "A1"))] = cell_text(cell, strings)
        if not cells:
            rows.append([])
            continue
        rows.append([cells.get(index, "") for index in range(max(cells) + 1)])
    return rows


def parse_as_of(value: str) -> str:
    text = str(value or "").strip()
    text = re.sub(r"^As of\s+", "", text, flags=re.IGNORECASE)
    for pattern in ("%d-%b-%Y", "%Y-%m-%d", "%b %d %Y"):
        try:
            return datetime.strptime(text, pattern).date().isoformat()
        except ValueError:
            continue
    raise ValueError("SPY holdings workbook has an unsupported as-of date")


def parse_spy_holdings(content: bytes) -> tuple[str, list[dict[str, Any]]]:
    rows = workbook_rows(content)
    as_of = ""
    header_index = -1
    headers: dict[str, int] = {}
    for index, row in enumerate(rows):
        if len(row) >= 2 and str(row[0]).strip().casefold() == "holdings:":
            as_of = parse_as_of(row[1])
        normalized = {str(value).strip().casefold(): position for position, value in enumerate(row)}
        if "ticker" in normalized and "name" in normalized and "weight" in normalized:
            header_index = index
            headers = normalized
            break
    if not as_of or header_index < 0:
        raise ValueError("SPY holdings workbook is missing its as-of date or header")

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
        name_position = headers["name"]
        identifier_position = headers.get("identifier")
        weight_position = headers["weight"]
        try:
            weight = float(row[weight_position])
        except (IndexError, TypeError, ValueError):
            continue
        if weight <= 0:
            continue
        seen.add(ticker)
        members.append({
            "ticker": ticker,
            "company_name": row[name_position].strip() if name_position < len(row) else None,
            "identifier": (
                row[identifier_position].strip()
                if identifier_position is not None and identifier_position < len(row)
                else None
            ),
            "weight_pct": round(weight, 6),
            "source_ids": [SOURCE_ID],
        })
    if len(members) < MINIMUM_PROXY_HOLDINGS:
        raise ValueError(
            f"SPY holdings proxy is incomplete: {len(members)} "
            f"< {MINIMUM_PROXY_HOLDINGS}"
        )
    return as_of, members


def build_membership_input(report_date: str, content: bytes) -> dict[str, Any]:
    as_of, members = parse_spy_holdings(content)
    if date.fromisoformat(as_of) > date.fromisoformat(report_date):
        raise ValueError("SPY holdings cannot be dated after the report")
    payload = {
        "schema_version": MEMBERSHIP_SCHEMA_VERSION,
        "report_date": report_date,
        "sources": [{
            "source_id": SOURCE_ID,
            "universe_id": "sp500",
            "membership_scope": "fund_holdings_proxy",
            "provider": "State Street SPDR",
            "source_url": SPY_PRODUCT_URL,
            "download_url": SPY_HOLDINGS_URL,
            "source_grade": "A",
            "primary_source_confirmed": True,
            "as_of": as_of,
            "expected_refresh_days": 7,
            "rights_label": "provider_permitted_internal_research",
        }],
        "members": members,
        "lineage_note": (
            "SPY daily fund holdings are used as an explicit S&P 500 proxy. "
            "The raw workbook is not redistributed."
        ),
    }
    validate_membership_input(payload, report_date)
    return payload


def collect_spy_membership(
    report_date: str,
    *,
    fetcher: Callable[[str], bytes] = fetch_binary,
) -> dict[str, Any]:
    return build_membership_input(report_date, fetcher(SPY_HOLDINGS_URL))


def main() -> None:
    parser = argparse.ArgumentParser(description="Collect the official SPY holdings proxy")
    parser.add_argument("--date", required=True)
    parser.add_argument("--input-file")
    parser.add_argument("--output-file")
    args = parser.parse_args()
    try:
        content = (
            root_path(args.input_file, Path(args.input_file)).read_bytes()
            if args.input_file
            else fetch_binary(SPY_HOLDINGS_URL)
        )
        payload = build_membership_input(args.date, content)
    except Exception as exc:
        print(
            "SPY holdings membership unavailable | "
            f"error_type={type(exc).__name__}"
        )
        return
    output = root_path(
        args.output_file,
        ROOT / "workspace" / "us_equity_universe_inputs" / args.date / "index_membership.json",
    )
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(
        f"SPY holdings membership saved: {output.relative_to(ROOT)} | "
        f"members={len(payload['members'])} | as_of={payload['sources'][0]['as_of']}"
    )


if __name__ == "__main__":
    main()
