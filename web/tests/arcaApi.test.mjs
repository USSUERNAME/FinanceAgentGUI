import assert from "node:assert/strict";
import test from "node:test";
import {
  fetchArcaArticle,
  fetchArcaAuthStatus,
  fetchArcaBoard,
  fetchArcaNotifications,
  markArcaNotificationsRead,
  requestArcaAuthAction,
} from "../src/arca/arcaApi.js";

function response(payload = { ok: true }, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    async json() {
      return payload;
    },
  };
}

test("Arca API client preserves endpoint and request contracts", async () => {
  const calls = [];
  const fetchImpl = async (path, options) => {
    calls.push({ path, options });
    if (path === "/api/arca/notifications" && options.method === "DELETE") {
      return response({ ok: true, accepted: true });
    }
    return response({ ok: true });
  };

  await fetchArcaNotifications(fetchImpl);
  await markArcaNotificationsRead(fetchImpl);
  await fetchArcaAuthStatus(fetchImpl);
  await requestArcaAuthAction("/api/arca/auth/start", {}, fetchImpl);
  await requestArcaAuthAction("/api/arca/auth/session", { method: "DELETE" }, fetchImpl);
  await fetchArcaBoard({ category: "뉴스", page: 2 }, fetchImpl);
  await fetchArcaArticle("https://arca.live/b/stock/1?a=2", {}, fetchImpl);

  assert.deepEqual(calls.map((item) => item.path), [
    "/api/arca/notifications",
    "/api/arca/notifications",
    "/api/arca/auth/status",
    "/api/arca/auth/start",
    "/api/arca/auth/session",
    "/api/arca/articles",
    "/api/arca/article?url=https%3A%2F%2Farca.live%2Fb%2Fstock%2F1%3Fa%3D2",
  ]);
  assert.equal(calls[1].options.method, "DELETE");
  assert.equal(calls[3].options.method, "POST");
  assert.equal(calls[3].options.body, "{}");
  assert.equal(calls[4].options.method, "DELETE");
  assert.equal(calls[5].options.method, "POST");
  assert.deepEqual(JSON.parse(calls[5].options.body), { category: "뉴스", page: 2 });
});

test("Arca article errors prefer structured issue messages", async () => {
  const fetchImpl = async () => response(
    { ok: false, issues: [{ message: "login required" }] },
    { ok: false, status: 401 }
  );
  await assert.rejects(() => fetchArcaArticle("https://arca.live/item", {}, fetchImpl), /login required/);
});

test("Arca board preserves diagnostic issue payloads", async () => {
  const fetchImpl = async () => response(
    { ok: false, issues: [{ message: "partial board" }] },
    { ok: false, status: 503 }
  );
  const payload = await fetchArcaBoard({}, fetchImpl);
  assert.equal(payload.ok, false);
  assert.equal(payload.issues[0].message, "partial board");
});
