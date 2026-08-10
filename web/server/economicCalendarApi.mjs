import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getCodexOptions, readJsonBody, runAntigravityGenerate, sendJson } from "./codexProbe.mjs";
import {
  ANTIGRAVITY_TRANSLATION_FALLBACK_MODEL,
  ANTIGRAVITY_TRANSLATION_REASONING,
  selectAntigravityModelForReasoning,
} from "../src/agent/antigravityModelSelection.js";
import { selectCodexTranslationModel } from "../src/agent/codexTranslationModelSelection.js";
import { spawnObservedLlm, waitForLlmObservation } from "./llmProcessObserver.mjs";

const WEB_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const GUIBUILD_ROOT = resolve(WEB_ROOT, "..");
const DATA_DIR = join(GUIBUILD_ROOT, "data");
const ECONOMIC_STORE_PATH = join(DATA_DIR, "economic-calendar-cache.json");
const ECONOMIC_SETTINGS_PATH = join(DATA_DIR, "economic-calendar-settings.json");
const ECONOMIC_TRANSLATION_MEMORY_PATH = join(DATA_DIR, "economic-calendar-translation-memory.json");
const ECONOMIC_OFFICIAL_FALLBACK_SOURCES = [
  {
    id: "bls-release-calendar",
    title: "미국 노동통계국(BLS) 발표 일정",
    url: "https://www.bls.gov/schedule/",
    scope: "CPI·PPI·고용",
  },
  {
    id: "federal-reserve-calendar",
    title: "미국 연방준비제도 일정",
    url: "https://www.federalreserve.gov/newsevents/calendar.htm",
    scope: "FOMC·연준 연설",
  },
  {
    id: "bea-release-calendar",
    title: "미국 경제분석국(BEA) 발표 일정",
    url: "https://www.bea.gov/news/schedule",
    scope: "GDP·PCE·국민계정",
  },
];
const DEFAULT_DAYS = 6;
const DEFAULT_LIMIT = 100;
const MAX_DAYS = 45;
const MAX_LIMIT = 100;
const ECONOMIC_FETCH_MAX_PAGES = 20;
const CACHE_TTL_MS = 15 * 60 * 1000;
const ECONOMIC_FETCH_TIMEOUT_MS = 45000;
const ECONOMIC_TRANSLATION_TIMEOUT_MS = 60000;
const ECONOMIC_TRANSLATION_BATCH_SIZE = 12;
const ECONOMIC_TRANSLATION_TITLE_MAX_CHARS = 220;
const ECONOMIC_UNTRANSLATED_COPY_LATIN_WORDS = 2;
const FINALIZED_CACHE_AFTER_HOURS = 24;
const FINALIZED_CACHE_AFTER_MS = FINALIZED_CACHE_AFTER_HOURS * 60 * 60 * 1000;
const ANTIGRAVITY_PROVIDER_ID = "antigravity-cli";
const configuredRuntimePython = String(process.env.PB_DAILY_INTELLIGENCE_PYTHON || "").trim();
const runtimeCaBundle = configuredRuntimePython
  ? join(dirname(configuredRuntimePython), "Lib", "site-packages", "pip", "_vendor", "certifi", "cacert.pem")
  : "";
const safeRuntimeCaBundle = runtimeCaBundle && existsSync(runtimeCaBundle) ? runtimeCaBundle : "";
const PYTHON_UTF8_ENV = {
  ...process.env,
  PYTHONIOENCODING: "utf-8",
  PYTHONUTF8: "1",
  PYTHONUNBUFFERED: "1",
  ...(safeRuntimeCaBundle ? {
    CURL_CA_BUNDLE: safeRuntimeCaBundle,
    REQUESTS_CA_BUNDLE: safeRuntimeCaBundle,
    SSL_CERT_FILE: safeRuntimeCaBundle,
  } : {}),
};

const cache = new Map();
const translationRuntimeKey = Symbol.for("financeAgentGui.economicCalendarTranslations");

const fallbackEconomicCalendarSettings = {
  version: 1,
  updatedAt: "",
  countryFilter: {
    selectedCountryCodes: [],
  },
};

const ECONOMIC_COUNTRY_CODE_ALIASES = Object.freeze({
  EA: "EMU",
  EZ: "EMU",
  UK: "GB",
});

const ECONOMIC_COUNTRY_LABELS = Object.freeze({
  AE: ["아랍에미리트", "🇦🇪"],
  AR: ["아르헨티나", "🇦🇷"],
  AT: ["오스트리아", "🇦🇹"],
  AU: ["호주", "🇦🇺"],
  BE: ["벨기에", "🇧🇪"],
  BG: ["불가리아", "🇧🇬"],
  BH: ["바레인", "🇧🇭"],
  BR: ["브라질", "🇧🇷"],
  CA: ["캐나다", "🇨🇦"],
  CH: ["스위스", "🇨🇭"],
  CL: ["칠레", "🇨🇱"],
  CN: ["중국 본토", "🇨🇳"],
  CO: ["콜롬비아", "🇨🇴"],
  CY: ["키프로스", "🇨🇾"],
  CZ: ["체코", "🇨🇿"],
  DE: ["독일", "🇩🇪"],
  DK: ["덴마크", "🇩🇰"],
  EA: ["유로존", "🇪🇺"],
  EE: ["에스토니아", "🇪🇪"],
  EG: ["이집트", "🇪🇬"],
  EMU: ["유로존", "🇪🇺"],
  ES: ["스페인", "🇪🇸"],
  EU: ["유럽연합", "🇪🇺"],
  EZ: ["유로존", "🇪🇺"],
  FI: ["핀란드", "🇫🇮"],
  FR: ["프랑스", "🇫🇷"],
  GB: ["영국", "🇬🇧"],
  GH: ["가나", "🇬🇭"],
  GR: ["그리스", "🇬🇷"],
  HK: ["홍콩", "🇭🇰"],
  HR: ["크로아티아", "🇭🇷"],
  HU: ["헝가리", "🇭🇺"],
  ID: ["인도네시아", "🇮🇩"],
  IE: ["아일랜드", "🇮🇪"],
  IL: ["이스라엘", "🇮🇱"],
  IN: ["인도", "🇮🇳"],
  IS: ["아이슬란드", "🇮🇸"],
  IT: ["이탈리아", "🇮🇹"],
  JP: ["일본", "🇯🇵"],
  KE: ["케냐", "🇰🇪"],
  KR: ["대한민국", "🇰🇷"],
  KW: ["쿠웨이트", "🇰🇼"],
  LT: ["리투아니아", "🇱🇹"],
  LU: ["룩셈부르크", "🇱🇺"],
  LV: ["라트비아", "🇱🇻"],
  MT: ["몰타", "🇲🇹"],
  MX: ["멕시코", "🇲🇽"],
  MW: ["말라위", "🇲🇼"],
  MY: ["말레이시아", "🇲🇾"],
  MZ: ["모잠비크", "🇲🇿"],
  NG: ["나이지리아", "🇳🇬"],
  NL: ["네덜란드", "🇳🇱"],
  NO: ["노르웨이", "🇳🇴"],
  NZ: ["뉴질랜드", "🇳🇿"],
  OM: ["오만", "🇴🇲"],
  PE: ["페루", "🇵🇪"],
  PH: ["필리핀", "🇵🇭"],
  PL: ["폴란드", "🇵🇱"],
  PT: ["포르투갈", "🇵🇹"],
  QA: ["카타르", "🇶🇦"],
  RO: ["루마니아", "🇷🇴"],
  RU: ["러시아", "🇷🇺"],
  SA: ["사우디아라비아", "🇸🇦"],
  SE: ["스웨덴", "🇸🇪"],
  SG: ["싱가포르", "🇸🇬"],
  SI: ["슬로베니아", "🇸🇮"],
  SK: ["슬로바키아", "🇸🇰"],
  TH: ["태국", "🇹🇭"],
  TR: ["튀르키예", "🇹🇷"],
  TZ: ["탄자니아", "🇹🇿"],
  TW: ["대만", "🇹🇼"],
  UG: ["우간다", "🇺🇬"],
  UA: ["우크라이나", "🇺🇦"],
  UK: ["영국", "🇬🇧"],
  US: ["미국", "🇺🇸"],
  VN: ["베트남", "🇻🇳"],
  ZA: ["남아프리카공화국", "🇿🇦"],
  ZM: ["잠비아", "🇿🇲"],
});

function clampNumber(value, fallback, min, max) {
  if (value === null || value === undefined || value === "") return fallback;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(numeric)));
}

function normalizeEconomicCountryCode(value) {
  const code = String(value || "").trim().toUpperCase().replace(/\s+/g, "");
  return ECONOMIC_COUNTRY_CODE_ALIASES[code] || code;
}

function normalizeSelectedCountryCodes(value) {
  const rawCodes = Array.isArray(value) ? value : [];
  return [...new Set(rawCodes.map(normalizeEconomicCountryCode).filter(Boolean))]
    .slice(0, 250)
    .sort((left, right) => left.localeCompare(right));
}

function normalizeEconomicCalendarSettings(raw = {}) {
  const source = raw && typeof raw === "object" ? raw : {};
  const countryFilter = source.countryFilter && typeof source.countryFilter === "object"
    ? source.countryFilter
    : {};
  return {
    version: 1,
    updatedAt: typeof source.updatedAt === "string" ? source.updatedAt : "",
    countryFilter: {
      selectedCountryCodes: normalizeSelectedCountryCodes(countryFilter.selectedCountryCodes),
    },
  };
}

function readEconomicCalendarSettings() {
  if (!existsSync(ECONOMIC_SETTINGS_PATH)) return normalizeEconomicCalendarSettings(fallbackEconomicCalendarSettings);

  try {
    return normalizeEconomicCalendarSettings({
      ...fallbackEconomicCalendarSettings,
      ...JSON.parse(readFileSync(ECONOMIC_SETTINGS_PATH, "utf8")),
    });
  } catch {
    return normalizeEconomicCalendarSettings(fallbackEconomicCalendarSettings);
  }
}

function writeEconomicCalendarSettingsPatch(patch = {}) {
  const source = patch && typeof patch === "object" ? patch : {};
  const rawCountryFilter = source.countryFilter && typeof source.countryFilter === "object"
    ? source.countryFilter
    : source;
  const nextSettings = normalizeEconomicCalendarSettings({
    ...readEconomicCalendarSettings(),
    updatedAt: new Date().toISOString(),
    countryFilter: {
      selectedCountryCodes: normalizeSelectedCountryCodes(rawCountryFilter.selectedCountryCodes),
    },
  });

  mkdirSync(DATA_DIR, { recursive: true });
  const tmpPath = `${ECONOMIC_SETTINGS_PATH}.tmp`;
  writeFileSync(tmpPath, `${JSON.stringify(nextSettings, null, 2)}\n`);
  renameSync(tmpPath, ECONOMIC_SETTINGS_PATH);
  return nextSettings;
}

function publicEconomicCalendarSettingsSnapshot() {
  const settings = readEconomicCalendarSettings();
  return {
    ok: true,
    configPath: "data/economic-calendar-settings.json",
    settings,
  };
}

function emptyEconomicTranslationMemory() {
  return {
    version: 1,
    source: "economic-calendar-event-name",
    updatedAt: "",
    entries: {},
  };
}

function normalizeEconomicEventNameKey(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeEconomicTranslationEntry(key, entry = {}) {
  const sourceText = normalizeEconomicEventNameKey(entry.sourceText || key);
  const textKo = String(entry.textKo || "").trim();
  const rawStatus = String(entry.status || "").trim();
  const status = textKo
    ? "translated"
    : ["pending", "translating", "failed"].includes(rawStatus)
      ? rawStatus === "translating" ? "pending" : rawStatus
      : "pending";

  return {
    sourceText,
    textKo,
    status,
    firstSeenAt: typeof entry.firstSeenAt === "string" ? entry.firstSeenAt : "",
    lastSeenAt: typeof entry.lastSeenAt === "string" ? entry.lastSeenAt : "",
    hitCount: Number.isFinite(Number(entry.hitCount)) ? Math.max(0, Number(entry.hitCount)) : 0,
    translatedAt: typeof entry.translatedAt === "string" ? entry.translatedAt : "",
    model: typeof entry.model === "string" ? entry.model : "",
    reasoning: typeof entry.reasoning === "string" ? entry.reasoning : "",
    attempts: Number.isFinite(Number(entry.attempts)) ? Math.max(0, Number(entry.attempts)) : 0,
    lastAttemptAt: typeof entry.lastAttemptAt === "string" ? entry.lastAttemptAt : "",
    error: typeof entry.error === "string" ? entry.error : "",
  };
}

export function normalizeEconomicTranslationMemory(raw = {}) {
  const source = raw && typeof raw === "object" ? raw : {};
  const rawEntries = source.entries && typeof source.entries === "object" ? source.entries : {};
  const entries = {};
  for (const [rawKey, rawEntry] of Object.entries(rawEntries)) {
    const key = normalizeEconomicEventNameKey(rawKey);
    if (!key) continue;
    entries[key] = normalizeEconomicTranslationEntry(key, rawEntry);
  }
  return {
    ...emptyEconomicTranslationMemory(),
    updatedAt: typeof source.updatedAt === "string" ? source.updatedAt : "",
    entries,
  };
}

function readEconomicTranslationMemory() {
  if (!existsSync(ECONOMIC_TRANSLATION_MEMORY_PATH)) return emptyEconomicTranslationMemory();

  try {
    return normalizeEconomicTranslationMemory(JSON.parse(readFileSync(ECONOMIC_TRANSLATION_MEMORY_PATH, "utf8")));
  } catch {
    return emptyEconomicTranslationMemory();
  }
}

function writeEconomicTranslationMemory(memory) {
  mkdirSync(DATA_DIR, { recursive: true });
  const nextMemory = normalizeEconomicTranslationMemory({
    ...memory,
    updatedAt: new Date().toISOString(),
  });
  const tmpPath = `${ECONOMIC_TRANSLATION_MEMORY_PATH}.tmp`;
  writeFileSync(tmpPath, `${JSON.stringify(nextMemory, null, 2)}\n`);
  renameSync(tmpPath, ECONOMIC_TRANSLATION_MEMORY_PATH);
  return nextMemory;
}

function economicEventNameStrings(events = []) {
  const names = [];
  for (const event of Array.isArray(events) ? events : []) {
    const name = normalizeEconomicEventNameKey(typeof event === "string" ? event : event?.eventName);
    if (name) names.push(name);
  }
  return [...new Set(names)];
}

export function mergeEconomicEventNamesIntoTranslationMemory(memory, events, now = new Date().toISOString()) {
  const nextMemory = normalizeEconomicTranslationMemory(memory);
  let changed = false;

  for (const sourceText of economicEventNameStrings(events)) {
    const key = normalizeEconomicEventNameKey(sourceText);
    if (!key) continue;
    const previous = nextMemory.entries[key];
    if (!previous) {
      nextMemory.entries[key] = normalizeEconomicTranslationEntry(key, {
        sourceText,
        status: "pending",
        firstSeenAt: now,
        lastSeenAt: now,
        hitCount: 1,
      });
      changed = true;
      continue;
    }

    const nextEntry = {
      ...previous,
      sourceText: previous.sourceText || sourceText,
      firstSeenAt: previous.firstSeenAt || now,
      lastSeenAt: now,
      hitCount: Number(previous.hitCount || 0) + 1,
    };
    if (JSON.stringify(nextEntry) !== JSON.stringify(previous)) {
      nextMemory.entries[key] = nextEntry;
      changed = true;
    }
  }

  return { memory: nextMemory, changed };
}

function ensureEconomicEventNameTranslationMemory(events = []) {
  const { memory, changed } = mergeEconomicEventNamesIntoTranslationMemory(readEconomicTranslationMemory(), events);
  return changed ? writeEconomicTranslationMemory(memory) : memory;
}

function economicTranslationRuntime() {
  if (!globalThis[translationRuntimeKey]) {
    globalThis[translationRuntimeKey] = {
      inFlight: null,
      lastStartedAt: "",
      lastFinishedAt: "",
      lastError: "",
    };
  }
  return globalThis[translationRuntimeKey];
}

function economicTranslationMemoryStats(memory = readEconomicTranslationMemory()) {
  const entries = Object.values(normalizeEconomicTranslationMemory(memory).entries);
  const runtime = economicTranslationRuntime();
  return {
    path: "data/economic-calendar-translation-memory.json",
    totalCount: entries.length,
    translatedCount: entries.filter((entry) => entry.status === "translated" && entry.textKo).length,
    pendingCount: entries.filter((entry) => entry.status === "pending").length,
    failedCount: entries.filter((entry) => entry.status === "failed").length,
    inFlight: Boolean(runtime.inFlight),
    lastStartedAt: runtime.lastStartedAt,
    lastFinishedAt: runtime.lastFinishedAt,
    lastError: runtime.lastError,
    updatedAt: memory.updatedAt || "",
  };
}

function publicEconomicTranslationMemorySnapshot({ limit = 300 } = {}) {
  const memory = readEconomicTranslationMemory();
  const entries = Object.entries(memory.entries)
    .map(([key, entry]) => ({ key, ...entry }))
    .sort((left, right) =>
      String(right.lastSeenAt || "").localeCompare(String(left.lastSeenAt || "")) ||
      String(left.sourceText || "").localeCompare(String(right.sourceText || ""))
    )
    .slice(0, Math.max(1, Math.min(1000, Number(limit) || 300)));

  return {
    ok: true,
    translationMemory: {
      ...economicTranslationMemoryStats(memory),
      entries,
    },
  };
}

export function applyEconomicEventNameTranslations(events = [], memory = readEconomicTranslationMemory()) {
  const entries = normalizeEconomicTranslationMemory(memory).entries;
  return (Array.isArray(events) ? events : []).map((event) => {
    const key = normalizeEconomicEventNameKey(event?.eventName);
    const entry = key ? entries[key] : null;
    return {
      ...event,
      eventNameKo: entry?.status === "translated" ? entry.textKo || "" : "",
      eventNameTranslationStatus: entry?.status || (key ? "pending" : ""),
      eventNameTranslationModel: entry?.model || "",
      eventNameTranslationReasoning: entry?.reasoning || "",
      eventNameTranslationError: entry?.error || "",
    };
  });
}

function latestAntigravityTranslationModel(options) {
  const catalogModels = Array.isArray(options.antigravityModelCatalog?.models)
    ? options.antigravityModelCatalog.models.filter((item) => item?.selectable && item?.name)
    : [];
  return selectAntigravityModelForReasoning(catalogModels, {
    cliVersion: options.antigravity?.version || "",
    currentModel:
      options.agentSettings?.settings?.providers?.[ANTIGRAVITY_PROVIDER_ID]?.model ||
      options.selected?.model ||
      options.antigravity?.defaultModel ||
      ANTIGRAVITY_TRANSLATION_FALLBACK_MODEL,
  });
}

function codexEconomicTranslationModel(options) {
  const selection = selectCodexTranslationModel({
    cliVersion: options.codex?.version,
    models: options.modelGroups,
  });

  return {
    provider: "codex-cli",
    providerLabel: "Codex CLI",
    ...selection,
  };
}

function antigravityEconomicTranslationModel(options) {
  const status = options.antigravity || {};
  if (!status.ready) {
    throw new Error(status.detail || status.error || "Antigravity CLI가 번역에 사용할 준비가 되지 않았습니다.");
  }

  const model = latestAntigravityTranslationModel(options);
  return {
    provider: ANTIGRAVITY_PROVIDER_ID,
    providerLabel: "Antigravity CLI",
    model,
    modelLabel: `Antigravity CLI · ${model}`,
    reasoning: ANTIGRAVITY_TRANSLATION_REASONING,
  };
}

function chooseEconomicTranslationModel() {
  const options = getCodexOptions();
  const selectedProvider = options.selected?.provider || "";

  if (selectedProvider === ANTIGRAVITY_PROVIDER_ID) {
    return antigravityEconomicTranslationModel(options);
  }

  if (!options.codex?.available) {
    throw new Error(options.codex?.error || "codex command not found");
  }

  return codexEconomicTranslationModel(options);
}

function truncateEconomicTranslationText(value) {
  const text = normalizeEconomicEventNameKey(value);
  if (text.length <= ECONOMIC_TRANSLATION_TITLE_MAX_CHARS) return text;
  return `${text.slice(0, ECONOMIC_TRANSLATION_TITLE_MAX_CHARS).trim()} ... [truncated]`;
}

function economicEventNameTranslationPrompt(items) {
  const input = items.map((item) => ({
    id: item.id,
    eventName: truncateEconomicTranslationText(item.sourceText),
  }));

  return [
    "경제 캘린더 이벤트명을 한국어로 번역한다.",
    "출력은 JSON 객체 하나만 반환한다.",
    "입력 문자열의 의미를 보존하고, 거시경제/중앙은행/시장 지표 용어는 한국 투자자가 읽기 자연스럽게 옮긴다.",
    "요약하지 말고 이벤트명만 번역한다. 별표(*)나 약어가 원문에 있으면 필요한 경우 보존한다.",
    "없는 정보를 추가하지 않는다.",
    "",
    "반환 형식:",
    '{"translations":[{"id":"입력 id","textKo":"한국어 이벤트명"}]}',
    "",
    "입력 JSON:",
    JSON.stringify({ items: input }, null, 2),
  ].join("\n");
}

function parseTranslationJsonPayload(text) {
  const raw = String(text || "").trim();
  if (!raw) throw new Error("번역 응답이 비어 있습니다.");
  try {
    return JSON.parse(raw);
  } catch {
    const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced) return JSON.parse(fenced[1]);
    const objectMatch = raw.match(/\{[\s\S]*\}/);
    if (objectMatch) return JSON.parse(objectMatch[0]);
    throw new Error("번역 응답을 JSON으로 해석하지 못했습니다.");
  }
}

function compactEconomicTranslationText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function sameEconomicTranslationText(left, right) {
  const normalizedLeft = compactEconomicTranslationText(left).toLocaleLowerCase("en-US");
  const normalizedRight = compactEconomicTranslationText(right).toLocaleLowerCase("en-US");
  return normalizedLeft && normalizedLeft === normalizedRight;
}

function economicTextLikelyNeedsKorean(value) {
  const text = compactEconomicTranslationText(value);
  if (!text || /[가-힣]/.test(text)) return false;
  const latinWords = text.match(/[A-Za-z][A-Za-z'.-]{1,}/g) || [];
  return latinWords.length >= ECONOMIC_UNTRANSLATED_COPY_LATIN_WORDS;
}

function hasKoreanText(value) {
  return /[가-힣]/.test(String(value || ""));
}

export function normalizeEconomicTranslationCandidate(item = {}, translation = {}) {
  const sourceText = compactEconomicTranslationText(item.sourceText);
  const textKo = compactEconomicTranslationText(translation?.textKo);
  const issues = [];

  if (sourceText && !textKo) issues.push("textKo가 비어 있습니다");
  if (sourceText && textKo && economicTextLikelyNeedsKorean(sourceText) && !hasKoreanText(textKo)) {
    issues.push("textKo에 한국어가 없습니다");
  }
  if (sourceText && textKo && economicTextLikelyNeedsKorean(sourceText) && sameEconomicTranslationText(sourceText, textKo)) {
    issues.push("textKo가 원문과 같습니다");
  }

  return {
    ok: issues.length === 0,
    textKo,
    error: issues.length ? `번역 검증 보류: ${issues.join(", ")}` : "",
  };
}

function runCodexEconomicTranslationBatch(items, modelInfo) {
  return new Promise((resolveBatch, reject) => {
    const tempDir = mkdtempSync(join(tmpdir(), "finance-agent-economic-calendar-"));
    const outputPath = join(tempDir, "translation.json");
    const schemaPath = join(tempDir, "schema.json");
    const schema = {
      type: "object",
      additionalProperties: false,
      properties: {
        translations: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              id: { type: "string" },
              textKo: { type: "string" },
            },
            required: ["id", "textKo"],
          },
        },
      },
      required: ["translations"],
    };
    writeFileSync(schemaPath, `${JSON.stringify(schema, null, 2)}\n`);

    const args = [
      "--ask-for-approval",
      "never",
      "exec",
      "--skip-git-repo-check",
      "--ephemeral",
      "--ignore-rules",
      "-C",
      WEB_ROOT,
      "-s",
      "read-only",
      "-m",
      modelInfo.model,
      "-c",
      `model_reasoning_effort="${modelInfo.reasoning}"`,
      "--output-schema",
      schemaPath,
      "-o",
      outputPath,
      economicEventNameTranslationPrompt(items),
    ];

    let stdout = "";
    let stderr = "";
    let settled = false;
    const child = spawnObservedLlm("codex", args, {
      cwd: WEB_ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        NO_COLOR: "1",
      },
    }, {
      feature: "economic-calendar-translation",
      provider: "codex-cli",
      model: modelInfo.model,
      timeoutMs: ECONOMIC_TRANSLATION_TIMEOUT_MS,
    });

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGTERM");
      rmSync(tempDir, { recursive: true, force: true });
      reject(new Error("경제 캘린더 이벤트명 번역 시간이 초과되었습니다."));
    }, ECONOMIC_TRANSLATION_TIMEOUT_MS);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      rmSync(tempDir, { recursive: true, force: true });
      reject(error);
    });

    child.on("close", async (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        await waitForLlmObservation(child);
        const output = existsSync(outputPath) ? readFileSync(outputPath, "utf8") : stdout;
        if (code !== 0) throw new Error((stderr || output || `codex exited ${code}`).trim());
        resolveBatch(parseTranslationJsonPayload(output));
      } catch (error) {
        reject(error);
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });
  });
}

async function runAntigravityEconomicTranslationBatch(items, modelInfo) {
  const result = await runAntigravityGenerate({
    prompt: economicEventNameTranslationPrompt(items),
    model: modelInfo.model,
    approval: "default",
    timeoutMs: ECONOMIC_TRANSLATION_TIMEOUT_MS,
    observationFeature: "economic-calendar-translation",
  });
  return parseTranslationJsonPayload(result.answer);
}

async function translateEconomicEventNames(items) {
  if (!items.length) return { translations: [], model: "", reasoning: "" };
  const modelInfo = chooseEconomicTranslationModel();
  const translations = [];

  for (let index = 0; index < items.length; index += ECONOMIC_TRANSLATION_BATCH_SIZE) {
    const batch = items.slice(index, index + ECONOMIC_TRANSLATION_BATCH_SIZE);
    const payload =
      modelInfo.provider === ANTIGRAVITY_PROVIDER_ID
        ? await runAntigravityEconomicTranslationBatch(batch, modelInfo)
        : await runCodexEconomicTranslationBatch(batch, modelInfo);
    translations.push(...(Array.isArray(payload.translations) ? payload.translations : []));
  }

  return {
    translations,
    model: modelInfo.modelLabel || modelInfo.model,
    reasoning: modelInfo.reasoning,
  };
}

function pendingEconomicTranslationItems(memory) {
  return Object.entries(normalizeEconomicTranslationMemory(memory).entries)
    .map(([key, entry]) => ({ id: key, key, sourceText: entry.sourceText || key, entry }))
    .filter((item) => item.entry.status === "pending" && !item.entry.textKo)
    .sort((left, right) =>
      String(right.entry.lastSeenAt || "").localeCompare(String(left.entry.lastSeenAt || "")) ||
      left.sourceText.localeCompare(right.sourceText)
    );
}

function economicTranslationAutoRunEnabled() {
  return process.env.ECONOMIC_CALENDAR_TRANSLATION_DISABLED !== "1";
}

function startPendingEconomicEventNameTranslation() {
  if (!economicTranslationAutoRunEnabled()) return null;
  const runtime = economicTranslationRuntime();
  if (runtime.inFlight) return runtime.inFlight;

  runtime.inFlight = (async () => {
    while (true) {
      let memory = readEconomicTranslationMemory();
      const pendingItems = pendingEconomicTranslationItems(memory);
      if (!pendingItems.length) break;

      const startedAt = new Date().toISOString();
      runtime.lastStartedAt = startedAt;
      runtime.lastError = "";
      memory.entries = {
        ...memory.entries,
        ...Object.fromEntries(
          pendingItems.map((item) => [
            item.key,
            {
              ...item.entry,
              status: "translating",
              attempts: Number(item.entry.attempts || 0) + 1,
              lastAttemptAt: startedAt,
              error: "",
            },
          ])
        ),
      };
      memory = writeEconomicTranslationMemory(memory);

      try {
        const translated = await translateEconomicEventNames(pendingItems);
        const translationById = new Map(
          translated.translations.map((item) => [normalizeEconomicEventNameKey(item.id), item])
        );
        const translatedAt = new Date().toISOString();
        memory = readEconomicTranslationMemory();
        let retryCount = 0;
        for (const item of pendingItems) {
          const entry = memory.entries[item.key] || item.entry;
          const translation = translationById.get(item.key);
          const candidate = normalizeEconomicTranslationCandidate(item, translation);
          if (!candidate.ok) retryCount += 1;
          memory.entries[item.key] = {
            ...entry,
            status: candidate.ok ? "translated" : "pending",
            textKo: candidate.ok ? candidate.textKo : "",
            translatedAt: candidate.ok ? translatedAt : entry.translatedAt || "",
            model: translated.model || entry.model || "",
            reasoning: translated.reasoning || entry.reasoning || "",
            error: candidate.error,
          };
        }
        writeEconomicTranslationMemory(memory);
        if (retryCount) break;
      } catch (error) {
        runtime.lastError = error.message || "경제 캘린더 이벤트명 번역 실패";
        memory = readEconomicTranslationMemory();
        for (const item of pendingItems) {
          const entry = memory.entries[item.key] || item.entry;
          memory.entries[item.key] = {
            ...entry,
            status: "pending",
            error: runtime.lastError,
          };
        }
        writeEconomicTranslationMemory(memory);
        break;
      }
    }
  })().finally(() => {
    runtime.lastFinishedAt = new Date().toISOString();
    runtime.inFlight = null;
  });

  return runtime.inFlight;
}

function requeueFailedEconomicTranslations() {
  const memory = readEconomicTranslationMemory();
  let changed = false;
  for (const [key, entry] of Object.entries(memory.entries)) {
    if (entry.status !== "failed") continue;
    memory.entries[key] = {
      ...entry,
      status: "pending",
      error: "",
    };
    changed = true;
  }
  return changed ? writeEconomicTranslationMemory(memory) : memory;
}

function decorateEconomicCalendarResponse(response, eventSources = []) {
  const sourceEvents = [
    ...(Array.isArray(response?.events) ? response.events : []),
    ...eventSources.flatMap((events) => (Array.isArray(events) ? events : [])),
  ];
  const memory = ensureEconomicEventNameTranslationMemory(sourceEvents);
  if (pendingEconomicTranslationItems(memory).length) {
    void startPendingEconomicEventNameTranslation();
  }

  return {
    ...response,
    events: applyEconomicEventNameTranslations(response.events || [], memory),
    translationMemory: economicTranslationMemoryStats(memory),
  };
}

function flagForIsoAlpha2(code) {
  if (!/^[A-Z]{2}$/.test(code)) return "";
  return String.fromCodePoint(...[...code].map((character) => 0x1f1e6 + character.charCodeAt(0) - 65));
}

export function economicCountryDisplayForRegion(value) {
  const code = normalizeEconomicCountryCode(value);
  if (!code) {
    return { code: "", country: "기타", flag: "•" };
  }

  const [country, flag] = ECONOMIC_COUNTRY_LABELS[code] || [code, flagForIsoAlpha2(code) || "•"];
  return { code, country, flag };
}

export function normalizeEconomicCalendarEventCountry(event = {}) {
  const rawSourceCode = String(event.countryCode || event.sourceRegion || "").trim().toUpperCase().replace(/\s+/g, "");
  const sourceCode = normalizeEconomicCountryCode(rawSourceCode);
  if (!sourceCode) return event;

  const display = economicCountryDisplayForRegion(sourceCode);
  return {
    ...event,
    country: display.country,
    countryCode: display.code,
    flag: display.flag,
    sourceRegion: event.sourceRegion || rawSourceCode || display.code,
  };
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

function dateKeyInKorea(value = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(value).map((part) => [part.type, part.value])
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function todayDateKeyInKorea() {
  return dateKeyInKorea(new Date());
}

function emptyEconomicStore() {
  return {
    version: 1,
    source: "yfinance",
    timezone: "Asia/Seoul",
    updatedAt: "",
    lastFetch: null,
    cachePolicy: {
      finalizedAfterHours: FINALIZED_CACHE_AFTER_HOURS,
    },
    cachedFinalizedRanges: [],
    events: [],
  };
}

function readEconomicStore() {
  if (!existsSync(ECONOMIC_STORE_PATH)) return emptyEconomicStore();

  try {
    const parsed = JSON.parse(readFileSync(ECONOMIC_STORE_PATH, "utf8"));
    return {
      ...emptyEconomicStore(),
      ...parsed,
      source: parsed.source === "local-seed" ? "yfinance" : parsed.source || "yfinance",
      cachePolicy: {
        finalizedAfterHours: FINALIZED_CACHE_AFTER_HOURS,
        ...(parsed.cachePolicy || {}),
      },
      cachedFinalizedRanges: Array.isArray(parsed.cachedFinalizedRanges)
        ? parsed.cachedFinalizedRanges.filter((range) => parseDateKey(range?.startDate) && parseDateKey(range?.endDate))
        : [],
      events: Array.isArray(parsed.events) ? parsed.events.map(normalizeEconomicCalendarEventCountry) : [],
    };
  } catch {
    return emptyEconomicStore();
  }
}

function writeEconomicStore(store) {
  mkdirSync(DATA_DIR, { recursive: true });
  const tmpPath = `${ECONOMIC_STORE_PATH}.tmp`;
  const normalizedStore = {
    ...store,
    events: Array.isArray(store.events) ? store.events.map(normalizeEconomicCalendarEventCountry) : [],
  };
  writeFileSync(tmpPath, `${JSON.stringify(normalizedStore, null, 2)}\n`);
  renameSync(tmpPath, ECONOMIC_STORE_PATH);
}

function eventCacheKey(event) {
  return [
    String(event?.countryCode || "").trim().toUpperCase(),
    String(event?.eventStartUtc || event?.dateKey || "").trim(),
    String(event?.eventName || "").trim(),
    String(event?.period || "").trim(),
  ].join("|");
}

function eventDateKey(event) {
  return parseDateKey(event?.dateKey) || "";
}

function eventTimeMs(event) {
  const raw = event?.eventStartUtc || event?.eventStartKst || "";
  const timestamp = Date.parse(raw);
  return Number.isFinite(timestamp) ? timestamp : NaN;
}

function isFinalizedEconomicEvent(event, nowMs = Date.now()) {
  const timestamp = eventTimeMs(event);
  return Number.isFinite(timestamp) && timestamp <= nowMs - FINALIZED_CACHE_AFTER_MS;
}

function finalizedFullRangeEndDate(nowMs = Date.now()) {
  return dateKeyInKorea(new Date(nowMs - FINALIZED_CACHE_AFTER_MS));
}

function rangeIsFullyFinalized(startDate, endDate, nowMs = Date.now()) {
  return Boolean(startDate && endDate && endDate <= finalizedFullRangeEndDate(nowMs));
}

function sortEconomicEvents(events) {
  return [...events].sort((left, right) => {
    const leftDate = eventDateKey(left);
    const rightDate = eventDateKey(right);
    if (leftDate !== rightDate) return leftDate.localeCompare(rightDate);
    const leftTime = String(left.time || "99:99");
    const rightTime = String(right.time || "99:99");
    if (leftTime !== rightTime) return leftTime.localeCompare(rightTime);
    const leftCountry = String(left.country || left.countryCode || "");
    const rightCountry = String(right.country || right.countryCode || "");
    if (leftCountry !== rightCountry) return leftCountry.localeCompare(rightCountry);
    return String(left.eventName || "").localeCompare(String(right.eventName || ""));
  });
}

function mergeEconomicEvents(existingEvents, fetchedEvents) {
  const merged = new Map();

  for (const rawEvent of existingEvents) {
    const event = normalizeEconomicCalendarEventCountry(rawEvent);
    const key = eventCacheKey(event);
    if (!key.trim() || !eventDateKey(event)) continue;
    merged.set(key, event);
  }

  for (const rawEvent of fetchedEvents) {
    const event = normalizeEconomicCalendarEventCountry(rawEvent);
    const key = eventCacheKey(event);
    if (!key.trim() || !eventDateKey(event)) continue;
    merged.set(key, event);
  }

  return sortEconomicEvents([...merged.values()]);
}

function buildFinalizedStoreEvents(existingEvents, fetchedEvents, nowMs = Date.now(), cachedAt = new Date().toISOString()) {
  const existingFinalizedEvents = existingEvents.filter((event) => isFinalizedEconomicEvent(event, nowMs));
  const fetchedFinalizedEvents = fetchedEvents
    .filter((event) => isFinalizedEconomicEvent(event, nowMs))
    .map((event) => ({
      ...event,
      cachedFinalizedAt: event.cachedFinalizedAt || cachedAt,
    }));
  return mergeEconomicEvents(existingFinalizedEvents, fetchedFinalizedEvents);
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

function filterEconomicEvents(events, startDate, endDate) {
  return sortEconomicEvents(
    events.map(normalizeEconomicCalendarEventCountry).filter((event) => {
      const dateKey = eventDateKey(event);
      return dateKey && dateKey >= startDate && dateKey < endDate;
    })
  );
}

function economicStoreResponse({ store, startDate, endDate, fetchPayload = null, warning = "", responseEvents = null }) {
  const events = filterEconomicEvents(responseEvents || store.events, startDate, endDate);
  const collectionStatus = warning
    ? "fallback_cache"
    : fetchPayload?.ok
      ? "ready"
      : "cache";
  return {
    ok: true,
    source: "yfinance",
    timezone: "Asia/Seoul",
    startDate,
    endDate,
    generatedAt: fetchPayload?.generatedAt || store.updatedAt || new Date().toISOString(),
    updatedAt: store.updatedAt || "",
    rowCount: events.length,
    fetchedRowCount: Array.isArray(fetchPayload?.events) ? fetchPayload.events.length : 0,
    events,
    warnings: [
      ...(Array.isArray(fetchPayload?.warnings) ? fetchPayload.warnings : []),
      ...(warning ? [warning] : []),
    ],
    collectionStatus,
    lastSuccessfulAt: store.updatedAt || "",
    collectionFailure: warning ? {
      code: fetchPayload?.errorCode || "YFINANCE_FETCH_FAILED",
      message: warning,
    } : null,
    officialFallbackSources: ECONOMIC_OFFICIAL_FALLBACK_SOURCES,
    persistentCache: {
      path: "data/economic-calendar-cache.json",
      updatedAt: store.updatedAt || "",
      eventCount: store.events.length,
      lastFetch: store.lastFetch,
      cachePolicy: store.cachePolicy || { finalizedAfterHours: FINALIZED_CACHE_AFTER_HOURS },
      cachedFinalizedRanges: store.cachedFinalizedRanges || [],
    },
    importanceSource: "event-name heuristic",
  };
}

const yfinanceEconomicScript = String.raw`
import argparse
import json
import math
import sys
from datetime import datetime
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
parser.add_argument("--max-pages", type=int, required=True)
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

COUNTRY_CODE_ALIASES = {
    "EA": "EMU",
    "EZ": "EMU",
    "UK": "GB",
}

COUNTRY_LABELS = {
    "AE": ("아랍에미리트", "🇦🇪"),
    "AR": ("아르헨티나", "🇦🇷"),
    "AT": ("오스트리아", "🇦🇹"),
    "AU": ("호주", "🇦🇺"),
    "BE": ("벨기에", "🇧🇪"),
    "BG": ("불가리아", "🇧🇬"),
    "BH": ("바레인", "🇧🇭"),
    "BR": ("브라질", "🇧🇷"),
    "US": ("미국", "🇺🇸"),
    "CA": ("캐나다", "🇨🇦"),
    "MX": ("멕시코", "🇲🇽"),
    "CH": ("스위스", "🇨🇭"),
    "CL": ("칠레", "🇨🇱"),
    "CN": ("중국 본토", "🇨🇳"),
    "CO": ("콜롬비아", "🇨🇴"),
    "CY": ("키프로스", "🇨🇾"),
    "CZ": ("체코", "🇨🇿"),
    "DE": ("독일", "🇩🇪"),
    "DK": ("덴마크", "🇩🇰"),
    "EA": ("유로존", "🇪🇺"),
    "EE": ("에스토니아", "🇪🇪"),
    "EG": ("이집트", "🇪🇬"),
    "EMU": ("유로존", "🇪🇺"),
    "ES": ("스페인", "🇪🇸"),
    "EU": ("유럽연합", "🇪🇺"),
    "EZ": ("유로존", "🇪🇺"),
    "FI": ("핀란드", "🇫🇮"),
    "FR": ("프랑스", "🇫🇷"),
    "GB": ("영국", "🇬🇧"),
    "GH": ("가나", "🇬🇭"),
    "GR": ("그리스", "🇬🇷"),
    "HK": ("홍콩", "🇭🇰"),
    "HR": ("크로아티아", "🇭🇷"),
    "HU": ("헝가리", "🇭🇺"),
    "ID": ("인도네시아", "🇮🇩"),
    "IE": ("아일랜드", "🇮🇪"),
    "IL": ("이스라엘", "🇮🇱"),
    "IN": ("인도", "🇮🇳"),
    "IS": ("아이슬란드", "🇮🇸"),
    "IT": ("이탈리아", "🇮🇹"),
    "JP": ("일본", "🇯🇵"),
    "KE": ("케냐", "🇰🇪"),
    "KR": ("대한민국", "🇰🇷"),
    "KW": ("쿠웨이트", "🇰🇼"),
    "LT": ("리투아니아", "🇱🇹"),
    "LU": ("룩셈부르크", "🇱🇺"),
    "LV": ("라트비아", "🇱🇻"),
    "MT": ("몰타", "🇲🇹"),
    "MY": ("말레이시아", "🇲🇾"),
    "MW": ("말라위", "🇲🇼"),
    "MZ": ("모잠비크", "🇲🇿"),
    "NG": ("나이지리아", "🇳🇬"),
    "NL": ("네덜란드", "🇳🇱"),
    "NO": ("노르웨이", "🇳🇴"),
    "NZ": ("뉴질랜드", "🇳🇿"),
    "OM": ("오만", "🇴🇲"),
    "PE": ("페루", "🇵🇪"),
    "PH": ("필리핀", "🇵🇭"),
    "PL": ("폴란드", "🇵🇱"),
    "PT": ("포르투갈", "🇵🇹"),
    "QA": ("카타르", "🇶🇦"),
    "RO": ("루마니아", "🇷🇴"),
    "RU": ("러시아", "🇷🇺"),
    "SA": ("사우디아라비아", "🇸🇦"),
    "SE": ("스웨덴", "🇸🇪"),
    "SG": ("싱가포르", "🇸🇬"),
    "SI": ("슬로베니아", "🇸🇮"),
    "SK": ("슬로바키아", "🇸🇰"),
    "TH": ("태국", "🇹🇭"),
    "TR": ("튀르키예", "🇹🇷"),
    "TZ": ("탄자니아", "🇹🇿"),
    "TW": ("대만", "🇹🇼"),
    "UG": ("우간다", "🇺🇬"),
    "UA": ("우크라이나", "🇺🇦"),
    "UK": ("영국", "🇬🇧"),
    "VN": ("베트남", "🇻🇳"),
    "ZA": ("남아프리카공화국", "🇿🇦"),
    "ZM": ("잠비아", "🇿🇲"),
}

HIGH_IMPORTANCE_KEYWORDS = (
    "payroll", "unemployment", "jobless", "cpi", "pce", "ppi", "gdp",
    "fomc", "fed", "rate decision", "interest rate", "ism", "pmi",
    "retail sales", "durable goods", "consumer confidence",
)

LOW_IMPORTANCE_KEYWORDS = (
    "auction", "inventory", "stocks", "storage", "bill", "note", "bond",
    "speech", "speaks", "remarks",
)

def is_blank(value):
    if value is None:
        return True
    try:
        return bool(pd.isna(value))
    except Exception:
        return False

def clean_text(value):
    if is_blank(value):
        return "-"
    text = str(value).strip()
    return text if text else "-"

def clean_region(value):
    text = clean_text(value)
    if text == "-":
        return ""
    code = text.upper().replace(" ", "")
    return COUNTRY_CODE_ALIASES.get(code, code)

def flag_for_iso_alpha2(code):
    if len(code) != 2 or not code.isalpha():
        return ""
    return "".join(chr(0x1F1E6 + ord(character) - ord("A")) for character in code)

def country_for_region(region):
    code = clean_region(region)
    label, flag = COUNTRY_LABELS.get(code, (code or "기타", flag_for_iso_alpha2(code) or "•"))
    return code, label, flag

def format_value(value):
    if is_blank(value):
        return "-"
    try:
        numeric = float(value)
    except Exception:
        return clean_text(value)
    if not math.isfinite(numeric):
        return "-"
    if abs(numeric) >= 100:
        return f"{numeric:.2f}".rstrip("0").rstrip(".")
    return f"{numeric:.2f}".rstrip("0").rstrip(".")

def parse_event_datetime(value):
    if is_blank(value):
        return None
    parsed = pd.to_datetime(value, utc=True, errors="coerce")
    if is_blank(parsed):
        return None
    return parsed.to_pydatetime()

def importance_for_event(name):
    lowered = str(name or "").lower()
    if any(keyword in lowered for keyword in HIGH_IMPORTANCE_KEYWORDS):
        return 3
    if any(keyword in lowered for keyword in LOW_IMPORTANCE_KEYWORDS):
        return 1
    return 2

try:
    calendars = yf.Calendars(start=args.start, end=args.end)
    if not hasattr(calendars, "get_economic_events_calendar"):
        print(json.dumps({
            "ok": False,
            "errorCode": "YFINANCE_ECONOMIC_CALENDAR_UNAVAILABLE",
            "error": "Installed yfinance does not expose get_economic_events_calendar.",
            "installCommand": f"{sys.executable} -m pip install --upgrade yfinance",
        }, ensure_ascii=False))
        sys.exit(0)
    frames = []
    page_offsets = []
    page_limit = max(1, int(args.limit or 100))
    max_pages = max(1, min(50, int(args.max_pages or 1)))
    reached_page_cap = False

    for page in range(max_pages):
        offset = page * page_limit
        page_df = calendars.get_economic_events_calendar(
            start=args.start,
            end=args.end,
            limit=page_limit,
            offset=offset,
            force=args.force,
        )
        if page_df is None or page_df.empty:
            break
        frames.append(page_df)
        page_offsets.append(offset)
        if len(page_df) < page_limit:
            break
    else:
        reached_page_cap = bool(frames)

    df = pd.concat(frames, ignore_index=False) if frames else None
except Exception as exc:
    print(json.dumps({
        "ok": False,
        "errorCode": "YFINANCE_FETCH_FAILED",
        "error": str(exc) or "yfinance economic calendar request failed",
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
    }, ensure_ascii=False))
    sys.exit(0)

records = []
record_keys = set()
data = df.reset_index()
for index, row in data.iterrows():
    event_name = clean_text(row.get("Event"))
    if event_name == "-":
        event_name = clean_text(row.iloc[0] if len(row) else "-")
    if event_name == "-":
        continue

    event_dt_utc = parse_event_datetime(row.get("Event Time"))
    if event_dt_utc is None:
        continue
    event_dt_kst = event_dt_utc.astimezone(KST)
    region = clean_region(row.get("Region"))
    country_code, country_label, flag = country_for_region(region)
    period = clean_text(row.get("For"))
    actual = format_value(row.get("Actual"))
    expected = format_value(row.get("Expected"))
    last = format_value(row.get("Last"))
    revised = format_value(row.get("Revised"))
    record_key = "|".join([country_code or "XX", event_dt_utc.isoformat(), event_name, period])
    if record_key in record_keys:
        continue
    record_keys.add(record_key)

    records.append({
        "id": record_key,
        "dateKey": event_dt_kst.date().isoformat(),
        "time": event_dt_kst.strftime("%H:%M"),
        "country": country_label,
        "countryCode": country_code,
        "flag": flag,
        "importance": importance_for_event(event_name),
        "importanceSource": "event-name heuristic",
        "eventName": event_name,
        "period": period,
        "actual": actual,
        "forecast": expected,
        "previous": last,
        "revised": revised,
        "eventStartUtc": event_dt_utc.isoformat(),
        "eventStartKst": event_dt_kst.isoformat(),
        "sourceRegion": region,
    })

records.sort(key=lambda item: (
    item["eventStartKst"],
    item["countryCode"],
    item["eventName"],
))

print(json.dumps({
    "ok": True,
    "source": "yfinance",
    "timezone": "Asia/Seoul",
    "startDate": args.start,
    "endDate": args.end,
    "generatedAt": datetime.now(KST).isoformat(),
    "events": records,
    "warnings": [f"Reached yfinance pagination cap at {len(page_offsets)} pages."] if reached_page_cap else [],
    "rowCount": len(records),
    "fetchedPageCount": len(page_offsets),
    "fetchedOffsets": page_offsets,
}, ensure_ascii=False))
`;

function runYfinanceEconomicCalendar({ startDate, endDate, limit, force }) {
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
        yfinanceEconomicScript,
        "--start",
        startDate,
        "--end",
        endDate,
        "--limit",
        String(limit),
        "--max-pages",
        String(ECONOMIC_FETCH_MAX_PAGES),
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
        error: "yfinance economic calendar request timed out.",
      });
    }, ECONOMIC_FETCH_TIMEOUT_MS);

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

export async function handleEconomicCalendarEndpoint(endpoint, req, res) {
  if (endpoint === "translations") {
    try {
      if (req.method === "GET") {
        const url = new URL(req.url, "http://127.0.0.1");
        sendJson(res, publicEconomicTranslationMemorySnapshot({ limit: url.searchParams.get("limit") }));
        return;
      }

      if (req.method === "POST" || req.method === "PATCH") {
        const body = await readJsonBody(req, 64 * 1024);
        const action = String(body.action || "refresh").trim();
        if (action === "retry-failed") {
          requeueFailedEconomicTranslations();
        }
        if (action === "refresh" || action === "retry-failed") {
          ensureEconomicEventNameTranslationMemory(readEconomicStore().events);
          void startPendingEconomicEventNameTranslation();
          sendJson(res, publicEconomicTranslationMemorySnapshot({ limit: body.limit }));
          return;
        }
        sendJson(res, { ok: false, error: "unknown economic calendar translation action" }, 400);
        return;
      }

      sendJson(res, { ok: false, error: "method not allowed" }, 405);
      return;
    } catch (error) {
      sendJson(res, { ok: false, error: error.message || "economic calendar translations failed" }, 400);
      return;
    }
  }

  if (endpoint === "settings") {
    try {
      if (req.method === "GET") {
        sendJson(res, publicEconomicCalendarSettingsSnapshot());
        return;
      }

      if (req.method === "PUT" || req.method === "PATCH" || req.method === "POST") {
        const body = await readJsonBody(req, 64 * 1024);
        writeEconomicCalendarSettingsPatch(body);
        sendJson(res, publicEconomicCalendarSettingsSnapshot());
        return;
      }

      sendJson(res, { ok: false, error: "method not allowed" }, 405);
      return;
    } catch (error) {
      sendJson(res, { ok: false, error: error.message || "economic calendar settings failed" }, 400);
      return;
    }
  }

  if (endpoint !== "events") {
    sendJson(res, { ok: false, error: "unknown economic calendar endpoint" }, 404);
    return;
  }

  if (req.method !== "GET") {
    sendJson(res, { ok: false, error: "method not allowed" }, 405);
    return;
  }

  const url = new URL(req.url, "http://127.0.0.1");
  const startDate = parseDateKey(url.searchParams.get("start")) || todayDateKeyInKorea();
  const days = clampNumber(url.searchParams.get("days"), DEFAULT_DAYS, 1, MAX_DAYS);
  const endDate = parseDateKey(url.searchParams.get("end")) || addDaysToDateKey(startDate, days);
  const fetchStartDate = addDaysToDateKey(startDate, -1);
  const fetchEndDate = addDaysToDateKey(endDate, 1);
  const limit = clampNumber(url.searchParams.get("limit"), DEFAULT_LIMIT, 1, MAX_LIMIT);
  const force = url.searchParams.get("force") === "1" || url.searchParams.get("force") === "true";
  const cacheKey = JSON.stringify({ endpoint, startDate, endDate, fetchStartDate, fetchEndDate, limit });
  const cached = cache.get(cacheKey);
  const nowMs = Date.now();

  if (!force && cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
    sendJson(res, decorateEconomicCalendarResponse({
      ...cached.payload,
      cache: {
        hit: true,
        cachedAt: new Date(cached.cachedAt).toISOString(),
        ttlSeconds: Math.round((CACHE_TTL_MS - (Date.now() - cached.cachedAt)) / 1000),
      },
    }, [readEconomicStore().events]));
    return;
  }

  const storedBeforeFetch = readEconomicStore();
  const requestIsFullyFinalized = rangeIsFullyFinalized(startDate, endDate, nowMs);

  if (
    !force &&
    requestIsFullyFinalized &&
    cachedFinalizedRangeCovers(storedBeforeFetch.cachedFinalizedRanges, startDate, endDate)
  ) {
    const response = {
      ...economicStoreResponse({
        store: storedBeforeFetch,
        startDate,
        endDate,
      }),
      fetchStartDate: "",
      fetchEndDate: "",
      cache: {
        hit: true,
        persistent: true,
        finalized: true,
        finalizedAfterHours: FINALIZED_CACHE_AFTER_HOURS,
      },
    };
    const decoratedResponse = decorateEconomicCalendarResponse(response, [storedBeforeFetch.events]);
    cache.set(cacheKey, {
      cachedAt: Date.now(),
      payload: decoratedResponse,
    });
    sendJson(res, decoratedResponse);
    return;
  }

  const payload = await runYfinanceEconomicCalendar({
    startDate: fetchStartDate,
    endDate: fetchEndDate,
    limit,
    force,
  });

  if (payload.ok) {
    const fetchedEvents = Array.isArray(payload.events) ? payload.events : [];
    const cachedAt = new Date().toISOString();
    const finalizedEventsForStore = buildFinalizedStoreEvents(storedBeforeFetch.events, fetchedEvents, nowMs, cachedAt);
    const nextCachedFinalizedRanges = mergeCachedFinalizedRanges(
      storedBeforeFetch.cachedFinalizedRanges,
      requestIsFullyFinalized
        ? {
            startDate,
            endDate,
            cachedAt,
            eventCount: filterEconomicEvents(finalizedEventsForStore, startDate, endDate).length,
          }
        : null
    );
    const nextStore = {
      ...emptyEconomicStore(),
      ...storedBeforeFetch,
      source: "yfinance",
      timezone: "Asia/Seoul",
      updatedAt: cachedAt,
      lastFetch: {
        requestedStartDate: startDate,
        requestedEndDate: endDate,
        fetchStartDate,
        fetchEndDate,
        generatedAt: payload.generatedAt || "",
        fetchedRowCount: fetchedEvents.length,
        finalizedCachedCount: finalizedEventsForStore.length,
      },
      cachePolicy: {
        finalizedAfterHours: FINALIZED_CACHE_AFTER_HOURS,
      },
      cachedFinalizedRanges: nextCachedFinalizedRanges,
      events: finalizedEventsForStore,
    };
    writeEconomicStore(nextStore);

    const responseStore = {
      ...nextStore,
      events: mergeEconomicEvents(finalizedEventsForStore, fetchedEvents),
    };

    const response = {
      ...economicStoreResponse({
        store: nextStore,
        startDate,
        endDate,
        fetchPayload: payload,
        responseEvents: responseStore.events,
      }),
      python: payload.python || null,
      stderr: payload.stderr || "",
      fetchStartDate,
      fetchEndDate,
      cache: {
        hit: false,
        ttlSeconds: Math.round(CACHE_TTL_MS / 1000),
        finalizedAfterHours: FINALIZED_CACHE_AFTER_HOURS,
        persistentFinalizedEventCount: finalizedEventsForStore.length,
      },
    };

    const decoratedResponse = decorateEconomicCalendarResponse(response, [responseStore.events]);
    cache.set(cacheKey, {
      cachedAt: Date.now(),
      payload: decoratedResponse,
    });

    sendJson(res, decoratedResponse);
    return;
  }

  const fallbackEvents = filterEconomicEvents(storedBeforeFetch.events, startDate, endDate);
  if (fallbackEvents.length) {
    sendJson(res, decorateEconomicCalendarResponse({
      ...economicStoreResponse({
        store: storedBeforeFetch,
        startDate,
        endDate,
        warning: `yfinance refresh failed; using saved economic calendar cache. ${payload.error || ""}`.trim(),
      }),
      yfinanceError: {
        errorCode: payload.errorCode || "YFINANCE_FETCH_FAILED",
        error: payload.error || "yfinance refresh failed",
        installCommand: payload.installCommand || "",
      },
      cache: {
        hit: false,
        fallback: true,
        finalized: true,
        finalizedAfterHours: FINALIZED_CACHE_AFTER_HOURS,
        ttlSeconds: Math.round(CACHE_TTL_MS / 1000),
      },
    }, [storedBeforeFetch.events]));
    return;
  }

  sendJson(
    res,
    decorateEconomicCalendarResponse({
      ...payload,
      collectionStatus: "failed",
      lastSuccessfulAt: storedBeforeFetch.updatedAt || "",
      collectionFailure: {
        code: payload.errorCode || "YFINANCE_FETCH_FAILED",
        message: payload.error || "yfinance refresh failed",
      },
      officialFallbackSources: ECONOMIC_OFFICIAL_FALLBACK_SOURCES,
      source: "yfinance",
      timezone: "Asia/Seoul",
      startDate,
      endDate,
      fetchStartDate,
      fetchEndDate,
      persistentCache: {
        path: "data/economic-calendar-cache.json",
        updatedAt: "",
        eventCount: 0,
        lastFetch: null,
      },
      cache: {
        hit: false,
        ttlSeconds: Math.round(CACHE_TTL_MS / 1000),
      },
    }),
    502
  );
}
