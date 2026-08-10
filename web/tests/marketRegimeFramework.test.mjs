import test from "node:test";
import assert from "node:assert/strict";

import { buildMarketRegimeFramework } from "../server/pbDailyIntelligenceApi.mjs";

test("market framework preserves the macro-first nine-step decision order", () => {
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
    "growth_inflation_regime",
    "earnings_cycle",
    "rates_liquidity",
    "fx_commodities",
    "volatility_positioning",
    "index_internals",
    "sector_leadership",
    "korea_transmission",
  ]);
  assert.equal(framework.completeness.total, 9);
  assert.equal(framework.stages[0].status, "verified");
  assert.equal(framework.stages[0].data.events[0].authoritative, true);
  assert.equal(framework.stages.find((stage) => stage.id === "rates_liquidity").status, "verified");
  assert.equal(framework.stages.find((stage) => stage.id === "fx_commodities").status, "insufficient");
  assert.equal(framework.stages.find((stage) => stage.id === "volatility_positioning").status, "insufficient");
  assert.equal(framework.stages.find((stage) => stage.id === "index_internals").status, "insufficient");
  const macroRegime = framework.stages.find((stage) => stage.id === "growth_inflation_regime");
  assert.equal(macroRegime.status, "insufficient");
  assert.equal(macroRegime.data.marketRiskRegime.label, "mixed");
  assert.match(macroRegime.data.evidenceBoundary, /가격 자료만으로/);
});

test("each stage exposes its own date and warns when inputs are misaligned", () => {
  const framework = buildMarketRegimeFramework({
    scoreboard: {
      cards: [
        { id: "nominal-2y", value: 3.5, asOf: "2026-08-07" },
        { id: "nominal-10y", value: 4.1, asOf: "2026-08-06" },
        { id: "real-10y", value: 1.8, asOf: "2026-08-06" },
        { id: "curve-2s10s", value: 0.6, asOf: "2026-08-07" },
        { id: "credit", value: 3.2, asOf: "2026-08-06" },
      ],
    },
  });
  const rates = framework.stages.find((stage) => stage.id === "rates_liquidity");

  assert.equal(rates.asOf, "2026-08-07");
  assert.deepEqual(rates.dataDates, ["2026-08-06", "2026-08-07"]);
  assert.equal(rates.dateAlignment, "mixed_dates");
});

test("growth and inflation regime requires authoritative evidence on both axes", () => {
  const framework = buildMarketRegimeFramework({
    intelligence: {
      market: {
        growth_inflation_regime: {
          growth_direction: "slowing",
          inflation_direction: "rising",
          quadrant: "stagflation_pressure",
          summary: "성장 둔화와 물가 상승 압력이 함께 확인됩니다.",
          evidence: [{
            axis: "growth",
            observation: "비농업 고용 증가세 둔화",
            source_type: "BLS",
            primary_source_confirmed: true,
          }, {
            axis: "inflation",
            observation: "CPI 전년 대비 상승률 반등",
            source_type: "BLS",
            primary_source_confirmed: true,
          }],
        },
      },
    },
    scoreboard: { regime: { label: "risk_off", quantitativeEvidence: ["VIX", "RSP/SPY"] } },
  });
  const macroRegime = framework.stages.find((stage) => stage.id === "growth_inflation_regime");

  assert.equal(macroRegime.status, "verified");
  assert.equal(macroRegime.data.authoritativeGrowthEvidenceCount, 1);
  assert.equal(macroRegime.data.authoritativeInflationEvidenceCount, 1);
  assert.equal(macroRegime.data.marketRiskRegime.label, "risk_off");
});

test("calendar collection failure is not rendered as no events", () => {
  const framework = buildMarketRegimeFramework({
    intelligence: { market: { official_calendar: { collection_status: "collection_failed" } } },
  });
  const calendar = framework.stages[0];
  assert.equal(calendar.status, "collection_failed");
  assert.match(calendar.summary, /이벤트 없음으로 간주하지 않습니다/);
});
