import assert from "node:assert/strict";
import test from "node:test";

import { normalizeWorldMemoryBriefRows } from "../server/worldMemoryApi.mjs";


test("World Memory brief normalization bounds model-generated subject types", () => {
  const [row] = normalizeWorldMemoryBriefRows([{
    title: "FX intervention watch",
    summary: "A bounded test summary.",
    sources: [{ name: "Official source", url: "https://example.com" }],
    subjects: [
      { name: "Japanese Yen", type: "market" },
      { name: "Japan", type: "country" },
      { name: "Unexpected generated type", type: "macro_theme" },
    ],
  }]);

  assert.deepEqual(
    row.subjects.map((subject) => subject.type),
    ["market_actor", "institution", "other"],
  );
});
