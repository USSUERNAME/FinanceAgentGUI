import assert from "node:assert/strict";
import test from "node:test";

import { worldMemoryHealthState } from "../src/worldMemory/statusHelpers.js";

test("summary status reports healthy collection without pretending diagnostics ran", () => {
  const health = worldMemoryHealthState({
    ok: true,
    diagnosticsDeferred: true,
    db: { exists: true },
    collector: { status: "ok", running: false, inFlight: false, lastError: "" },
    report: { status: "ready" },
  });

  assert.equal(health.level, "online");
  assert.equal(health.statusLabel, "수집 정상");
  assert.match(health.title, /정밀 점검은 화면 진입 시 실행/);
});

test("summary status still surfaces collector failures", () => {
  const health = worldMemoryHealthState({
    ok: true,
    diagnosticsDeferred: true,
    db: { exists: true },
    collector: { status: "failed", lastError: "collector failed" },
    report: { status: "ready" },
  });

  assert.equal(health.level, "error");
  assert.equal(health.statusLabel, "관리 필요");
});
