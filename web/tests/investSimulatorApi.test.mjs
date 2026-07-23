import assert from "node:assert/strict";
import test from "node:test";
import {
  deleteInvestSimulatorAccount,
  fetchInvestSimulatorAccounts,
  patchInvestSimulatorAccount,
  postInvestSimulatorAccount,
  postInvestSimulatorBuy,
  postInvestSimulatorExchange,
  postInvestSimulatorSell,
} from "../src/transactions/investSimulatorApi.js";

function response(payload = { ok: true }, { ok = true, status = 200 } = {}) {
  return { ok, status, async json() { return payload; } };
}

test("invest simulator API client preserves account and order contracts", async () => {
  const calls = [];
  const fetchImpl = async (path, options) => {
    calls.push({ path, options });
    return response({ ok: true });
  };
  await fetchInvestSimulatorAccounts(undefined, fetchImpl);
  await postInvestSimulatorAccount({ name: "연습" }, undefined, fetchImpl);
  await patchInvestSimulatorAccount({ simulatorId: "sim-1", name: "수정" }, undefined, fetchImpl);
  await deleteInvestSimulatorAccount("sim-1", undefined, fetchImpl);
  await postInvestSimulatorExchange({ simulatorId: "sim-1" }, undefined, fetchImpl);
  await postInvestSimulatorBuy({ simulatorId: "sim-1", side: "buy" }, undefined, fetchImpl);
  await postInvestSimulatorSell({ simulatorId: "sim-1" }, undefined, fetchImpl);

  assert.deepEqual(calls.map(({ path }) => path), [
    "/api/invest-simulator/accounts",
    "/api/invest-simulator/accounts",
    "/api/invest-simulator/accounts",
    "/api/invest-simulator/accounts?simulatorId=sim-1",
    "/api/invest-simulator/exchange",
    "/api/invest-simulator/orders",
    "/api/invest-simulator/orders",
  ]);
  assert.deepEqual(calls.map(({ options }) => options.method || "GET"), [
    "GET", "POST", "PATCH", "DELETE", "POST", "POST", "POST",
  ]);
  assert.equal(JSON.parse(calls.at(-1).options.body).side, "sell");
});

test("invest simulator API client rejects invalid targets and server failures", async () => {
  assert.throws(() => deleteInvestSimulatorAccount(""), /찾지 못했습니다/);
  const fetchImpl = async () => response(
    { ok: false, error: "ledger unavailable" },
    { ok: false, status: 503 },
  );
  await assert.rejects(() => fetchInvestSimulatorAccounts(undefined, fetchImpl), /ledger unavailable/);
});
