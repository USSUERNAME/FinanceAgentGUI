import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { sendJson } from "./codexProbe.mjs";

const WEB_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const GUIBUILD_ROOT = resolve(WEB_ROOT, "..");
const DATA_DIR = join(GUIBUILD_ROOT, "data");
const EARNINGS_STORE_PATH = join(DATA_DIR, "earnings-calendar-cache.json");
const DEFAULT_LOOKAHEAD_DAYS = 45;
const DEFAULT_LIMIT = 1000;
const MAX_LOOKAHEAD_DAYS = 120;
const MAX_LIMIT = 1000;
const RETENTION_DAYS = 183;
const CACHE_TTL_MS = 15 * 60 * 1000;
const EARNINGS_FETCH_TIMEOUT_MS = 45000;
const FINALIZED_CACHE_AFTER_HOURS = 24;
const FINALIZED_CACHE_AFTER_MS = FINALIZED_CACHE_AFTER_HOURS * 60 * 60 * 1000;
const FETCH_CHUNK_DAYS = 1;
const MAX_EVENTS_PER_DAY = 6;
const MIN_DISPLAY_MARKET_CAP_USD = 1_000_000_000;
const EXCLUDE_OVERSEAS_OTC = false;
const PYTHON_UTF8_ENV = {
  ...process.env,
  PYTHONIOENCODING: "utf-8",
  PYTHONUTF8: "1",
  PYTHONUNBUFFERED: "1",
};

const cache = new Map();

function clampNumber(value, fallback, min, max) {
  if (value === null || value === undefined || value === "") return fallback;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(numeric)));
}

function findPythonCommand() {
  const localVenvPython =
    process.platform === "win32"
      ? join(GUIBUILD_ROOT, ".venv", "Scripts", "python.exe")
      : join(GUIBUILD_ROOT, ".venv", "bin", "python");

  const candidates =
    process.platform === "win32"
      ? [
          { command: localVenvPython, argsPrefix: [], display: ".venv/Scripts/python.exe" },
          { command: "py", argsPrefix: ["-3"], display: "py -3" },
          { command: "python", argsPrefix: [], display: "python" },
          { command: "python3", argsPrefix: [], display: "python3" },
        ]
      : [
          { command: localVenvPython, argsPrefix: [], display: ".venv/bin/python" },
          { command: "python3", argsPrefix: [], display: "python3" },
          { command: "python", argsPrefix: [], display: "python" },
        ];

  let fallback = null;

  for (const candidate of candidates) {
    if (candidate.command.includes(".venv") && !existsSync(candidate.command)) continue;
    const versionResult = spawnSync(candidate.command, [...candidate.argsPrefix, "--version"], {
      encoding: "utf8",
      env: PYTHON_UTF8_ENV,
      timeout: 3000,
    });
    if (versionResult.error || versionResult.status !== 0) continue;
    fallback ||= candidate;

    const importResult = spawnSync(candidate.command, [...candidate.argsPrefix, "-c", "import pandas, yfinance"], {
      encoding: "utf8",
      env: PYTHON_UTF8_ENV,
      timeout: 5000,
    });
    if (!importResult.error && importResult.status === 0) return candidate;
  }

  return fallback;
}

function parseDateKey(value) {
  const raw = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : "";
}

function addDaysToDateKey(dateKey, days) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
}

function maxDateKey(left, right) {
  if (!left) return right || "";
  if (!right) return left;
  return left > right ? left : right;
}

function dateKeyInKorea(value = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(new Date()).map((part) => [part.type, part.value])
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function todayDateKeyInKorea() {
  return dateKeyInKorea(new Date());
}

function emptyEarningsStore() {
  return {
    version: 2,
    source: "yfinance",
    timezone: "Asia/Seoul",
    retentionDays: RETENTION_DAYS,
    updatedAt: "",
    lastFetch: null,
    cachePolicy: {
      finalizedAfterHours: FINALIZED_CACHE_AFTER_HOURS,
      persistObservedEvents: true,
    },
    cachedFinalizedRanges: [],
    events: [],
  };
}

function readEarningsStore() {
  if (!existsSync(EARNINGS_STORE_PATH)) return emptyEarningsStore();

  try {
    const parsed = JSON.parse(readFileSync(EARNINGS_STORE_PATH, "utf8"));
    const parsedVersion = Number(parsed?.version) || 1;
    return {
      ...emptyEarningsStore(),
      ...parsed,
      version: 2,
      cachePolicy: {
        finalizedAfterHours: FINALIZED_CACHE_AFTER_HOURS,
        persistObservedEvents: true,
        ...(parsed.cachePolicy || {}),
      },
      cachedFinalizedRanges: parsedVersion >= 2 && Array.isArray(parsed.cachedFinalizedRanges)
        ? parsed.cachedFinalizedRanges.filter((range) => parseDateKey(range?.startDate) && parseDateKey(range?.endDate))
        : [],
      events: Array.isArray(parsed.events) ? parsed.events : [],
    };
  } catch {
    return emptyEarningsStore();
  }
}

function writeEarningsStore(store) {
  mkdirSync(DATA_DIR, { recursive: true });
  const tmpPath = `${EARNINGS_STORE_PATH}.tmp`;
  writeFileSync(tmpPath, `${JSON.stringify(store, null, 2)}\n`);
  renameSync(tmpPath, EARNINGS_STORE_PATH);
}

function eventCacheKey(event) {
  return [
    String(event?.symbol || "").trim().toUpperCase(),
    String(event?.announcementDate || event?.dateKey || "").trim(),
  ].join("|");
}

function eventDateKey(event) {
  return parseDateKey(event?.dateKey) || parseDateKey(event?.announcementDate) || "";
}

function parseMarketCapValue(event) {
  const rawValue = Number(event?.marketCapValue);
  if (Number.isFinite(rawValue)) return rawValue;

  const rawText = String(event?.marketCap || "").trim().toUpperCase().replace(/,/g, "");
  const match = rawText.match(/^(-?\d+(?:\.\d+)?)([KMBT])?$/);
  if (!match) return 0;
  const numeric = Number(match[1]);
  if (!Number.isFinite(numeric)) return 0;
  const multiplier = {
    K: 1_000,
    M: 1_000_000,
    B: 1_000_000_000,
    T: 1_000_000_000_000,
  }[match[2] || ""] || 1;
  return numeric * multiplier;
}

function eventTimeMs(event) {
  const raw = event?.eventStartUtc || event?.kstDateTime || "";
  const timestamp = Date.parse(raw);
  return Number.isFinite(timestamp) ? timestamp : NaN;
}

function isFinalizedEarningsEvent(event, nowMs = Date.now()) {
  const timestamp = eventTimeMs(event);
  return Number.isFinite(timestamp) && timestamp <= nowMs - FINALIZED_CACHE_AFTER_MS;
}

function finalizedFullRangeEndDate(nowMs = Date.now()) {
  return dateKeyInKorea(new Date(nowMs - FINALIZED_CACHE_AFTER_MS));
}

function rangeIsFullyFinalized(startDate, endDate, nowMs = Date.now()) {
  return Boolean(startDate && endDate && endDate <= finalizedFullRangeEndDate(nowMs));
}

function sortEarningsEvents(events) {
  return [...events].sort((left, right) => {
    const leftDate = eventDateKey(left);
    const rightDate = eventDateKey(right);
    if (leftDate !== rightDate) return leftDate.localeCompare(rightDate);
    const leftTime = String(left.kstDateTime || left.eventStartUtc || "");
    const rightTime = String(right.kstDateTime || right.eventStartUtc || "");
    if (leftTime !== rightTime) return leftTime.localeCompare(rightTime);
    return String(left.symbol || "").localeCompare(String(right.symbol || ""));
  });
}

function sortEarningsEventsForDisplay(events) {
  return [...events].sort((left, right) => {
    const leftDate = eventDateKey(left);
    const rightDate = eventDateKey(right);
    if (leftDate !== rightDate) return leftDate.localeCompare(rightDate);
    const marketCapDiff = parseMarketCapValue(right) - parseMarketCapValue(left);
    if (marketCapDiff !== 0) return marketCapDiff;
    return String(left.symbol || "").localeCompare(String(right.symbol || ""));
  });
}

function mergeStoredEarnings(existingEvents, fetchedEvents, retentionStartDate) {
  const merged = new Map();

  for (const event of existingEvents) {
    const key = eventCacheKey(event);
    const dateKey = eventDateKey(event);
    if (!key.trim() || !dateKey || dateKey < retentionStartDate) continue;
    merged.set(key, event);
  }

  for (const event of fetchedEvents) {
    const key = eventCacheKey(event);
    const dateKey = eventDateKey(event);
    if (!key.trim() || !dateKey || dateKey < retentionStartDate) continue;
    merged.set(key, event);
  }

  return sortEarningsEvents([...merged.values()]);
}

function buildStoredEarningsEvents(
  existingEvents,
  fetchedEvents,
  retentionStartDate,
  nowMs = Date.now(),
  observedAt = new Date().toISOString()
) {
  const existingByKey = new Map(existingEvents.map((event) => [eventCacheKey(event), event]));
  const observedEvents = fetchedEvents.map((event) => {
    const previous = existingByKey.get(eventCacheKey(event));
    const finalizedAt = isFinalizedEarningsEvent(event, nowMs)
      ? previous?.cachedFinalizedAt || observedAt
      : previous?.cachedFinalizedAt;
    return {
      ...event,
      cachedObservedAt: previous?.cachedObservedAt || observedAt,
      cachedLastSeenAt: observedAt,
      ...(finalizedAt ? { cachedFinalizedAt: finalizedAt } : {}),
    };
  });
  return mergeStoredEarnings(existingEvents, observedEvents, retentionStartDate);
}

function mergeCachedFinalizedRanges(existingRanges, nextRange) {
  const ranges = Array.isArray(existingRanges) ? [...existingRanges] : [];
  if (nextRange?.startDate && nextRange?.endDate && nextRange.startDate < nextRange.endDate) {
    ranges.push(nextRange);
  }
  const deduped = new Map();
  for (const range of ranges) {
    const startDate = parseDateKey(range?.startDate);
    const endDate = parseDateKey(range?.endDate);
    if (!startDate || !endDate || startDate >= endDate) continue;
    deduped.set(`${startDate}|${endDate}`, {
      startDate,
      endDate,
      cachedAt: range.cachedAt || "",
      eventCount: Number.isFinite(Number(range.eventCount)) ? Number(range.eventCount) : 0,
    });
  }
  return [...deduped.values()].sort((left, right) =>
    left.startDate === right.startDate
      ? left.endDate.localeCompare(right.endDate)
      : left.startDate.localeCompare(right.startDate)
  );
}

function cachedFinalizedRangeCovers(ranges, startDate, endDate) {
  return (ranges || []).some((range) => range.startDate <= startDate && range.endDate >= endDate);
}

function limitEarningsEventsByDay(events, maxEventsPerDay = MAX_EVENTS_PER_DAY) {
  const groups = new Map();
  for (const event of events) {
    const dateKey = eventDateKey(event);
    if (!dateKey) continue;
    if (EXCLUDE_OVERSEAS_OTC && event?.isOverseasOtc) continue;
    if (parseMarketCapValue(event) < MIN_DISPLAY_MARKET_CAP_USD) continue;
    const rows = groups.get(dateKey) || [];
    rows.push(event);
    groups.set(dateKey, rows);
  }

  const limitedEvents = [];
  for (const rows of groups.values()) {
    limitedEvents.push(
      ...sortEarningsEventsForDisplay(rows).slice(0, maxEventsPerDay)
    );
  }
  return sortEarningsEventsForDisplay(limitedEvents);
}

function filterEarningsEvents(events, startDate, endDate) {
  const filteredEvents = sortEarningsEvents(
    events.filter((event) => {
      const dateKey = eventDateKey(event);
      return dateKey && dateKey >= startDate && dateKey < endDate;
    })
  );
  return limitEarningsEventsByDay(filteredEvents);
}

function earningsStoreResponse({
  store,
  startDate,
  endDate,
  fetchPayload = null,
  fetchStartDate,
  fetchEndDate,
  retentionStartDate,
  warning = "",
  responseEvents = null,
}) {
  const events = filterEarningsEvents(responseEvents || store.events, startDate, endDate);
  const latestEventDate = events.reduce((latest, event) => maxDateKey(latest, eventDateKey(event)), "");
  return {
    ok: true,
    source: "yfinance",
    timezone: "Asia/Seoul",
    startDate,
    endDate: maxDateKey(endDate, latestEventDate),
    fetchStartDate,
    fetchEndDate,
    retentionStartDate,
    generatedAt: fetchPayload?.generatedAt || store.updatedAt || new Date().toISOString(),
    updatedAt: store.updatedAt || "",
    events,
    warnings: [
      ...(Array.isArray(fetchPayload?.warnings) ? fetchPayload.warnings : []),
      ...(fetchPayload?.truncated
        ? [
            `yfinance earnings fetch reached the ${fetchPayload.requestedLimit || MAX_LIMIT} row per-chunk safety limit for ${fetchPayload.truncatedChunks?.length || 1} date chunk(s).`,
          ]
        : []),
      ...(warning ? [warning] : []),
    ],
    rowCount: events.length,
    fetchedRowCount: Array.isArray(fetchPayload?.events) ? fetchPayload.events.length : 0,
    persistentCache: {
      path: "data/earnings-calendar-cache.json",
      retentionDays: RETENTION_DAYS,
      updatedAt: store.updatedAt || "",
      eventCount: store.events.length,
      lastFetch: store.lastFetch,
      cachePolicy: store.cachePolicy || {
        finalizedAfterHours: FINALIZED_CACHE_AFTER_HOURS,
        persistObservedEvents: true,
      },
      cachedFinalizedRanges: store.cachedFinalizedRanges || [],
    },
    displayPolicy: {
      maxEventsPerDay: MAX_EVENTS_PER_DAY,
      minMarketCapUsd: MIN_DISPLAY_MARKET_CAP_USD,
      excludeOverseasOtc: EXCLUDE_OVERSEAS_OTC,
      ranking: "marketCap desc",
    },
    sourceTruncated: Boolean(fetchPayload?.truncated),
  };
}

const yfinanceEarningsScript = String.raw`
import argparse
import json
import math
import sys
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

for stream in (sys.stdout, sys.stderr):
    try:
        stream.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

parser = argparse.ArgumentParser()
parser.add_argument("--start", required=True)
parser.add_argument("--end", required=True)
parser.add_argument("--limit", type=int, required=True)
parser.add_argument("--force", action="store_true")
args = parser.parse_args()

try:
    import pandas as pd
    import yfinance as yf
except Exception as exc:
    print(json.dumps({
        "ok": False,
        "errorCode": "YFINANCE_NOT_AVAILABLE",
        "error": str(exc) or "yfinance is not installed",
        "installCommand": f"{sys.executable} -m pip install --upgrade yfinance",
    }, ensure_ascii=False))
    sys.exit(0)

KST = ZoneInfo("Asia/Seoul")
FETCH_START_DATE = datetime.strptime(args.start, "%Y-%m-%d").date()
FETCH_END_DATE = datetime.strptime(args.end, "%Y-%m-%d").date()

def is_blank(value):
    if value is None:
        return True
    try:
        return bool(pd.isna(value))
    except Exception:
        return False

def pick(row, names):
    for name in names:
        if name in row and not is_blank(row[name]):
            return row[name]
    return None

def clean_text(value):
    if is_blank(value):
        return "-"
    text = str(value).strip()
    return text if text else "-"

def format_number(value, signed=False):
    if is_blank(value):
        return "-"
    try:
        numeric = float(value)
    except Exception:
        return clean_text(value)
    if not math.isfinite(numeric):
        return "-"
    text = f"{numeric:.2f}".rstrip("0").rstrip(".")
    if signed and numeric > 0:
        return f"+{text}"
    return text

def format_market_cap(value):
    if is_blank(value):
        return "-"
    try:
        numeric = float(value)
    except Exception:
        return clean_text(value)
    if not math.isfinite(numeric):
        return "-"
    sign = "-" if numeric < 0 else ""
    value_abs = abs(numeric)
    for threshold, suffix in ((1_000_000_000_000, "T"), (1_000_000_000, "B"), (1_000_000, "M"), (1_000, "K")):
        if value_abs >= threshold:
            text = f"{value_abs / threshold:.2f}".rstrip("0").rstrip(".")
            return f"{sign}{text}{suffix}"
    return f"{numeric:.0f}"

def numeric_market_cap(value):
    if is_blank(value):
        return None
    try:
        numeric = float(value)
    except Exception:
        return None
    if not math.isfinite(numeric):
        return None
    return numeric

def parse_event_datetime(value):
    if is_blank(value):
        return None
    parsed = pd.to_datetime(value, utc=True, errors="coerce")
    if is_blank(parsed):
        return None
    return parsed.to_pydatetime()

def confidence_for_timing(timing):
    code = str(timing or "").strip().upper()
    if code in ("AMC", "BMO"):
        return "standard"
    if code == "TAS":
        return "low"
    if code == "TNS":
        return "unknown"
    return "unknown"

def is_overseas_otc_symbol(symbol):
    code = str(symbol or "").strip().upper()
    return len(code) == 5 and code.isalpha() and code.endswith(("F", "Y"))

try:
    frames = []
    page_limit = max(1, min(args.limit, 100))
    fetched_page_count = 0
    truncated_chunks = []
    chunk_start = FETCH_START_DATE

    while chunk_start < FETCH_END_DATE:
        chunk_end = min(chunk_start + timedelta(days=${FETCH_CHUNK_DAYS}), FETCH_END_DATE)
        chunk_start_text = chunk_start.isoformat()
        chunk_end_text = chunk_end.isoformat()
        calendars = yf.Calendars(start=chunk_start_text, end=chunk_end_text)
        chunk_truncated = False

        for offset in range(0, args.limit, page_limit):
            page = calendars.get_earnings_calendar(
                start=chunk_start_text,
                end=chunk_end_text,
                limit=page_limit,
                offset=offset,
                filter_most_active=False,
                force=args.force,
            )
            if page is None or page.empty:
                break
            frames.append(page)
            fetched_page_count += 1
            if len(page) < page_limit:
                break
            if offset + page_limit >= args.limit:
                chunk_truncated = True

        if chunk_truncated:
            truncated_chunks.append({"startDate": chunk_start_text, "endDate": chunk_end_text})
        chunk_start = chunk_end

    df = pd.concat(frames) if frames else None
except Exception as exc:
    print(json.dumps({
        "ok": False,
        "errorCode": "YFINANCE_FETCH_FAILED",
        "error": str(exc) or "yfinance earnings calendar request failed",
    }, ensure_ascii=False))
    sys.exit(0)

if df is None or df.empty:
    print(json.dumps({
        "ok": True,
        "source": "yfinance",
        "timezone": "Asia/Seoul",
        "startDate": args.start,
        "endDate": args.end,
        "generatedAt": datetime.now(KST).isoformat(),
        "events": [],
        "warnings": [],
        "rowCount": 0,
        "fetchedPageCount": 0,
        "pageLimit": args.limit,
        "requestedLimit": args.limit,
        "truncated": False,
        "truncatedChunks": [],
    }, ensure_ascii=False))
    sys.exit(0)

records = []
data = df.reset_index()
for index, row in data.iterrows():
    symbol = clean_text(pick(row, ("Symbol", "index", "Ticker")))
    if symbol == "-":
        continue

    event_dt_utc = parse_event_datetime(pick(row, ("Event Start Date", "Start Date", "Date")))
    if event_dt_utc is None:
        continue
    if event_dt_utc.date() < FETCH_START_DATE or event_dt_utc.date() >= FETCH_END_DATE:
        continue
    event_dt_kst = event_dt_utc.astimezone(KST)
    timing = clean_text(pick(row, ("Timing", "Earnings Call Time", "Call Time")))
    timing = timing.upper() if timing != "-" else "-"
    company = clean_text(pick(row, ("Company", "Company Name")))
    event_name = clean_text(pick(row, ("Event Name", "Event")))
    surprise = format_number(pick(row, ("Surprise(%)", "Surprise (%)", "Surprise")), signed=True)
    market_cap_raw = pick(row, ("Marketcap", "Market Cap (Intraday)", "Market Cap"))
    event_id = f"{symbol}-{event_dt_utc.isoformat()}-{index}"
    announcement_date = event_dt_utc.date().isoformat()
    overseas_otc = is_overseas_otc_symbol(symbol)
    calendar_date = announcement_date if overseas_otc else event_dt_kst.date().isoformat()
    calendar_display_label = (
        f"{announcement_date} 발표일"
        if overseas_otc
        else event_dt_kst.strftime("%m/%d %H:%M KST")
    )

    records.append({
        "id": event_id,
        "dateKey": calendar_date,
        "symbol": symbol,
        "company": company,
        "eventName": event_name,
        "callTime": timing,
        "timing": timing,
        "epsEstimate": format_number(pick(row, ("EPS Estimate", "EPS Est.", "Estimate"))),
        "reportedEps": format_number(pick(row, ("Reported EPS", "EPS Actual", "Reported"))),
        "surprise": surprise,
        "marketCap": format_market_cap(market_cap_raw),
        "marketCapValue": numeric_market_cap(market_cap_raw),
        "eventStartUtc": event_dt_utc.isoformat(),
        "kstDateTime": event_dt_kst.isoformat(),
        "kstDateTimeLabel": event_dt_kst.strftime("%m/%d %H:%M KST"),
        "kstTime": event_dt_kst.strftime("%H:%M"),
        "announcementDate": announcement_date,
        "calendarDisplayLabel": calendar_display_label,
        "calendarTimeLabel": "발표일" if overseas_otc else event_dt_kst.strftime("%H:%M"),
        "calendarDateBasis": "announcement-date" if overseas_otc else "kst-converted",
        "calendarDateBasisLabel": "OTC/해외 발표일 기준" if overseas_otc else "KST 변환",
        "isOverseasOtc": overseas_otc,
        "timeConfidence": confidence_for_timing(timing),
        "timeNote": "Yahoo 기준시각",
    })

deduped = {}
for record in records:
    key = (record["symbol"], record["eventStartUtc"], record["eventName"])
    if key not in deduped:
        deduped[key] = record

records = list(deduped.values())
records.sort(key=lambda item: (
    item["kstDateTime"],
    item["symbol"],
))

print(json.dumps({
    "ok": True,
    "source": "yfinance",
    "timezone": "Asia/Seoul",
    "startDate": args.start,
    "endDate": args.end,
    "generatedAt": datetime.now(KST).isoformat(),
    "events": records,
    "warnings": [],
    "rowCount": len(records),
    "fetchedPageCount": fetched_page_count,
    "pageLimit": page_limit,
    "requestedLimit": args.limit,
    "fetchChunkDays": ${FETCH_CHUNK_DAYS},
    "truncated": bool(truncated_chunks),
    "truncatedChunks": truncated_chunks,
}, ensure_ascii=False))
`;

function runYfinanceEarnings({ startDate, endDate, limit, force }) {
  const python = findPythonCommand();
  if (!python) {
    return Promise.resolve({
      ok: false,
      errorCode: "PYTHON_NOT_FOUND",
      error: "python3 또는 python 명령을 찾지 못했습니다.",
      installCommand: "python3 -m pip install --upgrade yfinance",
    });
  }

  return new Promise((resolvePromise) => {
    const child = spawn(
      python.command,
      [
        ...python.argsPrefix,
        "-c",
        yfinanceEarningsScript,
        "--start",
        startDate,
        "--end",
        endDate,
        "--limit",
        String(limit),
        ...(force ? ["--force"] : []),
      ],
      {
        cwd: WEB_ROOT,
        env: PYTHON_UTF8_ENV,
        stdio: ["ignore", "pipe", "pipe"],
      }
    );

    let stdout = "";
    let stderr = "";
    let settled = false;

    const finish = (payload) => {
      if (settled) return;
      settled = true;
      resolvePromise({
        python: {
          display: python.display,
        },
        stderr: stderr.trim(),
        ...payload,
      });
    };

    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      finish({
        ok: false,
        errorCode: "YFINANCE_TIMEOUT",
        error: "yfinance earnings calendar request timed out.",
      });
    }, EARNINGS_FETCH_TIMEOUT_MS);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });

    child.once("error", (error) => {
      clearTimeout(timer);
      finish({
        ok: false,
        errorCode: "PYTHON_SPAWN_FAILED",
        error: error.message,
      });
    });

    child.once("close", (code) => {
      clearTimeout(timer);
      if (settled) return;
      if (code !== 0) {
        finish({
          ok: false,
          errorCode: "YFINANCE_PROCESS_FAILED",
          error: stderr.trim() || `Python process exited with code ${code}`,
        });
        return;
      }

      try {
        finish(JSON.parse(stdout.trim() || "{}"));
      } catch (error) {
        finish({
          ok: false,
          errorCode: "YFINANCE_RESPONSE_PARSE_FAILED",
          error: error.message,
          stdout: stdout.trim().slice(0, 2000),
        });
      }
    });
  });
}

export async function handleEarningsEndpoint(endpoint, req, res) {
  if (endpoint !== "upcoming") {
    sendJson(res, { ok: false, error: "unknown earnings endpoint" }, 404);
    return;
  }

  if (req.method !== "GET") {
    sendJson(res, { ok: false, error: "method not allowed" }, 405);
    return;
  }

  const url = new URL(req.url, "http://127.0.0.1");
  const todayDate = todayDateKeyInKorea();
  const retentionStartDate = addDaysToDateKey(todayDate, -RETENTION_DAYS);
  const startDate = parseDateKey(url.searchParams.get("start")) || todayDate;
  const days = clampNumber(url.searchParams.get("days"), DEFAULT_LOOKAHEAD_DAYS, 1, MAX_LOOKAHEAD_DAYS);
  const parsedEndDate = parseDateKey(url.searchParams.get("end"));
  const endDate = parsedEndDate && parsedEndDate > startDate ? parsedEndDate : addDaysToDateKey(startDate, days);
  const fetchStartDate = addDaysToDateKey(startDate, -1);
  const fetchEndDate = addDaysToDateKey(endDate, 1);
  const limit = clampNumber(url.searchParams.get("limit"), DEFAULT_LIMIT, 1, MAX_LIMIT);
  const force = url.searchParams.get("force") === "1" || url.searchParams.get("force") === "true";
  const cacheKey = JSON.stringify({ endpoint, startDate, endDate, fetchStartDate, fetchEndDate, limit, retentionStartDate });
  const cached = cache.get(cacheKey);
  const nowMs = Date.now();

  if (!force && cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
    sendJson(res, {
      ...cached.payload,
      cache: {
        hit: true,
        cachedAt: new Date(cached.cachedAt).toISOString(),
        ttlSeconds: Math.round((CACHE_TTL_MS - (Date.now() - cached.cachedAt)) / 1000),
      },
    });
    return;
  }

  const storedBeforeFetch = readEarningsStore();
  const requestIsFullyFinalized = rangeIsFullyFinalized(startDate, endDate, nowMs);

  if (
    !force &&
    requestIsFullyFinalized &&
    cachedFinalizedRangeCovers(storedBeforeFetch.cachedFinalizedRanges, startDate, endDate)
  ) {
    const response = {
      ...earningsStoreResponse({
        store: storedBeforeFetch,
        startDate,
        endDate,
        fetchStartDate: "",
        fetchEndDate: "",
        retentionStartDate,
      }),
      cache: {
        hit: true,
        persistent: true,
        finalized: true,
        finalizedAfterHours: FINALIZED_CACHE_AFTER_HOURS,
      },
    };
    cache.set(cacheKey, {
      cachedAt: Date.now(),
      payload: response,
    });
    sendJson(res, response);
    return;
  }

  const payload = await runYfinanceEarnings({ startDate: fetchStartDate, endDate: fetchEndDate, limit, force });
  let response;

  if (payload.ok) {
    const fetchedEvents = Array.isArray(payload.events) ? payload.events : [];
    const cachedAt = new Date().toISOString();
    const storedEvents = buildStoredEarningsEvents(
      storedBeforeFetch.events,
      fetchedEvents,
      retentionStartDate,
      nowMs,
      cachedAt
    );
    const nextCachedFinalizedRanges = mergeCachedFinalizedRanges(
      storedBeforeFetch.cachedFinalizedRanges,
      requestIsFullyFinalized && !payload.truncated
        ? {
            startDate,
            endDate,
            cachedAt,
            eventCount: filterEarningsEvents(storedEvents, startDate, endDate).length,
          }
        : null
    );
    const nextStore = {
      ...emptyEarningsStore(),
      ...storedBeforeFetch,
      source: "yfinance",
      timezone: "Asia/Seoul",
      retentionDays: RETENTION_DAYS,
      updatedAt: cachedAt,
      lastFetch: {
        requestedStartDate: startDate,
        requestedEndDate: endDate,
        fetchStartDate,
        fetchEndDate,
        generatedAt: payload.generatedAt || "",
        fetchedRowCount: fetchedEvents.length,
        fetchedPageCount: payload.fetchedPageCount ?? null,
        sourceTruncated: Boolean(payload.truncated),
        fetchChunkDays: payload.fetchChunkDays ?? FETCH_CHUNK_DAYS,
        truncatedChunks: Array.isArray(payload.truncatedChunks) ? payload.truncatedChunks : [],
        finalizedCachedCount: storedEvents.filter((event) => isFinalizedEarningsEvent(event, nowMs)).length,
        observedCachedCount: storedEvents.length,
      },
      cachePolicy: {
        finalizedAfterHours: FINALIZED_CACHE_AFTER_HOURS,
        persistObservedEvents: true,
      },
      cachedFinalizedRanges: nextCachedFinalizedRanges,
      events: storedEvents,
    };
    writeEarningsStore(nextStore);

    const responseEvents = mergeStoredEarnings(storedEvents, fetchedEvents, retentionStartDate);
    response = {
      ...earningsStoreResponse({
        store: nextStore,
        startDate,
        endDate,
        fetchPayload: payload,
        fetchStartDate,
        fetchEndDate,
        retentionStartDate,
        responseEvents,
      }),
      python: payload.python || null,
      stderr: payload.stderr || "",
      cache: {
        hit: false,
        ttlSeconds: Math.round(CACHE_TTL_MS / 1000),
        finalizedAfterHours: FINALIZED_CACHE_AFTER_HOURS,
        persistentEventCount: storedEvents.length,
        persistentFinalizedEventCount: storedEvents.filter((event) => isFinalizedEarningsEvent(event, nowMs)).length,
      },
    };

    cache.set(cacheKey, {
      cachedAt: Date.now(),
      payload: response,
    });

    sendJson(res, response);
    return;
  }

  const fallbackEvents = filterEarningsEvents(storedBeforeFetch.events, startDate, endDate);
  if (fallbackEvents.length) {
    const retainedEvents = mergeStoredEarnings(storedBeforeFetch.events, [], retentionStartDate);
    const fallbackStore = {
      ...emptyEarningsStore(),
      ...storedBeforeFetch,
      events: retainedEvents,
      retentionDays: RETENTION_DAYS,
    };
    if (retainedEvents.length !== storedBeforeFetch.events.length) {
      writeEarningsStore({
        ...fallbackStore,
        updatedAt: new Date().toISOString(),
      });
    }

    response = {
      ...earningsStoreResponse({
        store: fallbackStore,
        fetchPayload: null,
        fetchStartDate,
        fetchEndDate,
        startDate,
        endDate,
        retentionStartDate,
        warning: `yfinance refresh failed; using saved earnings cache. ${payload.error || ""}`.trim(),
      }),
      yfinanceError: {
        errorCode: payload.errorCode || "YFINANCE_FETCH_FAILED",
        error: payload.error || "yfinance refresh failed",
        installCommand: payload.installCommand || "",
      },
      cache: {
        hit: false,
        fallback: true,
        ttlSeconds: Math.round(CACHE_TTL_MS / 1000),
      },
    };
    sendJson(res, response);
    return;
  }

  response = {
    ...payload,
    persistentCache: {
      path: "data/earnings-calendar-cache.json",
      retentionDays: RETENTION_DAYS,
      updatedAt: "",
      eventCount: 0,
      lastFetch: null,
      cachePolicy: {
        finalizedAfterHours: FINALIZED_CACHE_AFTER_HOURS,
        persistObservedEvents: true,
      },
      cachedFinalizedRanges: [],
    },
    cache: {
      hit: false,
      ttlSeconds: Math.round(CACHE_TTL_MS / 1000),
    },
  };

  sendJson(res, response, 502);
}

export const __earningsApiTestHooks = Object.freeze({
  buildStoredEarningsEvents,
  eventCacheKey,
  filterEarningsEvents,
  isFinalizedEarningsEvent,
  mergeStoredEarnings,
});
