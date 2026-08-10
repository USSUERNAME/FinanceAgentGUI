import test from "node:test";
import assert from "node:assert/strict";
import {
  candidatePerformanceSnapshot,
  emptyCandidatePerformanceStore,
  reviewCandidatePerformanceStore,
  syncCandidatePerformanceStore,
  updateCandidateTradePlanStore,
} from "../server/stockCandidatePerformance.mjs";

test("candidate performance keeps the first registration price and measures reached horizons", () => {
  let store = syncCandidatePerformanceStore(emptyCandidatePerformanceStore(), [{
    ticker: "ABNB",
    companyName: "Airbnb",
    grade: "B",
    asOf: "2026-08-10",
    close: 180,
    benchmarkReturn1d: 0.5,
  }], new Date("2026-08-10T10:00:00Z"));
  store = syncCandidatePerformanceStore(store, [{
    ticker: "ABNB",
    companyName: "Airbnb",
    grade: "B",
    asOf: "2026-08-18",
    close: 198,
    benchmarkReturn1d: 1,
  }], new Date("2026-08-18T10:00:00Z"));

  const record = candidatePerformanceSnapshot(store).records[0];
  assert.equal(record.registeredPrice, 180);
  assert.equal(record.observationCount, 2);
  assert.equal(record.horizons[0].status, "measured");
  assert.equal(record.horizons[0].returnPct, 10);
  assert.equal(record.horizons[1].status, "pending");
});

test("trade plan is stored with thesis rules and snapshotted into review history", () => {
  let store = syncCandidatePerformanceStore(emptyCandidatePerformanceStore(), [{
    ticker: "ABNB",
    asOf: "2026-08-10",
    close: 180,
    thesisReason: "공식 실적에서 성장과 현금흐름을 확인",
    invalidationConditions: ["FCF 마진이 훼손되면 가설 폐기"],
  }], new Date("2026-08-10T10:00:00Z"));
  store = updateCandidateTradePlanStore(store, "ABNB", {
    tradeHorizon: "position",
    thesisReason: "공식 실적 개선 때문에 관찰",
    entryCondition: "실적 갭을 지지하면 진입",
    addCondition: "가이던스 상향이면 추가 검토",
    exitCondition: "FCF 마진 훼손이면 정리",
    maxLossPct: 5,
    positionSizePct: 3,
  }, new Date("2026-08-10T11:00:00Z"));
  store = reviewCandidatePerformanceStore(
    store,
    "ABNB",
    "invalidated",
    "정리 조건 확인",
    new Date("2026-08-18T10:00:00Z"),
  );

  const record = store.records[0];
  assert.equal(record.tradePlan.readiness.ready, true);
  assert.equal(record.tradePlan.tradeHorizon, "position");
  assert.equal(record.reviewHistory.length, 1);
  assert.equal(record.reviewHistory[0].thesisStatus, "invalidated");
  assert.equal(record.reviewHistory[0].tradePlanSnapshot.exitCondition, "FCF 마진 훼손이면 정리");
  assert.deepEqual(record.invalidationConditionsAtRegistration, ["FCF 마진이 훼손되면 가설 폐기"]);
});

test("trade plan rejects invalid risk percentages", () => {
  const store = syncCandidatePerformanceStore(emptyCandidatePerformanceStore(), [{
    ticker: "TTD", asOf: "2026-08-10", close: 14,
  }], new Date("2026-08-10T10:00:00Z"));
  assert.throws(
    () => updateCandidateTradePlanStore(store, "TTD", {
      tradeHorizon: "day",
      maxLossPct: 120,
    }),
    /maxLossPct/,
  );
});

test("candidate performance leaves benchmark excess pending when comparison coverage is incomplete", () => {
  let store = syncCandidatePerformanceStore(emptyCandidatePerformanceStore(), [{
    ticker: "TTD", asOf: "2026-08-10", close: 14,
  }], new Date("2026-08-10T10:00:00Z"));
  store = syncCandidatePerformanceStore(store, [{
    ticker: "TTD", asOf: "2026-08-18", close: 12,
  }], new Date("2026-08-18T10:00:00Z"));
  const horizon = candidatePerformanceSnapshot(store).records[0].horizons[0];
  assert.equal(horizon.status, "measured");
  assert.equal(horizon.benchmarkReturnPct, null);
  assert.equal(horizon.excessReturnPct, null);
});

