#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = resolve(fileURLToPath(new URL(".", import.meta.url)));
const GUIBUILD_ROOT = resolve(SCRIPT_DIR, "..");
const ARTICLES_DIR = process.env.MAGAZINE_ARTICLES_DIR
  ? resolve(process.env.MAGAZINE_ARTICLES_DIR)
  : join(GUIBUILD_ROOT, "data", "magazine", "articles");
const MAGAZINE_TOPICS_PATH = process.env.MAGAZINE_TOPICS_PATH
  ? resolve(process.env.MAGAZINE_TOPICS_PATH)
  : join(GUIBUILD_ROOT, "config", "magazine-topics.json");
const MAX_ARTICLE_TOPICS = 3;
const ISSUE_SLATE_MAX_ARTICLES = 12;
const BASELINE_ARTICLES_DIR = process.env.MAGAZINE_BASELINE_ARTICLES_DIR
  ? resolve(process.env.MAGAZINE_BASELINE_ARTICLES_DIR)
  : "";
const BASELINE_ARTICLE_LIMIT = Number.parseInt(process.env.MAGAZINE_BASELINE_ARTICLE_LIMIT || "12", 10) || 12;

const args = new Set(process.argv.slice(2));
const strict = args.has("--strict");
const warnOnly = args.has("--warn-only");
const jsonOutput = args.has("--json");

const LENGTH_TARGETS = {
  "fact-brief": 3000,
  "market-brief": 4500,
  analysis: 5500,
  "deep-analysis": 7000,
};

const HERO_BITMAP_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".avif"]);
const HERO_MIN_BYTES = 10 * 1024;
const HERO_MIN_WIDTH = 320;
const HERO_MIN_HEIGHT = 180;

const INTERNAL_PHRASES = [
  /\bWorld\s*Memory\b/i,
  /월드\s*메모리/,
  /월드메모리/,
  /World Memory vector/i,
  /semantic-search/i,
  /월드\s*메모리\s*벡터/,
  /\bNews\s*Feed\b/i,
  /post-?cutoff/i,
  /post-World-Memory-update/i,
  /컷오프/,
  /수집\s*기사/,
  /(^|[^가-힣A-Za-z])피드(?!백)/,
  /시장\s*메모리/,
  /편집회의\s*체크리스트/,
  /하네스/,
];

const LECTURE_PATTERNS = [
  /봐야 합니다/g,
  /확인해야 합니다/g,
  /점검해야 합니다/g,
  /잊으면 안 됩니다/g,
  /필요합니다/g,
  /투자자는/g,
  /핵심은/g,
  /문제는/g,
];

const ATTRIBUTION_PATTERNS = [
  /에 따르면/g,
  /라고 말했습니다/g,
  /라고 밝혔습니다/g,
  /라고 전했습니다/g,
  /라고 설명했습니다/g,
  /라고 봤습니다/g,
  /라고 분석했습니다/g,
  /라고 경고했습니다/g,
];

function stripHtml(html) {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function paragraphCountsBySection(html) {
  const tokens = String(html || "").match(/<h2[\s\S]*?<\/h2>|<p[\s\S]*?<\/p>/gi) || [];
  const counts = [];
  let current = null;
  for (const token of tokens) {
    if (/^<h2/i.test(token)) {
      if (current !== null) counts.push(current);
      current = 0;
    } else if (/^<p/i.test(token) && current !== null) {
      current += 1;
    }
  }
  if (current !== null) counts.push(current);
  return counts;
}

function countMatches(text, pattern) {
  return Array.from(String(text || "").matchAll(pattern)).length;
}

function sourceBasisUsesWorldMemory(metadata) {
  return Array.isArray(metadata.sourceBasis) && metadata.sourceBasis.some((item) => /world memory/i.test(String(item)));
}

function sourceBasisUsesNewsFeed(metadata) {
  return Array.isArray(metadata.sourceBasis) && metadata.sourceBasis.some((item) => /news feed/i.test(String(item)));
}

function parseTimestamp(value) {
  const timestamp = Date.parse(String(value || ""));
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function newsFeedItemTimestamp(item = {}) {
  for (const field of ["publishedAt", "fetchedAt", "translatedAt"]) {
    const timestamp = parseTimestamp(item[field]);
    if (timestamp) return { field, timestamp };
  }
  return { field: "", timestamp: 0 };
}

function articleTimestamp(articleDir, metadata = {}) {
  const explicit = parseTimestamp(metadata.uploadedAt || metadata.generatedAt || metadata.publishedAt || metadata.createdAt || metadata.updatedAt);
  if (explicit) return explicit;
  try {
    return statSync(articleDir).mtimeMs || 0;
  } catch {
    return 0;
  }
}

function cleanIdentityText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function cleanUrl(value) {
  return cleanIdentityText(value).replace(/[),.;]+$/g, "");
}

function identitySet(values = []) {
  return Array.from(new Set(values.map(cleanIdentityText).filter(Boolean)));
}

function magazineNewsFeedIds(metadata = {}) {
  const items = Array.isArray(metadata.newsFeed?.items) ? metadata.newsFeed.items : [];
  return identitySet(items.map((item) => item?.id || item?.sourceFingerprint));
}

function heroImageSourceAnchors(metadata = {}) {
  const hero = metadata.heroImage && typeof metadata.heroImage === "object" ? metadata.heroImage : {};
  return identitySet([
    hero.sourceUrl,
    hero.sourceURL,
    hero.pageUrl,
    hero.originalUrl,
    hero.href,
    /^https?:\/\//i.test(String(hero.src || "")) ? hero.src : "",
  ].map(cleanUrl));
}

function sourceBasisAnchors(metadata = {}) {
  const sourceBasis = Array.isArray(metadata.sourceBasis) ? metadata.sourceBasis : [];
  const heroAnchors = new Set(heroImageSourceAnchors(metadata));
  const anchors = [];
  for (const item of sourceBasis) {
    const text = String(item || "");
    anchors.push(...Array.from(text.matchAll(/https?:\/\/[^\s)"'<>]+/gi), (match) => cleanUrl(match[0])));
  }
  return identitySet(anchors).filter((anchor) => !heroAnchors.has(anchor));
}

function normalizeSignatureString(value) {
  return cleanIdentityText(value).toLowerCase();
}

function normalizeSignatureList(value) {
  const values = Array.isArray(value) ? value : value ? [value] : [];
  return Array.from(new Set(values.map(normalizeSignatureString).filter(Boolean))).sort();
}

function normalizeEventSignature(source = {}, metadata = {}, index = 0) {
  if (!source || typeof source !== "object" || Array.isArray(source)) return null;

  const normalized = {
    role: normalizeSignatureString(source.role || (index === 0 ? "primary" : "supporting")),
    actor: normalizeSignatureString(source.actor),
    action: normalizeSignatureString(source.action),
    object: normalizeSignatureList(source.object || source.objects),
    time: normalizeSignatureString(source.time || source.occurredAt || source.publishedAt),
    marketMechanism: normalizeSignatureString(source.marketMechanism || source.market_mechanism),
    sourceIds: normalizeSignatureList(source.sourceIds || source.source_ids || magazineNewsFeedIds(metadata)),
  };

  if (
    !normalized.actor &&
    !normalized.action &&
    !normalized.object.length &&
    !normalized.time &&
    !normalized.marketMechanism &&
    !normalized.sourceIds.length
  ) {
    return null;
  }
  return normalized;
}

function normalizedEventSignatures(metadata = {}) {
  const explicitList = Array.isArray(metadata.eventSignatures) ? metadata.eventSignatures : [];
  const single = metadata.eventSignature && typeof metadata.eventSignature === "object" && !Array.isArray(metadata.eventSignature)
    ? [metadata.eventSignature]
    : [];
  const sourceList = explicitList.length ? explicitList : single;
  return sourceList
    .map((signature, index) => normalizeEventSignature(signature, metadata, index))
    .filter(Boolean);
}

function primaryEventSignature(metadata = {}) {
  const signatures = normalizedEventSignatures(metadata);
  return signatures.find((signature) => signature.role === "primary") || signatures[0] || null;
}

function eventSignatureHashFor(normalized) {
  if (!normalized) return "";
  return createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
}

function primaryEventSignatureHash(metadata = {}) {
  return eventSignatureHashFor(primaryEventSignature(metadata));
}

function magazineWorldMemoryEventIds(metadata = {}) {
  const hits = Array.isArray(metadata.worldMemory?.vectorSearch?.hits) ? metadata.worldMemory.vectorSearch.hits : [];
  return identitySet(
    hits.map((hit) => {
      if (hit && typeof hit === "object") return hit.eventId || hit.event_id || hit.id || "";
      return "";
    }),
  );
}

function articleIdentity({ articleId, metadata, source = "candidate", timestamp = 0 }) {
  const worldMemoryEventIds = magazineWorldMemoryEventIds(metadata);
  return {
    articleId,
    source,
    timestamp,
    title: cleanIdentityText(metadata.title || articleId),
    storyFamily: cleanIdentityText(metadata.storyFamily || metadata.storyKey || ""),
    editorialAngle: cleanIdentityText(metadata.editorialAngle || ""),
    noveltyNote: cleanIdentityText(metadata.noveltyNote || ""),
    newsFeedIds: magazineNewsFeedIds(metadata),
    sourceAnchors: sourceBasisAnchors(metadata),
    primaryEventSignatureHash: cleanIdentityText(metadata.eventSignatureHash || metadata.primaryEventSignatureHash || primaryEventSignatureHash(metadata)),
    worldMemoryEventIds,
    primaryWorldMemoryEventId: worldMemoryEventIds[0] || "",
  };
}

function sharedValues(left = [], right = []) {
  const rightSet = new Set(right);
  return left.filter((value) => rightSet.has(value));
}

function articleReference(record) {
  const label = record.source === "baseline" ? "recent uploaded article" : "same check set article";
  return `${label} ${record.articleId}`;
}

function duplicateNoveltyIssues(candidates, baselineRecords = []) {
  const issues = [];
  const previous = [...baselineRecords];
  const issueSizedCandidateSet = candidates.length <= ISSUE_SLATE_MAX_ARTICLES;

  for (const candidate of candidates) {
    for (const other of previous) {
      if (candidate.articleId === other.articleId && candidate.source === other.source) continue;

      const sharedNewsFeedIds = sharedValues(candidate.newsFeedIds, other.newsFeedIds);
      if (sharedNewsFeedIds.length) {
        issues.push({
          articleId: candidate.articleId,
          level: "error",
          code: "duplicate-news-feed-anchor",
          message: `article reuses local evidence item(s) ${sharedNewsFeedIds.join(", ")} from ${articleReference(other)}`,
        });
      }

      const sharedSourceAnchors = sharedValues(candidate.sourceAnchors, other.sourceAnchors);
      if (sharedSourceAnchors.length) {
        issues.push({
          articleId: candidate.articleId,
          level: "error",
          code: "duplicate-source-anchor",
          message: `article reuses source URL(s) ${sharedSourceAnchors.join(", ")} from ${articleReference(other)}`,
        });
      }

      if (candidate.primaryEventSignatureHash && candidate.primaryEventSignatureHash === other.primaryEventSignatureHash) {
        issues.push({
          articleId: candidate.articleId,
          level: "error",
          code: "duplicate-event-signature",
          message: `article reuses primary event signature ${candidate.primaryEventSignatureHash.slice(0, 16)} from ${articleReference(other)}`,
        });
      }

      if (
        candidate.primaryWorldMemoryEventId &&
        candidate.primaryWorldMemoryEventId === other.primaryWorldMemoryEventId &&
        candidate.storyFamily &&
        candidate.storyFamily === other.storyFamily &&
        !candidate.newsFeedIds.length &&
        !candidate.sourceAnchors.length
      ) {
        issues.push({
          articleId: candidate.articleId,
          level: "error",
          code: "duplicate-world-memory-anchor",
          message: `article reuses primary continuity event ${candidate.primaryWorldMemoryEventId} and storyFamily "${candidate.storyFamily}" from ${articleReference(other)} without a fresh local evidence id or source URL anchor`,
        });
      }

      if (
        issueSizedCandidateSet &&
        candidate.storyFamily &&
        candidate.editorialAngle &&
        candidate.storyFamily === other.storyFamily &&
        candidate.editorialAngle === other.editorialAngle
      ) {
        issues.push({
          articleId: candidate.articleId,
          level: "warn",
          code: "duplicate-story-angle",
          message: `article repeats storyFamily "${candidate.storyFamily}" with editorialAngle "${candidate.editorialAngle}" from ${articleReference(other)}`,
        });
      }

    }
    previous.push(candidate);
  }

  return issues;
}

function externalSourceCount(metadata) {
  if (!Array.isArray(metadata.sourceBasis)) return 0;
  return metadata.sourceBasis.filter((item) => {
    const text = String(item || "");
    return /^https?:\/\//i.test(text) || /https?:\/\//i.test(text) || /^[A-Z][A-Za-z .&-]+,\s*\d{4}/.test(text);
  }).length;
}

function countAttributions(html, text) {
  const quoteBlocks = (String(html || "").match(/<blockquote\b/gi) || []).length;
  const attributedText = ATTRIBUTION_PATTERNS.reduce((sum, pattern) => sum + countMatches(text, pattern), 0);
  return quoteBlocks + attributedText;
}

function heroImageExtension(src) {
  const value = String(src || "").trim();
  if (!value) return "";
  try {
    return extname(new URL(value).pathname).toLowerCase();
  } catch {
    return extname(value.split(/[?#]/)[0]).toLowerCase();
  }
}

function heroSourceUrl(heroImage, src) {
  const source = heroImage && typeof heroImage === "object" ? heroImage : {};
  const explicitSource = String(source.sourceUrl || source.sourceURL || source.pageUrl || source.originalUrl || source.href || "").trim();
  if (explicitSource) return explicitSource;
  return /^https?:\/\//i.test(String(src || "")) ? String(src).trim() : "";
}

function jpegDimensions(buffer) {
  let offset = 2;
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) return null;
    const marker = buffer[offset + 1];
    const length = buffer.readUInt16BE(offset + 2);
    if (length < 2) return null;
    if (
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf)
    ) {
      return {
        width: buffer.readUInt16BE(offset + 7),
        height: buffer.readUInt16BE(offset + 5),
      };
    }
    offset += 2 + length;
  }
  return null;
}

function pngDimensions(buffer) {
  if (buffer.length < 24 || buffer.toString("ascii", 1, 4) !== "PNG") return null;
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

function webpDimensions(buffer) {
  if (buffer.length < 30 || buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WEBP") {
    return null;
  }
  const type = buffer.toString("ascii", 12, 16);
  if (type === "VP8 " && buffer.length >= 30) {
    return {
      width: buffer.readUInt16LE(26) & 0x3fff,
      height: buffer.readUInt16LE(28) & 0x3fff,
    };
  }
  if (type === "VP8L" && buffer.length >= 25) {
    const bits = buffer.readUInt32LE(21);
    return {
      width: (bits & 0x3fff) + 1,
      height: ((bits >> 14) & 0x3fff) + 1,
    };
  }
  if (type === "VP8X" && buffer.length >= 30) {
    return {
      width: buffer.readUIntLE(24, 3) + 1,
      height: buffer.readUIntLE(27, 3) + 1,
    };
  }
  return null;
}

function imageDimensions(buffer, extension) {
  if (extension === ".jpg" || extension === ".jpeg") return jpegDimensions(buffer);
  if (extension === ".png") return pngDimensions(buffer);
  if (extension === ".webp") return webpDimensions(buffer);
  return null;
}

function checkLocalHeroAsset(articleId, src, extension) {
  const issues = [];
  if (!src.startsWith("assets/")) return issues;
  if (src.includes("\0") || src.split(/[\\/]+/).some((part) => part === "." || part === "..")) {
    return [{ level: "error", code: "hero-image-local-path-invalid", message: "local heroImage assets must stay inside the article assets directory" }];
  }

  const path = join(ARTICLES_DIR, articleId, src);
  if (!existsSync(path)) {
    return [{ level: "error", code: "hero-image-local-file-missing", message: `local heroImage asset does not exist: ${src}` }];
  }

  const fileStat = statSync(path);
  if (!fileStat.isFile()) {
    issues.push({ level: "error", code: "hero-image-local-file-invalid", message: `local heroImage asset is not a file: ${src}` });
    return issues;
  }

  if (fileStat.size < HERO_MIN_BYTES) {
    issues.push({
      level: "error",
      code: "hero-image-too-small",
      message: `local heroImage asset is ${fileStat.size} bytes; use a real article image, not a placeholder or 1px mock`,
    });
  }

  try {
    const dimensions = imageDimensions(readFileSync(path), extension);
    if (!dimensions) {
      issues.push({ level: "error", code: "hero-image-dimensions-unreadable", message: `could not read local heroImage dimensions: ${src}` });
    } else if (dimensions.width < HERO_MIN_WIDTH || dimensions.height < HERO_MIN_HEIGHT) {
      issues.push({
        level: "error",
        code: "hero-image-too-small-dimensions",
        message: `local heroImage asset is ${dimensions.width}x${dimensions.height}; minimum is ${HERO_MIN_WIDTH}x${HERO_MIN_HEIGHT}`,
      });
    }
  } catch (error) {
    issues.push({ level: "error", code: "hero-image-file-read-failed", message: `could not inspect local heroImage asset: ${error.message}` });
  }

  return issues;
}

async function readMagazineTopicCatalog() {
  const raw = JSON.parse(await readFile(MAGAZINE_TOPICS_PATH, "utf8"));
  const topics = Array.isArray(raw?.topics) ? raw.topics : [];
  const labels = topics
    .map((topic) => String(topic?.label || "").trim())
    .filter(Boolean);
  if (!labels.length) {
    throw new Error(`magazine topic catalog has no labels: ${MAGAZINE_TOPICS_PATH}`);
  }
  return {
    labels,
    labelSet: new Set(labels),
  };
}

function checkArticleTopics(metadata, topicCatalog) {
  const issues = [];
  const rawTopics = Array.isArray(metadata.topics)
    ? metadata.topics
    : metadata.topic
      ? [metadata.topic]
      : [];
  const topics = rawTopics.map((topic) => String(topic || "").trim()).filter(Boolean);

  if (!topics.length) {
    issues.push({
      level: "error",
      code: "topics-missing",
      message: `metadata.topics must include at least one configured topic: ${topicCatalog.labels.join(", ")}`,
    });
    return issues;
  }

  if (topics.length > MAX_ARTICLE_TOPICS) {
    issues.push({
      level: "error",
      code: "topics-too-many",
      message: `metadata.topics must include at most ${MAX_ARTICLE_TOPICS} configured topic(s); got ${topics.length}`,
    });
  }

  const seen = new Set();
  const duplicates = [];
  const invalid = [];
  for (const topic of topics) {
    if (seen.has(topic)) duplicates.push(topic);
    seen.add(topic);
    if (!topicCatalog.labelSet.has(topic)) invalid.push(topic);
  }

  if (invalid.length) {
    issues.push({
      level: "error",
      code: "topics-outside-catalog",
      message: `metadata.topics contains non-catalog topic(s): ${Array.from(new Set(invalid)).join(", ")}; allowed topics: ${topicCatalog.labels.join(", ")}`,
    });
  }

  if (duplicates.length) {
    issues.push({
      level: "error",
      code: "topics-duplicate",
      message: `metadata.topics contains duplicate topic(s): ${Array.from(new Set(duplicates)).join(", ")}`,
    });
  }

  return issues;
}

function checkHeroImage(articleId, metadata) {
  const issues = [];
  const heroImage = metadata.heroImage && typeof metadata.heroImage === "object" ? metadata.heroImage : {};
  const src = String(heroImage.src || heroImage.url || "").trim();
  const extension = heroImageExtension(src);
  const sourceUrl = heroSourceUrl(heroImage, src);
  const credit = String(heroImage.credit || "").trim();
  const rights = String(heroImage.license || heroImage.rights || heroImage.usageNote || heroImage.usagePolicy || "").trim();

  if (!src) {
    issues.push({ level: "error", code: "hero-image-src-missing", message: "heroImage.src must point to a real article image" });
    return issues;
  }

  if (extension === ".svg") {
    issues.push({
      level: "error",
      code: "hero-image-vector-mock",
      message: "heroImage must use a real photo/news/open bitmap image; SVG/vector mock hero assets are prototype-only and cannot be published",
    });
  } else if (extension && !HERO_BITMAP_EXTENSIONS.has(extension)) {
    issues.push({
      level: "error",
      code: "hero-image-unsupported-format",
      message: `heroImage uses unsupported extension "${extension}"; use jpg, jpeg, png, webp, or avif`,
    });
  } else if (!extension && src.startsWith("assets/")) {
    issues.push({
      level: "error",
      code: "hero-image-extension-missing",
      message: "local heroImage assets must have a bitmap extension: jpg, jpeg, png, webp, or avif",
    });
  }

  if (!credit || /^FinanceAgentGUI$/i.test(credit)) {
    issues.push({
      level: "error",
      code: "hero-image-credit-missing",
      message: "heroImage.credit must name the real image source or photographer, not the app",
    });
  }

  if (!/^https?:\/\//i.test(sourceUrl)) {
    issues.push({
      level: "error",
      code: "hero-image-source-url-missing",
      message: "heroImage.sourceUrl or pageUrl must include the original image/source page URL",
    });
  }

  if (!rights) {
    issues.push({
      level: "error",
      code: "hero-image-rights-missing",
      message: "heroImage must include license, rights, usagePolicy, or usageNote; use open-license/official-source when available, or editorial-private-use for local private news images",
    });
  }

  issues.push(...checkLocalHeroAsset(articleId, src, extension));
  return issues;
}

function validScore(value) {
  return Number.isFinite(Number(value)) && Number(value) >= 0 && Number(value) <= 100;
}

function checkCoverDecision(metadata) {
  const issues = [];
  const isCoverStory = Boolean(metadata.isCoverStory);
  const decision = metadata.coverDecision && typeof metadata.coverDecision === "object" ? metadata.coverDecision : null;
  const scorePolicy = String(decision?.scorePolicy || "").trim();
  const mode = String(decision?.mode || "").trim();
  const isBootstrapCoverFill = mode === "bootstrap-cover-fill" || scorePolicy === "not-scored-total-articles-lte-5";

  if (isCoverStory && !String(metadata.coverRegisteredAt || "").trim()) {
    issues.push({
      level: "error",
      code: "cover-registered-at-missing",
      message: "cover stories must set coverRegisteredAt when promoted",
    });
  }

  if (isCoverStory && !decision) {
    issues.push({
      level: "error",
      code: "cover-decision-missing",
      message: "cover stories must include metadata.coverDecision explaining why the article beat the recent upload comparison window",
    });
    return issues;
  }

  if (!decision) return issues;

  if (decision.policy !== "world-memory-cover-v1") {
    issues.push({
      level: "error",
      code: "cover-decision-policy-invalid",
      message: "coverDecision.policy must be world-memory-cover-v1",
    });
  }

  if (!["promote", "do-not-promote"].includes(String(decision.result || ""))) {
    issues.push({
      level: "error",
      code: "cover-decision-result-invalid",
      message: "coverDecision.result must be promote or do-not-promote",
    });
  }

  if (isCoverStory && decision.result !== "promote") {
    issues.push({
      level: "error",
      code: "cover-decision-result-conflict",
      message: "isCoverStory=true requires coverDecision.result=promote",
    });
  }

  if (!isCoverStory && decision.result === "promote") {
    issues.push({
      level: "error",
      code: "cover-decision-result-conflict",
      message: "coverDecision.result=promote requires isCoverStory=true",
    });
  }

  if (!String(decision.evaluatedAt || "").trim()) {
    issues.push({
      level: "error",
      code: "cover-decision-evaluated-at-missing",
      message: "coverDecision.evaluatedAt is required",
    });
  }

  const comparisonWindow = decision.comparisonWindow && typeof decision.comparisonWindow === "object" ? decision.comparisonWindow : {};
  if (comparisonWindow.basis !== "upload-time" || Number(comparisonWindow.articleLimit) !== 5 || !Array.isArray(comparisonWindow.articleIds)) {
    issues.push({
      level: "error",
      code: "cover-comparison-window-invalid",
      message: "coverDecision.comparisonWindow must use basis=upload-time, articleLimit=5, and articleIds[]",
    });
  } else if (comparisonWindow.articleIds.length > 5) {
    issues.push({
      level: "error",
      code: "cover-comparison-window-too-large",
      message: "coverDecision.comparisonWindow.articleIds must contain at most the previous five uploaded articles",
    });
  }

  const totalArticleCount = Number(comparisonWindow.totalArticleCount);
  if (isBootstrapCoverFill && (!Number.isFinite(totalArticleCount) || totalArticleCount > 5)) {
    issues.push({
      level: "error",
      code: "cover-bootstrap-total-invalid",
      message: "bootstrap-cover-fill is only valid when comparisonWindow.totalArticleCount is 5 or less",
    });
  }

  const worldMemorySignals = decision.worldMemorySignals && typeof decision.worldMemorySignals === "object" ? decision.worldMemorySignals : {};
  if (!isBootstrapCoverFill && !String(worldMemorySignals.mostImportantIssue || "").trim() && !String(worldMemorySignals.mostRecentIssue || "").trim()) {
    issues.push({
      level: "error",
      code: "cover-world-memory-signal-missing",
      message: "coverDecision.worldMemorySignals must name the most important issue or the most recent issue used for cover promotion",
    });
  }

  if (isBootstrapCoverFill && decision.candidateScore !== null && decision.candidateScore !== undefined) {
    issues.push({
      level: "error",
      code: "cover-bootstrap-candidate-score-present",
      message: "bootstrap-cover-fill must not score candidateScore; use null or omit it",
    });
  } else if (!isBootstrapCoverFill && !validScore(decision.candidateScore)) {
    issues.push({
      level: "error",
      code: "cover-candidate-score-invalid",
      message: "coverDecision.candidateScore must be a number from 0 to 100",
    });
  }

  if (isBootstrapCoverFill && decision.bestPreviousScore !== null && decision.bestPreviousScore !== undefined) {
    issues.push({
      level: "error",
      code: "cover-bootstrap-previous-score-present",
      message: "bootstrap-cover-fill must not score bestPreviousScore; use null or omit it",
    });
  } else if (decision.bestPreviousScore !== null && decision.bestPreviousScore !== undefined && !validScore(decision.bestPreviousScore)) {
    issues.push({
      level: "error",
      code: "cover-previous-score-invalid",
      message: "coverDecision.bestPreviousScore must be null or a number from 0 to 100",
    });
  }

  if (!String(decision.rationale || "").trim()) {
    issues.push({
      level: "error",
      code: "cover-rationale-missing",
      message: "coverDecision.rationale must explain why the candidate is or is not stronger than the comparison window",
    });
  }

  return issues;
}

function checkNewsFeedEvidence(metadata) {
  const issues = [];
  const usesNewsFeed = Boolean(metadata.newsFeed) || sourceBasisUsesNewsFeed(metadata);
  if (!usesNewsFeed) return issues;

  const evidence = metadata.newsFeed && typeof metadata.newsFeed === "object" ? metadata.newsFeed : null;
  if (!evidence) {
    issues.push({
      level: "error",
      code: "news-feed-evidence-missing",
      message: "local evidence based articles must include metadata.newsFeed evidence",
    });
    return issues;
  }

  if (evidence.selectionPolicy !== "post-world-memory-update-only") {
    issues.push({
      level: "error",
      code: "news-feed-policy-invalid",
      message: "metadata.newsFeed.selectionPolicy must be post-world-memory-update-only",
    });
  }

  const cutoff = parseTimestamp(evidence.worldMemoryLastSuccessfulAt);
  if (!cutoff) {
    issues.push({
      level: "error",
      code: "news-feed-world-memory-cutoff-missing",
      message: "metadata.newsFeed.worldMemoryLastSuccessfulAt must record the internal eligibility boundary",
    });
  }

  const items = Array.isArray(evidence.items) ? evidence.items : [];
  if (!items.length) {
    issues.push({
      level: "error",
      code: "news-feed-items-missing",
      message: "metadata.newsFeed.items must include the eligible local evidence item(s) used",
    });
    return issues;
  }

  if (!cutoff) return issues;
  for (const item of items) {
    const itemTime = newsFeedItemTimestamp(item);
    if (!itemTime.timestamp) {
      issues.push({
        level: "error",
        code: "news-feed-item-time-missing",
        message: `local evidence item ${item?.id || "(missing id)"} needs publishedAt, fetchedAt, or translatedAt`,
      });
    } else if (itemTime.timestamp <= cutoff) {
      issues.push({
        level: "error",
        code: "news-feed-before-world-memory-cutoff",
        message: `local evidence item ${item?.id || "(missing id)"} uses ${itemTime.field} at or before worldMemoryLastSuccessfulAt`,
      });
    }
  }

  return issues;
}

async function readArticle(articleId) {
  const dir = join(ARTICLES_DIR, articleId);
  const metadata = JSON.parse(await readFile(join(dir, "metadata.json"), "utf8"));
  const html = await readFile(join(dir, "article.html"), "utf8");
  return { articleId, metadata, html };
}

function checkArticle({ articleId, metadata, html }, topicCatalog) {
  const issues = [];
  const visibleMetadata = [metadata.deck, metadata.summary].filter(Boolean).join("\n");
  const bodyText = stripHtml(html);
  const visibleText = `${visibleMetadata}\n${bodyText}`;
  const articleType = String(metadata.articleType || "analysis");
  const minLength = LENGTH_TARGETS[articleType] || LENGTH_TARGETS.analysis;
  const compactLength = bodyText.replace(/\s/g, "").length;
  const h2Count = (html.match(/<h2\b/gi) || []).length;
  const paragraphCount = (html.match(/<p\b/gi) || []).length;
  const sectionParagraphCounts = paragraphCountsBySection(html);
  const attributionCount = countAttributions(html, bodyText);
  const sourceCount = Array.isArray(metadata.sourceBasis) ? metadata.sourceBasis.length : 0;

  if (!metadata.title || !metadata.summary || !metadata.heroImage) {
    issues.push({ level: "error", code: "metadata-missing-catalog-fields", message: "metadata must include title, summary, and heroImage" });
  }

  issues.push(...checkArticleTopics(metadata, topicCatalog));
  issues.push(...checkHeroImage(articleId, metadata));
  issues.push(...checkCoverDecision(metadata));
  issues.push(...checkNewsFeedEvidence(metadata));

  if (!Array.isArray(metadata.sourceBasis) || metadata.sourceBasis.length < 3) {
    issues.push({ level: "error", code: "source-basis-too-thin", message: "sourceBasis should include at least three source or evidence entries" });
  }

  if (sourceCount < 5) {
    issues.push({ level: "warn", code: "source-basis-density-low", message: `sourceBasis has ${sourceCount} entries; magazine generation should usually use 5+ evidence entries` });
  }

  for (const pattern of INTERNAL_PHRASES) {
    if (pattern.test(visibleText)) {
      issues.push({ level: "error", code: "internal-process-language", message: `reader-facing text contains internal phrase pattern ${pattern}` });
    }
  }

  const usesWorldMemory = Boolean(metadata.worldMemory) || sourceBasisUsesWorldMemory(metadata);
  const usesNewsFeed = Boolean(metadata.newsFeed) || sourceBasisUsesNewsFeed(metadata);
  if (usesWorldMemory) {
    const evidence = metadata.worldMemory || {};
    const vector = evidence.vectorSearch || {};
    if (evidence.retrievalPolicy !== "mandatory-vector-search" || !evidence.query || !vector.engine || !vector.model || !Array.isArray(vector.hits) || !vector.hits.length) {
      issues.push({ level: "error", code: "world-memory-vector-evidence-missing", message: "World Memory based articles need query, engine, model, and vector hits" });
    }
  }

  if (!usesWorldMemory && !usesNewsFeed && externalSourceCount(metadata) < 3) {
    issues.push({ level: "error", code: "external-research-too-thin", message: "external-research articles need at least three external sourceBasis entries" });
  }

  const allowedResearchModes = ["external-research", "external-first", "mixed-research", "news-feed-first", "news-feed-with-world-memory-backup"];
  if (!usesWorldMemory && !allowedResearchModes.includes(String(metadata.researchMode || ""))) {
    issues.push({ level: "warn", code: "research-mode-missing", message: "non-World-Memory articles should declare researchMode" });
  }

  if (!metadata.editorialAngle) {
    issues.push({ level: "warn", code: "editorial-angle-missing", message: "metadata.editorialAngle helps avoid repeated generic issue explainers" });
  }

  if (/무엇인가|뭡니까|알아야 할|총정리|개론/.test(`${metadata.deck || ""}`)) {
    issues.push({ level: "warn", code: "generic-explainer-framing", message: "deck may read like a repeated generic explainer" });
  }

  if (compactLength < minLength) {
    issues.push({
      level: "warn",
      code: "body-too-short",
      message: `${articleType} body has ${compactLength} non-space chars; target is ${minLength}+`,
    });
  }

  const lectureCount = LECTURE_PATTERNS.reduce((sum, pattern) => sum + countMatches(visibleText, pattern), 0);
  if (lectureCount >= 10) {
    issues.push({ level: "warn", code: "lecture-tone-risk", message: `teacherly or generic guidance patterns appear ${lectureCount} times` });
  }

  const twoParagraphSections = sectionParagraphCounts.filter((count) => count === 2).length;
  if (h2Count >= 4 && twoParagraphSections >= Math.max(3, Math.ceil(sectionParagraphCounts.length * 0.7))) {
    issues.push({
      level: "warn",
      code: "uniform-h2-rhythm",
      message: `section paragraph counts look templated: ${sectionParagraphCounts.join(", ")}`,
    });
  }

  if (paragraphCount < 10) {
    issues.push({ level: "warn", code: "paragraph-count-low", message: `article has only ${paragraphCount} body paragraphs` });
  }

  if (/[가-힣][\s\n]+of[\s\n]+[가-힣]/i.test(visibleText)) {
    issues.push({
      level: "warn",
      code: "stray-english-token",
      message: "reader-facing Korean text contains a stray English connector such as 'of' between Korean words",
    });
  }

  return {
    ...articleIdentity({ articleId, metadata, source: "candidate" }),
    articleId,
    title: metadata.title || articleId,
    articleType,
    compactLength,
    h2Count,
    paragraphCount,
    attributionCount,
    sectionParagraphCounts,
    issues,
  };
}

async function readBaselineArticleIdentities() {
  if (!BASELINE_ARTICLES_DIR || !existsSync(BASELINE_ARTICLES_DIR)) return [];
  const records = [];
  for (const name of await readdir(BASELINE_ARTICLES_DIR)) {
    const articleDir = join(BASELINE_ARTICLES_DIR, name);
    const itemStat = await stat(articleDir).catch(() => null);
    if (!itemStat?.isDirectory()) continue;
    const metadataPath = join(articleDir, "metadata.json");
    if (!existsSync(metadataPath)) continue;
    try {
      const metadata = JSON.parse(await readFile(metadataPath, "utf8"));
      records.push(articleIdentity({
        articleId: name,
        metadata,
        source: "baseline",
        timestamp: articleTimestamp(articleDir, metadata),
      }));
    } catch {
      // Ignore malformed baseline articles; the candidate set is still checked normally.
    }
  }
  return records
    .sort((left, right) => right.timestamp - left.timestamp || left.articleId.localeCompare(right.articleId))
    .slice(0, Math.max(0, BASELINE_ARTICLE_LIMIT));
}

async function main() {
  if (!existsSync(ARTICLES_DIR)) {
    console.error(`missing articles directory: ${ARTICLES_DIR}`);
    process.exit(1);
  }
  if (!existsSync(MAGAZINE_TOPICS_PATH)) {
    console.error(`missing magazine topic catalog: ${MAGAZINE_TOPICS_PATH}`);
    process.exit(1);
  }

  const topicCatalog = await readMagazineTopicCatalog();

  const articleIds = [];
  for (const name of await readdir(ARTICLES_DIR)) {
    const itemStat = await stat(join(ARTICLES_DIR, name));
    if (itemStat.isDirectory()) articleIds.push(name);
  }
  articleIds.sort();

  const results = [];
  for (const articleId of articleIds) {
    results.push(checkArticle(await readArticle(articleId), topicCatalog));
  }
  const baselineRecords = await readBaselineArticleIdentities();

  const storyFamilyCounts = new Map();
  const angleCounts = new Map();
  for (const result of results) {
    if (result.storyFamily) storyFamilyCounts.set(result.storyFamily, (storyFamilyCounts.get(result.storyFamily) || 0) + 1);
    if (result.editorialAngle) angleCounts.set(result.editorialAngle, (angleCounts.get(result.editorialAngle) || 0) + 1);
  }
  const slateIssues = [];
  if (results.length >= 5 && results.length <= ISSUE_SLATE_MAX_ARTICLES) {
    for (const [storyFamily, count] of storyFamilyCounts.entries()) {
      if (count > 2) {
        slateIssues.push({
          articleId: "__issue_slate__",
          level: "warn",
          code: "story-family-concentration",
          message: `${count} articles share storyFamily "${storyFamily}"; five-article issues should usually cap a family at two`,
        });
      }
    }
    const hasLowLevel = (angleCounts.get("low-level-signal") || 0) + (angleCounts.get("data-anomaly") || 0) + (angleCounts.get("human-drama") || 0);
    if (!hasLowLevel) {
      slateIssues.push({
        articleId: "__issue_slate__",
        level: "warn",
        code: "no-low-level-signal",
        message: "issue slate has no low-level-signal, data-anomaly, or human-drama article",
      });
    }
    const hasExternal = (angleCounts.get("external-research") || 0) > 0;
    if (!hasExternal) {
      slateIssues.push({
        articleId: "__issue_slate__",
        level: "warn",
        code: "no-external-research-angle",
        message: "issue slate has no external-research article; World Memory should not be the only doorway",
      });
    }
  }
  slateIssues.push(...duplicateNoveltyIssues(results, baselineRecords));

  const errors = [
    ...results.flatMap((result) => result.issues.filter((issue) => issue.level === "error").map((issue) => ({ articleId: result.articleId, ...issue }))),
    ...slateIssues.filter((issue) => issue.level === "error"),
  ];
  const warnings = [
    ...results.flatMap((result) => result.issues.filter((issue) => issue.level === "warn").map((issue) => ({ articleId: result.articleId, ...issue }))),
    ...slateIssues.filter((issue) => issue.level === "warn"),
  ];
  const failed = errors.length > 0 || (strict && warnings.length > 0);

  if (jsonOutput) {
    console.log(JSON.stringify({ ok: !failed, articleCount: results.length, errors, warnings, baselineCount: baselineRecords.length, results }, null, 2));
  } else {
    console.log(`Magazine article style check: ${results.length} article(s)`);
    for (const result of results) {
      const issueText = result.issues.length ? `${result.issues.length} issue(s)` : "ok";
      console.log(`- ${result.articleId}: ${result.compactLength} chars, ${result.paragraphCount} paragraphs, ${result.attributionCount} attributions, ${issueText}`);
      for (const issue of result.issues) {
        console.log(`  [${issue.level}] ${issue.code}: ${issue.message}`);
      }
    }
    for (const issue of slateIssues) {
      console.log(`- ${issue.articleId}: [${issue.level}] ${issue.code}: ${issue.message}`);
    }
    console.log(`Summary: ${errors.length} error(s), ${warnings.length} warning(s)`);
  }

  if (failed && !warnOnly) process.exit(1);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
