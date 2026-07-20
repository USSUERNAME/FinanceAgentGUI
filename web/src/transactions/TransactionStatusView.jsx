import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import BriefcaseBusiness from "lucide-react/dist/esm/icons/briefcase-business.js";
import Check from "lucide-react/dist/esm/icons/check.js";
import ChevronDown from "lucide-react/dist/esm/icons/chevron-down.js";
import CircleHelp from "lucide-react/dist/esm/icons/circle-help.js";
import CirclePlus from "lucide-react/dist/esm/icons/circle-plus.js";
import Filter from "lucide-react/dist/esm/icons/filter.js";
import FolderClosed from "lucide-react/dist/esm/icons/folder-closed.js";
import GripVertical from "lucide-react/dist/esm/icons/grip-vertical.js";
import Heart from "lucide-react/dist/esm/icons/heart.js";
import LoaderCircle from "lucide-react/dist/esm/icons/loader-circle.js";
import PencilLine from "lucide-react/dist/esm/icons/pencil-line.js";
import Plus from "lucide-react/dist/esm/icons/plus.js";
import Save from "lucide-react/dist/esm/icons/save.js";
import Search from "lucide-react/dist/esm/icons/search.js";
import Trash2 from "lucide-react/dist/esm/icons/trash-2.js";
import X from "lucide-react/dist/esm/icons/x.js";
import {
  AreaSeries,
  BarSeries,
  BaselineSeries,
  CandlestickSeries,
  ColorType,
  HistogramSeries,
  LineSeries,
  TickMarkType,
  createChart,
} from "lightweight-charts";
import { PortfolioTossApiStatus } from "../portfolio/PortfolioWorkspaceHeader.jsx";
import { buildTransactionStatusContextPacket } from "./contextPacketBuilder.js";
import { resolveUsRegularSessionBasis } from "./watchlistReturnBasis.js";

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
  sidebarValueMode: "value",
  investmentChartMode: "area",
  investmentChartIntervalMode: "1d",
  investmentChartVolumeVisible: false,
  mainTableColumns: [],
  sidebarManualOrder: [],
  watchlistGroups: [],
};

const transactionSimulatorStorageKey = "finance-agent-gui.transaction-simulators.v1";
const transactionSimulatorInitialKrw = 10_000_000;
const transactionSimulatorInitialUsd = 0;
const transactionSimulatorMinimumBuyKrw = 10_000;
const transactionSimulatorMinimumBuyUsd = 10;
const transactionWatchlistPriceRefreshMs = 1_000;
const transactionEtfNameTranslationPollMs = 1_000;
const transactionTossUsMarkets = new Set(["NYSE", "NASDAQ", "AMEX", "US_ETC"]);
const transactionTossTranslatedFundTypes = new Set(["ETF", "FOREIGN_ETF", "ETN"]);
const transactionTossRateLimitFallbackMs = 10_000;
const transactionWatchlistCandlePageSize = 200;
const transactionInvestmentDetailCandlePageSize = 200;
const transactionInvestmentDetailCandleRefreshMs = 500;
const transactionInvestmentDetailOlderLoadThreshold = 16;
const transactionWatchlistCandleCacheTtlMs = 60_000;
const transactionWatchlistKoreanDailyBasisCacheTtlMs = 6 * 60 * 60 * 1_000;
const transactionWatchlistCandleCache = new Map();
const transactionInvestmentDetailCandleCache = new Map();
const transactionWatchlistKoreanDailyBasisCache = new Map();
const transactionWatchlistMarketCalendarCache = new Map();
const transactionInvestmentDirectionPalettes = {
  up: {
    lineColor: "#e11d48",
    fillColor: "rgba(225, 29, 72, 0.16)",
    fillBottomColor: "rgba(225, 29, 72, 0.02)",
  },
  down: {
    lineColor: "#2878ff",
    fillColor: "rgba(40, 120, 255, 0.16)",
    fillBottomColor: "rgba(40, 120, 255, 0.02)",
  },
  flat: {
    lineColor: "#111827",
    fillColor: "rgba(15, 23, 42, 0.14)",
    fillBottomColor: "rgba(100, 116, 139, 0.03)",
  },
};
const transactionInvestmentDetailChartModes = [
  { id: "area", label: "영역" },
  { id: "candles", label: "캔들" },
  { id: "line", label: "라인" },
  { id: "bars", label: "바" },
  { id: "baseline", label: "베이스라인" },
];
const transactionInvestmentMinuteIntervals = [
  { id: "1m", label: "1분" },
  { id: "3m", label: "3분" },
  { id: "5m", label: "5분" },
  { id: "10m", label: "10분" },
  { id: "15m", label: "15분" },
  { id: "30m", label: "30분" },
  { id: "60m", label: "60분" },
  { id: "120m", label: "120분" },
  { id: "240m", label: "240분" },
];
const transactionInvestmentTimeframeTabs = [
  { id: "1d", label: "일" },
  { id: "1w", label: "주" },
];
const transactionInvestmentDetailChartModeIds = new Set(transactionInvestmentDetailChartModes.map((mode) => mode.id));
const transactionInvestmentDetailIntervalIds = new Set([
  ...transactionInvestmentMinuteIntervals.map((interval) => interval.id),
  ...transactionInvestmentTimeframeTabs.map((timeframe) => timeframe.id),
]);
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
  const nextKeys = [];
  for (const item of value) {
    const raw = String(item || "").trim();
    const key = raw.includes(":") ? cleanTransactionInstrumentId(raw) : cleanTransactionWatchlistSymbol(raw);
    if (key && !nextKeys.includes(key)) {
      nextKeys.push(key);
    }
  }
  return nextKeys;
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

function normalizeTransactionInstrumentProvider(value = "toss") {
  return String(value || "").trim().toLowerCase() === "binance" ? "binance" : "toss";
}

function cleanTransactionInstrumentId(value) {
  const raw = String(value ?? "").trim().replace(/[^a-zA-Z0-9:._-]/g, "").slice(0, 128);
  const binanceMatch = /^binance:(spot|usdm):(.+)$/i.exec(raw);
  if (binanceMatch) return `binance:${binanceMatch[1].toLowerCase()}:${cleanTransactionWatchlistSymbol(binanceMatch[2])}`;
  const tossMatch = /^toss:stock:(.+)$/i.exec(raw);
  if (tossMatch) return `toss:stock:${cleanTransactionWatchlistSymbol(tossMatch[1])}`;
  return raw;
}

function normalizeTransactionInstrument(source = {}) {
  const item = source && typeof source === "object" ? source : { symbol: source };
  const symbol = cleanTransactionWatchlistSymbol(item.symbol ?? item.ticker ?? item.code);
  if (!symbol) return null;
  const requestedProvider = String(item.provider || "").trim().toLowerCase();
  const provider = requestedProvider === "binance" || /^binance:/i.test(String(item.instrumentId || ""))
    ? "binance"
    : "toss";
  const marketType = String(item.marketType || "").trim().toLowerCase() === "usdm" || /USDM|FUTURES/i.test(String(item.venue || item.market || ""))
    ? "usdm"
    : "spot";
  const instrumentId = cleanTransactionInstrumentId(item.instrumentId) || (
    provider === "binance" ? `binance:${marketType}:${symbol}` : `toss:stock:${symbol}`
  );
  const assetClass = provider === "binance"
    ? marketType === "usdm" ? "tradfi" : "crypto"
    : "stock";
  const venue = String(item.venue || item.market || (provider === "binance" ? "BINANCE_SPOT" : "")).trim();
  const displaySymbol = String(item.displaySymbol || (
    provider === "binance" && item.baseAsset && item.quoteAsset
      ? `${item.baseAsset}/${item.quoteAsset}`
      : symbol
  )).trim();
  return {
    ...item,
    instrumentId,
    provider,
    marketType: provider === "binance" ? marketType : "",
    venue,
    assetClass: String(item.assetClass || assetClass).trim().toLowerCase() || assetClass,
    symbol,
    displaySymbol,
    baseAsset: String(item.baseAsset || "").trim().toUpperCase(),
    quoteAsset: String(item.quoteAsset || "").trim().toUpperCase(),
    settlementAsset: String(item.settlementAsset || item.currency || (provider === "binance" ? "USD" : "")).trim().toUpperCase(),
    nativeQuoteAsset: String(item.nativeQuoteAsset || item.quoteAsset || "").trim().toUpperCase(),
    status: String(item.status || (provider === "binance" ? "" : "ACTIVE")).trim().toUpperCase(),
    sessionPolicy: String(item.sessionPolicy || (provider === "binance" ? "24x7" : "exchange-hours")).trim(),
    market: String(item.market || venue).trim(),
    name: String(item.name || item.label || displaySymbol || symbol).trim(),
    englishName: String(item.englishName || "").trim(),
    source: String(item.source || (provider === "binance" ? "binance-public" : "toss-stocks")).trim(),
    contractType: String(item.contractType || "").trim().toUpperCase(),
    underlyingType: String(item.underlyingType || "").trim().toUpperCase(),
    underlyingSubType: (Array.isArray(item.underlyingSubType) ? item.underlyingSubType : [])
      .map((value) => String(value || "").trim())
      .filter(Boolean),
    currency: provider === "binance" ? "USD" : normalizeMoneyUnit(item.currency || item.settlementAsset || "KRW"),
  };
}

function transactionEtfTranslationMarketCountry(item = {}) {
  const explicit = String(item.marketCountry || "").trim().toUpperCase();
  if (explicit) return explicit;
  const market = String(item.market || item.venue || "").trim().toUpperCase();
  if (/KRX|KOSPI|KOSDAQ|KONEX|KOREA|SEOUL/.test(market)) return "KR";
  if (market || normalizeMoneyUnit(item.currency || item.settlementAsset) === "USD") return "US";
  return "";
}

function transactionEtfNameTranslationSource(source = {}) {
  const item = normalizeTransactionInstrument(source);
  if (!item) return null;
  return { ...item, ...source, symbol: item.symbol, provider: item.provider };
}

function collectTransactionEtfNameTranslationSources(
  liveItems = [],
  watchlistGroups = [],
  simulatorAccounts = [],
  discoveredItems = [],
) {
  const candidates = new Map();
  const addSource = (source, { allowBinance = true } = {}) => {
    const candidate = transactionEtfNameTranslationSource(source);
    if (!candidate || (!allowBinance && candidate.provider === "binance")) return;
    const key = `${candidate.provider}:${candidate.symbol}`;
    if (!candidates.has(key)) candidates.set(key, candidate);
  };
  for (const item of Array.isArray(liveItems) ? liveItems : []) addSource(item, { allowBinance: false });
  for (const group of normalizeTransactionWatchlistGroupsSetting(watchlistGroups, [])) {
    for (const instrument of normalizeTransactionWatchlistInstrumentsSetting(group.instruments, group.symbols)) {
      addSource(instrument);
    }
  }
  for (const simulator of normalizeTransactionSimulatorAccounts(simulatorAccounts)) {
    for (const item of Array.isArray(simulator.items) ? simulator.items : []) addSource(item);
  }
  for (const item of Array.isArray(discoveredItems) ? discoveredItems : []) addSource(item);
  return [...candidates.values()];
}

async function resolveTransactionEtfNameTranslationCandidates(sources = [], signal) {
  const symbols = [...new Set(
    sources
      .filter((item) => normalizeTransactionInstrumentProvider(item?.provider) !== "binance")
      .map((item) => cleanTransactionWatchlistSymbol(item?.symbol))
      .filter(Boolean)
  )];
  const candidates = [];
  for (let index = 0; index < symbols.length; index += 200) {
    const chunk = symbols.slice(index, index + 200);
    const response = await fetch(`/api/tossinvest/stocks?symbols=${encodeURIComponent(chunk.join(","))}`, {
      cache: "no-store",
      signal,
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body?.ok === false) throw new Error(body?.error || `HTTP ${response.status}`);
    for (const item of transactionWatchlistStockOptionsFromPayload(body)) {
      const market = String(item.market || "").trim().toUpperCase();
      const securityType = String(item.securityType || "").trim().toUpperCase();
      const sourceName = String(item.englishName || "").replace(/\s+/g, " ").trim();
      if (!transactionTossUsMarkets.has(market)) continue;
      if (!transactionTossTranslatedFundTypes.has(securityType)) continue;
      if (!sourceName || sourceName.toUpperCase() === item.symbol || !/[A-Za-z]/.test(sourceName) || /[가-힣]/.test(sourceName)) continue;
      candidates.push({
        ...item,
        label: sourceName,
        name: sourceName,
        originalName: sourceName,
        englishName: sourceName,
        market,
        marketCountry: "US",
        currency: "USD",
      });
    }
  }
  const binanceSources = sources.filter(
    (item) => normalizeTransactionInstrumentProvider(item?.provider) === "binance"
  );
  for (let index = 0; index < binanceSources.length; index += 100) {
    const chunk = binanceSources.slice(index, index + 100);
    const instrumentIds = chunk
      .map((item) => cleanTransactionInstrumentId(item?.instrumentId) || `binance:spot:${cleanTransactionWatchlistSymbol(item?.symbol)}`)
      .filter(Boolean);
    if (!instrumentIds.length) continue;
    const response = await fetch(
      `/api/market-data/instruments?instrumentIds=${encodeURIComponent(instrumentIds.join(","))}`,
      { cache: "no-store", signal }
    );
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body?.ok === false) throw new Error(body?.error || `HTTP ${response.status}`);
    for (const item of transactionMarketDataInstrumentOptionsFromPayload(body)) {
      const sourceName = String(item.name || item.englishName || item.assetName || item.displaySymbol || item.symbol || "")
        .replace(/\s+/g, " ")
        .trim();
      if (!sourceName) continue;
      candidates.push({
        ...item,
        label: sourceName,
        name: sourceName,
        originalName: sourceName,
        englishName: sourceName,
        market: item.market || item.venue || "BINANCE_SPOT",
        marketCountry: "GLOBAL",
        securityType: item.contractType || (item.assetClass === "commodity" ? "COMMODITY" : "CRYPTO_ASSET"),
        currency: "USD",
      });
    }
  }
  return candidates;
}

function transactionEtfNameTranslationMap(items = []) {
  const translations = new Map();
  for (const item of Array.isArray(items) ? items : []) {
    const symbol = cleanTransactionWatchlistSymbol(item.symbol);
    const status = String(item?.etfNameTranslationStatus || "").trim();
    if (symbol && ["pending", "translating", "translated"].includes(status)) translations.set(symbol, item);
  }
  return translations;
}

function applyTransactionEtfNameTranslation(item = {}, translations = new Map()) {
  const translated = translations.get(cleanTransactionWatchlistSymbol(item.symbol));
  if (!translated) return item;
  const status = String(translated.etfNameTranslationStatus || "").trim();
  if (status !== "translated") {
    return {
      ...item,
      etfNameTranslationStatus: status,
      etfNameTranslationError: String(translated.etfNameTranslationError || "").trim(),
    };
  }
  const name = String(translated.name || translated.label || "").trim();
  if (!name) return item;
  return {
    ...item,
    label: name,
    name,
    englishName: String(translated.englishName || item.englishName || item.name || item.label || "").trim(),
    originalName: String(translated.originalName || item.originalName || item.englishName || item.name || item.label || "").trim(),
    etfNameTranslationStatus: "translated",
  };
}

async function fetchTransactionEtfNameTranslations(items = [], signal) {
  const response = await fetch("/api/tossinvest/etf-name-translations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    signal,
    body: JSON.stringify({ items }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body?.ok === false) throw new Error(body?.error || `HTTP ${response.status}`);
  return body;
}

function transactionInstrumentKey(source = {}) {
  const instrument = normalizeTransactionInstrument(source);
  return instrument?.instrumentId || "";
}

function normalizeTransactionWatchlistInstrumentsSetting(value, legacySymbols = []) {
  const nextInstruments = [];
  const seenIds = new Set();
  const explicitSources = Array.isArray(value) ? value : [];
  for (const source of explicitSources) {
    const instrument = normalizeTransactionInstrument(source);
    if (!instrument || seenIds.has(instrument.instrumentId)) continue;
    seenIds.add(instrument.instrumentId);
    nextInstruments.push(instrument);
  }
  const explicitSymbols = new Set(nextInstruments.map((instrument) => instrument.symbol));
  for (const source of Array.isArray(legacySymbols) ? legacySymbols : []) {
    const legacySymbol = cleanTransactionWatchlistSymbol(
      source && typeof source === "object" ? source.symbol ?? source.ticker ?? source.code : source
    );
    if (!legacySymbol || explicitSymbols.has(legacySymbol)) continue;
    const instrument = normalizeTransactionInstrument(source);
    if (!instrument || seenIds.has(instrument.instrumentId)) continue;
    seenIds.add(instrument.instrumentId);
    nextInstruments.push(instrument);
  }
  return nextInstruments;
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
    const instruments = normalizeTransactionWatchlistInstrumentsSetting(
      source.instruments,
      source.symbols ?? source.tickers ?? source.items
    );
    nextGroups.push({
      id,
      name,
      createdAt: typeof source.createdAt === "string" ? source.createdAt : "",
      symbols: normalizeTransactionWatchlistSymbolsSetting(instruments),
      instruments,
    });
  }
  return nextGroups;
}

function transactionItemOrderKey(item = {}) {
  const source = item && typeof item === "object" ? item : {};
  return String(source.symbol || "").trim().toUpperCase();
}

function transactionItemSelectionKey(item = {}) {
  const source = item && typeof item === "object" ? item : {};
  return transactionInstrumentKey(source) || transactionItemOrderKey(source);
}

function cleanTransactionItemSelectionKey(value) {
  const raw = String(value || "").trim();
  return raw.includes(":") ? cleanTransactionInstrumentId(raw) : cleanTransactionWatchlistSymbol(raw);
}

function createTransactionSimulatorOrderIdempotencyKey(side, simulatorId, instrumentId) {
  const nonce = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return [
    side === "sell" ? "sell" : "buy",
    cleanTransactionSimulatorId(simulatorId),
    cleanTransactionInstrumentId(instrumentId),
    nonce,
  ].filter(Boolean).join(":").slice(0, 160);
}

function transactionItemOrderKeys(items = []) {
  const nextKeys = [];
  for (const item of items) {
    const key = transactionItemSelectionKey(item);
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
  const itemEntries = items.map((item) => ({
    key: transactionItemSelectionKey(item),
    symbol: transactionItemOrderKey(item),
  }));
  const nextOrder = [];
  for (const savedKey of normalizeTransactionSidebarManualOrderSetting(savedOrder, [])) {
    if (itemKeySet.has(savedKey)) {
      if (!nextOrder.includes(savedKey)) nextOrder.push(savedKey);
      continue;
    }
    if (savedKey.includes(":")) continue;
    for (const entry of itemEntries) {
      if (entry.symbol === savedKey && !nextOrder.includes(entry.key)) nextOrder.push(entry.key);
    }
  }
  for (const key of itemKeys) {
    if (!nextOrder.includes(key)) nextOrder.push(key);
  }
  return nextOrder;
}

function reorderTransactionSidebarManualOrder(currentOrder, sourceKey, targetKey, placement = "before") {
  const source = cleanTransactionItemSelectionKey(sourceKey);
  const target = cleanTransactionItemSelectionKey(targetKey);
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

function normalizeTransactionWatchlistInstrumentOrder(value = []) {
  const order = [];
  for (const item of Array.isArray(value) ? value : []) {
    const instrumentId = cleanTransactionInstrumentId(
      item && typeof item === "object" ? item.instrumentId : item
    );
    if (instrumentId && !order.includes(instrumentId)) order.push(instrumentId);
  }
  return order;
}

function reorderTransactionWatchlistInstruments(currentOrder, sourceId, targetId, placement = "before") {
  const source = cleanTransactionInstrumentId(sourceId);
  const target = cleanTransactionInstrumentId(targetId);
  const nextOrder = normalizeTransactionWatchlistInstrumentOrder(currentOrder);
  if (!source || !target || source === target) return nextOrder;
  const sourceIndex = nextOrder.indexOf(source);
  const targetIndex = nextOrder.indexOf(target);
  if (sourceIndex < 0 || targetIndex < 0) return nextOrder;
  const [movedId] = nextOrder.splice(sourceIndex, 1);
  const nextTargetIndex = nextOrder.indexOf(target);
  nextOrder.splice(placement === "after" ? nextTargetIndex + 1 : nextTargetIndex, 0, movedId);
  return nextOrder;
}

function transactionWatchlistInstrumentsInOrder(group = {}, instrumentOrder = []) {
  const instruments = normalizeTransactionWatchlistInstrumentsSetting(group.instruments, group.symbols);
  const byId = new Map(instruments.map((instrument) => [instrument.instrumentId, instrument]));
  const ordered = normalizeTransactionWatchlistInstrumentOrder(instrumentOrder)
    .map((instrumentId) => byId.get(instrumentId))
    .filter(Boolean);
  for (const instrument of instruments) {
    if (!ordered.some((item) => item.instrumentId === instrument.instrumentId)) ordered.push(instrument);
  }
  return ordered;
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

function normalizeTransactionValueModeSetting(value = "value") {
  return String(value ?? "").trim().toLowerCase() === "price" ? "price" : "value";
}

function normalizeTransactionInvestmentChartModeSetting(value = defaultTransactionCurrencySettings.investmentChartMode) {
  const candidate = String(value ?? "").trim().toLowerCase();
  return transactionInvestmentDetailChartModeIds.has(candidate) ? candidate : defaultTransactionCurrencySettings.investmentChartMode;
}

function normalizeTransactionInvestmentChartIntervalSetting(value = defaultTransactionCurrencySettings.investmentChartIntervalMode) {
  const candidate = String(value ?? "").trim().toLowerCase();
  return transactionInvestmentDetailIntervalIds.has(candidate) ? candidate : defaultTransactionCurrencySettings.investmentChartIntervalMode;
}

function normalizeTransactionBooleanSetting(value, fallback = false) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  const candidate = String(value ?? "").trim().toLowerCase();
  if (["true", "1", "yes", "y", "on"].includes(candidate)) return true;
  if (["false", "0", "no", "n", "off", ""].includes(candidate)) return false;
  return Boolean(fallback);
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
    sidebarValueMode: normalizeTransactionValueModeSetting(
      source?.sidebarValueMode ?? source?.valueMode ?? source?.investmentValueMode
    ),
    investmentChartMode: normalizeTransactionInvestmentChartModeSetting(
      source?.investmentChartMode ?? source?.investmentDetailChartMode ?? source?.chartMode
    ),
    investmentChartIntervalMode: normalizeTransactionInvestmentChartIntervalSetting(
      source?.investmentChartIntervalMode ?? source?.investmentDetailIntervalMode ?? source?.chartIntervalMode ?? source?.timeframe
    ),
    investmentChartVolumeVisible: normalizeTransactionBooleanSetting(
      source?.investmentChartVolumeVisible ??
        source?.investmentDetailVolumeVisible ??
        source?.chartVolumeVisible ??
        source?.showVolume,
      defaultTransactionCurrencySettings.investmentChartVolumeVisible
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

function formatQuantity(value, item = null) {
  const number = Number(value || 0);
  const suffix = itemIsCrypto(item) ? String(item?.baseAsset || "").toUpperCase() : "주";
  if (!Number.isFinite(number)) return `0${suffix}`;
  return `${number.toLocaleString("ko-KR", { maximumFractionDigits: 8 })}${suffix}`;
}

function formatUpdatedAt(value) {
  if (!value) return "";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return date.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function formatCompactNumber(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) return "-";
  return new Intl.NumberFormat("ko-KR", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(number);
}

function formatCompactMoney(value, unit = "KRW") {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) return "-";
  const normalizedUnit = normalizeMoneyUnit(unit);
  if (normalizedUnit === "USD") return `$${formatCompactNumber(number)}`;
  return `${formatCompactNumber(number)}원`;
}

function transactionDatePartsFromTime(time) {
  if (typeof time === "number" && Number.isFinite(time)) {
    const date = new Date(time * (time > 10_000_000_000 ? 1 : 1000));
    if (!Number.isNaN(date.getTime())) {
      return {
        year: date.getFullYear(),
        month: date.getMonth() + 1,
        day: date.getDate(),
        hour: date.getHours(),
        minute: date.getMinutes(),
      };
    }
  }
  const text = typeof time === "string" ? time.trim() : "";
  const match = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(text);
  if (!match) return null;
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
}

function formatTransactionChartDateLabel(time, { includeDay = true } = {}) {
  const parts = transactionDatePartsFromTime(time);
  if (!parts) return String(time || "");
  if (typeof parts.hour === "number") {
    return `${parts.month}월 ${parts.day}일 ${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}`;
  }
  const year = `${String(parts.year).slice(-2)}년`;
  const month = `${parts.month}월`;
  const day = `${parts.day}일`;
  return includeDay ? `${year} ${month} ${day}` : `${year} ${month}`;
}

function formatTransactionChartTickMark(time, tickMarkType) {
  const parts = transactionDatePartsFromTime(time);
  if (!parts) return "";
  if (tickMarkType === TickMarkType.Year) return `${String(parts.year).slice(-2)}년`;
  if (tickMarkType === TickMarkType.Month) return `${String(parts.year).slice(-2)}년 ${parts.month}월`;
  if (tickMarkType === TickMarkType.DayOfMonth) return `${parts.month}월 ${parts.day}일`;
  if (
    (tickMarkType === TickMarkType.Time || tickMarkType === TickMarkType.TimeWithSeconds) &&
    typeof parts.hour === "number"
  ) {
    return `${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}`;
  }
  return formatTransactionChartDateLabel(time);
}

function valueTone(value) {
  const number = Number(value || 0);
  if (number > 0) return "is-positive";
  if (number < 0) return "is-negative";
  return "";
}

function transactionInvestmentDirectionPalette(dailyReturnPercent) {
  const number = Number(dailyReturnPercent);
  if (!Number.isFinite(number) || Math.abs(number) < 0.005) {
    return transactionInvestmentDirectionPalettes.flat;
  }
  return number > 0 ? transactionInvestmentDirectionPalettes.up : transactionInvestmentDirectionPalettes.down;
}

function displayName(item = {}) {
  const symbol = String(item.symbol || "").trim();
  const preferredName = String(companyNames[symbol] || item.label || item.name || "").trim();
  const englishName = String(item.englishName || "").trim();
  const provider = normalizeTransactionInstrumentProvider(item.provider);
  const preferredNameIsTicker = !preferredName || preferredName.toUpperCase() === symbol.toUpperCase();

  if (provider === "toss" && englishName && preferredNameIsTicker) {
    return englishName;
  }
  return preferredName || item.displaySymbol || symbol || "-";
}

function displayNameFromInstrumentSources(...sources) {
  let fallback = "";
  for (const source of sources) {
    const instrument = normalizeTransactionInstrument(source);
    if (!instrument) continue;
    const candidate = displayName(instrument);
    if (!fallback) fallback = candidate;
    const normalizedCandidate = String(candidate || "").replace(/[^A-Za-z0-9가-힣]/g, "").toUpperCase();
    const normalizedSymbol = String(instrument.symbol || "").replace(/[^A-Za-z0-9가-힣]/g, "").toUpperCase();
    const normalizedDisplay = String(instrument.displaySymbol || "").replace(/[^A-Za-z0-9가-힣]/g, "").toUpperCase();
    if (normalizedCandidate && normalizedCandidate !== normalizedSymbol && normalizedCandidate !== normalizedDisplay) {
      return candidate;
    }
  }
  return fallback || "-";
}

function transactionInstrumentDescription(item = {}) {
  const parts = [item?.name, item?.englishName, item?.market];
  const seen = new Set();
  return parts
    .map((value) => String(value || "").replace(/\s+/g, " ").trim())
    .filter((value) => {
      if (!value) return false;
      const key = value.toLocaleLowerCase("ko-KR");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .join(" · ");
}

function transactionNameTranslationPending(item = {}) {
  return ["pending", "translating"].includes(String(item.etfNameTranslationStatus || "").trim());
}

function TransactionTranslatedName({ item, name = displayName(item) }) {
  return (
    <span className="transaction-translated-name">
      <span>{name}</span>
      {transactionNameTranslationPending(item) ? (
        <small className="transaction-name-translation-status">번역대기중</small>
      ) : null}
    </span>
  );
}

function transactionWatchlistSearchName(item = {}) {
  return String(item.name || item.companyName || item.koreanName || item.label || displayName(item) || "").trim();
}

function transactionWatchlistOptionAliases(option = {}) {
  return [
    option.symbol,
    option.displaySymbol,
    option.baseAsset,
    option.quoteAsset,
    option.name,
    option.englishName,
    option.assetName,
    option.label,
    option.market,
    ...(Array.isArray(option.tags) ? option.tags : []),
  ]
    .map((value) => String(value || "").trim())
    .filter(Boolean);
}

function transactionSymbolSearchSuggestions(symbolOptions = [], query = "", excludedInstruments = [], limit = 8) {
  const cleanQuery = String(query || "").trim();
  if (!cleanQuery) return [];
  const symbolQuery = cleanTransactionWatchlistSymbol(cleanQuery);
  const lowerQuery = cleanQuery.toLocaleLowerCase("ko-KR");
  const existingInstrumentIds = new Set(
    normalizeTransactionWatchlistInstrumentsSetting(excludedInstruments)
      .map((instrument) => instrument.instrumentId)
  );
  const ranked = symbolOptions
    .map((option, index) => {
      const instrument = normalizeTransactionInstrument(option);
      if (!instrument || existingInstrumentIds.has(instrument.instrumentId)) return null;
      let score = Number.POSITIVE_INFINITY;
      for (const alias of transactionWatchlistOptionAliases(instrument)) {
        const aliasSymbol = cleanTransactionWatchlistSymbol(alias);
        const lowerAlias = alias.toLocaleLowerCase("ko-KR");
        if (aliasSymbol === symbolQuery || lowerAlias === lowerQuery) score = Math.min(score, 0);
        else if (aliasSymbol.startsWith(symbolQuery) || lowerAlias.startsWith(lowerQuery)) score = Math.min(score, 1);
        else if (aliasSymbol.includes(symbolQuery) || lowerAlias.includes(lowerQuery)) score = Math.min(score, 2);
      }
      return Number.isFinite(score) ? { instrument, index, score } : null;
    })
    .filter(Boolean)
    .sort((left, right) => left.score - right.score || left.index - right.index);
  const selected = [];
  const selectedIds = new Set();
  const representedProviders = new Set();
  for (const entry of ranked) {
    if (representedProviders.has(entry.instrument.provider)) continue;
    representedProviders.add(entry.instrument.provider);
    selectedIds.add(entry.instrument.instrumentId);
    selected.push(entry.instrument);
  }
  for (const entry of ranked) {
    if (selected.length >= limit) break;
    if (selectedIds.has(entry.instrument.instrumentId)) continue;
    selectedIds.add(entry.instrument.instrumentId);
    selected.push(entry.instrument);
  }
  return selected.slice(0, limit);
}

function transactionWatchlistSymbolOptions(items = []) {
  const seenInstruments = new Set();
  const options = [];
  for (const item of items) {
    const symbol = transactionItemOrderKey(item);
    const instrument = normalizeTransactionInstrument({ ...item, symbol });
    if (!instrument || seenInstruments.has(instrument.instrumentId)) continue;
    seenInstruments.add(instrument.instrumentId);
    const name = transactionWatchlistSearchName(item) || symbol;
    options.push({
      ...instrument,
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
  const rows = result
    .map((item) => {
      const symbol = cleanTransactionWatchlistSymbol(item?.symbol);
      if (!symbol) return null;
      const koreanMarketDetail =
        item?.koreanMarketDetail && typeof item.koreanMarketDetail === "object" ? item.koreanMarketDetail : null;
      return normalizeTransactionInstrument({
        ...item,
        provider: item?.provider || "toss",
        assetClass: item?.assetClass || "stock",
        symbol,
        name: String(item?.name || item?.label || symbol).trim(),
        englishName: String(item?.englishName || "").trim(),
        market: String(item?.market || "").trim(),
        status: String(item?.status || "").trim(),
        securityType: String(item?.securityType || "").trim(),
        sector: String(item?.sector || "").trim(),
        koreanMarketDetail,
        source: String(item?.source || "toss-stocks").trim(),
      });
    })
    .filter(Boolean);
  return rows;
}

function transactionMarketDataInstrumentOptionsFromPayload(payload = {}) {
  const result = Array.isArray(payload?.result)
    ? payload.result
    : Array.isArray(payload?.result?.instruments)
      ? payload.result.instruments
      : Array.isArray(payload)
        ? payload
        : [];
  return result.map((item) => normalizeTransactionInstrument(item)).filter(Boolean);
}

function transactionWatchlistPriceRowsFromPayload(payload = {}) {
  const result = Array.isArray(payload?.result)
    ? payload.result
    : Array.isArray(payload?.result?.quotes)
      ? payload.result.quotes
      : Array.isArray(payload)
        ? payload
        : [];
  return result
    .map((item) => {
      const symbol = cleanTransactionWatchlistSymbol(item?.symbol);
      if (!symbol) return null;
      const instrument = normalizeTransactionInstrument(item);
      const rawTimestamp = item?.timestamp ?? item?.dateTime ?? item?.time ?? "";
      return {
        raw: item,
        ...instrument,
        symbol,
        lastPrice: optionalNumericAmount(item?.lastPrice ?? item?.price ?? item?.closePrice ?? item?.close),
        currency: normalizeMoneyUnit(item?.currency || "KRW"),
        timestamp: typeof rawTimestamp === "number" || /^\d{12,}$/.test(String(rawTimestamp || ""))
          ? new Date(Number(rawTimestamp)).toISOString()
          : String(rawTimestamp || "").trim(),
        volume: optionalNumericAmount(item?.volume ?? item?.baseVolume),
        quoteVolume: optionalNumericAmount(item?.quoteVolume),
        rolling24HourReturnPercent: instrument?.provider === "binance"
          ? optionalNumericAmount(item?.priceChangePercent)
          : null,
        dailyReturnPercent: instrument?.provider === "binance"
          ? null
          : optionalRatePercent(
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
      const rawTime = item?.date ?? item?.timestamp ?? item?.dateTime ?? item?.time ?? item?.at ?? item?.openTime ?? "";
      const date = typeof rawTime === "number" || /^\d{12,}$/.test(String(rawTime || ""))
        ? new Date(Number(rawTime)).toISOString().slice(0, 10)
        : String(rawTime || "").slice(0, 10);
      const close = optionalNumericAmount(item?.closePrice ?? item?.close ?? item?.lastPrice ?? item?.price);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || close === null || close <= 0) return null;
      return { date, close };
    })
    .filter(Boolean)
    .sort((left, right) => left.date.localeCompare(right.date));
}

function transactionInvestmentIntervalIsIntraday(interval = "1d") {
  return /^(?:\d+)(?:s|m|h)$/.test(String(interval || "").trim());
}

function transactionInvestmentCandleRowsFromPayload(payload = {}, interval = "1d") {
  const result = Array.isArray(payload?.result?.candles)
    ? payload.result.candles
    : Array.isArray(payload?.candles)
      ? payload.candles
      : Array.isArray(payload?.result)
        ? payload.result
        : Array.isArray(payload)
          ? payload
          : [];
  const rows = result
    .map((item) => {
      const rawTimestamp = item?.timestamp ?? item?.dateTime ?? item?.time ?? item?.at ?? item?.openTime ?? item?.date ?? "";
      const timestamp = typeof rawTimestamp === "number" || /^\d{12,}$/.test(String(rawTimestamp || ""))
        ? new Date(Number(rawTimestamp)).toISOString()
        : String(rawTimestamp || "").trim();
      const date = String(item?.date || timestamp).slice(0, 10);
      const close = optionalNumericAmount(item?.closePrice ?? item?.close ?? item?.lastPrice ?? item?.price);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || close === null || close <= 0) return null;
      const open = optionalNumericAmount(item?.openPrice ?? item?.open) ?? close;
      const high = optionalNumericAmount(item?.highPrice ?? item?.high) ?? Math.max(open, close);
      const low = optionalNumericAmount(item?.lowPrice ?? item?.low) ?? Math.min(open, close);
      const volume = optionalNumericAmount(item?.volume) ?? 0;
      const turnover = optionalNumericAmount(item?.quoteVolume) ?? close * volume;
      const currency = normalizeMoneyUnit(
        item?.currency || payload?.result?.currency || payload?.currency || "KRW"
      );
      const timestampMs = Date.parse(timestamp);
      const isIntradayInterval = transactionInvestmentIntervalIsIntraday(interval);
      return {
        date,
        timestamp,
        time: isIntradayInterval && Number.isFinite(timestampMs) ? Math.floor(timestampMs / 1000) : date,
        open,
        high,
        low,
        close,
        volume,
        turnover,
        currency,
      };
    })
    .filter(Boolean)
    .sort((left, right) => {
      const leftTime = typeof left.time === "number" ? left.time : Date.parse(left.date);
      const rightTime = typeof right.time === "number" ? right.time : Date.parse(right.date);
      if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime) {
        return leftTime - rightTime;
      }
      return left.date.localeCompare(right.date);
    });
  const usedTimes = new Set();
  return rows.map((row) => {
    if (typeof row.time !== "number") return row;
    let nextTime = row.time;
    while (usedTimes.has(nextTime)) nextTime += 1;
    usedTimes.add(nextTime);
    return nextTime === row.time ? row : { ...row, time: nextTime };
  });
}

function transactionInvestmentSourceInterval(interval = "1d") {
  const normalized = String(interval || "1d").trim().toLowerCase();
  // Toss minute views are built from 1m rows, while Binance hour rows are
  // already intraday data and must keep timestamp keys instead of date keys.
  if (/^\d+(?:s|h)$/.test(normalized)) return normalized;
  return normalized.endsWith("m") ? "1m" : "1d";
}

function transactionBinanceSourceInterval(interval = "1d") {
  const normalized = String(interval || "1d").trim().toLowerCase();
  if (normalized === "60m") return "1h";
  if (normalized === "120m") return "2h";
  if (normalized === "240m") return "4h";
  return normalized;
}

function transactionInvestmentCandleRowKey(row = {}, interval = "1d") {
  const sourceInterval = String(interval || "1d").trim();
  if (transactionInvestmentIntervalIsIntraday(sourceInterval)) {
    return String(row.timestamp || row.time || row.date || "").trim();
  }
  return String(row.date || row.timestamp || row.time || "").slice(0, 10);
}

function uniqueTransactionInvestmentCandleRows(rows = [], interval = "1d") {
  const sourceInterval = transactionInvestmentSourceInterval(interval);
  const byKey = new Map();
  for (const row of transactionInvestmentCandleRowsFromPayload(rows, sourceInterval)) {
    const key = transactionInvestmentCandleRowKey(row, sourceInterval);
    if (!key) continue;
    byKey.set(key, row);
  }
  return [...byKey.values()].sort((left, right) => transactionChartTimeSortValue(left.time) - transactionChartTimeSortValue(right.time));
}

function mergeTransactionInvestmentCandleRows(existing = [], incoming = [], interval = "1d") {
  return uniqueTransactionInvestmentCandleRows([...existing, ...incoming], interval);
}

function transactionInvestmentCandleRowsEqual(leftRows = [], rightRows = [], interval = "1d") {
  if (leftRows.length !== rightRows.length) return false;
  const numericFields = ["open", "high", "low", "close", "volume", "turnover"];
  for (let index = 0; index < leftRows.length; index += 1) {
    const left = leftRows[index] || {};
    const right = rightRows[index] || {};
    if (transactionInvestmentCandleRowKey(left, interval) !== transactionInvestmentCandleRowKey(right, interval)) {
      return false;
    }
    if (String(left.currency || "") !== String(right.currency || "")) return false;
    if (numericFields.some((field) => Number(left[field] ?? 0) !== Number(right[field] ?? 0))) return false;
  }
  return true;
}

function transactionInvestmentOlderBeforeFromRows(rows = [], interval = "1d") {
  const sourceInterval = String(interval || "1d").trim();
  const firstRow = transactionInvestmentCandleRowsFromPayload(rows, sourceInterval)[0];
  if (!firstRow) return "";
  if (transactionInvestmentIntervalIsIntraday(sourceInterval)) {
    const timeMs = Date.parse(firstRow.timestamp || firstRow.date || "");
    return Number.isFinite(timeMs) ? new Date(timeMs - 1000).toISOString() : "";
  }
  const beforeDate = transactionWatchlistShiftDate(firstRow.date, { days: 1 });
  return beforeDate ? `${beforeDate}T23:59:59+09:00` : "";
}

function transactionInvestmentNextBeforeFromPayload(body = {}, rows = [], interval = "1d") {
  const nextBefore = String(body?.result?.nextBefore || body?.nextBefore || "").trim();
  return nextBefore || transactionInvestmentOlderBeforeFromRows(rows, interval);
}

function transactionInvestmentShouldLoadOlderFromLogicalRange(series, logicalRange) {
  if (!logicalRange) return false;
  const barsInfo = series?.barsInLogicalRange?.(logicalRange) || null;
  const barsBefore = Number(barsInfo?.barsBefore);
  const rangeFrom = Number(logicalRange.from);
  return (
    (Number.isFinite(barsBefore) && barsBefore <= transactionInvestmentDetailOlderLoadThreshold) ||
    (!Number.isFinite(barsBefore) && Number.isFinite(rangeFrom) && rangeFrom <= transactionInvestmentDetailOlderLoadThreshold)
  );
}

function transactionInvestmentRestoredLogicalRange(logicalRange, prependedCount = 0) {
  if (!logicalRange) return null;
  const from = Number(logicalRange.from);
  const to = Number(logicalRange.to);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
  const offset = Number(prependedCount || 0);
  if (!Number.isFinite(offset) || offset <= 0) return { from, to };
  return {
    from: from + offset,
    to: to + offset,
  };
}

function transactionInvestmentMinuteSize(interval = "1m") {
  const match = /^(\d+)m$/.exec(String(interval || ""));
  const minutes = match ? Number(match[1]) : 1;
  return Number.isFinite(minutes) && minutes > 0 ? minutes : 1;
}

function mergeTransactionInvestmentCandleGroup(group, row) {
  if (!group) {
    return {
      date: row.date,
      timestamp: row.timestamp,
      time: row.time,
      open: row.open,
      high: row.high,
      low: row.low,
      close: row.close,
      volume: row.volume || 0,
      turnover: row.turnover || 0,
      currency: row.currency,
    };
  }
  return {
    ...group,
    date: row.date || group.date,
    timestamp: row.timestamp || group.timestamp,
    high: Math.max(group.high, row.high),
    low: Math.min(group.low, row.low),
    close: row.close,
    volume: (group.volume || 0) + (row.volume || 0),
    turnover: (group.turnover || 0) + (row.turnover || 0),
  };
}

function aggregateTransactionInvestmentMinuteRows(rows = [], interval = "1m") {
  const minutes = transactionInvestmentMinuteSize(interval);
  if (minutes <= 1) return rows;
  const bucketSeconds = minutes * 60;
  const groups = new Map();
  for (const row of rows) {
    const sourceTime = typeof row.time === "number" ? row.time : Math.floor(Date.parse(row.timestamp || row.date) / 1000);
    if (!Number.isFinite(sourceTime)) continue;
    const bucketTime = Math.floor(sourceTime / bucketSeconds) * bucketSeconds;
    const bucketKey = String(bucketTime);
    const groupRow = { ...row, time: bucketTime };
    groups.set(bucketKey, mergeTransactionInvestmentCandleGroup(groups.get(bucketKey), groupRow));
  }
  return [...groups.values()].sort((left, right) => Number(left.time || 0) - Number(right.time || 0));
}

function transactionInvestmentWeekStart(dateString = "") {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateString || ""));
  if (!match) return "";
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  const day = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - day);
  return date.toISOString().slice(0, 10);
}

function aggregateTransactionInvestmentWeeklyRows(rows = []) {
  const groups = new Map();
  for (const row of rows) {
    const weekStart = transactionInvestmentWeekStart(row.date);
    if (!weekStart) continue;
    const groupRow = { ...row, date: weekStart, time: weekStart, timestamp: weekStart };
    groups.set(weekStart, mergeTransactionInvestmentCandleGroup(groups.get(weekStart), groupRow));
  }
  return [...groups.values()].sort((left, right) => left.date.localeCompare(right.date));
}

function transactionInvestmentDailyDate(row = {}) {
  const date = String(row.date || row.timestamp || row.time || "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : "";
}

function aggregateTransactionInvestmentDailyRows(rows = []) {
  const groups = new Map();
  const sortedRows = [...rows].sort(
    (left, right) =>
      transactionChartTimeSortValue(left.time || left.timestamp || left.date) -
      transactionChartTimeSortValue(right.time || right.timestamp || right.date)
  );
  for (const row of sortedRows) {
    const date = transactionInvestmentDailyDate(row);
    if (!date) continue;
    const open = optionalNumericAmount(row.open) ?? optionalNumericAmount(row.close) ?? 0;
    const close = optionalNumericAmount(row.close) ?? open;
    const high = optionalNumericAmount(row.high) ?? Math.max(open, close);
    const low = optionalNumericAmount(row.low) ?? Math.min(open, close);
    const volume = optionalNumericAmount(row.volume) ?? 0;
    const turnover = optionalNumericAmount(row.turnover) ?? close * volume;
    const current = groups.get(date);
    if (!current) {
      groups.set(date, {
        date,
        timestamp: date,
        time: date,
        open,
        high,
        low,
        close,
        volume,
        turnover,
        currency: row.currency,
      });
      continue;
    }
    groups.set(date, {
      ...current,
      high: Math.max(current.high, high),
      low: Math.min(current.low, low),
      close,
      volume: (current.volume || 0) + volume,
      turnover: (current.turnover || 0) + turnover,
      currency: row.currency || current.currency,
    });
  }
  return [...groups.values()].sort((left, right) => left.date.localeCompare(right.date));
}

function aggregateTransactionInvestmentRows(rows = [], interval = "1d") {
  if (String(interval || "").endsWith("m")) {
    return aggregateTransactionInvestmentMinuteRows(rows, interval);
  }
  if (interval === "1w") {
    return aggregateTransactionInvestmentWeeklyRows(rows);
  }
  return rows;
}

function transactionChartTimeSortValue(time) {
  if (typeof time === "number" && Number.isFinite(time)) return time;
  const parsed = Date.parse(String(time || ""));
  return Number.isFinite(parsed) ? parsed / 1000 : 0;
}

function transactionChartDataTime(row = {}) {
  const time = row?.time ?? row?.date;
  if (typeof time === "number") return Number.isFinite(time) ? time : null;
  const text = String(time || "").trim();
  return text || null;
}

function transactionChartDataTimeKey(time) {
  if (typeof time === "number") return Number.isFinite(time) ? `n:${time}` : "";
  const text = String(time || "").trim();
  return text ? `s:${text}` : "";
}

function transactionInvestmentChartDatumEqual(left = {}, right = {}) {
  if (transactionChartDataTimeKey(left?.time) !== transactionChartDataTimeKey(right?.time)) return false;
  return ["value", "open", "high", "low", "close", "color"].every(
    (field) => (left?.[field] ?? null) === (right?.[field] ?? null)
  );
}

function transactionInvestmentCanUpdateLastChartDatum(previousRows = [], nextRows = []) {
  if (!previousRows.length || !nextRows.length) return false;
  if (nextRows.length !== previousRows.length && nextRows.length !== previousRows.length + 1) return false;
  const stableCount = nextRows.length === previousRows.length ? nextRows.length - 1 : previousRows.length;
  for (let index = 0; index < stableCount; index += 1) {
    if (!transactionInvestmentChartDatumEqual(previousRows[index], nextRows[index])) return false;
  }
  return true;
}

function normalizeTransactionChartRows(rows = []) {
  const usedTimes = new Set();
  const nextRows = [];
  const sortedRows = [...rows].sort((left, right) => transactionChartTimeSortValue(left.time) - transactionChartTimeSortValue(right.time));
  for (const row of sortedRows) {
    const chartTime = transactionChartDataTime(row);
    if (chartTime === null) continue;
    if (typeof chartTime === "number") {
      let nextTime = chartTime;
      while (usedTimes.has(nextTime)) nextTime += 1;
      usedTimes.add(nextTime);
      nextRows.push(nextTime === row.time ? row : { ...row, time: nextTime });
      continue;
    }
    const timeKey = chartTime;
    if (!timeKey || usedTimes.has(timeKey)) continue;
    usedTimes.add(timeKey);
    nextRows.push({ ...row, time: timeKey });
  }
  return nextRows;
}

function transactionInvestmentDisplayCandleRows(rows = [], fromUnit = "USD", toUnit = "USD", usdKrwRate = 0) {
  const sourceUnit = normalizeMoneyUnit(fromUnit);
  const displayUnit = normalizeMoneyUnit(toUnit);
  if (sourceUnit !== displayUnit && convertMoney(1, sourceUnit, displayUnit, usdKrwRate) === null) return [];
  if (sourceUnit === displayUnit) return rows;
  const moneyFields = ["open", "high", "low", "close", "turnover"];
  return rows.map((row) => {
    const convertedRow = { ...row, currency: displayUnit };
    for (const field of moneyFields) {
      const value = optionalNumericAmount(row?.[field]);
      if (value === null) continue;
      const convertedValue = convertMoney(value, sourceUnit, displayUnit, usdKrwRate);
      if (convertedValue !== null) convertedRow[field] = convertedValue;
    }
    return convertedRow;
  });
}

function transactionInvestmentLineChartData(rows = []) {
  return rows
    .map((row) => {
      const time = transactionChartDataTime(row);
      const value = optionalNumericAmount(row?.close);
      if (time === null || value === null || value <= 0) return null;
      return { time, value };
    })
    .filter(Boolean);
}

function transactionInvestmentOhlcChartData(rows = []) {
  return rows
    .map((row) => {
      const time = transactionChartDataTime(row);
      const close = optionalNumericAmount(row?.close);
      if (time === null || close === null || close <= 0) return null;
      const open = optionalNumericAmount(row?.open) ?? close;
      const rawHigh = optionalNumericAmount(row?.high);
      const rawLow = optionalNumericAmount(row?.low);
      const priceValues = [open, close];
      if (rawHigh !== null) priceValues.push(rawHigh);
      if (rawLow !== null) priceValues.push(rawLow);
      return {
        time,
        open,
        high: Math.max(...priceValues),
        low: Math.min(...priceValues),
        close,
      };
    })
    .filter(Boolean);
}

function transactionInvestmentVolumeChartData(rows = [], priceData = []) {
  const priceTimeKeys = new Set(priceData.map((row) => transactionChartDataTimeKey(row?.time)).filter(Boolean));
  return rows
    .map((row) => {
      const time = transactionChartDataTime(row);
      if (time === null || (priceTimeKeys.size && !priceTimeKeys.has(transactionChartDataTimeKey(time)))) return null;
      const volume = optionalNumericAmount(row?.volume) ?? 0;
      const close = optionalNumericAmount(row?.close);
      const open = optionalNumericAmount(row?.open);
      const isUp = close !== null && open !== null ? close >= open : true;
      return {
        time,
        value: Math.max(0, volume),
        color: isUp ? "rgba(225, 29, 72, 0.34)" : "rgba(40, 120, 255, 0.34)",
      };
    })
    .filter(Boolean);
}

function transactionInvestmentChartDataReady(priceData = [], volumeData = [], volumeVisible = false) {
  if (!priceData.length) return false;
  if (!volumeVisible) return true;
  if (!volumeData.length) return false;
  const volumeTimeKeys = new Set(volumeData.map((row) => transactionChartDataTimeKey(row?.time)).filter(Boolean));
  return priceData.every((row) => volumeTimeKeys.has(transactionChartDataTimeKey(row?.time)));
}

function transactionInvestmentHasNewCandleRows(currentRows = [], nextRows = [], interval = "1d") {
  const currentKeys = new Set(
    currentRows
      .map((row) => transactionInvestmentCandleRowKey(row, interval))
      .filter(Boolean)
  );
  return nextRows.some((row) => {
    const key = transactionInvestmentCandleRowKey(row, interval);
    return key && !currentKeys.has(key);
  });
}

function transactionWatchlistMinuteCandleRowsFromPayload(payload = {}) {
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
      const timestamp = String(item?.timestamp || item?.dateTime || item?.time || item?.at || "").trim();
      const close = optionalNumericAmount(item?.closePrice ?? item?.close ?? item?.lastPrice ?? item?.price);
      const volume = optionalNumericAmount(item?.volume);
      if (!timestamp || close === null || close <= 0) return null;
      const timeMs = Date.parse(timestamp);
      return {
        timestamp,
        timeMs: Number.isFinite(timeMs) ? timeMs : 0,
        close,
        volume: volume ?? 0,
      };
    })
    .filter(Boolean)
    .sort((left, right) => right.timeMs - left.timeMs);
}

function transactionWatchlistPriceDate(row = {}) {
  const source = String(row.timestamp || row.raw?.timestamp || row.raw?.dateTime || row.raw?.time || row.raw?.date || "").trim();
  const fallbackDate = source.slice(0, 10);
  if (normalizeTransactionInstrument(row)?.provider === "binance") {
    const parsed = Date.parse(source);
    return Number.isFinite(parsed) ? new Date(parsed).toISOString().slice(0, 10) : fallbackDate;
  }
  if (source.includes("T")) {
    const parsed = Date.parse(source);
    if (Number.isFinite(parsed)) {
      const timeZone = normalizeMoneyUnit(row.currency || row.raw?.currency || "KRW") === "USD"
        ? "America/New_York"
        : "Asia/Seoul";
      return transactionSimulatorCalendarDateInTimeZone(timeZone, new Date(parsed));
    }
  }
  return /^\d{4}-\d{2}-\d{2}$/.test(fallbackDate) ? fallbackDate : "";
}

function transactionWatchlistPriceDateObject(row = {}) {
  const source = String(row.timestamp || row.raw?.timestamp || row.raw?.dateTime || row.raw?.time || "").trim();
  const parsed = Date.parse(source);
  return Number.isFinite(parsed) ? new Date(parsed) : new Date();
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

function transactionWatchlistAddMinutes(timestamp = "", minutes = 0) {
  const timeMs = Date.parse(String(timestamp || ""));
  if (!Number.isFinite(timeMs)) return "";
  const nextTimeMs = timeMs + Number(minutes || 0) * 60_000;
  if (String(timestamp || "").endsWith("+09:00")) {
    return `${new Date(nextTimeMs + 9 * 60 * 60_000).toISOString().replace("Z", "")}+09:00`;
  }
  return new Date(nextTimeMs).toISOString();
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

function transactionWatchlistReturnsForPrice(priceRow = {}, candleRows = [], dailyBasis = null) {
  const rows = transactionWatchlistCandleRowsFromPayload(candleRows);
  const anchorDate = transactionWatchlistPriceDate(priceRow) || rows.at(-1)?.date || transactionWatchlistLocalDateString();
  const isBinance = normalizeTransactionInstrument(priceRow)?.provider === "binance";
  const dailyBasisClose = optionalNumericAmount(dailyBasis?.close);
  const previousClose = dailyBasisClose && dailyBasisClose > 0
    ? dailyBasisClose
    : isBinance
      ? null
      : previousCloseForWatchlistPrice(priceRow, rows);
  const hasDailyBasis = dailyBasisClose && dailyBasisClose > 0;
  let dailyReturnPercent = hasDailyBasis
    ? transactionWatchlistReturnPercent(priceRow.lastPrice, previousClose)
    : isBinance
      ? null
      : priceRow.dailyReturnPercent;
  if (!isBinance && !Number.isFinite(dailyReturnPercent)) {
    dailyReturnPercent = transactionWatchlistReturnPercent(priceRow.lastPrice, previousClose);
  }
  const returns = {
    previousClose,
    previousCloseTimestamp: hasDailyBasis ? dailyBasis?.timestamp || "" : "",
    previousCloseSource: hasDailyBasis ? dailyBasis?.source || "" : "",
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

function transactionWatchlistPriceMap(priceRows = [], candlePayloads = [], dailyBasisPayloads = []) {
  const candleRowsBySymbol = new Map();
  for (const payload of candlePayloads) {
    const symbol = cleanTransactionWatchlistSymbol(payload?.symbol);
    if (symbol) candleRowsBySymbol.set(symbol, transactionWatchlistUniqueCandleRows(payload?.candles || []));
  }
  const dailyBasisBySymbol = new Map();
  for (const payload of dailyBasisPayloads) {
    const symbol = cleanTransactionWatchlistSymbol(payload?.symbol);
    if (symbol && optionalNumericAmount(payload?.close) > 0) dailyBasisBySymbol.set(symbol, payload);
  }
  const map = new Map();
  for (const row of priceRows) {
    map.set(row.symbol, {
      ...row,
      ...transactionWatchlistReturnsForPrice(
        row,
        candleRowsBySymbol.get(row.symbol) || [],
        dailyBasisBySymbol.get(row.symbol) || null
      ),
    });
  }
  return map;
}

async function fetchTransactionWatchlistCatalogOptions(query, signal) {
  const clean = String(query || "").trim();
  if (!clean) return [];
  const [stockResult, binanceResult] = await Promise.allSettled([
    fetch(`/api/market-symbols/search?query=${encodeURIComponent(clean)}&limit=12`, {
      cache: "no-store",
      signal,
    }),
    fetch(
      `/api/market-data/instruments/search?query=${encodeURIComponent(clean)}&provider=binance&limit=12`,
      { cache: "no-store", signal }
    ),
  ]);
  if (signal?.aborted) return [];
  const optionGroups = [];
  if (stockResult.status === "fulfilled") {
    const body = await stockResult.value.json().catch(() => ({}));
    if (stockResult.value.ok && body?.ok !== false) {
      optionGroups.push(transactionWatchlistStockOptionsFromPayload(body));
    }
  }
  if (binanceResult.status === "fulfilled") {
    const body = await binanceResult.value.json().catch(() => ({}));
    if (binanceResult.value.ok && body?.ok !== false) {
      optionGroups.push(transactionMarketDataInstrumentOptionsFromPayload(body));
    }
  }
  return mergeTransactionWatchlistSymbolOptions(...optionGroups);
}

async function fetchTransactionWatchlistCandleRows(symbol, signal) {
  const cleanSymbol = cleanTransactionWatchlistSymbol(symbol);
  const cached = transactionWatchlistCandleCache.get(cleanSymbol);
  if (cached && Date.now() - cached.fetchedAtMs <= transactionWatchlistCandleCacheTtlMs) {
    return { symbol: cleanSymbol, candles: cached.candles };
  }
  const params = new URLSearchParams({
    symbol: cleanSymbol,
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
    if (!candleResponse.ok || candleBody?.ok === false) {
      return { symbol: cleanSymbol, candles: cached?.candles || [] };
    }
    const candles = transactionWatchlistUniqueCandleRows(transactionWatchlistCandleRowsFromPayload(candleBody));
    if (candles.length) {
      transactionWatchlistCandleCache.set(cleanSymbol, { candles, fetchedAtMs: Date.now() });
    }
    return { symbol: cleanSymbol, candles };
  } catch (fetchError) {
    if (fetchError.name === "AbortError") throw fetchError;
    return { symbol: cleanSymbol, candles: cached?.candles || [] };
  }
}

async function fetchTransactionInvestmentDetailCandles(instrumentSource, interval = "1d", signal, options = {}) {
  const instrument = normalizeTransactionInstrument(instrumentSource);
  const cleanSymbol = cleanTransactionWatchlistSymbol(instrument?.symbol ?? instrumentSource);
  const cleanInterval = String(interval || "1d").trim() || "1d";
  const sourceInterval = instrument?.provider === "binance"
    ? transactionBinanceSourceInterval(cleanInterval)
    : transactionInvestmentSourceInterval(cleanInterval);
  const before = String(options?.before || "").trim();
  const force = options?.force === true;
  const cacheKey = `${instrument?.instrumentId || cleanSymbol}:${sourceInterval}`;
  const cached = transactionInvestmentDetailCandleCache.get(cacheKey);
  if (!force && !before && cached && Date.now() - cached.fetchedAtMs <= transactionWatchlistCandleCacheTtlMs) {
    return {
      symbol: cleanSymbol,
      interval: sourceInterval,
      requestedInterval: cleanInterval,
      candles: cached.candles,
      source: cached.source,
      nextBefore: cached.nextBefore || "",
      hasMore: cached.hasMore !== false,
    };
  }
  const params = new URLSearchParams();
  if (instrument?.provider === "binance") {
    params.set("instrumentId", instrument.instrumentId);
    params.set("interval", sourceInterval);
    params.set("limit", String(transactionInvestmentDetailCandlePageSize));
  } else {
    params.set("symbol", cleanSymbol);
    params.set("interval", sourceInterval);
    params.set("count", String(transactionInvestmentDetailCandlePageSize));
    params.set("adjusted", "true");
  }
  if (before) params.set("before", before);
  const route = instrument?.provider === "binance" ? "/api/market-data/candles" : "/api/tossinvest/candles";
  const response = await fetch(`${route}?${params.toString()}`, {
    cache: "no-store",
    signal,
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body?.ok === false) {
    const error = new Error(body?.error || `HTTP ${response.status}`);
    error.errorCode = body?.errorCode || "";
    throw error;
  }
  const pageCandles = transactionInvestmentCandleRowsFromPayload(body, sourceInterval);
  const candles = before
    ? mergeTransactionInvestmentCandleRows(cached?.candles || [], pageCandles, sourceInterval)
    : mergeTransactionInvestmentCandleRows([], pageCandles, sourceInterval);
  const nextBefore = transactionInvestmentNextBeforeFromPayload(body, pageCandles, sourceInterval);
  const hasMore = Boolean(nextBefore) && pageCandles.length > 0;
  const payload = {
    instrumentId: instrument?.instrumentId || "",
    provider: instrument?.provider || "toss",
    symbol: cleanSymbol,
    interval: sourceInterval,
    requestedInterval: cleanInterval,
    candles,
    source: body?.source || (instrument?.provider === "binance" ? "Binance 공개 시세" : "토스 증권 API 시세"),
    nextBefore,
    hasMore,
    fetchedPageCount: pageCandles.length,
    loadedBefore: before,
  };
  if (candles.length) {
    transactionInvestmentDetailCandleCache.set(cacheKey, { ...payload, fetchedAtMs: Date.now() });
  }
  return payload;
}

async function fetchTransactionWatchlistMarketCalendar(marketCode = "kr", date = "", signal) {
  const cleanMarketCode = String(marketCode || "").toLowerCase() === "us" ? "us" : "kr";
  const cleanDate = /^\d{4}-\d{2}-\d{2}$/.test(String(date || "")) ? String(date) : "";
  if (!cleanDate) return null;
  const cacheKey = `${cleanMarketCode}:${cleanDate}`;
  const cached = transactionWatchlistMarketCalendarCache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAtMs <= transactionWatchlistKoreanDailyBasisCacheTtlMs) {
    return cached.payload;
  }
  try {
    const response = await fetch(
      `/api/tossinvest/market-calendar/${cleanMarketCode}?date=${encodeURIComponent(cleanDate)}`,
      {
        cache: "no-store",
        signal,
      }
    );
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body?.ok === false) return cached?.payload || null;
    transactionWatchlistMarketCalendarCache.set(cacheKey, { payload: body, fetchedAtMs: Date.now() });
    return body;
  } catch (fetchError) {
    if (fetchError.name === "AbortError") throw fetchError;
    return cached?.payload || null;
  }
}

function transactionWatchlistKoreanDailyBasisBoundary(calendarPayload = {}) {
  const result = transactionSimulatorCalendarResult(calendarPayload);
  const previousBusinessDay =
    result?.previousBusinessDay && typeof result.previousBusinessDay === "object"
      ? result.previousBusinessDay
      : null;
  const integrated =
    previousBusinessDay?.integrated && typeof previousBusinessDay.integrated === "object"
      ? previousBusinessDay.integrated
      : null;
  const afterStart = String(integrated?.afterMarket?.startTime || "").trim();
  const regularEnd = String(integrated?.regularMarket?.endTime || "").trim();
  const boundary = transactionWatchlistAddMinutes(afterStart || regularEnd, 1);
  return boundary || afterStart || regularEnd || "";
}

function transactionWatchlistUsDailyBasisBoundary(calendarPayload = {}, priceRow = {}) {
  const result = transactionSimulatorCalendarResult(calendarPayload);
  const today = result?.today && typeof result.today === "object" ? result.today : null;
  const previousBusinessDay =
    result?.previousBusinessDay && typeof result.previousBusinessDay === "object"
      ? result.previousBusinessDay
      : null;
  if (!today && !previousBusinessDay) return null;
  const priceDate = transactionWatchlistPriceDateObject(priceRow);
  const session = transactionSimulatorCurrentMarketSession(calendarPayload, "USD", priceDate);
  const basis = resolveUsRegularSessionBasis({
    today: today || {},
    previousBusinessDay: previousBusinessDay || {},
    sessionKey: session?.key || "",
    priceTimestamp: priceDate.toISOString(),
  });
  return basis ? { ...basis, sessionKey: session?.key || "" } : null;
}

async function fetchTransactionWatchlistMinuteBasisClose({ symbol, boundary, cacheKey, source, signal }) {
  const cached = transactionWatchlistKoreanDailyBasisCache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAtMs <= transactionWatchlistKoreanDailyBasisCacheTtlMs) {
    return cached.payload;
  }
  const params = new URLSearchParams({
    symbol,
    interval: "1m",
    count: "40",
    before: boundary,
  });
  try {
    const response = await fetch(`/api/tossinvest/candles?${params.toString()}`, {
      cache: "no-store",
      signal,
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body?.ok === false) return cached?.payload || null;
    const rows = transactionWatchlistMinuteCandleRowsFromPayload(body);
    const basisRow = rows.find((row) => row.close > 0) || null;
    if (!basisRow) return cached?.payload || null;
    const payload = {
      symbol,
      close: basisRow.close,
      timestamp: basisRow.timestamp,
      source,
    };
    transactionWatchlistKoreanDailyBasisCache.set(cacheKey, { payload, fetchedAtMs: Date.now() });
    return payload;
  } catch (fetchError) {
    if (fetchError.name === "AbortError") throw fetchError;
    return cached?.payload || null;
  }
}

async function fetchTransactionWatchlistKoreanDailyBasis(priceRow = {}, signal) {
  const symbol = cleanTransactionWatchlistSymbol(priceRow?.symbol);
  const priceDate = transactionWatchlistPriceDate(priceRow);
  if (!symbol || normalizeMoneyUnit(priceRow?.currency) !== "KRW" || !priceDate) return null;
  const calendar = await fetchTransactionWatchlistMarketCalendar("kr", priceDate, signal);
  const boundary = transactionWatchlistKoreanDailyBasisBoundary(calendar);
  if (!boundary) return null;
  return fetchTransactionWatchlistMinuteBasisClose({
    symbol,
    boundary,
    cacheKey: `kr:${symbol}:${priceDate}:${boundary}`,
    source: "토스 1분봉 전 영업일 정규장 기준가",
    signal,
  });
}

async function fetchTransactionWatchlistUsDailyBasis(priceRow = {}, signal) {
  const symbol = cleanTransactionWatchlistSymbol(priceRow?.symbol);
  const priceDate = transactionWatchlistPriceDate(priceRow);
  if (!symbol || normalizeMoneyUnit(priceRow?.currency) !== "USD" || !priceDate) return null;
  const calendar = await fetchTransactionWatchlistMarketCalendar("us", priceDate, signal);
  const basis = transactionWatchlistUsDailyBasisBoundary(calendar, priceRow);
  if (!basis?.boundary) return null;
  return fetchTransactionWatchlistMinuteBasisClose({
    symbol,
    boundary: basis.boundary,
    cacheKey: `us:${symbol}:${priceDate}:${basis.boundary}`,
    source: basis.source,
    signal,
  });
}

async function fetchTransactionBinanceDailyBasis(priceRow = {}, signal, calendarPayload) {
  const instrument = normalizeTransactionInstrument(priceRow);
  const priceDate = transactionWatchlistPriceDate(priceRow);
  if (instrument?.provider !== "binance" || !instrument.instrumentId || !priceDate) return null;
  const calendar = calendarPayload === undefined
    ? await fetchTransactionWatchlistMarketCalendar("us", priceDate, signal)
    : calendarPayload;
  const basis = transactionWatchlistUsDailyBasisBoundary(calendar, priceRow);
  if (!basis?.boundary) return null;

  const cacheKey = `binance-us:${instrument.instrumentId}:${priceDate}:${basis.boundary}`;
  const cached = transactionWatchlistKoreanDailyBasisCache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAtMs <= transactionWatchlistKoreanDailyBasisCacheTtlMs) {
    return cached.payload;
  }

  const boundaryMs = Date.parse(basis.boundary);
  if (!Number.isFinite(boundaryMs)) return cached?.payload || null;
  const params = new URLSearchParams({
    instrumentId: instrument.instrumentId,
    interval: "1m",
    limit: "3",
    before: new Date(boundaryMs + 59_999).toISOString(),
  });
  try {
    const response = await fetch(`/api/market-data/candles?${params.toString()}`, {
      cache: "no-store",
      signal,
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body?.ok === false) return cached?.payload || null;
    const rows = transactionInvestmentCandleRowsFromPayload(body, "1m");
    const boundaryRow = rows.find((row) => Date.parse(row.timestamp) === boundaryMs);
    const previousRow = rows.filter((row) => Date.parse(row.timestamp) < boundaryMs).at(-1);
    const close = optionalNumericAmount(boundaryRow?.open ?? previousRow?.close);
    if (close === null || close <= 0) return cached?.payload || null;
    const payload = {
      symbol: instrument.symbol,
      instrumentId: instrument.instrumentId,
      close,
      timestamp: boundaryRow?.timestamp || previousRow?.timestamp || basis.boundary,
      source: "Binance 1분봉 미국 정규장 마감 기준가",
    };
    transactionWatchlistKoreanDailyBasisCache.set(cacheKey, { payload, fetchedAtMs: Date.now() });
    return payload;
  } catch (fetchError) {
    if (fetchError.name === "AbortError") throw fetchError;
    return cached?.payload || null;
  }
}

async function fetchTransactionWatchlistDailyBasis(priceRow = {}, signal) {
  return normalizeMoneyUnit(priceRow?.currency) === "USD"
    ? fetchTransactionWatchlistUsDailyBasis(priceRow, signal)
    : fetchTransactionWatchlistKoreanDailyBasis(priceRow, signal);
}

async function fetchTransactionTossWatchlistPrices(symbols = [], signal) {
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
  const dailyBasisPayloads = await Promise.all(
    priceRows.map((row) => fetchTransactionWatchlistDailyBasis(row, signal))
  );
  const priceMap = transactionWatchlistPriceMap(priceRows, candlePayloads, dailyBasisPayloads);
  for (const row of priceRows) {
    const price = priceMap.get(row.symbol);
    if (price && row.instrumentId) priceMap.set(row.instrumentId, price);
  }
  return {
    ...body,
    ok: true,
    result: priceRows,
    priceMap,
    source: "토스 증권 API 가격",
    fetchedAt: new Date().toISOString(),
  };
}

async function fetchTransactionBinanceWatchlistPrices(instruments = [], signal) {
  const normalizedInstruments = normalizeTransactionWatchlistInstrumentsSetting(instruments)
    .filter((instrument) => instrument.provider === "binance");
  if (!normalizedInstruments.length) {
    return { ok: true, result: [], priceMap: new Map(), source: "Binance 공개 시세", fetchedAt: new Date().toISOString() };
  }
  const instrumentIds = normalizedInstruments.map((instrument) => instrument.instrumentId);
  const response = await fetch(
    `/api/market-data/quotes?instrumentIds=${encodeURIComponent(instrumentIds.join(","))}`,
    { cache: "no-store", signal }
  );
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body?.ok === false) {
    throw new Error(body?.error || `HTTP ${response.status}`);
  }
  const priceRows = transactionWatchlistPriceRowsFromPayload(body).map((row) => ({
    ...row,
    provider: "binance",
    instrumentId: cleanTransactionInstrumentId(row.instrumentId) || `binance:spot:${row.symbol}`,
    currency: "USD",
    nativeQuoteAsset: String(row.nativeQuoteAsset || row.quoteAsset || "USDT").toUpperCase(),
  }));
  const calendarDate = transactionWatchlistPriceDate(priceRows[0]);
  const calendarPromise = calendarDate
    ? fetchTransactionWatchlistMarketCalendar("us", calendarDate, signal)
    : Promise.resolve(null);
  const candlePayloadsPromise = Promise.all(normalizedInstruments.map(async (instrument) => {
      const params = new URLSearchParams({
        instrumentId: instrument.instrumentId,
        interval: "1d",
        limit: String(transactionWatchlistCandlePageSize),
      });
      try {
        const candleResponse = await fetch(`/api/market-data/candles?${params.toString()}`, {
          cache: "no-store",
          signal,
        });
        const candleBody = await candleResponse.json().catch(() => ({}));
        if (!candleResponse.ok || candleBody?.ok === false) {
          return { symbol: instrument.symbol, instrumentId: instrument.instrumentId, candles: [] };
        }
        return {
          symbol: instrument.symbol,
          instrumentId: instrument.instrumentId,
          candles: transactionWatchlistUniqueCandleRows(transactionWatchlistCandleRowsFromPayload(candleBody)),
        };
      } catch (fetchError) {
        if (fetchError.name === "AbortError") throw fetchError;
        return { symbol: instrument.symbol, instrumentId: instrument.instrumentId, candles: [] };
      }
    }));
  const [candlePayloads, calendar] = await Promise.all([
    candlePayloadsPromise,
    calendarPromise,
  ]);
  const dailyBasisPayloads = await Promise.all(
    priceRows.map((row) => fetchTransactionBinanceDailyBasis(row, signal, calendar))
  );
  const priceMap = transactionWatchlistPriceMap(priceRows, candlePayloads, dailyBasisPayloads);
  for (const row of priceRows) {
    const price = priceMap.get(row.symbol);
    if (price) priceMap.set(row.instrumentId, price);
  }
  return {
    ...body,
    ok: true,
    result: priceRows,
    priceMap,
    source: body?.source || "Binance 공개 시세",
    fetchedAt: body?.fetchedAt || new Date().toISOString(),
  };
}

async function fetchTransactionWatchlistPrices(instrumentValues = [], signal, options = {}) {
  const instruments = normalizeTransactionWatchlistInstrumentsSetting(instrumentValues);
  const tossSymbols = instruments
    .filter((instrument) => instrument.provider !== "binance")
    .map((instrument) => instrument.symbol);
  const binanceInstruments = instruments.filter((instrument) => instrument.provider === "binance");
  const tasks = [];
  const providers = {};
  if (tossSymbols.length && options.tossReady !== false) {
    tasks.push(["toss", fetchTransactionTossWatchlistPrices(tossSymbols, signal)]);
  } else if (tossSymbols.length) {
    providers.toss = { ok: false, skipped: true, error: options.tossMessage || "토스증권 API 연결이 필요합니다." };
  }
  if (binanceInstruments.length) {
    tasks.push(["binance", fetchTransactionBinanceWatchlistPrices(binanceInstruments, signal)]);
  }
  if (!tasks.length) {
    const skippedMessage = providers.toss?.error || "가격을 조회할 상품이 없습니다.";
    if (tossSymbols.length) throw new Error(skippedMessage);
    return { ok: true, result: [], priceMap: new Map(), providers, fetchedAt: new Date().toISOString() };
  }
  const settled = await Promise.allSettled(tasks.map(([, promise]) => promise));
  const priceMap = new Map();
  const result = [];
  const sources = [];
  settled.forEach((entry, index) => {
    const provider = tasks[index][0];
    if (entry.status === "rejected") {
      if (entry.reason?.name === "AbortError") throw entry.reason;
      providers[provider] = { ok: false, error: entry.reason?.message || "시세를 불러오지 못했습니다." };
      return;
    }
    const payload = entry.value;
    providers[provider] = { ok: true, source: payload.source || "", fetchedAt: payload.fetchedAt || "" };
    result.push(...(Array.isArray(payload.result) ? payload.result : []));
    sources.push(payload.source || provider);
    for (const [key, value] of payload.priceMap || []) priceMap.set(key, value);
  });
  if (!priceMap.size && Object.values(providers).some((provider) => provider.ok === false)) {
    throw new Error(Object.values(providers).find((provider) => provider.error)?.error || "시세를 불러오지 못했습니다.");
  }
  return {
    ok: true,
    result,
    priceMap,
    providers,
    partial: Object.values(providers).some((provider) => provider.ok === false),
    source: sources.filter(Boolean).join(" + "),
    fetchedAt: new Date().toISOString(),
  };
}

async function fetchInvestSimulatorAccounts(signal) {
  const response = await fetch("/api/invest-simulator/accounts", {
    cache: "no-store",
    signal,
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body?.ok === false) {
    throw new Error(body?.error || `HTTP ${response.status}`);
  }
  return body;
}

async function postInvestSimulatorAccount(payload = {}, signal) {
  const response = await fetch("/api/invest-simulator/accounts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    signal,
    body: JSON.stringify(payload || {}),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body?.ok === false) {
    throw new Error(body?.error || `HTTP ${response.status}`);
  }
  return body;
}

async function patchInvestSimulatorAccount(payload = {}, signal) {
  const response = await fetch("/api/invest-simulator/accounts", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    signal,
    body: JSON.stringify(payload || {}),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body?.ok === false) {
    throw new Error(body?.error || `HTTP ${response.status}`);
  }
  return body;
}

async function deleteInvestSimulatorAccount(simulatorId, signal) {
  const cleanId = cleanTransactionSimulatorId(simulatorId);
  if (!cleanId) throw new Error("삭제할 시뮬레이터 계좌를 찾지 못했습니다.");
  const response = await fetch(`/api/invest-simulator/accounts?simulatorId=${encodeURIComponent(cleanId)}`, {
    method: "DELETE",
    cache: "no-store",
    signal,
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body?.ok === false) {
    throw new Error(body?.error || `HTTP ${response.status}`);
  }
  return body;
}

async function postInvestSimulatorExchange(payload = {}, signal) {
  const response = await fetch("/api/invest-simulator/exchange", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    signal,
    body: JSON.stringify(payload || {}),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body?.ok === false) {
    throw new Error(body?.error || `HTTP ${response.status}`);
  }
  return body;
}

async function postInvestSimulatorBuy(payload = {}, signal) {
  const response = await fetch("/api/invest-simulator/orders", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    signal,
    body: JSON.stringify(payload || {}),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body?.ok === false) {
    throw new Error(body?.error || `HTTP ${response.status}`);
  }
  return body;
}

async function postInvestSimulatorSell(payload = {}, signal) {
  const response = await fetch("/api/invest-simulator/orders", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    signal,
    body: JSON.stringify({ ...(payload || {}), side: "sell" }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body?.ok === false) {
    throw new Error(body?.error || `HTTP ${response.status}`);
  }
  return body;
}

function transactionSimulatorPriceFromPayload(payload = {}, symbol = "", fallbackUnit = "KRW") {
  const cleanSymbol = cleanTransactionWatchlistSymbol(symbol);
  const rows = Array.isArray(payload?.result) ? payload.result : Array.isArray(payload) ? payload : [];
  const row = rows.find((item) => cleanTransactionWatchlistSymbol(item?.symbol) === cleanSymbol) || rows[0] || null;
  if (!row) return null;
  const lastPrice = optionalNumericAmount(row?.lastPrice ?? row?.price ?? row?.closePrice ?? row?.close);
  if (lastPrice === null || lastPrice <= 0) return null;
  return {
    price: lastPrice,
    currency: normalizeMoneyUnit(row?.currency || fallbackUnit),
    timestamp: String(row?.timestamp || row?.dateTime || row?.time || "").trim(),
    source: "토스 증권 API 가격",
  };
}

async function fetchTransactionSimulatorExecutionPrice(symbol, settlementUnit = "KRW", signal) {
  const instrument = normalizeTransactionInstrument(symbol);
  const cleanSymbol = cleanTransactionWatchlistSymbol(instrument?.symbol ?? symbol);
  if (!cleanSymbol) throw new Error("매수할 종목을 찾지 못했습니다.");
  const route = instrument?.provider === "binance"
    ? `/api/market-data/execution-price?instrumentId=${encodeURIComponent(instrument.instrumentId)}`
    : `/api/tossinvest/prices?symbols=${encodeURIComponent(cleanSymbol)}`;
  const response = await fetch(route, {
    cache: "no-store",
    signal,
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body?.ok === false) {
    throw new Error(body?.error || `HTTP ${response.status}`);
  }
  const executionResult = body?.result && !Array.isArray(body.result) ? body.result : null;
  const price = instrument?.provider === "binance" && executionResult
    ? {
        price: optionalNumericAmount(executionResult.lastPrice ?? executionResult.price),
        currency: "USD",
        timestamp: String(executionResult.timestamp || body?.fetchedAt || "").trim(),
        source: body?.source || "Binance 공개 현재가",
      }
    : transactionSimulatorPriceFromPayload(body, cleanSymbol, settlementUnit);
  if (!price || !Number.isFinite(Number(price.price)) || Number(price.price) <= 0) {
    throw new Error("시장가 체결에 사용할 현재가를 확인하지 못했습니다.");
  }
  if (normalizeMoneyUnit(price.currency) !== normalizeMoneyUnit(settlementUnit)) {
    throw new Error(`현재가 통화(${price.currency})와 결제 통화(${settlementUnit})가 다릅니다.`);
  }
  return price;
}

function mergeTransactionWatchlistSymbolOptions(...optionGroups) {
  const byInstrument = new Map();
  for (const group of optionGroups) {
    for (const option of Array.isArray(group) ? group : []) {
      const instrument = normalizeTransactionInstrument(option);
      if (!instrument) continue;
      const key = instrument.instrumentId;
      byInstrument.set(key, normalizeTransactionInstrument({
        ...(byInstrument.get(key) || {}),
        ...instrument,
        name: String(instrument.name || byInstrument.get(key)?.name || instrument.symbol).trim(),
      }));
    }
  }
  return [...byInstrument.values()];
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

function transactionSimulatorBuyPresets(unit = "KRW") {
  return normalizeMoneyUnit(unit) === "USD"
    ? [
        { label: "$10", amount: 10 },
        { label: "$100", amount: 100 },
        { label: "$500", amount: 500 },
      ]
    : [
        { label: "1천원", amount: 1_000 },
        { label: "1만원", amount: 10_000 },
        { label: "10만원", amount: 100_000 },
      ];
}

const transactionSimulatorSellFractions = [
  { label: "10%", fraction: 0.1 },
  { label: "25%", fraction: 0.25 },
  { label: "50%", fraction: 0.5 },
  { label: "전액", fraction: 1 },
];

function transactionSimulatorOrderNotificationMessage({ side = "buy", symbol = "", amount = 0, unit = "KRW" }) {
  const actionLabel = side === "sell" ? "매도" : "매수";
  const ticker = cleanTransactionWatchlistSymbol(symbol) || "주문";
  return `${ticker} ${formatMoney(amount, unit)} ${actionLabel} 주문 체결이 성공했습니다.`;
}

function transactionSimulatorStockOptionFromItem(item = {}) {
  const symbol = cleanTransactionWatchlistSymbol(item?.symbol);
  if (!symbol) return null;
  return normalizeTransactionInstrument({
    ...item,
    symbol,
    name: displayName(item),
    englishName: String(item?.englishName || "").trim(),
    market: String(item?.market || "").trim(),
    status: String(item?.status || "ACTIVE").trim(),
    source: "simulator-position",
  });
}

function transactionSimulatorSettlementUnit(option = {}) {
  const instrument = normalizeTransactionInstrument(option);
  if (instrument?.provider === "binance") return "USD";
  const symbol = cleanTransactionWatchlistSymbol(option?.symbol);
  const market = String(option?.market || option?.exchange || "").toUpperCase();
  if (/^\d{6}$/.test(symbol) || /KOSPI|KOSDAQ|KONEX|KRX|KOREA|SEOUL/.test(market)) return "KRW";
  if (/NASDAQ|NYSE|AMEX|ARCA|OTC|BATS|US/.test(market)) return "USD";
  return symbol && /^[A-Z][A-Z0-9.-]*$/.test(symbol) ? "USD" : "KRW";
}

function transactionSimulatorMarketCalendarCode(settlementUnit = "KRW") {
  return normalizeMoneyUnit(settlementUnit) === "USD" ? "us" : "kr";
}

function transactionSimulatorCalendarDateInTimeZone(timeZone, date = new Date()) {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(date);
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    if (values.year && values.month && values.day) return `${values.year}-${values.month}-${values.day}`;
  } catch {
    // Fall back to local date below.
  }
  return date.toISOString().slice(0, 10);
}

function transactionSimulatorCalendarDate(settlementUnit = "KRW", date = new Date()) {
  return normalizeMoneyUnit(settlementUnit) === "USD"
    ? transactionSimulatorCalendarDateInTimeZone("America/New_York", date)
    : transactionSimulatorCalendarDateInTimeZone("Asia/Seoul", date);
}

function transactionSimulatorCalendarResult(payload = {}) {
  if (payload?.result && typeof payload.result === "object" && !Array.isArray(payload.result)) return payload.result;
  if (payload && typeof payload === "object" && !Array.isArray(payload)) return payload;
  return null;
}

function transactionSimulatorCalendarSessions(payload = {}, settlementUnit = "KRW") {
  const result = transactionSimulatorCalendarResult(payload);
  const today = result?.today && typeof result.today === "object" ? result.today : null;
  if (!today) return [];
  if (normalizeMoneyUnit(settlementUnit) === "USD") {
    return [
      { key: "dayMarket", label: "데이마켓", session: today.dayMarket },
      { key: "preMarket", label: "프리장", session: today.preMarket },
      { key: "regularMarket", label: "정규장", session: today.regularMarket },
      { key: "afterMarket", label: "애프터장", session: today.afterMarket },
    ];
  }
  const integrated = today.integrated && typeof today.integrated === "object" ? today.integrated : null;
  return [
    { key: "preMarket", label: "프리장", session: integrated?.preMarket },
    { key: "regularMarket", label: "정규장", session: integrated?.regularMarket },
    { key: "afterMarket", label: "애프터장", session: integrated?.afterMarket },
  ];
}

function transactionSimulatorCurrentMarketSession(payload = {}, settlementUnit = "KRW", date = new Date()) {
  const now = date.getTime();
  const sessions = transactionSimulatorCalendarSessions(payload, settlementUnit);
  for (const item of sessions) {
    const startTime = Date.parse(item.session?.startTime || "");
    const endTime = Date.parse(item.session?.endTime || "");
    if (!Number.isFinite(startTime) || !Number.isFinite(endTime)) continue;
    if (now >= startTime && now < endTime) return { key: item.key, label: item.label, ...item.session };
  }
  return null;
}

function transactionSimulatorCalendarUnitsForItems(items = []) {
  const units = new Set();
  for (const item of Array.isArray(items) ? items : []) {
    const unit = normalizeMoneyUnit(item?.currency || item?.displayCurrency || "KRW");
    units.add(unit);
  }
  return [...units].sort();
}

function transactionBinanceProviderAvailability(payload = null, error = "") {
  if (error) return { ready: true, available: false, reason: error };
  if (!payload) return { ready: false, available: false, reason: "Binance 공개 시세 연결을 확인하는 중입니다." };
  const result = payload?.result && typeof payload.result === "object" ? payload.result : payload;
  const stale = result?.stale === true || String(result?.status || "").toLowerCase() === "stale";
  const degraded = result?.degraded === true || String(result?.status || "").toLowerCase() === "degraded";
  const unavailable = result?.available === false || result?.ready === false || result?.connected === false;
  if (stale) return { ready: true, available: false, reason: "Binance 시세가 오래되어 주문할 수 없습니다." };
  if (degraded) return { ready: true, available: false, reason: "Binance 시세 공급자가 불안정해 주문을 잠시 막았습니다." };
  if (unavailable) return { ready: true, available: false, reason: result?.message || "Binance 공개 시세를 사용할 수 없습니다." };
  return { ready: true, available: true, reason: "" };
}

function transactionSidebarPriceModeLabel(items = [], marketCalendars = {}) {
  const units = transactionSimulatorCalendarUnitsForItems(items);
  if (!units.length) return "현재가";
  let knownCount = 0;
  let openCount = 0;
  for (const unit of units) {
    const calendar = marketCalendars?.[unit];
    if (!calendar) continue;
    knownCount += 1;
    if (transactionSimulatorCurrentMarketSession(calendar, unit)) {
      openCount += 1;
    }
  }
  if (!knownCount) return "현재가";
  if (openCount <= 0 && knownCount === units.length) return "최신 종가";
  if (openCount > 0 && openCount < knownCount) return "가격";
  return "현재가";
}

function transactionSimulatorBuyTradingEligibility({
  selectedSymbol,
  marketCalendar,
  marketCalendarLoading = false,
  marketCalendarError = "",
  binanceStatus = null,
  binanceError = "",
  date = new Date(),
} = {}) {
  const symbol = cleanTransactionWatchlistSymbol(selectedSymbol?.symbol);
  if (!symbol) {
    return { ready: false, canTrade: false, label: "거래 시간 확인 대기", reason: "종목을 선택하세요." };
  }
  const instrument = normalizeTransactionInstrument(selectedSymbol);
  if (instrument?.provider === "binance" || instrument?.sessionPolicy === "24x7") {
    if (String(instrument.status || "").toUpperCase() !== "TRADING") {
      return { ready: true, canTrade: false, label: "거래 불가", reason: "Binance 상품 거래 상태가 TRADING이 아닙니다." };
    }
    const providerAvailability = transactionBinanceProviderAvailability(binanceStatus, binanceError);
    if (!providerAvailability.available) {
      return {
        ready: providerAvailability.ready,
        canTrade: false,
        label: providerAvailability.ready ? "거래 불가 · 시세 공급자 확인" : "Binance 연결 확인 중",
        reason: providerAvailability.reason,
      };
    }
    return {
      ready: true,
      canTrade: true,
      label: instrument.marketType === "usdm"
        ? "Binance USDⓈ-M 선물 · 24시간 주문 가능"
        : "Binance Spot · 24시간 주문 가능",
      sessionKey: "24x7",
      sessionLabel: "24시간",
    };
  }
  if (marketCalendarLoading) {
    return { ready: false, canTrade: false, label: "거래 시간 확인 중", reason: "장 운영 정보를 확인하는 중입니다." };
  }
  if (marketCalendarError) {
    return { ready: false, canTrade: false, label: "거래 시간 확인 실패", reason: marketCalendarError };
  }
  if (!marketCalendar) {
    return { ready: false, canTrade: false, label: "거래 시간 확인 중", reason: "장 운영 정보를 확인하는 중입니다." };
  }
  const settlementUnit = transactionSimulatorSettlementUnit(selectedSymbol);
  const stockStatus = String(selectedSymbol?.status || "").toUpperCase();
  if (stockStatus && stockStatus !== "ACTIVE") {
    return {
      ready: true,
      canTrade: false,
      label: "거래 불가",
      reason: "Toss 종목 상태가 활성 상태가 아닙니다.",
    };
  }
  const session = transactionSimulatorCurrentMarketSession(marketCalendar, settlementUnit, date);
  if (!session) {
    return {
      ready: true,
      canTrade: false,
      label: "거래 불가 · 장 운영 시간 아님",
      reason: "현재 운영 중인 거래 세션이 아닙니다.",
    };
  }
  if (normalizeMoneyUnit(settlementUnit) === "USD") {
    return {
      ready: true,
      canTrade: true,
      label: `거래 시간 ${session.label} · 주문 가능`,
      sessionKey: session.key,
      sessionLabel: session.label,
    };
  }
  const koreanMarketDetail =
    selectedSymbol?.koreanMarketDetail && typeof selectedSymbol.koreanMarketDetail === "object"
      ? selectedSymbol.koreanMarketDetail
      : null;
  if (koreanMarketDetail?.krxTradingSuspended === true) {
    return {
      ready: true,
      canTrade: false,
      label: `거래 불가 · ${session.label}`,
      reason: "KRX 거래정지 종목은 주문할 수 없습니다.",
      sessionKey: session.key,
      sessionLabel: session.label,
    };
  }
  if (session.key === "regularMarket") {
    return {
      ready: true,
      canTrade: true,
      label: "거래 시간 정규장 · 주문 가능",
      sessionKey: session.key,
      sessionLabel: session.label,
    };
  }
  if (!koreanMarketDetail) {
    return {
      ready: true,
      canTrade: false,
      label: `거래 확인 필요 · ${session.label}`,
      reason: "프리/애프터장 주문에는 NXT 지원 상태 확인이 필요합니다.",
      sessionKey: session.key,
      sessionLabel: session.label,
    };
  }
  if (koreanMarketDetail.nxtSupported === false) {
    return {
      ready: true,
      canTrade: false,
      label: `거래 불가 · ${session.label}`,
      reason: "프리/애프터장에는 NXT 미지원 종목을 제외합니다.",
      sessionKey: session.key,
      sessionLabel: session.label,
    };
  }
  if (koreanMarketDetail.nxtTradingSuspended === true) {
    return {
      ready: true,
      canTrade: false,
      label: `거래 불가 · ${session.label}`,
      reason: "프리/애프터장에는 NXT 거래정지 종목을 제외합니다.",
      sessionKey: session.key,
      sessionLabel: session.label,
    };
  }
  return {
    ready: true,
    canTrade: true,
    label: `거래 시간 ${session.label} · 주문 가능`,
    sessionKey: session.key,
    sessionLabel: session.label,
  };
}

function transactionSimulatorCurrencyLabel(unit = "KRW") {
  return normalizeMoneyUnit(unit) === "USD" ? "달러" : "원화";
}

function transactionSimulatorMinimumSettlementBuyAmount(settlementUnit = "KRW", usdKrwRate = 0) {
  if (normalizeMoneyUnit(settlementUnit) === "KRW") return transactionSimulatorMinimumBuyKrw;
  const krwEquivalent = convertMoney(transactionSimulatorMinimumBuyKrw, "KRW", "USD", usdKrwRate);
  if (krwEquivalent !== null && krwEquivalent > 0 && krwEquivalent < transactionSimulatorMinimumBuyUsd) {
    return Math.ceil(krwEquivalent * 100) / 100;
  }
  return transactionSimulatorMinimumBuyUsd;
}

function transactionSimulatorMinimumOrderAmount(orderUnit = "KRW", settlementUnit = "KRW", usdKrwRate = 0) {
  const minimumSettlement = transactionSimulatorMinimumSettlementBuyAmount(settlementUnit, usdKrwRate);
  const amount = convertMoney(minimumSettlement, settlementUnit, orderUnit, usdKrwRate);
  if (amount === null) return null;
  return normalizeMoneyUnit(orderUnit) === "USD" ? Math.ceil(amount * 100) / 100 : Math.ceil(amount);
}

function transactionSimulatorMinimumBuyLabel(orderUnit = "KRW", settlementUnit = "KRW", usdKrwRate = 0) {
  const displayUnit = normalizeMoneyUnit(orderUnit);
  const settlementDisplayUnit = normalizeMoneyUnit(settlementUnit);
  const minimum = transactionSimulatorMinimumOrderAmount(displayUnit, settlementDisplayUnit, usdKrwRate);
  if (minimum === null) return "환율 확인 필요";
  if (displayUnit !== settlementDisplayUnit) {
    const basis = settlementDisplayUnit === "KRW"
      ? "원화 1만원 기준"
      : `달러 최소 ${formatUsd(transactionSimulatorMinimumSettlementBuyAmount("USD", usdKrwRate))} 기준`;
    return `${formatMoney(minimum, displayUnit)} (${basis})`;
  }
  return formatMoney(minimum, displayUnit);
}

function transactionSimulatorBuyAvailableAmount(simulator = {}, unit = "KRW") {
  return normalizeMoneyUnit(unit) === "USD"
    ? numericAmount(simulator.cashUsd ?? simulator.balances?.USD, 0)
    : numericAmount(simulator.cashKrw ?? simulator.balances?.KRW, 0);
}

function transactionSimulatorPositionSettlementValue(position = {}) {
  const quantity = numericAmount(position.quantity, 0);
  const price = numericAmount(position.currentPrice ?? position.lastPrice, 0);
  const value = numericAmount(position.value ?? position.rawValue, 0);
  if (value > 0) return value;
  return quantity > 0 && price > 0 ? quantity * price : 0;
}

function cleanTransactionSimulatorBuyAmountDraft(value, unit = "KRW") {
  const displayUnit = normalizeMoneyUnit(unit);
  const source = String(value ?? "").replace(/,/g, "").trim();
  if (displayUnit === "KRW") {
    return source.replace(/\D/g, "").slice(0, 14);
  }
  const cleaned = source.replace(/[^\d.]/g, "");
  const [head = "", ...tail] = cleaned.split(".");
  const integerPart = head.replace(/\D/g, "").slice(0, 10);
  if (!tail.length) return integerPart;
  return `${integerPart}.${tail.join("").replace(/\D/g, "").slice(0, 2)}`;
}

function transactionSimulatorBuyAmountValue(value) {
  const amount = Number(String(value || "").replace(/,/g, ""));
  return Number.isFinite(amount) ? amount : 0;
}

function formatTransactionSimulatorBuyAmountDraft(value, unit = "KRW") {
  const displayUnit = normalizeMoneyUnit(unit);
  const amount = Number(value || 0);
  if (!Number.isFinite(amount) || amount <= 0) return "";
  if (displayUnit === "KRW") return String(Math.round(amount));
  return amount.toFixed(2).replace(/\.?0+$/, "");
}

const transactionSimulatorExchangeModes = [
  { id: "KRW_TO_USD", label: "원화 → 달러", fromUnit: "KRW", toUnit: "USD" },
  { id: "USD_TO_KRW", label: "달러 → 원화", fromUnit: "USD", toUnit: "KRW" },
];

function transactionSimulatorExchangeMode(modeId = "KRW_TO_USD") {
  return transactionSimulatorExchangeModes.find((mode) => mode.id === modeId) || transactionSimulatorExchangeModes[0];
}

function cleanTransactionSimulatorExchangeAmountDraft(value, modeId = "KRW_TO_USD") {
  const mode = transactionSimulatorExchangeMode(modeId);
  return cleanTransactionSimulatorBuyAmountDraft(value, mode.fromUnit);
}

function formatTransactionSimulatorExchangeAmountDraft(value, modeId = "KRW_TO_USD") {
  const mode = transactionSimulatorExchangeMode(modeId);
  return formatTransactionSimulatorBuyAmountDraft(value, mode.fromUnit);
}

function transactionSimulatorExchangeAmountValue(value) {
  return transactionSimulatorBuyAmountValue(value);
}

function transactionSimulatorExchangeOutputAmount(fromAmount, modeId = "KRW_TO_USD", usdKrwRate = 0) {
  const mode = transactionSimulatorExchangeMode(modeId);
  return convertMoney(fromAmount, mode.fromUnit, mode.toUnit, usdKrwRate);
}

function transactionSimulatorExchangeRateText(usdKrwRate = 0) {
  const rate = Number(usdKrwRate || 0);
  if (!Number.isFinite(rate) || rate <= 0) return "환율 확인 필요";
  return `$1 = ${formatKrw(rate)}`;
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

function cleanTransactionSimulatorId(value) {
  return String(value ?? "").trim().replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 96);
}

function cleanTransactionSimulatorName(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
}

function simulatorDisplayLabel(simulator = {}, index = 0) {
  return cleanTransactionSimulatorName(simulator.name) || `투자 시뮬레이터 ${index + 1}`;
}

function normalizeTransactionSimulatorAccount(source = {}, index = 0, usedIds = new Set()) {
  const baseId = cleanTransactionSimulatorId(source.id) || `simulator-${index + 1}`;
  let id = baseId;
  let suffix = 2;
  while (usedIds.has(id)) {
    id = `${baseId}-${suffix}`;
    suffix += 1;
  }
  usedIds.add(id);
  const cashKrw = numericAmount(source.cashKrw ?? source.krwCash ?? source.balances?.KRW, transactionSimulatorInitialKrw);
  const cashUsd = numericAmount(source.cashUsd ?? source.usdCash ?? source.balances?.USD, transactionSimulatorInitialUsd);
  const createdAt = typeof source.createdAt === "string" && source.createdAt ? source.createdAt : new Date().toISOString();
  const items = Array.isArray(source.items) ? source.items : [];
  return {
    id,
    name: simulatorDisplayLabel(source, index),
    cashKrw,
    cashUsd,
    items,
    positionCount: Number(source.positionCount ?? items.length) || 0,
    totalValueKrw: numericAmount(source.totalValueKrw, 0),
    totalValueUsd: numericAmount(source.totalValueUsd, 0),
    totalCostBasisKrw: numericAmount(source.totalCostBasisKrw, 0),
    totalCostBasisUsd: numericAmount(source.totalCostBasisUsd, 0),
    createdAt,
    updatedAt: typeof source.updatedAt === "string" && source.updatedAt ? source.updatedAt : createdAt,
  };
}

function normalizeTransactionSimulatorAccounts(value) {
  const sourceAccounts = Array.isArray(value?.accounts) ? value.accounts : Array.isArray(value) ? value : [];
  const usedIds = new Set();
  return sourceAccounts.map((account, index) => (
    normalizeTransactionSimulatorAccount(account && typeof account === "object" ? account : {}, index, usedIds)
  ));
}

function readStoredTransactionSimulators() {
  if (typeof window === "undefined" || !window.localStorage) return [];
  try {
    const raw = window.localStorage.getItem(transactionSimulatorStorageKey);
    if (!raw) return [];
    return normalizeTransactionSimulatorAccounts(JSON.parse(raw));
  } catch {
    return [];
  }
}

function clearStoredTransactionSimulators() {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    window.localStorage.removeItem(transactionSimulatorStorageKey);
  } catch {
    // The SQLite-backed store remains authoritative even if prototype storage cleanup fails.
  }
}

function transactionSimulatorMarketDateForTimestamp(timestamp, itemUnit) {
  const time = Date.parse(String(timestamp || ""));
  if (!Number.isFinite(time)) return transactionSimulatorCalendarDate(itemUnit);
  return transactionSimulatorCalendarDate(itemUnit, new Date(time));
}

function transactionSimulatorSameDayLotBasis(item = {}, itemUnit = "KRW", marketDate = "") {
  const lots = Array.isArray(item.lots) ? item.lots : [];
  if (!lots.length || !marketDate) return { quantity: 0, costBasis: 0 };
  let quantity = 0;
  let costBasis = 0;
  for (const lot of lots) {
    if (String(lot?.side || "buy").toLowerCase() !== "buy") continue;
    const lotDate = transactionSimulatorMarketDateForTimestamp(lot?.executedAt, itemUnit);
    if (lotDate !== marketDate) continue;
    const lotQuantity = numericAmount(lot?.quantity, 0);
    if (lotQuantity <= 0) continue;
    const lotCostBasis = numericAmount(
      lot?.costBasis ?? lot?.grossAmount,
      lotQuantity * numericAmount(lot?.price, 0)
    );
    quantity += lotQuantity;
    costBasis += lotCostBasis;
  }
  return { quantity, costBasis };
}

function transactionSimulatorDailyBaseline({
  item,
  itemUnit,
  quantity,
  previousClose,
  priceTimestamp,
} = {}) {
  const marketDate = transactionSimulatorMarketDateForTimestamp(priceTimestamp, itemUnit);
  let sameDayBasis = transactionSimulatorSameDayLotBasis(item, itemUnit, marketDate);
  if (sameDayBasis.quantity <= 0) {
    const currentMarketDate = transactionSimulatorCalendarDate(itemUnit);
    if (currentMarketDate && currentMarketDate !== marketDate) {
      sameDayBasis = transactionSimulatorSameDayLotBasis(item, itemUnit, currentMarketDate);
    }
  }
  const sameDayQuantity = Math.min(Math.max(quantity, 0), Math.max(sameDayBasis.quantity, 0));
  const sameDayCostBasis =
    sameDayBasis.quantity > 0 && sameDayQuantity > 0
      ? sameDayBasis.costBasis * (sameDayQuantity / sameDayBasis.quantity)
      : 0;
  const carriedQuantity = Math.max(0, quantity - sameDayQuantity);
  if (previousClose > 0) {
    return previousClose * carriedQuantity + sameDayCostBasis;
  }
  if (carriedQuantity <= 0 && sameDayCostBasis > 0) {
    return sameDayCostBasis;
  }
  return 0;
}

function transactionSimulatorItemsWithPrices(items = [], priceMap = new Map()) {
  if (!Array.isArray(items) || !items.length || !(priceMap instanceof Map) || !priceMap.size) {
    return Array.isArray(items) ? items : [];
  }
  return items.map((item) => {
    const symbol = transactionItemOrderKey(item);
    const instrumentId = transactionInstrumentKey(item);
    const price = instrumentId ? priceMap.get(instrumentId) : (symbol ? priceMap.get(symbol) : null);
    const livePrice = Number(price?.lastPrice);
    if (!price || !Number.isFinite(livePrice) || livePrice <= 0) return item;

    const itemUnit = normalizeMoneyUnit(item.currency || item.displayCurrency || price.currency || "KRW");
    const priceUnit = normalizeMoneyUnit(price.currency || itemUnit);
    if (priceUnit !== itemUnit) return item;

    const quantity = numericAmount(item.quantity, 0);
    const costBasis = numericAmount(
      item.costBasis ?? (itemUnit === "USD" ? item.knownCostBasisUsd : item.knownCostBasisKrw),
      0
    );
    const value = quantity * livePrice;
    const profit = value - costBasis;
    const profitPercent = costBasis ? (profit / Math.abs(costBasis)) * 100 : 0;
    const priceDailyReturnPercent = Number(price.dailyReturnPercent);
    const hasDailyReturn = Boolean(price.hasDailyReturn && Number.isFinite(priceDailyReturnPercent));
    const previousClose = numericAmount(price.previousClose, 0);
    const marketDailyReturnPercent = hasDailyReturn
      ? priceDailyReturnPercent
      : transactionWatchlistReturnPercent(livePrice, previousClose);
    const hasMarketDailyReturn = Number.isFinite(marketDailyReturnPercent);
    const dailyBaseline = transactionSimulatorDailyBaseline({
      item,
      itemUnit,
      quantity,
      previousClose,
      priceTimestamp: price.timestamp || price.raw?.timestamp || price.raw?.dateTime || price.raw?.time || "",
    });
    const hasDailyBaseline = dailyBaseline > 0;
    const dailyProfit = hasDailyBaseline
      ? value - dailyBaseline
      : hasDailyReturn && previousClose > 0
        ? (livePrice - previousClose) * quantity
        : numericAmount(item.dailyProfit, 0);
    const dailyReturnPercent = hasDailyBaseline
      ? (dailyProfit / Math.abs(dailyBaseline)) * 100
      : hasDailyReturn
        ? priceDailyReturnPercent
        : numericAmount(item.dailyReturnPercent, 0);

    return {
      ...item,
      instrumentId: price.instrumentId || item.instrumentId,
      provider: price.provider || item.provider,
      marketType: price.marketType || item.marketType,
      venue: price.venue || item.venue,
      market: price.market || item.market,
      assetClass: price.assetClass || item.assetClass,
      name: displayName({ ...item, ...price }),
      englishName: String(price.englishName || price.name || item.englishName || "").trim(),
      assetName: String(price.assetName || item.assetName || "").trim(),
      quoteAssetName: String(price.quoteAssetName || item.quoteAssetName || "").trim(),
      tags: Array.isArray(price.tags) && price.tags.length ? price.tags : item.tags,
      currentPrice: livePrice,
      value,
      rawValue: value,
      profit,
      profitPercent,
      dailyProfit,
      dailyReturnPercent,
      hasDailyReturn: hasDailyBaseline || hasDailyReturn,
      previousClose,
      marketDailyReturnPercent: hasMarketDailyReturn ? marketDailyReturnPercent : null,
      marketDailyProfit: previousClose > 0 ? (livePrice - previousClose) * quantity : null,
      hasMarketDailyReturn,
      dailyBaseline,
      currentPriceTimestamp: price.timestamp || item.currentPriceTimestamp || "",
      marketValueKrw: itemUnit === "KRW" ? value : 0,
      marketValueUsd: itemUnit === "USD" ? value : 0,
      knownCostBasisKrw: itemUnit === "KRW" ? costBasis : 0,
      knownCostBasisUsd: itemUnit === "USD" ? costBasis : 0,
    };
  });
}

function transactionSimulatorTotalsFromItems(items = []) {
  const totals = {
    totalValueKrw: 0,
    totalValueUsd: 0,
    totalCostBasisKrw: 0,
    totalCostBasisUsd: 0,
  };
  for (const item of items) {
    const itemUnit = normalizeMoneyUnit(item.currency || item.displayCurrency || "KRW");
    const value = numericAmount(item.value, 0);
    const costBasis = numericAmount(item.costBasis, 0);
    if (itemUnit === "USD") {
      totals.totalValueUsd += value;
      totals.totalCostBasisUsd += costBasis;
    } else {
      totals.totalValueKrw += value;
      totals.totalCostBasisKrw += costBasis;
    }
  }
  return totals;
}

function transactionSimulatorDailyReturnPercent(items = []) {
  let dailyProfit = 0;
  let previousValue = 0;
  for (const item of items) {
    if (!item?.hasDailyReturn) continue;
    const itemDailyProfit = numericAmount(item.dailyProfit, 0);
    const itemValue = numericAmount(item.value, 0);
    dailyProfit += itemDailyProfit;
    previousValue += itemValue - itemDailyProfit;
  }
  return previousValue ? (dailyProfit / Math.abs(previousValue)) * 100 : 0;
}

function transactionSimulatorDefaultDisplayUnit(simulator = {}, items = []) {
  const hasKrwItems = items.some((item) => normalizeMoneyUnit(item.currency || item.displayCurrency) === "KRW");
  const hasUsdItems = items.some((item) => normalizeMoneyUnit(item.currency || item.displayCurrency) === "USD");
  if (hasUsdItems && !hasKrwItems) return "USD";
  if (hasKrwItems && !hasUsdItems) return "KRW";
  const hasKrwCash = numericAmount(simulator.cashKrw, 0) > 0;
  const hasUsdCash = numericAmount(simulator.cashUsd, 0) > 0;
  if (hasUsdCash && !hasKrwCash) return "USD";
  if (hasKrwCash && !hasUsdCash) return "KRW";
  return normalizeMoneyUnit(simulator.baseCurrency || "KRW");
}

function transactionAvailableDisplayUnit(requestedUnit, fallbackUnit, items = [], usdKrwRate = 0) {
  const requested = normalizeMoneyUnit(requestedUnit);
  if (numericAmount(usdKrwRate, 0) > 0) return requested;
  const itemUnits = new Set(
    (Array.isArray(items) ? items : [])
      .map((item) => normalizeMoneyUnit(item?.currency || item?.displayCurrency || fallbackUnit))
      .filter(Boolean),
  );
  if (itemUnits.size === 1) return [...itemUnits][0];
  return requested;
}

function transactionSimulatorPayload(simulator = null, priceMap = new Map(), pricePayload = null) {
  if (!simulator) return null;
  const items = transactionSimulatorItemsWithPrices(simulator.items, priceMap);
  const totals = transactionSimulatorTotalsFromItems(items);
  const hasLivePrices = priceMap instanceof Map && priceMap.size > 0;
  const defaultDisplayUnit = transactionSimulatorDefaultDisplayUnit(simulator, items);
  return {
    ok: true,
    source: hasLivePrices ? "투자 시뮬레이터 로컬 장부 + 시세 공급자 현재가" : "투자 시뮬레이터 로컬 장부",
    sourceMode: "simulator",
    unit: defaultDisplayUnit,
    accountSeq: simulator.id,
    accounts: [],
    items,
    cashKrw: Number(simulator.cashKrw || 0),
    cashUsd: Number(simulator.cashUsd || 0),
    balances: {
      KRW: Number(simulator.cashKrw || 0),
      USD: Number(simulator.cashUsd || 0),
    },
    ...totals,
    dailyReturnPercent: transactionSimulatorDailyReturnPercent(items),
    fetchedAt: pricePayload?.fetchedAt || simulator.updatedAt || simulator.createdAt || new Date().toISOString(),
  };
}

function simulatorAccountsFromApiPayload(payload = {}) {
  return normalizeTransactionSimulatorAccounts(payload?.accounts || []);
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
    const originalIndex = new Map(items.map((item, index) => [transactionItemSelectionKey(item), index]));
    return [...items].sort((left, right) => {
      const leftKey = transactionItemSelectionKey(left);
      const rightKey = transactionItemSelectionKey(right);
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
  if (String(item?.assetClass || "").toLowerCase() === "crypto") return false;
  const marketCountry = itemMarketCountry(item);
  return Boolean(marketCountry && marketCountry !== "KR");
}

function itemIsDomesticStock(item = {}) {
  if (String(item?.assetClass || "").toLowerCase() === "crypto") return false;
  return itemMarketCountry(item) === "KR";
}

function itemIsCrypto(item = {}) {
  const instrument = normalizeTransactionInstrument(item);
  return String(instrument?.assetClass || item?.assetClass || "").toLowerCase() === "crypto" || (
    instrument?.provider === "binance" && instrument?.marketType === "spot"
  );
}

function transactionPerformancePeriodPrefix(items = []) {
  return "일간";
}

function transactionSortOptionsForItems(items = []) {
  const prefix = transactionPerformancePeriodPrefix(items);
  return sortOptions.map((option) => (
    option.id === "dailyRateDesc"
      ? { ...option, label: `${prefix} 수익률 높은 순` }
      : option.id === "dailyRateAsc"
        ? { ...option, label: `${prefix} 수익률 낮은 순` }
        : option
  ));
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

function SortMenu({ sortId, open, onOpenChange, onSelect, items = [] }) {
  const contextualOptions = transactionSortOptionsForItems(items);
  const selected = contextualOptions.find((option) => option.id === sortId) || contextualOptions[3];
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
          {contextualOptions.map((option) => (
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
  const marketDailyReturnPercent = Number(item.marketDailyReturnPercent);
  const changePercent = isPriceMode && Number.isFinite(marketDailyReturnPercent)
    ? marketDailyReturnPercent
    : isPriceMode
      ? item.dailyReturnPercent
      : item.profitPercent;
  const displayValueInUnit = convertedMoney(displayValue, itemUnit, displayUnit, usdKrwRate);
  const positionName = isPriceMode ? displayName(item) : item.symbol;
  const positionMeta = isPriceMode
    ? `내 평균 ${item.averageKnownCost ? formatConvertedMoney(item.averageKnownCost, itemUnit, displayUnit, usdKrwRate) : "-"}`
    : formatQuantity(item.quantity, item);
  const changeLabel = isPriceMode
    ? formatSignedPercent(changePercent)
    : formatConvertedPerformance(true, changeValue, changePercent, itemUnit, displayUnit, usdKrwRate);
  return {
    positionName,
    translationPending: transactionNameTranslationPending(item),
    positionMeta,
    valueLabel: formatOptionalMoney(displayValueInUnit.hasValue, displayValueInUnit.value, displayUnit),
    changeLabel,
    toneClass: valueTone(isPriceMode ? changePercent : changeValue),
  };
}

function SimulatorNameEditForm({
  inputId,
  value,
  busy = false,
  error = "",
  compact = false,
  onChange,
  onSubmit,
  onCancel,
}) {
  const handleCommit = () => {
    if (busy) return;
    onSubmit?.();
  };
  return (
    <span
      className={`transaction-simulator-name-form${compact ? " is-compact" : ""}`}
      role="form"
      aria-label="시뮬레이터 계좌 이름 변경"
      onClick={(event) => event.stopPropagation()}
    >
      <input
        id={inputId}
        type="text"
        value={value}
        maxLength={80}
        autoComplete="off"
        autoFocus
        disabled={busy}
        onFocus={(event) => event.currentTarget.select()}
        onChange={(event) => onChange?.(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.nativeEvent?.isComposing) {
            event.preventDefault();
            handleCommit();
          } else if (event.key === "Escape") {
            event.preventDefault();
            onCancel?.();
          }
        }}
      />
      <button
        className="transaction-simulator-name-save"
        type="button"
        disabled={busy}
        aria-label="시뮬레이터 이름 저장"
        title="저장"
        onClick={handleCommit}
      >
        <Check size={14} strokeWidth={2.6} aria-hidden="true" />
      </button>
      <button type="button" disabled={busy} aria-label="시뮬레이터 이름 편집 취소" title="취소" onClick={onCancel}>
        <X size={14} strokeWidth={2.6} aria-hidden="true" />
      </button>
      {error ? <span className="transaction-simulator-name-error" role="alert">{error}</span> : null}
    </span>
  );
}

function SimulatorEditableName({
  simulator,
  index = 0,
  placement = "main",
  editing = false,
  draft = "",
  busy = false,
  error = "",
  onStart,
  onDraftChange,
  onSubmit,
  onCancel,
}) {
  const simulatorId = cleanTransactionSimulatorId(simulator?.id);
  const simulatorName = simulatorDisplayLabel(simulator, index);
  if (!simulatorId) return <strong>{simulatorName}</strong>;
  if (editing) {
    return (
      <SimulatorNameEditForm
        inputId={`transaction-simulator-name-${placement}`}
        value={draft}
        busy={busy}
        error={error}
        compact={placement !== "main"}
        onChange={onDraftChange}
        onSubmit={onSubmit}
        onCancel={onCancel}
      />
    );
  }
  return (
    <button
      className="transaction-simulator-name-inline"
      type="button"
      title={`${simulatorName} 이름 변경`}
      aria-label={`${simulatorName} 이름 변경`}
      onClick={(event) => {
        event.stopPropagation();
        onStart?.(simulator, placement);
      }}
    >
      <span>{simulatorName}</span>
    </button>
  );
}

function SimulatorPositionActionPopover({
  menu,
  onClose,
  onBuy,
  onSell,
}) {
  const buyButtonRef = useRef(null);
  const item = menu?.item || null;
  const symbol = cleanTransactionWatchlistSymbol(item?.symbol);
  const positionName = item ? displayName(item) : "";

  useEffect(() => {
    if (!menu) return;
    buyButtonRef.current?.focus();
  }, [menu]);

  if (!menu || !item) return null;

  return (
    <div
      className="transaction-side-position-actions-popover"
      role="dialog"
      aria-label={`${positionName || symbol} 거래 메뉴`}
      style={{
        "--transaction-position-action-x": `${menu.x}px`,
        "--transaction-position-action-y": `${menu.y}px`,
      }}
      onClick={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
      onContextMenu={(event) => {
        event.preventDefault();
        onClose?.();
      }}
    >
      <span className="transaction-side-position-actions-title">
        {symbol || positionName}
      </span>
      <button
        className="is-buy"
        type="button"
        ref={buyButtonRef}
        onClick={() => {
          onClose?.();
          onBuy?.(item);
        }}
      >
        매수
      </button>
      <button
        className="is-sell"
        type="button"
        disabled={!onSell}
        title={onSell ? `${positionName || symbol} 매도` : "매도 주문은 다음 단계에서 연결합니다"}
        onClick={() => {
          onClose?.();
          onSell?.(item);
        }}
      >
        매도
      </button>
    </div>
  );
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
  simulators = [],
  accountOpen,
  selectedAccountSeq,
  selectedSimulatorId,
  simulatorMarketCalendars = {},
  simulatorLoading = false,
  simulatorError = "",
  simulatorRenameTarget = null,
  simulatorRenameDraft = "",
  simulatorRenameBusy = false,
  simulatorRenameError = "",
  onAccountOpenChange,
  onAccountSelect,
  onSimulatorSelect,
  onCreateSimulator,
  onOpenExchange,
  onPositionBuy,
  onPositionSell,
  onSimulatorRenameStart,
  onSimulatorRenameDraftChange,
  onSimulatorRenameSubmit,
  onSimulatorRenameCancel,
  valueMode,
  onValueModeChange,
  selectedPositionKey = "",
  onSelectPosition,
  onResetPositionSelection,
}) {
  const displayUnit = normalizeMoneyUnit(unit);
  const [draggedOrderKey, setDraggedOrderKey] = useState("");
  const [dragOverOrderKey, setDragOverOrderKey] = useState("");
  const [dragInsertPlacement, setDragInsertPlacement] = useState("before");
  const [dragPreview, setDragPreview] = useState(null);
  const [positionActionMenu, setPositionActionMenu] = useState(null);
  const pointerDraggedOrderKeyRef = useRef("");
  const pointerDragOverOrderKeyRef = useRef("");
  const pointerDragPlacementRef = useRef("before");
  const manualOrderRef = useRef(manualOrder);
  const manualItemsRef = useRef(items);
  const hasPayload = Boolean(payload?.ok);
  const payloadBalances = payload?.balances && typeof payload.balances === "object" ? payload.balances : {};
  const totalUsd = hasPayload
    ? Number(payload?.cashUsd ?? payload?.usdCash ?? payloadBalances.USD ?? payload?.totalValueUsd ?? items.reduce((sum, item) => sum + Number(item.marketValueUsd || 0), 0))
    : null;
  const totalKrw = hasPayload
    ? Number(payload?.cashKrw ?? payload?.krwCash ?? payloadBalances.KRW ?? payload?.totalValueKrw ?? 0)
    : null;
  const totals = aggregatePerformance(items, displayUnit, usdKrwRate);
  const contextualSortOptions = transactionSortOptionsForItems(items);
  const sortLabel = (contextualSortOptions.find((option) => option.id === sortId) || contextualSortOptions[3]).label;
  const accountRows = Array.isArray(accounts) ? accounts : [];
  const simulatorRows = normalizeTransactionSimulatorAccounts(simulators);
  const effectiveAccountSeq = cleanAccountSeq(selectedAccountSeq || payload?.accountSeq);
  const effectiveSimulatorId = cleanTransactionSimulatorId(selectedSimulatorId);
  const selectedAccountIndex = Math.max(
    0,
    accountRows.findIndex((account) => cleanAccountSeq(account.accountSeq) === effectiveAccountSeq)
  );
  const selectedAccount = accountRows[selectedAccountIndex] || {};
  const selectedSimulatorIndex = simulatorRows.findIndex((simulator) => simulator.id === effectiveSimulatorId);
  const selectedSimulator = selectedSimulatorIndex >= 0 ? simulatorRows[selectedSimulatorIndex] : null;
  const priceModeLabel = "현재가";
  const nextValueMode = valueMode === "price" ? "value" : "price";
  const activeValueModeLabel = valueMode === "price" ? priceModeLabel : "평가금";
  const nextValueModeLabel = nextValueMode === "price" ? priceModeLabel : "평가금";
  const accountLabel = selectedSimulator
    ? simulatorDisplayLabel(selectedSimulator, selectedSimulatorIndex)
    : accountRows.length
      ? accountDisplayLabel(selectedAccount, selectedAccountIndex)
      : "기본계좌";
  const summaryLabel = selectedSimulator ? simulatorDisplayLabel(selectedSimulator, selectedSimulatorIndex) : "내 투자";
  const manualSortActive = sortId === "custom" && manualOrderEditing;
  const sideTotalRenameEditing = Boolean(
    selectedSimulator &&
      simulatorRenameTarget?.simulatorId === selectedSimulator.id &&
      simulatorRenameTarget?.placement === "sideTotal"
  );
  const positionSelectionEnabled = Boolean(onSelectPosition && !manualSortActive);
  const positionActionsEnabled = Boolean(selectedSimulator && !positionSelectionEnabled && !manualSortActive);
  const sideTotalResetEnabled = Boolean(onResetPositionSelection);

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
    const orderKey = transactionItemSelectionKey(item);
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

  const closePositionActionMenu = useCallback(() => {
    setPositionActionMenu(null);
  }, []);

  const openPositionActionMenu = useCallback((event, item) => {
    if (!positionActionsEnabled) return;
    const orderKey = transactionItemSelectionKey(item);
    if (!orderKey) return;
    event.preventDefault();
    event.stopPropagation();
    const viewportWidth = typeof window === "undefined" ? 1280 : window.innerWidth;
    const viewportHeight = typeof window === "undefined" ? 800 : window.innerHeight;
    const fallbackRect = event.currentTarget?.getBoundingClientRect?.();
    const rawX = Number.isFinite(event.clientX) && event.clientX > 0
      ? event.clientX
      : (fallbackRect ? fallbackRect.left + fallbackRect.width / 2 : 0);
    const rawY = Number.isFinite(event.clientY) && event.clientY > 0
      ? event.clientY
      : (fallbackRect ? fallbackRect.top + fallbackRect.height / 2 : 0);
    const x = Math.max(8, Math.min(rawX, viewportWidth - 172));
    const y = Math.max(8, Math.min(rawY, viewportHeight - 66));
    setPositionActionMenu({ orderKey, x, y, item });
  }, [positionActionsEnabled]);

  const handlePositionActionKeyDown = useCallback((event, item) => {
    if (!positionActionsEnabled) return;
    if (event.key !== "Enter" && event.key !== " ") return;
    openPositionActionMenu(event, item);
  }, [openPositionActionMenu, positionActionsEnabled]);

  const handlePositionSelectKeyDown = useCallback((event, item) => {
    if (!positionSelectionEnabled) return;
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    onSelectPosition?.(transactionItemSelectionKey(item));
  }, [onSelectPosition, positionSelectionEnabled]);

  const handlePositionBuy = useCallback((item) => {
    closePositionActionMenu();
    onPositionBuy?.(item);
  }, [closePositionActionMenu, onPositionBuy]);

  const handlePositionSell = useCallback((item) => {
    if (!onPositionSell) return;
    closePositionActionMenu();
    onPositionSell(item);
  }, [closePositionActionMenu, onPositionSell]);

  const handleSideTotalReset = useCallback(() => {
    closePositionActionMenu();
    onResetPositionSelection?.();
  }, [closePositionActionMenu, onResetPositionSelection]);

  const handleSideTotalKeyDown = useCallback((event) => {
    if (!sideTotalResetEnabled) return;
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    handleSideTotalReset();
  }, [handleSideTotalReset, sideTotalResetEnabled]);

  useEffect(() => {
    if (!positionActionMenu) return undefined;
    function handleDocumentPointerDown() {
      closePositionActionMenu();
    }
    function handleDocumentContextMenu() {
      closePositionActionMenu();
    }
    function handleDocumentKeyDown(event) {
      if (event.key === "Escape") closePositionActionMenu();
    }
    document.addEventListener("pointerdown", handleDocumentPointerDown);
    document.addEventListener("contextmenu", handleDocumentContextMenu);
    document.addEventListener("keydown", handleDocumentKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handleDocumentPointerDown);
      document.removeEventListener("contextmenu", handleDocumentContextMenu);
      document.removeEventListener("keydown", handleDocumentKeyDown);
    };
  }, [closePositionActionMenu, positionActionMenu]);

  useEffect(() => {
    if (!positionActionMenu) return;
    if (!positionActionsEnabled) {
      closePositionActionMenu();
      return;
    }
    if (!items.some((item) => transactionItemSelectionKey(item) === positionActionMenu.orderKey)) {
      closePositionActionMenu();
    }
  }, [closePositionActionMenu, items, positionActionMenu, positionActionsEnabled]);

  useEffect(() => {
    if (!manualSortActive || !draggedOrderKey) return undefined;
    function dropTargetFromPoint(clientX, clientY) {
      const target = document.elementFromPoint(clientX, clientY);
      const row = target?.closest?.("[data-transaction-order-key]");
      const orderKey = cleanTransactionItemSelectionKey(row?.dataset?.transactionOrderKey);
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
          {selectedSimulator ? (
            <button
              className="transaction-account-trigger is-simulator"
              type="button"
              onClick={() => onAccountOpenChange(!accountOpen)}
              aria-expanded={accountOpen}
            >
              <span className="transaction-account-dot is-simulator" aria-hidden="true" />
              <strong>{accountLabel}</strong>
              <ChevronDown size={14} strokeWidth={2.4} />
            </button>
          ) : (
            <button
              className="transaction-account-trigger"
              type="button"
              onClick={() => onAccountOpenChange(!accountOpen)}
              aria-expanded={accountOpen}
            >
              <span className="transaction-account-dot" aria-hidden="true" />
              <strong>{accountLabel}</strong>
              <ChevronDown size={14} strokeWidth={2.4} />
            </button>
          )}
          {accountOpen ? (
            <div className="transaction-account-popover" role="menu">
              {accountRows.length ? (
                accountRows.map((account, index) => {
                  const accountSeq = cleanAccountSeq(account.accountSeq);
                  const selected = !effectiveSimulatorId && accountSeq && accountSeq === effectiveAccountSeq;
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
                <span>정규 계좌 없음</span>
              )}
              {simulatorRows.length ? (
                <div className="transaction-account-popover-divider" role="separator" />
              ) : null}
              {simulatorRows.map((simulator, index) => {
                const selected = simulator.id === effectiveSimulatorId;
                return (
                  <button
                    className={selected ? "is-selected is-simulator" : "is-simulator"}
                    type="button"
                    role="menuitemradio"
                    aria-checked={selected}
                    key={`transaction-simulator-account-${simulator.id}`}
                    onClick={() => onSimulatorSelect(simulator.id)}
                  >
                    <span>{simulatorDisplayLabel(simulator, index)}</span>
                    {selected ? <Check size={15} strokeWidth={2.6} /> : null}
                  </button>
                );
              })}
              {simulatorLoading ? (
                <span className="transaction-account-popover-status">시뮬레이터 장부 확인 중</span>
              ) : null}
              {simulatorError ? (
                <span className="transaction-account-popover-error">{simulatorError}</span>
              ) : null}
              <button
                className="transaction-account-create-simulator"
                type="button"
                role="menuitem"
                disabled={simulatorLoading}
                onClick={onCreateSimulator}
              >
                <span>
                  <Plus size={14} strokeWidth={2.5} aria-hidden="true" />
                  <span>{simulatorLoading ? "시뮬레이터 준비 중" : "투자 시뮬레이터 추가"}</span>
                </span>
              </button>
            </div>
          ) : null}
        </div>
        <CurrencySwitch unit={displayUnit} onChange={onUnitChange} label="사이드바 통화 표시" />
      </div>

      {selectedSimulator ? (
        <div className="transaction-cash-grid is-actionable" aria-label="시뮬레이터 현금 잔고">
          <button type="button" onClick={() => onOpenExchange?.("KRW_TO_USD")}>
            <span>원화</span>
            <strong>{formatOptionalMoney(hasPayload, totalKrw, "KRW")}</strong>
          </button>
          <button type="button" onClick={() => onOpenExchange?.("USD_TO_KRW")}>
            <span>달러</span>
            <strong>{hasPayload ? formatUsd(totalUsd) : "-"}</strong>
          </button>
        </div>
      ) : (
        <div className="transaction-cash-grid" aria-label="현금 잔고">
          <div>
            <span>원화</span>
            <strong>{formatOptionalMoney(hasPayload, totalKrw, "KRW")}</strong>
          </div>
          <div>
            <span>달러</span>
            <strong>{hasPayload ? formatUsd(totalUsd) : "-"}</strong>
          </div>
        </div>
      )}

      <section
        className={sideTotalResetEnabled ? "transaction-side-total is-clickable" : "transaction-side-total"}
        role={sideTotalResetEnabled ? "button" : undefined}
        tabIndex={sideTotalResetEnabled ? 0 : undefined}
        title={sideTotalResetEnabled ? "내 투자 첫 화면으로 이동" : undefined}
        aria-label={sideTotalResetEnabled ? "내 투자 첫 화면으로 이동" : undefined}
        onClick={sideTotalResetEnabled ? handleSideTotalReset : undefined}
        onKeyDown={handleSideTotalKeyDown}
      >
        <span>
          {selectedSimulator ? (
            <SimulatorEditableName
              simulator={selectedSimulator}
              index={selectedSimulatorIndex}
              placement="sideTotal"
              editing={sideTotalRenameEditing}
              draft={simulatorRenameDraft}
              busy={simulatorRenameBusy}
              error={sideTotalRenameEditing ? simulatorRenameError : ""}
              onStart={onSimulatorRenameStart}
              onDraftChange={onSimulatorRenameDraftChange}
              onSubmit={onSimulatorRenameSubmit}
              onCancel={onSimulatorRenameCancel}
            />
          ) : summaryLabel}
        </span>
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
          items={items}
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
              type="button"
              className="is-active"
              aria-pressed={valueMode === "price"}
              aria-label={`${activeValueModeLabel} 표시 중. 클릭하면 ${nextValueModeLabel} 표시`}
              title={`${nextValueModeLabel} 표시`}
              onClick={() => onValueModeChange(nextValueMode)}
            >
              <span className={valueMode === "price" ? "is-active" : ""}>{priceModeLabel}</span>
              <span className={valueMode === "value" ? "is-active" : ""}>평가금</span>
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
          const orderKey = transactionItemSelectionKey(item);
          const selectionKey = orderKey;
          const positionView = transactionSidebarPositionView(item, displayUnit, valueMode, usdKrwRate);
          const positionSelected = positionSelectionEnabled && selectionKey === selectedPositionKey;
          const positionInteractive = positionActionsEnabled || positionSelectionEnabled;
          const itemClassName = [
            "transaction-side-position-item",
            positionActionsEnabled ? "is-simulator-actionable" : "",
            positionSelectionEnabled ? "is-selectable" : "",
            positionSelected ? "is-selected" : "",
            positionActionMenu?.orderKey === selectionKey ? "is-action-open" : "",
            manualSortActive ? "is-manual-sort" : "",
            dragOverOrderKey === orderKey && draggedOrderKey && draggedOrderKey !== orderKey
              ? `is-drop-${dragInsertPlacement}`
              : "",
            draggedOrderKey === orderKey ? "is-dragging" : "",
          ].filter(Boolean).join(" ");
          return (
            <li
              className={itemClassName}
              key={`transaction-side-${selectionKey}`}
              data-transaction-order-key={orderKey}
              role={positionInteractive ? "button" : undefined}
              tabIndex={positionInteractive ? 0 : undefined}
              aria-pressed={positionSelectionEnabled ? positionSelected : undefined}
              aria-label={
                positionActionsEnabled
                  ? `${displayName(item)} 거래 메뉴 열기`
                  : positionSelectionEnabled
                    ? `${displayName(item)} 상세 보기`
                    : undefined
              }
              onClick={
                positionActionsEnabled
                  ? (event) => openPositionActionMenu(event, item)
                  : positionSelectionEnabled
                    ? () => onSelectPosition?.(selectionKey)
                    : undefined
              }
              onKeyDown={
                positionActionsEnabled
                  ? (event) => handlePositionActionKeyDown(event, item)
                  : positionSelectionEnabled
                    ? (event) => handlePositionSelectKeyDown(event, item)
                    : undefined
              }
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
                <strong>
                  <span>{positionView.positionName}</span>
                  {positionView.translationPending ? (
                    <small className="transaction-name-translation-status">번역대기중</small>
                  ) : null}
                </strong>
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
      <SimulatorPositionActionPopover
        menu={positionActionMenu}
        onClose={closePositionActionMenu}
        onBuy={handlePositionBuy}
        onSell={onPositionSell ? handlePositionSell : null}
      />
      {dragPreview ? (
        <div
          className="transaction-side-drag-preview"
          style={{ "--transaction-drag-x": `${dragPreview.x}px`, "--transaction-drag-y": `${dragPreview.y}px` }}
          aria-hidden="true"
        >
          <div className="transaction-side-position-name">
            <strong>
              <span>{dragPreview.positionName}</span>
              {dragPreview.translationPending ? (
                <small className="transaction-name-translation-status">번역대기중</small>
              ) : null}
            </strong>
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
  if (columnId === "name") return <TransactionTranslatedName item={item} />;
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
  if (columnId === "quantity") return formatQuantity(item.quantity, item);
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

function transactionContextInstrumentRow(item = {}, displayUnit = "KRW", usdKrwRate = 0) {
  const itemUnit = normalizeMoneyUnit(item.displayCurrency || item.currency || displayUnit);
  const convert = (value) => {
    const result = convertedMoney(value, itemUnit, displayUnit, usdKrwRate);
    return result.hasValue ? result.value : null;
  };
  return {
    instrumentId: transactionInstrumentKey(item),
    provider: String(item.provider || "toss").trim(),
    venue: String(item.venue || "").trim(),
    assetClass: String(item.assetClass || "").trim(),
    symbol: cleanTransactionWatchlistSymbol(item.symbol),
    name: displayName(item),
    market: String(item.market || "").trim(),
    sourceCurrency: itemUnit,
    displayCurrency: displayUnit,
    quantity: Number(item.quantity || 0),
    value: Number(item.value || 0),
    costBasis: Number(item.costBasis || 0),
    profit: Number(item.profit || 0),
    profitPercent: Number(item.profitPercent || 0),
    currentPrice: Number(item.currentPrice || 0),
    averageKnownCost: Number(item.averageKnownCost || 0),
    dailyReturnPercent: Number(item.dailyReturnPercent || 0),
    marketDailyReturnPercent: Number.isFinite(Number(item.marketDailyReturnPercent))
      ? Number(item.marketDailyReturnPercent)
      : null,
    dailyProfit: Number(item.dailyProfit || 0),
    displayed: {
      value: convert(item.value),
      costBasis: convert(item.costBasis),
      profit: convert(item.profit),
      currentPrice: convert(item.currentPrice),
      averageKnownCost: item.averageKnownCost ? convert(item.averageKnownCost) : null,
      dailyProfit: convert(item.dailyProfit),
      quantityLabel: formatQuantity(item.quantity, item),
    },
  };
}

function transactionInvestmentOverviewDisplayData({
  kind,
  title,
  accountType,
  accountId = "",
  items = [],
  filteredItems = [],
  payload = null,
  displayUnit = "KRW",
  usdKrwRate = 0,
  activeFilter = "all",
  selectedColumnIds = [],
  sidebarValueMode = "value",
} = {}) {
  const totals = aggregatePerformance(items, displayUnit, usdKrwRate);
  const visibleColumns = visibleTransactionMainTableColumns(selectedColumnIds);
  return {
    schemaVersion: "transaction-status-display-data.v1",
    id: kind,
    title,
    kind,
    exposure: "context",
    summary: {
      status: payload?.ok ? "ready" : "waiting",
      accountType,
      accountId,
      displayUnit,
      activeFilter,
      holdingCount: items.length,
      visibleRowCount: filteredItems.length,
      totalValue: totals.value.hasValue ? totals.value.value : null,
      totalCostBasis: totals.costBasis.hasValue ? totals.costBasis.value : null,
      totalProfit: totals.profit.hasValue ? totals.profit.value : null,
      totalProfitPercent: totals.profitPercent,
      dailyProfit: totals.dailyProfit.hasValue ? totals.dailyProfit.value : null,
      dailyReturnPercent: Number(payload?.dailyReturnPercent || 0),
      cashKrw: Number(payload?.cashKrw ?? payload?.balances?.KRW ?? 0),
      cashUsd: Number(payload?.cashUsd ?? payload?.balances?.USD ?? 0),
      source: String(payload?.source || "").trim(),
      fetchedAt: String(payload?.fetchedAt || "").trim(),
    },
    data: {
      sidebarItems: items.map((item) => ({
        ...transactionContextInstrumentRow(item, displayUnit, usdKrwRate),
        sidebar: transactionSidebarPositionView(item, displayUnit, sidebarValueMode, usdKrwRate),
      })),
      tableColumns: visibleColumns.map((column) => ({ id: column.id, label: column.label })),
      tableRows: filteredItems.map((item) => transactionContextInstrumentRow(item, displayUnit, usdKrwRate)),
    },
  };
}

function transactionWatchlistContextRow(row = {}) {
  return {
    instrumentId: cleanTransactionInstrumentId(row.instrumentId),
    provider: String(row.provider || "toss").trim(),
    venue: String(row.venue || "").trim(),
    assetClass: String(row.assetClass || "").trim(),
    symbol: cleanTransactionWatchlistSymbol(row.symbol),
    name: String(row.name || row.symbol || "").trim(),
    currency: String(row.price?.currency || row.item?.currency || "").trim(),
    lastPrice: Number.isFinite(Number(row.lastPrice)) ? Number(row.lastPrice) : null,
    dailyReturnPercent: row.hasDailyReturn ? Number(row.dailyReturnPercent) : null,
    weeklyReturnPercent: row.hasWeeklyReturn ? Number(row.weeklyReturnPercent) : null,
    monthlyReturnPercent: row.hasMonthlyReturn ? Number(row.monthlyReturnPercent) : null,
    sixMonthReturnPercent: row.hasSixMonthReturn ? Number(row.sixMonthReturnPercent) : null,
    timestamp: String(row.price?.timestamp || "").trim(),
  };
}

function InvestmentTable({
  items,
  payload,
  unit,
  usdKrwRate,
  selectedColumnIds,
  emptyLabel = "보유 종목이 없습니다.",
  onSelectItem,
}) {
  const displayUnit = normalizeMoneyUnit(unit);
  const visibleColumns = useMemo(() => visibleTransactionMainTableColumns(selectedColumnIds), [selectedColumnIds]);
  const periodPrefix = transactionPerformancePeriodPrefix(items);
  return (
    <div className="transaction-main-table-wrap">
      <table className="transaction-main-table" style={{ "--transaction-table-column-count": visibleColumns.length }}>
        <thead>
          <tr>
            {visibleColumns.map((column) => (
              <th className={column.align === "left" ? "is-left" : ""} key={`transaction-table-head-${column.id}`}>
                {column.id === "dailyReturnPercent"
                  ? `${periodPrefix} 수익률`
                  : column.id === "dailyProfit"
                    ? `${periodPrefix} 수익금`
                    : column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const itemUnit = item.displayCurrency || item.currency || displayUnit;
            const rowKey = transactionItemSelectionKey(item);
            const rowContext = { item, itemUnit, displayUnit, usdKrwRate };
            return (
              <tr
                className={onSelectItem ? "transaction-investment-row is-selectable" : "transaction-investment-row"}
                key={`transaction-table-${rowKey}`}
                tabIndex={onSelectItem ? 0 : undefined}
                aria-label={onSelectItem ? `${displayName(item)} 차트 보기` : undefined}
                onClick={onSelectItem ? () => onSelectItem(rowKey) : undefined}
                onKeyDown={onSelectItem ? (event) => {
                  if (event.key !== "Enter" && event.key !== " ") return;
                  event.preventDefault();
                  onSelectItem(rowKey);
                } : undefined}
              >
                {visibleColumns.map((column) => {
                  const toneClass = column.toneField ? valueTone(item[column.toneField]) : "";
                  const className = [column.align === "left" ? "is-left" : "", column.className || "", toneClass]
                    .filter(Boolean)
                    .join(" ");
                  return (
                    <td className={className} key={`transaction-table-${rowKey}-${column.id}`}>
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

function formatTransactionCandleRowLabel(row = {}) {
  return String(row.date || row.timestamp || "").slice(5, 10).replace("-", ".");
}

const TransactionAssetDailyTable = React.memo(function TransactionAssetDailyTable({
  rows,
  unit,
  initialLoading = false,
  loadingMore = false,
  hasMore = true,
  error = "",
  onLoadMore,
  onRetry,
}) {
  const tableWrapRef = useRef(null);
  const loadMoreSentinelRef = useRef(null);
  const tableRows = useMemo(() => {
    const sourceRows = aggregateTransactionInvestmentDailyRows(Array.isArray(rows) ? rows : []);
    return sourceRows
      .map((row, index) => {
        const previousClose = sourceRows[index - 1]?.close;
        const changePercent = previousClose > 0 ? ((row.close - previousClose) / previousClose) * 100 : 0;
        return {
          ...row,
          changePercent,
        };
      })
      .reverse();
  }, [rows]);

  useEffect(() => {
    const root = tableWrapRef.current;
    const sentinel = loadMoreSentinelRef.current;
    if (
      !root ||
      !sentinel ||
      initialLoading ||
      loadingMore ||
      Boolean(error) ||
      !hasMore ||
      typeof onLoadMore !== "function" ||
      typeof IntersectionObserver === "undefined"
    ) {
      return undefined;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) onLoadMore();
      },
      {
        root,
        rootMargin: "0px 0px 120px 0px",
        threshold: 0,
      }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [error, hasMore, initialLoading, loadingMore, onLoadMore, tableRows.length]);

  return (
    <section className="transaction-asset-daily-panel" aria-label="일별 시세">
      <div className="transaction-asset-daily-toolbar">
        <strong>시세</strong>
      </div>
      <div
        className="transaction-asset-daily-table-wrap"
        ref={tableWrapRef}
        aria-busy={initialLoading || loadingMore}
      >
        <table className="transaction-main-table transaction-asset-daily-table">
          <colgroup>
            <col className="transaction-asset-daily-col-date" />
            <col className="transaction-asset-daily-col-price" />
            <col className="transaction-asset-daily-col-change" />
            <col className="transaction-asset-daily-col-volume" />
            <col className="transaction-asset-daily-col-turnover" />
            <col className="transaction-asset-daily-col-price" />
            <col className="transaction-asset-daily-col-price" />
            <col className="transaction-asset-daily-col-price" />
          </colgroup>
          <thead>
            <tr>
              <th className="is-left">일자</th>
              <th>종가</th>
              <th>등락률</th>
              <th>거래량</th>
              <th>거래대금</th>
              <th>시가</th>
              <th>고가</th>
              <th>저가</th>
            </tr>
          </thead>
          <tbody>
            {tableRows.map((row) => (
              <tr key={`transaction-asset-daily-${row.timestamp || row.date}`}>
                <td className="is-left">{formatTransactionCandleRowLabel(row)}</td>
                <td>{formatMoney(row.close, unit)}</td>
                <td className={valueTone(row.changePercent)}>{formatSignedPercent(row.changePercent)}</td>
                <td>{row.volume ? Math.round(row.volume).toLocaleString("ko-KR") : "-"}</td>
                <td>{row.turnover ? formatCompactMoney(row.turnover, unit) : "-"}</td>
                <td>{formatMoney(row.open, unit)}</td>
                <td>{formatMoney(row.high, unit)}</td>
                <td>{formatMoney(row.low, unit)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {initialLoading && !tableRows.length ? (
          <div className="transaction-asset-daily-load-state" role="status">
            <LoaderCircle className="is-spinning" size={15} aria-hidden="true" />
            <span>일별 시세 로딩</span>
          </div>
        ) : null}
        {!initialLoading && !tableRows.length && !error ? (
          <div className="transaction-empty-state">일별 시세가 없습니다.</div>
        ) : null}
        {error ? (
          <div className="transaction-asset-daily-load-state is-error" role="status">
            <span>{error}</span>
            <button type="button" onClick={tableRows.length ? onLoadMore : onRetry}>
              다시 불러오기
            </button>
          </div>
        ) : null}
        {loadingMore ? (
          <div className="transaction-asset-daily-load-state" role="status">
            <LoaderCircle className="is-spinning" size={15} aria-hidden="true" />
            <span>이전 일별 시세 로딩</span>
          </div>
        ) : null}
        <div className="transaction-asset-daily-load-sentinel" ref={loadMoreSentinelRef} aria-hidden="true" />
      </div>
    </section>
  );
});

function TransactionInvestmentAssetDetail({
  item,
  payload,
  unit,
  usdKrwRate,
  onUnitChange,
  onClose,
  statusBannerProps,
  binanceStatus,
  binanceError = "",
  chartModeSetting = defaultTransactionCurrencySettings.investmentChartMode,
  intervalModeSetting = defaultTransactionCurrencySettings.investmentChartIntervalMode,
  volumeVisibleSetting = defaultTransactionCurrencySettings.investmentChartVolumeVisible,
  onChartModeChange,
  onIntervalModeChange,
  onVolumeVisibleChange,
  onBuy,
  onSell,
  onDisplayData,
}) {
  const chartContainerRef = useRef(null);
  const minuteMenuRef = useRef(null);
  const chartRef = useRef(null);
  const seriesRef = useRef(null);
  const volumeSeriesRef = useRef(null);
  const seriesModeRef = useRef("");
  const averagePriceLineRef = useRef(null);
  const averagePriceLineValueRef = useRef(null);
  const previousChartKeyRef = useRef("");
  const chartOptionsKeyRef = useRef("");
  const priceSeriesDataRef = useRef({ identity: "", rows: [] });
  const volumeSeriesDataRef = useRef({ identity: "", rows: [] });
  const visibleRangeSubscriptionRef = useRef(null);
  const chartRangeUpdateSuppressedRef = useRef(false);
  const chartRangeSuppressionTimerRef = useRef(null);
  const chartOlderLoadIntentRef = useRef(false);
  const chartOlderLoadIntentTimerRef = useRef(null);
  const previousFirstCandleKeyRef = useRef("");
  const candleOlderLoadingRef = useRef(false);
  const candleOlderControllerRef = useRef(null);
  const candleOlderLoadedBeforeRef = useRef(new Set());
  const loadOlderCandlesRef = useRef(() => {});
  const dailyCandleLoadingRef = useRef(false);
  const dailyCandleControllerRef = useRef(null);
  const dailyCandleLoadedBeforeRef = useRef(new Set());
  const [chartMode, setChartMode] = useState(() => normalizeTransactionInvestmentChartModeSetting(chartModeSetting));
  const [intervalMode, setIntervalMode] = useState(() => normalizeTransactionInvestmentChartIntervalSetting(intervalModeSetting));
  const [volumeVisible, setVolumeVisible] = useState(() =>
    normalizeTransactionBooleanSetting(volumeVisibleSetting, defaultTransactionCurrencySettings.investmentChartVolumeVisible)
  );
  const [minuteMenuOpen, setMinuteMenuOpen] = useState(false);
  const [candlePayload, setCandlePayload] = useState(null);
  const [candleLoading, setCandleLoading] = useState(false);
  const [candleOlderLoading, setCandleOlderLoading] = useState(false);
  const [candleOlderError, setCandleOlderError] = useState("");
  const [candleError, setCandleError] = useState("");
  const [dailyCandlePayload, setDailyCandlePayload] = useState(null);
  const [dailyCandleLoading, setDailyCandleLoading] = useState(false);
  const [dailyCandleOlderLoading, setDailyCandleOlderLoading] = useState(false);
  const [dailyCandleError, setDailyCandleError] = useState("");
  const requestedDisplayUnit = normalizeMoneyUnit(unit);
  const symbol = cleanTransactionWatchlistSymbol(item?.symbol);
  const instrumentId = transactionInstrumentKey(item);
  const candleInstrument = useMemo(
    () => normalizeTransactionInstrument({ instrumentId, symbol }),
    [instrumentId, symbol]
  );
  const itemUnit = normalizeMoneyUnit(item?.displayCurrency || item?.currency || payload?.unit || requestedDisplayUnit);
  const displayUnit = requestedDisplayUnit === itemUnit || convertMoney(1, itemUnit, requestedDisplayUnit, usdKrwRate) !== null
    ? requestedDisplayUnit
    : itemUnit;
  const averagePrice = Number(item?.averageKnownCost || 0);
  const currentPrice = Number(item?.currentPrice || 0);
  const marketDailyReturnPercent = Number(item?.marketDailyReturnPercent);
  const dailyReturnPercent = Number.isFinite(marketDailyReturnPercent)
    ? marketDailyReturnPercent
    : Number(item?.dailyReturnPercent || 0);
  const itemName = displayName(item);
  const applyLatestCandlePayload = useCallback((nextPayload, { replace = false } = {}) => {
    const sourceInterval = nextPayload?.interval || transactionInvestmentSourceInterval(intervalMode);
    const nextRows = transactionInvestmentCandleRowsFromPayload(nextPayload?.candles || [], sourceInterval);
    setCandlePayload((current) => {
      const currentInterval = current?.interval || sourceInterval;
      const currentSymbol = cleanTransactionWatchlistSymbol(current?.symbol);
      if (replace || !current || currentSymbol !== symbol || currentInterval !== sourceInterval) {
        return {
          ...nextPayload,
          interval: sourceInterval,
          requestedInterval: intervalMode,
          candles: nextRows,
        };
      }
      const mergedRows = mergeTransactionInvestmentCandleRows(current?.candles || [], nextRows, sourceInterval);
      if (transactionInvestmentCandleRowsEqual(current?.candles || [], mergedRows, sourceInterval)) {
        return current;
      }
      return {
        ...nextPayload,
        interval: sourceInterval,
        requestedInterval: intervalMode,
        candles: mergedRows,
        nextBefore: current?.nextBefore || nextPayload?.nextBefore || "",
        hasMore: current?.hasMore === false ? false : nextPayload?.hasMore !== false,
      };
    });
  }, [intervalMode, symbol]);

  useEffect(() => {
    setChartMode(normalizeTransactionInvestmentChartModeSetting(chartModeSetting));
  }, [chartModeSetting]);

  useEffect(() => {
    setIntervalMode(normalizeTransactionInvestmentChartIntervalSetting(intervalModeSetting));
    setMinuteMenuOpen(false);
  }, [intervalModeSetting]);

  useEffect(() => {
    setVolumeVisible(
      normalizeTransactionBooleanSetting(volumeVisibleSetting, defaultTransactionCurrencySettings.investmentChartVolumeVisible)
    );
  }, [volumeVisibleSetting]);

  const handleChartModeSelect = useCallback((nextMode) => {
    const normalizedMode = normalizeTransactionInvestmentChartModeSetting(nextMode);
    setChartMode(normalizedMode);
    onChartModeChange?.(normalizedMode);
  }, [onChartModeChange]);

  const handleIntervalModeSelect = useCallback((nextInterval) => {
    const normalizedInterval = normalizeTransactionInvestmentChartIntervalSetting(nextInterval);
    setIntervalMode(normalizedInterval);
    setMinuteMenuOpen(false);
    onIntervalModeChange?.(normalizedInterval);
  }, [onIntervalModeChange]);

  const handleVolumeVisibleChange = useCallback((event) => {
    const nextVisible = Boolean(event.target.checked);
    setVolumeVisible(nextVisible);
    onVolumeVisibleChange?.(nextVisible);
  }, [onVolumeVisibleChange]);

  useEffect(() => {
    if (!minuteMenuOpen) return undefined;
    function closeMinuteMenuFromOutside(event) {
      const menu = minuteMenuRef.current;
      if (menu && event.target && menu.contains(event.target)) return;
      setMinuteMenuOpen(false);
    }
    function handleKeyDown(event) {
      if (event.key === "Escape") setMinuteMenuOpen(false);
    }
    document.addEventListener("pointerdown", closeMinuteMenuFromOutside, true);
    document.addEventListener("focusin", closeMinuteMenuFromOutside, true);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", closeMinuteMenuFromOutside, true);
      document.removeEventListener("focusin", closeMinuteMenuFromOutside, true);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [minuteMenuOpen]);

  useEffect(() => {
    if (!onClose) return undefined;
    function handleChartKeyDown(event) {
      if (event.key !== "Escape" || event.defaultPrevented || event.isComposing) return;
      if (minuteMenuOpen || document.querySelector('[aria-modal="true"]')) return;
      onClose();
    }
    document.addEventListener("keydown", handleChartKeyDown);
    return () => document.removeEventListener("keydown", handleChartKeyDown);
  }, [minuteMenuOpen, onClose]);

  useEffect(() => {
    if (!symbol) {
      setCandlePayload(null);
      setCandleLoading(false);
      setCandleOlderLoading(false);
      setCandleOlderError("");
      setCandleError("");
      candleOlderLoadingRef.current = false;
      candleOlderControllerRef.current?.abort();
      candleOlderControllerRef.current = null;
      candleOlderLoadedBeforeRef.current = new Set();
      previousFirstCandleKeyRef.current = "";
      return undefined;
    }
    const controller = new AbortController();
    let latestRefreshBusy = false;
    setCandleOlderLoading(false);
    setCandleOlderError("");
    candleOlderLoadingRef.current = false;
    candleOlderControllerRef.current?.abort();
    candleOlderControllerRef.current = null;
    candleOlderLoadedBeforeRef.current = new Set();
    previousFirstCandleKeyRef.current = "";
    async function loadCandles({ replace = false } = {}) {
      if (latestRefreshBusy) return;
      latestRefreshBusy = true;
      if (replace) {
        setCandleLoading(true);
        setCandleError("");
      }
      try {
        const nextPayload = await fetchTransactionInvestmentDetailCandles(candleInstrument, intervalMode, controller.signal, { force: true });
        if (controller.signal.aborted) return;
        applyLatestCandlePayload(nextPayload, { replace });
        setCandleError("");
      } catch (fetchError) {
        if (replace && fetchError.name !== "AbortError") {
          setCandleError(fetchError.message || "일별 시세를 불러오지 못했습니다.");
        }
      } finally {
        latestRefreshBusy = false;
        if (replace && !controller.signal.aborted) setCandleLoading(false);
      }
    }
    void loadCandles({ replace: true });
    const timer = window.setInterval(() => {
      if (candleOlderLoadingRef.current) return;
      void loadCandles();
    }, transactionInvestmentDetailCandleRefreshMs);
    return () => {
      window.clearInterval(timer);
      controller.abort();
      candleOlderControllerRef.current?.abort();
      candleOlderControllerRef.current = null;
    };
  }, [applyLatestCandlePayload, candleInstrument, instrumentId, intervalMode, symbol]);

  const loadInitialDailyCandles = useCallback(async () => {
    if (!symbol || dailyCandleLoadingRef.current) return;
    dailyCandleLoadingRef.current = true;
    dailyCandleControllerRef.current?.abort();
    const controller = new AbortController();
    dailyCandleControllerRef.current = controller;
    setDailyCandleLoading(true);
    setDailyCandleOlderLoading(false);
    setDailyCandleError("");
    try {
      const nextPayload = await fetchTransactionInvestmentDetailCandles(candleInstrument, "1d", controller.signal, { force: true });
      if (controller.signal.aborted) return;
      setDailyCandlePayload({
        ...nextPayload,
        interval: "1d",
        requestedInterval: "1d",
        candles: transactionInvestmentCandleRowsFromPayload(nextPayload?.candles || [], "1d"),
      });
    } catch (fetchError) {
      if (fetchError.name !== "AbortError" && !controller.signal.aborted) {
        setDailyCandleError(fetchError.message || "일별 시세를 불러오지 못했습니다.");
      }
    } finally {
      if (dailyCandleControllerRef.current === controller) {
        dailyCandleControllerRef.current = null;
        dailyCandleLoadingRef.current = false;
        if (!controller.signal.aborted) setDailyCandleLoading(false);
      }
    }
  }, [candleInstrument, instrumentId, symbol]);

  useEffect(() => {
    dailyCandleControllerRef.current?.abort();
    dailyCandleControllerRef.current = null;
    dailyCandleLoadingRef.current = false;
    dailyCandleLoadedBeforeRef.current = new Set();
    setDailyCandlePayload(null);
    setDailyCandleLoading(Boolean(symbol));
    setDailyCandleOlderLoading(false);
    setDailyCandleError("");
    if (symbol) void loadInitialDailyCandles();
    return () => {
      dailyCandleControllerRef.current?.abort();
      dailyCandleControllerRef.current = null;
      dailyCandleLoadingRef.current = false;
    };
  }, [loadInitialDailyCandles, symbol]);

  const rawCandleRows = useMemo(
    () => transactionInvestmentCandleRowsFromPayload(candlePayload?.candles || [], candlePayload?.interval || intervalMode),
    [candlePayload?.candles, candlePayload?.interval, intervalMode]
  );
  const candleRows = useMemo(
    () => aggregateTransactionInvestmentRows(rawCandleRows, intervalMode),
    [intervalMode, rawCandleRows]
  );
  const dailyCandleRows = useMemo(
    () => transactionInvestmentCandleRowsFromPayload(dailyCandlePayload?.candles || [], "1d"),
    [dailyCandlePayload?.candles]
  );
  const latestCandle = candleRows[candleRows.length - 1] || null;
  const effectiveCurrentPrice = currentPrice > 0 ? currentPrice : latestCandle?.close || 0;
  const displayAveragePrice = convertMoney(averagePrice, itemUnit, displayUnit, usdKrwRate) ?? 0;
  const displayCandleRows = useMemo(
    () => transactionInvestmentDisplayCandleRows(candleRows, itemUnit, displayUnit, usdKrwRate),
    [candleRows, displayUnit, itemUnit, usdKrwRate]
  );
  const displayDailyCandleRows = useMemo(
    () => transactionInvestmentDisplayCandleRows(dailyCandleRows, itemUnit, displayUnit, usdKrwRate),
    [dailyCandleRows, displayUnit, itemUnit, usdKrwRate]
  );
  const visibleCandleRows = useMemo(() => normalizeTransactionChartRows(displayCandleRows), [displayCandleRows]);
  const lineData = useMemo(
    () => transactionInvestmentLineChartData(visibleCandleRows),
    [visibleCandleRows]
  );
  const ohlcData = useMemo(
    () => transactionInvestmentOhlcChartData(visibleCandleRows),
    [visibleCandleRows]
  );
  const volumeData = useMemo(
    () => transactionInvestmentVolumeChartData(visibleCandleRows, lineData),
    [lineData, visibleCandleRows]
  );
  const chartDataReady = useMemo(
    () => transactionInvestmentChartDataReady(lineData, volumeData, volumeVisible),
    [lineData, volumeData, volumeVisible]
  );
  const chartPalette = transactionInvestmentDirectionPalette(dailyReturnPercent);
  const chartColor = chartPalette.lineColor;
  const chartFillColor = chartPalette.fillColor;
  const chartFillBottomColor = chartPalette.fillBottomColor;
  const chartKey = `${symbol}|${intervalMode}|${chartMode}`;
  const displayData = useMemo(() => ({
    schemaVersion: "transaction-status-display-data.v1",
    id: "investment-chart-detail",
    title: `${itemName} 차트뷰`,
    kind: "investment-chart-detail",
    exposure: "rag",
    summary: {
      status: candleLoading ? "loading" : candleError ? "error" : chartDataReady ? "ready" : "empty",
      error: candleError || candleOlderError,
      instrumentId,
      provider: String(item?.provider || "toss").trim(),
      venue: String(item?.venue || "").trim(),
      symbol,
      name: itemName,
      chartMode,
      intervalMode,
      volumeVisible,
      sourceCurrency: itemUnit,
      displayCurrency: displayUnit,
      candleCount: visibleCandleRows.length,
      dailyCandleCount: displayDailyCandleRows.length,
      startTime: visibleCandleRows[0]?.time || visibleCandleRows[0]?.date || "",
      endTime: visibleCandleRows.at(-1)?.time || visibleCandleRows.at(-1)?.date || "",
      currentPrice: effectiveCurrentPrice,
      displayCurrentPrice: convertMoney(effectiveCurrentPrice, itemUnit, displayUnit, usdKrwRate),
      averageKnownCost: averagePrice,
      displayAverageKnownCost: displayAveragePrice,
      quantity: Number(item?.quantity || 0),
      value: Number(item?.value || 0),
      profit: Number(item?.profit || 0),
      profitPercent: Number(item?.profitPercent || 0),
      dailyReturnPercent,
      source: String(candlePayload?.source || payload?.source || "").trim(),
      fetchedAt: String(candlePayload?.fetchedAt || payload?.fetchedAt || "").trim(),
    },
    data: {
      displayedCandles: visibleCandleRows,
      displayedDailyCandles: displayDailyCandleRows,
      priceSeries: chartMode === "candles" || chartMode === "bars" ? ohlcData : lineData,
      volumeSeries: volumeData,
    },
  }), [
    averagePrice,
    candleError,
    candleLoading,
    candleOlderError,
    candlePayload?.fetchedAt,
    candlePayload?.source,
    chartDataReady,
    chartMode,
    dailyReturnPercent,
    displayAveragePrice,
    displayDailyCandleRows,
    displayUnit,
    effectiveCurrentPrice,
    instrumentId,
    intervalMode,
    item,
    itemName,
    itemUnit,
    lineData,
    ohlcData,
    payload?.fetchedAt,
    payload?.source,
    symbol,
    usdKrwRate,
    visibleCandleRows,
    volumeData,
    volumeVisible,
  ]);

  useEffect(() => {
    onDisplayData?.(displayData);
  }, [displayData, onDisplayData]);
  const loadOlderDailyCandles = useCallback(async () => {
    if (!symbol || dailyCandleLoadingRef.current || !dailyCandleRows.length) return;
    if (dailyCandlePayload?.hasMore === false) return;
    const before =
      String(dailyCandlePayload?.nextBefore || "").trim() ||
      transactionInvestmentOlderBeforeFromRows(dailyCandleRows, "1d");
    if (!before || dailyCandleLoadedBeforeRef.current.has(before)) return;
    dailyCandleLoadedBeforeRef.current.add(before);
    dailyCandleLoadingRef.current = true;
    const controller = new AbortController();
    dailyCandleControllerRef.current = controller;
    setDailyCandleOlderLoading(true);
    setDailyCandleError("");
    try {
      const nextPayload = await fetchTransactionInvestmentDetailCandles(candleInstrument, "1d", controller.signal, { before });
      if (controller.signal.aborted) return;
      const nextRows = transactionInvestmentCandleRowsFromPayload(nextPayload?.candles || [], "1d");
      const hasNewOlderRows = transactionInvestmentHasNewCandleRows(dailyCandleRows, nextRows, "1d");
      setDailyCandlePayload((current) => {
        const currentRows = transactionInvestmentCandleRowsFromPayload(current?.candles || [], "1d");
        return {
          ...nextPayload,
          interval: "1d",
          requestedInterval: "1d",
          candles: mergeTransactionInvestmentCandleRows(currentRows, nextRows, "1d"),
          hasMore: nextPayload?.hasMore !== false && hasNewOlderRows,
        };
      });
    } catch (fetchError) {
      if (fetchError.name !== "AbortError" && !controller.signal.aborted) {
        dailyCandleLoadedBeforeRef.current.delete(before);
        setDailyCandleError(fetchError.message || "이전 일별 시세를 더 불러오지 못했습니다.");
      }
    } finally {
      if (dailyCandleControllerRef.current === controller) {
        dailyCandleControllerRef.current = null;
        dailyCandleLoadingRef.current = false;
        if (!controller.signal.aborted) setDailyCandleOlderLoading(false);
      }
    }
  }, [candleInstrument, dailyCandlePayload?.hasMore, dailyCandlePayload?.nextBefore, dailyCandleRows, instrumentId, symbol]);

  const loadOlderCandles = useCallback(async () => {
    if (!symbol || candleLoading || candleOlderLoadingRef.current || !rawCandleRows.length) return;
    if (candlePayload?.hasMore === false) return;
    const sourceInterval = candlePayload?.interval || transactionInvestmentSourceInterval(intervalMode);
    const before =
      String(candlePayload?.nextBefore || "").trim() ||
      transactionInvestmentOlderBeforeFromRows(rawCandleRows, sourceInterval);
    if (!before || candleOlderLoadedBeforeRef.current.has(before)) return;
    candleOlderLoadedBeforeRef.current.add(before);
    candleOlderLoadingRef.current = true;
    const controller = new AbortController();
    candleOlderControllerRef.current = controller;
    setCandleOlderLoading(true);
    setCandleOlderError("");
    try {
      const nextPayload = await fetchTransactionInvestmentDetailCandles(candleInstrument, intervalMode, controller.signal, { before });
      if (controller.signal.aborted) return;
      const nextRows = transactionInvestmentCandleRowsFromPayload(nextPayload?.candles || [], nextPayload?.interval || sourceInterval);
      const mergedRows = mergeTransactionInvestmentCandleRows(rawCandleRows, nextRows, sourceInterval);
      const hasNewOlderRows = transactionInvestmentHasNewCandleRows(rawCandleRows, mergedRows, sourceInterval);
      setCandlePayload({
        ...nextPayload,
        interval: sourceInterval,
        requestedInterval: intervalMode,
        candles: mergedRows,
        hasMore: nextPayload?.hasMore !== false && hasNewOlderRows,
      });
      if (!hasNewOlderRows) {
        setCandleOlderError("");
      }
    } catch (fetchError) {
      if (fetchError.name !== "AbortError" && !controller.signal.aborted) {
        candleOlderLoadedBeforeRef.current.delete(before);
        setCandleOlderError(fetchError.message || "과거 시세를 더 불러오지 못했습니다.");
      }
    } finally {
      if (candleOlderControllerRef.current === controller) {
        candleOlderControllerRef.current = null;
      }
      candleOlderLoadingRef.current = false;
      if (!controller.signal.aborted) setCandleOlderLoading(false);
    }
  }, [
    candleLoading,
    candleInstrument,
    candlePayload?.hasMore,
    candlePayload?.interval,
    candlePayload?.nextBefore,
    intervalMode,
    instrumentId,
    rawCandleRows,
    symbol,
  ]);

  useEffect(() => {
    loadOlderCandlesRef.current = loadOlderCandles;
  }, [loadOlderCandles]);

  const suppressChartRangeChange = useCallback((callback) => {
    chartRangeUpdateSuppressedRef.current = true;
    if (chartRangeSuppressionTimerRef.current) {
      window.clearTimeout(chartRangeSuppressionTimerRef.current);
    }
    try {
      callback();
    } finally {
      chartRangeSuppressionTimerRef.current = window.setTimeout(() => {
        chartRangeSuppressionTimerRef.current = null;
        chartRangeUpdateSuppressedRef.current = false;
      }, 100);
    }
  }, []);

  const clearChartOlderLoadIntent = useCallback(() => {
    chartOlderLoadIntentRef.current = false;
    if (chartOlderLoadIntentTimerRef.current) {
      window.clearTimeout(chartOlderLoadIntentTimerRef.current);
      chartOlderLoadIntentTimerRef.current = null;
    }
  }, []);

  const armChartOlderLoadIntent = useCallback(() => {
    if (candleOlderLoadingRef.current) return;
    if (chartOlderLoadIntentTimerRef.current) {
      window.clearTimeout(chartOlderLoadIntentTimerRef.current);
    }
    chartOlderLoadIntentRef.current = true;
    chartOlderLoadIntentTimerRef.current = window.setTimeout(() => {
      chartOlderLoadIntentTimerRef.current = null;
      chartOlderLoadIntentRef.current = false;
    }, 500);
  }, []);

  const requestOlderCandlesIfNeeded = useCallback((logicalRange = null) => {
    if (chartRangeUpdateSuppressedRef.current) return;
    if (!chartOlderLoadIntentRef.current) return;
    const targetRange = logicalRange || chartRef.current?.timeScale?.().getVisibleLogicalRange?.() || null;
    if (transactionInvestmentShouldLoadOlderFromLogicalRange(seriesRef.current, targetRange)) {
      clearChartOlderLoadIntent();
      loadOlderCandlesRef.current();
    }
  }, [clearChartOlderLoadIntent]);

  useEffect(() => {
    const node = chartContainerRef.current;
    if (!node || !chartDataReady) return undefined;
    const handlePointerMove = (event) => {
      if (event.buttons) armChartOlderLoadIntent();
    };
    node.addEventListener("wheel", armChartOlderLoadIntent, { passive: true });
    node.addEventListener("pointerdown", armChartOlderLoadIntent, { passive: true });
    node.addEventListener("pointermove", handlePointerMove, { passive: true });
    return () => {
      node.removeEventListener("wheel", armChartOlderLoadIntent);
      node.removeEventListener("pointerdown", armChartOlderLoadIntent);
      node.removeEventListener("pointermove", handlePointerMove);
    };
  }, [armChartOlderLoadIntent, chartDataReady]);

  useEffect(() => {
    clearChartOlderLoadIntent();
  }, [chartKey, clearChartOlderLoadIntent]);

  useEffect(() => {
    const node = chartContainerRef.current;
    if (!node || !chartDataReady) return undefined;
    let chart = chartRef.current;
    let series = seriesRef.current;
    const chartSeriesKind = chartMode;
    const baselineBaseValue = displayAveragePrice > 0 ? displayAveragePrice : lineData[0]?.value || 0;
    const chartSeriesKey = [
      chartSeriesKind,
      "stable-no-series-options-v4",
      chartSeriesKind === "baseline" ? baselineBaseValue : "",
      chartSeriesKind === "area" || chartSeriesKind === "line" ? chartColor : "",
    ].join(":");
    const modeChanged = seriesModeRef.current !== chartSeriesKey;
    const chartKeyChanged = previousChartKeyRef.current && previousChartKeyRef.current !== chartKey;
    const visibleLogicalRange = chart?.timeScale?.().getVisibleLogicalRange?.() || null;
    const previousFirstKey = previousFirstCandleKeyRef.current;
    const currentFirstKey = transactionInvestmentCandleRowKey(visibleCandleRows[0] || {}, intervalMode);
    const prependedVisibleCount = previousFirstKey
      ? visibleCandleRows.findIndex((row) => transactionInvestmentCandleRowKey(row, intervalMode) === previousFirstKey)
      : -1;
    const restoredLogicalRange = transactionInvestmentRestoredLogicalRange(visibleLogicalRange, prependedVisibleCount);
    const chartShowsIntradayTime = transactionInvestmentIntervalIsIntraday(intervalMode);
    const chartOptionsKey = `${displayUnit}|${volumeVisible ? "volume" : "price"}|${chartShowsIntradayTime ? "intraday" : "calendar"}`;

    if (!chart) {
      chart = createChart(node, {
        autoSize: true,
        layout: {
          background: { type: ColorType.Solid, color: "#ffffff" },
          textColor: "#667085",
          fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
        },
        grid: {
          vertLines: { color: "rgba(148, 163, 184, 0.13)" },
          horzLines: { color: "rgba(148, 163, 184, 0.13)" },
        },
        localization: {
          priceFormatter: (price) => formatMoney(price, displayUnit),
          timeFormatter: (time) => formatTransactionChartDateLabel(time),
          dateFormat: "yy년 MM월 dd일",
          locale: "ko-KR",
        },
        rightPriceScale: {
          borderColor: "rgba(148, 163, 184, 0.22)",
          scaleMargins: { top: 0.12, bottom: volumeVisible ? 0.28 : 0.14 },
        },
        timeScale: {
          borderColor: "rgba(148, 163, 184, 0.22)",
          timeVisible: chartShowsIntradayTime,
          secondsVisible: false,
          tickMarkFormatter: formatTransactionChartTickMark,
        },
        crosshair: {
          mode: 1,
          vertLine: { visible: true, labelVisible: true },
          horzLine: { visible: true, labelVisible: true },
        },
        handleScroll: true,
        handleScale: true,
      });
      chartRef.current = chart;
      chartOptionsKeyRef.current = chartOptionsKey;
    }
    if (!visibleRangeSubscriptionRef.current) {
      const handleVisibleRangeChange = (logicalRange) => {
        if (!logicalRange) return;
        requestOlderCandlesIfNeeded(logicalRange);
      };
      chart.timeScale().subscribeVisibleLogicalRangeChange(handleVisibleRangeChange);
      visibleRangeSubscriptionRef.current = handleVisibleRangeChange;
    }

    if (chartOptionsKeyRef.current !== chartOptionsKey) {
      chart.applyOptions({
        localization: {
          priceFormatter: (price) => formatMoney(price, displayUnit),
          timeFormatter: (time) => formatTransactionChartDateLabel(time),
          dateFormat: "yy년 MM월 dd일",
          locale: "ko-KR",
        },
        rightPriceScale: {
          scaleMargins: { top: 0.12, bottom: volumeVisible ? 0.28 : 0.14 },
        },
        timeScale: {
          timeVisible: chartShowsIntradayTime,
          secondsVisible: false,
          tickMarkFormatter: formatTransactionChartTickMark,
        },
      });
      chartOptionsKeyRef.current = chartOptionsKey;
    }

    if (!series || modeChanged) {
      if (averagePriceLineRef.current && series) {
        try {
          series.removePriceLine(averagePriceLineRef.current);
        } catch {
          // Removed series may already have released the price line.
        }
        averagePriceLineRef.current = null;
        averagePriceLineValueRef.current = null;
      }
      if (series) {
        chart.removeSeries(series);
        priceSeriesDataRef.current = { identity: "", rows: [] };
      }
      if (chartMode === "candles") {
        series = chart.addSeries(CandlestickSeries, {
          upColor: "#e11d48",
          borderUpColor: "#e11d48",
          wickUpColor: "#e11d48",
          downColor: "#2878ff",
          borderDownColor: "#2878ff",
          wickDownColor: "#2878ff",
        });
      } else if (chartMode === "bars") {
        series = chart.addSeries(BarSeries, {
          upColor: "#e11d48",
          downColor: "#2878ff",
          thinBars: false,
        });
      } else if (chartSeriesKind === "area") {
        series = chart.addSeries(AreaSeries, {
          lineColor: chartColor,
          topColor: chartFillColor,
          bottomColor: chartFillBottomColor,
          lineWidth: 2,
          priceLineVisible: false,
          lastValueVisible: true,
        });
      } else if (chartSeriesKind === "baseline") {
        series = chart.addSeries(BaselineSeries, {
          baseValue: { type: "price", price: baselineBaseValue },
          topLineColor: "#e11d48",
          topFillColor1: "rgba(225, 29, 72, 0.18)",
          topFillColor2: "rgba(225, 29, 72, 0.02)",
          bottomLineColor: "#2878ff",
          bottomFillColor1: "rgba(40, 120, 255, 0.02)",
          bottomFillColor2: "rgba(40, 120, 255, 0.18)",
          lineWidth: 2,
          priceLineVisible: false,
          lastValueVisible: true,
        });
      } else if (chartSeriesKind === "line") {
        series = chart.addSeries(LineSeries, {
          color: chartColor,
          lineWidth: 2,
          priceLineVisible: false,
          lastValueVisible: true,
        });
      }
      seriesRef.current = series;
      seriesModeRef.current = chartSeriesKey;
    }

    const nextPriceSeriesRows = chartMode === "candles" || chartMode === "bars" ? ohlcData : lineData;
    const priceSeriesIdentity = `${chartKey}|${chartSeriesKey}|${displayUnit}`;
    const previousPriceSeriesData = priceSeriesDataRef.current;
    if (
      previousPriceSeriesData.identity === priceSeriesIdentity &&
      transactionInvestmentCanUpdateLastChartDatum(previousPriceSeriesData.rows, nextPriceSeriesRows)
    ) {
      series.update(nextPriceSeriesRows[nextPriceSeriesRows.length - 1]);
    } else {
      const replacePriceSeriesData = () => series.setData(nextPriceSeriesRows);
      if (prependedVisibleCount > 0) {
        suppressChartRangeChange(replacePriceSeriesData);
      } else {
        replacePriceSeriesData();
      }
    }
    priceSeriesDataRef.current = { identity: priceSeriesIdentity, rows: nextPriceSeriesRows };

    if (volumeVisible) {
      if (!volumeSeriesRef.current) {
        volumeSeriesRef.current = chart.addSeries(HistogramSeries, {
          priceFormat: { type: "volume" },
          priceScaleId: "volume",
          priceLineVisible: false,
          lastValueVisible: false,
          color: "rgba(100, 116, 139, 0.28)",
        });
        volumeSeriesDataRef.current = { identity: "", rows: [] };
      }
      chart.priceScale("volume").applyOptions({
        visible: false,
        borderVisible: false,
        scaleMargins: { top: 0.78, bottom: 0 },
      });
      const volumeSeriesIdentity = `${chartKey}|volume`;
      const previousVolumeSeriesData = volumeSeriesDataRef.current;
      if (
        previousVolumeSeriesData.identity === volumeSeriesIdentity &&
        transactionInvestmentCanUpdateLastChartDatum(previousVolumeSeriesData.rows, volumeData)
      ) {
        volumeSeriesRef.current.update(volumeData[volumeData.length - 1]);
      } else {
        volumeSeriesRef.current.setData(volumeData);
      }
      volumeSeriesDataRef.current = { identity: volumeSeriesIdentity, rows: volumeData };
    } else if (volumeSeriesRef.current) {
      volumeSeriesRef.current.setData([]);
      volumeSeriesDataRef.current = { identity: "", rows: [] };
    }

    if (averagePriceLineRef.current && averagePriceLineValueRef.current !== displayAveragePrice) {
      try {
        series.removePriceLine(averagePriceLineRef.current);
      } catch {
        // Price line cleanup is best-effort across chart mode changes.
      }
      averagePriceLineRef.current = null;
      averagePriceLineValueRef.current = null;
    }
    if (!averagePriceLineRef.current && displayAveragePrice > 0) {
      averagePriceLineRef.current = series.createPriceLine({
        price: displayAveragePrice,
        color: "rgba(71, 85, 105, 0.62)",
        lineWidth: 1,
        lineStyle: 2,
        axisLabelVisible: true,
        title: "내 평균",
      });
      averagePriceLineValueRef.current = displayAveragePrice;
    }

    if (!previousChartKeyRef.current || chartKeyChanged) {
      suppressChartRangeChange(() => chart.timeScale().fitContent());
    } else if (restoredLogicalRange) {
      suppressChartRangeChange(() => chart.timeScale().setVisibleLogicalRange(restoredLogicalRange));
    }
    previousChartKeyRef.current = chartKey;
    previousFirstCandleKeyRef.current = currentFirstKey;

    return undefined;
  }, [
    chartFillBottomColor,
    chartFillColor,
    chartColor,
    chartKey,
    chartMode,
    displayAveragePrice,
    displayUnit,
    intervalMode,
    chartDataReady,
    lineData,
    ohlcData,
    volumeData,
    volumeVisible,
    visibleCandleRows,
    requestOlderCandlesIfNeeded,
    suppressChartRangeChange,
  ]);

  useEffect(
    () => () => {
      if (chartRef.current) {
        if (visibleRangeSubscriptionRef.current) {
          chartRef.current.timeScale().unsubscribeVisibleLogicalRangeChange(visibleRangeSubscriptionRef.current);
          visibleRangeSubscriptionRef.current = null;
        }
        chartRef.current.remove();
        chartRef.current = null;
      }
      seriesRef.current = null;
      volumeSeriesRef.current = null;
      seriesModeRef.current = "";
      averagePriceLineRef.current = null;
      averagePriceLineValueRef.current = null;
      previousChartKeyRef.current = "";
      chartOptionsKeyRef.current = "";
      priceSeriesDataRef.current = { identity: "", rows: [] };
      volumeSeriesDataRef.current = { identity: "", rows: [] };
      candleOlderLoadingRef.current = false;
      candleOlderControllerRef.current?.abort();
      candleOlderControllerRef.current = null;
      candleOlderLoadedBeforeRef.current = new Set();
      if (chartRangeSuppressionTimerRef.current) {
        window.clearTimeout(chartRangeSuppressionTimerRef.current);
        chartRangeSuppressionTimerRef.current = null;
      }
      chartRangeUpdateSuppressedRef.current = false;
      if (chartOlderLoadIntentTimerRef.current) {
        window.clearTimeout(chartOlderLoadIntentTimerRef.current);
        chartOlderLoadIntentTimerRef.current = null;
      }
      chartOlderLoadIntentRef.current = false;
      previousFirstCandleKeyRef.current = "";
    },
    []
  );

  const displayValue = convertedMoney(item?.value, itemUnit, displayUnit, usdKrwRate);
  const displayProfit = convertedMoney(item?.profit, itemUnit, displayUnit, usdKrwRate);
  const displayCostBasis = convertedMoney(item?.costBasis, itemUnit, displayUnit, usdKrwRate);
  const secondaryPriceUnit = displayUnit === "USD" ? "KRW" : "USD";
  const primaryPriceLabel =
    effectiveCurrentPrice > 0
      ? formatConvertedMoney(effectiveCurrentPrice, itemUnit, displayUnit, usdKrwRate)
      : "-";
  const secondaryPriceLabel =
    effectiveCurrentPrice > 0
      ? formatConvertedMoney(effectiveCurrentPrice, itemUnit, secondaryPriceUnit, usdKrwRate)
      : "-";
  const previousClose = Number(item?.previousClose);
  const dailyPriceChange =
    effectiveCurrentPrice > 0 && Number.isFinite(previousClose) && previousClose > 0
      ? effectiveCurrentPrice - previousClose
      : effectiveCurrentPrice > 0 && Number.isFinite(dailyReturnPercent) && dailyReturnPercent > -100
        ? effectiveCurrentPrice - effectiveCurrentPrice / (1 + dailyReturnPercent / 100)
        : null;
  const dailyPriceChangeAmount = Number.isFinite(dailyPriceChange)
    ? convertMoney(dailyPriceChange, itemUnit, displayUnit, usdKrwRate)
    : null;
  const dailyPriceChangeLabel = dailyPriceChangeAmount !== null
    ? formatSignedMoney(dailyPriceChangeAmount, displayUnit)
    : "-";
  const activeChartMode = transactionInvestmentDetailChartModes.some((mode) => mode.id === chartMode) ? chartMode : "area";
  const activeMinuteInterval = transactionInvestmentMinuteIntervals.find((interval) => interval.id === intervalMode);
  const minuteTriggerLabel = activeMinuteInterval?.label || transactionInvestmentMinuteIntervals[0].label;
  const intervalLabel =
    activeMinuteInterval?.label ||
    transactionInvestmentTimeframeTabs.find((timeframe) => timeframe.id === intervalMode)?.label ||
    "일";
  const isCryptoInstrument = itemIsCrypto(item);

  return (
    <section className="transaction-main-section transaction-asset-detail-section" aria-label={`${itemName} 상세`}>
      <TransactionMarketDataStatus
        statusBannerProps={statusBannerProps}
        instruments={[item]}
        binanceStatus={binanceStatus}
        binanceError={binanceError}
      />
      <div className="transaction-asset-detail-header">
        <div className="transaction-asset-quote-block">
          <div className="transaction-asset-title-block">
            <strong>{itemName}</strong>
            <span>{item?.displaySymbol || symbol}</span>
          </div>
          <div className="transaction-asset-price-block">
            <strong>{primaryPriceLabel}</strong>
            <b>{secondaryPriceLabel}</b>
            <span className="transaction-asset-price-comparison">
              {isCryptoInstrument ? "· 지난 미국 정규장 마감보다" : "· 지난 정규장보다"}
            </span>
            <span className={`transaction-asset-price-change ${valueTone(dailyReturnPercent)}`.trim()}>
              {dailyPriceChangeLabel} ({formatSignedPercent(dailyReturnPercent)})
            </span>
          </div>
        </div>
        <div className="transaction-asset-detail-header-actions">
          <CurrencySwitch unit={displayUnit} onChange={onUnitChange} label="메인 섹션 통화 표시" />
          {onClose ? (
            <button
              className="transaction-asset-detail-close-button"
              type="button"
              aria-label={`${itemName} 차트 닫기`}
              title="차트 닫기"
              onClick={onClose}
            >
              <X size={17} strokeWidth={2.6} aria-hidden="true" />
            </button>
          ) : null}
        </div>
      </div>

      <div className="transaction-asset-summary-strip" aria-label="선택 종목 보유 지표">
        <div>
          <span>평가금</span>
          <strong>{formatOptionalMoney(displayValue.hasValue, displayValue.value, displayUnit)}</strong>
        </div>
        <div>
          <span>원금</span>
          <strong>{formatOptionalMoney(displayCostBasis.hasValue, displayCostBasis.value, displayUnit)}</strong>
        </div>
        <div>
          <span>총 수익</span>
          <strong className={valueTone(item?.profit)}>
            {formatOptionalSignedMoney(displayProfit.hasValue, displayProfit.value, displayUnit)}
          </strong>
        </div>
        <div>
          <span>수익률</span>
          <strong className={valueTone(item?.profitPercent)}>{formatSignedPercent(item?.profitPercent)}</strong>
        </div>
        <div>
          <span>보유 수량</span>
          <strong>{formatQuantity(item?.quantity, item)}</strong>
        </div>
        <div>
          <span>평단가</span>
          <strong>{displayAveragePrice > 0 ? formatMoney(displayAveragePrice, displayUnit) : "-"}</strong>
        </div>
      </div>

      <div className="transaction-asset-detail-scroll">
        <section className="transaction-asset-chart-panel" aria-label={`${itemName} 가격 차트`}>
          <div className="transaction-asset-chart-toolbar">
            <div className="transaction-asset-chart-primary-tools">
              <div className="transaction-asset-chart-ranges" role="group" aria-label="봉 모드">
                <div className="transaction-asset-minute-menu" ref={minuteMenuRef}>
                  <button
                    className={activeMinuteInterval ? "is-active" : ""}
                    type="button"
                    aria-expanded={minuteMenuOpen}
                    aria-pressed={Boolean(activeMinuteInterval)}
                    onClick={() => setMinuteMenuOpen((current) => !current)}
                  >
                    <span>{minuteTriggerLabel}</span>
                    <ChevronDown size={14} strokeWidth={2.4} aria-hidden="true" />
                  </button>
                  {minuteMenuOpen ? (
                    <div className="transaction-asset-minute-popover" role="menu">
                      {transactionInvestmentMinuteIntervals.map((interval) => (
                        <button
                          className={interval.id === intervalMode ? "is-active" : ""}
                          type="button"
                          role="menuitemradio"
                          aria-checked={interval.id === intervalMode}
                          key={`transaction-asset-minute-${interval.id}`}
                          onClick={() => handleIntervalModeSelect(interval.id)}
                        >
                          {interval.label}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
                {transactionInvestmentTimeframeTabs.map((timeframe) => (
                  <button
                    className={timeframe.id === intervalMode ? "is-active" : ""}
                    type="button"
                    key={`transaction-asset-timeframe-${timeframe.id}`}
                    aria-pressed={timeframe.id === intervalMode}
                    onClick={() => handleIntervalModeSelect(timeframe.id)}
                  >
                    {timeframe.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="transaction-asset-chart-options">
              <label className="transaction-asset-volume-toggle">
                <input
                  type="checkbox"
                  checked={volumeVisible}
                  onChange={handleVolumeVisibleChange}
                />
                <span>거래량</span>
              </label>
              <div className="transaction-asset-chart-modes" role="group" aria-label="차트 형식">
                {transactionInvestmentDetailChartModes.map((mode) => (
                  <button
                    className={mode.id === activeChartMode ? "is-active" : ""}
                    type="button"
                    key={`transaction-asset-mode-${mode.id}`}
                    aria-pressed={mode.id === activeChartMode}
                    onClick={() => handleChartModeSelect(mode.id)}
                  >
                    {mode.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="transaction-asset-chart-frame">
            {onBuy || onSell ? (
              <div className="transaction-asset-chart-trade-actions" role="group" aria-label={`${itemName} 모의투자 주문`}>
                <button className="is-buy" type="button" disabled={!onBuy} onClick={() => onBuy?.(item)}>
                  매수
                </button>
                <button className="is-sell" type="button" disabled={!onSell} onClick={() => onSell?.(item)}>
                  매도
                </button>
              </div>
            ) : null}
            {candleLoading ? <div className="transaction-asset-chart-state">차트 데이터 로딩</div> : null}
            {!candleLoading && candleError ? <div className="transaction-asset-chart-state is-error">{candleError}</div> : null}
            {!candleLoading && !candleError && !lineData.length ? (
              <div className="transaction-asset-chart-state">가격 차트 데이터가 없습니다.</div>
            ) : null}
            {!candleLoading && !candleError && candleOlderLoading ? (
              <div className="transaction-asset-chart-older-state">과거 데이터 로딩</div>
            ) : null}
            {!candleLoading && !candleError && candleOlderError ? (
              <div className="transaction-asset-chart-older-state is-error">{candleOlderError}</div>
            ) : null}
            <div
              className={lineData.length && !candleLoading && !candleError ? "transaction-asset-chart-canvas" : "transaction-asset-chart-canvas is-hidden"}
              ref={chartContainerRef}
            />
          </div>
          <div className="transaction-asset-chart-credit">
            <span>{[candlePayload?.source || "토스 증권 API 시세", intervalLabel].join(" · ")}</span>
            <a href="https://www.tradingview.com/" target="_blank" rel="noreferrer">
              Lightweight Charts™
            </a>
          </div>
        </section>

        <TransactionAssetDailyTable
          rows={displayDailyCandleRows}
          unit={displayUnit}
          initialLoading={dailyCandleLoading}
          loadingMore={dailyCandleOlderLoading}
          hasMore={dailyCandlePayload?.hasMore !== false}
          error={dailyCandleError}
          onLoadMore={loadOlderDailyCandles}
          onRetry={loadInitialDailyCandles}
        />
      </div>
    </section>
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
  onSelectItem,
  onDisplayData,
  sidebarValueMode = "value",
}) {
  const [activeFilter, setActiveFilter] = useState("all");
  const displayUnit = normalizeMoneyUnit(unit);
  const hasPayload = Boolean(payload?.ok);
  const totals = aggregatePerformance(items, displayUnit, usdKrwRate);
  const overseasCount = items.filter(itemIsOverseasStock).length;
  const domesticCount = items.filter(itemIsDomesticStock).length;
  const cryptoCount = items.filter(itemIsCrypto).length;
  const stockCount = overseasCount + domesticCount;
  const periodProfitLabel = "일간 수익";
  const filteredItems = useMemo(() => {
    if (activeFilter === "overseas") return items.filter(itemIsOverseasStock);
    if (activeFilter === "domestic") return items.filter(itemIsDomesticStock);
    if (activeFilter === "crypto") return items.filter(itemIsCrypto);
    return items;
  }, [activeFilter, items]);
  const activeFilterLabel =
    activeFilter === "overseas"
      ? "해외주식"
      : activeFilter === "domestic"
        ? "국내주식"
        : activeFilter === "crypto"
          ? "암호자산"
          : "전체";
  const shouldShowBlockingError = Boolean(error && !payload);
  const displayData = useMemo(
    () => transactionInvestmentOverviewDisplayData({
      kind: "live-investment-overview",
      title: "내 투자 첫 페이지",
      accountType: "live",
      accountId: payload?.accountSeq || "",
      items,
      filteredItems,
      payload,
      displayUnit,
      usdKrwRate,
      activeFilter,
      selectedColumnIds: selectedTableColumnIds,
      sidebarValueMode,
    }),
    [activeFilter, displayUnit, filteredItems, items, payload, selectedTableColumnIds, sidebarValueMode, usdKrwRate]
  );

  useEffect(() => {
    onDisplayData?.(displayData);
  }, [displayData, onDisplayData]);

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
            {periodProfitLabel} {formatOptionalPerformance(
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
        <button
          className={activeFilter === "crypto" ? "is-active" : ""}
          type="button"
          aria-pressed={activeFilter === "crypto"}
          onClick={() => setActiveFilter("crypto")}
        >
          암호자산 {cryptoCount}개
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
          onSelectItem={onSelectItem}
        />
      )}
    </section>
  );
}

function TransactionMarketDataStatus({
  statusBannerProps,
  instruments = [],
  binanceStatus = null,
  binanceError = "",
  showBinanceWhenEmpty = false,
}) {
  const normalizedInstruments = normalizeTransactionWatchlistInstrumentsSetting(instruments);
  const usesBinance = showBinanceWhenEmpty || normalizedInstruments.some((instrument) => instrument.provider === "binance");
  const usesToss = !normalizedInstruments.length || normalizedInstruments.some((instrument) => instrument.provider !== "binance");
  const availability = transactionBinanceProviderAvailability(binanceStatus, binanceError);
  const binanceConnected = availability.available;
  return (
    <div className="transaction-market-provider-status-stack">
      {usesToss ? <PortfolioTossApiStatus {...statusBannerProps} /> : null}
      {usesBinance ? (
        <div
          className={`transaction-market-provider-status is-binance ${binanceConnected ? "is-connected" : "is-error"}`}
          role="status"
        >
          <strong>Binance 공개 시세</strong>
          <span>{binanceConnected ? "API 키 없이 연결됨 · USDT=USD" : availability.reason}</span>
        </div>
      ) : null}
    </div>
  );
}

function SimulatorInvestmentMain({
  simulator,
  items: orderedItems = [],
  payload,
  unit,
  usdKrwRate,
  onUnitChange,
  selectedTableColumnIds,
  onTableColumnsChange,
  statusBannerProps,
  binanceStatus,
  binanceError = "",
  deleteBusy = false,
  simulatorRenameTarget = null,
  simulatorRenameDraft = "",
  simulatorRenameBusy = false,
  simulatorRenameError = "",
  onDeleteSimulator,
  onOpenSymbolSearch,
  onSimulatorRenameStart,
  onSimulatorRenameDraftChange,
  onSimulatorRenameSubmit,
  onSimulatorRenameCancel,
  onSelectItem,
  onDisplayData,
  sidebarValueMode = "value",
}) {
  const [activeFilter, setActiveFilter] = useState("all");
  const displayUnit = normalizeMoneyUnit(unit);
  const simulatorName = simulatorDisplayLabel(simulator, 0);
  const hasPayload = Boolean(payload?.ok);
  const items = useMemo(
    () => (
      Array.isArray(orderedItems)
        ? orderedItems.map((item) => normalizeItem(item, payload?.unit || displayUnit))
        : []
    ),
    [displayUnit, orderedItems, payload?.unit]
  );
  const totals = aggregatePerformance(items, displayUnit, usdKrwRate);
  const overseasCount = items.filter(itemIsOverseasStock).length;
  const domesticCount = items.filter(itemIsDomesticStock).length;
  const cryptoCount = items.filter(itemIsCrypto).length;
  const simulatorStockCount = overseasCount + domesticCount;
  const simulatorPeriodProfitLabel = "일간 수익";
  const filteredItems = useMemo(() => {
    if (activeFilter === "overseas") return items.filter(itemIsOverseasStock);
    if (activeFilter === "domestic") return items.filter(itemIsDomesticStock);
    if (activeFilter === "crypto") return items.filter(itemIsCrypto);
    return items;
  }, [activeFilter, items]);
  const activeFilterLabel =
    activeFilter === "overseas"
      ? "해외주식"
      : activeFilter === "domestic"
        ? "국내주식"
        : activeFilter === "crypto"
          ? "암호자산"
          : "전체";
  const mainRenameEditing = Boolean(
    simulator?.id &&
      simulatorRenameTarget?.simulatorId === simulator.id &&
      simulatorRenameTarget?.placement === "main"
  );
  const displayData = useMemo(
    () => transactionInvestmentOverviewDisplayData({
      kind: "simulator-investment-overview",
      title: `${simulatorName} 첫 페이지`,
      accountType: "simulator",
      accountId: simulator?.id || "",
      items,
      filteredItems,
      payload,
      displayUnit,
      usdKrwRate,
      activeFilter,
      selectedColumnIds: selectedTableColumnIds,
      sidebarValueMode,
    }),
    [activeFilter, displayUnit, filteredItems, items, payload, selectedTableColumnIds, sidebarValueMode, simulator?.id, simulatorName, usdKrwRate]
  );

  useEffect(() => {
    onDisplayData?.(displayData);
  }, [displayData, onDisplayData]);

  return (
    <section className="transaction-main-section transaction-simulator-main-section" aria-label={`${simulatorName} 상세`}>
      <TransactionMarketDataStatus
        statusBannerProps={statusBannerProps}
        instruments={items}
        binanceStatus={binanceStatus}
        binanceError={binanceError}
        showBinanceWhenEmpty
      />

      <div className="transaction-simulator-banner" aria-label="시뮬레이터 상태">
        <div className="transaction-simulator-banner-copy">
          <span>시뮬레이터</span>
          <strong>실계좌와 분리된 모의 계좌</strong>
        </div>
        <button
          className="transaction-simulator-delete-button"
          type="button"
          title={`${simulatorName} 삭제`}
          aria-label={`${simulatorName} 삭제`}
          disabled={deleteBusy}
          onClick={() => onDeleteSimulator?.(simulator?.id)}
        >
          <Trash2 size={16} strokeWidth={2.25} aria-hidden="true" />
        </button>
      </div>

      <div className="transaction-main-summary is-actionable">
        <span className="transaction-main-summary-title">
          <SimulatorEditableName
            simulator={simulator}
            placement="main"
            editing={mainRenameEditing}
            draft={simulatorRenameDraft}
            busy={simulatorRenameBusy}
            error={mainRenameEditing ? simulatorRenameError : ""}
            onStart={onSimulatorRenameStart}
            onDraftChange={onSimulatorRenameDraftChange}
            onSubmit={onSimulatorRenameSubmit}
            onCancel={onSimulatorRenameCancel}
          />
        </span>
        <div>
          <strong>{formatOptionalMoney(hasPayload && totals.value.hasValue, totals.value.value, displayUnit)}</strong>
          <em>원금 {formatOptionalMoney(hasPayload && totals.costBasis.hasValue, totals.costBasis.value, displayUnit)}</em>
          <em className={hasPayload ? valueTone(totals.profit.value) : ""}>
            총 수익 {formatOptionalPerformance(hasPayload && totals.profit.hasValue, totals.profit.value, totals.profitPercent, displayUnit)}
          </em>
          <em className={hasPayload ? valueTone(totals.dailyProfit.value) : ""}>
            {simulatorPeriodProfitLabel} {formatOptionalPerformance(
              hasPayload && totals.dailyProfit.hasValue,
              totals.dailyProfit.value,
              payload?.dailyReturnPercent || 0,
              displayUnit
            )}
          </em>
        </div>
        <button
          className="transaction-simulator-search-button"
          type="button"
          aria-label={`${simulatorName} 종목검색`}
          title={`${simulatorName} 종목검색`}
          onClick={onOpenSymbolSearch}
        >
          <Search size={15} strokeWidth={2.4} aria-hidden="true" />
          <span>종목검색</span>
        </button>
      </div>

      <div className="transaction-main-filters" aria-label="모의 보유 종목 필터">
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
        <button
          className={activeFilter === "crypto" ? "is-active" : ""}
          type="button"
          aria-pressed={activeFilter === "crypto"}
          onClick={() => setActiveFilter("crypto")}
        >
          암호자산 {cryptoCount}개
        </button>
        <TransactionColumnFilter
          selectedColumnIds={selectedTableColumnIds}
          onChange={onTableColumnsChange}
        />
        <CurrencySwitch unit={displayUnit} onChange={onUnitChange} label="시뮬레이터 표 통화 표시" />
      </div>

      <InvestmentTable
        items={filteredItems}
        payload={payload}
        unit={displayUnit}
        usdKrwRate={usdKrwRate}
        selectedColumnIds={selectedTableColumnIds}
        emptyLabel={`${activeFilterLabel} 모의 보유 종목이 없습니다.`}
        onSelectItem={onSelectItem}
      />
    </section>
  );
}

function watchlistRowsFromGroup(group, items, symbolOptions = [], priceMap = new Map()) {
  const itemByInstrument = new Map();
  const itemBySymbol = new Map();
  for (const item of items) {
    const instrumentId = transactionInstrumentKey(item);
    if (instrumentId && !itemByInstrument.has(instrumentId)) {
      itemByInstrument.set(instrumentId, item);
    }
    const symbol = transactionItemOrderKey(item);
    if (symbol && !itemBySymbol.has(symbol)) {
      itemBySymbol.set(symbol, item);
    }
  }
  const optionByInstrument = new Map(
    symbolOptions
      .map((option) => [transactionInstrumentKey(option), option])
      .filter(([instrumentId]) => instrumentId)
  );
  const instruments = normalizeTransactionWatchlistInstrumentsSetting(group?.instruments, group?.symbols);
  return instruments.map((instrument) => {
    const symbol = instrument.symbol;
    const item = instrument.instrumentId
      ? itemByInstrument.get(instrument.instrumentId) || null
      : itemBySymbol.get(symbol) || null;
    const option = optionByInstrument.get(instrument.instrumentId) || instrument;
    const price = instrument.instrumentId
      ? priceMap.get(instrument.instrumentId) || null
      : priceMap.get(symbol) || null;
    const displayItem = normalizeTransactionInstrument({
      ...instrument,
      ...option,
      ...price,
      ...(item || {}),
      name: displayNameFromInstrumentSources(item, option, price, instrument),
    });
    const row = {
      ...instrument,
      symbol,
      item,
      option,
      price,
      name: displayName(displayItem || item || option || price),
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

function transactionWatchlistDetailItem(row, fallbackUnit = "KRW") {
  const source = row?.item || row?.option || {};
  const displayCurrency = normalizeMoneyUnit(
    row?.price?.currency || source?.displayCurrency || source?.currency || fallbackUnit
  );
  const hasDailyReturn = Boolean(row?.hasDailyReturn && Number.isFinite(Number(row?.dailyReturnPercent)));
  const dailyReturnPercent = hasDailyReturn ? Number(row.dailyReturnPercent) : Number(source?.dailyReturnPercent || 0);
  return normalizeItem({
    ...source,
    instrumentId: row?.instrumentId || source?.instrumentId,
    provider: row?.provider || source?.provider,
    venue: row?.venue || source?.venue,
    assetClass: row?.assetClass || source?.assetClass,
    displaySymbol: row?.displaySymbol || source?.displaySymbol,
    baseAsset: row?.baseAsset || source?.baseAsset,
    quoteAsset: row?.quoteAsset || source?.quoteAsset,
    settlementAsset: row?.settlementAsset || source?.settlementAsset,
    nativeQuoteAsset: row?.nativeQuoteAsset || source?.nativeQuoteAsset,
    sessionPolicy: row?.sessionPolicy || source?.sessionPolicy,
    status: row?.status || source?.status,
    symbol: cleanTransactionWatchlistSymbol(row?.symbol),
    label: String(row?.name || source?.label || source?.name || row?.symbol || "-").trim(),
    currency: displayCurrency,
    displayCurrency,
    currentPrice: Number(row?.lastPrice ?? source?.currentPrice ?? 0),
    marketDailyReturnPercent: hasDailyReturn ? dailyReturnPercent : source?.marketDailyReturnPercent,
    dailyReturnPercent,
  }, displayCurrency);
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
  onSelectSymbol,
}) {
  const [draggedInstrumentId, setDraggedInstrumentId] = useState("");
  const [dragOverInstrumentId, setDragOverInstrumentId] = useState("");
  const [dragInsertPlacement, setDragInsertPlacement] = useState("before");
  const [dragPreview, setDragPreview] = useState(null);
  const pointerDraggedInstrumentIdRef = useRef("");
  const pointerDragOverInstrumentIdRef = useRef("");
  const pointerDragPlacementRef = useRef("before");
  const rowsRef = useRef(rows);

  useEffect(() => {
    rowsRef.current = rows;
  }, [rows]);

  const updateDragOverInstrument = useCallback((instrumentId, placement = "before") => {
    pointerDragOverInstrumentIdRef.current = instrumentId;
    pointerDragPlacementRef.current = placement;
    setDragOverInstrumentId(instrumentId);
    setDragInsertPlacement(placement);
  }, []);

  const handleSymbolDragEnd = useCallback(() => {
    pointerDraggedInstrumentIdRef.current = "";
    pointerDragOverInstrumentIdRef.current = "";
    pointerDragPlacementRef.current = "before";
    setDraggedInstrumentId("");
    setDragOverInstrumentId("");
    setDragInsertPlacement("before");
    setDragPreview(null);
  }, []);

  const commitInstrumentOrderChange = useCallback((sourceId, targetId, placement = "before") => {
    const currentRows = Array.isArray(rowsRef.current) ? rowsRef.current : [];
    const currentOrder = currentRows.map((row) => row.instrumentId);
    const nextOrder = reorderTransactionWatchlistInstruments(currentOrder, sourceId, targetId, placement);
    if (arraysEqual(currentOrder, nextOrder)) return;
    const rowById = new Map(currentRows.map((row) => [row.instrumentId, row]));
    rowsRef.current = nextOrder.map((instrumentId) => rowById.get(instrumentId)).filter(Boolean);
    onOrderChange(nextOrder);
  }, [onOrderChange]);

  const handleSymbolPointerStart = useCallback((event, row) => {
    if (!orderEditing) return;
    if (event.type === "mousedown" && pointerDraggedInstrumentIdRef.current) return;
    const instrumentId = cleanTransactionInstrumentId(row?.instrumentId);
    if (!instrumentId) return;
    pointerDraggedInstrumentIdRef.current = instrumentId;
    pointerDragOverInstrumentIdRef.current = instrumentId;
    pointerDragPlacementRef.current = "before";
    setDraggedInstrumentId(instrumentId);
    setDragOverInstrumentId(instrumentId);
    setDragInsertPlacement("before");
    setDragPreview({
      instrumentId,
      symbol: row.symbol,
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
    if (!orderEditing || !pointerDraggedInstrumentIdRef.current) return;
    setDragPreview((current) => (
      current ? { ...current, x: event.clientX, y: event.clientY } : current
    ));
  }, [orderEditing]);

  const handleSymbolPointerEnd = useCallback(() => {
    if (!orderEditing || !pointerDraggedInstrumentIdRef.current) return;
    handleSymbolDragEnd();
  }, [handleSymbolDragEnd, orderEditing]);

  useEffect(() => {
    if (!orderEditing || !draggedInstrumentId) return undefined;
    function dropTargetFromPoint(clientX, clientY) {
      const target = document.elementFromPoint(clientX, clientY);
      const row = target?.closest?.("[data-transaction-watchlist-instrument]");
      const instrumentId = cleanTransactionInstrumentId(row?.dataset?.transactionWatchlistInstrument);
      if (!row || !instrumentId) return null;
      const rect = row.getBoundingClientRect();
      return {
        instrumentId,
        placement: clientY > rect.top + rect.height / 2 ? "after" : "before",
      };
    }
    function handleDocumentMove(event) {
      if (!pointerDraggedInstrumentIdRef.current) return;
      const clientX = Number(event.clientX || 0);
      const clientY = Number(event.clientY || 0);
      setDragPreview((current) => (
        current ? { ...current, x: clientX, y: clientY } : current
      ));
      const target = dropTargetFromPoint(clientX, clientY);
      if (!target) return;
      if (
        target.instrumentId === pointerDragOverInstrumentIdRef.current &&
        target.placement === pointerDragPlacementRef.current
      ) {
        return;
      }
      updateDragOverInstrument(target.instrumentId, target.placement);
      if (target.instrumentId !== pointerDraggedInstrumentIdRef.current) {
        commitInstrumentOrderChange(pointerDraggedInstrumentIdRef.current, target.instrumentId, target.placement);
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
    commitInstrumentOrderChange,
    draggedInstrumentId,
    handleSymbolDragEnd,
    orderEditing,
    updateDragOverInstrument,
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
              !orderEditing && onSelectSymbol ? "is-selectable" : "",
              orderEditing ? "is-manual-sort" : "",
              dragOverInstrumentId === row.instrumentId && draggedInstrumentId && draggedInstrumentId !== row.instrumentId
                ? `is-drop-${dragInsertPlacement}`
                : "",
              draggedInstrumentId === row.instrumentId ? "is-dragging" : "",
            ].filter(Boolean).join(" ");
            return (
            <tr
              className={rowClassName}
              key={`transaction-watchlist-row-${row.instrumentId || row.symbol}`}
              data-transaction-watchlist-instrument={row.instrumentId || row.symbol}
              tabIndex={!orderEditing && onSelectSymbol ? 0 : undefined}
              onClick={!orderEditing && onSelectSymbol ? () => onSelectSymbol(row.instrumentId || row.symbol) : undefined}
              onKeyDown={!orderEditing && onSelectSymbol ? (event) => {
                if (event.key !== "Enter" && event.key !== " ") return;
                event.preventDefault();
                onSelectSymbol(row.instrumentId || row.symbol);
              } : undefined}
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
                    key={`transaction-watchlist-row-${row.instrumentId || row.symbol}-${column.key}`}
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
                    onClick={(event) => {
                      event.stopPropagation();
                      onRemoveSymbol(row.instrumentId || row.symbol);
                    }}
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
  binanceStatus,
  binanceError = "",
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
  onSelectSymbol,
  onDisplayData,
}) {
  const hasSelectedGroup = Boolean(selectedGroup);
  const rows = useMemo(
    () => watchlistRowsFromGroup(selectedGroup, items, symbolOptions, priceMap),
    [items, priceMap, selectedGroup, symbolOptions]
  );
  const averageDailyReturn = useMemo(() => averageWatchlistDailyReturn(rows), [rows]);
  const stockAverageReturn = useMemo(
    () => averageWatchlistDailyReturn(rows.filter((row) => row.provider !== "binance")),
    [rows],
  );
  const cryptoAverageReturn = useMemo(
    () => averageWatchlistDailyReturn(rows.filter((row) => row.provider === "binance")),
    [rows],
  );
  const hasMixedPeriods = rows.some((row) => row.provider === "binance") &&
    rows.some((row) => row.provider !== "binance");
  const averageReturnLabel = hasMixedPeriods
    ? `주식 ${stockAverageReturn.hasValue ? formatSignedPercent(stockAverageReturn.value) : "-"} · 암호자산 ${cryptoAverageReturn.hasValue ? formatSignedPercent(cryptoAverageReturn.value) : "-"} · 합계 ${averageDailyReturn.hasValue ? formatSignedPercent(averageDailyReturn.value) : "-"}`
    : averageDailyReturn.hasValue ? formatSignedPercent(averageDailyReturn.value) : "-";
  const averageReturnMetrics = hasMixedPeriods
    ? [
        { id: "stock", label: "주식", ...stockAverageReturn },
        { id: "crypto", label: "암호자산", ...cryptoAverageReturn },
        { id: "total", label: "합계", ...averageDailyReturn },
      ]
    : [{ id: "total", label: "합계", ...averageDailyReturn }];
  const averageReturnCaption = "일간 평균 수익";
  const shouldShowBlockingError = Boolean(error && !payload);
  const SymbolOrderIcon = symbolOrderEditing ? Save : PencilLine;
  const displayData = useMemo(() => ({
    schemaVersion: "transaction-status-display-data.v1",
    id: "watchlist-overview",
    title: `${selectedGroup?.name || "관심 목록"} 메인`,
    kind: "watchlist-overview",
    exposure: "context",
    summary: {
      status: loading ? "loading" : error ? "error" : "ready",
      error,
      groupId: selectedGroup?.id || "",
      groupName: selectedGroup?.name || "관심 목록",
      rowCount: rows.length,
      averageReturnLabel,
      averageReturnCaption,
      mixedPeriods: hasMixedPeriods,
      source: String(payload?.source || "").trim(),
      fetchedAt: String(payload?.fetchedAt || "").trim(),
    },
    data: {
      selectedGroup: selectedGroup
        ? {
            id: selectedGroup.id,
            name: selectedGroup.name,
            instruments: normalizeTransactionWatchlistInstrumentsSetting(
              selectedGroup.instruments,
              selectedGroup.symbols
            ),
          }
        : null,
      tableColumns: [
        { id: "symbol", label: "티커 / 종목번호" },
        { id: "name", label: "종목명" },
        ...transactionWatchlistReturnColumns.map((column) => ({ id: column.key, label: column.label })),
      ],
      tableRows: rows.map(transactionWatchlistContextRow),
    },
  }), [averageReturnCaption, averageReturnLabel, error, hasMixedPeriods, loading, payload, rows, selectedGroup]);

  useEffect(() => {
    onDisplayData?.(displayData);
  }, [displayData, onDisplayData]);

  return (
    <section className="transaction-main-section transaction-watchlist-main-section" aria-label="관심 그룹 상세">
      <TransactionMarketDataStatus
        statusBannerProps={statusBannerProps}
        instruments={normalizeTransactionWatchlistInstrumentsSetting(selectedGroup?.instruments, selectedGroup?.symbols)}
        binanceStatus={binanceStatus}
        binanceError={binanceError}
      />

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
        <div className="transaction-watchlist-return-summary">
          <span className="transaction-watchlist-return-metrics" aria-label={averageReturnLabel}>
            {averageReturnMetrics.map((metric) => (
              <span className="transaction-watchlist-return-metric" key={metric.id}>
                <strong>{metric.label}</strong>
                <em className={metric.hasValue ? valueTone(metric.value) : ""}>
                  {metric.hasValue ? formatSignedPercent(metric.value) : "-"}
                </em>
              </span>
            ))}
          </span>
          <em className="transaction-watchlist-return-caption">{averageReturnCaption}</em>
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
          <span>시장 시세 불러오는 중</span>
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
          onSelectSymbol={onSelectSymbol}
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

function TransactionSymbolSearchField({
  inputId,
  titleId,
  label = "티커 / 종목번호 / 종목명을 입력하세요",
  draftSymbol,
  symbolOptions = [],
  excludedInstruments = [],
  selectedSymbol = null,
  autoFocus = false,
  disabled = false,
  onDraftSymbolChange,
  onSelectOption,
}) {
  const query = String(draftSymbol || "").trim();
  const listboxId = `${inputId}-options`;
  const selectedSymbolCode = cleanTransactionWatchlistSymbol(selectedSymbol?.symbol);
  const selectedMatchesDraft = selectedSymbolCode && selectedSymbolCode === cleanTransactionWatchlistSymbol(draftSymbol);
  const suggestions = query && !selectedMatchesDraft
    ? transactionSymbolSearchSuggestions(symbolOptions, query, excludedInstruments, 8)
    : [];
  const suggestionKey = suggestions.map((option) => option.instrumentId).join(",");
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  useEffect(() => {
    setHighlightedIndex(suggestions.length ? 0 : -1);
  }, [query, suggestionKey, suggestions.length]);
  const handleSelectOption = useCallback((option) => {
    const symbol = cleanTransactionWatchlistSymbol(option?.symbol);
    if (!symbol) return;
    if (onSelectOption) {
      onSelectOption({ ...option, symbol });
    } else {
      onDraftSymbolChange(symbol);
    }
    setHighlightedIndex(-1);
  }, [onDraftSymbolChange, onSelectOption]);

  return (
    <>
      <label className="transaction-watchlist-field" htmlFor={inputId}>
        <span id={titleId}>{label}</span>
        <input
          id={inputId}
          type="text"
          value={draftSymbol}
          maxLength={32}
          autoFocus={autoFocus}
          autoComplete="off"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={suggestions.length > 0}
          aria-controls={suggestions.length ? listboxId : undefined}
          aria-activedescendant={highlightedIndex >= 0 ? `${listboxId}-${highlightedIndex}` : undefined}
          disabled={disabled}
          onChange={(event) => onDraftSymbolChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return;
            if (event.key === "ArrowDown" && suggestions.length) {
              event.preventDefault();
              setHighlightedIndex((current) => (current + 1 + suggestions.length) % suggestions.length);
              return;
            }
            if (event.key === "ArrowUp" && suggestions.length) {
              event.preventDefault();
              setHighlightedIndex((current) => (current - 1 + suggestions.length) % suggestions.length);
              return;
            }
            if (event.key === "Escape" && highlightedIndex >= 0) {
              event.preventDefault();
              event.stopPropagation();
              setHighlightedIndex(-1);
              return;
            }
            if (event.key !== "Enter" || !onSelectOption || !suggestions.length) return;
            event.preventDefault();
            handleSelectOption(suggestions[Math.max(0, highlightedIndex)]);
          }}
        />
      </label>
      {suggestions.length ? (
        <div id={listboxId} className="transaction-watchlist-autocomplete" role="listbox" aria-label="종목 자동완성">
          {suggestions.map((option, index) => (
            <button
              id={`${listboxId}-${index}`}
              type="button"
              role="option"
              aria-selected={index === highlightedIndex}
              key={`transaction-watchlist-option-${option.instrumentId || option.symbol}`}
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setHighlightedIndex(index)}
              onClick={() => handleSelectOption(option)}
            >
              <strong>{option.displaySymbol || option.symbol}</strong>
              <span>{transactionInstrumentDescription(option)}</span>
              <em className={`transaction-instrument-provider-badge is-${normalizeTransactionInstrumentProvider(option.provider)}`}>
                {normalizeTransactionInstrumentProvider(option.provider) === "binance" ? "Binance" : "Toss"}
              </em>
            </button>
          ))}
        </div>
      ) : query && !selectedMatchesDraft ? (
        <p className="transaction-watchlist-autocomplete-empty">검색 가능한 종목 목록에서 찾을 수 없습니다.</p>
      ) : null}
    </>
  );
}

function TransactionSymbolSearchDialog({
  inputId,
  titleId,
  draftSymbol,
  selectedSymbol,
  error,
  symbolOptions = [],
  excludedInstruments = [],
  onDraftSymbolChange,
  onSelectSymbol,
  onCancel,
  onSubmit,
}) {
  return (
    <div className="transaction-watchlist-modal-backdrop" role="presentation" onMouseDown={onCancel}>
      <form
        className="transaction-watchlist-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onMouseDown={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <TransactionSymbolSearchField
          inputId={inputId}
          titleId={titleId}
          draftSymbol={draftSymbol}
          symbolOptions={symbolOptions}
          excludedInstruments={excludedInstruments}
          selectedSymbol={selectedSymbol}
          autoFocus
          onDraftSymbolChange={onDraftSymbolChange}
          onSelectOption={onSelectSymbol}
        />
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
  selectedSymbol,
  error,
  symbolOptions = [],
  onDraftSymbolChange,
  onSelectSymbol,
  onCancel,
  onSubmit,
}) {
  if (!group) return null;
  return (
    <TransactionSymbolSearchDialog
      inputId="transaction-watchlist-symbol"
      titleId="transaction-watchlist-symbol-title"
      draftSymbol={draftSymbol}
      selectedSymbol={selectedSymbol}
      error={error}
      symbolOptions={symbolOptions}
      excludedInstruments={group.instruments}
      onDraftSymbolChange={onDraftSymbolChange}
      onSelectSymbol={onSelectSymbol}
      onCancel={onCancel}
      onSubmit={onSubmit}
    />
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

function SimulatorDeleteDialog({ simulator, busy = false, onCancel, onConfirm }) {
  if (!simulator) return null;
  const simulatorName = simulatorDisplayLabel(simulator, 0);
  return (
    <div className="transaction-watchlist-modal-backdrop" role="presentation" onMouseDown={busy ? undefined : onCancel}>
      <section
        className="transaction-watchlist-modal"
        role="alertdialog"
        aria-modal="true"
        aria-label="투자 시뮬레이터 삭제"
        aria-describedby="transaction-simulator-delete-description"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <p id="transaction-simulator-delete-description">
          이 시뮬레이터 계좌를 목록에서 삭제할까요? 장부에는 삭제 기록이 남습니다.
        </p>
        <strong className="transaction-watchlist-delete-target">{simulatorName}</strong>
        <div className="transaction-watchlist-modal-actions">
          <button type="button" disabled={busy} onClick={onCancel}>
            취소
          </button>
          <button className="is-danger" type="button" disabled={busy} onClick={onConfirm}>
            {busy ? "삭제 중" : "삭제"}
          </button>
        </div>
      </section>
    </div>
  );
}

function SimulatorExchangeDialog({
  simulator,
  usdKrwRate,
  modeId,
  amountDraft,
  error,
  busy = false,
  onModeChange,
  onAmountChange,
  onSubmitExchange,
  onCancel,
}) {
  if (!simulator) return null;
  const mode = transactionSimulatorExchangeMode(modeId);
  const fromBalance = transactionSimulatorBuyAvailableAmount(simulator, mode.fromUnit);
  const amountValue = transactionSimulatorExchangeAmountValue(amountDraft);
  const hasAmount = String(amountDraft || "").trim() !== "";
  const outputAmount = transactionSimulatorExchangeOutputAmount(amountValue, mode.id, usdKrwRate);
  const rate = Number(usdKrwRate || 0);
  const rateUnavailable = !Number.isFinite(rate) || rate <= 0;
  const amountTooLarge = hasAmount && amountValue > fromBalance;
  const amountInvalid = hasAmount && amountValue <= 0;
  const convertedText = hasAmount && outputAmount !== null && outputAmount > 0
    ? formatMoney(outputAmount, mode.toUnit)
    : "-";
  const formMessage = rateUnavailable
    ? "환율을 불러온 뒤 환전 가능합니다."
    : amountTooLarge
      ? `최대 환전 가능 액수는 ${formatMoney(fromBalance, mode.fromUnit)}입니다.`
      : amountInvalid
        ? "환전할 금액을 입력하세요."
        : "";
  const canSubmitExchange =
    !busy &&
    hasAmount &&
    !rateUnavailable &&
    !amountTooLarge &&
    !amountInvalid &&
    outputAmount !== null &&
    outputAmount > 0;

  function handleSubmit(event) {
    event.preventDefault();
    if (!canSubmitExchange) return;
    onSubmitExchange?.({
      mode: mode.id,
      fromCurrency: mode.fromUnit,
      toCurrency: mode.toUnit,
      fromAmount: amountValue,
      toAmount: outputAmount,
      rate,
    });
  }

  return (
    <div className="transaction-watchlist-modal-backdrop" role="presentation" onMouseDown={busy ? undefined : onCancel}>
      <section
        className="transaction-watchlist-modal transaction-simulator-exchange-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="transaction-simulator-exchange-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="transaction-simulator-exchange-header">
          <strong id="transaction-simulator-exchange-title">환전</strong>
          <span>{transactionSimulatorExchangeRateText(usdKrwRate)}</span>
        </div>
        <div className="transaction-simulator-exchange-tabs" role="tablist" aria-label="환전 방향">
          {transactionSimulatorExchangeModes.map((tabMode) => {
            const selected = tabMode.id === mode.id;
            return (
              <button
                className={selected ? "is-active" : ""}
                type="button"
                role="tab"
                aria-selected={selected}
                key={tabMode.id}
                disabled={busy}
                onClick={() => onModeChange?.(tabMode.id)}
              >
                {tabMode.label}
              </button>
            );
          })}
        </div>
        <form className="transaction-simulator-exchange-form" onSubmit={handleSubmit}>
          <label htmlFor="transaction-simulator-exchange-amount">
            <span>{transactionSimulatorCurrencyLabel(mode.fromUnit)} 금액</span>
            <div className={`transaction-simulator-money-input transaction-simulator-exchange-input is-${mode.fromUnit.toLowerCase()}`}>
              <input
                id="transaction-simulator-exchange-amount"
                type="text"
                inputMode={mode.fromUnit === "USD" ? "decimal" : "numeric"}
                placeholder={mode.fromUnit === "USD" ? "0.00" : "0"}
                value={amountDraft}
                disabled={busy}
                autoFocus
                onChange={(event) => onAmountChange?.(event.target.value)}
              />
              <em className="transaction-simulator-money-input-adornment" aria-hidden="true">
                {mode.fromUnit === "USD" ? "$" : "원"}
              </em>
            </div>
          </label>
          <p className="transaction-simulator-exchange-limit">
            최대 환전 가능 {formatMoney(fromBalance, mode.fromUnit)}
          </p>
          <p className="transaction-simulator-exchange-estimate">
            예상 수령 <strong>{convertedText}</strong>
          </p>
          {formMessage ? <p className="transaction-watchlist-modal-error" role="alert">{formMessage}</p> : null}
          {error ? <p className="transaction-watchlist-modal-error" role="alert">{error}</p> : null}
          <div className="transaction-simulator-exchange-actions">
            <button type="button" disabled={busy} onClick={onCancel}>
              닫기
            </button>
            <button className="is-primary" type="submit" disabled={!canSubmitExchange}>
              {busy ? "환전 중" : "환전하기"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

function SimulatorBuyDialog({
  simulator,
  unit,
  usdKrwRate,
  draftSymbol,
  selectedSymbol,
  symbolOptions = [],
  amountDraft,
  error,
  busy = false,
  marketCalendar,
  marketCalendarLoading = false,
  marketCalendarError = "",
  binanceStatus = null,
  binanceError = "",
  onDraftSymbolChange,
  onSelectSymbol,
  onAmountChange,
  onPresetAmount,
  onSubmitOrder,
  onCancel,
}) {
  if (!simulator) return null;
  const displayUnit = normalizeMoneyUnit(unit);
  const selectedSymbolCode = cleanTransactionWatchlistSymbol(selectedSymbol?.symbol);
  const hasSelectedSymbol = Boolean(selectedSymbolCode);
  const settlementUnit = hasSelectedSymbol ? transactionSimulatorSettlementUnit(selectedSymbol) : displayUnit;
  const settlementCurrencyLabel = transactionSimulatorCurrencyLabel(settlementUnit);
  const selectedSymbolDescription = transactionInstrumentDescription(selectedSymbol);
  const availableSettlementAmount = transactionSimulatorBuyAvailableAmount(simulator, settlementUnit);
  const availableOrderAmount = convertMoney(availableSettlementAmount, settlementUnit, displayUnit, usdKrwRate);
  const availableOrderText = availableOrderAmount === null ? "-" : formatMoney(availableOrderAmount, displayUnit);
  const minimumSettlementAmount = transactionSimulatorMinimumSettlementBuyAmount(settlementUnit, usdKrwRate);
  const minimumAmount = transactionSimulatorMinimumOrderAmount(displayUnit, settlementUnit, usdKrwRate);
  const minimumLabel = transactionSimulatorMinimumBuyLabel(displayUnit, settlementUnit, usdKrwRate);
  const amountValue = transactionSimulatorBuyAmountValue(amountDraft);
  const hasAmount = String(amountDraft || "").trim() !== "";
  const settlementAmountValue = convertMoney(amountValue, displayUnit, settlementUnit, usdKrwRate);
  const needsExchangeRate = hasSelectedSymbol && displayUnit !== settlementUnit && (
    minimumAmount === null || availableOrderAmount === null || (hasAmount && settlementAmountValue === null)
  );
  const amountTooSmall = hasSelectedSymbol && hasAmount && minimumAmount !== null && amountValue < minimumAmount;
  const amountTooLarge =
    hasSelectedSymbol && hasAmount && settlementAmountValue !== null && settlementAmountValue > availableSettlementAmount;
  const tradingEligibility = transactionSimulatorBuyTradingEligibility({
    selectedSymbol,
    marketCalendar,
    marketCalendarLoading,
    marketCalendarError,
    binanceStatus,
    binanceError,
  });
  const canSubmitOrder =
    hasSelectedSymbol &&
    hasAmount &&
    tradingEligibility.canTrade &&
    !needsExchangeRate &&
    !amountTooSmall &&
    !amountTooLarge &&
    settlementAmountValue !== null &&
    settlementAmountValue > 0;
  const tradingMessage = hasSelectedSymbol && !tradingEligibility.canTrade ? tradingEligibility.reason : "";
  const amountMessage = tradingMessage || (
    needsExchangeRate
      ? "환율을 불러온 뒤 주문 가능합니다."
      : amountTooSmall
        ? `최소 주문 금액은 ${minimumLabel}입니다.`
        : amountTooLarge
          ? `주문 가능 금액은 ${availableOrderText}입니다.`
          : ""
  );
  const presets = transactionSimulatorBuyPresets(displayUnit);
  const helpTitle =
    `소수점 매매만 지원하며 체결 가격은 시장가만 사용합니다. ${settlementCurrencyLabel} 잔고에서 결제됩니다.${itemIsCrypto(selectedSymbol) ? " 공개 계정 수수료율을 알 수 없어 수수료는 0으로 가정합니다." : ""}`;

  return (
    <div className="transaction-watchlist-modal-backdrop" role="presentation" onMouseDown={onCancel}>
      <section
        className="transaction-watchlist-modal transaction-simulator-buy-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="transaction-simulator-buy-symbol-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <TransactionSymbolSearchField
          inputId="transaction-simulator-buy-symbol"
          titleId="transaction-simulator-buy-symbol-title"
          draftSymbol={draftSymbol}
          symbolOptions={symbolOptions}
          selectedSymbol={selectedSymbol}
          autoFocus
          disabled={busy}
          onDraftSymbolChange={onDraftSymbolChange}
          onSelectOption={onSelectSymbol}
        />
        {hasSelectedSymbol ? (
          <div className="transaction-simulator-buy-selected-symbol">
            <strong>{selectedSymbolCode}</strong>
            <span>{selectedSymbolDescription || selectedSymbolCode}</span>
          </div>
        ) : null}
        <div
          className={`transaction-simulator-buy-order-panel${hasSelectedSymbol ? "" : " is-disabled"}`}
          aria-disabled={!hasSelectedSymbol}
        >
          <div className="transaction-simulator-buy-amount-row">
            <span className="transaction-simulator-buy-amount-label">총 주문 금액</span>
            <div className={`transaction-simulator-buy-amount-control transaction-simulator-money-input is-${displayUnit.toLowerCase()}`}>
              <input
                type="text"
                inputMode={displayUnit === "USD" ? "decimal" : "numeric"}
                placeholder={displayUnit === "USD" ? "0.00" : "0"}
                value={amountDraft}
                disabled={!hasSelectedSymbol || busy}
                aria-label="총 주문 금액"
                onChange={(event) => onAmountChange(event.target.value)}
              />
              <em className="transaction-simulator-money-input-adornment" aria-hidden="true">
                {displayUnit === "USD" ? "$" : "원"}
              </em>
            </div>
          </div>
          <div className="transaction-simulator-buy-presets" aria-label="주문 금액 빠른 입력">
            {presets.map((preset) => {
              const belowMinimum = minimumAmount !== null && preset.amount < minimumAmount;
              return (
                <button
                  type="button"
                  key={`${displayUnit}-${preset.label}`}
                  disabled={!hasSelectedSymbol || busy || belowMinimum}
                  title={belowMinimum ? `최소 주문 금액은 ${minimumLabel}입니다.` : `${preset.label} 입력`}
                  onClick={() => onPresetAmount(preset.amount)}
                >
                  {preset.label}
                </button>
              );
            })}
            <button
              type="button"
              disabled={
                !hasSelectedSymbol ||
                busy ||
                availableOrderAmount === null ||
                availableSettlementAmount < minimumSettlementAmount
              }
              title="주문 가능 금액 전체 입력"
              onClick={() => onPresetAmount(availableOrderAmount)}
            >
              최대
            </button>
          </div>
          <p className="transaction-simulator-buy-available">
            주문 가능 금액 {availableOrderText}
            <span title={helpTitle} aria-label={helpTitle}>
              <CircleHelp size={15} strokeWidth={2.1} aria-hidden="true" />
            </span>
          </p>
          {hasSelectedSymbol ? (
            <p className="transaction-simulator-buy-settlement">
              결제 잔고 {settlementCurrencyLabel} {formatMoney(availableSettlementAmount, settlementUnit)}
            </p>
          ) : null}
          {hasSelectedSymbol ? (
            <p
              className={`transaction-simulator-buy-trading${tradingEligibility.canTrade ? " is-open" : " is-closed"}`}
            >
              {tradingEligibility.label}
            </p>
          ) : null}
          <p className="transaction-simulator-buy-minimum">최소 주문 금액 {minimumLabel}</p>
          {amountMessage ? <p className="transaction-watchlist-modal-error" role="alert">{amountMessage}</p> : null}
        </div>
        {error ? <p className="transaction-watchlist-modal-error" role="alert">{error}</p> : null}
        <div className="transaction-simulator-buy-modal-actions">
          <span>
            {transactionSimulatorCurrencyLabel(displayUnit)} 입력 · {settlementCurrencyLabel} 결제 · 시장가 매수
            {itemIsCrypto(selectedSymbol) ? " · 수수료 0 가정" : ""}
          </span>
          <div className="transaction-simulator-buy-modal-action-buttons">
            <button type="button" disabled={busy} onClick={onCancel}>
              닫기
            </button>
            <button
              className="transaction-simulator-buy-submit"
              type="button"
              disabled={!canSubmitOrder || busy}
              onClick={() => onSubmitOrder?.({
                ...normalizeTransactionInstrument(selectedSymbol),
                symbol: selectedSymbolCode,
                symbolName: selectedSymbol?.name || "",
                market: selectedSymbol?.market || "",
                orderUnit: displayUnit,
                settlementUnit,
                orderAmount: amountValue,
                settlementAmount: settlementAmountValue,
                marketSession: tradingEligibility.sessionKey || "",
              })}
            >
              {busy ? "주문 중" : "주문하기"}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

function SimulatorSellDialog({
  position,
  unit,
  usdKrwRate,
  amountDraft,
  error,
  busy = false,
  marketCalendar,
  marketCalendarLoading = false,
  marketCalendarError = "",
  binanceStatus = null,
  binanceError = "",
  onAmountChange,
  onPresetFraction,
  onSubmitOrder,
  onCancel,
}) {
  if (!position) return null;
  const displayUnit = normalizeMoneyUnit(unit);
  const selectedSymbol = transactionSimulatorStockOptionFromItem(position);
  const selectedSymbolCode = cleanTransactionWatchlistSymbol(selectedSymbol?.symbol);
  const settlementUnit = normalizeMoneyUnit(position.currency || position.displayCurrency || transactionSimulatorSettlementUnit(selectedSymbol));
  const settlementCurrencyLabel = transactionSimulatorCurrencyLabel(settlementUnit);
  const selectedSymbolDescription = transactionInstrumentDescription(selectedSymbol);
  const availableSettlementAmount = transactionSimulatorPositionSettlementValue(position);
  const availableOrderAmount = convertMoney(availableSettlementAmount, settlementUnit, displayUnit, usdKrwRate);
  const availableOrderText = availableOrderAmount === null ? "-" : formatMoney(availableOrderAmount, displayUnit);
  const amountValue = transactionSimulatorBuyAmountValue(amountDraft);
  const hasAmount = String(amountDraft || "").trim() !== "";
  const settlementAmountValue = convertMoney(amountValue, displayUnit, settlementUnit, usdKrwRate);
  const needsExchangeRate = displayUnit !== settlementUnit && (
    availableOrderAmount === null || (hasAmount && settlementAmountValue === null)
  );
  const amountTooLarge =
    hasAmount && settlementAmountValue !== null && settlementAmountValue > availableSettlementAmount;
  const tradingEligibility = transactionSimulatorBuyTradingEligibility({
    selectedSymbol,
    marketCalendar,
    marketCalendarLoading,
    marketCalendarError,
    binanceStatus,
    binanceError,
  });
  const canSubmitOrder =
    Boolean(selectedSymbolCode) &&
    hasAmount &&
    tradingEligibility.canTrade &&
    !needsExchangeRate &&
    !amountTooLarge &&
    settlementAmountValue !== null &&
    settlementAmountValue > 0;
  const tradingMessage = !tradingEligibility.canTrade ? tradingEligibility.reason : "";
  const amountMessage = tradingMessage || (
    needsExchangeRate
      ? "환율을 불러온 뒤 주문 가능합니다."
      : amountTooLarge
        ? `매도 가능 금액은 ${availableOrderText}입니다.`
        : ""
  );
  const helpTitle =
    `소수점 매매만 지원하며 체결 가격은 시장가만 사용합니다. ${settlementCurrencyLabel} 보유분을 매도합니다.${itemIsCrypto(selectedSymbol) ? " 공개 계정 수수료율을 알 수 없어 수수료는 0으로 가정합니다." : ""}`;

  return (
    <div className="transaction-watchlist-modal-backdrop" role="presentation" onMouseDown={onCancel}>
      <section
        className="transaction-watchlist-modal transaction-simulator-buy-modal transaction-simulator-sell-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="transaction-simulator-sell-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="transaction-simulator-sell-header">
          <strong id="transaction-simulator-sell-title">매도</strong>
          <span>시장가 · 소수점 매매</span>
        </div>
        <div className="transaction-simulator-buy-selected-symbol">
          <strong>{selectedSymbolCode}</strong>
          <span>{selectedSymbolDescription || selectedSymbolCode}</span>
        </div>
        <div className="transaction-simulator-buy-order-panel" aria-disabled={false}>
          <div className="transaction-simulator-buy-amount-row">
            <span className="transaction-simulator-buy-amount-label">총 주문 금액</span>
            <div className={`transaction-simulator-buy-amount-control transaction-simulator-money-input is-${displayUnit.toLowerCase()}`}>
              <input
                type="text"
                inputMode={displayUnit === "USD" ? "decimal" : "numeric"}
                placeholder={displayUnit === "USD" ? "0.00" : "0"}
                value={amountDraft}
                disabled={busy}
                autoFocus
                aria-label="총 주문 금액"
                onChange={(event) => onAmountChange(event.target.value)}
              />
              <em className="transaction-simulator-money-input-adornment" aria-hidden="true">
                {displayUnit === "USD" ? "$" : "원"}
              </em>
            </div>
          </div>
          <div className="transaction-simulator-buy-presets transaction-simulator-sell-presets" aria-label="매도 비율 빠른 입력">
            {transactionSimulatorSellFractions.map((preset) => (
              <button
                type="button"
                key={preset.label}
                disabled={busy || availableOrderAmount === null || availableOrderAmount <= 0}
                title={`${preset.label} 매도 금액 입력`}
                onClick={() => onPresetFraction(preset.fraction)}
              >
                {preset.label}
              </button>
            ))}
          </div>
          <p className="transaction-simulator-buy-available">
            매도 가능 금액 {availableOrderText}
            <span title={helpTitle} aria-label={helpTitle}>
              <CircleHelp size={15} strokeWidth={2.1} aria-hidden="true" />
            </span>
          </p>
          <p className="transaction-simulator-buy-settlement">
            보유 수량 {formatQuantity(position.quantity, position)} · {settlementCurrencyLabel} 평가액 {formatMoney(availableSettlementAmount, settlementUnit)}
          </p>
          <p
            className={`transaction-simulator-buy-trading${tradingEligibility.canTrade ? " is-open" : " is-closed"}`}
          >
            {tradingEligibility.label}
          </p>
          {amountMessage ? <p className="transaction-watchlist-modal-error" role="alert">{amountMessage}</p> : null}
        </div>
        {error ? <p className="transaction-watchlist-modal-error" role="alert">{error}</p> : null}
        <div className="transaction-simulator-buy-modal-actions">
          <span>
            {transactionSimulatorCurrencyLabel(displayUnit)} 입력 · {settlementCurrencyLabel} 매도 · 시장가 매도
            {itemIsCrypto(selectedSymbol) ? " · 수수료 0 가정" : ""}
          </span>
          <div className="transaction-simulator-buy-modal-action-buttons">
            <button type="button" disabled={busy} onClick={onCancel}>
              닫기
            </button>
            <button
              className="transaction-simulator-sell-submit"
              type="button"
              disabled={!canSubmitOrder || busy}
              onClick={() => onSubmitOrder?.({
                ...normalizeTransactionInstrument(selectedSymbol),
                symbol: selectedSymbolCode,
                symbolName: selectedSymbol?.name || "",
                englishName: selectedSymbol?.englishName || "",
                market: selectedSymbol?.market || "",
                orderUnit: displayUnit,
                settlementUnit,
                orderAmount: amountValue,
                settlementAmount: settlementAmountValue,
                marketSession: tradingEligibility.sessionKey || "",
              })}
            >
              {busy ? "주문 중" : "주문하기"}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

function TransactionSimulatorOrderNotifications({ notifications = [] }) {
  if (!notifications.length) return null;
  return (
    <div className="transaction-order-notification-stack" aria-live="polite" aria-atomic="false">
      {notifications.map((notification) => (
        <div
          className={`transaction-order-notification is-${notification.side}${notification.leaving ? " is-leaving" : ""}`}
          key={notification.id}
          role="status"
        >
          <span>{notification.message}</span>
        </div>
      ))}
    </div>
  );
}

function WatchlistPlaceholder({
  statusBannerProps,
  binanceStatus,
  binanceError = "",
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
  selectedChartItem,
  chartUnit,
  usdKrwRate,
  onChartUnitChange,
  chartModeSetting,
  chartIntervalModeSetting,
  chartVolumeVisibleSetting,
  onChartModeChange,
  onChartIntervalModeChange,
  onChartVolumeVisibleChange,
  onSelectSymbol,
  onCloseChart,
  onOpenCreateGroup,
  onRequestDeleteGroup,
  onOrderEditStart,
  onOrderChange,
  onOrderSave,
  onDisplayData,
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
        {selectedChartItem ? (
          <TransactionInvestmentAssetDetail
            item={selectedChartItem}
            payload={payload}
            unit={chartUnit}
            usdKrwRate={usdKrwRate}
            onUnitChange={onChartUnitChange}
            onClose={onCloseChart}
            statusBannerProps={statusBannerProps}
            binanceStatus={binanceStatus}
            binanceError={binanceError}
            chartModeSetting={chartModeSetting}
            intervalModeSetting={chartIntervalModeSetting}
            volumeVisibleSetting={chartVolumeVisibleSetting}
            onChartModeChange={onChartModeChange}
            onIntervalModeChange={onChartIntervalModeChange}
            onVolumeVisibleChange={onChartVolumeVisibleChange}
            onDisplayData={onDisplayData}
          />
        ) : (
          <WatchlistMain
            selectedGroup={selectedGroup}
            items={items}
            symbolOptions={symbolOptions}
            priceMap={priceMap}
            payload={payload}
            loading={loading}
            error={error}
            statusBannerProps={statusBannerProps}
            binanceStatus={binanceStatus}
            binanceError={binanceError}
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
            onSelectSymbol={onSelectSymbol}
            onDisplayData={onDisplayData}
          />
        )}
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
  onContextChange,
}) {
  const [activeSection, setActiveSection] = useState("investment");
  const [selectedInvestmentOrderKey, setSelectedInvestmentOrderKey] = useState("");
  const [selectedInvestmentSearchItem, setSelectedInvestmentSearchItem] = useState(null);
  const [selectedWatchlistChartSymbol, setSelectedWatchlistChartSymbol] = useState("");
  const [sortId, setSortId] = useState("valueAsc");
  const [sortOpen, setSortOpen] = useState(false);
  const [manualOrderEditing, setManualOrderEditing] = useState(false);
  const [manualOrderDraft, setManualOrderDraft] = useState([]);
  const [accountOpen, setAccountOpen] = useState(false);
  const [selectedAccountSeq, setSelectedAccountSeq] = useState("");
  const [simulatorAccounts, setSimulatorAccounts] = useState([]);
  const [selectedSimulatorId, setSelectedSimulatorId] = useState("");
  const [simulatorStoreReady, setSimulatorStoreReady] = useState(false);
  const [simulatorLoading, setSimulatorLoading] = useState(false);
  const [simulatorError, setSimulatorError] = useState("");
  const [simulatorDeleteTarget, setSimulatorDeleteTarget] = useState(null);
  const [simulatorDeletingId, setSimulatorDeletingId] = useState("");
  const [simulatorRenameTarget, setSimulatorRenameTarget] = useState(null);
  const [simulatorRenameDraft, setSimulatorRenameDraft] = useState("");
  const [simulatorRenameBusy, setSimulatorRenameBusy] = useState(false);
  const [simulatorRenameError, setSimulatorRenameError] = useState("");
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
  const [watchlistSelectedSymbol, setWatchlistSelectedSymbol] = useState(null);
  const [watchlistSymbolError, setWatchlistSymbolError] = useState("");
  const [watchlistSavedSymbolOptions, setWatchlistSavedSymbolOptions] = useState([]);
  const [watchlistRemoteSymbolOptions, setWatchlistRemoteSymbolOptions] = useState([]);
  const [simulatorSymbolSearchOpen, setSimulatorSymbolSearchOpen] = useState(false);
  const [simulatorSymbolSearchDraft, setSimulatorSymbolSearchDraft] = useState("");
  const [simulatorSymbolSearchSelection, setSimulatorSymbolSearchSelection] = useState(null);
  const [simulatorSymbolSearchOptions, setSimulatorSymbolSearchOptions] = useState([]);
  const [simulatorSymbolSearchError, setSimulatorSymbolSearchError] = useState("");
  const [simulatorBuyOpen, setSimulatorBuyOpen] = useState(false);
  const [simulatorBuySymbolDraft, setSimulatorBuySymbolDraft] = useState("");
  const [simulatorBuySelectedSymbol, setSimulatorBuySelectedSymbol] = useState(null);
  const [simulatorBuyRemoteSymbolOptions, setSimulatorBuyRemoteSymbolOptions] = useState([]);
  const [simulatorBuyAmountDraft, setSimulatorBuyAmountDraft] = useState("");
  const [simulatorBuyUnit, setSimulatorBuyUnit] = useState(() => normalizeMoneyUnit("KRW"));
  const [simulatorBuyError, setSimulatorBuyError] = useState("");
  const [simulatorBuyBusy, setSimulatorBuyBusy] = useState(false);
  const [simulatorBuyMarketCalendar, setSimulatorBuyMarketCalendar] = useState(null);
  const [simulatorBuyMarketCalendarLoading, setSimulatorBuyMarketCalendarLoading] = useState(false);
  const [simulatorBuyMarketCalendarError, setSimulatorBuyMarketCalendarError] = useState("");
  const [simulatorSellOpen, setSimulatorSellOpen] = useState(false);
  const [simulatorSellPosition, setSimulatorSellPosition] = useState(null);
  const [simulatorSellAmountDraft, setSimulatorSellAmountDraft] = useState("");
  const [simulatorSellUnit, setSimulatorSellUnit] = useState(() => normalizeMoneyUnit("KRW"));
  const [simulatorSellError, setSimulatorSellError] = useState("");
  const [simulatorSellBusy, setSimulatorSellBusy] = useState(false);
  const [simulatorSellMarketCalendar, setSimulatorSellMarketCalendar] = useState(null);
  const [simulatorSellMarketCalendarLoading, setSimulatorSellMarketCalendarLoading] = useState(false);
  const [simulatorSellMarketCalendarError, setSimulatorSellMarketCalendarError] = useState("");
  const [simulatorOrderNotifications, setSimulatorOrderNotifications] = useState([]);
  const [simulatorExchangeOpen, setSimulatorExchangeOpen] = useState(false);
  const [simulatorExchangeMode, setSimulatorExchangeMode] = useState("KRW_TO_USD");
  const [simulatorExchangeAmountDraft, setSimulatorExchangeAmountDraft] = useState("");
  const [simulatorExchangeError, setSimulatorExchangeError] = useState("");
  const [simulatorExchangeBusy, setSimulatorExchangeBusy] = useState(false);
  const [usdKrwRate, setUsdKrwRate] = useState(0);
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [liveErrorCode, setLiveErrorCode] = useState("");
  const [liveRetryAfterMs, setLiveRetryAfterMs] = useState(0);
  const [etfNameTranslations, setEtfNameTranslations] = useState(() => new Map());
  const [watchlistPricePayload, setWatchlistPricePayload] = useState(null);
  const [watchlistPriceMap, setWatchlistPriceMap] = useState(() => new Map());
  const [watchlistPriceLoading, setWatchlistPriceLoading] = useState(false);
  const [watchlistPriceError, setWatchlistPriceError] = useState("");
  const [watchlistPriceErrorCode, setWatchlistPriceErrorCode] = useState("");
  const [simulatorPricePayload, setSimulatorPricePayload] = useState(null);
  const [simulatorPriceMap, setSimulatorPriceMap] = useState(() => new Map());
  const [simulatorPriceError, setSimulatorPriceError] = useState("");
  const [binanceProviderStatus, setBinanceProviderStatus] = useState(null);
  const [binanceProviderError, setBinanceProviderError] = useState("");
  const [simulatorMarketCalendars, setSimulatorMarketCalendars] = useState({});
  const [refreshKey, setRefreshKey] = useState(0);
  const [refreshSettledKey, setRefreshSettledKey] = useState(0);
  const [liveRefreshBusy, setLiveRefreshBusy] = useState(false);
  const [pageVisible, setPageVisible] = useState(() => transactionPageIsVisible());
  const rootRef = useRef(null);
  const forceNextRefreshRef = useRef(false);
  const transactionContextMetaRef = useRef(null);
  const liveRefreshBusyRef = useRef(false);
  const liveRetryUntilRef = useRef(0);
  const payloadRef = useRef(null);
  const initialLoadRef = useRef(true);
  const simulatorOrderNotificationTimersRef = useRef(new Map());
  const handleContextSurfaceData = useCallback((surface) => {
    if (!onContextChange) return;
    onContextChange(buildTransactionStatusContextPacket({
      ...(transactionContextMetaRef.current || {}),
      surface,
    }));
  }, [onContextChange]);
  const simulatorBuyIdempotencyKeyRef = useRef("");
  const simulatorSellIdempotencyKeyRef = useRef("");
  const wasPageHiddenRef = useRef(!transactionPageIsVisible());

  const removeSimulatorOrderNotification = useCallback((notificationId) => {
    const timers = simulatorOrderNotificationTimersRef.current.get(notificationId);
    if (timers?.leave) window.clearTimeout(timers.leave);
    if (timers?.remove) window.clearTimeout(timers.remove);
    simulatorOrderNotificationTimersRef.current.delete(notificationId);
    setSimulatorOrderNotifications((current) => current.filter((notification) => notification.id !== notificationId));
  }, []);

  const showSimulatorOrderNotification = useCallback(({ side = "buy", symbol = "", amount = 0, unit = "KRW" }) => {
    const normalizedSide = side === "sell" ? "sell" : "buy";
    const notificationId = `sim-order-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const notification = {
      id: notificationId,
      side: normalizedSide,
      message: transactionSimulatorOrderNotificationMessage({
        side: normalizedSide,
        symbol,
        amount,
        unit,
      }),
      leaving: false,
    };
    setSimulatorOrderNotifications((current) => [...current, notification]);
    const leaveTimer = window.setTimeout(() => {
      setSimulatorOrderNotifications((current) => current.map((item) => (
        item.id === notificationId ? { ...item, leaving: true } : item
      )));
      const removeTimer = window.setTimeout(() => {
        removeSimulatorOrderNotification(notificationId);
      }, 260);
      const timers = simulatorOrderNotificationTimersRef.current.get(notificationId);
      if (timers) {
        simulatorOrderNotificationTimersRef.current.set(notificationId, { ...timers, remove: removeTimer });
      }
    }, 2000);
    simulatorOrderNotificationTimersRef.current.set(notificationId, { leave: leaveTimer, remove: null });
  }, [removeSimulatorOrderNotification]);

  useEffect(() => () => {
    for (const timers of simulatorOrderNotificationTimersRef.current.values()) {
      if (timers?.leave) window.clearTimeout(timers.leave);
      if (timers?.remove) window.clearTimeout(timers.remove);
    }
    simulatorOrderNotificationTimersRef.current.clear();
  }, []);

  const liveFetchGate = useMemo(() => transactionLiveFetchGate(tossStatus), [tossStatus]);
  const normalizedSimulatorAccounts = useMemo(
    () => normalizeTransactionSimulatorAccounts(simulatorAccounts),
    [simulatorAccounts]
  );
  const selectedSimulator = useMemo(() => {
    const simulatorId = cleanTransactionSimulatorId(selectedSimulatorId);
    if (!simulatorId) return null;
    return normalizedSimulatorAccounts.find((simulator) => simulator.id === simulatorId) || null;
  }, [normalizedSimulatorAccounts, selectedSimulatorId]);
  const selectedSimulatorInstruments = useMemo(
    () => normalizeTransactionWatchlistInstrumentsSetting(selectedSimulator?.items || []),
    [selectedSimulator]
  );
  const selectedSimulatorMarketDataInstruments = useMemo(
    () => normalizeTransactionWatchlistInstrumentsSetting([
      ...selectedSimulatorInstruments,
      ...(selectedInvestmentSearchItem ? [selectedInvestmentSearchItem] : []),
    ]),
    [selectedInvestmentSearchItem, selectedSimulatorInstruments],
  );
  const selectedSimulatorSymbolKey = useMemo(
    () => selectedSimulatorMarketDataInstruments.map((instrument) => instrument.instrumentId).join(","),
    [selectedSimulatorMarketDataInstruments]
  );
  const selectedSimulatorCalendarUnitKey = useMemo(
    () => transactionSimulatorCalendarUnitsForItems(selectedSimulator?.items || []).join(","),
    [selectedSimulator]
  );
  const simulatorPayload = useMemo(
    () => transactionSimulatorPayload(selectedSimulator, simulatorPriceMap, simulatorPricePayload),
    [selectedSimulator, simulatorPriceMap, simulatorPricePayload]
  );
  const translatedSimulatorPayload = useMemo(() => {
    if (!simulatorPayload) return null;
    return {
      ...simulatorPayload,
      items: (Array.isArray(simulatorPayload.items) ? simulatorPayload.items : []).map((item) => (
        applyTransactionEtfNameTranslation(item, etfNameTranslations)
      )),
    };
  }, [etfNameTranslations, simulatorPayload]);
  const translatedLivePayload = useMemo(() => {
    if (!payload) return null;
    return {
      ...payload,
      items: (Array.isArray(payload.items) ? payload.items : []).map((item) => (
        applyTransactionEtfNameTranslation(item, etfNameTranslations)
      )),
    };
  }, [etfNameTranslations, payload]);
  const activeInvestmentPayload = translatedSimulatorPayload || translatedLivePayload;
  const unit = activeInvestmentPayload?.unit || currency;
  const normalizedItems = useMemo(
    () => (Array.isArray(activeInvestmentPayload?.items) ? activeInvestmentPayload.items.map((item) => normalizeItem(item, unit)) : []),
    [activeInvestmentPayload?.items, unit]
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
    ).map((item) => applyTransactionEtfNameTranslation(item, etfNameTranslations)),
    [etfNameTranslations, watchlistHoldingSymbolOptions, watchlistRemoteSymbolOptions, watchlistSavedSymbolOptions]
  );
  const simulatorBuySymbolOptions = useMemo(
    () => mergeTransactionWatchlistSymbolOptions(watchlistSymbolOptions, simulatorBuyRemoteSymbolOptions),
    [simulatorBuyRemoteSymbolOptions, watchlistSymbolOptions]
  );
  const simulatorSearchSymbolOptions = useMemo(
    () => mergeTransactionWatchlistSymbolOptions(watchlistSymbolOptions, simulatorSymbolSearchOptions),
    [simulatorSymbolSearchOptions, watchlistSymbolOptions]
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
  const selectedWatchlistUsesToss = useMemo(
    () => normalizeTransactionWatchlistInstrumentsSetting(
      selectedWatchlistGroup?.instruments,
      selectedWatchlistGroup?.symbols
    ).some((instrument) => instrument.provider !== "binance"),
    [selectedWatchlistGroup]
  );
  const selectedWatchlistUsesBinance = useMemo(
    () => normalizeTransactionWatchlistInstrumentsSetting(
      selectedWatchlistGroup?.instruments,
      selectedWatchlistGroup?.symbols
    ).some((instrument) => instrument.provider === "binance"),
    [selectedWatchlistGroup]
  );
  const selectedWatchlistDisplayGroup = useMemo(() => {
    if (!selectedWatchlistGroup) return null;
    if (!watchlistSymbolOrderEditing) return selectedWatchlistGroup;
    const instruments = transactionWatchlistInstrumentsInOrder(
      selectedWatchlistGroup,
      watchlistSymbolOrderDraft,
    );
    return {
      ...selectedWatchlistGroup,
      symbols: normalizeTransactionWatchlistSymbolsSetting(instruments),
      instruments,
    };
  }, [selectedWatchlistGroup, watchlistSymbolOrderDraft, watchlistSymbolOrderEditing]);
  const selectedWatchlistSymbolKey = useMemo(
    () => normalizeTransactionWatchlistInstrumentsSetting(
      selectedWatchlistGroup?.instruments,
      selectedWatchlistGroup?.symbols
    ).map((instrument) => instrument.instrumentId).join(","),
    [selectedWatchlistGroup]
  );
  const selectedWatchlistRows = useMemo(
    () => watchlistRowsFromGroup(
      selectedWatchlistDisplayGroup,
      normalizedItems,
      watchlistSymbolOptions,
      watchlistPriceMap
    ).map((item) => applyTransactionEtfNameTranslation(item, etfNameTranslations)),
    [etfNameTranslations, normalizedItems, selectedWatchlistDisplayGroup, watchlistPriceMap, watchlistSymbolOptions]
  );
  const etfNameTranslationSources = useMemo(
    () => collectTransactionEtfNameTranslationSources(
      payload?.items,
      normalizedWatchlistGroups,
      normalizedSimulatorAccounts,
      [
        ...watchlistRemoteSymbolOptions,
        ...simulatorBuyRemoteSymbolOptions,
        ...simulatorSymbolSearchOptions,
      ],
    ),
    [
      normalizedSimulatorAccounts,
      normalizedWatchlistGroups,
      payload?.items,
      simulatorBuyRemoteSymbolOptions,
      simulatorSymbolSearchOptions,
      watchlistRemoteSymbolOptions,
    ],
  );
  const etfNameTranslationSourceKey = useMemo(
    () => JSON.stringify(etfNameTranslationSources.map((item) => [
      item.provider,
      item.symbol,
      item.instrumentId,
      item.contractType,
      item.underlyingType,
      item.underlyingSubType,
    ])),
    [etfNameTranslationSources],
  );
  const selectedWatchlistChartItem = useMemo(() => {
    const instrumentId = cleanTransactionInstrumentId(selectedWatchlistChartSymbol);
    if (!instrumentId) return null;
    const row = selectedWatchlistRows.find((item) => item.instrumentId === instrumentId);
    return row ? transactionWatchlistDetailItem(row, mainUnit) : null;
  }, [mainUnit, selectedWatchlistChartSymbol, selectedWatchlistRows]);

  useEffect(() => {
    if (!selectedWatchlistChartSymbol || selectedWatchlistChartItem) return;
    setSelectedWatchlistChartSymbol("");
  }, [selectedWatchlistChartItem, selectedWatchlistChartSymbol]);

  useEffect(() => {
    if (!etfNameTranslationSources.length) {
      setEtfNameTranslations(new Map());
      return undefined;
    }
    const controller = new AbortController();
    let timer = null;

    async function startTranslationPolling() {
      try {
        const candidates = await resolveTransactionEtfNameTranslationCandidates(
          etfNameTranslationSources,
          controller.signal,
        );
        if (controller.signal.aborted) return;
        if (!candidates.length) {
          setEtfNameTranslations(new Map());
          return;
        }

        async function refreshTranslations() {
          try {
            const body = await fetchTransactionEtfNameTranslations(candidates, controller.signal);
            if (controller.signal.aborted) return;
            setEtfNameTranslations(transactionEtfNameTranslationMap(body.items));
            const memory = body.etfNameTranslationCache || {};
            if (memory.inFlight || Number(memory.pendingCount || 0) > 0) {
              const retryAtMs = Date.parse(memory.nextRetryAt || "");
              const retryDelayMs = Number.isFinite(retryAtMs)
                ? Math.min(300_000, Math.max(transactionEtfNameTranslationPollMs, retryAtMs - Date.now()))
                : transactionEtfNameTranslationPollMs;
              timer = window.setTimeout(refreshTranslations, retryDelayMs);
            }
          } catch (fetchError) {
            if (!controller.signal.aborted && fetchError.name !== "AbortError") {
              timer = window.setTimeout(refreshTranslations, 5_000);
            }
          }
        }

        void refreshTranslations();
      } catch (fetchError) {
        if (!controller.signal.aborted && fetchError.name !== "AbortError") {
          timer = window.setTimeout(startTranslationPolling, 5_000);
        }
      }
    }

    void startTranslationPolling();
    return () => {
      controller.abort();
      if (timer) window.clearTimeout(timer);
    };
  }, [etfNameTranslationSourceKey]);

  useEffect(() => {
    payloadRef.current = payload;
  }, [payload]);

  useEffect(() => {
    const controller = new AbortController();
    async function loadBinanceProviderStatus() {
      try {
        const response = await fetch("/api/market-data/providers/status?provider=binance", {
          cache: "no-store",
          signal: controller.signal,
        });
        const body = await response.json().catch(() => ({}));
        if (!response.ok || body?.ok === false) throw new Error(body?.error || `HTTP ${response.status}`);
        if (!controller.signal.aborted) {
          setBinanceProviderStatus(body);
          setBinanceProviderError("");
        }
      } catch (fetchError) {
        if (!controller.signal.aborted && fetchError.name !== "AbortError") {
          setBinanceProviderStatus(null);
          setBinanceProviderError(fetchError.message || "Binance 공개 시세 상태를 확인하지 못했습니다.");
        }
      }
    }
    void loadBinanceProviderStatus();
    return () => controller.abort();
  }, [refreshKey]);

  useEffect(() => {
    const controller = new AbortController();

    async function loadSimulatorAccounts() {
      setSimulatorLoading(true);
      setSimulatorError("");
      try {
        let body = await fetchInvestSimulatorAccounts(controller.signal);
        let nextAccounts = simulatorAccountsFromApiPayload(body);
        const storedAccounts = readStoredTransactionSimulators();
        if (!nextAccounts.length && storedAccounts.length) {
          for (const storedAccount of storedAccounts) {
            if (controller.signal.aborted) return;
            body = await postInvestSimulatorAccount({
              id: storedAccount.id,
              name: storedAccount.name,
              initialKrw: storedAccount.cashKrw,
              initialUsd: storedAccount.cashUsd,
              idempotencyKey: `prototype-migration:${storedAccount.id}`,
            }, controller.signal);
          }
          clearStoredTransactionSimulators();
          nextAccounts = simulatorAccountsFromApiPayload(body);
        }
        if (!controller.signal.aborted) {
          setSimulatorAccounts(nextAccounts);
          setSimulatorError("");
        }
      } catch (fetchError) {
        if (fetchError.name !== "AbortError") {
          setSimulatorError(fetchError.message || "시뮬레이터 장부를 불러오지 못했습니다.");
        }
      } finally {
        if (!controller.signal.aborted) {
          setSimulatorLoading(false);
          setSimulatorStoreReady(true);
        }
      }
    }

    void loadSimulatorAccounts();
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!simulatorStoreReady || !selectedSimulatorId) return;
    const simulatorId = cleanTransactionSimulatorId(selectedSimulatorId);
    if (!simulatorId) return;
    if (!normalizedSimulatorAccounts.some((simulator) => simulator.id === simulatorId)) {
      setSelectedSimulatorId("");
    }
  }, [normalizedSimulatorAccounts, selectedSimulatorId, simulatorStoreReady]);

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
    const savedInstruments = normalizeTransactionWatchlistInstrumentsSetting(
      selectedWatchlistGroup?.instruments,
      selectedWatchlistGroup?.symbols
    );
    const tossSymbols = savedInstruments
      .filter((instrument) => instrument.provider !== "binance")
      .map((instrument) => instrument.symbol);
    setWatchlistSavedSymbolOptions(savedInstruments);
    if (!tossSymbols.length || !liveFetchGate.ready) return undefined;
    const controller = new AbortController();
    async function loadSavedWatchlistSymbols() {
      try {
        const response = await fetch(`/api/tossinvest/stocks?symbols=${encodeURIComponent(tossSymbols.join(","))}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const body = await response.json().catch(() => ({}));
        if (!response.ok || body?.ok === false) return;
        const options = transactionWatchlistStockOptionsFromPayload(body);
        if (!controller.signal.aborted) {
          setWatchlistSavedSymbolOptions(mergeTransactionWatchlistSymbolOptions(savedInstruments, options));
        }
      } catch (fetchError) {
        if (!controller.signal.aborted && fetchError.name !== "AbortError") {
          setWatchlistSavedSymbolOptions(savedInstruments);
        }
      }
    }
    void loadSavedWatchlistSymbols();
    return () => controller.abort();
  }, [liveFetchGate.ready, selectedWatchlistGroup, selectedWatchlistSymbolKey]);

  useEffect(() => {
    if (activeSection !== "watchlist") return undefined;
    const instruments = normalizeTransactionWatchlistInstrumentsSetting(
      selectedWatchlistGroup?.instruments,
      selectedWatchlistGroup?.symbols
    );
    if (!instruments.length) {
      setWatchlistPricePayload(null);
      setWatchlistPriceMap(new Map());
      setWatchlistPriceLoading(false);
      setWatchlistPriceError("");
      setWatchlistPriceErrorCode("");
      return undefined;
    }
    const hasBinance = instruments.some((instrument) => instrument.provider === "binance");
    const hasToss = instruments.some((instrument) => instrument.provider !== "binance");
    if (!hasBinance && hasToss && !liveFetchGate.ready) {
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
        const nextPayload = await fetchTransactionWatchlistPrices(instruments, controller.signal, {
          tossReady: liveFetchGate.ready,
          tossMessage: liveFetchGate.message,
        });
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
    if (
      activeSection !== "investment" ||
      !selectedSimulatorId ||
      !selectedSimulatorCalendarUnitKey ||
      !liveFetchGate.ready
    ) {
      setSimulatorMarketCalendars({});
      return undefined;
    }
    const units = selectedSimulatorCalendarUnitKey
      .split(",")
      .map((unit) => normalizeMoneyUnit(unit))
      .filter(Boolean);
    const controller = new AbortController();

    async function loadSimulatorMarketCalendars() {
      const entries = await Promise.all(units.map(async (unit) => {
        const marketCode = transactionSimulatorMarketCalendarCode(unit);
        const calendarDate = transactionSimulatorCalendarDate(unit);
        try {
          const response = await fetch(
            `/api/tossinvest/market-calendar/${marketCode}?date=${encodeURIComponent(calendarDate)}`,
            {
              cache: "no-store",
              signal: controller.signal,
            }
          );
          const body = await response.json().catch(() => ({}));
          if (!response.ok || body?.ok === false) return null;
          return [unit, body];
        } catch (fetchError) {
          if (fetchError.name === "AbortError") throw fetchError;
          return null;
        }
      }));
      if (controller.signal.aborted) return;
      setSimulatorMarketCalendars(Object.fromEntries(entries.filter(Boolean)));
    }

    void loadSimulatorMarketCalendars().catch((fetchError) => {
      if (!controller.signal.aborted && fetchError.name !== "AbortError") {
        setSimulatorMarketCalendars({});
      }
    });
    return () => controller.abort();
  }, [
    activeSection,
    liveFetchGate.ready,
    selectedSimulatorCalendarUnitKey,
    selectedSimulatorId,
  ]);

  useEffect(() => {
    if (activeSection !== "investment" || !selectedSimulatorId || !simulatorStoreReady || !pageVisible) {
      return undefined;
    }

    const controller = new AbortController();
    async function refreshSimulatorAccounts() {
      try {
        const body = await fetchInvestSimulatorAccounts(controller.signal);
        if (controller.signal.aborted) return;
        setSimulatorAccounts(simulatorAccountsFromApiPayload(body));
        setSimulatorError("");
      } catch (fetchError) {
        if (!controller.signal.aborted && fetchError.name !== "AbortError") {
          setSimulatorError(fetchError.message || "시뮬레이터 장부를 갱신하지 못했습니다.");
        }
      }
    }

    void refreshSimulatorAccounts();
    return () => controller.abort();
  }, [
    activeSection,
    pageVisible,
    refreshKey,
    selectedSimulatorId,
    simulatorStoreReady,
  ]);

  useEffect(() => {
    if (activeSection !== "investment" || !selectedSimulatorId) {
      setSimulatorPricePayload(null);
      setSimulatorPriceMap(new Map());
      setSimulatorPriceError("");
      return undefined;
    }
    const instruments = selectedSimulatorMarketDataInstruments;
    if (!instruments.length) {
      setSimulatorPricePayload(null);
      setSimulatorPriceMap(new Map());
      setSimulatorPriceError("");
      return undefined;
    }
    const hasBinance = instruments.some((instrument) => instrument.provider === "binance");
    const hasToss = instruments.some((instrument) => instrument.provider !== "binance");
    if (!hasBinance && hasToss && !liveFetchGate.ready) {
      setSimulatorPricePayload(null);
      setSimulatorPriceMap(new Map());
      setSimulatorPriceError(liveFetchGate.waiting ? "" : liveFetchGate.message);
      return undefined;
    }

    const controller = new AbortController();
    async function loadSimulatorPrices() {
      try {
        const nextPayload = await fetchTransactionWatchlistPrices(instruments, controller.signal, {
          tossReady: liveFetchGate.ready,
          tossMessage: liveFetchGate.message,
        });
        if (controller.signal.aborted) return;
        setSimulatorPricePayload(nextPayload);
        setSimulatorPriceMap(nextPayload.priceMap || new Map());
        setSimulatorPriceError("");
      } catch (fetchError) {
        if (!controller.signal.aborted && fetchError.name !== "AbortError") {
          setSimulatorPriceError(fetchError.message || "시뮬레이터 현재가를 갱신하지 못했습니다.");
        }
      }
    }

    void loadSimulatorPrices();
    return () => controller.abort();
  }, [
    activeSection,
    liveFetchGate.message,
    liveFetchGate.ready,
    liveFetchGate.waiting,
    refreshKey,
    selectedSimulatorId,
    selectedSimulatorMarketDataInstruments,
    selectedSimulatorSymbolKey,
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
          const nextSettings = transactionCurrencySettingsFromPayload(body);
          setCurrencySettings(nextSettings);
          setValueMode(nextSettings.sidebarValueMode);
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
      setValueMode(nextSettings.sidebarValueMode);
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

  const handleValueModeChange = useCallback((nextMode) => {
    const normalizedMode = normalizeTransactionValueModeSetting(nextMode);
    setValueMode(normalizedMode);
    setCurrencySettings((current) => ({
      ...current,
      sidebarValueMode: normalizedMode,
    }));
    void saveTransactionCurrencySettings({ sidebarValueMode: normalizedMode });
  }, [saveTransactionCurrencySettings]);

  const handleInvestmentChartModeChange = useCallback((nextMode) => {
    const normalizedMode = normalizeTransactionInvestmentChartModeSetting(nextMode);
    setCurrencySettings((current) => ({
      ...current,
      investmentChartMode: normalizedMode,
    }));
    void saveTransactionCurrencySettings({ investmentChartMode: normalizedMode });
  }, [saveTransactionCurrencySettings]);

  const handleInvestmentChartIntervalChange = useCallback((nextInterval) => {
    const normalizedInterval = normalizeTransactionInvestmentChartIntervalSetting(nextInterval);
    setCurrencySettings((current) => ({
      ...current,
      investmentChartIntervalMode: normalizedInterval,
    }));
    void saveTransactionCurrencySettings({ investmentChartIntervalMode: normalizedInterval });
  }, [saveTransactionCurrencySettings]);

  const handleInvestmentChartVolumeVisibleChange = useCallback((nextVisible) => {
    const normalizedVisible = normalizeTransactionBooleanSetting(
      nextVisible,
      defaultTransactionCurrencySettings.investmentChartVolumeVisible
    );
    setCurrencySettings((current) => ({
      ...current,
      investmentChartVolumeVisible: normalizedVisible,
    }));
    void saveTransactionCurrencySettings({ investmentChartVolumeVisible: normalizedVisible });
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
    setSelectedWatchlistChartSymbol("");
    if (watchlistRenameGroupId && nextGroupId !== watchlistRenameGroupId) {
      handleCancelWatchlistGroupRename();
    }
    handleCancelWatchlistSymbolOrder();
  }, [
    handleCancelWatchlistGroupRename,
    handleCancelWatchlistSymbolOrder,
    watchlistRenameGroupId,
  ]);

  const handleSelectWatchlistSymbol = useCallback((instrumentValue) => {
    const instrumentId = cleanTransactionInstrumentId(instrumentValue);
    if (!instrumentId || watchlistSymbolOrderEditing) return;
    setSelectedWatchlistChartSymbol(instrumentId);
  }, [watchlistSymbolOrderEditing]);

  const handleCloseWatchlistChart = useCallback(() => {
    setSelectedWatchlistChartSymbol("");
  }, []);

  const handleOpenWatchlistSymbolAdd = useCallback(() => {
    if (watchlistSymbolOrderEditing) return;
    if (!selectedWatchlistGroup) return;
    setWatchlistSymbolDraft("");
    setWatchlistSelectedSymbol(null);
    setWatchlistSymbolError("");
    setWatchlistRemoteSymbolOptions([]);
    setWatchlistSymbolAddOpen(true);
  }, [selectedWatchlistGroup, watchlistSymbolOrderEditing]);

  const handleCancelWatchlistSymbolAdd = useCallback(() => {
    setWatchlistSymbolAddOpen(false);
    setWatchlistSymbolDraft("");
    setWatchlistSelectedSymbol(null);
    setWatchlistSymbolError("");
    setWatchlistRemoteSymbolOptions([]);
  }, []);

  const handleWatchlistSymbolDraftChange = useCallback((nextValue) => {
    setWatchlistSymbolDraft(nextValue);
    const selectedSymbol = cleanTransactionWatchlistSymbol(watchlistSelectedSymbol?.symbol);
    if (selectedSymbol && cleanTransactionWatchlistSymbol(nextValue) !== selectedSymbol) {
      setWatchlistSelectedSymbol(null);
    }
    if (watchlistSymbolError) setWatchlistSymbolError("");
  }, [watchlistSelectedSymbol?.symbol, watchlistSymbolError]);

  const handleWatchlistSymbolSelect = useCallback((option) => {
    const symbol = cleanTransactionWatchlistSymbol(option?.symbol);
    if (!symbol) return;
    setWatchlistSymbolDraft(symbol);
    setWatchlistSelectedSymbol({ ...option, symbol });
    setWatchlistSymbolError("");
    setWatchlistRemoteSymbolOptions((current) => (
      mergeTransactionWatchlistSymbolOptions(current, [{ ...option, symbol }])
    ));
  }, []);

  const handleOpenSimulatorSymbolSearch = useCallback(() => {
    if (!selectedSimulator) return;
    setSimulatorSymbolSearchDraft("");
    setSimulatorSymbolSearchSelection(null);
    setSimulatorSymbolSearchOptions([]);
    setSimulatorSymbolSearchError("");
    setSimulatorSymbolSearchOpen(true);
  }, [selectedSimulator]);

  const handleCancelSimulatorSymbolSearch = useCallback(() => {
    setSimulatorSymbolSearchOpen(false);
    setSimulatorSymbolSearchDraft("");
    setSimulatorSymbolSearchSelection(null);
    setSimulatorSymbolSearchOptions([]);
    setSimulatorSymbolSearchError("");
  }, []);

  const handleSimulatorSymbolSearchDraftChange = useCallback((nextValue) => {
    setSimulatorSymbolSearchDraft(nextValue);
    const selectedSymbol = cleanTransactionWatchlistSymbol(simulatorSymbolSearchSelection?.symbol);
    if (selectedSymbol && cleanTransactionWatchlistSymbol(nextValue) !== selectedSymbol) {
      setSimulatorSymbolSearchSelection(null);
    }
    if (simulatorSymbolSearchError) setSimulatorSymbolSearchError("");
  }, [simulatorSymbolSearchError, simulatorSymbolSearchSelection?.symbol]);

  const handleSimulatorSymbolSearchSelect = useCallback((option) => {
    const symbol = cleanTransactionWatchlistSymbol(option?.symbol);
    if (!symbol) return;
    const normalizedOption = { ...option, symbol };
    setSimulatorSymbolSearchDraft(symbol);
    setSimulatorSymbolSearchSelection(normalizedOption);
    setSimulatorSymbolSearchOptions((current) => (
      mergeTransactionWatchlistSymbolOptions(current, [normalizedOption])
    ));
    setSimulatorSymbolSearchError("");
  }, []);

  const handleOpenSimulatorBuy = useCallback((sourceItem = null, options = {}) => {
    if (!selectedSimulator) return;
    const selectedPositionSymbol = transactionSimulatorStockOptionFromItem(sourceItem);
    const requestedOrderUnit = normalizeMoneyUnit(options?.unit || mainUnit);
    const settlementUnit = selectedPositionSymbol
      ? transactionSimulatorSettlementUnit(selectedPositionSymbol)
      : requestedOrderUnit;
    const orderUnit = requestedOrderUnit === settlementUnit ||
      convertMoney(1, settlementUnit, requestedOrderUnit, usdKrwRate) !== null
      ? requestedOrderUnit
      : settlementUnit;
    setSimulatorSellOpen(false);
    setSimulatorSellPosition(null);
    setSimulatorBuyBusy(false);
    setSimulatorBuyUnit(orderUnit);
    setSimulatorBuySymbolDraft(selectedPositionSymbol?.symbol || "");
    setSimulatorBuySelectedSymbol(selectedPositionSymbol);
    setSimulatorBuyRemoteSymbolOptions([]);
    setSimulatorBuyAmountDraft("");
    setSimulatorBuyError("");
    setSimulatorBuyMarketCalendar(null);
    setSimulatorBuyMarketCalendarLoading(false);
    setSimulatorBuyMarketCalendarError("");
    simulatorBuyIdempotencyKeyRef.current = "";
    setSimulatorBuyOpen(true);
  }, [mainUnit, selectedSimulator, usdKrwRate]);

  const handleCancelSimulatorBuy = useCallback(() => {
    if (simulatorBuyBusy) return;
    setSimulatorBuyOpen(false);
    setSimulatorBuyBusy(false);
    setSimulatorBuySymbolDraft("");
    setSimulatorBuySelectedSymbol(null);
    setSimulatorBuyRemoteSymbolOptions([]);
    setSimulatorBuyAmountDraft("");
    setSimulatorBuyError("");
    setSimulatorBuyMarketCalendar(null);
    setSimulatorBuyMarketCalendarLoading(false);
    setSimulatorBuyMarketCalendarError("");
    simulatorBuyIdempotencyKeyRef.current = "";
  }, [simulatorBuyBusy]);

  const handleSimulatorBuySymbolDraftChange = useCallback((nextValue) => {
    setSimulatorBuySymbolDraft(nextValue);
    const selectedSymbol = cleanTransactionWatchlistSymbol(simulatorBuySelectedSymbol?.symbol);
    if (selectedSymbol && cleanTransactionWatchlistSymbol(nextValue) !== selectedSymbol) {
      setSimulatorBuySelectedSymbol(null);
      setSimulatorBuyAmountDraft("");
      setSimulatorBuyMarketCalendar(null);
      setSimulatorBuyMarketCalendarLoading(false);
      setSimulatorBuyMarketCalendarError("");
      simulatorBuyIdempotencyKeyRef.current = "";
    }
    if (simulatorBuyError) setSimulatorBuyError("");
  }, [simulatorBuyError, simulatorBuySelectedSymbol?.symbol]);

  const handleSimulatorBuySelectSymbol = useCallback((option) => {
    const symbol = cleanTransactionWatchlistSymbol(option?.symbol);
    if (!symbol) return;
    const selectedInstrument = normalizeTransactionInstrument({ ...option, symbol });
    const settlementUnit = transactionSimulatorSettlementUnit(selectedInstrument);
    setSimulatorBuyUnit((currentUnit) => (
      currentUnit === settlementUnit || convertMoney(1, settlementUnit, currentUnit, usdKrwRate) !== null
        ? currentUnit
        : settlementUnit
    ));
    setSimulatorBuySelectedSymbol(selectedInstrument);
    setSimulatorBuySymbolDraft(symbol);
    setSimulatorBuyAmountDraft("");
    setSimulatorBuyError("");
    setSimulatorBuyMarketCalendar(null);
    setSimulatorBuyMarketCalendarLoading(false);
    setSimulatorBuyMarketCalendarError("");
    simulatorBuyIdempotencyKeyRef.current = "";
  }, [usdKrwRate]);

  const handleSimulatorBuyAmountChange = useCallback((nextValue) => {
    setSimulatorBuyAmountDraft(cleanTransactionSimulatorBuyAmountDraft(nextValue, simulatorBuyUnit));
    simulatorBuyIdempotencyKeyRef.current = "";
    if (simulatorBuyError) setSimulatorBuyError("");
  }, [simulatorBuyError, simulatorBuyUnit]);

  const handleSimulatorBuyPresetAmount = useCallback((amount) => {
    setSimulatorBuyAmountDraft(formatTransactionSimulatorBuyAmountDraft(amount, simulatorBuyUnit));
    simulatorBuyIdempotencyKeyRef.current = "";
    setSimulatorBuyError("");
  }, [simulatorBuyUnit]);

  const handleSubmitSimulatorBuy = useCallback(async (order) => {
    if (!selectedSimulator?.id || simulatorBuyBusy) return;
    const symbol = cleanTransactionWatchlistSymbol(order?.symbol);
    if (!symbol) {
      setSimulatorBuyError("매수할 종목을 선택하세요.");
      return;
    }
    const settlementUnit = normalizeMoneyUnit(order?.settlementUnit);
    const instrument = normalizeTransactionInstrument({ ...simulatorBuySelectedSymbol, ...order, symbol });
    if (instrument.provider === "binance") {
      const availability = transactionBinanceProviderAvailability(binanceProviderStatus, binanceProviderError);
      if (!availability.available) {
        setSimulatorBuyError(availability.reason);
        return;
      }
    }
    const settlementAmount = Number(order?.settlementAmount || 0);
    if (!Number.isFinite(settlementAmount) || settlementAmount <= 0) {
      setSimulatorBuyError("주문 금액을 입력하세요.");
      return;
    }
    setSimulatorBuyBusy(true);
    setSimulatorBuyError("");
    try {
      const execution = await fetchTransactionSimulatorExecutionPrice(instrument, settlementUnit);
      const quantity = settlementAmount / execution.price;
      if (!Number.isFinite(quantity) || quantity <= 0) {
        throw new Error("체결 수량을 계산하지 못했습니다.");
      }
      const idempotencyKey = simulatorBuyIdempotencyKeyRef.current ||
        createTransactionSimulatorOrderIdempotencyKey("buy", selectedSimulator.id, instrument.instrumentId);
      simulatorBuyIdempotencyKeyRef.current = idempotencyKey;
      const body = await postInvestSimulatorBuy({
        simulatorId: selectedSimulator.id,
        instrumentId: instrument.instrumentId,
        provider: instrument.provider,
        venue: instrument.venue,
        assetClass: instrument.assetClass,
        displaySymbol: instrument.displaySymbol,
        baseAsset: instrument.baseAsset,
        quoteAsset: instrument.quoteAsset,
        settlementAsset: instrument.settlementAsset || settlementUnit,
        nativeQuoteAsset: instrument.nativeQuoteAsset,
        sessionPolicy: instrument.sessionPolicy,
        status: instrument.status,
        feeAmount: 0,
        feeAssumption: "zero-no-public-account-rate",
        symbol,
        symbolName: order?.symbolName || simulatorBuySelectedSymbol?.name || symbol,
        englishName: simulatorBuySelectedSymbol?.englishName || "",
        market: order?.market || simulatorBuySelectedSymbol?.market || "",
        marketCountry: instrument.provider === "binance" ? "GLOBAL" : settlementUnit === "KRW" ? "KR" : "US",
        orderUnit: normalizeMoneyUnit(order?.orderUnit),
        orderAmount: order?.orderAmount,
        settlementCurrency: settlementUnit,
        settlementAmount,
        price: execution.price,
        priceCurrency: execution.currency,
        quantity,
        priceTimestamp: execution.timestamp,
        priceSource: execution.source,
        marketSession: order?.marketSession || "",
        idempotencyKey,
      });
      setSimulatorAccounts(simulatorAccountsFromApiPayload(body));
      showSimulatorOrderNotification({
        side: "buy",
        symbol,
        amount: settlementAmount,
        unit: settlementUnit,
      });
      setSimulatorBuyOpen(false);
      setSimulatorBuySymbolDraft("");
      setSimulatorBuySelectedSymbol(null);
      setSimulatorBuyRemoteSymbolOptions([]);
      setSimulatorBuyAmountDraft("");
      setSimulatorBuyMarketCalendar(null);
      setSimulatorBuyMarketCalendarLoading(false);
      setSimulatorBuyMarketCalendarError("");
      simulatorBuyIdempotencyKeyRef.current = "";
    } catch (fetchError) {
      setSimulatorBuyError(fetchError.message || "주문을 체결하지 못했습니다.");
    } finally {
      setSimulatorBuyBusy(false);
    }
  }, [
    selectedSimulator?.id,
    binanceProviderError,
    binanceProviderStatus,
    showSimulatorOrderNotification,
    simulatorBuyBusy,
    simulatorBuySelectedSymbol,
  ]);

  const handleOpenSimulatorSell = useCallback((position, options = {}) => {
    if (!selectedSimulator) return;
    const selectedPositionSymbol = transactionSimulatorStockOptionFromItem(position);
    if (!selectedPositionSymbol) return;
    const requestedOrderUnit = normalizeMoneyUnit(options?.unit || mainUnit);
    const settlementUnit = transactionSimulatorSettlementUnit(selectedPositionSymbol);
    const orderUnit = requestedOrderUnit === settlementUnit ||
      convertMoney(1, settlementUnit, requestedOrderUnit, usdKrwRate) !== null
      ? requestedOrderUnit
      : settlementUnit;
    setSimulatorBuyOpen(false);
    setSimulatorSellBusy(false);
    setSimulatorSellUnit(orderUnit);
    setSimulatorSellPosition(position);
    setSimulatorSellAmountDraft("");
    setSimulatorSellError("");
    setSimulatorSellMarketCalendar(null);
    setSimulatorSellMarketCalendarLoading(false);
    setSimulatorSellMarketCalendarError("");
    simulatorSellIdempotencyKeyRef.current = "";
    setSimulatorSellOpen(true);
  }, [mainUnit, selectedSimulator, usdKrwRate]);

  const handleCancelSimulatorSell = useCallback(() => {
    if (simulatorSellBusy) return;
    setSimulatorSellOpen(false);
    setSimulatorSellBusy(false);
    setSimulatorSellPosition(null);
    setSimulatorSellAmountDraft("");
    setSimulatorSellError("");
    setSimulatorSellMarketCalendar(null);
    setSimulatorSellMarketCalendarLoading(false);
    setSimulatorSellMarketCalendarError("");
    simulatorSellIdempotencyKeyRef.current = "";
  }, [simulatorSellBusy]);

  const handleSimulatorSellAmountChange = useCallback((nextValue) => {
    setSimulatorSellAmountDraft(cleanTransactionSimulatorBuyAmountDraft(nextValue, simulatorSellUnit));
    simulatorSellIdempotencyKeyRef.current = "";
    if (simulatorSellError) setSimulatorSellError("");
  }, [simulatorSellError, simulatorSellUnit]);

  const handleSimulatorSellPresetFraction = useCallback((fraction) => {
    const position = simulatorSellPosition;
    const settlementUnit = normalizeMoneyUnit(position?.currency || position?.displayCurrency || "KRW");
    const holdingSettlementValue = transactionSimulatorPositionSettlementValue(position);
    const holdingOrderValue = convertMoney(holdingSettlementValue, settlementUnit, simulatorSellUnit, usdKrwRate);
    if (holdingOrderValue === null || holdingOrderValue <= 0) return;
    const nextAmount = holdingOrderValue * Number(fraction || 0);
    setSimulatorSellAmountDraft(formatTransactionSimulatorBuyAmountDraft(nextAmount, simulatorSellUnit));
    simulatorSellIdempotencyKeyRef.current = "";
    setSimulatorSellError("");
  }, [simulatorSellPosition, simulatorSellUnit, usdKrwRate]);

  const handleSubmitSimulatorSell = useCallback(async (order) => {
    if (!selectedSimulator?.id || !simulatorSellPosition || simulatorSellBusy) return;
    const symbol = cleanTransactionWatchlistSymbol(order?.symbol);
    if (!symbol) {
      setSimulatorSellError("매도할 종목을 찾지 못했습니다.");
      return;
    }
    const settlementUnit = normalizeMoneyUnit(order?.settlementUnit);
    const instrument = normalizeTransactionInstrument({ ...simulatorSellPosition, ...order, symbol });
    if (instrument.provider === "binance") {
      const availability = transactionBinanceProviderAvailability(binanceProviderStatus, binanceProviderError);
      if (!availability.available) {
        setSimulatorSellError(availability.reason);
        return;
      }
    }
    const requestedSettlementAmount = Number(order?.settlementAmount || 0);
    if (!Number.isFinite(requestedSettlementAmount) || requestedSettlementAmount <= 0) {
      setSimulatorSellError("주문 금액을 입력하세요.");
      return;
    }
    setSimulatorSellBusy(true);
    setSimulatorSellError("");
    try {
      const execution = await fetchTransactionSimulatorExecutionPrice(instrument, settlementUnit);
      const heldQuantity = numericAmount(simulatorSellPosition.quantity, 0);
      const holdingSettlementValue = transactionSimulatorPositionSettlementValue(simulatorSellPosition);
      const shouldSellAll = requestedSettlementAmount >= holdingSettlementValue * 0.999;
      let quantity = shouldSellAll ? heldQuantity : requestedSettlementAmount / execution.price;
      if (!Number.isFinite(quantity) || quantity <= 0) {
        throw new Error("체결 수량을 계산하지 못했습니다.");
      }
      if (quantity > heldQuantity) {
        if (shouldSellAll || quantity - heldQuantity < 0.0000001) {
          quantity = heldQuantity;
        } else {
          throw new Error("보유 수량보다 많이 매도할 수 없습니다.");
        }
      }
      const settlementAmount = quantity * execution.price;
      const idempotencyKey = simulatorSellIdempotencyKeyRef.current ||
        createTransactionSimulatorOrderIdempotencyKey("sell", selectedSimulator.id, instrument.instrumentId);
      simulatorSellIdempotencyKeyRef.current = idempotencyKey;
      const body = await postInvestSimulatorSell({
        simulatorId: selectedSimulator.id,
        instrumentId: instrument.instrumentId,
        provider: instrument.provider,
        venue: instrument.venue,
        assetClass: instrument.assetClass,
        displaySymbol: instrument.displaySymbol,
        baseAsset: instrument.baseAsset,
        quoteAsset: instrument.quoteAsset,
        settlementAsset: instrument.settlementAsset || settlementUnit,
        nativeQuoteAsset: instrument.nativeQuoteAsset,
        sessionPolicy: instrument.sessionPolicy,
        status: instrument.status,
        feeAmount: 0,
        feeAssumption: "zero-no-public-account-rate",
        symbol,
        symbolName: order?.symbolName || simulatorSellPosition.label || simulatorSellPosition.name || symbol,
        englishName: order?.englishName || simulatorSellPosition.englishName || "",
        market: order?.market || simulatorSellPosition.market || "",
        marketCountry: instrument.provider === "binance" ? "GLOBAL" : settlementUnit === "KRW" ? "KR" : "US",
        orderUnit: normalizeMoneyUnit(order?.orderUnit),
        orderAmount: order?.orderAmount,
        settlementCurrency: settlementUnit,
        settlementAmount,
        price: execution.price,
        priceCurrency: execution.currency,
        quantity,
        priceTimestamp: execution.timestamp,
        priceSource: execution.source,
        marketSession: order?.marketSession || "",
        idempotencyKey,
      });
      setSimulatorAccounts(simulatorAccountsFromApiPayload(body));
      showSimulatorOrderNotification({
        side: "sell",
        symbol,
        amount: settlementAmount,
        unit: settlementUnit,
      });
      setSimulatorSellOpen(false);
      setSimulatorSellPosition(null);
      setSimulatorSellAmountDraft("");
      setSimulatorSellMarketCalendar(null);
      setSimulatorSellMarketCalendarLoading(false);
      setSimulatorSellMarketCalendarError("");
      simulatorSellIdempotencyKeyRef.current = "";
    } catch (fetchError) {
      setSimulatorSellError(fetchError.message || "주문을 체결하지 못했습니다.");
    } finally {
      setSimulatorSellBusy(false);
    }
  }, [
    selectedSimulator?.id,
    binanceProviderError,
    binanceProviderStatus,
    showSimulatorOrderNotification,
    simulatorSellBusy,
    simulatorSellPosition,
  ]);

  const handleOpenSidebarSimulatorBuy = useCallback((item) => {
    handleOpenSimulatorBuy(item, { unit: sidebarUnit });
  }, [handleOpenSimulatorBuy, sidebarUnit]);

  const handleOpenSidebarSimulatorSell = useCallback((item) => {
    handleOpenSimulatorSell(item, { unit: sidebarUnit });
  }, [handleOpenSimulatorSell, sidebarUnit]);

  const handleOpenDetailSimulatorBuy = useCallback((item) => {
    handleOpenSimulatorBuy(item, { unit: mainUnit });
  }, [handleOpenSimulatorBuy, mainUnit]);

  const handleOpenDetailSimulatorSell = useCallback((item) => {
    handleOpenSimulatorSell(item, { unit: mainUnit });
  }, [handleOpenSimulatorSell, mainUnit]);

  const handleOpenSimulatorExchange = useCallback((modeId = "KRW_TO_USD") => {
    if (!selectedSimulator) return;
    const mode = transactionSimulatorExchangeMode(modeId);
    setSimulatorExchangeMode(mode.id);
    setSimulatorExchangeAmountDraft("");
    setSimulatorExchangeError("");
    setSimulatorExchangeOpen(true);
  }, [selectedSimulator]);

  const handleCancelSimulatorExchange = useCallback(() => {
    if (simulatorExchangeBusy) return;
    setSimulatorExchangeOpen(false);
    setSimulatorExchangeMode("KRW_TO_USD");
    setSimulatorExchangeAmountDraft("");
    setSimulatorExchangeError("");
  }, [simulatorExchangeBusy]);

  const handleSimulatorExchangeModeChange = useCallback((modeId) => {
    const mode = transactionSimulatorExchangeMode(modeId);
    setSimulatorExchangeMode(mode.id);
    setSimulatorExchangeAmountDraft("");
    setSimulatorExchangeError("");
  }, []);

  const handleSimulatorExchangeAmountChange = useCallback((nextValue) => {
    setSimulatorExchangeAmountDraft(cleanTransactionSimulatorExchangeAmountDraft(nextValue, simulatorExchangeMode));
    if (simulatorExchangeError) setSimulatorExchangeError("");
  }, [simulatorExchangeError, simulatorExchangeMode]);

  const handleSubmitSimulatorExchange = useCallback(async (exchange) => {
    if (!selectedSimulator?.id || simulatorExchangeBusy) return;
    setSimulatorExchangeBusy(true);
    setSimulatorExchangeError("");
    try {
      const body = await postInvestSimulatorExchange({
        simulatorId: selectedSimulator.id,
        fromCurrency: exchange.fromCurrency,
        toCurrency: exchange.toCurrency,
        fromAmount: exchange.fromAmount,
        toAmount: exchange.toAmount,
        rate: exchange.rate,
      });
      setSimulatorAccounts(simulatorAccountsFromApiPayload(body));
      setSimulatorExchangeOpen(false);
      setSimulatorExchangeAmountDraft("");
      setSimulatorExchangeError("");
    } catch (fetchError) {
      setSimulatorExchangeError(fetchError.message || "환전을 저장하지 못했습니다.");
    } finally {
      setSimulatorExchangeBusy(false);
    }
  }, [selectedSimulator?.id, simulatorExchangeBusy]);

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
    let matchedInstrument = normalizeTransactionInstrument(watchlistSelectedSymbol);
    if (!matchedInstrument || matchedInstrument.symbol !== symbol) {
      matchedInstrument = matchedSymbol
        ? normalizeTransactionInstrument(nextSymbolOptions.find((option) => option.symbol === matchedSymbol))
        : null;
    }
    if (!matchedInstrument) {
      try {
        const catalogOptions = await fetchTransactionWatchlistCatalogOptions(watchlistSymbolDraft);
        nextSymbolOptions = mergeTransactionWatchlistSymbolOptions(nextSymbolOptions, catalogOptions);
        if (catalogOptions.length) {
          setWatchlistRemoteSymbolOptions((current) => (
            mergeTransactionWatchlistSymbolOptions(current, catalogOptions)
          ));
        }
        matchedSymbol = resolveTransactionWatchlistSymbolInput(watchlistSymbolDraft, nextSymbolOptions);
        matchedInstrument = matchedSymbol
          ? normalizeTransactionInstrument(nextSymbolOptions.find((option) => option.symbol === matchedSymbol))
          : null;
      } catch {
        // The validation message below is enough for a failed fallback lookup.
      }
    }
    if (!matchedInstrument && symbol && /^[A-Z0-9.-]+$/.test(symbol)) {
      matchedInstrument = normalizeTransactionInstrument({ symbol, provider: "toss" });
      matchedSymbol = symbol;
    }
    if (!matchedInstrument || !matchedSymbol) {
      setWatchlistSymbolError("Toss 또는 Binance 목록에서 확인할 수 없는 티커 / 종목번호 / 종목명입니다.");
      return;
    }
    if (matchedInstrument.provider === "binance") {
      if (matchedInstrument.status !== "TRADING") {
        setWatchlistSymbolError("현재 TRADING 상태인 Binance 상품만 추가할 수 있습니다.");
        return;
      }
    } else try {
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
    const currentInstruments = normalizeTransactionWatchlistInstrumentsSetting(currentGroup.instruments, currentGroup.symbols);
    if (currentInstruments.some((instrument) => instrument.instrumentId === matchedInstrument.instrumentId)) {
      setWatchlistSymbolError("이미 추가된 종목입니다.");
      return;
    }
    const nextInstruments = [...currentInstruments, matchedInstrument];
    const nextGroups = currentGroups.map((group) => (
      group.id === selectedWatchlistGroup.id
        ? { ...group, symbols: [...currentSymbols, matchedSymbol], instruments: nextInstruments }
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
    setWatchlistSelectedSymbol(null);
    setWatchlistSymbolError("");
    void saveTransactionCurrencySettings({ watchlistGroups: nextGroups });
  }, [
    activeWatchlistGroups,
    saveTransactionCurrencySettings,
    selectedWatchlistGroup,
    watchlistOrderEditing,
    watchlistSelectedSymbol,
    watchlistSymbolOptions,
    watchlistSymbolDraft,
  ]);

  const handleRemoveWatchlistSymbol = useCallback((instrumentValue) => {
    if (!selectedWatchlistGroup?.id) return;
    const instrumentId = cleanTransactionInstrumentId(instrumentValue);
    const symbol = cleanTransactionWatchlistSymbol(instrumentValue);
    if (!instrumentId && !symbol) return;
    const currentGroups = normalizeTransactionWatchlistGroupsSetting(activeWatchlistGroups, []);
    const nextGroups = currentGroups.map((group) => {
      if (group.id !== selectedWatchlistGroup.id) return group;
      const instruments = normalizeTransactionWatchlistInstrumentsSetting(group.instruments, group.symbols)
        .filter((item) => instrumentId ? item.instrumentId !== instrumentId : item.symbol !== symbol);
      return {
        ...group,
        symbols: normalizeTransactionWatchlistSymbolsSetting(instruments),
        instruments,
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
    const instrumentOrder = normalizeTransactionWatchlistInstrumentsSetting(
      selectedWatchlistGroup.instruments,
      selectedWatchlistGroup.symbols,
    ).map((instrument) => instrument.instrumentId);
    if (instrumentOrder.length < 2) return;
    handleCancelWatchlistGroupRename();
    setWatchlistSymbolOrderDraft(instrumentOrder);
    setWatchlistSymbolOrderEditing(true);
  }, [handleCancelWatchlistGroupRename, selectedWatchlistGroup]);

  const handleWatchlistSymbolOrderChange = useCallback((nextSymbols) => {
    setWatchlistSymbolOrderDraft(normalizeTransactionWatchlistInstrumentOrder(nextSymbols));
  }, []);

  const handleWatchlistSymbolOrderSave = useCallback(() => {
    if (!selectedWatchlistGroup?.id) {
      handleCancelWatchlistSymbolOrder();
      return;
    }
    const nextInstrumentOrder = normalizeTransactionWatchlistInstrumentOrder(watchlistSymbolOrderDraft);
    const currentGroups = normalizeTransactionWatchlistGroupsSetting(activeWatchlistGroups, []);
    const currentGroup = currentGroups.find((group) => group.id === selectedWatchlistGroup.id);
    if (!currentGroup) {
      handleCancelWatchlistSymbolOrder();
      return;
    }
    const nextGroups = currentGroups.map((group) => (
      group.id === selectedWatchlistGroup.id
        ? (() => {
            const instruments = transactionWatchlistInstrumentsInOrder(group, nextInstrumentOrder);
            return {
              ...group,
              symbols: normalizeTransactionWatchlistSymbolsSetting(instruments),
              instruments,
            };
          })()
        : group
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
    if (
      !watchlistCreateOpen &&
      !watchlistDeleteTarget &&
      !watchlistSymbolAddOpen &&
      !simulatorSymbolSearchOpen &&
      !simulatorBuyOpen &&
      !simulatorSellOpen &&
      !simulatorExchangeOpen
    ) {
      return undefined;
    }
    function handleDialogKeyDown(event) {
      if (event.key !== "Escape") return;
      if (watchlistCreateOpen) handleCancelWatchlistCreate();
      if (watchlistDeleteTarget) handleCancelDeleteWatchlistGroup();
      if (watchlistSymbolAddOpen) handleCancelWatchlistSymbolAdd();
      if (simulatorSymbolSearchOpen) handleCancelSimulatorSymbolSearch();
      if (simulatorBuyOpen) handleCancelSimulatorBuy();
      if (simulatorSellOpen) handleCancelSimulatorSell();
      if (simulatorExchangeOpen) handleCancelSimulatorExchange();
    }
    document.addEventListener("keydown", handleDialogKeyDown);
    return () => document.removeEventListener("keydown", handleDialogKeyDown);
  }, [
    handleCancelDeleteWatchlistGroup,
    handleCancelSimulatorBuy,
    handleCancelSimulatorSymbolSearch,
    handleCancelSimulatorSell,
    handleCancelSimulatorExchange,
    handleCancelWatchlistCreate,
    handleCancelWatchlistSymbolAdd,
    simulatorExchangeOpen,
    simulatorBuyOpen,
    simulatorSellOpen,
    simulatorSymbolSearchOpen,
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
        if (liveFetchGate.ready && symbol && /^[A-Z0-9.-]+$/.test(symbol)) {
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
  }, [liveFetchGate.ready, watchlistSymbolAddOpen, watchlistSymbolDraft]);

  useEffect(() => {
    if (!simulatorBuyOpen) return undefined;
    const query = String(simulatorBuySymbolDraft || "").trim();
    const symbol = cleanTransactionWatchlistSymbol(simulatorBuySymbolDraft);
    if (!query) return undefined;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const optionGroups = [await fetchTransactionWatchlistCatalogOptions(query, controller.signal)];
        if (liveFetchGate.ready && symbol && /^[A-Z0-9.-]+$/.test(symbol)) {
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
          setSimulatorBuyRemoteSymbolOptions((current) => (
            mergeTransactionWatchlistSymbolOptions(current, options)
          ));
        }
      } catch (fetchError) {
        if (fetchError.name !== "AbortError") {
          // Lookup failures leave the user with any existing local suggestions.
        }
      }
    }, 280);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [liveFetchGate.ready, simulatorBuyOpen, simulatorBuySymbolDraft]);

  useEffect(() => {
    if (!simulatorSymbolSearchOpen) return undefined;
    const query = String(simulatorSymbolSearchDraft || "").trim();
    const symbol = cleanTransactionWatchlistSymbol(simulatorSymbolSearchDraft);
    if (!query) return undefined;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const optionGroups = [await fetchTransactionWatchlistCatalogOptions(query, controller.signal)];
        if (liveFetchGate.ready && symbol && /^[A-Z0-9.-]+$/.test(symbol)) {
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
          setSimulatorSymbolSearchOptions((current) => (
            mergeTransactionWatchlistSymbolOptions(current, options)
          ));
        }
      } catch (fetchError) {
        if (fetchError.name !== "AbortError") {
          // Search keeps any locally available holdings and watchlist suggestions.
        }
      }
    }, 280);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [liveFetchGate.ready, simulatorSymbolSearchDraft, simulatorSymbolSearchOpen]);

  useEffect(() => {
    const selectedSymbol = cleanTransactionWatchlistSymbol(simulatorBuySelectedSymbol?.symbol);
    if (!simulatorBuyOpen || !selectedSymbol) return;
    if (simulatorBuySelectedSymbol?.koreanMarketDetail) return;
    const enrichedOption = simulatorBuySymbolOptions.find((option) => (
      cleanTransactionWatchlistSymbol(option.symbol) === selectedSymbol && option.koreanMarketDetail
    ));
    if (!enrichedOption) return;
    setSimulatorBuySelectedSymbol((current) => {
      if (cleanTransactionWatchlistSymbol(current?.symbol) !== selectedSymbol || current?.koreanMarketDetail) return current;
      return { ...current, ...enrichedOption, symbol: selectedSymbol };
    });
  }, [simulatorBuyOpen, simulatorBuySelectedSymbol?.koreanMarketDetail, simulatorBuySelectedSymbol?.symbol, simulatorBuySymbolOptions]);

  useEffect(() => {
    const selectedSymbol = cleanTransactionWatchlistSymbol(simulatorBuySelectedSymbol?.symbol);
    if (!simulatorBuyOpen || !selectedSymbol) {
      setSimulatorBuyMarketCalendar(null);
      setSimulatorBuyMarketCalendarLoading(false);
      setSimulatorBuyMarketCalendarError("");
      return undefined;
    }
    if (itemIsCrypto(simulatorBuySelectedSymbol)) {
      setSimulatorBuyMarketCalendar(null);
      setSimulatorBuyMarketCalendarLoading(false);
      setSimulatorBuyMarketCalendarError("");
      return undefined;
    }
    const settlementUnit = transactionSimulatorSettlementUnit(simulatorBuySelectedSymbol);
    const marketCode = transactionSimulatorMarketCalendarCode(settlementUnit);
    const calendarDate = transactionSimulatorCalendarDate(settlementUnit);
    const controller = new AbortController();

    async function loadSimulatorBuyMarketCalendar() {
      setSimulatorBuyMarketCalendarLoading(true);
      setSimulatorBuyMarketCalendarError("");
      try {
        const response = await fetch(
          `/api/tossinvest/market-calendar/${marketCode}?date=${encodeURIComponent(calendarDate)}`,
          {
            cache: "no-store",
            signal: controller.signal,
          }
        );
        const body = await response.json().catch(() => ({}));
        if (!response.ok || body?.ok === false) {
          throw new Error(body?.error || `HTTP ${response.status}`);
        }
        if (!controller.signal.aborted) {
          setSimulatorBuyMarketCalendar(body);
          setSimulatorBuyMarketCalendarError("");
        }
      } catch (fetchError) {
        if (!controller.signal.aborted && fetchError.name !== "AbortError") {
          setSimulatorBuyMarketCalendar(null);
          setSimulatorBuyMarketCalendarError(fetchError.message || "장 운영 정보를 확인하지 못했습니다.");
        }
      } finally {
        if (!controller.signal.aborted) {
          setSimulatorBuyMarketCalendarLoading(false);
        }
      }
    }

    void loadSimulatorBuyMarketCalendar();
    return () => controller.abort();
  }, [
    simulatorBuyOpen,
    simulatorBuySelectedSymbol?.market,
    simulatorBuySelectedSymbol?.symbol,
  ]);

  useEffect(() => {
    const selectedSymbol = cleanTransactionWatchlistSymbol(simulatorSellPosition?.symbol);
    if (!simulatorSellOpen || !selectedSymbol) {
      setSimulatorSellMarketCalendar(null);
      setSimulatorSellMarketCalendarLoading(false);
      setSimulatorSellMarketCalendarError("");
      return undefined;
    }
    if (itemIsCrypto(simulatorSellPosition)) {
      setSimulatorSellMarketCalendar(null);
      setSimulatorSellMarketCalendarLoading(false);
      setSimulatorSellMarketCalendarError("");
      return undefined;
    }
    const settlementUnit = normalizeMoneyUnit(simulatorSellPosition?.currency || simulatorSellPosition?.displayCurrency || "KRW");
    const marketCode = transactionSimulatorMarketCalendarCode(settlementUnit);
    const calendarDate = transactionSimulatorCalendarDate(settlementUnit);
    const controller = new AbortController();

    async function loadSimulatorSellMarketCalendar() {
      setSimulatorSellMarketCalendarLoading(true);
      setSimulatorSellMarketCalendarError("");
      try {
        const response = await fetch(
          `/api/tossinvest/market-calendar/${marketCode}?date=${encodeURIComponent(calendarDate)}`,
          {
            cache: "no-store",
            signal: controller.signal,
          }
        );
        const body = await response.json().catch(() => ({}));
        if (!response.ok || body?.ok === false) {
          throw new Error(body?.error || `HTTP ${response.status}`);
        }
        if (!controller.signal.aborted) {
          setSimulatorSellMarketCalendar(body);
          setSimulatorSellMarketCalendarError("");
        }
      } catch (fetchError) {
        if (!controller.signal.aborted && fetchError.name !== "AbortError") {
          setSimulatorSellMarketCalendar(null);
          setSimulatorSellMarketCalendarError(fetchError.message || "장 운영 정보를 확인하지 못했습니다.");
        }
      } finally {
        if (!controller.signal.aborted) {
          setSimulatorSellMarketCalendarLoading(false);
        }
      }
    }

    void loadSimulatorSellMarketCalendar();
    return () => controller.abort();
  }, [
    simulatorSellOpen,
    simulatorSellPosition?.currency,
    simulatorSellPosition?.displayCurrency,
    simulatorSellPosition?.symbol,
  ]);

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
        (liveFetchGate.ready || selectedWatchlistUsesBinance) &&
        (activeSection === "investment" || (activeSection === "watchlist" && selectedWatchlistSymbolKey))
      ) {
        wasPageHiddenRef.current = false;
        setRefreshKey((current) => current + 1);
      }
    }
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [activeSection, liveFetchGate.ready, selectedWatchlistSymbolKey, selectedWatchlistUsesBinance]);

  useEffect(() => {
    const needsUsdKrwRate = activeSection === "investment" || (
      activeSection === "watchlist" && Boolean(selectedWatchlistChartSymbol)
    );
    if (!needsUsdKrwRate || !liveFetchGate.ready) {
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
  }, [activeSection, liveFetchGate.ready, selectedWatchlistChartSymbol]);

  useEffect(() => {
    if (activeSection !== "investment") {
      forceNextRefreshRef.current = false;
      liveRefreshBusyRef.current = false;
      setLiveRefreshBusy(false);
      setLoading(false);
      return undefined;
    }
    if (selectedSimulator) {
      forceNextRefreshRef.current = false;
      liveRefreshBusyRef.current = false;
      setLiveRefreshBusy(false);
      setLoading(false);
      setError("");
      setLiveErrorCode("");
      setLiveRetryAfterMs(0);
      liveRetryUntilRef.current = 0;
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
        liveRetryUntilRef.current = 0;
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
          responseError.retryAfterMs =
            retryAfterMsFromRateLimit(body?.rateLimit) ||
            (response.status === 429 ? transactionTossRateLimitFallbackMs : 0);
          throw responseError;
        }
        setPayload(body);
        setError("");
        setLiveErrorCode("");
        setLiveRetryAfterMs(0);
        liveRetryUntilRef.current = 0;
      } catch (fetchError) {
        if (fetchError.name !== "AbortError") {
          const retryAfterMs = Math.max(0, Number(fetchError.retryAfterMs || 0));
          setError(fetchError.message || "거래현황을 불러오지 못했습니다.");
          setLiveErrorCode(fetchError.errorCode || "");
          setLiveRetryAfterMs(retryAfterMs);
          liveRetryUntilRef.current = retryAfterMs ? Date.now() + retryAfterMs : 0;
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
  }, [
    activeSection,
    currency,
    liveFetchGate.message,
    liveFetchGate.ready,
    liveFetchGate.waiting,
    refreshKey,
    selectedAccountSeq,
    selectedSimulator,
  ]);

  useEffect(() => {
    if (activeSection !== "investment") return undefined;
    if (selectedSimulator) return undefined;
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
    selectedSimulator,
  ]);

  useEffect(() => {
    if (activeSection !== "investment") return undefined;
    if (!selectedSimulatorId) return undefined;
    if (!pageVisible) return undefined;
    const timer = window.setInterval(() => {
      setRefreshKey((current) => current + 1);
    }, transactionWatchlistPriceRefreshMs);
    return () => window.clearInterval(timer);
  }, [
    activeSection,
    pageVisible,
    selectedSimulatorId,
  ]);

  useEffect(() => {
    if (activeSection !== "watchlist") return undefined;
    if (!liveFetchGate.ready && !selectedWatchlistUsesBinance) return undefined;
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
    selectedWatchlistUsesBinance,
    watchlistPricePayload?.fetchedAt,
  ]);

  const handleReload = useCallback(() => {
    if (liveFetchGate.ready && liveRefreshBusyRef.current) return;
    if (onReload) onReload();
    const retryRemainingMs = Math.max(0, liveRetryUntilRef.current - Date.now());
    if (activeSection === "investment" && retryRemainingMs > 0) {
      setLiveRetryAfterMs(retryRemainingMs);
      return;
    }
    if (activeSection === "watchlist") {
      setWatchlistPriceError("");
      setWatchlistPriceErrorCode("");
    } else {
      setError("");
      setLiveErrorCode("");
    }
    setLiveRetryAfterMs(0);
    liveRetryUntilRef.current = 0;
    forceNextRefreshRef.current = true;
    setRefreshKey((current) => current + 1);
  }, [activeSection, liveFetchGate.ready, onReload]);

  const handleCancelSimulatorRename = useCallback(() => {
    if (simulatorRenameBusy) return;
    setSimulatorRenameTarget(null);
    setSimulatorRenameDraft("");
    setSimulatorRenameError("");
  }, [simulatorRenameBusy]);

  const handleSimulatorRenameStart = useCallback((simulator, placement = "main") => {
    if (simulatorRenameBusy) return;
    const simulatorId = cleanTransactionSimulatorId(simulator?.id);
    if (!simulatorId) return;
    setAccountOpen(false);
    const normalizedPlacement = placement === "sideTotal" ? "sideTotal" : "main";
    setSimulatorRenameTarget({
      simulatorId,
      placement: normalizedPlacement,
    });
    setSimulatorRenameDraft(cleanTransactionSimulatorName(simulator?.name) || simulatorDisplayLabel(simulator, 0));
    setSimulatorRenameError("");
  }, [simulatorRenameBusy]);

  const handleSimulatorRenameDraftChange = useCallback((nextValue) => {
    setSimulatorRenameDraft(nextValue);
    if (simulatorRenameError) setSimulatorRenameError("");
  }, [simulatorRenameError]);

  const handleSubmitSimulatorRename = useCallback(async () => {
    if (simulatorRenameBusy) return;
    const simulatorId = cleanTransactionSimulatorId(simulatorRenameTarget?.simulatorId);
    if (!simulatorId) return;
    const name = cleanTransactionSimulatorName(simulatorRenameDraft);
    if (!name) {
      setSimulatorRenameError("계좌 이름을 입력하세요.");
      return;
    }
    const targetIndex = normalizedSimulatorAccounts.findIndex((simulator) => simulator.id === simulatorId);
    const currentName = targetIndex >= 0
      ? simulatorDisplayLabel(normalizedSimulatorAccounts[targetIndex], targetIndex)
      : "";
    if (name === currentName) {
      setSimulatorRenameTarget(null);
      setSimulatorRenameDraft("");
      setSimulatorRenameError("");
      return;
    }
    setSimulatorRenameBusy(true);
    setSimulatorRenameError("");
    try {
      const body = await patchInvestSimulatorAccount({ simulatorId, name });
      setSimulatorAccounts(simulatorAccountsFromApiPayload(body));
      setSimulatorStoreReady(true);
      setSimulatorRenameTarget(null);
      setSimulatorRenameDraft("");
      setSimulatorRenameError("");
    } catch (fetchError) {
      setSimulatorRenameError(fetchError.message || "시뮬레이터 이름을 저장하지 못했습니다.");
    } finally {
      setSimulatorRenameBusy(false);
    }
  }, [
    normalizedSimulatorAccounts,
    simulatorRenameBusy,
    simulatorRenameDraft,
    simulatorRenameTarget?.simulatorId,
  ]);

  const handleAccountSelect = useCallback((accountSeq) => {
    const nextAccountSeq = cleanAccountSeq(accountSeq);
    setAccountOpen(false);
    if (!nextAccountSeq || (!selectedSimulatorId && nextAccountSeq === selectedAccountSeq)) return;
    handleCancelSimulatorBuy();
    handleCancelSimulatorSell();
    handleCancelSimulatorExchange();
    handleCancelSimulatorSymbolSearch();
    handleCancelSimulatorRename();
    setSelectedSimulatorId("");
    setSelectedInvestmentOrderKey("");
    setSelectedInvestmentSearchItem(null);
    forceNextRefreshRef.current = true;
    setSelectedAccountSeq(nextAccountSeq);
  }, [handleCancelSimulatorBuy, handleCancelSimulatorExchange, handleCancelSimulatorRename, handleCancelSimulatorSell, handleCancelSimulatorSymbolSearch, selectedAccountSeq, selectedSimulatorId]);

  const handleSimulatorSelect = useCallback((simulatorId) => {
    const nextSimulatorId = cleanTransactionSimulatorId(simulatorId);
    if (!nextSimulatorId) return;
    setAccountOpen(false);
    handleCancelSimulatorBuy();
    handleCancelSimulatorSell();
    handleCancelSimulatorExchange();
    handleCancelSimulatorSymbolSearch();
    handleCancelSimulatorRename();
    setSelectedSimulatorId(nextSimulatorId);
    setSelectedInvestmentOrderKey("");
    setSelectedInvestmentSearchItem(null);
    setManualOrderEditing(false);
    setManualOrderDraft([]);
    forceNextRefreshRef.current = false;
  }, [handleCancelSimulatorBuy, handleCancelSimulatorExchange, handleCancelSimulatorRename, handleCancelSimulatorSell, handleCancelSimulatorSymbolSearch]);

  const handleCreateSimulator = useCallback(async () => {
    if (simulatorLoading) return;
    setSimulatorLoading(true);
    setSimulatorError("");
    try {
      const body = await postInvestSimulatorAccount({});
      const nextAccounts = simulatorAccountsFromApiPayload(body);
      const nextSimulatorId =
        cleanTransactionSimulatorId(body?.account?.id) ||
        cleanTransactionSimulatorId(nextAccounts[nextAccounts.length - 1]?.id);
      setSimulatorAccounts(nextAccounts);
      setSimulatorStoreReady(true);
      setAccountOpen(false);
      setActiveSection("investment");
      handleCancelSimulatorBuy();
      handleCancelSimulatorSell();
      handleCancelSimulatorExchange();
      handleCancelSimulatorSymbolSearch();
      handleCancelSimulatorRename();
      if (nextSimulatorId) setSelectedSimulatorId(nextSimulatorId);
      setSelectedInvestmentOrderKey("");
      setSelectedInvestmentSearchItem(null);
      setManualOrderEditing(false);
      setManualOrderDraft([]);
      forceNextRefreshRef.current = false;
    } catch (fetchError) {
      setSimulatorError(fetchError.message || "투자 시뮬레이터를 생성하지 못했습니다.");
    } finally {
      setSimulatorLoading(false);
    }
  }, [handleCancelSimulatorBuy, handleCancelSimulatorExchange, handleCancelSimulatorRename, handleCancelSimulatorSell, handleCancelSimulatorSymbolSearch, simulatorLoading]);

  const handleRequestDeleteSimulator = useCallback((simulatorId) => {
    const targetId = cleanTransactionSimulatorId(simulatorId);
    if (!targetId || simulatorDeletingId) return;
    const targetIndex = normalizedSimulatorAccounts.findIndex((simulator) => simulator.id === targetId);
    const targetSimulator = normalizedSimulatorAccounts[targetIndex] || null;
    if (!targetSimulator) return;
    handleCancelSimulatorRename();
    setSimulatorDeleteTarget(targetSimulator);
  }, [handleCancelSimulatorRename, normalizedSimulatorAccounts, simulatorDeletingId]);

  const handleCancelDeleteSimulator = useCallback(() => {
    if (simulatorDeletingId) return;
    setSimulatorDeleteTarget(null);
  }, [simulatorDeletingId]);

  const handleConfirmDeleteSimulator = useCallback(async () => {
    const targetId = cleanTransactionSimulatorId(simulatorDeleteTarget?.id);
    if (!targetId || simulatorDeletingId) return;
    const targetIndex = normalizedSimulatorAccounts.findIndex((simulator) => simulator.id === targetId);
    setSimulatorDeletingId(targetId);
    setSimulatorError("");
    try {
      const body = await deleteInvestSimulatorAccount(targetId);
      const nextAccounts = simulatorAccountsFromApiPayload(body);
      const nextIndex = Math.max(0, Math.min(targetIndex, nextAccounts.length - 1));
      const nextSimulatorId = cleanTransactionSimulatorId(nextAccounts[nextIndex]?.id);
      setSimulatorAccounts(nextAccounts);
      setSimulatorStoreReady(true);
      setAccountOpen(false);
      if (selectedSimulatorId === targetId) {
        handleCancelSimulatorBuy();
        handleCancelSimulatorSell();
        handleCancelSimulatorExchange();
        handleCancelSimulatorSymbolSearch();
        handleCancelSimulatorRename();
        setSelectedSimulatorId(nextSimulatorId);
        setSelectedInvestmentOrderKey("");
        setSelectedInvestmentSearchItem(null);
        if (!nextSimulatorId) {
          forceNextRefreshRef.current = true;
          setRefreshKey((current) => current + 1);
        }
      }
      setManualOrderEditing(false);
      setManualOrderDraft([]);
      setSimulatorDeleteTarget(null);
    } catch (fetchError) {
      setSimulatorError(fetchError.message || "투자 시뮬레이터를 삭제하지 못했습니다.");
    } finally {
      setSimulatorDeletingId("");
    }
  }, [
    handleCancelSimulatorBuy,
    handleCancelSimulatorExchange,
    handleCancelSimulatorRename,
    handleCancelSimulatorSell,
    handleCancelSimulatorSymbolSearch,
    normalizedSimulatorAccounts,
    selectedSimulatorId,
    simulatorDeleteTarget?.id,
    simulatorDeletingId,
  ]);

  useEffect(() => {
    if (!simulatorDeleteTarget) return undefined;
    function handleSimulatorDeleteKeyDown(event) {
      if (event.key === "Escape") handleCancelDeleteSimulator();
    }
    document.addEventListener("keydown", handleSimulatorDeleteKeyDown);
    return () => document.removeEventListener("keydown", handleSimulatorDeleteKeyDown);
  }, [handleCancelDeleteSimulator, simulatorDeleteTarget]);

  useEffect(() => {
    const targetId = cleanTransactionSimulatorId(simulatorRenameTarget?.simulatorId);
    if (!targetId || simulatorRenameBusy) return;
    if (!normalizedSimulatorAccounts.some((simulator) => simulator.id === targetId)) {
      setSimulatorRenameTarget(null);
      setSimulatorRenameDraft("");
      setSimulatorRenameError("");
    }
  }, [normalizedSimulatorAccounts, simulatorRenameBusy, simulatorRenameTarget?.simulatorId]);

  useEffect(() => {
    if (!activeInvestmentPayload?.ok) return;
    const fallbackUnit = normalizeMoneyUnit(activeInvestmentPayload.unit || currency);
    const activeItems = Array.isArray(activeInvestmentPayload.items) ? activeInvestmentPayload.items : [];
    const requestedSidebarUnit = effectiveMoneyUnitFromSetting(
      currencySettings.sidebarDisplayCurrency,
      fallbackUnit,
    );
    const requestedMainUnit = effectiveMoneyUnitFromSetting(
      currencySettings.mainDisplayCurrency,
      fallbackUnit,
    );
    setSidebarUnit(transactionAvailableDisplayUnit(requestedSidebarUnit, fallbackUnit, activeItems, usdKrwRate));
    setMainUnit(transactionAvailableDisplayUnit(requestedMainUnit, fallbackUnit, activeItems, usdKrwRate));
  }, [
    activeInvestmentPayload?.items,
    activeInvestmentPayload?.ok,
    activeInvestmentPayload?.unit,
    currency,
    currencySettings.mainDisplayCurrency,
    currencySettings.sidebarDisplayCurrency,
    usdKrwRate,
  ]);

  const activeSidebarManualOrder = manualOrderEditing ? manualOrderDraft : currencySettings.sidebarManualOrder;
  const sortedItems = useMemo(
    () => sortItems(normalizedItems, sortId, activeSidebarManualOrder),
    [activeSidebarManualOrder, normalizedItems, sortId]
  );
  const selectedInvestmentItem = useMemo(() => {
    const selectedKey = cleanTransactionItemSelectionKey(selectedInvestmentOrderKey);
    if (!selectedKey) return null;
    const holdingItem = sortedItems.find((item) => transactionItemSelectionKey(item) === selectedKey);
    if (holdingItem) return holdingItem;
    if (transactionItemSelectionKey(selectedInvestmentSearchItem) !== selectedKey) return null;
    return transactionSimulatorItemsWithPrices([selectedInvestmentSearchItem], simulatorPriceMap)[0] || null;
  }, [selectedInvestmentOrderKey, selectedInvestmentSearchItem, simulatorPriceMap, sortedItems]);
  const selectedInvestmentIsHeld = useMemo(() => {
    const selectedKey = cleanTransactionItemSelectionKey(selectedInvestmentOrderKey);
    return Boolean(selectedKey && sortedItems.some((item) => transactionItemSelectionKey(item) === selectedKey));
  }, [selectedInvestmentOrderKey, sortedItems]);

  useEffect(() => {
    if (!selectedInvestmentOrderKey) return;
    if (selectedInvestmentItem) return;
    setSelectedInvestmentOrderKey("");
    setSelectedInvestmentSearchItem(null);
  }, [selectedInvestmentItem, selectedInvestmentOrderKey]);

  const handleSubmitSimulatorSymbolSearch = useCallback(() => {
    const symbol = cleanTransactionWatchlistSymbol(simulatorSymbolSearchSelection?.symbol);
    const draftSymbol = cleanTransactionWatchlistSymbol(simulatorSymbolSearchDraft);
    if (!symbol || symbol !== draftSymbol) {
      setSimulatorSymbolSearchError("차트로 볼 종목을 검색 결과에서 선택하세요.");
      return;
    }
    const selectedInstrument = normalizeTransactionInstrument(simulatorSymbolSearchSelection);
    const selectedKey = transactionItemSelectionKey(selectedInstrument);
    const holdingItem = sortedItems.find((item) => transactionItemSelectionKey(item) === selectedKey) || null;
    const option = simulatorSearchSymbolOptions.find((item) => (
      transactionInstrumentKey(item) === selectedKey
    )) || simulatorSymbolSearchSelection;
    const itemUnit = transactionSimulatorSettlementUnit(option);
    const searchItem = holdingItem || normalizeItem({
      ...normalizeTransactionInstrument(option),
      symbol,
      label: String(option?.name || option?.englishName || symbol).trim(),
      englishName: String(option?.englishName || "").trim(),
      market: String(option?.market || "").trim(),
      currency: itemUnit,
      displayCurrency: itemUnit,
      source: String(option?.source || "symbol-search").trim(),
    }, itemUnit);
    setSelectedInvestmentSearchItem(holdingItem ? null : searchItem);
    setSelectedInvestmentOrderKey(transactionItemSelectionKey(searchItem));
    handleCancelSimulatorSymbolSearch();
  }, [
    handleCancelSimulatorSymbolSearch,
    simulatorSearchSymbolOptions,
    simulatorSymbolSearchDraft,
    simulatorSymbolSearchSelection,
    sortedItems,
  ]);

  const handleSelectInvestmentPosition = useCallback((orderKey) => {
    const nextOrderKey = cleanTransactionItemSelectionKey(orderKey);
    if (!nextOrderKey) return;
    setSelectedInvestmentSearchItem(null);
    setSelectedInvestmentOrderKey(nextOrderKey);
  }, []);

  const handleCloseInvestmentPosition = useCallback(() => {
    setSelectedInvestmentOrderKey("");
    setSelectedInvestmentSearchItem(null);
  }, []);

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
      ? selectedWatchlistUsesToss && Boolean(watchlistPricePayload?.providers?.toss?.ok)
      : selectedSimulator
        ? true
        : Boolean(payload?.ok && payload?.sourceMode === "live");
    const sectionError = activeSection === "watchlist" ? watchlistPriceError : error;
    if (activeSection === "investment" && selectedSimulator) return tossStatus;
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
    selectedSimulator,
    selectedWatchlistUsesToss,
    tossStatus,
    watchlistPriceError,
    watchlistPricePayload?.providers?.toss?.ok,
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
  const selectedSimulatorContextIndex = selectedSimulator
    ? normalizedSimulatorAccounts.findIndex((simulator) => simulator.id === selectedSimulator.id)
    : -1;
  const transactionViewMode = activeSection === "watchlist"
    ? selectedWatchlistChartItem ? "watchlist-chart-detail" : "watchlist-overview"
    : selectedInvestmentItem
      ? selectedSimulator ? "simulator-chart-detail" : "live-investment-chart-detail"
      : selectedSimulator ? "simulator-investment-overview" : "live-investment-overview";
  transactionContextMetaRef.current = {
    activeSection,
    viewMode: transactionViewMode,
    account: activeSection === "watchlist"
      ? {
          type: "watchlist",
          id: selectedWatchlistDisplayGroup?.id || "",
          label: selectedWatchlistDisplayGroup?.name || "관심 목록",
        }
      : selectedSimulator
      ? {
          type: "simulator",
          id: selectedSimulator.id,
          label: simulatorDisplayLabel(selectedSimulator, Math.max(0, selectedSimulatorContextIndex)),
        }
      : {
          type: "live",
          id: selectedAccountSeq || payload?.accountSeq || "",
          label: "내 투자",
        },
    selectedWatchlistGroup: selectedWatchlistDisplayGroup
      ? {
          id: selectedWatchlistDisplayGroup.id,
          name: selectedWatchlistDisplayGroup.name,
          instrumentCount: normalizeTransactionWatchlistInstrumentsSetting(
            selectedWatchlistDisplayGroup.instruments,
            selectedWatchlistDisplayGroup.symbols
          ).length,
        }
      : null,
    displaySettings: {
      sidebarUnit,
      mainUnit,
      sidebarValueMode: valueMode,
      sortId,
      mainTableColumns: visibleTransactionMainTableColumns(currencySettings.mainTableColumns).map((column) => column.id),
      chartMode: currencySettings.investmentChartMode,
      chartIntervalMode: currencySettings.investmentChartIntervalMode,
      chartVolumeVisible: currencySettings.investmentChartVolumeVisible,
    },
  };
  return (
    <section className="workspace-canvas transaction-status-canvas" aria-label="거래현황" ref={rootRef}>
      <div className="transaction-status-shell">
        <SectionRail activeSection={activeSection} onSelectSection={setActiveSection} />
        {activeSection === "investment" ? (
          <>
            <InvestmentSidebar
              items={sortedItems}
              payload={activeInvestmentPayload}
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
              simulators={normalizedSimulatorAccounts}
              accountOpen={accountOpen}
              selectedAccountSeq={selectedSimulator ? "" : selectedAccountSeq || payload?.accountSeq || ""}
              selectedSimulatorId={selectedSimulator?.id || ""}
              simulatorMarketCalendars={simulatorMarketCalendars}
              simulatorLoading={simulatorLoading}
              simulatorError={simulatorError}
              simulatorRenameTarget={simulatorRenameTarget}
              simulatorRenameDraft={simulatorRenameDraft}
              simulatorRenameBusy={simulatorRenameBusy}
              simulatorRenameError={simulatorRenameError}
              onAccountOpenChange={setAccountOpen}
              onAccountSelect={handleAccountSelect}
              onSimulatorSelect={handleSimulatorSelect}
              onCreateSimulator={handleCreateSimulator}
              onOpenExchange={handleOpenSimulatorExchange}
              onPositionBuy={handleOpenSidebarSimulatorBuy}
              onPositionSell={handleOpenSidebarSimulatorSell}
              onSimulatorRenameStart={handleSimulatorRenameStart}
              onSimulatorRenameDraftChange={handleSimulatorRenameDraftChange}
              onSimulatorRenameSubmit={handleSubmitSimulatorRename}
              onSimulatorRenameCancel={handleCancelSimulatorRename}
              valueMode={valueMode}
              onValueModeChange={handleValueModeChange}
              selectedPositionKey={selectedInvestmentOrderKey}
              onSelectPosition={handleSelectInvestmentPosition}
              onResetPositionSelection={handleCloseInvestmentPosition}
            />
            {selectedInvestmentItem ? (
              <TransactionInvestmentAssetDetail
                item={selectedInvestmentItem}
                payload={activeInvestmentPayload}
                unit={mainUnit}
                usdKrwRate={usdKrwRate}
                onUnitChange={handleMainUnitChange}
                onClose={handleCloseInvestmentPosition}
                statusBannerProps={statusBannerProps}
                binanceStatus={binanceProviderStatus}
                binanceError={binanceProviderError}
                chartModeSetting={currencySettings.investmentChartMode}
                intervalModeSetting={currencySettings.investmentChartIntervalMode}
                volumeVisibleSetting={currencySettings.investmentChartVolumeVisible}
                onChartModeChange={handleInvestmentChartModeChange}
                onIntervalModeChange={handleInvestmentChartIntervalChange}
                onVolumeVisibleChange={handleInvestmentChartVolumeVisibleChange}
                onBuy={selectedSimulator ? handleOpenDetailSimulatorBuy : undefined}
                onSell={selectedSimulator && selectedInvestmentIsHeld ? handleOpenDetailSimulatorSell : undefined}
                onDisplayData={handleContextSurfaceData}
              />
            ) : selectedSimulator ? (
              <SimulatorInvestmentMain
                simulator={selectedSimulator}
                items={sortedItems}
                payload={activeInvestmentPayload}
                unit={mainUnit}
                usdKrwRate={usdKrwRate}
                onUnitChange={handleMainUnitChange}
                selectedTableColumnIds={currencySettings.mainTableColumns}
                onTableColumnsChange={handleMainTableColumnsChange}
                statusBannerProps={statusBannerProps}
                binanceStatus={binanceProviderStatus}
                binanceError={binanceProviderError}
                deleteBusy={simulatorDeletingId === selectedSimulator.id}
                simulatorRenameTarget={simulatorRenameTarget}
                simulatorRenameDraft={simulatorRenameDraft}
                simulatorRenameBusy={simulatorRenameBusy}
                simulatorRenameError={simulatorRenameError}
                onDeleteSimulator={handleRequestDeleteSimulator}
                onOpenSymbolSearch={handleOpenSimulatorSymbolSearch}
                onSimulatorRenameStart={handleSimulatorRenameStart}
                onSimulatorRenameDraftChange={handleSimulatorRenameDraftChange}
                onSimulatorRenameSubmit={handleSubmitSimulatorRename}
                onSimulatorRenameCancel={handleCancelSimulatorRename}
                onSelectItem={handleSelectInvestmentPosition}
                onDisplayData={handleContextSurfaceData}
                sidebarValueMode={valueMode}
              />
            ) : (
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
                onSelectItem={handleSelectInvestmentPosition}
                onDisplayData={handleContextSurfaceData}
                sidebarValueMode={valueMode}
              />
            )}
          </>
        ) : (
          <WatchlistPlaceholder
            statusBannerProps={statusBannerProps}
            binanceStatus={binanceProviderStatus}
            binanceError={binanceProviderError}
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
            selectedChartItem={selectedWatchlistChartItem}
            chartUnit={mainUnit}
            usdKrwRate={usdKrwRate}
            onChartUnitChange={handleMainUnitChange}
            chartModeSetting={currencySettings.investmentChartMode}
            chartIntervalModeSetting={currencySettings.investmentChartIntervalMode}
            chartVolumeVisibleSetting={currencySettings.investmentChartVolumeVisible}
            onChartModeChange={handleInvestmentChartModeChange}
            onChartIntervalModeChange={handleInvestmentChartIntervalChange}
            onChartVolumeVisibleChange={handleInvestmentChartVolumeVisibleChange}
            onSelectSymbol={handleSelectWatchlistSymbol}
            onCloseChart={handleCloseWatchlistChart}
            onOpenCreateGroup={handleOpenWatchlistCreate}
            onRequestDeleteGroup={handleRequestDeleteWatchlistGroup}
            onOrderEditStart={handleWatchlistOrderEditStart}
            onOrderChange={handleWatchlistOrderChange}
            onOrderSave={handleWatchlistOrderSave}
            onDisplayData={handleContextSurfaceData}
          />
        )}
      </div>
      <TransactionSimulatorOrderNotifications notifications={simulatorOrderNotifications} />
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
          selectedSymbol={watchlistSelectedSymbol}
          error={watchlistSymbolError}
          symbolOptions={watchlistSymbolOptions}
          onDraftSymbolChange={handleWatchlistSymbolDraftChange}
          onSelectSymbol={handleWatchlistSymbolSelect}
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
      {simulatorSymbolSearchOpen && selectedSimulator ? (
        <TransactionSymbolSearchDialog
          inputId="transaction-simulator-symbol-search"
          titleId="transaction-simulator-symbol-search-title"
          draftSymbol={simulatorSymbolSearchDraft}
          selectedSymbol={simulatorSymbolSearchSelection}
          error={simulatorSymbolSearchError}
          symbolOptions={simulatorSearchSymbolOptions}
          onDraftSymbolChange={handleSimulatorSymbolSearchDraftChange}
          onSelectSymbol={handleSimulatorSymbolSearchSelect}
          onCancel={handleCancelSimulatorSymbolSearch}
          onSubmit={handleSubmitSimulatorSymbolSearch}
        />
      ) : null}
      {simulatorDeleteTarget ? (
        <SimulatorDeleteDialog
          simulator={simulatorDeleteTarget}
          busy={simulatorDeletingId === simulatorDeleteTarget.id}
          onCancel={handleCancelDeleteSimulator}
          onConfirm={handleConfirmDeleteSimulator}
        />
      ) : null}
      {simulatorExchangeOpen && selectedSimulator ? (
        <SimulatorExchangeDialog
          simulator={selectedSimulator}
          usdKrwRate={usdKrwRate}
          modeId={simulatorExchangeMode}
          amountDraft={simulatorExchangeAmountDraft}
          error={simulatorExchangeError}
          busy={simulatorExchangeBusy}
          onModeChange={handleSimulatorExchangeModeChange}
          onAmountChange={handleSimulatorExchangeAmountChange}
          onSubmitExchange={handleSubmitSimulatorExchange}
          onCancel={handleCancelSimulatorExchange}
        />
      ) : null}
      {simulatorBuyOpen && selectedSimulator ? (
        <SimulatorBuyDialog
          simulator={selectedSimulator}
          unit={simulatorBuyUnit}
          usdKrwRate={usdKrwRate}
          draftSymbol={simulatorBuySymbolDraft}
          selectedSymbol={simulatorBuySelectedSymbol}
          symbolOptions={simulatorBuySymbolOptions}
          amountDraft={simulatorBuyAmountDraft}
          error={simulatorBuyError}
          busy={simulatorBuyBusy}
          marketCalendar={simulatorBuyMarketCalendar}
          marketCalendarLoading={simulatorBuyMarketCalendarLoading}
          marketCalendarError={simulatorBuyMarketCalendarError}
          binanceStatus={binanceProviderStatus}
          binanceError={binanceProviderError}
          onDraftSymbolChange={handleSimulatorBuySymbolDraftChange}
          onSelectSymbol={handleSimulatorBuySelectSymbol}
          onAmountChange={handleSimulatorBuyAmountChange}
          onPresetAmount={handleSimulatorBuyPresetAmount}
          onSubmitOrder={handleSubmitSimulatorBuy}
          onCancel={handleCancelSimulatorBuy}
        />
      ) : null}
      {simulatorSellOpen && selectedSimulator ? (
        <SimulatorSellDialog
          position={simulatorSellPosition}
          unit={simulatorSellUnit}
          usdKrwRate={usdKrwRate}
          amountDraft={simulatorSellAmountDraft}
          error={simulatorSellError}
          busy={simulatorSellBusy}
          marketCalendar={simulatorSellMarketCalendar}
          marketCalendarLoading={simulatorSellMarketCalendarLoading}
          marketCalendarError={simulatorSellMarketCalendarError}
          binanceStatus={binanceProviderStatus}
          binanceError={binanceProviderError}
          onAmountChange={handleSimulatorSellAmountChange}
          onPresetFraction={handleSimulatorSellPresetFraction}
          onSubmitOrder={handleSubmitSimulatorSell}
          onCancel={handleCancelSimulatorSell}
        />
      ) : null}
    </section>
  );
}
