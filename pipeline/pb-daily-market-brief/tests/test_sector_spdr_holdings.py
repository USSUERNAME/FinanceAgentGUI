from __future__ import annotations

import unittest
from io import BytesIO
from zipfile import ZIP_DEFLATED, ZipFile

from collect_sector_spdr_holdings import (
    MINIMUM_SECTOR_HOLDINGS,
    collect_sector_memberships,
    parse_sector_holdings,
)
from us_market_panel import SECTOR_ETFS


def minimal_workbook(member_count: int = MINIMUM_SECTOR_HOLDINGS) -> bytes:
    strings = [
        "Holdings:",
        "As of 23-Jul-2026",
        "Name",
        "Ticker",
        "Weight",
        "Local Currency",
        "USD",
    ]
    for index in range(member_count):
        strings.extend([f"Company {index}", f"T{index:03d}"])
    shared = "".join(f"<si><t>{value}</t></si>" for value in strings)
    sheet_rows = [
        '<row r="1"><c r="A1" t="s"><v>0</v></c>'
        '<c r="B1" t="s"><v>1</v></c></row>',
        '<row r="2"><c r="A2" t="s"><v>2</v></c>'
        '<c r="B2" t="s"><v>3</v></c>'
        '<c r="C2" t="s"><v>4</v></c>'
        '<c r="D2" t="s"><v>5</v></c></row>',
    ]
    base = 7
    for index in range(member_count):
        name_index = base + index * 2
        ticker_index = name_index + 1
        row_number = index + 3
        sheet_rows.append(
            f'<row r="{row_number}">'
            f'<c r="A{row_number}" t="s"><v>{name_index}</v></c>'
            f'<c r="B{row_number}" t="s"><v>{ticker_index}</v></c>'
            f'<c r="C{row_number}"><v>{1 / member_count}</v></c>'
            f'<c r="D{row_number}" t="s"><v>6</v></c>'
            "</row>"
        )
    output = BytesIO()
    with ZipFile(output, "w", ZIP_DEFLATED) as archive:
        archive.writestr(
            "xl/sharedStrings.xml",
            (
                '<?xml version="1.0" encoding="UTF-8"?>'
                '<sst xmlns="http://schemas.openxmlformats.org/'
                'spreadsheetml/2006/main">'
                f"{shared}</sst>"
            ),
        )
        archive.writestr(
            "xl/worksheets/sheet1.xml",
            (
                '<?xml version="1.0" encoding="UTF-8"?>'
                '<worksheet xmlns="http://schemas.openxmlformats.org/'
                'spreadsheetml/2006/main">'
                f"<sheetData>{''.join(sheet_rows)}</sheetData></worksheet>"
            ),
        )
    return output.getvalue()


class SectorSpdrHoldingsTests(unittest.TestCase):
    def test_parses_sector_holdings_proxy(self) -> None:
        as_of, members = parse_sector_holdings(minimal_workbook(), "XLK")
        self.assertEqual(as_of, "2026-07-23")
        self.assertEqual(len(members), MINIMUM_SECTOR_HOLDINGS)
        self.assertEqual(members[0]["ticker"], "T000")

    def test_collects_all_eleven_sector_proxies(self) -> None:
        calls = []

        def fetcher(url: str) -> bytes:
            calls.append(url)
            return minimal_workbook()

        payload = collect_sector_memberships("2026-07-27", fetcher=fetcher)
        self.assertEqual(payload["collection_status"], "ready")
        self.assertEqual(len(calls), len(SECTOR_ETFS))
        self.assertEqual(
            payload["coverage"]["available_sector_count"],
            len(SECTOR_ETFS),
        )
        self.assertEqual(
            {row["sector_ticker"] for row in payload["sectors"]},
            set(SECTOR_ETFS),
        )

    def test_one_failed_sector_is_partial_not_global_failure(self) -> None:
        def fetcher(url: str) -> bytes:
            if "xlk.xlsx" in url:
                raise OSError("fixture failure")
            return minimal_workbook()

        payload = collect_sector_memberships("2026-07-27", fetcher=fetcher)
        self.assertEqual(payload["collection_status"], "partial")
        self.assertEqual(payload["coverage"]["missing_sector_tickers"], ["XLK"])


if __name__ == "__main__":
    unittest.main()
