import assert from "node:assert/strict";
import test from "node:test";
import {
  fetchWorldMemorySettings,
  fetchWorldMemoryStatus,
  patchWorldMemorySettings,
  requestWorldMemoryAction,
} from "../src/worldMemory/worldMemoryApi.js";

function response(payload = { ok: true }, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    async json() {
      return payload;
    },
  };
}

test("World Memory API client preserves endpoint and request contracts", async () => {
  const calls = [];
  const fetchImpl = async (path, options) => {
    calls.push({ path, options });
    return response({ ok: true });
  };

  await fetchWorldMemorySettings(fetchImpl);
  await fetchWorldMemoryStatus({}, fetchImpl);
  await fetchWorldMemoryStatus({ summary: true }, fetchImpl);
  await patchWorldMemorySettings({ enabled: true }, fetchImpl);
  const actionResult = await requestWorldMemoryAction(
    "refreshReport",
    { reason: "manual" },
    fetchImpl
  );

  assert.deepEqual(calls.map((item) => item.path), [
    "/api/world-memory/settings",
    "/api/world-memory/status",
    "/api/world-memory/status?mode=summary",
    "/api/world-memory/settings",
    "/api/world-memory/action",
  ]);
  assert.equal(calls[3].options.method, "PATCH");
  assert.deepEqual(JSON.parse(calls[3].options.body), { enabled: true });
  assert.equal(calls[4].options.method, "POST");
  assert.deepEqual(JSON.parse(calls[4].options.body), {
    action: "refreshReport",
    reason: "manual",
  });
  assert.deepEqual(actionResult, { payload: { ok: true }, responseOk: true });
});

test("World Memory status keeps diagnostic payloads with ok false", async () => {
  const fetchImpl = async () => response({
    ok: false,
    dependencies: { issues: [{ status: "error", message: "collector unavailable" }] },
  });
  const payload = await fetchWorldMemoryStatus({}, fetchImpl);
  assert.equal(payload.ok, false);
});

test("World Memory settings surface structured server failures", async () => {
  const fetchImpl = async () => response(
    { ok: false, error: "invalid settings" },
    { ok: false, status: 400 }
  );
  await assert.rejects(() => patchWorldMemorySettings({}, fetchImpl), /invalid settings/);
});
