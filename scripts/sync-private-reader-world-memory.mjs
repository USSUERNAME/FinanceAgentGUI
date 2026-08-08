#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { buildWorldMemorySnapshot } from "./build-public-report-reader.mjs";

const SCRIPT_DIR = resolve(fileURLToPath(new URL(".", import.meta.url)));
const APP_ROOT = resolve(SCRIPT_DIR, "..");
const DEFAULT_STATE = joinRoot("data", "world-memory", "collector-state.json");
const DEFAULT_THESES = joinRoot("data", "world-memory", "pb-investment-theses.json");
const DEFAULT_OUTPUT = joinRoot(".generated", "private-reader-world-memory.json");
const SECRET_NAME = "PRIVATE_READER_WORLD_MEMORY_JSON";

function joinRoot(...parts) {
  return resolve(APP_ROOT, ...parts);
}

function argument(name, fallback = "") {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] || fallback : fallback;
}

async function readJson(path, fallback = {}) {
  try {
    return JSON.parse(await readFile(resolve(path), "utf8"));
  } catch {
    return fallback;
  }
}

function validateRepository(value) {
  const repository = String(value || "").trim();
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
    throw new Error("--repo must use owner/name form when --push is enabled");
  }
  return repository;
}

function pushSecret({ repository, ghPath, body }) {
  const result = spawnSync(ghPath, ["secret", "set", SECRET_NAME, "--repo", repository], {
    input: body,
    encoding: "utf8",
    windowsHide: true,
    shell: false,
    maxBuffer: 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = String(result.stderr || result.stdout || "").trim().slice(0, 1200);
    throw new Error(`GitHub secret update failed${detail ? `: ${detail}` : ""}`);
  }
}

const collectorStatePath = argument("state", DEFAULT_STATE);
const thesesPath = argument("theses", DEFAULT_THESES);
const outputPath = resolve(argument("output", DEFAULT_OUTPUT));
const push = process.argv.includes("--push");
const repository = push ? validateRepository(argument("repo")) : "";
const ghPath = argument("gh", "gh");

const collectorState = await readJson(collectorStatePath);
const investmentTheses = await readJson(thesesPath);
const snapshot = buildWorldMemorySnapshot(collectorState, investmentTheses);
if (!snapshot.report.title && !snapshot.report.summary && !snapshot.theses.length) {
  throw new Error("World Memory report or investment theses are not ready");
}

const serialized = `${JSON.stringify(snapshot)}\n`;
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, serialized, "utf8");
if (push) pushSecret({ repository, ghPath, body: serialized });

console.log(JSON.stringify({
  output: outputPath,
  generatedAt: snapshot.generatedAt,
  signalCount: snapshot.report.signalRadar.length,
  highlightCount: snapshot.report.highlights.length,
  thesisCount: snapshot.theses.length,
  pushed: push,
  secretName: push ? SECRET_NAME : "",
}));
