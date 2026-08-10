import test from "node:test";
import assert from "node:assert/strict";
import {
  candidatePerformanceSnapshot,
  emptyCandidatePerformanceStore,
  syncCandidatePerformanceStore,
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

