"""Publish a reviewed Markdown brief as a child page of one private Notion page."""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parent
NOTION_VERSION = "2026-03-11"

# Notion has no page-wide CSS theme, so native heading and callout colors
# carry a consistent institutional market-brief visual language on all devices.
SECTION_COLORS = {
    "오늘의 결론": "blue",
    "데이터 기준과 수집 상태": "gray",
    "시장 스코어보드": "green",
    "전일 가설 점검": "orange",
    "향후 이벤트 시나리오": "purple",
    "가설 누적 성과": "gray",
    "거시 지표와 시장 맥락": "blue",
    "ETF 모니터링": "green",
    "해외 뉴스": "yellow",
    "국내 공시": "purple",
    "종목 및 공시": "red",
    "언더라이팅 승인 검토": "purple",
    "운영 설정 승인 검토": "blue",
    "운영 알림 모니터": "red",
    "회사 논리 검토 캘린더": "orange",
}

# Editorial card roles adapted from the broker-digest reference. Notion has
# no page-wide CSS, so native callouts and columns carry the visual hierarchy
# while remaining editable and responsive on mobile.
SECTION_CARD_STYLES = {
    "전일 가설 점검": ("🧪", "blue_background"),
    "향후 이벤트 시나리오": ("📅", "orange_background"),
    "가설 누적 성과": ("✅", "gray_background"),
    "다음 확인 항목": ("🔎", "gray_background"),
    "언더라이팅 승인 검토": ("🧾", "purple_background"),
    "운영 설정 승인 검토": ("⚙️", "blue_background"),
    "운영 알림 모니터": ("⏱️", "yellow_background"),
    "회사 논리 검토 캘린더": ("📅", "orange_background"),
}

# PowerShell's legacy CP949 console can fail while printing a valid UTF-8 brief.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")


def load_dotenv() -> None:
    env_file = ROOT / ".env"
    if not env_file.exists():
        return
    for raw in env_file.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if line and not line.startswith("#") and "=" in line:
            key, value = line.split("=", 1)
            os.environ.setdefault(key.strip(), value.strip().strip('"'))


def rich_text(content: str) -> list[dict]:
    """Return Notion rich text with real Markdown source hyperlinks.

    Notion accepts at most 2,000 characters in each text object.  The previous
    implementation kept only the first 1,900 characters and represented
    Markdown links as plain text.  Split long text and preserve link targets.
    """
    max_chars = 1900
    fragments: list[dict] = []

    def append_fragment(value: str, url: str | None = None) -> None:
        for start in range(0, len(value), max_chars):
            text: dict = {"content": value[start:start + max_chars]}
            if url:
                text["link"] = {"url": url}
            fragments.append({"type": "text", "text": text})

    cursor = 0
    for match in re.finditer(r"\[([^\]]+)\]\((https?://[^)]+)\)", content):
        append_fragment(content[cursor:match.start()])
        append_fragment(match.group(1), match.group(2))
        cursor = match.end()
    append_fragment(content[cursor:])
    return fragments


def callout_block(content: str, emoji: str, color: str = "gray_background") -> dict:
    return {
        "object": "block",
        "type": "callout",
        "callout": {
            "rich_text": rich_text(content),
            "icon": {"type": "emoji", "emoji": emoji},
            "color": color,
        },
    }


def column_list_block(cards: list[dict]) -> dict:
    """Arrange compact dashboard cards in responsive Notion columns."""
    return {
        "object": "block",
        "type": "column_list",
        "column_list": {
            "children": [
                {
                    "object": "block",
                    "type": "column",
                    "column": {"children": [card]},
                }
                for card in cards
            ],
        },
    }


def labeled_value(value: str) -> tuple[str, str]:
    label, separator, body = value.partition(":")
    return (label.strip(), body.strip()) if separator else ("", value.strip())


def hero_summary_blocks(items: list[str]) -> list[dict]:
    """Render the fixed decision labels as an editorial lead and signal strip."""
    parsed = dict(labeled_value(item) for item in items[:4])
    regime = parsed.get("시장 체제") or (items[0] if items else "자료 없음")
    conclusion = parsed.get("오늘의 결론") or (items[1] if len(items) > 1 else "자료 없음")
    key_variable = parsed.get("핵심 변수") or (items[2] if len(items) > 2 else "자료 없음")
    risk = parsed.get("최우선 리스크") or (items[3] if len(items) > 3 else "자료 없음")
    return [
        callout_block(f"오늘의 결론\n{conclusion}\n시장 체제 · {regime}", "🎯", "blue_background"),
        column_list_block([
            callout_block(f"시장 체제\n{regime}", "📊", "gray_background"),
            callout_block(f"핵심 변수\n{key_variable}", "🔎", "yellow_background"),
            callout_block(f"최우선 리스크\n{risk}", "⚠️", "red_background"),
        ]),
    ]


def scoreboard_blocks(items: list[str]) -> list[dict]:
    """Render market observations as readable two-column KPI rows.

    Four Notion columns looked compact in a mock-up but left too little width
    for direct metric labels on a desktop page. Two columns preserve the
    scorecard scan path and remain usable on mobile; the conclusion-like
    monitoring signal is intentionally a full-width annotation.
    """
    colors = ("green_background", "purple_background", "blue_background", "orange_background")
    icons = ("📈", "🌡️", "💹", "💰")
    metric_items: list[str] = []
    signal_items: list[str] = []
    for item in items:
        if item.startswith(("모니터링 신호:", "결론(모니터링 신호):", "결론:")):
            signal_items.append(item)
        else:
            metric_items.append(item)
    result: list[dict] = []
    for start in range(0, len(metric_items), 2):
        cards = [
            callout_block(item, icons[index % len(icons)], colors[index % len(colors)])
            for index, item in enumerate(metric_items[start:start + 2], start=start)
        ]
        # Notion requires a column_list to contain at least two columns.
        # Keep an odd final metric as a full-width card instead.
        result.append(column_list_block(cards) if len(cards) > 1 else cards[0])
    for item in signal_items:
        result.append(callout_block(item, "🔎", "gray_background"))
    return result


def compact_page_title(title: str) -> str:
    """Keep Notion's narrow page-title area readable on mobile.

    The complete date remains in the first report block.  This deliberately
    shortens only the native Notion page title, which otherwise wraps the year,
    date and the Korean word for report onto three separate lines.
    """
    report_date = title.removesuffix(" 리포트")
    try:
        year, month, day = report_date.split("-", 2)
    except ValueError:
        return title
    return f"{month}.{day} 리포트"


def report_masthead(title: str) -> dict:
    report_date = title.removesuffix(" 리포트")
    return column_list_block([
        callout_block(
            f"PB RESEARCH\nDAILY MARKET INTELLIGENCE\n{title}",
            "🗞️",
            "blue_background",
        ),
        callout_block(
            f"AS OF\n{report_date}\nINTERNAL MONITORING",
            "📅",
            "yellow_background",
        ),
    ])


def report_navigation() -> dict:
    return {"object": "block", "type": "table_of_contents", "table_of_contents": {"color": "gray"}}


def markdown_blocks(markdown: str) -> tuple[str, list[dict]]:
    title = "SEC Korean Brief"
    blocks: list[dict] = []
    paragraph_buffer: list[str] = []
    summary_buffer: list[str] = []
    scoreboard_buffer: list[str] = []
    current_section = ""
    section_item_count = 0

    def flush() -> None:
        if paragraph_buffer:
            text = " ".join(paragraph_buffer).strip()
            if text:
                blocks.append({"object": "block", "type": "paragraph", "paragraph": {"rich_text": rich_text(text)}})
            paragraph_buffer.clear()

    def flush_summary() -> None:
        if summary_buffer:
            hero_items = summary_buffer[:4]
            blocks.extend(hero_summary_blocks(hero_items))
            for item in summary_buffer[4:]:
                blocks.append({
                    "object": "block",
                    "type": "bulleted_list_item",
                    "bulleted_list_item": {"rich_text": rich_text(item)},
                })
            summary_buffer.clear()

    def flush_scoreboard() -> None:
        if scoreboard_buffer:
            blocks.extend(scoreboard_blocks(scoreboard_buffer))
            scoreboard_buffer.clear()

    def is_numbered_news_headline(value: str) -> bool:
        """Recognize a report item's `1)` / `1.` headline without a parser.

        The daily brief deliberately uses short numbered international-news
        headlines.  Rendering those as callouts gives the section the same
        scan-friendly card hierarchy as the report design, while the bullets
        below retain the source-backed summary and link.
        """
        return len(value) >= 3 and value[0].isdigit() and value[1] in ".)" and value[2].isspace()

    for raw in markdown.splitlines():
        indent = len(raw) - len(raw.lstrip())
        line = raw.strip()
        if not line:
            flush()
            if current_section != "오늘의 결론":
                flush_summary()
            flush_scoreboard()
            continue
        if line.startswith("<!--") and line.endswith("-->"):
            # Internal completion markers remain in the Markdown artifact only.
            flush()
            continue
        if line.startswith("# "):
            flush(); flush_summary(); flush_scoreboard(); title = line[2:].strip() or title
        elif line.startswith("### "):
            flush(); flush_summary(); flush_scoreboard(); blocks.append({"object": "block", "type": "heading_3", "heading_3": {"rich_text": rich_text(line[4:].strip())}})
        elif line.startswith("## "):
            flush(); flush_summary(); flush_scoreboard()
            if blocks:
                blocks.append({"object": "block", "type": "divider", "divider": {}})
            current_section = line[3:].strip()
            section_item_count = 0
            blocks.append({
                "object": "block",
                "type": "heading_2",
                "heading_2": {
                    "rich_text": rich_text(current_section),
                    "color": SECTION_COLORS.get(current_section, "default"),
                },
            })
        elif current_section == "해외 뉴스" and is_numbered_news_headline(line):
            flush(); flush_summary()
            blocks.append(callout_block(line, "📰", "yellow_background"))
        elif current_section == "국내 공시" and is_numbered_news_headline(line):
            flush(); flush_summary()
            blocks.append(callout_block(line, "📑", "purple_background"))
        elif current_section == "종목 및 공시" and indent == 0 and line.startswith("- "):
            # A filing ticker/title is the card heading; its indented
            # confirmed facts and monitoring notes remain readable bullets.
            flush(); flush_summary()
            empty_state = "없음" in line
            blocks.append(callout_block(
                line[2:].strip(),
                "✅" if empty_state else "📄",
                "gray_background" if empty_state else "red_background",
            ))
        elif line.startswith("- "):
            flush()
            if current_section == "오늘의 결론":
                summary_buffer.append(line[2:].strip())
            elif current_section == "시장 스코어보드":
                scoreboard_buffer.append(line[2:].strip())
            elif current_section == "데이터 기준과 수집 상태" and section_item_count == 0:
                blocks.append(callout_block(line[2:].strip(), "🕒", "gray_background"))
            elif current_section in SECTION_CARD_STYLES and indent == 0:
                icon, color = SECTION_CARD_STYLES[current_section]
                blocks.append(callout_block(line[2:].strip(), icon, color))
            else:
                blocks.append({"object": "block", "type": "bulleted_list_item", "bulleted_list_item": {"rich_text": rich_text(line[2:].strip())}})
            section_item_count += 1
        else:
            flush_summary(); flush_scoreboard()
            paragraph_buffer.append(line)
    flush(); flush_summary(); flush_scoreboard()
    return title, blocks


def archive_page(page_id: str, token: str) -> None:
    """Move a superseded page to Notion's trash using the current API field."""
    archive_body = json.dumps({"in_trash": True}).encode("utf-8")
    archive_request = Request(
        f"https://api.notion.com/v1/pages/{page_id}", method="PATCH", data=archive_body,
        headers={"Authorization": f"Bearer {token}", "Notion-Version": NOTION_VERSION, "Content-Type": "application/json"},
    )
    try:
        with urlopen(archive_request, timeout=30) as response:
            json.loads(response.read().decode("utf-8"))
    except HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise SystemExit(f"Archiving the old page failed (HTTP {exc.code}): {detail}") from exc
    print(f"Archived superseded page: {page_id}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Publish a reviewed Korean brief to Notion.")
    parser.add_argument("brief_markdown", help="Markdown brief produced after Codex review")
    parser.add_argument("--dry-run", action="store_true", help="Validate content locally without calling Notion")
    parser.add_argument("--archive-page-id", help="After a successful publish, archive this superseded Notion page ID")
    parser.add_argument("--archive-only-page-id", help="Archive one already-superseded page without publishing a new page")
    args = parser.parse_args()
    load_dotenv()

    token = os.getenv("NOTION_TOKEN", "").strip()
    if args.archive_only_page_id:
        if args.dry_run:
            print(f"Would archive superseded page: {args.archive_only_page_id}")
            return
        if not token:
            raise SystemExit("Set NOTION_TOKEN in .env before archiving a page.")
        archive_page(args.archive_only_page_id, token)
        return

    markdown = Path(args.brief_markdown).read_text(encoding="utf-8")
    title, children = markdown_blocks(markdown)
    if len(children) > 100:
        raise SystemExit("Brief has more than 100 blocks. Split it before publishing.")
    payload = {
        "parent": {"type": "page_id", "page_id": os.getenv("NOTION_PARENT_PAGE_ID", "")},
        "properties": {"title": {"title": rich_text(compact_page_title(title))}},
        "children": children,
    }
    if args.dry_run:
        print(json.dumps(payload, ensure_ascii=False, indent=2)); return

    parent = os.getenv("NOTION_PARENT_PAGE_ID", "").strip()
    if not token or not parent:
        raise SystemExit("Set NOTION_TOKEN and NOTION_PARENT_PAGE_ID in .env before publishing.")
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    request = Request(
        "https://api.notion.com/v1/pages", method="POST", data=body,
        headers={"Authorization": f"Bearer {token}", "Notion-Version": NOTION_VERSION, "Content-Type": "application/json"},
    )
    try:
        with urlopen(request, timeout=30) as response:
            result = json.loads(response.read().decode("utf-8"))
    except HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise SystemExit(f"Notion returned HTTP {exc.code}: {detail}") from exc
    print(f"Published: {result.get('url', '(Notion returned no URL)')}")
    if args.archive_page_id:
        archive_page(args.archive_page_id, token)


if __name__ == "__main__":
    main()
