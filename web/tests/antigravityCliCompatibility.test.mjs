import test from "node:test";
import assert from "node:assert/strict";

import {
  antigravityPrintInvocation,
  antigravityPromptTransport,
  parseAntigravityCliVersion,
} from "../server/antigravityCliCompatibility.mjs";

test("Antigravity CLI version parsing and prompt transport cover legacy and current releases", () => {
  assert.deepEqual(parseAntigravityCliVersion("agy 1.1.1"), [1, 1, 1]);
  assert.equal(antigravityPromptTransport("1.0.9"), "legacy-stdin");
  assert.equal(antigravityPromptTransport("1.1.1"), "argument");
  assert.equal(antigravityPromptTransport("2.0.0"), "argument");
});

test("Antigravity invocation preserves both CLI contracts", () => {
  const legacy = antigravityPrintInvocation({
    cliVersion: "1.0.9",
    model: "Legacy Model",
    prompt: "legacy prompt",
  });
  const current = antigravityPrintInvocation({
    cliVersion: "1.1.1",
    model: "Current Model",
    prompt: "current prompt",
  });

  assert.deepEqual(legacy.args.slice(-2), ["-p", "-"]);
  assert.equal(legacy.stdin, "legacy prompt");
  assert.deepEqual(current.args.slice(-2), ["-p", "current prompt"]);
  assert.equal(current.stdin, null);
});
