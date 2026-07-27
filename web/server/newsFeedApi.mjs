import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { XMLParser } from "fast-xml-parser";
import {
  getCodexOptions,
  readJsonBody,
  runAntigravityGenerate,
  sendJson,
} from "./codexProbe.mjs";
import {
  ANTIGRAVITY_TRANSLATION_FALLBACK_MODEL,
  ANTIGRAVITY_TRANSLATION_REASONING,
  selectAntigravityModelForReasoning,
} from "../src/agent/antigravityModelSelection.js";
import { selectCodexTranslationModel } from "../src/agent/codexTranslationModelSelection.js";
import { spawnObservedLlm, waitForLlmObservation } from "./llmProcessObserver.mjs";

const WEB_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const GUIBUILD_ROOT = resolve(WEB_ROOT, "..");
const CONFIG_DIR = join(GUIBUILD_ROOT, "config");
const DATA_DIR = join(GUIBUILD_ROOT, "data");
const DEFAULT_CONFIG_PATH = join(CONFIG_DIR, "news-feeds.defaults.json");
const USER_CONFIG_PATH = join(CONFIG_DIR, "news-feeds.user.json");
const LEGACY_CONFIG_PATH = join(CONFIG_DIR, "news-feeds.json");
const STORE_PATH = join(DATA_DIR, "news-feed.json");
const READ_STATE_PATH = join(DATA_DIR, "news-feed-read-state.json");
const VIEW_STATE_PATH = join(DATA_DIR, "news-feed-view-state.json");
const DAILY_DIGEST_PATH = join(DATA_DIR, "news-feed-daily-digest.json");
const DEFAULT_POLL_INTERVAL_SECONDS = 180;
const DEFAULT_RETENTION_HOURS = 48;
const DEFAULT_TRANSLATION_BATCH_SIZE = 12;
const DEFAULT_MAX_ITEMS_PER_FEED = 500;
const TRANSLATION_TIMEOUT_MS = 60000;
const DAILY_DIGEST_TIMEOUT_MS = 120000;
const DAILY_DIGEST_HOUR_KST = 7;
const DAILY_DIGEST_MINUTE_KST = 30;
const DAILY_DIGEST_MAX_EVENTS = 8;
const DAILY_DIGEST_HISTORY_LIMIT = 14;
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 20000;
const FEED_FETCH_STAGGER_WINDOW_MS = 60000;
const TRANSLATION_TEXT_MAX_CHARS = 1200;
const ANTIGRAVITY_PROVIDER_ID = "antigravity-cli";
const UNICODE_REPLACEMENT_CHARACTER = "\uFFFD";
const UNTRANSLATED_COPY_LATIN_WORDS = 2;
const runtimeKey = Symbol.for("financeAgentGui.newsFeedCollector");
const defaultFeedHeaders = {
  accept: "application/rss+xml,application/atom+xml,application/xml,text/xml;q=0.9,*/*;q=0.5",
  "accept-language": "en-US,en;q=0.9",
  "user-agent": "FinanceAgentGUI/0.1 local-news-feed-collector",
};

const browserLikeFeedHeaders = {
  ...defaultFeedHeaders,
  accept: "application/rss+xml,application/xml,text/xml,*/*",
  "accept-language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
  "user-agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36 FinanceAgentGUI/0.1",
};

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  textNodeName: "#text",
  cdataPropName: "#cdata",
  trimValues: true,
  parseTagValue: false,
  parseAttributeValue: false,
});

const fallbackConfig = {
  pollIntervalSeconds: DEFAULT_POLL_INTERVAL_SECONDS,
  retentionHours: DEFAULT_RETENTION_HOURS,
  maxItemsPerFeed: DEFAULT_MAX_ITEMS_PER_FEED,
  translationBatchSize: DEFAULT_TRANSLATION_BATCH_SIZE,
  feeds: [
    {
      id: "financialjuice",
      title: "FinancialJuice",
      url: "https://rss.app/feeds/5VaycMAa8SwPhOAP.xml",
      itemContentMode: "title-only",
      enabled: true,
    },
    {
      id: "walter-bloomberg",
      title: "*Walter Bloomberg",
      url: "https://rss.app/feeds/YcRRdWN5eSO3o2LP.xml",
      itemContentMode: "title-only",
      enabled: true,
    },
    {
      id: "wall-st-engine",
      title: "Wall St Engine",
      url: "https://rss.app/feeds/Hf52VRUllNu7gABF.xml",
      itemContentMode: "title-only",
      enabled: true,
    },
    {
      id: "first-squawk",
      title: "First Squawk",
      url: "https://rss.app/feeds/d68ow40E3dkwaEvN.xml",
      itemContentMode: "title-only",
      publishedAtOffsetMinutes: -540,
      enabled: true,
    },
    {
      id: "unusual-whales",
      title: "unusual_whales",
      url: "https://rss.app/feeds/nikLNBATmLDuprRz.xml",
      itemContentMode: "title-only",
      publishedAtOffsetMinutes: -540,
      enabled: true,
    },
  ],
};

function nowIso() {
  return new Date().toISOString();
}

function timestampMs(value) {
  const timestamp = Date.parse(String(value || ""));
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function staggeredFeedPlan(feeds, windowMs = FEED_FETCH_STAGGER_WINDOW_MS) {
  const enabledFeeds = feeds.filter((feed) => feed.enabled);
  if (enabledFeeds.length <= 1 || windowMs <= 0) {
    return enabledFeeds.map((feed) => ({ feed, delayMs: 0 }));
  }

  const rawPlan = enabledFeeds.map((feed) => ({
    feed,
    delayMs: Math.floor(Math.random() * (windowMs + 1)),
  }));
  const firstDelayMs = Math.min(...rawPlan.map((item) => item.delayMs));
  return rawPlan
    .map((item) => ({ ...item, delayMs: item.delayMs - firstDelayMs }))
    .sort((a, b) => a.delayMs - b.delayMs || a.feed.id.localeCompare(b.feed.id));
}

async function waitUntilFeedOffset(collectionStartedAtMs, delayMs) {
  const remainingMs = collectionStartedAtMs + delayMs - Date.now();
  if (remainingMs > 0) {
    await sleep(remainingMs);
  }
}

function ensureDirs() {
  mkdirSync(CONFIG_DIR, { recursive: true });
  mkdirSync(DATA_DIR, { recursive: true });
}

function hashText(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function safeId(value, fallback) {
  const raw = String(value || "").trim().toLowerCase();
  const normalized = raw.replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  return normalized.slice(0, 64) || fallback;
}

function toArray(value) {
  if (value === null || value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function textValue(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.map(textValue).filter(Boolean).join(" ");
  }
  if (typeof value === "object") {
    return textValue(value["#cdata"] ?? value["#text"] ?? value.text ?? value.value ?? "");
  }
  return "";
}

function decodeHtmlEntities(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) => String.fromCodePoint(Number.parseInt(code, 16)));
}

function stripHtml(value) {
  return decodeHtmlEntities(String(value || "").replace(/<[^>]*>/g, " "));
}

function removeLinks(value) {
  return String(value || "").replace(/https?:\/\/\S+/gi, "").replace(/\s+/g, " ").trim();
}

function cleanText(value) {
  return removeLinks(stripHtml(textValue(value))).replace(/\s+/g, " ").trim();
}

function parseDateIso(value) {
  const raw = textValue(value).trim();
  if (!raw) return "";
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function normalizePublishedAtOffsetMinutes(value) {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(-840, Math.min(840, Math.round(numeric)));
}

function offsetDateIso(value, offsetMinutes = 0) {
  const sourceIso = parseDateIso(value);
  if (!sourceIso) return "";
  const offset = normalizePublishedAtOffsetMinutes(offsetMinutes);
  return new Date(new Date(sourceIso).getTime() + offset * 60 * 1000).toISOString();
}

function atomLinkValue(link) {
  const links = toArray(link);
  const preferred = links.find((item) => item?.rel === "alternate") || links[0];
  return textValue(preferred?.href || preferred);
}

function itemFingerprint(feed, item) {
  const guid = textValue(item.guid || item.id).trim();
  const link = newsFeedItemSourceUrl(item);
  const title = cleanText(item.title);
  const published = textValue(item.pubDate || item.published || item.updated || item["dc:date"]).trim();
  return hashText([feed.id, guid || link || title, published].join("\n"));
}

function newsFeedItemSourceUrl(item) {
  const link = (atomLinkValue(item.link) || textValue(item.link)).trim();
  if (link) return link;
  const guid = textValue(item.guid || item.id).trim();
  return /^https?:\/\//i.test(guid) ? guid : "";
}

function newsFeedItemIdentityKeys(item = {}) {
  return [
    item.sourceFingerprint ? `fingerprint:${item.sourceFingerprint}` : "",
    item.id ? `id:${item.id}` : "",
  ].filter(Boolean);
}

function normalizeItemContentMode(value) {
  return value === "title-only" ? "title-only" : "body";
}

export function mergeNewsFeedItemsPreservingLatest(latestItems = [], refreshItems = []) {
  const merged = [];
  const seen = new Set();

  const append = (item) => {
    if (!item || typeof item !== "object") return;
    const keys = newsFeedItemIdentityKeys(item);
    if (keys.some((key) => seen.has(key))) return;
    merged.push(item);
    for (const key of keys) seen.add(key);
  };

  for (const item of toArray(latestItems)) append(item);
  for (const item of toArray(refreshItems)) append(item);
  return merged;
}

function normalizeRssItem(feed, item, channelTitle) {
  const title = cleanText(item.title);
  const body = cleanText(item.description || item["content:encoded"] || item.summary || item.content);
  const itemContentMode = normalizeItemContentMode(feed.itemContentMode);
  const sourcePublishedAt = parseDateIso(
    item.pubDate || item.published || item.updated || item["dc:date"]
  );
  const publishedAtOffsetMinutes = normalizePublishedAtOffsetMinutes(
    feed.publishedAtOffsetMinutes
  );
  const publishedAt = offsetDateIso(sourcePublishedAt, publishedAtOffsetMinutes);
  const fingerprint = itemFingerprint(feed, item);
  if (!title && !body) return null;
  return {
    id: `nf_${fingerprint.slice(0, 18)}`,
    sourceFingerprint: fingerprint,
    feedId: feed.id,
    feedTitle: feed.title || channelTitle || feed.id,
    sourceUrl: newsFeedItemSourceUrl(item),
    title,
    originalText: itemContentMode === "title-only" ? "" : body,
    translatedTitle: "",
    translatedText: "",
    itemContentMode,
    translationSourceField: itemContentMode === "title-only" ? "title" : "body",
    feedSourceUrl: feed.url,
    sourcePublishedAt,
    publishedAt,
    publishedAtOffsetMinutes,
    fetchedAt: nowIso(),
    translatedAt: "",
    translationStatus: "pending",
    translationError: "",
    translationModel: "",
    translationReasoning: "",
  };
}

export function parseFeedXml(xml, feed) {
  if (!String(xml || "").trim()) {
    throw new Error("RSS 응답 본문이 비어 있습니다.");
  }

  const parsed = xmlParser.parse(xml);
  const rssChannel = parsed?.rss?.channel;
  const atomFeed = parsed?.feed;

  if (rssChannel) {
    const channelTitle = cleanText(rssChannel.title);
    return {
      title: channelTitle || feed.title || feed.id,
      items: toArray(rssChannel.item)
        .map((item) => normalizeRssItem(feed, item, channelTitle))
        .filter(Boolean),
    };
  }

  if (atomFeed) {
    const channelTitle = cleanText(atomFeed.title);
    return {
      title: channelTitle || feed.title || feed.id,
      items: toArray(atomFeed.entry)
        .map((item) => normalizeRssItem(feed, item, channelTitle))
        .filter(Boolean),
    };
  }

  throw new Error("RSS 또는 Atom 문서로 인식하지 못했습니다.");
}

function readJsonFile(path) {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function normalizeNewsFeedConfig(config = {}) {
  const raw = config && typeof config === "object" ? config : {};
  const feeds = toArray(raw.feeds)
    .map((feed, index) => {
      const id = safeId(feed.id || feed.title, `feed-${index + 1}`);
      return {
        id,
        title: String(feed.title || id).trim() || id,
        url: String(feed.url || "").trim(),
        itemContentMode: normalizeItemContentMode(feed.itemContentMode),
        publishedAtOffsetMinutes: normalizePublishedAtOffsetMinutes(
          feed.publishedAtOffsetMinutes
        ),
        publishedAtOffsetMigrationFetchedAfter: parseDateIso(
          feed.publishedAtOffsetMigrationFetchedAfter
        ),
        enabled: feed.enabled !== false,
      };
    })
    .filter((feed) => feed.url);

  return {
    pollIntervalSeconds: Math.max(
      60,
      Math.min(600, Number(raw.pollIntervalSeconds || DEFAULT_POLL_INTERVAL_SECONDS))
    ),
    retentionHours: Math.max(
      DEFAULT_RETENTION_HOURS,
      Number(raw.retentionHours || DEFAULT_RETENTION_HOURS)
    ),
    maxItemsPerFeed: Math.max(50, Number(raw.maxItemsPerFeed || DEFAULT_MAX_ITEMS_PER_FEED)),
    translationBatchSize: Math.max(
      1,
      Math.min(20, Number(raw.translationBatchSize || DEFAULT_TRANSLATION_BATCH_SIZE))
    ),
    feeds: feeds.length ? feeds : fallbackConfig.feeds,
  };
}

function mergeNewsFeedConfig(defaultConfig, userConfig) {
  const base = normalizeNewsFeedConfig(defaultConfig || fallbackConfig);
  if (!userConfig || typeof userConfig !== "object") return base;

  const merged = { ...base };
  for (const key of [
    "pollIntervalSeconds",
    "retentionHours",
    "maxItemsPerFeed",
    "translationBatchSize",
  ]) {
    if (userConfig[key] !== undefined) merged[key] = userConfig[key];
  }

  const order = base.feeds.map((feed) => feed.id);
  const feedMap = new Map(base.feeds.map((feed) => [feed.id, { ...feed }]));
  for (const rawFeed of toArray(userConfig.feeds)) {
    const id = safeId(rawFeed?.id || rawFeed?.title, "");
    if (!id) continue;
    const previous = feedMap.get(id) || { id };
    const next = { ...previous };
    if (rawFeed.title !== undefined) next.title = String(rawFeed.title || id).trim() || id;
    if (rawFeed.url !== undefined) next.url = String(rawFeed.url || "").trim();
    if (rawFeed.itemContentMode !== undefined) {
      next.itemContentMode = normalizeItemContentMode(rawFeed.itemContentMode);
    }
    if (rawFeed.publishedAtOffsetMinutes !== undefined) {
      next.publishedAtOffsetMinutes = normalizePublishedAtOffsetMinutes(
        rawFeed.publishedAtOffsetMinutes
      );
    }
    if (rawFeed.publishedAtOffsetMigrationFetchedAfter !== undefined) {
      next.publishedAtOffsetMigrationFetchedAfter = parseDateIso(
        rawFeed.publishedAtOffsetMigrationFetchedAfter
      );
    }
    if (rawFeed.enabled !== undefined) next.enabled = rawFeed.enabled !== false;
    feedMap.set(id, next);
    if (!order.includes(id)) order.push(id);
  }

  return normalizeNewsFeedConfig({
    ...merged,
    feeds: order.map((id) => feedMap.get(id)).filter(Boolean),
  });
}

export function applyNewsFeedPublishedAtOffsets(store = {}, config = {}) {
  const feedById = new Map(
    toArray(config.feeds).map((feed) => [String(feed?.id || ""), feed])
  );

  const items = toArray(store.items).map((item) => {
    const feed = feedById.get(String(item?.feedId || "")) || {};
    const configuredOffset = normalizePublishedAtOffsetMinutes(
      feed.publishedAtOffsetMinutes
    );
    const currentFeedUrl = String(feed.url || "").trim();
    const storedFeedUrl = String(item?.feedSourceUrl || "").trim();
    const migrationFetchedAfter = timestampMs(
      feed.publishedAtOffsetMigrationFetchedAfter
    );
    const itemFetchedAt = timestampMs(item?.fetchedAt);
    const inferredCurrentSource = Boolean(
      !storedFeedUrl &&
        migrationFetchedAfter &&
        itemFetchedAt >= migrationFetchedAfter
    );
    const belongsToCurrentSource = Boolean(
      configuredOffset === 0 ||
        (storedFeedUrl && storedFeedUrl === currentFeedUrl) ||
        inferredCurrentSource
    );
    const desiredOffset = belongsToCurrentSource ? configuredOffset : 0;
    const hasAppliedOffset = Object.hasOwn(item || {}, "publishedAtOffsetMinutes");
    const previousOffset = hasAppliedOffset
      ? normalizePublishedAtOffsetMinutes(item.publishedAtOffsetMinutes)
      : 0;
    const sourcePublishedAt = parseDateIso(
      item.sourcePublishedAt ||
        (hasAppliedOffset
          ? offsetDateIso(item.publishedAt, -previousOffset)
          : item.publishedAt)
    );
    if (!sourcePublishedAt) return item;

    const publishedAt = offsetDateIso(sourcePublishedAt, desiredOffset);
    if (
      item.sourcePublishedAt === sourcePublishedAt &&
      item.publishedAt === publishedAt &&
      previousOffset === desiredOffset &&
      (!inferredCurrentSource || storedFeedUrl === currentFeedUrl)
    ) {
      return item;
    }
    return {
      ...item,
      ...(inferredCurrentSource ? { feedSourceUrl: currentFeedUrl } : {}),
      sourcePublishedAt,
      publishedAt,
      publishedAtOffsetMinutes: desiredOffset,
    };
  });

  return { ...store, items };
}

function translationSourceFieldForItem(item = {}) {
  return normalizeItemContentMode(item.itemContentMode) === "title-only" ? "title" : "body";
}

function translationSourceText(item = {}) {
  return compactTranslationText(
    translationSourceFieldForItem(item) === "title" ? item.title : item.originalText
  );
}

export function applyNewsFeedContentModes(store = {}, config = {}) {
  const feedById = new Map(
    toArray(config.feeds).map((feed) => [String(feed?.id || ""), feed])
  );
  const items = toArray(store.items).map((item) => {
    const feed = feedById.get(String(item?.feedId || ""));
    if (!feed) return item;
    const desiredMode = normalizeItemContentMode(feed.itemContentMode);
    const currentMode = normalizeItemContentMode(item.itemContentMode);
    const sourceField = desiredMode === "title-only" ? "title" : "body";

    if (desiredMode === currentMode && item.translationSourceField === sourceField) {
      return item;
    }

    if (desiredMode === "title-only") {
      return {
        ...item,
        originalText: "",
        translatedTitle: "",
        translatedText: "",
        translatedAt: "",
        translationStatus: item.title ? "pending" : "translated",
        translationError: "",
        itemContentMode: desiredMode,
        translationSourceField: sourceField,
      };
    }

    return {
      ...item,
      itemContentMode: desiredMode,
      translationSourceField: sourceField,
    };
  });

  return { ...store, items };
}

function readNewsFeedConfig() {
  ensureDirs();
  const defaultConfig = readJsonFile(DEFAULT_CONFIG_PATH) || fallbackConfig;
  const userConfig = readJsonFile(USER_CONFIG_PATH) || readJsonFile(LEGACY_CONFIG_PATH);
  return mergeNewsFeedConfig(defaultConfig, userConfig);
}

function writeNewsFeedConfig(config) {
  ensureDirs();
  const nextConfig = normalizeNewsFeedConfig(config);
  writeFileSync(USER_CONFIG_PATH, `${JSON.stringify(nextConfig, null, 2)}\n`);
  return readNewsFeedConfig();
}

function feedItemCount(store, feedId) {
  return store.items.filter((item) => item.feedId === feedId).length;
}

function publicSettingsSnapshot() {
  const config = readNewsFeedConfig();
  const store = readStore();
  return {
    ok: true,
    configPath: "config/news-feeds.user.json",
    defaultConfigPath: "config/news-feeds.defaults.json",
    pollIntervalSeconds: config.pollIntervalSeconds,
    retentionHours: config.retentionHours,
    translationBatchSize: config.translationBatchSize,
    feeds: config.feeds.map((feed) => {
      const status = store.feeds.find((item) => item.id === feed.id) || {};
      return {
        id: feed.id,
        title: feed.title,
        enabled: feed.enabled,
        publishedAtOffsetMinutes: feed.publishedAtOffsetMinutes,
        itemContentMode: feed.itemContentMode,
        lastFetchStatus: feed.enabled ? status.lastFetchStatus || "idle" : "disabled",
        lastFetchedAt: status.lastFetchedAt || "",
        lastError: feed.enabled ? status.lastError || "" : "",
        itemCount: feedItemCount(store, feed.id),
      };
    }),
  };
}

function updateStoreFeedEnabled(feed, enabled) {
  const store = readStore();
  const previous = store.feeds.find((item) => item.id === feed.id) || {};
  const restoredStatus = previous.itemCount || previous.lastSeenCount ? "ok" : "idle";
  updateFeedStatus(store, feed, {
    enabled,
    lastFetchStatus: enabled ? restoredStatus : "disabled",
    lastError: "",
    lastNewCount: 0,
  });
  writeStore(store);
}

function emptyStore() {
  return {
    version: 1,
    updatedAt: nowIso(),
    collector: {
      running: false,
      healthy: false,
      status: "idle",
      lastAction: "대기 중",
      lastError: "",
      lastPollStartedAt: "",
      lastPollFinishedAt: "",
      lastNewCount: 0,
      lastTranslatedCount: 0,
      translationModel: "",
      translationReasoning: "",
    },
    feeds: [],
    items: [],
  };
}

function readStore() {
  ensureDirs();
  if (!existsSync(STORE_PATH)) {
    return emptyStore();
  }
  try {
    const store = JSON.parse(readFileSync(STORE_PATH, "utf8"));
    return sanitizeStoredTranslationIntegrity({
      ...emptyStore(),
      ...store,
      collector: { ...emptyStore().collector, ...(store.collector || {}) },
      feeds: Array.isArray(store.feeds) ? store.feeds : [],
      items: Array.isArray(store.items) ? store.items : [],
    });
  } catch {
    return emptyStore();
  }
}

function sanitizeStoredTranslationIntegrity(store) {
  let sanitizedCount = 0;
  const items = store.items.map((item) => {
    if (
      item?.translationStatus !== "translated" ||
      (!hasUnicodeReplacementCharacter(item.translatedText) &&
        !hasUnicodeReplacementCharacter(item.translatedTitle))
    ) {
      return item;
    }
    sanitizedCount += 1;
    return {
      ...item,
      translatedTitle: "",
      translatedText: "",
      translatedAt: "",
      translationStatus: "pending",
      translationError:
        "저장된 번역에 유니코드 대체 문자가 있어 재번역 대기열로 이동했습니다.",
    };
  });
  if (!sanitizedCount) return store;
  return {
    ...store,
    collector: {
      ...store.collector,
      translationLastError: `${sanitizedCount}개 항목의 깨진 번역을 재시도 대기열로 이동했습니다.`,
    },
    items,
  };
}

function writeStore(store) {
  ensureDirs();
  const nextStore = { ...store, updatedAt: nowIso() };
  writeFileSync(STORE_PATH, `${JSON.stringify(nextStore, null, 2)}\n`);
  return nextStore;
}

function emptyReadState() {
  return {
    version: 1,
    updatedAt: nowIso(),
    lastOpenedAt: "",
  };
}

function readNewsFeedReadState() {
  ensureDirs();
  if (!existsSync(READ_STATE_PATH)) {
    return emptyReadState();
  }
  try {
    const readState = JSON.parse(readFileSync(READ_STATE_PATH, "utf8"));
    return {
      ...emptyReadState(),
      ...readState,
      lastOpenedAt: typeof readState.lastOpenedAt === "string" ? readState.lastOpenedAt : "",
    };
  } catch {
    return emptyReadState();
  }
}

function writeNewsFeedReadState(readState) {
  ensureDirs();
  const nextReadState = {
    ...emptyReadState(),
    ...readState,
    updatedAt: nowIso(),
  };
  writeFileSync(READ_STATE_PATH, `${JSON.stringify(nextReadState, null, 2)}\n`);
  return nextReadState;
}

function emptyViewState() {
  return {
    version: 1,
    updatedAt: nowIso(),
    marketSummaryCollapsed: true,
  };
}

function readNewsFeedViewState() {
  ensureDirs();
  if (!existsSync(VIEW_STATE_PATH)) {
    return emptyViewState();
  }
  try {
    const viewState = JSON.parse(readFileSync(VIEW_STATE_PATH, "utf8"));
    return {
      ...emptyViewState(),
      ...viewState,
      marketSummaryCollapsed: viewState.marketSummaryCollapsed !== false,
    };
  } catch {
    return emptyViewState();
  }
}

function writeNewsFeedViewState(viewState) {
  ensureDirs();
  const nextViewState = {
    ...emptyViewState(),
    ...viewState,
    marketSummaryCollapsed: viewState.marketSummaryCollapsed !== false,
    updatedAt: nowIso(),
  };
  writeFileSync(VIEW_STATE_PATH, `${JSON.stringify(nextViewState, null, 2)}\n`);
  return nextViewState;
}

function newsFeedReadStateSnapshot(store, readState = readNewsFeedReadState()) {
  const lastOpenedMs = timestampMs(readState.lastOpenedAt);
  let unreadTranslatedCount = 0;
  let latestTranslatedAt = "";
  let latestTranslatedMs = 0;

  for (const item of store.items) {
    if (item.translationStatus !== "translated") continue;
    const translatedMs = timestampMs(item.translatedAt);
    if (!translatedMs) continue;
    if (translatedMs > latestTranslatedMs) {
      latestTranslatedMs = translatedMs;
      latestTranslatedAt = item.translatedAt;
    }
    if (translatedMs > lastOpenedMs) {
      unreadTranslatedCount += 1;
    }
  }

  return {
    lastOpenedAt: readState.lastOpenedAt,
    unreadTranslatedCount,
    latestTranslatedAt,
    path: "data/news-feed-read-state.json",
  };
}

function newsFeedViewStateSnapshot(viewState = readNewsFeedViewState()) {
  return {
    marketSummaryCollapsed: viewState.marketSummaryCollapsed !== false,
    updatedAt: viewState.updatedAt || "",
    path: "data/news-feed-view-state.json",
  };
}

function markNewsFeedOpened() {
  const readState = writeNewsFeedReadState({
    ...readNewsFeedReadState(),
    lastOpenedAt: nowIso(),
  });
  return publicSnapshot({ limit: 0, readState });
}

function publicItem(item) {
  const {
    sourceFingerprint,
    ...rest
  } = item;
  return rest;
}

function publicFeed(feed) {
  const {
    url,
    ...rest
  } = feed;
  return rest;
}

function runtimeState() {
  if (!globalThis[runtimeKey]) {
    globalThis[runtimeKey] = {
      started: false,
      timer: null,
      inFlight: null,
      translationInFlight: null,
      dailyDigestInFlight: null,
      dailyDigestTimer: null,
      nextDailyDigestAt: "",
      nextPollAt: "",
      startedAt: "",
    };
  }
  return globalThis[runtimeKey];
}

function newsFeedTranslationAutoRunEnabled() {
  return process.env.NEWS_FEED_TRANSLATION_AUTORUN !== "0";
}

function scheduleNewsFeedCollector(
  config = readNewsFeedConfig(),
  delayMs = config.pollIntervalSeconds * 1000
) {
  const runtime = runtimeState();
  if (!runtime.started || process.env.NEWS_FEED_COLLECTOR_DISABLED === "1") return;
  if (runtime.timer) clearTimeout(runtime.timer);
  const safeDelayMs = Math.max(0, Number(delayMs) || 0);
  runtime.nextPollAt = new Date(Date.now() + safeDelayMs).toISOString();
  runtime.timer = setTimeout(() => {
    runtime.timer = null;
    void refreshNewsFeeds("interval");
  }, safeDelayMs);
}

function collectorStatusFromStore(store, config) {
  const runtime = runtimeState();
  const enabledFeeds = config.feeds.filter((feed) => feed.enabled);
  const feedStatuses = enabledFeeds.map((feed) => store.feeds.find((item) => item.id === feed.id));
  const allFetched = enabledFeeds.length > 0 && feedStatuses.every((feed) => feed?.lastFetchStatus === "ok");
  const healthy = Boolean(runtime.started && !runtime.inFlight && allFetched && store.collector.status === "ok");

  return {
    ...store.collector,
    running: runtime.started,
    inFlight: Boolean(runtime.inFlight),
    translationInFlight: Boolean(runtime.translationInFlight),
    translationAutoRun: newsFeedTranslationAutoRunEnabled(),
    healthy,
    nextPollAt: runtime.nextPollAt,
    pollIntervalSeconds: config.pollIntervalSeconds,
    retentionHours: config.retentionHours,
    dataPath: "data/news-feed.json",
    configPath: "config/news-feeds.user.json",
    defaultConfigPath: "config/news-feeds.defaults.json",
  };
}

function publicSnapshot({ limit = 80, offset = 0, readState = null, viewState = null } = {}) {
  const snapshotReadState = readState || readNewsFeedReadState();
  const snapshotViewState = viewState || readNewsFeedViewState();
  const config = readNewsFeedConfig();
  const store = readStore();
  const sortedItems = limit > 0
    ? store.items
        .slice()
        .sort((a, b) => String(b.publishedAt || b.fetchedAt).localeCompare(String(a.publishedAt || a.fetchedAt)))
    : [];
  const items = sortedItems
    .slice(offset, offset + limit)
    .map(publicItem);
  const latestItem = store.items.reduce((latest, item) => {
    if (!latest) return item;
    const itemTimestamp = String(item.publishedAt || item.fetchedAt || "");
    const latestTimestamp = String(latest.publishedAt || latest.fetchedAt || "");
    return itemTimestamp > latestTimestamp ? item : latest;
  }, null);
  const readStateSnapshot = newsFeedReadStateSnapshot(store, snapshotReadState);
  const itemCount = store.items.length;
  const contentRevision = [
    itemCount,
    latestItem?.id || "",
    readStateSnapshot.latestTranslatedAt || "",
  ].join(":");

  return {
    ok: true,
    collector: collectorStatusFromStore(store, config),
    feeds: store.feeds.map((feed) => publicFeed({ ...feed, itemCount: feedItemCount(store, feed.id) })),
    configuredFeeds: config.feeds.map((feed) => ({
      id: feed.id,
      title: feed.title,
      enabled: feed.enabled,
      publishedAtOffsetMinutes: feed.publishedAtOffsetMinutes,
      itemContentMode: feed.itemContentMode,
    })),
    itemCount,
    latestItemId: latestItem?.id || "",
    contentRevision,
    readState: readStateSnapshot,
    viewState: newsFeedViewStateSnapshot(snapshotViewState),
    dailyDigest: publicDailyDigestSnapshot(),
    offset,
    limit,
    hasMore: offset + items.length < itemCount,
    items,
  };
}

function emptyDailyDigestStore() {
  return {
    version: 1,
    updatedAt: "",
    latest: null,
    history: [],
  };
}

function readDailyDigestStore() {
  ensureDirs();
  const payload = readJsonFile(DAILY_DIGEST_PATH);
  if (!payload || typeof payload !== "object") return emptyDailyDigestStore();
  return {
    ...emptyDailyDigestStore(),
    ...payload,
    latest: payload.latest && typeof payload.latest === "object" ? payload.latest : null,
    history: toArray(payload.history).filter((item) => item && typeof item === "object"),
  };
}

function writeDailyDigestStore(store) {
  ensureDirs();
  const next = {
    ...emptyDailyDigestStore(),
    ...store,
    updatedAt: nowIso(),
    history: toArray(store.history).slice(0, DAILY_DIGEST_HISTORY_LIMIT),
  };
  writeFileSync(DAILY_DIGEST_PATH, `${JSON.stringify(next, null, 2)}\n`);
  return next;
}

function kstDateLabel(timestamp) {
  const shifted = new Date(timestamp + KST_OFFSET_MS);
  return [
    shifted.getUTCFullYear(),
    String(shifted.getUTCMonth() + 1).padStart(2, "0"),
    String(shifted.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

export function completedNewsDigestWindow(date = new Date()) {
  const nowMs = date instanceof Date ? date.getTime() : new Date(date).getTime();
  const safeNowMs = Number.isFinite(nowMs) ? nowMs : Date.now();
  const shifted = new Date(safeNowMs + KST_OFFSET_MS);
  let shiftedEndMs = Date.UTC(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth(),
    shifted.getUTCDate(),
    DAILY_DIGEST_HOUR_KST,
    DAILY_DIGEST_MINUTE_KST,
  );
  if (safeNowMs + KST_OFFSET_MS < shiftedEndMs) shiftedEndMs -= DAY_MS;
  const endMs = shiftedEndMs - KST_OFFSET_MS;
  const startMs = endMs - DAY_MS;
  return {
    key: kstDateLabel(endMs),
    startAt: new Date(startMs).toISOString(),
    endAt: new Date(endMs).toISOString(),
    startMs,
    endMs,
  };
}

function nextNewsDigestCutoff(date = new Date()) {
  const nowMs = date instanceof Date ? date.getTime() : new Date(date).getTime();
  const current = completedNewsDigestWindow(new Date(nowMs));
  return new Date(current.endMs + DAY_MS).toISOString();
}

function canonicalDigestUrl(value = "") {
  try {
    const url = new URL(String(value || "").trim());
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|fbclid$|gclid$|ref$|source$)/i.test(key)) url.searchParams.delete(key);
    }
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return "";
  }
}

const DAILY_DIGEST_STOP_WORDS = new Set([
  "the", "a", "an", "and", "or", "of", "to", "in", "on", "for", "with", "from",
  "at", "by", "as", "is", "are", "was", "were", "be", "has", "have", "had", "will",
  "said", "says", "after", "before", "about", "over", "under", "into", "its", "it",
  "this", "that", "these", "those", "new", "update", "breaking",
  "및", "관련", "대한", "통해", "따라", "위해", "에서", "으로", "이다", "있다", "발표",
]);

function digestItemText(item = {}) {
  return compactTranslationText(
    item.translatedText ||
      item.translatedTitle ||
      item.originalText ||
      item.title ||
      "",
  );
}

function digestTokens(value = "") {
  return new Set(
    String(value || "")
      .toLocaleLowerCase("en-US")
      .replace(/https?:\/\/\S+/g, " ")
      .replace(/[^\p{L}\p{N}$%]+/gu, " ")
      .split(/\s+/)
      .map((token) => token.trim())
      .filter((token) => token.length >= 2 && !DAILY_DIGEST_STOP_WORDS.has(token)),
  );
}

function tokenSimilarity(left, right) {
  if (!left.size || !right.size) return 0;
  let shared = 0;
  for (const token of left) {
    if (right.has(token)) shared += 1;
  }
  return shared / Math.min(left.size, right.size);
}

function digestItemsSameEvent(left, right) {
  if (left.canonicalUrl && right.canonicalUrl && left.canonicalUrl === right.canonicalUrl) {
    return true;
  }
  const similarity = tokenSimilarity(left.tokens, right.tokens);
  if (similarity >= 0.72) return true;
  const sharedTicker = [...left.tokens].some(
    (token) => (token.startsWith("$") || /^[A-Z]{2,5}$/.test(token)) && right.tokens.has(token),
  );
  return sharedTicker && similarity >= 0.58;
}

export function clusterNewsDigestItems(items = [], window = completedNewsDigestWindow()) {
  const eligible = toArray(items)
    .filter((item) => {
      const time = itemTimestampMs(item);
      return time >= window.startMs && time < window.endMs && digestItemText(item);
    })
    .sort((a, b) => itemTimestampMs(b) - itemTimestampMs(a))
    .map((item) => {
      const text = digestItemText(item);
      return {
        item,
        text,
        tokens: digestTokens(text),
        canonicalUrl: canonicalDigestUrl(item.sourceUrl),
      };
    });

  const clusters = [];
  for (const candidate of eligible) {
    const existing = clusters.find((cluster) =>
      cluster.members.some((member) => digestItemsSameEvent(member, candidate))
    );
    if (existing) {
      existing.members.push(candidate);
      continue;
    }
    clusters.push({ members: [candidate] });
  }

  return clusters.map((cluster, index) => {
    const members = cluster.members;
    const feedIds = [...new Set(members.map(({ item }) => item.feedId).filter(Boolean))];
    const sourceUrls = [...new Set(members.map(({ item }) => item.sourceUrl).filter(Boolean))];
    const representative = members[0];
    return {
      id: `event-${index + 1}`,
      representativeText: representative.text,
      latestAt: representative.item.publishedAt || representative.item.fetchedAt || "",
      itemCount: members.length,
      sourceCount: feedIds.length,
      sources: [...new Set(members.map(({ item }) => item.feedTitle || item.feedId).filter(Boolean))],
      sourceUrls: sourceUrls.slice(0, 3),
      itemIds: members.map(({ item }) => item.id).filter(Boolean),
      sampleTexts: members.slice(0, 3).map(({ text }) => text),
      verificationStatus: feedIds.length >= 2 ? "multi_source" : "metadata_only",
    };
  });
}

function publicDailyDigestSnapshot() {
  const runtime = runtimeState();
  const store = readDailyDigestStore();
  const latest = store.latest || null;
  return {
    ...(latest || {}),
    available: Boolean(latest),
    inFlight: Boolean(runtime.dailyDigestInFlight),
    nextRunAt: runtime.nextDailyDigestAt || nextNewsDigestCutoff(),
    dataPath: "data/news-feed-daily-digest.json",
  };
}

async function fetchWithTimeout(url, options = {}, timeoutMs = FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchFeedXml(feed) {
  const attempts = [
    { label: "default", headers: defaultFeedHeaders },
    { label: "browser-like", headers: browserLikeFeedHeaders },
  ];

  let lastError = null;
  for (const attempt of attempts) {
    try {
      const response = await fetchWithTimeout(feed.url, { headers: attempt.headers });
      const xml = await response.text();
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      if (!xml.trim()) {
        throw new Error(`${attempt.label} 요청의 RSS 응답 본문이 비어 있습니다.`);
      }
      return xml;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error("RSS 응답을 가져오지 못했습니다.");
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

function codexTranslationModel(options) {
  const selection = selectCodexTranslationModel({
    cliVersion: options.codex?.version,
    models: options.modelGroups,
  });

  return {
    provider: "codex-cli",
    providerLabel: "Codex CLI",
    command: options.codex?.command || options.codex?.path || "codex",
    argsPrefix: Array.isArray(options.codex?.argsPrefix)
      ? options.codex.argsPrefix
      : [],
    ...selection,
  };
}

function antigravityTranslationModel(options) {
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

function chooseTranslationModel() {
  const options = getCodexOptions();
  const selectedProvider = options.selected?.provider || "";

  if (selectedProvider === ANTIGRAVITY_PROVIDER_ID) {
    return antigravityTranslationModel(options);
  }

  if (!options.codex?.available) {
    throw new Error(options.codex?.error || "codex command not found");
  }

  return codexTranslationModel(options);
}

function translationPrompt(items) {
  const truncateForTranslation = (value, limit) => {
    const text = String(value || "").trim();
    if (text.length <= limit) return text;
    return `${text.slice(0, limit).trim()} ... [truncated for translation]`;
  };
  const input = items.map((item) => ({
    id: item.id,
    sourceField: translationSourceFieldForItem(item),
    text: truncateForTranslation(translationSourceText(item), TRANSLATION_TEXT_MAX_CHARS),
  }));

  return [
    "금융 뉴스 RSS 항목의 지정된 텍스트를 한국어로 번역한다.",
    "sourceField가 title이면 트윗 제목만, body이면 본문만 번역한다.",
    "출력은 JSON 객체 하나만 반환한다. 링크, URL, 출처 링크 문구는 절대 넣지 않는다.",
    "원문 의미를 보존하고, 시장/기업/중앙은행 용어는 한국 투자자가 읽기 자연스럽게 옮긴다.",
    "요약하거나 작성자·계정·게시일을 덧붙이지 말고 입력 text만 번역한다.",
    "입력 text가 비어 있으면 textKo는 빈 문자열로 둔다.",
    "모든 입력 id에 대해 translations 항목을 정확히 하나씩 반환한다.",
    "입력 text가 있으면 textKo를 비우지 않는다.",
    "영문 원문 문장을 그대로 복사하지 말고 반드시 한국어 문장으로 번역한다.",
    "",
    "반환 형식:",
    '{"translations":[{"id":"입력 id","textKo":"한국어 번역"}]}',
    "",
    "입력 JSON:",
    JSON.stringify({ items: input }, null, 2),
  ].join("\n");
}

function parseJsonPayload(text) {
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

function compactTranslationText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function hasUnicodeReplacementCharacter(value) {
  return String(value || "").includes(UNICODE_REPLACEMENT_CHARACTER);
}

function sameTranslationText(left, right) {
  const normalizedLeft = compactTranslationText(left).toLocaleLowerCase("en-US");
  const normalizedRight = compactTranslationText(right).toLocaleLowerCase("en-US");
  return normalizedLeft && normalizedLeft === normalizedRight;
}

function likelyNeedsKoreanTranslation(value) {
  const text = compactTranslationText(value);
  if (!text || /[가-힣]/.test(text)) return false;
  const latinWords = text.match(/[A-Za-z][A-Za-z'.-]{2,}/g) || [];
  return latinWords.length >= UNTRANSLATED_COPY_LATIN_WORDS;
}

function hasKoreanText(value) {
  return /[가-힣]/.test(String(value || ""));
}

export function normalizeNewsFeedTranslationCandidate(item = {}, translation = {}) {
  const sourceText = translationSourceText(item);
  const textKo = compactTranslationText(translation?.textKo);

  const issues = [];
  if (sourceText && !textKo) issues.push("textKo가 비어 있습니다");
  if (textKo && hasUnicodeReplacementCharacter(textKo)) {
    issues.push("textKo에 유니코드 대체 문자가 포함되어 있습니다");
  }
  if (sourceText && textKo && likelyNeedsKoreanTranslation(sourceText) && !hasKoreanText(textKo)) {
    issues.push("textKo에 한국어가 없습니다");
  }
  if (sourceText && textKo && likelyNeedsKoreanTranslation(sourceText) && sameTranslationText(sourceText, textKo)) {
    issues.push("textKo가 영문 원문과 같습니다");
  }

  return {
    ok: issues.length === 0,
    textKo,
    error: issues.length ? `번역 검증 보류: ${issues.join(", ")}` : "",
  };
}

function runCodexTranslationBatch(items, modelInfo) {
  return new Promise((resolveBatch, reject) => {
    const tempDir = mkdtempSync(join(tmpdir(), "finance-agent-news-feed-"));
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
      translationPrompt(items),
    ];

    let stdout = "";
    let stderr = "";
    let settled = false;
    const child = spawnObservedLlm(modelInfo.command || "codex", [
      ...(Array.isArray(modelInfo.argsPrefix) ? modelInfo.argsPrefix : []),
      ...args,
    ], {
      cwd: WEB_ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        NO_COLOR: "1",
      },
    }, {
      feature: "news-feed-translation",
      provider: "codex-cli",
      model: modelInfo.model,
      timeoutMs: TRANSLATION_TIMEOUT_MS,
    });
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGTERM");
      rmSync(tempDir, { recursive: true, force: true });
      reject(new Error("Codex 번역 시간이 초과되었습니다."));
    }, TRANSLATION_TIMEOUT_MS);

    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk;
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
        if (code !== 0) {
          throw new Error((stderr || output || `codex exited ${code}`).trim());
        }
        resolveBatch(parseJsonPayload(output));
      } catch (error) {
        reject(error);
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });
  });
}

async function runAntigravityTranslationBatch(items, modelInfo) {
  const result = await runAntigravityGenerate({
    prompt: translationPrompt(items),
    model: modelInfo.model,
    approval: "default",
    timeoutMs: TRANSLATION_TIMEOUT_MS,
    observationFeature: "news-feed-translation",
  });
  return parseJsonPayload(result.answer);
}

async function translateBatch(items, modelInfo) {
  if (!items.length) return { translations: [], model: "", reasoning: "" };
  const payload =
    modelInfo.provider === ANTIGRAVITY_PROVIDER_ID
      ? await runAntigravityTranslationBatch(items, modelInfo)
      : await runCodexTranslationBatch(items, modelInfo);
  return {
    translations: toArray(payload.translations),
    model: modelInfo.modelLabel || modelInfo.model,
    reasoning: modelInfo.reasoning,
  };
}

function dailyDigestPrompt({ window, clusters }) {
  const input = clusters.map((cluster) => ({
    id: cluster.id,
    latestAt: cluster.latestAt,
    itemCount: cluster.itemCount,
    sourceCount: cluster.sourceCount,
    sources: cluster.sources,
    verificationStatus: cluster.verificationStatus,
    representativeText: cluster.representativeText,
    additionalTexts: cluster.sampleTexts.slice(1),
  }));
  return [
    "너는 한국 PB가 다음 날 아침 읽는 전일 금융 뉴스 다이제스트 편집자다.",
    "입력은 이미 URL과 문장 유사도로 1차 통합된 사건 후보다.",
    "같은 사건이 여러 후보에 남아 있으면 하나로 합치고, 새 정보가 없는 반복 보도는 제외한다.",
    `중요한 사건을 최대 ${DAILY_DIGEST_MAX_EVENTS}개만 선정한다.`,
    "시장 영향 범위, 신규성, 여러 출처의 독립 확인, 금리·환율·지수·대형주·핵심 섹터 연관성을 우선한다.",
    "입력에 없는 사실이나 수치, 가격 반응, 공식 확인 여부를 만들어내지 않는다.",
    "metadata_only는 단일 속보성 출처이므로 확인된 사실처럼 단정하지 않는다.",
    "multi_source는 복수 피드에서 포착했다는 뜻일 뿐 공식 원문 확인을 의미하지 않는다.",
    "매매 추천, 목표가격, 확정적 미래 예측은 쓰지 않는다.",
    "summaryKo에는 전일 뉴스 전체의 공통 흐름과 충돌 신호를 2-4문장으로 쓴다.",
    "각 사건은 제목, 확인 가능한 내용, 왜 중요한지, 관련 자산·섹터, 확인 상태를 짧게 쓴다.",
    "clusterIds에는 반드시 입력 id만 쓰고, 같은 id를 여러 사건에 중복 사용하지 않는다.",
    "출력은 JSON 객체 하나만 반환한다.",
    "",
    "반환 형식:",
    JSON.stringify({
      summaryKo: "전일 핵심 흐름 2-4문장",
      events: [
        {
          titleKo: "사건 제목",
          summaryKo: "확인 가능한 내용",
          whyItMattersKo: "시장에 중요한 이유",
          relatedAssets: ["관련 자산 또는 섹터"],
          verificationStatus: "metadata_only|multi_source",
          clusterIds: ["event-1"],
        },
      ],
    }),
    "",
    "수집 구간:",
    JSON.stringify({ startAt: window.startAt, endAt: window.endAt, timezone: "Asia/Seoul" }),
    "",
    "사건 후보:",
    JSON.stringify(input, null, 2),
  ].join("\n");
}

function dailyDigestSchema() {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      summaryKo: { type: "string" },
      events: {
        type: "array",
        maxItems: DAILY_DIGEST_MAX_EVENTS,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            titleKo: { type: "string" },
            summaryKo: { type: "string" },
            whyItMattersKo: { type: "string" },
            relatedAssets: { type: "array", items: { type: "string" }, maxItems: 8 },
            verificationStatus: {
              type: "string",
              enum: ["metadata_only", "multi_source"],
            },
            clusterIds: { type: "array", items: { type: "string" }, minItems: 1 },
          },
          required: [
            "titleKo",
            "summaryKo",
            "whyItMattersKo",
            "relatedAssets",
            "verificationStatus",
            "clusterIds",
          ],
        },
      },
    },
    required: ["summaryKo", "events"],
  };
}

function runCodexDailyDigest(clusters, window, modelInfo) {
  return new Promise((resolveDigest, reject) => {
    const tempDir = mkdtempSync(join(tmpdir(), "finance-agent-news-digest-"));
    const outputPath = join(tempDir, "digest.json");
    const schemaPath = join(tempDir, "schema.json");
    writeFileSync(schemaPath, `${JSON.stringify(dailyDigestSchema(), null, 2)}\n`);
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
    ];
    let stdout = "";
    let stderr = "";
    let settled = false;
    const child = spawnObservedLlm(
      modelInfo.command || "codex",
      [...(Array.isArray(modelInfo.argsPrefix) ? modelInfo.argsPrefix : []), ...args],
      {
        cwd: WEB_ROOT,
        encoding: "utf8",
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env, NO_COLOR: "1" },
      },
      {
        feature: "news-feed-daily-digest",
        provider: "codex-cli",
        model: modelInfo.model,
        timeoutMs: DAILY_DIGEST_TIMEOUT_MS,
      },
    );
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdin.end(dailyDigestPrompt({ window, clusters }), "utf8");

    const cleanup = () => rmSync(tempDir, { recursive: true, force: true });
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGTERM");
      cleanup();
      reject(new Error("전일 뉴스 요약 시간이 초과되었습니다."));
    }, DAILY_DIGEST_TIMEOUT_MS);

    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      cleanup();
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
        resolveDigest(parseJsonPayload(output));
      } catch (error) {
        reject(error);
      } finally {
        cleanup();
      }
    });
  });
}

async function runDailyDigestModel(clusters, window, modelInfo) {
  if (modelInfo.provider === ANTIGRAVITY_PROVIDER_ID) {
    const result = await runAntigravityGenerate({
      prompt: dailyDigestPrompt({ window, clusters }),
      model: modelInfo.model,
      approval: "default",
      timeoutMs: DAILY_DIGEST_TIMEOUT_MS,
      observationFeature: "news-feed-daily-digest",
    });
    return parseJsonPayload(result.answer);
  }
  return runCodexDailyDigest(clusters, window, modelInfo);
}

export function normalizeNewsDailyDigestCandidate(payload = {}, clusters = []) {
  const clusterById = new Map(clusters.map((cluster) => [cluster.id, cluster]));
  const used = new Set();
  const events = [];
  for (const event of toArray(payload.events).slice(0, DAILY_DIGEST_MAX_EVENTS)) {
    const clusterIds = toArray(event?.clusterIds)
      .map((id) => String(id || "").trim())
      .filter((id) => clusterById.has(id) && !used.has(id));
    if (!clusterIds.length) continue;
    clusterIds.forEach((id) => used.add(id));
    const sourceClusters = clusterIds.map((id) => clusterById.get(id));
    const sourceUrls = [...new Set(sourceClusters.flatMap((cluster) => cluster.sourceUrls || []))].slice(0, 4);
    const sourceCount = new Set(sourceClusters.flatMap((cluster) => cluster.sources || [])).size;
    events.push({
      titleKo: compactTranslationText(event.titleKo),
      summaryKo: compactTranslationText(event.summaryKo),
      whyItMattersKo: compactTranslationText(event.whyItMattersKo),
      relatedAssets: [...new Set(toArray(event.relatedAssets).map(compactTranslationText).filter(Boolean))].slice(0, 8),
      verificationStatus: sourceCount >= 2 ? "multi_source" : "metadata_only",
      clusterIds,
      sourceUrls,
      sourceCount,
      itemCount: sourceClusters.reduce((sum, cluster) => sum + Number(cluster.itemCount || 0), 0),
    });
  }
  const summaryKo = compactTranslationText(payload.summaryKo);
  const issues = [];
  if (!summaryKo || !hasKoreanText(summaryKo)) issues.push("한국어 전체 요약이 없습니다");
  if (!events.length && clusters.length) issues.push("선정된 사건이 없습니다");
  for (const event of events) {
    if (!event.titleKo || !event.summaryKo || !event.whyItMattersKo) {
      issues.push("사건 카드의 필수 문장이 비어 있습니다");
      break;
    }
  }
  return {
    ok: issues.length === 0,
    summaryKo,
    events,
    error: issues.join(", "),
  };
}

async function generateDailyNewsDigest({ force = false, date = new Date() } = {}) {
  const runtime = runtimeState();
  if (runtime.dailyDigestInFlight) return runtime.dailyDigestInFlight;
  runtime.dailyDigestInFlight = (async () => {
    const window = completedNewsDigestWindow(date);
    const stored = readDailyDigestStore();
    if (!force && stored.latest?.windowKey === window.key && stored.latest?.status === "ready") {
      return publicDailyDigestSnapshot();
    }

    const newsStore = readStore();
    const clusters = clusterNewsDigestItems(newsStore.items, window);
    const itemCount = clusters.reduce((sum, cluster) => sum + cluster.itemCount, 0);
    let record = {
      windowKey: window.key,
      windowStartAt: window.startAt,
      windowEndAt: window.endAt,
      generatedAt: nowIso(),
      status: "ready",
      summaryKo: "",
      events: [],
      itemCount,
      clusterCount: clusters.length,
      model: "",
      reasoning: "",
      error: "",
    };

    if (!clusters.length) {
      record.summaryKo = "해당 수집 구간에 요약할 뉴스가 없습니다.";
    } else {
      try {
        const modelInfo = chooseTranslationModel();
        const payload = await runDailyDigestModel(clusters, window, modelInfo);
        const candidate = normalizeNewsDailyDigestCandidate(payload, clusters);
        if (!candidate.ok) throw new Error(candidate.error);
        record = {
          ...record,
          summaryKo: candidate.summaryKo,
          events: candidate.events,
          model: modelInfo.modelLabel || modelInfo.model,
          reasoning: modelInfo.reasoning,
        };
      } catch (error) {
        record = {
          ...record,
          status: "failed",
          summaryKo: "",
          error: compactTranslationText(error.message || "전일 뉴스 요약 생성 실패"),
        };
      }
    }

    const previousHistory = toArray(stored.history).filter(
      (item) => item.windowKey !== record.windowKey
    );
    writeDailyDigestStore({
      ...stored,
      latest: record,
      history: [record, ...previousHistory],
    });
    return publicDailyDigestSnapshot();
  })().finally(() => {
    runtime.dailyDigestInFlight = null;
  });
  return runtime.dailyDigestInFlight;
}

function scheduleDailyNewsDigest() {
  const runtime = runtimeState();
  if (runtime.dailyDigestTimer) clearTimeout(runtime.dailyDigestTimer);
  const nextAt = nextNewsDigestCutoff();
  runtime.nextDailyDigestAt = nextAt;
  const delayMs = Math.max(1000, timestampMs(nextAt) - Date.now());
  runtime.dailyDigestTimer = setTimeout(() => {
    runtime.dailyDigestTimer = null;
    void generateDailyNewsDigest().finally(scheduleDailyNewsDigest);
  }, delayMs);
}

export function applyNewsFeedTranslationBatch(store, pendingItems, translated) {
  const translationById = new Map(
    toArray(translated?.translations).map((item) => [String(item?.id || ""), item])
  );
  const pendingIds = new Set(toArray(pendingItems).map((item) => String(item?.id || "")));
  let translatedCount = 0;
  let retryCount = 0;

  const items = toArray(store?.items).map((item) => {
    if (!pendingIds.has(String(item?.id || ""))) return item;
    const translation = translationById.get(String(item.id));
    if (!translation) {
      retryCount += 1;
      return {
        ...item,
        translatedTitle: "",
        translatedText: "",
        translatedAt: "",
        translationStatus: "pending",
        translationError: "번역 응답에 이 항목이 없어 재시도 대기열에 유지합니다.",
        translationModel: translated?.model || "",
        translationReasoning: translated?.reasoning || "",
      };
    }

    const candidate = normalizeNewsFeedTranslationCandidate(item, translation);
    if (!candidate.ok) {
      retryCount += 1;
      return {
        ...item,
        translatedTitle: "",
        translatedText: "",
        translatedAt: "",
        translationStatus: "pending",
        translationError: candidate.error,
        translationModel: translated?.model || "",
        translationReasoning: translated?.reasoning || "",
      };
    }

    translatedCount += 1;
    const sourceField = translationSourceFieldForItem(item);
    return {
      ...item,
      translatedTitle: sourceField === "title" ? candidate.textKo : "",
      translatedText: sourceField === "body" ? candidate.textKo : "",
      translatedAt: nowIso(),
      translationStatus: "translated",
      translationError: "",
      translationModel: translated?.model || "",
      translationReasoning: translated?.reasoning || "",
    };
  });

  return {
    store: { ...store, items },
    translatedCount,
    retryCount,
  };
}

function updateFeedStatus(store, feed, patch) {
  const previous = store.feeds.find((item) => item.id === feed.id) || {};
  const next = {
    id: feed.id,
    title: feed.title,
    enabled: feed.enabled,
    lastFetchStatus: "idle",
    lastFetchedAt: "",
    lastError: "",
    itemCount: store.items.filter((item) => item.feedId === feed.id).length,
    ...previous,
    ...patch,
  };
  next.itemCount = store.items.filter((item) => item.feedId === feed.id).length;
  store.feeds = [next, ...store.feeds.filter((item) => item.id !== feed.id)];
}

function itemTimestampMs(item) {
  const timestamp = new Date(item.publishedAt || item.fetchedAt || 0).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function isItemWithinRetention(item, config) {
  const cutoffMs = Date.now() - config.retentionHours * 60 * 60 * 1000;
  return itemTimestampMs(item) >= cutoffMs;
}

function trimStoreItems(store, config) {
  const cutoffMs = Date.now() - config.retentionHours * 60 * 60 * 1000;
  store.items = store.items.filter((item) => {
    return itemTimestampMs(item) >= cutoffMs;
  });

  const byFeed = new Map();
  for (const item of store.items) {
    const rows = byFeed.get(item.feedId) || [];
    rows.push(item);
    byFeed.set(item.feedId, rows);
  }

  store.items = [...byFeed.values()].flatMap((items) =>
    items
      .slice()
      .sort((a, b) => String(b.publishedAt || b.fetchedAt).localeCompare(String(a.publishedAt || a.fetchedAt)))
      .slice(0, config.maxItemsPerFeed)
  );
}

function pendingTranslationItems(store) {
  return selectPendingNewsFeedTranslationBatch(store.items, Number.POSITIVE_INFINITY);
}

export function selectPendingNewsFeedTranslationBatch(items, batchSize) {
  const limit = Number.isFinite(Number(batchSize))
    ? Math.max(1, Math.floor(Number(batchSize)))
    : Number.POSITIVE_INFINITY;
  return toArray(items)
    .filter((item) => item.translationStatus === "pending")
    .sort((a, b) =>
      String(b.publishedAt || b.fetchedAt).localeCompare(String(a.publishedAt || a.fetchedAt))
    )
    .slice(0, limit);
}

function startPendingNewsFeedTranslation(batchSize) {
  const runtime = runtimeState();
  if (runtime.translationInFlight) return runtime.translationInFlight;

  runtime.translationInFlight = (async () => {
    let translatedTotal = 0;
    let modelInfo = null;
    const deferredTranslationIds = new Set();

    while (true) {
      let store = readStore();
      const pendingItems = pendingTranslationItems(store).filter(
        (item) => !deferredTranslationIds.has(String(item.id)),
      );
      if (!pendingItems.length) break;
      const batch = pendingItems.slice(0, Math.max(1, Number(batchSize) || 1));

      store.collector = {
        ...store.collector,
        lastAction: `${translatedTotal}개 번역 저장 완료 · ${pendingItems.length}개 대기 · ${batch.length}개 처리 중`,
        lastTranslatedCount: translatedTotal,
      };
      store = writeStore(store);

      try {
        modelInfo ||= chooseTranslationModel();
        const translated = await translateBatch(batch, modelInfo);
        store = readStore();
        const applied = applyNewsFeedTranslationBatch(store, batch, translated);
        store = applied.store;
        if (applied.retryCount) {
          const pendingIds = new Set(
            pendingTranslationItems(store).map((item) => String(item.id)),
          );
          for (const item of batch) {
            if (pendingIds.has(String(item.id))) {
              deferredTranslationIds.add(String(item.id));
            }
          }
        }
        translatedTotal += applied.translatedCount;
        store.collector = {
          ...store.collector,
          status: store.collector.status === "error" ? "error" : "ok",
          lastAction: applied.retryCount
            ? `${translatedTotal}개 번역 저장 완료 · ${applied.retryCount}개 재시도 대기`
            : `${translatedTotal}개 번역 저장 완료`,
          lastTranslatedCount: translatedTotal,
          translationModel: translated.model,
          translationReasoning: translated.reasoning,
          translationLastError: applied.retryCount
            ? `${applied.retryCount}개 항목 번역 검증 보류`
            : "",
          lastPollFinishedAt: nowIso(),
        };
        store = writeStore(store);
      } catch (error) {
        store = readStore();
        store.collector = {
          ...store.collector,
          status: store.collector.status === "error" ? "error" : "ok",
          lastAction: `${translatedTotal}개 번역 저장 완료 · ${batch.length}개 번역 보류 · 원문 표시 유지`,
          lastTranslatedCount: translatedTotal,
          lastPollFinishedAt: nowIso(),
          translationLastError: error.message,
        };
        writeStore(store);
        break;
      }
    }

    if (deferredTranslationIds.size) {
      let store = readStore();
      store.collector = {
        ...store.collector,
        lastAction: `${translatedTotal}개 번역 저장 완료 · ${deferredTranslationIds.size}개 다음 주기 재시도`,
        lastTranslatedCount: translatedTotal,
        translationLastError: `${deferredTranslationIds.size}개 항목 번역 검증 보류`,
        lastPollFinishedAt: nowIso(),
      };
      writeStore(store);
    }

    return publicSnapshot({ limit: 0 });
  })().finally(() => {
    runtime.translationInFlight = null;
  });

  return runtime.translationInFlight;
}

async function refreshNewsFeeds(reason = "manual") {
  const runtime = runtimeState();
  if (runtime.inFlight) return runtime.inFlight;
  if (runtime.timer) {
    clearTimeout(runtime.timer);
    runtime.timer = null;
  }

  runtime.inFlight = (async () => {
    const config = readNewsFeedConfig();
    const startedAtMs = Date.now();
    const startedAt = new Date(startedAtMs).toISOString();
    const enabledFeeds = config.feeds.filter((feed) => feed.enabled);
    const feedPlan = staggeredFeedPlan(enabledFeeds);
    const staggerWindowSeconds =
      feedPlan.length > 1 ? Math.round(FEED_FETCH_STAGGER_WINDOW_MS / 1000) : 0;
    let store = applyNewsFeedContentModes(
      applyNewsFeedPublishedAtOffsets(readStore(), config),
      config
    );
    const existingFingerprints = new Set(store.items.map((item) => item.sourceFingerprint).filter(Boolean));
    const newItems = [];
    const issues = [];

    store.collector = {
      ...store.collector,
      running: true,
      status: "polling",
      lastAction:
        staggerWindowSeconds > 0
          ? `${reason === "manual" ? "수동" : "자동"} 수집 중 · ${enabledFeeds.length}개 피드 최대 ${staggerWindowSeconds}초 분산`
          : reason === "manual"
            ? "수동 수집 중"
            : "자동 수집 중",
      lastError: "",
      lastPollStartedAt: startedAt,
      feedStaggerWindowSeconds: staggerWindowSeconds,
      feedStaggerPlan: feedPlan.map(({ feed, delayMs }) => ({
        feedId: feed.id,
        delaySeconds: Math.round(delayMs / 1000),
      })),
      lastNewCount: 0,
      lastTranslatedCount: 0,
    };
    store = writeStore(store);

    for (const feed of config.feeds.filter((feed) => !feed.enabled)) {
      updateFeedStatus(store, feed, { lastFetchStatus: "disabled", lastError: "" });
    }

    for (const { feed, delayMs } of feedPlan) {
      try {
        await waitUntilFeedOffset(startedAtMs, delayMs);
        const xml = await fetchFeedXml(feed);
        const parsed = parseFeedXml(xml, feed);
        const feedNewItems = [];

        for (const item of parsed.items) {
          if (!isItemWithinRetention(item, config)) continue;
          if (existingFingerprints.has(item.sourceFingerprint)) continue;
          existingFingerprints.add(item.sourceFingerprint);
          feedNewItems.push(item);
        }

        store.items.unshift(...feedNewItems);
        newItems.push(...feedNewItems);
        updateFeedStatus(store, feed, {
          title: feed.title || parsed.title,
          lastFetchStatus: "ok",
          lastFetchedAt: nowIso(),
          lastError: "",
          lastSeenCount: parsed.items.length,
          lastNewCount: feedNewItems.length,
        });
      } catch (error) {
        issues.push({ feedId: feed.id, message: error.message });
        updateFeedStatus(store, feed, {
          lastFetchStatus: "error",
          lastFetchedAt: nowIso(),
          lastError: error.message,
          lastNewCount: 0,
        });
      }
    }

    const refreshItems = store.items;
    const refreshFeeds = store.feeds;
    const previousCollector = store.collector;
    const latestStore = readStore();
    const latestCollector = latestStore.collector || {};

    store = {
      ...latestStore,
      feeds: refreshFeeds,
      items: mergeNewsFeedItemsPreservingLatest(latestStore.items, refreshItems),
    };

    trimStoreItems(store, config);
    store.collector = {
      ...latestCollector,
      status: issues.length ? "error" : "ok",
      healthy: !issues.length,
      lastAction: newItems.length
        ? newsFeedTranslationAutoRunEnabled()
          ? `${newItems.length}개 신규 항목 저장, 번역 대기열 등록`
          : `${newItems.length}개 신규 항목 저장, 번역 보류`
        : "신규 항목 없음",
      lastError: issues.map((issue) => `${issue.feedId}: ${issue.message}`).join(" / "),
      lastPollFinishedAt: nowIso(),
      feedStaggerWindowSeconds: staggerWindowSeconds,
      lastNewCount: newItems.length,
      lastTranslatedCount: latestCollector.lastTranslatedCount || 0,
      translationModel: latestCollector.translationModel || previousCollector.translationModel || "",
      translationReasoning:
        latestCollector.translationReasoning || previousCollector.translationReasoning || "",
      translationLastError: latestCollector.translationLastError || "",
    };
    store = writeStore(store);

    if (newsFeedTranslationAutoRunEnabled() && (newItems.length || pendingTranslationItems(store).length)) {
      void startPendingNewsFeedTranslation(config.translationBatchSize);
    }

    return publicSnapshot({ limit: 0 });
  })().finally(() => {
    const config = readNewsFeedConfig();
    runtime.inFlight = null;
    if (runtime.started && process.env.NEWS_FEED_COLLECTOR_DISABLED !== "1") {
      scheduleNewsFeedCollector(config);
    } else {
      runtime.nextPollAt = "";
    }
  });

  return runtime.inFlight;
}

export function startNewsFeedCollector() {
  const runtime = runtimeState();
  if (runtime.started || process.env.NEWS_FEED_COLLECTOR_DISABLED === "1") return;

  runtime.started = true;
  runtime.startedAt = nowIso();
  scheduleDailyNewsDigest();

  void refreshNewsFeeds("startup").finally(() => {
    void generateDailyNewsDigest();
    if (!newsFeedTranslationAutoRunEnabled()) return;
    const latestConfig = readNewsFeedConfig();
    void startPendingNewsFeedTranslation(latestConfig.translationBatchSize);
  });
}

export async function handleNewsFeedEndpoint(kind, req, res) {
  try {
    if (kind === "settings") {
      if (req.method === "GET") {
        sendJson(res, publicSettingsSnapshot());
        return;
      }

      if (req.method === "PATCH" || req.method === "POST") {
        const body = await readJsonBody(req);
        const feedId = safeId(body.feedId || body.id, "");
        const config = readNewsFeedConfig();
        const hasPollInterval = body.pollIntervalSeconds !== undefined;
        const pollIntervalSeconds = hasPollInterval
          ? Math.max(60, Math.min(600, Number(body.pollIntervalSeconds || 0)))
          : config.pollIntervalSeconds;

        if (hasPollInterval && !Number.isFinite(pollIntervalSeconds)) {
          sendJson(res, { ok: false, error: "invalid poll interval" }, 400);
          return;
        }

        let nextFeeds = config.feeds;
        let nextFeed = null;
        let enabled = null;
        if (feedId) {
          enabled = Boolean(body.enabled);
          const feed = config.feeds.find((item) => item.id === feedId);
          if (!feed) {
            sendJson(res, { ok: false, error: "feed not found" }, 404);
            return;
          }
          nextFeeds = config.feeds.map((item) =>
            item.id === feedId ? { ...item, enabled } : item
          );
        } else if (!hasPollInterval) {
          sendJson(res, { ok: false, error: "settings patch is empty" }, 400);
          return;
        }

        const nextConfig = writeNewsFeedConfig({
          ...config,
          pollIntervalSeconds,
          feeds: nextFeeds,
        });
        scheduleNewsFeedCollector(nextConfig);
        if (feedId) {
          nextFeed = nextConfig.feeds.find((item) => item.id === feedId);
          if (nextFeed) updateStoreFeedEnabled(nextFeed, enabled);
          if (nextFeed?.enabled) await refreshNewsFeeds("settings");
        }
        sendJson(res, publicSettingsSnapshot());
        return;
      }

      sendJson(res, { ok: false, error: "method not allowed" }, 405);
      return;
    }

    if (kind === "status") {
      if (req.method !== "GET") {
        sendJson(res, { ok: false, error: "method not allowed" }, 405);
        return;
      }
      sendJson(res, publicSnapshot({ limit: 0 }));
      return;
    }

    if (kind === "daily-digest") {
      if (req.method === "GET") {
        sendJson(res, { ok: true, dailyDigest: publicDailyDigestSnapshot() });
        return;
      }
      if (req.method === "POST") {
        const body = await readJsonBody(req);
        await generateDailyNewsDigest({ force: body.force !== false });
        sendJson(res, { ok: true, dailyDigest: publicDailyDigestSnapshot() });
        return;
      }
      sendJson(res, { ok: false, error: "method not allowed" }, 405);
      return;
    }

    if (kind === "read-state") {
      if (req.method === "GET") {
        sendJson(res, publicSnapshot({ limit: 0 }));
        return;
      }

      if (req.method === "POST" || req.method === "PATCH") {
        sendJson(res, markNewsFeedOpened());
        return;
      }

      sendJson(res, { ok: false, error: "method not allowed" }, 405);
      return;
    }

    if (kind === "view-state") {
      if (req.method === "GET") {
        sendJson(res, {
          ok: true,
          viewState: newsFeedViewStateSnapshot(),
        });
        return;
      }

      if (req.method === "POST" || req.method === "PATCH") {
        const body = await readJsonBody(req);
        if (body.marketSummaryCollapsed === undefined) {
          sendJson(res, { ok: false, error: "view-state patch is empty" }, 400);
          return;
        }
        const viewState = writeNewsFeedViewState({
          ...readNewsFeedViewState(),
          marketSummaryCollapsed: Boolean(body.marketSummaryCollapsed),
        });
        sendJson(res, publicSnapshot({ limit: 0, viewState }));
        return;
      }

      sendJson(res, { ok: false, error: "method not allowed" }, 405);
      return;
    }

    if (kind === "items") {
      if (req.method !== "GET") {
        sendJson(res, { ok: false, error: "method not allowed" }, 405);
        return;
      }
      const url = new URL(req.url, `http://${req.headers.host || "127.0.0.1"}`);
      const limit = Math.max(1, Math.min(200, Number(url.searchParams.get("limit") || 80)));
      const offset = Math.max(0, Number(url.searchParams.get("offset") || 0));
      sendJson(res, publicSnapshot({ limit, offset }));
      return;
    }

    if (kind === "refresh") {
      if (req.method !== "POST") {
        sendJson(res, { ok: false, error: "method not allowed" }, 405);
        return;
      }
      const collectionAlreadyRunning = Boolean(runtimeState().inFlight);
      void refreshNewsFeeds("manual").catch(() => {});
      sendJson(
        res,
        {
          ...publicSnapshot({ limit: 0 }),
          accepted: !collectionAlreadyRunning,
          collectionAlreadyRunning,
        },
        collectionAlreadyRunning ? 200 : 202
      );
      return;
    }

    sendJson(res, { ok: false, error: "unknown news-feed endpoint" }, 404);
  } catch (error) {
    sendJson(res, { ok: false, error: error.message }, 500);
  }
}
