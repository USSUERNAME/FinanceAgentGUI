#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

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

function postWorldMemoryNewsFeedSummary(limit = 24) {
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

  const candidates = items
    .map((item) => ({ item, itemTime: newsFeedItemTimestamp(item) }))
    .filter(({ itemTime }) => itemTime.timestamp > cutoff.timestamp)
    .sort((a, b) => b.itemTime.timestamp - a.itemTime.timestamp || String(a.item.id || "").localeCompare(String(b.item.id || "")));
  const windowItems = candidates.slice(0, limit);

  if (!windowItems.length) {
    return [
      `- worldMemoryLastSuccessfulAt=${cutoff.iso}`,
      `- 확인된 보도 ${items.length}개 중 기준 업데이트 이후 항목이 없다.`,
      "- 이 경우 로컬 보도 데이터를 기사 소재 후보로 쓰지 말고 World Memory와 외부 리서치로 소재를 고른다.",
    ].join("\n");
  }

  return [
    `- policy=post-world-memory-update-only / worldMemoryLastSuccessfulAt=${cutoff.iso} / availableAfterCutoff=${candidates.length} / showing=${windowItems.length}`,
    "- 아래 목록 밖의 최근 확인된 보도는 기사 소재 후보로 쓰지 않는다.",
    ...windowItems.map(({ item, itemTime }) => {
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
  const label = String(agent.label || "").trim();
  const normalized = {
    provider,
    model,
    reasoning,
    label,
  };
  return Object.fromEntries(Object.entries(normalized).filter(([, value]) => value));
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

async function finalizeArticleTitles({ provider, codex, approval, sandbox, model, reasoning, timeoutMs, tempDir, articleDirectory, agentLabel }) {
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

function buildPrompt({ count, replace, articleDirectory, staged, agentLabel = "Codex CLI" }) {
  const extraPrompt = String(process.env.MAGAZINE_EXTRA_PROMPT || process.env.MAGAZINE_CODEX_EXTRA_PROMPT || "").trim();
  const recentArticles = recentArticleWindowSummary(12);
  const newsFeedCandidates = postWorldMemoryNewsFeedSummary(24);
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
    "- 기사마다 sourceBasis를 5개 이상 채우고, 본문에는 직접 인용 또는 간접 귀속을 보통 4회 이상 넣는다. 이것은 글의 균형을 잡기 위한 목표이지, 기계적인 quote block 할당량이 아니다.",
    "- 기사 핵심과 관련 있는 인물·기업·기관·정책당국·분석가·트레이더의 실제 발언을 발견했다면 익명 요약으로 뭉개지 말고 반드시 처리한다. 정확한 원문이 확인되면 직접 인용하고, 정확한 표현이 확인되지 않으면 명시적 간접 귀속으로 쓴다.",
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
    "- 직접 인용은 검증된 출처일 때만 쓴다. 확실하지 않으면 따옴표를 쓰지 말고 간접 인용한다.",
    "- 매체명/소속기관/사람 이름은 첫 등장에 original name(Korean name) 형태를 쓴다.",
    "- 존대말로 쓰되 독자를 가르치거나 훈계하지 않는다.",
    "- 사망, 전쟁, 테러리즘, 심각한 수준의 시장 붕괴처럼 가혹한 상황을 다루는 기사가 아니라면 본문에는 Bloomberg 뉴스레터 스타일의 절제된 유머와 위트를 어느 정도 담는다. 위트는 장식이 아니라 시장 메커니즘을 더 선명하게 보이게 해야 한다.",
    "- 인용은 본문과 유기적으로 연결될 때만 쓴다. 본문과 인용이 같은 말을 반복하면 padding으로 간주하고, 인용 대신 더 구체적인 수치·반론·현장 맥락을 넣는다.",
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

function truncateForPrompt(text, limit = 6000) {
  const value = String(text || "").trim();
  if (value.length <= limit) return value;
  return `${value.slice(0, limit)}\n...<truncated>`;
}

function buildRepairPrompt({ count, checkOutput, articleDirectory, staged, agentLabel = "Codex CLI" }) {
  const recentArticles = recentArticleWindowSummary(12);
  const newsFeedCandidates = postWorldMemoryNewsFeedSummary(24);
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
    "- 기사 핵심과 관련 있는 실제 발언이 metadata.sourceBasis, 기사 본문, 리서치 근거에 있는데 본문에서 익명 요약으로만 처리됐다면 직접 인용 또는 명시적 간접 귀속으로 복구한다.",
    "- 본문에는 직접 인용 또는 간접 귀속을 보통 4회 이상 확보한다. 다만 고정 횟수를 채우기 위한 장식 인용은 넣지 말고, 출처 목소리가 기사 흐름을 실제로 앞으로 밀 때만 추가한다.",
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

async function runCommand(command, args, options = {}) {
  return new Promise((resolveCommand, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd || GUIBUILD_ROOT,
      env: { ...process.env, NO_COLOR: "1", ...(options.env || {}) },
      stdio: ["ignore", "pipe", "pipe"],
    });
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
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
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

function buildCodexArgs({ approval, sandbox, model, reasoning, outputPath, prompt }) {
  return [
    "--ask-for-approval",
    approval,
    "exec",
    "--skip-git-repo-check",
    "--ephemeral",
    "-C",
    GUIBUILD_ROOT,
    "-s",
    sandbox,
    "-m",
    model,
    "-c",
    `model_reasoning_effort="${reasoning}"`,
    "-o",
    outputPath,
    prompt,
  ];
}

async function runCodexPrompt({ codex, approval, sandbox, model, reasoning, outputPath, prompt, timeoutMs }) {
  const args = buildCodexArgs({ approval, sandbox, model, reasoning, outputPath, prompt });
  await runCommand(codex, args, { cwd: GUIBUILD_ROOT, timeoutMs });
  const finalAnswer = existsSync(outputPath) ? readFileSync(outputPath, "utf8").trim() : "";
  if (finalAnswer) {
    console.log("\n--- Codex final answer ---");
    console.log(finalAnswer);
  }
}

function antigravitySecurityArgs(approval) {
  return String(approval || "").trim().toLowerCase() === "turbo"
    ? ["--dangerously-skip-permissions"]
    : [];
}

function antigravityPrintTimeout() {
  return String(process.env.ANTIGRAVITY_CLI_PRINT_TIMEOUT || "30m").trim() || "30m";
}

async function runAntigravityPrompt({
  approval,
  model,
  outputPath,
  prompt,
  timeoutMs,
}) {
  const agy = findAntigravityCommand();
  const args = [
    ...antigravitySecurityArgs(approval),
    "--model",
    cleanAntigravityModel(model),
    `--print-timeout=${antigravityPrintTimeout()}`,
    "-p",
    "-",
  ];

  return new Promise((resolvePrompt, reject) => {
    const child = spawn(agy, args, {
      cwd: GUIBUILD_ROOT,
      env: { ...process.env, NO_COLOR: "1" },
      stdio: ["pipe", "pipe", "pipe"],
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
    child.on("error", (error) => {
      if (timer) clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
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

    child.stdin.end(prompt);
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

function buildSequentialPrompt({ articleIndex, count, articleDirectory, agentLabel }) {
  return [
    buildPrompt({ count: 1, replace: false, articleDirectory, staged: true, agentLabel }),
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

async function runStrictCheckWithRepair({ provider, codex, approval, sandbox, model, reasoning, timeoutMs, tempDir, count, repairRounds, articleDirectory, staged, agentLabel, publishedAt, existingArticleCount, previousArticleIds, generationAgent }) {
  for (let attempt = 0; attempt <= repairRounds; attempt += 1) {
    console.log("\nRunning local magazine style check...");
    try {
      normalizeGeneratedArticleMetadata(articleDirectory, publishedAt, { existingArticleCount, previousArticleIds, generationAgent });
      await finalizeArticleTitles({
        provider,
        codex,
        approval,
        sandbox,
        model,
        reasoning,
        timeoutMs,
        tempDir,
        articleDirectory,
        agentLabel,
      });
      await runCommand(process.execPath, ["scripts/magazine_article_style_check.mjs", "--strict"], {
        cwd: GUIBUILD_ROOT,
        env: {
          MAGAZINE_ARTICLES_DIR: articleDirectory,
          ...(staged && existingArticleCount > 0
            ? {
                MAGAZINE_BASELINE_ARTICLES_DIR: ARTICLES_DIR,
                MAGAZINE_BASELINE_ARTICLE_LIMIT: "12",
              }
            : {}),
        },
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
      console.warn(`\nMagazine strict check failed; starting ${agentLabel} repair round ${repairNumber}/${repairRounds}.`);
      await runAgentPrompt({
        provider,
        codex,
        approval,
        sandbox,
        model,
        reasoning,
        outputPath: repairOutputPath,
        prompt: buildRepairPrompt({ count, checkOutput, articleDirectory, staged, agentLabel }),
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
  const approval = cleanCliValue(
    argValue("--approval", antigravity ? process.env.MAGAZINE_ANTIGRAVITY_APPROVAL || "turbo" : process.env.MAGAZINE_CODEX_APPROVAL || "never"),
    antigravity ? "turbo" : "never",
    /^[A-Za-z-]+$/,
  );
  const sandbox = cleanCliValue(argValue("--sandbox", process.env.MAGAZINE_CODEX_SANDBOX || "workspace-write"), "workspace-write", /^[A-Za-z-]+$/);
  const timeoutMs = Number.parseInt(argValue("--timeout-ms", process.env.MAGAZINE_CODEX_TIMEOUT_MS || "1800000"), 10) || 1800000;
  const repairRounds = Number.parseInt(argValue("--repair-rounds", process.env.MAGAZINE_CODEX_REPAIR_ROUNDS || "2"), 10) || 2;
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
    label: agentLabel,
  };
  mkdirSync(stagingArticlesDir, { recursive: true });

  if (!existsSync(ARTICLES_DIR)) {
    mkdirSync(ARTICLES_DIR, { recursive: true });
  }

  acquireGenerationLock();

  try {
    console.log(`Staging magazine articles in ${stagingArticlesDir}`);

    console.log(`Starting ${agentLabel} magazine generation: count=${count}, replace=${replace}, model=${model}, reasoning=${reasoning}, approval=${approval}, repairRounds=${repairRounds}, sequential=${sequential}, publishedAt=${publishedAt}`);
    if (sequential && count > 1) {
      for (let articleIndex = 1; articleIndex <= count; articleIndex += 1) {
        const sequentialOutputPath = join(tempDir, `${provider}-article-${articleIndex}.txt`);
        console.log(`\nStarting sequential article generation ${articleIndex}/${count}`);
        await runAgentPrompt({
          provider,
          codex,
          approval,
          sandbox,
          model,
          reasoning,
          outputPath: sequentialOutputPath,
          prompt: buildSequentialPrompt({ articleIndex, count, articleDirectory: stagingArticlesDir, agentLabel }),
          timeoutMs,
          tempDir,
        });
        assertArticleCount(stagingArticlesDir, articleIndex);
      }
    } else {
      const prompt = buildPrompt({ count, replace, articleDirectory: stagingArticlesDir, staged: true, agentLabel });
      await runAgentPrompt({
        provider,
        codex,
        approval,
        sandbox,
        model,
        reasoning,
        outputPath,
        prompt,
        timeoutMs,
        tempDir,
      });
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
    });
    publishGeneratedArticles({ stagingArticlesDir, replace });
    console.log(`Published magazine articles to ${ARTICLES_DIR}`);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
    rmSync(stagingRoot, { recursive: true, force: true });
    releaseGenerationLock();
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
