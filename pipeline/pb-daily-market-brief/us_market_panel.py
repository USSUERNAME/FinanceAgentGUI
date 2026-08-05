"""Canonical U.S. market-internals panel shared by collection and analysis."""

from __future__ import annotations

SECTOR_ETFS = {
    "XLC": "Communication Services",
    "XLY": "Consumer Discretionary",
    "XLP": "Consumer Staples",
    "XLE": "Energy",
    "XLF": "Financials",
    "XLV": "Health Care",
    "XLI": "Industrials",
    "XLB": "Materials",
    "XLRE": "Real Estate",
    "XLK": "Technology",
    "XLU": "Utilities",
}

STYLE_PAIRS = {
    "growth_vs_value": ("IWF", "IWD"),
    "large_vs_small": ("SPY", "IWM"),
    "large_vs_mid": ("SPY", "MDY"),
    "momentum_vs_low_volatility": ("MTUM", "USMV"),
    "equal_weight_vs_cap_weight": ("RSP", "SPY"),
}

CORE_MARKET_BENCHMARKS = (
    "SPY",
    "RSP",
    "IWM",
    "MDY",
    "IWF",
    "IWD",
    "MTUM",
    "USMV",
    *SECTOR_ETFS,
)

REQUIRED_TICKERS = frozenset(CORE_MARKET_BENCHMARKS)
