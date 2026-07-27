import assert from "node:assert/strict";
import test from "node:test";
import {
  executeDailyIntelligenceJob,
  fetchDailyIntelligence,
  fetchDailyIntelligenceJobStatus,
  planDailyIntelligenceJob,
} from "../src/dailyIntelligence/dailyIntelligenceApi.js";

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

test("Daily Intelligence API client requests a selected analyst research date", async () => {
  const calls = [];
  await fetchDailyIntelligence(async (path, options) => {
    calls.push({ path, options });
    return response({ ok: true });
  }, { brokerResearchDate: "2026-07-25" });
  assert.equal(
    calls[0].path,
    "/api/pb-daily-intelligence?brokerDate=2026-07-25"
  );
});

test("Daily Intelligence job client uses plan and execute confirmation flow", async () => {
  const calls = [];
  const fetchImpl = async (path, options = {}) => {
    calls.push({ path, options });
    return response({ ok: true, run: { status: "idle" } });
  };
  await fetchDailyIntelligenceJobStatus(fetchImpl);
  await planDailyIntelligenceJob("dry_run", fetchImpl);
  await executeDailyIntelligenceJob("confirmation-token", fetchImpl);

  assert.equal(calls[0].path, "/api/pb-daily-intelligence/jobs");
  assert.equal(calls[0].options.method, "GET");
  assert.deepEqual(JSON.parse(calls[1].options.body), {
    action: "plan",
    jobId: "dry_run",
  });
  assert.deepEqual(JSON.parse(calls[2].options.body), {
    action: "execute",
    token: "confirmation-token",
  });
});
