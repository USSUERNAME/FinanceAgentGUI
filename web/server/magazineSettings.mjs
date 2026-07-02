import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isWorldMemoryEnabled } from "./worldMemorySettings.mjs";

const WEB_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const GUIBUILD_ROOT = resolve(WEB_ROOT, "..");
const CONFIG_DIR = join(GUIBUILD_ROOT, "config");
const DEFAULT_SETTINGS_PATH = join(CONFIG_DIR, "magazine.defaults.json");
const USER_SETTINGS_PATH = join(CONFIG_DIR, "magazine.user.json");

const fallbackSettings = {
  version: 1,
  enabled: false,
  writingProvider: "default",
  schedulerIntervalHours: 6,
  schedulerMaxArticlesPerCycle: 2,
};

const MODEL_PROVIDER_IDS = new Set(["default", "codex-cli", "antigravity-cli"]);
const DEFAULT_SCHEDULER_INTERVAL_HOURS = 6;
const MIN_SCHEDULER_INTERVAL_HOURS = 1;
const MAX_SCHEDULER_INTERVAL_HOURS = 10;
const DEFAULT_SCHEDULER_MAX_ARTICLES_PER_CYCLE = 2;
const MIN_SCHEDULER_MAX_ARTICLES_PER_CYCLE = 1;
const MAX_SCHEDULER_MAX_ARTICLES_PER_CYCLE = 3;

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

export function normalizeMagazineSchedulerIntervalHours(value, fallback = DEFAULT_SCHEDULER_INTERVAL_HOURS) {
  const number = Number.parseInt(value, 10);
  const safeFallback = Math.max(
    MIN_SCHEDULER_INTERVAL_HOURS,
    Math.min(MAX_SCHEDULER_INTERVAL_HOURS, Number.parseInt(fallback, 10) || DEFAULT_SCHEDULER_INTERVAL_HOURS)
  );
  if (!Number.isFinite(number)) return safeFallback;
  return Math.max(MIN_SCHEDULER_INTERVAL_HOURS, Math.min(MAX_SCHEDULER_INTERVAL_HOURS, number));
}

export function normalizeMagazineSchedulerMaxArticlesPerCycle(
  value,
  fallback = DEFAULT_SCHEDULER_MAX_ARTICLES_PER_CYCLE
) {
  const number = Number.parseInt(value, 10);
  const safeFallback = Math.max(
    MIN_SCHEDULER_MAX_ARTICLES_PER_CYCLE,
    Math.min(
      MAX_SCHEDULER_MAX_ARTICLES_PER_CYCLE,
      Number.parseInt(fallback, 10) || DEFAULT_SCHEDULER_MAX_ARTICLES_PER_CYCLE
    )
  );
  if (!Number.isFinite(number)) return safeFallback;
  return Math.max(
    MIN_SCHEDULER_MAX_ARTICLES_PER_CYCLE,
    Math.min(MAX_SCHEDULER_MAX_ARTICLES_PER_CYCLE, number)
  );
}

function normalizeMagazineSettings(raw = {}) {
  const source = raw && typeof raw === "object" ? raw : {};
  const writingProvider = source.writingProvider || source.authorProvider || fallbackSettings.writingProvider;
  return {
    version: 1,
    enabled: source.enabled === true,
    writingProvider: MODEL_PROVIDER_IDS.has(writingProvider)
      ? writingProvider
      : fallbackSettings.writingProvider,
    schedulerIntervalHours: normalizeMagazineSchedulerIntervalHours(
      source.schedulerIntervalHours ?? source.intervalHours ?? fallbackSettings.schedulerIntervalHours
    ),
    schedulerMaxArticlesPerCycle: normalizeMagazineSchedulerMaxArticlesPerCycle(
      source.schedulerMaxArticlesPerCycle ??
        source.maxArticlesPerCycle ??
        source.maxPerCycle ??
        fallbackSettings.schedulerMaxArticlesPerCycle
    ),
    updatedAt: typeof source.updatedAt === "string" ? source.updatedAt : "",
    disabledReason: typeof source.disabledReason === "string" ? source.disabledReason : "",
  };
}

export function readMagazineSettings() {
  ensureConfigDir();
  return normalizeMagazineSettings({
    ...fallbackSettings,
    ...(readJsonFile(DEFAULT_SETTINGS_PATH) || {}),
    ...(readJsonFile(USER_SETTINGS_PATH) || {}),
  });
}

export function isMagazineEnabled() {
  return isWorldMemoryEnabled() && readMagazineSettings().enabled === true;
}

export function writeMagazineSettingsPatch(patch = {}) {
  ensureConfigDir();
  const source = patch && typeof patch === "object" ? patch : {};
  const hasEnabled = Object.prototype.hasOwnProperty.call(source, "enabled");
  const hasWritingProvider = Object.prototype.hasOwnProperty.call(source, "writingProvider");
  const hasSchedulerIntervalHours = Object.prototype.hasOwnProperty.call(source, "schedulerIntervalHours");
  const hasSchedulerMaxArticlesPerCycle = Object.prototype.hasOwnProperty.call(
    source,
    "schedulerMaxArticlesPerCycle"
  );
  const hasDisabledReason = Object.prototype.hasOwnProperty.call(source, "disabledReason");
  if (
    !hasEnabled &&
    !hasWritingProvider &&
    !hasSchedulerIntervalHours &&
    !hasSchedulerMaxArticlesPerCycle &&
    !hasDisabledReason
  ) {
    throw new Error("enabled, writingProvider, schedulerIntervalHours, or schedulerMaxArticlesPerCycle is required");
  }
  if (hasEnabled && source.enabled === true && !isWorldMemoryEnabled()) {
    const error = new Error("World Memory must be enabled before Magazine can be enabled");
    error.statusCode = 409;
    throw error;
  }

  const currentSettings = readMagazineSettings();
  const nextEnabled = hasEnabled ? source.enabled === true : currentSettings.enabled;
  const nextSettings = normalizeMagazineSettings({
    ...currentSettings,
    enabled: nextEnabled,
    ...(hasWritingProvider ? { writingProvider: source.writingProvider } : {}),
    ...(hasSchedulerIntervalHours ? { schedulerIntervalHours: source.schedulerIntervalHours } : {}),
    ...(hasSchedulerMaxArticlesPerCycle
      ? { schedulerMaxArticlesPerCycle: source.schedulerMaxArticlesPerCycle }
      : {}),
    disabledReason: nextEnabled ? "" : source.disabledReason || currentSettings.disabledReason || "",
    updatedAt: new Date().toISOString(),
  });
  writeFileSync(USER_SETTINGS_PATH, `${JSON.stringify(nextSettings, null, 2)}\n`);
  return nextSettings;
}

export function disableMagazineSettings(disabledReason = "world-memory-disabled") {
  const current = readMagazineSettings();
  if (!current.enabled && current.disabledReason === disabledReason) return current;
  return writeMagazineSettingsPatch({
    enabled: false,
    disabledReason,
  });
}

export function publicMagazineSettingsSnapshot() {
  const settings = readMagazineSettings();
  const worldMemoryEnabled = isWorldMemoryEnabled();
  const enabled = worldMemoryEnabled && settings.enabled;
  return {
    ok: true,
    configPath: "config/magazine.user.json",
    defaultConfigPath: "config/magazine.defaults.json",
    enabled,
    worldMemoryEnabled,
    writingProvider: settings.writingProvider,
    schedulerIntervalHours: settings.schedulerIntervalHours,
    schedulerIntervalMs: settings.schedulerIntervalHours * 60 * 60 * 1000,
    schedulerMaxArticlesPerCycle: settings.schedulerMaxArticlesPerCycle,
    disabledReason: worldMemoryEnabled ? settings.disabledReason : "world-memory-disabled",
    settings: {
      ...settings,
      enabled,
    },
  };
}
