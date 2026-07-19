#!/usr/bin/env python3
from __future__ import annotations

import argparse
import csv
import datetime as dt
import io
import re
import sys
from dataclasses import dataclass
from email.utils import parsedate_to_datetime
from pathlib import Path
from xml.etree import ElementTree
from zoneinfo import ZoneInfo

import pandas as pd
import requests
import yfinance as yf

KST = ZoneInfo("Asia/Seoul")
UTC = dt.timezone.utc
TRANSLATE_API_URL = "https://translate.googleapis.com/translate_a/single"

RSS_FEEDS: list[tuple[str, str, int]] = [
    ("First Squawk", "https://rss.app/feeds/d68ow40E3dkwaEvN.xml", -540),
    ("unusual_whales", "https://rss.app/feeds/nikLNBATmLDuprRz.xml", -540),
    ("FinancialJuice", "https://rss.app/feeds/5VaycMAa8SwPhOAP.xml", 0),
    ("*Walter Bloomberg", "https://rss.app/feeds/YcRRdWN5eSO3o2LP.xml", 0),
]

FRED_GRAPH_CSV_URL = "https://fred.stlouisfed.org/graph/fredgraph.csv"
FRED_START_DATE = "2024-01-01"

MARKET_TICKERS = [
    "SPY",
    "QQQ",
    "IWM",
    "RSP",
    "^VIX",
    "^VFTW1",
    "^VFTW2",
    "^TNX",
    "TLT",
    "HYG",
    "LQD",
    "DX-Y.NYB",
    "CL=F",
    "GC=F",
    "BTC-USD",
]

THEME_RULES: list[tuple[str, tuple[str, ...]]] = [
    (
        "지정학·에너지",
        (
            r"\biran\b",
            r"\bmiddle east\b",
            r"\bgaza\b",
            r"\bhamas\b",
            r"\bmilitary\b",
            r"\bnuclear\b",
            r"\bwar\b",
            r"\boil\b",
            r"\bcrude\b",
            r"\bopec\b",
            r"\bred sea\b",
            r"\bstrait\b",
            r"\bmissile\b",
        ),
    ),
    (
        "금리·유동성·채권",
        (
            r"\bfed\b",
            r"\bfomc\b",
            r"\btreasury\b",
            r"\bauction\b",
            r"\btips\b",
            r"\byield\b",
            r"\bbond\b",
            r"\brepo\b",
            r"\brrp\b",
            r"\bmortgage\b",
            r"\brates\b",
            r"\bduration\b",
        ),
    ),
    (
        "거시·소비·경기",
        (
            r"\bconsumer\b",
            r"\bretail\b",
            r"\bwalmart\b",
            r"\bhiring\b",
            r"\bemployment\b",
            r"\bunemployment\b",
            r"\bhousing\b",
            r"\bhome sales\b",
            r"\binflation\b",
            r"\brecession\b",
            r"\btrade deficit\b",
            r"\bpmi\b",
        ),
    ),
    (
        "기업·실적·딜",
        (
            r"\bearnings?\b",
            r"\bguidance\b",
            r"\bnetflix\b",
            r"\bwarner\b",
            r"\bbuyout\b",
            r"\bmerger\b",
            r"\bamd\b",
            r"\bloan\b",
            r"\blayoff\b",
            r"\bchip\b",
            r"\bai\b",
            r"\bprivate equity\b",
        ),
    ),
]

SEVERITY_PATTERNS: list[tuple[str, float]] = [
    (r"\biran\b", 3.0),
    (r"\bwar\b", 3.0),
    (r"\bmilitary\b", 3.0),
    (r"\bnuclear\b", 3.0),
    (r"\btariff\b", 2.0),
    (r"\bfed\b", 2.0),
    (r"\bfomc\b", 2.0),
    (r"\btreasury\b", 1.7),
    (r"\byield\b", 1.5),
    (r"\binflation\b", 2.0),
    (r"\brecession\b", 2.5),
    (r"\bcrude\b", 1.8),
    (r"\boil\b", 1.8),
    (r"\binventory\b", 1.2),
    (r"\bwalmart\b", 1.4),
    (r"\bmortgage\b", 1.2),
    (r"\blayoff\b", 1.8),
    (r"\bdefault\b", 3.0),
]

MARKET_RELEVANCE_PATTERNS: tuple[str, ...] = (
    r"\bstock\b",
    r"\bstocks\b",
    r"\bmarket\b",
    r"\bequity\b",
    r"\byield\b",
    r"\bfed\b",
    r"\bfomc\b",
    r"\brates\b",
    r"\btips\b",
    r"\bauction\b",
    r"\btreasury\b",
    r"\brepo\b",
    r"\boil\b",
    r"\bcrude\b",
    r"\bgold\b",
    r"\binflation\b",
    r"\bconsumer\b",
    r"\bwalmart\b",
    r"\bhousing\b",
    r"\bmortgage\b",
    r"\brecession\b",
    r"\bearnings?\b",
    r"\bguidance\b",
    r"\bbuyout\b",
    r"\bmerger\b",
    r"\blayoff\b",
    r"\biran\b",
    r"\bgaza\b",
    r"\bmiddle east\b",
    r"\btariff\b",
    r"\bcredit\b",
    r"\bdebt\b",
)

@dataclass
class NewsItem:
    title: str
    link: str
    source: str
    published_at: dt.datetime
    feed_type: str
    channel: str
    score: float = 0.0
    theme: str = "기타"
    relevance: int = 0
    title_ko: str | None = None

    def key(self) -> tuple[str, str, str]:
        return (
            self.link.strip(),
            self.published_at.astimezone(UTC).strftime("%Y-%m-%d %H:%M"),
            _normalize_text(self.title)[:180],
        )


def _now_kst() -> dt.datetime:
    return dt.datetime.now(tz=KST)


def _parse_datetime(value: str) -> dt.datetime | None:
    text = value.strip()
    if not text:
        return None
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    try:
        parsed = dt.datetime.fromisoformat(text)
    except ValueError:
        try:
            parsed = parsedate_to_datetime(text)
        except (TypeError, ValueError):
            return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC)


def _normalize_text(text: str) -> str:
    return re.sub(r"\s+", " ", text.strip().lower())


def _short_title(title: str, limit: int = 140) -> str:
    t = re.sub(r"\s+", " ", title.strip())
    if len(t) <= limit:
        return t
    return t[: limit - 1].rstrip() + "…"


def _has_hangul(text: str) -> bool:
    return bool(re.search(r"[\uac00-\ud7a3]", text))


def _needs_korean_translation(text: str) -> bool:
    if not text.strip():
        return False
    if _has_hangul(text):
        return False
    return bool(re.search(r"[A-Za-z]", text))


def _translate_to_korean(text: str, timeout: int, cache: dict[str, str]) -> str:
    normalized = re.sub(r"\s+", " ", text).strip()
    if not normalized:
        return normalized
    if normalized in cache:
        return cache[normalized]
    if not _needs_korean_translation(normalized):
        cache[normalized] = normalized
        return normalized

    try:
        resp = requests.get(
            TRANSLATE_API_URL,
            params={
                "client": "gtx",
                "sl": "auto",
                "tl": "ko",
                "dt": "t",
                "q": normalized,
            },
            headers={"User-Agent": "market-analysis-bot/1.0"},
            timeout=timeout,
        )
        resp.raise_for_status()
        payload = resp.json()

        parts: list[str] = []
        if isinstance(payload, list) and payload and isinstance(payload[0], list):
            for seg in payload[0]:
                if isinstance(seg, list) and seg:
                    translated_piece = seg[0]
                    if isinstance(translated_piece, str):
                        parts.append(translated_piece)
        translated = "".join(parts).strip()
        if translated:
            cache[normalized] = translated
            return translated
    except Exception:
        pass

    cache[normalized] = normalized
    return normalized


def localize_news_titles(items: list[NewsItem], timeout: int, target_language: str) -> None:
    if target_language != "ko":
        for item in items:
            item.title_ko = None
        return

    cache: dict[str, str] = {}
    for item in items:
        item.title_ko = _translate_to_korean(item.title, timeout=timeout, cache=cache)


def _display_news_title(item: NewsItem, limit: int, news_language: str, show_original_title: bool) -> str:
    if news_language == "ko":
        localized = item.title_ko or item.title
    else:
        localized = item.title

    localized_short = _short_title(localized, limit=limit)
    if not show_original_title or news_language != "ko":
        return localized_short

    original = _short_title(item.title, limit=max(90, int(limit * 0.55)))
    if _normalize_text(original) == _normalize_text(localized_short):
        return localized_short
    return f"{localized_short} (원문: {original})"


def _fetch_url_text(url: str, timeout: int) -> str:
    headers = {
        "User-Agent": "market-analysis-bot/1.0",
        "Accept": "application/rss+xml,application/xml,text/xml,*/*",
    }
    resp = requests.get(url, headers=headers, timeout=timeout)
    resp.raise_for_status()
    return resp.text


def fetch_rss_feed(
    source_name: str,
    url: str,
    timeout: int,
    published_at_offset_minutes: int = 0,
) -> list[NewsItem]:
    rows: list[NewsItem] = []
    raw = _fetch_url_text(url, timeout=timeout)
    root = ElementTree.fromstring(raw)
    for item in root.findall("./channel/item"):
        title = (item.findtext("title") or "").strip()
        link = (item.findtext("link") or item.findtext("guid") or "").strip()
        published_at = _parse_datetime(item.findtext("pubDate") or item.findtext("date") or "")
        if not title or published_at is None:
            continue
        published_at += dt.timedelta(minutes=published_at_offset_minutes)
        rows.append(
            NewsItem(
                title=title,
                link=link,
                source=source_name,
                published_at=published_at,
                feed_type="rss",
                channel=url,
            )
        )
    rows.sort(key=lambda x: x.published_at, reverse=True)
    return rows


def dedupe_news(items: list[NewsItem]) -> list[NewsItem]:
    out: list[NewsItem] = []
    seen_links: set[str] = set()
    seen_title_minute: set[tuple[str, str]] = set()

    for item in sorted(items, key=lambda x: x.published_at, reverse=True):
        normalized_title = _normalize_text(item.title)[:200]
        minute_key = item.published_at.astimezone(UTC).strftime("%Y-%m-%d %H:%M")
        title_minute_key = (normalized_title, minute_key)

        if item.link and item.link in seen_links:
            continue
        if title_minute_key in seen_title_minute:
            continue

        if item.link:
            seen_links.add(item.link)
        seen_title_minute.add(title_minute_key)
        out.append(item)

    return out


def _match_any(patterns: tuple[str, ...] | list[str], text: str) -> bool:
    return any(re.search(pattern, text, flags=re.I) for pattern in patterns)


def classify_theme(title: str) -> str:
    low = title.lower()
    for theme, patterns in THEME_RULES:
        if _match_any(patterns, low):
            return theme
    return "기타"


def market_relevance_score(title: str, link: str) -> int:
    low = title.lower()
    hits = sum(1 for pattern in MARKET_RELEVANCE_PATTERNS if re.search(pattern, low, flags=re.I))
    link_low = link.lower()
    trusted_host = any(
        host in link_low for host in ("bloomberg.com", "wsj.com", "ft.com", "reuters.com", "finance.yahoo.com")
    )
    if hits > 0 and trusted_host:
        hits += 1
    if re.search(r"\bpodcast\b|\bmonarchy\b|\bepstein\b|\bprince\b|\bcelebrity\b", low, flags=re.I):
        hits -= 2
    return max(0, hits)


def score_news(item: NewsItem, now_utc: dt.datetime) -> float:
    age_hours = max(0.0, (now_utc - item.published_at).total_seconds() / 3600.0)
    recency = max(0.0, 36.0 - age_hours) * 0.5

    severity = 0.0
    low = item.title.lower()
    for pattern, weight in SEVERITY_PATTERNS:
        if re.search(pattern, low, flags=re.I):
            severity += weight

    source_bonus = 0.0
    link_low = item.link.lower()
    if "bloomberg.com" in link_low or "wsj.com" in link_low or "ft.com" in link_low:
        source_bonus += 1.2
    if item.feed_type == "rss":
        source_bonus += 0.6

    relevance_bonus = min(4.0, float(item.relevance) * 0.8)
    if item.relevance <= 0:
        relevance_bonus = -1.5

    return recency + severity + source_bonus + relevance_bonus


def fetch_news(timeout: int, max_items: int) -> tuple[list[NewsItem], list[str]]:
    all_items: list[NewsItem] = []
    errors: list[str] = []

    for source_name, feed_url, published_at_offset_minutes in RSS_FEEDS:
        try:
            all_items.extend(
                fetch_rss_feed(
                    source_name,
                    feed_url,
                    timeout=timeout,
                    published_at_offset_minutes=published_at_offset_minutes,
                )
            )
        except Exception as exc:
            errors.append(f"RSS 피드 조회 실패: {source_name} | {feed_url} ({exc})")

    deduped = dedupe_news(all_items)
    now_utc = dt.datetime.now(tz=UTC)

    for item in deduped:
        item.theme = classify_theme(item.title)
        item.relevance = market_relevance_score(item.title, item.link)
        item.score = score_news(item, now_utc=now_utc)

    deduped.sort(key=lambda x: (x.score, x.relevance, x.published_at), reverse=True)
    return deduped[:max_items], errors


def _series_stats(series: pd.Series) -> dict[str, float | str | None]:
    if series.empty:
        return {
            "last": None,
            "d1_pct": None,
            "d5_pct": None,
            "d21_pct": None,
            "date": None,
        }

    s = series.dropna()
    if s.empty:
        return {
            "last": None,
            "d1_pct": None,
            "d5_pct": None,
            "d21_pct": None,
            "date": None,
        }

    last = float(s.iloc[-1])
    prev = float(s.iloc[-2]) if len(s) >= 2 else None
    d1 = ((last / prev) - 1.0) * 100.0 if prev else None

    d5 = None
    if len(s) >= 6:
        anchor = float(s.iloc[-6])
        d5 = ((last / anchor) - 1.0) * 100.0 if anchor else None

    d21 = None
    if len(s) >= 22:
        anchor = float(s.iloc[-22])
        d21 = ((last / anchor) - 1.0) * 100.0 if anchor else None

    return {
        "last": last,
        "d1_pct": d1,
        "d5_pct": d5,
        "d21_pct": d21,
        "date": s.index[-1].strftime("%Y-%m-%d"),
    }


def _point_delta(series: pd.Series, periods: int) -> float | None:
    s = series.dropna()
    if len(s) <= periods:
        return None
    return float(s.iloc[-1] - s.iloc[-1 - periods])


def _extract_close_series(df: pd.DataFrame, ticker: str) -> pd.Series:
    if df.empty:
        return pd.Series(dtype=float)

    if isinstance(df.columns, pd.MultiIndex):
        if ticker in df.columns.get_level_values(0):
            try:
                return df[ticker]["Close"].dropna()
            except Exception:
                return pd.Series(dtype=float)
        return pd.Series(dtype=float)

    if "Close" in df.columns:
        return df["Close"].dropna()
    return pd.Series(dtype=float)


def _fetch_fred_series(series_id: str, start_date: str = FRED_START_DATE) -> pd.Series:
    response = requests.get(
        FRED_GRAPH_CSV_URL,
        params={"id": series_id, "cosd": start_date},
        timeout=20,
    )
    response.raise_for_status()

    rows: list[tuple[pd.Timestamp, float]] = []
    reader = csv.DictReader(io.StringIO(response.text))
    for row in reader:
        raw_date = row.get("observation_date", "")
        raw_value = row.get(series_id, "")
        if not raw_date or not raw_value or raw_value == ".":
            continue
        try:
            rows.append((pd.Timestamp(raw_date), float(raw_value)))
        except ValueError:
            continue

    if not rows:
        return pd.Series(dtype=float)

    idx, vals = zip(*rows)
    return pd.Series(vals, index=pd.DatetimeIndex(idx), dtype=float).sort_index()


def _close_only_supertrend(
    series: pd.Series, atr_window: int = 10, multiplier: float = 3.0
) -> pd.DataFrame:
    s = series.dropna().astype(float)
    out = pd.DataFrame(index=s.index)
    out["Close"] = s
    if len(s) < atr_window + 2:
        out["ATR"] = pd.Series(dtype=float)
        out["Supertrend"] = pd.Series(dtype=float)
        out["Direction"] = pd.Series(dtype="object")
        return out

    # FRED weekly indicators only have one value per week. Treating H/L/C as the
    # same value makes true range the absolute weekly change.
    tr = s.diff().abs().fillna(0.0)
    atr = tr.ewm(alpha=1 / atr_window, adjust=False, min_periods=atr_window).mean()
    basic_upper = s + multiplier * atr
    basic_lower = s - multiplier * atr

    final_upper = pd.Series(index=s.index, dtype=float)
    final_lower = pd.Series(index=s.index, dtype=float)
    supertrend = pd.Series(index=s.index, dtype=float)
    direction = pd.Series("UNKNOWN", index=s.index, dtype="object")

    prev_dir: str | None = None
    for i, idx in enumerate(s.index):
        if pd.isna(atr.iloc[i]):
            continue

        bu = float(basic_upper.iloc[i])
        bl = float(basic_lower.iloc[i])
        close = float(s.iloc[i])

        if prev_dir is None:
            lookback = max(0, i - atr_window)
            prev_dir = "RISK_UP" if close >= float(s.iloc[lookback]) else "RISK_DOWN"
            final_upper.iloc[i] = bu
            final_lower.iloc[i] = bl
        else:
            prev_close = float(s.iloc[i - 1])
            prev_upper = float(final_upper.iloc[i - 1])
            prev_lower = float(final_lower.iloc[i - 1])

            final_upper.iloc[i] = bu if bu < prev_upper or prev_close > prev_upper else prev_upper
            final_lower.iloc[i] = bl if bl > prev_lower or prev_close < prev_lower else prev_lower

            if close > prev_upper:
                prev_dir = "RISK_UP"
            elif close < prev_lower:
                prev_dir = "RISK_DOWN"

        direction.iloc[i] = prev_dir
        supertrend.iloc[i] = final_lower.iloc[i] if prev_dir == "RISK_UP" else final_upper.iloc[i]

    out["ATR"] = atr
    out["Supertrend"] = supertrend
    out["Direction"] = direction
    return out


def _trend_run_length(direction: pd.Series) -> tuple[str, int]:
    valid = direction[direction != "UNKNOWN"].dropna()
    if valid.empty:
        return "UNKNOWN", 0

    current = str(valid.iloc[-1])
    weeks = 0
    for value in reversed(valid.tolist()):
        if str(value) != current:
            break
        weeks += 1
    return current, weeks


def fetch_fred_snapshot() -> dict[str, object]:
    indicators: dict[str, dict[str, float | str | int | None]] = {}
    errors: list[str] = []

    try:
        nfcirisk = _fetch_fred_series("NFCIRISK")
    except Exception as exc:
        errors.append(f"NFCIRISK fetch failed: {exc}")
        nfcirisk = pd.Series(dtype=float)

    if not nfcirisk.empty:
        st = _close_only_supertrend(nfcirisk, atr_window=10, multiplier=3.0)
        direction, trend_weeks = _trend_run_length(st["Direction"])
        latest = st.iloc[-1]
        st_value = latest.get("Supertrend")
        close = latest.get("Close")
        indicators["NFCIRISK"] = {
            "last": float(close) if pd.notna(close) else None,
            "date": st.index[-1].strftime("%Y-%m-%d"),
            "delta_1w": _point_delta(nfcirisk, 1),
            "delta_4w": _point_delta(nfcirisk, 4),
            "delta_13w": _point_delta(nfcirisk, 13),
            "atr10": float(latest.get("ATR")) if pd.notna(latest.get("ATR")) else None,
            "supertrend": float(st_value) if pd.notna(st_value) else None,
            "supertrend_dir": direction,
            "trend_weeks": trend_weeks,
            "close_minus_supertrend": (
                float(close - st_value) if pd.notna(close) and pd.notna(st_value) else None
            ),
        }

    return {"indicators": indicators, "errors": errors}


def fetch_market_snapshot() -> dict[str, object]:
    data = yf.download(
        MARKET_TICKERS,
        period="3mo",
        interval="1d",
        auto_adjust=False,
        progress=False,
        group_by="ticker",
        threads=True,
    )

    closes: dict[str, pd.Series] = {}
    stats: dict[str, dict[str, float | str | None]] = {}

    for ticker in MARKET_TICKERS:
        s = _extract_close_series(data, ticker)
        closes[ticker] = s
        stats[ticker] = _series_stats(s)

    ratios: dict[str, dict[str, float | str | None]] = {}
    ratio_defs = {
        "HYG/LQD": ("HYG", "LQD"),
        "QQQ/SPY": ("QQQ", "SPY"),
        "RSP/SPY": ("RSP", "SPY"),
    }

    for name, (a, b) in ratio_defs.items():
        sa = closes.get(a, pd.Series(dtype=float))
        sb = closes.get(b, pd.Series(dtype=float))
        idx = sa.index.intersection(sb.index)
        if len(idx) == 0:
            ratios[name] = _series_stats(pd.Series(dtype=float))
            continue
        rs = (sa.loc[idx] / sb.loc[idx]).dropna()
        ratios[name] = _series_stats(rs)

    as_of_dates = [
        s.index[-1].strftime("%Y-%m-%d")
        for s in closes.values()
        if isinstance(s, pd.Series) and not s.empty
    ]
    as_of = max(as_of_dates) if as_of_dates else _now_kst().strftime("%Y-%m-%d")

    return {
        "stats": stats,
        "ratios": ratios,
        "fred": fetch_fred_snapshot(),
        "as_of_date": as_of,
    }


def _num(stats: dict[str, float | str | None], key: str) -> float | None:
    val = stats.get(key)
    if isinstance(val, (float, int)):
        return float(val)
    return None


def _fmt_pct(value: float | None) -> str:
    if value is None:
        return "n/a"
    return f"{value:+.2f}%"


def _fmt_num(value: float | None, digits: int = 2) -> str:
    if value is None:
        return "n/a"
    return f"{value:.{digits}f}"


def _fmt_point(value: float | None, digits: int = 3) -> str:
    if value is None:
        return "n/a"
    return f"{value:+.{digits}f}pt"


def _fmt_nfcirisk_trend(summary: dict[str, float | str | int | None]) -> str:
    direction = str(summary.get("supertrend_dir") or "UNKNOWN")
    trend_weeks = summary.get("trend_weeks")
    supertrend = summary.get("supertrend")
    gap = summary.get("close_minus_supertrend")
    if direction == "RISK_UP":
        label = "위험상승"
    elif direction == "RISK_DOWN":
        label = "위험완화"
    else:
        label = "판정불가"
    return (
        f"{label}({direction}), {trend_weeks}주째, "
        f"ST={_fmt_num(supertrend if isinstance(supertrend, float) else None, 3)}, "
        f"gap={_fmt_point(gap if isinstance(gap, float) else None)}"
    )


def build_regime_summary(snapshot: dict[str, object]) -> dict[str, object]:
    stats = snapshot["stats"]
    ratios = snapshot["ratios"]
    fred = snapshot.get("fred", {})

    spy = stats.get("SPY", {})
    qqq = stats.get("QQQ", {})
    iwm = stats.get("IWM", {})
    vix = stats.get("^VIX", {})
    tnx = stats.get("^TNX", {})
    tlt = stats.get("TLT", {})
    dxy = stats.get("DX-Y.NYB", {})
    oil = stats.get("CL=F", {})
    hyg_lqd = ratios.get("HYG/LQD", {})
    nfcirisk = {}
    if isinstance(fred, dict):
        indicators = fred.get("indicators", {})
        if isinstance(indicators, dict):
            maybe_nfcirisk = indicators.get("NFCIRISK", {})
            if isinstance(maybe_nfcirisk, dict):
                nfcirisk = maybe_nfcirisk

    risk_off_score = 0
    rule_hits: list[tuple[str, int]] = []

    spy_d1 = _num(spy, "d1_pct")
    vix_d1 = _num(vix, "d1_pct")
    if spy_d1 is not None and vix_d1 is not None and spy_d1 < 0 and vix_d1 > 0:
        risk_off_score += 2
        rule_hits.append(("주식 하락 + 변동성 상승 (SPY<0 & VIX>0)", 1))
    else:
        rule_hits.append(("주식 하락 + 변동성 상승 (SPY<0 & VIX>0)", 0))

    hyg_lqd_d5 = _num(hyg_lqd, "d5_pct")
    if hyg_lqd_d5 is not None and hyg_lqd_d5 < 0:
        risk_off_score += 1
        rule_hits.append(("크레딧 스프레드 악화 (HYG/LQD 5D < 0)", 1))
    else:
        rule_hits.append(("크레딧 스프레드 악화 (HYG/LQD 5D < 0)", 0))

    tlt_d5 = _num(tlt, "d5_pct")
    tnx_d5 = _num(tnx, "d5_pct")
    if tlt_d5 is not None and tnx_d5 is not None and tlt_d5 > 0 and tnx_d5 < 0:
        risk_off_score += 1
        rule_hits.append(("안전자산 선호 (TLT 5D > 0 & 10Y 5D < 0)", 1))
    else:
        rule_hits.append(("안전자산 선호 (TLT 5D > 0 & 10Y 5D < 0)", 0))

    oil_d5 = _num(oil, "d5_pct")
    if oil_d5 is not None and oil_d5 > 2:
        risk_off_score += 1
        rule_hits.append(("유가 급등 (WTI 5D > 2%)", 1))
    else:
        rule_hits.append(("유가 급등 (WTI 5D > 2%)", 0))

    if nfcirisk:
        if nfcirisk.get("supertrend_dir") == "RISK_UP":
            risk_off_score += 1
            rule_hits.append(("NFCIRISK Supertrend(10,3) 위험상승", 1))
        else:
            rule_hits.append(("NFCIRISK Supertrend(10,3) 위험상승", 0))

    regime_code = f"RO{risk_off_score}"

    signal_rows = [
        ("SPY 1일 변화율", _fmt_pct(_num(spy, "d1_pct"))),
        ("QQQ 1일 변화율", _fmt_pct(_num(qqq, "d1_pct"))),
        ("IWM 1일 변화율", _fmt_pct(_num(iwm, "d1_pct"))),
        ("VIX 종가", _fmt_num(_num(vix, "last"))),
        ("VIX 1일 변화율", _fmt_pct(_num(vix, "d1_pct"))),
        ("미국 10년물 금리(%)", _fmt_num(_num(tnx, "last"), 3)),
        ("TLT 5일 변화율", _fmt_pct(_num(tlt, "d5_pct"))),
        ("HYG/LQD 5일 변화율", _fmt_pct(_num(hyg_lqd, "d5_pct"))),
        (
            "NFCIRISK",
            (
                f"{_fmt_num(nfcirisk.get('last') if isinstance(nfcirisk.get('last'), float) else None, 3)} "
                f"({nfcirisk.get('date')})"
                if nfcirisk
                else "n/a"
            ),
        ),
        (
            "NFCIRISK 1/4/13주 변화",
            (
                f"{_fmt_point(nfcirisk.get('delta_1w') if isinstance(nfcirisk.get('delta_1w'), float) else None)} / "
                f"{_fmt_point(nfcirisk.get('delta_4w') if isinstance(nfcirisk.get('delta_4w'), float) else None)} / "
                f"{_fmt_point(nfcirisk.get('delta_13w') if isinstance(nfcirisk.get('delta_13w'), float) else None)}"
                if nfcirisk
                else "n/a"
            ),
        ),
        ("NFCIRISK Supertrend(10,3)", _fmt_nfcirisk_trend(nfcirisk) if nfcirisk else "n/a"),
        ("DXY 5일 변화율", _fmt_pct(_num(dxy, "d5_pct"))),
        ("WTI 5일 변화율", _fmt_pct(_num(oil, "d5_pct"))),
    ]

    return {
        "risk_off_score": risk_off_score,
        "regime_code": regime_code,
        "rule_hits": rule_hits,
        "signal_rows": signal_rows,
    }


def _format_source_links(items: list[NewsItem], limit: int = 2) -> str:
    seen: set[str] = set()
    links: list[str] = []
    for item in items:
        if not item.link:
            continue
        if item.link in seen:
            continue
        seen.add(item.link)
        links.append(f"[{item.source}]({item.link})")
        if len(links) >= limit:
            break
    if links:
        return " · ".join(links)
    names = [item.source for item in items if item.source]
    if names:
        return ", ".join(dict.fromkeys(names))
    return "출처 없음"


def build_newsletter_paragraphs(
    items: list[NewsItem],
    paragraph_count: int,
    style: str,
    *,
    news_language: str,
    show_original_title: bool,
) -> list[str]:
    if not items:
        return [
            "현재 피드에서 유효한 뉴스를 확보하지 못했습니다. 피드 오류 여부를 점검한 뒤 재호출이 필요합니다."
        ]

    paragraph_count = max(4, paragraph_count)
    relevant_items = [item for item in items if item.relevance > 0]
    working_items = relevant_items if len(relevant_items) >= paragraph_count else items

    buckets: dict[str, list[NewsItem]] = {}
    for item in working_items:
        buckets.setdefault(item.theme, []).append(item)

    theme_order = sorted(
        buckets.keys(),
        key=lambda t: (max(x.score for x in buckets[t]), len(buckets[t])),
        reverse=True,
    )

    paragraphs: list[str] = []
    for theme in theme_order:
        if len(paragraphs) >= paragraph_count:
            break

        chunk = buckets[theme][:3]
        if not chunk:
            continue

        lines = [f"### {theme}"]
        for item in chunk:
            kst = item.published_at.astimezone(KST).strftime("%Y-%m-%d %H:%M KST")
            title = _display_news_title(
                item,
                limit=170,
                news_language=news_language,
                show_original_title=show_original_title,
            )
            if item.link:
                lines.append(f"- {kst} | {title} ([{item.source}]({item.link}))")
            else:
                lines.append(f"- {kst} | {title} ({item.source})")

        paragraphs.append("\n".join(lines))

    if len(paragraphs) < paragraph_count:
        leftovers = [item for item in working_items if item.theme not in theme_order[:paragraph_count]]
        for item in leftovers:
            if len(paragraphs) >= paragraph_count:
                break
            kst = item.published_at.astimezone(KST).strftime("%Y-%m-%d %H:%M KST")
            title = _display_news_title(
                item,
                limit=170,
                news_language=news_language,
                show_original_title=show_original_title,
            )
            if item.link:
                paragraphs.append(f"- {kst} | {title} ([{item.source}]({item.link}))")
            else:
                paragraphs.append(f"- {kst} | {title} ({item.source})")

    return paragraphs


def _timeline_line(item: NewsItem, *, news_language: str, show_original_title: bool) -> str:
    kst_time = item.published_at.astimezone(KST).strftime("%Y-%m-%d %H:%M KST")
    title = _display_news_title(
        item,
        limit=180,
        news_language=news_language,
        show_original_title=show_original_title,
    )
    if item.link:
        return f"- {kst_time} | {title} ([{item.source}]({item.link}))"
    return f"- {kst_time} | {title} ({item.source})"


def _write_output(text: str, out_path: str | None) -> None:
    if out_path:
        out = Path(out_path)
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(text, encoding="utf-8")
        return

    sys.stdout.write(text)
    if not text.endswith("\n"):
        sys.stdout.write("\n")


def build_report(
    *,
    snapshot: dict[str, object] | None,
    news_items: list[NewsItem],
    news_errors: list[str],
    news_style: str,
    news_paragraphs: int,
    timeline_items: int,
    news_language: str,
    show_original_title: bool,
) -> str:
    now_kst = _now_kst()
    lines: list[str] = []

    lines.append(f"### 시장 상황 + 뉴스레터 브리핑 (기준 시각: {now_kst.strftime('%Y-%m-%d %H:%M KST')})")
    lines.append(
        "데이터 성격: yfinance(일봉) + FRED NFCIRISK(주간) + 지정 FEED(CSV 2종 + 텔레그램 3종). 장중/지연 데이터가 혼재할 수 있습니다."
    )
    lines.append("")

    if snapshot is not None:
        regime = build_regime_summary(snapshot)
        lines.append("## 플래시 레이어")
        lines.append(f"**레짐 점수:** `{regime['risk_off_score']}` (코드: `{regime['regime_code']}`)")
        lines.append("")
        lines.append("### 시그널")
        lines.append("| 지표 | 값 |")
        lines.append("| --- | --- |")
        for metric, value in regime["signal_rows"]:
            lines.append(f"| {metric} | {value} |")
        lines.append("")
        lines.append("### 규칙 충족")
        lines.append("| 규칙 | 충족(1/0) |")
        lines.append("| --- | --- |")
        for rule, hit in regime["rule_hits"]:
            lines.append(f"| {rule} | {hit} |")
        lines.append("")

    lines.append("## 뉴스레터 레이어")
    lines.append(
        f"아래는 LLM 작성용 뉴스 컨텍스트 카드입니다. 파이썬은 데이터 정리만 수행하며, 최종 서술은 `SKILLs/MarketAnalysis.md` 지침으로 생성합니다. (카드 수: {max(4, news_paragraphs)})"
    )
    lines.append("")

    paragraphs = build_newsletter_paragraphs(
        news_items,
        paragraph_count=news_paragraphs,
        style=news_style,
        news_language=news_language,
        show_original_title=show_original_title,
    )
    for paragraph in paragraphs:
        lines.append(paragraph)
        lines.append("")

    lines.append("## 뉴스 테이프 (KST, 최신순)")
    if news_items:
        timeline_pool = [item for item in news_items if item.relevance > 0]
        if not timeline_pool:
            timeline_pool = news_items
        by_time = sorted(timeline_pool, key=lambda x: x.published_at, reverse=True)
        for item in by_time[: max(1, timeline_items)]:
            lines.append(
                _timeline_line(
                    item,
                    news_language=news_language,
                    show_original_title=show_original_title,
                )
            )
    else:
        lines.append("- 유효 뉴스 항목이 없습니다.")
    lines.append("")

    if news_errors:
        lines.append("## Feed 점검 메모")
        for err in news_errors:
            lines.append(f"- {err}")
        lines.append("")

    return "\n".join(lines).rstrip() + "\n"


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description="시장 시황 + 뉴스레터 스타일 브리핑 생성기 (yfinance + 지정 FEED)",
    )
    p.add_argument(
        "--news-style",
        choices=["bloomberg", "brief"],
        default="bloomberg",
        help="뉴스 서술 스타일 (기본: bloomberg)",
    )
    p.add_argument(
        "--news-paragraphs",
        type=int,
        default=10,
        help="뉴스 산문 문단 수 (기본: 10)",
    )
    p.add_argument(
        "--max-news-items",
        type=int,
        default=80,
        help="통합 후 사용 뉴스 최대 건수 (기본: 80)",
    )
    p.add_argument(
        "--timeline-items",
        type=int,
        default=18,
        help="뉴스 테이프에 표시할 최신 뉴스 건수 (기본: 18)",
    )
    p.add_argument(
        "--news-language",
        choices=["ko", "original"],
        default="ko",
        help="뉴스 제목 출력 언어 (기본: ko)",
    )
    p.add_argument(
        "--show-original-title",
        action="store_true",
        help="`--news-language ko`일 때 원문 제목을 괄호로 병기",
    )
    p.add_argument(
        "--timeout",
        type=int,
        default=20,
        help="피드 요청 타임아웃(초, 기본: 20)",
    )
    p.add_argument(
        "--out",
        default=None,
        help="출력 파일 경로 (.md)",
    )
    return p.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)

    snapshot: dict[str, object] | None = None
    snapshot_error: str | None = None
    try:
        snapshot = fetch_market_snapshot()
    except Exception as exc:
        snapshot_error = f"시장 스냅샷 조회 실패: {exc}"

    news_items, news_errors = fetch_news(timeout=max(5, args.timeout), max_items=max(20, args.max_news_items))
    localize_news_titles(
        news_items,
        timeout=max(5, args.timeout),
        target_language=args.news_language,
    )
    if snapshot_error:
        news_errors.append(snapshot_error)

    report = build_report(
        snapshot=snapshot,
        news_items=news_items,
        news_errors=news_errors,
        news_style=args.news_style,
        news_paragraphs=max(4, args.news_paragraphs),
        timeline_items=max(5, args.timeline_items),
        news_language=args.news_language,
        show_original_title=args.show_original_title,
    )
    _write_output(report, args.out)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
