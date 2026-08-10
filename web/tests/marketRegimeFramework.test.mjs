import test from "node:test";
import assert from "node:assert/strict";

import { buildMarketRegimeFramework } from "../server/pbDailyIntelligenceApi.mjs";

test("market framework preserves the configured seven-step decision order", () => {
  const framework = buildMarketRegimeFramework({
    intelligence: {
      market: {
        official_calendar: { collection_status: "complete" },
        upcoming_events: [{
          event_id: "cpi",
          date: "2026-08-12",
          title: "Consumer Price Index",
          source_url: "https://www.bls.gov/schedule/",
          primary_source_confirmed: true,
        }],
      },
    },
    scoreboard: {
      cards: [
        { id: "nominal-2y", value: 3.5 },
        { id: "nominal-10y", value: 4.1 },
        { id: "real-10y", value: 1.8 },
        { id: "curve-2s10s", value: 0.6 },
        { id: "credit", value: 3.2 },
      ],
      regime: { label: "mixed", summary: "방향 엇갈림", quantitativeEvidence: ["a", "b"] },
    },
    marketInternals: {
      status: "ready",
      coverage: { available: 19, required: 19 },
      sectors: { "5d": [{ ticker: "XLK" }] },
    },
    report: {
      koreaConnection: { status: "ready", summary: "한국시장 전파 확인", metrics: [] },
    },
  });

  assert.deepEqual(framework.stages.map((stage) => stage.id), [
    "official_calendar",
    "rates_liquidity",
    "fx_commodities",
    "index_internals",
    "sector_leadership",
    "growth_inflation_regime",
    "korea_transmission",
  ]);
  assert.equal(framework.stages[0].status, "verified");
  assert.equal(framework.stages[0].data.events[0].authoritative, true);
  assert.equal(framework.stages[1].status, "verified");
  assert.equal(framework.stages[2].status, "insufficient");
});

test("calendar collection failure is not rendered as no events", () => {
  const framework = buildMarketRegimeFramework({
    intelligence: { market: { official_calendar: { collection_status: "collection_failed" } } },
  });
  const calendar = framework.stages[0];
  assert.equal(calendar.status, "collection_failed");
  assert.match(calendar.summary, /이벤트 없음으로 간주하지 않습니다/);
});
