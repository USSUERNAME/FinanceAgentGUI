"""Render a compact FRED macro dashboard as a PNG for the daily Notion report."""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode

from PIL import Image, ImageDraw, ImageFont

from collectors.common import get_json, load_dotenv, load_source_config, ROOT

WIDTH, HEIGHT = 1600, 1050
MARGIN_X, HEADER_H = 85, 145
PANEL_GAP = 45
BG, INK, MUTED, GRID, BLUE, GREEN = "#F8FAFC", "#0F172A", "#475569", "#CBD5E1", "#2563EB", "#059669"
FRED_OBSERVATION_CACHE_SCHEMA = "fred_observation_cache.v1"
FRED_OBSERVATION_CACHE_DIR = ROOT / "workspace" / "fred_cache" / "observations"


def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    """Load a Korean-capable font on both Windows and GitHub's Ubuntu runner.

    The cards are generated in GitHub Actions, not on the author's PC.  Pillow
    silently falls back to its bitmap default font when it cannot find a font;
    that fallback has no Hangul glyphs, so Korean appears as square boxes in
    the published PNGs.  Noto Sans CJK is installed by the workflow below.
    """
    candidates = [
        Path("C:/Windows/Fonts") / ("malgunbd.ttf" if bold else "malgun.ttf"),
        Path("C:/Windows/Fonts") / ("arialbd.ttf" if bold else "arial.ttf"),
        Path("/usr/share/fonts/opentype/noto") / ("NotoSansCJK-Bold.ttc" if bold else "NotoSansCJK-Regular.ttc"),
        Path("/usr/share/fonts/truetype/noto") / ("NotoSansCJK-Bold.ttc" if bold else "NotoSansCJK-Regular.ttc"),
    ]
    for candidate in candidates:
        if candidate.exists():
            return ImageFont.truetype(str(candidate), size)
    return ImageFont.load_default()


def _observation_rows(payload: dict[str, object]) -> list[tuple[date, float]]:
    rows: list[tuple[date, float]] = []
    for item in payload.get("observations", []):
        if not isinstance(item, dict) or item.get("value") in {".", ""}:
            continue
        rows.append((date.fromisoformat(str(item["date"])), float(item["value"])))
    return rows


def _observation_cache_path(series_id: str, cache_dir: Path) -> Path:
    safe_id = "".join(character for character in series_id if character.isalnum() or character in {"_", "-"})
    if not safe_id:
        raise ValueError("FRED series ID is invalid")
    return cache_dir / f"{safe_id}.json"


def _write_observation_cache(
    series_id: str,
    rows: list[tuple[date, float]],
    *,
    cache_dir: Path,
) -> None:
    cache_dir.mkdir(parents=True, exist_ok=True)
    cache_path = _observation_cache_path(series_id, cache_dir)
    payload = {
        "schema_version": FRED_OBSERVATION_CACHE_SCHEMA,
        "series_id": series_id,
        "fetched_at": datetime.now(timezone.utc).isoformat(),
        "observations": [
            {"date": observation_date.isoformat(), "value": value}
            for observation_date, value in rows
        ],
    }
    temporary = cache_path.with_suffix(f"{cache_path.suffix}.tmp-{os.getpid()}")
    temporary.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    temporary.replace(cache_path)


def _read_observation_cache(
    series_id: str,
    start: str,
    *,
    cache_dir: Path,
) -> list[tuple[date, float]]:
    cache_path = _observation_cache_path(series_id, cache_dir)
    try:
        payload = json.loads(cache_path.read_text(encoding="utf-8"))
        if (
            payload.get("schema_version") != FRED_OBSERVATION_CACHE_SCHEMA
            or payload.get("series_id") != series_id
        ):
            return []
        start_date = date.fromisoformat(start)
        return [
            row
            for row in _observation_rows(payload)
            if row[0] >= start_date
        ]
    except (OSError, UnicodeDecodeError, json.JSONDecodeError, TypeError, ValueError, KeyError):
        return []


def observations(
    series_id: str,
    api_key: str,
    start: str,
    *,
    attempts: int = 3,
    retry_delay_seconds: float = 1.0,
    cache_dir: Path = FRED_OBSERVATION_CACHE_DIR,
) -> list[tuple[date, float]]:
    query = urlencode({
        "series_id": series_id, "api_key": api_key, "file_type": "json",
        "observation_start": start, "sort_order": "asc",
    })
    last_error: Exception | None = None
    for attempt in range(max(1, attempts)):
        try:
            rows = _observation_rows(
                get_json(
                    f"https://api.stlouisfed.org/fred/series/observations?{query}"
                )
            )
            if rows:
                _write_observation_cache(series_id, rows, cache_dir=cache_dir)
            return rows
        except (HTTPError, URLError, TimeoutError, OSError) as exc:
            last_error = exc
            if attempt + 1 < max(1, attempts) and retry_delay_seconds > 0:
                time.sleep(retry_delay_seconds)

    cached = _read_observation_cache(series_id, start, cache_dir=cache_dir)
    if cached:
        latest = cached[-1][0].isoformat()
        print(
            f"WARNING: FRED {series_id} request failed; "
            f"using cached observations through {latest}.",
            file=sys.stderr,
        )
        return cached
    if last_error is not None:
        raise last_error
    return []


def draw_panel(draw: ImageDraw.ImageDraw, box: tuple[int, int, int, int], label: str, unit: str, values: list[tuple[date, float]]) -> None:
    left, top, right, bottom = box
    draw.rounded_rectangle(box, radius=18, fill="#FFFFFF", outline=GRID, width=2)
    label_font, value_font, small_font = font(25, True), font(42, True), font(19)
    latest_date, latest_value = values[-1]
    previous_value = values[-2][1] if len(values) > 1 else latest_value
    delta = latest_value - previous_value
    delta_text = f"{delta:+.2f} vs prior" if len(values) > 1 else "first observation"
    draw.text((left + 28, top + 24), label, fill=INK, font=label_font)
    draw.text((left + 28, top + 61), f"{latest_value:,.2f}", fill=INK, font=value_font)
    unit_x = left + 28 + int(draw.textlength(f"{latest_value:,.2f}", font=value_font)) + 12
    draw.text((unit_x, top + 82), unit, fill=MUTED, font=small_font)
    draw.text((left + 28, top + 125), f"{latest_date.isoformat()} | {delta_text}", fill=GREEN if delta >= 0 else BLUE, font=small_font)

    chart = (left + 30, top + 175, right - 30, bottom - 58)
    x0, y0, x1, y1 = chart
    series_values = [value for _, value in values]
    lo, hi = min(series_values), max(series_values)
    pad = max((hi - lo) * 0.12, 0.1)
    lo, hi = lo - pad, hi + pad
    for i in range(4):
        y = y0 + (y1 - y0) * i / 3
        draw.line((x0, y, x1, y), fill=GRID, width=1)
        value = hi - (hi - lo) * i / 3
        draw.text((x0 - 4, y - 12), f"{value:.1f}", fill=MUTED, font=small_font, anchor="ra")
    points: list[tuple[float, float]] = []
    for index, (_, value) in enumerate(values):
        x = x0 + (x1 - x0) * index / max(len(values) - 1, 1)
        y = y1 - (value - lo) / max(hi - lo, 0.001) * (y1 - y0)
        points.append((x, y))
    if len(points) > 1:
        draw.line(points, fill=BLUE, width=5, joint="curve")
    end_x, end_y = points[-1]
    draw.ellipse((end_x - 7, end_y - 7, end_x + 7, end_y + 7), fill=GREEN, outline="#FFFFFF", width=2)
    for fraction, text in [(0, values[0][0].strftime("%Y-%m")), (0.5, values[len(values)//2][0].strftime("%Y-%m")), (1, latest_date.strftime("%Y-%m"))]:
        draw.text((x0 + (x1 - x0) * fraction, y1 + 16), text, fill=MUTED, font=small_font, anchor="ma")


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate a four-panel FRED macro chart for a report.")
    parser.add_argument("--date", default=date.today().isoformat(), help="Report date in YYYY-MM-DD")
    parser.add_argument("--months", type=int, default=18, help="Historical window to draw")
    args = parser.parse_args()
    load_dotenv()
    api_key = os.getenv("FRED_API_KEY", "").strip()
    if not api_key:
        raise SystemExit("Set FRED_API_KEY in .env before generating a macro chart.")
    report_date = date.fromisoformat(args.date)
    start = (report_date - timedelta(days=args.months * 31)).isoformat()
    config = load_source_config()
    series = config.get("fred_series", [])
    if len(series) != 4:
        raise SystemExit("The chart currently expects exactly four fred_series entries in sources.json.")

    image = Image.new("RGB", (WIDTH, HEIGHT), BG)
    draw = ImageDraw.Draw(image)
    draw.text((MARGIN_X, 42), "미국 거시 모니터링", fill=INK, font=font(46, True))
    draw.text((MARGIN_X, 100), f"기준일 {report_date.isoformat()} | FRED 관측치 | 최근 {args.months}개월", fill=MUTED, font=font(23))
    panel_width = (WIDTH - MARGIN_X * 2 - PANEL_GAP) // 2
    panel_height = (HEIGHT - HEADER_H - 80 - PANEL_GAP) // 2
    for index, info in enumerate(series):
        values = observations(info["id"], api_key, start)
        if len(values) < 2:
            raise SystemExit(f"FRED returned insufficient observations for {info['id']}.")
        col, row = index % 2, index // 2
        left = MARGIN_X + col * (panel_width + PANEL_GAP)
        top = HEADER_H + 35 + row * (panel_height + PANEL_GAP)
        draw_panel(draw, (left, top, left + panel_width, top + panel_height), info.get("chart_label", info["label"]), info.get("unit", ""), values)
    draw.text((MARGIN_X, HEIGHT - 34), "Source: Federal Reserve Bank of St. Louis (FRED). Values are observations, not investment recommendations.", fill=MUTED, font=font(17))
    output_dir = ROOT / "workspace" / "charts"
    output_dir.mkdir(parents=True, exist_ok=True)
    output = output_dir / f"{args.date}_macro_dashboard.png"
    image.save(output, format="PNG", optimize=True)
    print(f"Chart saved: {output.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
