import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { __tossInvestTestHooks, handleTossInvestEndpoint } from "../server/tossInvestApi.mjs";

const {
  buildLiveInvestmentStatusPayload,
  clearRuntimeState,
  createTossRateLimitPacer,
  tossRateLimitGroupForPath,
  tossRateLimitPublicSummary,
} = __tossInvestTestHooks;
const TEST_DIR = dirname(fileURLToPath(import.meta.url));

function jsonResponse(payload, { status = 200, requestId = "", retryAfter = "" } = {}) {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (requestId) headers.set("x-request-id", requestId);
  if (retryAfter) headers.set("retry-after", retryAfter);
  return new Response(JSON.stringify(payload), { status, headers });
}

function createMockResponseSink() {
  return {
    statusCode: 200,
    headers: {},
    body: "",
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value;
    },
    end(body) {
      this.body = body;
    },
  };
}

async function callTossInvestEndpoint(kind, url) {
  const res = createMockResponseSink();
  await handleTossInvestEndpoint(kind, { method: "GET", url }, res);
  return {
    statusCode: res.statusCode,
    body: JSON.parse(res.body || "{}"),
  };
}

async function collectPaceTimes(groupName, count) {
  let currentTime = 0;
  const starts = [];
  const pace = createTossRateLimitPacer({
    now: () => currentTime,
    delay: async (ms) => {
      currentTime += ms;
    },
  });
  await Promise.all(
    Array.from({ length: count }, async () => {
      await pace(groupName);
      starts.push(currentTime);
    }),
  );
  return starts.sort((left, right) => left - right);
}

test("Toss live investment payload keeps KRW and USD amounts separate", () => {
  const payload = buildLiveInvestmentStatusPayload({
    accountsResponse: {
      result: [{ accountNo: "12345678901", accountSeq: 1, accountType: "BROKERAGE" }],
      requestId: "accounts-request",
    },
    holdingsResponse: {
      result: {
        totalPurchaseAmount: { krw: "1000000", usd: "1000" },
        marketValue: {
          amount: { krw: "1100000", usd: "1200" },
          amountAfterCost: { krw: "1090000", usd: "1190" },
        },
        profitLoss: {
          amount: { krw: "100000", usd: "200" },
          amountAfterCost: { krw: "90000", usd: "190" },
          rate: "0.1428",
          rateAfterCost: "0.1333",
        },
        dailyProfitLoss: {
          amount: { krw: "10000", usd: "15" },
          rate: "0.0101",
        },
        items: [
          {
            symbol: "005930",
            name: "삼성전자",
            marketCountry: "KR",
            currency: "KRW",
            quantity: "10",
            lastPrice: "110000",
            averagePurchasePrice: "100000",
            marketValue: { purchaseAmount: "1000000", amount: "1100000", amountAfterCost: "1090000" },
            profitLoss: { amount: "100000", amountAfterCost: "90000", rate: "0.1", rateAfterCost: "0.09" },
            dailyProfitLoss: { amount: "10000", rate: "0.0091" },
            cost: { commission: "1000", tax: "9000" },
          },
          {
            symbol: "AAPL",
            name: "Apple Inc.",
            marketCountry: "US",
            currency: "USD",
            quantity: "5",
            lastPrice: "240",
            averagePurchasePrice: "200",
            marketValue: { purchaseAmount: "1000", amount: "1200", amountAfterCost: "1190" },
            profitLoss: { amount: "200", amountAfterCost: "190", rate: "0.2", rateAfterCost: "0.19" },
            dailyProfitLoss: { amount: "15", rate: "0.0125" },
            cost: { commission: "5", tax: null },
          },
        ],
      },
      requestId: "holdings-request",
    },
    priceResponses: [
      {
        result: [
          { symbol: "005930", lastPrice: "111000", currency: "KRW", timestamp: "2026-07-08T09:30:00+09:00" },
          { symbol: "AAPL", lastPrice: "241.5", currency: "USD", timestamp: "2026-07-08T22:30:00+09:00" },
        ],
        requestId: "prices-request",
      },
    ],
    selectedAccountSeq: "1",
    requestedCurrency: "KRW",
    requestSummary: { accounts: 1, holdings: 1, prices: 1 },
  });

  assert.equal(payload.ok, true);
  assert.equal(payload.source, "토스 증권 API");
  assert.equal(payload.sourceMode, "live");
  assert.equal(payload.refresh.recommendedIntervalMs, 1000);
  assert.equal(payload.refresh.cacheTtlMs, 900);
  assert.equal(payload.rateLimitPolicy.MARKET_INFO.maxPerSecond, 3);
  assert.equal(payload.rateLimitPolicy.MARKET_DATA.maxPerSecond, 10);
  assert.equal(payload.rateLimitPolicy.MARKET_DATA_CHART.maxPerSecond, 5);
  assert.equal(payload.unit, "KRW");
  assert.equal(payload.totalValue, 1090000);
  assert.equal(payload.totalValueKrw, 1090000);
  assert.equal(payload.totalValueUsd, 1190);
  assert.equal(payload.totalProfitKrw, 90000);
  assert.equal(payload.totalProfitUsd, 190);
  assert.equal(payload.totalProfitPercent, 13.33);
  assert.equal(payload.items.length, 2);
  assert.equal(payload.items[0].marketCountry, "KR");
  assert.equal(payload.items[1].marketCountry, "US");
  assert.equal(payload.items[1].symbol, "AAPL");
  assert.equal(payload.items[1].displayCurrency, "USD");
  assert.equal(payload.items[1].value, 1190);
  assert.equal(payload.items[1].currentPrice, 241.5);
  assert.equal(payload.items[1].marketValueKrw, 0);
  assert.equal(payload.items[1].marketValueUsd, 1190);
});

test("Toss live investment payload does not invent KRW totals for USD-only holdings", () => {
  const payload = buildLiveInvestmentStatusPayload({
    accountsResponse: { result: [{ accountSeq: 1, accountType: "BROKERAGE" }] },
    holdingsResponse: {
      result: {
        totalPurchaseAmount: { krw: "0", usd: "1000" },
        marketValue: {
          amount: { krw: "0", usd: "1200" },
          amountAfterCost: { krw: "0", usd: "1190" },
        },
        profitLoss: {
          amount: { krw: "0", usd: "200" },
          amountAfterCost: { krw: "0", usd: "190" },
          rate: "0.2",
          rateAfterCost: "0.19",
        },
        dailyProfitLoss: { amount: { krw: "0", usd: "15" }, rate: "0.0125" },
        items: [],
      },
    },
    priceResponses: [],
    selectedAccountSeq: "1",
    requestedCurrency: "KRW",
    requestSummary: { accounts: 1, holdings: 1, prices: 0 },
  });

  assert.equal(payload.unit, "USD");
  assert.equal(payload.totalValue, 1190);
  assert.equal(payload.totalValueKrw, 0);
  assert.equal(payload.totalValueUsd, 1190);
});

test("Toss rate-limit grouping follows official market groups and conservative account pacing", () => {
  assert.equal(tossRateLimitGroupForPath("/api/v1/prices"), "MARKET_DATA");
  assert.equal(tossRateLimitGroupForPath("/api/v1/candles"), "MARKET_DATA_CHART");
  assert.equal(tossRateLimitGroupForPath("/api/v1/exchange-rate"), "MARKET_INFO");
  assert.equal(tossRateLimitGroupForPath("/api/v1/market-calendar/US"), "MARKET_INFO");
  assert.equal(tossRateLimitGroupForPath("/api/v1/accounts"), "ACCOUNT");
  assert.equal(tossRateLimitGroupForPath("/api/v1/holdings"), "ASSET");

  const summary = tossRateLimitPublicSummary();
  assert.equal(summary.MARKET_INFO.maxPerSecond, 3);
  assert.equal(summary.MARKET_DATA.maxPerSecond, 10);
  assert.equal(summary.MARKET_DATA_CHART.maxPerSecond, 5);
  assert.ok(summary.MARKET_INFO.minIntervalMs >= 333);
  assert.ok(summary.MARKET_DATA.minIntervalMs >= 100);
  assert.ok(summary.MARKET_DATA_CHART.minIntervalMs >= 200);
});

test("Toss rate-limit pacer serializes concurrent calls inside each limit group", async () => {
  assert.deepEqual(await collectPaceTimes("MARKET_DATA", 4), [0, 120, 240, 360]);
  assert.deepEqual(await collectPaceTimes("MARKET_DATA_CHART", 3), [0, 220, 440]);
  assert.deepEqual(await collectPaceTimes("MARKET_INFO", 3), [0, 350, 700]);
});

test("Toss read-only market endpoints pace official rate-limit groups", async () => {
  const envSnapshot = {
    TOSSINVEST_BASE_URL: process.env.TOSSINVEST_BASE_URL,
    TOSSINVEST_CLIENT_ID: process.env.TOSSINVEST_CLIENT_ID,
    TOSSINVEST_CLIENT_SECRET: process.env.TOSSINVEST_CLIENT_SECRET,
    TOSS_INVEST_CLIENT_ID: process.env.TOSS_INVEST_CLIENT_ID,
    TOSS_INVEST_CLIENT_SECRET: process.env.TOSS_INVEST_CLIENT_SECRET,
  };
  const originalFetch = globalThis.fetch;
  const calls = [];

  clearRuntimeState();
  process.env.TOSSINVEST_BASE_URL = "https://mock.tossinvest.test";
  process.env.TOSSINVEST_CLIENT_ID = "mock-client-id";
  process.env.TOSSINVEST_CLIENT_SECRET = "mock-client-secret";
  delete process.env.TOSS_INVEST_CLIENT_ID;
  delete process.env.TOSS_INVEST_CLIENT_SECRET;

  globalThis.fetch = async (url, options = {}) => {
    const target = new URL(String(url));
    calls.push({
      method: options.method || "GET",
      path: target.pathname,
      search: target.search,
      at: Date.now(),
    });

    if (target.pathname === "/oauth2/token") {
      return jsonResponse({ access_token: "paced-token", token_type: "Bearer", expires_in: 300 });
    }
    if (target.pathname === "/api/v1/prices") {
      return jsonResponse({
        result: target.searchParams.get("symbols").split(",").map((symbol) => ({
          symbol,
          lastPrice: "100",
          currency: "USD",
          timestamp: "2026-07-09T09:13:00+09:00",
        })),
      });
    }
    if (target.pathname === "/api/v1/candles") {
      return jsonResponse({
        result: [{ symbol: target.searchParams.get("symbol"), close: "100", timestamp: "2026-07-09" }],
      });
    }
    if (target.pathname === "/api/v1/exchange-rate") {
      return jsonResponse({ result: { baseCurrency: "USD", quoteCurrency: "KRW", rate: "1370.00" } });
    }
    if (target.pathname === "/api/v1/market-calendar/US") {
      return jsonResponse({ result: [{ date: "2026-07-09", isOpen: true }] });
    }
    return jsonResponse({ error: { message: `unexpected ${target.pathname}` } }, { status: 404 });
  };

  try {
    const priceResults = await Promise.all([
      callTossInvestEndpoint("prices", "/api/tossinvest/prices?symbols=AAPL"),
      callTossInvestEndpoint("prices", "/api/tossinvest/prices?symbols=MSFT"),
    ]);
    const candleResults = await Promise.all([
      callTossInvestEndpoint("candles", "/api/tossinvest/candles?symbol=AAPL&interval=1d&count=1"),
      callTossInvestEndpoint("candles", "/api/tossinvest/candles?symbol=MSFT&interval=1d&count=1"),
    ]);
    const marketInfoResults = await Promise.all([
      callTossInvestEndpoint("exchange-rate", "/api/tossinvest/exchange-rate?baseCurrency=USD&quoteCurrency=KRW"),
      callTossInvestEndpoint("market-calendar-us", "/api/tossinvest/market-calendar/us?date=2026-07-09"),
    ]);

    for (const response of [...priceResults, ...candleResults, ...marketInfoResults]) {
      assert.equal(response.statusCode, 200);
      assert.equal(response.body.ok, true);
    }

    const priceCalls = calls.filter((call) => call.path === "/api/v1/prices");
    const candleCalls = calls.filter((call) => call.path === "/api/v1/candles");
    const infoCalls = calls.filter(
      (call) => call.path === "/api/v1/exchange-rate" || call.path === "/api/v1/market-calendar/US",
    );

    assert.equal(priceCalls.length, 2);
    assert.equal(candleCalls.length, 2);
    assert.equal(infoCalls.length, 2);
    assert.ok(priceCalls[1].at - priceCalls[0].at >= 100);
    assert.ok(candleCalls[1].at - candleCalls[0].at >= 180);
    assert.ok(infoCalls[1].at - infoCalls[0].at >= 300);
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(envSnapshot)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    clearRuntimeState();
  }
});

test("Toss rate-limit token failure backs off without credential discard", async () => {
  const envSnapshot = {
    TOSSINVEST_BASE_URL: process.env.TOSSINVEST_BASE_URL,
    TOSSINVEST_CLIENT_ID: process.env.TOSSINVEST_CLIENT_ID,
    TOSSINVEST_CLIENT_SECRET: process.env.TOSSINVEST_CLIENT_SECRET,
    TOSS_INVEST_CLIENT_ID: process.env.TOSS_INVEST_CLIENT_ID,
    TOSS_INVEST_CLIENT_SECRET: process.env.TOSS_INVEST_CLIENT_SECRET,
  };
  const originalFetch = globalThis.fetch;
  const calls = [];

  clearRuntimeState();
  process.env.TOSSINVEST_BASE_URL = "https://mock.tossinvest.test";
  process.env.TOSSINVEST_CLIENT_ID = "mock-client-id";
  process.env.TOSSINVEST_CLIENT_SECRET = "mock-client-secret";
  delete process.env.TOSS_INVEST_CLIENT_ID;
  delete process.env.TOSS_INVEST_CLIENT_SECRET;

  globalThis.fetch = async (url, options = {}) => {
    const target = new URL(String(url));
    calls.push({ method: options.method || "GET", path: target.pathname });
    if (target.pathname === "/oauth2/token") {
      return jsonResponse(
        { error: { message: "요청 한도를 초과했습니다. 잠시 후 다시 시도해 주세요." } },
        { status: 429, requestId: "token-rate-limit", retryAfter: "0.1" },
      );
    }
    return jsonResponse({ error: { message: `unexpected ${target.pathname}` } }, { status: 404 });
  };

  try {
    const response = await callTossInvestEndpoint(
      "investment-status",
      "/api/tossinvest/investment-status?currency=KRW&accountSeq=11&force=1",
    );

    assert.equal(response.statusCode, 429);
    assert.equal(response.body.ok, false);
    assert.equal(response.body.errorCode, "");
    assert.match(response.body.error, /요청 한도/);
    assert.equal(response.body.requestId, "token-rate-limit");
    assert.equal(response.body.rateLimit.retryAfter, "0.1");
    assert.deepEqual(calls.map((call) => call.path), ["/oauth2/token"]);
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(envSnapshot)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    clearRuntimeState();
  }
});

test("Toss credential auth failures expose discard-only error codes", async () => {
  const envSnapshot = {
    TOSSINVEST_BASE_URL: process.env.TOSSINVEST_BASE_URL,
    TOSSINVEST_CLIENT_ID: process.env.TOSSINVEST_CLIENT_ID,
    TOSSINVEST_CLIENT_SECRET: process.env.TOSSINVEST_CLIENT_SECRET,
    TOSS_INVEST_CLIENT_ID: process.env.TOSS_INVEST_CLIENT_ID,
    TOSS_INVEST_CLIENT_SECRET: process.env.TOSS_INVEST_CLIENT_SECRET,
  };
  const originalFetch = globalThis.fetch;

  clearRuntimeState();
  process.env.TOSSINVEST_BASE_URL = "https://mock.tossinvest.test";
  process.env.TOSSINVEST_CLIENT_ID = "mock-client-id";
  process.env.TOSSINVEST_CLIENT_SECRET = "bad-secret";
  delete process.env.TOSS_INVEST_CLIENT_ID;
  delete process.env.TOSS_INVEST_CLIENT_SECRET;

  globalThis.fetch = async (url) => {
    const target = new URL(String(url));
    if (target.pathname === "/oauth2/token") {
      return jsonResponse({ error_description: "client authentication failed: client_secret" }, { status: 401 });
    }
    return jsonResponse({ error: { message: `unexpected ${target.pathname}` } }, { status: 404 });
  };

  try {
    const response = await callTossInvestEndpoint(
      "investment-status",
      "/api/tossinvest/investment-status?currency=KRW&accountSeq=11&force=1",
    );

    assert.equal(response.statusCode, 401);
    assert.equal(response.body.ok, false);
    assert.equal(response.body.errorCode, "toss_client_secret_auth");
    assert.match(response.body.error, /Secret Key/);
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(envSnapshot)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    clearRuntimeState();
  }
});

test("Toss investment status endpoint composes live accounts, holdings, and prices", async () => {
  const envSnapshot = {
    TOSSINVEST_BASE_URL: process.env.TOSSINVEST_BASE_URL,
    TOSSINVEST_CLIENT_ID: process.env.TOSSINVEST_CLIENT_ID,
    TOSSINVEST_CLIENT_SECRET: process.env.TOSSINVEST_CLIENT_SECRET,
    TOSS_INVEST_CLIENT_ID: process.env.TOSS_INVEST_CLIENT_ID,
    TOSS_INVEST_CLIENT_SECRET: process.env.TOSS_INVEST_CLIENT_SECRET,
  };
  const originalFetch = globalThis.fetch;
  const calls = [];

  clearRuntimeState();
  process.env.TOSSINVEST_BASE_URL = "https://mock.tossinvest.test";
  process.env.TOSSINVEST_CLIENT_ID = "mock-client-id";
  process.env.TOSSINVEST_CLIENT_SECRET = "mock-client-secret";
  delete process.env.TOSS_INVEST_CLIENT_ID;
  delete process.env.TOSS_INVEST_CLIENT_SECRET;

  globalThis.fetch = async (url, options = {}) => {
    const target = new URL(String(url));
    const headers = options.headers || {};
    const call = {
      method: options.method || "GET",
      path: target.pathname,
      search: target.search,
      authorization: headers.Authorization || headers.authorization || "",
      accountSeq: headers["X-Tossinvest-Account"] || headers["x-tossinvest-account"] || "",
    };
    calls.push(call);

    if (target.pathname === "/oauth2/token") {
      return jsonResponse(
        { access_token: "mock-access-token", token_type: "Bearer", expires_in: 300 },
        { requestId: "token-request" },
      );
    }
    if (target.pathname === "/api/v1/accounts") {
      return jsonResponse(
        {
          result: [
            { accountNo: "111122223333", accountSeq: "11", accountType: "BROKERAGE" },
            { accountNo: "444455556666", accountSeq: "22", accountType: "BROKERAGE" },
          ],
        },
        { requestId: "accounts-request" },
      );
    }
    if (target.pathname === "/api/v1/holdings") {
      assert.equal(call.authorization, "Bearer mock-access-token");
      assert.equal(call.accountSeq, "22");
      return jsonResponse(
        {
          result: {
            totalPurchaseAmount: { krw: "0", usd: "300" },
            marketValue: {
              amount: { krw: "0", usd: "333" },
              amountAfterCost: { krw: "0", usd: "330" },
            },
            profitLoss: {
              amount: { krw: "0", usd: "33" },
              amountAfterCost: { krw: "0", usd: "30" },
              rate: "0.11",
              rateAfterCost: "0.10",
            },
            dailyProfitLoss: { amount: { krw: "0", usd: "6" }, rate: "0.0182" },
            items: [
              {
                symbol: "AAPL",
                name: "Apple Inc.",
                marketCountry: "US",
                currency: "USD",
                quantity: "1",
                lastPrice: "190",
                averagePurchasePrice: "170",
                marketValue: { purchaseAmount: "170", amount: "191", amountAfterCost: "190" },
                profitLoss: { amount: "21", amountAfterCost: "20", rate: "0.1235", rateAfterCost: "0.1176" },
                dailyProfitLoss: { amount: "4", rate: "0.0215" },
                cost: { commission: "1", tax: null },
              },
              {
                symbol: "MSFT",
                name: "Microsoft",
                marketCountry: "US",
                currency: "USD",
                quantity: "0.5",
                lastPrice: "280",
                averagePurchasePrice: "260",
                marketValue: { purchaseAmount: "130", amount: "142", amountAfterCost: "140" },
                profitLoss: { amount: "12", amountAfterCost: "10", rate: "0.0923", rateAfterCost: "0.0769" },
                dailyProfitLoss: { amount: "2", rate: "0.0145" },
                cost: { commission: "1", tax: null },
              },
            ],
          },
        },
        { requestId: "holdings-request" },
      );
    }
    if (target.pathname === "/api/v1/prices") {
      assert.equal(target.searchParams.get("symbols"), "AAPL,MSFT");
      return jsonResponse(
        {
          result: [
            { symbol: "AAPL", lastPrice: "192", currency: "USD", timestamp: "2026-07-08T22:30:00+09:00" },
            { symbol: "MSFT", lastPrice: "284", currency: "USD", timestamp: "2026-07-08T22:30:00+09:00" },
          ],
        },
        { requestId: "prices-request" },
      );
    }
    return jsonResponse({ error: { message: `unexpected ${target.pathname}` } }, { status: 404 });
  };

  try {
    const response = await callTossInvestEndpoint(
      "investment-status",
      "/api/tossinvest/investment-status?currency=KRW&accountSeq=22&force=1",
    );
    const payload = response.body;

    assert.equal(response.statusCode, 200);
    assert.equal(payload.ok, true);
    assert.equal(payload.sourceMode, "live");
    assert.equal(payload.source, "토스 증권 API");
    assert.equal(payload.accountSeq, "22");
    assert.equal(payload.accountCount, 2);
    assert.equal(payload.unit, "USD");
    assert.equal(payload.totalValue, 330);
    assert.equal(payload.totalValueKrw, 0);
    assert.equal(payload.totalValueUsd, 330);
    assert.equal(payload.items.length, 2);
    assert.equal(payload.items[0].symbol, "AAPL");
    assert.equal(payload.items[0].currentPrice, 192);
    assert.equal(payload.requestSummary.accounts, 1);
    assert.equal(payload.requestSummary.holdings, 1);
    assert.equal(payload.requestSummary.prices, 1);
    assert.equal(payload.refresh.recommendedIntervalMs, 1000);
    assert.equal(payload.refresh.cacheTtlMs, 900);
    assert.equal(payload.rateLimitPolicy.MARKET_DATA.maxPerSecond, 10);
    assert.equal(payload.rateLimitPolicy.MARKET_DATA.minIntervalMs >= 100, true);
    assert.deepEqual(
      calls.map((call) => call.path),
      ["/oauth2/token", "/api/v1/accounts", "/api/v1/holdings", "/api/v1/prices"],
    );
    assert.equal(calls.some((call) => call.path === "/api/v1/exchange-rate"), false);
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(envSnapshot)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    clearRuntimeState();
  }
});

test("Toss investment status endpoint keeps holdings visible when price lookup fails", async () => {
  const envSnapshot = {
    TOSSINVEST_BASE_URL: process.env.TOSSINVEST_BASE_URL,
    TOSSINVEST_CLIENT_ID: process.env.TOSSINVEST_CLIENT_ID,
    TOSSINVEST_CLIENT_SECRET: process.env.TOSSINVEST_CLIENT_SECRET,
    TOSS_INVEST_CLIENT_ID: process.env.TOSS_INVEST_CLIENT_ID,
    TOSS_INVEST_CLIENT_SECRET: process.env.TOSS_INVEST_CLIENT_SECRET,
  };
  const originalFetch = globalThis.fetch;
  const calls = [];

  clearRuntimeState();
  process.env.TOSSINVEST_BASE_URL = "https://mock.tossinvest.test";
  process.env.TOSSINVEST_CLIENT_ID = "mock-client-id";
  process.env.TOSSINVEST_CLIENT_SECRET = "mock-client-secret";
  delete process.env.TOSS_INVEST_CLIENT_ID;
  delete process.env.TOSS_INVEST_CLIENT_SECRET;

  globalThis.fetch = async (url, options = {}) => {
    const target = new URL(String(url));
    const headers = options.headers || {};
    calls.push({
      method: options.method || "GET",
      path: target.pathname,
      search: target.search,
      accountSeq: headers["X-Tossinvest-Account"] || headers["x-tossinvest-account"] || "",
    });

    if (target.pathname === "/oauth2/token") {
      return jsonResponse({ access_token: "price-failure-token", token_type: "Bearer", expires_in: 300 });
    }
    if (target.pathname === "/api/v1/accounts") {
      return jsonResponse({ result: [{ accountNo: "111122223333", accountSeq: "11", accountType: "BROKERAGE" }] });
    }
    if (target.pathname === "/api/v1/holdings") {
      return jsonResponse({
        result: {
          totalPurchaseAmount: { krw: "0", usd: "170" },
          marketValue: { amount: { krw: "0", usd: "191" }, amountAfterCost: { krw: "0", usd: "190" } },
          profitLoss: { amount: { krw: "0", usd: "21" }, amountAfterCost: { krw: "0", usd: "20" }, rateAfterCost: "0.1176" },
          dailyProfitLoss: { amount: { krw: "0", usd: "4" }, rate: "0.0215" },
          items: [
            {
              symbol: "AAPL",
              name: "Apple Inc.",
              marketCountry: "US",
              currency: "USD",
              quantity: "1",
              lastPrice: "190",
              averagePurchasePrice: "170",
              marketValue: { purchaseAmount: "170", amount: "191", amountAfterCost: "190" },
              profitLoss: { amount: "21", amountAfterCost: "20", rate: "0.1235", rateAfterCost: "0.1176" },
              dailyProfitLoss: { amount: "4", rate: "0.0215" },
              cost: { commission: "1", tax: null },
            },
          ],
        },
      });
    }
    if (target.pathname === "/api/v1/prices") {
      return jsonResponse({ error: { message: "temporary market data outage" } }, { status: 503 });
    }
    return jsonResponse({ error: { message: `unexpected ${target.pathname}` } }, { status: 404 });
  };

  try {
    const response = await callTossInvestEndpoint(
      "investment-status",
      "/api/tossinvest/investment-status?currency=USD&accountSeq=11&force=1",
    );
    const priceCalls = calls.filter((call) => call.path === "/api/v1/prices");

    assert.equal(response.statusCode, 200);
    assert.equal(response.body.ok, true);
    assert.equal(response.body.sourceMode, "live");
    assert.equal(response.body.items.length, 1);
    assert.equal(response.body.items[0].symbol, "AAPL");
    assert.equal(response.body.items[0].currentPrice, 190);
    assert.equal(response.body.requestSummary.accounts, 1);
    assert.equal(response.body.requestSummary.holdings, 1);
    assert.equal(response.body.requestSummary.prices, 0);
    assert.equal(response.body.requestSummary.priceIssue.ok, false);
    assert.match(response.body.requestSummary.priceIssue.error, /temporary market data outage/);
    assert.equal(priceCalls.length, 1);
    assert.equal(calls.some((call) => call.path === "/api/v1/exchange-rate"), false);
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(envSnapshot)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    clearRuntimeState();
  }
});

test("Toss investment status endpoint backs off partial price rate limits", async () => {
  const envSnapshot = {
    TOSSINVEST_BASE_URL: process.env.TOSSINVEST_BASE_URL,
    TOSSINVEST_CLIENT_ID: process.env.TOSSINVEST_CLIENT_ID,
    TOSSINVEST_CLIENT_SECRET: process.env.TOSSINVEST_CLIENT_SECRET,
    TOSS_INVEST_CLIENT_ID: process.env.TOSS_INVEST_CLIENT_ID,
    TOSS_INVEST_CLIENT_SECRET: process.env.TOSS_INVEST_CLIENT_SECRET,
  };
  const originalFetch = globalThis.fetch;
  const calls = [];

  clearRuntimeState();
  process.env.TOSSINVEST_BASE_URL = "https://mock.tossinvest.test";
  process.env.TOSSINVEST_CLIENT_ID = "mock-client-id";
  process.env.TOSSINVEST_CLIENT_SECRET = "mock-client-secret";
  delete process.env.TOSS_INVEST_CLIENT_ID;
  delete process.env.TOSS_INVEST_CLIENT_SECRET;

  globalThis.fetch = async (url, options = {}) => {
    const target = new URL(String(url));
    calls.push({ method: options.method || "GET", path: target.pathname });

    if (target.pathname === "/oauth2/token") {
      return jsonResponse({ access_token: "price-rate-limit-token", token_type: "Bearer", expires_in: 300 });
    }
    if (target.pathname === "/api/v1/accounts") {
      return jsonResponse({ result: [{ accountNo: "111122223333", accountSeq: "11", accountType: "BROKERAGE" }] });
    }
    if (target.pathname === "/api/v1/holdings") {
      return jsonResponse({
        result: {
          totalPurchaseAmount: { krw: "0", usd: "170" },
          marketValue: { amount: { krw: "0", usd: "191" }, amountAfterCost: { krw: "0", usd: "190" } },
          profitLoss: { amount: { krw: "0", usd: "21" }, amountAfterCost: { krw: "0", usd: "20" }, rateAfterCost: "0.1176" },
          dailyProfitLoss: { amount: { krw: "0", usd: "4" }, rate: "0.0215" },
          items: [
            {
              symbol: "AAPL",
              name: "Apple Inc.",
              marketCountry: "US",
              currency: "USD",
              quantity: "1",
              lastPrice: "190",
              averagePurchasePrice: "170",
              marketValue: { purchaseAmount: "170", amount: "191", amountAfterCost: "190" },
              profitLoss: { amount: "21", amountAfterCost: "20", rateAfterCost: "0.1176" },
              dailyProfitLoss: { amount: "4", rate: "0.0215" },
              cost: { commission: "1", tax: null },
            },
          ],
        },
      });
    }
    if (target.pathname === "/api/v1/prices") {
      return jsonResponse(
        { error: { message: "요청 한도를 초과했습니다. 잠시 후 다시 시도해 주세요." } },
        { status: 429, requestId: "prices-rate-limit", retryAfter: "45" },
      );
    }
    return jsonResponse({ error: { message: `unexpected ${target.pathname}` } }, { status: 404 });
  };

  try {
    const response = await callTossInvestEndpoint(
      "investment-status",
      "/api/tossinvest/investment-status?currency=USD&accountSeq=11&force=1",
    );
    const priceCalls = calls.filter((call) => call.path === "/api/v1/prices");

    assert.equal(response.statusCode, 200);
    assert.equal(response.body.ok, true);
    assert.equal(response.body.items.length, 1);
    assert.equal(response.body.items[0].currentPrice, 190);
    assert.equal(response.body.requestSummary.priceIssue.ok, false);
    assert.equal(response.body.requestSummary.priceIssue.requestId, "prices-rate-limit");
    assert.equal(response.body.requestSummary.priceIssue.rateLimit.retryAfter, "45");
    assert.equal(response.body.refresh.retryAfterMs, 45000);
    assert.equal(response.body.refresh.recommendedIntervalMs, 45000);
    assert.equal(priceCalls.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(envSnapshot)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    clearRuntimeState();
  }
});

test("Toss investment status endpoint defaults to the first account when none is selected", async () => {
  const envSnapshot = {
    TOSSINVEST_BASE_URL: process.env.TOSSINVEST_BASE_URL,
    TOSSINVEST_CLIENT_ID: process.env.TOSSINVEST_CLIENT_ID,
    TOSSINVEST_CLIENT_SECRET: process.env.TOSSINVEST_CLIENT_SECRET,
    TOSS_INVEST_CLIENT_ID: process.env.TOSS_INVEST_CLIENT_ID,
    TOSS_INVEST_CLIENT_SECRET: process.env.TOSS_INVEST_CLIENT_SECRET,
  };
  const originalFetch = globalThis.fetch;
  const calls = [];

  clearRuntimeState();
  process.env.TOSSINVEST_BASE_URL = "https://mock.tossinvest.test";
  process.env.TOSSINVEST_CLIENT_ID = "mock-client-id";
  process.env.TOSSINVEST_CLIENT_SECRET = "mock-client-secret";
  delete process.env.TOSS_INVEST_CLIENT_ID;
  delete process.env.TOSS_INVEST_CLIENT_SECRET;

  globalThis.fetch = async (url, options = {}) => {
    const target = new URL(String(url));
    const headers = options.headers || {};
    calls.push({
      method: options.method || "GET",
      path: target.pathname,
      accountSeq: headers["X-Tossinvest-Account"] || headers["x-tossinvest-account"] || "",
    });

    if (target.pathname === "/oauth2/token") {
      return jsonResponse({ access_token: "default-account-token", token_type: "Bearer", expires_in: 300 });
    }
    if (target.pathname === "/api/v1/accounts") {
      return jsonResponse({
        result: [
          { accountNo: "111122223333", accountSeq: "11", accountType: "BROKERAGE" },
          { accountNo: "444455556666", accountSeq: "22", accountType: "BROKERAGE" },
        ],
      });
    }
    if (target.pathname === "/api/v1/holdings") {
      return jsonResponse({
        result: {
          totalPurchaseAmount: { krw: "100000", usd: "0" },
          marketValue: { amount: { krw: "101000", usd: "0" }, amountAfterCost: { krw: "100900", usd: "0" } },
          profitLoss: { amount: { krw: "1000", usd: "0" }, amountAfterCost: { krw: "900", usd: "0" }, rateAfterCost: "0.009" },
          dailyProfitLoss: { amount: { krw: "300", usd: "0" }, rate: "0.003" },
          items: [],
        },
      });
    }
    return jsonResponse({ error: { message: `unexpected ${target.pathname}` } }, { status: 404 });
  };

  try {
    const response = await callTossInvestEndpoint(
      "investment-status",
      "/api/tossinvest/investment-status?currency=KRW&force=1",
    );
    const holdingsCall = calls.find((call) => call.path === "/api/v1/holdings");

    assert.equal(response.statusCode, 200);
    assert.equal(response.body.ok, true);
    assert.equal(response.body.accountSeq, "11");
    assert.equal(response.body.accountCount, 2);
    assert.equal(holdingsCall.accountSeq, "11");
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(envSnapshot)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    clearRuntimeState();
  }
});

test("Toss investment status endpoint reuses fresh aggregate cache for refreshes", async () => {
  const envSnapshot = {
    TOSSINVEST_BASE_URL: process.env.TOSSINVEST_BASE_URL,
    TOSSINVEST_CLIENT_ID: process.env.TOSSINVEST_CLIENT_ID,
    TOSSINVEST_CLIENT_SECRET: process.env.TOSSINVEST_CLIENT_SECRET,
    TOSS_INVEST_CLIENT_ID: process.env.TOSS_INVEST_CLIENT_ID,
    TOSS_INVEST_CLIENT_SECRET: process.env.TOSS_INVEST_CLIENT_SECRET,
  };
  const originalFetch = globalThis.fetch;
  const calls = [];

  clearRuntimeState();
  process.env.TOSSINVEST_BASE_URL = "https://mock.tossinvest.test";
  process.env.TOSSINVEST_CLIENT_ID = "mock-client-id";
  process.env.TOSSINVEST_CLIENT_SECRET = "mock-client-secret";
  delete process.env.TOSS_INVEST_CLIENT_ID;
  delete process.env.TOSS_INVEST_CLIENT_SECRET;

  globalThis.fetch = async (url, options = {}) => {
    const target = new URL(String(url));
    const headers = options.headers || {};
    calls.push({
      method: options.method || "GET",
      path: target.pathname,
      search: target.search,
      accountSeq: headers["X-Tossinvest-Account"] || headers["x-tossinvest-account"] || "",
    });

    if (target.pathname === "/oauth2/token") {
      return jsonResponse({ access_token: "cached-token", token_type: "Bearer", expires_in: 300 });
    }
    if (target.pathname === "/api/v1/accounts") {
      return jsonResponse({ result: [{ accountNo: "111122223333", accountSeq: "11", accountType: "BROKERAGE" }] });
    }
    if (target.pathname === "/api/v1/holdings") {
      return jsonResponse({
        result: {
          totalPurchaseAmount: { krw: "100000", usd: "0" },
          marketValue: { amount: { krw: "101000", usd: "0" }, amountAfterCost: { krw: "100900", usd: "0" } },
          profitLoss: { amount: { krw: "1000", usd: "0" }, amountAfterCost: { krw: "900", usd: "0" }, rateAfterCost: "0.009" },
          dailyProfitLoss: { amount: { krw: "300", usd: "0" }, rate: "0.003" },
          items: [
            {
              symbol: "005930",
              name: "삼성전자",
              marketCountry: "KR",
              currency: "KRW",
              quantity: "1",
              lastPrice: "100900",
              averagePurchasePrice: "100000",
              marketValue: { purchaseAmount: "100000", amount: "101000", amountAfterCost: "100900" },
              profitLoss: { amount: "1000", amountAfterCost: "900", rateAfterCost: "0.009" },
              dailyProfitLoss: { amount: "300", rate: "0.003" },
              cost: { commission: "100", tax: null },
            },
          ],
        },
      });
    }
    if (target.pathname === "/api/v1/prices") {
      return jsonResponse({
        result: [{ symbol: "005930", lastPrice: "101500", currency: "KRW", timestamp: "2026-07-09T09:10:00+09:00" }],
      });
    }
    return jsonResponse({ error: { message: `unexpected ${target.pathname}` } }, { status: 404 });
  };

  try {
    const first = await callTossInvestEndpoint(
      "investment-status",
      "/api/tossinvest/investment-status?currency=KRW&accountSeq=11&force=1",
    );
    const second = await callTossInvestEndpoint(
      "investment-status",
      "/api/tossinvest/investment-status?currency=KRW&accountSeq=11",
    );

    assert.equal(first.statusCode, 200);
    assert.equal(second.statusCode, 200);
    assert.equal(first.body.cached, false);
    assert.equal(second.body.cached, true);
    assert.equal(second.body.totalValue, first.body.totalValue);
    assert.equal(Number.isFinite(second.body.cacheAgeMs), true);
    assert.deepEqual(
      calls.map((call) => call.path),
      ["/oauth2/token", "/api/v1/accounts", "/api/v1/holdings", "/api/v1/prices"],
    );
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(envSnapshot)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    clearRuntimeState();
  }
});

test("Toss investment status cache is scoped to the active credentials", async () => {
  const envSnapshot = {
    TOSSINVEST_BASE_URL: process.env.TOSSINVEST_BASE_URL,
    TOSSINVEST_CLIENT_ID: process.env.TOSSINVEST_CLIENT_ID,
    TOSSINVEST_CLIENT_SECRET: process.env.TOSSINVEST_CLIENT_SECRET,
    TOSS_INVEST_CLIENT_ID: process.env.TOSS_INVEST_CLIENT_ID,
    TOSS_INVEST_CLIENT_SECRET: process.env.TOSS_INVEST_CLIENT_SECRET,
  };
  const originalFetch = globalThis.fetch;
  const calls = [];

  clearRuntimeState();
  process.env.TOSSINVEST_BASE_URL = "https://mock.tossinvest.test";
  process.env.TOSSINVEST_CLIENT_ID = "mock-client-a";
  process.env.TOSSINVEST_CLIENT_SECRET = "mock-secret-a";
  delete process.env.TOSS_INVEST_CLIENT_ID;
  delete process.env.TOSS_INVEST_CLIENT_SECRET;

  globalThis.fetch = async (url, options = {}) => {
    const target = new URL(String(url));
    const headers = options.headers || {};
    const bodyText = String(options.body || "");
    const authHeader = headers.Authorization || headers.authorization || "";
    const tokenName = authHeader.includes("token-b") ? "B" : "A";
    calls.push({
      path: target.pathname,
      clientId: bodyText.match(/client_id=([^&]+)/)?.[1] || "",
      tokenName,
    });

    if (target.pathname === "/oauth2/token") {
      const isCredentialB = bodyText.includes("mock-client-b");
      return jsonResponse({
        access_token: isCredentialB ? "credential-token-b" : "credential-token-a",
        token_type: "Bearer",
        expires_in: 300,
      });
    }
    if (target.pathname === "/api/v1/accounts") {
      return jsonResponse({ result: [{ accountNo: "111122223333", accountSeq: "11", accountType: "BROKERAGE" }] });
    }
    if (target.pathname === "/api/v1/holdings") {
      const symbol = tokenName === "B" ? "MSFT" : "AAPL";
      const lastPrice = tokenName === "B" ? "420" : "240";
      return jsonResponse({
        result: {
          totalPurchaseAmount: { krw: "0", usd: tokenName === "B" ? "400" : "200" },
          marketValue: {
            amount: { krw: "0", usd: lastPrice },
            amountAfterCost: { krw: "0", usd: lastPrice },
          },
          profitLoss: {
            amount: { krw: "0", usd: tokenName === "B" ? "20" : "40" },
            amountAfterCost: { krw: "0", usd: tokenName === "B" ? "20" : "40" },
            rateAfterCost: tokenName === "B" ? "0.05" : "0.2",
          },
          dailyProfitLoss: { amount: { krw: "0", usd: "1" }, rate: "0.0025" },
          items: [
            {
              symbol,
              name: symbol,
              marketCountry: "US",
              currency: "USD",
              quantity: "1",
              lastPrice,
              averagePurchasePrice: tokenName === "B" ? "400" : "200",
              marketValue: { purchaseAmount: tokenName === "B" ? "400" : "200", amount: lastPrice, amountAfterCost: lastPrice },
              profitLoss: {
                amount: tokenName === "B" ? "20" : "40",
                amountAfterCost: tokenName === "B" ? "20" : "40",
                rateAfterCost: tokenName === "B" ? "0.05" : "0.2",
              },
              dailyProfitLoss: { amount: "1", rate: "0.0025" },
              cost: { commission: "0", tax: null },
            },
          ],
        },
      });
    }
    if (target.pathname === "/api/v1/prices") {
      return jsonResponse({
        result: [
          {
            symbol: tokenName === "B" ? "MSFT" : "AAPL",
            lastPrice: tokenName === "B" ? "421" : "241",
            currency: "USD",
            timestamp: "2026-07-09T09:10:00+09:00",
          },
        ],
      });
    }
    return jsonResponse({ error: { message: `unexpected ${target.pathname}` } }, { status: 404 });
  };

  try {
    const first = await callTossInvestEndpoint(
      "investment-status",
      "/api/tossinvest/investment-status?currency=USD&accountSeq=11&force=1",
    );
    const second = await callTossInvestEndpoint(
      "investment-status",
      "/api/tossinvest/investment-status?currency=USD&accountSeq=11",
    );

    process.env.TOSSINVEST_CLIENT_ID = "mock-client-b";
    process.env.TOSSINVEST_CLIENT_SECRET = "mock-secret-b";
    const third = await callTossInvestEndpoint(
      "investment-status",
      "/api/tossinvest/investment-status?currency=USD&accountSeq=11",
    );

    assert.equal(first.statusCode, 200);
    assert.equal(second.statusCode, 200);
    assert.equal(third.statusCode, 200);
    assert.equal(second.body.cached, true);
    assert.equal(third.body.cached, false);
    assert.equal(first.body.items[0].symbol, "AAPL");
    assert.equal(third.body.items[0].symbol, "MSFT");
    assert.deepEqual(
      calls.map((call) => call.path),
      [
        "/oauth2/token",
        "/api/v1/accounts",
        "/api/v1/holdings",
        "/api/v1/prices",
        "/oauth2/token",
        "/api/v1/accounts",
        "/api/v1/holdings",
        "/api/v1/prices",
      ],
    );
    assert.deepEqual(calls.filter((call) => call.path === "/oauth2/token").map((call) => call.clientId), [
      "mock-client-a",
      "mock-client-b",
    ]);
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(envSnapshot)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    clearRuntimeState();
  }
});

test("Toss investment status endpoint coalesces concurrent forced refreshes", async () => {
  const envSnapshot = {
    TOSSINVEST_BASE_URL: process.env.TOSSINVEST_BASE_URL,
    TOSSINVEST_CLIENT_ID: process.env.TOSSINVEST_CLIENT_ID,
    TOSSINVEST_CLIENT_SECRET: process.env.TOSSINVEST_CLIENT_SECRET,
    TOSS_INVEST_CLIENT_ID: process.env.TOSS_INVEST_CLIENT_ID,
    TOSS_INVEST_CLIENT_SECRET: process.env.TOSS_INVEST_CLIENT_SECRET,
  };
  const originalFetch = globalThis.fetch;
  const calls = [];

  clearRuntimeState();
  process.env.TOSSINVEST_BASE_URL = "https://mock.tossinvest.test";
  process.env.TOSSINVEST_CLIENT_ID = "mock-client-id";
  process.env.TOSSINVEST_CLIENT_SECRET = "mock-client-secret";
  delete process.env.TOSS_INVEST_CLIENT_ID;
  delete process.env.TOSS_INVEST_CLIENT_SECRET;

  globalThis.fetch = async (url, options = {}) => {
    const target = new URL(String(url));
    const headers = options.headers || {};
    calls.push({
      method: options.method || "GET",
      path: target.pathname,
      search: target.search,
      accountSeq: headers["X-Tossinvest-Account"] || headers["x-tossinvest-account"] || "",
    });

    await new Promise((resolveDelay) => setTimeout(resolveDelay, target.pathname === "/oauth2/token" ? 5 : 25));

    if (target.pathname === "/oauth2/token") {
      return jsonResponse({ access_token: "forced-refresh-token", token_type: "Bearer", expires_in: 300 });
    }
    if (target.pathname === "/api/v1/accounts") {
      return jsonResponse({ result: [{ accountNo: "111122223333", accountSeq: "11", accountType: "BROKERAGE" }] });
    }
    if (target.pathname === "/api/v1/holdings") {
      return jsonResponse({
        result: {
          totalPurchaseAmount: { krw: "100000", usd: "0" },
          marketValue: { amount: { krw: "102000", usd: "0" }, amountAfterCost: { krw: "101900", usd: "0" } },
          profitLoss: { amount: { krw: "2000", usd: "0" }, amountAfterCost: { krw: "1900", usd: "0" }, rateAfterCost: "0.019" },
          dailyProfitLoss: { amount: { krw: "700", usd: "0" }, rate: "0.0069" },
          items: [
            {
              symbol: "005930",
              name: "삼성전자",
              marketCountry: "KR",
              currency: "KRW",
              quantity: "1",
              lastPrice: "101900",
              averagePurchasePrice: "100000",
              marketValue: { purchaseAmount: "100000", amount: "102000", amountAfterCost: "101900" },
              profitLoss: { amount: "2000", amountAfterCost: "1900", rateAfterCost: "0.019" },
              dailyProfitLoss: { amount: "700", rate: "0.0069" },
              cost: { commission: "100", tax: null },
            },
          ],
        },
      });
    }
    if (target.pathname === "/api/v1/prices") {
      return jsonResponse({
        result: [{ symbol: "005930", lastPrice: "102300", currency: "KRW", timestamp: "2026-07-09T09:11:00+09:00" }],
      });
    }
    return jsonResponse({ error: { message: `unexpected ${target.pathname}` } }, { status: 404 });
  };

  try {
    const [first, second] = await Promise.all([
      callTossInvestEndpoint(
        "investment-status",
        "/api/tossinvest/investment-status?currency=KRW&accountSeq=11&force=1",
      ),
      callTossInvestEndpoint(
        "investment-status",
        "/api/tossinvest/investment-status?currency=KRW&accountSeq=11&force=1",
      ),
    ]);

    assert.equal(first.statusCode, 200);
    assert.equal(second.statusCode, 200);
    assert.equal(first.body.cached, false);
    assert.equal(second.body.cached, false);
    assert.equal(first.body.totalValue, second.body.totalValue);
    assert.deepEqual(
      calls.map((call) => call.path),
      ["/oauth2/token", "/api/v1/accounts", "/api/v1/holdings", "/api/v1/prices"],
    );
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(envSnapshot)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    clearRuntimeState();
  }
});

test("Toss investment status endpoint chunks large price requests by 200 symbols", async () => {
  const envSnapshot = {
    TOSSINVEST_BASE_URL: process.env.TOSSINVEST_BASE_URL,
    TOSSINVEST_CLIENT_ID: process.env.TOSSINVEST_CLIENT_ID,
    TOSSINVEST_CLIENT_SECRET: process.env.TOSSINVEST_CLIENT_SECRET,
    TOSS_INVEST_CLIENT_ID: process.env.TOSS_INVEST_CLIENT_ID,
    TOSS_INVEST_CLIENT_SECRET: process.env.TOSS_INVEST_CLIENT_SECRET,
  };
  const originalFetch = globalThis.fetch;
  const calls = [];
  const holdingsItems = Array.from({ length: 401 }, (_, index) => {
    const symbol = `T${String(index + 1).padStart(4, "0")}`;
    return {
      symbol,
      name: `Test ${index + 1}`,
      marketCountry: "US",
      currency: "USD",
      quantity: "1",
      lastPrice: "10",
      averagePurchasePrice: "9",
      marketValue: { purchaseAmount: "9", amount: "10", amountAfterCost: "10" },
      profitLoss: { amount: "1", amountAfterCost: "1", rateAfterCost: "0.1111" },
      dailyProfitLoss: { amount: "0.1", rate: "0.01" },
      cost: { commission: "0", tax: null },
    };
  });

  clearRuntimeState();
  process.env.TOSSINVEST_BASE_URL = "https://mock.tossinvest.test";
  process.env.TOSSINVEST_CLIENT_ID = "mock-client-id";
  process.env.TOSSINVEST_CLIENT_SECRET = "mock-client-secret";
  delete process.env.TOSS_INVEST_CLIENT_ID;
  delete process.env.TOSS_INVEST_CLIENT_SECRET;

  globalThis.fetch = async (url, options = {}) => {
    const target = new URL(String(url));
    const headers = options.headers || {};
    calls.push({
      method: options.method || "GET",
      path: target.pathname,
      symbols: target.searchParams.get("symbols") || "",
      accountSeq: headers["X-Tossinvest-Account"] || headers["x-tossinvest-account"] || "",
    });

    if (target.pathname === "/oauth2/token") {
      return jsonResponse({ access_token: "chunk-token", token_type: "Bearer", expires_in: 300 });
    }
    if (target.pathname === "/api/v1/accounts") {
      return jsonResponse({ result: [{ accountNo: "111122223333", accountSeq: "11", accountType: "BROKERAGE" }] });
    }
    if (target.pathname === "/api/v1/holdings") {
      assert.equal(headers["X-Tossinvest-Account"] || headers["x-tossinvest-account"] || "", "11");
      return jsonResponse({
        result: {
          totalPurchaseAmount: { krw: "0", usd: "3609" },
          marketValue: { amount: { krw: "0", usd: "4010" }, amountAfterCost: { krw: "0", usd: "4010" } },
          profitLoss: { amount: { krw: "0", usd: "401" }, amountAfterCost: { krw: "0", usd: "401" }, rateAfterCost: "0.1111" },
          dailyProfitLoss: { amount: { krw: "0", usd: "40.1" }, rate: "0.01" },
          items: holdingsItems,
        },
      });
    }
    if (target.pathname === "/api/v1/prices") {
      const symbols = target.searchParams.get("symbols").split(",");
      return jsonResponse({
        result: symbols.map((symbol, index) => ({
          symbol,
          lastPrice: String(10 + index / 100),
          currency: "USD",
          timestamp: "2026-07-09T09:12:00+09:00",
        })),
      });
    }
    return jsonResponse({ error: { message: `unexpected ${target.pathname}` } }, { status: 404 });
  };

  try {
    const response = await callTossInvestEndpoint(
      "investment-status",
      "/api/tossinvest/investment-status?currency=USD&accountSeq=11&force=1",
    );
    const priceCalls = calls.filter((call) => call.path === "/api/v1/prices");
    const priceChunkSizes = priceCalls.map((call) => call.symbols.split(",").filter(Boolean).length);

    assert.equal(response.statusCode, 200);
    assert.equal(response.body.ok, true);
    assert.equal(response.body.items.length, 401);
    assert.equal(response.body.requestSummary.prices, 3);
    assert.deepEqual(priceChunkSizes, [200, 200, 1]);
    assert.deepEqual(priceCalls.map((call) => call.symbols.split(",")[0]), ["T0001", "T0201", "T0401"]);
    assert.equal(calls.some((call) => call.path === "/api/v1/exchange-rate"), false);
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(envSnapshot)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    clearRuntimeState();
  }
});

test("transaction status view reads the live Toss API endpoint and does not expose snapshot internals", () => {
  const source = readFileSync(
    resolve(TEST_DIR, "../src/transactions/TransactionStatusView.jsx"),
    "utf8",
  );
  const portfolioStatusSource = readFileSync(
    resolve(TEST_DIR, "../src/portfolio/PortfolioWorkspaceHeader.jsx"),
    "utf8",
  );
  const serverSource = readFileSync(resolve(TEST_DIR, "../server/tossInvestApi.mjs"), "utf8");
  const standaloneServerSource = readFileSync(resolve(TEST_DIR, "../server/server.mjs"), "utf8");
  const viteServerSource = readFileSync(resolve(TEST_DIR, "../server/viteCodexApi.mjs"), "utf8");
  const transactionSettingsSource = readFileSync(resolve(TEST_DIR, "../server/transactionSettings.mjs"), "utf8");
  const transactionDefaultsSource = readFileSync(resolve(TEST_DIR, "../../config/transaction-status.defaults.json"), "utf8");
  const stylesSource = readFileSync(resolve(TEST_DIR, "../src/styles.css"), "utf8");

  assert.match(source, /\/api\/tossinvest\/investment-status/);
  assert.match(standaloneServerSource, /\/api\/tossinvest\/investment-status/);
  assert.match(standaloneServerSource, /handleTossInvestEndpoint\("investment-status", req, res\)/);
  assert.match(viteServerSource, /\/api\/tossinvest\/investment-status/);
  assert.match(viteServerSource, /handleTossInvestEndpoint\("investment-status", req, res\)/);
  assert.match(source, /PortfolioTossApiStatus/);
  assert.match(source, /showOrderSyncSummary: false/);
  assert.match(source, /autoProbeConnection: false/);
  assert.match(source, /onProbeConnection: handleReload/);
  assert.doesNotMatch(source, /onProbeConnection: onProbeConnection \|\| handleReload/);
  assert.match(portfolioStatusSource, /저장소 잠겨있음/);
  assert.match(portfolioStatusSource, /설정에서 저장소 패스워드로 잠금 해제/);
  assert.match(portfolioStatusSource, /autoProbeConnection = true/);
  assert.match(portfolioStatusSource, /autoProbeConnection && statusView\.tone === "pending"/);
  assert.match(portfolioStatusSource, /if \(!autoProbeConnection \|\| statusView\.tone !== "pending" \|\| visibleError\)/);
  assert.match(portfolioStatusSource, /manualProbeAction \|\| refreshConnectionAction/);
  assert.match(portfolioStatusSource, /tossApiCredentialDiscardErrorCode/);
  assert.match(portfolioStatusSource, /toss_client_id_auth/);
  assert.match(portfolioStatusSource, /toss_client_secret_auth/);
  assert.match(portfolioStatusSource, /toss_client_auth/);
  assert.match(portfolioStatusSource, /statusView\.tone === "failed" && !credentialDiscardAction/);
  assert.match(portfolioStatusSource, /showOrderSyncSummary && connected/);
  assert.match(source, /visibilitychange/);
  assert.match(source, /visibilityState !== "hidden"/);
  assert.match(source, /pageVisible/);
  assert.match(source, /activeSection !== "investment"/);
  assert.match(source, /Math\.max\(1_000, Math\.min\(300_000/);
  assert.match(source, /payload\?\.refresh\?\.recommendedIntervalMs \|\| 1_000/);
  assert.match(source, /refreshSettledKey/);
  assert.match(source, /setRefreshSettledKey\(\(current\) => current \+ 1\)/);
  assert.match(source, /retryAfterMsFromRateLimit/);
  assert.match(source, /responseError\.retryAfterMs = retryAfterMsFromRateLimit\(body\?\.rateLimit\)/);
  assert.match(source, /setLiveRetryAfterMs\(Math\.max\(0, Number\(fetchError\.retryAfterMs \|\| 0\)\)\)/);
  assert.match(source, /Math\.min\(300_000, Math\.max\(recommendedIntervalMs, liveRetryAfterMs \|\| 0\)\)/);
  assert.match(serverSource, /function retryAfterMsFromRateLimit\(rateLimit = null\)/);
  assert.match(serverSource, /recommendedIntervalMs: Math\.max\(LIVE_INVESTMENT_STATUS_REFRESH_MS, retryAfterMs\)/);
  assert.match(serverSource, /retryAfterMs,/);
  assert.match(serverSource, /LIVE_INVESTMENT_STATUS_RETRY_OPTIONS = \{ retries: 1, retryRateLimited: false \}/);
  assert.match(serverSource, /retryRateLimited = true/);
  assert.match(source, /liveRefreshBusy/);
  assert.match(source, /liveFetchGate\.ready && liveRefreshBusyRef\.current/);
  assert.match(source, /hasCurrentPayload/);
  assert.match(source, /loading && !payload/);
  assert.match(source, /key=\{`transaction-side-\$\{item\.currency\}-\$\{item\.symbol\}`\}/);
  assert.match(source, /key=\{`transaction-table-\$\{item\.currency\}-\$\{item\.symbol\}`\}/);
  assert.match(source, /function itemMarketCountry\(item = \{\}\)/);
  assert.match(source, /marketCountry && marketCountry !== "KR"/);
  assert.match(source, /itemMarketCountry\(item\) === "KR"/);
  assert.match(source, /Filter from "lucide-react\/dist\/esm\/icons\/filter\.js"/);
  assert.match(source, /GripVertical from "lucide-react\/dist\/esm\/icons\/grip-vertical\.js"/);
  assert.match(source, /const transactionMainTableColumns = \[/);
  assert.match(source, /mainTableColumns: \[\]/);
  assert.match(source, /sidebarManualOrder: \[\]/);
  assert.match(source, /fixedTransactionMainTableColumnId = "ticker"/);
  assert.match(source, /transactionSelectableMainTableColumns/);
  assert.match(source, /normalizeTransactionSidebarManualOrderSetting/);
  assert.match(source, /syncTransactionSidebarManualOrder/);
  assert.match(source, /reorderTransactionSidebarManualOrder/);
  assert.match(source, /function TransactionColumnFilter\(/);
  assert.match(source, /normalizedColumnIds\.length/);
  assert.match(source, /기본 표 열만 표시/);
  assert.match(source, /visibleTransactionMainTableColumns\(selectedColumnIds\)/);
  assert.match(source, /onSelect\(option\.id\)/);
  assert.match(source, /sortId === "custom"/);
  assert.match(source, /manualOrderEditing/);
  assert.match(source, /manualOrderDraft/);
  assert.match(source, /transaction-manual-order-actions/);
  assert.match(source, /수동 정렬 편집/);
  assert.match(source, /저장/);
  assert.match(source, /취소/);
  assert.match(source, /transaction-side-drag-handle/);
  assert.match(source, /transaction-side-drag-preview/);
  assert.match(source, /dragPreview/);
  assert.match(source, /dragInsertPlacement/);
  assert.match(source, /is-drop-\$\{dragInsertPlacement\}/);
  assert.match(source, /elementFromPoint/);
  assert.match(stylesSource, /is-drop-before/);
  assert.match(stylesSource, /is-drop-after/);
  assert.match(stylesSource, /margin 180ms cubic-bezier/);
  assert.doesNotMatch(stylesSource, /is-drag-over/);
  assert.doesNotMatch(stylesSource, /#b7d2ff/);
  assert.match(source, /transactionSidebarPositionView/);
  assert.match(source, /onPointerDown/);
  assert.match(source, /onPointerMove/);
  assert.match(source, /onMouseDown/);
  assert.match(source, /onMouseMove/);
  assert.match(source, /handleManualOrderSave/);
  assert.match(source, /handleManualOrderCancel/);
  assert.match(source, /setManualOrderEditing\(false\)/);
  assert.match(source, /saveTransactionCurrencySettings\(\{ sidebarManualOrder: normalizedOrder \}\)/);
  assert.match(source, /해외주식 \{overseasCount\}개/);
  assert.match(source, /국내주식 \{domesticCount\}개/);
  assert.doesNotMatch(source, /숨긴 종목/);
  assert.match(source, /label: "티커 \/ 종목번호"/);
  assert.match(source, /className: "transaction-table-ticker"/);
  assert.match(source, /className: "transaction-table-name"/);
  assert.match(source, /mainTableColumns: normalizedColumnIds/);
  assert.match(transactionSettingsSource, /mainTableColumns: \[\]/);
  assert.match(transactionSettingsSource, /sidebarManualOrder: \[\]/);
  assert.match(transactionSettingsSource, /normalizeTransactionSidebarManualOrder/);
  assert.match(transactionSettingsSource, /sidebarManualOrder/);
  assert.match(transactionSettingsSource, /MAIN_TABLE_COLUMN_IDS/);
  assert.match(transactionSettingsSource, /normalizeTransactionMainTableColumns/);
  assert.doesNotMatch(transactionSettingsSource, /"ticker",/);
  assert.match(transactionSettingsSource, /mainTableColumns, sidebarManualOrder, or watchlistGroups is required/);
  assert.match(transactionDefaultsSource, /"mainTableColumns": \[\s*\]/);
  assert.match(transactionDefaultsSource, /"sidebarManualOrder": \[\s*\]/);
  assert.match(source, /statusForBanner/);
  assert.match(source, /if \(credentials\.locked \|\| credentials\.invalid\) return tossStatus/);
  assert.match(source, /sectionHasLivePayload/);
  assert.match(source, /activeSection === "watchlist"\s*\?\s*Boolean\(watchlistPricePayload\?\.ok\)/);
  assert.match(source, /sectionError \|\| !sectionHasLivePayload/);
  assert.match(source, /connected: true/);
  assert.match(source, /statusBannerError = sectionError \|\| currencySettingsError \|\| tossError/);
  assert.match(source, /liveErrorCode/);
  assert.match(source, /watchlistPriceErrorCode/);
  assert.match(source, /responseError\.errorCode = body\?\.errorCode \|\| ""/);
  assert.match(source, /setLiveErrorCode\(fetchError\.errorCode \|\| ""\)/);
  assert.match(source, /statusBannerErrorCode = sectionError \? sectionErrorCode : statusBannerError \? tossErrorCode : ""/);
  assert.match(source, /fetchTransactionWatchlistPrices/);
  assert.match(source, /\/api\/tossinvest\/prices\?symbols=/);
  assert.match(source, /\/api\/tossinvest\/candles\?\$\{params\.toString\(\)\}/);
  assert.match(source, /new URLSearchParams\(\{\s*symbol,\s*interval: "1d",\s*count: String\(transactionWatchlistCandlePageSize\),\s*adjusted: "true"/);
  assert.match(source, /transactionWatchlistCandlePageSize = 200/);
  assert.match(source, /payload\?\.result\?\.candles/);
  assert.match(source, /price\?\.\[column\.hasField\]/);
  assert.match(source, /hasWeeklyReturn/);
  assert.match(source, /hasMonthlyReturn/);
  assert.match(source, /hasSixMonthReturn/);
  assert.match(source, /weeklyReturnPercent/);
  assert.match(source, /monthlyReturnPercent/);
  assert.match(source, /sixMonthReturnPercent/);
  assert.match(source, /주간 수익률/);
  assert.match(source, /월간 수익률/);
  assert.match(source, /6개월 수익률/);
  assert.doesNotMatch(source, /연간 수익률/);
  assert.doesNotMatch(source, /yearlyReturnPercent/);
  assert.match(source, /hasValue \? formatSignedPercent\(value\) : "-"/);
  assert.match(source, /activeSection !== "watchlist"/);
  assert.match(source, /transactionWatchlistPriceRefreshMs = 1_000/);
  assert.match(source, /<span>종목 추가하기<\/span>/);
  assert.match(source, /watchlistRenameGroupId/);
  assert.match(source, /watchlistRenamePlacement/);
  assert.match(source, /handleRequestWatchlistGroupRename/);
  assert.match(source, /transaction-watchlist-rename-form/);
  assert.match(source, /transaction-watchlist-title-rename-form/);
  assert.match(source, /onRequestRenameGroup\(groupId, "sidebar"\)/);
  assert.match(source, /onRequestRenameGroup\(selectedGroup\.id, "main"\)/);
  assert.match(source, /void saveTransactionCurrencySettings\(\{ watchlistGroups: nextGroups \}\)/);
  assert.match(source, /reorderTransactionWatchlistSymbols/);
  assert.match(source, /watchlistSymbolOrderEditing/);
  assert.match(source, /watchlistSymbolOrderDraft/);
  assert.match(source, /handleWatchlistSymbolOrderSave/);
  assert.match(source, /transaction-watchlist-stock-order-button/);
  assert.match(source, /transaction-watchlist-symbol-drag-handle/);
  assert.match(source, /순서 바꾸기/);
  assert.match(source, /순서 저장/);
  assert.match(source, /formatOptionalMoney/);
  assert.match(source, /formatOptionalPerformance/);
  assert.match(source, /hasPayload = Boolean\(payload\?\.ok\)/);
  assert.doesNotMatch(source, /\/api\/tossinvest\/order-sync\/position-status/);
  assert.doesNotMatch(source, /position_snapshots/);
  assert.doesNotMatch(source, /스냅샷 로딩/);
});
