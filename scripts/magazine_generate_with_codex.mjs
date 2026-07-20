#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { codexServiceTierArgs, normalizeCodexSpeed } from "../web/server/agentSpeed.mjs";
import { antigravityPrintInvocation } from "../web/server/antigravityCliCompatibility.mjs";
import { spawnObservedLlm, waitForLlmObservation } from "../web/server/llmProcessObserver.mjs";

const SCRIPT_DIR = resolve(fileURLToPath(new URL(".", import.meta.url)));
const GUIBUILD_ROOT = resolve(SCRIPT_DIR, "..");
const ARTICLES_DIR = join(GUIBUILD_ROOT, "data", "magazine", "articles");
const MAGAZINE_DATA_DIR = join(GUIBUILD_ROOT, "data", "magazine");
const NEWS_FEED_STORE_PATH = join(GUIBUILD_ROOT, "data", "news-feed.json");
const WORLD_MEMORY_STATE_PATH = join(GUIBUILD_ROOT, "data", "world-memory", "collector-state.json");
const LOCK_PATH = join(GUIBUILD_ROOT, "data", "magazine", ".generation.lock");
const CODEX_PROVIDER_ID = "codex-cli";
const ANTIGRAVITY_PROVIDER_ID = "antigravity-cli";
const MAX_ARTICLE_TOPICS = 3;
const MAGAZINE_RESEARCH_MODES = new Set([
  "external-research",
  "external-first",
  "mixed-research",
  "news-feed-first",
  "news-feed-with-world-memory-backup",
]);
const READER_TONE_POLICY = "magazine-reader-tone-v1";
const READER_TONE_METHOD = "LLM_CLASSIFICATION_ONLY";
const QUOTE_FLOW_POLICY = "magazine-quote-flow-v1";
const QUOTE_FLOW_METHOD = "LLM_CLASSIFICATION_ONLY";
const LEGACY_HARNESS_PROFILE = "legacy";
const DEFAULT_HARNESS_PROFILE = "v2";
const EDITORIAL_REVIEW_POLICY = "magazine-editorial-review-v2";
const EDITORIAL_EXEMPLAR_CONFIG_PATH = join(GUIBUILD_ROOT, "config", "magazine-editorial-exemplars.json");

function argValue(name, fallback = "") {
  const index = process.argv.indexOf(name);
  if (index < 0) return fallback;
  return process.argv[index + 1] || fallback;
}

function hasArg(name) {
  return process.argv.includes(name);
}

function cleanCliValue(value, fallback, pattern = /^[A-Za-z0-9._:-]+$/) {
  const text = String(value || "").trim();
  return pattern.test(text) ? text : fallback;
}

function normalizeHarnessProfile(value) {
  return String(value || "").trim().toLowerCase() === LEGACY_HARNESS_PROFILE
    ? LEGACY_HARNESS_PROFILE
    : DEFAULT_HARNESS_PROFILE;
}

function cleanAntigravityModel(value, fallback = "Gemini 3.5 Flash (Medium)") {
  const text = String(value || "").trim();
  return /^[\w .:/()+-]+$/.test(text) ? text : fallback;
}

function findCodexCommand() {
  return process.env.CODEX_CLI_PATH || "codex";
}

function findAntigravityCommand() {
  return process.env.ANTIGRAVITY_CLI_PATH || "agy";
}

function findPythonCommand() {
  const localPython =
    process.platform === "win32"
      ? join(GUIBUILD_ROOT, ".venv", "Scripts", "python.exe")
      : join(GUIBUILD_ROOT, ".venv", "bin", "python");
  const candidates =
    process.platform === "win32"
      ? [
          { command: localPython, argsPrefix: [] },
          { command: "py", argsPrefix: ["-3"] },
          { command: "python", argsPrefix: [] },
          { command: "python3", argsPrefix: [] },
        ]
      : [
          { command: localPython, argsPrefix: [] },
          { command: "python3", argsPrefix: [] },
          { command: "python", argsPrefix: [] },
        ];
  for (const candidate of candidates) {
    if (candidate.command.includes(".venv") && !existsSync(candidate.command)) continue;
    return candidate;
  }
  return null;
}

function isAntigravityProvider(provider) {
  return provider === ANTIGRAVITY_PROVIDER_ID;
}

function agentLabelForProvider(provider) {
  return isAntigravityProvider(provider) ? "Antigravity CLI" : "Codex CLI";
}

function parseTimestamp(value) {
  const timestamp = Date.parse(String(value || ""));
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function nowKstIso(date = new Date()) {
  const kst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  return `${kst.toISOString().slice(0, 19)}+09:00`;
}

function readJsonFile(path) {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

export function approvedEditorialExemplars() {
  const config = readJsonFile(EDITORIAL_EXEMPLAR_CONFIG_PATH) || {};
  if (config.enabled === false) return [];
  const configuredRoot = String(config.root || "data/magazine/editorial-exemplars").trim();
  const root = resolve(GUIBUILD_ROOT, configuredRoot);
  if (!root.startsWith(`${GUIBUILD_ROOT}/`) || !existsSync(root)) return [];
  const maxExemplars = Math.max(0, Math.min(6, Number.parseInt(config.maxExemplars, 10) || 3));
  const maxArticleChars = Math.max(2000, Math.min(30000, Number.parseInt(config.maxArticleChars, 10) || 18000));
  const maxEditorialMapChars = Math.max(1000, Math.min(12000, Number.parseInt(config.maxEditorialMapChars, 10) || 6000));
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const exemplarDir = join(root, entry.name);
      const metadata = readJsonFile(join(exemplarDir, "metadata.json"));
      const editorialMap = readJsonFile(join(exemplarDir, "editorial-map.json"));
      const articlePath = join(exemplarDir, "article.md");
      if (!metadata?.approved || !editorialMap || !existsSync(articlePath)) return null;
      const article = readFileSync(articlePath, "utf8").trim();
      if (!article) return null;
      return {
        id: entry.name,
        title: String(metadata.title || entry.name).trim(),
        article: article.slice(0, maxArticleChars),
        editorialMap: JSON.stringify(editorialMap, null, 2).slice(0, maxEditorialMapChars),
      };
    })
    .filter(Boolean)
    .slice(0, maxExemplars);
}

function editorialExemplarWriterPrompt() {
  const exemplars = approvedEditorialExemplars();
  if (!exemplars.length) return "- 승인된 로컬 한국어 퓨샷이 없다. 장문 편집 표준만 따른다.";
  return [
    "아래 글은 FinanceAgentGUI 안에서 독립적으로 작성·승인한 한국어 편집 퓨샷이다.",
    "새 기사에 이전할 것은 논증의 이동, 근거의 기능 분담, 문단 리듬, 반론 처리, 결말의 변형 방식뿐이다.",
    "퓨샷의 문구, 비유, 제목 구문, 고유명사, 사실, 출처, 주제를 복제하거나 새 기사의 근거로 사용하지 않는다.",
    "새 기사와 퓨샷의 문장·섹션 순서를 대응시키지 말고, 현재 소재가 요구하는 독자적인 구조를 만든다.",
    ...exemplars.flatMap((exemplar, index) => [
      "",
      `=== 승인 퓨샷 ${index + 1}: ${exemplar.id} / ${exemplar.title} ===`,
      "[편집 지도]",
      exemplar.editorialMap,
      "[한국어 기사 본문]",
      exemplar.article,
    ]),
  ].join("\n");
}

function editorialExemplarReviewPrompt() {
  const exemplars = approvedEditorialExemplars();
  if (!exemplars.length) return "승인된 로컬 한국어 퓨샷 편집 지도가 없다.";
  return [
    "아래 편집 지도는 문구 유사도를 채점하기 위한 것이 아니다. 새 기사가 그와 동등한 수준의 장거리 논증을 독자적인 구조로 수행하는지만 비교한다.",
    ...exemplars.map((exemplar, index) => `\n[승인 퓨샷 편집 지도 ${index + 1}: ${exemplar.title}]\n${exemplar.editorialMap}`),
  ].join("\n");
}

function articleUploadTimestamp(articleDir, metadata = {}) {
  const explicitUpload = parseTimestamp(metadata.uploadedAt || metadata.generatedAt || metadata.importedAt);
  if (explicitUpload) return explicitUpload;
  try {
    const stats = statSync(articleDir);
    const candidates = [stats.birthtimeMs, stats.mtimeMs, parseTimestamp(metadata.updatedAt), parseTimestamp(metadata.createdAt), parseTimestamp(metadata.publishedAt)];
    const timestamp = candidates.find((value) => Number.isFinite(value) && value > 0);
    return timestamp || 0;
  } catch {
    return parseTimestamp(metadata.updatedAt) || parseTimestamp(metadata.createdAt) || parseTimestamp(metadata.publishedAt) || 0;
  }
}

function worldMemoryLastSuccessfulAt() {
  const state = readJsonFile(WORLD_MEMORY_STATE_PATH);
  const timestamp = parseTimestamp(state?.collector?.lastSuccessfulAt);
  if (timestamp) return { iso: new Date(timestamp).toISOString(), timestamp };
  return { iso: "", timestamp: 0 };
}

function newsFeedItemTimestamp(item = {}) {
  for (const field of ["publishedAt", "fetchedAt", "translatedAt"]) {
    const timestamp = parseTimestamp(item[field]);
    if (timestamp) return { field, timestamp, iso: new Date(timestamp).toISOString() };
  }
  return { field: "", timestamp: 0, iso: "" };
}

function compactPromptText(value, limit = 180) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > limit ? `${text.slice(0, limit - 1)}...` : text;
}

function postWorldMemoryNewsFeedSummary({ limit = 0 } = {}) {
  const cutoff = worldMemoryLastSuccessfulAt();
  if (!cutoff.timestamp) {
    return [
      "- 기준 업데이트 시각을 찾지 못했다.",
      "- 최근 확인된 보도 후보는 기준 업데이트 이후 항목만 사용할 수 있으므로 이번 생성에서는 기사 소재 후보로 쓰지 않는다.",
    ].join("\n");
  }

  const store = readJsonFile(NEWS_FEED_STORE_PATH);
  const items = Array.isArray(store?.items) ? store.items : [];
  if (!items.length) {
    return [
      `- worldMemoryLastSuccessfulAt=${cutoff.iso}`,
      "- data/news-feed.json에 최근 확인된 보도 항목이 없다.",
    ].join("\n");
  }

  const eligibleCandidates = items
    .map((item) => ({ item, itemTime: newsFeedItemTimestamp(item) }))
    .filter(({ itemTime }) => itemTime.timestamp > cutoff.timestamp)
    .sort((a, b) => b.itemTime.timestamp - a.itemTime.timestamp || String(a.item.id || "").localeCompare(String(b.item.id || "")));

  if (!eligibleCandidates.length) {
    return [
      `- worldMemoryLastSuccessfulAt=${cutoff.iso}`,
      `- 확인된 보도 ${items.length}개 중 기준 업데이트 이후 항목이 없다.`,
      "- 이 경우 로컬 보도 데이터를 기사 소재 후보로 쓰지 말고 World Memory와 외부 리서치로 소재를 고른다.",
    ].join("\n");
  }

  const candidates = limit > 0 ? eligibleCandidates.slice(0, limit) : eligibleCandidates;

  return [
    `- policy=post-world-memory-update-only / worldMemoryLastSuccessfulAt=${cutoff.iso} / availableAfterCutoff=${eligibleCandidates.length} / included=${candidates.length}`,
    limit > 0
      ? `- 아래 목록은 기준 업데이트 이후 보도 중 최신 ${candidates.length}개 후보이며, 더 오래된 후보가 필요하면 data/news-feed.json에서 직접 확인한다.`
      : "- 아래 목록은 기준 업데이트 이후 확인된 전체 보도 후보다.",
    ...candidates.map(({ item, itemTime }) => {
      const title = compactPromptText(item.translatedTitle || item.translatedText || item.title || item.originalText, 220);
      const original = compactPromptText(item.originalText && item.originalText !== title ? item.originalText : "", 160);
      return [
        `- ${item.id || item.sourceFingerprint || "collected-news-item"}`,
        `time=${itemTime.iso}`,
        `timeField=${itemTime.field}`,
        `source=${item.feedTitle || item.feedId || ""}`,
        `title=${title}`,
        original ? `original=${original}` : "",
      ]
        .filter(Boolean)
        .join(" / ");
    }),
  ].join("\n");
}

function worldMemoryCurrentSignalSummary(limit = 8) {
  const python = findPythonCommand();
  if (!python) return "- python runtime not found; current market context unavailable.";
  const result = spawnSync(
    python.command,
    [
      ...python.argsPrefix,
      "scripts/world_memory_cli.py",
      "--base-dir",
      "data/world-memory",
      "list",
      "--limit",
      String(limit),
      "--entry-mode",
      "brief",
      "--format",
      "md",
    ],
    {
      cwd: GUIBUILD_ROOT,
      encoding: "utf8",
      timeout: 20000,
      maxBuffer: 2 * 1024 * 1024,
    },
  );
  const output = (result.stdout || result.stderr || "").trim();
  if (result.status !== 0 || !output || output === "(no rows)") {
    return output ? `- current market context read failed: ${compactPromptText(output, 800)}` : "- current market context unavailable.";
  }
  return output;
}

function uploadedArticleRecords(articleDirectory = ARTICLES_DIR) {
  if (!existsSync(articleDirectory)) return [];
  const articles = [];
  for (const entry of readdirSync(articleDirectory, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const articleDir = join(articleDirectory, entry.name);
    const metadataPath = join(articleDir, "metadata.json");
    if (!existsSync(metadataPath)) continue;
    try {
      const metadata = JSON.parse(readFileSync(metadataPath, "utf8"));
      articles.push({ articleId: entry.name, metadata, timestamp: articleUploadTimestamp(articleDir, metadata) });
    } catch {
      articles.push({ articleId: entry.name, metadata: {}, timestamp: articleUploadTimestamp(articleDir, {}) });
    }
  }
  return articles.sort((a, b) => b.timestamp - a.timestamp || a.articleId.localeCompare(b.articleId));
}

function cleanIdentityText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function identityList(values = []) {
  return Array.from(new Set(values.map(cleanIdentityText).filter(Boolean)));
}

function metadataNewsFeedIds(metadata = {}) {
  const items = Array.isArray(metadata.newsFeed?.items) ? metadata.newsFeed.items : [];
  return identityList(items.map((item) => item?.id || item?.sourceFingerprint));
}

function metadataWorldMemoryEventIds(metadata = {}) {
  const hits = Array.isArray(metadata.worldMemory?.vectorSearch?.hits) ? metadata.worldMemory.vectorSearch.hits : [];
  return identityList(
    hits.map((hit) => {
      if (hit && typeof hit === "object") return hit.eventId || hit.event_id || hit.id || "";
      return "";
    }),
  );
}

function articleCountIn(articleDirectory = ARTICLES_DIR) {
  return uploadedArticleRecords(articleDirectory).length;
}

function recentArticleIds(limit = 5) {
  return uploadedArticleRecords(ARTICLES_DIR)
    .slice(0, limit)
    .map((article) => article.articleId);
}

function recentArticleWindowSummary(limit = 5) {
  const windowArticles = uploadedArticleRecords(ARTICLES_DIR).slice(0, limit);
  if (!windowArticles.length) return "- 기존 업로드 기사가 없다.";
  return windowArticles
    .map(({ articleId, metadata, timestamp }) => {
      const uploadedAt = timestamp ? new Date(timestamp).toISOString() : "";
      const publishedAt = metadata.publishedAt || "";
      const topics = Array.isArray(metadata.topics) ? metadata.topics.join(", ") : metadata.topic || "";
      const newsFeedIds = metadataNewsFeedIds(metadata).slice(0, 6).join(", ");
      const worldMemoryEventIds = metadataWorldMemoryEventIds(metadata).slice(0, 6).join(", ");
      return [
        `- ${articleId}`,
        `title=${metadata.title || ""}`,
        uploadedAt ? `uploadTime=${uploadedAt}` : "",
        publishedAt ? `publishedAt=${publishedAt}` : "",
        topics ? `topics=${topics}` : "",
        metadata.storyFamily ? `storyFamily=${metadata.storyFamily}` : "",
        metadata.editorialAngle ? `editorialAngle=${metadata.editorialAngle}` : "",
        newsFeedIds ? `newsFeedIds=${newsFeedIds}` : "",
        worldMemoryEventIds ? `worldMemoryEventIds=${worldMemoryEventIds}` : "",
        metadata.isCoverStory ? "isCoverStory=true" : "isCoverStory=false",
      ]
        .filter(Boolean)
        .join(" / ");
    })
    .join("\n");
}

function bootstrapCoverDecision({ comparisonArticleIds, timestampIso, totalArticleCount }) {
  return {
    policy: "world-memory-cover-v1",
    result: "promote",
    mode: "bootstrap-cover-fill",
    scorePolicy: "not-scored-total-articles-lte-5",
    evaluatedAt: timestampIso,
    comparisonWindow: {
      basis: "upload-time",
      articleLimit: 5,
      articleIds: comparisonArticleIds,
      totalArticleCount,
    },
    candidateScore: null,
    bestPreviousScore: null,
    rationale: "총 기사 수가 5개 이하인 초기 구간이므로 채점 없이 커버스토리 슬롯을 채우기 위해 승격했습니다.",
  };
}

function normalizeGenerationAgent(agent = {}) {
  const provider = cleanCliValue(agent.provider || "", "");
  const model = cleanCliValue(agent.model || "", "");
  const reasoning = cleanCliValue(agent.reasoning || "", "");
  const speed = cleanCliValue(agent.speed || "", "");
  const harnessProfile = normalizeHarnessProfile(agent.harnessProfile);
  const pipeline = cleanCliValue(agent.pipeline || "", "");
  const label = String(agent.label || "").trim();
  const editorialExemplars = identityList(Array.isArray(agent.editorialExemplars) ? agent.editorialExemplars : []).slice(0, 6);
  const normalized = {
    provider,
    model,
    reasoning,
    speed,
    harnessProfile,
    pipeline,
    label,
    editorialExemplars,
  };
  return Object.fromEntries(Object.entries(normalized).filter(([, value]) => Array.isArray(value) ? value.length : value));
}

function normalizeGeneratedTopicList(metadata = {}) {
  const rawTopics = Array.isArray(metadata.topics)
    ? metadata.topics
    : metadata.topic
      ? [metadata.topic]
      : [];
  return rawTopics
    .map((topic) => String(topic || "").trim())
    .filter(Boolean)
    .slice(0, MAX_ARTICLE_TOPICS);
}

export function normalizeGeneratedResearchMode(metadata = {}) {
  const raw = String(metadata.researchMode || "").trim();
  if (MAGAZINE_RESEARCH_MODES.has(raw)) return raw;
  const usesNewsFeed = Boolean(metadata.newsFeed && (
    !Array.isArray(metadata.newsFeed?.items) || metadata.newsFeed.items.length
  ));
  const usesWorldMemory = Boolean(metadata.worldMemory);
  if (usesNewsFeed && usesWorldMemory) return "news-feed-with-world-memory-backup";
  if (usesNewsFeed) return "news-feed-first";
  if (usesWorldMemory) return "mixed-research";
  return "external-research";
}

function normalizeGeneratedArticleMetadata(articleDirectory, timestampIso, { existingArticleCount = articleCountIn(ARTICLES_DIR), previousArticleIds = recentArticleIds(5), generationAgent = {} } = {}) {
  const generatedArticleIds = articleIdsIn(articleDirectory);
  const normalizedGenerationAgent = normalizeGenerationAgent(generationAgent);
  for (const [articleIndex, articleId] of generatedArticleIds.entries()) {
    const metadataPath = join(articleDirectory, articleId, "metadata.json");
    if (!existsSync(metadataPath)) continue;
    const metadata = readJsonFile(metadataPath);
    if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) continue;
    const totalArticleCount = existingArticleCount + articleIndex + 1;
    const bootstrapCover = totalArticleCount <= 5;
    const stagedPreviousIds = generatedArticleIds.slice(0, articleIndex).reverse();
    const comparisonArticleIds = [...stagedPreviousIds, ...previousArticleIds].slice(0, 5);
    const isCoverStory = bootstrapCover ? true : Boolean(metadata.isCoverStory);
    const coverDecision = bootstrapCover
      ? bootstrapCoverDecision({ comparisonArticleIds, timestampIso, totalArticleCount })
      : metadata.coverDecision && typeof metadata.coverDecision === "object" && !Array.isArray(metadata.coverDecision)
        ? { ...metadata.coverDecision, evaluatedAt: timestampIso }
        : metadata.coverDecision;
    const nextMetadata = {
      ...metadata,
      topics: normalizeGeneratedTopicList(metadata),
      researchMode: normalizeGeneratedResearchMode(metadata),
      isCoverStory,
      publishedAt: timestampIso,
      createdAt: timestampIso,
      updatedAt: timestampIso,
      uploadedAt: timestampIso,
      generatedAt: timestampIso,
      generationAgent: Object.keys(normalizedGenerationAgent).length
        ? normalizedGenerationAgent
        : metadata.generationAgent,
      coverRegisteredAt: isCoverStory ? timestampIso : null,
      coverDecision,
    };
    writeFileSync(metadataPath, `${JSON.stringify(nextMetadata, null, 2)}\n`, "utf8");
  }
}

function stripHtmlForTitle(html) {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export function htmlForEditorialReview(html) {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_, level, content) => {
      const heading = stripHtmlForTitle(content);
      return heading ? `\n\n${"#".repeat(Number(level))} ${heading}\n\n` : "\n\n";
    })
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<\/(?:p|blockquote|li|div|section)>/gi, "\n\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function cleanGeneratedTitle(output) {
  const raw = String(output || "").trim();
  if (!raw) return "";
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      const title = cleanGeneratedTitle(parsed?.title || parsed?.headline || "");
      if (title) return title;
    } catch {
      // Fall back to line-based cleanup.
    }
  }
  const withoutFences = raw.replace(/```(?:json|text)?/gi, "").replace(/```/g, "").trim();
  const firstLine = withoutFences
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  return String(firstLine || "")
    .replace(/^[-*•\d.)\s]+/, "")
    .replace(/^(?:제목|title|headline)\s*[:：]\s*/i, "")
    .replace(/^["'`“”‘’]+|["'`“”‘’]+$/g, "")
    .trim();
}

function buildTitlePrompt({ bodyText }) {
  return [
    "아래 기사 본문만 읽고 한국어 기사 제목을 한 줄로 작성한다.",
    "기사 본문을 잘 설명하는 가독성 높고 이해하기 쉬운 기사 제목을 달성하라.",
    "제목 작성은 Bloomberg나 Financial Times의 제목 작성 스타일을 한국어로 표현한다고 여기라.",
    "출력은 최종 제목 한 줄만 한다.",
    "",
    "[기사 본문]",
    bodyText,
  ].join("\n");
}

function extractJsonObject(output) {
  const raw = String(output || "").trim();
  const withoutFences = raw.replace(/```(?:json)?/gi, "").replace(/```/g, "").trim();
  const start = withoutFences.indexOf("{");
  const end = withoutFences.lastIndexOf("}");
  if (start < 0 || end < start) return null;
  try {
    return JSON.parse(withoutFences.slice(start, end + 1));
  } catch {
    return null;
  }
}

function buildReaderToneDecisionPrompt({ articleId, metadata, bodyText }) {
  return [
    "너는 FinanceAgentGUI Magazine의 독자 톤 LLM 분류 하네스다.",
    "절대 키워드, 정규식, 부분 문자열, 금칙어 목록으로 판정하지 않는다. 문맥과 발화 주체를 의미적으로 분류한다.",
    "예: 'Trump 대통령은 투표자의 신원을 확인해야 한다고 말했습니다'는 독자 지시가 아니라 제3자 발언 귀속이다.",
    "예: '해외 투자자는 달러와 장기금리를 함께 봅니다'는 기사 속 제3자 시장 참여자 설명이다.",
    "예: '투자자는 이 변수를 확인해야 합니다'처럼 독자를 투자자로 호명하고 과제를 주면 실패다.",
    "",
    "분류 목표:",
    "- 기사 후반부가 독자에게 무엇을 해야 한다고 지시하거나 숙제를 내는지 판정한다.",
    "- 독자를 '투자자' 또는 '투자자 여러분'으로 호명했는지 판정한다.",
    "- 결론부를 독자 체크리스트로 묶었는지 판정한다.",
    "- 기사 속 제3자인 투자자, 유권자, 기업, 정책당국, 대통령, 분석가가 무엇을 해야 한다고 말하거나 행동한 것은 독자 지시로 보지 않는다.",
    "",
    "반드시 아래 JSON 객체 하나만 출력한다. 설명 문장이나 마크다운을 붙이지 않는다.",
    JSON.stringify({
      policy: READER_TONE_POLICY,
      method: READER_TONE_METHOD,
      noTextMatching: true,
      classifier: "magazine-reader-tone-llm",
      readerDirective: false,
      readerAddressedAsInvestor: false,
      checklistConclusion: false,
      lateSectionReviews: [
        {
          heading: "소제목 또는 후반부 문단 묶음 label",
          classification: "market_observation | unresolved_tension | evidence_based_implication | third_party_market_participant | reader_directive | checklist_conclusion | mixed",
          rationale: "발화 주체와 독자 지시 여부를 의미적으로 설명",
        },
      ],
    }, null, 2),
    "",
    "허용 classification:",
    "- market_observation: 시장이 어떻게 읽는지 관찰한다.",
    "- unresolved_tension: 아직 풀리지 않은 긴장이나 변수의 의미를 설명한다.",
    "- evidence_based_implication: 근거에서 파생되는 함의를 설명한다.",
    "- third_party_market_participant: 기사 속 제3자 발언/행동/의무를 귀속한다.",
    "",
    "실패 classification:",
    "- reader_directive: 독자에게 무엇을 봐야/확인해야/점검해야/주목해야 한다고 말한다.",
    "- checklist_conclusion: 결론을 독자 체크리스트로 묶는다.",
    "- mixed: 허용/실패가 섞여 있어 수리가 필요하다.",
    "",
    "판정값 규칙:",
    "- readerDirective는 실패 classification이 하나라도 있으면 true, 아니면 false.",
    "- readerAddressedAsInvestor는 독자를 투자자로 부른 경우만 true. 기사 속 제3자 투자자는 false.",
    "- checklistConclusion은 실패 classification checklist_conclusion이 있으면 true.",
    "- lateSectionReviews에는 기사 후반부 주요 소제목/문단 묶음을 최소 1개 이상 넣는다.",
    "",
    `[articleId]\n${articleId}`,
    "",
    "[metadata excerpt]",
    JSON.stringify({
      title: metadata.title || "",
      deck: metadata.deck || "",
      summary: metadata.summary || "",
      articleType: metadata.articleType || "",
      storyFamily: metadata.storyFamily || metadata.storyKey || "",
      editorialAngle: metadata.editorialAngle || "",
    }, null, 2),
    "",
    "[article body text]",
    bodyText,
  ].join("\n");
}

function buildQuoteFlowDecisionPrompt({ articleId, metadata, bodyText }) {
  return [
    "너는 FinanceAgentGUI Magazine의 인용 흐름 LLM 분류 하네스다.",
    "절대 키워드, 정규식, 부분 문자열, 따옴표 개수로 판정하지 않는다. 문맥, 발화 주체, 같은 claim의 반복 여부를 의미적으로 분류한다.",
    "목표는 직접인용을 없애는 것이 아니라, 검증된 직접인용은 살리고 그 앞뒤의 중복 간접요약만 줄이는 것이다.",
    "직접인용 회피로 통과하려 하지 않는다. 검증된 이해관계자 발언이 있으면 적어도 하나 이상의 고신호 직접인용을 보통 남겨야 한다.",
    "",
    "분류 목표:",
    "- 직접인용이 있다면 그 발언의 핵심 claim을 바로 직접인용으로 제시했는지 확인한다.",
    "- 검증된 이해관계자 발언이 있는데도 직접인용을 모두 없애거나 간접귀속으로만 처리했는지 판정한다.",
    "- 같은 문단이나 인접 문단에서 간접 귀속으로 이미 설명한 내용을 직접인용이 반복하는지 판정한다.",
    "- 정확한 원문이 확인된 발언인데도 불필요한 간접귀속으로 우회했는지 판정한다.",
    "- 정확한 표현이 불확실한 경우의 짧은 간접귀속은 허용한다.",
    "- 출처명 연결, 데이터 출처 표시, 발언 배경 소개처럼 같은 claim을 반복하지 않는 attribution은 허용한다.",
    "",
    "반드시 아래 JSON 객체 하나만 출력한다. 설명 문장이나 마크다운을 붙이지 않는다.",
    JSON.stringify({
      policy: QUOTE_FLOW_POLICY,
      method: QUOTE_FLOW_METHOD,
      noTextMatching: true,
      classifier: "magazine-quote-flow-llm",
      quoteFlowOk: true,
      directQuotePreferredWhenExactWordingVerified: true,
      directQuoteCoverageOk: true,
      indirectAttributionLimitedToUnverifiedWording: true,
      directQuoteAvoidance: false,
      repeatedIndirectBeforeDirectQuote: false,
      indirectAttributionOverused: false,
      ornamentalQuoteBlocks: false,
      reviews: [
        {
          location: "문단 또는 소제목 label",
          classification: "direct_quote_integrated | necessary_indirect_attribution | source_attribution_without_repetition | no_verified_statement_available | indirect_then_direct_repetition | direct_quote_avoidance | indirect_attribution_overused | ornamental_quote_block | mixed",
          rationale: "직접/간접 인용 선택과 반복 여부를 의미적으로 설명",
        },
      ],
    }, null, 2),
    "",
    "허용 classification:",
    "- direct_quote_integrated: 검증된 발언을 먼저 직접인용으로 제시하고, 앞뒤 문장이 분석을 전진시킨다.",
    "- necessary_indirect_attribution: 정확한 표현이 불확실하거나 짧은 출처 귀속이 더 적합해 간접귀속을 쓴다.",
    "- source_attribution_without_repetition: 출처 표시나 배경 설명일 뿐 같은 claim을 반복하지 않는다.",
    "- no_verified_statement_available: 검증 가능한 이해관계자 발언이 없어서 데이터, 가격 반응, 구조 설명만으로 충분하다.",
    "",
    "실패 classification:",
    "- indirect_then_direct_repetition: 간접귀속으로 같은 내용을 설명한 뒤 직접인용으로 다시 반복한다.",
    "- direct_quote_avoidance: 검증된 직접 발언이 있는데도 반복 위험을 피하려고 직접인용을 모두 없애거나 간접귀속으로만 처리한다.",
    "- indirect_attribution_overused: 직접인용이 가능하거나 필요 없는 자리까지 간접귀속으로 문장을 늘린다.",
    "- ornamental_quote_block: quote block이 장식이나 증명 도장처럼 붙어 있고 새 정보·반론·메커니즘을 만들지 않는다.",
    "- mixed: 허용/실패가 섞여 있어 수리가 필요하다.",
    "",
    "판정값 규칙:",
    "- quoteFlowOk는 실패 classification이 하나라도 있으면 false, 아니면 true.",
    "- directQuoteCoverageOk는 검증된 이해관계자 발언이 없거나, 검증된 발언이 있을 때 최소 하나의 고신호 직접인용이 본문에 살아 있으면 true.",
    "- directQuoteAvoidance는 direct_quote_avoidance가 하나라도 있으면 true.",
    "- repeatedIndirectBeforeDirectQuote는 indirect_then_direct_repetition이 하나라도 있으면 true.",
    "- indirectAttributionOverused는 indirect_attribution_overused가 하나라도 있으면 true.",
    "- ornamentalQuoteBlocks는 ornamental_quote_block이 하나라도 있으면 true.",
    "- reviews에는 기사에서 인용·귀속이 가장 많이 쓰인 대목 또는 인용이 없는 경우 그 선택의 이유를 최소 1개 이상 넣는다.",
    "",
    `[articleId]\n${articleId}`,
    "",
    "[metadata excerpt]",
    JSON.stringify({
      title: metadata.title || "",
      deck: metadata.deck || "",
      summary: metadata.summary || "",
      articleType: metadata.articleType || "",
      sourceBasis: Array.isArray(metadata.sourceBasis) ? metadata.sourceBasis.slice(0, 8) : [],
      storyFamily: metadata.storyFamily || metadata.storyKey || "",
      editorialAngle: metadata.editorialAngle || "",
    }, null, 2),
    "",
    "[article body text]",
    bodyText,
  ].join("\n");
}

async function finalizeArticleTitles({ provider, codex, approval, sandbox, model, reasoning, speed, timeoutMs, tempDir, articleDirectory, agentLabel }) {
  for (const [index, articleId] of articleIdsIn(articleDirectory).entries()) {
    const articleDir = join(articleDirectory, articleId);
    const metadataPath = join(articleDir, "metadata.json");
    const htmlPath = join(articleDir, "article.html");
    if (!existsSync(metadataPath) || !existsSync(htmlPath)) continue;
    const metadata = readJsonFile(metadataPath);
    if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) continue;
    const bodyText = stripHtmlForTitle(readFileSync(htmlPath, "utf8"));
    if (!bodyText) continue;
    const outputPath = join(tempDir, `${provider}-title-${index + 1}.txt`);
    console.log(`\nFinalizing article title from body only: ${articleId}`);
    await runAgentPrompt({
      provider,
      codex,
      approval,
      sandbox,
      model,
      reasoning,
      speed,
      outputPath,
      prompt: buildTitlePrompt({ bodyText }),
      timeoutMs,
      tempDir,
    });
    const title = cleanGeneratedTitle(existsSync(outputPath) ? readFileSync(outputPath, "utf8") : "");
    if (!title) {
      throw new Error(`${agentLabel} title finalization returned an empty title for ${articleId}`);
    }
    writeFileSync(metadataPath, `${JSON.stringify({ ...metadata, title }, null, 2)}\n`, "utf8");
  }
}

async function finalizeReaderToneDecisions({ provider, codex, approval, sandbox, model, reasoning, speed, timeoutMs, tempDir, articleDirectory, agentLabel }) {
  for (const [index, articleId] of articleIdsIn(articleDirectory).entries()) {
    const articleDir = join(articleDirectory, articleId);
    const metadataPath = join(articleDir, "metadata.json");
    const htmlPath = join(articleDir, "article.html");
    if (!existsSync(metadataPath) || !existsSync(htmlPath)) continue;
    const metadata = readJsonFile(metadataPath);
    if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) continue;
    const bodyText = stripHtmlForTitle(readFileSync(htmlPath, "utf8"));
    if (!bodyText) continue;
    const outputPath = join(tempDir, `${provider}-reader-tone-${index + 1}.json`);
    console.log(`\nClassifying article reader tone with LLM harness: ${articleId}`);
    await runAgentPrompt({
      provider,
      codex,
      approval,
      sandbox,
      model,
      reasoning,
      speed,
      outputPath,
      prompt: buildReaderToneDecisionPrompt({ articleId, metadata, bodyText }),
      timeoutMs,
      tempDir,
    });
    const decision = extractJsonObject(existsSync(outputPath) ? readFileSync(outputPath, "utf8") : "");
    if (!decision) {
      throw new Error(`${agentLabel} reader-tone classifier returned invalid JSON for ${articleId}`);
    }
    writeFileSync(metadataPath, `${JSON.stringify({ ...metadata, readerToneDecision: decision }, null, 2)}\n`, "utf8");
  }
}

async function finalizeQuoteFlowDecisions({ provider, codex, approval, sandbox, model, reasoning, speed, timeoutMs, tempDir, articleDirectory, agentLabel }) {
  for (const [index, articleId] of articleIdsIn(articleDirectory).entries()) {
    const articleDir = join(articleDirectory, articleId);
    const metadataPath = join(articleDir, "metadata.json");
    const htmlPath = join(articleDir, "article.html");
    if (!existsSync(metadataPath) || !existsSync(htmlPath)) continue;
    const metadata = readJsonFile(metadataPath);
    if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) continue;
    const bodyText = stripHtmlForTitle(readFileSync(htmlPath, "utf8"));
    if (!bodyText) continue;
    const outputPath = join(tempDir, `${provider}-quote-flow-${index + 1}.json`);
    console.log(`\nClassifying article quote flow with LLM harness: ${articleId}`);
    await runAgentPrompt({
      provider,
      codex,
      approval,
      sandbox,
      model,
      reasoning,
      speed,
      outputPath,
      prompt: buildQuoteFlowDecisionPrompt({ articleId, metadata, bodyText }),
      timeoutMs,
      tempDir,
    });
    const decision = extractJsonObject(existsSync(outputPath) ? readFileSync(outputPath, "utf8") : "");
    if (!decision) {
      throw new Error(`${agentLabel} quote-flow classifier returned invalid JSON for ${articleId}`);
    }
    writeFileSync(metadataPath, `${JSON.stringify({ ...metadata, quoteFlowDecision: decision }, null, 2)}\n`, "utf8");
  }
}

export function buildEditorialReviewPrompt({ articleId, metadata, bodyText }) {
  return [
    "너는 FinanceAgentGUI Magazine v2의 독립 편집 리뷰어다.",
    "config/magazine-longform-editorial-standard.prompt.md의 편집 커미션을 기준으로 완성도를 평가한다.",
    "키워드 매칭, 글자 수, 문단 수, 인용 수, 출처 수 할당량으로 판정하지 않는다.",
    "기사의 논제, 논증 전개, 근거 사다리, 가장 강한 반론, 역사·제도 맥락, 구체적 결과, 존대말의 자연스러운 한국어 잡지 문체, 소재에서 나온 절제된 위트와 호흡의 여유, 사건의 독립성, 인용의 정확성과 흐름을 검토한다.",
    "한국어 문체는 문법 오류만 보지 않는다. 영어식 추상명사 주어, 추상 개념의 반복 의인화, 명사구 연쇄, 의미 관계를 생략한 대칭 문장, 문단마다 만든 경구가 기사 전반에 퍼져 한국어 독자가 다른 언어로 역번역해야 뜻이 잡히는지 의미적으로 판정한다.",
    "제목도 누가 무엇을 했는지 첫 독해에 드러나는지 검토한다. 두 동사의 목적어나 의미 관계를 생략해 대칭만 만든 압축 제목, 본문보다 수사가 앞서는 제목은 자연스러운 한국어 제목이 아니다.",
    "논증 구조는 내부 편집 기준이다. 소제목이나 본문이 '강한 반론', '반론', '시장 메커니즘', '논증 전환', '근거 사다리'처럼 자기 구조를 독자에게 설명하지 않았는지 의미적으로 검토한다. 실제 당사자나 공식 문서가 반박·반론이라고 이름 붙인 경우가 아니라면, 편집 표찰 대신 경쟁하는 실제 주장·행위자·증거·결과를 직접 써야 한다.",
    "개별 어휘 취향, 선택적 리듬 개선, 위트의 양은 advisory다. 그러나 번역투 구조와 부자연스러운 수사가 기사 전반에 반복되어 한국어 기사로 자연스럽게 읽히지 않으면 pervasive-unidiomatic-korean blocking issue다.",
    "명료한 설명형·분석형 한국어는 허용한다. 보고서형 호흡, 장면이나 위트의 부족, 합칠 수 있는 반복 설명은 논증이 실제로 멈추거나 근거 없는 padding이 되지 않는 한 advisory로만 반환한다.",
    "blocking 범위는 근거 없는 핵심 주장, 명백히 오해를 부르는 인용, 독자-facing 내부 프로세스 또는 편집 구조 표찰 노출, 본문이 성립하지 않을 정도의 논리 단절, 같은 primary event의 실질적 재출판, 또는 longform 커미션의 실질적 미이행으로 제한한다.",
    "실질적 미이행은 실제 본문을 근거로 얕은 뉴스 브리프, 논제 없는 설명, 검토되지 않은 핵심 반론, 근거 없는 반복으로 논증이 더 진행되지 않는 구조, 사건을 역사·인센티브·구체적 결과로 연결하지 못한 경우, 서술자가 -다/-한다 평서체를 쓰는 경우, 또는 번역투 구조가 글 전체를 지배하는 경우 중 무엇이 문제인지 특정할 수 있을 때만 판정한다.",
    "글자 수 하나만으로 blocking을 만들지 않는다. 문단 수, H2 리듬, 위트 유무, 직접인용 유무, sourceBasis가 5개 미만이라는 이유만으로도 blocking을 만들지 않는다.",
    "문제가 없으면 issues를 빈 배열로 반환한다. 합격값을 채우기 위한 boolean 필드는 만들지 않는다.",
    "초안 metadata.title은 생성 절차상 의도적으로 비어 있고 suggestedTitle이 곧 반영된다. 빈 title 자체를 issue로 만들지 않는다.",
    "본문의 Markdown형 # 소제목 표시는 실제 HTML heading 경계를 보존한 것이다. 표시된 경계를 평문 연결 오류로 오판하지 않는다.",
    "반드시 JSON 객체 하나만 출력하며 마크다운이나 설명 문장을 붙이지 않는다.",
    JSON.stringify({
      policy: EDITORIAL_REVIEW_POLICY,
      method: "LLM_SEMANTIC_REVIEW",
      reviewer: "magazine-editorial-review-llm",
      suggestedTitle: "주체·쟁점·결과가 첫 독해에 드러나며 생략된 대칭 수사나 추상 개념의 의인화에 기대지 않는 자연스러운 한국어 기사 제목 한 줄",
      summary: "기사의 출판 준비 상태를 한 문장으로 요약",
      issues: [
        {
          severity: "blocking | advisory",
          code: "구체적인 영문-kebab-case 코드",
          location: "문단 또는 메타데이터 필드",
          rationale: "기사에서 확인한 구체적 근거와 문제",
          suggestedFix: "필요한 경우에만 최소 수정 방향",
          confidence: 0.0,
        },
      ],
    }, null, 2),
    "",
    "[approved Korean exemplar editorial maps]",
    editorialExemplarReviewPrompt(),
    "",
    `[articleId]\n${articleId}`,
    "",
    "[metadata]",
    JSON.stringify({
      title: metadata.title || "",
      deck: metadata.deck || "",
      summary: metadata.summary || "",
      articleType: metadata.articleType || "",
      topics: metadata.topics || [],
      storyFamily: metadata.storyFamily || metadata.storyKey || "",
      editorialAngle: metadata.editorialAngle || "",
      noveltyNote: metadata.noveltyNote || "",
      eventSignature: metadata.eventSignature || null,
      sourceBasis: Array.isArray(metadata.sourceBasis) ? metadata.sourceBasis : [],
    }, null, 2),
    "",
    "[article body text]",
    bodyText,
  ].join("\n");
}

function validEditorialReviewDecision(decision) {
  return Boolean(
    decision &&
      typeof decision === "object" &&
      !Array.isArray(decision) &&
      decision.policy === EDITORIAL_REVIEW_POLICY &&
      decision.method === "LLM_SEMANTIC_REVIEW" &&
      cleanGeneratedTitle(decision.suggestedTitle) &&
      Array.isArray(decision.issues),
  );
}

async function collectEditorialReviewDecisions({ provider, codex, approval, sandbox, model, reasoning, speed, timeoutMs, tempDir, articleDirectory, agentLabel, resumeSessionId = "" }) {
  const decisions = new Map();
  let reviewerSessionId = resumeSessionId;
  for (const [index, articleId] of articleIdsIn(articleDirectory).entries()) {
    const articleDir = join(articleDirectory, articleId);
    const metadataPath = join(articleDir, "metadata.json");
    const htmlPath = join(articleDir, "article.html");
    if (!existsSync(metadataPath) || !existsSync(htmlPath)) continue;
    const metadata = readJsonFile(metadataPath);
    if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) continue;
    const bodyText = htmlForEditorialReview(readFileSync(htmlPath, "utf8"));
    if (!bodyText) continue;
    const outputPath = join(tempDir, `${provider}-editorial-review-${index + 1}.json`);
    console.log(`\nReviewing article with Magazine v2 semantic editor: ${articleId}`);
    let decision = null;
    for (let transportAttempt = 0; transportAttempt < 2; transportAttempt += 1) {
      const result = await runAgentPrompt({
        provider,
        codex,
        approval,
        sandbox,
        model,
        reasoning,
        speed,
        outputPath,
        prompt: buildEditorialReviewPrompt({ articleId, metadata, bodyText }),
        timeoutMs,
        tempDir,
        persistSession: !isAntigravityProvider(provider),
        resumeSessionId: reviewerSessionId,
      });
      reviewerSessionId = result?.sessionId || reviewerSessionId;
      decision = extractJsonObject(existsSync(outputPath) ? readFileSync(outputPath, "utf8") : "");
      if (validEditorialReviewDecision(decision)) break;
      console.warn(`${agentLabel} v2 editorial reviewer returned an invalid contract for ${articleId}; retrying reviewer only.`);
    }
    if (!validEditorialReviewDecision(decision)) {
      throw new Error(`${agentLabel} v2 editorial reviewer returned invalid JSON/contract for ${articleId}`);
    }
    decisions.set(articleId, decision);
  }
  return { decisions, sessionId: reviewerSessionId };
}

function buildHeroImageWorkerPrompt({ articleId, articleDir, metadata, bodyText, diagnostic = "" }) {
  return [
    "너는 FinanceAgentGUI Magazine v2의 히어로 이미지 소싱 전담 worker다.",
    "기사 본문과 metadata.json은 절대 수정하지 않는다.",
    `작업 대상 article-id는 ${articleId}이고 고정 기사 디렉터리는 ${articleDir} 이다.`,
    `이미지 파일은 ${join(articleDir, "assets")} 아래에만 저장한다.`,
    `최종 이미지 메타데이터는 ${join(articleDir, "hero-image.json")} 한 파일에 JSON 객체로 저장한다.`,
    "무료/오픈 이미지, 공식 이미지, 개인 열람용 공개 보도사진 순으로 후보를 검토한다.",
    "검색은 최대 2회로 제한한다. 실제 관련성이 있는 후보를 찾으면 즉시 원본 이미지 확보와 검증으로 넘어간다.",
    "jpg, jpeg, png, webp만 허용한다. SVG, AVIF, 생성 이미지, placeholder, HTML 응답을 이미지 확장자로 저장한 파일은 금지한다.",
    "다운로드 뒤 file, byte size, 이미지 치수를 확인한다. 최소 10KiB, 320x180 이상이어야 한다.",
    "credit, http(s) sourceUrl 또는 pageUrl, license/rights/usagePolicy/usageNote 중 하나를 실제 근거대로 기록한다. 추측하지 않는다.",
    "개인 열람용 보도사진이면 usageNote에 editorial-private-use; local personal reading only와 원출처를 남긴다.",
    "hero-image.json 형식은 {\"heroImage\":{\"src\":\"assets/file.jpg\",\"alt\":\"...\",\"credit\":\"...\",\"sourceUrl\":\"https://...\",\"license\":\"...\"},\"selection\":{\"query\":\"...\",\"rationale\":\"...\"}} 이다.",
    "성공하지 못하면 빈 파일이나 가짜 메타데이터를 만들지 말고 오류를 최종 답변에 보고한다.",
    diagnostic ? `직전 검증 오류: ${diagnostic}` : "",
    "",
    "[article metadata excerpt]",
    JSON.stringify({
      deck: metadata.deck || "",
      summary: metadata.summary || "",
      topics: metadata.topics || [],
      storyFamily: metadata.storyFamily || metadata.storyKey || "",
      editorialAngle: metadata.editorialAngle || "",
      heroImageRequest: metadata.heroImageRequest || null,
      sourceBasis: Array.isArray(metadata.sourceBasis) ? metadata.sourceBasis.slice(0, 8) : [],
    }, null, 2),
    "",
    "[article body text]",
    bodyText,
  ].filter(Boolean).join("\n");
}

function validateHeroImagePatch(articleDir, patch) {
  const heroImage = patch?.heroImage && typeof patch.heroImage === "object" && !Array.isArray(patch.heroImage)
    ? patch.heroImage
    : null;
  if (!heroImage) return "hero-image.json must include heroImage object";
  const src = String(heroImage.src || "").trim();
  if (!/^assets\/[A-Za-z0-9._-]+\.(?:jpe?g|png|webp)$/i.test(src)) return "heroImage.src must be a safe assets/ jpg, jpeg, png, or webp path";
  const assetPath = join(articleDir, src);
  if (!existsSync(assetPath)) return `hero image asset does not exist: ${src}`;
  try {
    if (statSync(assetPath).size < 10 * 1024) return `hero image asset is smaller than 10KiB: ${src}`;
  } catch (error) {
    return `hero image asset is unreadable: ${error.message}`;
  }
  if (!String(heroImage.alt || "").trim()) return "heroImage.alt is required";
  if (!String(heroImage.credit || "").trim()) return "heroImage.credit is required";
  const sourceUrl = String(heroImage.sourceUrl || heroImage.pageUrl || "").trim();
  if (!/^https?:\/\//i.test(sourceUrl)) return "heroImage.sourceUrl or pageUrl must be http(s)";
  if (!String(heroImage.license || heroImage.rights || heroImage.usagePolicy || heroImage.usageNote || "").trim()) {
    return "heroImage rights or usage metadata is required";
  }
  return "";
}

function hasExistingHeroAsset(articleDir, metadata = {}) {
  const src = String(metadata.heroImage?.src || "").trim();
  return /^assets\//.test(src) && existsSync(join(articleDir, src));
}

async function collectHeroImagePatches({ provider, codex, approval, sandbox, model, reasoning, speed, timeoutMs, tempDir, articleDirectory, agentLabel, force = false }) {
  const patches = new Map();
  for (const [index, articleId] of articleIdsIn(articleDirectory).entries()) {
    const articleDir = join(articleDirectory, articleId);
    const metadataPath = join(articleDir, "metadata.json");
    const htmlPath = join(articleDir, "article.html");
    const metadata = readJsonFile(metadataPath);
    if (!metadata || !existsSync(htmlPath)) continue;
    if (!force && hasExistingHeroAsset(articleDir, metadata)) {
      patches.set(articleId, { heroImage: metadata.heroImage, selection: { source: "writer-existing-asset" } });
      continue;
    }
    const bodyText = stripHtmlForTitle(readFileSync(htmlPath, "utf8"));
    const sidecarPath = join(articleDir, "hero-image.json");
    let patch = null;
    let diagnostic = "";
    for (let imageAttempt = 0; imageAttempt < 2; imageAttempt += 1) {
      rmSync(sidecarPath, { force: true });
      const outputPath = join(tempDir, `${provider}-hero-image-${index + 1}-${imageAttempt + 1}.txt`);
      console.log(`\nSourcing Magazine v2 hero image: ${articleId} (attempt ${imageAttempt + 1}/2)`);
      await runAgentPrompt({
        provider,
        codex,
        approval,
        sandbox,
        model,
        reasoning,
        speed,
        outputPath,
        prompt: buildHeroImageWorkerPrompt({ articleId, articleDir, metadata, bodyText, diagnostic }),
        timeoutMs,
        tempDir,
      });
      patch = readJsonFile(sidecarPath);
      diagnostic = validateHeroImagePatch(articleDir, patch);
      if (!diagnostic) break;
      console.warn(`${agentLabel} hero image worker validation failed for ${articleId}: ${diagnostic}`);
    }
    if (diagnostic || !patch) throw new Error(`${agentLabel} hero image worker failed for ${articleId}: ${diagnostic || "missing hero-image.json"}`);
    patches.set(articleId, patch);
  }
  return patches;
}

async function prepareLockedTopicHero({ provider, codex, approval, sandbox, model, speed, timeoutMs, tempDir, stagingRoot, agentLabel, lockedTopic }) {
  const preparedRoot = join(stagingRoot, "prepared-hero");
  const preparedArticleId = "locked-topic";
  const preparedArticleDir = join(preparedRoot, preparedArticleId);
  mkdirSync(preparedArticleDir, { recursive: true });
  writeFileSync(join(preparedArticleDir, "metadata.json"), `${JSON.stringify({
    deck: lockedTopic.primaryEvent || lockedTopic.reason || lockedTopic.title,
    summary: lockedTopic.reason || lockedTopic.primaryEvent || lockedTopic.title,
    storyFamily: lockedTopic.storyFamily,
    editorialAngle: lockedTopic.editorialAngle,
    heroImageRequest: {
      subject: lockedTopic.primaryEvent || lockedTopic.title,
      researchQueries: lockedTopic.researchQueries,
    },
    sourceBasis: lockedTopic.researchQueries.map((query) => ({ title: query })),
  }, null, 2)}\n`, "utf8");
  writeFileSync(join(preparedArticleDir, "article.html"), `<p>${lockedTopic.title}</p><p>${lockedTopic.primaryEvent || lockedTopic.reason}</p>\n`, "utf8");

  const patches = await collectHeroImagePatches({
    provider,
    codex,
    approval,
    sandbox,
    model,
    reasoning: cleanCliValue(process.env.MAGAZINE_IMAGE_REASONING || "low", "low"),
    speed,
    timeoutMs,
    tempDir,
    articleDirectory: preparedRoot,
    agentLabel,
  });
  return { preparedArticleDir, patch: patches.get(preparedArticleId) || null };
}

export function installPreparedHero({ preparedHero, articleDirectory }) {
  const articleIds = articleIdsIn(articleDirectory);
  if (!preparedHero?.patch?.heroImage || articleIds.length !== 1) return new Map();
  const articleId = articleIds[0];
  const articleDir = join(articleDirectory, articleId);
  const sourceName = String(preparedHero.patch.heroImage.src || "").replace(/^assets\//, "");
  if (!/^[A-Za-z0-9._-]+\.(?:jpe?g|png|webp)$/i.test(sourceName)) return new Map();
  const sourcePath = join(preparedHero.preparedArticleDir, "assets", sourceName);
  if (!existsSync(sourcePath)) return new Map();
  const targetAssetsDir = join(articleDir, "assets");
  mkdirSync(targetAssetsDir, { recursive: true });
  const targetPath = join(targetAssetsDir, sourceName);
  copyFileSync(sourcePath, targetPath);
  return new Map([[articleId, {
    ...preparedHero.patch,
    heroImage: { ...preparedHero.patch.heroImage, src: `assets/${sourceName}` },
  }]]);
}

function mergeV2FinalizerResults(articleDirectory, reviewDecisions, heroPatches = new Map()) {
  for (const articleId of articleIdsIn(articleDirectory)) {
    const articleDir = join(articleDirectory, articleId);
    const metadataPath = join(articleDir, "metadata.json");
    const metadata = readJsonFile(metadataPath);
    if (!metadata) continue;
    const review = reviewDecisions.get(articleId);
    const finalizedReview = review
      ? {
          ...review,
          issues: Array.isArray(review.issues)
            ? review.issues.filter((issue) => String(issue?.code || "") !== "missing-publication-title")
            : [],
        }
      : null;
    const heroPatch = heroPatches.get(articleId);
    const nextMetadata = {
      ...metadata,
      ...(finalizedReview
        ? {
            title: cleanGeneratedTitle(finalizedReview.suggestedTitle),
            editorialReviewDecision: finalizedReview,
          }
        : {}),
      ...(heroPatch?.heroImage ? { heroImage: heroPatch.heroImage } : {}),
    };
    delete nextMetadata.heroImageRequest;
    writeFileSync(metadataPath, `${JSON.stringify(nextMetadata, null, 2)}\n`, "utf8");
    rmSync(join(articleDir, "hero-image.json"), { force: true });
  }
}

export function normalizeLockedTopic(source = {}) {
  const topic = source && typeof source === "object" && !Array.isArray(source) ? source : {};
  const title = compactPromptText(topic.title || topic.angle || "", 220);
  if (!title) return null;
  return {
    title,
    reason: compactPromptText(topic.reason || topic.rationale || "", 500),
    storyFamily: compactPromptText(topic.storyFamily || "", 160),
    editorialAngle: compactPromptText(topic.editorialAngle || "", 120),
    primaryEvent: compactPromptText(topic.primaryEvent || topic.event || "", 300),
    newsFeedIds: identityList(Array.isArray(topic.newsFeedIds) ? topic.newsFeedIds : topic.sourceIds || []).slice(0, 8),
    researchQueries: identityList(Array.isArray(topic.researchQueries) ? topic.researchQueries : []).slice(0, 5),
  };
}

function lockedTopicFromEnvironment() {
  const raw = String(process.env.MAGAZINE_LOCKED_TOPIC_JSON || "").trim();
  if (!raw) return null;
  try {
    return normalizeLockedTopic(JSON.parse(raw));
  } catch {
    return null;
  }
}

function selectedNewsFeedEvidenceSummary(newsFeedIds = []) {
  const ids = new Set(identityList(newsFeedIds));
  if (!ids.size) return "- 확정 소재에 고정된 로컬 보도 id가 없다. 필요한 근거는 공식/외부 출처로 조사한다.";
  const cutoff = worldMemoryLastSuccessfulAt();
  const store = readJsonFile(NEWS_FEED_STORE_PATH);
  const items = Array.isArray(store?.items) ? store.items : [];
  const selected = items.filter((item) => ids.has(String(item.id || item.sourceFingerprint || "")));
  const invalid = selected.filter((item) => newsFeedItemTimestamp(item).timestamp <= cutoff.timestamp);
  if (invalid.length) throw new Error(`locked topic contains ineligible local evidence id(s): ${invalid.map((item) => item.id).join(", ")}`);
  const foundIds = new Set(selected.map((item) => String(item.id || item.sourceFingerprint || "")));
  const missing = [...ids].filter((id) => !foundIds.has(id));
  if (missing.length) throw new Error(`locked topic contains unknown local evidence id(s): ${missing.join(", ")}`);
  return [
    `- worldMemoryLastSuccessfulAt=${cutoff.iso}`,
    ...selected.map((item) => {
      const itemTime = newsFeedItemTimestamp(item);
      return `- ${item.id} / time=${itemTime.iso} / source=${item.feedTitle || item.feedId || ""} / title=${compactPromptText(item.translatedTitle || item.translatedText || item.title || item.originalText, 260)}`;
    }),
  ].join("\n");
}

function buildV2TopicPreflightPrompt() {
  const extraPrompt = String(process.env.MAGAZINE_EXTRA_PROMPT || process.env.MAGAZINE_CODEX_EXTRA_PROMPT || "").trim();
  return [
    "너는 FinanceAgentGUI Magazine v2의 기사 소재 preflight 편집자다.",
    "본문을 쓰거나 파일을 수정하지 않는다. 제공된 후보와 최근 기사만 보고 이번 1개 기사에 사용할 소재를 확정한다.",
    "텍스트 매칭이나 키워드 개수로 고르지 않고 사건의 독립성, 새 근거, 시장 메커니즘, 독자 가치를 의미적으로 판단한다.",
    "config/magazine-longform-editorial-standard.prompt.md 수준의 장문 논증을 지탱할 소재만 고른다. 단일 속보를 반복 설명하는 것 외에 역사·인센티브·반론·구체적 결과로 확장할 근거가 없으면 skip한다.",
    "researchQueries는 같은 헤드라인을 다시 찾는 질의가 아니라 원문/공식자료, 규모를 보여줄 데이터, 역사적 비교, 가장 강한 반론, 영향을 받는 사람·기업·기관의 구체적 결과를 조사하는 서로 다른 질의로 구성한다.",
    "최근 기사와 같은 사건이면 제외한다. 공통 기준 URL만 같고 primary event가 다르면 중복으로 보지 않는다.",
    "status는 selected 또는 skip이다. selected라면 실제 후보에 존재하는 newsFeedIds만 반환한다.",
    "반드시 JSON 객체 하나만 출력한다.",
    JSON.stringify({
      status: "selected | skip",
      title: "확정 기사 각도",
      reason: "왜 독립적이고 지금 쓸 가치가 있는지",
      storyFamily: "예상 storyFamily",
      editorialAngle: "예상 editorialAngle",
      primaryEvent: "primary event 한 문장",
      newsFeedIds: ["nf_..."],
      researchQueries: ["공식·외부 리서치 질의"],
    }, null, 2),
    extraPrompt ? `\n[상위 스케줄러/사용자 후보 지시]\n${extraPrompt}` : "",
    "",
    "[eligible local candidates]",
    postWorldMemoryNewsFeedSummary({ limit: 24 }),
    "",
    "[current market signals]",
    worldMemoryCurrentSignalSummary(8),
    "",
    "[recent uploaded articles]",
    recentArticleWindowSummary(8),
  ].filter(Boolean).join("\n");
}

async function selectV2LockedTopic({ provider, codex, approval, model, speed, timeoutMs, tempDir, agentLabel }) {
  const outputPath = join(tempDir, `${provider}-topic-preflight.json`);
  console.log("\nRunning Magazine v2 topic preflight...");
  await runAgentPrompt({
    provider,
    codex,
    approval,
    sandbox: "read-only",
    model,
    reasoning: cleanCliValue(process.env.MAGAZINE_PREFLIGHT_REASONING || "low", "low"),
    speed,
    outputPath,
    prompt: buildV2TopicPreflightPrompt(),
    timeoutMs,
    tempDir,
  });
  const decision = extractJsonObject(existsSync(outputPath) ? readFileSync(outputPath, "utf8") : "");
  if (!decision || decision.status !== "selected") {
    throw new Error(`${agentLabel} v2 topic preflight did not select an article: ${decision?.reason || "invalid decision"}`);
  }
  const lockedTopic = normalizeLockedTopic(decision);
  if (!lockedTopic) throw new Error(`${agentLabel} v2 topic preflight returned no usable title`);
  selectedNewsFeedEvidenceSummary(lockedTopic.newsFeedIds);
  return lockedTopic;
}

function buildV2Prompt({ count, replace, articleDirectory, staged, agentLabel = "Codex CLI", lockedTopic }) {
  const extraPrompt = String(process.env.MAGAZINE_EXTRA_PROMPT || process.env.MAGAZINE_CODEX_EXTRA_PROMPT || "").trim();
  const recentArticles = recentArticleWindowSummary(8);
  const normalizedLockedTopic = normalizeLockedTopic(lockedTopic);
  if (!normalizedLockedTopic) throw new Error("Magazine v2 writer requires a locked topic from preflight");
  const newsFeedCandidates = selectedNewsFeedEvidenceSummary(normalizedLockedTopic.newsFeedIds);
  const worldMemorySignals = worldMemoryCurrentSignalSummary(8);
  return [
    `너는 FinanceAgentGUI 배포본 안에서 실행되는 ${agentLabel} 금융 매거진 기자 겸 편집자다.`,
    "작업 루트는 GuiBuild이며 지정된 staging 기사 디렉터리만 수정한다.",
    "",
    "목표:",
    `- 매거진 기사 정확히 ${count}개를 생성한다.`,
    staged
      ? `- 출력 디렉터리는 ${articleDirectory} 이다. production data/magazine/articles/는 직접 수정하지 않는다.`
      : replace
        ? "- 기존 기사를 대체하는 실행이다."
        : "- 기존 기사와 충돌하지 않는 article-id로 추가한다.",
    `- 기사별로 ${articleDirectory}/<article-id>/metadata.json, article.html, 필요하면 assets/를 만든다.`,
    "- 초안 metadata.title은 빈 문자열로 둔다. 생성기가 완성된 본문만 읽고 제목을 별도 확정한다.",
    "",
    "먼저 읽을 계약:",
    "- AGENTS.md",
    "- config/magazine-article-style-v2.prompt.md",
    "- config/magazine-longform-editorial-standard.prompt.md",
    "- config/magazine-topics.json",
    "- 구조나 감사 메타데이터가 필요할 때만 docs/magazine.md의 해당 절을 확인한다.",
    "",
    "v2 작업 원칙:",
    "- 아래 확정 소재는 preflight가 중복·신규성 판단을 마친 결과다. 다른 후보로 바꾸거나 전체 기사 아카이브를 다시 훑지 않는다.",
    "- 실제 근거가 확정 소재와 충돌하거나 기사가 성립하지 않으면 파일을 만들기 전에 topic-reselect-required로 실패 보고한다. 호출 안에서 다른 소재로 전환하지 않는다.",
    "- 체크리스트를 채우는 글이 아니라, 새 사건·시장 메커니즘·이해관계의 충돌이 자연스럽게 이어지는 완성된 기사를 쓴다.",
    "- 기본 커미션은 한국어 장문 분석·에세이·리뷰다. 단순 사건 설명에 일반적 함의를 붙인 브리프를 매거진 기사로 송고하지 않는다.",
    "- 리서치를 마치면 먼저 확인된 사실, 행위자, 행동, 인과관계, 반론, 불확실성, 결론을 한국어 의미 단위로 다시 정리한다. 영문 근거의 문장 순서와 수사 이미지를 따라 번역하거나 문장별로 바꿔 쓰지 말고 이 의미 지도에서 새로 집필한다.",
    "- 독자-facing 서술은 처음부터 끝까지 자연스러운 존대말로 쓴다. 서술자의 -다/-이다/-한다 평서체는 쓰지 않는다. 정확한 직접인용 안의 화법은 예외다.",
    "- 명료하고 차분한 설명형·분석형 한국어를 허용한다. 관료적 명사 압축이나 강의문처럼 독자를 가르치는 말투는 피하되, 장면·위트·친근한 구어체를 억지로 보강하지 않는다. -습니다/-입니다를 기본으로 문장 길이와 연결 방식을 자연스럽게 바꾼다.",
    "- 절제된 위트와 비유는 의무가 아니다. 기관의 명분과 인센티브가 어긋나는 지점처럼 소재 자체에 아이러니가 있을 때만 사용한다. 정확한 직설문이 장식적 비유보다 낫고, 문단마다 경구·대칭 문장·펀치라인을 만들지 않는다.",
    "- 모든 사실을 즉시 '따라서'로 결제하지 않는다. 구체적 장면, 짧은 여담, 뜻밖의 비교, 짧은 독립 문단으로 독자가 아이러니를 받아들일 시간을 준다. 전쟁·죽음·강압·재난에서는 유머를 만들지 말고 절제와 인간적 구체성으로 같은 여유를 만든다.",
    "- 추상명사를 겹쳐 압축하지 말고 누가 무엇을 했으며 그것이 논증을 어떻게 바꾸고 누가 비용을 부담하는지 문장으로 풀어 쓴다. '~로 해석됩니다', '~을 시사합니다', '관찰이 필요합니다' 같은 보고서 상투어를 반복하지 않는다.",
    "- 시장, 지수, 외교, 자본, 시계, 장부, 가격, 규칙 같은 추상 개념이 말하고 묻고 지키고 서명하고 기다리는 식의 의인화를 반복하지 않는다. 한국어 문장은 구체적인 사람·기업·기관의 행동과 결과를 우선한다.",
    "- 제목과 소제목은 한 번 읽어 뜻이 잡혀야 한다. 대칭을 만들려고 두 동사의 목적어나 의미 관계를 생략하지 말고, 구체적인 행위자·쟁점·결과를 우선한다.",
    "- 대체로 공백 제외 5,500~8,500자에 해당하는 취재·논증 밀도를 기대하지만 숫자를 채우지 않는다. 그 범위를 지탱할 논제와 근거가 없으면 topic-reselect-required로 중단한다.",
    "- 도입에서 역설·충돌·장면·수치·명제 중 소재에 맞는 하나로 중심 긴장을 만들고, 초반에 반박 가능한 논제를 드러낸다. 일반적인 사건 요약으로 시작하지 않는다.",
    "- 근거는 나열하지 말고 역할이 다른 사다리로 쌓는다: 사건 확정, 규모 비교, 인센티브, 역사, 반론, 구체적 결과 가운데 필요한 기능을 각각 맡긴다.",
    "- 가장 강한 대안 설명이나 반론을 실제로 검토한다. 짧은 양보 문장 하나로 반론을 처리하지 않는다.",
    "- 필요할 때 개인·기업·기관·산업·국가 사이의 스케일을 오가며 추상을 구체적 결과에 연결한다.",
    "- 소제목은 논증이 방향을 바꿀 때만 쓴다. 섹션과 문단 길이를 시각적으로 균등하게 맞추지 않는다.",
    "- 소제목과 본문은 반론의 실제 주장이나 행위자, 증거, 결과를 직접 쓴다. 실제 당사자나 공식 문서가 그렇게 명명한 경우가 아니라면 '강한 반론:', '반론:', '시장 메커니즘:', '논증 전환:'처럼 편집 구조를 독자에게 알리는 표찰을 쓰지 않는다.",
    "- 결말은 도입의 명제를 더 어렵거나 정교한 형태로 바꿔야 한다. 앞 문단 요약, 전망 체크리스트, 매끈한 재진술로 끝내지 않는다.",
    "- 사실, 수치, 출처, 인용을 만들지 않는다. 중요한 주장에는 추적 가능한 근거를 남긴다.",
    "- sourceBasis는 의미 있는 근거를 최소 3개 남기되 5개나 그 이상을 채우기 위한 약한 출처를 추가하지 않는다.",
    "- 길이, 문단 수, H2 수, 인용 수에는 할당량이 없다. 소재를 충분히 설명한 지점에서 끝내고 임계값을 향해 padding하지 않는다.",
    "- 검증된 직접인용이 새 의미를 만들 때만 사용한다. 직접인용 0개도 정상이며, 같은 claim을 간접요약한 뒤 다시 직접인용하지 않는다.",
    "- 위트, 장면, 비유는 메커니즘을 선명하게 할 때만 쓴다. 의무적으로 넣지 않는다.",
    "- 결말은 남은 긴장, 조건, 시나리오, 앞으로 나올 증거를 설명할 수 있다. 독자에게 일반적인 숙제 목록을 주지는 않는다.",
    "- 최근 기사와 공통 통계·IR·공식 페이지 URL을 참고했다는 이유만으로 중복이라 보지 않는다. primary event와 독립 델타를 기준으로 판단한다.",
    "- metadata.eventSignature에는 primary event claimlet 하나를 저장하고, noveltyNote에는 최근 기사 이후 새로 생긴 근거와 달라진 메커니즘을 명시한다.",
    "- 로컬 보도 항목을 썼다면 아래 eligibility boundary 이후 item만 쓰고 metadata.newsFeed에 실제 id와 시각을 남긴다.",
    "- 독자-facing 문장에는 World Memory, 월드 메모리, News Feed, 뉴스 피드, 로컬 저장소, cutoff, semantic-search, vector search, 하네스 같은 내부 생산 용어를 노출하지 않는다. 실제 출처와 사건명으로 쓴다.",
    "- 내부 저장소와 검색 결과는 매체가 아니다. 저장 항목을 실제 출판사·기관·문서·데이터셋·공시·책·논문·발언자로 환원해 확인하고 그 원출처만 귀속한다. 원출처를 확인할 수 없으면 저장소를 출처처럼 인용하지 말고 해당 사실을 본문에서 제외한다.",
    "- writer는 이미지 검색이나 다운로드를 하지 않는다. 대신 metadata.heroImageRequest에 subject, query, preferredSourceType, rationale를 짧게 남긴다. 별도 image worker가 본문 작성과 분리되어 실제 이미지를 확보한다.",
    "- 생성 과정에서 production 전체를 대상으로 legacy checker를 실행하지 않는다. 저장을 마치면 생성기의 v2 review/check 단계가 처리한다.",
    "",
    "확정 소재:",
    JSON.stringify(normalizedLockedTopic, null, 2),
    "",
    "참고 근거 묶음:",
    newsFeedCandidates,
    "",
    worldMemorySignals,
    "",
    "최근 업로드 기사 비교창:",
    recentArticles,
    "",
    "승인된 한국어 장문 퓨샷:",
    editorialExemplarWriterPrompt(),
    "",
    "출력:",
    "- 실제 기사 파일을 저장한 뒤 article-id와 저장 여부만 짧게 보고한다.",
    extraPrompt ? `\n추가 사용자 지시:\n${extraPrompt}` : "",
  ].join("\n");
}

function buildLegacyPrompt({ count, replace, articleDirectory, staged, agentLabel = "Codex CLI" }) {
  const extraPrompt = String(process.env.MAGAZINE_EXTRA_PROMPT || process.env.MAGAZINE_CODEX_EXTRA_PROMPT || "").trim();
  const recentArticles = recentArticleWindowSummary(12);
  const newsFeedCandidates = postWorldMemoryNewsFeedSummary();
  const worldMemorySignals = worldMemoryCurrentSignalSummary(8);
  const existingArticleCount = replace ? 0 : articleCountIn(ARTICLES_DIR);
  const firstGeneratedTotalCount = existingArticleCount + 1;
  return [
    `너는 FinanceAgentGUI 배포본 안에서 실행되는 ${agentLabel} 기사 생성 작업자다.`,
    "작업 루트는 GuiBuild이며, 런타임 기사 데이터만 수정한다.",
    "",
    "목표:",
    `- 매거진 기사 정확히 ${count}개를 생성한다. 더 적게도, 더 많이도 만들지 않는다.`,
    staged
      ? `- 기사 출력 디렉터리는 ${articleDirectory} 이다. production data/magazine/articles/는 직접 수정하지 않는다.`
      : replace
        ? "- 기존 data/magazine/articles/ 하위의 파일럿 기사 폴더를 삭제한 뒤 새 기사만 남긴다. .gitkeep은 유지해도 된다."
        : "- 기존 기사와 충돌하지 않는 새 article-id로 추가한다.",
    `- 기사별로 ${articleDirectory}/<article-id>/metadata.json 과 article.html 을 만든다.`,
    `- 필요하면 ${articleDirectory}/<article-id>/assets/ 를 만들 수 있다.`,
    "- 초안 작성 단계에서는 metadata.title을 빈 문자열(\"\")로 둔다. 제목은 article.html 본문이 완성된 뒤 생성기가 본문만 따로 읽고 확정한다.",
    "",
    "반드시 먼저 읽을 파일:",
    "- AGENTS.md",
    "- docs/magazine.md",
    "- config/magazine-article-style.prompt.md",
    "- config/magazine-topics.json",
    "",
    "기사 생성 원칙:",
    "- 아래 '참고 근거 묶음'은 기사 소재와 커버스토리 판단에 사용할 고정 입력이다. 없는 중요/최신 이슈를 지어내지 않는다.",
    "- 소재를 고르기 전에 참고 근거 묶음을 먼저 검토한다.",
    "- 내부 근거의 저장 위치나 검색 경로를 기사 문장 안에서 구분하지 않는다. 독자에게는 출처 계층이 아니라 사건, 수치, 발언, 가격 반응, 공식/외부 출처만 보이게 쓴다.",
    "- 보도 후보는 data/world-memory/collector-state.json의 collector.lastSuccessfulAt 이후 항목만 사용할 수 있다. 그 이전 항목은 기사 소재로 쓰지 않는다.",
    "- 최근 확인된 보도 중 속보성, 시장 충격, 정책/기업/거시 메커니즘이 강한 항목이 있으면 그쪽을 기사 주제로 삼을 수 있다. 이 판단은 LLM 편집 판단으로 하며 키워드 매칭 규칙을 만들지 않는다.",
    "- 최근 보도를 주근거로 쓰는 경우에도 연속성 검색을 실행한다. 내부 근거가 약하면 외부 리서치로 보강한다.",
    "- 감사용 메타데이터에는 metadata.newsFeed={\"selectionPolicy\":\"post-world-memory-update-only\",\"worldMemoryLastSuccessfulAt\":\"ISO timestamp\",\"items\":[{\"id\":\"...\",\"feedId\":\"...\",\"feedTitle\":\"...\",\"title\":\"...\",\"publishedAt\":\"...\",\"fetchedAt\":\"...\",\"translatedAt\":\"...\"}]}를 저장한다. 단, 이 필드명과 레이어 구분을 deck, summary, article.html, noveltyNote, coverDecision.rationale, sourceBasis prose에 쓰지 않는다.",
    "- 같은 metadata.newsFeed.items[].id를 이미 최근 업로드 기사가 사용했다면 같은 뉴스다. 제목·표현·storyFamily를 바꿔도 새 기사로 쓰지 않는다.",
    "- metadata.eventSignature를 반드시 저장한다. 형식: {\"role\":\"primary\",\"actor\":\"주체\",\"action\":\"무엇을 했다\",\"object\":[\"대상/수치\"],\"time\":\"대표 발생/보도 시각\",\"marketMechanism\":\"시장에 작동하는 메커니즘\",\"sourceIds\":[\"nf_...\"]}. 이것은 기사 전체 요약이 아니라 사건 claimlet이다.",
    "- 복수 사건을 엮는 기사라면 metadata.eventSignatures[]를 사용할 수 있다. 단, role='primary' 카드는 정확히 하나여야 하고, supporting 카드는 배경·비교·연쇄 효과만 담는다.",
    "- 직접 연속성 검색을 실행한다: python3 scripts/world_memory_cli.py semantic-search \"질의\" --limit 8 --format json",
    "- 검색 결과가 강하면 감사용 metadata.worldMemory.retrievalPolicy='mandatory-vector-search'와 query, engine, model, hits를 저장한다.",
    "- 검색 결과가 약하거나 주제 밖이면 스킵하지 말고 external-first/external-research로 보강한다.",
    "- 최근 업로드 기사와 primary worldMemory eventId가 같다는 사실만으로 중복 판정하지 않는다. 그 eventId는 연속성 맥락일 수 있고, 하드 veto가 아니다.",
    "- 독립 델타는 기사 전체 임베딩 거리가 아니라 새 근거 앵커다. 새 보도 id, 새 공식/외부 출처 URL, 새 수치, 새 정책 집행, 새 가격 반응, 새 기업 행동 중 적어도 하나가 이전 기사 이후 발생했음을 metadata.noveltyNote와 metadata.eventSignature에 명시하고 그 근거를 metadata.newsFeed.items 또는 sourceBasis/worldMemory.hits에 남긴다.",
    "- 최근 기사와 같은 이슈처럼 보이면 내부적으로 LLM novelty judge를 수행한다: same_event이면 쓰지 않고, independent_followup이면 새 근거 앵커와 달라진 메커니즘을 metadata에 남기며, unrelated이면 별도 기사로 둔다. 사진, 제목, storyFamily 변경만으로 independent_followup이라고 판단하지 않는다.",
    "- 최근 업로드 기사와 storyFamily 및 editorialAngle이 모두 같으면 중복 위험이 높다. follow-up이라도 noveltyNote에 무엇이 새로 생겼는지 명시할 수 없으면 생성하지 않는다.",
    "- metadata.topics는 config/magazine-topics.json의 topics[].label 중 1~3개만 사용한다. 1개 주 토픽은 반드시 고르고, 보조 토픽은 정말 강할 때만 최대 2개까지 붙인다. 3개는 목표가 아니라 상한이다.",
    "- 기사마다 sourceBasis를 5개 이상 채우고, 본문에는 직접 인용 또는 필요한 출처 귀속을 보통 4회 안팎으로 넣는다. 이것은 글의 균형을 잡기 위한 목표이지, 기계적인 quote block 또는 간접인용 할당량이 아니다.",
    "- 기사 핵심과 관련 있는 인물·기업·기관·정책당국·분석가·트레이더의 실제 발언을 발견했다면 익명 요약으로 뭉개지 말고 반드시 처리한다. 정확한 원문이 확인되면 간접요약을 먼저 쓰지 말고 직접 인용을 우선한다. 반복 위험은 직접인용을 없애서 피하지 말고, 앞의 간접요약을 시장 맥락 문장으로 바꿔 해결한다.",
    "- 직접인용이 0개인 기사는 예외다. 리서치상 검증 가능한 이해관계자 발언이 정말 없고 데이터·가격 반응·공시 사실만으로 기사 가치가 충분할 때만 quote-free로 둔다.",
    "- 직접 인용을 쓸 때는 같은 claim을 직전 또는 같은 문단에서 간접귀속으로 먼저 설명하지 않는다. 직접인용이 그 발언의 첫 제시가 되어야 하며, 인용 뒤 문장은 반복 요약이 아니라 분석·반론·시장 메커니즘으로 넘어가야 한다.",
    "- 인용·귀속은 본문이 이미 설명한 내용을 반복하는 장식으로 넣지 않는다. 새 사실, 이해관계자 관점, 수치의 의미, 반론, 비용 부담자, 다음 문단의 전환 중 하나를 반드시 제공해야 한다.",
    "- 인용 앞 문장은 왜 그 목소리가 필요한지 만들어 주고, 인용 뒤 문장은 그 발언을 받아 다음 분석으로 넘어가야 한다. 흐름을 바꾸지 못하는 인용은 짧은 간접 귀속으로 줄이거나 빼고 더 좋은 근거를 찾는다.",
    `- 송고 시각은 기사 소재 시각이 아니라 매거진 생성기가 지정한 현재 송고 시각을 사용한다. metadata.publishedAt, createdAt, updatedAt, uploadedAt, generatedAt을 임의 과거 시각으로 쓰지 않는다.`,
    `- 현재 production 기사 수는 ${existingArticleCount}개이고, 이번 첫 기사까지 포함하면 총 ${firstGeneratedTotalCount}개다.`,
    "- 커버스토리 초기 채우기 정책: 이번 기사까지 포함한 총 기사 수가 5개 이하인 개별 기사는 채점하지 말고 바로 metadata.isCoverStory=true로 둔다. 이때 coverDecision.mode='bootstrap-cover-fill', scorePolicy='not-scored-total-articles-lte-5', candidateScore=null, bestPreviousScore=null로 둔다.",
    "- 총 기사 수가 6개 이상이 되는 기사부터 커버스토리 승격은 별도 판단이다. 새 기사를 최근 업로드 기사 비교창의 지난 최대 5개 기사와 비교해, 현재 시장에서 가장 중요한 이슈 또는 가장 최근의 이슈에 새 기사가 가장 가깝다고 판단될 때만 metadata.isCoverStory=true로 둔다.",
    "- 커버로 올릴 때는 metadata.coverRegisteredAt을 현재 생성 시각으로 저장하고 metadata.coverDecision을 남긴다. 채점 모드 coverDecision 형식: {\"policy\":\"world-memory-cover-v1\",\"result\":\"promote\",\"evaluatedAt\":\"ISO timestamp\",\"comparisonWindow\":{\"basis\":\"upload-time\",\"articleLimit\":5,\"articleIds\":[\"...\"]},\"worldMemorySignals\":{\"mostImportantIssue\":\"...\",\"mostRecentIssue\":\"...\",\"query\":\"...\",\"hitIds\":[\"...\"]},\"candidateScore\":0-100,\"bestPreviousScore\":0-100 또는 null,\"rationale\":\"왜 새 기사가 비교창 안에서 가장 커버에 가까운지\"}. worldMemorySignals는 감사용 필드명일 뿐이며 rationale 문장에는 내부 레이어명을 쓰지 않는다.",
    "- 커버가 아니면 metadata.isCoverStory=false, coverRegisteredAt=null로 둔다. coverDecision을 남긴다면 result는 do-not-promote여야 한다.",
    "- 히어로 이미지는 기사와 직접 관련 있는 실제 무료/오픈 이미지, 공식 이미지, 또는 개인 열람용 보도사진을 사용한다. SVG, 생성 벡터, 목업 이미지는 금지한다.",
    "- metadata.heroImage에는 src, alt, credit, sourceUrl 또는 pageUrl, license/rights/usagePolicy/usageNote 중 하나를 반드시 저장한다.",
    "- 이미지를 로컬에 저장할 때는 assets/ 아래 jpg, jpeg, png, webp, avif 비트맵 파일로 저장한다. 개인 열람용 보도사진이면 usageNote에 editorial-private-use와 원출처를 남긴다.",
    "- 이미지 소싱 절차: 무료/오픈 이미지, 공식 이미지, 공개 보도사진 후보를 모두 검토한다. 오픈/공식 이미지가 기사 맥락을 충분히 담으면 우선 사용하고, 인물·특정 사건처럼 보도사진이 더 정확한 경우에는 개인 열람용 보도사진을 사용할 수 있다.",
    "- 이미지 검색 예산: search_web는 최대 3회까지만 사용한다. 적절한 후보 페이지를 찾으면 더 검색하지 말고 즉시 이미지 URL 확보와 다운로드 검증으로 넘어간다. 오픈 이미지 후보가 부정확하면 공식 이미지 또는 개인 열람용 보도사진 후보로 전환한다.",
    "- 이미지 파일 확보 절차: Wikimedia Commons는 Special:FilePath 또는 upload.wikimedia.org 직접 URL을 쓰고, 공식/보도사진은 원본 이미지 URL이나 페이지에서 확인되는 대표 이미지를 curl -L --fail --show-error -A 'FinanceAgentGUI/1.0' -o assets/<name>.<ext> 형태로 저장한다.",
    "- 개인 열람용 보도사진을 쓰면 metadata.heroImage.usageNote에 'editorial-private-use; local personal reading only'와 원출처를 남긴다. 오픈/공식 이미지면 license/rights를 남긴다.",
    "- 다운로드 뒤에는 file, ls -lh, strict check로 실제 비트맵인지 확인한다. 다운로드가 실패하면 1px placeholder나 빈 파일을 만들지 말고 실패 원인과 실행한 명령을 보고한다.",
    "- 기사마다 본문 텍스트는 공백 제외 한국어 3,000자 이상을 목표로 한다. 수치, 이해관계자 발언, 반론, 다음 데이터 포인트로 분량을 늘리되 filler는 쓰지 않는다.",
    "- 직접 인용은 검증된 출처일 때만 쓴다. 검증된 직접 발언이 있으면 간접인용을 덧붙여 같은 뜻을 반복하지 않는다. 확실하지 않으면 따옴표를 쓰지 말고 필요한 만큼만 짧게 간접 귀속한다.",
    "- 매체명·기관명·사람 이름은 한국어 독자가 자연스럽게 읽는 표기를 우선한다. 널리 알려진 이름에 원어 괄호를 기계적으로 붙이지 않는다. 낯선 고유명사나 약어의 식별에 도움이 될 때만 첫 등장에 한국어명(원어명·약어)을 덧붙인다.",
    "- 존대말로 쓰되 독자를 가르치거나 훈계하지 않는다.",
    "- '투자자'는 해외 투자자, 채권 투자자, 기관투자자처럼 기사 속 제3자 시장 참여자를 말할 때만 쓴다. 독자를 '투자자', '투자자 여러분'이라고 부르거나 '투자자는 ...해야 합니다/봐야 합니다/확인해야 합니다'처럼 호명하지 않는다.",
    "- 글의 후반부에서는 소제목 유무와 관계없이 독자에게 무엇을 봐야/확인해야/점검해야/주목해야 한다고 말하지 않는다. 앞으로의 변수는 시장의 미해결 긴장, 가격 반응, 증거가 아직 붙지 않은 대목으로 서술한다.",
    "- 글의 끝을 '다음 확인 지점', '앞으로 볼 것', '남은 확인 변수' 같은 소제목 아래 여러 문단의 체크리스트로 묶지 않는다.",
    "- 독자 지시 여부는 별도 LLM 분류 패스가 metadata.readerToneDecision에 저장한다. 기사 작성자는 키워드/정규식 회피가 아니라 의미상 독자에게 과제를 주지 않는 문장을 쓴다.",
    "- 사망, 전쟁, 테러리즘, 심각한 수준의 시장 붕괴처럼 가혹한 상황을 다루는 기사가 아니라면 본문에는 Bloomberg 뉴스레터 스타일의 절제된 유머와 위트를 어느 정도 담는다. 위트는 장식이 아니라 시장 메커니즘을 더 선명하게 보이게 해야 한다.",
    "- 인용은 본문과 유기적으로 연결될 때만 쓴다. 본문과 인용이 같은 말을 반복하면 padding으로 간주하고, 간접귀속을 줄인 뒤 직접인용 또는 더 구체적인 수치·반론·현장 맥락 중 하나를 선택한다.",
    "- 인용 흐름 여부는 별도 LLM 분류 패스가 metadata.quoteFlowDecision에 저장한다. 기사 작성자는 키워드/따옴표 개수 회피가 아니라 의미상 같은 claim을 반복하지 않는 문장을 쓴다.",
    count > 1
      ? `- 이번 생성 묶음 ${count}개가 같은 storyFamily에 몰리지 않도록 issue slate를 내부적으로 잡는다.`
      : "- 이미 같은 issue 안에 생성된 기사와 storyFamily, editorialAngle, 제목 구도가 겹치지 않게 한다.",
    "",
    "참고 근거 묶음:",
    newsFeedCandidates,
    "",
    worldMemorySignals,
    "",
    "최근 업로드 기사 비교창:",
    recentArticles,
    "- 위 비교창은 실제 업로드 시간 기준이다. 중복/참신성 판단에도 이 비교창을 사용한다.",
    "- coverDecision.comparisonWindow.articleIds는 이 비교창의 article-id만 사용한다.",
    "- 생성 뒤 node scripts/magazine_article_style_check.mjs --strict 를 통과시킨다. warning도 실패로 간주하고, 경고가 있으면 article.html/metadata.json을 고친 뒤 다시 검사한다.",
    "",
    "출력:",
    "- 최종 답변은 생성한 article-id, 본문 저장 여부, 검증 결과만 짧게 한국어로 보고한다.",
    "- 독자-facing deck, summary, article.html과 metadata의 prose 필드에서는 내부 출처명을 한 단어로 기계 치환하지 말고 신문 기사 문장으로 풀어 쓴다. 예: 'Bloomberg가 전한 장중 보도', '같은 날 나온 ISNA 인용 발언', '새 가격 반응', '새 기업 공시', '최근 현지 매체 보도'.",
    "- 독자-facing deck, summary, article.html과 metadata의 prose 필드에는 'World Memory', '월드 메모리', '월드메모리', '월드 메모리 벡터 검색 결과', 'News Feed', 'post-cutoff', 'post-World-Memory-update', '컷오프', '수집 기사', '피드', 'semantic-search', '하네스' 같은 내부 표현을 쓰지 않는다.",
    extraPrompt ? `\n추가 사용자 지시:\n${extraPrompt}` : "",
  ].join("\n");
}

function buildPrompt({ harnessProfile = DEFAULT_HARNESS_PROFILE, ...options }) {
  return normalizeHarnessProfile(harnessProfile) === LEGACY_HARNESS_PROFILE
    ? buildLegacyPrompt(options)
    : buildV2Prompt(options);
}

function truncateForPrompt(text, limit = 6000) {
  const value = String(text || "").trim();
  if (value.length <= limit) return value;
  return `${value.slice(0, limit)}\n...<truncated>`;
}

function buildV2RepairPrompt({ count, checkOutput, articleDirectory, staged, agentLabel = "Codex CLI" }) {
  return [
    `너는 FinanceAgentGUI 배포본 안에서 실행되는 ${agentLabel} v2 기사 수리 편집자다.`,
    `현재 ${articleDirectory} 아래 기사 폴더 정확히 ${count}개를 유지한다.`,
    staged ? "production data/magazine/articles/는 직접 수정하지 않는다." : "",
    "새 기사 폴더를 만들거나 기존 폴더를 삭제하지 않는다.",
    "config/magazine-article-style-v2.prompt.md와 config/magazine-longform-editorial-standard.prompt.md를 기준으로 아래 blocking error만 수정한다.",
    "advisory는 자동 수정 명령이 아니다. 글자 수, 문단 수, H2 리듬, 위트, 인용 수, sourceBasis 5+ 목표를 맞추기 위한 문장을 추가하지 않는다.",
    "longform 커미션 미이행이 blocking이면 문장을 조금 늘리는 방식으로 수리하지 않는다. 부족하다고 지적된 논제·근거 기능·반론·역사 또는 제도 맥락·구체적 결과를 조사하고 논증 구조를 다시 세운다.",
    "pervasive-unidiomatic-korean blocking이면 단어 치환이나 문장별 윤문으로 수리하지 않는다. 확인된 사실·행위자·인과관계·반론·불확실성을 한국어 의미 지도로 다시 정리한 뒤 본문 전체를 전면 재작성한다.",
    "본문과 무관한 이미지·메타데이터 오류라면 article.html을 다시 쓰지 않는다.",
    "본문을 수정하면 metadata.title은 빈 문자열로 되돌린다. 생성기가 수정된 본문에서 제목을 다시 확정한다.",
    "사실, 출처, 인용을 새로 만들지 않는다. 근거가 부족한 주장은 삭제·완화하거나 실제 근거를 조사해 보강한다.",
    "",
    "v2 quality check 출력:",
    "```text",
    truncateForPrompt(checkOutput, 12000),
    "```",
    "",
    "실제 파일을 수정한 뒤 수정한 article-id와 blocking error 처리 결과만 짧게 보고한다.",
  ].filter(Boolean).join("\n");
}

function buildLegacyRepairPrompt({ count, checkOutput, articleDirectory, staged, agentLabel = "Codex CLI" }) {
  const recentArticles = recentArticleWindowSummary(12);
  const newsFeedCandidates = postWorldMemoryNewsFeedSummary();
  const worldMemorySignals = worldMemoryCurrentSignalSummary(8);
  return [
    `너는 FinanceAgentGUI 배포본 안에서 실행되는 ${agentLabel} 기사 보강 작업자다.`,
    "작업 루트는 GuiBuild이며, 런타임 기사 데이터만 수정한다.",
    "",
    "목표:",
    `- 현재 ${articleDirectory} 아래에 있는 기사 폴더 정확히 ${count}개를 유지한다.`,
    "- 새 기사 폴더를 만들지 말고, 기존 기사 폴더를 삭제하지 않는다.",
    staged ? "- production data/magazine/articles/는 직접 수정하지 않는다." : "",
    "- 기존 metadata.json의 storyFamily, sourceBasis, worldMemory.vectorSearch.hits는 보존하거나 더 정확하게 보강한다.",
    "- article.html과 필요한 metadata.json만 수정해서 strict style check를 통과시킨다.",
    "- metadata.title은 본문 보강 뒤 별도 제목 확정 단계가 다시 쓴다. repair 작업자는 제목 문구나 제목 전용 규칙을 만들지 않는다.",
    "",
    "반드시 먼저 읽을 파일:",
    "- docs/magazine.md",
    "- config/magazine-article-style.prompt.md",
    "- config/magazine-topics.json",
    "",
    "보강 원칙:",
    "- 본문 공백 제외 3,000자 미만인 기사는 실제 근거, 이해관계자 발언, 수치, 반론, 다음 데이터 포인트로 확장한다.",
    "- 기사 핵심과 관련 있는 실제 발언이 metadata.sourceBasis, 기사 본문, 리서치 근거에 있는데 본문에서 익명 요약으로만 처리됐다면 정확한 원문이 확인되는 경우 직접 인용으로 복구한다. 정확한 표현이 확인되지 않을 때만 짧은 명시적 간접 귀속으로 둔다.",
    "- quote-flow 수리를 직접인용 삭제로 해결하지 않는다. 반복이 문제라면 직접인용을 남기고 앞의 간접요약을 줄이거나 시장 맥락 문장으로 바꾼다.",
    "- 본문에는 직접 인용 또는 필요한 출처 귀속을 보통 4회 안팎으로 확보한다. 다만 고정 횟수를 채우기 위한 장식 인용이나 간접인용은 넣지 말고, 출처 목소리가 기사 흐름을 실제로 앞으로 밀 때만 추가한다.",
    "- 직접 인용을 보강할 때는 같은 claim을 앞 문장에서 간접요약하지 않는다. 이미 간접요약 뒤에 직접인용이 붙어 있다면 둘 중 하나를 고르되, 원문이 검증된 경우 직접인용을 남기고 앞의 간접요약을 삭제하거나 시장 맥락 문장으로 바꾼다.",
    "- 인용·귀속을 보강할 때는 앞 문장이 그 목소리의 필요성을 만들고, 뒤 문장이 그 발언을 받아 다음 분석으로 넘어가게 고친다. 인용마다 새 사실, 반론, 이해관계자 관점, 수치 해석, 비용 부담자 중 하나를 추가해야 한다.",
    "- 토픽 하네스가 실패했다면 metadata.topics를 config/magazine-topics.json의 topics[].label 중 1~3개로만 고친다. 1개 주 토픽은 반드시 남기고, 4개 이상 반환했다면 앞의 3개만 남긴다.",
    "- 최근 보도 근거를 보강하거나 새로 붙일 때는 기준 업데이트 이후 항목만 사용한다. 과거 보도 항목을 근거로 쓰지 않는다.",
    "- 감사용 메타데이터에는 metadata.newsFeed.selectionPolicy='post-world-memory-update-only', worldMemoryLastSuccessfulAt, items[]를 남긴다. 단, 이 필드명과 레이어 구분을 deck, summary, article.html, noveltyNote, coverDecision.rationale, sourceBasis prose에 쓰지 않는다.",
    "- metadata.eventSignature가 없거나 기사 전체 요약처럼 길게 쓰였으면 claimlet 형식으로 보강한다: role, actor, action, object[], time, marketMechanism, sourceIds[]. 복수 카드가 필요하면 eventSignatures[]에 primary 1개와 supporting 0개 이상을 둔다.",
    "- duplicate-news-feed-anchor, duplicate-world-memory-anchor, duplicate-story-angle이 나오면 기사 제목만 바꾸지 말고 실제로 다른 사건/다른 메커니즘으로 바꾼다. 독립 델타가 없으면 해당 기사 폴더를 새 비중복 주제로 다시 작성한다.",
    "- 독립 델타는 기사 전체 임베딩 거리가 아니라 새 근거 앵커다. 새 보도 id, 새 공식/외부 출처 URL, 새 수치, 새 정책 집행, 새 가격 반응, 새 기업 행동 중 적어도 하나가 이전 기사 이후 발생해야 한다.",
    "- primary worldMemory eventId가 겹친다는 이유만으로 정상 follow-up을 버리지 않는다. 대신 same_event / independent_followup / unrelated로 의미 판정하고, same_event이면 새 비중복 주제로 다시 작성한다.",
    "- 커버스토리 하네스가 실패했다면 docs/magazine.md와 config/magazine-article-style.prompt.md의 Cover Story Promotion Policy를 따른다. isCoverStory=true인 기사는 coverRegisteredAt과 metadata.coverDecision을 보강하고, 커버가 아니면 isCoverStory=false 및 coverRegisteredAt=null로 정리한다.",
    "- 총 기사 수가 5개 이하인 초기 구간에서는 커버스토리 채점을 하지 않는다. bootstrap-cover-fill이면 candidateScore와 bestPreviousScore를 null로 둔다.",
    "- 히어로 이미지가 SVG, 생성 벡터, 목업, 앱 자체 크레딧, 출처/권리 메타데이터 누락으로 실패했다면 기사와 직접 관련 있는 실제 무료/오픈 이미지, 공식 이미지, 또는 개인 열람용 보도사진으로 교체한다.",
    "- metadata.heroImage에는 src, alt, credit, sourceUrl 또는 pageUrl, license/rights/usagePolicy/usageNote 중 하나를 반드시 저장한다. 로컬 저장 시 assets/ 아래 jpg, jpeg, png, webp, avif 비트맵 파일을 사용한다.",
    "- 이미지 수리 절차: 무료/오픈 이미지, 공식 이미지, 공개 보도사진 후보를 모두 검토한다. search_web는 최대 3회까지만 사용하고, 후보 페이지를 찾으면 더 검색하지 말고 이미지 URL 확보와 다운로드 검증으로 넘어간다. Wikimedia Commons는 Special:FilePath 또는 upload.wikimedia.org 직접 URL을 쓰고, 공식/보도사진은 원본 이미지 URL이나 페이지에서 확인되는 대표 이미지를 curl -L --fail --show-error -A 'FinanceAgentGUI/1.0' -o assets/<name>.<ext> 형태로 저장한다. 저장 후 file, ls -lh, strict check를 실행한다.",
    "- 개인 열람용 보도사진을 쓰면 metadata.heroImage.usageNote에 'editorial-private-use; local personal reading only'와 원출처를 남긴다. 오픈/공식 이미지면 license/rights를 남긴다.",
    "- 이미지 다운로드가 실패하면 1px placeholder나 빈 JPEG를 만들지 말고, 실패한 URL/명령/오류를 최종 답변에 남긴다.",
    "- 독자-facing deck, summary, article.html과 metadata의 prose 필드에서는 내부 출처명을 한 단어로 기계 치환하지 말고 신문 기사 문장으로 풀어 쓴다. 예: 'Bloomberg가 전한 장중 보도', '같은 날 나온 ISNA 인용 발언', '새 가격 반응', '새 기업 공시', '최근 현지 매체 보도'.",
    "- 독자-facing deck, summary, article.html과 metadata의 prose 필드에는 'World Memory', '월드 메모리', '월드메모리', '월드 메모리 벡터 검색 결과', 'News Feed', 'post-cutoff', 'post-World-Memory-update', '컷오프', '수집 기사', '피드', 'semantic-search', '하네스' 같은 내부 표현을 쓰지 않는다.",
    "- 존대말을 유지하되 독자를 가르치거나 훈계하는 문장을 줄인다.",
    "- '투자자'는 기사 속 제3자 시장 참여자를 말할 때만 쓰고, 독자를 '투자자'나 '투자자 여러분'으로 부르지 않는다. '투자자는 ...해야 합니다/봐야 합니다/확인해야 합니다' 같은 문장은 반드시 고친다.",
    "- 글의 후반부에서 소제목 유무와 관계없이 독자에게 무엇을 봐야/확인해야/점검해야/주목해야 한다고 말하는 문장은 반드시 고친다. 시장의 미해결 긴장, 가격 반응, 증거가 아직 붙지 않은 대목으로 바꾼다.",
    "- '다음 확인 지점', '앞으로 볼 것', '남은 확인 변수' 같은 소제목 아래 여러 문단의 독자 체크리스트가 있으면 소제목과 문단을 함께 고친다.",
    "- reader-tone strict failure는 키워드 치환으로 고치지 않는다. 발화 주체와 독자 지시 여부를 의미상 분리하고, 제3자 발언 귀속은 살리되 독자에게 과제를 주는 문장만 관찰/함의 문장으로 고친다.",
    "- quote-flow strict failure도 키워드 치환으로 고치지 않는다. 같은 claim의 간접 후 직접 반복인지 의미상 판정하고, 직접인용을 남길 때는 앞의 간접요약을 줄이며, 간접귀속은 원문이 불확실한 경우나 짧은 출처 표시로 제한한다. direct_quote_avoidance 실패라면 검증된 발언을 찾아 직접인용으로 복구한다.",
    "- 사망, 전쟁, 테러리즘, 심각한 수준의 시장 붕괴처럼 가혹한 상황이 아닌데 본문이 건조한 요약문처럼 보이면 Bloomberg 뉴스레터 스타일의 절제된 유머와 위트를 보강한다. 위트는 시장 메커니즘을 선명하게 하는 문장으로만 넣는다.",
    "- 생성 뒤 node scripts/magazine_article_style_check.mjs --strict 를 실행하고 warning 0개가 될 때까지 수정한다.",
    "",
    "참고 근거 묶음:",
    newsFeedCandidates,
    "",
    worldMemorySignals,
    "",
    "최근 업로드 기사 비교창:",
    recentArticles,
    "",
    "직전 strict check 출력:",
    "```text",
    truncateForPrompt(checkOutput),
    "```",
    "",
    "최종 답변은 수정한 article-id와 strict 검증 결과만 짧게 한국어로 보고한다.",
  ].join("\n");
}

function buildRepairPrompt({ harnessProfile = DEFAULT_HARNESS_PROFILE, ...options }) {
  return normalizeHarnessProfile(harnessProfile) === LEGACY_HARNESS_PROFILE
    ? buildLegacyRepairPrompt(options)
    : buildV2RepairPrompt(options);
}

async function runCommand(command, args, options = {}) {
  return new Promise((resolveCommand, reject) => {
    const spawnCommand = options.llm ? spawnObservedLlm : spawn;
    const child = spawnCommand(command, args, {
      cwd: options.cwd || GUIBUILD_ROOT,
      env: { ...process.env, NO_COLOR: "1", ...(options.env || {}) },
      stdio: ["ignore", "pipe", "pipe"],
    }, ...(options.llm ? [options.llm] : []));
    let stdout = "";
    let stderr = "";
    const timeoutMs = options.timeoutMs || 0;
    const timer = timeoutMs
      ? setTimeout(() => {
          child.kill("SIGTERM");
          reject(new Error(`${command} timed out after ${timeoutMs}ms`));
        }, timeoutMs)
      : null;

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
      process.stdout.write(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
      process.stderr.write(chunk);
    });
    child.on("error", (error) => {
      if (timer) clearTimeout(timer);
      reject(error);
    });
    child.on("close", async (code) => {
      if (timer) clearTimeout(timer);
      if (options.llm) {
        try {
          await waitForLlmObservation(child);
        } catch (error) {
          reject(error);
          return;
        }
      }
      if (code !== 0) {
        const error = new Error((stderr || stdout || `${command} exited ${code}`).trim());
        error.code = code;
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
        return;
      }
      resolveCommand({ stdout, stderr });
    });
  });
}

async function runEventSignatureEmbeddingCheck({ articleDirectory, staged, existingArticleCount, timeoutMs = 600000 }) {
  const python = findPythonCommand();
  if (!python) {
    console.warn("Magazine event-signature embedding check skipped: python runtime not found.");
    return;
  }
  const args = [
    ...python.argsPrefix,
    "scripts/magazine_event_signature_index.py",
    "check",
    "--articles-dir",
    articleDirectory,
    "--index-path",
    join(MAGAZINE_DATA_DIR, "event-signature-index.sqlite3"),
    "--mode",
    process.env.MAGAZINE_EVENT_SIGNATURE_EMBEDDING_MODE || "auto",
  ];
  if (staged && existingArticleCount > 0) {
    args.push("--baseline-articles-dir", ARTICLES_DIR, "--baseline-limit", "12");
  }
  if (process.env.MAGAZINE_EVENT_SIGNATURE_STRICT === "1") {
    args.push("--strict");
  }
  await runCommand(python.command, args, {
    cwd: GUIBUILD_ROOT,
    timeoutMs,
  });
}

export function buildCodexArgs({ approval, sandbox, model, reasoning, speed = "standard", outputPath, prompt, persistSession = false, jsonEvents = false }) {
  return [
    "--ask-for-approval",
    approval,
    "exec",
    "--skip-git-repo-check",
    ...(persistSession ? [] : ["--ephemeral"]),
    "-C",
    GUIBUILD_ROOT,
    "-s",
    sandbox,
    "-m",
    model,
    "-c",
    `model_reasoning_effort="${reasoning}"`,
    ...codexServiceTierArgs(speed),
    ...(jsonEvents ? ["--json"] : []),
    "-o",
    outputPath,
    prompt,
  ];
}

export function buildCodexResumeArgs({ sessionId, model, reasoning, speed = "standard", outputPath, prompt, jsonEvents = false }) {
  return [
    "exec",
    "resume",
    sessionId,
    "-m",
    model,
    "-c",
    `model_reasoning_effort="${reasoning}"`,
    ...codexServiceTierArgs(speed),
    ...(jsonEvents ? ["--json"] : []),
    "-o",
    outputPath,
    prompt,
  ];
}

export function extractCodexSessionId({ stdout = "", stderr = "" } = {}) {
  for (const line of String(stdout || "").split(/\r?\n/)) {
    try {
      const event = JSON.parse(line);
      const sessionId = event?.thread_id || event?.threadId || event?.thread?.id || event?.session_id || event?.sessionId;
      if (event?.type === "thread.started" && /^[0-9a-f-]{36}$/i.test(String(sessionId || ""))) return String(sessionId);
    } catch {
      // Non-JSON progress output is allowed.
    }
  }
  const humanMatch = String(stderr || "").match(/session id:\s*([0-9a-f-]{36})/i);
  return humanMatch ? humanMatch[1] : "";
}

async function runCodexPrompt({ codex, approval, sandbox, model, reasoning, speed, outputPath, prompt, timeoutMs, persistSession = false, resumeSessionId = "" }) {
  const jsonEvents = persistSession || Boolean(resumeSessionId);
  const args = resumeSessionId
    ? buildCodexResumeArgs({ sessionId: resumeSessionId, model, reasoning, speed, outputPath, prompt, jsonEvents })
    : buildCodexArgs({ approval, sandbox, model, reasoning, speed, outputPath, prompt, persistSession, jsonEvents });
  const commandResult = await runCommand(codex, args, {
    cwd: GUIBUILD_ROOT,
    timeoutMs,
    llm: {
      feature: "magazine-agent-pass",
      provider: CODEX_PROVIDER_ID,
      model,
      timeoutMs,
    },
  });
  const finalAnswer = existsSync(outputPath) ? readFileSync(outputPath, "utf8").trim() : "";
  if (finalAnswer) {
    console.log("\n--- Codex final answer ---");
    console.log(finalAnswer);
  }
  return {
    ...commandResult,
    sessionId: resumeSessionId || extractCodexSessionId(commandResult),
  };
}

function antigravitySecurityArgs(approval) {
  return String(approval || "").trim().toLowerCase() === "turbo"
    ? ["--dangerously-skip-permissions"]
    : [];
}

function antigravityPrintTimeout() {
  return String(process.env.ANTIGRAVITY_CLI_PRINT_TIMEOUT || "30m").trim() || "30m";
}

function antigravityCliVersion(command) {
  const result = spawnSync(command, ["--version"], {
    cwd: GUIBUILD_ROOT,
    encoding: "utf8",
    timeout: 5000,
    maxBuffer: 64 * 1024,
    env: { ...process.env, NO_COLOR: "1" },
  });
  if (result.error || result.status !== 0) return "";
  return String(result.stdout || result.stderr || "").trim();
}

async function runAntigravityPrompt({
  approval,
  model,
  outputPath,
  prompt,
  timeoutMs,
}) {
  const agy = findAntigravityCommand();
  const invocation = antigravityPrintInvocation({
    cliVersion: antigravityCliVersion(agy),
    model: cleanAntigravityModel(model),
    printTimeout: antigravityPrintTimeout(),
    prompt,
    securityArgs: antigravitySecurityArgs(approval),
  });

  return new Promise((resolvePrompt, reject) => {
    const child = spawnObservedLlm(agy, invocation.args, {
      cwd: GUIBUILD_ROOT,
      env: { ...process.env, NO_COLOR: "1" },
      stdio: invocation.stdio,
    }, {
      feature: "magazine-agent-pass",
      provider: ANTIGRAVITY_PROVIDER_ID,
      model,
      timeoutMs,
    });
    let stdout = "";
    let stderr = "";
    const timer = timeoutMs
      ? setTimeout(() => {
          child.kill("SIGTERM");
          reject(new Error(`Antigravity CLI timed out after ${timeoutMs}ms`));
        }, timeoutMs)
      : null;

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
      process.stdout.write(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
      process.stderr.write(chunk);
    });
    child.stdin?.once("error", (error) => {
      if (timer) clearTimeout(timer);
      reject(error);
    });
    child.on("error", (error) => {
      if (timer) clearTimeout(timer);
      reject(error);
    });
    child.on("close", async (code) => {
      if (timer) clearTimeout(timer);
      try {
        await waitForLlmObservation(child);
      } catch (error) {
        reject(error);
        return;
      }
      if (code !== 0) {
        const error = new Error((stderr || stdout || `Antigravity CLI exited ${code}`).trim());
        error.code = code;
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
        return;
      }
      writeFileSync(outputPath, stdout.trim() ? `${stdout.trim()}\n` : "", "utf8");
      const finalAnswer = existsSync(outputPath) ? readFileSync(outputPath, "utf8").trim() : "";
      if (finalAnswer) {
        console.log("\n--- Antigravity final answer ---");
        console.log(finalAnswer);
      }
      resolvePrompt({ stdout, stderr });
    });
    if (invocation.stdin !== null) child.stdin.end(invocation.stdin);
  });
}

async function runAgentPrompt({ provider, ...options }) {
  if (isAntigravityProvider(provider)) {
    return runAntigravityPrompt(options);
  }
  return runCodexPrompt(options);
}

function articleIdsIn(articleDirectory) {
  if (!existsSync(articleDirectory)) return [];
  return readdirSync(articleDirectory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function assertArticleCount(articleDirectory, expectedCount) {
  const ids = articleIdsIn(articleDirectory);
  if (ids.length !== expectedCount) {
    throw new Error(`expected ${expectedCount} article folder(s) in ${articleDirectory}, found ${ids.length}: ${ids.join(", ")}`);
  }
  return ids;
}

function stagedArticleSummary(articleDirectory) {
  const lines = [];
  for (const articleId of articleIdsIn(articleDirectory)) {
    const metadataPath = join(articleDirectory, articleId, "metadata.json");
    if (!existsSync(metadataPath)) {
      lines.push(`- ${articleId}`);
      continue;
    }
    try {
      const metadata = JSON.parse(readFileSync(metadataPath, "utf8"));
      lines.push(
        `- ${articleId}: ${metadata.title || ""} / storyFamily=${metadata.storyFamily || metadata.storyKey || ""} / editorialAngle=${metadata.editorialAngle || ""}`,
      );
    } catch {
      lines.push(`- ${articleId}`);
    }
  }
  return lines.length ? lines.join("\n") : "- 아직 생성된 기사가 없다.";
}

function buildSequentialPrompt({ articleIndex, count, articleDirectory, agentLabel, harnessProfile, lockedTopic }) {
  return [
    buildPrompt({ count: 1, replace: false, articleDirectory, staged: true, agentLabel, harnessProfile, lockedTopic }),
    "",
    "순차 생성 지시:",
    `- 이번은 전체 ${count}편 중 ${articleIndex}번째 기사다.`,
    "- 아래 이미 생성된 기사와 제목, storyFamily, editorialAngle, 핵심 데이터 포인트가 겹치지 않게 한다.",
    "- 이번 호출에서는 새 기사 폴더를 정확히 1개만 추가한다.",
    "- 생성 직후 article.html과 metadata.json을 실제로 저장한다.",
    "",
    "이미 staging에 생성된 기사:",
    stagedArticleSummary(articleDirectory),
  ].join("\n");
}

function qualityCheckEnvironment({ articleDirectory, staged, existingArticleCount }) {
  return {
    MAGAZINE_ARTICLES_DIR: articleDirectory,
    ...(staged && existingArticleCount > 0
      ? {
          MAGAZINE_BASELINE_ARTICLES_DIR: ARTICLES_DIR,
          MAGAZINE_BASELINE_ARTICLE_LIMIT: "12",
        }
      : {}),
  };
}

function blockingEditorialReviewIssues(decisions) {
  const blockers = [];
  for (const [articleId, decision] of decisions.entries()) {
    for (const issue of decision.issues || []) {
      if (String(issue?.severity || "").toLowerCase() === "blocking") blockers.push({ articleId, ...issue });
    }
  }
  return blockers;
}

async function runWriterRepairRound({ provider, codex, approval, sandbox, model, reasoning, speed, outputPath, prompt, timeoutMs, tempDir, writerSessionId }) {
  return runAgentPrompt({
    provider,
    codex,
    approval,
    sandbox,
    model,
    reasoning,
    speed,
    outputPath,
    prompt,
    timeoutMs,
    tempDir,
    persistSession: !isAntigravityProvider(provider) && !writerSessionId,
    resumeSessionId: !isAntigravityProvider(provider) ? writerSessionId : "",
  });
}

async function runV2QualityWithRepair({ provider, codex, approval, sandbox, model, reasoning, speed, timeoutMs, tempDir, count, repairRounds, articleDirectory, staged, agentLabel, publishedAt, existingArticleCount, previousArticleIds, generationAgent, harnessProfile, writerSessionId, initialHeroPatches = new Map() }) {
  let currentWriterSessionId = writerSessionId;
  let reviewerSessionId = "";
  for (let attempt = 0; attempt <= repairRounds; attempt += 1) {
    console.log(`\nRunning Magazine v2 editorial review and hero-image finalization (attempt ${attempt + 1}/${repairRounds + 1})...`);
    normalizeGeneratedArticleMetadata(articleDirectory, publishedAt, { existingArticleCount, previousArticleIds, generationAgent });
    const parallelStartedAt = Date.now();
    const [reviewBundle, heroPatches] = await Promise.all([
      collectEditorialReviewDecisions({
        provider,
        codex,
        approval,
        sandbox: "read-only",
        model,
        reasoning: cleanCliValue(process.env.MAGAZINE_REVIEW_REASONING || reasoning, reasoning),
        speed,
        timeoutMs,
        tempDir,
        articleDirectory,
        agentLabel,
        resumeSessionId: reviewerSessionId,
      }),
      attempt === 0 && initialHeroPatches.size
        ? Promise.resolve(initialHeroPatches)
        : collectHeroImagePatches({
        provider,
        codex,
        approval,
        sandbox,
        model,
        reasoning: cleanCliValue(process.env.MAGAZINE_IMAGE_REASONING || "low", "low"),
        speed,
        timeoutMs,
        tempDir,
        articleDirectory,
        agentLabel,
        }),
    ]);
    console.log(`Magazine v2 review/image finalization finished in ${Date.now() - parallelStartedAt}ms.`);
    reviewerSessionId = reviewBundle.sessionId || reviewerSessionId;
    mergeV2FinalizerResults(articleDirectory, reviewBundle.decisions, heroPatches);

    const semanticBlockers = blockingEditorialReviewIssues(reviewBundle.decisions);
    if (semanticBlockers.length) {
      if (attempt >= repairRounds) {
        throw new Error(`Magazine v2 semantic review still has blocking issue(s): ${JSON.stringify(semanticBlockers)}`);
      }
      const repairNumber = attempt + 1;
      const repairOutputPath = join(tempDir, `${provider}-repair-${repairNumber}.txt`);
      const checkOutput = JSON.stringify({ profile: "v2", phase: "semantic-review", errors: semanticBlockers }, null, 2);
      console.warn(`\nMagazine v2 semantic review found blocking issue(s); resuming writer repair ${repairNumber}/${repairRounds}.`);
      const repairResult = await runWriterRepairRound({
        provider,
        codex,
        approval,
        sandbox,
        model,
        reasoning,
        speed,
        outputPath: repairOutputPath,
        prompt: buildRepairPrompt({ count, checkOutput, articleDirectory, staged, agentLabel, harnessProfile }),
        timeoutMs,
        tempDir,
        writerSessionId: currentWriterSessionId,
      });
      currentWriterSessionId = repairResult?.sessionId || currentWriterSessionId;
      continue;
    }

    console.log("\nRunning local Magazine v2 quality check...");
    try {
      await runCommand(process.execPath, ["scripts/magazine_article_quality_check.mjs", "--strict", "--json"], {
        cwd: GUIBUILD_ROOT,
        env: qualityCheckEnvironment({ articleDirectory, staged, existingArticleCount }),
        timeoutMs: 120000,
      });
    } catch (error) {
      const checkOutput = [error.stdout, error.stderr, error.message].filter(Boolean).join("\n").trim();
      const qualityReport = extractJsonObject(error.stdout || "");
      const qualityErrors = Array.isArray(qualityReport?.errors) ? qualityReport.errors : [];
      if (qualityErrors.length && qualityErrors.every((issue) => String(issue?.code || "").startsWith("hero-image-"))) {
        console.warn("\nMagazine v2 quality check found only hero-image errors; retrying image worker without rewriting the article.");
        const replacementHeroPatches = await collectHeroImagePatches({
          provider,
          codex,
          approval,
          sandbox,
          model,
          reasoning: cleanCliValue(process.env.MAGAZINE_IMAGE_REASONING || "low", "low"),
          speed,
          timeoutMs,
          tempDir,
          articleDirectory,
          agentLabel,
          force: true,
        });
        mergeV2FinalizerResults(articleDirectory, new Map(), replacementHeroPatches);
        await runCommand(process.execPath, ["scripts/magazine_article_quality_check.mjs", "--strict", "--json"], {
          cwd: GUIBUILD_ROOT,
          env: qualityCheckEnvironment({ articleDirectory, staged, existingArticleCount }),
          timeoutMs: 120000,
        });
        await runEventSignatureEmbeddingCheck({ articleDirectory, staged, existingArticleCount });
        return;
      }
      if (attempt >= repairRounds) throw error;
      const repairNumber = attempt + 1;
      const repairOutputPath = join(tempDir, `${provider}-repair-${repairNumber}.txt`);
      console.warn(`\nMagazine v2 structural/evidence check failed; resuming writer repair ${repairNumber}/${repairRounds}.`);
      const repairResult = await runWriterRepairRound({
        provider,
        codex,
        approval,
        sandbox,
        model,
        reasoning,
        speed,
        outputPath: repairOutputPath,
        prompt: buildRepairPrompt({ count, checkOutput, articleDirectory, staged, agentLabel, harnessProfile }),
        timeoutMs,
        tempDir,
        writerSessionId: currentWriterSessionId,
      });
      currentWriterSessionId = repairResult?.sessionId || currentWriterSessionId;
      continue;
    }

    await runEventSignatureEmbeddingCheck({ articleDirectory, staged, existingArticleCount });
    return;
  }
}

async function runStrictCheckWithRepair({ provider, codex, approval, sandbox, model, reasoning, speed, timeoutMs, tempDir, count, repairRounds, articleDirectory, staged, agentLabel, publishedAt, existingArticleCount, previousArticleIds, generationAgent, harnessProfile, writerSessionId = "", initialHeroPatches = new Map() }) {
  const legacyHarness = normalizeHarnessProfile(harnessProfile) === LEGACY_HARNESS_PROFILE;
  if (!legacyHarness) {
    return runV2QualityWithRepair({ provider, codex, approval, sandbox, model, reasoning, speed, timeoutMs, tempDir, count, repairRounds, articleDirectory, staged, agentLabel, publishedAt, existingArticleCount, previousArticleIds, generationAgent, harnessProfile, writerSessionId, initialHeroPatches });
  }

  for (let attempt = 0; attempt <= repairRounds; attempt += 1) {
    console.log("\nRunning local magazine legacy style check...");
    try {
      normalizeGeneratedArticleMetadata(articleDirectory, publishedAt, { existingArticleCount, previousArticleIds, generationAgent });
      await finalizeArticleTitles({
        provider,
        codex,
        approval,
        sandbox,
        model,
        reasoning,
        speed,
        timeoutMs,
        tempDir,
        articleDirectory,
        agentLabel,
      });
      await finalizeReaderToneDecisions({ provider, codex, approval, sandbox, model, reasoning, speed, timeoutMs, tempDir, articleDirectory, agentLabel });
      await finalizeQuoteFlowDecisions({ provider, codex, approval, sandbox, model, reasoning, speed, timeoutMs, tempDir, articleDirectory, agentLabel });
      await runCommand(process.execPath, ["scripts/magazine_article_style_check.mjs", "--strict"], {
        cwd: GUIBUILD_ROOT,
        env: qualityCheckEnvironment({ articleDirectory, staged, existingArticleCount }),
        timeoutMs: 120000,
      });
      await runEventSignatureEmbeddingCheck({
        articleDirectory,
        staged,
        existingArticleCount,
      });
      return;
    } catch (error) {
      const checkOutput = [error.stdout, error.stderr, error.message].filter(Boolean).join("\n").trim();
      if (attempt >= repairRounds) {
        throw error;
      }
      const repairNumber = attempt + 1;
      const repairOutputPath = join(tempDir, `${provider}-repair-${repairNumber}.txt`);
      console.warn(`\nMagazine legacy strict check failed; starting ${agentLabel} repair round ${repairNumber}/${repairRounds}.`);
      await runAgentPrompt({
        provider,
        codex,
        approval,
        sandbox,
        model,
        reasoning,
        speed,
        outputPath: repairOutputPath,
        prompt: buildRepairPrompt({ count, checkOutput, articleDirectory, staged, agentLabel, harnessProfile }),
        timeoutMs,
        tempDir,
      });
    }
  }
}

function publishGeneratedArticles({ stagingArticlesDir, replace }) {
  if (!existsSync(stagingArticlesDir)) {
    throw new Error(`missing staged article directory: ${stagingArticlesDir}`);
  }

  if (replace) {
    const backupDir = join(MAGAZINE_DATA_DIR, `.articles-backup-${Date.now()}-${process.pid}`);
    let backupCreated = false;
    try {
      if (existsSync(ARTICLES_DIR)) {
        renameSync(ARTICLES_DIR, backupDir);
        backupCreated = true;
      }
      renameSync(stagingArticlesDir, ARTICLES_DIR);
      if (backupCreated) rmSync(backupDir, { recursive: true, force: true });
      return;
    } catch (error) {
      if (!existsSync(ARTICLES_DIR) && backupCreated && existsSync(backupDir)) {
        renameSync(backupDir, ARTICLES_DIR);
      }
      throw error;
    }
  }

  mkdirSync(ARTICLES_DIR, { recursive: true });
  for (const entry of readdirSync(stagingArticlesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const source = join(stagingArticlesDir, entry.name);
    const target = join(ARTICLES_DIR, entry.name);
    if (existsSync(target)) {
      throw new Error(`article already exists: ${entry.name}`);
    }
    renameSync(source, target);
  }
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

function acquireGenerationLock() {
  if (existsSync(LOCK_PATH)) {
    try {
      const lock = JSON.parse(readFileSync(LOCK_PATH, "utf8"));
      if (processIsAlive(Number(lock.pid))) {
        throw new Error(`magazine generation is already running (pid ${lock.pid})`);
      }
    } catch (error) {
      if (/already running/.test(error.message)) throw error;
    }
    rmSync(LOCK_PATH, { force: true });
  }
  writeFileSync(
    LOCK_PATH,
    JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }, null, 2),
    "utf8",
  );
}

function releaseGenerationLock() {
  if (!existsSync(LOCK_PATH)) return;
  try {
    const lock = JSON.parse(readFileSync(LOCK_PATH, "utf8"));
    if (Number(lock.pid) !== process.pid) return;
  } catch {
    // If the lock is unreadable, remove it only from this generator cleanup path.
  }
  rmSync(LOCK_PATH, { force: true });
}

async function main() {
  const count = Number.parseInt(argValue("--count", "1"), 10) || 1;
  const replace = hasArg("--replace");
  const provider = cleanCliValue(argValue("--provider", process.env.MAGAZINE_AGENT_PROVIDER || CODEX_PROVIDER_ID), CODEX_PROVIDER_ID);
  const antigravity = isAntigravityProvider(provider);
  const agentLabel = agentLabelForProvider(provider);
  const model = antigravity
    ? cleanAntigravityModel(
        argValue(
          "--model",
          process.env.MAGAZINE_ANTIGRAVITY_CLI_MODEL ||
            process.env.MAGAZINE_ANTIGRAVITY_MODEL ||
            "Gemini 3.5 Flash (Medium)",
        ),
      )
    : cleanCliValue(
        argValue("--model", process.env.MAGAZINE_CODEX_MODEL || "gpt-5.5"),
        "gpt-5.5",
      );
  const reasoning = cleanCliValue(
    argValue("--reasoning", antigravity ? process.env.MAGAZINE_ANTIGRAVITY_REASONING || "medium" : process.env.MAGAZINE_CODEX_REASONING || "high"),
    antigravity ? "medium" : "high",
  );
  const speed = antigravity
    ? "standard"
    : normalizeCodexSpeed(argValue("--speed", process.env.MAGAZINE_CODEX_SPEED || "standard"));
  const approval = cleanCliValue(
    argValue("--approval", antigravity ? process.env.MAGAZINE_ANTIGRAVITY_APPROVAL || "turbo" : process.env.MAGAZINE_CODEX_APPROVAL || "never"),
    antigravity ? "turbo" : "never",
    /^[A-Za-z-]+$/,
  );
  const sandbox = cleanCliValue(argValue("--sandbox", process.env.MAGAZINE_CODEX_SANDBOX || "workspace-write"), "workspace-write", /^[A-Za-z-]+$/);
  const timeoutMs = Number.parseInt(argValue("--timeout-ms", process.env.MAGAZINE_CODEX_TIMEOUT_MS || "1800000"), 10) || 1800000;
  const repairRounds = Number.parseInt(argValue("--repair-rounds", process.env.MAGAZINE_CODEX_REPAIR_ROUNDS || "2"), 10) || 2;
  const harnessProfile = normalizeHarnessProfile(argValue("--harness", process.env.MAGAZINE_HARNESS_PROFILE || DEFAULT_HARNESS_PROFILE));
  const sequential = !hasArg("--batch") && process.env.MAGAZINE_CODEX_BATCH !== "1";
  const codex = antigravity ? "" : findCodexCommand();
  const tempDir = mkdtempSync(join(tmpdir(), `finance-agent-magazine-${antigravity ? "antigravity-cli" : "codex"}-`));
  const outputPath = join(tempDir, `${antigravity ? "antigravity-cli" : "codex"}-final.txt`);
  const stagingRoot = mkdtempSync(join(MAGAZINE_DATA_DIR, ".generation-stage-"));
  const stagingArticlesDir = join(stagingRoot, "articles");
  const publishedAt = nowKstIso();
  const existingArticleCount = replace ? 0 : articleCountIn(ARTICLES_DIR);
  const previousArticleIds = replace ? [] : recentArticleIds(5);
  const generationAgent = {
    provider,
    model,
    reasoning,
    speed,
    harnessProfile,
    pipeline: harnessProfile === LEGACY_HARNESS_PROFILE ? "legacy-sequential" : "v2-locked-topic-parallel-finalizers",
    label: agentLabel,
    editorialExemplars: harnessProfile === LEGACY_HARNESS_PROFILE
      ? []
      : approvedEditorialExemplars().map((exemplar) => exemplar.id),
  };
  mkdirSync(stagingArticlesDir, { recursive: true });

  if (!existsSync(ARTICLES_DIR)) {
    mkdirSync(ARTICLES_DIR, { recursive: true });
  }

  acquireGenerationLock();

  try {
    console.log(`Staging magazine articles in ${stagingArticlesDir}`);

    console.log(`Starting ${agentLabel} magazine generation: count=${count}, replace=${replace}, model=${model}, reasoning=${reasoning}, speed=${speed}, harness=${harnessProfile}, approval=${approval}, repairRounds=${repairRounds}, sequential=${sequential}, publishedAt=${publishedAt}`);
    const legacyHarness = harnessProfile === LEGACY_HARNESS_PROFILE;
    const configuredLockedTopic = legacyHarness ? null : lockedTopicFromEnvironment();
    let writerSessionId = "";
    let initialHeroPatches = new Map();
    if (sequential && count > 1) {
      for (let articleIndex = 1; articleIndex <= count; articleIndex += 1) {
        const articleLockedTopic = legacyHarness
          ? null
          : articleIndex === 1 && configuredLockedTopic
            ? configuredLockedTopic
            : await selectV2LockedTopic({ provider, codex, approval, model, speed, timeoutMs, tempDir, agentLabel });
        const sequentialOutputPath = join(tempDir, `${provider}-article-${articleIndex}.txt`);
        console.log(`\nStarting sequential article generation ${articleIndex}/${count}`);
        const writerResult = await runAgentPrompt({
          provider,
          codex,
          approval,
          sandbox,
          model,
          reasoning,
          speed,
          outputPath: sequentialOutputPath,
          prompt: buildSequentialPrompt({ articleIndex, count, articleDirectory: stagingArticlesDir, agentLabel, harnessProfile, lockedTopic: articleLockedTopic }),
          timeoutMs,
          tempDir,
          persistSession: !legacyHarness && !writerSessionId,
          resumeSessionId: !legacyHarness ? writerSessionId : "",
        });
        writerSessionId = writerResult?.sessionId || writerSessionId;
        assertArticleCount(stagingArticlesDir, articleIndex);
      }
    } else {
      const articleLockedTopic = legacyHarness
        ? null
        : configuredLockedTopic || await selectV2LockedTopic({ provider, codex, approval, model, speed, timeoutMs, tempDir, agentLabel });
      const prompt = buildPrompt({ count, replace, articleDirectory: stagingArticlesDir, staged: true, agentLabel, harnessProfile, lockedTopic: articleLockedTopic });
      const writerPromise = runAgentPrompt({
        provider,
        codex,
        approval,
        sandbox,
        model,
        reasoning,
        speed,
        outputPath,
        prompt,
        timeoutMs,
        tempDir,
        persistSession: !legacyHarness,
      });
      const preparedHeroPromise = !legacyHarness && count === 1
        ? prepareLockedTopicHero({
            provider,
            codex,
            approval,
            sandbox,
            model,
            speed,
            timeoutMs,
            tempDir,
            stagingRoot,
            agentLabel,
            lockedTopic: articleLockedTopic,
          }).catch((error) => {
            console.warn(`Magazine v2 early hero preparation failed; falling back after writing: ${error.message}`);
            return null;
          })
        : Promise.resolve(null);
      const [writerResult, preparedHero] = await Promise.all([writerPromise, preparedHeroPromise]);
      writerSessionId = writerResult?.sessionId || "";
      initialHeroPatches = installPreparedHero({ preparedHero, articleDirectory: stagingArticlesDir });
    }
    assertArticleCount(stagingArticlesDir, count);
    normalizeGeneratedArticleMetadata(stagingArticlesDir, publishedAt, { existingArticleCount, previousArticleIds, generationAgent });
    await runStrictCheckWithRepair({
      provider,
      codex,
      approval,
      sandbox,
      model,
      reasoning,
      speed,
      timeoutMs,
      tempDir,
      count,
      repairRounds,
      articleDirectory: stagingArticlesDir,
      staged: true,
      agentLabel,
      publishedAt,
      existingArticleCount,
      previousArticleIds,
      generationAgent,
      harnessProfile,
      writerSessionId,
      initialHeroPatches,
    });
    publishGeneratedArticles({ stagingArticlesDir, replace });
    console.log(`Published magazine articles to ${ARTICLES_DIR}`);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
    rmSync(stagingRoot, { recursive: true, force: true });
    releaseGenerationLock();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exit(1);
  });
}
