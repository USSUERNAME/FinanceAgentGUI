import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readJsonBody, sendJson } from "./codexProbe.mjs";

const WEB_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const GUIBUILD_ROOT = resolve(WEB_ROOT, "..");
const CONFIG_DIR = join(GUIBUILD_ROOT, "config");
const DEFAULT_SETTINGS_PATH = join(CONFIG_DIR, "transaction-status.defaults.json");
const USER_SETTINGS_PATH = join(CONFIG_DIR, "transaction-status.user.json");

const fallbackSettings = {
  version: 2,
  menuHidden: false,
  sidebarDisplayCurrency: "auto",
  mainDisplayCurrency: "auto",
  sidebarValueMode: "value",
  investmentChartMode: "area",
  investmentChartIntervalMode: "1d",
  investmentChartVolumeVisible: false,
  mainTableColumns: [],
  sidebarManualOrder: [],
  watchlistGroups: [],
  portfolioHoldings: [],
};

const DISPLAY_CURRENCY_IDS = new Set(["auto", "KRW", "USD"]);
const SIDEBAR_VALUE_MODE_IDS = new Set(["value", "price"]);
const INVESTMENT_CHART_MODE_IDS = new Set(["area", "candles", "line", "bars", "baseline"]);
const INVESTMENT_CHART_INTERVAL_IDS = new Set(["1d", "1w", "1m", "3m", "5m", "10m", "15m", "30m", "60m", "120m", "240m"]);
const MAIN_TABLE_COLUMN_IDS = new Set([
  "name",
  "profitPercent",
  "profit",
  "value",
  "costBasis",
  "currentPrice",
  "quantity",
  "averageKnownCost",
  "dailyReturnPercent",
  "dailyProfit",
]);

function ensureConfigDir() {
  mkdirSync(CONFIG_DIR, { recursive: true });
}

function readJsonFile(path) {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function normalizeTransactionDisplayCurrency(value, fallback = "auto") {
  const candidate = String(value ?? "").trim().toUpperCase();
  if (candidate === "AUTO") return "auto";
  if (DISPLAY_CURRENCY_IDS.has(candidate)) return candidate;
  return DISPLAY_CURRENCY_IDS.has(fallback) ? fallback : "auto";
}

function normalizeTransactionSidebarValueMode(value, fallback = fallbackSettings.sidebarValueMode) {
  const candidate = String(value ?? "").trim().toLowerCase();
  if (SIDEBAR_VALUE_MODE_IDS.has(candidate)) return candidate;
  return SIDEBAR_VALUE_MODE_IDS.has(fallback) ? fallback : "value";
}

function normalizeTransactionInvestmentChartMode(value, fallback = fallbackSettings.investmentChartMode) {
  const candidate = String(value ?? "").trim().toLowerCase();
  if (INVESTMENT_CHART_MODE_IDS.has(candidate)) return candidate;
  return INVESTMENT_CHART_MODE_IDS.has(fallback) ? fallback : "area";
}

function normalizeTransactionInvestmentChartIntervalMode(value, fallback = fallbackSettings.investmentChartIntervalMode) {
  const candidate = String(value ?? "").trim().toLowerCase();
  if (INVESTMENT_CHART_INTERVAL_IDS.has(candidate)) return candidate;
  return INVESTMENT_CHART_INTERVAL_IDS.has(fallback) ? fallback : "1d";
}

function normalizeTransactionBoolean(value, fallback = false) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  const candidate = String(value ?? "").trim().toLowerCase();
  if (["true", "1", "yes", "y", "on"].includes(candidate)) return true;
  if (["false", "0", "no", "n", "off", ""].includes(candidate)) return false;
  return Boolean(fallback);
}

function normalizeTransactionMainTableColumns(value, fallback = fallbackSettings.mainTableColumns) {
  if (!Array.isArray(value)) return Array.isArray(fallback) ? [...fallback] : [];
  const nextColumns = [];
  for (const item of value) {
    const columnId = String(item || "").trim();
    if (MAIN_TABLE_COLUMN_IDS.has(columnId) && !nextColumns.includes(columnId)) {
      nextColumns.push(columnId);
    }
  }
  return nextColumns;
}

function normalizeTransactionSidebarManualOrder(value, fallback = fallbackSettings.sidebarManualOrder) {
  if (!Array.isArray(value)) return Array.isArray(fallback) ? [...fallback] : [];
  const nextKeys = [];
  for (const item of value) {
    const raw = String(item || "").trim();
    const binanceMatch = /^binance:(spot|usdm):([a-zA-Z0-9._-]+)$/i.exec(raw);
    const tossMatch = /^toss:stock:([a-zA-Z0-9._-]+)$/i.exec(raw);
    const key = binanceMatch
      ? `binance:${binanceMatch[1].toLowerCase()}:${binanceMatch[2].toUpperCase()}`
      : tossMatch
        ? `toss:stock:${tossMatch[1].toUpperCase()}`
        : raw.includes(":")
          ? raw.replace(/[^a-zA-Z0-9:._\/-]/g, "").slice(0, 160)
          : raw.toUpperCase();
    if (key && !nextKeys.includes(key)) {
      nextKeys.push(key);
    }
  }
  return nextKeys;
}

function cleanWatchlistGroupName(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
}

function cleanWatchlistGroupId(value) {
  return String(value ?? "").trim().replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 96);
}

function cleanWatchlistSymbol(value) {
  return String(value ?? "").trim().toUpperCase().replace(/\s+/g, "").slice(0, 32);
}

function cleanWatchlistInstrumentId(value) {
  return String(value ?? "")
    .trim()
    .replace(/[^a-zA-Z0-9:._\/-]/g, "")
    .slice(0, 160);
}

function cleanWatchlistProvider(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "")
    .slice(0, 40);
}

function cleanWatchlistUpperCode(value, limit = 40) {
  return String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9._-]/g, "")
    .slice(0, limit);
}

function cleanWatchlistLowerCode(value, limit = 40) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "")
    .slice(0, limit);
}

function cleanWatchlistInstrumentText(value, limit = 120) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, limit);
}

function normalizeTransactionWatchlistInstrument(value) {
  if (!value || typeof value !== "object") return null;
  const symbol = cleanWatchlistSymbol(value.symbol ?? value.ticker ?? value.code);
  if (!symbol) return null;

  let instrumentId = cleanWatchlistInstrumentId(value.instrumentId ?? value.instrument_id);
  let provider = cleanWatchlistProvider(value.provider);
  if (!provider && instrumentId.includes(":")) {
    provider = cleanWatchlistProvider(instrumentId.split(":", 1)[0]);
  }
  let venue = cleanWatchlistUpperCode(value.venue ?? value.market);
  let market = cleanWatchlistUpperCode(value.market ?? venue);
  let assetClass = cleanWatchlistLowerCode(value.assetClass ?? value.asset_class);
  const baseAsset = cleanWatchlistUpperCode(value.baseAsset ?? value.base_asset);
  const quoteAsset = cleanWatchlistUpperCode(value.quoteAsset ?? value.nativeQuoteAsset ?? value.quote_asset);
  let settlementAsset = cleanWatchlistUpperCode(
    value.settlementAsset ?? value.settlementCurrency ?? value.currency ?? value.settlement_asset,
  );
  let status = cleanWatchlistUpperCode(value.status ?? value.instrumentStatus);
  let sessionPolicy = cleanWatchlistLowerCode(value.sessionPolicy ?? value.session_policy);
  let source = cleanWatchlistInstrumentText(value.source, 80);
  const requestedMarketType = cleanWatchlistLowerCode(value.marketType, 20);
  const marketType = requestedMarketType === "usdm" || /USDM|FUTURES/.test(`${venue} ${market}`)
    ? "usdm"
    : "spot";

  if (provider === "binance") {
    instrumentId = `binance:${marketType}:${symbol}`;
    venue = marketType === "usdm" ? "BINANCE_USDM_FUTURES" : "BINANCE_SPOT";
    market = venue;
    assetClass = assetClass || (marketType === "usdm" ? "tradfi" : "crypto");
    if (quoteAsset === "USDT") settlementAsset = "USD";
    sessionPolicy = "24x7";
    source = source || "binance-market-data";
  }
  if (!instrumentId) return null;

  const displaySymbol =
    cleanWatchlistInstrumentText(value.displaySymbol, 80) ||
    (baseAsset && quoteAsset ? `${baseAsset}/${quoteAsset}` : symbol);
  return {
    instrumentId,
    provider,
    marketType: provider === "binance" ? marketType : "",
    venue,
    assetClass,
    symbol,
    displaySymbol,
    baseAsset,
    quoteAsset,
    settlementAsset,
    status,
    sessionPolicy,
    market,
    name: cleanWatchlistInstrumentText(value.name ?? value.symbolName, 120) || symbol,
    englishName: cleanWatchlistInstrumentText(value.englishName, 120),
    contractType: cleanWatchlistUpperCode(value.contractType, 60),
    underlyingType: cleanWatchlistUpperCode(value.underlyingType, 60),
    underlyingSubType: (Array.isArray(value.underlyingSubType) ? value.underlyingSubType : [])
      .map((item) => cleanWatchlistInstrumentText(item, 80))
      .filter(Boolean)
      .slice(0, 12),
    source,
  };
}

function normalizeTransactionWatchlistInstruments(value) {
  if (!Array.isArray(value)) return [];
  const nextInstruments = [];
  const usedIds = new Set();
  for (const item of value) {
    const instrument = normalizeTransactionWatchlistInstrument(item);
    if (!instrument || usedIds.has(instrument.instrumentId)) continue;
    usedIds.add(instrument.instrumentId);
    nextInstruments.push(instrument);
  }
  return nextInstruments;
}

function normalizeTransactionWatchlistSymbols(value) {
  if (!Array.isArray(value)) return [];
  const nextSymbols = [];
  for (const item of value) {
    const source = item && typeof item === "object" ? item.symbol ?? item.ticker ?? item.code : item;
    const symbol = cleanWatchlistSymbol(source);
    if (symbol && !nextSymbols.includes(symbol)) {
      nextSymbols.push(symbol);
    }
  }
  return nextSymbols;
}

function normalizeTransactionWatchlistGroups(value, fallback = fallbackSettings.watchlistGroups) {
  const sourceGroups = Array.isArray(value) ? value : Array.isArray(fallback) ? fallback : [];
  const nextGroups = [];
  const usedIds = new Set();
  for (const [index, item] of sourceGroups.entries()) {
    const source = item && typeof item === "object" ? item : { name: item };
    const name = cleanWatchlistGroupName(source.name ?? source.title ?? source.label);
    if (!name) continue;
    const baseId = cleanWatchlistGroupId(source.id) || `watchlist-${index + 1}`;
    let id = baseId;
    let suffix = 2;
    while (usedIds.has(id)) {
      id = `${baseId}-${suffix}`;
      suffix += 1;
    }
    usedIds.add(id);
    const instruments = normalizeTransactionWatchlistInstruments(source.instruments);
    const symbols = normalizeTransactionWatchlistSymbols(source.symbols ?? source.tickers ?? source.items);
    for (const instrument of instruments) {
      if (!symbols.includes(instrument.symbol)) symbols.push(instrument.symbol);
    }
    nextGroups.push({
      id,
      name,
      createdAt: typeof source.createdAt === "string" ? source.createdAt : "",
      symbols,
      instruments,
    });
  }
  return nextGroups;
}

function normalizeTransactionPortfolioHoldings(value, fallback = fallbackSettings.portfolioHoldings) {
  const source = Array.isArray(value) ? value : Array.isArray(fallback) ? fallback : [];
  const byTicker = new Map();
  for (const item of source) {
    const raw = item && typeof item === "object" ? item : { ticker: item };
    const ticker = cleanWatchlistSymbol(raw.ticker ?? raw.symbol ?? raw.code);
    if (!ticker) continue;
    const numericWeight = Number(raw.weight ?? raw.targetWeight ?? raw.allocation);
    const weight = Number.isFinite(numericWeight)
      ? Math.min(100, Math.max(0.01, Math.round(numericWeight * 100) / 100))
      : null;
    if (weight === null) continue;
    byTicker.set(ticker, {
      ticker,
      weight,
      label: cleanWatchlistInstrumentText(raw.label ?? raw.name, 100) || "간편 보유목록",
      updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : "",
    });
  }
  return [...byTicker.values()];
}

export function preserveTransactionWatchlistInstrumentsForLegacyPatch(value, currentGroups = []) {
  if (!Array.isArray(value)) return value;
  const currentById = new Map(
    normalizeTransactionWatchlistGroups(currentGroups).map((group) => [group.id, group]),
  );
  return value.map((item) => {
    if (!item || typeof item !== "object" || Object.prototype.hasOwnProperty.call(item, "instruments")) {
      return item;
    }
    const groupId = cleanWatchlistGroupId(item.id);
    const currentGroup = currentById.get(groupId);
    if (!currentGroup?.instruments?.length) return item;
    const incomingSymbols = normalizeTransactionWatchlistSymbols(item.symbols ?? item.tickers ?? item.items);
    return {
      ...item,
      instruments: currentGroup.instruments.filter((instrument) => incomingSymbols.includes(instrument.symbol)),
    };
  });
}

export function normalizeTransactionSettings(raw = {}) {
  const source = raw && typeof raw === "object" ? raw : {};
  return {
    version: 2,
    menuHidden: normalizeTransactionBoolean(source.menuHidden, fallbackSettings.menuHidden),
    sidebarDisplayCurrency: normalizeTransactionDisplayCurrency(
      source.sidebarDisplayCurrency ?? source.sidebarUnit ?? source.sidebarCurrency,
      fallbackSettings.sidebarDisplayCurrency
    ),
    mainDisplayCurrency: normalizeTransactionDisplayCurrency(
      source.mainDisplayCurrency ?? source.mainUnit ?? source.mainCurrency,
      fallbackSettings.mainDisplayCurrency
    ),
    sidebarValueMode: normalizeTransactionSidebarValueMode(
      source.sidebarValueMode ?? source.valueMode ?? source.investmentValueMode,
      fallbackSettings.sidebarValueMode
    ),
    investmentChartMode: normalizeTransactionInvestmentChartMode(
      source.investmentChartMode ?? source.investmentDetailChartMode ?? source.chartMode,
      fallbackSettings.investmentChartMode
    ),
    investmentChartIntervalMode: normalizeTransactionInvestmentChartIntervalMode(
      source.investmentChartIntervalMode ?? source.investmentDetailIntervalMode ?? source.chartIntervalMode ?? source.timeframe,
      fallbackSettings.investmentChartIntervalMode
    ),
    investmentChartVolumeVisible: normalizeTransactionBoolean(
      source.investmentChartVolumeVisible ?? source.investmentDetailVolumeVisible ?? source.chartVolumeVisible ?? source.showVolume,
      fallbackSettings.investmentChartVolumeVisible
    ),
    mainTableColumns: normalizeTransactionMainTableColumns(
      source.mainTableColumns ?? source.mainVisibleColumns ?? source.tableColumns,
      fallbackSettings.mainTableColumns
    ),
    sidebarManualOrder: normalizeTransactionSidebarManualOrder(
      source.sidebarManualOrder ?? source.manualSidebarOrder ?? source.sidebarCustomOrder,
      fallbackSettings.sidebarManualOrder
    ),
    watchlistGroups: normalizeTransactionWatchlistGroups(
      source.watchlistGroups ?? source.watchlistFolders ?? source.interestGroups,
      fallbackSettings.watchlistGroups
    ),
    portfolioHoldings: normalizeTransactionPortfolioHoldings(
      source.portfolioHoldings ?? source.quickPortfolioHoldings ?? source.holdings,
      fallbackSettings.portfolioHoldings,
    ),
    updatedAt: typeof source.updatedAt === "string" ? source.updatedAt : "",
  };
}

export function readTransactionSettings() {
  ensureConfigDir();
  return normalizeTransactionSettings({
    ...fallbackSettings,
    ...(readJsonFile(DEFAULT_SETTINGS_PATH) || {}),
    ...(readJsonFile(USER_SETTINGS_PATH) || {}),
  });
}

export function writeTransactionSettingsPatch(patch = {}) {
  ensureConfigDir();
  const source = patch && typeof patch === "object" ? patch : {};
  const hasMenuHidden = Object.prototype.hasOwnProperty.call(source, "menuHidden");
  const hasSidebarDisplayCurrency =
    Object.prototype.hasOwnProperty.call(source, "sidebarDisplayCurrency") ||
    Object.prototype.hasOwnProperty.call(source, "sidebarUnit") ||
    Object.prototype.hasOwnProperty.call(source, "sidebarCurrency");
  const hasMainDisplayCurrency =
    Object.prototype.hasOwnProperty.call(source, "mainDisplayCurrency") ||
    Object.prototype.hasOwnProperty.call(source, "mainUnit") ||
    Object.prototype.hasOwnProperty.call(source, "mainCurrency");
  const hasSidebarValueMode =
    Object.prototype.hasOwnProperty.call(source, "sidebarValueMode") ||
    Object.prototype.hasOwnProperty.call(source, "valueMode") ||
    Object.prototype.hasOwnProperty.call(source, "investmentValueMode");
  const hasInvestmentChartMode =
    Object.prototype.hasOwnProperty.call(source, "investmentChartMode") ||
    Object.prototype.hasOwnProperty.call(source, "investmentDetailChartMode") ||
    Object.prototype.hasOwnProperty.call(source, "chartMode");
  const hasInvestmentChartIntervalMode =
    Object.prototype.hasOwnProperty.call(source, "investmentChartIntervalMode") ||
    Object.prototype.hasOwnProperty.call(source, "investmentDetailIntervalMode") ||
    Object.prototype.hasOwnProperty.call(source, "chartIntervalMode") ||
    Object.prototype.hasOwnProperty.call(source, "timeframe");
  const hasInvestmentChartVolumeVisible =
    Object.prototype.hasOwnProperty.call(source, "investmentChartVolumeVisible") ||
    Object.prototype.hasOwnProperty.call(source, "investmentDetailVolumeVisible") ||
    Object.prototype.hasOwnProperty.call(source, "chartVolumeVisible") ||
    Object.prototype.hasOwnProperty.call(source, "showVolume");
  const hasMainTableColumns =
    Object.prototype.hasOwnProperty.call(source, "mainTableColumns") ||
    Object.prototype.hasOwnProperty.call(source, "mainVisibleColumns") ||
    Object.prototype.hasOwnProperty.call(source, "tableColumns");
  const hasSidebarManualOrder =
    Object.prototype.hasOwnProperty.call(source, "sidebarManualOrder") ||
    Object.prototype.hasOwnProperty.call(source, "manualSidebarOrder") ||
    Object.prototype.hasOwnProperty.call(source, "sidebarCustomOrder");
  const hasWatchlistGroups =
    Object.prototype.hasOwnProperty.call(source, "watchlistGroups") ||
    Object.prototype.hasOwnProperty.call(source, "watchlistFolders") ||
    Object.prototype.hasOwnProperty.call(source, "interestGroups");
  const hasPortfolioHoldings =
    Object.prototype.hasOwnProperty.call(source, "portfolioHoldings") ||
    Object.prototype.hasOwnProperty.call(source, "quickPortfolioHoldings") ||
    Object.prototype.hasOwnProperty.call(source, "holdings");
  if (
    !hasMenuHidden &&
    !hasSidebarDisplayCurrency &&
    !hasMainDisplayCurrency &&
    !hasSidebarValueMode &&
    !hasInvestmentChartMode &&
    !hasInvestmentChartIntervalMode &&
    !hasInvestmentChartVolumeVisible &&
    !hasMainTableColumns &&
    !hasSidebarManualOrder &&
    !hasWatchlistGroups &&
    !hasPortfolioHoldings
  ) {
    throw new Error("menuHidden, sidebarDisplayCurrency, mainDisplayCurrency, sidebarValueMode, investmentChartMode, investmentChartIntervalMode, investmentChartVolumeVisible, mainTableColumns, sidebarManualOrder, watchlistGroups, or portfolioHoldings is required");
  }

  const current = readTransactionSettings();
  const nextSettings = normalizeTransactionSettings({
    ...current,
    ...(hasMenuHidden ? { menuHidden: source.menuHidden } : {}),
    ...(hasSidebarDisplayCurrency
      ? { sidebarDisplayCurrency: source.sidebarDisplayCurrency ?? source.sidebarUnit ?? source.sidebarCurrency }
      : {}),
    ...(hasMainDisplayCurrency
      ? { mainDisplayCurrency: source.mainDisplayCurrency ?? source.mainUnit ?? source.mainCurrency }
      : {}),
    ...(hasSidebarValueMode
      ? { sidebarValueMode: source.sidebarValueMode ?? source.valueMode ?? source.investmentValueMode }
      : {}),
    ...(hasInvestmentChartMode
      ? { investmentChartMode: source.investmentChartMode ?? source.investmentDetailChartMode ?? source.chartMode }
      : {}),
    ...(hasInvestmentChartIntervalMode
      ? {
          investmentChartIntervalMode:
            source.investmentChartIntervalMode ?? source.investmentDetailIntervalMode ?? source.chartIntervalMode ?? source.timeframe,
        }
      : {}),
    ...(hasInvestmentChartVolumeVisible
      ? {
          investmentChartVolumeVisible:
            source.investmentChartVolumeVisible ??
            source.investmentDetailVolumeVisible ??
            source.chartVolumeVisible ??
            source.showVolume,
        }
      : {}),
    ...(hasMainTableColumns
      ? { mainTableColumns: source.mainTableColumns ?? source.mainVisibleColumns ?? source.tableColumns }
      : {}),
    ...(hasSidebarManualOrder
      ? { sidebarManualOrder: source.sidebarManualOrder ?? source.manualSidebarOrder ?? source.sidebarCustomOrder }
      : {}),
    ...(hasWatchlistGroups
      ? {
          watchlistGroups: preserveTransactionWatchlistInstrumentsForLegacyPatch(
            source.watchlistGroups ?? source.watchlistFolders ?? source.interestGroups,
            current.watchlistGroups,
          ),
        }
      : {}),
    ...(hasPortfolioHoldings
      ? {
          portfolioHoldings:
            source.portfolioHoldings ?? source.quickPortfolioHoldings ?? source.holdings,
        }
      : {}),
    updatedAt: new Date().toISOString(),
  });
  const tmpPath = `${USER_SETTINGS_PATH}.tmp`;
  writeFileSync(tmpPath, `${JSON.stringify(nextSettings, null, 2)}\n`);
  renameSync(tmpPath, USER_SETTINGS_PATH);
  return nextSettings;
}

export function addTickerToTransactionWatchlistSettings(currentSettings, {
  ticker,
  groupId = "daily-intelligence",
  groupName = "Daily Intelligence",
} = {}) {
  const symbol = cleanWatchlistSymbol(ticker);
  if (!symbol) throw new Error("추가할 미국 주식 티커가 올바르지 않습니다.");
  const current = normalizeTransactionSettings(currentSettings);
  const existingGroup = current.watchlistGroups.find((group) =>
    group.symbols.includes(symbol));
  if (existingGroup) {
    return {
      added: false,
      ticker: symbol,
      groupId: existingGroup.id,
      groupName: existingGroup.name,
      settings: current,
    };
  }
  const normalizedGroupId = cleanWatchlistGroupId(groupId) || "daily-intelligence";
  const normalizedGroupName = cleanWatchlistGroupName(groupName) || "Daily Intelligence";
  const groups = current.watchlistGroups.map((group) => ({
    ...group,
    symbols: [...group.symbols],
    instruments: [...group.instruments],
  }));
  const targetIndex = groups.findIndex((group) => group.id === normalizedGroupId);
  if (targetIndex === -1) {
    groups.push({
      id: normalizedGroupId,
      name: normalizedGroupName,
      createdAt: new Date().toISOString(),
      symbols: [symbol],
      instruments: [],
    });
  } else {
    groups[targetIndex] = {
      ...groups[targetIndex],
      symbols: [...groups[targetIndex].symbols, symbol],
    };
  }
  const settings = normalizeTransactionSettings({
    ...current,
    watchlistGroups: groups,
  });
  return {
    added: true,
    ticker: symbol,
    groupId: normalizedGroupId,
    groupName: normalizedGroupName,
    settings,
  };
}

export function addTransactionWatchlistTicker(options = {}) {
  const result = addTickerToTransactionWatchlistSettings(
    readTransactionSettings(),
    options,
  );
  if (!result.added) return result;
  return {
    ...result,
    settings: writeTransactionSettingsPatch({
      watchlistGroups: result.settings.watchlistGroups,
    }),
  };
}

export function upsertPortfolioHoldingSettings(currentSettings, {
  ticker,
  weight,
  label = "Daily Intelligence 간편 보유",
} = {}) {
  const symbol = cleanWatchlistSymbol(ticker);
  if (!symbol) throw new Error("등록할 미국 주식 티커가 올바르지 않습니다.");
  const numericWeight = Number(weight);
  if (!Number.isFinite(numericWeight) || numericWeight <= 0 || numericWeight > 100) {
    throw new Error("보유 비중은 0보다 크고 100 이하인 숫자여야 합니다.");
  }
  const current = normalizeTransactionSettings(currentSettings);
  const normalizedWeight = Math.round(numericWeight * 100) / 100;
  const existing = current.portfolioHoldings.find((item) => item.ticker === symbol);
  const projectedTotal = current.portfolioHoldings
    .filter((item) => item.ticker !== symbol)
    .reduce((sum, item) => sum + item.weight, 0) + normalizedWeight;
  if (projectedTotal > 100.0001) {
    throw new Error(`보유 비중 합계가 100%를 초과합니다. 현재 등록 가능 비중은 ${Math.max(
      0,
      100 - current.portfolioHoldings
        .filter((item) => item.ticker !== symbol)
        .reduce((sum, item) => sum + item.weight, 0),
    ).toFixed(2)}%입니다.`);
  }
  const portfolioHoldings = current.portfolioHoldings
    .filter((item) => item.ticker !== symbol)
    .concat({
      ticker: symbol,
      weight: normalizedWeight,
      label: cleanWatchlistInstrumentText(label, 100) || "Daily Intelligence 간편 보유",
      updatedAt: new Date().toISOString(),
    });
  return {
    added: !existing,
    updated: Boolean(existing),
    ticker: symbol,
    weight: normalizedWeight,
    settings: normalizeTransactionSettings({
      ...current,
      portfolioHoldings,
    }),
  };
}

export function upsertTransactionPortfolioHolding(options = {}) {
  const result = upsertPortfolioHoldingSettings(readTransactionSettings(), options);
  return {
    ...result,
    settings: writeTransactionSettingsPatch({
      portfolioHoldings: result.settings.portfolioHoldings,
    }),
  };
}

export function removePortfolioHoldingSettings(currentSettings, { ticker } = {}) {
  const symbol = cleanWatchlistSymbol(ticker);
  if (!symbol) throw new Error("삭제할 미국 주식 티커가 올바르지 않습니다.");
  const current = normalizeTransactionSettings(currentSettings);
  const exists = current.portfolioHoldings.some((item) => item.ticker === symbol);
  return {
    removed: exists,
    ticker: symbol,
    settings: normalizeTransactionSettings({
      ...current,
      portfolioHoldings: current.portfolioHoldings.filter((item) => item.ticker !== symbol),
    }),
  };
}

export function removeTransactionPortfolioHolding(options = {}) {
  const result = removePortfolioHoldingSettings(readTransactionSettings(), options);
  if (!result.removed) return result;
  return {
    ...result,
    settings: writeTransactionSettingsPatch({
      portfolioHoldings: result.settings.portfolioHoldings,
    }),
  };
}

export function publicTransactionSettingsSnapshot() {
  const settings = readTransactionSettings();
  return {
    ok: true,
    configPath: "config/transaction-status.user.json",
    defaultConfigPath: "config/transaction-status.defaults.json",
    settings,
  };
}

export async function handleTransactionSettingsEndpoint(req, res) {
  try {
    if (req.method === "GET") {
      sendJson(res, publicTransactionSettingsSnapshot());
      return;
    }
    if (req.method === "PATCH" || req.method === "POST") {
      const body = await readJsonBody(req);
      writeTransactionSettingsPatch(body);
      sendJson(res, publicTransactionSettingsSnapshot());
      return;
    }
    sendJson(res, { ok: false, error: "method not allowed" }, 405);
  } catch (error) {
    sendJson(res, { ok: false, error: error.message || "transaction settings failed" }, error.statusCode || 400);
  }
}
