"""Render a ten-ETF, three-month price dashboard from Alpha Vantage daily data."""

from __future__ import annotations

import argparse
import json
import os
import shutil
import time
from datetime import date, timedelta
from pathlib import Path
from typing import Any
from urllib.parse import urlencode

from PIL import Image, ImageDraw

from collectors.common import ROOT, get_json, load_dotenv, load_source_config
from generate_macro_chart import BG, BLUE, GREEN, GRID, HEIGHT, INK, MARGIN_X, MUTED, font

WIDTH, DASH_HEIGHT = 2000, 1320
PANEL_GAP, HEADER_H = 35, 150
DEFAULT_REQUEST_DELAY_SECONDS = 13.0
MAX_CACHE_AGE_DAYS = 4


def return_for_sessions(prices: list[tuple[date, float]], sessions: int) -> float:
    """Calculate a close-to-close return using trading sessions, not calendar days."""
    if len(prices) <= sessions:
        return 0.0
    return (prices[-1][1] / prices[-1 - sessions][1] - 1) * 100


def heat_color(value: float) -> tuple[str, str]:
    """Return a readable red/green heatmap fill and text colour for a return."""
    magnitude = min(abs(value) / 10, 1.0)
    if value >= 0:
        start, end = (220, 252, 231), (22, 101, 52)
    else:
        start, end = (254, 226, 226), (185, 28, 28)
    rgb = tuple(int(start[i] + (end[i] - start[i]) * magnitude) for i in range(3))
    return "#%02X%02X%02X" % rgb, "#FFFFFF" if magnitude >= 0.58 else INK


def draw_relative_strength(
    report_date: str,
    series: list[tuple[dict[str, str], list[tuple[date, float]]]],
) -> Path:
    """Save a mobile-readable 10-ETF return heatmap beside the line dashboard."""
    width, height = 1600, 1060
    image = Image.new("RGB", (width, height), BG)
    draw = ImageDraw.Draw(image)
    draw.text((MARGIN_X, 42), "ETF 상대강도 히트맵", fill=INK, font=font(46, True))
    draw.text((MARGIN_X, 102), f"기준일 {report_date} | 종가 기준 절대 수익률 | 색이 진할수록 변동폭이 큼", fill=MUTED, font=font(22))
    left, top = MARGIN_X, 180
    ticker_w, name_w, price_w, cell_w = 150, 350, 230, 220
    headers = [("Ticker", ticker_w), ("ETF", name_w), ("Last", price_w), ("1D", cell_w), ("1W", cell_w), ("3M", cell_w)]
    x = left
    for label, column_w in headers:
        draw.rounded_rectangle((x, top, x + column_w - 8, top + 58), radius=10, fill="#E2E8F0")
        draw.text((x + 18, top + 17), label, fill=INK, font=font(20, True))
        x += column_w
    row_h = 72
    for row, (item, prices) in enumerate(series):
        y = top + 72 + row * row_h
        if row % 2 == 0:
            draw.rounded_rectangle((left, y, width - MARGIN_X, y + row_h - 6), radius=10, fill="#FFFFFF")
        values = [return_for_sessions(prices, sessions) for sessions in (1, 5, 62)]
        draw.text((left + 18, y + 20), item["ticker"], fill=INK, font=font(22, True))
        draw.text((left + ticker_w + 18, y + 22), item["name"], fill=MUTED, font=font(18))
        draw.text((left + ticker_w + name_w + price_w - 18, y + 20), f"${prices[-1][1]:,.2f}", fill=INK, font=font(21, True), anchor="ra")
        cell_x = left + ticker_w + name_w + price_w
        for value in values:
            fill, text_color = heat_color(value)
            draw.rounded_rectangle((cell_x, y + 6, cell_x + cell_w - 12, y + row_h - 12), radius=10, fill=fill)
            draw.text((cell_x + (cell_w - 12) / 2, y + 22), f"{value:+.2f}%", fill=text_color, font=font(21, True), anchor="ma")
            cell_x += cell_w
    draw.text((MARGIN_X, height - 70), "1D = 직전 거래일 대비, 1W = 5거래일 대비, 3M = 약 3개월(62거래일) 대비. 수익률은 분배금·세금·환율을 반영하지 않습니다.", fill=MUTED, font=font(17))
    draw.text((MARGIN_X, height - 34), "Source: Alpha Vantage daily close. 상대 비교용 관찰 자료이며 투자 권유가 아닙니다.", fill=MUTED, font=font(17))
    output_dir = ROOT / "workspace" / "charts"
    output_dir.mkdir(parents=True, exist_ok=True)
    output = output_dir / f"{report_date}_etf_relative_strength.png"
    image.save(output, format="PNG", optimize=True)
    return output


def daily_prices(ticker: str, api_key: str) -> list[tuple[date, float]]:
    query = urlencode({"function": "TIME_SERIES_DAILY", "symbol": ticker, "outputsize": "compact", "apikey": api_key})
    payload = get_json(f"https://www.alphavantage.co/query?{query}")
    error = payload.get("Information") or payload.get("Note") or payload.get("Error Message")
    if error:
        # Provider notices can echo an API key. Never print them to the console.
        raise RuntimeError(f"{ticker}: Alpha Vantage returned a rate-limit or provider error")
    series = payload.get("Time Series (Daily)", {})
    values = [(date.fromisoformat(day), float(row["4. close"])) for day, row in series.items()]
    if len(values) < 30:
        raise RuntimeError(f"{ticker}: insufficient daily observations")
    return sorted(values)[-63:]  # roughly three trading months


def metric_row(item: dict[str, str], prices: list[tuple[date, float]]) -> dict[str, Any]:
    """Return the deterministic market fields used by the daily snapshot."""
    return {
        "ticker": item["ticker"],
        "name": item["name"],
        "as_of": prices[-1][0].isoformat(),
        "close": prices[-1][1],
        "previous_close": prices[-2][1],
        "close_5_sessions_ago": prices[-6][1],
        "close_20_sessions_ago": prices[-21][1],
        "return_1d_pct": return_for_sessions(prices, 1),
        "return_5d_pct": return_for_sessions(prices, 5),
        "return_20d_pct": return_for_sessions(prices, 20),
        "return_62d_pct": return_for_sessions(prices, 62),
        "source": "Alpha Vantage TIME_SERIES_DAILY close",
        "market_cutoff": "previous_available_close",
    }


def reuse_latest_cached_outputs(
    report_date: str,
    items: list[dict[str, str]],
    *,
    reason: str,
) -> tuple[Path, Path, Path]:
    target_date = date.fromisoformat(report_date)
    expected_tickers = {item["ticker"] for item in items}
    market_data_root = ROOT / "workspace" / "market_data"
    candidates: list[tuple[date, Path, dict[str, Any]]] = []
    if market_data_root.exists():
        for path in market_data_root.glob("*/etf_metrics.json"):
            try:
                source_date = date.fromisoformat(path.parent.name)
                payload = json.loads(path.read_text(encoding="utf-8-sig"))
            except (ValueError, OSError, json.JSONDecodeError):
                continue
            age = target_date - source_date
            if age < timedelta(0) or age > timedelta(days=MAX_CACHE_AGE_DAYS):
                continue
            rows = payload.get("items") or []
            if {str(row.get("ticker") or "") for row in rows} != expected_tickers:
                continue
            if not all(row.get("as_of") and row.get("close") for row in rows):
                continue
            candidates.append((source_date, path, payload))
    if not candidates:
        raise RuntimeError(
            "Alpha Vantage failed and no complete ETF cache is available"
        )

    source_date, metrics_path, payload = max(
        candidates,
        key=lambda candidate: candidate[0],
    )
    charts_dir = ROOT / "workspace" / "charts"
    source_dashboard = charts_dir / f"{source_date.isoformat()}_etf_dashboard.png"
    source_heatmap = (
        charts_dir / f"{source_date.isoformat()}_etf_relative_strength.png"
    )
    if not source_dashboard.exists() or not source_heatmap.exists():
        raise RuntimeError(
            "Alpha Vantage failed and the latest ETF cache has no chart images"
        )

    target_dashboard = charts_dir / f"{report_date}_etf_dashboard.png"
    target_heatmap = charts_dir / f"{report_date}_etf_relative_strength.png"
    if source_dashboard.resolve() != target_dashboard.resolve():
        shutil.copy2(source_dashboard, target_dashboard)
    if source_heatmap.resolve() != target_heatmap.resolve():
        shutil.copy2(source_heatmap, target_heatmap)

    output_dir = market_data_root / report_date
    output_dir.mkdir(parents=True, exist_ok=True)
    output = output_dir / "etf_metrics.json"
    cached_items = []
    for row in payload["items"]:
        cached_items.append(
            {
                **row,
                "source": f"{row.get('source') or 'Alpha Vantage'} (cached)",
                "market_cutoff": "cached_previous_available_close",
            }
        )
    output.write_text(
        json.dumps(
            {
                **payload,
                "report_date": report_date,
                "evidence_label": "fact_provider_standardized_cached",
                "items": cached_items,
                "cache_status": {
                    "status": "reused_due_provider_error",
                    "source_report_date": source_date.isoformat(),
                    "age_calendar_days": (target_date - source_date).days,
                    "reason": reason,
                },
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    return target_dashboard, target_heatmap, output


def draw_panel(draw: ImageDraw.ImageDraw, box: tuple[int, int, int, int], item: dict[str, str], prices: list[tuple[date, float]]) -> None:
    left, top, right, bottom = box
    draw.rounded_rectangle(box, radius=16, fill="#FFFFFF", outline=GRID, width=2)
    ticker_font, name_font, value_font, small_font = font(28, True), font(17), font(30, True), font(17)
    first_date, first = prices[0]
    last_date, last = prices[-1]
    change = (last / first - 1) * 100
    color = GREEN if change >= 0 else "#DC2626"
    draw.text((left + 24, top + 20), item["ticker"], fill=INK, font=ticker_font)
    draw.text((left + 24, top + 60), item["name"], fill=MUTED, font=name_font)
    draw.text((right - 24, top + 23), f"${last:,.2f}", fill=INK, font=value_font, anchor="ra")
    draw.text((right - 24, top + 64), f"3M {change:+.1f}%", fill=color, font=small_font, anchor="ra")
    x0, y0, x1, y1 = left + 24, top + 110, right - 24, bottom - 47
    values = [value for _, value in prices]
    low, high = min(values), max(values)
    padding = max((high - low) * 0.1, 0.01)
    low, high = low - padding, high + padding
    for fraction in (0, 0.5, 1):
        y = y0 + (y1 - y0) * fraction
        draw.line((x0, y, x1, y), fill=GRID, width=1)
    points = []
    for index, (_, value) in enumerate(prices):
        x = x0 + (x1 - x0) * index / (len(prices) - 1)
        y = y1 - (value - low) / max(high - low, 0.001) * (y1 - y0)
        points.append((x, y))
    draw.line(points, fill=BLUE, width=4, joint="curve")
    x, y = points[-1]
    draw.ellipse((x - 6, y - 6, x + 6, y + 6), fill=color, outline="#FFFFFF", width=2)
    draw.text((x0, y1 + 15), first_date.strftime("%m-%d"), fill=MUTED, font=small_font)
    draw.text((x1, y1 + 15), last_date.strftime("%m-%d"), fill=MUTED, font=small_font, anchor="ra")


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate a 10-ETF liquidity sample dashboard.")
    parser.add_argument("--date", default=date.today().isoformat(), help="Report date in YYYY-MM-DD")
    args = parser.parse_args()
    load_dotenv()
    api_key = os.getenv("ALPHAVANTAGE_API_KEY", "").strip()
    if not api_key:
        raise SystemExit("Set ALPHAVANTAGE_API_KEY in .env before generating an ETF chart.")
    items: list[dict[str, str]] = load_source_config().get("etf_watchlist", [])
    if len(items) != 10:
        raise SystemExit("The ETF chart expects exactly 10 entries in sources.json.")
    series: list[tuple[dict[str, str], list[tuple[date, float]]]] = []
    request_delay = float(os.getenv("ALPHAVANTAGE_REQUEST_DELAY_SECONDS", str(DEFAULT_REQUEST_DELAY_SECONDS)))
    try:
        for index, item in enumerate(items):
            series.append((item, daily_prices(item["ticker"], api_key)))
            if index < len(items) - 1:
                # The free tier permits only a small number of requests per
                # minute.  The pipeline takes about two minutes, but is far more
                # reliable than a burst that fails after the first few ETFs.
                time.sleep(request_delay)
    except RuntimeError as exc:
        output, heatmap, metrics_output = reuse_latest_cached_outputs(
            args.date,
            items,
            reason=str(exc),
        )
        print(
            "Alpha Vantage unavailable; reused the latest complete ETF cache "
            f"for {args.date}."
        )
        print(f"ETF chart saved: {output.relative_to(ROOT)}")
        print(f"ETF heatmap saved: {heatmap.relative_to(ROOT)}")
        print(f"ETF metrics saved: {metrics_output.relative_to(ROOT)}")
        return

    image = Image.new("RGB", (WIDTH, DASH_HEIGHT), BG)
    draw = ImageDraw.Draw(image)
    draw.text((MARGIN_X, 42), "미국 ETF 대표 거래활성 샘플", fill=INK, font=font(46, True))
    draw.text((MARGIN_X, 100), f"기준일 {args.date} | 최근 약 3개월 일별 종가 | 가격은 수정주가가 아닌 종가", fill=MUTED, font=font(23))
    columns, rows = 5, 2
    panel_width = (WIDTH - MARGIN_X * 2 - PANEL_GAP * (columns - 1)) // columns
    panel_height = (DASH_HEIGHT - HEADER_H - 85 - PANEL_GAP) // rows
    for index, (item, prices) in enumerate(series):
        col, row = index % columns, index // columns
        left = MARGIN_X + col * (panel_width + PANEL_GAP)
        top = HEADER_H + 35 + row * (panel_height + PANEL_GAP)
        draw_panel(draw, (left, top, left + panel_width, top + panel_height), item, prices)
    draw.text((MARGIN_X, DASH_HEIGHT - 33), "Source: Alpha Vantage daily close. The sample favors liquid, unlevered ETFs to avoid split-driven distortion; it is not a current ranking or investment recommendation.", fill=MUTED, font=font(16))
    output_dir = ROOT / "workspace" / "charts"
    output_dir.mkdir(parents=True, exist_ok=True)
    output = output_dir / f"{args.date}_etf_dashboard.png"
    image.save(output, format="PNG", optimize=True)
    heatmap = draw_relative_strength(args.date, series)
    metrics_dir = ROOT / "workspace" / "market_data" / args.date
    metrics_dir.mkdir(parents=True, exist_ok=True)
    metrics_output = metrics_dir / "etf_metrics.json"
    metrics_output.write_text(json.dumps({
        "report_date": args.date,
        "source_grade": "B",
        "primary_source_confirmed": False,
        "evidence_label": "fact_provider_standardized",
        "items": [metric_row(item, prices) for item, prices in series],
    }, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"ETF chart saved: {output.relative_to(ROOT)}")
    print(f"ETF heatmap saved: {heatmap.relative_to(ROOT)}")
    print(f"ETF metrics saved: {metrics_output.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
