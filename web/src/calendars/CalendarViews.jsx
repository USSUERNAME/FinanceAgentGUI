import React, { useEffect, useMemo, useRef, useState } from "react";
import "./calendars.css";
import Filter from "lucide-react/dist/esm/icons/filter.js";
import LoaderCircle from "lucide-react/dist/esm/icons/loader-circle.js";
import RefreshCw from "lucide-react/dist/esm/icons/refresh-cw.js";
import AlertTriangle from "lucide-react/dist/esm/icons/triangle-alert.js";
import ExternalLink from "lucide-react/dist/esm/icons/external-link.js";

const calendarWeekdays = [
  { key: "mon", label: "월" },
  { key: "tue", label: "화" },
  { key: "wed", label: "수" },
  { key: "thu", label: "목" },
  { key: "fri", label: "금" },
  { key: "sat", label: "토" },
];

const EARNINGS_LIMIT = 1000;
const ECONOMIC_TRANSLATION_POLL_MS = 3000;

const economicCountryGroupOrder = ["아시아", "북미", "남미", "유럽", "오세아니아", "아프리카", "기타"];

const economicCountryCodeAliases = {
  EA: "EMU",
  EZ: "EMU",
  UK: "GB",
};

const economicCountryFallbacks = [
  ["AE", "아랍에미리트", "🇦🇪", "아시아"],
  ["BH", "바레인", "🇧🇭", "아시아"],
  ["CN", "중국 본토", "🇨🇳", "아시아"],
  ["HK", "홍콩", "🇭🇰", "아시아"],
  ["ID", "인도네시아", "🇮🇩", "아시아"],
  ["IL", "이스라엘", "🇮🇱", "아시아"],
  ["IN", "인도", "🇮🇳", "아시아"],
  ["JP", "일본", "🇯🇵", "아시아"],
  ["KR", "대한민국", "🇰🇷", "아시아"],
  ["KW", "쿠웨이트", "🇰🇼", "아시아"],
  ["MY", "말레이시아", "🇲🇾", "아시아"],
  ["OM", "오만", "🇴🇲", "아시아"],
  ["PH", "필리핀", "🇵🇭", "아시아"],
  ["QA", "카타르", "🇶🇦", "아시아"],
  ["SA", "사우디아라비아", "🇸🇦", "아시아"],
  ["SG", "싱가포르", "🇸🇬", "아시아"],
  ["TH", "태국", "🇹🇭", "아시아"],
  ["TR", "튀르키예", "🇹🇷", "아시아"],
  ["TW", "대만", "🇹🇼", "아시아"],
  ["VN", "베트남", "🇻🇳", "아시아"],
  ["CA", "캐나다", "🇨🇦", "북미"],
  ["MX", "멕시코", "🇲🇽", "북미"],
  ["US", "미국", "🇺🇸", "북미"],
  ["AR", "아르헨티나", "🇦🇷", "남미"],
  ["BR", "브라질", "🇧🇷", "남미"],
  ["CL", "칠레", "🇨🇱", "남미"],
  ["CO", "콜롬비아", "🇨🇴", "남미"],
  ["PE", "페루", "🇵🇪", "남미"],
  ["AT", "오스트리아", "🇦🇹", "유럽"],
  ["BE", "벨기에", "🇧🇪", "유럽"],
  ["BG", "불가리아", "🇧🇬", "유럽"],
  ["CH", "스위스", "🇨🇭", "유럽"],
  ["CY", "키프로스", "🇨🇾", "유럽"],
  ["CZ", "체코", "🇨🇿", "유럽"],
  ["DE", "독일", "🇩🇪", "유럽"],
  ["DK", "덴마크", "🇩🇰", "유럽"],
  ["EE", "에스토니아", "🇪🇪", "유럽"],
  ["EMU", "유로존", "🇪🇺", "유럽"],
  ["ES", "스페인", "🇪🇸", "유럽"],
  ["EU", "유럽연합", "🇪🇺", "유럽"],
  ["FI", "핀란드", "🇫🇮", "유럽"],
  ["FR", "프랑스", "🇫🇷", "유럽"],
  ["GB", "영국", "🇬🇧", "유럽"],
  ["GR", "그리스", "🇬🇷", "유럽"],
  ["HR", "크로아티아", "🇭🇷", "유럽"],
  ["HU", "헝가리", "🇭🇺", "유럽"],
  ["IE", "아일랜드", "🇮🇪", "유럽"],
  ["IS", "아이슬란드", "🇮🇸", "유럽"],
  ["IT", "이탈리아", "🇮🇹", "유럽"],
  ["LT", "리투아니아", "🇱🇹", "유럽"],
  ["LU", "룩셈부르크", "🇱🇺", "유럽"],
  ["LV", "라트비아", "🇱🇻", "유럽"],
  ["MT", "몰타", "🇲🇹", "유럽"],
  ["NL", "네덜란드", "🇳🇱", "유럽"],
  ["NO", "노르웨이", "🇳🇴", "유럽"],
  ["PL", "폴란드", "🇵🇱", "유럽"],
  ["PT", "포르투갈", "🇵🇹", "유럽"],
  ["RO", "루마니아", "🇷🇴", "유럽"],
  ["RU", "러시아", "🇷🇺", "유럽"],
  ["SE", "스웨덴", "🇸🇪", "유럽"],
  ["SI", "슬로베니아", "🇸🇮", "유럽"],
  ["SK", "슬로바키아", "🇸🇰", "유럽"],
  ["UA", "우크라이나", "🇺🇦", "유럽"],
  ["AU", "호주", "🇦🇺", "오세아니아"],
  ["NZ", "뉴질랜드", "🇳🇿", "오세아니아"],
  ["EG", "이집트", "🇪🇬", "아프리카"],
  ["GH", "가나", "🇬🇭", "아프리카"],
  ["KE", "케냐", "🇰🇪", "아프리카"],
  ["MW", "말라위", "🇲🇼", "아프리카"],
  ["MZ", "모잠비크", "🇲🇿", "아프리카"],
  ["NG", "나이지리아", "🇳🇬", "아프리카"],
  ["TZ", "탄자니아", "🇹🇿", "아프리카"],
  ["UG", "우간다", "🇺🇬", "아프리카"],
  ["ZA", "남아프리카공화국", "🇿🇦", "아프리카"],
  ["ZM", "잠비아", "🇿🇲", "아프리카"],
].map(([code, country, flag, continent]) => ({ code, country, flag, continent }));

const economicCountryFallbackByCode = new Map(
  economicCountryFallbacks.map((country) => [country.code, country])
);

function startOfLocalDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addCalendarDays(date, days) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

function addCalendarMonths(date, months) {
  const targetMonthStart = new Date(date.getFullYear(), date.getMonth() + months, 1);
  const targetMonthEnd = new Date(targetMonthStart.getFullYear(), targetMonthStart.getMonth() + 1, 0);
  return new Date(
    targetMonthStart.getFullYear(),
    targetMonthStart.getMonth(),
    Math.min(date.getDate(), targetMonthEnd.getDate())
  );
}

function startOfCalendarWeek(date) {
  const value = startOfLocalDay(date);
  const mondayOffset = (value.getDay() + 6) % 7;
  return addCalendarDays(value, -mondayOffset);
}

function startOfVisibleCalendarWeek(date) {
  const value = startOfLocalDay(date);
  if (value.getDay() === 0) return addCalendarDays(value, 1);
  return startOfCalendarWeek(value);
}

function sameCalendarDate(left, right) {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

function calendarDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function localDateFromKey(dateKey) {
  const [year, month, day] = String(dateKey || "").split("-").map(Number);
  return new Date(year, month - 1, day);
}

function formatCalendarMonth(date) {
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "long",
  }).format(date);
}

function formatCalendarDay(date) {
  return new Intl.DateTimeFormat("ko-KR", {
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function formatCalendarRange(startDate, endDate) {
  return `${formatCalendarDay(startDate)} - ${formatCalendarDay(endDate)}`;
}

function formatEarningDetailTitle(dateKey) {
  const date = localDateFromKey(dateKey);
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(date);
}

function formatKoreanDateTitle(dateKey) {
  const date = localDateFromKey(dateKey);
  if (Number.isNaN(date.getTime())) return "날짜 미정";
  return new Intl.DateTimeFormat("ko-KR", {
    month: "long",
    day: "numeric",
    weekday: "long",
  }).format(date);
}

function formatEconomicCardDate(date) {
  return new Intl.DateTimeFormat("ko-KR", {
    month: "numeric",
    day: "numeric",
  }).format(date);
}

function groupEarningsByDate(events) {
  return events.reduce((groups, event) => {
    if (!event.dateKey) return groups;
    const rows = groups.get(event.dateKey) || [];
    rows.push(event);
    groups.set(event.dateKey, rows);
    return groups;
  }, new Map());
}

function groupEconomicEventsByDate(events) {
  return events.reduce((groups, event) => {
    if (!event.dateKey) return groups;
    const rows = groups.get(event.dateKey) || [];
    rows.push(event);
    groups.set(event.dateKey, rows);
    return groups;
  }, new Map());
}

function surpriseTone(value) {
  const numeric = Number(String(value || "").replace("%", ""));
  if (!Number.isFinite(numeric) || numeric === 0) return "";
  return numeric > 0 ? "is-positive" : "is-negative";
}

function parseEarningNumber(value) {
  const normalized = String(value ?? "").replace(/,/g, "").trim();
  if (!normalized || normalized === "-") return null;
  const numeric = Number(normalized);
  return Number.isFinite(numeric) ? numeric : null;
}

function earningResultTone(event) {
  const estimate = parseEarningNumber(event?.epsEstimate);
  const reported = parseEarningNumber(event?.reportedEps);
  if (estimate === null || reported === null) return "is-neutral";
  if (reported > estimate) return "is-beat";
  if (reported < estimate) return "is-miss";
  return "is-inline";
}

function earningResultLabel(event) {
  const tone = earningResultTone(event);
  if (tone === "is-beat") return "어닝 비트";
  if (tone === "is-miss") return "어닝 미스";
  if (tone === "is-inline") return "예상 일치";
  return "발표 전";
}

function buildEarningCalendarWeeks(anchorDate, viewMode) {
  if (viewMode === "week") {
    const weekStart = startOfCalendarWeek(anchorDate);
    return [
      calendarWeekdays.map((_weekday, index) => addCalendarDays(weekStart, index)),
    ];
  }

  const monthStart = new Date(anchorDate.getFullYear(), anchorDate.getMonth(), 1);
  const monthEnd = new Date(anchorDate.getFullYear(), anchorDate.getMonth() + 1, 0);
  const firstWeekStart = startOfVisibleCalendarWeek(monthStart);
  const lastWeekStart = startOfCalendarWeek(monthEnd);
  const weeks = [];

  for (
    let cursor = firstWeekStart;
    cursor.getTime() <= lastWeekStart.getTime();
    cursor = addCalendarDays(cursor, 7)
  ) {
    weeks.push(calendarWeekdays.map((_weekday, index) => addCalendarDays(cursor, index)));
  }

  return weeks;
}

function earningCalendarTitle(anchorDate, viewMode) {
  if (viewMode === "week") {
    const weekStart = startOfCalendarWeek(anchorDate);
    return `${formatCalendarMonth(anchorDate)} · ${formatCalendarRange(weekStart, addCalendarDays(weekStart, 5))}`;
  }
  return formatCalendarMonth(anchorDate);
}

function formatEarningRangeLabel(meta) {
  if (!meta?.startDate || !meta?.endDate) return "다가오는 실적 발표";
  const endDate = localDateFromKey(meta.endDate);
  if (Number.isNaN(endDate.getTime())) return `${meta.startDate} - ${meta.endDate}`;
  const inclusiveEndDate = calendarDateKey(addCalendarDays(endDate, -1));
  if (meta.startDate === inclusiveEndDate) return meta.startDate;
  return `${meta.startDate} - ${inclusiveEndDate}`;
}

function displayEarningValue(value) {
  const text = String(value ?? "").trim();
  return text || "-";
}

function formatEarningMarketCapPolicy(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return "";
  if (numeric >= 1_000_000_000_000) return `$${(numeric / 1_000_000_000_000).toFixed(1)}T+`;
  if (numeric >= 1_000_000_000) return `$${Math.round(numeric / 1_000_000_000)}B+`;
  return "";
}

function timingConfidenceLabel(value) {
  if (value === "standard") return "Yahoo 기준";
  if (value === "low") return "정확도 낮음";
  if (value === "unknown") return "시간 미공개";
  return "Yahoo 기준";
}

function calendarTimeLabel(event) {
  return event?.calendarTimeLabel || event?.kstTime || "";
}

function calendarBasisLabel(event) {
  return event?.calendarDateBasisLabel || timingConfidenceLabel(event?.timeConfidence);
}

function buildEarningsApiUrl({ startDate, endDate, force = false }) {
  const search = new URLSearchParams({
    start: startDate,
    end: endDate,
    limit: String(EARNINGS_LIMIT),
  });
  if (force) search.set("force", "1");
  return `/api/earnings/upcoming?${search.toString()}`;
}

function buildEconomicCalendarApiUrl({ weekStart, force = false }) {
  const search = new URLSearchParams({
    start: calendarDateKey(weekStart),
    days: "6",
    limit: "100",
  });
  if (force) search.set("force", "1");
  return `/api/economic-calendar/events?${search.toString()}`;
}

function economicImpactLabel(value) {
  const level = Number(value || 0);
  if (level >= 3) return "높음";
  if (level === 2) return "중간";
  return "낮음";
}

function economicDisplayValue(value) {
  const text = String(value ?? "").trim();
  return text || "-";
}

function normalizeEconomicTranslationKey(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function translationMemoryShouldPoll(memory) {
  if (!memory || typeof memory !== "object") return false;
  return Boolean(memory.inFlight);
}

function applyEconomicTranslationMemoryToEvents(events, memory) {
  const entries = Array.isArray(memory?.entries) ? memory.entries : [];
  if (!entries.length || !Array.isArray(events) || !events.length) return events;

  const entryByKey = new Map();
  for (const entry of entries) {
    const key = normalizeEconomicTranslationKey(entry?.key || entry?.sourceText);
    if (key) entryByKey.set(key, entry);
  }
  if (!entryByKey.size) return events;

  let changed = false;
  const nextEvents = events.map((event) => {
    const key = normalizeEconomicTranslationKey(event?.eventName);
    const entry = key ? entryByKey.get(key) : null;
    if (!entry) return event;

    const status = String(entry.status || (entry.textKo ? "translated" : "pending")).trim() || "pending";
    const patch = {
      eventNameKo: status === "translated" ? String(entry.textKo || "").trim() : "",
      eventNameTranslationStatus: status,
      eventNameTranslationModel: String(entry.model || ""),
      eventNameTranslationReasoning: String(entry.reasoning || ""),
      eventNameTranslationError: String(entry.error || ""),
    };

    if (
      event.eventNameKo === patch.eventNameKo &&
      event.eventNameTranslationStatus === patch.eventNameTranslationStatus &&
      event.eventNameTranslationModel === patch.eventNameTranslationModel &&
      event.eventNameTranslationReasoning === patch.eventNameTranslationReasoning &&
      event.eventNameTranslationError === patch.eventNameTranslationError
    ) {
      return event;
    }

    changed = true;
    return {
      ...event,
      ...patch,
    };
  });

  return changed ? nextEvents : events;
}

function normalizeEconomicCountryCode(value) {
  const code = String(value || "").trim().toUpperCase().replace(/\s+/g, "");
  return economicCountryCodeAliases[code] || code;
}

function flagForEconomicCountryCode(code) {
  if (!/^[A-Z]{2}$/.test(code)) return "•";
  return String.fromCodePoint(...[...code].map((character) => 0x1f1e6 + character.charCodeAt(0) - 65));
}

function normalizeSelectedCountryCodes(codes) {
  const normalized = Array.isArray(codes)
    ? codes.map(normalizeEconomicCountryCode).filter(Boolean)
    : [];
  return [...new Set(normalized)].sort((left, right) => left.localeCompare(right));
}

function economicCountryOptionFromCode(code) {
  const safeCode = normalizeEconomicCountryCode(code);
  const fallback = economicCountryFallbackByCode.get(safeCode);
  return fallback || {
    code: safeCode,
    country: safeCode || "기타",
    flag: safeCode ? flagForEconomicCountryCode(safeCode) : "•",
    continent: "기타",
  };
}

function compareEconomicCountries(left, right) {
  return (
    String(left.country || "").localeCompare(String(right.country || ""), "ko-KR") ||
    String(left.code || "").localeCompare(String(right.code || ""))
  );
}

function buildEconomicCountryOptions(events, selectedCountryCodes) {
  const options = new Map(economicCountryFallbacks.map((country) => [country.code, country]));

  for (const event of events) {
    const code = normalizeEconomicCountryCode(event?.countryCode || event?.sourceRegion);
    if (!code) continue;
    const fallback = economicCountryOptionFromCode(code);
    options.set(code, {
      ...fallback,
      country: event.country || fallback.country,
      flag: event.flag || fallback.flag,
    });
  }

  for (const code of selectedCountryCodes) {
    if (!options.has(code)) options.set(code, economicCountryOptionFromCode(code));
  }

  return [...options.values()].sort(compareEconomicCountries);
}

function groupEconomicCountryOptions(countryOptions, query) {
  const normalizedQuery = String(query || "").trim().toLocaleLowerCase("ko-KR");
  const matches = countryOptions.filter((option) => {
    if (!normalizedQuery) return true;
    return (
      String(option.country || "").toLocaleLowerCase("ko-KR").includes(normalizedQuery) ||
      String(option.code || "").toLocaleLowerCase("ko-KR").includes(normalizedQuery)
    );
  });
  return economicCountryGroupOrder
    .map((continent) => ({
      continent,
      countries: matches
        .filter((option) => option.continent === continent)
        .sort(compareEconomicCountries),
    }))
    .filter((group) => group.countries.length > 0);
}

function filterEconomicEventsByCountry(events, selectedCountryCodes) {
  if (!selectedCountryCodes.length) return events;
  const selected = new Set(selectedCountryCodes);
  return events.filter((event) => selected.has(normalizeEconomicCountryCode(event?.countryCode || event?.sourceRegion)));
}

function EconomicImpactBars({ level }) {
  const safeLevel = Math.max(1, Math.min(3, Number(level || 1)));
  return (
    <span className={`economic-impact-bars is-level-${safeLevel}`} aria-label={`중요도 ${economicImpactLabel(safeLevel)}`}>
      {[1, 2, 3].map((bar) => (
        <span className={bar <= safeLevel ? "is-filled" : ""} key={bar} />
      ))}
    </span>
  );
}

function earningCalendarEventForContext(event, index) {
  return {
    rank: index + 1,
    dateKey: event.dateKey || "",
    symbol: event.symbol || "",
    company: event.company || "",
    eventName: event.eventName || "",
    timing: event.callTime || event.timing || "",
    calendarTime: event.calendarDisplayLabel || event.kstDateTimeLabel || "",
    calendarBasis: event.calendarDateBasisLabel || "",
    epsEstimate: event.epsEstimate || "",
    reportedEps: event.reportedEps || "",
    surprise: event.surprise || "",
    marketCap: event.marketCap || "",
    marketCapValue: event.marketCapValue || null,
    isOverseasOtc: Boolean(event.isOverseasOtc),
  };
}

function buildEarningCalendarContextSnapshot({
  viewMode,
  title,
  requestStartKey,
  requestEndKey,
  selectedDateKey,
  visibleDates,
  events,
  eventsByDate,
  selectedEvents,
  meta,
  loadState,
}) {
  const visibleDateKeys = visibleDates.map(calendarDateKey);
  return {
    available: true,
    screen: "earning-calendar",
    source: "현재 화면에 렌더된 Earning Calendar 스냅샷",
    title,
    viewMode,
    timezone: meta?.timezone || "Asia/Seoul",
    requestRange: {
      startDate: requestStartKey,
      endDateExclusive: requestEndKey,
    },
    selectedDateKey,
    uiState: {
      status: loadState.status,
      error: loadState.error || "",
      loading: loadState.status === "loading",
    },
    dataPolicy: meta?.displayPolicy || null,
    counts: {
      rowCount: meta?.rowCount ?? events.length,
      selectedDateEvents: selectedEvents.length,
      visibleDates: visibleDateKeys.length,
    },
    dailyCounts: visibleDateKeys.map((dateKey) => {
      const rows = eventsByDate.get(dateKey) || [];
      return {
        dateKey,
        eventCount: rows.length,
        symbols: rows.map((event) => event.symbol).filter(Boolean),
      };
    }),
    selectedEvents: selectedEvents.slice(0, 20).map(earningCalendarEventForContext),
    visibleEvents: events.slice(0, 120).map(earningCalendarEventForContext),
    meta: {
      source: meta?.source || "yfinance",
      generatedAt: meta?.generatedAt || "",
      cache: meta?.cache || null,
      persistentCache: meta?.persistentCache || null,
    },
    nextActionHint:
      "사용자가 현재 보이는 어닝 일정, 특정 날짜, 특정 심볼, 발표 전/후 여부, EPS/서프라이즈/시총 순서를 물으면 이 스냅샷을 우선 참고한다.",
  };
}

function economicCalendarEventForContext(event, index) {
  return {
    rank: index + 1,
    dateKey: event.dateKey || "",
    time: event.time || "",
    country: event.country || "",
    countryCode: event.countryCode || "",
    importance: Number(event.importance || 0),
    importanceLabel: economicImpactLabel(event.importance),
    eventName: event.eventName || "",
    eventNameKo: event.eventNameKo || "",
    eventNameTranslationStatus: event.eventNameTranslationStatus || "",
    eventNameTranslationModel: event.eventNameTranslationModel || "",
    period: event.period || "",
    actual: event.actual || "",
    forecast: event.forecast || "",
    previous: event.previous || "",
    revised: event.revised || "",
  };
}

function buildEconomicCalendarContextSnapshot({
  weekStart,
  weekDates,
  selectedDateKey,
  events,
  eventsByDate,
  selectedEvents,
  meta,
  loadState,
}) {
  const visibleDateKeys = weekDates.map(calendarDateKey);
  return {
    available: true,
    screen: "economic-calendar",
    source: "현재 화면에 렌더된 Economic Calendar 스냅샷",
    title: `${formatCalendarRange(weekStart, addCalendarDays(weekStart, 5))} Economic Calendar`,
    timezone: meta?.timezone || "Asia/Seoul",
    selectedDateKey,
    visibleRange: {
      startDate: visibleDateKeys[0] || "",
      endDateInclusive: visibleDateKeys[visibleDateKeys.length - 1] || "",
    },
    uiState: {
      status: loadState.status,
      error: loadState.error || "",
      loading: loadState.status === "loading",
    },
    counts: {
      rowCount: meta?.rowCount ?? events.length,
      selectedDateEvents: selectedEvents.length,
      visibleDates: visibleDateKeys.length,
    },
    dailyCounts: visibleDateKeys.map((dateKey) => {
      const rows = eventsByDate.get(dateKey) || [];
      const maxImportance = rows.length ? Math.max(...rows.map((event) => Number(event.importance || 1))) : 0;
      return {
        dateKey,
        eventCount: rows.length,
        maxImportance,
        maxImportanceLabel: rows.length ? economicImpactLabel(maxImportance) : "",
        highImpactEvents: rows
          .filter((event) => Number(event.importance || 0) >= 3)
          .map((event) => event.eventNameKo || event.eventName)
          .slice(0, 8),
      };
    }),
    selectedEvents: selectedEvents.slice(0, 40).map(economicCalendarEventForContext),
    visibleEvents: events.slice(0, 140).map(economicCalendarEventForContext),
    meta: {
      source: meta?.source || "yfinance",
      updatedAt: meta?.updatedAt || "",
      cache: meta?.cache || null,
      translationMemory: meta?.translationMemory || null,
    },
    nextActionHint:
      "사용자가 현재 보이는 경제지표 일정, 특정 날짜, 국가, 중요도, 발표/예측/이전 값을 물으면 이 스냅샷을 우선 참고한다.",
  };
}

export function EarningCalendarView({
  agentIcon = "",
  analysisReady = true,
  analysisBusy = false,
  onAnalyzeEarning,
  onContextChange,
}) {
  const [viewMode, setViewMode] = useState("month");
  const [anchorDate, setAnchorDate] = useState(() => startOfLocalDay(new Date()));
  const [selectedDateKey, setSelectedDateKey] = useState(() => calendarDateKey(new Date()));
  const [earningEvents, setEarningEvents] = useState([]);
  const [earningMeta, setEarningMeta] = useState(null);
  const [earningLoadState, setEarningLoadState] = useState({ status: "loading", error: "" });
  const [refreshSequence, setRefreshSequence] = useState(0);
  const appliedDefaultSelectionRef = useRef(false);
  const today = startOfLocalDay(new Date());
  const weeks = useMemo(() => buildEarningCalendarWeeks(anchorDate, viewMode), [anchorDate, viewMode]);
  const visibleDates = useMemo(() => weeks.flat(), [weeks]);
  const requestStartKey = visibleDates.length ? calendarDateKey(visibleDates[0]) : calendarDateKey(anchorDate);
  const requestEndKey = visibleDates.length
    ? calendarDateKey(addCalendarDays(visibleDates[visibleDates.length - 1], 1))
    : calendarDateKey(addCalendarDays(anchorDate, 1));
  const earningsByDate = useMemo(() => groupEarningsByDate(earningEvents), [earningEvents]);
  const selectedEvents = useMemo(
    () => earningsByDate.get(selectedDateKey) || [],
    [earningsByDate, selectedDateKey]
  );
  const isLoadingEarnings = earningLoadState.status === "loading";
  const contextSnapshot = useMemo(
    () =>
      buildEarningCalendarContextSnapshot({
        viewMode,
        title: earningCalendarTitle(anchorDate, viewMode),
        requestStartKey,
        requestEndKey,
        selectedDateKey,
        visibleDates,
        events: earningEvents,
        eventsByDate: earningsByDate,
        selectedEvents,
        meta: earningMeta,
        loadState: earningLoadState,
      }),
    [
      viewMode,
      anchorDate,
      requestStartKey,
      requestEndKey,
      selectedDateKey,
      visibleDates,
      earningEvents,
      earningsByDate,
      selectedEvents,
      earningMeta,
      earningLoadState,
    ]
  );

  useEffect(() => {
    onContextChange?.(contextSnapshot);
  }, [contextSnapshot, onContextChange]);

  useEffect(() => {
    let active = true;
    const force = refreshSequence > 0;

    setEarningLoadState({ status: "loading", error: "" });

    fetch(buildEarningsApiUrl({ startDate: requestStartKey, endDate: requestEndKey, force }))
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || !payload.ok) {
          throw new Error(payload.error || "Earning Calendar 데이터를 불러오지 못했습니다.");
        }
        return payload;
      })
      .then((payload) => {
        if (!active) return;
        const nextEvents = Array.isArray(payload.events) ? payload.events : [];
        setEarningEvents(nextEvents);
        setEarningMeta({
          source: payload.source || "yfinance",
          timezone: payload.timezone || "Asia/Seoul",
          startDate: payload.startDate || "",
          endDate: payload.endDate || "",
          fetchStartDate: payload.fetchStartDate || "",
          fetchEndDate: payload.fetchEndDate || "",
          generatedAt: payload.generatedAt || "",
          rowCount: payload.rowCount ?? nextEvents.length,
          fetchedRowCount: payload.fetchedRowCount ?? 0,
          cache: payload.cache || null,
          persistentCache: payload.persistentCache || null,
          displayPolicy: payload.displayPolicy || null,
          python: payload.python || null,
        });
        setEarningLoadState({ status: "ready", error: "" });
      })
      .catch((error) => {
        if (!active) return;
        setEarningEvents([]);
        setEarningLoadState({
          status: "error",
          error: error.message || "Earning Calendar 데이터를 불러오지 못했습니다.",
        });
      });

    return () => {
      active = false;
    };
  }, [refreshSequence, requestStartKey, requestEndKey]);

  useEffect(() => {
    if (!earningEvents.length || appliedDefaultSelectionRef.current) return;
    const selectedHasEvents = earningEvents.some((event) => event.dateKey === selectedDateKey);
    if (selectedHasEvents) {
      appliedDefaultSelectionRef.current = true;
      return;
    }
    const firstVisibleEvent = earningEvents.find(
      (event) => event.dateKey >= requestStartKey && event.dateKey < requestEndKey
    );
    if (!firstVisibleEvent?.dateKey) return;
    appliedDefaultSelectionRef.current = true;
    setSelectedDateKey(firstVisibleEvent.dateKey);
  }, [earningEvents, requestStartKey, requestEndKey, selectedDateKey]);

  function moveCalendar(direction) {
    const nextAnchor =
      viewMode === "month" ? addCalendarMonths(anchorDate, direction) : addCalendarDays(anchorDate, direction * 7);
    appliedDefaultSelectionRef.current = false;
    setAnchorDate(nextAnchor);
    setSelectedDateKey(calendarDateKey(nextAnchor));
  }

  function jumpToToday() {
    const nextToday = startOfLocalDay(new Date());
    appliedDefaultSelectionRef.current = false;
    setAnchorDate(nextToday);
    setSelectedDateKey(calendarDateKey(nextToday));
  }

  function refreshEarnings() {
    appliedDefaultSelectionRef.current = false;
    setRefreshSequence((current) => current + 1);
  }

  const dataStatusClass = [
    "earning-calendar-data-status",
    `is-${earningLoadState.status}`,
  ].join(" ");
  const dataStatusMessage =
    earningLoadState.status === "loading"
      ? "yfinance에서 선택 기간 실적 발표를 불러오는 중"
      : earningLoadState.status === "error"
        ? earningLoadState.error
        : `${earningMeta?.rowCount ?? earningEvents.length}개 조회 · ${formatEarningRangeLabel(earningMeta)} · ${
            earningMeta?.cache?.persistent ? "확정 캐시" : earningMeta?.cache?.hit ? "메모리 캐시" : "yfinance"
          } · ${
            formatEarningMarketCapPolicy(earningMeta?.displayPolicy?.minMarketCapUsd)
              ? `${formatEarningMarketCapPolicy(earningMeta?.displayPolicy?.minMarketCapUsd)} · `
              : ""
          }일별 시총 상위 ${earningMeta?.displayPolicy?.maxEventsPerDay || 6}개`;

  return (
    <div className="calendar-shell earning-calendar-shell">
      <section className="calendar-board earning-calendar-board" aria-labelledby="earning-calendar-title">
        <header className="calendar-header earning-calendar-header">
          <div>
            <h1 id="earning-calendar-title">Earning Calendar</h1>
            <p>{earningCalendarTitle(anchorDate, viewMode)} · yfinance · KST + 해외 발표일 보정</p>
          </div>

          <div className="calendar-toolbar" aria-label="Earning Calendar controls">
            <div className="calendar-view-toggle" role="tablist" aria-label="캘린더 보기">
              {[
                { id: "month", label: "월간" },
                { id: "week", label: "주간" },
              ].map((option) => (
                <button
                  className={viewMode === option.id ? "is-selected" : ""}
                  type="button"
                  role="tab"
                  aria-selected={viewMode === option.id}
                  onClick={() => {
                    appliedDefaultSelectionRef.current = false;
                    setViewMode(option.id);
                  }}
                  key={option.id}
                >
                  {option.label}
                </button>
              ))}
            </div>

            <div className="calendar-nav" aria-label="날짜 이동">
              <button type="button" onClick={() => moveCalendar(-1)} aria-label="이전 기간">
                ◀
              </button>
              <button type="button" onClick={jumpToToday}>
                오늘
              </button>
              <button type="button" onClick={() => moveCalendar(1)} aria-label="다음 기간">
                ▶
              </button>
            </div>

            <button
              className="calendar-icon-button"
              type="button"
              aria-label="yfinance 실적 발표 새로고침"
              title="yfinance 실적 발표 새로고침"
              disabled={isLoadingEarnings}
              onClick={refreshEarnings}
            >
              <RefreshCw size={15} strokeWidth={2.2} className={isLoadingEarnings ? "is-spinning" : ""} />
            </button>
          </div>
        </header>

        <div className={dataStatusClass}>
          {isLoadingEarnings ? <LoaderCircle size={15} strokeWidth={2.2} className="is-spinning" /> : null}
          <span>{dataStatusMessage}</span>
        </div>

        <div className={`earning-calendar-grid earning-calendar-grid-${viewMode}`}>
          {calendarWeekdays.map((weekday) => (
            <div className="earning-calendar-weekday" key={weekday.key}>
              {weekday.label}
            </div>
          ))}

          {visibleDates.map((date) => {
            const dateKey = calendarDateKey(date);
            const events = earningsByDate.get(dateKey) || [];
            const displayedEvents = viewMode === "week" ? events : events.slice(0, 4);
            const hiddenEventCount = events.length - displayedEvents.length;
            const isOutsideMonth = viewMode === "month" && date.getMonth() !== anchorDate.getMonth();
            const isToday = sameCalendarDate(date, today);
            const isSelected = dateKey === selectedDateKey;
            const className = [
              "earning-calendar-day",
              isOutsideMonth ? "is-outside-month" : "",
              isToday ? "is-today" : "",
              isSelected ? "is-selected" : "",
              events.length ? "has-events" : "",
            ]
              .filter(Boolean)
              .join(" ");
            return (
              <button
                className={className}
                type="button"
                onClick={() => setSelectedDateKey(dateKey)}
                key={dateKey}
              >
                <div className="earning-calendar-day-head">
                  <span>{date.getDate()}</span>
                  <span className="earning-calendar-day-badges">
                    {isToday ? <strong>오늘</strong> : null}
                    {events.length ? <em>{events.length}건</em> : null}
                  </span>
                </div>
                {events.length ? (
                  <div className="earning-calendar-event-stack">
                    {displayedEvents.map((event) => {
                      const resultTone = earningResultTone(event);
                      const resultLabel = earningResultLabel(event);
                      const eventTimingLabel = [event.callTime, calendarTimeLabel(event)].filter(Boolean).join(" · ");
                      return (
                        <div
                          className={`earning-calendar-event-pill ${resultTone}`}
                          title={`${event.symbol} · ${resultLabel}`}
                          aria-label={`${event.symbol} ${resultLabel}`}
                          key={event.id || `${event.symbol}-${event.kstDateTime}`}
                        >
                          <strong>{event.symbol}</strong>
                          <span>{eventTimingLabel}</span>
                        </div>
                      );
                    })}
                    {hiddenEventCount > 0 ? (
                      <div className="earning-calendar-event-more">+{hiddenEventCount} more</div>
                    ) : null}
                  </div>
                ) : (
                  <div className="earning-calendar-empty-slot">어닝 없음</div>
                )}
              </button>
            );
          })}
        </div>

        <section className="earning-calendar-detail" aria-labelledby="earning-calendar-detail-title">
          <header className="earning-calendar-detail-header">
            <div>
              <h2 id="earning-calendar-detail-title">Earnings On {formatEarningDetailTitle(selectedDateKey)}</h2>
              <p>
                {selectedEvents.length
                  ? `${selectedEvents.length}개 이벤트 · KST 기준, 5글자 해외 티커는 발표일 배치`
                  : "선택한 날짜에 등록된 yfinance 이벤트 없음"}
              </p>
            </div>
          </header>

          {selectedEvents.length ? (
            <div className="earning-calendar-table-shell">
              <table className="earning-calendar-table">
                <thead>
                  <tr>
                    <th>Symbol</th>
                    <th>Company</th>
                    <th>Event Name</th>
                    <th>Call Time</th>
                    <th>KST / Basis</th>
                    <th>EPS Estimate</th>
                    <th>Reported EPS</th>
                    <th>Surprise (%)</th>
                    <th>Market Cap</th>
                    <th>Analysis</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedEvents.map((event, index) => (
                    <tr key={event.id || `${event.symbol}-${event.dateKey}-${index}`}>
                      <td>
                        <strong className="earning-calendar-symbol">{event.symbol}</strong>
                      </td>
                      <td>{displayEarningValue(event.company)}</td>
                      <td>{displayEarningValue(event.eventName)}</td>
                      <td>
                        <span className={`earning-calendar-time-badge is-${event.timeConfidence || "standard"}`}>
                          {displayEarningValue(event.callTime)}
                        </span>
                      </td>
                      <td>
                        <span className="earning-calendar-time-cell">
                          <strong>{displayEarningValue(event.calendarDisplayLabel || event.kstDateTimeLabel)}</strong>
                          <em>{calendarBasisLabel(event)}</em>
                        </span>
                      </td>
                      <td>{displayEarningValue(event.epsEstimate)}</td>
                      <td>{displayEarningValue(event.reportedEps)}</td>
                      <td className={surpriseTone(event.surprise)}>{displayEarningValue(event.surprise)}</td>
                      <td>{displayEarningValue(event.marketCap)}</td>
                      <td>
                        <button
                          className="earning-calendar-analysis-button"
                          type="button"
                          aria-label={`${event.symbol} 어닝 분석 실행`}
                          title={`${event.symbol} 어닝 분석`}
                          disabled={!analysisReady || analysisBusy || !onAnalyzeEarning}
                          onClick={() => onAnalyzeEarning?.(event)}
                        >
                          <img className="agent-logo-image" src={agentIcon} alt="" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : earningLoadState.status === "error" ? (
            <div className="earning-calendar-detail-empty is-error">{earningLoadState.error}</div>
          ) : isLoadingEarnings ? (
            <div className="earning-calendar-detail-empty">yfinance 데이터를 불러오는 중입니다.</div>
          ) : (
            <div className="earning-calendar-detail-empty">선택한 날짜에는 yfinance 이벤트가 없습니다.</div>
          )}
        </section>
      </section>
    </div>
  );
}

function EconomicCountryFilterModal({
  countryGroups,
  countryOptions,
  query,
  selectedCountryCodes,
  onQueryChange,
  onToggleCountry,
  onSelectAll,
  onClearAll,
  onClose,
}) {
  const selectedCountrySet = useMemo(() => new Set(selectedCountryCodes), [selectedCountryCodes]);

  return (
    <div
      className="economic-country-filter-panel"
      role="dialog"
      aria-label="국가 필터"
    >
      <div className="economic-country-filter-top">
        <div className="economic-country-filter-search-row">
          <form
            className="economic-country-filter-search-form"
            onSubmit={(event) => event.preventDefault()}
          >
            <input
              type="search"
              value={query}
              placeholder="국가명 검색"
              aria-label="국가명 검색"
              onChange={(event) => onQueryChange(event.target.value)}
            />
          </form>
          <button
            className="economic-country-filter-close"
            type="button"
            aria-label="국가 필터 닫기"
            onClick={onClose}
          >
            ×
          </button>
        </div>

        <div className="economic-country-filter-links">
          <button type="button" onClick={onSelectAll} disabled={!countryOptions.length}>
            전부 선택
          </button>
          <button type="button" onClick={onClearAll}>
            전부 선택 해제
          </button>
        </div>
      </div>

      <div className="economic-country-filter-list">
        {countryGroups.length ? (
          countryGroups.map((group) => (
            <section className="economic-country-filter-group" key={group.continent}>
              <h3>{group.continent}</h3>
              <div className="economic-country-filter-options">
                {group.countries.map((country) => (
                  <label className="economic-country-filter-option" key={country.code}>
                    <input
                      type="checkbox"
                      checked={selectedCountrySet.has(country.code)}
                      onChange={(event) => onToggleCountry(country.code, event.target.checked)}
                    />
                    <span className="economic-country-filter-flag" aria-hidden="true">{country.flag || "•"}</span>
                    <span>{country.country}</span>
                  </label>
                ))}
              </div>
            </section>
          ))
        ) : (
          <div className="economic-country-filter-empty">검색 결과 없음</div>
        )}
      </div>
    </div>
  );
}

export function EconomicCalendarView({ onContextChange }) {
  const [weekStart, setWeekStart] = useState(() => startOfCalendarWeek(new Date()));
  const [selectedDateKey, setSelectedDateKey] = useState(() => calendarDateKey(new Date()));
  const [events, setEvents] = useState([]);
  const [meta, setMeta] = useState(null);
  const [translationMemory, setTranslationMemory] = useState(null);
  const [loadState, setLoadState] = useState({ status: "loading", error: "" });
  const [refreshSequence, setRefreshSequence] = useState(0);
  const [countryFilterOpen, setCountryFilterOpen] = useState(false);
  const [countryFilterQuery, setCountryFilterQuery] = useState("");
  const [selectedCountryCodes, setSelectedCountryCodes] = useState([]);
  const [countrySettingsError, setCountrySettingsError] = useState("");
  const countryFilterRef = useRef(null);
  const lastSavedCountryFilterKeyRef = useRef("");
  const weekDates = useMemo(
    () => calendarWeekdays.map((_weekday, index) => addCalendarDays(weekStart, index)),
    [weekStart]
  );
  const countryFilterActive = selectedCountryCodes.length > 0;
  const filteredEvents = useMemo(
    () => filterEconomicEventsByCountry(events, selectedCountryCodes),
    [events, selectedCountryCodes]
  );
  const countryOptions = useMemo(
    () => buildEconomicCountryOptions(events, selectedCountryCodes),
    [events, selectedCountryCodes]
  );
  const countryGroups = useMemo(
    () => groupEconomicCountryOptions(countryOptions, countryFilterQuery),
    [countryFilterQuery, countryOptions]
  );
  const eventsByDate = useMemo(() => groupEconomicEventsByDate(filteredEvents), [filteredEvents]);
  const selectedEvents = useMemo(
    () => eventsByDate.get(selectedDateKey) || [],
    [eventsByDate, selectedDateKey]
  );
  const contextSnapshot = useMemo(
    () =>
      buildEconomicCalendarContextSnapshot({
        weekStart,
        weekDates,
        selectedDateKey,
        events: filteredEvents,
        eventsByDate,
        selectedEvents,
        meta,
        loadState,
      }),
    [weekStart, weekDates, selectedDateKey, filteredEvents, eventsByDate, selectedEvents, meta, loadState]
  );

  useEffect(() => {
    onContextChange?.(contextSnapshot);
  }, [contextSnapshot, onContextChange]);

  useEffect(() => {
    let active = true;
    fetch("/api/economic-calendar/settings", { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || !payload.ok) {
          throw new Error(payload.error || "Economic Calendar 설정을 불러오지 못했습니다.");
        }
        return payload;
      })
      .then((payload) => {
        if (!active) return;
        const nextCodes = normalizeSelectedCountryCodes(payload.settings?.countryFilter?.selectedCountryCodes);
        setSelectedCountryCodes(nextCodes);
        lastSavedCountryFilterKeyRef.current = nextCodes.join("|");
        setCountrySettingsError("");
      })
      .catch((error) => {
        if (!active) return;
        setCountrySettingsError(error.message || "Economic Calendar 설정을 불러오지 못했습니다.");
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!countryFilterOpen) return undefined;

    function handlePointerDown(event) {
      if (countryFilterRef.current && !countryFilterRef.current.contains(event.target)) {
        setCountryFilterOpen(false);
      }
    }

    function handleKeyDown(event) {
      if (event.key === "Escape") setCountryFilterOpen(false);
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [countryFilterOpen]);

  useEffect(() => {
    let active = true;
    const force = refreshSequence > 0;
    setLoadState({ status: "loading", error: "" });

    fetch(buildEconomicCalendarApiUrl({ weekStart, force }), { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || !payload.ok) {
          const loadError = new Error(payload.error || "Economic Calendar 데이터를 불러오지 못했습니다.");
          loadError.payload = payload;
          throw loadError;
        }
        return payload;
      })
      .then((payload) => {
        if (!active) return;
        const nextEvents = Array.isArray(payload.events) ? payload.events : [];
        setEvents(nextEvents);
        setMeta({
          source: payload.source || "yfinance",
          timezone: payload.timezone || "Asia/Seoul",
          updatedAt: payload.updatedAt || "",
          rowCount: payload.rowCount ?? nextEvents.length,
          cache: payload.persistentCache || null,
          translationMemory: payload.translationMemory || null,
          collectionStatus: payload.collectionStatus || "ready",
          collectionFailure: payload.collectionFailure || null,
          officialFallbackSources: Array.isArray(payload.officialFallbackSources) ? payload.officialFallbackSources : [],
          lastSuccessfulAt: payload.lastSuccessfulAt || payload.updatedAt || "",
          warnings: Array.isArray(payload.warnings) ? payload.warnings : [],
        });
        setTranslationMemory(payload.translationMemory || null);
        setLoadState({ status: "ready", error: "" });
      })
      .catch((error) => {
        if (!active) return;
        setEvents([]);
        const errorPayload = error?.payload || {};
        setMeta({
          source: errorPayload.source || "yfinance",
          timezone: errorPayload.timezone || "Asia/Seoul",
          updatedAt: "",
          rowCount: 0,
          cache: errorPayload.persistentCache || null,
          translationMemory: null,
          collectionStatus: errorPayload.collectionStatus || "failed",
          collectionFailure: errorPayload.collectionFailure || {
            code: errorPayload.errorCode || "ECONOMIC_CALENDAR_FETCH_FAILED",
            message: error.message || "Economic Calendar 수집 실패",
          },
          officialFallbackSources: Array.isArray(errorPayload.officialFallbackSources) ? errorPayload.officialFallbackSources : [],
          lastSuccessfulAt: errorPayload.lastSuccessfulAt || errorPayload.persistentCache?.updatedAt || "",
          warnings: [],
        });
        setLoadState({
          status: "error",
          error: error.message || "Economic Calendar 데이터를 불러오지 못했습니다.",
        });
      });

    return () => {
      active = false;
    };
  }, [refreshSequence, weekStart]);

  useEffect(() => {
    if (!translationMemoryShouldPoll(translationMemory)) return undefined;

    let active = true;
    let timer = null;

    async function pollTranslationMemory() {
      try {
        const response = await fetch("/api/economic-calendar/translations?limit=1000", { cache: "no-store" });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || !payload.ok) {
          throw new Error(payload.error || "Economic Calendar 번역 메모리를 불러오지 못했습니다.");
        }
        if (!active) return;

        const nextMemory = payload.translationMemory || null;
        setTranslationMemory(nextMemory);
        setMeta((current) => current ? { ...current, translationMemory: nextMemory } : current);
        setEvents((currentEvents) => applyEconomicTranslationMemoryToEvents(currentEvents, nextMemory));
      } catch {
        if (!active) return;
      }
    }

    timer = window.setInterval(() => {
      void pollTranslationMemory();
    }, ECONOMIC_TRANSLATION_POLL_MS);
    void pollTranslationMemory();

    return () => {
      active = false;
      if (timer) window.clearInterval(timer);
    };
  }, [translationMemory?.inFlight]);

  useEffect(() => {
    const visibleKeys = new Set(weekDates.map(calendarDateKey));
    if (!visibleKeys.has(selectedDateKey)) {
      setSelectedDateKey(calendarDateKey(weekDates[0]));
    }
  }, [selectedDateKey, weekDates]);

  function moveWeek(direction) {
    setWeekStart((current) => addCalendarDays(current, direction * 7));
  }

  function jumpToThisWeek() {
    const currentWeekStart = startOfCalendarWeek(new Date());
    setWeekStart(currentWeekStart);
    setSelectedDateKey(calendarDateKey(new Date()));
  }

  function refreshEconomicCalendar() {
    setRefreshSequence((current) => current + 1);
  }

  function saveEconomicCountryFilterSelection(nextCodes) {
    const selectedCountryCodes = normalizeSelectedCountryCodes(nextCodes);
    fetch("/api/economic-calendar/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({
        countryFilter: {
          selectedCountryCodes,
        },
      }),
    })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || !payload.ok) {
          throw new Error(payload.error || "Economic Calendar 설정을 저장하지 못했습니다.");
        }
        return payload;
      })
      .then((payload) => {
        const savedCodes = normalizeSelectedCountryCodes(payload.settings?.countryFilter?.selectedCountryCodes);
        lastSavedCountryFilterKeyRef.current = savedCodes.join("|");
        if (savedCodes.join("|") !== selectedCountryCodes.join("|")) {
          setSelectedCountryCodes(savedCodes);
        }
        setCountrySettingsError("");
      })
      .catch((error) => {
        setCountrySettingsError(error.message || "Economic Calendar 설정을 저장하지 못했습니다.");
      });
  }

  function toggleEconomicCountryFilter(code, checked) {
    const safeCode = normalizeEconomicCountryCode(code);
    if (!safeCode) return;
    const nextCodes = checked
      ? normalizeSelectedCountryCodes([...selectedCountryCodes, safeCode])
      : normalizeSelectedCountryCodes(selectedCountryCodes.filter((item) => item !== safeCode));
    setSelectedCountryCodes(nextCodes);
    saveEconomicCountryFilterSelection(nextCodes);
  }

  function selectAllEconomicCountries() {
    const nextCodes = normalizeSelectedCountryCodes(countryOptions.map((country) => country.code));
    setSelectedCountryCodes(nextCodes);
    saveEconomicCountryFilterSelection(nextCodes);
  }

  function clearAllEconomicCountries() {
    saveEconomicCountryFilterSelection([]);
    setSelectedCountryCodes([]);
  }

  const isLoadingEconomicCalendar = loadState.status === "loading";
  const selectedDateEventsBeforeFilter = (groupEconomicEventsByDate(events).get(selectedDateKey) || []).length;
  const filterButtonTitle = countryFilterActive
    ? `국가 필터 ${selectedCountryCodes.length}개 선택됨`
    : "국가 필터";

  const statusClass = [
    "economic-calendar-data-status",
    `is-${loadState.status}`,
  ].join(" ");
  const statusMessage =
    loadState.status === "loading"
      ? "경제지표 캐시를 불러오는 중"
      : loadState.status === "error"
        ? loadState.error
        : "";
  const collectionFailed = meta?.collectionStatus === "failed" || meta?.collectionStatus === "fallback_cache";
  const usingFallbackCache = meta?.collectionStatus === "fallback_cache";
  const officialFallbackSources = Array.isArray(meta?.officialFallbackSources) ? meta.officialFallbackSources : [];

  return (
    <div className="calendar-shell economic-calendar-shell">
      <section className="calendar-board economic-calendar-board" aria-labelledby="economic-calendar-title">
        <header className="calendar-header economic-calendar-header">
          <div>
            <h1 id="economic-calendar-title">Economic Calendar</h1>
            <p>{formatCalendarRange(weekStart, addCalendarDays(weekStart, 5))} · KST(UTC+9) · yfinance</p>
          </div>

          <div className="calendar-toolbar" aria-label="Economic Calendar controls">
            <div className="calendar-nav" aria-label="주간 이동">
              <button type="button" onClick={() => moveWeek(-1)} aria-label="이전 주">
                ◀
              </button>
              <button type="button" onClick={jumpToThisWeek}>
                이번 주
              </button>
              <button type="button" onClick={() => moveWeek(1)} aria-label="다음 주">
                ▶
              </button>
            </div>

            <button
              className="calendar-icon-button"
              type="button"
              aria-label="yfinance 경제 캘린더 새로고침"
              title="yfinance 경제 캘린더 새로고침"
              disabled={isLoadingEconomicCalendar}
              onClick={refreshEconomicCalendar}
            >
              <RefreshCw size={15} strokeWidth={2.2} className={isLoadingEconomicCalendar ? "is-spinning" : ""} />
            </button>
          </div>
        </header>

        {statusMessage ? (
          <div className={statusClass}>
            {isLoadingEconomicCalendar ? <LoaderCircle size={15} strokeWidth={2.2} className="is-spinning" /> : null}
            <span>{statusMessage}</span>
          </div>
        ) : null}

        {collectionFailed ? (
          <section className={`economic-calendar-collection-alert ${usingFallbackCache ? "is-fallback" : "is-failed"}`} role="status">
            <AlertTriangle size={19} strokeWidth={2.1} />
            <div>
              <strong>{usingFallbackCache ? "최신 수집 실패 · 저장된 일정 표시 중" : "경제 캘린더 수집 실패"}</strong>
              <span>
                {meta?.collectionFailure?.message || loadState.error || "일정 제공자 응답을 확인하지 못했습니다."}
                {meta?.lastSuccessfulAt ? ` · 마지막 정상 수집 ${meta.lastSuccessfulAt}` : " · 정상 수집 이력 없음"}
              </span>
              {officialFallbackSources.length ? (
                <nav aria-label="경제 캘린더 공식 대체 출처">
                  {officialFallbackSources.map((source) => (
                    <a href={source.url} target="_blank" rel="noreferrer" key={source.id || source.url}>
                      {source.title}<small>{source.scope}</small><ExternalLink size={12} />
                    </a>
                  ))}
                </nav>
              ) : null}
            </div>
          </section>
        ) : null}

        <div className="economic-week-strip" aria-label="월요일부터 토요일까지 경제 캘린더">
          {weekDates.map((date, index) => {
            const dateKey = calendarDateKey(date);
            const dayEvents = eventsByDate.get(dateKey) || [];
            const maxImpact = dayEvents.length
              ? Math.max(...dayEvents.map((event) => Number(event.importance || 1)))
              : 0;
            const isSelected = dateKey === selectedDateKey;
            const isToday = sameCalendarDate(date, startOfLocalDay(new Date()));
            return (
              <button
                className={[
                  "economic-day-card",
                  isSelected ? "is-selected" : "",
                  isToday ? "is-today" : "",
                  dayEvents.length ? "has-events" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                type="button"
                aria-pressed={isSelected}
                onClick={() => setSelectedDateKey(dateKey)}
                key={dateKey}
              >
                <span className="economic-day-weekday">{calendarWeekdays[index].label}</span>
                <strong>{formatEconomicCardDate(date)}</strong>
                <span className="economic-day-count">{dayEvents.length ? `${dayEvents.length}개 이벤트` : "이벤트 없음"}</span>
                <em>{dayEvents.length ? `최고 ${economicImpactLabel(maxImpact)}` : "비어 있음"}</em>
              </button>
            );
          })}
        </div>

        <section className="economic-event-list" aria-labelledby="economic-event-list-title">
          <header className="economic-event-list-header">
            <div>
              <h2 id="economic-event-list-title">{formatKoreanDateTitle(selectedDateKey)}</h2>
              <p>
                {selectedEvents.length
                  ? [
                      `${selectedEvents.length}개 이벤트`,
                      `${economicImpactLabel(Math.max(...selectedEvents.map((event) => Number(event.importance || 1))))} 중요도 포함`,
                      countryFilterActive ? `국가 ${selectedCountryCodes.length}개 선택` : "",
                    ].filter(Boolean).join(" · ")
                  : countryFilterActive && selectedDateEventsBeforeFilter
                    ? "선택한 국가의 경제 이벤트가 없습니다."
                    : "선택한 날짜에는 등록된 경제 이벤트가 없습니다."}
              </p>
            </div>
            <div className="economic-country-filter-anchor" ref={countryFilterRef}>
              <button
                className={countryFilterActive ? "economic-country-filter-button is-active" : "economic-country-filter-button"}
                type="button"
                aria-label={filterButtonTitle}
                title={countrySettingsError ? `${filterButtonTitle} · ${countrySettingsError}` : filterButtonTitle}
                aria-expanded={countryFilterOpen}
                onClick={() => setCountryFilterOpen((open) => !open)}
              >
                <Filter size={17} strokeWidth={2.2} />
              </button>

              {countryFilterOpen ? (
                <EconomicCountryFilterModal
                  countryGroups={countryGroups}
                  countryOptions={countryOptions}
                  query={countryFilterQuery}
                  selectedCountryCodes={selectedCountryCodes}
                  onQueryChange={setCountryFilterQuery}
                  onToggleCountry={toggleEconomicCountryFilter}
                  onSelectAll={selectAllEconomicCountries}
                  onClearAll={clearAllEconomicCountries}
                  onClose={() => setCountryFilterOpen(false)}
                />
              ) : null}
            </div>
          </header>

          {selectedEvents.length ? (
            <div className="economic-table-shell">
              <table className="economic-table">
                <thead>
                  <tr>
                    <th className="economic-col-time">시간</th>
                    <th className="economic-col-country">국가</th>
                    <th className="economic-col-impact">중요도</th>
                    <th>이벤트</th>
                    <th className="economic-col-value">발표</th>
                    <th className="economic-col-value">예측</th>
                    <th className="economic-col-value">이전</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedEvents.map((event, index) => {
                    const previous = selectedEvents[index - 1];
                    const showTime = !previous || previous.time !== event.time;
                    const showCountry = showTime || previous.country !== event.country;
                    const translatedEventName = String(event.eventNameKo || "").trim();
                    const originalEventName = economicDisplayValue(event.eventName);
                    const translationStatus = String(event.eventNameTranslationStatus || "").trim();
                    return (
                      <tr key={event.id || `${event.dateKey}-${event.time}-${event.eventName}`}>
                        <td className="economic-col-time">{showTime ? event.time || "-" : ""}</td>
                        <td className="economic-col-country">
                          {showCountry ? (
                            <span className="economic-country">
                              <span className="economic-country-flag" aria-hidden="true">{event.flag || "•"}</span>
                              <span>{event.country || "-"}</span>
                            </span>
                          ) : null}
                        </td>
                        <td className="economic-col-impact">
                          <EconomicImpactBars level={event.importance} />
                        </td>
                        <td>
                          <span className="economic-event-name">
                            <span>{translatedEventName || originalEventName}</span>
                            {translatedEventName ? (
                              <small className="economic-event-original">{originalEventName}</small>
                            ) : translationStatus && translationStatus !== "translated" ? (
                              <small className={`economic-event-translation-status is-${translationStatus}`}>
                                {translationStatus === "failed" ? "번역 실패" : "번역 대기"}
                              </small>
                            ) : null}
                          </span>
                        </td>
                        <td className="economic-col-value is-actual">{economicDisplayValue(event.actual)}</td>
                        <td className="economic-col-value">{economicDisplayValue(event.forecast)}</td>
                        <td className="economic-col-value">{economicDisplayValue(event.previous)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : loadState.status === "error" || meta?.collectionStatus === "failed" ? (
            <div className="economic-detail-empty is-error">일정 없음이 아니라 수집 실패 상태입니다. 위 공식 대체 출처를 확인하세요.</div>
          ) : loadState.status === "loading" ? (
            <div className="economic-detail-empty">경제지표 캐시를 불러오는 중입니다.</div>
          ) : countryFilterActive && selectedDateEventsBeforeFilter ? (
            <div className="economic-detail-empty">선택한 국가의 경제 이벤트가 없습니다.</div>
          ) : (
            <div className="economic-detail-empty">선택한 날짜에는 경제 이벤트가 없습니다.</div>
          )}
        </section>
      </section>
    </div>
  );
}

export function CalendarPlaceholderView({ title, Icon }) {
  return (
    <div className="calendar-shell">
      <section className="calendar-board" aria-labelledby={`${title.toLowerCase().replace(/\s+/g, "-")}-title`}>
        <header className="calendar-header">
          <div>
            <h1 id={`${title.toLowerCase().replace(/\s+/g, "-")}-title`}>{title}</h1>
            <p>캘린더 데이터 연결 대기</p>
          </div>
          <div className="calendar-status" title={`${title} 대기`}>
            <span className="status-dot" />
            <span>대기</span>
          </div>
        </header>

        <div className="calendar-empty-state">
          <Icon size={30} strokeWidth={1.8} />
          <strong>연결된 캘린더가 없습니다.</strong>
        </div>
      </section>
    </div>
  );
}
