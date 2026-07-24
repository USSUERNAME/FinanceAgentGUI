import assert from "node:assert/strict";
import test from "node:test";
import { fetchDailyIntelligence } from "../src/dailyIntelligence/dailyIntelligenceApi.js";

function response(payload, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    async json() {
      return payload;
    },
  };
}

test("Daily Intelligence API client requests the read-only bridge endpoint", async () => {
  const calls = [];
  const payload = await fetchDailyIntelligence(async (path, options) => {
    calls.push({ path, options });
    return response({ ok: true, connection: { available: true } });
  });
  assert.equal(calls[0].path, "/api/pb-daily-intelligence");
  assert.equal(calls[0].options.cache, "no-store");
  assert.equal(payload.connection.available, true);
});

test("Daily Intelligence API client surfaces backend errors", async () => {
  await assert.rejects(
    () =>
      fetchDailyIntelligence(async () =>
        response({ ok: false, error: "bridge failed" }, { ok: false, status: 500 })
      ),
    /bridge failed/
  );
});
