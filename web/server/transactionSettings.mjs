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
    const binanceMatch = /^binance:spot:([a-zA-Z0-9._-]+)$/i.exec(raw);
    const tossMatch = /^toss:stock:([a-zA-Z0-9._-]+)$/i.exec(raw);
    const key = binanceMatch
      ? `binance:spot:${binanceMatch[1].toUpperCase()}`
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

  if (provider === "binance") {
    instrumentId = `binance:spot:${symbol}`;
    venue = "BINANCE_SPOT";
    market = "BINANCE_SPOT";
    assetClass = "crypto";
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
    !hasWatchlistGroups
  ) {
    throw new Error("menuHidden, sidebarDisplayCurrency, mainDisplayCurrency, sidebarValueMode, investmentChartMode, investmentChartIntervalMode, investmentChartVolumeVisible, mainTableColumns, sidebarManualOrder, or watchlistGroups is required");
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
    updatedAt: new Date().toISOString(),
  });
  const tmpPath = `${USER_SETTINGS_PATH}.tmp`;
  writeFileSync(tmpPath, `${JSON.stringify(nextSettings, null, 2)}\n`);
  renameSync(tmpPath, USER_SETTINGS_PATH);
  return nextSettings;
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
