import { randomInt, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { createReadStream, existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { extname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getCodexOptions, runCodexChat, sendJson } from "./codexProbe.mjs";
import {
  isMagazineEnabled,
  publicMagazineSettingsSnapshot,
  readMagazineSettings,
  writeMagazineSettingsPatch,
} from "./magazineSettings.mjs";

const WEB_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const GUIBUILD_ROOT = resolve(WEB_ROOT, "..");
const DATA_MAGAZINE_DIR = join(GUIBUILD_ROOT, "data", "magazine");
const MAGAZINE_ARTICLES_DIR = join(DATA_MAGAZINE_DIR, "articles");
const MAGAZINE_EVENT_SIGNATURE_INDEX_PATH = join(DATA_MAGAZINE_DIR, "event-signature-index.sqlite3");
const MAGAZINE_READ_STATE_PATH = join(DATA_MAGAZINE_DIR, "read-state.json");
const MAGAZINE_SCHEDULER_STATE_PATH = join(DATA_MAGAZINE_DIR, "scheduler-state.json");
const MAGAZINE_GENERATION_LOCK_PATH = join(DATA_MAGAZINE_DIR, ".generation.lock");
const MAGAZINE_PREFERENCES_PATH = join(DATA_MAGAZINE_DIR, "editorial-preferences.json");
const MAGAZINE_EDITORIAL_BIAS_PATH = join(DATA_MAGAZINE_DIR, "editorial-bias.json");
const MAGAZINE_TOPICS_PATH = join(GUIBUILD_ROOT, "config", "magazine-topics.json");
const MAGAZINE_CODEX_GENERATOR = join(GUIBUILD_ROOT, "scripts", "magazine_generate_with_codex.mjs");
const NEWS_FEED_STORE_PATH = join(GUIBUILD_ROOT, "data", "news-feed.json");
const WORLD_MEMORY_STATE_PATH = join(GUIBUILD_ROOT, "data", "world-memory", "collector-state.json");
const AGENT_SETTINGS_DEFAULT_PATH = join(GUIBUILD_ROOT, "config", "agent-settings.defaults.json");
const AGENT_SETTINGS_USER_PATH = join(GUIBUILD_ROOT, "config", "agent-settings.user.json");
const MAX_ARTICLES = 200;
const MAGAZINE_STATUS_RECORD_CACHE_MS = 60 * 1000;
const MAX_ARTICLE_HTML_BYTES = 2 * 1024 * 1024;
const MAX_PREFERENCE_EVENTS = 5000;
const MAX_BIAS_EVENTS = 5000;
const MAX_COMMENTS_PER_ARTICLE = 500;
const MAX_COMMENT_TEXT_CHARS = 4000;
const MAX_COMMENT_REPLY_CHARS = 12000;
const ARTICLE_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,119}$/i;
const PREFERENCE_ID_PATTERN = /^[a-z0-9][a-z0-9._:-]{0,119}$/i;
const PREFERENCE_DECAY_WINDOWS_DAYS = [30, 90, 180, 365];
const MAGAZINE_EVENT_SIGNATURE_TABLE = "magazine_event_signature_embeddings";
const WORLD_MEMORY_VECTOR_POLICY = {
  requiredForWorldMemoryArticles: true,
  retrievalPolicy: "mandatory-vector-search",
  retrievalMode: "world_memory_cli.py semantic-search vector similarity",
};
const MAGAZINE_CODEX_PROVIDER_ID = "codex-cli";
const MAGAZINE_ANTIGRAVITY_PROVIDER_ID = "antigravity-cli";
const MAGAZINE_CODEX_REASONING_IDS = new Set(["minimal", "low", "medium", "high", "xhigh", "max", "ultra"]);
const MAGAZINE_ANTIGRAVITY_REASONING_IDS = new Set(["minimal", "low", "medium", "high"]);

let magazineStatusRecordCache = null;

const MAGAZINE_GENERATION_TIMEOUT_MS = 31 * 60 * 1000;
const MAGAZINE_SCHEDULER_DEFAULT_INTERVAL_MS = 6 * 60 * 60 * 1000;
const MAGAZINE_SCHEDULER_MIN_INTERVAL_MS = 60_000;
const MAGAZINE_SCHEDULER_MAX_INTERVAL_MS = 24 * 60 * 60 * 1000;
const MAGAZINE_SCHEDULER_ENV_MAX_PER_CYCLE =
  process.env.FINANCE_AGENT_MAGAZINE_MAX_PER_CYCLE === undefined
    ? null
    : clampInteger(process.env.FINANCE_AGENT_MAGAZINE_MAX_PER_CYCLE, 0, 3, 3);
const MAGAZINE_ARTICLE_TOPIC_LIMIT = 3;
const MAGAZINE_SCHEDULER_MAX_MANUAL_DELAY_MS = 24 * 60 * 60 * 1000;
const MAGAZINE_SCHEDULER_RUNTIME_KEY = Symbol.for("finance-agent-gui.magazineSchedulerRuntime");
const MAGAZINE_WORLD_MEMORY_SCOUT_PROBABILITY = 0.12;
const MAGAZINE_WORLD_MEMORY_SCOUT_DAYS = 45;
const MAGAZINE_WORLD_MEMORY_SCOUT_READ_LIMIT = 120;
const MAGAZINE_WORLD_MEMORY_SCOUT_CANDIDATE_LIMIT = 36;

const previousMagazineSchedulerRuntime = globalThis[MAGAZINE_SCHEDULER_RUNTIME_KEY];
if (previousMagazineSchedulerRuntime?.timer) {
  clearTimeout(previousMagazineSchedulerRuntime.timer);
  previousMagazineSchedulerRuntime.timer = null;
}

const magazineSchedulerRuntime = previousMagazineSchedulerRuntime || {
  started: false,
  startedAt: "",
  running: false,
  timer: null,
  nextRunAt: "",
  nextRetryAt: "",
  currentCycle: null,
  activeCycle: null,
  lastCycle: null,
  lastError: "",
  manualStartRequestedAt: "",
};
globalThis[MAGAZINE_SCHEDULER_RUNTIME_KEY] = magazineSchedulerRuntime;

const mimeTypes = {
  ".avif": "image/avif",
  ".gif": "image/gif",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

const blockedMagazineAssetExtensions = new Set([".svg"]);

const fallbackMagazineTopicCatalog = [
  { label: "시장", emoji: "📈", tone: "market" },
  { label: "금융", emoji: "🏦", tone: "finance" },
  { label: "경제", emoji: "🌐", tone: "economy" },
  { label: "산업", emoji: "🏭", tone: "industry" },
  { label: "테크", emoji: "💻", tone: "tech" },
  { label: "정치", emoji: "🏛️", tone: "policy" },
  { label: "AI", emoji: "🤖", tone: "ai" },
  { label: "기후", emoji: "🌱", tone: "climate" },
  { label: "크립토", emoji: "🪙", tone: "crypto" },
];

function ensureMagazineDirs() {
  mkdirSync(DATA_MAGAZINE_DIR, { recursive: true });
  mkdirSync(MAGAZINE_ARTICLES_DIR, { recursive: true });
}

function cleanText(value) {
  return String(value || "")
    .replace(/\r\n?/g, "\n")
    .replace(/\t/g, " ")
    .replace(/[ \u00a0]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function uniqueStrings(values = []) {
  return Array.from(new Set((Array.isArray(values) ? values : []).map(cleanText).filter(Boolean)));
}

const magazineBodyChromePatterns = [
  /<h1\b[^>]*>[\s\S]*?<\/h1>/gi,
  /<p\b(?=[^>]*\bclass\s*=\s*(?:"[^"]*\barticle-kicker\b[^"]*"|'[^']*\barticle-kicker\b[^']*'|[^\s>]*\barticle-kicker\b[^\s>]*))[^>]*>[\s\S]*?<\/p>/gi,
  /<p\b(?=[^>]*\bclass\s*=\s*(?:"[^"]*\barticle-deck\b[^"]*"|'[^']*\barticle-deck\b[^']*'|[^\s>]*\barticle-deck\b[^\s>]*))[^>]*>[\s\S]*?<\/p>/gi,
];

function cleanMagazineArticleBodyHtml(value) {
  let html = String(value || "");
  for (const pattern of magazineBodyChromePatterns) {
    html = html.replace(pattern, "");
  }
  return html.replace(/\n{3,}/g, "\n\n").trim();
}

function normalizeArticleId(value) {
  const articleId = String(value || "").trim();
  if (!ARTICLE_ID_PATTERN.test(articleId)) {
    throw new Error("invalid article id");
  }
  return articleId;
}

function normalizePreferenceId(value, fallback = "") {
  const optionId = String(value || fallback || "").trim();
  if (!PREFERENCE_ID_PATTERN.test(optionId)) {
    throw new Error("invalid preference option id");
  }
  return optionId;
}

function ensureInsideRoot(root, target) {
  const rel = relative(root, target);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error("unsafe magazine path");
  }
  return target;
}

function articleDirForId(articleId) {
  const id = normalizeArticleId(articleId);
  return ensureInsideRoot(MAGAZINE_ARTICLES_DIR, resolve(MAGAZINE_ARTICLES_DIR, id));
}

function articleStoragePath(target) {
  const rel = relative(GUIBUILD_ROOT, target);
  return rel && !rel.startsWith("..") && !isAbsolute(rel) ? rel : "data/magazine";
}

function parseTimestamp(value) {
  const timestamp = Date.parse(value || "");
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function nowIso(date = new Date()) {
  return date.toISOString();
}

function addMs(value, ms) {
  const baseMs = typeof value === "number" ? value : parseTimestamp(value);
  return nowIso(new Date((baseMs || Date.now()) + ms));
}

export function normalizeMagazineSchedulerNextRunAt(value, options = {}) {
  const timestamp = parseTimestamp(value);
  if (!timestamp) {
    throw new Error("nextRunAt must be a valid ISO timestamp");
  }
  const nowMs = Number.isFinite(Number(options.nowMs)) ? Number(options.nowMs) : Date.now();
  if (timestamp <= nowMs) {
    throw new Error("nextRunAt must be in the future");
  }
  const maxDelayMs = Number.isFinite(Number(options.maxDelayMs))
    ? Number(options.maxDelayMs)
    : MAGAZINE_SCHEDULER_MAX_MANUAL_DELAY_MS;
  if (timestamp - nowMs > maxDelayMs) {
    throw new Error("nextRunAt must be within the next 24 hours");
  }
  return nowIso(new Date(timestamp));
}

function sortByLatest(a, b) {
  return (
    parseTimestamp(b.publishedAt || b.createdAt || b.updatedAt) -
    parseTimestamp(a.publishedAt || a.createdAt || a.updatedAt)
  );
}

function sortByCoverOrder(a, b) {
  const aCoverTime = parseTimestamp(a.coverRegisteredAt || a.publishedAt || a.createdAt);
  const bCoverTime = parseTimestamp(b.coverRegisteredAt || b.publishedAt || b.createdAt);
  if (aCoverTime !== bCoverTime) return bCoverTime - aCoverTime;
  const aRank = Number.isFinite(Number(a.coverRank)) ? Number(a.coverRank) : Number.POSITIVE_INFINITY;
  const bRank = Number.isFinite(Number(b.coverRank)) ? Number(b.coverRank) : Number.POSITIVE_INFINITY;
  if (aRank !== bRank) return aRank - bRank;
  return sortByLatest(a, b);
}

function normalizeTopicList(value, fallback = [], { max = MAGAZINE_ARTICLE_TOPIC_LIMIT } = {}) {
  const topics = Array.isArray(value) ? value : [value].filter(Boolean);
  const normalized = topics.map((item) => cleanText(item)).filter(Boolean);
  if (normalized.length) return normalized.slice(0, max);
  const fallbackTopics = Array.isArray(fallback) ? fallback : [fallback].filter(Boolean);
  return fallbackTopics.map((item) => cleanText(item)).filter(Boolean).slice(0, max);
}

function articleTopicSource(metadata = {}) {
  if (Array.isArray(metadata.topics)) return metadata.topics;
  if (metadata.topics) return [metadata.topics];
  if (metadata.topic) return [metadata.topic];
  return [];
}

function normalizeArticleTopics(metadata = {}) {
  return normalizeTopicList(articleTopicSource(metadata));
}

function normalizeTopicCatalog(value) {
  const topics = Array.isArray(value) ? value : [];
  const seen = new Set();
  return topics
    .map((item) => {
      const source = item && typeof item === "object" ? item : { label: item };
      const label = cleanText(source.label || "");
      if (!label || seen.has(label)) return null;
      seen.add(label);
      return {
        label,
        emoji: cleanText(source.emoji || ""),
        tone: cleanText(source.tone || "market"),
      };
    })
    .filter(Boolean);
}

function readMagazineTopicCatalog() {
  try {
    const raw = JSON.parse(readFileSync(MAGAZINE_TOPICS_PATH, "utf8"));
    const topics = normalizeTopicCatalog(raw?.topics);
    return topics.length ? topics : fallbackMagazineTopicCatalog;
  } catch {
    return fallbackMagazineTopicCatalog;
  }
}

function normalizeFollowupOption(value, index, articleTopics = []) {
  const source = value && typeof value === "object" ? value : {};
  const label = cleanText(source.label || source.title || "");
  if (!label) return null;
  return {
    id: normalizePreferenceId(source.id || `followup-${index + 1}`),
    label,
    prompt: cleanText(source.prompt || label),
    topics: normalizeTopicList(source.topics || articleTopics, articleTopics),
    tone: cleanText(source.tone || ""),
  };
}

function defaultFollowupOptionsForArticle(metadata) {
  const topics = normalizeArticleTopics(metadata);
  const topicText = topics.length ? topics.join("·") : "매거진";
  return [
    {
      id: "deeper-data",
      label: "데이터를 더 자세히",
      prompt: `${topicText} 관련 핵심 데이터를 더 많이 비교하는 후속 기사`,
      topics,
      tone: "market",
    },
    {
      id: "market-impact",
      label: "시장 영향 더 보기",
      prompt: `${topicText} 이슈가 자산 가격과 업종에 미치는 영향`,
      topics,
      tone: "finance",
    },
    {
      id: "company-map",
      label: "관련 기업으로 확장",
      prompt: `${topicText} 이슈와 연결되는 기업, ETF, 산업 밸류체인`,
      topics,
      tone: "industry",
    },
    {
      id: "next-signal",
      label: "다음 신호 추적",
      prompt: `${topicText} 이슈를 확인하거나 반박할 다음 지표와 일정`,
      topics,
      tone: "economy",
    },
  ];
}

function normalizeHeroImage(heroImage, articleId) {
  const source = heroImage && typeof heroImage === "object" ? heroImage : {};
  const src = cleanText(source.src || source.url || "");
  const localSrc = src.startsWith("assets/") ? `/api/magazine/assets/${articleId}/${src.slice("assets/".length)}` : src;
  return {
    src: localSrc || "",
    alt: cleanText(source.alt || "매거진 기사 이미지"),
    credit: cleanText(source.credit || ""),
    sourceUrl: cleanText(source.sourceUrl || source.sourceURL || source.pageUrl || source.originalUrl || source.href || ""),
    license: cleanText(source.license || source.rights || source.usagePolicy || ""),
    usageNote: cleanText(source.usageNote || ""),
  };
}

function normalizeVectorHit(value) {
  const source = value && typeof value === "object" ? value : {};
  return {
    eventId: cleanText(source.eventId || source.event_id || ""),
    title: cleanText(source.title || ""),
    semanticScore: Number(source.semanticScore ?? source.semantic_score ?? 0),
    rankScore: Number(source.rankScore ?? source.rank_score ?? 0),
  };
}

function normalizeWorldMemoryEvidence(worldMemory) {
  const source = worldMemory && typeof worldMemory === "object" ? worldMemory : {};
  const vectorSearch = source.vectorSearch && typeof source.vectorSearch === "object" ? source.vectorSearch : {};
  return {
    retrievalPolicy: cleanText(source.retrievalPolicy || WORLD_MEMORY_VECTOR_POLICY.retrievalPolicy),
    query: cleanText(source.query || ""),
    vectorSearch: {
      engine: cleanText(vectorSearch.engine || ""),
      model: cleanText(vectorSearch.model || ""),
      days: Number(vectorSearch.days || 0),
      entryMode: cleanText(vectorSearch.entryMode || ""),
      limit: Number(vectorSearch.limit || 0),
      candidateLimit: Number(vectorSearch.candidateLimit || 0),
      matchedCount: Number(vectorSearch.matchedCount || 0),
      missingEmbeddings: Number(vectorSearch.missingEmbeddings || 0),
      staleEmbeddings: Number(vectorSearch.staleEmbeddings || 0),
      hits: Array.isArray(vectorSearch.hits)
        ? vectorSearch.hits.map(normalizeVectorHit).filter((hit) => hit.eventId || hit.title)
        : [],
    },
  };
}

function normalizeGenerationAgent(agent) {
  const source = agent && typeof agent === "object" ? agent : {};
  return {
    provider: cleanText(source.provider || ""),
    model: cleanText(source.model || ""),
    reasoning: cleanText(source.reasoning || ""),
    label: cleanText(source.label || ""),
  };
}

function normalizeChartBlock(value, index) {
  const source = value && typeof value === "object" ? value : {};
  const option = source.option && typeof source.option === "object" && !Array.isArray(source.option)
    ? source.option
    : null;
  if (!option) return null;
  return {
    id: cleanText(source.id || `chart-${index + 1}`),
    title: cleanText(source.title || `차트 ${index + 1}`),
    note: cleanText(source.note || ""),
    option,
    ariaLabel: cleanText(source.ariaLabel || source.title || `매거진 차트 ${index + 1}`),
  };
}

function normalizePreferenceStore(raw = {}) {
  const source = raw && typeof raw === "object" ? raw : {};
  const events = Array.isArray(source.events) ? source.events : [];
  return {
    version: 1,
    decayWindowsDays: PREFERENCE_DECAY_WINDOWS_DAYS,
    updatedAt: cleanText(source.updatedAt || ""),
    events: events
      .map(normalizePreferenceEvent)
      .filter(Boolean)
      .slice(-MAX_PREFERENCE_EVENTS),
  };
}

function normalizePreferenceEvent(value) {
  const source = value && typeof value === "object" ? value : {};
  const articleId = cleanText(source.articleId || "");
  const optionId = cleanText(source.optionId || "");
  const selectedAt = cleanText(source.selectedAt || "");
  if (!articleId || !optionId || !selectedAt) return null;
  return {
    id: cleanText(source.id || `${selectedAt}-${articleId}-${optionId}`),
    action: source.action === "deselect" ? "deselect" : "select",
    articleId,
    articleTitle: cleanText(source.articleTitle || ""),
    articleType: cleanText(source.articleType || ""),
    optionId,
    label: cleanText(source.label || ""),
    prompt: cleanText(source.prompt || source.label || ""),
    topics: normalizeTopicList(source.topics || []),
    selectedAt,
    baseWeight: clampNumber(source.baseWeight, 0.1, 5, 1),
    worldMemoryWeight: clampNumber(source.worldMemoryWeight, 0.1, 2, 1),
    worldMemoryAnchors: Array.isArray(source.worldMemoryAnchors)
      ? source.worldMemoryAnchors.map(cleanText).filter(Boolean).slice(0, 12)
      : [],
    decayWindowsDays: PREFERENCE_DECAY_WINDOWS_DAYS,
  };
}

function normalizeCommentText(value) {
  return cleanText(value).slice(0, MAX_COMMENT_TEXT_CHARS);
}

function normalizeCommentReply(value) {
  return cleanText(value).slice(0, MAX_COMMENT_REPLY_CHARS);
}

function normalizeCommentReplyRecord(value) {
  const source = value && typeof value === "object" ? value : {};
  const text = normalizeCommentReply(source.text || "");
  if (!text) return null;
  return {
    id: cleanText(source.id || randomUUID()),
    author: "매거진 편집자 AI",
    text,
    createdAt: cleanText(source.createdAt || new Date().toISOString()),
    status: cleanText(source.status || "complete"),
    provider: cleanText(source.provider || ""),
    model: cleanText(source.model || ""),
    reasoning: cleanText(source.reasoning || ""),
    biasEventIds: Array.isArray(source.biasEventIds)
      ? source.biasEventIds.map(cleanText).filter(Boolean).slice(0, 20)
      : [],
  };
}

function normalizeCommentRecord(value) {
  const source = value && typeof value === "object" ? value : {};
  const text = normalizeCommentText(source.text || "");
  const createdAt = cleanText(source.createdAt || "");
  if (!text || !createdAt) return null;
  return {
    id: cleanText(source.id || randomUUID()),
    author: "사용자",
    text,
    createdAt,
    reply: normalizeCommentReplyRecord(source.reply),
  };
}

function normalizeCommentStore(articleId, raw = {}) {
  const source = raw && typeof raw === "object" ? raw : {};
  const comments = Array.isArray(source.comments) ? source.comments : [];
  return {
    version: 1,
    articleId,
    updatedAt: cleanText(source.updatedAt || ""),
    comments: comments
      .map(normalizeCommentRecord)
      .filter(Boolean)
      .slice(-MAX_COMMENTS_PER_ARTICLE),
  };
}

function normalizeBiasDirection(value) {
  const direction = cleanText(value || "").toLowerCase();
  if (["decrease", "negative", "reduce", "less", "줄임", "축소"].includes(direction)) return "decrease";
  if (["increase", "positive", "more", "boost", "늘림", "확대"].includes(direction)) return "increase";
  return "neutral";
}

function normalizeBiasEvent(value) {
  const source = value && typeof value === "object" ? value : {};
  const articleId = cleanText(source.articleId || "");
  const commentId = cleanText(source.commentId || "");
  const createdAt = cleanText(source.createdAt || "");
  const label = cleanText(source.label || source.title || "");
  const prompt = cleanText(source.prompt || source.request || label);
  if (!articleId || !commentId || !createdAt || !label) return null;
  const direction = normalizeBiasDirection(source.direction || source.action || source.sentiment);
  const baseWeight = clampNumber(source.baseWeight ?? source.weight, 0.1, 5, 1);
  return {
    id: cleanText(source.id || `${createdAt}-${articleId}-${commentId}-${label}`),
    source: "magazine-comment",
    direction,
    articleId,
    articleTitle: cleanText(source.articleTitle || ""),
    articleType: cleanText(source.articleType || ""),
    commentId,
    label,
    prompt,
    reason: cleanText(source.reason || ""),
    topics: normalizeTopicList(source.topics || []),
    createdAt,
    baseWeight,
    signedBaseWeight: direction === "decrease" ? -baseWeight : direction === "increase" ? baseWeight : 0,
    worldMemoryWeight: clampNumber(source.worldMemoryWeight, 0.1, 2, 1),
    worldMemoryAnchors: Array.isArray(source.worldMemoryAnchors)
      ? source.worldMemoryAnchors.map(cleanText).filter(Boolean).slice(0, 12)
      : [],
    decayWindowsDays: PREFERENCE_DECAY_WINDOWS_DAYS,
  };
}

function normalizeBiasStore(raw = {}) {
  const source = raw && typeof raw === "object" ? raw : {};
  const events = Array.isArray(source.events) ? source.events : [];
  return {
    version: 1,
    decayWindowsDays: PREFERENCE_DECAY_WINDOWS_DAYS,
    updatedAt: cleanText(source.updatedAt || ""),
    events: events
      .map(normalizeBiasEvent)
      .filter(Boolean)
      .slice(-MAX_BIAS_EVENTS),
  };
}

function clampNumber(value, min, max, fallback) {
  const next = Number(value);
  if (!Number.isFinite(next)) return fallback;
  return Math.max(min, Math.min(max, next));
}

async function readJsonFile(path) {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return null;
  }
}

async function writeJsonAtomic(path, value) {
  ensureMagazineDirs();
  const tempPath = `${path}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(tempPath, path);
}

async function deleteMagazineEventSignatureIndexEntryWithNodeSqlite(indexPath, articleId) {
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(indexPath);
  try {
    const table = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(MAGAZINE_EVENT_SIGNATURE_TABLE);
    if (!table) {
      return {
        ok: true,
        method: "node:sqlite",
        tableFound: false,
        deletedCount: 0,
      };
    }
    const result = db
      .prepare(`DELETE FROM ${MAGAZINE_EVENT_SIGNATURE_TABLE} WHERE article_id = ?`)
      .run(articleId);
    return {
      ok: true,
      method: "node:sqlite",
      tableFound: true,
      deletedCount: Number(result.changes) || 0,
    };
  } finally {
    db.close();
  }
}

function magazinePythonCandidates() {
  const localVenvPython =
    process.platform === "win32"
      ? join(GUIBUILD_ROOT, ".venv", "Scripts", "python.exe")
      : join(GUIBUILD_ROOT, ".venv", "bin", "python");
  return process.platform === "win32"
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
}

function deleteMagazineEventSignatureIndexEntryWithPythonCandidate(candidate, indexPath, articleId) {
  const script = [
    "import json, sqlite3, sys",
    "index_path = sys.argv[1]",
    "article_id = sys.argv[2]",
    `table = ${JSON.stringify(MAGAZINE_EVENT_SIGNATURE_TABLE)}`,
    "conn = sqlite3.connect(index_path)",
    "try:",
    "    found = conn.execute(\"SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?\", (table,)).fetchone()",
    "    if not found:",
    "        print(json.dumps({'ok': True, 'tableFound': False, 'deletedCount': 0}))",
    "    else:",
    "        cursor = conn.execute(f'DELETE FROM {table} WHERE article_id = ?', (article_id,))",
    "        conn.commit()",
    "        print(json.dumps({'ok': True, 'tableFound': True, 'deletedCount': max(0, cursor.rowcount)}))",
    "finally:",
    "    conn.close()",
  ].join("\n");

  return new Promise((resolveDelete) => {
    const child = spawn(candidate.command, [...candidate.argsPrefix, "-c", script, indexPath, articleId], {
      cwd: GUIBUILD_ROOT,
      env: { ...process.env, PYTHONUNBUFFERED: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timer = null;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolveDelete(result);
    };
    timer = setTimeout(() => {
      child.kill("SIGTERM");
      finish({ ok: false, error: `${candidate.display} timed out while deleting magazine index row` });
    }, 5000);
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      finish({ ok: false, error: error.message });
    });
    child.on("close", (code) => {
      if (code !== 0) {
        finish({ ok: false, error: stderr.trim() || stdout.trim() || `${candidate.display} exited ${code}` });
        return;
      }
      try {
        const parsed = JSON.parse(stdout.trim() || "{}");
        finish({
          ok: true,
          method: `python:${candidate.display}`,
          tableFound: parsed.tableFound === true,
          deletedCount: Number(parsed.deletedCount) || 0,
        });
      } catch (error) {
        finish({ ok: false, error: `invalid ${candidate.display} sqlite cleanup output: ${error.message}` });
      }
    });
  });
}

async function deleteMagazineEventSignatureIndexEntryWithPython(indexPath, articleId) {
  const errors = [];
  for (const candidate of magazinePythonCandidates()) {
    if (candidate.command.includes(".venv") && !existsSync(candidate.command)) continue;
    const result = await deleteMagazineEventSignatureIndexEntryWithPythonCandidate(candidate, indexPath, articleId);
    if (result.ok) return result;
    errors.push(`${candidate.display}: ${result.error || "failed"}`);
  }
  throw new Error(errors.join("; ") || "Python executable not found");
}

export async function deleteMagazineEventSignatureIndexEntry(articleId, options = {}) {
  const id = normalizeArticleId(articleId);
  const indexPath = resolve(options.indexPath || MAGAZINE_EVENT_SIGNATURE_INDEX_PATH);
  const baseResult = {
    articleId: id,
    indexPath: articleStoragePath(indexPath),
  };
  if (!existsSync(indexPath)) {
    return {
      ...baseResult,
      ok: true,
      skipped: true,
      reason: "index not found",
      tableFound: false,
      deleted: false,
      deletedCount: 0,
    };
  }

  try {
    const result = await deleteMagazineEventSignatureIndexEntryWithPython(indexPath, id);
    return {
      ...baseResult,
      ...result,
      deleted: result.deletedCount > 0,
    };
  } catch (pythonError) {
    try {
      const result = await deleteMagazineEventSignatureIndexEntryWithNodeSqlite(indexPath, id);
      return {
        ...baseResult,
        ...result,
        fallbackFrom: "python",
        deleted: result.deletedCount > 0,
      };
    } catch (nodeSqliteError) {
      throw new Error(
        `failed to delete magazine event-signature index row for ${id}: ${pythonError.message}; node:sqlite fallback: ${nodeSqliteError.message}`,
      );
    }
  }
}

function emptyMagazineReadState() {
  return {
    version: 1,
    updatedAt: nowIso(),
    lastOpenedAt: "",
  };
}

async function readMagazineReadState() {
  ensureMagazineDirs();
  const readState = await readJsonFile(MAGAZINE_READ_STATE_PATH);
  return {
    ...emptyMagazineReadState(),
    ...(readState && typeof readState === "object" && !Array.isArray(readState) ? readState : {}),
    lastOpenedAt: typeof readState?.lastOpenedAt === "string" ? readState.lastOpenedAt : "",
  };
}

async function writeMagazineReadState(readState) {
  const nextReadState = {
    ...emptyMagazineReadState(),
    ...(readState && typeof readState === "object" && !Array.isArray(readState) ? readState : {}),
    updatedAt: nowIso(),
  };
  await writeJsonAtomic(MAGAZINE_READ_STATE_PATH, nextReadState);
  return nextReadState;
}

function articleNotificationTimestamp(article) {
  return parseTimestamp(article?.publishedAt || article?.createdAt || article?.updatedAt);
}

function magazineReadStateSnapshot(articles = [], readState = emptyMagazineReadState()) {
  const lastOpenedMs = parseTimestamp(readState.lastOpenedAt);
  let unreadArticleCount = 0;
  let latestArticleAt = "";
  let latestArticleMs = 0;
  let latestArticleId = "";
  let latestArticleTitle = "";

  for (const article of articles) {
    const articleMs = articleNotificationTimestamp(article);
    if (!articleMs) continue;
    if (articleMs > latestArticleMs) {
      latestArticleMs = articleMs;
      latestArticleAt = article.publishedAt || article.createdAt || article.updatedAt || "";
      latestArticleId = article.id || "";
      latestArticleTitle = article.title || "";
    }
    if (articleMs > lastOpenedMs) {
      unreadArticleCount += 1;
    }
  }

  return {
    lastOpenedAt: readState.lastOpenedAt,
    unreadArticleCount,
    latestArticleAt,
    latestArticleId,
    latestArticleTitle,
    path: "data/magazine/read-state.json",
  };
}

async function readPreferenceStore() {
  ensureMagazineDirs();
  return normalizePreferenceStore(await readJsonFile(MAGAZINE_PREFERENCES_PATH));
}

function commentStorePathForArticle(articleId) {
  return join(articleDirForId(articleId), "comments.json");
}

async function readCommentStore(articleId) {
  ensureMagazineDirs();
  const id = normalizeArticleId(articleId);
  return normalizeCommentStore(id, await readJsonFile(commentStorePathForArticle(id)));
}

async function readBiasStore() {
  ensureMagazineDirs();
  return normalizeBiasStore(await readJsonFile(MAGAZINE_EDITORIAL_BIAS_PATH));
}

function halfLifeDecay(ageDays, halfLifeDays) {
  return Math.pow(0.5, Math.max(0, ageDays) / Math.max(1, halfLifeDays));
}

function scorePreferenceEvent(event, nowMs = Date.now()) {
  const selectedMs = parseTimestamp(event.selectedAt);
  const ageDays = selectedMs ? Math.max(0, (nowMs - selectedMs) / 86400000) : 0;
  const baseWeight = clampNumber(event.baseWeight, 0.1, 5, 1);
  const worldMemoryWeight = clampNumber(event.worldMemoryWeight, 0.1, 2, 1);
  const decayWeights = Object.fromEntries(
    PREFERENCE_DECAY_WINDOWS_DAYS.map((days) => [
      `${days}d`,
      roundScore(baseWeight * worldMemoryWeight * halfLifeDecay(ageDays, days)),
    ])
  );
  const effectiveWeight = roundScore(
    decayWeights["30d"] * 0.4 +
      decayWeights["90d"] * 0.3 +
      decayWeights["180d"] * 0.2 +
      decayWeights["365d"] * 0.1
  );
  return {
    ageDays: roundScore(ageDays),
    decayWeights,
    effectiveWeight,
  };
}

function roundScore(value) {
  return Math.round(Number(value || 0) * 10000) / 10000;
}

function buildActivePreferenceEntries(events = []) {
  const active = new Map();
  const chronological = [...events].sort((a, b) => parseTimestamp(a.selectedAt) - parseTimestamp(b.selectedAt));
  for (const event of chronological) {
    const articleId = event.articleId;
    const optionId = event.optionId;
    if (!articleId || !optionId) continue;
    if (!active.has(articleId)) active.set(articleId, new Map());
    const articleMap = active.get(articleId);
    if (event.action === "deselect") {
      articleMap.delete(optionId);
      continue;
    }
    articleMap.set(optionId, event);
  }
  return active;
}

function activePreferenceIdsForArticle(events, articleId) {
  const active = buildActivePreferenceEntries(events);
  return new Set(Array.from(active.get(articleId)?.keys() || []));
}

function publicPreferenceSnapshot(store = normalizePreferenceStore()) {
  const nowMs = Date.now();
  const latestByArticle = {};
  const activeByArticle = {};
  const aggregateMap = new Map();
  const scoredEvents = store.events.map((event) => ({
    ...event,
    ...scorePreferenceEvent(event, nowMs),
  }));
  const activeEntries = buildActivePreferenceEntries(store.events);
  for (const [articleId, articleMap] of activeEntries.entries()) {
    const activeScored = Array.from(articleMap.values())
      .map((event) => ({
        ...event,
        ...scorePreferenceEvent(event, nowMs),
      }))
      .sort((a, b) => parseTimestamp(b.selectedAt) - parseTimestamp(a.selectedAt));
    if (!activeScored.length) continue;
    activeByArticle[articleId] = activeScored;
    latestByArticle[articleId] = activeScored[0];
  }
  for (const event of Object.values(activeByArticle).flat()) {
    const score = scorePreferenceEvent(event, nowMs);
    const key = event.optionId || event.label;
    const aggregate = aggregateMap.get(key) || {
      optionId: event.optionId,
      label: event.label,
      prompt: event.prompt,
      topics: event.topics,
      count: 0,
      effectiveWeight: 0,
      decayWeights: Object.fromEntries(PREFERENCE_DECAY_WINDOWS_DAYS.map((days) => [`${days}d`, 0])),
      latestSelectedAt: "",
    };
    aggregate.count += 1;
    aggregate.effectiveWeight += score.effectiveWeight;
    for (const days of PREFERENCE_DECAY_WINDOWS_DAYS) {
      aggregate.decayWeights[`${days}d`] += score.decayWeights[`${days}d`];
    }
    if (!aggregate.latestSelectedAt || parseTimestamp(aggregate.latestSelectedAt) < parseTimestamp(event.selectedAt)) {
      aggregate.latestSelectedAt = event.selectedAt;
    }
    aggregateMap.set(key, aggregate);
  }
  const effectiveSignals = Array.from(aggregateMap.values())
    .map((item) => ({
      ...item,
      effectiveWeight: roundScore(item.effectiveWeight),
      decayWeights: Object.fromEntries(
        Object.entries(item.decayWeights).map(([key, value]) => [key, roundScore(value)])
      ),
    }))
    .sort((a, b) => b.effectiveWeight - a.effectiveWeight || parseTimestamp(b.latestSelectedAt) - parseTimestamp(a.latestSelectedAt));

  return {
    ok: true,
    storage: "files",
    configPath: "data/magazine/editorial-preferences.json",
    version: 1,
    decayModel: {
      type: "half-life",
      windowsDays: PREFERENCE_DECAY_WINDOWS_DAYS,
      blendedWeightFormula: "30d*0.4 + 90d*0.3 + 180d*0.2 + 365d*0.1",
      worldMemoryCoupling: "event effective weight is multiplied by worldMemoryWeight so future generation can reduce old preferences when related World Memory relevance weakens",
    },
    updatedAt: store.updatedAt,
    eventCount: scoredEvents.length,
    activeCount: Object.values(activeByArticle).reduce((sum, items) => sum + items.length, 0),
    latestByArticle,
    activeByArticle,
    effectiveSignals,
    events: scoredEvents.slice(-200),
  };
}

function scoreBiasEvent(event, nowMs = Date.now()) {
  const createdMs = parseTimestamp(event.createdAt);
  const ageDays = createdMs ? Math.max(0, (nowMs - createdMs) / 86400000) : 0;
  const worldMemoryWeight = clampNumber(event.worldMemoryWeight, 0.1, 2, 1);
  const signedBaseWeight = clampNumber(event.signedBaseWeight, -5, 5, 0);
  const decayWeights = Object.fromEntries(
    PREFERENCE_DECAY_WINDOWS_DAYS.map((days) => [
      `${days}d`,
      roundScore(signedBaseWeight * worldMemoryWeight * halfLifeDecay(ageDays, days)),
    ])
  );
  const effectiveWeight = roundScore(
    decayWeights["30d"] * 0.4 +
      decayWeights["90d"] * 0.3 +
      decayWeights["180d"] * 0.2 +
      decayWeights["365d"] * 0.1
  );
  return {
    ageDays: roundScore(ageDays),
    decayWeights,
    effectiveWeight,
  };
}

function publicBiasSnapshot(store = normalizeBiasStore()) {
  const nowMs = Date.now();
  const scoredEvents = store.events.map((event) => ({
    ...event,
    ...scoreBiasEvent(event, nowMs),
  }));
  const aggregateMap = new Map();
  for (const event of scoredEvents) {
    const key = event.label || event.prompt;
    const aggregate = aggregateMap.get(key) || {
      label: event.label,
      prompt: event.prompt,
      topics: event.topics,
      increaseCount: 0,
      decreaseCount: 0,
      neutralCount: 0,
      effectiveWeight: 0,
      decayWeights: Object.fromEntries(PREFERENCE_DECAY_WINDOWS_DAYS.map((days) => [`${days}d`, 0])),
      latestAt: "",
    };
    if (event.direction === "increase") aggregate.increaseCount += 1;
    else if (event.direction === "decrease") aggregate.decreaseCount += 1;
    else aggregate.neutralCount += 1;
    aggregate.effectiveWeight += event.effectiveWeight;
    for (const days of PREFERENCE_DECAY_WINDOWS_DAYS) {
      aggregate.decayWeights[`${days}d`] += event.decayWeights[`${days}d`];
    }
    if (!aggregate.latestAt || parseTimestamp(aggregate.latestAt) < parseTimestamp(event.createdAt)) {
      aggregate.latestAt = event.createdAt;
    }
    aggregateMap.set(key, aggregate);
  }
  return {
    ok: true,
    storage: "files",
    configPath: "data/magazine/editorial-bias.json",
    version: 1,
    decayModel: {
      type: "half-life",
      windowsDays: PREFERENCE_DECAY_WINDOWS_DAYS,
      blendedWeightFormula: "30d*0.4 + 90d*0.3 + 180d*0.2 + 365d*0.1",
      negativeWeight: "direction=decrease stores a negative signedBaseWeight",
    },
    updatedAt: store.updatedAt,
    eventCount: scoredEvents.length,
    effectiveBiasSignals: Array.from(aggregateMap.values())
      .map((item) => ({
        ...item,
        effectiveWeight: roundScore(item.effectiveWeight),
        decayWeights: Object.fromEntries(
          Object.entries(item.decayWeights).map(([key, value]) => [key, roundScore(value)])
        ),
      }))
      .sort((a, b) => Math.abs(b.effectiveWeight) - Math.abs(a.effectiveWeight) || parseTimestamp(b.latestAt) - parseTimestamp(a.latestAt)),
    events: scoredEvents.slice(-200),
  };
}

function worldMemoryWeightForArticle(article) {
  const hits = Array.isArray(article?.worldMemory?.vectorSearch?.hits) ? article.worldMemory.vectorSearch.hits : [];
  if (!hits.length) return 1;
  const averageRank = hits.reduce((sum, hit) => sum + Number(hit.rankScore || 0), 0) / hits.length;
  return clampNumber(averageRank || 1, 0.35, 1.2, 1);
}

function worldMemoryAnchorsForArticle(article) {
  const hits = Array.isArray(article?.worldMemory?.vectorSearch?.hits) ? article.worldMemory.vectorSearch.hits : [];
  return hits.map((hit) => hit.eventId || hit.title).filter(Boolean).slice(0, 8);
}

function stripHtmlToText(html = "") {
  return cleanText(
    String(html || "")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|section|article|h1|h2|h3|li)>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, "\"")
      .replace(/&#39;/g, "'")
  );
}

function compactArticleForCommentPrompt(article) {
  return {
    id: article.id,
    title: article.title,
    summary: article.summary,
    topics: article.topics,
    articleType: article.articleType,
    publishedAt: article.publishedAt,
    sourceBasis: article.sourceBasis,
    worldMemory: article.worldMemory
      ? {
          retrievalPolicy: article.worldMemory.retrievalPolicy,
          query: article.worldMemory.query,
          vectorSearch: {
            engine: article.worldMemory.vectorSearch?.engine || "",
            model: article.worldMemory.vectorSearch?.model || "",
            hits: Array.isArray(article.worldMemory.vectorSearch?.hits)
              ? article.worldMemory.vectorSearch.hits.slice(0, 8)
              : [],
          },
        }
      : null,
    bodyText: stripHtmlToText(article.bodyHtml).slice(0, 12000),
  };
}

function compactCommentsForPrompt(comments = []) {
  return comments.slice(-12).map((comment) => ({
    id: comment.id,
    author: "사용자",
    text: comment.text,
    createdAt: comment.createdAt,
    reply: comment.reply
      ? {
          author: "매거진 편집자 AI",
          text: comment.reply.text,
          createdAt: comment.reply.createdAt,
          status: comment.reply.status,
        }
      : null,
  }));
}

function buildMagazineCommentPrompt({ article, comments, commentText }) {
  return [
    "너는 '주식채널 매거진+' 기사 하단 댓글에 답하는 매거진 편집자 AI다.",
    "작성자명은 화면에서 '매거진 편집자 AI'로 표시된다. 답변 본문에서는 굳이 자신을 다시 소개하지 않는다.",
    "사용자가 기사와 관련해 궁금한 점을 물으면 기사 내용, 기존 코멘트, 사용자 메모리, 외부 메모리, 월드메모리 검색 맥락, 필요하면 웹 확인 맥락을 바탕으로 답한다.",
    "사용자가 앞으로 다뤄 달라는 기사 방향을 말하면 가볍게 수용하되, 가능한 경우 '방금 잠시 알아보니'처럼 확인한 근거의 방향을 짧게 붙이고 어떤 기사 비중을 늘리거나 줄일지 말한다.",
    "단순 텍스트 매칭으로 의도를 분류하지 말고, 댓글의 의미를 해석한다. '요즘 이런 기사 너무 많아요', '이런 건 줄여 주세요' 같은 요청은 네거티브 편집 가중치로 해석할 수 있다.",
    "한국어 존대말로 답한다. 지나친 농담은 피하고, 뼈 있는 한 문장 정도만 허용한다.",
    "페르소나 채팅 모드는 이 기능에 적용하지 않는다. 특정 캐릭터 말투나 사이드바 페르소나를 흉내내지 않는다.",
    "답변 끝에는 화면에 보이지 않을 내부 액션을 반드시 하나의 코드펜스로 붙인다. 형식은 ```magazine_comment_action JSON ``` 이고, biasEvents 배열만 포함한다.",
    "biasEvents는 기사 작성 방향 요청이 있을 때만 넣는다. 질문 답변만이면 빈 배열을 넣는다.",
    "biasEvents 항목 형식: {\"direction\":\"increase|decrease|neutral\",\"label\":\"짧은 편집 방향\",\"prompt\":\"향후 기사 생성에 반영할 구체적 요청\",\"topics\":[\"시장\"],\"reason\":\"왜 그렇게 해석했는지\",\"weight\":1}.",
    "[현재 기사]",
    JSON.stringify(compactArticleForCommentPrompt(article), null, 2),
    "[기존 코멘트와 답변]",
    JSON.stringify(compactCommentsForPrompt(comments), null, 2),
    "[새 사용자 코멘트]",
    commentText,
  ].join("\n\n");
}

function parseMagazineCommentAction(answer = "") {
  const match = String(answer).match(/```magazine_comment_action\s*([\s\S]*?)```/i);
  if (!match) return { biasEvents: [] };
  try {
    const parsed = JSON.parse(match[1].trim());
    return {
      biasEvents: Array.isArray(parsed.biasEvents) ? parsed.biasEvents : [],
    };
  } catch {
    return { biasEvents: [] };
  }
}

function parseJsonObjectFromText(text = "") {
  const source = String(text || "").trim();
  const fenced = source.match(/```(?:json|magazine_comment_action)?\s*([\s\S]*?)```/i);
  const candidates = [
    fenced?.[1]?.trim() || "",
    source,
    source.slice(source.indexOf("{"), source.lastIndexOf("}") + 1),
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
    } catch {
      // Try the next candidate.
    }
  }
  return {};
}

function stripMagazineCommentActionBlocks(answer = "") {
  return cleanText(String(answer || "").replace(/```magazine_comment_action[\s\S]*?```/gi, ""));
}

function buildMagazineCommentBiasPrompt({ article, comments, commentText, replyText }) {
  return [
    "너는 주식채널 매거진+의 댓글을 읽고 사용자 취향/편집 방향 bias 이벤트를 분류하는 JSON 하네스다.",
    "독자에게 보이는 답변을 쓰지 말고 JSON 객체만 출력한다. 마크다운 코드펜스도 붙이지 않는다.",
    "텍스트 매칭 규칙을 만들지 말고, 댓글의 의미와 맥락을 추론해 분류한다.",
    "새 댓글이 앞으로 어떤 기사/주제/형식/깊이를 더 다루거나 덜 다루라는 요청이면 isEditorialDirectionRequest=true다.",
    "예: '앞으로 계속 팔로우업 하고 싶어', '이런 기사 더 보고 싶어요', '너무 많으니 줄여줘', '데이터를 더 넣어줘'는 편집 방향 요청이다.",
    "단순 질문, 사실 확인, 기사 내용 이해 요청이면 isEditorialDirectionRequest=false이고 biasEvents는 빈 배열이다.",
    "increase는 더 다뤄 달라는 요청, decrease는 줄여 달라는 요청, neutral은 기억할 메모는 있으나 방향성이 약한 요청이다.",
    "biasEvents는 최대 3개로 제한하고, label은 짧고 재사용 가능한 한국어 편집 방향으로 쓴다.",
    "prompt는 향후 기사 생성기가 바로 참고할 수 있도록 구체적으로 쓴다.",
    "weight는 보통 1, 강한 표현이면 1.3, 약한 표현이면 0.6 정도로 둔다.",
    "출력 스키마: {\"isEditorialDirectionRequest\":true,\"confidence\":0.0,\"biasEvents\":[{\"direction\":\"increase|decrease|neutral\",\"label\":\"짧은 편집 방향\",\"prompt\":\"향후 기사 생성에 반영할 구체적 요청\",\"topics\":[\"시장\"],\"reason\":\"판단 근거\",\"weight\":1}]}",
    "[현재 기사]",
    JSON.stringify(compactArticleForCommentPrompt(article), null, 2),
    "[기존 코멘트와 답변]",
    JSON.stringify(compactCommentsForPrompt(comments), null, 2),
    "[새 사용자 코멘트]",
    commentText,
    "[매거진 편집자 AI 답변]",
    replyText,
  ].join("\n\n");
}

function normalizeClassifierBiasEvents(parsed) {
  const source = parsed && typeof parsed === "object" ? parsed : {};
  const isRequest = source.isEditorialDirectionRequest === true;
  const confidence = clampNumber(source.confidence, 0, 1, isRequest ? 0.7 : 0);
  const biasEvents = Array.isArray(source.biasEvents) ? source.biasEvents : [];
  if (!isRequest || confidence < 0.45) {
    return [];
  }
  return biasEvents
    .map((event) => ({
      direction: normalizeBiasDirection(event?.direction),
      label: cleanText(event?.label || event?.title || ""),
      prompt: cleanText(event?.prompt || event?.request || event?.label || ""),
      topics: normalizeTopicList(event?.topics || []),
      reason: cleanText(event?.reason || ""),
      weight: clampNumber(event?.weight, 0.1, 5, confidence >= 0.75 ? 1 : 0.6),
    }))
    .filter((event) => event.label && event.prompt)
    .slice(0, 3);
}

async function classifyMagazineCommentBias({ body, article, comments, commentText, replyText }) {
  try {
    const result = await runCodexChat({
      provider: cleanText(body.provider || ""),
      model: cleanText(body.model || ""),
      reasoning: cleanText(body.reasoning || "medium"),
      speed: cleanText(body.speed || "standard"),
      approval: "never",
      personaMode: "none",
      prompt: buildMagazineCommentBiasPrompt({
        article,
        comments,
        commentText,
        replyText,
      }),
      messages: [],
      screen: "magazine",
      includeSharedMemory: true,
      includeWorldMemorySearchContext: true,
      worldMemoryVectorSearchQuery: [article.title, article.summary, commentText].filter(Boolean).join("\n"),
      worldMemoryFocusContext: {
        source: "magazine-comment-bias-classifier",
        articleId: article.id,
        articleTitle: article.title,
        topics: article.topics,
      },
      includeNewsFeedSearchContext: false,
      requireWebSearch: false,
    });
    return normalizeClassifierBiasEvents(parseJsonObjectFromText(result.answer || ""));
  } catch {
    return [];
  }
}

function upsertComment(comments = [], comment) {
  const next = [];
  let replaced = false;
  for (const item of comments) {
    if (item.id === comment.id) {
      next.push(comment);
      replaced = true;
    } else {
      next.push(item);
    }
  }
  if (!replaced) next.push(comment);
  return next.slice(-MAX_COMMENTS_PER_ARTICLE);
}

async function appendBiasEventsFromComment({ article, comment, rawBiasEvents }) {
  const sourceEvents = Array.isArray(rawBiasEvents) ? rawBiasEvents.slice(0, 6) : [];
  if (!sourceEvents.length) return [];
  const createdAt = comment.reply?.createdAt || new Date().toISOString();
  const nextEvents = sourceEvents
    .map((event, index) =>
      normalizeBiasEvent({
        ...event,
        id: `${createdAt}-${comment.id}-bias-${index + 1}`,
        articleId: article.id,
        articleTitle: article.title,
        articleType: article.articleType,
        commentId: comment.id,
        createdAt,
        worldMemoryWeight: worldMemoryWeightForArticle(article),
        worldMemoryAnchors: worldMemoryAnchorsForArticle(article),
      })
    )
    .filter(Boolean);
  if (!nextEvents.length) return [];
  const store = await readBiasStore();
  const nextStore = normalizeBiasStore({
    ...store,
    updatedAt: createdAt,
    events: [...store.events, ...nextEvents].slice(-MAX_BIAS_EVENTS),
  });
  await writeJsonAtomic(MAGAZINE_EDITORIAL_BIAS_PATH, nextStore);
  return nextEvents;
}

async function writeCommentStore(articleId, store) {
  const id = normalizeArticleId(articleId);
  const nextStore = normalizeCommentStore(id, store);
  await writeJsonAtomic(commentStorePathForArticle(id), nextStore);
  return nextStore;
}

function publicCommentSnapshot(store, extra = {}) {
  return {
    ok: true,
    storage: "files",
    configPath: `data/magazine/articles/${store.articleId}/comments.json`,
    version: 1,
    articleId: store.articleId,
    updatedAt: store.updatedAt,
    commentCount: store.comments.length,
    comments: store.comments,
    ...extra,
  };
}

async function readJsonBody(req) {
  const chunks = [];
  let length = 0;
  for await (const chunk of req) {
    length += chunk.length;
    if (length > 1024 * 1024) {
      throw new Error("request body too large");
    }
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString("utf8").trim();
  return text ? JSON.parse(text) : {};
}

function worldMemoryIssues(metadata, evidence) {
  const usesWorldMemory = Boolean(metadata.worldMemory) ||
    (Array.isArray(metadata.sourceBasis) && metadata.sourceBasis.some((item) => /world memory/i.test(String(item))));
  if (!usesWorldMemory) return [];
  const issues = [];
  if (evidence.retrievalPolicy !== WORLD_MEMORY_VECTOR_POLICY.retrievalPolicy) {
    issues.push("worldMemory.retrievalPolicy must be mandatory-vector-search");
  }
  if (!evidence.query) {
    issues.push("worldMemory.query is required");
  }
  if (!evidence.vectorSearch.hits.length) {
    issues.push("worldMemory.vectorSearch.hits must include semantic-search results");
  }
  if (!evidence.vectorSearch.engine || !evidence.vectorSearch.model) {
    issues.push("worldMemory.vectorSearch engine/model are required");
  }
  return issues;
}

async function readArticle(articleId) {
  const id = normalizeArticleId(articleId);
  const articleDir = articleDirForId(id);
  const metadataPath = join(articleDir, "metadata.json");
  const bodyPath = join(articleDir, "article.html");
  const metadata = JSON.parse(await readFile(metadataPath, "utf8"));
  const bodyStat = await stat(bodyPath);
  if (bodyStat.size > MAX_ARTICLE_HTML_BYTES) {
    throw new Error(`article body is too large: ${id}`);
  }
  const bodyHtml = cleanMagazineArticleBodyHtml(await readFile(bodyPath, "utf8"));
  const heroImage = normalizeHeroImage(metadata.heroImage, id);
  const worldMemory = normalizeWorldMemoryEvidence(metadata.worldMemory);
  const generationAgent = normalizeGenerationAgent(metadata.generationAgent);
  const issues = worldMemoryIssues(metadata, worldMemory);
  const summary = cleanText(metadata.summary || metadata.deck || "");
  const title = cleanText(metadata.title || id);
  const articleTopics = normalizeArticleTopics(metadata);
  const followupOptions = Array.isArray(metadata.followupOptions) && metadata.followupOptions.length
    ? metadata.followupOptions
    : defaultFollowupOptionsForArticle(metadata);
  return {
    id,
    articleType: cleanText(metadata.articleType || "analysis"),
    topic: cleanText(articleTopics[0] || (!Array.isArray(metadata.topics) ? metadata.topic : "")),
    topics: articleTopics,
    title,
    deck: cleanText(metadata.deck || summary),
    summary,
    image: heroImage.src,
    imageAlt: heroImage.alt,
    imageCredit: heroImage.credit,
    heroImage,
    publishedAt: cleanText(metadata.publishedAt || ""),
    createdAt: cleanText(metadata.createdAt || ""),
    updatedAt: cleanText(metadata.updatedAt || ""),
    isCoverStory: Boolean(metadata.isCoverStory),
    coverRank: metadata.coverRank,
    coverRegisteredAt: cleanText(metadata.coverRegisteredAt || ""),
    sourceBasis: Array.isArray(metadata.sourceBasis) ? metadata.sourceBasis.map(cleanText).filter(Boolean) : [],
    worldMemory,
    generationAgent,
    chartBlocks: Array.isArray(metadata.chartBlocks)
      ? metadata.chartBlocks.map(normalizeChartBlock).filter(Boolean).slice(0, 8)
      : [],
    followupOptions: followupOptions
      .map((option, index) => normalizeFollowupOption(option, index, articleTopics))
      .filter(Boolean)
      .slice(0, 6),
    issues,
    bodyHtml,
    storagePath: articleStoragePath(articleDir),
  };
}

export async function listMagazineArticles() {
  ensureMagazineDirs();
  const entries = await readdir(MAGAZINE_ARTICLES_DIR, { withFileTypes: true });
  const articles = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (!ARTICLE_ID_PATTERN.test(entry.name)) continue;
    try {
      articles.push(await readArticle(entry.name));
    } catch {
      // Skip malformed article folders; diagnostics can surface detailed repair later.
    }
  }
  articles.sort(sortByLatest);
  const coverStories = articles
    .filter((article) => article.isCoverStory)
    .sort(sortByCoverOrder)
    .slice(0, 5);
  return {
    articles: articles.slice(0, MAX_ARTICLES),
    coverStories,
    topicCatalog: readMagazineTopicCatalog(),
    readState: magazineReadStateSnapshot(articles, await readMagazineReadState()),
    scheduler: publicMagazineSchedulerState(),
    worldMemoryPolicy: WORLD_MEMORY_VECTOR_POLICY,
    worldMemoryIssues: articles
      .filter((article) => article.issues.length)
      .map((article) => ({
        articleId: article.id,
        title: article.title,
        issues: article.issues,
      })),
  };
}

async function listMagazineArticleStatusRecords() {
  ensureMagazineDirs();
  const directoryStat = await stat(MAGAZINE_ARTICLES_DIR);
  const now = Date.now();
  if (
    magazineStatusRecordCache &&
    magazineStatusRecordCache.directoryMtimeMs === directoryStat.mtimeMs &&
    now - magazineStatusRecordCache.cachedAt < MAGAZINE_STATUS_RECORD_CACHE_MS
  ) {
    return magazineStatusRecordCache.records;
  }

  const entries = (await readdir(MAGAZINE_ARTICLES_DIR, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && ARTICLE_ID_PATTERN.test(entry.name));
  const records = [];
  const batchSize = 32;
  for (let index = 0; index < entries.length; index += batchSize) {
    const batch = entries.slice(index, index + batchSize);
    const batchRecords = await Promise.all(
      batch.map(async (entry) => {
        try {
          const metadata = JSON.parse(
            await readFile(join(MAGAZINE_ARTICLES_DIR, entry.name, "metadata.json"), "utf8")
          );
          return {
            id: entry.name,
            title: cleanText(metadata.title || entry.name),
            publishedAt: cleanText(metadata.publishedAt || ""),
            createdAt: cleanText(metadata.createdAt || ""),
            updatedAt: cleanText(metadata.updatedAt || ""),
          };
        } catch {
          return null;
        }
      })
    );
    records.push(...batchRecords.filter(Boolean));
  }
  records.sort(sortByLatest);
  const limitedRecords = records.slice(0, MAX_ARTICLES);
  magazineStatusRecordCache = {
    cachedAt: now,
    directoryMtimeMs: directoryStat.mtimeMs,
    records: limitedRecords,
  };
  return limitedRecords;
}

export async function deleteMagazineArticle(articleId) {
  ensureMagazineDirs();
  const id = normalizeArticleId(articleId);
  const targetDir = articleDirForId(id);
  if (!existsSync(targetDir)) {
    return { deleted: false, articleId: id, deletedCount: 0, indexDeletedCount: 0 };
  }
  await rm(targetDir, { recursive: true, force: false });
  const indexDeletion = await deleteMagazineEventSignatureIndexEntry(id);
  return {
    deleted: true,
    articleId: id,
    deletedCount: 1,
    indexDeletedCount: indexDeletion.deletedCount,
    indexDeletion,
  };
}

function clampInteger(value, min, max, fallback) {
  const number = Number.parseInt(value, 10);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}

function magazineSchedulerIntervalMs() {
  const settingsIntervalMs = readMagazineSettings().schedulerIntervalHours * 60 * 60 * 1000;
  const fallback = Number.isFinite(settingsIntervalMs) && settingsIntervalMs > 0
    ? settingsIntervalMs
    : MAGAZINE_SCHEDULER_DEFAULT_INTERVAL_MS;
  return clampInteger(
    process.env.FINANCE_AGENT_MAGAZINE_INTERVAL_MS,
    MAGAZINE_SCHEDULER_MIN_INTERVAL_MS,
    MAGAZINE_SCHEDULER_MAX_INTERVAL_MS,
    fallback
  );
}

function magazineSchedulerRetryIntervalMs(intervalMs = magazineSchedulerIntervalMs()) {
  return clampInteger(
    process.env.FINANCE_AGENT_MAGAZINE_RETRY_INTERVAL_MS,
    MAGAZINE_SCHEDULER_MIN_INTERVAL_MS,
    intervalMs,
    Math.min(15 * 60 * 1000, intervalMs)
  );
}

function magazineSchedulerInitialDelayMs(intervalMs = magazineSchedulerIntervalMs()) {
  return clampInteger(
    process.env.FINANCE_AGENT_MAGAZINE_INITIAL_DELAY_MS,
    0,
    intervalMs,
    intervalMs
  );
}

function safeGeneratorCliValue(value, fallback, pattern = /^[A-Za-z0-9._:-]+$/) {
  const text = cleanText(value || "");
  return pattern.test(text) ? text : fallback;
}

function safeGeneratorModelValue(value, fallback) {
  return safeGeneratorCliValue(value, fallback, /^[\w .:/()+-]+$/);
}

function truncateSchedulerText(value, limit = 260) {
  const text = cleanText(value || "");
  if (text.length <= limit) return text;
  return `${text.slice(0, Math.max(0, limit - 1)).trim()}…`;
}

function normalizeAgentProviderId(value, fallback = MAGAZINE_CODEX_PROVIDER_ID) {
  const provider = safeGeneratorCliValue(value, fallback);
  return provider === MAGAZINE_ANTIGRAVITY_PROVIDER_ID || provider === MAGAZINE_CODEX_PROVIDER_ID
    ? provider
    : fallback;
}

function normalizeMagazineProviderSetting(value) {
  return value === MAGAZINE_ANTIGRAVITY_PROVIDER_ID || value === MAGAZINE_CODEX_PROVIDER_ID
    ? value
    : "default";
}

function normalizeMagazineReasoningForProvider(provider, value, fallback = "") {
  const candidate = safeGeneratorCliValue(value || "", "").toLowerCase();
  const allowed =
    provider === MAGAZINE_ANTIGRAVITY_PROVIDER_ID
      ? MAGAZINE_ANTIGRAVITY_REASONING_IDS
      : MAGAZINE_CODEX_REASONING_IDS;
  if (allowed.has(candidate)) return candidate;
  const safeFallback = safeGeneratorCliValue(fallback || "", "").toLowerCase();
  return allowed.has(safeFallback) ? safeFallback : "";
}

function normalizeAgentProviderSettings(raw = {}) {
  const source = raw && typeof raw === "object" ? raw : {};
  return {
    approval: safeGeneratorCliValue(source.approval || source.approvalPolicy || "", ""),
    model: safeGeneratorModelValue(source.model || "", ""),
    reasoning: safeGeneratorCliValue(source.reasoning || source.reasoningEffort || "", ""),
    speed: safeGeneratorCliValue(source.speed || source.serviceTier || "standard", "standard"),
  };
}

function mergeAgentProviderSettings(base = {}, override = {}) {
  const current = normalizeAgentProviderSettings(base);
  const next = normalizeAgentProviderSettings(override);
  return Object.fromEntries(
    Object.entries({
      approval: next.approval || current.approval,
      model: next.model || current.model,
      reasoning: next.reasoning || current.reasoning,
      speed: next.speed || current.speed || "standard",
    }).filter(([, value]) => value)
  );
}

async function readMagazineSchedulerAgent() {
  const defaultSettings = (await readJsonFile(AGENT_SETTINGS_DEFAULT_PATH)) || {};
  const userSettings = (await readJsonFile(AGENT_SETTINGS_USER_PATH)) || {};
  const magazineSettings = readMagazineSettings();
  const configuredProvider = normalizeMagazineProviderSetting(magazineSettings.writingProvider);
  const defaultProvider = normalizeAgentProviderId(
    userSettings.selectedProvider || userSettings.provider || defaultSettings.selectedProvider || defaultSettings.provider
  );
  const provider = configuredProvider === "default" ? defaultProvider : configuredProvider;
  const providerSettings = mergeAgentProviderSettings(
    defaultSettings.providers?.[provider] || {},
    userSettings.providers?.[provider] || {}
  );
  const topLevelSettings = mergeAgentProviderSettings(defaultSettings, userSettings);
  const settings = mergeAgentProviderSettings(providerSettings, topLevelSettings);
  const useAntigravity = provider === MAGAZINE_ANTIGRAVITY_PROVIDER_ID;
  const defaultReasoning = useAntigravity ? "medium" : "high";
  const providerReasoning = normalizeMagazineReasoningForProvider(provider, settings.reasoning, defaultReasoning);
  const configuredReasoning = normalizeMagazineReasoningForProvider(
    provider,
    magazineSettings.writingReasoning,
    providerReasoning || defaultReasoning
  );
  const model = magazineSettings.writingModel || settings.model || (useAntigravity ? "Gemini 3.5 Flash (Medium)" : "gpt-5.5");
  const reasoning = configuredReasoning || providerReasoning || defaultReasoning;
  let speed = "standard";
  if (!useAntigravity) {
    try {
      const modelGroup = getCodexOptions().modelGroups?.find((group) => group.slug === model);
      const preferredSpeed = magazineSettings.writingSpeed || settings.speed || "standard";
      const speedOption = modelGroup?.speedOptions?.find((option) => option.id === preferredSpeed);
      const supportedReasoningLevels = Array.isArray(speedOption?.supportedReasoningLevels)
        ? speedOption.supportedReasoningLevels
        : [];
      if (speedOption && (!supportedReasoningLevels.length || supportedReasoningLevels.includes(reasoning))) {
        speed = preferredSpeed;
      }
    } catch {
      speed = "standard";
    }
  }
  return {
    provider,
    model,
    reasoning,
    approval: useAntigravity ? settings.approval || "turbo" : "never",
    speed,
  };
}

function schedulerGenerationApproval(agent = {}) {
  return agent.provider === MAGAZINE_ANTIGRAVITY_PROVIDER_ID ? agent.approval || "turbo" : "never";
}

function processIsAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function activeMagazineGenerationLock() {
  if (!existsSync(MAGAZINE_GENERATION_LOCK_PATH)) return null;
  try {
    const lock = JSON.parse(readFileSync(MAGAZINE_GENERATION_LOCK_PATH, "utf8"));
    const pid = Number(lock.pid || 0);
    if (processIsAlive(pid)) {
      return {
        pid,
        startedAt: typeof lock.startedAt === "string" ? lock.startedAt : "",
      };
    }
  } catch {
    // Unreadable lock files are stale for scheduler preflight purposes.
  }
  rmSync(MAGAZINE_GENERATION_LOCK_PATH, { force: true });
  return null;
}

function newsFeedItemTimestamp(item = {}) {
  for (const field of ["publishedAt", "fetchedAt", "translatedAt"]) {
    const timestamp = parseTimestamp(item[field]);
    if (timestamp) return { timestamp, field, iso: nowIso(new Date(timestamp)) };
  }
  return { timestamp: 0, field: "", iso: "" };
}

function normalizeMagazineTopicDiscoveryLane(value = {}) {
  const source = value && typeof value === "object" ? value : { id: value };
  const id = cleanText(source.id || source.lane || "");
  const isScout = id === "world-memory-scout";
  return {
    id: isScout ? "world-memory-scout" : "news-feed-primary",
    label: isScout ? "비주류 후보 발굴" : "기본 후보 발굴",
    probability: isScout ? MAGAZINE_WORLD_MEMORY_SCOUT_PROBABILITY : 1 - MAGAZINE_WORLD_MEMORY_SCOUT_PROBABILITY,
    randomRoll:
      Number.isFinite(Number(source.randomRoll)) && Number(source.randomRoll) >= 0
        ? Number(source.randomRoll)
        : null,
    policy: isScout
      ? "true-random-12-percent-world-memory-under-radar-topic-discovery"
      : "default-news-feed-primary-topic-discovery",
  };
}

export function chooseMagazineTopicDiscoveryLane(options = {}) {
  const rawRoll = options.roll === undefined || options.roll === null ? randomInt(100) : Number(options.roll);
  const roll = clampInteger(rawRoll, 0, 99, 99);
  return normalizeMagazineTopicDiscoveryLane({
    id: roll < MAGAZINE_WORLD_MEMORY_SCOUT_PROBABILITY * 100 ? "world-memory-scout" : "news-feed-primary",
    randomRoll: roll,
  });
}

function hasMagazineTopicDiscoveryLane(value) {
  if (!value) return false;
  if (typeof value === "string") return Boolean(cleanText(value));
  if (typeof value !== "object") return false;
  return Boolean(cleanText(value.id || value.lane || ""));
}

export function buildMagazineTopicDiscoverySlots(targetCount = 0, options = {}) {
  const count = clampInteger(targetCount, 0, 3, 0);
  const forcedLane = hasMagazineTopicDiscoveryLane(options.topicDiscoveryLane)
    ? normalizeMagazineTopicDiscoveryLane(options.topicDiscoveryLane)
    : null;
  const rolls = Array.isArray(options.rolls) ? options.rolls : [];
  return Array.from({ length: count }, (_, index) => {
    const lane = forcedLane
      ? normalizeMagazineTopicDiscoveryLane(forcedLane)
      : chooseMagazineTopicDiscoveryLane({ roll: rolls[index] });
    return {
      index: index + 1,
      topicDiscoveryLane: lane,
      status: "pending",
    };
  });
}

function normalizeMagazineTopicDiscoverySlots(value = [], targetCount = 0, options = {}) {
  const count = clampInteger(targetCount, 0, 3, 0);
  const source = Array.isArray(value) ? value : [];
  const slots = [];
  for (let index = 0; index < count; index += 1) {
    const slot = source[index] && typeof source[index] === "object" ? source[index] : {};
    const fallbackLane = hasMagazineTopicDiscoveryLane(options.topicDiscoveryLane)
      ? options.topicDiscoveryLane
      : slot.topicDiscoveryLane || slot.lane || null;
    slots.push({
      ...slot,
      index: index + 1,
      topicDiscoveryLane: hasMagazineTopicDiscoveryLane(fallbackLane)
        ? normalizeMagazineTopicDiscoveryLane(fallbackLane)
        : chooseMagazineTopicDiscoveryLane(),
      status: cleanText(slot.status || "pending") || "pending",
    });
  }
  return slots;
}

function compactNewsFeedItemForDecision(item = {}) {
  const time = newsFeedItemTimestamp(item);
  return {
    id: truncateSchedulerText(item.id || item.sourceFingerprint || "", 80),
    source: truncateSchedulerText(item.feedTitle || item.feedId || "", 80),
    title: truncateSchedulerText(item.translatedTitle || item.title || item.translatedText || item.originalText, 220),
    original: truncateSchedulerText(
      item.originalText && item.originalText !== item.translatedTitle ? item.originalText : "",
      160
    ),
    time: time.iso,
    timeField: time.field,
  };
}

function compactArticleNewsFeedIds(metadata = {}) {
  const items = Array.isArray(metadata.newsFeed?.items) ? metadata.newsFeed.items : [];
  return Array.from(new Set(
    items
      .map((item) => truncateSchedulerText(item?.id || item?.sourceFingerprint || "", 80))
      .filter(Boolean)
  )).slice(0, 8);
}

function compactArticleWorldMemoryEventIds(metadata = {}) {
  const hits = Array.isArray(metadata.worldMemory?.vectorSearch?.hits) ? metadata.worldMemory.vectorSearch.hits : [];
  return Array.from(new Set(
    hits
      .map((hit) => {
        if (hit && typeof hit === "object") return truncateSchedulerText(hit.eventId || hit.event_id || hit.id || "", 80);
        return "";
      })
      .filter(Boolean)
  )).slice(0, 8);
}

function compactWorldMemoryReportForDecision(worldState = {}) {
  const report = worldState.report && typeof worldState.report === "object" ? worldState.report : {};
  const view = report.view && typeof report.view === "object" ? report.view : {};
  const source = view || report;
  return {
    collector: {
      status: truncateSchedulerText(worldState.collector?.status || "", 60),
      lastSuccessfulAt: truncateSchedulerText(worldState.collector?.lastSuccessfulAt || "", 80),
      lastAction: truncateSchedulerText(worldState.collector?.lastAction || "", 180),
      lastError: truncateSchedulerText(worldState.collector?.lastError || "", 180),
    },
    report: {
      status: truncateSchedulerText(report.status || "", 60),
      generatedAt: truncateSchedulerText(report.generatedAt || "", 80),
      title: truncateSchedulerText(source.title || report.title || "", 140),
      asOf: truncateSchedulerText(source.asOf || report.generatedAt || "", 80),
      stance: truncateSchedulerText(source.stance || "", 60),
      summary: truncateSchedulerText(source.summary || report.summary || "", 700),
      highlights: Array.isArray(source.highlights)
        ? source.highlights.slice(0, 8).map((item) => ({
            title: truncateSchedulerText(item?.title || "", 140),
            body: truncateSchedulerText(item?.body || "", 260),
            tag: truncateSchedulerText(item?.tag || "", 60),
            importance: truncateSchedulerText(item?.importance || "", 40),
          }))
        : [],
      nextChecks: Array.isArray(source.nextChecks)
        ? source.nextChecks.slice(0, 8).map((item) => truncateSchedulerText(item, 180))
        : [],
    },
  };
}

async function compactRecentArticlesForDecision(limit = 8) {
  ensureMagazineDirs();
  const entries = await readdir(MAGAZINE_ARTICLES_DIR, { withFileTypes: true }).catch(() => []);
  const records = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !ARTICLE_ID_PATTERN.test(entry.name)) continue;
    const metadata = await readJsonFile(join(MAGAZINE_ARTICLES_DIR, entry.name, "metadata.json"));
    if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) continue;
    const timestamp = parseTimestamp(metadata.uploadedAt || metadata.generatedAt || metadata.publishedAt || metadata.createdAt || metadata.updatedAt);
    records.push({
      id: entry.name,
      title: truncateSchedulerText(metadata.title || entry.name, 160),
      publishedAt: truncateSchedulerText(metadata.publishedAt || metadata.createdAt || metadata.updatedAt || "", 80),
      topics: normalizeArticleTopics(metadata),
      storyFamily: truncateSchedulerText(metadata.storyFamily || "", 120),
      editorialAngle: truncateSchedulerText(metadata.editorialAngle || "", 140),
      noveltyNote: truncateSchedulerText(metadata.noveltyNote || "", 180),
      newsFeedIds: compactArticleNewsFeedIds(metadata),
      worldMemoryEventIds: compactArticleWorldMemoryEventIds(metadata),
      primaryWorldMemoryEventId: compactArticleWorldMemoryEventIds(metadata)[0] || "",
      timestamp,
    });
  }
  return records
    .sort((a, b) => b.timestamp - a.timestamp || a.id.localeCompare(b.id))
    .slice(0, limit)
    .map(({ timestamp, ...record }) => record);
}

async function buildMagazineArticleCountDecisionContext(options = {}) {
  const [worldState, newsStore, preferenceStore, biasStore, recentArticles] = await Promise.all([
    readJsonFile(WORLD_MEMORY_STATE_PATH),
    readJsonFile(NEWS_FEED_STORE_PATH),
    readPreferenceStore(),
    readBiasStore(),
    compactRecentArticlesForDecision(8),
  ]);
  const topicDiscoveryLane = hasMagazineTopicDiscoveryLane(options.topicDiscoveryLane)
    ? normalizeMagazineTopicDiscoveryLane(options.topicDiscoveryLane)
    : null;
  const perArticleSlotMode = Boolean(options.perArticleSlotMode || !topicDiscoveryLane);
  const cutoffMs = parseTimestamp(worldState?.collector?.lastSuccessfulAt);
  const newsItems = Array.isArray(newsStore?.items) ? newsStore.items : [];
  const allPostCutoffNewsItems = compactPostCutoffNewsFeedItemsForDecision(newsItems, cutoffMs);
  const shouldBuildScoutContext = perArticleSlotMode || topicDiscoveryLane?.id === "world-memory-scout";
  const scoutContext =
    shouldBuildScoutContext
      ? await buildWorldMemoryScoutContextForDecision(recentArticles)
      : {
          policy: "world-memory-under-radar-scout-v1",
          method: "structured-world-memory-candidates-plus-llm-editorial-selection",
          days: MAGAZINE_WORLD_MEMORY_SCOUT_DAYS,
          readLimit: MAGAZINE_WORLD_MEMORY_SCOUT_READ_LIMIT,
          candidateLimit: MAGAZINE_WORLD_MEMORY_SCOUT_CANDIDATE_LIMIT,
          sourceRowCount: 0,
          candidateCount: 0,
          candidates: [],
          skippedReason: "topic discovery lane did not select scout mode",
          error: "",
        };
  const newsFeedExcludedFromTopicDiscovery = topicDiscoveryLane?.id === "world-memory-scout";
  const postCutoffNewsItems = newsFeedExcludedFromTopicDiscovery ? [] : allPostCutoffNewsItems;
  const preferenceSnapshot = publicPreferenceSnapshot(preferenceStore);
  const biasSnapshot = publicBiasSnapshot(biasStore);
  const maxTargetCount = clampInteger(options.maxTargetCount, 0, 3, magazineSchedulerMaxPerCycle());

  return {
    policy: "magazine-article-count-decision-v1",
    maxTargetCount,
    maxTargetPolicy: "user-configured-upper-bound-not-guaranteed-count",
    now: nowIso(),
    topicDiscoveryPolicy: perArticleSlotMode
      ? {
          id: "per-article-slot-random",
          label: "기사 슬롯별 후보 발굴",
          scoutProbability: MAGAZINE_WORLD_MEMORY_SCOUT_PROBABILITY,
          policy: "roll-a-fresh-12-percent-under-radar-branch-for-each-article-slot-after-target-count",
        }
      : {
          id: "fixed-lane",
          label: "고정 후보 발굴",
          policy: "use-the-server-selected-lane-for-this-topic-decision",
        },
    ...(topicDiscoveryLane ? { topicDiscoveryLane } : {}),
    worldMemory: {
      ...compactWorldMemoryReportForDecision(worldState || {}),
      scout: scoutContext,
    },
    newsFeed: {
      storeUpdatedAt: truncateSchedulerText(newsStore?.updatedAt || "", 80),
      totalCount: newsItems.length,
      worldMemoryLastSuccessfulAt: truncateSchedulerText(worldState?.collector?.lastSuccessfulAt || "", 80),
      postCutoffCount: postCutoffNewsItems.length,
      postCutoffItems: postCutoffNewsItems,
      eligiblePostCutoffCount: allPostCutoffNewsItems.length,
      excludedFromTopicDiscovery: newsFeedExcludedFromTopicDiscovery,
      cutoffPolicy: cutoffMs
        ? "use only items after worldMemory.collector.lastSuccessfulAt"
        : "world memory eligibility boundary missing; do not count local evidence items as fresh input",
    },
    recentArticles,
    editorialPreferences: {
      effectiveSignals: Array.isArray(preferenceSnapshot.effectiveSignals)
        ? preferenceSnapshot.effectiveSignals.slice(0, 8).map((item) => ({
            label: truncateSchedulerText(item.label || "", 100),
            prompt: truncateSchedulerText(item.prompt || "", 220),
            topics: normalizeTopicList(item.topics || []),
            effectiveWeight: Number(item.effectiveWeight || 0),
          }))
        : [],
      effectiveBiasSignals: Array.isArray(biasSnapshot.effectiveBiasSignals)
        ? biasSnapshot.effectiveBiasSignals.slice(0, 8).map((item) => ({
            label: truncateSchedulerText(item.label || "", 100),
            prompt: truncateSchedulerText(item.prompt || "", 220),
            topics: normalizeTopicList(item.topics || []),
            effectiveWeight: Number(item.effectiveWeight || 0),
            increaseCount: Number(item.increaseCount || 0),
            decreaseCount: Number(item.decreaseCount || 0),
          }))
        : [],
    },
  };
}

export function compactPostCutoffNewsFeedItemsForDecision(newsItems = [], cutoffMs = 0) {
  if (!cutoffMs) return [];
  const items = Array.isArray(newsItems) ? newsItems : [];
  return items
    .map((item) => ({ item, itemTime: newsFeedItemTimestamp(item) }))
    .filter(({ itemTime }) => itemTime.timestamp > cutoffMs)
    .sort((a, b) => b.itemTime.timestamp - a.itemTime.timestamp || String(a.item.id || "").localeCompare(String(b.item.id || "")))
    .map(({ item }) => compactNewsFeedItemForDecision(item));
}

function compactWorldMemoryArray(value = [], limit = 8) {
  return Array.isArray(value)
    ? value.map((item) => cleanText(typeof item === "string" ? item : item?.name || item?.label || "")).filter(Boolean).slice(0, limit)
    : [];
}

function worldMemoryRowTimestamp(row = {}) {
  return parseTimestamp(row.as_of || row.logged_at || row.date || "");
}

function normalizeWorldMemoryScoutDedupeKey(value = "") {
  return cleanText(value)
    .toLowerCase()
    .replace(/[^0-9a-z가-힣]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function worldMemoryScoutRowScore(row = {}, nowMs = Date.now()) {
  const timestamp = worldMemoryRowTimestamp(row);
  const ageDays = timestamp ? Math.max(0, (nowMs - timestamp) / (24 * 60 * 60 * 1000)) : 45;
  const recencyScore = Math.max(0, 3 - ageDays / 10);
  const importance = cleanText(row.importance || "").toLowerCase();
  const importanceScore = importance === "medium" ? 3 : importance === "low" ? 2.2 : importance === "high" ? 0.7 : 1.2;
  const entryModeScore = cleanText(row.entry_mode || "") === "brief" ? 1.2 : 0.4;
  const structuredScore =
    (compactWorldMemoryArray(row.industries, 4).length ? 0.8 : 0) +
    (compactWorldMemoryArray(row.subjects, 4).length ? 0.5 : 0) +
    (Array.isArray(row.sources) && row.sources.length ? 0.5 : 0) +
    (cleanText(row.why_it_matters || row.portfolio_link || "") ? 0.7 : 0);
  return recencyScore + importanceScore + entryModeScore + structuredScore;
}

export function compactWorldMemoryScoutCandidatesForDecision(rows = [], recentArticles = [], options = {}) {
  const limit = clampInteger(options.limit, 1, 200, MAGAZINE_WORLD_MEMORY_SCOUT_CANDIDATE_LIMIT);
  const nowMs = Number.isFinite(Number(options.nowMs)) ? Number(options.nowMs) : Date.now();
  const recentEventIds = new Set(
    (Array.isArray(recentArticles) ? recentArticles : [])
      .flatMap((article) => article?.worldMemoryEventIds || [])
      .map((id) => cleanText(id))
      .filter(Boolean)
  );
  const seen = new Set();
  const sourceRows = (Array.isArray(rows) ? rows : []).filter((row) => row && typeof row === "object");
  const underRadarRows = sourceRows.filter((row) => cleanText(row.importance || "").toLowerCase() !== "high");
  return (underRadarRows.length ? underRadarRows : sourceRows)
    .filter((row) => {
      const eventId = cleanText(row.event_id || row.eventId || "");
      return !eventId || !recentEventIds.has(eventId);
    })
    .map((row) => ({ row, score: worldMemoryScoutRowScore(row, nowMs), timestamp: worldMemoryRowTimestamp(row) }))
    .sort((a, b) => b.score - a.score || b.timestamp - a.timestamp)
    .map(({ row, score }) => {
      const title = truncateSchedulerText(row.title || "", 180);
      const story = truncateSchedulerText(row.story || "", 120);
      const storyFamily = truncateSchedulerText(row.story_family || row.storyFamily || "", 120);
      const eventId = truncateSchedulerText(row.event_id || row.eventId || "", 80);
      const dedupeKey =
        normalizeWorldMemoryScoutDedupeKey(row.story_key || row.story || row.story_family || row.dedupe_key || row.title || eventId) ||
        eventId;
      if (dedupeKey && seen.has(dedupeKey)) return null;
      if (dedupeKey) seen.add(dedupeKey);
      return {
        eventId,
        title,
        summary: truncateSchedulerText(row.summary || "", 260),
        whyItMatters: truncateSchedulerText(row.why_it_matters || row.portfolio_link || "", 300),
        asOf: truncateSchedulerText(row.as_of || row.logged_at || "", 80),
        importance: truncateSchedulerText(row.importance || "", 40),
        entryMode: truncateSchedulerText(row.entry_mode || "", 40),
        story,
        storyFamily,
        industries: compactWorldMemoryArray(row.industries, 6),
        subjects: compactWorldMemoryArray(row.subjects, 6),
        eventKind: truncateSchedulerText(row.event_kind || "", 100),
        sourceNames: Array.isArray(row.sources)
          ? row.sources.map((source) => truncateSchedulerText(source?.name || "", 80)).filter(Boolean).slice(0, 6)
          : [],
        scoutScore: Math.round(score * 100) / 100,
      };
    })
    .filter(Boolean)
    .slice(0, limit);
}

function readWorldMemoryScoutRowsWithPythonCandidate(candidate) {
  return new Promise((resolveRows) => {
    const args = [
      ...candidate.argsPrefix,
      "scripts/world_memory_cli.py",
      "--base-dir",
      "data/world-memory",
      "list",
      "--days",
      String(MAGAZINE_WORLD_MEMORY_SCOUT_DAYS),
      "--entry-mode",
      "all",
      "--importance",
      "all",
      "--limit",
      String(MAGAZINE_WORLD_MEMORY_SCOUT_READ_LIMIT),
      "--format",
      "json",
    ];
    const child = spawn(candidate.command, args, {
      cwd: GUIBUILD_ROOT,
      env: { ...process.env, PYTHONUNBUFFERED: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolveRows(result);
    };
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      finish({ ok: false, error: `${candidate.display} timed out while reading World Memory scout rows` });
    }, 15000);
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      finish({ ok: false, error: error.message });
    });
    child.on("close", (code) => {
      if (settled) return;
      if (code !== 0) {
        finish({ ok: false, error: stderr.trim() || stdout.trim() || `${candidate.display} exited ${code}` });
        return;
      }
      try {
        const parsed = JSON.parse(stdout || "{}");
        finish({
          ok: true,
          rows: Array.isArray(parsed.rows) ? parsed.rows : [],
          count: Number(parsed.count || 0),
          dbPath: cleanText(parsed.db_path || ""),
          method: candidate.display,
        });
      } catch (error) {
        finish({ ok: false, error: `invalid World Memory scout JSON: ${error.message}` });
      }
    });
  });
}

async function buildWorldMemoryScoutContextForDecision(recentArticles = []) {
  const errors = [];
  for (const candidate of magazinePythonCandidates()) {
    if (candidate.command.includes(".venv") && !existsSync(candidate.command)) continue;
    const result = await readWorldMemoryScoutRowsWithPythonCandidate(candidate);
    if (!result.ok) {
      errors.push(`${candidate.display}: ${result.error || "failed"}`);
      continue;
    }
    const candidates = compactWorldMemoryScoutCandidatesForDecision(result.rows, recentArticles);
    return {
      policy: "world-memory-under-radar-scout-v1",
      method: "structured-world-memory-candidates-plus-llm-editorial-selection",
      days: MAGAZINE_WORLD_MEMORY_SCOUT_DAYS,
      readLimit: MAGAZINE_WORLD_MEMORY_SCOUT_READ_LIMIT,
      candidateLimit: MAGAZINE_WORLD_MEMORY_SCOUT_CANDIDATE_LIMIT,
      sourceRowCount: Number(result.count || result.rows.length || 0),
      candidateCount: candidates.length,
      candidates,
      dbPath: result.dbPath,
      command: "scripts/world_memory_cli.py list --days 45 --entry-mode all --importance all --format json",
      error: "",
    };
  }
  return {
    policy: "world-memory-under-radar-scout-v1",
    method: "structured-world-memory-candidates-plus-llm-editorial-selection",
    days: MAGAZINE_WORLD_MEMORY_SCOUT_DAYS,
    readLimit: MAGAZINE_WORLD_MEMORY_SCOUT_READ_LIMIT,
    candidateLimit: MAGAZINE_WORLD_MEMORY_SCOUT_CANDIDATE_LIMIT,
    sourceRowCount: 0,
    candidateCount: 0,
    candidates: [],
    dbPath: "",
    command: "scripts/world_memory_cli.py list --days 45 --entry-mode all --importance all --format json",
    error: truncateSchedulerText(errors.join(" | ") || "python runtime not found", 300),
  };
}

function buildMagazineArticleCountDecisionPrompt(context) {
  const maxTargetCount = clampInteger(context?.maxTargetCount, 0, 3, magazineSchedulerMaxPerCycle());
  return [
    "너는 FinanceAgentGUI 주식채널 매거진+의 자동 편집회의 JSON 하네스다.",
    `이번 자동 생성 주기에서 새 매거진 기사를 몇 개 쓸지 0~${maxTargetCount} 사이 정수로 결정한다.`,
    `사용자 설정 maxTargetCount=${maxTargetCount}는 확정 생성 수가 아니라 상한이다. 충분한 독립 신규 각도가 없으면 이보다 적게 선택한다.`,
    "topicDiscoveryPolicy.id가 'per-article-slot-random'이면 서버는 targetCount가 정해진 뒤 실제 기사 슬롯마다 독립적으로 12% 비주류 후보 발굴 분기를 굴린다. 이 단계에서는 기사 수와 후보 풀의 품질만 판단한다.",
    "topicDiscoveryLane이 있으면 서버가 이미 정한 특정 기사 슬롯의 주제 후보판이다. 모델은 이 값을 바꾸지 말고, 그 후보판 안에서 후보 품질만 의미적으로 판단한다.",
    "기사 수와 후보 품질 판단에서는 무작위 선택, 텍스트 매칭 규칙, 키워드 카운팅을 금지한다. 아래 컨텍스트의 의미, 최신성, 중복도, 독자 편집 신호를 종합해 LLM 편집 판단으로 결정한다.",
    "0건은 허용되지만, '쓸 만한 신규 각도가 명확히 없다'고 판단될 때만 선택한다. 단순히 데이터가 조금 적다는 이유로 0건을 고르지 않는다.",
    "1건은 새 각도가 하나 있거나 기존 이슈의 의미 있는 후속 업데이트가 하나 있을 때 선택한다.",
    "2건은 maxTargetCount가 2 이상이고 서로 다른 storyFamily/editorialAngle로 쓸 수 있는 신호가 두 개 이상 있을 때만 선택한다.",
    "3건은 maxTargetCount가 3이고 강한 신규 신호가 세 개 이상이며 최근 기사와 충분히 다른 각도를 만들 수 있을 때만 선택한다.",
    "최근 기사와 제목 구도, storyFamily, editorialAngle이 겹치면 후보 수를 줄인다. 독자 선호와 bias 신호는 신선한 시장 신호보다 우선하지 말고 보조 가중치로만 쓴다.",
    "최근 기사와 같은 metadata.newsFeed.items[].id를 재사용하는 후보는 같은 뉴스로 본다. primary continuity eventId가 같다는 사실만으로는 중복 판정하지 않는다. 그 eventId는 연속성 맥락일 수 있고, 하드 veto가 아니다.",
    "같은 사건을 다른 제목으로 다시 쓰는 후보는 targetCount에 세지 않는다. 독립 델타는 기사 전체 임베딩 거리가 아니라 새 근거 앵커다: 새 보도 id, 새 공식/외부 출처 URL, 새 수치, 새 정책 집행, 새 가격 반응, 새 기업 행동 중 적어도 하나가 이전 기사 이후 발생했을 때만 follow-up 후보로 남긴다.",
    "candidateAngles.title/reason과 reason에는 내부 출처명, 저장소명, 레인명, 도구명을 쓰지 않는다. 독자용 기사 문장처럼 자연스럽게 풀어 쓴다. 예: 'Bloomberg가 전한 장중 보도', '같은 날 나온 ISNA 인용 발언', '새 가격 반응', '새 기업 공시'.",
    "비슷한 후보는 same_event / independent_followup / unrelated로 의미 판정한다. same_event이면 제외하고, independent_followup이면 어떤 새 근거 앵커와 메커니즘이 생겼는지 candidateAngles.reason에 적는다. 제목, 사진, storyFamily 변경만으로 independent_followup이라고 보지 않는다.",
    "topicDiscoveryLane.id가 'world-memory-scout'이면 이 기사 슬롯의 주제 선정은 worldMemory.scout.candidates에서만 한다. newsFeed.postCutoffItems는 의도적으로 비워 둔 것으로 해석하고, News Feed 단문을 주제 선정 후보로 삼지 않는다.",
    "비주류 후보 발굴 분기는 Reports 화면의 '심심해요' 방법론을 따른다. 메인 뉴스에 가려져 아직 조용하지만 점차 중요해질 수 있는 분야/이슈를 의미 기반으로 고르고, 중복 기사 규칙은 동일하게 적용한다.",
    "출력은 JSON 객체 하나만 반환한다. 마크다운 코드펜스, 설명 문장, 추가 텍스트는 금지한다.",
    "반환 스키마:",
    JSON.stringify(
      {
        targetCount: 0,
        confidence: 0.82,
        reason: "왜 이 주기에서 이 개수가 적절한지 한국어 한두 문장",
        candidateAngles: [
          {
            title: "기사 후보 각도",
            reason: "이 각도가 최근 기사와 어떻게 다르고 왜 지금 쓸 만한지",
            urgency: "low|medium|high",
            storyFamily: "예상 storyFamily",
            editorialAngle: "예상 editorialAngle",
            primaryEvent: "primary event 한 문장",
            newsFeedIds: ["컨텍스트에 실제 존재하는 nf_..."],
            researchQueries: ["공식·외부 리서치 질의"],
          },
        ],
      },
      null,
      2
    ),
    "[편집 판단 컨텍스트]",
    JSON.stringify(context, null, 2),
  ].join("\n\n");
}

function scrubMagazineDecisionText(value, limit = 260) {
  let text = cleanText(value);
  for (const pattern of [
    /\bWorld\s*Memory\b/gi,
    /월드\s*메모리/g,
    /월드메모리/g,
    /\bNews\s*Feed\b/gi,
    /world-memory-scout/gi,
    /topicDiscoveryLane/gi,
    /topicDiscoveryPolicy/gi,
    /per-article-slot-random/gi,
    /스카우트\s*레인/g,
    /스카우트/g,
    /레인/g,
    /하네스/g,
    /후보판/g,
  ]) {
    text = text.replace(pattern, "");
  }
  return truncateSchedulerText(text.replace(/\s{2,}/g, " ").replace(/\s+([,./])/g, "$1"), limit);
}

function normalizeMagazineDecisionAngle(value) {
  const source = value && typeof value === "object" ? value : { title: value };
  const title = scrubMagazineDecisionText(source.title || source.label || source.angle || "", 120);
  const reason = scrubMagazineDecisionText(source.reason || source.rationale || source.note || "", 220);
  const urgency = cleanText(source.urgency || source.priority || "").toLowerCase();
  if (!title && !reason) return null;
  return {
    title: title || reason,
    reason,
    urgency: ["low", "medium", "high"].includes(urgency) ? urgency : "medium",
    storyFamily: scrubMagazineDecisionText(source.storyFamily || "", 160),
    editorialAngle: scrubMagazineDecisionText(source.editorialAngle || "", 120),
    primaryEvent: scrubMagazineDecisionText(source.primaryEvent || source.event || "", 300),
    newsFeedIds: uniqueStrings(source.newsFeedIds || source.sourceIds || []).filter((id) => /^nf_[A-Za-z0-9]+$/.test(id)).slice(0, 8),
    researchQueries: uniqueStrings(source.researchQueries || []).map((query) => truncateSchedulerText(query, 180)).slice(0, 5),
  };
}

export function normalizeMagazineArticleCountDecision(parsed = {}, options = {}) {
  const maxCount = clampInteger(options.maxCount, 0, 3, 3);
  const source = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  const rawTarget = source.targetCount ?? source.articleCount ?? source.count;
  const hasTarget = rawTarget !== undefined && rawTarget !== null && rawTarget !== "";
  const fallbackCount = clampInteger(options.fallbackCount, 0, maxCount, maxCount > 0 ? 1 : 0);
  const targetCount = hasTarget ? clampInteger(rawTarget, 0, maxCount, fallbackCount) : fallbackCount;
  const candidateAngles = Array.isArray(source.candidateAngles)
    ? source.candidateAngles.map(normalizeMagazineDecisionAngle).filter(Boolean).slice(0, maxCount || 3)
    : [];
  const fallback = Boolean(options.fallback);
  return {
    policy: "magazine-article-count-decision-v1",
    basis: fallback ? "fallback-after-model-decision-failure" : "llm-editorial-judgment",
    schemaOk: hasTarget && Number.isFinite(Number.parseInt(rawTarget, 10)),
    decidedAt: options.decidedAt || nowIso(),
    targetCount,
    maxCount,
    confidence: clampNumber(source.confidence, 0, 1, fallback ? 0 : 0.6),
    reason:
      scrubMagazineDecisionText(source.reason || source.rationale || source.explanation || "", 420) ||
      (targetCount === 0
        ? "모델이 이번 주기에서 새 기사로 만들 만한 독립 각도가 부족하다고 판단했습니다."
        : "모델 산정 응답의 사유가 비어 있어 목표 건수만 기록했습니다."),
    candidateAngles,
    topicDiscoveryPolicy:
      source.topicDiscoveryPolicy && typeof source.topicDiscoveryPolicy === "object"
        ? source.topicDiscoveryPolicy
        : options.topicDiscoveryPolicy && typeof options.topicDiscoveryPolicy === "object"
          ? options.topicDiscoveryPolicy
          : {
              id: hasMagazineTopicDiscoveryLane(options.topicDiscoveryLane || source.topicDiscoveryLane)
                ? "fixed-lane"
                : "per-article-slot-random",
              scoutProbability: MAGAZINE_WORLD_MEMORY_SCOUT_PROBABILITY,
            },
    ...(hasMagazineTopicDiscoveryLane(options.topicDiscoveryLane || source.topicDiscoveryLane)
      ? { topicDiscoveryLane: normalizeMagazineTopicDiscoveryLane(options.topicDiscoveryLane || source.topicDiscoveryLane) }
      : {}),
    provider: truncateSchedulerText(options.provider || "", 80),
    model: truncateSchedulerText(options.model || "", 120),
    reasoning: truncateSchedulerText(options.reasoning || "", 60),
    elapsedMs: Number(options.elapsedMs || 0),
    fallback,
    error: truncateSchedulerText(options.error || "", 300),
  };
}

export function fallbackMagazineArticleCountDecision(options = {}) {
  const maxCount = clampInteger(options.maxCount, 0, 3, 3);
  const targetCount = maxCount > 0 ? Math.min(1, maxCount) : 0;
  return normalizeMagazineArticleCountDecision(
    {
      targetCount,
      confidence: 0,
      reason:
        targetCount > 0
          ? "기사 수 산정 모델 호출이 실패해 이번 주기를 조용히 건너뛰지 않고 보수적으로 1건 생성으로 전환합니다."
          : "maxPerCycle 설정이 0이므로 이번 주기에는 새 기사를 생성하지 않습니다.",
      candidateAngles: [],
    },
    {
      ...options,
      maxCount,
      fallbackCount: targetCount,
      fallback: true,
    }
  );
}

async function decideScheduledMagazineArticleCount({ scheduledAt = "", topicDiscoveryLane = null, maxCountOverride = null } = {}) {
  const maxCount =
    maxCountOverride === null || maxCountOverride === undefined
      ? magazineSchedulerMaxPerCycle()
      : clampInteger(maxCountOverride, 0, 3, magazineSchedulerMaxPerCycle());
  const agent = await readMagazineSchedulerAgent();
  const normalizedTopicDiscoveryLane = hasMagazineTopicDiscoveryLane(topicDiscoveryLane)
    ? normalizeMagazineTopicDiscoveryLane(topicDiscoveryLane)
    : null;
  const topicDiscoveryPolicy = normalizedTopicDiscoveryLane
    ? { id: "fixed-lane", scoutProbability: MAGAZINE_WORLD_MEMORY_SCOUT_PROBABILITY }
    : { id: "per-article-slot-random", scoutProbability: MAGAZINE_WORLD_MEMORY_SCOUT_PROBABILITY };
  if (maxCount <= 0) {
    return {
      agent,
      decision: fallbackMagazineArticleCountDecision({
        maxCount,
        provider: agent.provider,
        model: agent.model,
        reasoning: agent.reasoning,
        topicDiscoveryLane: normalizedTopicDiscoveryLane,
        topicDiscoveryPolicy,
      }),
    };
  }

  try {
    const context = await buildMagazineArticleCountDecisionContext({
      topicDiscoveryLane: normalizedTopicDiscoveryLane,
      perArticleSlotMode: !normalizedTopicDiscoveryLane,
      maxTargetCount: maxCount,
    });
    const result = await runCodexChat({
      provider: agent.provider,
      model: agent.model,
      reasoning: agent.reasoning,
      speed: agent.speed,
      approval: agent.provider === MAGAZINE_ANTIGRAVITY_PROVIDER_ID ? agent.approval : "never",
      personaMode: "none",
      prompt: buildMagazineArticleCountDecisionPrompt({
        ...context,
        scheduledAt,
        selectedAgent: {
          provider: agent.provider,
          model: agent.model,
          reasoning: agent.reasoning,
        },
      }),
      messages: [],
      screen: "magazine",
      includeSharedMemory: false,
      includeWorldMemoryContext: false,
      includeWorldMemorySearchContext: false,
      includeNewsFeedContext: false,
      includeNewsFeedSearchContext: false,
      requireWebSearch: false,
    });
    const decision = normalizeMagazineArticleCountDecision(parseJsonObjectFromText(result.answer || ""), {
      maxCount,
      provider: result.provider || agent.provider,
      model: result.model || agent.model,
      reasoning: result.reasoning || agent.reasoning,
      elapsedMs: result.elapsedMs,
      topicDiscoveryLane: normalizedTopicDiscoveryLane,
      topicDiscoveryPolicy,
    });
    if (!decision.schemaOk) {
      throw new Error("article count decision response did not include a numeric targetCount");
    }
    return { agent, decision };
  } catch (error) {
    return {
      agent,
      decision: fallbackMagazineArticleCountDecision({
        maxCount,
        provider: agent.provider,
        model: agent.model,
        reasoning: agent.reasoning,
        topicDiscoveryLane: normalizedTopicDiscoveryLane,
        topicDiscoveryPolicy,
        error: error.message,
      }),
    };
  }
}

function runMagazineGenerator(body = {}, action = "generateWithCodex") {
  ensureMagazineDirs();
  const provider =
    action === "generateWithAntigravity"
      ? MAGAZINE_ANTIGRAVITY_PROVIDER_ID
      : safeGeneratorCliValue(body.provider || MAGAZINE_CODEX_PROVIDER_ID, MAGAZINE_CODEX_PROVIDER_ID);
  const useAntigravity = provider === MAGAZINE_ANTIGRAVITY_PROVIDER_ID;
  const count = clampInteger(body.count, 1, 10, 1);
  const requestedCount = count;
  const replace = body.replace !== false;
  const model = safeGeneratorModelValue(body.model || (useAntigravity ? "Gemini 3.5 Flash (Medium)" : ""), "");
  const reasoning = safeGeneratorCliValue(body.reasoning || (useAntigravity ? "medium" : ""), "");
  const sandbox = safeGeneratorCliValue(body.sandbox || "", "", /^[A-Za-z-]+$/);
  const approval = safeGeneratorCliValue(body.approval || (useAntigravity ? "turbo" : "never"), useAntigravity ? "turbo" : "never", /^[A-Za-z-]+$/);
  const speed = safeGeneratorCliValue(body.speed || "standard", "standard", /^[A-Za-z-]+$/);
  const harness = safeGeneratorCliValue(body.harness || "v2", "v2", /^(?:v2|legacy)$/);
  const extraPrompt = cleanText(body.prompt || body.extraPrompt || "");
  const lockedTopic = body.lockedTopic && typeof body.lockedTopic === "object" && !Array.isArray(body.lockedTopic)
    ? body.lockedTopic
    : null;
  const project = safeGeneratorCliValue(body.project || "", "");
  const location = safeGeneratorCliValue(body.location || "", "");
  const args = [MAGAZINE_CODEX_GENERATOR, "--provider", provider, "--count", String(count), "--approval", approval];
  if (replace) args.push("--replace");
  if (model) args.push("--model", model);
  if (reasoning) args.push("--reasoning", reasoning);
  if (!useAntigravity && speed) args.push("--speed", speed);
  args.push("--harness", harness);
  if (sandbox) args.push("--sandbox", sandbox);
  if (project) args.push("--project", project);
  if (location) args.push("--location", location);

  return new Promise((resolveGenerator, reject) => {
    const startedAt = Date.now();
    const child = spawn(process.execPath, args, {
      cwd: GUIBUILD_ROOT,
      env: {
        ...process.env,
        NO_COLOR: "1",
        MAGAZINE_CODEX_EXTRA_PROMPT: extraPrompt,
        MAGAZINE_LOCKED_TOPIC_JSON: lockedTopic ? JSON.stringify(lockedTopic) : "",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error("magazine Codex generation timed out"));
    }, MAGAZINE_GENERATION_TIMEOUT_MS);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      const elapsedMs = Date.now() - startedAt;
      const result = {
        ok: code === 0,
        code,
        elapsedMs,
        stdout: stdout.trim().slice(-20000),
        stderr: stderr.trim().slice(-12000),
        count,
        requestedCount,
        replace,
        provider,
        model,
        reasoning,
        approval,
        speed,
      };
      if (code !== 0) {
        reject(new Error(result.stderr || result.stdout || `magazine generator exited ${code}`));
        return;
      }
      resolveGenerator(result);
    });
  });
}

function magazineSchedulerDisabled() {
  return (
    process.env.FINANCE_AGENT_MAGAZINE_SCHEDULER_DISABLED === "1" ||
    process.env.FINANCE_AGENT_MAGAZINE_AUTORUN === "0" ||
    !isMagazineEnabled()
  );
}

function magazineSchedulerMaxPerCycle() {
  const settingsMax = readMagazineSettings().schedulerMaxArticlesPerCycle;
  if (MAGAZINE_SCHEDULER_ENV_MAX_PER_CYCLE !== null) {
    return Math.min(settingsMax, MAGAZINE_SCHEDULER_ENV_MAX_PER_CYCLE);
  }
  return settingsMax;
}

function magazineSchedulerHasActiveWork() {
  return Boolean(
    magazineSchedulerRuntime.running ||
      magazineSchedulerRuntime.currentCycle ||
      magazineSchedulerRuntime.activeCycle ||
      magazineSchedulerRuntime.manualStartRequestedAt ||
      activeMagazineGenerationLock()
  );
}

function publicMagazineSchedulerState() {
  const settings = publicMagazineSettingsSnapshot();
  const generationLock = activeMagazineGenerationLock();
  const intervalMs = magazineSchedulerIntervalMs();
  const retryIntervalMs = magazineSchedulerRetryIntervalMs(intervalMs);
  const initialDelayMs = magazineSchedulerInitialDelayMs(intervalMs);
  return {
    enabled: !magazineSchedulerDisabled(),
    settings,
    started: magazineSchedulerRuntime.started,
    startedAt: magazineSchedulerRuntime.startedAt,
    running: magazineSchedulerRuntime.running,
    intervalMs,
    intervalMinutes: Math.round((intervalMs / 60000) * 100) / 100,
    intervalHours: Math.round((intervalMs / (60 * 60 * 1000)) * 100) / 100,
    intervalSource: process.env.FINANCE_AGENT_MAGAZINE_INTERVAL_MS ? "env" : "settings",
    retryIntervalMs,
    retryIntervalMinutes: Math.round((retryIntervalMs / 60000) * 100) / 100,
    retryWindowMs: intervalMs,
    initialDelayMs,
    maxPerCycle: magazineSchedulerMaxPerCycle(),
    maxPerCycleSource: MAGAZINE_SCHEDULER_ENV_MAX_PER_CYCLE === null ? "settings" : "settings-env-cap",
    nextRunAt: magazineSchedulerRuntime.nextRunAt,
    nextRetryAt: magazineSchedulerRuntime.nextRetryAt,
    currentCycle: magazineSchedulerRuntime.currentCycle,
    activeCycle: magazineSchedulerRuntime.activeCycle,
    lastCycle: magazineSchedulerRuntime.lastCycle,
    lastError: magazineSchedulerRuntime.lastError,
    generationLock,
    generationInFlight: Boolean(generationLock),
    manualStartRequestedAt: magazineSchedulerRuntime.manualStartRequestedAt,
    manualStartPending: Boolean(magazineSchedulerRuntime.manualStartRequestedAt && !magazineSchedulerRuntime.running),
    path: "data/magazine/scheduler-state.json",
  };
}

async function writeMagazineSchedulerState(extra = {}) {
  try {
    await writeJsonAtomic(MAGAZINE_SCHEDULER_STATE_PATH, {
      version: 1,
      updatedAt: nowIso(),
      scheduler: {
        ...publicMagazineSchedulerState(),
        ...extra,
      },
    });
  } catch {
    // Scheduler state is diagnostic; generation should not fail because the status file could not be written.
  }
}

function clearMagazineSchedulerTimer() {
  if (magazineSchedulerRuntime.timer) {
    clearTimeout(magazineSchedulerRuntime.timer);
    magazineSchedulerRuntime.timer = null;
  }
}

function scheduleMagazineTimer(delayOverrideMs = null) {
  clearMagazineSchedulerTimer();
  if (!magazineSchedulerRuntime.started || magazineSchedulerDisabled()) return;

  const now = Date.now();
  const intervalMs = magazineSchedulerIntervalMs();
  const nextRunMs = parseTimestamp(magazineSchedulerRuntime.nextRunAt) || now + intervalMs;
  const retryMs = parseTimestamp(magazineSchedulerRuntime.nextRetryAt);
  let targetMs = nextRunMs;
  if (retryMs > now) targetMs = Math.min(targetMs, retryMs);
  if (retryMs && retryMs <= now) targetMs = now;
  if (nextRunMs && nextRunMs <= now && (!retryMs || retryMs > nextRunMs)) targetMs = now;

  const delayMs = delayOverrideMs === null ? Math.max(0, targetMs - now) : Math.max(0, delayOverrideMs);
  magazineSchedulerRuntime.timer = setTimeout(() => {
    magazineSchedulerRuntime.timer = null;
    void handleMagazineSchedulerTimer();
  }, delayMs);
  magazineSchedulerRuntime.timer.unref?.();
}

function scheduleNextMagazineCycle(delayMs = null) {
  if (!magazineSchedulerRuntime.started || magazineSchedulerDisabled()) {
    clearMagazineSchedulerTimer();
    magazineSchedulerRuntime.nextRunAt = "";
    magazineSchedulerRuntime.nextRetryAt = "";
    magazineSchedulerRuntime.activeCycle = null;
    void writeMagazineSchedulerState();
    return;
  }
  const intervalMs = magazineSchedulerIntervalMs();
  const safeDelayMs = clampInteger(delayMs, 0, MAGAZINE_SCHEDULER_MAX_INTERVAL_MS, intervalMs);
  magazineSchedulerRuntime.nextRunAt = nowIso(new Date(Date.now() + safeDelayMs));
  magazineSchedulerRuntime.nextRetryAt = "";
  magazineSchedulerRuntime.activeCycle = null;
  scheduleMagazineTimer(safeDelayMs);
  void writeMagazineSchedulerState();
}

export async function rescheduleMagazineSchedulerNextRunAt(nextRunAt, options = {}) {
  if (magazineSchedulerDisabled()) {
    const error = new Error("magazine scheduler is disabled");
    error.statusCode = 409;
    throw error;
  }
  if (magazineSchedulerRuntime.running || magazineSchedulerRuntime.currentCycle || magazineSchedulerRuntime.activeCycle) {
    const error = new Error("magazine scheduler cycle is active");
    error.statusCode = 409;
    throw error;
  }

  const normalizedNextRunAt = normalizeMagazineSchedulerNextRunAt(nextRunAt, options);
  if (!magazineSchedulerRuntime.started) {
    magazineSchedulerRuntime.started = true;
    magazineSchedulerRuntime.startedAt = nowIso();
  }
  magazineSchedulerRuntime.nextRunAt = normalizedNextRunAt;
  magazineSchedulerRuntime.nextRetryAt = "";
  magazineSchedulerRuntime.lastError = "";

  scheduleMagazineTimer(Math.max(0, parseTimestamp(normalizedNextRunAt) - Date.now()));
  await writeMagazineSchedulerState({
    manualRescheduledAt: nowIso(),
    manualRescheduledBy: cleanText(options.source || "api"),
  });
  return publicMagazineSchedulerState();
}

export async function requestImmediateMagazineSchedulerRun(options = {}) {
  if (magazineSchedulerDisabled()) {
    const error = new Error("magazine scheduler is disabled");
    error.statusCode = 409;
    throw error;
  }
  if (magazineSchedulerRuntime.running || magazineSchedulerRuntime.currentCycle || magazineSchedulerRuntime.activeCycle) {
    const error = new Error("magazine scheduler cycle is active");
    error.statusCode = 409;
    throw error;
  }
  const generationLock = activeMagazineGenerationLock();
  if (generationLock) {
    const error = new Error(`magazine generation is already running (pid ${generationLock.pid})`);
    error.statusCode = 409;
    throw error;
  }

  const requestedAt = nowIso();
  const topicDiscoveryLane = options.topicDiscoveryLane
    ? normalizeMagazineTopicDiscoveryLane(options.topicDiscoveryLane)
    : null;
  if (!magazineSchedulerRuntime.started) {
    magazineSchedulerRuntime.started = true;
    magazineSchedulerRuntime.startedAt = requestedAt;
  }
  magazineSchedulerRuntime.manualStartRequestedAt = requestedAt;
  magazineSchedulerRuntime.nextRunAt = requestedAt;
  magazineSchedulerRuntime.nextRetryAt = "";
  magazineSchedulerRuntime.lastError = "";
  clearMagazineSchedulerTimer();

  await writeMagazineSchedulerState({
    manualStartRequestedAt: requestedAt,
    manualStartedBy: cleanText(options.source || "api"),
    ...(topicDiscoveryLane ? { manualTopicDiscoveryLane: topicDiscoveryLane } : {}),
  });

  void runScheduledMagazineCycle("manual", { scheduledAt: requestedAt, topicDiscoveryLane }).catch(async (error) => {
    magazineSchedulerRuntime.manualStartRequestedAt = "";
    magazineSchedulerRuntime.lastError = error.message;
    magazineSchedulerRuntime.lastCycle = {
      id: randomUUID(),
      trigger: "manual",
      status: "error",
      startedAt: requestedAt,
      finishedAt: nowIso(),
      targetCount: 0,
      generatedCount: 0,
      canceledCount: 0,
      runs: [],
      ...(topicDiscoveryLane ? { topicDiscoveryLane } : {}),
      error: error.message,
    };
    await writeMagazineSchedulerState();
    scheduleNextMagazineCycle(magazineSchedulerRetryIntervalMs());
  });

  return publicMagazineSchedulerState();
}

function canRetryMagazineCycle(cycle) {
  const deadlineMs = parseTimestamp(cycle?.deadlineAt);
  const retryIntervalMs = magazineSchedulerRetryIntervalMs();
  return Boolean(deadlineMs && Date.now() + retryIntervalMs < deadlineMs);
}

function nextDelayAfterClosedCycle(cycle) {
  const deadlineMs = parseTimestamp(cycle?.deadlineAt);
  const retryIntervalMs = magazineSchedulerRetryIntervalMs();
  if (deadlineMs && Date.now() < deadlineMs) {
    return Math.max(0, deadlineMs - Date.now()) + retryIntervalMs;
  }
  return retryIntervalMs;
}

async function buildMagazineCycle({ trigger, scheduledAt, sourceCycle = null, topicDiscoveryLane = null }) {
  const now = nowIso();
  const baseScheduledAt = sourceCycle?.scheduledAt || scheduledAt || magazineSchedulerRuntime.nextRunAt || now;
  const deadlineAt = sourceCycle?.deadlineAt || addMs(baseScheduledAt, magazineSchedulerIntervalMs());
  const forcedTopicDiscoveryLane = hasMagazineTopicDiscoveryLane(topicDiscoveryLane)
    ? normalizeMagazineTopicDiscoveryLane(topicDiscoveryLane)
    : sourceCycle?.topicDiscoveryLane && !Array.isArray(sourceCycle?.topicDiscoverySlots)
      ? normalizeMagazineTopicDiscoveryLane(sourceCycle.topicDiscoveryLane)
      : null;
  const countPlan = sourceCycle
    ? {
        agent: await readMagazineSchedulerAgent(),
        decision: sourceCycle.articleCountDecision || null,
      }
    : await decideScheduledMagazineArticleCount({
        scheduledAt: baseScheduledAt,
        topicDiscoveryLane: forcedTopicDiscoveryLane,
      });
  const articleCountDecision =
    countPlan.decision ||
    fallbackMagazineArticleCountDecision({
      maxCount: magazineSchedulerMaxPerCycle(),
      provider: countPlan.agent?.provider || "",
      model: countPlan.agent?.model || "",
      reasoning: countPlan.agent?.reasoning || "",
      topicDiscoveryLane: forcedTopicDiscoveryLane,
      error: "retry source cycle did not include an article count decision",
    });
  const targetCount = Number.isFinite(Number(sourceCycle?.targetCount))
    ? Number(sourceCycle.targetCount)
    : articleCountDecision.targetCount;
  const topicDiscoverySlots = sourceCycle
    ? normalizeMagazineTopicDiscoverySlots(
        sourceCycle.topicDiscoverySlots,
        targetCount,
        { topicDiscoveryLane: forcedTopicDiscoveryLane || sourceCycle.topicDiscoveryLane }
      )
    : buildMagazineTopicDiscoverySlots(targetCount, { topicDiscoveryLane: forcedTopicDiscoveryLane });
  return {
    id: sourceCycle?.id || randomUUID(),
    trigger,
    status: "running",
    scheduledAt: baseScheduledAt,
    deadlineAt,
    startedAt: now,
    finishedAt: "",
    attempts: Number(sourceCycle?.attempts || 0) + 1,
    targetCount,
    generatedCount: Number(sourceCycle?.generatedCount || 0),
    canceledCount: Number(sourceCycle?.canceledCount || 0),
    runs: Array.isArray(sourceCycle?.runs) ? [...sourceCycle.runs] : [],
    topicDiscoverySlots,
    ...(forcedTopicDiscoveryLane ? { manualTopicDiscoveryLane: forcedTopicDiscoveryLane } : {}),
    articleCountDecision,
    agent: countPlan.agent,
    error: "",
  };
}

function completedMagazineSlotCount(cycle = {}) {
  return Math.max(0, Number(cycle.generatedCount || 0) + Number(cycle.canceledCount || 0));
}

function fallbackMagazineCandidateAngleForSlot(cycle = {}, index = 0) {
  return Array.isArray(cycle.articleCountDecision?.candidateAngles)
    ? cycle.articleCountDecision.candidateAngles[index] || null
    : null;
}

export async function decideMagazineArticleSlotTopic({ cycle, index, slot } = {}) {
  const topicDiscoveryLane = normalizeMagazineTopicDiscoveryLane(slot?.topicDiscoveryLane);
  const fallbackAngle =
    topicDiscoveryLane.id === "news-feed-primary"
      ? fallbackMagazineCandidateAngleForSlot(cycle, index)
      : null;
  if (fallbackAngle) {
    return {
      agent: cycle?.agent || null,
      decision: {
        policy: "magazine-slot-topic-reuse-v2",
        targetCount: 1,
        confidence: Number(cycle?.articleCountDecision?.confidence) || 0,
        reason: "기사 수 산정 단계에서 선택한 후보 각도를 이 슬롯의 확정 preflight 소재로 재사용했습니다.",
        candidateAngles: [fallbackAngle],
      },
      candidateAngle: fallbackAngle,
      topicDiscoveryLane,
    };
  }
  const result = await decideScheduledMagazineArticleCount({
    scheduledAt: cycle?.scheduledAt || "",
    topicDiscoveryLane,
    maxCountOverride: 1,
  });
  const decision = result.decision;
  const candidateAngle =
    decision?.targetCount > 0 && Array.isArray(decision.candidateAngles) && decision.candidateAngles[0]
      ? decision.candidateAngles[0]
      : topicDiscoveryLane.id === "news-feed-primary"
        ? fallbackAngle
        : null;
  return {
    agent: result.agent,
    decision,
    candidateAngle,
    topicDiscoveryLane,
  };
}

async function runScheduledMagazineCycle(trigger = "timer", options = {}) {
  if (magazineSchedulerDisabled()) {
    magazineSchedulerRuntime.nextRunAt = "";
    magazineSchedulerRuntime.nextRetryAt = "";
    magazineSchedulerRuntime.activeCycle = null;
    magazineSchedulerRuntime.manualStartRequestedAt = "";
    await writeMagazineSchedulerState();
    return null;
  }
  if (magazineSchedulerRuntime.running) {
    magazineSchedulerRuntime.lastCycle = {
      id: randomUUID(),
      trigger,
      status: "skipped",
      reason: "previous-cycle-running",
      startedAt: nowIso(),
      finishedAt: nowIso(),
      targetCount: 0,
      generatedCount: 0,
    };
    magazineSchedulerRuntime.manualStartRequestedAt = "";
    await writeMagazineSchedulerState();
    scheduleMagazineTimer(magazineSchedulerRetryIntervalMs());
    return magazineSchedulerRuntime.lastCycle;
  }

  const generationLock = activeMagazineGenerationLock();
  if (generationLock) {
    const retryIntervalMs = magazineSchedulerRetryIntervalMs();
    const retryAt = addMs(Date.now(), retryIntervalMs);
    const lockAgent = await readMagazineSchedulerAgent();
    const blockedCycle = {
      id: randomUUID(),
      trigger,
      status: "retry_wait",
      reason: "generation-lock-active",
      scheduledAt: options.scheduledAt || magazineSchedulerRuntime.nextRunAt || nowIso(),
      startedAt: nowIso(),
      finishedAt: nowIso(),
      targetCount: 0,
      generatedCount: 0,
      canceledCount: 0,
      runs: [],
      articleCountDecision: null,
      agent: lockAgent,
      error: `magazine generation is already running (pid ${generationLock.pid})`,
      lock: generationLock,
    };
    magazineSchedulerRuntime.lastCycle = blockedCycle;
    magazineSchedulerRuntime.lastError = blockedCycle.error;
    magazineSchedulerRuntime.activeCycle = null;
    magazineSchedulerRuntime.currentCycle = null;
    magazineSchedulerRuntime.manualStartRequestedAt = "";
    magazineSchedulerRuntime.nextRunAt = retryAt;
    magazineSchedulerRuntime.nextRetryAt = "";
    await writeMagazineSchedulerState();
    scheduleMagazineTimer(retryIntervalMs);
    return blockedCycle;
  }

  clearMagazineSchedulerTimer();
  const cycle = await buildMagazineCycle({
    trigger,
    scheduledAt: options.scheduledAt,
    sourceCycle: options.sourceCycle,
    topicDiscoveryLane: options.topicDiscoveryLane,
  });
  const deadlineMs = parseTimestamp(cycle.deadlineAt);
  magazineSchedulerRuntime.running = true;
  magazineSchedulerRuntime.currentCycle = cycle;
  magazineSchedulerRuntime.activeCycle = cycle;
  magazineSchedulerRuntime.manualStartRequestedAt = "";
  magazineSchedulerRuntime.lastError = "";
  magazineSchedulerRuntime.nextRunAt = cycle.deadlineAt;
  magazineSchedulerRuntime.nextRetryAt = "";
  await writeMagazineSchedulerState();

  try {
    for (let index = completedMagazineSlotCount(cycle); index < cycle.targetCount; index += 1) {
      if (deadlineMs && Date.now() >= deadlineMs) {
        cycle.status = "partial_timeout";
        cycle.error = "scheduled cycle deadline reached before starting remaining articles";
        cycle.canceledCount = cycle.targetCount - cycle.generatedCount;
        break;
      }
      if (!Array.isArray(cycle.topicDiscoverySlots)) cycle.topicDiscoverySlots = [];
      if (!cycle.topicDiscoverySlots[index]) {
        cycle.topicDiscoverySlots[index] = buildMagazineTopicDiscoverySlots(1)[0];
        cycle.topicDiscoverySlots[index].index = index + 1;
      }
      const slot = cycle.topicDiscoverySlots[index];
      slot.index = index + 1;
      slot.status = "selecting";
      slot.startedAt = slot.startedAt || nowIso();
      await writeMagazineSchedulerState();

      const slotTopic = await decideMagazineArticleSlotTopic({ cycle, index, slot });
      slot.topicDiscoveryLane = slotTopic.topicDiscoveryLane;
      slot.topicDecision = slotTopic.decision;
      slot.candidateAngle = slotTopic.candidateAngle || null;
      if (!slot.candidateAngle && slot.topicDiscoveryLane.id === "world-memory-scout") {
        slot.status = "canceled";
        slot.finishedAt = nowIso();
        slot.skipReason = "no independent under-radar topic selected for this slot";
        cycle.canceledCount += 1;
        await writeMagazineSchedulerState();
        continue;
      }
      slot.status = "selected";
      await writeMagazineSchedulerState();

      const result = await runMagazineGenerator({
        count: 1,
        replace: false,
        provider: cycle.agent?.provider,
        model: cycle.agent?.model,
        reasoning: cycle.agent?.reasoning,
        approval: schedulerGenerationApproval(cycle.agent),
        speed: cycle.agent?.speed,
        prompt: [
          `자동 매거진 생성 주기 ${cycle.id}의 ${index + 1}/${cycle.targetCount}번째 기사다.`,
          "이번 자동 주기에서는 기존 기사를 절대 교체하지 말고 새 기사 1개만 추가한다.",
          "직전 자동 생성 기사와 storyFamily, editorialAngle, 제목 구도가 겹치지 않게 한다.",
          cycle.articleCountDecision?.reason
            ? `이번 주기 기사 수 산정 근거: ${cycle.articleCountDecision.reason}`
            : "",
          slot.candidateAngle
            ? `이번 기사 후보 각도: ${slot.candidateAngle.title} / ${slot.candidateAngle.reason}`
            : "",
        ].join("\n"),
        lockedTopic: slot.candidateAngle,
      });
      cycle.generatedCount += 1;
      slot.status = "generated";
      slot.finishedAt = nowIso();
      cycle.runs.push({
        index: index + 1,
        topicDiscoveryLane: slot.topicDiscoveryLane,
        candidateAngle: slot.candidateAngle,
        provider: result.provider,
        model: result.model,
        reasoning: result.reasoning,
        elapsedMs: result.elapsedMs,
        finishedAt: nowIso(),
      });
      await writeMagazineSchedulerState();
      if (deadlineMs && Date.now() >= deadlineMs && completedMagazineSlotCount(cycle) < cycle.targetCount) {
        cycle.status = "partial_timeout";
        cycle.error = "scheduled cycle deadline reached after the current article finished";
        cycle.canceledCount = cycle.targetCount - cycle.generatedCount;
        break;
      }
    }
    if (cycle.status === "running") {
      cycle.status = "complete";
    }
  } catch (error) {
    const canRetry = canRetryMagazineCycle(cycle);
    cycle.status = canRetry ? "retry_wait" : "error";
    cycle.error = error.message;
    magazineSchedulerRuntime.lastError = error.message;
  } finally {
    cycle.finishedAt = nowIso();
    magazineSchedulerRuntime.running = false;
    magazineSchedulerRuntime.currentCycle = null;
    magazineSchedulerRuntime.manualStartRequestedAt = "";
  }

  magazineSchedulerRuntime.lastCycle = cycle;

  if (cycle.status === "retry_wait") {
    magazineSchedulerRuntime.activeCycle = cycle;
    magazineSchedulerRuntime.nextRetryAt = addMs(Date.now(), magazineSchedulerRetryIntervalMs());
    magazineSchedulerRuntime.nextRunAt = cycle.deadlineAt;
    await writeMagazineSchedulerState();
    scheduleMagazineTimer();
    return cycle;
  }

  magazineSchedulerRuntime.activeCycle = null;
  magazineSchedulerRuntime.nextRetryAt = "";
  await writeMagazineSchedulerState();

  if (cycle.status === "complete") {
    const nextRunMs = parseTimestamp(cycle.deadlineAt);
    const delayMs = nextRunMs ? Math.max(0, nextRunMs - Date.now()) : magazineSchedulerIntervalMs();
    scheduleNextMagazineCycle(delayMs);
  } else {
    scheduleNextMagazineCycle(nextDelayAfterClosedCycle(cycle));
  }

  return cycle;
}

async function handleMagazineSchedulerTimer() {
  if (magazineSchedulerDisabled()) {
    stopMagazineScheduler();
    return;
  }
  if (magazineSchedulerRuntime.running) {
    scheduleMagazineTimer(magazineSchedulerRetryIntervalMs());
    return;
  }

  const now = Date.now();
  const activeCycle = magazineSchedulerRuntime.activeCycle;
  const retryMs = parseTimestamp(magazineSchedulerRuntime.nextRetryAt);
  if (activeCycle && retryMs && now >= retryMs) {
    const deadlineMs = parseTimestamp(activeCycle.deadlineAt);
    if (deadlineMs && now >= deadlineMs) {
      const failedCycle = {
        ...activeCycle,
        status: "expired",
        finishedAt: nowIso(),
        error: "retry window expired before the next magazine update slot",
        canceledCount: Math.max(0, Number(activeCycle.targetCount || 0) - Number(activeCycle.generatedCount || 0)),
      };
      magazineSchedulerRuntime.activeCycle = null;
      magazineSchedulerRuntime.nextRetryAt = "";
      magazineSchedulerRuntime.lastCycle = failedCycle;
      await writeMagazineSchedulerState();
      scheduleNextMagazineCycle(magazineSchedulerRetryIntervalMs());
      return;
    }
    void runScheduledMagazineCycle("retry", { sourceCycle: activeCycle });
    return;
  }

  const nextRunMs = parseTimestamp(magazineSchedulerRuntime.nextRunAt);
  if (nextRunMs && now >= nextRunMs) {
    void runScheduledMagazineCycle("timer", { scheduledAt: magazineSchedulerRuntime.nextRunAt });
    return;
  }

  scheduleMagazineTimer();
}

export function startMagazineScheduler() {
  if (magazineSchedulerDisabled()) return;
  if (magazineSchedulerRuntime.started) {
    if (!magazineSchedulerRuntime.timer && !magazineSchedulerRuntime.running) {
      if (magazineSchedulerRuntime.nextRunAt || magazineSchedulerRuntime.nextRetryAt) {
        scheduleMagazineTimer();
      } else {
        scheduleNextMagazineCycle(magazineSchedulerInitialDelayMs(magazineSchedulerIntervalMs()));
      }
    }
    return;
  }
  magazineSchedulerRuntime.started = true;
  magazineSchedulerRuntime.startedAt = nowIso();
  const intervalMs = magazineSchedulerIntervalMs();
  scheduleNextMagazineCycle(magazineSchedulerInitialDelayMs(intervalMs));
}

export function stopMagazineScheduler() {
  clearMagazineSchedulerTimer();
  magazineSchedulerRuntime.started = false;
  magazineSchedulerRuntime.running = false;
  magazineSchedulerRuntime.nextRunAt = "";
  magazineSchedulerRuntime.nextRetryAt = "";
  magazineSchedulerRuntime.currentCycle = null;
  magazineSchedulerRuntime.activeCycle = null;
  void writeMagazineSchedulerState();
}

function applyMagazineSchedulerSettingsChange(previousSettings, nextSettings) {
  if (!nextSettings.enabled) {
    stopMagazineScheduler();
    return;
  }

  if (!magazineSchedulerRuntime.started) {
    startMagazineScheduler();
    return;
  }

  const intervalChanged =
    Number(previousSettings?.schedulerIntervalHours || 0) !== Number(nextSettings.schedulerIntervalHours || 0);
  const maxArticlesChanged =
    Number(previousSettings?.schedulerMaxArticlesPerCycle || 0) !==
    Number(nextSettings.schedulerMaxArticlesPerCycle || 0);
  if (!intervalChanged && !maxArticlesChanged) return;

  if (!magazineSchedulerHasActiveWork()) {
    if (intervalChanged) {
      scheduleNextMagazineCycle(magazineSchedulerIntervalMs());
      return;
    }
    void writeMagazineSchedulerState({
      settingsChangedAt: nowIso(),
      pendingMaxArticlesPerCycle: nextSettings.schedulerMaxArticlesPerCycle,
    });
    return;
  }

  void writeMagazineSchedulerState({
    settingsChangedAt: nowIso(),
    ...(intervalChanged ? { pendingIntervalHours: nextSettings.schedulerIntervalHours } : {}),
    ...(maxArticlesChanged ? { pendingMaxArticlesPerCycle: nextSettings.schedulerMaxArticlesPerCycle } : {}),
  });
}

async function magazineStatusSnapshot() {
  const articles = await listMagazineArticleStatusRecords();
  const readState = magazineReadStateSnapshot(articles, await readMagazineReadState());
  return {
    ok: true,
    storage: "files",
    articleCount: articles.length,
    latestArticle: readState.latestArticleId
      ? {
          id: readState.latestArticleId,
          title: readState.latestArticleTitle,
          publishedAt: readState.latestArticleAt,
        }
      : null,
    readState,
    settings: publicMagazineSettingsSnapshot(),
    scheduler: publicMagazineSchedulerState(),
  };
}

async function markMagazineOpened() {
  await writeMagazineReadState({
    ...(await readMagazineReadState()),
    lastOpenedAt: nowIso(),
  });
  return magazineStatusSnapshot();
}

function parseAssetRequestUrl(urlValue) {
  const url = new URL(urlValue || "/", "http://localhost");
  const pathname = decodeURIComponent(url.pathname);
  const assetPrefix = "/api/magazine/assets/";
  const assetPath = pathname.startsWith(assetPrefix)
    ? pathname.slice(assetPrefix.length)
    : pathname.replace(/^\/+/, "");
  const parts = assetPath.split("/").filter(Boolean);
  if (parts.length < 2) {
    throw new Error("missing magazine asset path");
  }
  const articleId = normalizeArticleId(parts[0]);
  const fileParts = parts.slice(1);
  if (fileParts.some((part) => part === "." || part === ".." || part.includes("\0"))) {
    throw new Error("invalid magazine asset path");
  }
  const articleDir = articleDirForId(articleId);
  const assetsDir = join(articleDir, "assets");
  const assetFile = ensureInsideRoot(assetsDir, resolve(assetsDir, ...fileParts));
  return assetFile;
}

async function serveMagazineAsset(req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    sendJson(res, { ok: false, error: "method not allowed" }, 405);
    return;
  }
  try {
    const assetFile = parseAssetRequestUrl(req.url);
    const assetExtension = extname(assetFile).toLowerCase();
    if (blockedMagazineAssetExtensions.has(assetExtension)) {
      sendJson(res, { ok: false, error: "vector mock assets are not supported for magazine production images" }, 415);
      return;
    }
    const fileStat = await stat(assetFile);
    if (!fileStat.isFile()) {
      sendJson(res, { ok: false, error: "asset not found" }, 404);
      return;
    }
    res.statusCode = 200;
    res.setHeader("Content-Type", mimeTypes[assetExtension] || "application/octet-stream");
    res.setHeader("Content-Length", String(fileStat.size));
    res.setHeader("Cache-Control", "no-store");
    if (req.method === "HEAD") {
      res.end();
      return;
    }
    createReadStream(assetFile).pipe(res);
  } catch (error) {
    sendJson(res, { ok: false, error: error.message }, error.message.includes("not found") ? 404 : 400);
  }
}

async function handleArticleCollection(req, res) {
  if (req.method === "POST") {
    try {
      const body = await readJsonBody(req);
      const action = cleanText(body.action || "");
      if (action !== "generateWithCodex" && action !== "generateWithAntigravity") {
        sendJson(res, { ok: false, error: "unknown magazine article action" }, 400);
        return;
      }
      const agent = await readMagazineSchedulerAgent();
      const explicitProvider = cleanText(body.provider || "");
      const effectiveAction = explicitProvider
        ? action
        : agent.provider === MAGAZINE_ANTIGRAVITY_PROVIDER_ID
          ? "generateWithAntigravity"
          : "generateWithCodex";
      const generation = await runMagazineGenerator(
        {
          ...body,
          provider: explicitProvider || agent.provider,
          model: cleanText(body.model || "") || agent.model,
          reasoning: cleanText(body.reasoning || "") || agent.reasoning,
          approval: cleanText(body.approval || "") || schedulerGenerationApproval(agent),
          speed: cleanText(body.speed || "") || agent.speed,
        },
        effectiveAction
      );
      const catalog = await listMagazineArticles();
      sendJson(res, {
        ok: true,
        action: effectiveAction,
        requestedAction: action,
        generation,
        storage: "files",
        ...catalog,
      });
    } catch (error) {
      sendJson(res, { ok: false, error: error.message }, 500);
    }
    return;
  }

  if (req.method === "DELETE") {
    try {
      const url = new URL(req.url || "/api/magazine/articles", "http://localhost");
      const articleId = String(url.searchParams.get("id") || "").trim();
      if (!articleId) {
        sendJson(res, { ok: false, error: "missing article id" }, 400);
        return;
      }
      const result = await deleteMagazineArticle(articleId);
      if (!result.deleted) {
        sendJson(res, { ok: false, error: "article not found" }, 404);
        return;
      }
      const catalog = await listMagazineArticles();
      sendJson(res, {
        ok: true,
        deleted: true,
        deletedArticleId: result.articleId,
        deletedCount: result.deletedCount,
        indexDeletedCount: result.indexDeletedCount,
        indexDeletion: result.indexDeletion,
        ...catalog,
      });
    } catch (error) {
      sendJson(res, { ok: false, error: error.message }, error.message.includes("not found") ? 404 : 400);
    }
    return;
  }

  if (req.method !== "GET") {
    sendJson(res, { ok: false, error: "method not allowed" }, 405);
    return;
  }

  try {
    const catalog = await listMagazineArticles();
    sendJson(res, {
      ok: true,
      storage: "files",
      ...catalog,
    });
  } catch (error) {
    sendJson(res, { ok: false, error: error.message }, 500);
  }
}

async function handleMagazineStatus(req, res) {
  if (req.method === "GET") {
    try {
      sendJson(res, await magazineStatusSnapshot());
    } catch (error) {
      sendJson(res, { ok: false, error: error.message }, 500);
    }
    return;
  }

  if (req.method === "POST" || req.method === "PATCH") {
    try {
      const body = await readJsonBody(req);
      const action = cleanText(body.action || "reschedule");
      if (action === "runNow" || action === "generateNow") {
        await requestImmediateMagazineSchedulerRun({
          source: "api",
          topicDiscoveryLane: body.topicDiscoveryLane || body.discoveryLane || "",
        });
        sendJson(res, {
          ...(await magazineStatusSnapshot()),
          action: "runNow",
        });
        return;
      }
      if (action !== "reschedule") {
        sendJson(res, { ok: false, error: "unknown magazine status action" }, 400);
        return;
      }
      const scheduler = await rescheduleMagazineSchedulerNextRunAt(body.nextRunAt || body.scheduledAt, {
        source: "api",
      });
      sendJson(res, {
        ok: true,
        scheduler,
      });
    } catch (error) {
      sendJson(res, { ok: false, error: error.message }, error.statusCode || 400);
    }
    return;
  }

  if (req.method !== "GET") {
    sendJson(res, { ok: false, error: "method not allowed" }, 405);
    return;
  }
}

async function handleMagazineSettings(req, res) {
  try {
    if (req.method === "GET") {
      sendJson(res, publicMagazineSettingsSnapshot());
      return;
    }

    if (req.method === "PATCH" || req.method === "POST") {
      const body = await readJsonBody(req);
      const previousSettings = readMagazineSettings();
      const settings = writeMagazineSettingsPatch(body);
      applyMagazineSchedulerSettingsChange(previousSettings, settings);
      sendJson(res, publicMagazineSettingsSnapshot());
      return;
    }

    sendJson(res, { ok: false, error: "method not allowed" }, 405);
  } catch (error) {
    sendJson(res, { ok: false, error: error.message }, error.statusCode || 500);
  }
}

async function handleMagazineReadState(req, res) {
  try {
    if (req.method === "GET") {
      sendJson(res, await magazineStatusSnapshot());
      return;
    }

    if (req.method === "POST" || req.method === "PATCH") {
      sendJson(res, await markMagazineOpened());
      return;
    }

    sendJson(res, { ok: false, error: "method not allowed" }, 405);
  } catch (error) {
    sendJson(res, { ok: false, error: error.message }, 500);
  }
}

async function handleEditorialPreferences(req, res) {
  if (req.method === "GET") {
    const store = await readPreferenceStore();
    sendJson(res, publicPreferenceSnapshot(store));
    return;
  }

  if (req.method !== "POST") {
    sendJson(res, { ok: false, error: "method not allowed" }, 405);
    return;
  }

  try {
    const body = await readJsonBody(req);
    const articleId = normalizeArticleId(body.articleId);
    const article = await readArticle(articleId);
    const options = Array.isArray(article.followupOptions) ? article.followupOptions : [];
    const optionId = normalizePreferenceId(body.optionId);
    const selectedOption = options.find((option) => option.id === optionId);
    if (!selectedOption) {
      sendJson(res, { ok: false, error: "unknown preference option" }, 400);
      return;
    }

    const selectedAt = new Date().toISOString();
    const store = await readPreferenceStore();
    const activeIds = activePreferenceIdsForArticle(store.events, articleId);
    const action = activeIds.has(optionId) ? "deselect" : "select";
    const nextEvent = normalizePreferenceEvent({
      id: `${selectedAt}-${articleId}-${optionId}`,
      action,
      articleId,
      articleTitle: article.title,
      articleType: article.articleType,
      optionId,
      label: selectedOption.label,
      prompt: selectedOption.prompt,
      topics: selectedOption.topics,
      selectedAt,
      baseWeight: 1,
      worldMemoryWeight: worldMemoryWeightForArticle(article),
      worldMemoryAnchors: worldMemoryAnchorsForArticle(article),
      decayWindowsDays: PREFERENCE_DECAY_WINDOWS_DAYS,
    });
    const nextStore = normalizePreferenceStore({
      ...store,
      updatedAt: selectedAt,
      events: [...store.events, nextEvent].filter(Boolean).slice(-MAX_PREFERENCE_EVENTS),
    });
    await writeJsonAtomic(MAGAZINE_PREFERENCES_PATH, nextStore);
    sendJson(res, {
      action,
      message: action === "deselect" ? "선택이 해제되었습니다" : "앞으로의 기사 편집에 반영하도록 하겠습니다",
      selected: nextEvent,
      ...publicPreferenceSnapshot(nextStore),
    });
  } catch (error) {
    sendJson(res, { ok: false, error: error.message }, 400);
  }
}

async function handleMagazineComments(req, res) {
  if (req.method === "GET") {
    try {
      const url = new URL(req.url || "/api/magazine/comments", "http://localhost");
      const articleId = normalizeArticleId(url.searchParams.get("articleId") || url.searchParams.get("id") || "");
      await readArticle(articleId);
      const store = await readCommentStore(articleId);
      sendJson(res, publicCommentSnapshot(store));
    } catch (error) {
      sendJson(res, { ok: false, error: error.message }, 400);
    }
    return;
  }

  if (req.method !== "POST") {
    sendJson(res, { ok: false, error: "method not allowed" }, 405);
    return;
  }

  try {
    const body = await readJsonBody(req);
    const articleId = normalizeArticleId(body.articleId);
    const commentText = normalizeCommentText(body.text || body.comment || "");
    if (!commentText) {
      sendJson(res, { ok: false, error: "comment text is required" }, 400);
      return;
    }

    const article = await readArticle(articleId);
    const createdAt = new Date().toISOString();
    const comment = normalizeCommentRecord({
      id: cleanText(body.commentId || randomUUID()),
      author: "사용자",
      text: commentText,
      createdAt,
    });
    const initialStore = await readCommentStore(articleId);
    await writeCommentStore(articleId, {
      ...initialStore,
      updatedAt: createdAt,
      comments: upsertComment(initialStore.comments, comment),
    });

    let reply;
    let biasEvents = [];
    try {
      const result = await runCodexChat({
        provider: cleanText(body.provider || ""),
        model: cleanText(body.model || ""),
        reasoning: cleanText(body.reasoning || "high"),
        speed: cleanText(body.speed || "standard"),
        approval: "never",
        personaMode: "none",
        prompt: buildMagazineCommentPrompt({
          article,
          comments: initialStore.comments,
          commentText,
        }),
        messages: [],
        screen: "magazine",
        includeSharedMemory: true,
        includeWorldMemorySearchContext: true,
        forceWorldMemoryVectorSearch: true,
        worldMemoryVectorSearchQuery: [article.title, article.summary, commentText].filter(Boolean).join("\n"),
        worldMemoryFocusContext: {
          source: "magazine-comment",
          articleId: article.id,
          articleTitle: article.title,
          topics: article.topics,
        },
        includeNewsFeedSearchContext: true,
        requireWebSearch: true,
      });
      const action = parseMagazineCommentAction(result.answer || "");
      const visibleAnswer = stripMagazineCommentActionBlocks(result.answer || "") ||
        "알겠습니다. 이 의견은 앞으로의 기사 편집 방향을 잡을 때 함께 보겠습니다.";
      reply = normalizeCommentReplyRecord({
        id: randomUUID(),
        author: "매거진 편집자 AI",
        text: visibleAnswer,
        createdAt: new Date().toISOString(),
        status: "complete",
        provider: cleanText(body.provider || "codex-cli"),
        model: result.model || "",
        reasoning: result.reasoning || "",
      });
      const commentWithReply = { ...comment, reply };
      const rawBiasEvents = action.biasEvents.length
        ? action.biasEvents
        : await classifyMagazineCommentBias({
            body,
            article,
            comments: initialStore.comments,
            commentText,
            replyText: visibleAnswer,
          });
      biasEvents = await appendBiasEventsFromComment({
        article,
        comment: commentWithReply,
        rawBiasEvents,
      });
      reply = {
        ...reply,
        biasEventIds: biasEvents.map((event) => event.id),
      };
    } catch (error) {
      reply = normalizeCommentReplyRecord({
        id: randomUUID(),
        author: "매거진 편집자 AI",
        text: `답변 생성에 실패했습니다. 댓글은 저장해 두었습니다. (${error.message})`,
        createdAt: new Date().toISOString(),
        status: "error",
        provider: cleanText(body.provider || "codex-cli"),
      });
    }

    const finalComment = normalizeCommentRecord({
      ...comment,
      reply,
    });
    const latestStore = await readCommentStore(articleId);
    const finalStore = await writeCommentStore(articleId, {
      ...latestStore,
      updatedAt: reply.createdAt,
      comments: upsertComment(latestStore.comments, finalComment),
    });
    sendJson(res, publicCommentSnapshot(finalStore, {
      comment: finalComment,
      biasEvents,
      bias: publicBiasSnapshot(await readBiasStore()),
    }));
  } catch (error) {
    sendJson(res, { ok: false, error: error.message }, 400);
  }
}

async function handleEditorialBias(req, res) {
  if (req.method !== "GET") {
    sendJson(res, { ok: false, error: "method not allowed" }, 405);
    return;
  }
  const store = await readBiasStore();
  sendJson(res, publicBiasSnapshot(store));
}

export async function handleMagazineEndpoint(kind, req, res) {
  if (kind === "settings") {
    await handleMagazineSettings(req, res);
    return;
  }
  if (kind === "status") {
    await handleMagazineStatus(req, res);
    return;
  }
  if (kind === "read-state") {
    await handleMagazineReadState(req, res);
    return;
  }
  if (kind === "articles") {
    await handleArticleCollection(req, res);
    return;
  }
  if (kind === "comments") {
    await handleMagazineComments(req, res);
    return;
  }
  if (kind === "preferences") {
    await handleEditorialPreferences(req, res);
    return;
  }
  if (kind === "bias") {
    await handleEditorialBias(req, res);
    return;
  }
  if (kind === "assets") {
    await serveMagazineAsset(req, res);
    return;
  }
  sendJson(res, { ok: false, error: "unknown magazine endpoint" }, 404);
}
