#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = resolve(fileURLToPath(new URL(".", import.meta.url)));
const GUIBUILD_ROOT = resolve(SCRIPT_DIR, "..");
const LEGACY_CHECKER = join(SCRIPT_DIR, "magazine_article_style_check.mjs");
const ARTICLES_DIR = process.env.MAGAZINE_ARTICLES_DIR
  ? resolve(process.env.MAGAZINE_ARTICLES_DIR)
  : join(GUIBUILD_ROOT, "data", "magazine", "articles");

const args = new Set(process.argv.slice(2));
const strict = args.has("--strict");
const warnOnly = args.has("--warn-only");
const jsonOutput = args.has("--json");

const LEGACY_SELF_CERTIFICATION_CODES = new Set([
  "reader-tone-decision-missing",
  "reader-tone-policy-invalid",
  "reader-tone-method-invalid",
  "reader-tone-text-matching",
  "reader-tone-classifier-missing",
  "reader-directive",
  "reader-addressed-as-investor",
  "checklist-conclusion",
  "reader-tone-section-reviews-missing",
  "reader-tone-section-classification-invalid",
  "reader-tone-section-rationale-missing",
  "quote-flow-decision-missing",
  "quote-flow-policy-invalid",
  "quote-flow-method-invalid",
  "quote-flow-text-matching",
  "quote-flow-classifier-missing",
  "quote-flow-not-ok",
  "direct-quote-preference-missing",
  "direct-quote-coverage-missing",
  "indirect-attribution-limit-missing",
  "direct-quote-avoidance",
  "indirect-before-direct-repetition",
  "indirect-attribution-overused",
  "ornamental-quote-block",
  "quote-flow-reviews-missing",
  "quote-flow-classification-invalid",
  "quote-flow-rationale-missing",
]);

const DOWNGRADED_LEGACY_ERROR_CODES = new Set([
  "duplicate-source-anchor",
  "duplicate-story-angle",
  "internal-process-language",
]);

const EDITORIAL_REVIEW_POLICY = "magazine-editorial-review-v2";
const EDITORIAL_REVIEW_METHODS = new Set([
  "LLM_SEMANTIC_REVIEW",
  "LLM_INTEGRATED_ONE_SHOT_REVIEW",
]);

function runLegacyChecker() {
  const result = spawnSync(process.execPath, [LEGACY_CHECKER, "--json", "--warn-only"], {
    cwd: GUIBUILD_ROOT,
    env: process.env,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  const output = String(result.stdout || "").trim();
  if (!output) throw new Error(String(result.stderr || "legacy checker returned no JSON").trim());
  return JSON.parse(output);
}

function transformLegacyIssues(report) {
  const errors = [];
  const advisories = [];
  for (const issue of report.errors || []) {
    if (LEGACY_SELF_CERTIFICATION_CODES.has(issue.code)) continue;
    if (DOWNGRADED_LEGACY_ERROR_CODES.has(issue.code)) {
      advisories.push({ ...issue, level: "advisory", source: "legacy-compatibility" });
    } else {
      errors.push({ ...issue, level: "error", source: "legacy-structural-gate" });
    }
  }
  for (const issue of report.warnings || []) {
    advisories.push({ ...issue, level: "advisory", source: "legacy-editorial-signal" });
  }
  return { errors, advisories };
}

async function readEditorialReviewIssues() {
  const errors = [];
  const advisories = [];
  if (!existsSync(ARTICLES_DIR)) {
    return {
      errors: [{ articleId: "__harness__", level: "error", code: "articles-directory-missing", message: `missing articles directory: ${ARTICLES_DIR}` }],
      advisories,
    };
  }
  for (const articleId of await readdir(ARTICLES_DIR)) {
    const metadataPath = join(ARTICLES_DIR, articleId, "metadata.json");
    if (!existsSync(metadataPath)) continue;
    let metadata;
    try {
      metadata = JSON.parse(readFileSync(metadataPath, "utf8"));
    } catch (error) {
      errors.push({ articleId, level: "error", code: "editorial-review-metadata-unreadable", message: error.message });
      continue;
    }
    const review = metadata.editorialReviewDecision;
    if (!review || typeof review !== "object" || Array.isArray(review)) {
      errors.push({
        articleId,
        level: "error",
        code: "editorial-review-missing",
        message: "metadata.editorialReviewDecision must contain the v2 semantic editorial review",
      });
      continue;
    }
    if (review.policy !== EDITORIAL_REVIEW_POLICY || !EDITORIAL_REVIEW_METHODS.has(review.method)) {
      errors.push({
        articleId,
        level: "error",
        code: "editorial-review-contract-invalid",
        message: `editorial review must use policy=${EDITORIAL_REVIEW_POLICY} and an approved LLM review method`,
      });
    }
    if (
      review.method === "LLM_INTEGRATED_ONE_SHOT_REVIEW" &&
      review.publicationReady !== true
    ) {
      errors.push({
        articleId,
        level: "error",
        code: "integrated-editorial-review-not-ready",
        message: "integrated one-shot editorial review must explicitly set publicationReady=true",
      });
    }
    const issues = Array.isArray(review.issues) ? review.issues : [];
    for (const [index, issue] of issues.entries()) {
      const item = issue && typeof issue === "object" && !Array.isArray(issue) ? issue : {};
      const severity = String(item.severity || "advisory").toLowerCase();
      const normalized = {
        articleId,
        level: severity === "blocking" ? "error" : "advisory",
        code: String(item.code || `editorial-review-${index + 1}`),
        message: String(item.rationale || item.message || "semantic editorial review issue"),
        location: String(item.location || ""),
        suggestedFix: String(item.suggestedFix || ""),
        confidence: Number.isFinite(Number(item.confidence)) ? Number(item.confidence) : null,
        source: "v2-semantic-editorial-review",
      };
      if (normalized.level === "error") errors.push(normalized);
      else advisories.push(normalized);
    }
  }
  return { errors, advisories };
}

async function main() {
  const legacy = runLegacyChecker();
  const transformed = transformLegacyIssues(legacy);
  const semantic = await readEditorialReviewIssues();
  const errors = [...transformed.errors, ...semantic.errors];
  const advisories = [...transformed.advisories, ...semantic.advisories];
  const failed = errors.length > 0;
  const report = {
    ok: !failed,
    profile: "v2",
    strict,
    articleCount: legacy.articleCount || 0,
    errors,
    advisories,
    legacySummary: {
      errors: (legacy.errors || []).length,
      warnings: (legacy.warnings || []).length,
      ignoredSelfCertificationIssues: (legacy.errors || []).filter((issue) => LEGACY_SELF_CERTIFICATION_CODES.has(issue.code)).length,
      downgradedErrors: (legacy.errors || []).filter((issue) => DOWNGRADED_LEGACY_ERROR_CODES.has(issue.code)).length,
    },
  };
  if (jsonOutput) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`Magazine article quality check v2: ${report.articleCount} article(s)`);
    for (const issue of errors) console.log(`- ${issue.articleId}: [error] ${issue.code}: ${issue.message}`);
    for (const issue of advisories) console.log(`- ${issue.articleId}: [advisory] ${issue.code}: ${issue.message}`);
    console.log(`Summary: ${errors.length} error(s), ${advisories.length} advisory item(s)`);
  }
  if (failed && !warnOnly) process.exit(1);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
