"""Publish a V2 reader report to a separate Notion test page.

The publisher is intentionally opt-in.  It never updates, archives, or
replaces an existing page, and it does not participate in the production
daily-report path until that migration is approved separately.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path
from typing import Any
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from collectors.common import ROOT, load_dotenv
from compose_v2_reader_report import (
    SCHEMA_VERSION,
    load_json,
    validate_v2_reader_report,
)
from publish_to_notion import NOTION_VERSION, rich_text

MAX_CHILDREN_PER_PAGE = 100
TEST_TITLE_PREFIX = "[V2 TEST]"


if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")


def _plain_text(value: Any) -> str:
    text = re.sub(r"\*\*([^*]+)\*\*", r"\1", str(value or ""))
    return re.sub(r"\s+", " ", text).strip()


def _block(
    block_type: str,
    text: str = "",
    *,
    color: str | None = None,
) -> dict[str, Any]:
    body: dict[str, Any] = {"rich_text": rich_text(_plain_text(text))}
    if color:
        body["color"] = color
    return {
        "object": "block",
        "type": block_type,
        block_type: body,
    }


def _callout(
    text: str,
    *,
    emoji: str,
    color: str,
) -> dict[str, Any]:
    return {
        "object": "block",
        "type": "callout",
        "callout": {
            "rich_text": rich_text(_plain_text(text)),
            "icon": {"type": "emoji", "emoji": emoji},
            "color": color,
        },
    }


def _divider() -> dict[str, Any]:
    return {"object": "block", "type": "divider", "divider": {}}


def _heading(text: str, level: int = 2) -> dict[str, Any]:
    return _block(f"heading_{level}", text)


def _bullet(text: str) -> dict[str, Any]:
    return _block("bulleted_list_item", text)


def _source_bullet(source: dict[str, Any]) -> dict[str, Any]:
    title = _plain_text(source.get("title") or "공식 출처")
    as_of = f" · {source['as_of']}" if source.get("as_of") else ""
    return {
        "object": "block",
        "type": "bulleted_list_item",
        "bulleted_list_item": {
            "rich_text": [
                {
                    "type": "text",
                    "text": {
                        "content": title,
                        "link": {"url": str(source["url"])},
                    },
                },
                {
                    "type": "text",
                    "text": {"content": as_of},
                },
            ]
        },
    }


def notion_page_title(report: dict[str, Any]) -> str:
    report_date = str(report["report_date"])
    _, month, day = report_date.split("-", 2)
    return f"{TEST_TITLE_PREFIX} {month}.{day} Daily Market Intelligence"


def v2_report_blocks(report: dict[str, Any]) -> list[dict[str, Any]]:
    validate_v2_reader_report(report)
    blocks: list[dict[str, Any]] = [
        _callout(
            (
                "PB RESEARCH · V2 READER PREVIEW\n"
                f"{report['report_date']}\n"
                "검증된 정보만 포함한 테스트 발행본"
            ),
            emoji="🧭",
            color="blue_background",
        ),
        _heading("30초 결론"),
        _callout(
            "\n".join(
                f"{index}. {_plain_text(item)}"
                for index, item in enumerate(
                    report.get("executive_summary") or [],
                    start=1,
                )
            ),
            emoji="📌",
            color="blue_background",
        ),
    ]

    if report.get("today_changes"):
        blocks.extend([_divider(), _heading("오늘 달라진 것")])
        blocks.extend(_bullet(item) for item in report["today_changes"])

    if report.get("market_findings"):
        blocks.extend([_divider(), _heading("시장과 섹터 흐름")])
        for finding in report["market_findings"]:
            blocks.extend(
                [
                    _heading(str(finding["title"]), level=3),
                    _block("paragraph", str(finding["body"])),
                ]
            )

    blocks.extend([_divider(), _heading("검증된 핵심 사건")])
    if not report.get("verified_events"):
        blocks.append(
            _callout(
                (
                    "공식 원문 사실 확인과 구조화 추출을 모두 통과한 "
                    "신규 사건이 없어 미확인 기사와 관점은 제외했습니다."
                ),
                emoji="🔎",
                color="gray_background",
            )
        )
    for index, event in enumerate(report.get("verified_events") or [], start=1):
        blocks.extend(
            [
                _heading(f"{index}. {event['title']}", level=3),
                _callout(
                    "\n".join(
                        ["확인된 사실", *[f"• {fact}" for fact in event["facts"]]]
                    ),
                    emoji="✅",
                    color="green_background",
                ),
            ]
        )
        if event.get("expectation_gap"):
            blocks.append(
                _callout(
                    f"예상과 달라진 점\n{event['expectation_gap']}",
                    emoji="↔️",
                    color="yellow_background",
                )
            )
        if event.get("impact"):
            blocks.append(
                _callout(
                    f"시장 의미\n{event['impact']}",
                    emoji="📈",
                    color="purple_background",
                )
            )
        if event.get("measured_market_reaction"):
            blocks.append(
                _callout(
                    f"측정된 시장 반응\n{event['measured_market_reaction']}",
                    emoji="📊",
                    color="gray_background",
                )
            )

    if report.get("analyst_research"):
        blocks.extend([_divider(), _heading("애널리스트 리서치")])
        blocks.append(
            _callout(
                (
                    "사용자가 제공한 리서치 원문은 재배포하지 않고, "
                    "구조화된 요약과 점검 항목만 제시합니다."
                ),
                emoji="📚",
                color="gray_background",
            )
        )
        stance_labels = {
            "positive": "긍정",
            "neutral": "중립",
            "cautious": "경계",
            "negative": "부정",
        }
        for item in report["analyst_research"]:
            attribution = " · ".join(
                value
                for value in (item.get("publisher"), item.get("analyst"))
                if value
            )
            blocks.extend(
                [
                    _heading(
                        f"{attribution} — {item['title']}",
                        level=3,
                    ),
                    _callout(
                        (
                            "관점: "
                            f"{stance_labels.get(item.get('stance'), '중립')}\n"
                            f"{item['summary']}"
                        ),
                        emoji="📝",
                        color="blue_background",
                    ),
                ]
            )
            if item.get("key_claims"):
                blocks.append(_block("paragraph", "핵심 주장"))
                blocks.extend(
                    _bullet(claim) for claim in item["key_claims"]
                )
            if item.get("catalysts"):
                blocks.append(
                    _callout(
                        "촉매\n" + "\n".join(item["catalysts"]),
                        emoji="⚡",
                        color="green_background",
                    )
                )
            if item.get("risks"):
                blocks.append(
                    _callout(
                        "위험\n" + "\n".join(item["risks"]),
                        emoji="⚠️",
                        color="yellow_background",
                    )
                )
            source = item.get("source") or {}
            if source.get("url"):
                blocks.append(
                    _source_bullet(
                        {
                            "title": source.get("reference") or "원문",
                            "url": source["url"],
                        }
                    )
                )
            elif source.get("reference"):
                blocks.append(
                    _bullet(f"내부 참조: {source['reference']}")
                )

    korea = report.get("korea_connection") or {}
    blocks.extend(
        [
            _divider(),
            _heading("한국시장 연결"),
            _callout(
                str(korea.get("summary") or "검증된 국내시장 입력이 없습니다."),
                emoji="🇰🇷",
                color=(
                    "green_background"
                    if korea.get("status") == "available"
                    else "yellow_background"
                ),
            ),
        ]
    )
    for metric in korea.get("metrics") or []:
        change = metric.get("change_1d_pct")
        change_text = (
            f" · 1일 {float(change):+.2f}%"
            if isinstance(change, (int, float))
            else ""
        )
        blocks.append(
            _bullet(
                f"{metric['label']}: {float(metric['value']):,.2f} "
                f"{metric.get('unit') or ''}{change_text}"
            )
        )

    blocks.extend([_divider(), _heading("다음 24~72시간 확인사항")])
    blocks.extend(_bullet(item) for item in report.get("next_checks") or [])

    status = report.get("data_status") or {}
    blocks.extend(
        [
            _divider(),
            _heading("데이터 상태"),
            _callout(
                (
                    f"가격 기준일: {status.get('latest_price_as_of') or '확인 불가'}\n"
                    f"공식 사실 확인 사건: {int(status.get('verified_event_count') or 0)}건\n"
                    "한국시장 연결 데이터: "
                    + (
                        "충분"
                        if status.get("korea_data_status") == "available"
                        else "불충분"
                    )
                ),
                emoji="🗂️",
                color="gray_background",
            ),
        ]
    )

    if report.get("sources"):
        blocks.extend([_divider(), _heading("근거 링크")])
        blocks.extend(_source_bullet(source) for source in report["sources"])

    if len(blocks) > MAX_CHILDREN_PER_PAGE:
        raise ValueError(
            f"V2 Notion page exceeds {MAX_CHILDREN_PER_PAGE} blocks"
        )
    return blocks


def build_notion_payload(
    report: dict[str, Any],
    *,
    parent_page_id: str,
) -> dict[str, Any]:
    validate_v2_reader_report(report)
    parent = str(parent_page_id or "").strip()
    if not parent:
        raise ValueError("A V2 test parent page ID is required")
    return {
        "parent": {"type": "page_id", "page_id": parent},
        "properties": {
            "title": {"title": rich_text(notion_page_title(report))}
        },
        "children": v2_report_blocks(report),
    }


def notion_api_json(
    url: str,
    method: str,
    token: str,
    payload: dict[str, Any],
) -> dict[str, Any]:
    request = Request(
        url,
        method=method,
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {token}",
            "Notion-Version": NOTION_VERSION,
            "Content-Type": "application/json",
        },
    )
    with urlopen(request, timeout=45) as response:
        result = json.loads(response.read().decode("utf-8"))
    if not isinstance(result, dict):
        raise ValueError("Notion response must be a JSON object")
    return result


def _http_error_detail(error: HTTPError) -> str:
    try:
        body = error.read().decode("utf-8", errors="replace").strip()
    except (AttributeError, OSError):
        body = ""
    return f"HTTP {error.code}: {body[:1200]}" if body else f"HTTP {error.code}"


def _report_path(report_date: str) -> Path:
    return (
        ROOT
        / "workspace"
        / "v2_reader_reports"
        / report_date
        / "reader_report.json"
    )


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Publish a separate V2 reader preview to Notion"
    )
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--date", help="Report date in YYYY-MM-DD")
    source.add_argument("--report-json", help="Explicit V2 reader JSON path")
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument(
        "--dry-run",
        action="store_true",
        help="Validate and print a bounded payload summary without HTTP",
    )
    mode.add_argument(
        "--confirm-publish",
        action="store_true",
        help="Create one new [V2 TEST] child page",
    )
    args = parser.parse_args()
    load_dotenv()
    report_path = (
        _report_path(args.date)
        if args.date
        else Path(str(args.report_json)).resolve()
    )
    report = load_json(report_path)
    if report.get("schema_version") != SCHEMA_VERSION:
        raise SystemExit("The input is not a V2 reader report")
    parent = (
        os.getenv("NOTION_V2_TEST_PARENT_PAGE_ID", "").strip()
        or os.getenv("NOTION_PARENT_PAGE_ID", "").strip()
    )
    if not parent:
        raise SystemExit(
            "Set NOTION_V2_TEST_PARENT_PAGE_ID or NOTION_PARENT_PAGE_ID."
        )
    try:
        payload = build_notion_payload(report, parent_page_id=parent)
    except (ValueError, KeyError, TypeError) as exc:
        raise SystemExit(f"V2 Notion payload validation failed: {exc}") from exc
    if args.dry_run:
        print(
            json.dumps(
                {
                    "status": "validated",
                    "title": notion_page_title(report),
                    "report_date": report["report_date"],
                    "block_count": len(payload["children"]),
                    "verified_event_count": len(
                        report.get("verified_events") or []
                    ),
                    "http_called": False,
                    "existing_page_mutated": False,
                },
                ensure_ascii=False,
                indent=2,
            )
        )
        return
    token = os.getenv("NOTION_TOKEN", "").strip()
    if not token:
        raise SystemExit("Set NOTION_TOKEN before publishing.")
    try:
        page = notion_api_json(
            "https://api.notion.com/v1/pages",
            "POST",
            token,
            payload,
        )
    except HTTPError as exc:
        raise SystemExit(
            f"V2 Notion test publish failed ({_http_error_detail(exc)})."
        ) from exc
    page_url = str(page.get("url") or "")
    if not page_url:
        raise SystemExit("Notion created no readable page URL.")
    print(f"Published V2 test page: {page_url}")
    github_output = os.getenv("GITHUB_OUTPUT", "").strip()
    if github_output:
        with Path(github_output).open("a", encoding="utf-8") as output:
            output.write(f"notion_v2_test_url={page_url}\n")


if __name__ == "__main__":
    main()
