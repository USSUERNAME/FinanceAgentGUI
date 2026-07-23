import test from "node:test";
import assert from "node:assert/strict";

import {
  isAntigravityCliVersionAtLeast,
  selectAntigravityModelForReasoning,
} from "../src/agent/antigravityModelSelection.js";

const models = [
  { name: "gemini-3.6-flash-medium", selectable: true },
  { name: "gemini-3.6-flash-high", selectable: true },
  { name: "gemini-3.6-flash-low", selectable: true },
  { name: "Gemini 3.5 Flash (Medium)", selectable: true },
  { name: "Gemini 3.5 Flash (High)", selectable: true },
  { name: "Gemini 3.5 Flash (Low)", selectable: true },
  { name: "Gemini 3.1 Pro (High)", selectable: true },
  { name: "Gemini 3.1 Pro (Low)", selectable: true },
  { name: "Claude Sonnet 4.6 (Thinking)", selectable: true },
];

test("Antigravity translation uses Gemini 3.6 Flash Low at CLI 1.1.5", () => {
  assert.equal(
    selectAntigravityModelForReasoning(models, {
      cliVersion: "1.1.5",
      currentModel: "Gemini 3.5 Flash (Medium)",
    }),
    "gemini-3.6-flash-low",
  );
});

test("Antigravity translation keeps Gemini 3.5 Flash Low below CLI 1.1.5", () => {
  assert.equal(
    selectAntigravityModelForReasoning(models, {
      cliVersion: "1.1.4",
      currentModel: "gemini-3.6-flash-medium",
    }),
    "Gemini 3.5 Flash (Low)",
  );
});

test("Antigravity 3.6 translation falls back from Low to Medium then High", () => {
  assert.equal(
    selectAntigravityModelForReasoning(
      [
        { name: "gemini-3.6-flash-medium" },
        { name: "gemini-3.6-flash-high" },
      ],
      { cliVersion: "agy 1.1.5", currentModel: "Gemini 3.5 Flash (High)" },
    ),
    "gemini-3.6-flash-medium",
  );

  assert.equal(
    selectAntigravityModelForReasoning(
      [{ name: "gemini-3.6-flash-high" }],
      { cliVersion: "1.2.0", currentModel: "Gemini 3.5 Flash (Medium)" },
    ),
    "gemini-3.6-flash-high",
  );
});

test("Antigravity translation uses legacy 3.5 family when 3.6 is unavailable", () => {
  assert.equal(
    selectAntigravityModelForReasoning(models, {
      cliVersion: "1.1.5",
      currentModel: "Claude Sonnet 4.6 (Thinking)",
    }),
    "gemini-3.6-flash-low",
  );

  assert.equal(
    selectAntigravityModelForReasoning(
      models.filter((model) => !model.name.startsWith("gemini-3.6")),
      {
        cliVersion: "1.1.5",
        currentModel: "Claude Sonnet 4.6 (Thinking)",
      },
    ),
    "Gemini 3.5 Flash (Low)",
  );
});

test("Antigravity 1.1.5 prereleases stay below the stable version boundary", () => {
  assert.equal(isAntigravityCliVersionAtLeast("agy 1.1.5-alpha.2"), false);
  assert.equal(isAntigravityCliVersionAtLeast("1.1.5"), true);
});
