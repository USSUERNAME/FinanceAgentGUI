"""Build aggregate S&P 500 constituent breadth from authorized daily bars."""

from __future__ import annotations

import argparse
import json
import os
from collections import Counter
from datetime import date
from pathlib import Path
from typing import Any, Callable
from urllib.error import HTTPError, URLError

from build_us_equity_universe import root_path
from collect_sector_spdr_holdings import (
    MINIMUM_SECTOR_HOLDINGS,
    SCHEMA_VERSION as SECTOR_HOLDINGS_SCHEMA,
)
from collectors.alpaca_market import ALPACA_DOCUMENTATION_URL, fetch_daily_series_batch
from collectors.common import ROOT, load_dotenv
from us_market_panel import SECTOR_ETFS

SCHEMA_VERSION = "us_constituent_breadth.v1"
MINIMUM_SP500_MEMBERS = 450
MINIMUM_PRICE_COVERAGE_PCT = 90.0
MINIMUM_LONG_HISTORY_COVERAGE_PCT = 80.0


def round_pct(numerator: float, denominator: float) -> float | None:
    if denominator <= 0:
        return None
    return round(numerator / denominator * 100, 2)


def blocked_payload(
    report_date: str,
    reason: str,
    *,
    eligible_count: int = 0,
) -> dict[str, Any]:
    return {
        "schema_version": SCHEMA_VERSION,
        "report_date": report_date,
        "collection_status": "blocked",
        "as_of": None,
        "universe": {
            "id": "sp500",
            "membership_scope": None,
            "eligible_count": eligible_count,
        },
        "coverage": {
            "eligible_count": eligible_count,
            "daily_price_count": 0,
            "daily_price_pct": 0.0,
            "long_history_count": 0,
            "long_history_pct": 0.0,
            "missing_count": eligible_count,
            "missing_tickers": [],
        },
        "breadth": {},
        "sector_breadth": None,
        "data_gaps": [reason],
        "posture": "aggregate_market_breadth_not_investment_recommendation",
    }


def sp500_members(universe: dict[str, Any]) -> tuple[list[str], str | None]:
    securities = universe.get("securities") or []
    rows = [
        row
        for row in securities
        if "sp500" in (row.get("index_memberships") or [])
    ]
    tickers = sorted({
        str(row.get("ticker") or "").strip().upper()
        for row in rows
        if row.get("ticker")
    })
    scopes = {
        str(scope)
        for row in rows
        for scope in (row.get("membership_scopes") or [])
        if scope
    }
    scope = (
        "index_constituents"
        if "index_constituents" in scopes else
        "fund_holdings_proxy"
        if "fund_holdings_proxy" in scopes else
        None
    )
    return tickers, scope


def normalized_series(
    series: list[dict[str, Any]],
    report_date: str,
) -> list[dict[str, Any]]:
    report_day = date.fromisoformat(report_date)
    by_day = {
        row["date"]: row
        for row in series
        if row.get("date") and row["date"] <= report_day
    }
    return [by_day[day] for day in sorted(by_day)]


def aggregate_histories(
    eligible_tickers: list[str],
    current_histories: dict[str, list[dict[str, Any]]],
) -> tuple[dict[str, Any], dict[str, Any]]:
    advances = declines = unchanged = 0
    advancing_volume = declining_volume = unchanged_volume = 0.0
    moving_average_counts = {
        horizon: {"above": 0, "below_or_equal": 0, "sample_count": 0}
        for horizon in (20, 50, 200)
    }
    new_highs = new_lows = high_low_sample = 0
    for ticker in eligible_tickers:
        rows = current_histories.get(ticker)
        if not rows:
            continue
        current = float(rows[-1]["close"])
        previous = float(rows[-2]["close"])
        volume = float(rows[-1].get("volume") or 0)
        if current > previous:
            advances += 1
            advancing_volume += volume
        elif current < previous:
            declines += 1
            declining_volume += volume
        else:
            unchanged += 1
            unchanged_volume += volume
        closes = [float(row["close"]) for row in rows]
        for horizon, counts in moving_average_counts.items():
            if len(closes) < horizon:
                continue
            counts["sample_count"] += 1
            moving_average = sum(closes[-horizon:]) / horizon
            if current > moving_average:
                counts["above"] += 1
            else:
                counts["below_or_equal"] += 1
        if len(closes) >= 252:
            high_low_sample += 1
            window = closes[-252:]
            if current >= max(window):
                new_highs += 1
            if current <= min(window):
                new_lows += 1

    daily_count = sum(ticker in current_histories for ticker in eligible_tickers)
    long_history_count = moving_average_counts[200]["sample_count"]
    missing = sorted(set(eligible_tickers) - set(current_histories))
    total_directional = advances + declines + unchanged
    total_volume = advancing_volume + declining_volume + unchanged_volume
    coverage = {
        "eligible_count": len(eligible_tickers),
        "daily_price_count": daily_count,
        "daily_price_pct": round_pct(daily_count, len(eligible_tickers)) or 0.0,
        "long_history_count": long_history_count,
        "long_history_pct": (
            round_pct(long_history_count, len(eligible_tickers)) or 0.0
        ),
        "missing_count": len(missing),
        "missing_tickers": missing[:50],
    }
    breadth = {
        "advance_decline": {
            "advances": advances,
            "declines": declines,
            "unchanged": unchanged,
            "sample_count": total_directional,
            "advance_pct": round_pct(advances, total_directional),
            "decline_pct": round_pct(declines, total_directional),
            "net_advances": advances - declines,
            "advance_decline_ratio": (
                round(advances / declines, 3)
                if declines > 0 else None
            ),
        },
        "volume": {
            "advancing_volume": round(advancing_volume, 2),
            "declining_volume": round(declining_volume, 2),
            "unchanged_volume": round(unchanged_volume, 2),
            "up_volume_pct": round_pct(advancing_volume, total_volume),
            "down_volume_pct": round_pct(declining_volume, total_volume),
        },
        "moving_averages": {
            f"{horizon}d": {
                **counts,
                "above_pct": round_pct(counts["above"], counts["sample_count"]),
            }
            for horizon, counts in moving_average_counts.items()
        },
        "highs_lows_52w": {
            "new_highs": new_highs,
            "new_lows": new_lows,
            "net_new_highs": new_highs - new_lows,
            "sample_count": high_low_sample,
            "new_high_pct": round_pct(new_highs, high_low_sample),
            "new_low_pct": round_pct(new_lows, high_low_sample),
        },
    }
    return coverage, breadth


def build_sector_breadth(
    report_date: str,
    sector_membership: dict[str, Any] | None,
    current_histories: dict[str, list[dict[str, Any]]],
) -> dict[str, Any] | None:
    if not sector_membership:
        return None
    if sector_membership.get("schema_version") != SECTOR_HOLDINGS_SCHEMA:
        raise ValueError("Unexpected sector holdings schema")
    if sector_membership.get("report_date") != report_date:
        raise ValueError("Sector holdings report date does not match breadth date")
    rows = []
    for sector in sector_membership.get("sectors") or []:
        ticker = str(sector.get("sector_ticker") or "").strip().upper()
        if ticker not in SECTOR_ETFS:
            continue
        members = sorted({
            str(member.get("ticker") or "").strip().upper()
            for member in (sector.get("members") or [])
            if member.get("ticker")
        })
        if len(members) < MINIMUM_SECTOR_HOLDINGS:
            continue
        coverage, breadth = aggregate_histories(members, current_histories)
        status = (
            "ready"
            if (
                coverage["daily_price_pct"] >= MINIMUM_PRICE_COVERAGE_PCT
                and coverage["long_history_pct"] >= MINIMUM_LONG_HISTORY_COVERAGE_PCT
            )
            else "partial"
        )
        rows.append({
            "sector_ticker": ticker,
            "sector_name": SECTOR_ETFS[ticker],
            "membership_scope": sector.get("membership_scope"),
            "membership_as_of": sector.get("as_of"),
            "collection_status": status,
            "coverage": coverage,
            "breadth": breadth,
        })
    ready_count = sum(row["collection_status"] == "ready" for row in rows)
    return {
        "collection_status": (
            "ready"
            if ready_count == len(SECTOR_ETFS)
            else "partial"
            if rows
            else "blocked"
        ),
        "membership_source_status": sector_membership.get("collection_status"),
        "coverage": {
            "required_sector_count": len(SECTOR_ETFS),
            "available_sector_count": len(rows),
            "ready_sector_count": ready_count,
            "missing_sector_tickers": sorted(
                set(SECTOR_ETFS) - {row["sector_ticker"] for row in rows}
            ),
        },
        "sectors": rows,
    }


def build_constituent_breadth(
    report_date: str,
    universe: dict[str, Any],
    series_by_ticker: dict[str, list[dict[str, Any]]],
    *,
    sector_membership: dict[str, Any] | None = None,
    provider: str = "Alpaca Historical Bars",
    source_url: str = ALPACA_DOCUMENTATION_URL,
    feed: str = "iex",
) -> dict[str, Any]:
    if universe.get("report_date") != report_date:
        raise ValueError("U.S. equity universe report date does not match breadth date")
    tickers, membership_scope = sp500_members(universe)
    if len(tickers) < MINIMUM_SP500_MEMBERS:
        return blocked_payload(
            report_date,
            "A current S&P 500 membership or fund-holdings proxy is incomplete.",
            eligible_count=len(tickers),
        )

    histories = {
        ticker: normalized_series(series_by_ticker.get(ticker) or [], report_date)
        for ticker in tickers
    }
    latest_counts = Counter(
        rows[-1]["date"].isoformat()
        for rows in histories.values()
        if len(rows) >= 2
    )
    if not latest_counts:
        return blocked_payload(
            report_date,
            "No constituent daily bars are available.",
            eligible_count=len(tickers),
        )
    as_of = latest_counts.most_common(1)[0][0]
    current_histories = {
        ticker: rows
        for ticker, rows in histories.items()
        if len(rows) >= 2 and rows[-1]["date"].isoformat() == as_of
    }
    coverage, breadth = aggregate_histories(tickers, current_histories)
    daily_coverage_pct = coverage["daily_price_pct"]
    long_history_pct = coverage["long_history_pct"]
    status = (
        "ready"
        if (
            daily_coverage_pct >= MINIMUM_PRICE_COVERAGE_PCT
            and long_history_pct >= MINIMUM_LONG_HISTORY_COVERAGE_PCT
        )
        else "partial"
    )
    sector_breadth = build_sector_breadth(
        report_date,
        sector_membership,
        current_histories,
    )
    data_gaps = [
        *(
            [
                "Daily constituent coverage is below "
                f"{MINIMUM_PRICE_COVERAGE_PCT:.0f}%."
            ]
            if daily_coverage_pct < MINIMUM_PRICE_COVERAGE_PCT else []
        ),
        *(
            [
                "200-day history coverage is below "
                f"{MINIMUM_LONG_HISTORY_COVERAGE_PCT:.0f}%."
            ]
            if long_history_pct < MINIMUM_LONG_HISTORY_COVERAGE_PCT else []
        ),
        "SPY holdings are an explicit fund proxy, not an official index constituent file."
        if membership_scope == "fund_holdings_proxy" else
        "Constituent breadth is an aggregate price observation, not evidence of causality.",
    ]
    return {
        "schema_version": SCHEMA_VERSION,
        "report_date": report_date,
        "collection_status": status,
        "as_of": as_of,
        "source": {
            "provider": provider,
            "source_url": source_url,
            "feed": feed,
            "price_adjustment": "split",
            "rights_label": "provider_permitted_internal_research",
            "market_cutoff": "official_close",
        },
        "universe": {
            "id": "sp500",
            "membership_scope": membership_scope,
            "eligible_count": len(tickers),
        },
        "coverage": {
            **coverage,
        },
        "breadth": breadth,
        "sector_breadth": sector_breadth,
        "data_gaps": data_gaps,
        "posture": "aggregate_market_breadth_not_investment_recommendation",
    }


def collect_constituent_breadth(
    report_date: str,
    universe: dict[str, Any],
    api_key_id: str,
    secret_key: str,
    *,
    sector_membership: dict[str, Any] | None = None,
    feed: str = "sip",
    fetcher: Callable[..., dict[str, list[dict[str, Any]]]] = fetch_daily_series_batch,
) -> dict[str, Any]:
    tickers, _ = sp500_members(universe)
    if len(tickers) < MINIMUM_SP500_MEMBERS:
        return blocked_payload(
            report_date,
            "A current S&P 500 membership or fund-holdings proxy is incomplete.",
            eligible_count=len(tickers),
        )
    if not api_key_id or not secret_key:
        return blocked_payload(
            report_date,
            "Alpaca credentials are required for constituent breadth.",
            eligible_count=len(tickers),
        )
    series = fetcher(
        tickers,
        api_key_id,
        secret_key,
        report_date,
        feed=feed,
        lookback_days=400,
        max_bars=260,
        adjustment="split",
    )
    return build_constituent_breadth(
        report_date,
        universe,
        series,
        sector_membership=sector_membership,
        feed=feed,
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="Build S&P 500 constituent breadth")
    parser.add_argument("--date", required=True)
    parser.add_argument("--universe-file")
    parser.add_argument("--sector-holdings-file")
    parser.add_argument("--output-file")
    args = parser.parse_args()
    load_dotenv()
    universe_path = root_path(
        args.universe_file,
        ROOT / "workspace" / "us_equity_universe" / args.date / "us_equity_universe.json",
    )
    if not universe_path.exists():
        payload = blocked_payload(args.date, "U.S. equity universe is unavailable.")
    else:
        universe = json.loads(universe_path.read_text(encoding="utf-8"))
        sector_path = root_path(
            args.sector_holdings_file,
            ROOT / "workspace" / "us_sector_holdings" / args.date
            / "sector_holdings.json",
        )
        sector_membership = (
            json.loads(sector_path.read_text(encoding="utf-8"))
            if sector_path.exists()
            else None
        )
        feed = os.getenv("ALPACA_MARKET_DATA_FEED", "iex").strip().lower()
        try:
            payload = collect_constituent_breadth(
                args.date,
                universe,
                os.getenv("APCA_API_KEY_ID", "").strip()
                or os.getenv("ALPACA_API_KEY", "").strip(),
                os.getenv("APCA_API_SECRET_KEY", "").strip()
                or os.getenv("ALPACA_SECRET_KEY", "").strip(),
                sector_membership=sector_membership,
                feed=feed,
            )
        except (HTTPError, URLError, RuntimeError) as exc:
            payload = blocked_payload(
                args.date,
                (
                    "Alpaca constituent breadth is unavailable because the "
                    f"{feed.upper()} feed request failed ({type(exc).__name__})."
                ),
                eligible_count=len(sp500_members(universe)[0]),
            )
    output = root_path(
        args.output_file,
        ROOT / "workspace" / "us_constituent_breadth" / args.date / "constituent_breadth.json",
    )
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(
        f"U.S. constituent breadth saved: {output.relative_to(ROOT)} | "
        f"status={payload['collection_status']} | "
        f"coverage={payload['coverage']['daily_price_count']}/"
        f"{payload['coverage']['eligible_count']}"
    )


if __name__ == "__main__":
    main()
