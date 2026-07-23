import { TickMarkType } from "lightweight-charts";
import { resolveUsRegularSessionBasis } from "./watchlistReturnBasis.js";

export const sortOptions = [
  { id: "profitRateDesc", label: "총 수익률 높은 순" },
  { id: "profitRateAsc", label: "총 수익률 낮은 순" },
  { id: "valueDesc", label: "평가금액 높은 순" },
  { id: "valueAsc", label: "평가금액 낮은 순" },
  { id: "dailyRateDesc", label: "일간 수익률 높은 순" },
  { id: "dailyRateAsc", label: "일간 수익률 낮은 순" },
  { id: "nameAsc", label: "가나다 순" },
  { id: "custom", label: "직접 설정하기" },
];

export const companyNames = {
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

export function formatKrw(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) return "-";
  return `${Math.round(number).toLocaleString("ko-KR")}원`;
}

export function formatUsd(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) return "-";
  return `$${number.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatMoney(value, unit = "KRW") {
  return unit === "USD" ? formatUsd(value) : formatKrw(value);
}

export function normalizeMoneyUnit(unit = "KRW") {
  return String(unit || "").toUpperCase() === "USD" ? "USD" : "KRW";
}

export const defaultTransactionCurrencySettings = {
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

export const transactionSimulatorStorageKey = "finance-agent-gui.transaction-simulators.v1";
export const transactionSimulatorInitialKrw = 10_000_000;
export const transactionSimulatorInitialUsd = 0;
export const transactionSimulatorMinimumBuyKrw = 10_000;
export const transactionSimulatorMinimumBuyUsd = 10;
export const transactionWatchlistPriceRefreshMs = 1_000;
export const transactionEtfNameTranslationPollMs = 1_000;
export const transactionTossUsMarkets = new Set(["NYSE", "NASDAQ", "AMEX", "US_ETC"]);
export const transactionTossTranslatedFundTypes = new Set(["ETF", "FOREIGN_ETF", "ETN"]);
export const transactionTossRateLimitFallbackMs = 10_000;
export const transactionWatchlistCandlePageSize = 200;
export const transactionInvestmentDetailCandlePageSize = 200;
export const transactionInvestmentDetailCandleRefreshMs = 500;
export const transactionInvestmentDetailOlderLoadThreshold = 16;
export const transactionWatchlistCandleCacheTtlMs = 60_000;
export const transactionWatchlistKoreanDailyBasisCacheTtlMs = 6 * 60 * 60 * 1_000;
export const transactionWatchlistCandleCache = new Map();
export const transactionInvestmentDetailCandleCache = new Map();
export const transactionWatchlistKoreanDailyBasisCache = new Map();
export const transactionWatchlistMarketCalendarCache = new Map();
export const transactionInvestmentDirectionPalettes = {
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
export const transactionInvestmentDetailChartModes = [
  { id: "area", label: "영역" },
  { id: "candles", label: "캔들" },
  { id: "line", label: "라인" },
  { id: "bars", label: "바" },
  { id: "baseline", label: "베이스라인" },
];
export const transactionInvestmentMinuteIntervals = [
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
export const transactionInvestmentTimeframeTabs = [
  { id: "1d", label: "일" },
  { id: "1w", label: "주" },
];
export const transactionInvestmentDetailChartModeIds = new Set(transactionInvestmentDetailChartModes.map((mode) => mode.id));
export const transactionInvestmentDetailIntervalIds = new Set([
  ...transactionInvestmentMinuteIntervals.map((interval) => interval.id),
  ...transactionInvestmentTimeframeTabs.map((timeframe) => timeframe.id),
]);
export const transactionWatchlistReturnColumns = [
  { key: "daily", label: "일간 수익률", valueField: "dailyReturnPercent", hasField: "hasDailyReturn" },
  { key: "weekly", label: "주간 수익률", valueField: "weeklyReturnPercent", hasField: "hasWeeklyReturn" },
  { key: "monthly", label: "월간 수익률", valueField: "monthlyReturnPercent", hasField: "hasMonthlyReturn" },
  { key: "sixMonth", label: "6개월 수익률", valueField: "sixMonthReturnPercent", hasField: "hasSixMonthReturn" },
];

export const transactionMainTableColumns = [
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

export const fixedTransactionMainTableColumnId = "ticker";
export const transactionSelectableMainTableColumns = transactionMainTableColumns.filter(
  (column) => column.id !== fixedTransactionMainTableColumnId
);
export const transactionSelectableMainTableColumnIds = new Set(
  transactionSelectableMainTableColumns.map((column) => column.id)
);

export function normalizeTransactionMainTableColumnsSetting(value, fallback = defaultTransactionCurrencySettings.mainTableColumns) {
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

export function normalizeTransactionSidebarManualOrderSetting(value, fallback = defaultTransactionCurrencySettings.sidebarManualOrder) {
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

export function cleanTransactionWatchlistGroupName(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
}

export function cleanTransactionWatchlistGroupId(value) {
  return String(value ?? "").trim().replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 96);
}

export function cleanTransactionWatchlistSymbol(value) {
  return String(value ?? "").trim().toUpperCase().replace(/\s+/g, "").slice(0, 32);
}

export function normalizeTransactionInstrumentProvider(value = "toss") {
  return String(value || "").trim().toLowerCase() === "binance" ? "binance" : "toss";
}

export function cleanTransactionInstrumentId(value) {
  const raw = String(value ?? "").trim().replace(/[^a-zA-Z0-9:._-]/g, "").slice(0, 128);
  const binanceMatch = /^binance:(spot|usdm):(.+)$/i.exec(raw);
  if (binanceMatch) return `binance:${binanceMatch[1].toLowerCase()}:${cleanTransactionWatchlistSymbol(binanceMatch[2])}`;
  const tossMatch = /^toss:stock:(.+)$/i.exec(raw);
  if (tossMatch) return `toss:stock:${cleanTransactionWatchlistSymbol(tossMatch[1])}`;
  return raw;
}

export function normalizeTransactionInstrument(source = {}) {
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

export function transactionEtfTranslationMarketCountry(item = {}) {
  const explicit = String(item.marketCountry || "").trim().toUpperCase();
  if (explicit) return explicit;
  const market = String(item.market || item.venue || "").trim().toUpperCase();
  if (/KRX|KOSPI|KOSDAQ|KONEX|KOREA|SEOUL/.test(market)) return "KR";
  if (market || normalizeMoneyUnit(item.currency || item.settlementAsset) === "USD") return "US";
  return "";
}

export function transactionEtfNameTranslationSource(source = {}) {
  const item = normalizeTransactionInstrument(source);
  if (!item) return null;
  return { ...item, ...source, symbol: item.symbol, provider: item.provider };
}

export function collectTransactionEtfNameTranslationSources(
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

export async function resolveTransactionEtfNameTranslationCandidates(sources = [], signal) {
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

export function transactionEtfNameTranslationMap(items = []) {
  const translations = new Map();
  for (const item of Array.isArray(items) ? items : []) {
    const symbol = cleanTransactionWatchlistSymbol(item.symbol);
    const status = String(item?.etfNameTranslationStatus || "").trim();
    if (symbol && ["pending", "translating", "translated"].includes(status)) translations.set(symbol, item);
  }
  return translations;
}

export function applyTransactionEtfNameTranslation(item = {}, translations = new Map()) {
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

export async function fetchTransactionEtfNameTranslations(items = [], signal) {
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

export function transactionInstrumentKey(source = {}) {
  const instrument = normalizeTransactionInstrument(source);
  return instrument?.instrumentId || "";
}

export function normalizeTransactionWatchlistInstrumentsSetting(value, legacySymbols = []) {
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

export function normalizeTransactionWatchlistSymbolsSetting(value) {
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

export function createTransactionWatchlistGroupId() {
  return `watchlist-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function normalizeTransactionWatchlistGroupsSetting(value, fallback = defaultTransactionCurrencySettings.watchlistGroups) {
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

export function transactionItemOrderKey(item = {}) {
  const source = item && typeof item === "object" ? item : {};
  return String(source.symbol || "").trim().toUpperCase();
}

export function transactionItemSelectionKey(item = {}) {
  const source = item && typeof item === "object" ? item : {};
  return transactionInstrumentKey(source) || transactionItemOrderKey(source);
}

export function cleanTransactionItemSelectionKey(value) {
  const raw = String(value || "").trim();
  return raw.includes(":") ? cleanTransactionInstrumentId(raw) : cleanTransactionWatchlistSymbol(raw);
}

export function createTransactionSimulatorOrderIdempotencyKey(side, simulatorId, instrumentId) {
  const nonce = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return [
    side === "sell" ? "sell" : "buy",
    cleanTransactionSimulatorId(simulatorId),
    cleanTransactionInstrumentId(instrumentId),
    nonce,
  ].filter(Boolean).join(":").slice(0, 160);
}

export function transactionItemOrderKeys(items = []) {
  const nextKeys = [];
  for (const item of items) {
    const key = transactionItemSelectionKey(item);
    if (key && !nextKeys.includes(key)) {
      nextKeys.push(key);
    }
  }
  return nextKeys;
}

export function arraysEqual(left = [], right = []) {
  if (left.length !== right.length) return false;
  return left.every((item, index) => item === right[index]);
}

export function syncTransactionSidebarManualOrder(savedOrder, items) {
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

export function reorderTransactionSidebarManualOrder(currentOrder, sourceKey, targetKey, placement = "before") {
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

export function reorderTransactionWatchlistGroups(currentGroups, sourceId, targetId, placement = "before") {
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

export function normalizeTransactionWatchlistInstrumentOrder(value = []) {
  const order = [];
  for (const item of Array.isArray(value) ? value : []) {
    const instrumentId = cleanTransactionInstrumentId(
      item && typeof item === "object" ? item.instrumentId : item
    );
    if (instrumentId && !order.includes(instrumentId)) order.push(instrumentId);
  }
  return order;
}

export function reorderTransactionWatchlistInstruments(currentOrder, sourceId, targetId, placement = "before") {
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

export function transactionWatchlistInstrumentsInOrder(group = {}, instrumentOrder = []) {
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

export function watchlistGroupIdsEqual(left = [], right = []) {
  const leftGroups = normalizeTransactionWatchlistGroupsSetting(left, []);
  const rightGroups = normalizeTransactionWatchlistGroupsSetting(right, []);
  if (leftGroups.length !== rightGroups.length) return false;
  return leftGroups.every((group, index) => group.id === rightGroups[index]?.id);
}

export function visibleTransactionMainTableColumns(selectedColumnIds) {
  const normalizedColumns = normalizeTransactionMainTableColumnsSetting(selectedColumnIds, []);
  const selectedSet = new Set(normalizedColumns);
  return transactionMainTableColumns.filter(
    (column) => column.id === fixedTransactionMainTableColumnId || selectedSet.has(column.id)
  );
}

export function normalizeDisplayCurrencySetting(value = "auto") {
  const candidate = String(value ?? "").trim().toUpperCase();
  if (candidate === "USD" || candidate === "KRW") return candidate;
  return "auto";
}

export function normalizeTransactionValueModeSetting(value = "value") {
  return String(value ?? "").trim().toLowerCase() === "price" ? "price" : "value";
}

export function normalizeTransactionInvestmentChartModeSetting(value = defaultTransactionCurrencySettings.investmentChartMode) {
  const candidate = String(value ?? "").trim().toLowerCase();
  return transactionInvestmentDetailChartModeIds.has(candidate) ? candidate : defaultTransactionCurrencySettings.investmentChartMode;
}

export function normalizeTransactionInvestmentChartIntervalSetting(value = defaultTransactionCurrencySettings.investmentChartIntervalMode) {
  const candidate = String(value ?? "").trim().toLowerCase();
  return transactionInvestmentDetailIntervalIds.has(candidate) ? candidate : defaultTransactionCurrencySettings.investmentChartIntervalMode;
}

export function normalizeTransactionBooleanSetting(value, fallback = false) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  const candidate = String(value ?? "").trim().toLowerCase();
  if (["true", "1", "yes", "y", "on"].includes(candidate)) return true;
  if (["false", "0", "no", "n", "off", ""].includes(candidate)) return false;
  return Boolean(fallback);
}

export function transactionCurrencySettingsFromPayload(payload = {}) {
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

export function effectiveMoneyUnitFromSetting(setting, fallbackUnit = "KRW") {
  const normalizedSetting = normalizeDisplayCurrencySetting(setting);
  return normalizedSetting === "auto" ? normalizeMoneyUnit(fallbackUnit) : normalizedSetting;
}

export function numericAmount(value, fallback = 0) {
  const number = Number(String(value ?? "").replace(/,/g, "").replace(/%$/, "").trim());
  return Number.isFinite(number) ? number : fallback;
}

export function optionalNumericAmount(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(String(value).replace(/,/g, "").replace(/%$/, "").trim());
  return Number.isFinite(number) ? number : null;
}

export function optionalRatePercent(value) {
  const number = optionalNumericAmount(value);
  if (number === null) return null;
  return Math.abs(number) <= 1 ? number * 100 : number;
}

export function convertMoney(value, fromUnit = "KRW", toUnit = "KRW", usdKrwRate = 0) {
  const amount = Number(value || 0);
  if (!Number.isFinite(amount)) return null;
  const sourceUnit = normalizeMoneyUnit(fromUnit);
  const targetUnit = normalizeMoneyUnit(toUnit);
  if (sourceUnit === targetUnit || amount === 0) return amount;
  const rate = Number(usdKrwRate || 0);
  if (!Number.isFinite(rate) || rate <= 0) return null;
  return sourceUnit === "USD" ? amount * rate : amount / rate;
}

export function convertedMoney(value, fromUnit, toUnit, usdKrwRate) {
  const amount = convertMoney(value, fromUnit, toUnit, usdKrwRate);
  return {
    hasValue: amount !== null,
    value: amount ?? 0,
  };
}

export function formatConvertedMoney(value, fromUnit, toUnit, usdKrwRate) {
  const amount = convertMoney(value, fromUnit, toUnit, usdKrwRate);
  return amount === null ? "-" : formatMoney(amount, toUnit);
}

export function formatOptionalMoney(hasValue, value, unit = "KRW") {
  return hasValue ? formatMoney(value, unit) : "-";
}

export function formatOptionalSignedMoney(hasValue, value, unit = "KRW") {
  return hasValue ? formatSignedMoney(value, unit) : "-";
}

export function formatSignedMoney(value, unit = "KRW") {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) return "-";
  const absText = formatMoney(Math.abs(number), unit);
  return `${number > 0 ? "+" : number < 0 ? "-" : ""}${absText}`;
}

export function formatOptionalPerformance(hasValue, value, percent, unit = "KRW") {
  if (!hasValue) return "-";
  return `${formatSignedMoney(value, unit)} (${formatSignedPercent(percent)})`;
}

export function formatConvertedPerformance(hasValue, value, percent, fromUnit, toUnit, usdKrwRate) {
  if (!hasValue) return "-";
  const amount = convertMoney(value, fromUnit, toUnit, usdKrwRate);
  if (amount === null) return "-";
  return `${formatSignedMoney(amount, toUnit)} (${formatSignedPercent(percent)})`;
}

export function formatPercent(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) return "0.00%";
  return `${number.toLocaleString("ko-KR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
}

export function formatSignedPercent(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) return "0.00%";
  return `${number > 0 ? "+" : ""}${formatPercent(number)}`;
}

export function formatQuantity(value, item = null) {
  const number = Number(value || 0);
  const suffix = itemIsCrypto(item) ? String(item?.baseAsset || "").toUpperCase() : "주";
  if (!Number.isFinite(number)) return `0${suffix}`;
  return `${number.toLocaleString("ko-KR", { maximumFractionDigits: 8 })}${suffix}`;
}

export function formatUpdatedAt(value) {
  if (!value) return "";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return date.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function formatCompactNumber(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) return "-";
  return new Intl.NumberFormat("ko-KR", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(number);
}

export function formatCompactMoney(value, unit = "KRW") {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) return "-";
  const normalizedUnit = normalizeMoneyUnit(unit);
  if (normalizedUnit === "USD") return `$${formatCompactNumber(number)}`;
  return `${formatCompactNumber(number)}원`;
}

export function transactionDatePartsFromTime(time) {
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

export function formatTransactionChartDateLabel(time, { includeDay = true } = {}) {
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

export function formatTransactionChartTickMark(time, tickMarkType) {
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

export function valueTone(value) {
  const number = Number(value || 0);
  if (number > 0) return "is-positive";
  if (number < 0) return "is-negative";
  return "";
}

export function transactionInvestmentDirectionPalette(dailyReturnPercent) {
  const number = Number(dailyReturnPercent);
  if (!Number.isFinite(number) || Math.abs(number) < 0.005) {
    return transactionInvestmentDirectionPalettes.flat;
  }
  return number > 0 ? transactionInvestmentDirectionPalettes.up : transactionInvestmentDirectionPalettes.down;
}

export function displayName(item = {}) {
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

export function displayNameFromInstrumentSources(...sources) {
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

export function transactionInstrumentDescription(item = {}) {
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

export function transactionNameTranslationPending(item = {}) {
  return ["pending", "translating"].includes(String(item.etfNameTranslationStatus || "").trim());
}

export function transactionWatchlistSearchName(item = {}) {
  return String(item.name || item.companyName || item.koreanName || item.label || displayName(item) || "").trim();
}

export function transactionWatchlistOptionAliases(option = {}) {
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

export function transactionSymbolSearchSuggestions(symbolOptions = [], query = "", excludedInstruments = [], limit = 8) {
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

export function transactionWatchlistSymbolOptions(items = []) {
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

export function transactionWatchlistStockOptionsFromPayload(payload = {}) {
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

export function transactionMarketDataInstrumentOptionsFromPayload(payload = {}) {
  const result = Array.isArray(payload?.result)
    ? payload.result
    : Array.isArray(payload?.result?.instruments)
      ? payload.result.instruments
      : Array.isArray(payload)
        ? payload
        : [];
  return result.map((item) => normalizeTransactionInstrument(item)).filter(Boolean);
}

export function transactionWatchlistPriceRowsFromPayload(payload = {}) {
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

export function transactionWatchlistCandleRowsFromPayload(payload = {}) {
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

export function transactionInvestmentIntervalIsIntraday(interval = "1d") {
  return /^(?:\d+)(?:s|m|h)$/.test(String(interval || "").trim());
}

export function transactionInvestmentCandleRowsFromPayload(payload = {}, interval = "1d") {
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

export function transactionInvestmentSourceInterval(interval = "1d") {
  const normalized = String(interval || "1d").trim().toLowerCase();
  // Toss minute views are built from 1m rows, while Binance hour rows are
  // already intraday data and must keep timestamp keys instead of date keys.
  if (/^\d+(?:s|h)$/.test(normalized)) return normalized;
  return normalized.endsWith("m") ? "1m" : "1d";
}

export function transactionBinanceSourceInterval(interval = "1d") {
  const normalized = String(interval || "1d").trim().toLowerCase();
  if (normalized === "60m") return "1h";
  if (normalized === "120m") return "2h";
  if (normalized === "240m") return "4h";
  return normalized;
}

export function transactionInvestmentCandleRowKey(row = {}, interval = "1d") {
  const sourceInterval = String(interval || "1d").trim();
  if (transactionInvestmentIntervalIsIntraday(sourceInterval)) {
    return String(row.timestamp || row.time || row.date || "").trim();
  }
  return String(row.date || row.timestamp || row.time || "").slice(0, 10);
}

export function uniqueTransactionInvestmentCandleRows(rows = [], interval = "1d") {
  const sourceInterval = transactionInvestmentSourceInterval(interval);
  const byKey = new Map();
  for (const row of transactionInvestmentCandleRowsFromPayload(rows, sourceInterval)) {
    const key = transactionInvestmentCandleRowKey(row, sourceInterval);
    if (!key) continue;
    byKey.set(key, row);
  }
  return [...byKey.values()].sort((left, right) => transactionChartTimeSortValue(left.time) - transactionChartTimeSortValue(right.time));
}

export function mergeTransactionInvestmentCandleRows(existing = [], incoming = [], interval = "1d") {
  return uniqueTransactionInvestmentCandleRows([...existing, ...incoming], interval);
}

export function transactionInvestmentCandleRowsEqual(leftRows = [], rightRows = [], interval = "1d") {
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

export function transactionInvestmentOlderBeforeFromRows(rows = [], interval = "1d") {
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

export function transactionInvestmentNextBeforeFromPayload(body = {}, rows = [], interval = "1d") {
  const nextBefore = String(body?.result?.nextBefore || body?.nextBefore || "").trim();
  return nextBefore || transactionInvestmentOlderBeforeFromRows(rows, interval);
}

export function transactionInvestmentShouldLoadOlderFromLogicalRange(series, logicalRange) {
  if (!logicalRange) return false;
  const barsInfo = series?.barsInLogicalRange?.(logicalRange) || null;
  const barsBefore = Number(barsInfo?.barsBefore);
  const rangeFrom = Number(logicalRange.from);
  return (
    (Number.isFinite(barsBefore) && barsBefore <= transactionInvestmentDetailOlderLoadThreshold) ||
    (!Number.isFinite(barsBefore) && Number.isFinite(rangeFrom) && rangeFrom <= transactionInvestmentDetailOlderLoadThreshold)
  );
}

export function transactionInvestmentRestoredLogicalRange(logicalRange, prependedCount = 0) {
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

export function transactionInvestmentMinuteSize(interval = "1m") {
  const match = /^(\d+)m$/.exec(String(interval || ""));
  const minutes = match ? Number(match[1]) : 1;
  return Number.isFinite(minutes) && minutes > 0 ? minutes : 1;
}

export function mergeTransactionInvestmentCandleGroup(group, row) {
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

export function aggregateTransactionInvestmentMinuteRows(rows = [], interval = "1m") {
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

export function transactionInvestmentWeekStart(dateString = "") {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateString || ""));
  if (!match) return "";
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  const day = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - day);
  return date.toISOString().slice(0, 10);
}

export function aggregateTransactionInvestmentWeeklyRows(rows = []) {
  const groups = new Map();
  for (const row of rows) {
    const weekStart = transactionInvestmentWeekStart(row.date);
    if (!weekStart) continue;
    const groupRow = { ...row, date: weekStart, time: weekStart, timestamp: weekStart };
    groups.set(weekStart, mergeTransactionInvestmentCandleGroup(groups.get(weekStart), groupRow));
  }
  return [...groups.values()].sort((left, right) => left.date.localeCompare(right.date));
}

export function transactionInvestmentDailyDate(row = {}) {
  const date = String(row.date || row.timestamp || row.time || "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : "";
}

export function aggregateTransactionInvestmentDailyRows(rows = []) {
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

export function aggregateTransactionInvestmentRows(rows = [], interval = "1d") {
  if (String(interval || "").endsWith("m")) {
    return aggregateTransactionInvestmentMinuteRows(rows, interval);
  }
  if (interval === "1w") {
    return aggregateTransactionInvestmentWeeklyRows(rows);
  }
  return rows;
}

export function transactionChartTimeSortValue(time) {
  if (typeof time === "number" && Number.isFinite(time)) return time;
  const parsed = Date.parse(String(time || ""));
  return Number.isFinite(parsed) ? parsed / 1000 : 0;
}

export function transactionChartDataTime(row = {}) {
  const time = row?.time ?? row?.date;
  if (typeof time === "number") return Number.isFinite(time) ? time : null;
  const text = String(time || "").trim();
  return text || null;
}

export function transactionChartDataTimeKey(time) {
  if (typeof time === "number") return Number.isFinite(time) ? `n:${time}` : "";
  const text = String(time || "").trim();
  return text ? `s:${text}` : "";
}

export function transactionInvestmentChartDatumEqual(left = {}, right = {}) {
  if (transactionChartDataTimeKey(left?.time) !== transactionChartDataTimeKey(right?.time)) return false;
  return ["value", "open", "high", "low", "close", "color"].every(
    (field) => (left?.[field] ?? null) === (right?.[field] ?? null)
  );
}

export function transactionInvestmentCanUpdateLastChartDatum(previousRows = [], nextRows = []) {
  if (!previousRows.length || !nextRows.length) return false;
  if (nextRows.length !== previousRows.length && nextRows.length !== previousRows.length + 1) return false;
  const stableCount = nextRows.length === previousRows.length ? nextRows.length - 1 : previousRows.length;
  for (let index = 0; index < stableCount; index += 1) {
    if (!transactionInvestmentChartDatumEqual(previousRows[index], nextRows[index])) return false;
  }
  return true;
}

export function normalizeTransactionChartRows(rows = []) {
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

export function transactionInvestmentDisplayCandleRows(rows = [], fromUnit = "USD", toUnit = "USD", usdKrwRate = 0) {
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

export function transactionInvestmentLineChartData(rows = []) {
  return rows
    .map((row) => {
      const time = transactionChartDataTime(row);
      const value = optionalNumericAmount(row?.close);
      if (time === null || value === null || value <= 0) return null;
      return { time, value };
    })
    .filter(Boolean);
}

export function transactionInvestmentOhlcChartData(rows = []) {
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

export function transactionInvestmentVolumeChartData(rows = [], priceData = []) {
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

export function transactionInvestmentChartDataReady(priceData = [], volumeData = [], volumeVisible = false) {
  if (!priceData.length) return false;
  if (!volumeVisible) return true;
  if (!volumeData.length) return false;
  const volumeTimeKeys = new Set(volumeData.map((row) => transactionChartDataTimeKey(row?.time)).filter(Boolean));
  return priceData.every((row) => volumeTimeKeys.has(transactionChartDataTimeKey(row?.time)));
}

export function transactionInvestmentHasNewCandleRows(currentRows = [], nextRows = [], interval = "1d") {
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

export function transactionWatchlistMinuteCandleRowsFromPayload(payload = {}) {
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

export function transactionWatchlistPriceDate(row = {}) {
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

export function transactionWatchlistPriceDateObject(row = {}) {
  const source = String(row.timestamp || row.raw?.timestamp || row.raw?.dateTime || row.raw?.time || "").trim();
  const parsed = Date.parse(source);
  return Number.isFinite(parsed) ? new Date(parsed) : new Date();
}

export function transactionWatchlistLocalDateString(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function transactionWatchlistDateParts(dateString) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateString || ""));
  if (!match) return null;
  return {
    year: Number(match[1]),
    monthIndex: Number(match[2]) - 1,
    day: Number(match[3]),
  };
}

export function transactionWatchlistShiftDate(dateString, { days = 0, months = 0, years = 0 } = {}) {
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

export function transactionWatchlistReturnTargetDate(anchorDate, periodKey) {
  if (periodKey === "weekly") return transactionWatchlistShiftDate(anchorDate, { days: 7 });
  if (periodKey === "monthly") return transactionWatchlistShiftDate(anchorDate, { months: 1 });
  if (periodKey === "sixMonth") return transactionWatchlistShiftDate(anchorDate, { months: 6 });
  return "";
}

export function transactionWatchlistCloseAtOrBefore(candleRows = [], targetDate = "") {
  if (!targetDate) return null;
  const rows = transactionWatchlistCandleRowsFromPayload(candleRows);
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    if (rows[index].date <= targetDate && rows[index].close > 0) {
      return rows[index].close;
    }
  }
  return null;
}

export function transactionWatchlistReturnPercent(lastPrice, baseClose) {
  const price = Number(lastPrice);
  const close = Number(baseClose);
  if (!Number.isFinite(price) || !Number.isFinite(close) || close <= 0) return null;
  return ((price - close) / close) * 100;
}

export function transactionWatchlistAddMinutes(timestamp = "", minutes = 0) {
  const timeMs = Date.parse(String(timestamp || ""));
  if (!Number.isFinite(timeMs)) return "";
  const nextTimeMs = timeMs + Number(minutes || 0) * 60_000;
  if (String(timestamp || "").endsWith("+09:00")) {
    return `${new Date(nextTimeMs + 9 * 60 * 60_000).toISOString().replace("Z", "")}+09:00`;
  }
  return new Date(nextTimeMs).toISOString();
}

export function transactionWatchlistUniqueCandleRows(rows = []) {
  const byDate = new Map();
  for (const row of transactionWatchlistCandleRowsFromPayload(rows)) {
    byDate.set(row.date, row);
  }
  return [...byDate.values()].sort((left, right) => left.date.localeCompare(right.date));
}

export function previousCloseForWatchlistPrice(priceRow = {}, candleRows = []) {
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

export function transactionWatchlistReturnsForPrice(priceRow = {}, candleRows = [], dailyBasis = null) {
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

export function transactionWatchlistPriceMap(priceRows = [], candlePayloads = [], dailyBasisPayloads = []) {
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

export async function fetchTransactionWatchlistCatalogOptions(query, signal) {
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

export async function fetchTransactionWatchlistCandleRows(symbol, signal) {
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

export async function fetchTransactionInvestmentDetailCandles(instrumentSource, interval = "1d", signal, options = {}) {
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

export async function fetchTransactionWatchlistMarketCalendar(marketCode = "kr", date = "", signal) {
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

export function transactionWatchlistKoreanDailyBasisBoundary(calendarPayload = {}) {
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

export function transactionWatchlistUsDailyBasisBoundary(calendarPayload = {}, priceRow = {}) {
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

export async function fetchTransactionWatchlistMinuteBasisClose({ symbol, boundary, cacheKey, source, signal }) {
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

export async function fetchTransactionWatchlistKoreanDailyBasis(priceRow = {}, signal) {
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

export async function fetchTransactionWatchlistUsDailyBasis(priceRow = {}, signal) {
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

export async function fetchTransactionBinanceDailyBasis(priceRow = {}, signal, calendarPayload) {
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

export async function fetchTransactionWatchlistDailyBasis(priceRow = {}, signal) {
  return normalizeMoneyUnit(priceRow?.currency) === "USD"
    ? fetchTransactionWatchlistUsDailyBasis(priceRow, signal)
    : fetchTransactionWatchlistKoreanDailyBasis(priceRow, signal);
}

export async function fetchTransactionTossWatchlistPrices(symbols = [], signal) {
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

export async function fetchTransactionBinanceWatchlistPrices(instruments = [], signal) {
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

export async function fetchTransactionWatchlistPrices(instrumentValues = [], signal, options = {}) {
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

export function transactionSimulatorPriceFromPayload(payload = {}, symbol = "", fallbackUnit = "KRW") {
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

export async function fetchTransactionSimulatorExecutionPrice(symbol, settlementUnit = "KRW", signal) {
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

export function mergeTransactionWatchlistSymbolOptions(...optionGroups) {
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

export function resolveTransactionWatchlistSymbolInput(value, options = []) {
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

export function transactionSimulatorBuyPresets(unit = "KRW") {
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

export const transactionSimulatorSellFractions = [
  { label: "10%", fraction: 0.1 },
  { label: "25%", fraction: 0.25 },
  { label: "50%", fraction: 0.5 },
  { label: "전액", fraction: 1 },
];

export function transactionSimulatorOrderNotificationMessage({ side = "buy", symbol = "", amount = 0, unit = "KRW" }) {
  const actionLabel = side === "sell" ? "매도" : "매수";
  const ticker = cleanTransactionWatchlistSymbol(symbol) || "주문";
  return `${ticker} ${formatMoney(amount, unit)} ${actionLabel} 주문 체결이 성공했습니다.`;
}

export function transactionSimulatorStockOptionFromItem(item = {}) {
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

export function transactionSimulatorSettlementUnit(option = {}) {
  const instrument = normalizeTransactionInstrument(option);
  if (instrument?.provider === "binance") return "USD";
  const symbol = cleanTransactionWatchlistSymbol(option?.symbol);
  const market = String(option?.market || option?.exchange || "").toUpperCase();
  if (/^\d{6}$/.test(symbol) || /KOSPI|KOSDAQ|KONEX|KRX|KOREA|SEOUL/.test(market)) return "KRW";
  if (/NASDAQ|NYSE|AMEX|ARCA|OTC|BATS|US/.test(market)) return "USD";
  return symbol && /^[A-Z][A-Z0-9.-]*$/.test(symbol) ? "USD" : "KRW";
}

export function transactionSimulatorMarketCalendarCode(settlementUnit = "KRW") {
  return normalizeMoneyUnit(settlementUnit) === "USD" ? "us" : "kr";
}

export function transactionSimulatorCalendarDateInTimeZone(timeZone, date = new Date()) {
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

export function transactionSimulatorCalendarDate(settlementUnit = "KRW", date = new Date()) {
  return normalizeMoneyUnit(settlementUnit) === "USD"
    ? transactionSimulatorCalendarDateInTimeZone("America/New_York", date)
    : transactionSimulatorCalendarDateInTimeZone("Asia/Seoul", date);
}

export function transactionSimulatorCalendarResult(payload = {}) {
  if (payload?.result && typeof payload.result === "object" && !Array.isArray(payload.result)) return payload.result;
  if (payload && typeof payload === "object" && !Array.isArray(payload)) return payload;
  return null;
}

export function transactionSimulatorCalendarSessions(payload = {}, settlementUnit = "KRW") {
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

export function transactionSimulatorCurrentMarketSession(payload = {}, settlementUnit = "KRW", date = new Date()) {
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

export function transactionSimulatorCalendarUnitsForItems(items = []) {
  const units = new Set();
  for (const item of Array.isArray(items) ? items : []) {
    const unit = normalizeMoneyUnit(item?.currency || item?.displayCurrency || "KRW");
    units.add(unit);
  }
  return [...units].sort();
}

export function transactionBinanceProviderAvailability(payload = null, error = "") {
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

export function transactionSidebarPriceModeLabel(items = [], marketCalendars = {}) {
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

export function transactionSimulatorBuyTradingEligibility({
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

export function transactionSimulatorCurrencyLabel(unit = "KRW") {
  return normalizeMoneyUnit(unit) === "USD" ? "달러" : "원화";
}

export function transactionSimulatorMinimumSettlementBuyAmount(settlementUnit = "KRW", usdKrwRate = 0) {
  if (normalizeMoneyUnit(settlementUnit) === "KRW") return transactionSimulatorMinimumBuyKrw;
  const krwEquivalent = convertMoney(transactionSimulatorMinimumBuyKrw, "KRW", "USD", usdKrwRate);
  if (krwEquivalent !== null && krwEquivalent > 0 && krwEquivalent < transactionSimulatorMinimumBuyUsd) {
    return Math.ceil(krwEquivalent * 100) / 100;
  }
  return transactionSimulatorMinimumBuyUsd;
}

export function transactionSimulatorMinimumOrderAmount(orderUnit = "KRW", settlementUnit = "KRW", usdKrwRate = 0) {
  const minimumSettlement = transactionSimulatorMinimumSettlementBuyAmount(settlementUnit, usdKrwRate);
  const amount = convertMoney(minimumSettlement, settlementUnit, orderUnit, usdKrwRate);
  if (amount === null) return null;
  return normalizeMoneyUnit(orderUnit) === "USD" ? Math.ceil(amount * 100) / 100 : Math.ceil(amount);
}

export function transactionSimulatorMinimumBuyLabel(orderUnit = "KRW", settlementUnit = "KRW", usdKrwRate = 0) {
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

export function transactionSimulatorBuyAvailableAmount(simulator = {}, unit = "KRW") {
  return normalizeMoneyUnit(unit) === "USD"
    ? numericAmount(simulator.cashUsd ?? simulator.balances?.USD, 0)
    : numericAmount(simulator.cashKrw ?? simulator.balances?.KRW, 0);
}

export function transactionSimulatorPositionSettlementValue(position = {}) {
  const quantity = numericAmount(position.quantity, 0);
  const price = numericAmount(position.currentPrice ?? position.lastPrice, 0);
  const value = numericAmount(position.value ?? position.rawValue, 0);
  if (value > 0) return value;
  return quantity > 0 && price > 0 ? quantity * price : 0;
}

export function cleanTransactionSimulatorBuyAmountDraft(value, unit = "KRW") {
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

export function transactionSimulatorBuyAmountValue(value) {
  const amount = Number(String(value || "").replace(/,/g, ""));
  return Number.isFinite(amount) ? amount : 0;
}

export function formatTransactionSimulatorBuyAmountDraft(value, unit = "KRW") {
  const displayUnit = normalizeMoneyUnit(unit);
  const amount = Number(value || 0);
  if (!Number.isFinite(amount) || amount <= 0) return "";
  if (displayUnit === "KRW") return String(Math.round(amount));
  return amount.toFixed(2).replace(/\.?0+$/, "");
}

export const transactionSimulatorExchangeModes = [
  { id: "KRW_TO_USD", label: "원화 → 달러", fromUnit: "KRW", toUnit: "USD" },
  { id: "USD_TO_KRW", label: "달러 → 원화", fromUnit: "USD", toUnit: "KRW" },
];

export function transactionSimulatorExchangeMode(modeId = "KRW_TO_USD") {
  return transactionSimulatorExchangeModes.find((mode) => mode.id === modeId) || transactionSimulatorExchangeModes[0];
}

export function cleanTransactionSimulatorExchangeAmountDraft(value, modeId = "KRW_TO_USD") {
  const mode = transactionSimulatorExchangeMode(modeId);
  return cleanTransactionSimulatorBuyAmountDraft(value, mode.fromUnit);
}

export function formatTransactionSimulatorExchangeAmountDraft(value, modeId = "KRW_TO_USD") {
  const mode = transactionSimulatorExchangeMode(modeId);
  return formatTransactionSimulatorBuyAmountDraft(value, mode.fromUnit);
}

export function transactionSimulatorExchangeAmountValue(value) {
  return transactionSimulatorBuyAmountValue(value);
}

export function transactionSimulatorExchangeOutputAmount(fromAmount, modeId = "KRW_TO_USD", usdKrwRate = 0) {
  const mode = transactionSimulatorExchangeMode(modeId);
  return convertMoney(fromAmount, mode.fromUnit, mode.toUnit, usdKrwRate);
}

export function transactionSimulatorExchangeRateText(usdKrwRate = 0) {
  const rate = Number(usdKrwRate || 0);
  if (!Number.isFinite(rate) || rate <= 0) return "환율 확인 필요";
  return `$1 = ${formatKrw(rate)}`;
}

export function cleanAccountSeq(value) {
  return String(value ?? "").trim();
}

export function accountDisplayLabel(account = {}, index = 0) {
  const accountNo = String(account.accountNo || "").replace(/\D/g, "");
  if (accountNo.length >= 4) return `계좌 ${accountNo.slice(-4)}`;
  const accountSeq = cleanAccountSeq(account.accountSeq);
  if (accountSeq) return `계좌 ${accountSeq}`;
  return index === 0 ? "기본계좌" : `계좌 ${index + 1}`;
}

export function cleanTransactionSimulatorId(value) {
  return String(value ?? "").trim().replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 96);
}

export function cleanTransactionSimulatorName(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
}

export function simulatorDisplayLabel(simulator = {}, index = 0) {
  return cleanTransactionSimulatorName(simulator.name) || `투자 시뮬레이터 ${index + 1}`;
}

export function normalizeTransactionSimulatorAccount(source = {}, index = 0, usedIds = new Set()) {
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

export function normalizeTransactionSimulatorAccounts(value) {
  const sourceAccounts = Array.isArray(value?.accounts) ? value.accounts : Array.isArray(value) ? value : [];
  const usedIds = new Set();
  return sourceAccounts.map((account, index) => (
    normalizeTransactionSimulatorAccount(account && typeof account === "object" ? account : {}, index, usedIds)
  ));
}

export function readStoredTransactionSimulators() {
  if (typeof window === "undefined" || !window.localStorage) return [];
  try {
    const raw = window.localStorage.getItem(transactionSimulatorStorageKey);
    if (!raw) return [];
    return normalizeTransactionSimulatorAccounts(JSON.parse(raw));
  } catch {
    return [];
  }
}

export function clearStoredTransactionSimulators() {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    window.localStorage.removeItem(transactionSimulatorStorageKey);
  } catch {
    // The SQLite-backed store remains authoritative even if prototype storage cleanup fails.
  }
}

export function transactionSimulatorMarketDateForTimestamp(timestamp, itemUnit) {
  const time = Date.parse(String(timestamp || ""));
  if (!Number.isFinite(time)) return transactionSimulatorCalendarDate(itemUnit);
  return transactionSimulatorCalendarDate(itemUnit, new Date(time));
}

export function transactionSimulatorSameDayLotBasis(item = {}, itemUnit = "KRW", marketDate = "") {
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

export function transactionSimulatorDailyBaseline({
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

export function transactionSimulatorItemsWithPrices(items = [], priceMap = new Map()) {
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

export function transactionSimulatorTotalsFromItems(items = []) {
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

export function transactionSimulatorDailyReturnPercent(items = []) {
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

export function transactionSimulatorDefaultDisplayUnit(simulator = {}, items = []) {
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

export function transactionAvailableDisplayUnit(requestedUnit, fallbackUnit, items = [], usdKrwRate = 0) {
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

export function transactionSimulatorPayload(simulator = null, priceMap = new Map(), pricePayload = null) {
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

export function simulatorAccountsFromApiPayload(payload = {}) {
  return normalizeTransactionSimulatorAccounts(payload?.accounts || []);
}

export function transactionLiveFetchGate(status) {
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

export function transactionPageIsVisible() {
  if (typeof document === "undefined") return true;
  return document.visibilityState !== "hidden";
}

export function retryAfterMsFromRateLimit(rateLimit = null) {
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

export function normalizeItem(item = {}, unit = "KRW") {
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

export function sumConvertedItems(items, field, unit, usdKrwRate) {
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

export function aggregatePerformance(items, unit, usdKrwRate) {
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

export function usdKrwRateFromPayload(payload = {}) {
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

export function sortItems(items, sortId, manualOrder = []) {
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

export function itemMarketCountry(item = {}) {
  return String(item.marketCountry || "").trim().toUpperCase();
}

export function itemIsOverseasStock(item = {}) {
  if (String(item?.assetClass || "").toLowerCase() === "crypto") return false;
  const marketCountry = itemMarketCountry(item);
  return Boolean(marketCountry && marketCountry !== "KR");
}

export function itemIsDomesticStock(item = {}) {
  if (String(item?.assetClass || "").toLowerCase() === "crypto") return false;
  return itemMarketCountry(item) === "KR";
}

export function itemIsCrypto(item = {}) {
  const instrument = normalizeTransactionInstrument(item);
  return String(instrument?.assetClass || item?.assetClass || "").toLowerCase() === "crypto" || (
    instrument?.provider === "binance" && instrument?.marketType === "spot"
  );
}

export function transactionPerformancePeriodPrefix(items = []) {
  return "일간";
}

export function transactionSortOptionsForItems(items = []) {
  const prefix = transactionPerformancePeriodPrefix(items);
  return sortOptions.map((option) => (
    option.id === "dailyRateDesc"
      ? { ...option, label: `${prefix} 수익률 높은 순` }
      : option.id === "dailyRateAsc"
        ? { ...option, label: `${prefix} 수익률 낮은 순` }
        : option
  ));
}
