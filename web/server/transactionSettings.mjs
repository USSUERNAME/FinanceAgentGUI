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
  version: 1,
  sidebarDisplayCurrency: "auto",
  mainDisplayCurrency: "auto",
  mainTableColumns: [],
  sidebarManualOrder: [],
  watchlistGroups: [],
};

const DISPLAY_CURRENCY_IDS = new Set(["auto", "KRW", "USD"]);
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
  const nextSymbols = [];
  for (const item of value) {
    const symbol = String(item || "").trim().toUpperCase();
    if (symbol && !nextSymbols.includes(symbol)) {
      nextSymbols.push(symbol);
    }
  }
  return nextSymbols;
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
    nextGroups.push({
      id,
      name,
      createdAt: typeof source.createdAt === "string" ? source.createdAt : "",
      symbols: normalizeTransactionWatchlistSymbols(source.symbols ?? source.tickers ?? source.items),
    });
  }
  return nextGroups;
}

function normalizeTransactionSettings(raw = {}) {
  const source = raw && typeof raw === "object" ? raw : {};
  return {
    version: 1,
    sidebarDisplayCurrency: normalizeTransactionDisplayCurrency(
      source.sidebarDisplayCurrency ?? source.sidebarUnit ?? source.sidebarCurrency,
      fallbackSettings.sidebarDisplayCurrency
    ),
    mainDisplayCurrency: normalizeTransactionDisplayCurrency(
      source.mainDisplayCurrency ?? source.mainUnit ?? source.mainCurrency,
      fallbackSettings.mainDisplayCurrency
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
  const hasSidebarDisplayCurrency =
    Object.prototype.hasOwnProperty.call(source, "sidebarDisplayCurrency") ||
    Object.prototype.hasOwnProperty.call(source, "sidebarUnit") ||
    Object.prototype.hasOwnProperty.call(source, "sidebarCurrency");
  const hasMainDisplayCurrency =
    Object.prototype.hasOwnProperty.call(source, "mainDisplayCurrency") ||
    Object.prototype.hasOwnProperty.call(source, "mainUnit") ||
    Object.prototype.hasOwnProperty.call(source, "mainCurrency");
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
    !hasSidebarDisplayCurrency &&
    !hasMainDisplayCurrency &&
    !hasMainTableColumns &&
    !hasSidebarManualOrder &&
    !hasWatchlistGroups
  ) {
    throw new Error("sidebarDisplayCurrency, mainDisplayCurrency, mainTableColumns, sidebarManualOrder, or watchlistGroups is required");
  }

  const current = readTransactionSettings();
  const nextSettings = normalizeTransactionSettings({
    ...current,
    ...(hasSidebarDisplayCurrency
      ? { sidebarDisplayCurrency: source.sidebarDisplayCurrency ?? source.sidebarUnit ?? source.sidebarCurrency }
      : {}),
    ...(hasMainDisplayCurrency
      ? { mainDisplayCurrency: source.mainDisplayCurrency ?? source.mainUnit ?? source.mainCurrency }
      : {}),
    ...(hasMainTableColumns
      ? { mainTableColumns: source.mainTableColumns ?? source.mainVisibleColumns ?? source.tableColumns }
      : {}),
    ...(hasSidebarManualOrder
      ? { sidebarManualOrder: source.sidebarManualOrder ?? source.manualSidebarOrder ?? source.sidebarCustomOrder }
      : {}),
    ...(hasWatchlistGroups
      ? { watchlistGroups: source.watchlistGroups ?? source.watchlistFolders ?? source.interestGroups }
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
