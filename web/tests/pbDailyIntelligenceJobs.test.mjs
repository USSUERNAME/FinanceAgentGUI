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
    "python-test run_daily_report.py --verification-dry-run"
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
