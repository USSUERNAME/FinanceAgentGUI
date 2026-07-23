import assert from "node:assert/strict";
import test from "node:test";
import {
  deleteSharedMemory,
  fetchSharedMemory,
  saveSharedMemory,
} from "../src/memory/sharedMemoryApi.js";

function response(payload = { ok: true }, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    async json() {
      return payload;
    },
  };
}

test("Shared Memory API client preserves endpoint and request contracts", async () => {
  const calls = [];
  const fetchImpl = async (path, options) => {
    calls.push({ path, options });
    return response({ ok: true });
  };
  await fetchSharedMemory({ limit: 20, offset: 40 }, fetchImpl);
  await saveSharedMemory({ title: "record" }, fetchImpl);
  await deleteSharedMemory({ id: "record / 1", limit: 5, offset: 0 }, fetchImpl);

  assert.deepEqual(calls.map((item) => item.path), [
    "/api/memory?limit=20&offset=40",
    "/api/memory",
    "/api/memory?id=record%20%2F%201&limit=5&offset=0",
  ]);
  assert.equal(calls[1].options.method, "POST");
  assert.deepEqual(JSON.parse(calls[1].options.body), { title: "record" });
  assert.equal(calls[2].options.method, "DELETE");
});

test("Shared Memory API client surfaces structured failures", async () => {
  const fetchImpl = async () => response(
    { ok: false, error: "memory unavailable" },
    { ok: false, status: 503 }
  );
  await assert.rejects(() => fetchSharedMemory({ limit: 5 }, fetchImpl), /memory unavailable/);
});
