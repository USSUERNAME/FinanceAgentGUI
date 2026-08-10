"""Collect a bounded, primary-source economic release calendar from official ICS feeds."""

from __future__ import annotations

import argparse
import hashlib
import html
import io
import json
import re
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable
from urllib.parse import urljoin
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo

from collectors.common import ROOT, canonicalize_url, load_source_config

SCHEMA_VERSION = "official_market_calendar.v1"
REQUEST_HEADERS = {
    # DOL's Akamai policy currently permits a transparent command-line client
    # while rejecting browser impersonation and the old custom bot UA.
    "User-Agent": "curl/8.0 FinanceAgentGUI/1.0",
    "Accept": "text/html,application/xhtml+xml,application/pdf,text/calendar;q=0.9,*/*;q=0.8",
}


def fetch_text(url: str) -> str:
    request = Request(url, headers=REQUEST_HEADERS)
    with urlopen(request, timeout=30) as response:
        return response.read().decode("utf-8-sig")


def fetch_bytes(url: str) -> bytes:
    request = Request(url, headers=REQUEST_HEADERS)
    with urlopen(request, timeout=30) as response:
        return response.read()


def unfold_ics(text: str) -> list[str]:
    lines: list[str] = []
    for raw_line in text.replace("\r\n", "\n").replace("\r", "\n").split("\n"):
        if raw_line.startswith((" ", "\t")) and lines:
            lines[-1] += raw_line[1:]
        else:
            lines.append(raw_line)
    return lines


def unescape_ics(value: str) -> str:
    return (
        value.replace("\\N", "\n")
        .replace("\\n", "\n")
        .replace("\\,", ",")
        .replace("\\;", ";")
        .replace("\\\\", "\\")
        .strip()
    )


def parse_property(line: str) -> tuple[str, dict[str, str], str]:
    head, separator, value = line.partition(":")
    if not separator:
        return "", {}, ""
    parts = head.split(";")
    params: dict[str, str] = {}
    for item in parts[1:]:
        key, equals, param_value = item.partition("=")
        if equals:
            params[key.upper()] = param_value
    return parts[0].upper(), params, unescape_ics(value)


def parse_ics_events(text: str) -> list[dict[str, Any]]:
    events: list[dict[str, Any]] = []
    current: dict[str, Any] | None = None
    for line in unfold_ics(text):
        if line == "BEGIN:VEVENT":
            current = {}
            continue
        if line == "END:VEVENT":
            if current is not None:
                events.append(current)
            current = None
            continue
        if current is None:
            continue
        name, params, value = parse_property(line)
        if name:
            current[name] = {"value": value, "params": params}
    return events


def parse_start(raw: dict[str, Any], default_timezone: str) -> tuple[str, str | None, str]:
    value = str(raw.get("value") or "")
    params = raw.get("params") or {}
    timezone_name = str(params.get("TZID") or default_timezone)
    if params.get("VALUE") == "DATE" or re.fullmatch(r"\d{8}", value):
        return datetime.strptime(value[:8], "%Y%m%d").date().isoformat(), None, timezone_name

    is_utc = value.endswith("Z")
    clean = value[:-1] if is_utc else value
    pattern = "%Y%m%dT%H%M%S" if len(clean) >= 15 else "%Y%m%dT%H%M"
    parsed = datetime.strptime(clean[:15] if len(clean) >= 15 else clean[:13], pattern)
    if is_utc:
        parsed = parsed.replace(tzinfo=timezone.utc).astimezone(ZoneInfo(default_timezone))
        timezone_name = default_timezone
    return parsed.date().isoformat(), parsed.strftime("%H:%M"), timezone_name


def event_policy(title: str) -> dict[str, Any]:
    lowered = title.casefold()
    if any(token in lowered for token in (
        "consumer price", "producer price", "import and export price", "personal income and outlays",
    )):
        return {
            "importance": "high",
            "monitoring_assets": ["미국 국채금리", "달러", "QQQ", "GLD"],
            "confirmation_focus": "물가가 예상 경로보다 강하거나 약한지와 금리·달러의 동행 반응",
        }
    if any(token in lowered for token in ("employment situation", "job openings", "employment cost")):
        return {
            "importance": "high",
            "monitoring_assets": ["미국 국채금리", "달러", "SPY", "QQQ", "IWM"],
            "confirmation_focus": "고용·임금의 강도와 금리 및 성장주·소형주의 반응",
        }
    if "gdp" in lowered:
        return {
            "importance": "high",
            "monitoring_assets": ["미국 국채금리", "달러", "SPY", "QQQ", "IWM"],
            "confirmation_focus": "성장률의 예상 경로 차이와 금리·경기민감 자산의 반응",
        }
    return {
        "importance": "medium",
        "monitoring_assets": ["미국 국채금리", "달러", "SPY"],
        "confirmation_focus": "발표 전후 금리·달러·주식의 방향과 지속성",
    }


def extract_url(event: dict[str, Any], fallback_url: str) -> str:
    direct = str((event.get("URL") or {}).get("value") or "")
    description = str((event.get("DESCRIPTION") or {}).get("value") or "")
    match = re.search(r"https?://[^\s<>]+", description)
    return canonicalize_url(direct or (match.group(0) if match else fallback_url))


def normalize_event(event: dict[str, Any], source: dict[str, Any]) -> dict[str, Any] | None:
    title = str((event.get("SUMMARY") or {}).get("value") or "").strip()
    start = event.get("DTSTART")
    if not title or not start:
        return None
    event_date, event_time, timezone_name = parse_start(start, source["time_zone"])
    uid = str((event.get("UID") or {}).get("value") or "")
    stable_input = f"{source['id']}|{uid or event_date + '|' + title.casefold()}"
    policy = event_policy(title)
    return {
        "event_id": f"{source['id']}-{hashlib.sha256(stable_input.encode('utf-8')).hexdigest()[:12]}",
        "date": event_date,
        "time": f"{event_time} ET" if event_time and timezone_name == "America/New_York" else event_time,
        "time_zone": timezone_name,
        "category": "macro",
        "title": title,
        "source": source["publisher"],
        "source_url": extract_url(event, source["url"]),
        "source_grade": "A",
        "primary_source_confirmed": True,
        "date_confidence": "confirmed_primary",
        "schedule_origin": "dynamic_official_calendar",
        "consensus": None,
        "previous": None,
        **policy,
    }


def plain_html(value: str) -> str:
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", value))).strip()


def parse_bea_schedule(text: str, report_date: str, source: dict[str, Any]) -> list[dict[str, Any]]:
    report_day = date.fromisoformat(report_date)
    events: list[dict[str, Any]] = []
    rows = re.findall(
        r'<tr\b[^>]*class="[^"]*scheduled-releases-type-press[^"]*"[^>]*>(.*?)</tr>',
        text,
        flags=re.IGNORECASE | re.DOTALL,
    )
    for row in rows:
        date_match = re.search(
            r'class="release-date"[^>]*>(.*?)</div>', row, flags=re.IGNORECASE | re.DOTALL,
        )
        time_match = re.search(
            r'<small\b[^>]*>(.*?)</small>', row, flags=re.IGNORECASE | re.DOTALL,
        )
        title_match = re.search(
            r'<td\b[^>]*class="[^"]*release-title[^"]*"[^>]*>(.*?)</td>',
            row,
            flags=re.IGNORECASE | re.DOTALL,
        )
        if not date_match or not title_match:
            continue
        date_text = plain_html(date_match.group(1))
        title = plain_html(title_match.group(1))
        time_text = plain_html(time_match.group(1)) if time_match else None
        try:
            event_day = datetime.strptime(
                f"{date_text} {report_day.year}", "%B %d %Y",
            ).date()
        except ValueError:
            continue
        if event_day < report_day - timedelta(days=180):
            event_day = event_day.replace(year=event_day.year + 1)
        stable_input = f"{source['id']}|{event_day.isoformat()}|{title.casefold()}"
        events.append({
            "event_id": f"{source['id']}-{hashlib.sha256(stable_input.encode('utf-8')).hexdigest()[:12]}",
            "date": event_day.isoformat(),
            "time": f"{time_text} ET" if time_text else None,
            "time_zone": source["time_zone"],
            "category": "macro",
            "title": title,
            "source": source["publisher"],
            "source_url": canonicalize_url(source["url"]),
            "source_grade": "A",
            "primary_source_confirmed": True,
            "date_confidence": "confirmed_primary",
            "schedule_origin": "dynamic_official_calendar",
            "consensus": None,
            "previous": None,
            **event_policy(title),
        })
    return events


def parse_bls_schedule(text: str, source: dict[str, Any], source_url: str) -> list[dict[str, Any]]:
    events: list[dict[str, Any]] = []
    for row in re.findall(r"<tr\b[^>]*>(.*?)</tr>", text, flags=re.IGNORECASE | re.DOTALL):
        cells = [
            plain_html(cell)
            for cell in re.findall(
                r"<t[dh]\b[^>]*>(.*?)</t[dh]>",
                row,
                flags=re.IGNORECASE | re.DOTALL,
            )
        ]
        if len(cells) < 3:
            continue
        date_text, time_text, title = cells[0], cells[1], cells[-1]
        parsed_day = None
        for pattern in ("%A, %B %d, %Y", "%B %d, %Y"):
            try:
                parsed_day = datetime.strptime(date_text, pattern).date()
                break
            except ValueError:
                continue
        if parsed_day is None or not title:
            continue
        time_match = re.search(r"\d{1,2}:\d{2}\s+[AP]M", time_text, flags=re.IGNORECASE)
        normalized_time = time_match.group(0).upper() if time_match else None
        stable_input = f"{source['id']}|{parsed_day.isoformat()}|{title.casefold()}"
        events.append({
            "event_id": f"{source['id']}-{hashlib.sha256(stable_input.encode('utf-8')).hexdigest()[:12]}",
            "date": parsed_day.isoformat(),
            "time": f"{normalized_time} ET" if normalized_time else None,
            "time_zone": source["time_zone"],
            "category": "macro",
            "title": title,
            "source": source["publisher"],
            "source_url": canonicalize_url(source_url),
            "source_grade": "A",
            "primary_source_confirmed": True,
            "date_confidence": "confirmed_primary",
            "schedule_origin": "dynamic_official_calendar_fallback",
            "consensus": None,
            "previous": None,
            **event_policy(title),
        })
    return events


DOL_RELEASE_NOTICE_PATTERNS = (
    (
        "Consumer Price Index",
        re.compile(
            r"The\s+Consumer\s+Price\s+Index(?:\s+news\s+release)?\s+for\s+"
            r"(?P<period>[A-Za-z]+\s+\d{4})\s+is\s+scheduled\s+to\s+be\s+"
            r"(?:released|published)\s+on\s+(?:[A-Za-z]+,\s+)?"
            r"(?P<date>[A-Za-z]+\s+\d{1,2},\s+\d{4}),?\s+at\s+"
            r"(?P<time>\d{1,2}:\d{2}\s+[ap]\.m\.)",
            flags=re.IGNORECASE,
        ),
    ),
    (
        "Producer Price Index",
        re.compile(
            r"The\s+Producer\s+Price\s+Index(?:\s+news\s+release)?\s+for\s+"
            r"(?P<period>[A-Za-z]+\s+\d{4})\s+is\s+scheduled\s+to\s+be\s+"
            r"(?:released|published)\s+on\s+(?:[A-Za-z]+,\s+)?"
            r"(?P<date>[A-Za-z]+\s+\d{1,2},\s+\d{4}),?\s+at\s+"
            r"(?P<time>\d{1,2}:\d{2}\s+[ap]\.m\.)",
            flags=re.IGNORECASE,
        ),
    ),
    (
        "Employment Situation",
        re.compile(
            r"The\s+Employment\s+Situation(?:\s+news\s+release)?\s+for\s+"
            r"(?P<period>[A-Za-z]+\s+\d{4})\s+is\s+scheduled\s+to\s+be\s+"
            r"published\s+on\s+(?:[A-Za-z]+,\s+)?"
            r"(?P<date>[A-Za-z]+\s+\d{1,2},\s+\d{4}),?\s+at\s+"
            r"(?P<time>\d{1,2}:\d{2}\s+[ap]\.m\.)",
            flags=re.IGNORECASE,
        ),
    ),
)


def discover_dol_release_urls(text: str, page_url: str) -> list[str]:
    links = re.findall(
        r'href=["\']([^"\']*?/economicdata/(?:cpi|ppi|empsit)_\d{8}\.pdf)["\']',
        text,
        flags=re.IGNORECASE,
    )
    return list(dict.fromkeys(urljoin(page_url, html.unescape(link)) for link in links))


def parse_dol_release_notice(
    payload: bytes,
    source: dict[str, Any],
    source_url: str,
) -> list[dict[str, Any]]:
    try:
        from pypdf import PdfReader
    except ImportError as exc:  # pragma: no cover - dependency is part of requirements.txt
        raise RuntimeError("Install pypdf to parse official DOL release notices") from exc

    document = PdfReader(io.BytesIO(payload))
    text_content = "\n".join(page.extract_text() or "" for page in document.pages)
    return parse_dol_release_notice_text(text_content, source, source_url)


def parse_dol_release_notice_text(
    text_content: str,
    source: dict[str, Any],
    source_url: str,
) -> list[dict[str, Any]]:
    normalized_text = re.sub(r"\s+", " ", text_content)
    events: list[dict[str, Any]] = []
    for title_prefix, pattern in DOL_RELEASE_NOTICE_PATTERNS:
        match = pattern.search(normalized_text)
        if not match:
            continue
        event_day = datetime.strptime(match.group("date"), "%B %d, %Y").date()
        normalized_time = match.group("time").replace(".", "").upper()
        title = f"{title_prefix} for {match.group('period')}"
        stable_input = f"{source['id']}|{event_day.isoformat()}|{title.casefold()}"
        events.append({
            "event_id": f"{source['id']}-{hashlib.sha256(stable_input.encode('utf-8')).hexdigest()[:12]}",
            "date": event_day.isoformat(),
            "time": f"{normalized_time} ET",
            "time_zone": source["time_zone"],
            "category": "macro",
            "title": title,
            "source": source["publisher"],
            "source_url": canonicalize_url(source_url),
            "source_grade": "A",
            "primary_source_confirmed": True,
            "date_confidence": "confirmed_primary",
            "schedule_origin": "dynamic_official_release_notice_fallback",
            "consensus": None,
            "previous": None,
            **event_policy(title),
        })
    return events


def fallback_month_urls(
    source: dict[str, Any],
    start: date,
    end: date,
) -> list[str]:
    template = str(source.get("fallback_url_template") or "")
    if not template:
        return []
    months: list[tuple[int, int]] = []
    cursor = start.replace(day=1)
    while cursor <= end:
        months.append((cursor.year, cursor.month))
        cursor = (
            cursor.replace(year=cursor.year + 1, month=1)
            if cursor.month == 12
            else cursor.replace(month=cursor.month + 1)
        )
    return [
        template.format(year=year, month=f"{month:02d}")
        for year, month in months
    ]


def collect_official_calendar(
    report_date: str,
    config: dict[str, Any],
    fetcher: Callable[[str], str] = fetch_text,
    binary_fetcher: Callable[[str], bytes] = fetch_bytes,
) -> dict[str, Any]:
    settings = config.get("official_market_calendar") or {}
    start = date.fromisoformat(report_date)
    end = start + timedelta(days=int(settings.get("lookahead_days", 7)))
    include_titles = [str(item).casefold() for item in settings.get("include_titles", [])]
    events: list[dict[str, Any]] = []
    sources: list[dict[str, Any]] = []
    errors: list[dict[str, str]] = []

    if not settings.get("enabled", False):
        return {
            "schema_version": SCHEMA_VERSION,
            "report_date": report_date,
            "collection_status": "disabled",
            "sources": [],
            "events": [],
            "errors": [],
        }

    for source in settings.get("sources", []):
        source_status = {
            "source_id": source.get("id"),
            "publisher": source.get("publisher"),
            "source_url": canonicalize_url(str(source.get("url") or "")),
            "source_grade": "A",
        }
        try:
            fallback_used = ""
            primary_error_type = None
            try:
                if source.get("format", "ics") == "bea_html":
                    normalized_events = parse_bea_schedule(fetcher(source["url"]), report_date, source)
                else:
                    normalized_events = [
                        normalized for raw_event in parse_ics_events(fetcher(source["url"]))
                        if (normalized := normalize_event(raw_event, source)) is not None
                    ]
            except Exception as primary_exc:
                primary_error_type = type(primary_exc).__name__
                if source.get("fallback_format") != "bls_html":
                    raise
                normalized_events = []
                for fallback_url in fallback_month_urls(source, start, end):
                    try:
                        normalized_events.extend(
                            parse_bls_schedule(fetcher(fallback_url), source, fallback_url)
                        )
                    except Exception:
                        continue
                if normalized_events:
                    fallback_used = "html"
                elif source.get("secondary_fallback_format") == "dol_release_notices":
                    notice_page_url = str(source.get("secondary_fallback_url") or "")
                    notice_urls = discover_dol_release_urls(fetcher(notice_page_url), notice_page_url)
                    for notice_url in notice_urls:
                        normalized_events.extend(
                            parse_dol_release_notice(binary_fetcher(notice_url), source, notice_url)
                        )
                    if normalized_events:
                        fallback_used = "official_release_notices"
                if not normalized_events:
                    raise primary_exc
            accepted = 0
            for normalized in normalized_events:
                event_day = date.fromisoformat(normalized["date"])
                if not start <= event_day <= end:
                    continue
                if include_titles and not any(token in normalized["title"].casefold() for token in include_titles):
                    continue
                events.append(normalized)
                accepted += 1
            sources.append({
                **source_status,
                "status": (
                    f"complete_fallback_{fallback_used}" if fallback_used else "complete"
                ),
                "accepted_event_count": accepted,
                **({"primary_error_type": primary_error_type} if fallback_used else {}),
            })
        except Exception as exc:
            errors.append({"source_id": str(source.get("id") or "unknown"), "error_type": type(exc).__name__})
            sources.append({**source_status, "status": "failed", "accepted_event_count": 0})

    unique_events = {item["event_id"]: item for item in events}
    collection_status = "failed_fallback_manual" if errors and not unique_events else (
        "partial" if errors else "complete"
    )
    collected_at = datetime.now(timezone.utc).isoformat()
    return {
        "schema_version": SCHEMA_VERSION,
        "report_date": report_date,
        "collection_status": collection_status,
        "collected_at": collected_at,
        "last_successful_at": collected_at if collection_status in {"complete", "partial"} else None,
        "sources": sources,
        "events": sorted(unique_events.values(), key=lambda item: (item["date"], item.get("time") or "")),
        "errors": errors,
        "policy_note": "Official schedules establish timing only. Consensus and previous values remain null unless separately sourced.",
    }


def carry_forward_last_successful_at(
    payload: dict[str, Any],
    previous_payload: dict[str, Any] | None,
) -> dict[str, Any]:
    """Keep the last known good collection time across a failed refresh."""
    result = dict(payload)
    if not result.get("last_successful_at") and previous_payload:
        result["last_successful_at"] = previous_payload.get("last_successful_at")
    return result


def write_calendar(payload: dict[str, Any]) -> Path:
    output_dir = ROOT / "workspace" / "market_calendar" / payload["report_date"]
    output_dir.mkdir(parents=True, exist_ok=True)
    output = output_dir / "official_market_calendar.json"
    previous_payload = None
    if output.exists():
        try:
            previous_payload = json.loads(output.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            previous_payload = None
    persisted_payload = carry_forward_last_successful_at(payload, previous_payload)
    output.write_text(
        json.dumps(persisted_payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return output


def main() -> None:
    parser = argparse.ArgumentParser(description="Collect official economic release schedules.")
    parser.add_argument("--date", default=date.today().isoformat())
    parser.add_argument("--ics-file", help="Use a local ICS fixture instead of network retrieval.")
    args = parser.parse_args()
    config = load_source_config()
    fetcher = fetch_text
    if args.ics_file:
        fixture = Path(args.ics_file)
        fetcher = lambda _url: fixture.read_text(encoding="utf-8-sig")
    payload = collect_official_calendar(args.date, config, fetcher=fetcher)
    output = write_calendar(payload)
    print(f"Official market calendar saved: {output.relative_to(ROOT)} ({payload['collection_status']})")


if __name__ == "__main__":
    main()
