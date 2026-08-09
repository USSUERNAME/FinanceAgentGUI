import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { __pbRemoteRunnerTestHooks } from "../../scripts/pb-remote-runner.mjs";

const tempRoot = join(process.cwd(), "data", ".test-pb-remote-runner");

test.afterEach(async () => {
  await rm(tempRoot, { recursive: true, force: true });
});

test("remote runner validates the allowlisted dispatch contract", () => {
  const options = __pbRemoteRunnerTestHooks.validateOptions({
    repo: "USSUERNAME/pb-daily-market-brief",
    workflow: "daily-brief.yml",
    ref: "main",
    "run-mode": "dry_run",
    "request-id": "finance-agent-12345678",
    workspace: tempRoot,
    gh: "gh-test",
  });
  assert.equal(options.runMode, "dry_run");
  assert.throws(() => __pbRemoteRunnerTestHooks.validateOptions({
    ...options,
    repo: "bad repository",
  }), /owner\/name/);
  assert.throws(() => __pbRemoteRunnerTestHooks.validateOptions({
    repo: "USSUERNAME/pb-daily-market-brief",
    workflow: "daily-brief.yml",
    ref: "main",
    "run-mode": "arbitrary",
    "request-id": "finance-agent-12345678",
    workspace: tempRoot,
    gh: "gh-test",
  }), /Unsupported remote run mode/);
});

test("remote runner correlates the exact workflow request", () => {
  const startedAt = Date.parse("2026-08-07T00:00:00Z");
  const found = __pbRemoteRunnerTestHooks.findRun([
    {
      databaseId: 1,
      displayTitle: "Daily market brief · dry_run · other-request",
      createdAt: "2026-08-07T00:00:05Z",
    },
    {
      databaseId: 2,
      displayTitle: "Daily market brief · dry_run · finance-agent-12345678",
      createdAt: "2026-08-07T00:00:10Z",
    },
  ], "finance-agent-12345678", startedAt);
  assert.equal(found.databaseId, 2);
});

test("remote runner prepares an enriched Telegram approval secret", async () => {
  const workspace = join(tempRoot, "workspace");
  const approvals = join(workspace, "telegram_research_approvals", "attachments.json");
  const refresh = join(workspace, "telegram_refresh", "2026-08-10", "telegram_intelligence.json");
  await mkdir(join(workspace, "telegram_research_approvals"), { recursive: true });
  await mkdir(join(workspace, "telegram_refresh", "2026-08-10"), { recursive: true });
  await writeFile(approvals, JSON.stringify({
    schema_version: "telegram_research_attachment_approvals.v1",
    decisions: [{ attachment_key: "a".repeat(64), decision: "approved" }],
  }), "utf8");
  await writeFile(refresh, JSON.stringify({
    pdf_attachments: [{
      attachment_key: "a".repeat(64),
      message_id: 123,
      channel_username: "OfficialBroker",
      published_at: "2026-08-10T00:00:00Z",
    }],
  }), "utf8");

  const prepared = __pbRemoteRunnerTestHooks.prepareTelegramApprovalSecret(
    approvals,
    workspace,
  );
  assert.equal(prepared.approvedCount, 1);
  assert.equal(prepared.enrichedCount, 1);
  assert.ok(prepared.encoded.length > 20);
});

test("remote runner copies only allowlisted report artifact directories", async () => {
  const staging = join(tempRoot, "staging");
  const workspace = join(tempRoot, "workspace");
  await mkdir(join(staging, "v2_reader_reports", "2026-08-07"), { recursive: true });
  await mkdir(join(staging, "source_status", "2026-08-07"), { recursive: true });
  await mkdir(join(staging, "not-allowlisted"), { recursive: true });
  await writeFile(
    join(staging, "v2_reader_reports", "2026-08-07", "reader_report.json"),
    "{}",
    "utf8"
  );
  await writeFile(join(staging, "not-allowlisted", "secret.txt"), "no", "utf8");

  const synced = __pbRemoteRunnerTestHooks.syncArtifact(staging, workspace);
  assert.ok(synced.includes("v2_reader_reports"));
  assert.ok(synced.includes("source_status"));
  assert.equal(synced.includes("not-allowlisted"), false);
});

test("remote runner accepts evidence-only artifacts for dry runs", async () => {
  const staging = join(tempRoot, "staging");
  const workspace = join(tempRoot, "workspace");
  await mkdir(join(staging, "snapshots", "2026-08-09"), { recursive: true });
  await mkdir(join(staging, "analysis", "2026-08-09"), { recursive: true });
  await mkdir(join(staging, "source_status", "2026-08-09"), { recursive: true });
  await writeFile(join(staging, "analysis", "2026-08-09", "market_analysis.json"), "{}", "utf8");

  const synced = __pbRemoteRunnerTestHooks.syncArtifact(staging, workspace, {
    runMode: "dry_run",
  });
  assert.ok(synced.includes("snapshots"));
  assert.ok(synced.includes("analysis"));
  assert.ok(synced.includes("source_status"));
});

test("remote runner keeps final-report validation strict outside dry runs", async () => {
  const staging = join(tempRoot, "staging");
  const workspace = join(tempRoot, "workspace");
  await mkdir(join(staging, "snapshots", "2026-08-09"), { recursive: true });
  await mkdir(join(staging, "analysis", "2026-08-09"), { recursive: true });

  assert.throws(
    () => __pbRemoteRunnerTestHooks.syncArtifact(staging, workspace, {
      runMode: "verification_dry_run",
    }),
    /validated report workspace/
  );
});
