import assert from "node:assert/strict";
import test from "node:test";
import {
  fetchBinanceProviderStatus,
  fetchTossInvestmentStatus,
  fetchTossMarketCalendar,
  fetchTossStockOptions,
  fetchUsdKrwExchangeRate,
} from "../src/transactions/transactionMarketDataApi.js";

function response(payload = { ok: true }, { ok = true, status = 200 } = {}) {
  return { ok, status, async json() { return payload; } };
}

test("transaction market-data API client preserves endpoint contracts", async () => {
  const calls = [];
  const fetchImpl = async (path, options) => {
    calls.push({ path, options });
    return response({ ok: true });
  };
  await fetchBinanceProviderStatus(undefined, fetchImpl);
  await fetchTossStockOptions(["aapl", "005930"], undefined, fetchImpl);
  await fetchTossMarketCalendar("us", "2026-07-22", undefined, fetchImpl);
  await fetchUsdKrwExchangeRate(undefined, fetchImpl);
  await fetchTossInvestmentStatus({ currency: "USD", accountSeq: "7", force: true }, undefined, fetchImpl);

  assert.deepEqual(calls.map(({ path }) => path), [
    "/api/market-data/providers/status?provider=binance",
    "/api/tossinvest/stocks?symbols=AAPL%2C005930",
    "/api/tossinvest/market-calendar/us?date=2026-07-22",
    "/api/tossinvest/exchange-rate?baseCurrency=USD&quoteCurrency=KRW",
    "/api/tossinvest/investment-status?currency=USD&accountSeq=7&force=1",
  ]);
});

test("transaction market-data API client preserves structured error metadata", async () => {
  const fetchImpl = async () => response(
    { ok: false, error: "rate limited", errorCode: "TOSS_RATE_LIMIT", rateLimit: { retryAfterMs: 9000 } },
    { ok: false, status: 429 },
  );
  await assert.rejects(
    async () => {
      try {
        await fetchTossInvestmentStatus({}, undefined, fetchImpl);
      } catch (error) {
        assert.equal(error.status, 429);
        assert.equal(error.errorCode, "TOSS_RATE_LIMIT");
        assert.deepEqual(error.rateLimit, { retryAfterMs: 9000 });
        throw error;
      }
    },
    /rate limited/,
  );
});
