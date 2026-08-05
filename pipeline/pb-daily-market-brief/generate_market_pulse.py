"""Render a compact market-pulse and seven-day event calendar for the brief."""

from __future__ import annotations

import argparse
import os
from datetime import date, timedelta
from pathlib import Path

from PIL import Image, ImageDraw

from collectors.common import ROOT, load_dotenv, load_source_config
from generate_macro_chart import BG, BLUE, GREEN, GRID, INK, MARGIN_X, MUTED, font, observations

WIDTH, HEIGHT = 2000, 1120
CARD_GAP, CARD_TOP, CARD_H = 24, 160, 255
RED, AMBER = "#DC2626", "#D97706"


def percent_change(values: list[tuple[date, float]]) -> float:
    return (values[-1][1] / values[-2][1] - 1) * 100


def draw_pulse_card(
    draw: ImageDraw.ImageDraw,
    box: tuple[int, int, int, int],
    label: str,
    value: str,
    delta: str,
    positive: bool,
    as_of: date,
) -> None:
    left, top, right, bottom = box
    accent = GREEN if positive else RED
    draw.rounded_rectangle(box, radius=18, fill="#FFFFFF", outline=GRID, width=2)
    draw.rounded_rectangle((left, top, left + 7, bottom), radius=4, fill=accent)
    draw.text((left + 28, top + 28), label, fill=MUTED, font=font(22, True))
    draw.text((left + 28, top + 82), value, fill=INK, font=font(39, True))
    draw.text((left + 28, top + 147), delta, fill=accent, font=font(25, True))
    draw.text((left + 28, bottom - 42), f"as of {as_of.isoformat()}", fill=MUTED, font=font(17))


def event_color(category: str) -> str:
    return {"실적": "#7C3AED", "거시": BLUE, "정책": AMBER}.get(category, "#475569")


def draw_events(draw: ImageDraw.ImageDraw, events: list[dict[str, str]], report_date: date) -> None:
    top = 500
    draw.text((MARGIN_X, top), "향후 7일 주요 일정", fill=INK, font=font(38, True))
    draw.text((MARGIN_X, top + 56), "원출처와 검증 상태를 등록한 일정만 표시합니다. 일정 목록은 sources.json에서 직접 관리합니다.", fill=MUTED, font=font(20))
    row_top = top + 115
    if not events:
        draw.rounded_rectangle((MARGIN_X, row_top, WIDTH - MARGIN_X, row_top + 140), radius=16, fill="#FFFFFF", outline=GRID, width=2)
        draw.text((MARGIN_X + 32, row_top + 50), "등록된 확정 일정이 없습니다.", fill=MUTED, font=font(26))
        return
    for index, event in enumerate(events[:5]):
        y = row_top + index * 105
        color = event_color(event.get("category", ""))
        draw.rounded_rectangle((MARGIN_X, y, WIDTH - MARGIN_X, y + 82), radius=14, fill="#FFFFFF", outline=GRID, width=2)
        draw.rounded_rectangle((MARGIN_X + 18, y + 18, MARGIN_X + 170, y + 64), radius=18, fill=color)
        draw.text((MARGIN_X + 94, y + 30), event.get("category", "Event"), fill="#FFFFFF", font=font(17, True), anchor="ma")
        event_date = date.fromisoformat(event["date"])
        draw.text((MARGIN_X + 200, y + 19), event_date.strftime("%m/%d"), fill=INK, font=font(27, True))
        draw.text((MARGIN_X + 300, y + 23), event.get("title", ""), fill=INK, font=font(24, True))
        right_text = " | ".join(filter(None, [event.get("time", ""), event.get("source", "")]))
        draw.text((WIDTH - MARGIN_X - 24, y + 30), right_text, fill=MUTED, font=font(18), anchor="ra")


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate the top market pulse and upcoming-events image.")
    parser.add_argument("--date", default=date.today().isoformat(), help="Report date in YYYY-MM-DD")
    args = parser.parse_args()
    report_date = date.fromisoformat(args.date)
    load_dotenv()
    fred_key = os.getenv("FRED_API_KEY", "").strip()
    if not fred_key:
        raise SystemExit("Set FRED_API_KEY in .env before generating the market pulse.")

    # Use FRED rather than additional Alpha Vantage symbols.  The ETF
    # dashboard already consumes the free Alpha Vantage request quota; sharing
    # its quota with five more pulse symbols made the scheduled run unreliable.
    pulse_series = [
        ("SP500", "S&P 500", "{:,.2f}", "percent"),
        ("NASDAQCOM", "Nasdaq Composite", "{:,.2f}", "percent"),
        ("DGS10", "US 10Y Treasury yield", "{:.2f}%", "basis_points"),
        ("DTWEXBGS", "US dollar index", "{:.2f}", "percent"),
        ("DCOILWTICO", "WTI oil", "${:,.2f}", "percent"),
    ]
    cards: list[tuple[str, str, str, bool, date]] = []
    for series_id, label, value_format, delta_mode in pulse_series:
        values = observations(series_id, fred_key, (report_date - timedelta(days=45)).isoformat())
        if len(values) < 2:
            raise SystemExit(f"FRED returned insufficient observations for {series_id}.")
        if delta_mode == "basis_points":
            change = (values[-1][1] - values[-2][1]) * 100
            delta = f"1D {change:+.1f} bp"
        else:
            change = percent_change(values)
            delta = f"1D {change:+.2f}%"
        cards.append((label, value_format.format(values[-1][1]), delta, change >= 0, values[-1][0]))

    config = load_source_config()
    end_date = report_date + timedelta(days=7)
    events = [
        item for item in config.get("market_calendar", [])
        if report_date <= date.fromisoformat(item["date"]) <= end_date
    ]
    events.sort(key=lambda item: item["date"])

    image = Image.new("RGB", (WIDTH, HEIGHT), BG)
    draw = ImageDraw.Draw(image)
    draw.text((MARGIN_X, 42), "MARKET PULSE", fill=INK, font=font(46, True))
    draw.text((MARGIN_X, 105), f"기준일 {report_date.isoformat()} | 1일 변화 | FRED 관측치", fill=MUTED, font=font(22))
    card_width = (WIDTH - MARGIN_X * 2 - CARD_GAP * 4) // 5
    for index, card in enumerate(cards):
        left = MARGIN_X + index * (card_width + CARD_GAP)
        draw_pulse_card(draw, (left, CARD_TOP, left + card_width, CARD_TOP + CARD_H), *card)
    draw_events(draw, events, report_date)
    draw.text((MARGIN_X, HEIGHT - 34), "시장 데이터: FRED 일별 관측치. 일정의 원출처는 각 항목에 표시됩니다.", fill=MUTED, font=font(16))
    output_dir = ROOT / "workspace" / "charts"
    output_dir.mkdir(parents=True, exist_ok=True)
    output = output_dir / f"{report_date}_market_pulse.png"
    image.save(output, format="PNG", optimize=True)
    print(f"Market pulse saved: {output.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
