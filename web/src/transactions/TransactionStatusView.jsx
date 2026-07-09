import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import BriefcaseBusiness from "lucide-react/dist/esm/icons/briefcase-business.js";
import Check from "lucide-react/dist/esm/icons/check.js";
import ChevronDown from "lucide-react/dist/esm/icons/chevron-down.js";
import CirclePlus from "lucide-react/dist/esm/icons/circle-plus.js";
import Filter from "lucide-react/dist/esm/icons/filter.js";
import FolderClosed from "lucide-react/dist/esm/icons/folder-closed.js";
import GripVertical from "lucide-react/dist/esm/icons/grip-vertical.js";
import Heart from "lucide-react/dist/esm/icons/heart.js";
import LoaderCircle from "lucide-react/dist/esm/icons/loader-circle.js";
import PencilLine from "lucide-react/dist/esm/icons/pencil-line.js";
import Plus from "lucide-react/dist/esm/icons/plus.js";
import Save from "lucide-react/dist/esm/icons/save.js";
import Trash2 from "lucide-react/dist/esm/icons/trash-2.js";
import { PortfolioTossApiStatus } from "../portfolio/PortfolioWorkspaceHeader.jsx";

const sortOptions = [
  { id: "profitRateDesc", label: "총 수익률 높은 순" },
  { id: "profitRateAsc", label: "총 수익률 낮은 순" },
  { id: "valueDesc", label: "평가금액 높은 순" },
  { id: "valueAsc", label: "평가금액 낮은 순" },
  { id: "dailyRateDesc", label: "일간 수익률 높은 순" },
  { id: "dailyRateAsc", label: "일간 수익률 낮은 순" },
  { id: "nameAsc", label: "가나다 순" },
  { id: "custom", label: "직접 설정하기" },
];

const companyNames = {
  AMD: "AMD",
  AMZN: "아마존",
  AVGO: "브로드컴",
  BA: "보잉",
  CAT: "캐터필러",
  COF: "캐피탈 원 파이낸셜",
  COST: "코스트코",
  DELL: "델 테크놀로지스",
  GOOG: "알파벳 C",
  LLY: "일라이 릴리",
  META: "메타",
  MSFT: "마이크로소프트",
  MU: "마이크론 테크놀로지",
  NVDA: "엔비디아",
  ORCL: "오라클",
};

function formatKrw(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) return "-";
  return `${Math.round(number).toLocaleString("ko-KR")}원`;
}

function formatUsd(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) return "-";
  return `$${number.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatMoney(value, unit = "KRW") {
  return unit === "USD" ? formatUsd(value) : formatKrw(value);
}

function normalizeMoneyUnit(unit = "KRW") {
  return String(unit || "").toUpperCase() === "USD" ? "USD" : "KRW";
}

const defaultTransactionCurrencySettings = {
  sidebarDisplayCurrency: "auto",
  mainDisplayCurrency: "auto",
  mainTableColumns: [],
  sidebarManualOrder: [],
  watchlistGroups: [],
};

const transactionWatchlistPriceRefreshMs = 1_000;
const transactionWatchlistCandlePageSize = 200;
const transactionWatchlistReturnColumns = [
  { key: "daily", label: "일간 수익률", valueField: "dailyReturnPercent", hasField: "hasDailyReturn" },
  { key: "weekly", label: "주간 수익률", valueField: "weeklyReturnPercent", hasField: "hasWeeklyReturn" },
  { key: "monthly", label: "월간 수익률", valueField: "monthlyReturnPercent", hasField: "hasMonthlyReturn" },
  { key: "sixMonth", label: "6개월 수익률", valueField: "sixMonthReturnPercent", hasField: "hasSixMonthReturn" },
];

const transactionMainTableColumns = [
  { id: "ticker", label: "티커 / 종목번호", className: "transaction-table-ticker", align: "left" },
  { id: "name", label: "종목명", className: "transaction-table-name", align: "left" },
  { id: "profitPercent", label: "총 수익률", toneField: "profitPercent" },
  { id: "profit", label: "총 수익금", toneField: "profit" },
  { id: "value", label: "평가금" },
  { id: "costBasis", label: "원금" },
  { id: "currentPrice", label: "현재가" },
  { id: "quantity", label: "보유 수량" },
  { id: "averageKnownCost", label: "평단가" },
  { id: "dailyReturnPercent", label: "일간 수익률", toneField: "dailyReturnPercent" },
  { id: "dailyProfit", label: "일간 수익금", toneField: "dailyProfit" },
];

const fixedTransactionMainTableColumnId = "ticker";
const transactionSelectableMainTableColumns = transactionMainTableColumns.filter(
  (column) => column.id !== fixedTransactionMainTableColumnId
);
const transactionSelectableMainTableColumnIds = new Set(
  transactionSelectableMainTableColumns.map((column) => column.id)
);

function normalizeTransactionMainTableColumnsSetting(value, fallback = defaultTransactionCurrencySettings.mainTableColumns) {
  if (!Array.isArray(value)) return [...fallback];
  const nextColumns = [];
  for (const item of value) {
    const columnId = String(item || "").trim();
    if (transactionSelectableMainTableColumnIds.has(columnId) && !nextColumns.includes(columnId)) {
      nextColumns.push(columnId);
    }
  }
  return nextColumns;
}

function normalizeTransactionSidebarManualOrderSetting(value, fallback = defaultTransactionCurrencySettings.sidebarManualOrder) {
  if (!Array.isArray(value)) return Array.isArray(fallback) ? [...fallback] : [];
  const nextSymbols = [];
  for (const item of value) {
    const symbol = String(item || "").trim().toUpperCase();
    if (symbol && !nextSymbols.includes(symbol)) {
      nextSymbols.push(symbol);
    }
  }
  return nextSymbols;
}

function cleanTransactionWatchlistGroupName(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
}

function cleanTransactionWatchlistGroupId(value) {
  return String(value ?? "").trim().replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 96);
}

function cleanTransactionWatchlistSymbol(value) {
  return String(value ?? "").trim().toUpperCase().replace(/\s+/g, "").slice(0, 32);
}

function normalizeTransactionWatchlistSymbolsSetting(value) {
  if (!Array.isArray(value)) return [];
  const nextSymbols = [];
  for (const item of value) {
    const source = item && typeof item === "object" ? item.symbol ?? item.ticker ?? item.code : item;
    const symbol = cleanTransactionWatchlistSymbol(source);
    if (symbol && !nextSymbols.includes(symbol)) {
      nextSymbols.push(symbol);
    }
  }
  return nextSymbols;
}

function createTransactionWatchlistGroupId() {
  return `watchlist-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeTransactionWatchlistGroupsSetting(value, fallback = defaultTransactionCurrencySettings.watchlistGroups) {
  const sourceGroups = Array.isArray(value) ? value : Array.isArray(fallback) ? fallback : [];
  const nextGroups = [];
  const usedIds = new Set();
  for (const [index, item] of sourceGroups.entries()) {
    const source = item && typeof item === "object" ? item : { name: item };
    const name = cleanTransactionWatchlistGroupName(source.name ?? source.title ?? source.label);
    if (!name) continue;
    const baseId = cleanTransactionWatchlistGroupId(source.id) || `watchlist-${index + 1}`;
    let id = baseId;
    let suffix = 2;
    while (usedIds.has(id)) {
      id = `${baseId}-${suffix}`;
      suffix += 1;
    }
    usedIds.add(id);
    nextGroups.push({
      id,
      name,
      createdAt: typeof source.createdAt === "string" ? source.createdAt : "",
      symbols: normalizeTransactionWatchlistSymbolsSetting(source.symbols ?? source.tickers ?? source.items),
    });
  }
  return nextGroups;
}

function transactionItemOrderKey(item = {}) {
  return String(item.symbol || "").trim().toUpperCase();
}

function transactionItemOrderKeys(items = []) {
  const nextKeys = [];
  for (const item of items) {
    const key = transactionItemOrderKey(item);
    if (key && !nextKeys.includes(key)) {
      nextKeys.push(key);
    }
  }
  return nextKeys;
}

function arraysEqual(left = [], right = []) {
  if (left.length !== right.length) return false;
  return left.every((item, index) => item === right[index]);
}

function syncTransactionSidebarManualOrder(savedOrder, items) {
  const itemKeys = transactionItemOrderKeys(items);
  const itemKeySet = new Set(itemKeys);
  const nextOrder = normalizeTransactionSidebarManualOrderSetting(savedOrder, []).filter((key) => itemKeySet.has(key));
  for (const key of itemKeys) {
    if (!nextOrder.includes(key)) nextOrder.push(key);
  }
  return nextOrder;
}

function reorderTransactionSidebarManualOrder(currentOrder, sourceKey, targetKey, placement = "before") {
  const source = String(sourceKey || "").trim().toUpperCase();
  const target = String(targetKey || "").trim().toUpperCase();
  const nextOrder = normalizeTransactionSidebarManualOrderSetting(currentOrder, []);
  if (!source || !target || source === target) return nextOrder;
  const sourceIndex = nextOrder.indexOf(source);
  const targetIndex = nextOrder.indexOf(target);
  if (sourceIndex < 0 || targetIndex < 0) return nextOrder;
  const [movedKey] = nextOrder.splice(sourceIndex, 1);
  const nextTargetIndex = nextOrder.indexOf(target);
  nextOrder.splice(placement === "after" ? nextTargetIndex + 1 : nextTargetIndex, 0, movedKey);
  return nextOrder;
}

function reorderTransactionWatchlistGroups(currentGroups, sourceId, targetId, placement = "before") {
  const source = cleanTransactionWatchlistGroupId(sourceId);
  const target = cleanTransactionWatchlistGroupId(targetId);
  const nextGroups = normalizeTransactionWatchlistGroupsSetting(currentGroups, []);
  if (!source || !target || source === target) return nextGroups;
  const sourceIndex = nextGroups.findIndex((group) => group.id === source);
  const targetIndex = nextGroups.findIndex((group) => group.id === target);
  if (sourceIndex < 0 || targetIndex < 0) return nextGroups;
  const [movedGroup] = nextGroups.splice(sourceIndex, 1);
  const nextTargetIndex = nextGroups.findIndex((group) => group.id === target);
  nextGroups.splice(placement === "after" ? nextTargetIndex + 1 : nextTargetIndex, 0, movedGroup);
  return nextGroups;
}

function reorderTransactionWatchlistSymbols(currentSymbols, sourceSymbol, targetSymbol, placement = "before") {
  const source = cleanTransactionWatchlistSymbol(sourceSymbol);
  const target = cleanTransactionWatchlistSymbol(targetSymbol);
  const nextSymbols = normalizeTransactionWatchlistSymbolsSetting(currentSymbols);
  if (!source || !target || source === target) return nextSymbols;
  const sourceIndex = nextSymbols.indexOf(source);
  const targetIndex = nextSymbols.indexOf(target);
  if (sourceIndex < 0 || targetIndex < 0) return nextSymbols;
  const [movedSymbol] = nextSymbols.splice(sourceIndex, 1);
  const nextTargetIndex = nextSymbols.indexOf(target);
  nextSymbols.splice(placement === "after" ? nextTargetIndex + 1 : nextTargetIndex, 0, movedSymbol);
  return nextSymbols;
}

function watchlistGroupIdsEqual(left = [], right = []) {
  const leftGroups = normalizeTransactionWatchlistGroupsSetting(left, []);
  const rightGroups = normalizeTransactionWatchlistGroupsSetting(right, []);
  if (leftGroups.length !== rightGroups.length) return false;
  return leftGroups.every((group, index) => group.id === rightGroups[index]?.id);
}

function visibleTransactionMainTableColumns(selectedColumnIds) {
  const normalizedColumns = normalizeTransactionMainTableColumnsSetting(selectedColumnIds, []);
  const selectedSet = new Set(normalizedColumns);
  return transactionMainTableColumns.filter(
    (column) => column.id === fixedTransactionMainTableColumnId || selectedSet.has(column.id)
  );
}

function normalizeDisplayCurrencySetting(value = "auto") {
  const candidate = String(value ?? "").trim().toUpperCase();
  if (candidate === "USD" || candidate === "KRW") return candidate;
  return "auto";
}

function transactionCurrencySettingsFromPayload(payload = {}) {
  const source = payload?.settings && typeof payload.settings === "object" ? payload.settings : payload;
  return {
    sidebarDisplayCurrency: normalizeDisplayCurrencySetting(
      source?.sidebarDisplayCurrency ?? source?.sidebarUnit ?? source?.sidebarCurrency
    ),
    mainDisplayCurrency: normalizeDisplayCurrencySetting(
      source?.mainDisplayCurrency ?? source?.mainUnit ?? source?.mainCurrency
    ),
    mainTableColumns: normalizeTransactionMainTableColumnsSetting(
      source?.mainTableColumns ?? source?.mainVisibleColumns ?? source?.tableColumns
    ),
    sidebarManualOrder: normalizeTransactionSidebarManualOrderSetting(
      source?.sidebarManualOrder ?? source?.manualSidebarOrder ?? source?.sidebarCustomOrder
    ),
    watchlistGroups: normalizeTransactionWatchlistGroupsSetting(
      source?.watchlistGroups ?? source?.watchlistFolders ?? source?.interestGroups
    ),
  };
}

function effectiveMoneyUnitFromSetting(setting, fallbackUnit = "KRW") {
  const normalizedSetting = normalizeDisplayCurrencySetting(setting);
  return normalizedSetting === "auto" ? normalizeMoneyUnit(fallbackUnit) : normalizedSetting;
}

function numericAmount(value, fallback = 0) {
  const number = Number(String(value ?? "").replace(/,/g, "").replace(/%$/, "").trim());
  return Number.isFinite(number) ? number : fallback;
}

function optionalNumericAmount(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(String(value).replace(/,/g, "").replace(/%$/, "").trim());
  return Number.isFinite(number) ? number : null;
}

function optionalRatePercent(value) {
  const number = optionalNumericAmount(value);
  if (number === null) return null;
  return Math.abs(number) <= 1 ? number * 100 : number;
}

function convertMoney(value, fromUnit = "KRW", toUnit = "KRW", usdKrwRate = 0) {
  const amount = Number(value || 0);
  if (!Number.isFinite(amount)) return null;
  const sourceUnit = normalizeMoneyUnit(fromUnit);
  const targetUnit = normalizeMoneyUnit(toUnit);
  if (sourceUnit === targetUnit || amount === 0) return amount;
  const rate = Number(usdKrwRate || 0);
  if (!Number.isFinite(rate) || rate <= 0) return null;
  return sourceUnit === "USD" ? amount * rate : amount / rate;
}

function convertedMoney(value, fromUnit, toUnit, usdKrwRate) {
  const amount = convertMoney(value, fromUnit, toUnit, usdKrwRate);
  return {
    hasValue: amount !== null,
    value: amount ?? 0,
  };
}

function formatConvertedMoney(value, fromUnit, toUnit, usdKrwRate) {
  const amount = convertMoney(value, fromUnit, toUnit, usdKrwRate);
  return amount === null ? "-" : formatMoney(amount, toUnit);
}

function formatOptionalMoney(hasValue, value, unit = "KRW") {
  return hasValue ? formatMoney(value, unit) : "-";
}

function formatOptionalSignedMoney(hasValue, value, unit = "KRW") {
  return hasValue ? formatSignedMoney(value, unit) : "-";
}

function formatSignedMoney(value, unit = "KRW") {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) return "-";
  const absText = formatMoney(Math.abs(number), unit);
  return `${number > 0 ? "+" : number < 0 ? "-" : ""}${absText}`;
}

function formatOptionalPerformance(hasValue, value, percent, unit = "KRW") {
  if (!hasValue) return "-";
  return `${formatSignedMoney(value, unit)} (${formatSignedPercent(percent)})`;
}

function formatConvertedPerformance(hasValue, value, percent, fromUnit, toUnit, usdKrwRate) {
  if (!hasValue) return "-";
  const amount = convertMoney(value, fromUnit, toUnit, usdKrwRate);
  if (amount === null) return "-";
  return `${formatSignedMoney(amount, toUnit)} (${formatSignedPercent(percent)})`;
}

function formatPercent(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) return "0.00%";
  return `${number.toLocaleString("ko-KR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
}

function formatSignedPercent(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) return "0.00%";
  return `${number > 0 ? "+" : ""}${formatPercent(number)}`;
}

function formatQuantity(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) return "0주";
  return `${number.toLocaleString("ko-KR", { maximumFractionDigits: 6 })}주`;
}

function formatUpdatedAt(value) {
  if (!value) return "";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return date.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function valueTone(value) {
  const number = Number(value || 0);
  if (number > 0) return "is-positive";
  if (number < 0) return "is-negative";
  return "";
}

function displayName(item = {}) {
  return companyNames[item.symbol] || item.label || item.symbol || "-";
}

function transactionWatchlistSearchName(item = {}) {
  return String(item.name || item.companyName || item.koreanName || item.label || displayName(item) || "").trim();
}

function transactionWatchlistOptionAliases(option = {}) {
  return [
    option.symbol,
    option.name,
    option.englishName,
    option.label,
    option.market,
  ]
    .map((value) => String(value || "").trim())
    .filter(Boolean);
}

function transactionWatchlistSymbolOptions(items = []) {
  const seenSymbols = new Set();
  const options = [];
  for (const item of items) {
    const symbol = transactionItemOrderKey(item);
    if (!symbol || seenSymbols.has(symbol)) continue;
    seenSymbols.add(symbol);
    const name = transactionWatchlistSearchName(item) || symbol;
    options.push({
      symbol,
      name,
      englishName: String(item.englishName || item.english_name || "").trim(),
      market: String(item.market || item.marketCountry || "").trim(),
      source: "holdings",
    });
  }
  return options;
}

function transactionWatchlistStockOptionsFromPayload(payload = {}) {
  const result = Array.isArray(payload?.result) ? payload.result : Array.isArray(payload) ? payload : [];
  return result
    .map((item) => {
      const symbol = cleanTransactionWatchlistSymbol(item?.symbol);
      if (!symbol) return null;
      return {
        symbol,
        name: String(item?.name || item?.label || symbol).trim(),
        englishName: String(item?.englishName || "").trim(),
        market: String(item?.market || "").trim(),
        status: String(item?.status || "").trim(),
        securityType: String(item?.securityType || "").trim(),
        sector: String(item?.sector || "").trim(),
        source: String(item?.source || "toss-stocks").trim(),
      };
    })
    .filter(Boolean);
}

function transactionWatchlistPriceRowsFromPayload(payload = {}) {
  const result = Array.isArray(payload?.result) ? payload.result : Array.isArray(payload) ? payload : [];
  return result
    .map((item) => {
      const symbol = cleanTransactionWatchlistSymbol(item?.symbol);
      if (!symbol) return null;
      return {
        raw: item,
        symbol,
        lastPrice: optionalNumericAmount(item?.lastPrice ?? item?.price ?? item?.closePrice ?? item?.close),
        currency: normalizeMoneyUnit(item?.currency || "KRW"),
        timestamp: String(item?.timestamp || item?.dateTime || item?.time || "").trim(),
        dailyReturnPercent: optionalRatePercent(
          item?.dailyReturnPercent ??
            item?.dayReturnPercent ??
            item?.dailyChangeRate ??
            item?.changeRate ??
            item?.fluctuationRate ??
            item?.rate
        ),
      };
    })
    .filter(Boolean);
}

function transactionWatchlistCandleRowsFromPayload(payload = {}) {
  const result = Array.isArray(payload?.result?.candles)
    ? payload.result.candles
    : Array.isArray(payload?.candles)
      ? payload.candles
      : Array.isArray(payload?.result)
        ? payload.result
        : Array.isArray(payload)
          ? payload
          : [];
  return result
    .map((item) => {
      const date = String(item?.date || item?.timestamp || item?.dateTime || item?.time || item?.at || "").slice(0, 10);
      const close = optionalNumericAmount(item?.closePrice ?? item?.close ?? item?.lastPrice ?? item?.price);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || close === null || close <= 0) return null;
      return { date, close };
    })
    .filter(Boolean)
    .sort((left, right) => left.date.localeCompare(right.date));
}

function transactionWatchlistPriceDate(row = {}) {
  const source = String(row.timestamp || row.raw?.timestamp || row.raw?.date || "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(source) ? source : "";
}

function transactionWatchlistLocalDateString(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function transactionWatchlistDateParts(dateString) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateString || ""));
  if (!match) return null;
  return {
    year: Number(match[1]),
    monthIndex: Number(match[2]) - 1,
    day: Number(match[3]),
  };
}

function transactionWatchlistShiftDate(dateString, { days = 0, months = 0, years = 0 } = {}) {
  const parts = transactionWatchlistDateParts(dateString);
  if (!parts) return "";
  const firstOfMonth = new Date(Date.UTC(parts.year - years, parts.monthIndex - months, 1));
  const lastDay = new Date(
    Date.UTC(firstOfMonth.getUTCFullYear(), firstOfMonth.getUTCMonth() + 1, 0)
  ).getUTCDate();
  const date = new Date(
    Date.UTC(firstOfMonth.getUTCFullYear(), firstOfMonth.getUTCMonth(), Math.min(parts.day, lastDay))
  );
  if (days) date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

function transactionWatchlistReturnTargetDate(anchorDate, periodKey) {
  if (periodKey === "weekly") return transactionWatchlistShiftDate(anchorDate, { days: 7 });
  if (periodKey === "monthly") return transactionWatchlistShiftDate(anchorDate, { months: 1 });
  if (periodKey === "sixMonth") return transactionWatchlistShiftDate(anchorDate, { months: 6 });
  return "";
}

function transactionWatchlistCloseAtOrBefore(candleRows = [], targetDate = "") {
  if (!targetDate) return null;
  const rows = transactionWatchlistCandleRowsFromPayload(candleRows);
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    if (rows[index].date <= targetDate && rows[index].close > 0) {
      return rows[index].close;
    }
  }
  return null;
}

function transactionWatchlistReturnPercent(lastPrice, baseClose) {
  const price = Number(lastPrice);
  const close = Number(baseClose);
  if (!Number.isFinite(price) || !Number.isFinite(close) || close <= 0) return null;
  return ((price - close) / close) * 100;
}

function transactionWatchlistUniqueCandleRows(rows = []) {
  const byDate = new Map();
  for (const row of transactionWatchlistCandleRowsFromPayload(rows)) {
    byDate.set(row.date, row);
  }
  return [...byDate.values()].sort((left, right) => left.date.localeCompare(right.date));
}

function previousCloseForWatchlistPrice(priceRow = {}, candleRows = []) {
  const priceDate = transactionWatchlistPriceDate(priceRow);
  const rows = transactionWatchlistCandleRowsFromPayload(candleRows);
  if (!rows.length) return null;
  if (priceDate) {
    const beforePriceDate = rows.filter((row) => row.date < priceDate).at(-1);
    if (beforePriceDate?.close > 0) return beforePriceDate.close;
  }
  if (rows.length >= 2) return rows.at(-2).close;
  return rows.at(-1)?.close > 0 && rows.at(-1).date !== priceDate ? rows.at(-1).close : null;
}

function transactionWatchlistReturnsForPrice(priceRow = {}, candleRows = []) {
  const rows = transactionWatchlistCandleRowsFromPayload(candleRows);
  const anchorDate = transactionWatchlistPriceDate(priceRow) || rows.at(-1)?.date || transactionWatchlistLocalDateString();
  const previousClose = previousCloseForWatchlistPrice(priceRow, rows);
  let dailyReturnPercent = priceRow.dailyReturnPercent;
  if (!Number.isFinite(dailyReturnPercent)) {
    dailyReturnPercent = transactionWatchlistReturnPercent(priceRow.lastPrice, previousClose);
  }
  const returns = {
    previousClose,
    dailyReturnPercent,
    hasDailyReturn: Number.isFinite(dailyReturnPercent),
  };
  for (const column of transactionWatchlistReturnColumns) {
    if (column.key === "daily") continue;
    const targetDate = transactionWatchlistReturnTargetDate(anchorDate, column.key);
    const baseClose = transactionWatchlistCloseAtOrBefore(rows, targetDate);
    const returnPercent = transactionWatchlistReturnPercent(priceRow.lastPrice, baseClose);
    const baseField = `${column.key}BaseClose`;
    returns[baseField] = baseClose;
    returns[column.valueField] = returnPercent;
    returns[column.hasField] = Number.isFinite(returnPercent);
  }
  return returns;
}

function transactionWatchlistPriceMap(priceRows = [], candlePayloads = []) {
  const candleRowsBySymbol = new Map();
  for (const payload of candlePayloads) {
    const symbol = cleanTransactionWatchlistSymbol(payload?.symbol);
    if (symbol) candleRowsBySymbol.set(symbol, transactionWatchlistUniqueCandleRows(payload?.candles || []));
  }
  const map = new Map();
  for (const row of priceRows) {
    map.set(row.symbol, {
      ...row,
      ...transactionWatchlistReturnsForPrice(row, candleRowsBySymbol.get(row.symbol) || []),
    });
  }
  return map;
}

async function fetchTransactionWatchlistCatalogOptions(query, signal) {
  const clean = String(query || "").trim();
  if (!clean) return [];
  const response = await fetch(`/api/market-symbols/search?query=${encodeURIComponent(clean)}&limit=12`, {
    cache: "no-store",
    signal,
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body?.ok === false) return [];
  return transactionWatchlistStockOptionsFromPayload(body);
}

async function fetchTransactionWatchlistCandleRows(symbol, signal) {
  const params = new URLSearchParams({
    symbol,
    interval: "1d",
    count: String(transactionWatchlistCandlePageSize),
    adjusted: "true",
  });
  try {
    const candleResponse = await fetch(`/api/tossinvest/candles?${params.toString()}`, {
      cache: "no-store",
      signal,
    });
    const candleBody = await candleResponse.json().catch(() => ({}));
    if (!candleResponse.ok || candleBody?.ok === false) return { symbol, candles: [] };
    return { symbol, candles: transactionWatchlistUniqueCandleRows(transactionWatchlistCandleRowsFromPayload(candleBody)) };
  } catch (fetchError) {
    if (fetchError.name === "AbortError") throw fetchError;
    return { symbol, candles: [] };
  }
}

async function fetchTransactionWatchlistPrices(symbols = [], signal) {
  const cleanSymbols = normalizeTransactionWatchlistSymbolsSetting(symbols);
  if (!cleanSymbols.length) {
    return {
      ok: true,
      result: [],
      priceMap: new Map(),
      source: "토스 증권 API",
      fetchedAt: new Date().toISOString(),
    };
  }
  const response = await fetch(`/api/tossinvest/prices?symbols=${encodeURIComponent(cleanSymbols.join(","))}`, {
    cache: "no-store",
    signal,
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body?.ok === false) {
    const error = new Error(body?.error || `HTTP ${response.status}`);
    error.errorCode = body?.errorCode || "";
    error.rateLimit = body?.rateLimit || null;
    throw error;
  }
  const priceRows = transactionWatchlistPriceRowsFromPayload(body);
  const candlePayloads = await Promise.all(
    cleanSymbols.map((symbol) => fetchTransactionWatchlistCandleRows(symbol, signal))
  );
  return {
    ...body,
    ok: true,
    result: priceRows,
    priceMap: transactionWatchlistPriceMap(priceRows, candlePayloads),
    source: "토스 증권 API 가격",
    fetchedAt: new Date().toISOString(),
  };
}

function mergeTransactionWatchlistSymbolOptions(...optionGroups) {
  const bySymbol = new Map();
  for (const group of optionGroups) {
    for (const option of Array.isArray(group) ? group : []) {
      const symbol = cleanTransactionWatchlistSymbol(option?.symbol);
      if (!symbol) continue;
      bySymbol.set(symbol, {
        ...(bySymbol.get(symbol) || {}),
        ...option,
        symbol,
        name: String(option?.name || bySymbol.get(symbol)?.name || symbol).trim(),
      });
    }
  }
  return [...bySymbol.values()];
}

function resolveTransactionWatchlistSymbolInput(value, options = []) {
  const rawValue = String(value ?? "").trim();
  const symbolValue = cleanTransactionWatchlistSymbol(rawValue);
  const lowerValue = rawValue.toLocaleLowerCase("ko-KR");
  if (!rawValue) return "";
  const exactSymbol = options.find((option) => cleanTransactionWatchlistSymbol(option.symbol) === symbolValue);
  if (exactSymbol) return cleanTransactionWatchlistSymbol(exactSymbol.symbol);
  const exactNameMatches = options.filter((option) => (
    transactionWatchlistOptionAliases(option).some((alias) => alias.toLocaleLowerCase("ko-KR") === lowerValue)
  ));
  return exactNameMatches.length === 1 ? cleanTransactionWatchlistSymbol(exactNameMatches[0].symbol) : "";
}

function cleanAccountSeq(value) {
  return String(value ?? "").trim();
}

function accountDisplayLabel(account = {}, index = 0) {
  const accountNo = String(account.accountNo || "").replace(/\D/g, "");
  if (accountNo.length >= 4) return `계좌 ${accountNo.slice(-4)}`;
  const accountSeq = cleanAccountSeq(account.accountSeq);
  if (accountSeq) return `계좌 ${accountSeq}`;
  return index === 0 ? "기본계좌" : `계좌 ${index + 1}`;
}

function transactionLiveFetchGate(status) {
  if (!status) {
    return { ready: false, waiting: true, message: "" };
  }
  const credentials = status?.credentials || {};
  const usable = Boolean(credentials.usable || credentials.unlocked);
  if (credentials.locked) {
    return {
      ready: false,
      waiting: false,
      message: "토스증권 API 키 저장소가 잠겨 있습니다. 설정에서 패스워드로 잠금 해제하세요.",
    };
  }
  if (credentials.invalid) {
    return {
      ready: false,
      waiting: false,
      message: "토스증권 API 키 저장소 형식이 올바르지 않습니다.",
    };
  }
  if (!usable) {
    return {
      ready: false,
      waiting: false,
      message: "토스증권 API 키가 설정되어 있지 않습니다.",
    };
  }
  return { ready: true, waiting: false, message: "" };
}

function transactionPageIsVisible() {
  if (typeof document === "undefined") return true;
  return document.visibilityState !== "hidden";
}

function retryAfterMsFromRateLimit(rateLimit = null) {
  const raw = String(rateLimit?.retryAfter || "").trim();
  if (!raw) return 0;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds > 0) {
    return Math.min(300_000, Math.round(seconds * 1000));
  }
  const retryAtMs = Date.parse(raw);
  if (!Number.isFinite(retryAtMs)) return 0;
  return Math.min(300_000, Math.max(0, retryAtMs - Date.now()));
}

function normalizeItem(item = {}, unit = "KRW") {
  const displayCurrency = item.displayCurrency || item.currency || unit;
  const value = Number(item.value || 0);
  const costBasis = Number(
    item.costBasis || (displayCurrency === "USD" ? item.knownCostBasisUsd : item.knownCostBasisKrw) || 0
  );
  const profit = Number(item.profit ?? value - costBasis);
  const profitPercent = Number(item.profitPercent ?? (costBasis ? (profit / costBasis) * 100 : 0));
  const dailyProfit = Number(item.dailyProfit || 0);
  const dailyReturnPercent = Number(item.dailyReturnPercent || 0);
  return {
    ...item,
    displayCurrency,
    value,
    costBasis,
    profit,
    profitPercent,
    dailyProfit,
    dailyReturnPercent,
    currentPrice: Number(item.currentPrice || 0),
    averageKnownCost: Number(item.averageKnownCost || 0),
  };
}

function sumConvertedItems(items, field, unit, usdKrwRate) {
  let total = 0;
  let hasValue = true;
  for (const item of items) {
    const itemUnit = item.displayCurrency || item.currency || unit;
    const amount = convertMoney(item[field], itemUnit, unit, usdKrwRate);
    if (amount === null) {
      hasValue = false;
      continue;
    }
    total += amount;
  }
  return { hasValue, value: total };
}

function aggregatePerformance(items, unit, usdKrwRate) {
  const value = sumConvertedItems(items, "value", unit, usdKrwRate);
  const costBasis = sumConvertedItems(items, "costBasis", unit, usdKrwRate);
  const profit = sumConvertedItems(items, "profit", unit, usdKrwRate);
  const dailyProfit = sumConvertedItems(items, "dailyProfit", unit, usdKrwRate);
  const profitPercent =
    costBasis.hasValue && costBasis.value ? (profit.value / Math.abs(costBasis.value)) * 100 : 0;
  return {
    value,
    costBasis,
    profit,
    dailyProfit,
    profitPercent,
  };
}

function usdKrwRateFromPayload(payload = {}) {
  const result = payload?.result && typeof payload.result === "object" ? payload.result : payload;
  const candidates = [
    result?.rate,
    result?.midRate,
    result?.exchangeRate,
    result?.baseRate,
    payload?.rate,
    payload?.midRate,
  ];
  for (const candidate of candidates) {
    const number = numericAmount(String(candidate ?? "").replace(/,/g, ""), 0);
    if (number > 0) return number;
  }
  return 0;
}

function sortItems(items, sortId, manualOrder = []) {
  if (sortId === "custom") {
    const itemOrder = syncTransactionSidebarManualOrder(manualOrder, items);
    const orderIndex = new Map(itemOrder.map((key, index) => [key, index]));
    const originalIndex = new Map(items.map((item, index) => [transactionItemOrderKey(item), index]));
    return [...items].sort((left, right) => {
      const leftKey = transactionItemOrderKey(left);
      const rightKey = transactionItemOrderKey(right);
      return (
        (orderIndex.get(leftKey) ?? Number.MAX_SAFE_INTEGER) -
          (orderIndex.get(rightKey) ?? Number.MAX_SAFE_INTEGER) ||
        (originalIndex.get(leftKey) ?? 0) - (originalIndex.get(rightKey) ?? 0)
      );
    });
  }
  const collator = new Intl.Collator("ko-KR", { numeric: true, sensitivity: "base" });
  const next = [...items];
  const compareName = (left, right) => collator.compare(displayName(left), displayName(right));
  next.sort((left, right) => {
    if (sortId === "profitRateDesc") return right.profitPercent - left.profitPercent || compareName(left, right);
    if (sortId === "profitRateAsc") return left.profitPercent - right.profitPercent || compareName(left, right);
    if (sortId === "valueDesc") return right.value - left.value || compareName(left, right);
    if (sortId === "valueAsc") return left.value - right.value || compareName(left, right);
    if (sortId === "dailyRateDesc") return right.dailyReturnPercent - left.dailyReturnPercent || compareName(left, right);
    if (sortId === "dailyRateAsc") return left.dailyReturnPercent - right.dailyReturnPercent || compareName(left, right);
    return compareName(left, right);
  });
  return next;
}

function itemMarketCountry(item = {}) {
  return String(item.marketCountry || "").trim().toUpperCase();
}

function itemIsOverseasStock(item = {}) {
  const marketCountry = itemMarketCountry(item);
  return Boolean(marketCountry && marketCountry !== "KR");
}

function itemIsDomesticStock(item = {}) {
  return itemMarketCountry(item) === "KR";
}

function SectionRail({ activeSection, onSelectSection }) {
  const items = [
    { id: "investment", label: "내 투자", Icon: BriefcaseBusiness },
    { id: "watchlist", label: "관심", Icon: Heart },
  ];
  return (
    <nav className="transaction-section-rail" aria-label="거래현황 섹션">
      {items.map(({ id, label, Icon }) => (
        <button
          className={activeSection === id ? "is-active" : ""}
          type="button"
          key={id}
          onClick={() => onSelectSection(id)}
          aria-pressed={activeSection === id}
        >
          <Icon size={18} strokeWidth={2.3} />
          <span>{label}</span>
        </button>
      ))}
    </nav>
  );
}

function SortMenu({ sortId, open, onOpenChange, onSelect }) {
  const selected = sortOptions.find((option) => option.id === sortId) || sortOptions[3];
  return (
    <div className="transaction-sort-menu">
      <button
        className="transaction-sort-trigger"
        type="button"
        onClick={() => onOpenChange(!open)}
        aria-expanded={open}
      >
        <span>{selected.label}</span>
        <ChevronDown size={16} strokeWidth={2.4} />
      </button>
      {open ? (
        <div className="transaction-sort-popover" role="menu">
          {sortOptions.map((option) => (
            <button
              type="button"
              role="menuitemradio"
              aria-checked={option.id === sortId}
              className={option.id === sortId ? "is-selected" : ""}
              key={option.id}
              onClick={() => {
                onSelect(option.id);
                onOpenChange(false);
              }}
            >
              <span>{option.label}</span>
              {option.id === sortId ? <Check size={17} strokeWidth={2.6} /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function CurrencySwitch({ unit, onChange, label = "통화 표시" }) {
  const normalizedUnit = normalizeMoneyUnit(unit);
  const nextUnit = normalizedUnit === "USD" ? "KRW" : "USD";
  const currentLabel = normalizedUnit === "USD" ? "달러" : "원화";
  const nextLabel = nextUnit === "USD" ? "달러" : "원화";
  return (
    <button
      className="transaction-currency-switch"
      type="button"
      onClick={() => onChange(nextUnit)}
      aria-label={`${label}: 현재 ${currentLabel}, 클릭하면 ${nextLabel}`}
    >
      <span className={normalizedUnit === "USD" ? "is-active" : ""} aria-hidden="true">
        $
      </span>
      <span className={normalizedUnit === "KRW" ? "is-active" : ""} aria-hidden="true">
        원
      </span>
    </button>
  );
}

function TransactionColumnFilter({ selectedColumnIds, onChange }) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef(null);
  const normalizedColumnIds = useMemo(
    () => normalizeTransactionMainTableColumnsSetting(selectedColumnIds, []),
    [selectedColumnIds]
  );
  const selectedSet = useMemo(() => new Set(normalizedColumnIds), [normalizedColumnIds]);
  const active = normalizedColumnIds.length > 0;
  const buttonTitle = active ? `추가 표 열 ${normalizedColumnIds.length}개 선택` : "기본 표 열만 표시";

  useEffect(() => {
    if (!open) return undefined;
    function handlePointerDown(event) {
      if (anchorRef.current && !anchorRef.current.contains(event.target)) {
        setOpen(false);
      }
    }
    function handleKeyDown(event) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const updateColumns = useCallback((nextColumnIds) => {
    onChange(normalizeTransactionMainTableColumnsSetting(nextColumnIds, []));
  }, [onChange]);

  const toggleColumn = useCallback((columnId, checked) => {
    const current = normalizeTransactionMainTableColumnsSetting(selectedColumnIds, []);
    const nextColumns = checked
      ? [...current, columnId]
      : current.filter((item) => item !== columnId);
    updateColumns(nextColumns);
  }, [selectedColumnIds, updateColumns]);

  return (
    <div className="transaction-column-filter-anchor" ref={anchorRef}>
      <button
        className={active ? "transaction-column-filter-button is-active" : "transaction-column-filter-button"}
        type="button"
        aria-label={buttonTitle}
        title={buttonTitle}
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <Filter size={17} strokeWidth={2.2} />
      </button>
      {open ? (
        <div className="transaction-column-filter-panel" role="dialog" aria-label="표 열 필터">
          <div className="transaction-column-filter-links">
            <button
              type="button"
              onClick={() => updateColumns(transactionSelectableMainTableColumns.map((column) => column.id))}
            >
              전부 선택
            </button>
            <button type="button" onClick={() => updateColumns([])}>
              전부 선택 해제
            </button>
          </div>
          <div className="transaction-column-filter-options">
            {transactionSelectableMainTableColumns.map((column) => (
              <label className="transaction-column-filter-option" key={column.id}>
                <input
                  type="checkbox"
                  checked={selectedSet.has(column.id)}
                  onChange={(event) => toggleColumn(column.id, event.target.checked)}
                />
                <span>{column.label}</span>
              </label>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function transactionSidebarPositionView(item, displayUnit, valueMode, usdKrwRate) {
  const itemUnit = item.displayCurrency || item.currency || displayUnit;
  const isPriceMode = valueMode === "price";
  const displayValue = isPriceMode ? item.currentPrice : item.value;
  const changeValue = isPriceMode ? item.dailyProfit : item.profit;
  const changePercent = isPriceMode ? item.dailyReturnPercent : item.profitPercent;
  const displayValueInUnit = convertedMoney(displayValue, itemUnit, displayUnit, usdKrwRate);
  const positionName = isPriceMode ? displayName(item) : item.symbol;
  const positionMeta = isPriceMode
    ? `내 평균 ${item.averageKnownCost ? formatConvertedMoney(item.averageKnownCost, itemUnit, displayUnit, usdKrwRate) : "-"}`
    : formatQuantity(item.quantity);
  const changeLabel = isPriceMode
    ? formatSignedPercent(changePercent)
    : formatConvertedPerformance(true, changeValue, changePercent, itemUnit, displayUnit, usdKrwRate);
  return {
    positionName,
    positionMeta,
    valueLabel: formatOptionalMoney(displayValueInUnit.hasValue, displayValueInUnit.value, displayUnit),
    changeLabel,
    toneClass: valueTone(isPriceMode ? changePercent : changeValue),
  };
}

function InvestmentSidebar({
  items,
  payload,
  unit,
  usdKrwRate,
  onUnitChange,
  sortId,
  sortOpen,
  onSortOpenChange,
  onSortSelect,
  manualOrder,
  manualOrderEditing,
  onManualOrderChange,
  onManualOrderSave,
  onManualOrderCancel,
  accounts,
  accountOpen,
  selectedAccountSeq,
  onAccountOpenChange,
  onAccountSelect,
  valueMode,
  onValueModeChange,
}) {
  const displayUnit = normalizeMoneyUnit(unit);
  const [draggedOrderKey, setDraggedOrderKey] = useState("");
  const [dragOverOrderKey, setDragOverOrderKey] = useState("");
  const [dragInsertPlacement, setDragInsertPlacement] = useState("before");
  const [dragPreview, setDragPreview] = useState(null);
  const pointerDraggedOrderKeyRef = useRef("");
  const pointerDragOverOrderKeyRef = useRef("");
  const pointerDragPlacementRef = useRef("before");
  const manualOrderRef = useRef(manualOrder);
  const manualItemsRef = useRef(items);
  const hasPayload = Boolean(payload?.ok);
  const totalUsd = hasPayload
    ? Number(payload?.totalValueUsd || items.reduce((sum, item) => sum + Number(item.marketValueUsd || 0), 0))
    : null;
  const totalKrw = hasPayload ? Number(payload?.totalValueKrw || 0) : null;
  const totals = aggregatePerformance(items, displayUnit, usdKrwRate);
  const sortLabel = (sortOptions.find((option) => option.id === sortId) || sortOptions[3]).label;
  const accountRows = Array.isArray(accounts) ? accounts : [];
  const effectiveAccountSeq = cleanAccountSeq(selectedAccountSeq || payload?.accountSeq);
  const selectedAccountIndex = Math.max(
    0,
    accountRows.findIndex((account) => cleanAccountSeq(account.accountSeq) === effectiveAccountSeq)
  );
  const selectedAccount = accountRows[selectedAccountIndex] || {};
  const accountLabel = accountRows.length ? accountDisplayLabel(selectedAccount, selectedAccountIndex) : "기본계좌";
  const manualSortActive = sortId === "custom" && manualOrderEditing;

  useEffect(() => {
    manualOrderRef.current = manualOrder;
  }, [manualOrder]);

  useEffect(() => {
    manualItemsRef.current = items;
  }, [items]);

  const updateDragOverOrderKey = useCallback((orderKey, placement = "before") => {
    pointerDragOverOrderKeyRef.current = orderKey;
    pointerDragPlacementRef.current = placement;
    setDragOverOrderKey(orderKey);
    setDragInsertPlacement(placement);
  }, []);

  const commitManualOrderChange = useCallback((sourceKey, targetKey, placement = "before") => {
    const currentOrder = syncTransactionSidebarManualOrder(manualOrderRef.current, manualItemsRef.current);
    const nextOrder = reorderTransactionSidebarManualOrder(currentOrder, sourceKey, targetKey, placement);
    if (!arraysEqual(currentOrder, nextOrder)) {
      manualOrderRef.current = nextOrder;
      onManualOrderChange(nextOrder);
    }
  }, [onManualOrderChange]);

  const handleManualDragEnd = useCallback(() => {
    pointerDraggedOrderKeyRef.current = "";
    pointerDragOverOrderKeyRef.current = "";
    pointerDragPlacementRef.current = "before";
    setDraggedOrderKey("");
    setDragOverOrderKey("");
    setDragInsertPlacement("before");
    setDragPreview(null);
  }, []);

  const handleManualPointerStart = useCallback((event, item) => {
    if (!manualSortActive) return;
    if (event.type === "mousedown" && pointerDraggedOrderKeyRef.current) return;
    const orderKey = transactionItemOrderKey(item);
    if (!orderKey) return;
    pointerDraggedOrderKeyRef.current = orderKey;
    pointerDragOverOrderKeyRef.current = orderKey;
    pointerDragPlacementRef.current = "before";
    setDraggedOrderKey(orderKey);
    setDragOverOrderKey(orderKey);
    setDragInsertPlacement("before");
    setDragPreview({
      key: orderKey,
      ...transactionSidebarPositionView(item, displayUnit, valueMode, usdKrwRate),
      x: event.clientX,
      y: event.clientY,
    });
    if (typeof event.currentTarget.setPointerCapture === "function" && event.pointerId !== undefined) {
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // Pointer capture is best-effort; document-level listeners still drive reordering.
      }
    }
    event.preventDefault();
    event.stopPropagation();
  }, [displayUnit, manualSortActive, usdKrwRate, valueMode]);

  const handleManualPointerMove = useCallback((event) => {
    if (!manualSortActive || !pointerDraggedOrderKeyRef.current) return;
    setDragPreview((current) => (
      current ? { ...current, x: event.clientX, y: event.clientY } : current
    ));
  }, [manualSortActive]);

  const handleManualPointerEnd = useCallback(() => {
    if (!manualSortActive || !pointerDraggedOrderKeyRef.current) return;
    pointerDraggedOrderKeyRef.current = "";
    pointerDragOverOrderKeyRef.current = "";
    pointerDragPlacementRef.current = "before";
    setDraggedOrderKey("");
    setDragOverOrderKey("");
    setDragInsertPlacement("before");
    setDragPreview(null);
  }, [manualSortActive]);

  useEffect(() => {
    if (!manualSortActive || !draggedOrderKey) return undefined;
    function dropTargetFromPoint(clientX, clientY) {
      const target = document.elementFromPoint(clientX, clientY);
      const row = target?.closest?.("[data-transaction-order-key]");
      const orderKey = String(row?.dataset?.transactionOrderKey || "").trim().toUpperCase();
      if (!row || !orderKey) return null;
      const rect = row.getBoundingClientRect();
      return {
        orderKey,
        placement: clientY > rect.top + rect.height / 2 ? "after" : "before",
      };
    }
    function handleDocumentMove(event) {
      if (!pointerDraggedOrderKeyRef.current) return;
      const clientX = Number(event.clientX || 0);
      const clientY = Number(event.clientY || 0);
      setDragPreview((current) => (
        current ? { ...current, x: clientX, y: clientY } : current
      ));
      const target = dropTargetFromPoint(clientX, clientY);
      if (!target) return;
      if (
        target.orderKey === pointerDragOverOrderKeyRef.current &&
        target.placement === pointerDragPlacementRef.current
      ) {
        return;
      }
      updateDragOverOrderKey(target.orderKey, target.placement);
      if (target.orderKey !== pointerDraggedOrderKeyRef.current) {
        commitManualOrderChange(pointerDraggedOrderKeyRef.current, target.orderKey, target.placement);
      }
    }
    function handleDocumentEnd() {
      handleManualDragEnd();
    }
    document.addEventListener("pointermove", handleDocumentMove);
    document.addEventListener("mousemove", handleDocumentMove);
    document.addEventListener("pointerup", handleDocumentEnd);
    document.addEventListener("mouseup", handleDocumentEnd);
    return () => {
      document.removeEventListener("pointermove", handleDocumentMove);
      document.removeEventListener("mousemove", handleDocumentMove);
      document.removeEventListener("pointerup", handleDocumentEnd);
      document.removeEventListener("mouseup", handleDocumentEnd);
    };
  }, [
    commitManualOrderChange,
    draggedOrderKey,
    handleManualDragEnd,
    manualSortActive,
    updateDragOverOrderKey,
  ]);

  return (
    <aside className="transaction-investment-sidebar" aria-label="내 투자 요약">
      <div className="transaction-account-header">
        <div className="transaction-account-menu">
          <button type="button" onClick={() => onAccountOpenChange(!accountOpen)} aria-expanded={accountOpen}>
            <span className="transaction-account-dot" aria-hidden="true" />
            <strong>{accountLabel}</strong>
            <ChevronDown size={14} strokeWidth={2.4} />
          </button>
          {accountOpen ? (
            <div className="transaction-account-popover" role="menu">
              {accountRows.length ? (
                accountRows.map((account, index) => {
                  const accountSeq = cleanAccountSeq(account.accountSeq);
                  const selected = accountSeq && accountSeq === effectiveAccountSeq;
                  return (
                    <button
                      className={selected ? "is-selected" : ""}
                      type="button"
                      role="menuitemradio"
                      aria-checked={selected}
                      key={`transaction-account-${accountSeq || index}`}
                      onClick={() => onAccountSelect(accountSeq)}
                    >
                      <span>{accountDisplayLabel(account, index)}</span>
                      {selected ? <Check size={15} strokeWidth={2.6} /> : null}
                    </button>
                  );
                })
              ) : (
                <span>계좌 없음</span>
              )}
            </div>
          ) : null}
        </div>
        <CurrencySwitch unit={displayUnit} onChange={onUnitChange} label="사이드바 통화 표시" />
      </div>

      <div className="transaction-cash-grid">
        <div>
          <span>원화</span>
          <strong>{formatOptionalMoney(hasPayload, totalKrw, "KRW")}</strong>
        </div>
        <div>
          <span>달러</span>
          <strong>{hasPayload ? formatUsd(totalUsd) : "-"}</strong>
        </div>
      </div>

      <section className="transaction-side-total">
        <span>내 투자</span>
        <strong>{formatOptionalMoney(hasPayload && totals.value.hasValue, totals.value.value, displayUnit)}</strong>
        <em className={hasPayload ? valueTone(totals.profit.value) : ""}>
          {formatOptionalPerformance(
            hasPayload && totals.profit.hasValue,
            totals.profit.value,
            totals.profitPercent,
            displayUnit
          )}
        </em>
      </section>

      <div className="transaction-side-controls">
        <SortMenu
          sortId={sortId}
          open={sortOpen}
          onOpenChange={onSortOpenChange}
          onSelect={onSortSelect}
        />
        {manualSortActive ? (
          <div className="transaction-manual-order-actions" role="group" aria-label="수동 정렬 편집">
            <button className="is-primary" type="button" onClick={onManualOrderSave}>
              저장
            </button>
            <button type="button" onClick={onManualOrderCancel}>
              취소
            </button>
          </div>
        ) : (
          <div className="transaction-value-mode" role="group" aria-label="보유 목록 값 표시">
            <button
              className={valueMode === "price" ? "is-active" : ""}
              type="button"
              onClick={() => onValueModeChange("price")}
            >
              현재가
            </button>
            <button
              className={valueMode === "value" ? "is-active" : ""}
              type="button"
              onClick={() => onValueModeChange("value")}
            >
              평가금
            </button>
          </div>
        )}
      </div>

      <ol
        className={dragPreview ? "transaction-side-position-list is-dragging" : "transaction-side-position-list"}
        aria-label={`${sortLabel} 보유 종목`}
        onPointerMove={handleManualPointerMove}
        onPointerUp={handleManualPointerEnd}
        onPointerCancel={handleManualDragEnd}
        onMouseMove={handleManualPointerMove}
        onMouseUp={handleManualPointerEnd}
      >
        {items.map((item) => {
          const orderKey = transactionItemOrderKey(item);
          const positionView = transactionSidebarPositionView(item, displayUnit, valueMode, usdKrwRate);
          const itemClassName = [
            "transaction-side-position-item",
            manualSortActive ? "is-manual-sort" : "",
            dragOverOrderKey === orderKey && draggedOrderKey && draggedOrderKey !== orderKey
              ? `is-drop-${dragInsertPlacement}`
              : "",
            draggedOrderKey === orderKey ? "is-dragging" : "",
          ].filter(Boolean).join(" ");
          return (
            <li
              className={itemClassName}
              key={`transaction-side-${item.currency}-${item.symbol}`}
              data-transaction-order-key={orderKey}
            >
              {manualSortActive ? (
                <button
                  className="transaction-side-drag-handle"
                  type="button"
                  title="클릭해서 드래그하면 순서를 바꿀 수 있습니다"
                  aria-label={`${displayName(item)} 순서 드래그`}
                  onPointerDown={(event) => handleManualPointerStart(event, item)}
                  onMouseDown={(event) => handleManualPointerStart(event, item)}
                >
                  <GripVertical size={16} strokeWidth={2.2} />
                </button>
              ) : null}
              <div className="transaction-side-position-name">
                <strong>{positionView.positionName}</strong>
                <span>{positionView.positionMeta}</span>
              </div>
              <div className="transaction-side-position-value">
                <strong>{positionView.valueLabel}</strong>
                <span className={positionView.toneClass}>{positionView.changeLabel}</span>
              </div>
            </li>
          );
        })}
      </ol>
      {dragPreview ? (
        <div
          className="transaction-side-drag-preview"
          style={{ "--transaction-drag-x": `${dragPreview.x}px`, "--transaction-drag-y": `${dragPreview.y}px` }}
          aria-hidden="true"
        >
          <div className="transaction-side-position-name">
            <strong>{dragPreview.positionName}</strong>
            <span>{dragPreview.positionMeta}</span>
          </div>
          <div className="transaction-side-position-value">
            <strong>{dragPreview.valueLabel}</strong>
            <span className={dragPreview.toneClass}>{dragPreview.changeLabel}</span>
          </div>
        </div>
      ) : null}
    </aside>
  );
}

function renderTransactionTableCell(columnId, { item, itemUnit, displayUnit, usdKrwRate }) {
  if (columnId === "ticker") return item.symbol || "-";
  if (columnId === "name") return displayName(item);
  if (columnId === "profitPercent") return formatSignedPercent(item.profitPercent);
  if (columnId === "profit") {
    const profit = convertedMoney(item.profit, itemUnit, displayUnit, usdKrwRate);
    return formatOptionalSignedMoney(profit.hasValue, profit.value, displayUnit);
  }
  if (columnId === "value") {
    const value = convertedMoney(item.value, itemUnit, displayUnit, usdKrwRate);
    return formatOptionalMoney(value.hasValue, value.value, displayUnit);
  }
  if (columnId === "costBasis") {
    const costBasis = convertedMoney(item.costBasis, itemUnit, displayUnit, usdKrwRate);
    return formatOptionalMoney(costBasis.hasValue, costBasis.value, displayUnit);
  }
  if (columnId === "currentPrice") {
    const currentPrice = convertedMoney(item.currentPrice, itemUnit, displayUnit, usdKrwRate);
    return formatOptionalMoney(currentPrice.hasValue, currentPrice.value, displayUnit);
  }
  if (columnId === "quantity") return formatQuantity(item.quantity);
  if (columnId === "averageKnownCost") {
    const averageKnownCost = convertedMoney(item.averageKnownCost, itemUnit, displayUnit, usdKrwRate);
    return item.averageKnownCost ? formatOptionalMoney(averageKnownCost.hasValue, averageKnownCost.value, displayUnit) : "-";
  }
  if (columnId === "dailyReturnPercent") return formatSignedPercent(item.dailyReturnPercent);
  if (columnId === "dailyProfit") {
    const dailyProfit = convertedMoney(item.dailyProfit, itemUnit, displayUnit, usdKrwRate);
    return formatOptionalSignedMoney(dailyProfit.hasValue, dailyProfit.value, displayUnit);
  }
  return "-";
}

function InvestmentTable({
  items,
  payload,
  unit,
  usdKrwRate,
  selectedColumnIds,
  emptyLabel = "보유 종목이 없습니다.",
}) {
  const displayUnit = normalizeMoneyUnit(unit);
  const visibleColumns = useMemo(() => visibleTransactionMainTableColumns(selectedColumnIds), [selectedColumnIds]);
  return (
    <div className="transaction-main-table-wrap">
      <table className="transaction-main-table" style={{ "--transaction-table-column-count": visibleColumns.length }}>
        <thead>
          <tr>
            {visibleColumns.map((column) => (
              <th className={column.align === "left" ? "is-left" : ""} key={`transaction-table-head-${column.id}`}>
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const itemUnit = item.displayCurrency || item.currency || displayUnit;
            const rowContext = { item, itemUnit, displayUnit, usdKrwRate };
            return (
              <tr key={`transaction-table-${item.currency}-${item.symbol}`}>
                {visibleColumns.map((column) => {
                  const toneClass = column.toneField ? valueTone(item[column.toneField]) : "";
                  const className = [column.align === "left" ? "is-left" : "", column.className || "", toneClass]
                    .filter(Boolean)
                    .join(" ");
                  return (
                    <td className={className} key={`transaction-table-${item.currency}-${item.symbol}-${column.id}`}>
                      {renderTransactionTableCell(column.id, rowContext)}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
      {!items.length ? (
        <div className="transaction-empty-state">{emptyLabel}</div>
      ) : null}
      <div className="transaction-table-credit">
        <span>{payload?.source || "토스 증권 API"}</span>
        {payload?.fetchedAt ? <span>{formatUpdatedAt(payload.fetchedAt)}</span> : null}
      </div>
    </div>
  );
}

function InvestmentMain({
  items,
  payload,
  unit,
  usdKrwRate,
  onUnitChange,
  selectedTableColumnIds,
  onTableColumnsChange,
  loading,
  error,
  statusBannerProps,
}) {
  const [activeFilter, setActiveFilter] = useState("all");
  const displayUnit = normalizeMoneyUnit(unit);
  const hasPayload = Boolean(payload?.ok);
  const totals = aggregatePerformance(items, displayUnit, usdKrwRate);
  const overseasCount = items.filter(itemIsOverseasStock).length;
  const domesticCount = items.filter(itemIsDomesticStock).length;
  const filteredItems = useMemo(() => {
    if (activeFilter === "overseas") return items.filter(itemIsOverseasStock);
    if (activeFilter === "domestic") return items.filter(itemIsDomesticStock);
    return items;
  }, [activeFilter, items]);
  const activeFilterLabel =
    activeFilter === "overseas" ? "해외주식" : activeFilter === "domestic" ? "국내주식" : "전체";
  const shouldShowBlockingError = Boolean(error && !payload);

  return (
    <section className="transaction-main-section" aria-label="내 투자 상세">
      <PortfolioTossApiStatus {...statusBannerProps} />

      <div className="transaction-main-summary">
        <span>내 투자</span>
        <div>
          <strong>{formatOptionalMoney(hasPayload && totals.value.hasValue, totals.value.value, displayUnit)}</strong>
          <em>원금 {formatOptionalMoney(hasPayload && totals.costBasis.hasValue, totals.costBasis.value, displayUnit)}</em>
          <em className={hasPayload ? valueTone(totals.profit.value) : ""}>
            총 수익 {formatOptionalPerformance(hasPayload && totals.profit.hasValue, totals.profit.value, totals.profitPercent, displayUnit)}
          </em>
          <em className={hasPayload ? valueTone(totals.dailyProfit.value) : ""}>
            일간 수익 {formatOptionalPerformance(
              hasPayload && totals.dailyProfit.hasValue,
              totals.dailyProfit.value,
              payload?.dailyReturnPercent || 0,
              displayUnit
            )}
          </em>
        </div>
      </div>

      <div className="transaction-main-filters" aria-label="보유 종목 필터">
        <button
          className={activeFilter === "all" ? "is-active" : ""}
          type="button"
          aria-pressed={activeFilter === "all"}
          onClick={() => setActiveFilter("all")}
        >
          전체 {items.length}개
        </button>
        <button
          className={activeFilter === "overseas" ? "is-active" : ""}
          type="button"
          aria-pressed={activeFilter === "overseas"}
          onClick={() => setActiveFilter("overseas")}
        >
          해외주식 {overseasCount}개
        </button>
        <button
          className={activeFilter === "domestic" ? "is-active" : ""}
          type="button"
          aria-pressed={activeFilter === "domestic"}
          onClick={() => setActiveFilter("domestic")}
        >
          국내주식 {domesticCount}개
        </button>
        <TransactionColumnFilter
          selectedColumnIds={selectedTableColumnIds}
          onChange={onTableColumnsChange}
        />
        <CurrencySwitch unit={displayUnit} onChange={onUnitChange} label="메인 섹션 통화 표시" />
      </div>

      {loading && !payload ? (
        <div className="transaction-loading-state">
          <LoaderCircle className="is-spinning" size={18} strokeWidth={2.4} />
          <span>토스 증권 API 불러오는 중</span>
        </div>
      ) : shouldShowBlockingError ? (
        <div className="transaction-error-state">{error}</div>
      ) : (
        <InvestmentTable
          items={filteredItems}
          payload={payload}
          unit={displayUnit}
          usdKrwRate={usdKrwRate}
          selectedColumnIds={selectedTableColumnIds}
          emptyLabel={`${activeFilterLabel} 보유 종목이 없습니다.`}
        />
      )}
    </section>
  );
}

function watchlistRowsFromGroup(group, items, symbolOptions = [], priceMap = new Map()) {
  const itemBySymbol = new Map();
  for (const item of items) {
    const symbol = transactionItemOrderKey(item);
    if (symbol && !itemBySymbol.has(symbol)) {
      itemBySymbol.set(symbol, item);
    }
  }
  const optionBySymbol = new Map(
    symbolOptions
      .map((option) => [cleanTransactionWatchlistSymbol(option?.symbol), option])
      .filter(([symbol]) => symbol)
  );
  return normalizeTransactionWatchlistSymbolsSetting(group?.symbols || []).map((symbol) => {
    const item = itemBySymbol.get(symbol) || null;
    const option = optionBySymbol.get(symbol) || null;
    const price = priceMap.get(symbol) || null;
    const row = {
      symbol,
      item,
      name: item ? displayName(item) : option?.name || option?.englishName || "-",
      lastPrice: price?.lastPrice ?? item?.currentPrice ?? null,
    };
    for (const column of transactionWatchlistReturnColumns) {
      const value = Number(price?.[column.valueField]);
      const hasValue = Boolean(price?.[column.hasField] && Number.isFinite(value));
      row[column.valueField] = hasValue ? value : 0;
      row[column.hasField] = hasValue;
    }
    return row;
  });
}

function averageWatchlistDailyReturn(rows) {
  const values = rows
    .filter((row) => row.hasDailyReturn)
    .map((row) => row.dailyReturnPercent);
  if (!values.length) return { hasValue: false, value: 0 };
  const total = values.reduce((sum, value) => sum + value, 0);
  return { hasValue: true, value: total / values.length };
}

function WatchlistTable({
  rows,
  payload,
  emptyLabel = "추가한 종목이 없습니다.",
  orderEditing,
  onOrderChange,
  onRemoveSymbol,
}) {
  const [draggedSymbol, setDraggedSymbol] = useState("");
  const [dragOverSymbol, setDragOverSymbol] = useState("");
  const [dragInsertPlacement, setDragInsertPlacement] = useState("before");
  const [dragPreview, setDragPreview] = useState(null);
  const pointerDraggedSymbolRef = useRef("");
  const pointerDragOverSymbolRef = useRef("");
  const pointerDragPlacementRef = useRef("before");
  const rowsRef = useRef(rows);

  useEffect(() => {
    rowsRef.current = rows;
  }, [rows]);

  const updateDragOverSymbol = useCallback((symbol, placement = "before") => {
    pointerDragOverSymbolRef.current = symbol;
    pointerDragPlacementRef.current = placement;
    setDragOverSymbol(symbol);
    setDragInsertPlacement(placement);
  }, []);

  const handleSymbolDragEnd = useCallback(() => {
    pointerDraggedSymbolRef.current = "";
    pointerDragOverSymbolRef.current = "";
    pointerDragPlacementRef.current = "before";
    setDraggedSymbol("");
    setDragOverSymbol("");
    setDragInsertPlacement("before");
    setDragPreview(null);
  }, []);

  const commitSymbolOrderChange = useCallback((sourceSymbol, targetSymbol, placement = "before") => {
    const currentRows = Array.isArray(rowsRef.current) ? rowsRef.current : [];
    const currentSymbols = currentRows.map((row) => row.symbol);
    const nextSymbols = reorderTransactionWatchlistSymbols(currentSymbols, sourceSymbol, targetSymbol, placement);
    if (arraysEqual(currentSymbols, nextSymbols)) return;
    const rowBySymbol = new Map(currentRows.map((row) => [row.symbol, row]));
    rowsRef.current = nextSymbols.map((symbol) => rowBySymbol.get(symbol)).filter(Boolean);
    onOrderChange(nextSymbols);
  }, [onOrderChange]);

  const handleSymbolPointerStart = useCallback((event, row) => {
    if (!orderEditing) return;
    if (event.type === "mousedown" && pointerDraggedSymbolRef.current) return;
    const symbol = cleanTransactionWatchlistSymbol(row?.symbol);
    if (!symbol) return;
    pointerDraggedSymbolRef.current = symbol;
    pointerDragOverSymbolRef.current = symbol;
    pointerDragPlacementRef.current = "before";
    setDraggedSymbol(symbol);
    setDragOverSymbol(symbol);
    setDragInsertPlacement("before");
    setDragPreview({
      symbol,
      name: row.name,
      x: event.clientX,
      y: event.clientY,
    });
    if (typeof event.currentTarget.setPointerCapture === "function" && event.pointerId !== undefined) {
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // Pointer capture is best-effort; document-level listeners still drive reordering.
      }
    }
    event.preventDefault();
    event.stopPropagation();
  }, [orderEditing]);

  const handleSymbolPointerMove = useCallback((event) => {
    if (!orderEditing || !pointerDraggedSymbolRef.current) return;
    setDragPreview((current) => (
      current ? { ...current, x: event.clientX, y: event.clientY } : current
    ));
  }, [orderEditing]);

  const handleSymbolPointerEnd = useCallback(() => {
    if (!orderEditing || !pointerDraggedSymbolRef.current) return;
    handleSymbolDragEnd();
  }, [handleSymbolDragEnd, orderEditing]);

  useEffect(() => {
    if (!orderEditing || !draggedSymbol) return undefined;
    function dropTargetFromPoint(clientX, clientY) {
      const target = document.elementFromPoint(clientX, clientY);
      const row = target?.closest?.("[data-transaction-watchlist-symbol]");
      const symbol = cleanTransactionWatchlistSymbol(row?.dataset?.transactionWatchlistSymbol);
      if (!row || !symbol) return null;
      const rect = row.getBoundingClientRect();
      return {
        symbol,
        placement: clientY > rect.top + rect.height / 2 ? "after" : "before",
      };
    }
    function handleDocumentMove(event) {
      if (!pointerDraggedSymbolRef.current) return;
      const clientX = Number(event.clientX || 0);
      const clientY = Number(event.clientY || 0);
      setDragPreview((current) => (
        current ? { ...current, x: clientX, y: clientY } : current
      ));
      const target = dropTargetFromPoint(clientX, clientY);
      if (!target) return;
      if (
        target.symbol === pointerDragOverSymbolRef.current &&
        target.placement === pointerDragPlacementRef.current
      ) {
        return;
      }
      updateDragOverSymbol(target.symbol, target.placement);
      if (target.symbol !== pointerDraggedSymbolRef.current) {
        commitSymbolOrderChange(pointerDraggedSymbolRef.current, target.symbol, target.placement);
      }
    }
    document.addEventListener("pointermove", handleDocumentMove);
    document.addEventListener("mousemove", handleDocumentMove);
    document.addEventListener("pointerup", handleSymbolDragEnd);
    document.addEventListener("mouseup", handleSymbolDragEnd);
    return () => {
      document.removeEventListener("pointermove", handleDocumentMove);
      document.removeEventListener("mousemove", handleDocumentMove);
      document.removeEventListener("pointerup", handleSymbolDragEnd);
      document.removeEventListener("mouseup", handleSymbolDragEnd);
    };
  }, [
    commitSymbolOrderChange,
    draggedSymbol,
    handleSymbolDragEnd,
    orderEditing,
    updateDragOverSymbol,
  ]);

  return (
    <div className="transaction-main-table-wrap">
      <table
        className={orderEditing ? "transaction-main-table transaction-watchlist-table is-order-editing" : "transaction-main-table transaction-watchlist-table"}
        style={{ "--transaction-table-column-count": transactionWatchlistReturnColumns.length + 3 }}
      >
        <thead>
          <tr>
            {orderEditing ? <th className="transaction-watchlist-drag-column" aria-label="순서" /> : null}
            <th className="is-left">티커 / 종목번호</th>
            <th className="is-left">종목명</th>
            {transactionWatchlistReturnColumns.map((column) => (
              <th key={`transaction-watchlist-head-${column.key}`}>{column.label}</th>
            ))}
            {!orderEditing ? <th className="transaction-watchlist-action-column" aria-label="항목 작업" /> : null}
          </tr>
        </thead>
        <tbody
          onPointerMove={handleSymbolPointerMove}
          onPointerUp={handleSymbolPointerEnd}
          onPointerCancel={handleSymbolDragEnd}
          onMouseMove={handleSymbolPointerMove}
          onMouseUp={handleSymbolPointerEnd}
        >
          {rows.map((row) => {
            const rowClassName = [
              "transaction-watchlist-stock-row",
              orderEditing ? "is-manual-sort" : "",
              dragOverSymbol === row.symbol && draggedSymbol && draggedSymbol !== row.symbol
                ? `is-drop-${dragInsertPlacement}`
                : "",
              draggedSymbol === row.symbol ? "is-dragging" : "",
            ].filter(Boolean).join(" ");
            return (
            <tr
              className={rowClassName}
              key={`transaction-watchlist-row-${row.symbol}`}
              data-transaction-watchlist-symbol={row.symbol}
            >
              {orderEditing ? (
                <td className="transaction-watchlist-drag-cell">
                  <button
                    className="transaction-watchlist-symbol-drag-handle"
                    type="button"
                    title="클릭해서 드래그하면 순서를 바꿀 수 있습니다"
                    aria-label={`${row.symbol} 순서 드래그`}
                    onPointerDown={(event) => handleSymbolPointerStart(event, row)}
                    onMouseDown={(event) => handleSymbolPointerStart(event, row)}
                  >
                    <GripVertical size={15} strokeWidth={2.2} aria-hidden="true" />
                  </button>
                </td>
              ) : null}
              <td className="is-left transaction-table-ticker">{row.symbol}</td>
              <td className="is-left transaction-table-name">{row.name}</td>
              {transactionWatchlistReturnColumns.map((column) => {
                const value = Number(row[column.valueField]);
                const hasValue = Boolean(row[column.hasField] && Number.isFinite(value));
                return (
                  <td
                    key={`transaction-watchlist-row-${row.symbol}-${column.key}`}
                    className={hasValue ? valueTone(value) : ""}
                  >
                    {hasValue ? formatSignedPercent(value) : "-"}
                  </td>
                );
              })}
              {!orderEditing ? (
                <td className="transaction-watchlist-row-actions">
                  <button
                    className="transaction-watchlist-symbol-delete-button"
                    type="button"
                    aria-label={`${row.symbol} 관심 종목 삭제`}
                    title={`${row.symbol} 관심 종목 삭제`}
                    onClick={() => onRemoveSymbol(row.symbol)}
                  >
                    <Trash2 size={14} strokeWidth={2.2} aria-hidden="true" />
                  </button>
                </td>
              ) : null}
            </tr>
            );
          })}
        </tbody>
      </table>
      {!rows.length ? (
        <div className="transaction-empty-state">{emptyLabel}</div>
      ) : null}
      <div className="transaction-table-credit">
        <span>{payload?.source || "토스 증권 API"}</span>
        {payload?.fetchedAt ? <span>{formatUpdatedAt(payload.fetchedAt)}</span> : null}
      </div>
      {dragPreview ? (
        <div
          className="transaction-watchlist-stock-drag-preview"
          style={{ "--transaction-drag-x": `${dragPreview.x}px`, "--transaction-drag-y": `${dragPreview.y}px` }}
          aria-hidden="true"
        >
          <span className="transaction-watchlist-stock-drag-label">
            <GripVertical size={15} strokeWidth={2.2} />
            <strong>{dragPreview.symbol}</strong>
            <span>{dragPreview.name}</span>
          </span>
        </div>
      ) : null}
    </div>
  );
}

function WatchlistMain({
  selectedGroup,
  items,
  symbolOptions,
  priceMap,
  payload,
  loading,
  error,
  statusBannerProps,
  renameActive,
  renameDraft,
  renameError,
  onRequestRenameGroup,
  onRenameDraftChange,
  onSubmitRenameGroup,
  onCancelRenameGroup,
  symbolOrderEditing,
  onSymbolOrderEditStart,
  onSymbolOrderChange,
  onSymbolOrderSave,
  onOpenAddSymbol,
  onRemoveSymbol,
}) {
  const hasSelectedGroup = Boolean(selectedGroup);
  const rows = useMemo(
    () => watchlistRowsFromGroup(selectedGroup, items, symbolOptions, priceMap),
    [items, priceMap, selectedGroup, symbolOptions]
  );
  const averageDailyReturn = useMemo(() => averageWatchlistDailyReturn(rows), [rows]);
  const shouldShowBlockingError = Boolean(error && !payload);
  const SymbolOrderIcon = symbolOrderEditing ? Save : PencilLine;

  return (
    <section className="transaction-main-section transaction-watchlist-main-section" aria-label="관심 그룹 상세">
      <PortfolioTossApiStatus {...statusBannerProps} />

      <div className="transaction-main-summary transaction-watchlist-main-summary">
        {renameActive && selectedGroup ? (
          <form
            className="transaction-watchlist-title-rename-form"
            aria-label={`${selectedGroup.name} 관심 그룹 이름 변경`}
            onSubmit={(event) => {
              event.preventDefault();
              onSubmitRenameGroup();
            }}
          >
            <input
              className="transaction-watchlist-title-rename-input"
              type="text"
              value={renameDraft}
              maxLength={80}
              autoFocus
              onFocus={(event) => event.currentTarget.select()}
              onChange={(event) => onRenameDraftChange(event.target.value)}
              onBlur={(event) => {
                if (!cleanTransactionWatchlistGroupName(event.currentTarget.value)) {
                  onCancelRenameGroup();
                  return;
                }
                onSubmitRenameGroup();
              }}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  onCancelRenameGroup();
                }
              }}
            />
            {renameError ? <span className="transaction-watchlist-title-rename-error" role="alert">{renameError}</span> : null}
          </form>
        ) : (
          <button
            className="transaction-watchlist-title-button"
            type="button"
            aria-label={hasSelectedGroup ? `${selectedGroup.name} 관심 그룹 이름 변경` : "관심 목록"}
            title={hasSelectedGroup ? "관심 그룹 이름 변경" : undefined}
            disabled={!hasSelectedGroup}
            onClick={() => onRequestRenameGroup(selectedGroup.id, "main")}
          >
            <span>{selectedGroup?.name || "관심 목록"}</span>
          </button>
        )}
        <div>
          <strong className={averageDailyReturn.hasValue ? valueTone(averageDailyReturn.value) : ""}>
            {averageDailyReturn.hasValue ? formatSignedPercent(averageDailyReturn.value) : "-"}
          </strong>
          <em>일간 수익</em>
        </div>
      </div>

      <div className="transaction-main-filters transaction-watchlist-main-actions" aria-label="관심 종목 작업">
        <button
          className={symbolOrderEditing ? "transaction-watchlist-stock-order-button is-active" : "transaction-watchlist-stock-order-button"}
          type="button"
          aria-label={symbolOrderEditing ? "관심 종목 순서 저장" : "관심 종목 순서 바꾸기"}
          title={symbolOrderEditing ? "관심 종목 순서 저장" : "관심 종목 순서 바꾸기"}
          aria-pressed={symbolOrderEditing}
          disabled={!symbolOrderEditing && (!hasSelectedGroup || rows.length < 2)}
          onClick={symbolOrderEditing ? onSymbolOrderSave : onSymbolOrderEditStart}
        >
          <SymbolOrderIcon size={16} strokeWidth={2.3} aria-hidden="true" />
          <span>{symbolOrderEditing ? "순서 저장" : "순서 바꾸기"}</span>
        </button>
        <button
          className="transaction-watchlist-stock-add-button"
          type="button"
          aria-label="종목 추가하기"
          title="종목 추가하기"
          disabled={!hasSelectedGroup || symbolOrderEditing}
          onClick={onOpenAddSymbol}
        >
          <CirclePlus size={17} strokeWidth={2.3} aria-hidden="true" />
          <span>종목 추가하기</span>
        </button>
      </div>

      {loading && !payload ? (
        <div className="transaction-loading-state">
          <LoaderCircle className="is-spinning" size={18} strokeWidth={2.4} />
          <span>토스 증권 API 불러오는 중</span>
        </div>
      ) : shouldShowBlockingError ? (
        <div className="transaction-error-state">{error}</div>
      ) : (
        <WatchlistTable
          rows={rows}
          payload={payload}
          emptyLabel={hasSelectedGroup ? "추가한 종목이 없습니다." : "관심 그룹이 없습니다."}
          orderEditing={symbolOrderEditing}
          onOrderChange={onSymbolOrderChange}
          onRemoveSymbol={onRemoveSymbol}
        />
      )}
    </section>
  );
}

function WatchlistCreateDialog({
  draftName,
  error,
  onDraftNameChange,
  onCancel,
  onSubmit,
}) {
  return (
    <div className="transaction-watchlist-modal-backdrop" role="presentation" onMouseDown={onCancel}>
      <form
        className="transaction-watchlist-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="transaction-watchlist-create-title"
        onMouseDown={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <label className="transaction-watchlist-field" htmlFor="transaction-watchlist-group-name">
          <span id="transaction-watchlist-create-title">새 관심 그룹 이름을 입력하세요</span>
          <input
            id="transaction-watchlist-group-name"
            type="text"
            value={draftName}
            maxLength={80}
            autoFocus
            onChange={(event) => onDraftNameChange(event.target.value)}
          />
        </label>
        {error ? <p className="transaction-watchlist-modal-error" role="alert">{error}</p> : null}
        <div className="transaction-watchlist-modal-actions">
          <button type="button" onClick={onCancel}>
            취소
          </button>
          <button className="is-primary" type="submit">
            입력
          </button>
        </div>
      </form>
    </div>
  );
}

function WatchlistSymbolDialog({
  group,
  draftSymbol,
  error,
  symbolOptions = [],
  onDraftSymbolChange,
  onCancel,
  onSubmit,
}) {
  if (!group) return null;
  const query = String(draftSymbol || "").trim();
  const symbolQuery = cleanTransactionWatchlistSymbol(query);
  const lowerQuery = query.toLocaleLowerCase("ko-KR");
  const existingSymbols = new Set(normalizeTransactionWatchlistSymbolsSetting(group.symbols));
  const suggestions = query
    ? symbolOptions
        .filter((option) => {
          const optionSymbol = cleanTransactionWatchlistSymbol(option.symbol);
          if (!optionSymbol || existingSymbols.has(optionSymbol)) return false;
          return transactionWatchlistOptionAliases(option).some((alias) => {
            const lowerAlias = alias.toLocaleLowerCase("ko-KR");
            return cleanTransactionWatchlistSymbol(alias).includes(symbolQuery) || lowerAlias.includes(lowerQuery);
          });
        })
        .slice(0, 8)
    : [];

  return (
    <div className="transaction-watchlist-modal-backdrop" role="presentation" onMouseDown={onCancel}>
      <form
        className="transaction-watchlist-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="transaction-watchlist-symbol-title"
        onMouseDown={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <label className="transaction-watchlist-field" htmlFor="transaction-watchlist-symbol">
          <span id="transaction-watchlist-symbol-title">티커 / 종목번호 / 종목명을 입력하세요</span>
          <input
            id="transaction-watchlist-symbol"
            type="text"
            value={draftSymbol}
            maxLength={32}
            autoFocus
            autoComplete="off"
            onChange={(event) => onDraftSymbolChange(event.target.value)}
          />
        </label>
        {suggestions.length ? (
          <div className="transaction-watchlist-autocomplete" role="listbox" aria-label="종목 자동완성">
            {suggestions.map((option) => (
              <button
                type="button"
                role="option"
                key={`transaction-watchlist-option-${option.symbol}`}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => onDraftSymbolChange(option.symbol)}
              >
                <strong>{option.symbol}</strong>
                <span>{[option.name, option.englishName, option.market].filter(Boolean).join(" · ")}</span>
              </button>
            ))}
          </div>
        ) : query ? (
          <p className="transaction-watchlist-autocomplete-empty">검색 가능한 종목 목록에서 찾을 수 없습니다.</p>
        ) : null}
        {error ? <p className="transaction-watchlist-modal-error" role="alert">{error}</p> : null}
        <div className="transaction-watchlist-modal-actions">
          <button type="button" onClick={onCancel}>
            취소
          </button>
          <button className="is-primary" type="submit">
            입력
          </button>
        </div>
      </form>
    </div>
  );
}

function WatchlistDeleteDialog({ group, onCancel, onConfirm }) {
  if (!group) return null;
  return (
    <div className="transaction-watchlist-modal-backdrop" role="presentation" onMouseDown={onCancel}>
      <section
        className="transaction-watchlist-modal"
        role="alertdialog"
        aria-modal="true"
        aria-label="관심 그룹 삭제"
        aria-describedby="transaction-watchlist-delete-description"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <p id="transaction-watchlist-delete-description">관심 그룹을 삭제하시겠습니까? 이 결정은 되돌릴 수 없습니다</p>
        <strong className="transaction-watchlist-delete-target">{group.name}</strong>
        <div className="transaction-watchlist-modal-actions">
          <button type="button" onClick={onCancel}>
            취소
          </button>
          <button className="is-danger" type="button" onClick={onConfirm}>
            확인
          </button>
        </div>
      </section>
    </div>
  );
}

function WatchlistPlaceholder({
  statusBannerProps,
  watchlistGroups,
  selectedGroupId,
  selectedGroup,
  items,
  symbolOptions,
  priceMap,
  payload,
  loading,
  error,
  orderEditing,
  renameGroupId,
  renamePlacement,
  renameDraft,
  renameError,
  symbolOrderEditing,
  onSelectGroup,
  onRequestRenameGroup,
  onRenameDraftChange,
  onSubmitRenameGroup,
  onCancelRenameGroup,
  onSymbolOrderEditStart,
  onSymbolOrderChange,
  onSymbolOrderSave,
  onOpenAddSymbol,
  onRemoveSymbol,
  onOpenCreateGroup,
  onRequestDeleteGroup,
  onOrderEditStart,
  onOrderChange,
  onOrderSave,
}) {
  const groups = normalizeTransactionWatchlistGroupsSetting(watchlistGroups, []);
  const [draggedGroupId, setDraggedGroupId] = useState("");
  const [dragOverGroupId, setDragOverGroupId] = useState("");
  const [dragInsertPlacement, setDragInsertPlacement] = useState("before");
  const [dragPreview, setDragPreview] = useState(null);
  const pointerDraggedGroupIdRef = useRef("");
  const pointerDragOverGroupIdRef = useRef("");
  const pointerDragPlacementRef = useRef("before");
  const groupsRef = useRef(groups);
  const SaveIcon = orderEditing ? Save : PencilLine;

  useEffect(() => {
    groupsRef.current = groups;
  }, [groups]);

  const updateDragOverGroupId = useCallback((groupId, placement = "before") => {
    pointerDragOverGroupIdRef.current = groupId;
    pointerDragPlacementRef.current = placement;
    setDragOverGroupId(groupId);
    setDragInsertPlacement(placement);
  }, []);

  const handleGroupDragEnd = useCallback(() => {
    pointerDraggedGroupIdRef.current = "";
    pointerDragOverGroupIdRef.current = "";
    pointerDragPlacementRef.current = "before";
    setDraggedGroupId("");
    setDragOverGroupId("");
    setDragInsertPlacement("before");
    setDragPreview(null);
  }, []);

  const commitGroupOrderChange = useCallback((sourceId, targetId, placement = "before") => {
    const currentGroups = normalizeTransactionWatchlistGroupsSetting(groupsRef.current, []);
    const nextGroups = reorderTransactionWatchlistGroups(currentGroups, sourceId, targetId, placement);
    if (!watchlistGroupIdsEqual(currentGroups, nextGroups)) {
      groupsRef.current = nextGroups;
      onOrderChange(nextGroups);
    }
  }, [onOrderChange]);

  const handleGroupPointerStart = useCallback((event, group) => {
    if (!orderEditing) return;
    if (event.type === "mousedown" && pointerDraggedGroupIdRef.current) return;
    const groupId = cleanTransactionWatchlistGroupId(group.id);
    if (!groupId) return;
    pointerDraggedGroupIdRef.current = groupId;
    pointerDragOverGroupIdRef.current = groupId;
    pointerDragPlacementRef.current = "before";
    setDraggedGroupId(groupId);
    setDragOverGroupId(groupId);
    setDragInsertPlacement("before");
    setDragPreview({
      id: groupId,
      name: group.name,
      x: event.clientX,
      y: event.clientY,
    });
    if (typeof event.currentTarget.setPointerCapture === "function" && event.pointerId !== undefined) {
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // Pointer capture is best-effort; document-level listeners still drive reordering.
      }
    }
    event.preventDefault();
    event.stopPropagation();
  }, [orderEditing]);

  const handleGroupPointerMove = useCallback((event) => {
    if (!orderEditing || !pointerDraggedGroupIdRef.current) return;
    setDragPreview((current) => (
      current ? { ...current, x: event.clientX, y: event.clientY } : current
    ));
  }, [orderEditing]);

  const handleGroupPointerEnd = useCallback(() => {
    if (!orderEditing || !pointerDraggedGroupIdRef.current) return;
    handleGroupDragEnd();
  }, [handleGroupDragEnd, orderEditing]);

  useEffect(() => {
    if (!orderEditing || !draggedGroupId) return undefined;
    function dropTargetFromPoint(clientX, clientY) {
      const target = document.elementFromPoint(clientX, clientY);
      const row = target?.closest?.("[data-transaction-watchlist-group-id]");
      const groupId = cleanTransactionWatchlistGroupId(row?.dataset?.transactionWatchlistGroupId);
      if (!row || !groupId) return null;
      const rect = row.getBoundingClientRect();
      return {
        groupId,
        placement: clientY > rect.top + rect.height / 2 ? "after" : "before",
      };
    }
    function handleDocumentMove(event) {
      if (!pointerDraggedGroupIdRef.current) return;
      const clientX = Number(event.clientX || 0);
      const clientY = Number(event.clientY || 0);
      setDragPreview((current) => (
        current ? { ...current, x: clientX, y: clientY } : current
      ));
      const target = dropTargetFromPoint(clientX, clientY);
      if (!target) return;
      if (
        target.groupId === pointerDragOverGroupIdRef.current &&
        target.placement === pointerDragPlacementRef.current
      ) {
        return;
      }
      updateDragOverGroupId(target.groupId, target.placement);
      if (target.groupId !== pointerDraggedGroupIdRef.current) {
        commitGroupOrderChange(pointerDraggedGroupIdRef.current, target.groupId, target.placement);
      }
    }
    document.addEventListener("pointermove", handleDocumentMove);
    document.addEventListener("mousemove", handleDocumentMove);
    document.addEventListener("pointerup", handleGroupDragEnd);
    document.addEventListener("mouseup", handleGroupDragEnd);
    return () => {
      document.removeEventListener("pointermove", handleDocumentMove);
      document.removeEventListener("mousemove", handleDocumentMove);
      document.removeEventListener("pointerup", handleGroupDragEnd);
      document.removeEventListener("mouseup", handleGroupDragEnd);
    };
  }, [
    commitGroupOrderChange,
    draggedGroupId,
    handleGroupDragEnd,
    orderEditing,
    updateDragOverGroupId,
  ]);

  return (
    <section className="transaction-watchlist-section" aria-label="관심">
      <div className="transaction-watchlist-sidebar">
        <div className="transaction-watchlist-header">
          <h2>관심 목록</h2>
          <div className="transaction-watchlist-header-actions">
            <button
              className={orderEditing ? "transaction-watchlist-edit-button is-active" : "transaction-watchlist-edit-button"}
              type="button"
              aria-label={orderEditing ? "관심 그룹 순서 저장" : "관심 그룹 순서 편집"}
              title={orderEditing ? "관심 그룹 순서 저장" : "관심 그룹 순서 편집"}
              aria-pressed={orderEditing}
              disabled={!orderEditing && !groups.length}
              onClick={orderEditing ? onOrderSave : onOrderEditStart}
            >
              <SaveIcon size={17} strokeWidth={2.3} aria-hidden="true" />
            </button>
            <button
              className="transaction-watchlist-add-button"
              type="button"
              aria-label="관심 그룹 추가"
              title="관심 그룹 추가"
              onClick={onOpenCreateGroup}
            >
              <Plus size={18} strokeWidth={2.4} aria-hidden="true" />
            </button>
          </div>
        </div>
        {groups.length ? (
          <ul
            className={dragPreview ? "transaction-watchlist-group-list is-dragging" : "transaction-watchlist-group-list"}
            aria-label="관심 그룹 목록"
            onPointerMove={handleGroupPointerMove}
            onPointerUp={handleGroupPointerEnd}
            onPointerCancel={handleGroupDragEnd}
            onMouseMove={handleGroupPointerMove}
            onMouseUp={handleGroupPointerEnd}
          >
            {groups.map((group) => {
              const groupId = cleanTransactionWatchlistGroupId(group.id);
              const isSelected = groupId === selectedGroupId;
              const isRenaming = !orderEditing && groupId === renameGroupId && renamePlacement === "sidebar";
              const itemClassName = [
                "transaction-watchlist-group-item",
                isSelected ? "is-selected" : "",
                isRenaming ? "is-renaming" : "",
                orderEditing ? "is-manual-sort" : "",
                dragOverGroupId === groupId && draggedGroupId && draggedGroupId !== groupId
                  ? `is-drop-${dragInsertPlacement}`
                  : "",
                draggedGroupId === groupId ? "is-dragging" : "",
              ].filter(Boolean).join(" ");
              return (
              <li
                className={itemClassName}
                key={group.id}
                data-transaction-watchlist-group-id={groupId}
              >
                {orderEditing ? (
                  <button
                    className="transaction-watchlist-drag-handle"
                    type="button"
                    title="클릭해서 드래그하면 순서를 바꿀 수 있습니다"
                    aria-label={`${group.name} 순서 드래그`}
                    onPointerDown={(event) => handleGroupPointerStart(event, group)}
                    onMouseDown={(event) => handleGroupPointerStart(event, group)}
                  >
                    <GripVertical size={16} strokeWidth={2.2} />
                  </button>
                ) : null}
                {orderEditing ? (
                  <span className="transaction-watchlist-group-label">
                    <FolderClosed size={15} strokeWidth={2.2} aria-hidden="true" />
                    <span>{group.name}</span>
                  </span>
                ) : isRenaming ? (
                  <form
                    className="transaction-watchlist-rename-form"
                    aria-label={`${group.name} 관심 그룹 이름 변경`}
                    onSubmit={(event) => {
                      event.preventDefault();
                      onSubmitRenameGroup();
                    }}
                  >
                    <FolderClosed size={15} strokeWidth={2.2} aria-hidden="true" />
                    <input
                      className="transaction-watchlist-rename-input"
                      type="text"
                      value={renameDraft}
                      maxLength={80}
                      autoFocus
                      onFocus={(event) => event.currentTarget.select()}
                      onChange={(event) => onRenameDraftChange(event.target.value)}
                      onBlur={(event) => {
                        if (!cleanTransactionWatchlistGroupName(event.currentTarget.value)) {
                          onCancelRenameGroup();
                          return;
                        }
                        onSubmitRenameGroup();
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Escape") {
                          event.preventDefault();
                          onCancelRenameGroup();
                        }
                      }}
                    />
                    {renameError ? <span className="transaction-watchlist-rename-error" role="alert">{renameError}</span> : null}
                  </form>
                ) : (
                  <button
                    className="transaction-watchlist-group-select"
                    type="button"
                    aria-pressed={isSelected}
                    onClick={() => (
                      isSelected ? onRequestRenameGroup(groupId, "sidebar") : onSelectGroup(groupId)
                    )}
                  >
                    <FolderClosed size={15} strokeWidth={2.2} aria-hidden="true" />
                    <span>{group.name}</span>
                  </button>
                )}
                {!orderEditing && !isRenaming ? (
                  <button
                    className="transaction-watchlist-delete-button"
                    type="button"
                    aria-label={`${group.name} 관심 그룹 삭제`}
                    title={`${group.name} 관심 그룹 삭제`}
                    onClick={() => onRequestDeleteGroup(group)}
                  >
                    <Trash2 size={14} strokeWidth={2.2} aria-hidden="true" />
                  </button>
                ) : null}
              </li>
              );
            })}
          </ul>
        ) : null}
      </div>
      <div className="transaction-watchlist-main" aria-label="관심 본문">
        <WatchlistMain
          selectedGroup={selectedGroup}
          items={items}
          symbolOptions={symbolOptions}
          priceMap={priceMap}
          payload={payload}
          loading={loading}
          error={error}
          statusBannerProps={statusBannerProps}
          renameActive={!orderEditing && selectedGroup?.id === renameGroupId && renamePlacement === "main"}
          renameDraft={renameDraft}
          renameError={renameError}
          onRequestRenameGroup={onRequestRenameGroup}
          onRenameDraftChange={onRenameDraftChange}
          onSubmitRenameGroup={onSubmitRenameGroup}
          onCancelRenameGroup={onCancelRenameGroup}
          symbolOrderEditing={symbolOrderEditing}
          onSymbolOrderEditStart={onSymbolOrderEditStart}
          onSymbolOrderChange={onSymbolOrderChange}
          onSymbolOrderSave={onSymbolOrderSave}
          onOpenAddSymbol={onOpenAddSymbol}
          onRemoveSymbol={onRemoveSymbol}
        />
      </div>
      {dragPreview ? (
        <div
          className="transaction-watchlist-drag-preview"
          style={{ "--transaction-drag-x": `${dragPreview.x}px`, "--transaction-drag-y": `${dragPreview.y}px` }}
          aria-hidden="true"
        >
          <span className="transaction-watchlist-group-label">
            <FolderClosed size={15} strokeWidth={2.2} />
            <span>{dragPreview.name}</span>
          </span>
        </div>
      ) : null}
    </section>
  );
}

export default function TransactionStatusView({
  tossStatus,
  tossBusy = false,
  tossError = "",
  tossErrorCode = "",
  tossPublicIp = null,
  tossPublicIpBusy = false,
  tossPublicIpError = "",
  onOpenSettings,
  onDeleteCredentials,
  onCheckPublicIp,
  onReload,
}) {
  const [activeSection, setActiveSection] = useState("investment");
  const [sortId, setSortId] = useState("valueAsc");
  const [sortOpen, setSortOpen] = useState(false);
  const [manualOrderEditing, setManualOrderEditing] = useState(false);
  const [manualOrderDraft, setManualOrderDraft] = useState([]);
  const [accountOpen, setAccountOpen] = useState(false);
  const [selectedAccountSeq, setSelectedAccountSeq] = useState("");
  const [valueMode, setValueMode] = useState("value");
  const [currency] = useState("KRW");
  const [sidebarUnit, setSidebarUnit] = useState(() => normalizeMoneyUnit("KRW"));
  const [mainUnit, setMainUnit] = useState(() => normalizeMoneyUnit("KRW"));
  const [currencySettings, setCurrencySettings] = useState(defaultTransactionCurrencySettings);
  const [currencySettingsError, setCurrencySettingsError] = useState("");
  const [watchlistCreateOpen, setWatchlistCreateOpen] = useState(false);
  const [watchlistGroupNameDraft, setWatchlistGroupNameDraft] = useState("");
  const [watchlistGroupNameError, setWatchlistGroupNameError] = useState("");
  const [watchlistDeleteTarget, setWatchlistDeleteTarget] = useState(null);
  const [watchlistOrderEditing, setWatchlistOrderEditing] = useState(false);
  const [watchlistOrderDraft, setWatchlistOrderDraft] = useState([]);
  const [selectedWatchlistGroupId, setSelectedWatchlistGroupId] = useState("");
  const [watchlistRenameGroupId, setWatchlistRenameGroupId] = useState("");
  const [watchlistRenamePlacement, setWatchlistRenamePlacement] = useState("sidebar");
  const [watchlistRenameDraft, setWatchlistRenameDraft] = useState("");
  const [watchlistRenameError, setWatchlistRenameError] = useState("");
  const [watchlistSymbolOrderEditing, setWatchlistSymbolOrderEditing] = useState(false);
  const [watchlistSymbolOrderDraft, setWatchlistSymbolOrderDraft] = useState([]);
  const [watchlistSymbolAddOpen, setWatchlistSymbolAddOpen] = useState(false);
  const [watchlistSymbolDraft, setWatchlistSymbolDraft] = useState("");
  const [watchlistSymbolError, setWatchlistSymbolError] = useState("");
  const [watchlistSavedSymbolOptions, setWatchlistSavedSymbolOptions] = useState([]);
  const [watchlistRemoteSymbolOptions, setWatchlistRemoteSymbolOptions] = useState([]);
  const [usdKrwRate, setUsdKrwRate] = useState(0);
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [liveErrorCode, setLiveErrorCode] = useState("");
  const [liveRetryAfterMs, setLiveRetryAfterMs] = useState(0);
  const [watchlistPricePayload, setWatchlistPricePayload] = useState(null);
  const [watchlistPriceMap, setWatchlistPriceMap] = useState(() => new Map());
  const [watchlistPriceLoading, setWatchlistPriceLoading] = useState(false);
  const [watchlistPriceError, setWatchlistPriceError] = useState("");
  const [watchlistPriceErrorCode, setWatchlistPriceErrorCode] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [refreshSettledKey, setRefreshSettledKey] = useState(0);
  const [liveRefreshBusy, setLiveRefreshBusy] = useState(false);
  const [pageVisible, setPageVisible] = useState(() => transactionPageIsVisible());
  const rootRef = useRef(null);
  const forceNextRefreshRef = useRef(false);
  const liveRefreshBusyRef = useRef(false);
  const payloadRef = useRef(null);
  const initialLoadRef = useRef(true);
  const wasPageHiddenRef = useRef(!transactionPageIsVisible());
  const liveFetchGate = useMemo(() => transactionLiveFetchGate(tossStatus), [tossStatus]);
  const unit = payload?.unit || currency;
  const normalizedItems = useMemo(
    () => (Array.isArray(payload?.items) ? payload.items.map((item) => normalizeItem(item, unit)) : []),
    [payload?.items, unit]
  );
  const watchlistHoldingSymbolOptions = useMemo(
    () => transactionWatchlistSymbolOptions(normalizedItems),
    [normalizedItems]
  );
  const watchlistSymbolOptions = useMemo(
    () => mergeTransactionWatchlistSymbolOptions(
      watchlistHoldingSymbolOptions,
      watchlistSavedSymbolOptions,
      watchlistRemoteSymbolOptions
    ),
    [watchlistHoldingSymbolOptions, watchlistRemoteSymbolOptions, watchlistSavedSymbolOptions]
  );
  const activeWatchlistGroups = watchlistOrderEditing ? watchlistOrderDraft : currencySettings.watchlistGroups;
  const normalizedWatchlistGroups = useMemo(
    () => normalizeTransactionWatchlistGroupsSetting(activeWatchlistGroups, []),
    [activeWatchlistGroups]
  );
  const selectedWatchlistGroup = useMemo(() => {
    if (!normalizedWatchlistGroups.length) return null;
    return normalizedWatchlistGroups.find((group) => group.id === selectedWatchlistGroupId) || normalizedWatchlistGroups[0];
  }, [normalizedWatchlistGroups, selectedWatchlistGroupId]);
  const selectedWatchlistDisplayGroup = useMemo(() => {
    if (!selectedWatchlistGroup) return null;
    if (!watchlistSymbolOrderEditing) return selectedWatchlistGroup;
    return {
      ...selectedWatchlistGroup,
      symbols: normalizeTransactionWatchlistSymbolsSetting(watchlistSymbolOrderDraft),
    };
  }, [selectedWatchlistGroup, watchlistSymbolOrderDraft, watchlistSymbolOrderEditing]);
  const selectedWatchlistSymbolKey = useMemo(
    () => normalizeTransactionWatchlistSymbolsSetting(selectedWatchlistGroup?.symbols || []).join(","),
    [selectedWatchlistGroup]
  );

  useEffect(() => {
    payloadRef.current = payload;
  }, [payload]);

  useEffect(() => {
    if (activeSection !== "watchlist") return;
    if (!normalizedWatchlistGroups.length) {
      if (selectedWatchlistGroupId) setSelectedWatchlistGroupId("");
      return;
    }
    if (!normalizedWatchlistGroups.some((group) => group.id === selectedWatchlistGroupId)) {
      setSelectedWatchlistGroupId(normalizedWatchlistGroups[0].id);
    }
  }, [activeSection, normalizedWatchlistGroups, selectedWatchlistGroupId]);

  useEffect(() => {
    if (!selectedWatchlistSymbolKey) {
      setWatchlistSavedSymbolOptions([]);
      return undefined;
    }
    const controller = new AbortController();
    async function loadSavedWatchlistSymbols() {
      try {
        const response = await fetch(`/api/tossinvest/stocks?symbols=${encodeURIComponent(selectedWatchlistSymbolKey)}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const body = await response.json().catch(() => ({}));
        if (!response.ok || body?.ok === false) return;
        const options = transactionWatchlistStockOptionsFromPayload(body);
        if (!controller.signal.aborted) {
          setWatchlistSavedSymbolOptions(options);
        }
      } catch (fetchError) {
        if (!controller.signal.aborted && fetchError.name !== "AbortError") {
          setWatchlistSavedSymbolOptions([]);
        }
      }
    }
    void loadSavedWatchlistSymbols();
    return () => controller.abort();
  }, [selectedWatchlistSymbolKey]);

  useEffect(() => {
    if (activeSection !== "watchlist") return undefined;
    const symbols = normalizeTransactionWatchlistSymbolsSetting(selectedWatchlistGroup?.symbols || []);
    if (!symbols.length) {
      setWatchlistPricePayload(null);
      setWatchlistPriceMap(new Map());
      setWatchlistPriceLoading(false);
      setWatchlistPriceError("");
      setWatchlistPriceErrorCode("");
      return undefined;
    }
    if (!liveFetchGate.ready) {
      setWatchlistPricePayload(null);
      setWatchlistPriceMap(new Map());
      setWatchlistPriceLoading(Boolean(liveFetchGate.waiting));
      setWatchlistPriceError(liveFetchGate.waiting ? "" : liveFetchGate.message);
      setWatchlistPriceErrorCode("");
      return undefined;
    }

    const controller = new AbortController();
    async function loadWatchlistPrices() {
      setWatchlistPriceLoading(true);
      setWatchlistPriceError("");
      setWatchlistPriceErrorCode("");
      try {
        const nextPayload = await fetchTransactionWatchlistPrices(symbols, controller.signal);
        if (controller.signal.aborted) return;
        setWatchlistPricePayload(nextPayload);
        setWatchlistPriceMap(nextPayload.priceMap || new Map());
      } catch (fetchError) {
        if (fetchError.name !== "AbortError") {
          setWatchlistPriceError(fetchError.message || "관심 종목 가격을 불러오지 못했습니다.");
          setWatchlistPriceErrorCode(fetchError.errorCode || "");
        }
      } finally {
        if (!controller.signal.aborted) {
          setWatchlistPriceLoading(false);
        }
      }
    }

    void loadWatchlistPrices();
    return () => controller.abort();
  }, [
    activeSection,
    liveFetchGate.message,
    liveFetchGate.ready,
    liveFetchGate.waiting,
    refreshKey,
    selectedWatchlistGroup,
    selectedWatchlistSymbolKey,
  ]);

  useEffect(() => {
    const controller = new AbortController();

    async function loadTransactionCurrencySettings() {
      try {
        const response = await fetch("/api/transactions/settings", {
          cache: "no-store",
          signal: controller.signal,
        });
        const body = await response.json().catch(() => ({}));
        if (!response.ok || body?.ok === false) {
          throw new Error(body?.error || `HTTP ${response.status}`);
        }
        if (!controller.signal.aborted) {
          setCurrencySettings(transactionCurrencySettingsFromPayload(body));
          setCurrencySettingsError("");
        }
      } catch (fetchError) {
        if (fetchError.name !== "AbortError") {
          setCurrencySettingsError(fetchError.message || "거래현황 통화 설정을 불러오지 못했습니다.");
        }
      }
    }

    void loadTransactionCurrencySettings();
    return () => controller.abort();
  }, []);

  const saveTransactionCurrencySettings = useCallback(async (patch) => {
    try {
      const response = await fetch("/api/transactions/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify(patch || {}),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || body?.ok === false) {
        throw new Error(body?.error || `HTTP ${response.status}`);
      }
      const nextSettings = transactionCurrencySettingsFromPayload(body);
      setCurrencySettings(nextSettings);
      setCurrencySettingsError("");
      return nextSettings;
    } catch (fetchError) {
      setCurrencySettingsError(fetchError.message || "거래현황 설정을 저장하지 못했습니다.");
      return null;
    }
  }, []);

  const handleSidebarUnitChange = useCallback((nextUnit) => {
    const normalizedUnit = normalizeMoneyUnit(nextUnit);
    setSidebarUnit(normalizedUnit);
    setCurrencySettings((current) => ({
      ...current,
      sidebarDisplayCurrency: normalizedUnit,
    }));
    void saveTransactionCurrencySettings({ sidebarDisplayCurrency: normalizedUnit });
  }, [saveTransactionCurrencySettings]);

  const handleMainUnitChange = useCallback((nextUnit) => {
    const normalizedUnit = normalizeMoneyUnit(nextUnit);
    setMainUnit(normalizedUnit);
    setCurrencySettings((current) => ({
      ...current,
      mainDisplayCurrency: normalizedUnit,
    }));
    void saveTransactionCurrencySettings({ mainDisplayCurrency: normalizedUnit });
  }, [saveTransactionCurrencySettings]);

  const handleMainTableColumnsChange = useCallback((nextColumnIds) => {
    const normalizedColumnIds = normalizeTransactionMainTableColumnsSetting(nextColumnIds, []);
    setCurrencySettings((current) => ({
      ...current,
      mainTableColumns: normalizedColumnIds,
    }));
    void saveTransactionCurrencySettings({ mainTableColumns: normalizedColumnIds });
  }, [saveTransactionCurrencySettings]);

  const handleCancelWatchlistGroupRename = useCallback(() => {
    setWatchlistRenameGroupId("");
    setWatchlistRenamePlacement("sidebar");
    setWatchlistRenameDraft("");
    setWatchlistRenameError("");
  }, []);

  const handleCancelWatchlistSymbolOrder = useCallback(() => {
    setWatchlistSymbolOrderEditing(false);
    setWatchlistSymbolOrderDraft([]);
  }, []);

  const handleOpenWatchlistCreate = useCallback(() => {
    handleCancelWatchlistGroupRename();
    handleCancelWatchlistSymbolOrder();
    setWatchlistGroupNameDraft("");
    setWatchlistGroupNameError("");
    setWatchlistCreateOpen(true);
  }, [handleCancelWatchlistGroupRename, handleCancelWatchlistSymbolOrder]);

  const handleCancelWatchlistCreate = useCallback(() => {
    setWatchlistCreateOpen(false);
    setWatchlistGroupNameDraft("");
    setWatchlistGroupNameError("");
  }, []);

  const handleWatchlistGroupDraftChange = useCallback((nextValue) => {
    setWatchlistGroupNameDraft(nextValue);
    if (watchlistGroupNameError) setWatchlistGroupNameError("");
  }, [watchlistGroupNameError]);

  const handleWatchlistRenameDraftChange = useCallback((nextValue) => {
    setWatchlistRenameDraft(nextValue);
    if (watchlistRenameError) setWatchlistRenameError("");
  }, [watchlistRenameError]);

  const handleRequestWatchlistGroupRename = useCallback((groupId, placement = "sidebar") => {
    if (watchlistOrderEditing) return;
    const nextGroupId = cleanTransactionWatchlistGroupId(groupId);
    if (!nextGroupId) return;
    const currentGroups = normalizeTransactionWatchlistGroupsSetting(activeWatchlistGroups, []);
    const targetGroup = currentGroups.find((group) => group.id === nextGroupId);
    if (!targetGroup) return;
    handleCancelWatchlistSymbolOrder();
    setSelectedWatchlistGroupId(nextGroupId);
    setWatchlistRenameGroupId(nextGroupId);
    setWatchlistRenamePlacement(placement === "main" ? "main" : "sidebar");
    setWatchlistRenameDraft(targetGroup.name);
    setWatchlistRenameError("");
  }, [activeWatchlistGroups, handleCancelWatchlistSymbolOrder, watchlistOrderEditing]);

  const handleSubmitWatchlistGroupRename = useCallback(() => {
    const groupId = cleanTransactionWatchlistGroupId(watchlistRenameGroupId);
    if (!groupId) return;
    const groupName = cleanTransactionWatchlistGroupName(watchlistRenameDraft);
    if (!groupName) {
      setWatchlistRenameError("관심 그룹 이름을 입력하세요.");
      return;
    }
    const currentGroups = normalizeTransactionWatchlistGroupsSetting(activeWatchlistGroups, []);
    const targetGroup = currentGroups.find((group) => group.id === groupId);
    if (!targetGroup) {
      handleCancelWatchlistGroupRename();
      return;
    }
    if (targetGroup.name === groupName) {
      handleCancelWatchlistGroupRename();
      return;
    }
    const nextGroups = currentGroups.map((group) => (
      group.id === groupId ? { ...group, name: groupName } : group
    ));
    setCurrencySettings((current) => ({
      ...current,
      watchlistGroups: nextGroups,
    }));
    if (watchlistOrderEditing) {
      setWatchlistOrderDraft(nextGroups);
    }
    handleCancelWatchlistGroupRename();
    void saveTransactionCurrencySettings({ watchlistGroups: nextGroups });
  }, [
    activeWatchlistGroups,
    handleCancelWatchlistGroupRename,
    saveTransactionCurrencySettings,
    watchlistOrderEditing,
    watchlistRenameDraft,
    watchlistRenameGroupId,
  ]);

  const handleCreateWatchlistGroup = useCallback(() => {
    const groupName = cleanTransactionWatchlistGroupName(watchlistGroupNameDraft);
    if (!groupName) {
      setWatchlistGroupNameError("관심 그룹 이름을 입력하세요.");
      return;
    }
    const currentGroups = normalizeTransactionWatchlistGroupsSetting(activeWatchlistGroups, []);
    const nextGroup = {
      id: createTransactionWatchlistGroupId(),
      name: groupName,
      createdAt: new Date().toISOString(),
      symbols: [],
    };
    const nextGroups = [...currentGroups, nextGroup];
    setCurrencySettings((current) => ({
      ...current,
      watchlistGroups: nextGroups,
    }));
    if (watchlistOrderEditing) {
      setWatchlistOrderDraft(nextGroups);
    }
    setSelectedWatchlistGroupId(nextGroup.id);
    setWatchlistCreateOpen(false);
    setWatchlistGroupNameDraft("");
    setWatchlistGroupNameError("");
    handleCancelWatchlistGroupRename();
    handleCancelWatchlistSymbolOrder();
    void saveTransactionCurrencySettings({ watchlistGroups: nextGroups });
  }, [
    activeWatchlistGroups,
    handleCancelWatchlistGroupRename,
    handleCancelWatchlistSymbolOrder,
    saveTransactionCurrencySettings,
    watchlistGroupNameDraft,
    watchlistOrderEditing,
  ]);

  const handleRequestDeleteWatchlistGroup = useCallback((group) => {
    setWatchlistDeleteTarget(group);
  }, []);

  const handleCancelDeleteWatchlistGroup = useCallback(() => {
    setWatchlistDeleteTarget(null);
  }, []);

  const handleConfirmDeleteWatchlistGroup = useCallback(() => {
    if (!watchlistDeleteTarget?.id) return;
    const currentGroups = normalizeTransactionWatchlistGroupsSetting(activeWatchlistGroups, []);
    const nextGroups = currentGroups.filter((group) => group.id !== watchlistDeleteTarget.id);
    setCurrencySettings((current) => ({
      ...current,
      watchlistGroups: nextGroups,
    }));
    if (watchlistOrderEditing) {
      setWatchlistOrderDraft(nextGroups);
    }
    if (selectedWatchlistGroupId === watchlistDeleteTarget.id) {
      setSelectedWatchlistGroupId(nextGroups[0]?.id || "");
    }
    handleCancelWatchlistGroupRename();
    handleCancelWatchlistSymbolOrder();
    setWatchlistDeleteTarget(null);
    void saveTransactionCurrencySettings({ watchlistGroups: nextGroups });
  }, [
    activeWatchlistGroups,
    handleCancelWatchlistGroupRename,
    handleCancelWatchlistSymbolOrder,
    saveTransactionCurrencySettings,
    selectedWatchlistGroupId,
    watchlistDeleteTarget,
    watchlistOrderEditing,
  ]);

  const handleSelectWatchlistGroup = useCallback((groupId) => {
    const nextGroupId = cleanTransactionWatchlistGroupId(groupId);
    if (!nextGroupId) return;
    setSelectedWatchlistGroupId(nextGroupId);
    if (watchlistRenameGroupId && nextGroupId !== watchlistRenameGroupId) {
      handleCancelWatchlistGroupRename();
    }
    handleCancelWatchlistSymbolOrder();
  }, [
    handleCancelWatchlistGroupRename,
    handleCancelWatchlistSymbolOrder,
    watchlistRenameGroupId,
  ]);

  const handleOpenWatchlistSymbolAdd = useCallback(() => {
    if (watchlistSymbolOrderEditing) return;
    if (!selectedWatchlistGroup) return;
    setWatchlistSymbolDraft("");
    setWatchlistSymbolError("");
    setWatchlistRemoteSymbolOptions([]);
    setWatchlistSymbolAddOpen(true);
  }, [selectedWatchlistGroup, watchlistSymbolOrderEditing]);

  const handleCancelWatchlistSymbolAdd = useCallback(() => {
    setWatchlistSymbolAddOpen(false);
    setWatchlistSymbolDraft("");
    setWatchlistSymbolError("");
    setWatchlistRemoteSymbolOptions([]);
  }, []);

  const handleWatchlistSymbolDraftChange = useCallback((nextValue) => {
    setWatchlistSymbolDraft(nextValue);
    if (watchlistSymbolError) setWatchlistSymbolError("");
  }, [watchlistSymbolError]);

  const handleAddWatchlistSymbol = useCallback(async () => {
    if (!selectedWatchlistGroup?.id) return;
    const symbol = cleanTransactionWatchlistSymbol(watchlistSymbolDraft);
    const rawInput = String(watchlistSymbolDraft || "").trim();
    if (!rawInput) {
      setWatchlistSymbolError("티커 / 종목번호 / 종목명을 입력하세요.");
      return;
    }
    let nextSymbolOptions = watchlistSymbolOptions;
    let matchedSymbol = resolveTransactionWatchlistSymbolInput(watchlistSymbolDraft, nextSymbolOptions);
    if (!matchedSymbol) {
      try {
        const catalogOptions = await fetchTransactionWatchlistCatalogOptions(watchlistSymbolDraft);
        nextSymbolOptions = mergeTransactionWatchlistSymbolOptions(nextSymbolOptions, catalogOptions);
        if (catalogOptions.length) {
          setWatchlistRemoteSymbolOptions((current) => (
            mergeTransactionWatchlistSymbolOptions(current, catalogOptions)
          ));
        }
        matchedSymbol = resolveTransactionWatchlistSymbolInput(watchlistSymbolDraft, nextSymbolOptions);
      } catch {
        // The validation message below is enough for a failed fallback lookup.
      }
    }
    if (!matchedSymbol && symbol && /^[A-Z0-9.-]+$/.test(symbol)) {
      matchedSymbol = symbol;
    }
    if (!matchedSymbol) {
      setWatchlistSymbolError("KRX/NYSE 목록이나 Toss 종목 조회에서 확인할 수 없는 티커 / 종목번호 / 종목명입니다.");
      return;
    }
    try {
      const response = await fetch(`/api/tossinvest/stocks?symbols=${encodeURIComponent(matchedSymbol)}`, {
        cache: "no-store",
      });
      const body = await response.json().catch(() => ({}));
      const options = response.ok && body?.ok !== false ? transactionWatchlistStockOptionsFromPayload(body) : [];
      if (!options.some((option) => cleanTransactionWatchlistSymbol(option.symbol) === matchedSymbol)) {
        setWatchlistSymbolError("Toss에서 조회할 수 없는 종목입니다.");
        return;
      }
      setWatchlistRemoteSymbolOptions((current) => (
        mergeTransactionWatchlistSymbolOptions(current, options)
      ));
    } catch {
      setWatchlistSymbolError("Toss 종목 확인에 실패했습니다.");
      return;
    }
    const currentGroups = normalizeTransactionWatchlistGroupsSetting(activeWatchlistGroups, []);
    const currentGroup = currentGroups.find((group) => group.id === selectedWatchlistGroup.id);
    if (!currentGroup) {
      setWatchlistSymbolError("선택된 관심 그룹을 찾지 못했습니다.");
      return;
    }
    const currentSymbols = normalizeTransactionWatchlistSymbolsSetting(currentGroup.symbols);
    if (currentSymbols.includes(matchedSymbol)) {
      setWatchlistSymbolError("이미 추가된 종목입니다.");
      return;
    }
    const nextGroups = currentGroups.map((group) => (
      group.id === selectedWatchlistGroup.id
        ? { ...group, symbols: [...currentSymbols, matchedSymbol] }
        : group
    ));
    setCurrencySettings((current) => ({
      ...current,
      watchlistGroups: nextGroups,
    }));
    if (watchlistOrderEditing) {
      setWatchlistOrderDraft(nextGroups);
    }
    setWatchlistSymbolAddOpen(false);
    setWatchlistSymbolDraft("");
    setWatchlistSymbolError("");
    void saveTransactionCurrencySettings({ watchlistGroups: nextGroups });
  }, [
    activeWatchlistGroups,
    saveTransactionCurrencySettings,
    selectedWatchlistGroup,
    watchlistOrderEditing,
    watchlistSymbolOptions,
    watchlistSymbolDraft,
  ]);

  const handleRemoveWatchlistSymbol = useCallback((symbolValue) => {
    if (!selectedWatchlistGroup?.id) return;
    const symbol = cleanTransactionWatchlistSymbol(symbolValue);
    if (!symbol) return;
    const currentGroups = normalizeTransactionWatchlistGroupsSetting(activeWatchlistGroups, []);
    const nextGroups = currentGroups.map((group) => {
      if (group.id !== selectedWatchlistGroup.id) return group;
      return {
        ...group,
        symbols: normalizeTransactionWatchlistSymbolsSetting(group.symbols).filter((item) => item !== symbol),
      };
    });
    setCurrencySettings((current) => ({
      ...current,
      watchlistGroups: nextGroups,
    }));
    if (watchlistOrderEditing) {
      setWatchlistOrderDraft(nextGroups);
    }
    void saveTransactionCurrencySettings({ watchlistGroups: nextGroups });
  }, [
    activeWatchlistGroups,
    saveTransactionCurrencySettings,
    selectedWatchlistGroup,
    watchlistOrderEditing,
  ]);

  const handleWatchlistOrderEditStart = useCallback(() => {
    handleCancelWatchlistGroupRename();
    handleCancelWatchlistSymbolOrder();
    setWatchlistOrderDraft(normalizeTransactionWatchlistGroupsSetting(currencySettings.watchlistGroups, []));
    setWatchlistOrderEditing(true);
  }, [
    currencySettings.watchlistGroups,
    handleCancelWatchlistGroupRename,
    handleCancelWatchlistSymbolOrder,
  ]);

  const handleWatchlistOrderChange = useCallback((nextGroups) => {
    setWatchlistOrderDraft(normalizeTransactionWatchlistGroupsSetting(nextGroups, []));
  }, []);

  const handleWatchlistOrderSave = useCallback(() => {
    const nextGroups = normalizeTransactionWatchlistGroupsSetting(watchlistOrderDraft, []);
    setCurrencySettings((current) => ({
      ...current,
      watchlistGroups: nextGroups,
    }));
    setWatchlistOrderEditing(false);
    void saveTransactionCurrencySettings({ watchlistGroups: nextGroups });
  }, [saveTransactionCurrencySettings, watchlistOrderDraft]);

  const handleWatchlistSymbolOrderEditStart = useCallback(() => {
    if (!selectedWatchlistGroup?.id) return;
    const symbols = normalizeTransactionWatchlistSymbolsSetting(selectedWatchlistGroup.symbols);
    if (symbols.length < 2) return;
    handleCancelWatchlistGroupRename();
    setWatchlistSymbolOrderDraft(symbols);
    setWatchlistSymbolOrderEditing(true);
  }, [handleCancelWatchlistGroupRename, selectedWatchlistGroup]);

  const handleWatchlistSymbolOrderChange = useCallback((nextSymbols) => {
    setWatchlistSymbolOrderDraft(normalizeTransactionWatchlistSymbolsSetting(nextSymbols));
  }, []);

  const handleWatchlistSymbolOrderSave = useCallback(() => {
    if (!selectedWatchlistGroup?.id) {
      handleCancelWatchlistSymbolOrder();
      return;
    }
    const nextSymbols = normalizeTransactionWatchlistSymbolsSetting(watchlistSymbolOrderDraft);
    const currentGroups = normalizeTransactionWatchlistGroupsSetting(activeWatchlistGroups, []);
    const currentGroup = currentGroups.find((group) => group.id === selectedWatchlistGroup.id);
    if (!currentGroup) {
      handleCancelWatchlistSymbolOrder();
      return;
    }
    const nextGroups = currentGroups.map((group) => (
      group.id === selectedWatchlistGroup.id ? { ...group, symbols: nextSymbols } : group
    ));
    setCurrencySettings((current) => ({
      ...current,
      watchlistGroups: nextGroups,
    }));
    if (watchlistOrderEditing) {
      setWatchlistOrderDraft(nextGroups);
    }
    handleCancelWatchlistSymbolOrder();
    void saveTransactionCurrencySettings({ watchlistGroups: nextGroups });
  }, [
    activeWatchlistGroups,
    handleCancelWatchlistSymbolOrder,
    saveTransactionCurrencySettings,
    selectedWatchlistGroup,
    watchlistOrderEditing,
    watchlistSymbolOrderDraft,
  ]);

  useEffect(() => {
    if (!watchlistRenameGroupId) return;
    if (normalizedWatchlistGroups.some((group) => group.id === watchlistRenameGroupId)) return;
    handleCancelWatchlistGroupRename();
  }, [
    handleCancelWatchlistGroupRename,
    normalizedWatchlistGroups,
    watchlistRenameGroupId,
  ]);

  useEffect(() => {
    if (!watchlistSymbolOrderEditing) return;
    if (selectedWatchlistGroup?.id) return;
    handleCancelWatchlistSymbolOrder();
  }, [
    handleCancelWatchlistSymbolOrder,
    selectedWatchlistGroup?.id,
    watchlistSymbolOrderEditing,
  ]);

  useEffect(() => {
    if (!watchlistCreateOpen && !watchlistDeleteTarget && !watchlistSymbolAddOpen) return undefined;
    function handleDialogKeyDown(event) {
      if (event.key !== "Escape") return;
      if (watchlistCreateOpen) handleCancelWatchlistCreate();
      if (watchlistDeleteTarget) handleCancelDeleteWatchlistGroup();
      if (watchlistSymbolAddOpen) handleCancelWatchlistSymbolAdd();
    }
    document.addEventListener("keydown", handleDialogKeyDown);
    return () => document.removeEventListener("keydown", handleDialogKeyDown);
  }, [
    handleCancelDeleteWatchlistGroup,
    handleCancelWatchlistCreate,
    handleCancelWatchlistSymbolAdd,
    watchlistCreateOpen,
    watchlistDeleteTarget,
    watchlistSymbolAddOpen,
  ]);

  useEffect(() => {
    if (!watchlistSymbolAddOpen) return undefined;
    const query = String(watchlistSymbolDraft || "").trim();
    const symbol = cleanTransactionWatchlistSymbol(watchlistSymbolDraft);
    if (!query) return undefined;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const optionGroups = [await fetchTransactionWatchlistCatalogOptions(query, controller.signal)];
        if (symbol && /^[A-Z0-9.-]+$/.test(symbol)) {
          const response = await fetch(`/api/tossinvest/stocks?symbols=${encodeURIComponent(symbol)}`, {
            cache: "no-store",
            signal: controller.signal,
          });
          const body = await response.json().catch(() => ({}));
          if (response.ok && body?.ok !== false) {
            optionGroups.push(transactionWatchlistStockOptionsFromPayload(body));
          }
        }
        const options = mergeTransactionWatchlistSymbolOptions(...optionGroups);
        if (!controller.signal.aborted && options.length) {
          setWatchlistRemoteSymbolOptions((current) => (
            mergeTransactionWatchlistSymbolOptions(current, options)
          ));
        }
      } catch (fetchError) {
        if (fetchError.name !== "AbortError") {
          // Lookup failures should not block local holdings suggestions or manual retry.
        }
      }
    }, 280);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [watchlistSymbolAddOpen, watchlistSymbolDraft]);

  useEffect(() => {
    function closeMenu(event) {
      if (!sortOpen && !accountOpen) return;
      if (rootRef.current?.contains(event.target)) return;
      setSortOpen(false);
      setAccountOpen(false);
    }
    document.addEventListener("mousedown", closeMenu);
    return () => document.removeEventListener("mousedown", closeMenu);
  }, [sortOpen, accountOpen]);

  useEffect(() => {
    if (typeof document === "undefined") return undefined;
    function handleVisibilityChange() {
      const visible = transactionPageIsVisible();
      setPageVisible(visible);
      if (!visible) {
        wasPageHiddenRef.current = true;
        return;
      }
      if (
        wasPageHiddenRef.current &&
        liveFetchGate.ready &&
        (activeSection === "investment" || (activeSection === "watchlist" && selectedWatchlistSymbolKey))
      ) {
        wasPageHiddenRef.current = false;
        setRefreshKey((current) => current + 1);
      }
    }
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [activeSection, liveFetchGate.ready, selectedWatchlistSymbolKey]);

  useEffect(() => {
    if (activeSection !== "investment" || !liveFetchGate.ready) {
      setUsdKrwRate(0);
      return undefined;
    }

    const controller = new AbortController();
    async function loadUsdKrwRate() {
      try {
        const response = await fetch("/api/tossinvest/exchange-rate?baseCurrency=USD&quoteCurrency=KRW", {
          cache: "no-store",
          signal: controller.signal,
        });
        const body = await response.json().catch(() => ({}));
        if (!response.ok || body?.ok === false) {
          throw new Error(body?.error || `HTTP ${response.status}`);
        }
        if (!controller.signal.aborted) {
          setUsdKrwRate(usdKrwRateFromPayload(body));
        }
      } catch (fetchError) {
        if (fetchError.name !== "AbortError") {
          setUsdKrwRate(0);
        }
      }
    }

    void loadUsdKrwRate();
    return () => controller.abort();
  }, [activeSection, liveFetchGate.ready]);

  useEffect(() => {
    if (activeSection !== "investment") {
      forceNextRefreshRef.current = false;
      liveRefreshBusyRef.current = false;
      setLiveRefreshBusy(false);
      setLoading(false);
      return undefined;
    }
    if (!liveFetchGate.ready) {
      forceNextRefreshRef.current = false;
      liveRefreshBusyRef.current = false;
      setLiveRefreshBusy(false);
      if (liveFetchGate.waiting) {
        setLoading(true);
        setError("");
      } else {
        setPayload(null);
        setLoading(false);
        setError(liveFetchGate.message);
        setLiveErrorCode("");
        setLiveRetryAfterMs(0);
        initialLoadRef.current = false;
      }
      return undefined;
    }

    const controller = new AbortController();
    const force = forceNextRefreshRef.current;
    forceNextRefreshRef.current = false;

    async function loadInvestmentStatus() {
      liveRefreshBusyRef.current = true;
      setLiveRefreshBusy(true);
      const hasCurrentPayload = Boolean(payloadRef.current);
      if (!hasCurrentPayload && initialLoadRef.current) {
        setLoading(true);
        setError("");
        setLiveErrorCode("");
        setLiveRetryAfterMs(0);
      }
      const params = new URLSearchParams({ currency });
      if (selectedAccountSeq) params.set("accountSeq", selectedAccountSeq);
      if (force) params.set("force", "1");
      try {
        const response = await fetch(`/api/tossinvest/investment-status?${params.toString()}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const body = await response.json().catch(() => ({}));
        if (!response.ok || body?.ok === false) {
          const responseError = new Error(body?.error || `HTTP ${response.status}`);
          responseError.errorCode = body?.errorCode || "";
          responseError.retryAfterMs = retryAfterMsFromRateLimit(body?.rateLimit);
          throw responseError;
        }
        setPayload(body);
        setError("");
        setLiveErrorCode("");
        setLiveRetryAfterMs(0);
      } catch (fetchError) {
        if (fetchError.name !== "AbortError") {
          setError(fetchError.message || "거래현황을 불러오지 못했습니다.");
          setLiveErrorCode(fetchError.errorCode || "");
          setLiveRetryAfterMs(Math.max(0, Number(fetchError.retryAfterMs || 0)));
        }
      } finally {
        if (!controller.signal.aborted) {
          liveRefreshBusyRef.current = false;
          setLiveRefreshBusy(false);
          setLoading(false);
          initialLoadRef.current = false;
          setRefreshSettledKey((current) => current + 1);
        }
      }
    }

    void loadInvestmentStatus();
    return () => {
      controller.abort();
    };
  }, [activeSection, currency, liveFetchGate, refreshKey, selectedAccountSeq]);

  useEffect(() => {
    if (activeSection !== "investment") return undefined;
    if (!liveFetchGate.ready) return undefined;
    if (!pageVisible) return undefined;
    const recommendedIntervalMs = Number(payload?.refresh?.recommendedIntervalMs || 1_000);
    const intervalMs = Math.max(1_000, Math.min(300_000, Math.max(recommendedIntervalMs, liveRetryAfterMs || 0)));
    const timer = window.setTimeout(() => {
      setRefreshKey((current) => current + 1);
    }, intervalMs);
    return () => window.clearTimeout(timer);
  }, [
    activeSection,
    liveFetchGate.ready,
    pageVisible,
    liveRetryAfterMs,
    payload?.fetchedAt,
    payload?.refresh?.recommendedIntervalMs,
    refreshSettledKey,
  ]);

  useEffect(() => {
    if (activeSection !== "watchlist") return undefined;
    if (!liveFetchGate.ready) return undefined;
    if (!pageVisible) return undefined;
    if (!selectedWatchlistSymbolKey) return undefined;
    const timer = window.setTimeout(() => {
      setRefreshKey((current) => current + 1);
    }, transactionWatchlistPriceRefreshMs);
    return () => window.clearTimeout(timer);
  }, [
    activeSection,
    liveFetchGate.ready,
    pageVisible,
    selectedWatchlistSymbolKey,
    watchlistPricePayload?.fetchedAt,
  ]);

  const handleReload = useCallback(() => {
    if (liveFetchGate.ready && liveRefreshBusyRef.current) return;
    forceNextRefreshRef.current = true;
    setRefreshKey((current) => current + 1);
    if (onReload) onReload();
  }, [liveFetchGate.ready, onReload]);

  const handleAccountSelect = useCallback((accountSeq) => {
    const nextAccountSeq = cleanAccountSeq(accountSeq);
    setAccountOpen(false);
    if (!nextAccountSeq || nextAccountSeq === selectedAccountSeq) return;
    forceNextRefreshRef.current = true;
    setSelectedAccountSeq(nextAccountSeq);
  }, [selectedAccountSeq]);

  useEffect(() => {
    if (!payload?.ok) return;
    const fallbackUnit = normalizeMoneyUnit(payload.unit || currency);
    setSidebarUnit(effectiveMoneyUnitFromSetting(currencySettings.sidebarDisplayCurrency, fallbackUnit));
    setMainUnit(effectiveMoneyUnitFromSetting(currencySettings.mainDisplayCurrency, fallbackUnit));
  }, [currency, currencySettings.mainDisplayCurrency, currencySettings.sidebarDisplayCurrency, payload?.ok, payload?.unit]);

  const activeSidebarManualOrder = manualOrderEditing ? manualOrderDraft : currencySettings.sidebarManualOrder;
  const sortedItems = useMemo(
    () => sortItems(normalizedItems, sortId, activeSidebarManualOrder),
    [activeSidebarManualOrder, normalizedItems, sortId]
  );

  const handleSidebarManualOrderChange = useCallback((nextOrder) => {
    const normalizedOrder = syncTransactionSidebarManualOrder(nextOrder, normalizedItems);
    setManualOrderDraft(normalizedOrder);
  }, [normalizedItems]);

  const handleManualOrderSave = useCallback(() => {
    const normalizedOrder = syncTransactionSidebarManualOrder(manualOrderDraft, normalizedItems);
    setManualOrderDraft(normalizedOrder);
    setCurrencySettings((current) => ({
      ...current,
      sidebarManualOrder: normalizedOrder,
    }));
    setManualOrderEditing(false);
    void saveTransactionCurrencySettings({ sidebarManualOrder: normalizedOrder });
  }, [manualOrderDraft, normalizedItems, saveTransactionCurrencySettings]);

  const handleManualOrderCancel = useCallback(() => {
    setManualOrderDraft(syncTransactionSidebarManualOrder(currencySettings.sidebarManualOrder, normalizedItems));
    setManualOrderEditing(false);
  }, [currencySettings.sidebarManualOrder, normalizedItems]);

  const handleSortSelect = useCallback((nextSortId) => {
    if (nextSortId === "custom") {
      const itemKeySet = new Set(transactionItemOrderKeys(normalizedItems));
      const savedManualOrder = normalizeTransactionSidebarManualOrderSetting(currencySettings.sidebarManualOrder, []);
      const hasSavedCurrentItem = savedManualOrder.some((key) => itemKeySet.has(key));
      const nextManualOrder = hasSavedCurrentItem
        ? syncTransactionSidebarManualOrder(savedManualOrder, normalizedItems)
        : syncTransactionSidebarManualOrder(transactionItemOrderKeys(sortedItems), normalizedItems);
      setManualOrderDraft(nextManualOrder);
      setManualOrderEditing(true);
    } else {
      setManualOrderEditing(false);
    }
    setSortId(nextSortId);
  }, [currencySettings.sidebarManualOrder, normalizedItems, sortedItems]);

  useEffect(() => {
    if (sortId !== "custom" || !manualOrderEditing) return;
    const nextManualOrder = syncTransactionSidebarManualOrder(manualOrderDraft, normalizedItems);
    if (arraysEqual(nextManualOrder, manualOrderDraft)) return;
    setManualOrderDraft(nextManualOrder);
  }, [manualOrderDraft, manualOrderEditing, normalizedItems, sortId]);

  const statusForBanner = useMemo(() => {
    const credentials = tossStatus?.credentials || {};
    if (credentials.locked || credentials.invalid) return tossStatus;
    const sectionHasLivePayload = activeSection === "watchlist"
      ? Boolean(watchlistPricePayload?.ok)
      : Boolean(payload?.ok && payload?.sourceMode === "live");
    const sectionError = activeSection === "watchlist" ? watchlistPriceError : error;
    if (sectionError || !sectionHasLivePayload) return tossStatus;
    return {
      ...(tossStatus || {}),
      connected: true,
      credentials: {
        ...(tossStatus?.credentials || {}),
        configured: true,
        usable: true,
        unlocked: true,
        locked: false,
      },
      token: {
        ...(tossStatus?.token || {}),
        cached: true,
      },
    };
  }, [
    activeSection,
    error,
    payload?.ok,
    payload?.sourceMode,
    tossStatus,
    watchlistPriceError,
    watchlistPricePayload?.ok,
  ]);
  const sectionError = activeSection === "watchlist" ? watchlistPriceError : error;
  const sectionErrorCode = activeSection === "watchlist" ? watchlistPriceErrorCode : liveErrorCode;
  const statusBannerError = sectionError || currencySettingsError || tossError;
  const statusBannerErrorCode = sectionError ? sectionErrorCode : statusBannerError ? tossErrorCode : "";
  const statusBannerProps = {
    status: statusForBanner,
    busy: tossBusy,
    error: statusBannerError,
    errorCode: statusBannerErrorCode,
    publicIp: tossPublicIp,
    publicIpBusy: tossPublicIpBusy,
    publicIpError: tossPublicIpError,
    showOrderSyncSummary: false,
    autoProbeConnection: false,
    onOpenSettings,
    onDeleteCredentials,
    onProbeConnection: handleReload,
    onCheckPublicIp,
  };
  return (
    <section className="workspace-canvas transaction-status-canvas" aria-label="거래현황" ref={rootRef}>
      <div className="transaction-status-shell">
        <SectionRail activeSection={activeSection} onSelectSection={setActiveSection} />
        {activeSection === "investment" ? (
          <>
            <InvestmentSidebar
              items={sortedItems}
              payload={payload}
              unit={sidebarUnit}
              usdKrwRate={usdKrwRate}
              onUnitChange={handleSidebarUnitChange}
              sortId={sortId}
              sortOpen={sortOpen}
              onSortOpenChange={setSortOpen}
              onSortSelect={handleSortSelect}
              manualOrder={activeSidebarManualOrder}
              manualOrderEditing={manualOrderEditing}
              onManualOrderChange={handleSidebarManualOrderChange}
              onManualOrderSave={handleManualOrderSave}
              onManualOrderCancel={handleManualOrderCancel}
              accounts={payload?.accounts || []}
              accountOpen={accountOpen}
              selectedAccountSeq={selectedAccountSeq || payload?.accountSeq || ""}
              onAccountOpenChange={setAccountOpen}
              onAccountSelect={handleAccountSelect}
              valueMode={valueMode}
              onValueModeChange={setValueMode}
            />
            <InvestmentMain
              items={sortedItems}
              payload={payload}
              unit={mainUnit}
              usdKrwRate={usdKrwRate}
              onUnitChange={handleMainUnitChange}
              selectedTableColumnIds={currencySettings.mainTableColumns}
              onTableColumnsChange={handleMainTableColumnsChange}
              loading={loading}
              error={error}
              statusBannerProps={statusBannerProps}
            />
          </>
        ) : (
          <WatchlistPlaceholder
            statusBannerProps={statusBannerProps}
            watchlistGroups={activeWatchlistGroups}
            selectedGroupId={selectedWatchlistDisplayGroup?.id || ""}
            selectedGroup={selectedWatchlistDisplayGroup}
            items={sortedItems}
            symbolOptions={watchlistSymbolOptions}
            priceMap={watchlistPriceMap}
            payload={watchlistPricePayload}
            loading={watchlistPriceLoading}
            error={watchlistPriceError}
            orderEditing={watchlistOrderEditing}
            renameGroupId={watchlistRenameGroupId}
            renamePlacement={watchlistRenamePlacement}
            renameDraft={watchlistRenameDraft}
            renameError={watchlistRenameError}
            symbolOrderEditing={watchlistSymbolOrderEditing}
            onSelectGroup={handleSelectWatchlistGroup}
            onRequestRenameGroup={handleRequestWatchlistGroupRename}
            onRenameDraftChange={handleWatchlistRenameDraftChange}
            onSubmitRenameGroup={handleSubmitWatchlistGroupRename}
            onCancelRenameGroup={handleCancelWatchlistGroupRename}
            onSymbolOrderEditStart={handleWatchlistSymbolOrderEditStart}
            onSymbolOrderChange={handleWatchlistSymbolOrderChange}
            onSymbolOrderSave={handleWatchlistSymbolOrderSave}
            onOpenAddSymbol={handleOpenWatchlistSymbolAdd}
            onRemoveSymbol={handleRemoveWatchlistSymbol}
            onOpenCreateGroup={handleOpenWatchlistCreate}
            onRequestDeleteGroup={handleRequestDeleteWatchlistGroup}
            onOrderEditStart={handleWatchlistOrderEditStart}
            onOrderChange={handleWatchlistOrderChange}
            onOrderSave={handleWatchlistOrderSave}
          />
        )}
      </div>
      {watchlistCreateOpen ? (
        <WatchlistCreateDialog
          draftName={watchlistGroupNameDraft}
          error={watchlistGroupNameError}
          onDraftNameChange={handleWatchlistGroupDraftChange}
          onCancel={handleCancelWatchlistCreate}
          onSubmit={handleCreateWatchlistGroup}
        />
      ) : null}
      {watchlistSymbolAddOpen ? (
        <WatchlistSymbolDialog
          group={selectedWatchlistGroup}
          draftSymbol={watchlistSymbolDraft}
          error={watchlistSymbolError}
          symbolOptions={watchlistSymbolOptions}
          onDraftSymbolChange={handleWatchlistSymbolDraftChange}
          onCancel={handleCancelWatchlistSymbolAdd}
          onSubmit={handleAddWatchlistSymbol}
        />
      ) : null}
      {watchlistDeleteTarget ? (
        <WatchlistDeleteDialog
          group={watchlistDeleteTarget}
          onCancel={handleCancelDeleteWatchlistGroup}
          onConfirm={handleConfirmDeleteWatchlistGroup}
        />
      ) : null}
    </section>
  );
}
