import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { createPbDailyIntelligenceJobService } from "../server/pbDailyIntelligenceJobs.mjs";

const tempRoot = join(process.cwd(), "data", ".test-pb-daily-intelligence-jobs");

async function createEngine() {
  await mkdir(tempRoot, { recursive: true });
  await writeFile(join(tempRoot, "collect_all.py"), "print('collect')\n", "utf8");
  await writeFile(
    join(tempRoot, "refresh_telegram_intelligence.py"),
    "print('telegram refresh')\n",
    "utf8"
  );
  await writeFile(join(tempRoot, "run_daily_report.py"), "print('report')\n", "utf8");
  await writeFile(
    join(tempRoot, "run_research_inbox_analysis.py"),
    "print('research inbox analysis')\n",
    "utf8"
  );
}

function fakeChild({ code = 0, output = "" } = {}) {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  queueMicrotask(() => {
    if (output) child.stdout.emit("data", Buffer.from(output));
    child.emit("close", code);
  });
  return child;
}

test.afterEach(async () => {
  await rm(tempRoot, { recursive: true, force: true });
});

test("PB job service fails closed when the engine is not configured", () => {
  const service = createPbDailyIntelligenceJobService({ env: {} });
  const status = service.status();
  assert.equal(status.connection.configured, false);
  assert.equal(status.connection.available, false);
  assert.throws(() => service.plan("dry_run"), /설정되지 않았습니다/);
});

test("PB job service creates an allowlisted confirmation plan without executing", async () => {
  await createEngine();
  let spawnCount = 0;
  const service = createPbDailyIntelligenceJobService({
    env: {
      PB_DAILY_INTELLIGENCE_ENGINE_DIR: tempRoot,
      PB_DAILY_INTELLIGENCE_PYTHON: "python-test",
    },
    uuid: () => "plan-token",
    spawnImpl() {
      spawnCount += 1;
      return fakeChild();
    },
  });

  const plan = service.plan("dry_run");
  assert.equal(plan.token, "plan-token");
  assert.equal(plan.job.id, "dry_run");
  assert.equal(plan.commandPreview, "python-test run_daily_report.py --dry-run");
  assert.equal(spawnCount, 0);
  assert.throws(() => service.plan("arbitrary-command"), /허용되지 않은/);
});

test("PB job service exposes an unpublished official-evidence verification run", async () => {
  await createEngine();
  const service = createPbDailyIntelligenceJobService({
    env: {
      PB_DAILY_INTELLIGENCE_ENGINE_DIR: tempRoot,
      PB_DAILY_INTELLIGENCE_PYTHON: "python-test",
    },
    uuid: () => "verification-plan",
    spawnImpl() {
      return fakeChild();
    },
  });

  const plan = service.plan("verification_dry_run");
  assert.equal(plan.token, "verification-plan");
  assert.equal(plan.job.id, "verification_dry_run");
  assert.equal(plan.job.publish, false);
  assert.equal(
    plan.commandPreview,
    "python-test run_daily_report.py --verification-dry-run"
  );
});

test("PB job service exposes an allowlisted Telegram-only refresh", async () => {
  await createEngine();
  const service = createPbDailyIntelligenceJobService({
    env: {
      PB_DAILY_INTELLIGENCE_ENGINE_DIR: tempRoot,
      PB_DAILY_INTELLIGENCE_PYTHON: "python-test",
    },
    uuid: () => "telegram-plan",
    spawnImpl() {
      return fakeChild();
    },
  });

  const plan = service.plan("telegram_refresh");
  assert.equal(plan.token, "telegram-plan");
  assert.equal(plan.job.id, "telegram_refresh");
  assert.equal(plan.job.publish, false);
  assert.equal(
    plan.commandPreview,
    "python-test refresh_telegram_intelligence.py"
  );
});

test("PB job service exposes a confirmed Telegram PDF analysis run", async () => {
  await createEngine();
  const service = createPbDailyIntelligenceJobService({
    env: {
      PB_DAILY_INTELLIGENCE_ENGINE_DIR: tempRoot,
      PB_DAILY_INTELLIGENCE_PYTHON: "python-test",
    },
    uuid: () => "telegram-analysis-plan",
    spawnImpl() {
      return fakeChild();
    },
  });

  const plan = service.plan("telegram_analyze");
  assert.equal(plan.token, "telegram-analysis-plan");
  assert.equal(plan.job.id, "telegram_analyze");
  assert.equal(plan.job.label, "Telegram 승인 PDF 수집·분석");
  assert.equal(plan.job.publish, false);
  assert.equal(
    plan.commandPreview,
    "python-test run_daily_report.py --verification-dry-run"
  );
});

test("PB job service exposes an allowlisted Gmail-only refresh", async () => {
  await createEngine();
  const service = createPbDailyIntelligenceJobService({
    env: {
      PB_DAILY_INTELLIGENCE_ENGINE_DIR: tempRoot,
      PB_DAILY_INTELLIGENCE_PYTHON: "python-test",
    },
    uuid: () => "gmail-plan",
    spawnImpl() {
      return fakeChild();
    },
  });

  const plan = service.plan("gmail_refresh");
  assert.equal(plan.token, "gmail-plan");
  assert.equal(plan.job.id, "gmail_refresh");
  assert.equal(plan.job.publish, false);
  assert.equal(
    plan.commandPreview,
    "python-test collect_all.py --sources gmail_research --source-timeout-seconds 90"
  );
});

test("PB job service exposes an unpublished Gmail-inclusive analysis run", async () => {
  await createEngine();
  const service = createPbDailyIntelligenceJobService({
    env: {
      PB_DAILY_INTELLIGENCE_ENGINE_DIR: tempRoot,
      PB_DAILY_INTELLIGENCE_PYTHON: "python-test",
    },
    uuid: () => "gmail-analysis-plan",
    spawnImpl() {
      return fakeChild();
    },
  });

  const plan = service.plan("gmail_analyze");
  assert.equal(plan.token, "gmail-analysis-plan");
  assert.equal(plan.job.id, "gmail_analyze");
  assert.equal(plan.job.label, "Gmail 수집·분석");
  assert.equal(plan.job.publish, false);
  assert.equal(
    plan.commandPreview,
    "python-test run_research_inbox_analysis.py"
  );
});

test("PB job service executes only a confirmed plan and redacts log secrets", async () => {
  await createEngine();
  const calls = [];
  let sequence = 0;
  const service = createPbDailyIntelligenceJobService({
    env: {
      PB_DAILY_INTELLIGENCE_ENGINE_DIR: tempRoot,
      PB_DAILY_INTELLIGENCE_PYTHON: "python-test",
    },
    uuid: () => `id-${++sequence}`,
    spawnImpl(command, args, options) {
      calls.push({ command, args, options });
      return fakeChild({
        output: "OPENAI_API_KEY=do-not-show\nDry run complete\n",
      });
    },
  });

  const plan = service.plan("dry_run");
  const run = service.execute(plan.token);
  assert.equal(run.status, "running");
  assert.equal(calls[0].command, "python-test");
  assert.match(calls[0].args[0], /run_daily_report\.py$/);
  assert.deepEqual(calls[0].args.slice(1), ["--dry-run"]);
  assert.equal(calls[0].options.shell, false);
  assert.equal(
    calls[0].options.env.COLLECTOR_TIMEOUT_GOOGLE_DRIVE_RESEARCH_INBOX_SECONDS,
    "300"
  );
  assert.equal(calls[0].options.env.OPENAI_BROKER_RESEARCH_MAX_REPORTS, "25");

  await new Promise((resolve) => setImmediate(resolve));
  const status = service.status();
  assert.equal(status.run.status, "succeeded");
  assert.equal(status.run.logTail.some((line) => line.includes("do-not-show")), false);
  assert.equal(status.run.logTail.some((line) => line.includes("[REDACTED]")), true);
  assert.throws(() => service.execute(plan.token), /만료됐거나 유효하지/);
});

test("PB job service preserves the concrete failure cause after process close", async () => {
  await createEngine();
  const service = createPbDailyIntelligenceJobService({
    env: {
      PB_DAILY_INTELLIGENCE_ENGINE_DIR: tempRoot,
      PB_DAILY_INTELLIGENCE_PYTHON: "python-test",
    },
    uuid: () => "failure-id",
    spawnImpl() {
      return fakeChild({
        code: 1,
        output: "OpenAI returned HTTP 520: temporary upstream error\n",
      });
    },
  });

  const plan = service.plan("dry_run");
  service.execute(plan.token);
  await new Promise((resolve) => setImmediate(resolve));

  const status = service.status();
  assert.equal(status.run.status, "failed");
  assert.equal(status.run.exitCode, 1);
  assert.equal(
    status.run.errorSummary,
    "OpenAI returned HTTP 520: temporary upstream error",
  );
  assert.match(status.run.message, /종료 코드 1/);
  assert.match(status.run.message, /OpenAI returned HTTP 520/);
});

test("PB job service syncs investment theses only after a successful report job", async () => {
  await createEngine();
  const syncCalls = [];
  const service = createPbDailyIntelligenceJobService({
    env: {
      PB_DAILY_INTELLIGENCE_ENGINE_DIR: tempRoot,
      PB_DAILY_INTELLIGENCE_DIR: join(tempRoot, "workspace"),
      PB_DAILY_INTELLIGENCE_PYTHON: "python-test",
    },
    uuid: () => "auto-sync-id",
    spawnImpl() {
      return fakeChild({ code: 0, output: "Dry run complete\n" });
    },
    async syncThesesImpl(context) {
      syncCalls.push(context);
      return {
        status: "succeeded",
        reportDate: "2026-07-29",
        candidateCount: 7,
        createdCount: 2,
        transitionCount: 1,
        message: "가설 7개를 World Memory에 반영했습니다.",
      };
    },
  });

  const plan = service.plan("dry_run");
  service.execute(plan.token);
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));

  const status = service.status();
  assert.equal(syncCalls.length, 1);
  assert.equal(syncCalls[0].jobId, "dry_run");
  assert.equal(status.run.status, "succeeded");
  assert.equal(status.run.thesisSync.status, "succeeded");
  assert.equal(status.run.thesisSync.candidateCount, 7);
  assert.equal(status.run.thesisSync.transitionCount, 1);
  assert.match(status.run.message, /World Memory에 반영/);
});

test("PB job service never syncs investment theses after a failed report job", async () => {
  await createEngine();
  let syncCount = 0;
  const service = createPbDailyIntelligenceJobService({
    env: {
      PB_DAILY_INTELLIGENCE_ENGINE_DIR: tempRoot,
      PB_DAILY_INTELLIGENCE_DIR: join(tempRoot, "workspace"),
      PB_DAILY_INTELLIGENCE_PYTHON: "python-test",
    },
    uuid: () => "failed-auto-sync-id",
    spawnImpl() {
      return fakeChild({ code: 1, output: "report failed\n" });
    },
    async syncThesesImpl() {
      syncCount += 1;
      return { status: "succeeded" };
    },
  });

  const plan = service.plan("publish");
  service.execute(plan.token);
  await new Promise((resolve) => setImmediate(resolve));

  const status = service.status();
  assert.equal(syncCount, 0);
  assert.equal(status.run.status, "failed");
  assert.equal(status.run.thesisSync.status, "idle");
});

test("PB job service dispatches configured report jobs through GitHub Actions", async () => {
  await createEngine();
  const remoteRunnerPath = join(tempRoot, "pb-remote-runner.mjs");
  const workspace = join(tempRoot, "workspace");
  await writeFile(remoteRunnerPath, "console.log('remote runner')\n", "utf8");
  const calls = [];
  let sequence = 0;
  const service = createPbDailyIntelligenceJobService({
    env: {
      PB_DAILY_INTELLIGENCE_DIR: workspace,
    },
    remoteUserConfig: {
      enabled: true,
      repository: "USSUERNAME/pb-daily-market-brief",
      workflow: "daily-brief.yml",
      ref: "codex/remote-artifact-sync",
      workspace,
      ghPath: "gh-test",
    },
    remoteRunnerPath,
    uuid: () => `remote-request-${++sequence}-12345678`,
    spawnImpl(command, args, options) {
      calls.push({ command, args, options });
      return fakeChild({ output: "GitHub Actions run 123: completed\nSynced report artifact\n" });
    },
    async syncThesesImpl() {
      return { status: "skipped", message: "test sync skipped" };
    },
  });

  const status = service.status();
  assert.equal(status.connection.available, true);
  assert.equal(status.connection.executionMode, "github_actions");
  const plan = service.plan("dry_run");
  assert.equal(plan.job.executionMode, "github_actions");
  assert.equal(
    plan.commandPreview,
    "gh workflow run daily-brief.yml -R USSUERNAME/pb-daily-market-brief -f run_mode=dry_run"
  );
  service.execute(plan.token);
  assert.equal(calls[0].command, process.execPath);
  assert.equal(calls[0].args[0], remoteRunnerPath);
  assert.deepEqual(calls[0].args.slice(1, 5), [
    "--repo",
    "USSUERNAME/pb-daily-market-brief",
    "--workflow",
    "daily-brief.yml",
  ]);
  assert.ok(calls[0].args.includes("client_request_id") === false);
  assert.ok(calls[0].args.some((item) => String(item).startsWith("finance-agent-remote-request-")));
  assert.equal(calls[0].options.shell, false);
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(service.status().run.status, "succeeded");
});

test("PB job service keeps collection-only jobs local when remote reports are enabled", async () => {
  await createEngine();
  const remoteRunnerPath = join(tempRoot, "pb-remote-runner.mjs");
  const workspace = join(tempRoot, "workspace");
  await writeFile(remoteRunnerPath, "console.log('remote runner')\n", "utf8");
  const service = createPbDailyIntelligenceJobService({
    env: {
      PB_DAILY_INTELLIGENCE_ENGINE_DIR: tempRoot,
      PB_DAILY_INTELLIGENCE_DIR: workspace,
      PB_DAILY_INTELLIGENCE_PYTHON: "python-test",
    },
    remoteUserConfig: {
      enabled: true,
      repository: "USSUERNAME/pb-daily-market-brief",
      workspace,
      ghPath: "gh-test",
    },
    remoteRunnerPath,
  });

  const plan = service.plan("collect");
  assert.equal(plan.job.executionMode, "local");
  assert.equal(plan.commandPreview, "python-test collect_all.py");
});
