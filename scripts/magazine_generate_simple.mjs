#!/usr/bin/env node
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { codexServiceTierArgs, normalizeCodexSpeed } from "../web/server/agentSpeed.mjs";
import { spawnObservedLlm, waitForLlmObservation } from "../web/server/llmProcessObserver.mjs";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const GUIBUILD_ROOT = resolve(dirname(SCRIPT_PATH), "..");
const EXEMPLAR_CONFIG_PATH = join(GUIBUILD_ROOT, "config", "magazine-editorial-exemplars.json");
const TOPICS_CONFIG_PATH = join(GUIBUILD_ROOT, "config", "magazine-topics.json");
const OUTPUT_SCHEMA_PATH = join(GUIBUILD_ROOT, "config", "magazine-simple-article.schema.json");
const TOPIC_SCHEMA_PATH = join(GUIBUILD_ROOT, "config", "magazine-simple-topic.schema.json");
const NEWS_FEED_PATH = join(GUIBUILD_ROOT, "data", "news-feed.json");
const WORLD_MEMORY_STATE_PATH = join(GUIBUILD_ROOT, "data", "world-memory", "collector-state.json");
const SIMPLE_TEST_ROOT = join(GUIBUILD_ROOT, "data", "magazine", "simple-tests");
const TOOL_ITEM_TYPES = new Set([
  "command_execution",
  "file_change",
  "mcp_tool_call",
  "tool_call",
  "web_search",
]);

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function cleanText(value, maxChars = 20_000) {
  return String(value ?? "").replace(/\r/g, "").trim().slice(0, maxChars);
}

function finiteTokenCount(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function nowKstIso(date = new Date()) {
  const kst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  return `${kst.toISOString().slice(0, 19)}+09:00`;
}

function insidePath(root, candidate) {
  return candidate === root || candidate.startsWith(`${root}${sep}`);
}

export function loadSimpleEditorialExemplars() {
  const config = readJson(EXEMPLAR_CONFIG_PATH);
  if (config.enabled === false) return [];
  const root = resolve(GUIBUILD_ROOT, cleanText(config.root, 500));
  if (!insidePath(GUIBUILD_ROOT, root) || !existsSync(root)) return [];
  const maxExemplars = Math.max(0, Math.min(3, Number.parseInt(config.maxExemplars, 10) || 3));
  const maxArticleChars = Math.max(
    2_000,
    Math.min(30_000, Number.parseInt(config.maxArticleChars, 10) || 18_000),
  );
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((entry) => {
      const exemplarRoot = join(root, entry.name);
      const metadataPath = join(exemplarRoot, "metadata.json");
      const articlePath = join(exemplarRoot, "article.md");
      if (!existsSync(metadataPath) || !existsSync(articlePath)) return null;
      const metadata = readJson(metadataPath);
      const article = cleanText(readFileSync(articlePath, "utf8"), maxArticleChars);
      if (!metadata.approved || !article) return null;
      return {
        id: entry.name,
        title: cleanText(metadata.title || entry.name, 200),
        article,
      };
    })
    .filter(Boolean)
    .slice(0, maxExemplars);
}

export function compactNewsEvidence(item) {
  const headline = cleanText(item?.translatedTitle || item?.title, 2_000);
  if (!item?.id || !headline) return null;
  const originalHeadline = cleanText(item?.title, 2_000);
  return {
    id: cleanText(item.id, 120),
    source: cleanText(item.feedTitle || item.feedId || "출처 미상", 160),
    publishedAt: cleanText(item.sourcePublishedAt || item.publishedAt, 80),
    headline,
    ...(originalHeadline && originalHeadline !== headline ? { originalHeadline } : {}),
    url: cleanText(item.sourceUrl, 1_000),
  };
}

export function selectNewsEvidence(newsFeed, ids = []) {
  const requestedIds = [...new Set(ids.map((id) => cleanText(id, 120)).filter(Boolean))];
  const byId = new Map(
    (Array.isArray(newsFeed?.items) ? newsFeed.items : [])
      .map((item) => [String(item?.id || ""), item])
      .filter(([id]) => id),
  );
  const missing = requestedIds.filter((id) => !byId.has(id));
  if (missing.length) throw new Error(`News Feed 근거를 찾을 수 없습니다: ${missing.join(", ")}`);
  return requestedIds.map((id) => compactNewsEvidence(byId.get(id))).filter(Boolean);
}

function newsItemTimestamp(item = {}) {
  for (const field of ["publishedAt", "fetchedAt", "translatedAt"]) {
    const timestamp = Date.parse(item?.[field] || "");
    if (Number.isFinite(timestamp)) return timestamp;
  }
  return 0;
}

export function allEligibleNewsEvidence(newsFeed, worldMemoryState) {
  const cutoff = cleanText(worldMemoryState?.collector?.lastSuccessfulAt, 80);
  const cutoffTimestamp = Date.parse(cutoff);
  if (!Number.isFinite(cutoffTimestamp)) {
    throw new Error("World Memory의 마지막 성공 시각을 찾을 수 없습니다");
  }
  const candidates = (Array.isArray(newsFeed?.items) ? newsFeed.items : [])
    .map((item) => ({ item, timestamp: newsItemTimestamp(item) }))
    .filter(({ timestamp }) => timestamp > cutoffTimestamp)
    .sort(
      (left, right) =>
        right.timestamp - left.timestamp ||
        String(left.item?.id || "").localeCompare(String(right.item?.id || "")),
    )
    .map(({ item }) => compactNewsEvidence(item))
    .filter(Boolean);
  if (!candidates.length) throw new Error("기준 업데이트 이후 사용할 수 있는 News Feed 후보가 없습니다");
  return { cutoff, candidates };
}

function allowedTopicLabels() {
  const config = readJson(TOPICS_CONFIG_PATH);
  return new Set(
    (Array.isArray(config?.topics) ? config.topics : [])
      .map((topic) => cleanText(topic?.label, 40))
      .filter(Boolean),
  );
}

export function buildAllCandidateTopicPrompt({ cutoff, candidates }) {
  if (!cutoff) throw new Error("후보 기준 시각이 필요합니다");
  if (!Array.isArray(candidates) || candidates.length === 0) throw new Error("기사 후보가 필요합니다");
  return [
    "당신은 한국어 금융 매거진의 소재 선정 편집자입니다.",
    "",
    "지시:",
    `- ${cutoff} 이후 수집된 아래 ${candidates.length}개 후보를 빠짐없이 모두 검토하십시오.`,
    "- 키워드 개수나 텍스트 매칭이 아니라 사건의 새로움, 독립성, 시장 메커니즘, 장문 기사 확장성을 의미적으로 판단하십시오.",
    "- 지금 한 편으로 쓸 가치가 가장 큰 독립 사건 또는 직접 연결된 사건 묶음 하나만 고르십시오.",
    "- newsFeedIds에는 선택한 논제를 직접 뒷받침하는 실제 후보 id를 모두 넣고, 관련 없는 후보는 넣지 마십시오.",
    "- 같은 사실을 반복한 후보는 독립 확인이나 추가 정보 역할이 있을 때만 함께 고르고, 단순 중복은 의미적으로 제외하십시오. 개수 할당량은 없습니다.",
    "- 제공된 후보에 없는 사실·수치·출처를 만들지 마십시오.",
    "- 도구, 웹 검색, 파일 읽기, 추가 조사를 하지 말고 이 한 번의 답변으로 끝내십시오.",
    "- 내부 저장소·선정 과정·후보 목록을 독자용 제목이나 각도에 언급하지 마십시오.",
    "- 지정된 JSON 스키마에 맞는 객체만 반환하십시오.",
    "",
    "=== 임의 개수 제한 없는 전체 후보 ===",
    JSON.stringify(candidates, null, 2),
  ].join("\n");
}

export function normalizeDiscoveredTopic(value, candidates) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("소재 선정 결과가 JSON 객체가 아닙니다");
  }
  const labels = allowedTopicLabels();
  const validCandidateIds = new Set(candidates.map((item) => item.id));
  const newsFeedIds = [...new Set(
    (Array.isArray(value.newsFeedIds) ? value.newsFeedIds : [])
      .map((entry) => cleanText(entry, 120))
      .filter((entry) => validCandidateIds.has(entry)),
  )];
  const topics = [...new Set(
    (Array.isArray(value.topics) ? value.topics : [])
      .map((entry) => cleanText(entry, 40))
      .filter((entry) => labels.has(entry)),
  )].slice(0, 3);
  const title = cleanText(value.title, 220);
  const brief = cleanText(value.brief, 1_200);
  const storyFamily = cleanText(value.storyFamily, 300);
  const editorialAngle = cleanText(value.editorialAngle, 1_000);
  const primaryEvent = cleanText(value.primaryEvent, 1_000);
  const marketMechanism = cleanText(value.marketMechanism, 1_200);
  const selectionReason = cleanText(value.selectionReason, 1_200);
  if (title.length < 8) throw new Error("선정된 소재 제목이 너무 짧습니다");
  if (brief.length < 30) throw new Error("선정된 소재 설명이 너무 짧습니다");
  if (!storyFamily || !editorialAngle || !primaryEvent || !marketMechanism || !selectionReason) {
    throw new Error("선정된 소재의 편집 판단 필드가 비어 있습니다");
  }
  if (!topics.length) throw new Error("선정된 소재에 유효한 토픽이 없습니다");
  if (!newsFeedIds.length) throw new Error("선정된 소재에 유효한 News Feed id가 없습니다");
  const selectedEvidence = candidates.filter((item) => newsFeedIds.includes(item.id));
  const newestEvidenceAt = selectedEvidence
    .map((item) => Date.parse(item.publishedAt || ""))
    .filter(Number.isFinite)
    .sort((left, right) => right - left)[0];
  return {
    title,
    brief,
    articleType: cleanText(value.articleType || "analysis", 40),
    topics,
    storyFamily,
    editorialAngle,
    selectionReason,
    newsFeedIds,
    eventSignature: {
      role: "primary",
      actor: "",
      action: primaryEvent,
      object: [],
      time: Number.isFinite(newestEvidenceAt) ? new Date(newestEvidenceAt).toISOString() : "",
      marketMechanism,
      sourceIds: newsFeedIds,
    },
  };
}

export function buildSimpleMagazinePrompt({ topic, evidence, exemplars }) {
  if (!topic || typeof topic !== "object") throw new Error("잠긴 주제 패킷이 필요합니다");
  if (!Array.isArray(evidence) || evidence.length === 0) throw new Error("사건 근거가 필요합니다");
  if (!Array.isArray(exemplars) || exemplars.length !== 3) {
    throw new Error(`승인 퓨샷은 정확히 3개여야 합니다: ${exemplars?.length || 0}개`);
  }
  const fewShots = exemplars.flatMap((exemplar, index) => [
    `=== 문체 예시 ${index + 1}: ${exemplar.title} ===`,
    exemplar.article,
  ]);
  return [
    "당신은 한국어 금융 매거진 편집자입니다.",
    "",
    "지시:",
    "- 아래 사건 자료만 사실 근거로 사용하고, 자료에 없는 수치·인용·경과는 만들지 마십시오.",
    "- 존댓말 기사로 쓰되 핵심 메커니즘, 가장 강한 반론, 남는 함의를 자연스럽게 연결하십시오.",
    "- 소제목에 '가장 강한 반론', '반론', '시장 메커니즘' 같은 편집 표찰을 노출하지 말고 실제 주장이나 쟁점을 쓰십시오.",
    "- 문체 예시에서는 논증의 흐름과 문단 리듬만 배우고 문구·사실·비유·구조를 복제하지 마십시오.",
    "- 도구, 웹 검색, 파일 읽기, 추가 조사를 하지 말고 이 한 번의 답변으로 끝내십시오.",
    "- articleId는 영문 소문자·숫자·하이픈만 사용한 의미 있는 slug로 작성하십시오.",
    "- 본문은 3,000~6,000자 정도의 Markdown으로 작성하되 H1 제목과 deck을 반복하지 말고 본문부터 시작하십시오.",
    "- eventSignature는 이번 사건의 실제 행위자·행동·대상·시각·시장 메커니즘과 사용한 근거 id만 담으십시오.",
    "- 최종 출력 전에 근거 충실성, 자연스러운 한국어, 논증 완결성, 편집 표찰 노출을 함께 의미적으로 검토하십시오.",
    "- 출판을 막을 문제가 있으면 editorialReview.publicationReady=false와 blocking issue를 반환하십시오. 문제를 숨기거나 응답 안에서 재작성 루프를 돌리지 마십시오.",
    "- 내부 작업 과정은 기사 본문에 언급하지 마십시오.",
    "- 지정된 JSON 스키마에 맞는 객체만 반환하십시오.",
    "",
    ...fewShots,
    "",
    "=== 이번 잠긴 주제 ===",
    JSON.stringify(topic, null, 2),
    "",
    "=== 이번 사건 자료 ===",
    JSON.stringify(evidence, null, 2),
  ].join("\n");
}

export function inspectCodexJsonl(stdout = "") {
  let turnCount = 0;
  let toolCallCount = 0;
  let threadId = "";
  let tokenUsage = null;
  for (const line of String(stdout).split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line);
      if (event.type === "thread.started") threadId = cleanText(event.thread_id || event.threadId, 100);
      if (event.type === "turn.completed") turnCount += 1;
      if (TOOL_ITEM_TYPES.has(String(event?.item?.type || ""))) toolCallCount += 1;
      const usage = event?.usage || event?.token_usage || event?.tokenUsage;
      if (usage && typeof usage === "object" && !Array.isArray(usage)) {
        tokenUsage = {
          inputTokens: finiteTokenCount(usage.input_tokens ?? usage.inputTokens),
          cachedInputTokens: finiteTokenCount(
            usage.cached_input_tokens ??
              usage.cachedInputTokens ??
              usage.input_tokens_details?.cached_tokens ??
              usage.inputTokensDetails?.cachedTokens,
          ),
          outputTokens: finiteTokenCount(usage.output_tokens ?? usage.outputTokens),
        };
      }
    } catch {
      // Codex may emit a non-JSON diagnostic line on stderr, but stdout events remain parseable.
    }
  }
  return { turnCount, toolCallCount, threadId, tokenUsage };
}

function parseStructuredResult(raw) {
  const text = cleanText(raw, 100_000)
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  return JSON.parse(text);
}

export function normalizeSimpleArticle(value, { topic, evidence }) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("기사 결과가 JSON 객체가 아닙니다");
  }
  const labels = allowedTopicLabels();
  const articleId = cleanText(value.articleId, 120).toLowerCase();
  const title = cleanText(value.title, 160);
  const deck = cleanText(value.deck, 500);
  const summary = cleanText(value.summary, 1_000);
  const articleMarkdown = cleanText(value.articleMarkdown, 20_000);
  const topics = [...new Set(
    (Array.isArray(value.topics) ? value.topics : [])
      .map((entry) => cleanText(entry, 40))
      .filter((entry) => labels.has(entry)),
  )].slice(0, 3);
  const evidenceIds = new Set(evidence.map((item) => item.id));
  const eventSourceIds = [...new Set(
    (Array.isArray(value.eventSignature?.sourceIds) ? value.eventSignature.sourceIds : [])
      .map((entry) => cleanText(entry, 120))
      .filter((entry) => evidenceIds.has(entry)),
  )];
  const eventSignature = {
    role: "primary",
    actor: cleanText(value.eventSignature?.actor, 300),
    action: cleanText(value.eventSignature?.action, 1_000),
    object: (Array.isArray(value.eventSignature?.object) ? value.eventSignature.object : [])
      .map((entry) => cleanText(entry, 300))
      .filter(Boolean),
    time: cleanText(value.eventSignature?.time, 80),
    marketMechanism: cleanText(value.eventSignature?.marketMechanism, 1_200),
    sourceIds: eventSourceIds,
  };
  const editorialIssues = (Array.isArray(value.editorialReview?.issues) ? value.editorialReview.issues : [])
    .map((issue) => ({
      severity: cleanText(issue?.severity, 20).toLowerCase() === "blocking" ? "blocking" : "advisory",
      code: cleanText(issue?.code, 120) || "integrated-review-issue",
      location: cleanText(issue?.location, 300),
      rationale: cleanText(issue?.rationale, 1_000),
      suggestedFix: cleanText(issue?.suggestedFix, 1_000),
      confidence: null,
    }));
  const editorialReview = {
    policy: "magazine-editorial-review-v2",
    method: "LLM_INTEGRATED_ONE_SHOT_REVIEW",
    reviewer: "magazine-simple-writer-integrated-review",
    suggestedTitle: title,
    publicationReady: value.editorialReview?.publicationReady === true,
    summary: cleanText(value.editorialReview?.summary, 1_000),
    issues: editorialIssues,
  };
  if (!/^[a-z0-9][a-z0-9-]{5,119}$/.test(articleId)) {
    throw new Error(`기사 articleId 형식이 올바르지 않습니다: ${articleId}`);
  }
  if (title.length < 8) throw new Error("기사 제목이 너무 짧습니다");
  if (deck.length < 30) throw new Error("기사 덱이 너무 짧습니다");
  if (summary.length < 50) throw new Error("기사 요약이 너무 짧습니다");
  if (topics.length === 0) throw new Error("유효한 토픽이 없습니다");
  if (articleMarkdown.length < 2_000) {
    throw new Error(`기사 본문이 너무 짧습니다: ${articleMarkdown.length}자`);
  }
  if (
    !eventSignature.actor ||
    !eventSignature.action ||
    !eventSignature.object.length ||
    !eventSignature.time ||
    !eventSignature.marketMechanism
  ) {
    throw new Error("기사의 primary event signature가 불완전합니다");
  }
  if (!eventSignature.sourceIds.length) throw new Error("기사 event signature에 유효한 근거 id가 없습니다");
  if (!editorialReview.summary) throw new Error("통합 편집 검토 요약이 없습니다");
  const blockingIssues = editorialReview.issues.filter((issue) => issue.severity === "blocking");
  if (!editorialReview.publicationReady || blockingIssues.length) {
    throw new Error(`통합 편집 검토가 출판을 차단했습니다: ${JSON.stringify(blockingIssues)}`);
  }
  return {
    articleId,
    title,
    deck,
    summary,
    topics,
    articleType: cleanText(topic.articleType || "analysis", 40),
    storyFamily: cleanText(topic.storyFamily, 300),
    editorialAngle: cleanText(topic.editorialAngle || topic.brief, 800),
    eventSignature,
    editorialReviewDecision: editorialReview,
    sourceBasis: evidence.map(
      (item) => `${item.source}, ${item.publishedAt}: ${item.headline}${item.url ? ` ${item.url}` : ""}`,
    ),
    articleMarkdown,
  };
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function inlineMarkdownToHtml(value) {
  return escapeHtml(value)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(/`([^`]+)`/g, "<code>$1</code>");
}

export function articleMarkdownToHtml(markdown) {
  const lines = cleanText(markdown, 30_000).split("\n");
  const blocks = [];
  let paragraph = [];
  let listItems = [];
  const flushParagraph = () => {
    if (!paragraph.length) return;
    blocks.push(`<p>${inlineMarkdownToHtml(paragraph.join(" "))}</p>`);
    paragraph = [];
  };
  const flushList = () => {
    if (!listItems.length) return;
    blocks.push(`<ul>${listItems.map((item) => `<li>${inlineMarkdownToHtml(item)}</li>`).join("")}</ul>`);
    listItems = [];
  };
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      flushParagraph();
      flushList();
      continue;
    }
    if (/^#\s+/.test(line)) {
      flushParagraph();
      flushList();
      continue;
    }
    const heading = line.match(/^(#{2,3})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      flushList();
      const level = heading[1].length;
      blocks.push(`<h${level}>${inlineMarkdownToHtml(heading[2])}</h${level}>`);
      continue;
    }
    const list = line.match(/^[-*]\s+(.+)$/);
    if (list) {
      flushParagraph();
      listItems.push(list[1]);
      continue;
    }
    if (/^>\s+/.test(line)) {
      flushParagraph();
      flushList();
      blocks.push(`<blockquote><p>${inlineMarkdownToHtml(line.replace(/^>\s+/, ""))}</p></blockquote>`);
      continue;
    }
    paragraph.push(line);
  }
  flushParagraph();
  flushList();
  return `<article class="magazine-article">\n${blocks.join("\n")}\n</article>\n`;
}

function parseArgs(argv) {
  const options = {
    model: "gpt-5.6-sol",
    reasoning: "medium",
    speed: "standard",
    timeoutMs: 10 * 60 * 1_000,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const next = argv[index + 1];
    if (argument === "--topic-file") options.topicFile = next, index += 1;
    else if (argument === "--discover-all") options.discoverAll = true;
    else if (argument === "--output-dir") options.outputDir = next, index += 1;
    else if (argument === "--model") options.model = next, index += 1;
    else if (argument === "--reasoning") options.reasoning = next, index += 1;
    else if (argument === "--speed") options.speed = next, index += 1;
    else if (argument === "--timeout-ms") options.timeoutMs = Number.parseInt(next, 10), index += 1;
    else throw new Error(`알 수 없는 인자: ${argument}`);
  }
  if (!options.topicFile && !options.discoverAll) {
    throw new Error("--topic-file 또는 --discover-all이 필요합니다");
  }
  if (options.topicFile && options.discoverAll) {
    throw new Error("--topic-file과 --discover-all은 함께 사용할 수 없습니다");
  }
  if (!options.outputDir) throw new Error("--output-dir이 필요합니다");
  return options;
}

function runObservedCodex({
  prompt,
  outputPath,
  outputSchemaPath,
  workingDirectory,
  feature,
  model,
  reasoning,
  speed,
  timeoutMs,
}) {
  return new Promise((resolveRun, rejectRun) => {
    const args = [
      "--ask-for-approval",
      "never",
      "exec",
      "--ignore-user-config",
      "--ignore-rules",
      "--ephemeral",
      "--skip-git-repo-check",
      "-C",
      workingDirectory,
      "-s",
      "read-only",
      "-m",
      model,
      "-c",
      `model_reasoning_effort="${reasoning}"`,
      ...codexServiceTierArgs(normalizeCodexSpeed(speed)),
      "--json",
      "--output-schema",
      outputSchemaPath,
      "-o",
      outputPath,
      "-",
    ];
    const child = spawnObservedLlm(
      process.env.CODEX_BIN || "codex",
      args,
      {
        cwd: workingDirectory,
        env: { ...process.env, NO_COLOR: "1", TERM: "dumb" },
        stdio: ["pipe", "pipe", "pipe"],
      },
      {
        feature,
        provider: "codex-cli",
        model,
        timeoutMs,
      },
    );
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => child.kill("SIGTERM"), timeoutMs);
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      rejectRun(error);
    });
    child.once("close", async (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        const observation = await waitForLlmObservation(child);
        if (code !== 0) {
          throw new Error(
            cleanText(stderr || stdout || `Codex가 ${signal || code}로 종료되었습니다`, 8_000),
          );
        }
        resolveRun({ stdout, stderr, observation });
      } catch (error) {
        rejectRun(error);
      }
    });
    child.stdin.end(prompt);
  });
}

async function runOneTurnStage({
  label,
  prompt,
  outputPath,
  outputSchemaPath,
  workingDirectory,
  feature,
  model,
  reasoning,
  speed,
  timeoutMs,
}) {
  const startedAt = new Date();
  const run = await runObservedCodex({
    prompt,
    outputPath,
    outputSchemaPath,
    workingDirectory,
    feature,
    model,
    reasoning,
    speed,
    timeoutMs,
  });
  const telemetry = inspectCodexJsonl(run.stdout);
  if (telemetry.toolCallCount > 0) {
    throw new Error(`${label}이 도구를 ${telemetry.toolCallCount}회 호출했습니다`);
  }
  if (telemetry.turnCount !== 1) {
    throw new Error(`${label}은 정확히 1턴이어야 합니다: ${telemetry.turnCount}턴`);
  }
  if (!existsSync(outputPath)) throw new Error(`${label} 결과 파일이 없습니다`);
  const completedAt = new Date();
  return {
    value: parseStructuredResult(readFileSync(outputPath, "utf8")),
    telemetry: {
      startedAt: startedAt.toISOString(),
      completedAt: completedAt.toISOString(),
      durationMs: completedAt.getTime() - startedAt.getTime(),
      promptChars: prompt.length,
      turnCount: telemetry.turnCount,
      toolCallCount: telemetry.toolCallCount,
      tokenUsage: telemetry.tokenUsage,
      astopObservation: run.observation,
      threadId: telemetry.threadId,
    },
  };
}

export async function runIsolatedCodexJsonPrompt({
  prompt,
  outputSchemaPath,
  feature,
  model = "gpt-5.6-sol",
  reasoning = "medium",
  speed = "standard",
  timeoutMs = 10 * 60 * 1_000,
  label = "격리된 Codex JSON 단계",
}) {
  const schemaPath = resolve(outputSchemaPath);
  if (!insidePath(GUIBUILD_ROOT, schemaPath) || !existsSync(schemaPath)) {
    throw new Error(`출력 스키마가 GuiBuild 안에 없거나 읽을 수 없습니다: ${schemaPath}`);
  }
  const workingDirectory = mkdtempSync(join(tmpdir(), "finance-magazine-isolated-"));
  try {
    return await runOneTurnStage({
      label,
      prompt,
      outputPath: join(workingDirectory, "result.json"),
      outputSchemaPath: schemaPath,
      workingDirectory,
      feature,
      model,
      reasoning,
      speed,
      timeoutMs,
    });
  } finally {
    rmSync(workingDirectory, { recursive: true, force: true });
  }
}

export async function discoverSimpleTopicFromAllCandidates(options = {}) {
  const newsFeed = readJson(NEWS_FEED_PATH);
  const eligible = allEligibleNewsEvidence(newsFeed, readJson(WORLD_MEMORY_STATE_PATH));
  const prompt = buildAllCandidateTopicPrompt(eligible);
  if (prompt.length > 500_000) {
    throw new Error(`전체 후보 프롬프트가 안전 상한을 넘었습니다: ${prompt.length}자`);
  }
  const result = await runIsolatedCodexJsonPrompt({
    prompt,
    outputSchemaPath: TOPIC_SCHEMA_PATH,
    feature: "magazine-simple-topic-selector",
    model: options.model,
    reasoning: options.reasoning,
    speed: options.speed,
    timeoutMs: options.timeoutMs,
    label: "전체 후보 소재 선정기",
  });
  return {
    topic: normalizeDiscoveredTopic(result.value, eligible.candidates),
    candidates: eligible.candidates,
    cutoff: eligible.cutoff,
    telemetry: result.telemetry,
  };
}

export async function generateSimpleDraftFromLockedTopic({ topic, ...options }) {
  const newsFeed = readJson(NEWS_FEED_PATH);
  const ids = Array.isArray(topic?.newsFeedIds) ? topic.newsFeedIds : [];
  const evidence = selectNewsEvidence(newsFeed, ids);
  const exemplars = loadSimpleEditorialExemplars();
  const prompt = buildSimpleMagazinePrompt({ topic, evidence, exemplars });
  if (prompt.length > 250_000) {
    throw new Error(`단순 작성 프롬프트가 안전 상한을 넘었습니다: ${prompt.length}자`);
  }
  const result = await runIsolatedCodexJsonPrompt({
    prompt,
    outputSchemaPath: OUTPUT_SCHEMA_PATH,
    feature: "magazine-simple-writer",
    model: options.model,
    reasoning: options.reasoning,
    speed: options.speed,
    timeoutMs: options.timeoutMs,
    label: "단순 작성기",
  });
  return {
    article: normalizeSimpleArticle(result.value, { topic, evidence }),
    evidence,
    exemplarIds: exemplars.map((entry) => entry.id),
    telemetry: {
      ...result.telemetry,
      exemplarChars: exemplars.reduce((sum, entry) => sum + entry.article.length, 0),
      evidenceChars: JSON.stringify(evidence).length,
    },
  };
}

function sumTokenUsage(stages) {
  return stages.reduce(
    (total, stage) => {
      const usage = stage?.tokenUsage;
      total.inputTokens += finiteTokenCount(usage?.inputTokens);
      total.cachedInputTokens += finiteTokenCount(usage?.cachedInputTokens);
      total.outputTokens += finiteTokenCount(usage?.outputTokens);
      return total;
    },
    { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 },
  );
}

export async function generateSimpleMagazineArticle(options) {
  const outputDirectory = resolve(options.outputDir);
  if (!insidePath(SIMPLE_TEST_ROOT, outputDirectory)) {
    throw new Error(`실험 출력은 ${SIMPLE_TEST_ROOT} 아래에만 저장할 수 있습니다`);
  }
  mkdirSync(outputDirectory, { recursive: true });
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "finance-magazine-simple-"));
  const startedAt = new Date();
  try {
    const newsFeed = readJson(NEWS_FEED_PATH);
    let topic;
    let discovery = null;
    let candidateCount = 0;
    let candidateCutoff = "";
    if (options.discoverAll) {
      const eligible = allEligibleNewsEvidence(newsFeed, readJson(WORLD_MEMORY_STATE_PATH));
      candidateCount = eligible.candidates.length;
      candidateCutoff = eligible.cutoff;
      const discoveryPrompt = buildAllCandidateTopicPrompt(eligible);
      if (discoveryPrompt.length > 500_000) {
        throw new Error(`전체 후보 프롬프트가 안전 상한을 넘었습니다: ${discoveryPrompt.length}자`);
      }
      const discoveryResult = await runOneTurnStage({
        label: "전체 후보 소재 선정기",
        prompt: discoveryPrompt,
        outputPath: join(temporaryDirectory, "topic.json"),
        outputSchemaPath: TOPIC_SCHEMA_PATH,
        workingDirectory: temporaryDirectory,
        feature: "magazine-simple-topic-selector",
        model: options.model,
        reasoning: options.reasoning,
        speed: options.speed,
        timeoutMs: options.timeoutMs,
      });
      topic = normalizeDiscoveredTopic(discoveryResult.value, eligible.candidates);
      discovery = {
        policy: "all-eligible-post-world-memory-update-no-count-cap",
        cutoff: eligible.cutoff,
        candidateCount: eligible.candidates.length,
        selectedEvidenceCount: topic.newsFeedIds.length,
        selectedNewsFeedIds: topic.newsFeedIds,
        selectionReason: topic.selectionReason,
        ...discoveryResult.telemetry,
      };
    } else {
      topic = readJson(resolve(options.topicFile));
    }
    const ids = Array.isArray(topic.newsFeedIds) ? topic.newsFeedIds : [];
    const evidence = selectNewsEvidence(newsFeed, ids);
    const exemplars = loadSimpleEditorialExemplars();
    const prompt = buildSimpleMagazinePrompt({ topic, evidence, exemplars });
    if (prompt.length > 250_000) {
      throw new Error(`단순 작성 프롬프트가 안전 상한을 넘었습니다: ${prompt.length}자`);
    }
    const writerResult = await runOneTurnStage({
      label: "단순 작성기",
      prompt,
      outputPath: join(temporaryDirectory, "article.json"),
      outputSchemaPath: OUTPUT_SCHEMA_PATH,
      workingDirectory: temporaryDirectory,
      feature: "magazine-simple-writer",
      model: options.model,
      reasoning: options.reasoning,
      speed: options.speed,
      timeoutMs: options.timeoutMs,
    });
    const article = normalizeSimpleArticle(writerResult.value, {
      topic,
      evidence,
    });
    const completedAt = new Date();
    const pipeline = options.discoverAll
      ? "simple-all-candidates-two-stage-v1"
      : "simple-one-shot-v1";
    const metadata = {
      articleId: article.articleId,
      title: article.title,
      deck: article.deck,
      summary: article.summary,
      topics: article.topics,
      articleType: article.articleType,
      storyFamily: article.storyFamily,
      editorialAngle: article.editorialAngle,
      eventSignature: article.eventSignature,
      editorialReviewDecision: article.editorialReviewDecision,
      sourceBasis: article.sourceBasis,
      ...(discovery
        ? {
            newsDiscovery: {
              policy: discovery.policy,
              cutoff: discovery.cutoff,
              candidateCount: discovery.candidateCount,
              selectedEvidenceCount: discovery.selectedEvidenceCount,
              selectedNewsFeedIds: discovery.selectedNewsFeedIds,
              selectionReason: discovery.selectionReason,
            },
          }
        : {}),
      createdAt: nowKstIso(completedAt),
      generatedAt: nowKstIso(completedAt),
      experimental: true,
      published: false,
      generationAgent: {
        provider: "codex-cli",
        model: options.model,
        reasoning: options.reasoning,
        speed: normalizeCodexSpeed(options.speed),
        pipeline,
        editorialExemplars: exemplars.map((entry) => entry.id),
      },
    };
    const stageTelemetries = [discovery, writerResult.telemetry].filter(Boolean);
    const generationTelemetry = {
      pipeline,
      startedAt: startedAt.toISOString(),
      completedAt: completedAt.toISOString(),
      durationMs: completedAt.getTime() - startedAt.getTime(),
      promptChars: prompt.length,
      exemplarChars: exemplars.reduce((sum, entry) => sum + entry.article.length, 0),
      evidenceChars: JSON.stringify(evidence).length,
      candidatePolicy: discovery?.policy || "locked-topic-input",
      candidateCutoff,
      eligibleCandidateCount: candidateCount,
      selectedEvidenceCount: evidence.length,
      discovery,
      writer: writerResult.telemetry,
      turnCount: stageTelemetries.reduce((sum, stage) => sum + stage.turnCount, 0),
      toolCallCount: stageTelemetries.reduce((sum, stage) => sum + stage.toolCallCount, 0),
      tokenUsage: sumTokenUsage(stageTelemetries),
    };
    writeFileSync(join(outputDirectory, "article.md"), `${article.articleMarkdown}\n`, "utf8");
    writeFileSync(join(outputDirectory, "metadata.json"), `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
    writeFileSync(
      join(outputDirectory, "generation-telemetry.json"),
      `${JSON.stringify(generationTelemetry, null, 2)}\n`,
      "utf8",
    );
    return { outputDirectory, article, metadata, telemetry: generationTelemetry };
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const result = await generateSimpleMagazineArticle(options);
  console.log(
    JSON.stringify(
      {
        ok: true,
        outputDirectory: result.outputDirectory,
        title: result.article.title,
        promptChars: result.telemetry.promptChars,
        turns: result.telemetry.turnCount,
        tools: result.telemetry.toolCallCount,
        eligibleCandidateCount: result.telemetry.eligibleCandidateCount,
        selectedEvidenceCount: result.telemetry.selectedEvidenceCount,
        tokenUsage: result.telemetry.tokenUsage,
      },
      null,
      2,
    ),
  );
}

if (process.argv[1] && resolve(process.argv[1]) === SCRIPT_PATH) {
  main().catch((error) => {
    console.error(error?.stack || error?.message || String(error));
    process.exitCode = 1;
  });
}
