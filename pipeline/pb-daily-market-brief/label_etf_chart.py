"""Add Korean ETF descriptions to an already-generated dashboard without new API calls."""

from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image, ImageDraw

from collectors.common import ROOT, load_source_config
from generate_etf_chart import DASH_HEIGHT, HEADER_H, MARGIN_X, PANEL_GAP, WIDTH, font


def main() -> None:
    parser = argparse.ArgumentParser(description="Overlay Korean ETF descriptions onto an existing dashboard PNG.")
    parser.add_argument("--date", default="2026-07-16", help="Chart date in YYYY-MM-DD")
    args = parser.parse_args()
    output_dir = ROOT / "workspace" / "charts"
    source = output_dir / f"{args.date}_etf_dashboard.png"
    if not source.exists():
        raise SystemExit(f"Generate the ETF chart first: {source}")
    items = load_source_config().get("etf_watchlist", [])
    if len(items) != 10:
        raise SystemExit("The ETF chart expects exactly 10 entries in sources.json.")
    image = Image.open(source).convert("RGB")
    draw = ImageDraw.Draw(image)
    columns, rows = 5, 2
    panel_width = (WIDTH - MARGIN_X * 2 - PANEL_GAP * (columns - 1)) // columns
    panel_height = (DASH_HEIGHT - HEADER_H - 85 - PANEL_GAP) // rows
    description_font = font(17)
    for index, item in enumerate(items):
        col, row = index % columns, index // columns
        left = MARGIN_X + col * (panel_width + PANEL_GAP)
        top = HEADER_H + 35 + row * (panel_height + PANEL_GAP)
        # This is the single subtitle line in the deterministic chart layout.
        # Preserve the right-aligned 3-month return while replacing only the subtitle.
        draw.rectangle((left + 18, top + 52, left + panel_width - 112, top + 89), fill="#FFFFFF")
        draw.text((left + 24, top + 60), item["name"], fill="#475569", font=description_font)
    output = output_dir / f"{args.date}_etf_dashboard_labeled.png"
    image.save(output, format="PNG", optimize=True)
    print(f"Labeled ETF chart saved: {output.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
