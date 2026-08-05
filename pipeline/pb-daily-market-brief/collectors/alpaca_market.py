"""Rights-bounded Alpaca multi-symbol daily bar adapter."""

from __future__ import annotations

from datetime import date, timedelta
from typing import Any, Callable
from urllib.parse import urlencode

from collectors.common import get_json

ALPACA_MARKET_DATA_URL = "https://data.alpaca.markets/v2/stocks/bars"
ALPACA_DOCUMENTATION_URL = "https://docs.alpaca.markets/us/v1.1/reference/stockbars"
SUPPORTED_FEEDS = {"iex", "sip"}
SUPPORTED_ADJUSTMENTS = {"raw", "split", "dividend", "all"}


def _bar_date(value: Any) -> date:
    return date.fromisoformat(str(value or "")[:10])


def fetch_daily_series_batch(
    tickers: list[str],
    api_key_id: str,
    secret_key: str,
    report_date: str,
    *,
    feed: str = "iex",
    lookback_days: int = 180,
    max_bars: int = 126,
    adjustment: str = "raw",
    fetcher: Callable[..., dict[str, Any]] = get_json,
) -> dict[str, list[dict[str, Any]]]:
    """Fetch raw daily bars for many symbols with pagination."""
    symbols = sorted({str(ticker or "").strip().upper() for ticker in tickers if ticker})
    if not symbols:
        return {}
    if not api_key_id or not secret_key:
        raise ValueError("Alpaca market data credentials are required")
    normalized_feed = str(feed or "iex").strip().lower()
    if normalized_feed not in SUPPORTED_FEEDS:
        raise ValueError(f"Unsupported Alpaca market data feed: {normalized_feed}")
    normalized_adjustment = str(adjustment or "raw").strip().lower()
    if normalized_adjustment not in SUPPORTED_ADJUSTMENTS:
        raise ValueError(
            f"Unsupported Alpaca price adjustment: {normalized_adjustment}"
        )

    report_day = date.fromisoformat(report_date)
    params = {
        "symbols": ",".join(symbols),
        "timeframe": "1Day",
        "start": (report_day - timedelta(days=max(lookback_days, 45))).isoformat(),
        "end": report_day.isoformat(),
        "adjustment": normalized_adjustment,
        "feed": normalized_feed,
        "limit": "10000",
        "sort": "asc",
    }
    headers = {
        "APCA-API-KEY-ID": api_key_id,
        "APCA-API-SECRET-KEY": secret_key,
        "User-Agent": "pb-daily-market-brief/1.0",
    }
    result: dict[str, list[dict[str, Any]]] = {ticker: [] for ticker in symbols}
    next_page_token = ""
    page_count = 0
    while True:
        query = dict(params)
        if next_page_token:
            query["page_token"] = next_page_token
        payload = fetcher(f"{ALPACA_MARKET_DATA_URL}?{urlencode(query)}", headers=headers)
        if payload.get("code") or (
            payload.get("message") and not payload.get("bars")
        ):
            raise RuntimeError("Alpaca returned a provider or entitlement error")
        bars = payload.get("bars")
        if not isinstance(bars, dict):
            raise RuntimeError("Alpaca response is missing multi-symbol daily bars")
        for ticker, rows in bars.items():
            normalized_ticker = str(ticker or "").strip().upper()
            if normalized_ticker not in result or not isinstance(rows, list):
                continue
            for row in rows:
                close = row.get("c")
                volume = row.get("v")
                timestamp = row.get("t")
                if close is None or volume is None or not timestamp:
                    continue
                result[normalized_ticker].append({
                    "date": _bar_date(timestamp),
                    "close": float(close),
                    "volume": float(volume),
                })
        next_page_token = str(payload.get("next_page_token") or "").strip()
        page_count += 1
        if not next_page_token:
            break
        if page_count >= 20:
            raise RuntimeError("Alpaca pagination exceeded the bounded page limit")

    normalized: dict[str, list[dict[str, Any]]] = {}
    for ticker, rows in result.items():
        by_day = {row["date"]: row for row in rows}
        ordered = [by_day[day] for day in sorted(by_day)]
        if ordered:
            normalized[ticker] = ordered[-max(int(max_bars), 1):]
    return normalized
