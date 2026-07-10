import assert from "node:assert/strict";
import test from "node:test";

import { chatTimeoutMsForPayload } from "../server/codexProbe.mjs";

test("codex chat honors explicit timeoutMs for long-running automation tasks", () => {
  assert.equal(chatTimeoutMsForPayload({ taskType: "world-memory-collection", timeoutMs: 240000 }), 240000);
});

test("codex chat keeps the earning calendar timeout fallback", () => {
  assert.equal(chatTimeoutMsForPayload({ screen: "earning-calendar" }), 15 * 60 * 1000);
});
