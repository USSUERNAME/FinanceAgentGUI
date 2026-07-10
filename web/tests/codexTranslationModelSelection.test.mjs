import test from "node:test";
import assert from "node:assert/strict";

import {
  isCodexCliVersionAtLeast,
  selectCodexTranslationModel,
} from "../src/agent/codexTranslationModelSelection.js";

const models = [
  {
    slug: "gpt-5.5",
    reasoningLevels: [{ id: "low" }, { id: "medium" }, { id: "high" }],
  },
  {
    slug: "gpt-5.6-luna",
    reasoningLevels: [{ id: "low" }, { id: "medium" }, { id: "high" }, { id: "max" }],
  },
];

test("Codex translation keeps GPT-5.5 low below CLI 0.144.0", () => {
  assert.deepEqual(
    selectCodexTranslationModel({ cliVersion: "codex-cli 0.143.9", models }),
    {
      model: "gpt-5.5",
      modelLabel: "gpt-5.5",
      reasoning: "low",
      minimumVersion: "0.144.0",
    },
  );
});

test("Codex translation uses GPT-5.6 Luna minimum reasoning at CLI 0.144.0", () => {
  assert.deepEqual(
    selectCodexTranslationModel({ cliVersion: "codex-cli 0.144.0", models }),
    {
      model: "gpt-5.6-luna",
      modelLabel: "gpt-5.6-luna",
      reasoning: "low",
      minimumVersion: "0.144.0",
    },
  );
});

test("Codex translation selects a newly available lower Luna reasoning tier", () => {
  const selection = selectCodexTranslationModel({
    cliVersion: "codex-cli 0.145.0",
    models: [
      {
        slug: "gpt-5.6-luna",
        supported_reasoning_levels: [{ effort: "medium" }, { effort: "minimal" }, { effort: "low" }],
      },
    ],
  });
  assert.equal(selection.reasoning, "minimal");
});

test("0.144.0 prereleases stay below the stable version boundary", () => {
  assert.equal(isCodexCliVersionAtLeast("codex-cli 0.144.0-alpha.4"), false);
  assert.equal(isCodexCliVersionAtLeast("codex-cli 0.144.0"), true);
});
