import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeCodexSpeed } from "./agentSpeed.mjs";

const WEB_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const GUIBUILD_ROOT = resolve(WEB_ROOT, "..");
const CONFIG_DIR = join(GUIBUILD_ROOT, "config");
const DEFAULT_SETTINGS_PATH = join(CONFIG_DIR, "world-memory.defaults.json");
const USER_SETTINGS_PATH = join(CONFIG_DIR, "world-memory.user.json");

const fallbackSettings = {
  version: 1,
  enabled: false,
  managementProvider: "default",
  managementModel: "",
  managementReasoning: "",
  managementSpeed: "standard",
};

const MODEL_PROVIDER_IDS = new Set(["default", "codex-cli", "antigravity-cli"]);
const REASONING_LEVEL_IDS = new Set(["minimal", "low", "medium", "high", "xhigh", "max", "ultra"]);

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

export function normalizeWorldMemoryManagementModel(value, fallback = fallbackSettings.managementModel) {
  const candidate = String(value ?? "").trim().replace(/[\r\n\0]/g, "").slice(0, 160);
  if (candidate) return candidate;
  return String(fallback ?? "").trim().replace(/[\r\n\0]/g, "").slice(0, 160);
}

export function normalizeWorldMemoryManagementReasoning(value, fallback = fallbackSettings.managementReasoning) {
  const candidate = String(value ?? "").trim().toLowerCase();
  if (REASONING_LEVEL_IDS.has(candidate)) return candidate;
  const safeFallback = String(fallback ?? "").trim().toLowerCase();
  return REASONING_LEVEL_IDS.has(safeFallback) ? safeFallback : fallbackSettings.managementReasoning;
}

export function normalizeWorldMemoryManagementSpeed(value, fallback = fallbackSettings.managementSpeed) {
  return normalizeCodexSpeed(value, fallback);
}

function normalizeWorldMemorySettings(raw = {}) {
  const source = raw && typeof raw === "object" ? raw : {};
  return {
    version: 1,
    enabled: source.enabled === true,
    managementProvider: MODEL_PROVIDER_IDS.has(source.managementProvider)
      ? source.managementProvider
      : fallbackSettings.managementProvider,
    managementModel: normalizeWorldMemoryManagementModel(source.managementModel ?? source.model),
    managementReasoning: normalizeWorldMemoryManagementReasoning(
      source.managementReasoning ?? source.reasoning
    ),
    managementSpeed: normalizeWorldMemoryManagementSpeed(source.managementSpeed ?? source.speed),
    updatedAt: typeof source.updatedAt === "string" ? source.updatedAt : "",
  };
}

export function readWorldMemorySettings() {
  ensureConfigDir();
  return normalizeWorldMemorySettings({
    ...fallbackSettings,
    ...(readJsonFile(DEFAULT_SETTINGS_PATH) || {}),
    ...(readJsonFile(USER_SETTINGS_PATH) || {}),
  });
}

export function isWorldMemoryEnabled() {
  return readWorldMemorySettings().enabled === true;
}

export function writeWorldMemorySettingsPatch(patch = {}) {
  ensureConfigDir();
  const source = patch && typeof patch === "object" ? patch : {};
  const hasEnabled = Object.prototype.hasOwnProperty.call(source, "enabled");
  const hasManagementProvider = Object.prototype.hasOwnProperty.call(source, "managementProvider");
  const hasManagementModel = Object.prototype.hasOwnProperty.call(source, "managementModel");
  const hasManagementReasoning = Object.prototype.hasOwnProperty.call(source, "managementReasoning");
  const hasManagementSpeed = Object.prototype.hasOwnProperty.call(source, "managementSpeed");
  if (!hasEnabled && !hasManagementProvider && !hasManagementModel && !hasManagementReasoning && !hasManagementSpeed) {
    throw new Error("enabled, managementProvider, managementModel, managementReasoning, or managementSpeed is required");
  }

  const nextSettings = normalizeWorldMemorySettings({
    ...readWorldMemorySettings(),
    ...(hasEnabled ? { enabled: source.enabled === true } : {}),
    ...(hasManagementProvider ? { managementProvider: source.managementProvider } : {}),
    ...(hasManagementModel ? { managementModel: source.managementModel } : {}),
    ...(hasManagementReasoning ? { managementReasoning: source.managementReasoning } : {}),
    ...(hasManagementSpeed ? { managementSpeed: source.managementSpeed } : {}),
    updatedAt: new Date().toISOString(),
  });
  writeFileSync(USER_SETTINGS_PATH, `${JSON.stringify(nextSettings, null, 2)}\n`);
  return nextSettings;
}

export function publicWorldMemorySettingsSnapshot() {
  const settings = readWorldMemorySettings();
  return {
    ok: true,
    configPath: "config/world-memory.user.json",
    defaultConfigPath: "config/world-memory.defaults.json",
    enabled: settings.enabled,
    managementProvider: settings.managementProvider,
    managementModel: settings.managementModel,
    managementReasoning: settings.managementReasoning,
    managementSpeed: settings.managementSpeed,
    settings,
  };
}
