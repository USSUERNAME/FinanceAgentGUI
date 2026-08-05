from __future__ import annotations

import unittest
from io import BytesIO
from zipfile import ZIP_DEFLATED, ZipFile

from collect_spy_holdings_membership import (
    MINIMUM_PROXY_HOLDINGS,
    build_membership_input,
    parse_spy_holdings,
)


def minimal_workbook(member_count: int = MINIMUM_PROXY_HOLDINGS) -> bytes:
    strings = [
        "Holdings:",
        "As of 23-Jul-2026",
        "Name",
        "Ticker",
        "Identifier",
        "SEDOL",
        "Weight",
        "Sector",
        "Shares Held",
        "Local Currency",
        "USD",
    ]
    for index in range(member_count):
        strings.extend([f"Company {index}", f"T{index:03d}", f"ID{index:03d}"])
    shared = "".join(
        f"<si><t>{value}</t></si>"
        for value in strings
    )
    sheet_rows = [
        '<row r="1"><c r="A1" t="s"><v>0</v></c>'
        '<c r="B1" t="s"><v>1</v></c></row>',
        '<row r="2">'
        '<c r="A2" t="s"><v>2</v></c><c r="B2" t="s"><v>3</v></c>'
        '<c r="C2" t="s"><v>4</v></c><c r="D2" t="s"><v>5</v></c>'
        '<c r="E2" t="s"><v>6</v></c><c r="F2" t="s"><v>7</v></c>'
        '<c r="G2" t="s"><v>8</v></c><c r="H2" t="s"><v>9</v></c>'
        '</row>',
    ]
    base = 11
    for index in range(member_count):
        name_index = base + index * 3
        ticker_index = name_index + 1
        identifier_index = name_index + 2
        row_number = index + 3
        sheet_rows.append(
            f'<row r="{row_number}">'
            f'<c r="A{row_number}" t="s"><v>{name_index}</v></c>'
            f'<c r="B{row_number}" t="s"><v>{ticker_index}</v></c>'
            f'<c r="C{row_number}" t="s"><v>{identifier_index}</v></c>'
            f'<c r="E{row_number}"><v>{1 / member_count}</v></c>'
            f'<c r="G{row_number}"><v>1000</v></c>'
            f'<c r="H{row_number}" t="s"><v>10</v></c>'
            "</row>"
        )
    output = BytesIO()
    with ZipFile(output, "w", ZIP_DEFLATED) as archive:
        archive.writestr(
            "xl/sharedStrings.xml",
            (
                '<?xml version="1.0" encoding="UTF-8"?>'
                '<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
                f"{shared}</sst>"
            ),
        )
        archive.writestr(
            "xl/worksheets/sheet1.xml",
            (
                '<?xml version="1.0" encoding="UTF-8"?>'
                '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
                f"<sheetData>{''.join(sheet_rows)}</sheetData></worksheet>"
            ),
        )
    return output.getvalue()


class SpyHoldingsMembershipTests(unittest.TestCase):
    def test_parses_daily_holdings_as_explicit_fund_proxy(self) -> None:
        as_of, members = parse_spy_holdings(minimal_workbook())
        self.assertEqual(as_of, "2026-07-23")
        self.assertEqual(len(members), MINIMUM_PROXY_HOLDINGS)
        self.assertEqual(members[0]["ticker"], "T000")
        self.assertEqual(members[0]["source_ids"], ["state_street_spy_daily_holdings"])

    def test_builds_valid_membership_contract(self) -> None:
        payload = build_membership_input("2026-07-27", minimal_workbook())
        source = payload["sources"][0]
        self.assertEqual(source["universe_id"], "sp500")
        self.assertEqual(source["membership_scope"], "fund_holdings_proxy")
        self.assertTrue(source["primary_source_confirmed"])

    def test_rejects_incomplete_holdings_download(self) -> None:
        with self.assertRaises(ValueError):
            parse_spy_holdings(minimal_workbook(MINIMUM_PROXY_HOLDINGS - 1))


if __name__ == "__main__":
    unittest.main()
