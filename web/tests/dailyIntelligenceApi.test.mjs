import assert from "node:assert/strict";
import test from "node:test";
import {
  executeDailyIntelligenceJob,
  fetchDailyIntelligence,
  fetchDailyIntelligenceJobStatus,
  planDailyIntelligenceJob,
  quickAddDailyIntelligencePortfolioHolding,
  quickAddDailyIntelligenceWatchlistTicker,
  removeDailyIntelligencePortfolioHolding,
  reviewDailyIntelligencePortfolioRisk,
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

test("Daily Intelligence quick-add sends only the selected ticker", async () => {
  const calls = [];
  const result = await quickAddDailyIntelligenceWatchlistTicker(
    "NVDA",
    async (path, options = {}) => {
      calls.push({ path, options });
      return response({ ok: true, added: true, ticker: "NVDA" });
    },
  );
  assert.equal(result.added, true);
  assert.equal(calls[0].path, "/api/pb-daily-intelligence");
  assert.equal(calls[0].options.method, "POST");
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    action: "quickAddWatchlistTicker",
    ticker: "NVDA",
  });
});

test("Daily Intelligence portfolio quick-add sends ticker and bounded weight", async () => {
  const calls = [];
  const result = await quickAddDailyIntelligencePortfolioHolding(
    "NVDA",
    7.5,
    async (path, options = {}) => {
      calls.push({ path, options });
      return response({ ok: true, added: true, ticker: "NVDA", weight: 7.5 });
    },
  );
  assert.equal(result.weight, 7.5);
  assert.equal(calls[0].path, "/api/pb-daily-intelligence");
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    action: "quickAddPortfolioHolding",
    ticker: "NVDA",
    weight: 7.5,
  });
});

test("Daily Intelligence portfolio remove sends only the selected ticker", async () => {
  const calls = [];
  const result = await removeDailyIntelligencePortfolioHolding(
    "NVDA",
    async (path, options = {}) => {
      calls.push({ path, options });
      return response({ ok: true, removed: true, ticker: "NVDA" });
    },
  );
  assert.equal(result.removed, true);
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    action: "removePortfolioHolding",
    ticker: "NVDA",
  });
});

test("Daily Intelligence portfolio risk review sends bounded status and note", async () => {
  const calls = [];
  const result = await reviewDailyIntelligencePortfolioRisk(
    {
      riskId: "stock:NVDA",
      status: "checked",
      note: "실적과 상대성과 확인 완료",
      reviewDate: "",
      reviewReportDate: "2026-07-29",
    },
    async (path, options = {}) => {
      calls.push({ path, options });
      return response({ ok: true, review: { status: "checked" } });
    },
  );
  assert.equal(result.review.status, "checked");
  assert.equal(calls[0].path, "/api/pb-daily-intelligence");
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    action: "reviewPortfolioRisk",
    riskId: "stock:NVDA",
    status: "checked",
    note: "실적과 상대성과 확인 완료",
    reviewDate: "",
    reviewReportDate: "2026-07-29",
  });
});
