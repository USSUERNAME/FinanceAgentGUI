import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
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

const WEB_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const GUIBUILD_ROOT = resolve(WEB_ROOT, "..");
const DEFAULT_CACHE_PATH = join(GUIBUILD_ROOT, "data", "toss-overseas-etf-name-translation-cache.json");
const TRANSLATION_TIMEOUT_MS = 60_000;
const TRANSLATION_BATCH_SIZE = 12;
const RETRY_DELAY_MS = 5 * 60 * 1000;
const LAST_SEEN_WRITE_INTERVAL_MS = 60 * 60 * 1000;
const ANTIGRAVITY_PROVIDER_ID = "antigravity-cli";
const TOSS_US_MARKETS = new Set(["NYSE", "NASDAQ", "AMEX", "US_ETC"]);
const TOSS_TRANSLATABLE_FUND_TYPES = new Set(["ETF", "FOREIGN_ETF", "ETN"]);
const runtimeKey = Symbol.for("financeAgentGui.tossEtfNameTranslations");

function cleanText(value, limit = 240) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, limit);
}

function normalizeTicker(value) {
  return cleanText(value, 40).toUpperCase().replace(/[^A-Z0-9.-]/g, "");
}

function cachePath() {
  const configured = String(process.env.TOSS_ETF_NAME_TRANSLATION_CACHE_PATH || "").trim().slice(0, 2000);
  return configured ? resolve(configured) : DEFAULT_CACHE_PATH;
}

function emptyCache() {
  return {
    version: 1,
    source: "toss-overseas-etf-name",
    updatedAt: "",
    entries: {},
  };
}

function normalizeEntry(ticker, raw = {}) {
  const sourceName = cleanText(raw.sourceName || raw.englishName || ticker, 240);
  const rawStatus = cleanText(raw.status, 30);
  const status = ["pending", "translating", "translated"].includes(rawStatus)
    ? rawStatus
    : "pending";
  return {
    ticker,
    sourceName,
    provider: cleanText(raw.provider, 40).toLowerCase(),
    assetClass: cleanText(raw.assetClass, 40).toLowerCase(),
    instrumentId: cleanText(raw.instrumentId, 120),
    market: cleanText(raw.market, 20).toUpperCase(),
    securityType: cleanText(raw.securityType, 40).toUpperCase(),
    marketCountry: cleanText(raw.marketCountry, 20).toUpperCase(),
    status,
    textKo: cleanText(raw.textKo, 240),
    firstSeenAt: cleanText(raw.firstSeenAt, 80),
    lastSeenAt: cleanText(raw.lastSeenAt, 80),
    translatedAt: cleanText(raw.translatedAt, 80),
    model: cleanText(raw.model, 160),
    reasoning: cleanText(raw.reasoning, 80),
    attempts: Number.isFinite(Number(raw.attempts)) ? Math.max(0, Number(raw.attempts)) : 0,
    lastAttemptAt: cleanText(raw.lastAttemptAt, 80),
    retryAfter: cleanText(raw.retryAfter, 80),
    error: cleanText(raw.error, 500),
  };
}

export function normalizeTossEtfNameTranslationCache(raw = {}) {
  const source = raw && typeof raw === "object" ? raw : {};
  const rawEntries = source.entries && typeof source.entries === "object" ? source.entries : {};
  const entries = {};
  for (const [rawTicker, rawEntry] of Object.entries(rawEntries)) {
    if (cleanText(rawEntry?.status, 30) === "not_etf") continue;
    const ticker = normalizeTicker(rawTicker || rawEntry?.ticker);
    if (!ticker) continue;
    entries[ticker] = normalizeEntry(ticker, rawEntry);
  }
  return {
    ...emptyCache(),
    updatedAt: cleanText(source.updatedAt, 80),
    entries,
  };
}

export function readTossEtfNameTranslationCache(path = cachePath()) {
  if (!existsSync(path)) return emptyCache();
  try {
    return normalizeTossEtfNameTranslationCache(JSON.parse(readFileSync(path, "utf8")));
  } catch {
    return emptyCache();
  }
}

export function writeTossEtfNameTranslationCache(memory, path = cachePath()) {
  mkdirSync(dirname(path), { recursive: true });
  const next = normalizeTossEtfNameTranslationCache({
    ...memory,
    updatedAt: new Date().toISOString(),
  });
  const temporaryPath = `${path}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(next, null, 2)}\n`);
  renameSync(temporaryPath, path);
  return next;
}

function isOverseasEnglishNameCandidate(item = {}) {
  const ticker = normalizeTicker(item.symbol || item.ticker);
  const sourceName = cleanText(item.originalName || item.englishName || item.label || item.name, 240);
  const market = cleanText(item.market, 20).toUpperCase();
  const securityType = cleanText(item.securityType, 40).toUpperCase();
  const provider = cleanText(item.provider, 40).toLowerCase();
  const assetClass = cleanText(item.assetClass, 40).toLowerCase();
  if (!ticker || !sourceName || sourceName.toUpperCase() === ticker) return false;
  const isBinanceAsset = provider === "binance" && assetClass === "crypto";
  if (isBinanceAsset) {
    return /[A-Za-z]/.test(sourceName) && !/[가-힣]/.test(sourceName);
  }
  if (!TOSS_US_MARKETS.has(market)) return false;
  if (!TOSS_TRANSLATABLE_FUND_TYPES.has(securityType)) return false;
  return /[A-Za-z]/.test(sourceName) && !/[가-힣]/.test(sourceName);
}

export function mergeTossEtfNameCandidates(memory, items = [], now = new Date().toISOString()) {
  const next = normalizeTossEtfNameTranslationCache(memory);
  let changed = false;
  for (const item of Array.isArray(items) ? items : []) {
    if (!isOverseasEnglishNameCandidate(item)) continue;
    const ticker = normalizeTicker(item.symbol || item.ticker);
    const sourceName = cleanText(item.originalName || item.englishName || item.label || item.name, 240);
    const market = cleanText(item.market, 20).toUpperCase();
    const securityType = cleanText(item.securityType, 40).toUpperCase();
    const marketCountry = cleanText(item.marketCountry, 20).toUpperCase();
    const provider = cleanText(item.provider, 40).toLowerCase();
    const assetClass = cleanText(item.assetClass, 40).toLowerCase();
    const instrumentId = cleanText(item.instrumentId, 120);
    const previous = next.entries[ticker];
    if (!previous) {
      next.entries[ticker] = normalizeEntry(ticker, {
        sourceName,
        provider,
        assetClass,
        instrumentId,
        market,
        securityType,
        marketCountry,
        status: "pending",
        firstSeenAt: now,
        lastSeenAt: now,
      });
      changed = true;
      continue;
    }

    const sourceChanged = previous.sourceName !== sourceName;
    const marketChanged = previous.market !== market;
    const securityTypeChanged = previous.securityType !== securityType;
    const marketCountryChanged = Boolean(marketCountry && previous.marketCountry !== marketCountry);
    const providerChanged = Boolean(provider && previous.provider !== provider);
    const assetClassChanged = Boolean(assetClass && previous.assetClass !== assetClass);
    const instrumentIdChanged = Boolean(instrumentId && previous.instrumentId !== instrumentId);
    const previousLastSeenMs = Date.parse(previous.lastSeenAt || "");
    const currentSeenMs = Date.parse(now);
    const shouldRefreshLastSeen =
      !Number.isFinite(previousLastSeenMs) ||
      !Number.isFinite(currentSeenMs) ||
      currentSeenMs - previousLastSeenMs >= LAST_SEEN_WRITE_INTERVAL_MS;
    const updated = normalizeEntry(ticker, {
      ...previous,
      sourceName,
      provider: provider || previous.provider,
      assetClass: assetClass || previous.assetClass,
      instrumentId: instrumentId || previous.instrumentId,
      market,
      securityType,
      marketCountry: marketCountry || previous.marketCountry,
      lastSeenAt: shouldRefreshLastSeen ? now : previous.lastSeenAt,
      ...(sourceChanged
        ? {
            status: "pending",
            textKo: "",
            translatedAt: "",
            retryAfter: "",
            error: "",
          }
        : {}),
    });
    if (
      sourceChanged ||
      marketChanged ||
      securityTypeChanged ||
      marketCountryChanged ||
      providerChanged ||
      assetClassChanged ||
      instrumentIdChanged ||
      shouldRefreshLastSeen
    ) {
      next.entries[ticker] = updated;
      changed = true;
    }
  }
  return { memory: next, changed };
}

function runtime() {
  if (!globalThis[runtimeKey]) {
    globalThis[runtimeKey] = {
      inFlight: null,
      lastStartedAt: "",
      lastFinishedAt: "",
      lastError: "",
    };
  }
  return globalThis[runtimeKey];
}

function cacheStats(memory) {
  const entries = Object.values(normalizeTossEtfNameTranslationCache(memory).entries);
  const state = runtime();
  const nextRetryAt = entries
    .map((entry) => entry.retryAfter)
    .filter(Boolean)
    .sort()[0] || "";
  return {
    path: "data/toss-overseas-etf-name-translation-cache.json",
    totalCount: entries.length,
    translatedCount: entries.filter((entry) => entry.status === "translated" && entry.textKo).length,
    nonEtfCount: 0,
    pendingCount: entries.filter((entry) => entry.status === "pending" || entry.status === "translating").length,
    inFlight: Boolean(state.inFlight),
    lastStartedAt: state.lastStartedAt,
    lastFinishedAt: state.lastFinishedAt,
    lastError: state.lastError,
    nextRetryAt,
    updatedAt: memory.updatedAt || "",
  };
}

export function applyTossEtfNameTranslations(items = [], memory = emptyCache()) {
  const entries = normalizeTossEtfNameTranslationCache(memory).entries;
  return (Array.isArray(items) ? items : []).map((item) => {
    const ticker = normalizeTicker(item?.symbol || item?.ticker);
    const entry = ticker ? entries[ticker] : null;
    if (!entry) return item;
    const translated = entry.status === "translated" && entry.textKo;
    const originalName = cleanText(item.originalName || item.englishName || item.label || item.name, 240);
    return {
      ...item,
      ...(translated
        ? {
            label: entry.textKo,
            name: entry.textKo,
            englishName: originalName,
            originalName,
          }
        : {}),
      etfNameTranslationStatus: entry.status,
      etfNameTranslationModel: entry.model || "",
      etfNameTranslationError: entry.error || "",
    };
  });
}

function latestAntigravityTranslationModel(options) {
  const catalogModels = Array.isArray(options.antigravityModelCatalog?.models)
    ? options.antigravityModelCatalog.models.filter((item) => item?.selectable && item?.name)
    : [];
  return selectAntigravityModelForReasoning(catalogModels, {
    currentModel:
      options.agentSettings?.settings?.providers?.[ANTIGRAVITY_PROVIDER_ID]?.model ||
      options.selected?.model ||
      options.antigravity?.defaultModel ||
      ANTIGRAVITY_TRANSLATION_FALLBACK_MODEL,
  });
}

function chooseTranslationModel() {
  const options = getCodexOptions();
  if (options.selected?.provider === ANTIGRAVITY_PROVIDER_ID) {
    if (!options.antigravity?.ready) {
      throw new Error(options.antigravity?.detail || options.antigravity?.error || "Antigravity CLI가 번역에 사용할 준비가 되지 않았습니다.");
    }
    const model = latestAntigravityTranslationModel(options);
    return {
      provider: ANTIGRAVITY_PROVIDER_ID,
      model,
      modelLabel: `Antigravity CLI · ${model}`,
      reasoning: ANTIGRAVITY_TRANSLATION_REASONING,
    };
  }
  if (!options.codex?.available) throw new Error(options.codex?.error || "codex command not found");
  return {
    provider: "codex-cli",
    ...selectCodexTranslationModel({
      cliVersion: options.codex?.version,
      models: options.modelGroups,
    }),
  };
}

function translationPrompt(items) {
  return [
    "금융 앱에 표시할 영문 자산명을 한국어로 번역한다.",
    "출력은 JSON 객체 하나만 반환한다.",
    "한국 투자자가 자연스럽게 식별할 수 있는 한국어 종목명으로 옮긴다.",
    "회사명과 운용사 브랜드, 지수명, 지역, 자산군, ETF·ETN, 레버리지·인버스 배수, Tokenized bStocks와 핵심 약어를 보존하고 없는 정보를 추가하지 않는다.",
    "provider가 binance이면 코인·토큰·토큰화 주식 등 입력의 자산 유형을 그대로 보존하며 일반 주식으로 바꾸어 쓰지 않는다.",
    "모든 입력 항목에 대해 번역 결과를 반환한다.",
    "",
    "반환 형식:",
    '{"translations":[{"id":"입력 ticker","textKo":"한국어 종목명"}]}',
    "",
    "입력 JSON:",
    JSON.stringify({
      items: items.map((item) => ({
        ticker: item.ticker,
        englishName: item.sourceName,
        market: item.market,
        securityType: item.securityType,
        provider: item.provider,
        assetClass: item.assetClass,
      })),
    }, null, 2),
  ].join("\n");
}

function parseJsonPayload(value) {
  const raw = String(value || "").trim();
  if (!raw) throw new Error("ETF 이름 번역 응답이 비어 있습니다.");
  try {
    return JSON.parse(raw);
  } catch {
    const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced) return JSON.parse(fenced[1]);
    const objectMatch = raw.match(/\{[\s\S]*\}/);
    if (objectMatch) return JSON.parse(objectMatch[0]);
    throw new Error("ETF 이름 번역 응답을 JSON으로 해석하지 못했습니다.");
  }
}

function runCodexBatch(items, modelInfo) {
  return new Promise((resolveBatch, reject) => {
    const temporaryDir = mkdtempSync(join(tmpdir(), "finance-agent-toss-etf-"));
    const outputPath = join(temporaryDir, "translation.json");
    const schemaPath = join(temporaryDir, "schema.json");
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

    const child = spawn("codex", [
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
      translationPrompt(items),
    ], {
      cwd: WEB_ROOT,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, NO_COLOR: "1" },
    });

    let stdout = "";
    let stderr = "";
    let settled = false;
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGTERM");
      rmSync(temporaryDir, { recursive: true, force: true });
      reject(new Error("ETF 이름 번역 시간이 초과되었습니다."));
    }, TRANSLATION_TIMEOUT_MS);

    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      rmSync(temporaryDir, { recursive: true, force: true });
      reject(error);
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        const output = existsSync(outputPath) ? readFileSync(outputPath, "utf8") : stdout;
        if (code !== 0) throw new Error((stderr || output || `codex exited ${code}`).trim());
        resolveBatch(parseJsonPayload(output));
      } catch (error) {
        reject(error);
      } finally {
        rmSync(temporaryDir, { recursive: true, force: true });
      }
    });
  });
}

async function runAntigravityBatch(items, modelInfo) {
  const result = await runAntigravityGenerate({
    prompt: translationPrompt(items),
    model: modelInfo.model,
    approval: "default",
    timeoutMs: TRANSLATION_TIMEOUT_MS,
  });
  return parseJsonPayload(result.answer);
}

async function translateItems(items) {
  const modelInfo = chooseTranslationModel();
  const translations = [];
  for (let index = 0; index < items.length; index += TRANSLATION_BATCH_SIZE) {
    const batch = items.slice(index, index + TRANSLATION_BATCH_SIZE);
    const payload = modelInfo.provider === ANTIGRAVITY_PROVIDER_ID
      ? await runAntigravityBatch(batch, modelInfo)
      : await runCodexBatch(batch, modelInfo);
    translations.push(...(Array.isArray(payload.translations) ? payload.translations : []));
  }
  return {
    translations,
    model: modelInfo.modelLabel || modelInfo.model,
    reasoning: modelInfo.reasoning,
  };
}

function validateCandidate(item, translation) {
  const textKo = cleanText(translation?.textKo, 240);
  if (!textKo) return { ok: false, error: "한국어 종목명이 비어 있습니다." };
  if (!/[가-힣]/.test(textKo)) return { ok: false, error: "한국어 종목명에 한글이 없습니다." };
  if (textKo.toLocaleLowerCase("ko-KR") === item.sourceName.toLocaleLowerCase("en-US")) {
    return { ok: false, error: "한국어 종목명이 원문과 같습니다." };
  }
  return { ok: true, textKo };
}

function pendingItems(memory, nowMs = Date.now()) {
  return Object.values(normalizeTossEtfNameTranslationCache(memory).entries)
    .filter((entry) => {
      if (entry.status !== "pending") return false;
      const retryAt = Date.parse(entry.retryAfter || "");
      return !Number.isFinite(retryAt) || retryAt <= nowMs;
    })
    .sort((left, right) => String(right.lastSeenAt).localeCompare(String(left.lastSeenAt)));
}

function translationEnabled() {
  return process.env.TOSS_ETF_NAME_TRANSLATION_DISABLED !== "1";
}

function startPendingTranslations(path = cachePath()) {
  if (!translationEnabled()) return null;
  const state = runtime();
  if (state.inFlight) return state.inFlight;
  const initial = readTossEtfNameTranslationCache(path);
  if (!pendingItems(initial).length) return null;

  state.inFlight = (async () => {
    let memory = readTossEtfNameTranslationCache(path);
    const pending = pendingItems(memory);
    if (!pending.length) return;
    const startedAt = new Date().toISOString();
    state.lastStartedAt = startedAt;
    state.lastError = "";
    for (const item of pending) {
      memory.entries[item.ticker] = normalizeEntry(item.ticker, {
        ...item,
        status: "translating",
        attempts: Number(item.attempts || 0) + 1,
        lastAttemptAt: startedAt,
        retryAfter: "",
        error: "",
      });
    }
    writeTossEtfNameTranslationCache(memory, path);

    try {
      const translated = await translateItems(pending);
      const byTicker = new Map(
        translated.translations.map((item) => [normalizeTicker(item.id || item.ticker), item])
      );
      const translatedAt = new Date().toISOString();
      memory = readTossEtfNameTranslationCache(path);
      for (const item of pending) {
        const current = memory.entries[item.ticker] || item;
        const candidate = validateCandidate(item, byTicker.get(item.ticker));
        memory.entries[item.ticker] = normalizeEntry(item.ticker, {
          ...current,
          status: candidate.ok ? "translated" : "pending",
          textKo: candidate.ok ? candidate.textKo : "",
          translatedAt: candidate.ok ? translatedAt : "",
          model: translated.model || current.model,
          reasoning: translated.reasoning || current.reasoning,
          retryAfter: candidate.ok ? "" : new Date(Date.now() + RETRY_DELAY_MS).toISOString(),
          error: candidate.ok ? "" : candidate.error,
        });
      }
      writeTossEtfNameTranslationCache(memory, path);
    } catch (error) {
      state.lastError = cleanText(error.message || "ETF 이름 번역 실패", 500);
      memory = readTossEtfNameTranslationCache(path);
      const retryAfter = new Date(Date.now() + RETRY_DELAY_MS).toISOString();
      for (const item of pending) {
        const current = memory.entries[item.ticker] || item;
        memory.entries[item.ticker] = normalizeEntry(item.ticker, {
          ...current,
          status: "pending",
          retryAfter,
          error: state.lastError,
        });
      }
      writeTossEtfNameTranslationCache(memory, path);
    }
  })().finally(() => {
    state.lastFinishedAt = new Date().toISOString();
    state.inFlight = null;
  });
  return state.inFlight;
}

export function decorateTossOverseasEtfNames(payload = {}, options = {}) {
  if (!payload || typeof payload !== "object") return payload;
  if (process.env.NODE_TEST_CONTEXT && !options.path) return payload;
  const path = options.path || cachePath();
  const startTranslation = options.startTranslation !== false;
  let memory = readTossEtfNameTranslationCache(path);
  const fileMissing = !existsSync(path);
  let interruptedTranslationRecovered = false;
  if (!runtime().inFlight) {
    for (const [ticker, entry] of Object.entries(memory.entries)) {
      if (entry.status !== "translating") continue;
      memory.entries[ticker] = normalizeEntry(ticker, {
        ...entry,
        status: "pending",
        retryAfter: "",
        error: "이전 번역 작업이 중단되어 다시 대기합니다.",
      });
      interruptedTranslationRecovered = true;
    }
  }
  const merged = mergeTossEtfNameCandidates(memory, payload.items || []);
  memory = fileMissing || interruptedTranslationRecovered || merged.changed
    ? writeTossEtfNameTranslationCache(merged.memory, path)
    : merged.memory;
  if (startTranslation && pendingItems(memory).length) void startPendingTranslations(path);
  return {
    ...payload,
    items: applyTossEtfNameTranslations(payload.items || [], memory),
    etfNameTranslationCache: cacheStats(memory),
  };
}

export async function handleTossEtfNameTranslationEndpoint(req, res) {
  try {
    if (req.method !== "POST") {
      sendJson(res, { ok: false, error: "method not allowed" }, 405);
      return;
    }
    const body = await readJsonBody(req, 256 * 1024);
    const items = Array.isArray(body?.items) ? body.items.slice(0, 500) : [];
    sendJson(
      res,
      decorateTossOverseasEtfNames(
        { ok: true, items },
        { path: cachePath(), startTranslation: true },
      ),
    );
  } catch (error) {
    sendJson(res, { ok: false, error: error.message || "ETF name translations failed" }, 500);
  }
}

export const __tossEtfNameTranslationTestHooks = {
  cacheStats,
  pendingItems,
  validateCandidate,
};
