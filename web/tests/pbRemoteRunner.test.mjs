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
