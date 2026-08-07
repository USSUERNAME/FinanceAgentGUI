#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, isAbsolute, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ALLOWED_RUN_MODES = new Set(["dry_run", "verification_dry_run", "publish"]);
const ALLOWED_WORKSPACE_DIRS = Object.freeze([
  "snapshots",
  "analysis",
  "briefs",
  "charts",
  "source_status",
  "triaged",
  "event_evidence",
  "market_calendar",
  "korea_market",
  "provider_budget",
  "us_equity_universe",
  "us_equity_market_inputs",
  "us_equity_candidate_screen",
  "us_market_internals",
  "history",
  "operations_reports",
  "operations_manifest",
  "intelligence",
  "v2_reader_reports",
  "broker_research_analysis",
  "broker_research_digest",
  "cross_source_events",
  "sector_metrics",
  "sector_fundamentals",
  "sector_drivers",
  "company_research_queue",
  "company_market_context",
  "company_peer_context",
  "company_valuation_expectations",
  "company_primary_facts",
  "company_guidance_inputs",
  "company_operating_bridge",
  "company_operating_inputs",
  "company_tearsheets",
  "company_earnings_events",
  "company_earnings_event_inputs",
  "company_earnings_reaction_context",
  "company_option_inputs",
  "company_earnings_driver_review",
  "company_earnings_scenarios",
  "company_earnings_result_inputs",
  "company_earnings_results",
  "company_earnings_deep_dive",
  "earnings_intelligence",
  "company_underwriting_inputs",
  "company_underwriting",
  "company_underwriting_drafts",
  "company_underwriting_approvals",
  "company_thesis_updates",
  "company_review_operating_inputs",
  "company_review_operating_drafts",
  "company_review_operating_review_queue",
  "company_review_operating_config",
  "company_review_operating_approvals",
  "company_thesis_review_calendar",
  "company_review_operations_monitor",
  "company_review_alert_delivery_plans",
  "company_review_alert_delivery_policy_approvals",
  "company_review_alert_acknowledgements",
  "company_review_alert_followup_assignments",
  "company_review_alert_followup_completions",
  "company_review_alert_followup_monitor",
  "company_review_alert_sla_summary",
  "company_review_alert_owner_queue",
  "company_review_alert_sla_trend",
  "company_review_alert_completion_evidence_integrity",
  "company_review_alert_completion_evidence_verifications",
  "company_review_alert_external_evidence_backlog",
  "company_review_alert_external_evidence_backlog_reviews",
  "company_review_alert_external_evidence_review_summary",
  "company_review_alert_external_evidence_operation_audit",
]);

function cleanText(value, maxLength = 4000) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  return text.length > maxLength ? `${text.slice(0, maxLength - 1).trim()}…` : text;
}

function redact(value) {
  return cleanText(value, 6000)
    .replace(/\b(sk|gho|ghp|github_pat|xox[baprs])-[-A-Za-z0-9_]{8,}\b/gi, "[REDACTED_TOKEN]")
    .replace(/\b(Bearer)\s+\S+/gi, "$1 [REDACTED]");
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag?.startsWith("--") || value === undefined) {
      throw new Error(`Invalid argument near ${flag || "end of command"}`);
    }
    result[flag.slice(2)] = value;
  }
  return result;
}

function sleep(ms) {
  const waiter = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(waiter, 0, 0, ms);
}

function runGh(ghPath, args, { json = false, allowFailure = false } = {}) {
  const result = spawnSync(ghPath, args, {
    encoding: "utf8",
    windowsHide: true,
    shell: false,
    maxBuffer: 8 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0 && !allowFailure) {
    const detail = redact([result.stdout, result.stderr].filter(Boolean).join("\n"));
    throw new Error(`GitHub CLI failed (${basename(ghPath)} ${args.slice(0, 3).join(" ")})${detail ? `: ${detail}` : ""}`);
  }
  const output = String(result.stdout || "").trim();
  if (!json) return { ...result, output };
  try {
    return { ...result, output, value: output ? JSON.parse(output) : null };
  } catch {
    throw new Error(`GitHub CLI returned invalid JSON: ${redact(output)}`);
  }
}

function validateOptions(raw) {
  const repository = cleanText(raw.repo, 200);
  const workflow = cleanText(raw.workflow || "daily-brief.yml", 160);
  const ref = cleanText(raw.ref || "main", 200);
  const runMode = cleanText(raw["run-mode"], 80);
  const requestId = cleanText(raw["request-id"], 120);
  const ghPath = cleanText(raw.gh || "gh", 4000);
  const workspace = resolve(cleanText(raw.workspace, 4000));
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
    throw new Error("Repository must use owner/name form");
  }
  if (!/^[A-Za-z0-9_.-]+\.ya?ml$/.test(workflow)) {
    throw new Error("Workflow must be a YAML filename");
  }
  if (!/^[A-Za-z0-9._/-]+$/.test(ref) || ref.includes("..")) {
    throw new Error("Invalid workflow ref");
  }
  if (!ALLOWED_RUN_MODES.has(runMode)) {
    throw new Error(`Unsupported remote run mode: ${runMode}`);
  }
  if (!/^[A-Za-z0-9_-]{8,120}$/.test(requestId)) {
    throw new Error("Invalid request ID");
  }
  if (!raw.workspace || workspace === resolve(sep)) {
    throw new Error("A narrow local workspace path is required");
  }
  if (isAbsolute(ghPath) && !existsSync(ghPath)) {
    throw new Error(`GitHub CLI not found: ${ghPath}`);
  }
  return { repository, workflow, ref, runMode, requestId, ghPath, workspace };
}

function findRun(rows, requestId, startedAtMs) {
  return (Array.isArray(rows) ? rows : [])
    .filter((item) => String(item?.displayTitle || "").includes(requestId))
    .filter((item) => {
      const createdAt = Date.parse(String(item?.createdAt || ""));
      return Number.isFinite(createdAt) && createdAt >= startedAtMs - 60_000;
    })
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))[0] || null;
}

function downloadArtifact(options, runId, stagingRoot) {
  const artifactName = `daily-market-evidence-${runId}`;
  let lastError = "";
  for (let attempt = 1; attempt <= 8; attempt += 1) {
    const result = runGh(options.ghPath, [
      "run", "download", String(runId),
      "-R", options.repository,
      "-n", artifactName,
      "-D", stagingRoot,
    ], { allowFailure: true });
    if (result.status === 0) return artifactName;
    lastError = redact([result.stdout, result.stderr].filter(Boolean).join("\n"));
    if (attempt < 8) sleep(5_000);
  }
  throw new Error(`Artifact download failed for ${artifactName}${lastError ? `: ${lastError}` : ""}`);
}

function copyDirectory(source, target) {
  mkdirSync(target, { recursive: true });
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    const sourcePath = join(source, entry.name);
    const targetPath = join(target, entry.name);
    if (entry.isSymbolicLink()) {
      throw new Error(`Artifact contains an unsupported symbolic link: ${entry.name}`);
    }
    if (entry.isDirectory()) {
      copyDirectory(sourcePath, targetPath);
    } else if (entry.isFile()) {
      copyFileSync(sourcePath, targetPath);
    }
  }
}

function syncArtifact(stagingRoot, workspace) {
  const nestedWorkspace = join(stagingRoot, "workspace");
  const artifactRoot = existsSync(nestedWorkspace) ? nestedWorkspace : stagingRoot;
  const available = new Set(readdirSync(artifactRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name));
  const selected = ALLOWED_WORKSPACE_DIRS.filter((name) => available.has(name));
  if (!selected.some((name) => ["v2_reader_reports", "intelligence", "operations_manifest"].includes(name))) {
    throw new Error("Downloaded artifact does not contain a validated report workspace");
  }
  mkdirSync(workspace, { recursive: true });
  for (const name of selected) {
    copyDirectory(join(artifactRoot, name), join(workspace, name));
  }
  return selected;
}

export function runRemoteWorkflow(rawOptions, { timeoutMs = 30 * 60 * 1000 } = {}) {
  const options = validateOptions(rawOptions);
  const startedAtMs = Date.now();
  console.log(`Dispatching ${options.repository}/${options.workflow} (${options.runMode})`);
  runGh(options.ghPath, [
    "workflow", "run", options.workflow,
    "-R", options.repository,
    "--ref", options.ref,
    "-f", `run_mode=${options.runMode}`,
    "-f", `client_request_id=${options.requestId}`,
  ]);

  let matchedRun = null;
  while (Date.now() - startedAtMs < timeoutMs) {
    const listing = runGh(options.ghPath, [
      "run", "list",
      "-R", options.repository,
      "--workflow", options.workflow,
      "--event", "workflow_dispatch",
      "--limit", "30",
      "--json", "databaseId,status,conclusion,createdAt,displayTitle,url,headBranch",
    ], { json: true });
    matchedRun = findRun(listing.value, options.requestId, startedAtMs);
    if (!matchedRun) {
      console.log("Waiting for GitHub Actions run registration…");
      sleep(3_000);
      continue;
    }
    console.log(`GitHub Actions run ${matchedRun.databaseId}: ${matchedRun.status}${matchedRun.url ? ` · ${matchedRun.url}` : ""}`);
    if (matchedRun.status === "completed") break;
    sleep(10_000);
  }

  if (!matchedRun || matchedRun.status !== "completed") {
    throw new Error("Timed out waiting for GitHub Actions completion");
  }
  if (matchedRun.conclusion !== "success") {
    throw new Error(`GitHub Actions run ${matchedRun.databaseId} finished with ${matchedRun.conclusion || "unknown conclusion"}`);
  }

  const stagingRoot = mkdtempSync(join(tmpdir(), "finance-agent-pb-artifact-"));
  try {
    const artifactName = downloadArtifact(options, matchedRun.databaseId, stagingRoot);
    const synced = syncArtifact(stagingRoot, options.workspace);
    console.log(`Downloaded ${artifactName}`);
    console.log(`Synced ${synced.length} workspace section(s) into ${options.workspace}`);
    console.log(`REMOTE_RUN_ID=${matchedRun.databaseId}`);
    return { runId: matchedRun.databaseId, artifactName, synced };
  } finally {
    const resolvedTemp = resolve(tmpdir());
    const resolvedStage = resolve(stagingRoot);
    if (resolvedStage.startsWith(`${resolvedTemp}${sep}`)) {
      rmSync(resolvedStage, { recursive: true, force: true });
    }
  }
}

export const __pbRemoteRunnerTestHooks = Object.freeze({
  findRun,
  syncArtifact,
  validateOptions,
});

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    runRemoteWorkflow(parseArgs(process.argv.slice(2)));
  } catch (error) {
    console.error(`Remote PB run failed: ${redact(error?.message || error)}`);
    process.exitCode = 1;
  }
}
