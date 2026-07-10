#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = resolve(fileURLToPath(new URL(".", import.meta.url)));
const GUIBUILD_ROOT = resolve(SCRIPT_DIR, "..");
const ROOT = resolve(
  GUIBUILD_ROOT,
  process.env.MAGAZINE_EDITORIAL_EXEMPLARS_DIR || "data/magazine/editorial-exemplars",
);
const jsonOutput = process.argv.includes("--json");
const strict = process.argv.includes("--strict");

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function cleanArticleText(markdown) {
  return String(markdown || "")
    .replace(/^---[\s\S]*?---\s*/u, "")
    .replace(/^#{1,6}\s+/gmu, "")
    .replace(/\s/gu, "");
}

function issue(exemplarId, code, message, level = "error") {
  return { exemplarId, level, code, message };
}

function checkExemplar(exemplarId) {
  const dir = join(ROOT, exemplarId);
  const articlePath = join(dir, "article.md");
  const metadataPath = join(dir, "metadata.json");
  const editorialMapPath = join(dir, "editorial-map.json");
  const errors = [];
  const advisories = [];
  if (!existsSync(articlePath)) errors.push(issue(exemplarId, "article-missing", "article.md is required"));
  if (!existsSync(metadataPath)) errors.push(issue(exemplarId, "metadata-missing", "metadata.json is required"));
  if (!existsSync(editorialMapPath)) errors.push(issue(exemplarId, "editorial-map-missing", "editorial-map.json is required"));
  if (errors.length) return { errors, advisories, bodyChars: 0 };

  const article = readFileSync(articlePath, "utf8");
  const metadata = readJson(metadataPath);
  const editorialMap = readJson(editorialMapPath);
  if (!metadata) errors.push(issue(exemplarId, "metadata-invalid", "metadata.json must be valid JSON"));
  if (!editorialMap) errors.push(issue(exemplarId, "editorial-map-invalid", "editorial-map.json must be valid JSON"));
  if (!metadata || !editorialMap) return { errors, advisories, bodyChars: 0 };

  for (const field of ["title", "deck", "summary"]) {
    if (!String(metadata[field] || "").trim()) errors.push(issue(exemplarId, `${field}-missing`, `metadata.${field} is required`));
  }
  if (metadata.approved !== true) advisories.push(issue(exemplarId, "not-approved", "metadata.approved is not true; writer will ignore this exemplar", "advisory"));
  if (!Array.isArray(metadata.worldMemoryEventIds) || !metadata.worldMemoryEventIds.length) {
    errors.push(issue(exemplarId, "world-memory-evidence-missing", "metadata.worldMemoryEventIds must identify the live World Memory basis"));
  }
  if (!Array.isArray(metadata.sourceBasis) || metadata.sourceBasis.length < 3) {
    errors.push(issue(exemplarId, "source-basis-thin", "metadata.sourceBasis must contain at least three meaningful evidence entries"));
  }

  for (const field of ["thesis", "argumentativeTurns", "evidenceFunctions", "counterargument", "scaleShifts", "endingTransformation", "voice"]) {
    const value = editorialMap[field];
    if (Array.isArray(value) ? !value.length : !String(value || "").trim()) {
      errors.push(issue(exemplarId, `editorial-map-${field}-missing`, `editorial-map.${field} is required`));
    }
  }

  const bodyChars = cleanArticleText(article).length;
  if (bodyChars < 5500) advisories.push(issue(exemplarId, "scope-below-commission", `body has ${bodyChars} non-space characters; longform commission usually begins around 5500`, "advisory"));
  if (bodyChars > 8500) advisories.push(issue(exemplarId, "scope-above-commission", `body has ${bodyChars} non-space characters; verify every turn earns its space`, "advisory"));
  if (/World Memory|월드\s*메모리|News Feed|뉴스\s*피드|로컬\s*(?:저장소|스토어)|하네스|semantic-search|vector\s*search/iu.test(article)) {
    errors.push(issue(exemplarId, "internal-process-language", "article.md exposes internal production language"));
  }
  return { errors, advisories, bodyChars };
}

const exemplarIds = existsSync(ROOT)
  ? readdirSync(ROOT, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort()
  : [];
const checks = exemplarIds.map((id) => ({ id, ...checkExemplar(id) }));
const errors = checks.flatMap((item) => item.errors);
const advisories = checks.flatMap((item) => item.advisories);
const report = {
  ok: errors.length === 0,
  root: ROOT,
  exemplarCount: exemplarIds.length,
  approvedCount: exemplarIds.filter((id) => readJson(join(ROOT, id, "metadata.json"))?.approved === true).length,
  bodyChars: Object.fromEntries(checks.map((item) => [item.id, item.bodyChars])),
  errors,
  advisories,
};

if (jsonOutput) console.log(JSON.stringify(report, null, 2));
else {
  console.log(`Magazine editorial exemplars: ${report.exemplarCount} total, ${report.approvedCount} approved`);
  for (const item of errors) console.log(`- ${item.exemplarId}: [error] ${item.code}: ${item.message}`);
  for (const item of advisories) console.log(`- ${item.exemplarId}: [advisory] ${item.code}: ${item.message}`);
}
if (strict && errors.length) process.exit(1);
