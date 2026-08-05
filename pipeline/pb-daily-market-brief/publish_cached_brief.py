"""Publish a previously validated daily brief without recollecting market data."""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from datetime import date
from pathlib import Path
from typing import Any

from collectors.common import ROOT


def available_report_dates(root: Path = ROOT) -> list[str]:
    result = []
    for path in (root / "workspace" / "briefs").glob("*_리포트.md"):
        prefix = path.name[:10]
        try:
            date.fromisoformat(prefix)
        except ValueError:
            continue
        result.append(prefix)
    return sorted(set(result))


def cached_publish_command(
    report_date: str,
    *,
    root: Path = ROOT,
    dry_run: bool = False,
) -> list[str]:
    brief = root / "workspace" / "briefs" / f"{report_date}_리포트.md"
    chart_dir = root / "workspace" / "charts"
    manifest = chart_dir / f"{report_date}_international_news_manifest.json"
    required = [
        brief,
        chart_dir / f"{report_date}_market_pulse.png",
        chart_dir / f"{report_date}_macro_dashboard.png",
        chart_dir / f"{report_date}_etf_dashboard_labeled.png",
        chart_dir / f"{report_date}_etf_relative_strength.png",
        manifest,
    ]
    missing = [str(path.relative_to(root)) for path in required if not path.exists()]
    if missing:
        raise FileNotFoundError(
            "Cached publication bundle is incomplete: " + ", ".join(missing)
        )
    manifest_payload: dict[str, Any] = json.loads(manifest.read_text(encoding="utf-8"))
    news_images = [str(value) for value in manifest_payload.get("images", [])]
    missing_news = [
        value
        for value in news_images
        if not (root / value).exists()
    ]
    if missing_news:
        raise FileNotFoundError(
            "Cached news images are incomplete: " + ", ".join(missing_news)
        )
    command = [
        sys.executable,
        "publish_visual_brief.py",
        str(brief.relative_to(root)),
        "--pulse-image",
        str(required[1].relative_to(root)),
        "--macro-image",
        str(required[2].relative_to(root)),
        "--etf-image",
        str(required[3].relative_to(root)),
        "--etf-heatmap-image",
        str(required[4].relative_to(root)),
        "--news-images",
        *news_images,
    ]
    if dry_run:
        command.append("--dry-run")
    return command


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Publish a validated brief artifact without data collection"
    )
    parser.add_argument("--date")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    report_dates = available_report_dates()
    report_date = args.date or (report_dates[-1] if report_dates else None)
    if report_date is None:
        raise SystemExit("No cached daily brief is available")
    command = cached_publish_command(report_date, dry_run=args.dry_run)
    print(f"Publishing cached report bundle for {report_date}", flush=True)
    subprocess.run(command, cwd=ROOT, check=True)


if __name__ == "__main__":
    main()
