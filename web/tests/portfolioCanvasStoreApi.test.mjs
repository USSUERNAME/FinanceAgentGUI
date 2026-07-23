import assert from "node:assert/strict";
import test from "node:test";
import { loadPortfolioCanvasStoreFile, savePortfolioCanvasStoreFile } from "../src/portfolio/canvasStoreApi.js";

function response(payload = { ok: true }, { ok = true, status = 200 } = {}) {
  return { ok, status, async json() { return payload; } };
}

test("Portfolio canvas store API preserves load and save contracts", async () => {
  const calls = [];
  const fetchImpl = async (path, options) => {
    calls.push({ path, options });
    return response({ ok: true, store: { version: 1, canvases: [], activeCanvasId: "" } });
  };
  await loadPortfolioCanvasStoreFile(fetchImpl);
  await savePortfolioCanvasStoreFile({ version: 1, canvases: [], activeCanvasId: "" }, fetchImpl);
  assert.deepEqual(calls.map((item) => item.path), [
    "/api/portfolio/canvases",
    "/api/portfolio/canvases",
  ]);
  assert.equal(calls[1].options.method, "PUT");
});
