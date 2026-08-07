import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const TEST_DIR = dirname(fileURLToPath(import.meta.url));

test("World Memory Python commands force UTF-8 output on Windows", () => {
  const source = readFileSync(
    resolve(TEST_DIR, "../server/worldMemoryApi.mjs"),
    "utf8",
  );

  assert.match(source, /PYTHONIOENCODING:\s*["']utf-8["']/u);
});
