#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = resolve(fileURLToPath(new URL(".", import.meta.url)));
const GUIBUILD_ROOT = resolve(SCRIPT_DIR, "..");
const MANIFEST_PATH = join(GUIBUILD_ROOT, "config", "llm-processes.json");
const OBSERVER_PATH = join(GUIBUILD_ROOT, "web", "server", "llmProcessObserver.mjs");
const AUDIT_PATH = join(GUIBUILD_ROOT, "scripts", "llm_observation_audit.mjs");
const DEFAULTS_PATH = join(GUIBUILD_ROOT, "config", "astop-observer.defaults.json");
const SERVER_ENTRY_PATHS = [
  join(GUIBUILD_ROOT, "web", "server", "server.mjs"),
  join(GUIBUILD_ROOT, "web", "server", "viteCodexApi.mjs"),
];
const SOURCE_ROOTS = [join(GUIBUILD_ROOT, "web", "server"), join(GUIBUILD_ROOT, "scripts")];
const SOURCE_EXTENSIONS = new Set([".js", ".mjs", ".cjs"]);

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function sourceFiles(root) {
  const files = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (["node_modules", "dist", "data", "logs"].includes(entry.name)) continue;
    const path = join(root, entry.name);
    if (entry.isDirectory()) files.push(...sourceFiles(path));
    else if (SOURCE_EXTENSIONS.has(extname(entry.name))) files.push(path);
  }
  return files;
}

function fail(errors, message) {
  errors.push(message);
}

const errors = [];
const manifest = readJson(MANIFEST_PATH);
const defaults = readJson(DEFAULTS_PATH);
const files = SOURCE_ROOTS.flatMap(sourceFiles);
const observerText = readFileSync(OBSERVER_PATH, "utf8");

if (defaults.requireForLlmProcesses !== true) {
  fail(errors, "config/astop-observer.defaults.json must require astop for LLM processes");
}
if (manifest.policy !== "required-when-installed") {
  fail(errors, "config/llm-processes.json must keep policy=required-when-installed");
}
if (manifest.failClosedWhenInstalledObserverUnavailable !== true) {
  fail(errors, "config/llm-processes.json must fail closed when installed astop is unavailable");
}
if (!Array.isArray(manifest.directExecutionWhen) || !manifest.directExecutionWhen.includes("not-installed")) {
  fail(errors, "config/llm-processes.json must preserve direct execution when astop is not installed");
}
for (const token of [
  "registerPidWatch",
  "confirmPidObserved",
  "--pid",
  "WAIT_FOR_OBSERVER_GATE",
  "REGISTER_SELF_AND_EXEC",
  "recoverPendingLlmObservations",
  "notifications",
  "pending",
  "--until",
  '"start"',
  "exit",
  "event",
  "ack",
  "watch",
  "stop",
  "verifyEvent",
]) {
  if (!observerText.includes(token)) fail(errors, `llmProcessObserver.mjs is missing ${token}`);
}
if (!observerText.includes('const OWNED_JOB_PREFIX = "finance-gui-llm-"')) {
  fail(errors, "llmProcessObserver.mjs must use an app-owned astop job prefix");
}
for (const path of SERVER_ENTRY_PATHS) {
  if (!readFileSync(path, "utf8").includes("recoverPendingLlmObservations")) {
    fail(errors, `${relative(GUIBUILD_ROOT, path)} must recover pending LLM observations at startup`);
  }
}

for (const entry of manifest.processes || []) {
  const path = join(GUIBUILD_ROOT, entry.entrypoint || "");
  if (!existsSync(path)) {
    fail(errors, `${entry.id}: missing entrypoint ${entry.entrypoint}`);
    continue;
  }
  const text = readFileSync(path, "utf8");
  for (const launcher of String(entry.launcher || "").split("/")) {
    if (!launcher || !text.includes(launcher)) {
      fail(errors, `${entry.id}: ${entry.entrypoint} does not use ${launcher}`);
    }
  }
}

const directLaunchPatterns = [
  { pattern: /\bspawn\s*\(\s*["']codex["']/g, label: "spawn(codex)" },
  { pattern: /\bspawnSync\s*\(\s*["']codex["']/g, label: "spawnSync(codex)" },
  { pattern: /\bspawn\s*\(\s*agy\b/g, label: "spawn(agy)" },
  { pattern: /\bspawnSync\s*\(\s*agy\b/g, label: "spawnSync(agy)" },
  { pattern: /\bspawn\s*\(\s*process\.execPath\s*,\s*args/g, label: "raw Magazine orchestrator spawn" },
];

for (const path of files) {
  if (path === OBSERVER_PATH || path === AUDIT_PATH) continue;
  const text = readFileSync(path, "utf8");
  for (const { pattern, label } of directLaunchPatterns) {
    pattern.lastIndex = 0;
    if (pattern.test(text)) {
      fail(errors, `${relative(GUIBUILD_ROOT, path)} contains unobserved ${label}`);
    }
  }
}

if (errors.length) {
  console.error(`LLM observation audit failed with ${errors.length} error(s):`);
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(
  `LLM observation audit passed: ${manifest.processes.length} process families, astop required when installed, direct fallback when unavailable, no token-consuming spawn bypasses.`,
);
