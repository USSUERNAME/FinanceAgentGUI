import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const testDir = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(testDir, "..", "..");

function readJson(relativePath) {
  return JSON.parse(readFileSync(resolve(rootDir, relativePath), "utf8"));
}

function readText(relativePath) {
  return readFileSync(resolve(rootDir, relativePath), "utf8");
}

test("stock framework separates trust grade, completeness, and horizon readiness", () => {
  const framework = readJson("config/stock-analysis-framework.json");
  const allowedRoles = new Set(["gate", "display", "context", "horizon_gate"]);
  const expectedStatuses = [
    "verified",
    "insufficient",
    "accumulating",
    "collection_failed",
    "stale",
  ];

  assert.equal(framework.schemaVersion, "stock_analysis_framework.v1");
  assert.equal(framework.rollout.separateTabAllowed, false);
  assert.equal(framework.rollout.newGateActivation, "simulation_required");
  assert.equal(framework.stages.length, 8);
  assert.equal(new Set(framework.stages.map((stage) => stage.id)).size, 8);
  assert.equal(framework.decisions.completeness.changesResearchGrade, false);
  assert.equal(framework.decisions.tradeHorizon.changesResearchGradeWhenMissing, false);
  assert.equal(framework.decisions.missingData.prohibitEstimatedFill, true);
  assert.equal(framework.decisions.missingData.missingNeverPassesGate, true);
  assert.deepEqual(framework.decisions.missingData.allowedStatuses, expectedStatuses);
  assert.ok(framework.decisions.researchGrade.coreGateIds.includes("authoritative_source"));
  assert.ok(framework.decisions.researchGrade.coreGateIds.includes("trade_suitability"));

  const stageIds = new Set(framework.stages.map((stage) => stage.id));
  for (const stage of framework.stages) {
    assert.ok(stage.fields.length > 0, `${stage.id} must declare fields`);
    for (const field of stage.fields) {
      assert.ok(allowedRoles.has(field.role), `${stage.id}.${field.id} has an invalid role`);
      assert.ok(field.sourceTypes.length > 0, `${stage.id}.${field.id} must declare sources`);
    }
  }
  for (const requirements of Object.values(framework.horizonRequirements)) {
    for (const stageId of requirements) assert.ok(stageIds.has(stageId));
  }
});

test("market framework fixes the top-down order and never fills failed data", () => {
  const framework = readJson("config/market-regime-framework.json");
  const expectedOrder = [
    "official_calendar",
    "growth_inflation_regime",
    "earnings_cycle",
    "rates_liquidity",
    "fx_commodities",
    "volatility_positioning",
    "index_internals",
    "sector_leadership",
    "korea_transmission",
  ];

  assert.equal(framework.schemaVersion, "market_regime_framework.v1");
  assert.deepEqual(framework.decisionOrder, expectedOrder);
  assert.deepEqual(framework.stages.map((stage) => stage.id), expectedOrder);
  assert.equal(framework.missingData.prohibitEstimatedFill, true);
  assert.ok(framework.missingData.allowedStatuses.includes("collection_failed"));
});

test("framework documents preserve missing-data and provider boundaries", () => {
  const stockDoc = readText("docs/stock-analysis-framework.md");
  const marketDoc = readText("docs/market-regime-framework.md");
  const availabilityDoc = readText("docs/stock-analysis-data-availability.md");

  for (const phrase of ["리서치 신뢰등급", "분석 완성도", "매매 준비도", "tradeHorizon", "수집 실패"]) {
    assert.match(stockDoc, new RegExp(phrase));
  }
  assert.match(marketDoc, /경제지표 → 금리·환율·원자재/);
  assert.match(marketDoc, /수집 실패/);
  assert.match(availabilityDoc, /verified_full_consensus/);
  assert.match(availabilityDoc, /licensed_options_data/);
  assert.match(availabilityDoc, /추정하지/);
});
