import assert from "node:assert/strict";
import test from "node:test";
import {
  fetchTransactionSettings,
  patchTransactionSettings,
} from "../src/transactions/transactionSettingsApi.js";

function response(payload = { ok: true }, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    async json() {
      return payload;
    },
  };
}

test("Transaction settings API client preserves endpoint and request contracts", async () => {
  const calls = [];
  const fetchImpl = async (path, options) => {
    calls.push({ path, options });
    return response({ ok: true });
  };
  await fetchTransactionSettings(fetchImpl);
  await patchTransactionSettings({ menuHidden: true }, fetchImpl);
  assert.deepEqual(calls.map((item) => item.path), [
    "/api/transactions/settings",
    "/api/transactions/settings",
  ]);
  assert.equal(calls[1].options.method, "PATCH");
  assert.deepEqual(JSON.parse(calls[1].options.body), { menuHidden: true });
});

test("Transaction settings API client forwards abort signals", async () => {
  const controller = new AbortController();
  const calls = [];
  const fetchImpl = async (path, options) => {
    calls.push({ path, options });
    return response({ ok: true });
  };
  await fetchTransactionSettings(fetchImpl, { signal: controller.signal });
  await patchTransactionSettings({ menuHidden: false }, fetchImpl, { signal: controller.signal });
  assert.equal(calls[0].options.signal, controller.signal);
  assert.equal(calls[1].options.signal, controller.signal);
});

test("Transaction settings API client surfaces structured failures", async () => {
  const fetchImpl = async () => response(
    { ok: false, error: "invalid visibility" },
    { ok: false, status: 400 }
  );
  await assert.rejects(() => patchTransactionSettings({}, fetchImpl), /invalid visibility/);
});
