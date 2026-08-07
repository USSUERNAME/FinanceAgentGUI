"""Render one mobile-readable Notion card for each selected international-news item."""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

from PIL import Image, ImageDraw

from collectors.common import ROOT
from generate_macro_chart import BG, BLUE, GRID, INK, MARGIN_X, MUTED, font


WIDTH, HEIGHT = 1080, 640
DEFAULT_CATEGORY = "주요 국제 이슈"
NUMBERED_ENTRY = r"(?m)^[ \t]*\d+[.)][ \t]+"


def wrap(draw: ImageDraw.ImageDraw, text: str, max_width: int, text_font) -> list[str]:
    words = text.split()
    lines, line = [], ""
    for word in words:
        candidate = f"{line} {word}".strip()
        if line and draw.textlength(candidate, font=text_font) > max_width:
            lines.append(line)
            line = word
        else:
            line = candidate
    if line:
        lines.append(line)
    return lines


def parse_cards(markdown: str) -> list[tuple[str, str, str]]:
    """Return category, Korean headline and bounded summary for up to three stories."""
    section = markdown.split("## 해외 뉴스", 1)[1]
    for next_heading in ("## 국내 공시", "## 종목 및 공시"):
        section = section.split(next_heading, 1)[0]
    category = DEFAULT_CATEGORY
    cards: list[tuple[str, str, str]] = []
    for group in re.split(r"(?m)^### ", section):
        lines = group.splitlines()
        if group != section and lines:
            category = lines[0].strip() or DEFAULT_CATEGORY
            group = "\n".join(lines[1:])
        for entry in re.split(NUMBERED_ENTRY, group)[1:]:
            entry_lines = [line.strip() for line in entry.splitlines() if line.strip()]
            if not entry_lines:
                continue
            title = entry_lines[0]
            summary = next((
                line.split(":", 1)[1].strip()
                for line in entry_lines
                if line.startswith(("- 제한된 요약:", "- 확인된 요약:"))
            ), "")
            cards.append((category, title, summary))
    return cards[:3]


def render_card(index: int, category: str, title: str, summary: str, report_date: str) -> Path:
    image = Image.new("RGB", (WIDTH, HEIGHT), BG)
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle((MARGIN_X, 38, WIDTH - MARGIN_X, HEIGHT - 42), radius=24, fill="#FFFFFF", outline=GRID, width=3)
    draw.ellipse((MARGIN_X + 34, 76, MARGIN_X + 108, 150), fill=BLUE)
    draw.text((MARGIN_X + 71, 113), str(index), fill="#FFFFFF", font=font(31, True), anchor="mm")
    draw.text((MARGIN_X + 138, 76), category, fill=BLUE, font=font(32, True))
    draw.text((MARGIN_X + 138, 120), f"기준일 {report_date} | NewsAPI 원문 링크 기준", fill=MUTED, font=font(23))

    text_x, max_width = MARGIN_X + 46, WIDTH - 2 * MARGIN_X - 92
    title_lines = wrap(draw, title, max_width, font(44, True))[:3]
    y = 210
    for line in title_lines:
        draw.text((text_x, y), line, fill=INK, font=font(44, True))
        y += 58
    y += 28
    summary_lines = wrap(draw, summary, max_width, font(31))[:4]
    for line in summary_lines:
        draw.text((text_x, y), line, fill=MUTED, font=font(31))
        y += 43
    draw.text((MARGIN_X + 46, HEIGHT - 82), "원문·이미지는 재게시하지 않으며, 본문 링크에서 확인합니다.", fill=MUTED, font=font(22))

    output = ROOT / "workspace" / "charts" / f"{report_date}_international_news_{index:02d}.png"
    output.parent.mkdir(parents=True, exist_ok=True)
    image.save(output, format="PNG", optimize=True)
    return output


def main() -> None:
    parser = argparse.ArgumentParser(description="Create mobile-readable Korean international-news cards from a daily brief.")
    parser.add_argument("brief_markdown")
    parser.add_argument("--date", required=True)
    args = parser.parse_args()
    cards = parse_cards(Path(args.brief_markdown).read_text(encoding="utf-8"))
    outputs = [render_card(index, category, title, summary, args.date) for index, (category, title, summary) in enumerate(cards, start=1)]
    manifest = ROOT / "workspace" / "charts" / f"{args.date}_international_news_manifest.json"
    manifest.write_text(json.dumps({"images": [str(path.relative_to(ROOT)) for path in outputs]}, ensure_ascii=False, indent=2), encoding="utf-8")
    if outputs:
        print(f"Mobile news cards saved: {len(outputs)}")
    else:
        print("No numbered news cards found; publishing the text-only overseas-news section.")


if __name__ == "__main__":
    main()
