import assert from "node:assert/strict";
import test from "node:test";
import {
  fetchTossInvestOrderSyncStatus,
  fetchTossInvestPublicIp,
  fetchTossInvestStatus,
  patchTossInvestOrderSyncSettings,
  requestTossInvestAuthAction,
  requestTossInvestOrderSyncBatch,
  requestTossInvestSnapshotRebuild,
} from "../src/transactions/tossInvestApi.js";

function response(payload = { ok: true }, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    async json() {
      return payload;
    },
  };
}

test("Toss Invest API client preserves endpoint and request contracts", async () => {
  const calls = [];
  const fetchImpl = async (path, options) => {
    calls.push({ path, options });
    return response({ ok: true });
  };

  await fetchTossInvestStatus(fetchImpl);
  await requestTossInvestAuthAction(
    "/api/tossinvest/auth/credentials",
    { method: "PUT", body: { appKey: "redacted" } },
    fetchImpl
  );
  await requestTossInvestAuthAction(
    "/api/tossinvest/auth/credentials",
    { method: "DELETE" },
    fetchImpl
  );
  await fetchTossInvestPublicIp(fetchImpl);
  await fetchTossInvestOrderSyncStatus(fetchImpl);
  await requestTossInvestOrderSyncBatch(fetchImpl);
  await requestTossInvestSnapshotRebuild({ forceFull: true }, fetchImpl);
  await patchTossInvestOrderSyncSettings({ enabled: false }, fetchImpl);

  assert.deepEqual(calls.map((item) => item.path), [
    "/api/tossinvest/auth/status",
    "/api/tossinvest/auth/credentials",
    "/api/tossinvest/auth/credentials",
    "/api/tossinvest/network/public-ip",
    "/api/tossinvest/order-sync/status",
    "/api/tossinvest/order-sync/run",
    "/api/tossinvest/order-sync/rebuild",
    "/api/tossinvest/order-sync/settings",
  ]);
  assert.equal(calls[1].options.method, "PUT");
  assert.deepEqual(JSON.parse(calls[1].options.body), { appKey: "redacted" });
  assert.equal(calls[2].options.method, "DELETE");
  assert.equal(calls[5].options.method, "POST");
  assert.deepEqual(JSON.parse(calls[6].options.body), { forceFull: true });
  assert.equal(calls[7].options.method, "PATCH");
});

test("Toss Invest API client preserves structured error codes", async () => {
  const fetchImpl = async () => response(
    { ok: false, error: "vault locked", errorCode: "TOSS_VAULT_LOCKED" },
    { ok: false, status: 423 }
  );
  await assert.rejects(
    () => fetchTossInvestStatus(fetchImpl),
    (error) => error.message === "vault locked" && error.errorCode === "TOSS_VAULT_LOCKED"
  );
});
