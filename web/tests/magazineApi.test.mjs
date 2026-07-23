import assert from "node:assert/strict";
import test from "node:test";
import {
  deleteMagazineArticle,
  fetchMagazineCatalog,
  fetchMagazineComments,
  fetchMagazinePreferences,
  fetchMagazineSettings,
  fetchMagazineStatus,
  markMagazineOpened,
  patchMagazineSettings,
  requestMagazineGenerateOne,
  requestMagazineRunNow,
  saveMagazinePreference,
  submitMagazineComment,
} from "../src/magazine/magazineApi.js";

function response(payload = { ok: true }, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    async json() {
      return payload;
    },
  };
}

test("Magazine API client preserves endpoint and request contracts", async () => {
  const calls = [];
  const fetchImpl = async (path, options) => {
    calls.push({ path, options });
    return response({ ok: true });
  };

  await fetchMagazineSettings(fetchImpl);
  await patchMagazineSettings({ enabled: true }, fetchImpl);
  await fetchMagazineCatalog({}, fetchImpl);
  await fetchMagazineStatus({}, fetchImpl);
  await markMagazineOpened(fetchImpl);
  await requestMagazineRunNow(fetchImpl);
  await requestMagazineGenerateOne(fetchImpl);
  await deleteMagazineArticle("article / 1", fetchImpl);
  await fetchMagazinePreferences({}, fetchImpl);
  await saveMagazinePreference({ articleId: "a1", optionId: "o1" }, fetchImpl);
  await fetchMagazineComments({ articleId: "a1" }, fetchImpl);
  await submitMagazineComment({ articleId: "a1", text: "hello" }, fetchImpl);

  assert.deepEqual(calls.map((item) => item.path), [
    "/api/magazine/settings",
    "/api/magazine/settings",
    "/api/magazine/articles",
    "/api/magazine/status",
    "/api/magazine/read-state",
    "/api/magazine/status",
    "/api/magazine/articles",
    "/api/magazine/articles?id=article%20%2F%201",
    "/api/magazine/preferences",
    "/api/magazine/preferences",
    "/api/magazine/comments?articleId=a1",
    "/api/magazine/comments",
  ]);
  assert.equal(calls[1].options.method, "PATCH");
  assert.equal(calls[4].options.method, "POST");
  assert.deepEqual(JSON.parse(calls[5].options.body), { action: "runNow" });
  assert.deepEqual(JSON.parse(calls[6].options.body), {
    action: "generateWithCodex",
    count: 1,
    replace: false,
  });
  assert.equal(calls[7].options.method, "DELETE");
  assert.deepEqual(JSON.parse(calls[9].options.body), { articleId: "a1", optionId: "o1" });
  assert.deepEqual(JSON.parse(calls[11].options.body), { articleId: "a1", text: "hello" });
});

test("Magazine API client surfaces structured failures", async () => {
  const fetchImpl = async () => response(
    { ok: false, error: "scheduler unavailable" },
    { ok: false, status: 503 }
  );
  await assert.rejects(() => fetchMagazineStatus({}, fetchImpl), /scheduler unavailable/);
});
