import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  llmObservationPolicy,
  recoverPendingLlmObservations,
} from "../server/llmProcessObserver.mjs";

test("installed astop always requires LLM observation even when general agent observation is disabled", () => {
  assert.deepEqual(
    llmObservationPolicy({
      supported: true,
      installed: true,
      serverHealthy: true,
      enabled: false,
      useForAgentTasks: false,
      requireForLlmProcesses: false,
    }),
    { active: true, required: true },
  );
});

test("installed astop fails closed when its server is unavailable", () => {
  assert.throws(
    () => llmObservationPolicy({
      supported: true,
      installed: true,
      serverHealthy: false,
      lastError: "agent API unavailable",
    }),
    /LLM 실행이 차단되었습니다.*agent API unavailable/,
  );
});

test("unsupported, missing, and indeterminate astop states use the direct LLM path", () => {
  for (const status of [
    { supported: false, installed: true, serverHealthy: true },
    { supported: true, installed: false, serverHealthy: null },
    { supported: true, installed: null, serverHealthy: null },
  ]) {
    assert.deepEqual(llmObservationPolicy(status), { active: false, required: false });
  }
});

test("startup recovery acknowledges only app-owned pending LLM events", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "finance-gui-llm-recovery-"));
  const auditLogPath = join(tempDir, "llm-observation.jsonl");
  const calls = [];
  const ownJob = "finance-gui-llm-magazine-agent-pass-codex-cli-abc123";
  const ownEvent = {
    event_id: "pte:owned",
    job: ownJob,
    pid: 123,
    exit_code: 0,
    terminal_state: "exited_successfully",
  };
  const unrelatedEvent = {
    event_id: "pte:unrelated",
    job: "other-project-training",
    pid: 456,
  };

  try {
    const result = recoverPendingLlmObservations({
      status: {
        supported: true,
        installed: true,
        serverHealthy: true,
        command: "/test/astop",
      },
      auditLogPath,
      runObserver: (_command, args) => {
        calls.push(args);
        if (args[0] === "notifications") {
          return { status: 0, stdout: JSON.stringify([ownEvent, unrelatedEvent]), stderr: "" };
        }
        return { status: 0, stdout: "", stderr: "" };
      },
    });

    assert.deepEqual(result, { active: true, recovered: 1, failed: 0, ignored: 1 });
    assert.deepEqual(calls.slice(1), [
      ["event", "ack", "pte:owned", "--consumer", "finance-agent-gui-recovery"],
      ["watch", "stop", ownJob],
    ]);
    const records = readFileSync(auditLogPath, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.deepEqual(records.map((record) => record.type), [
      "llm_observation_recovery_detected",
      "llm_observation_recovered",
    ]);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
