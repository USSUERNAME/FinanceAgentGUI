import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import {
  buildTrackedInvestmentTheses,
  buildWeeklyThesisCalibration,
  readInvestmentThesisMemory,
  syncInvestmentThesisMemory,
  syncSelectedStockThesisMemory,
} from "../server/pbInvestmentThesisMemory.mjs";

const tempPath = join(
  process.cwd(),
  "data",
  ".test-pb-investment-thesis-memory",
  "ledger.json",
);
const env = { PB_INVESTMENT_THESIS_MEMORY_PATH: tempPath };

function chain({ priority = "B", sectorGate = "watch" } = {}) {
  return {
    status: "ready",
    sectors: [
      {
        ticker: "XLK",
        label: "기술",
        stance: "beneficiary",
        reason: "상대강세가 관측됐습니다.",
        evidence: ["5일 +2.10%", "SPY 대비 +1.20%p"],
        fundamentalGate: {
          status: sectorGate,
          estimateLabel: "30일 추정치 2건 상향 · 0건 하향",
          valuationLabel: "비교 가능 1건",
        },
      },
    ],
    candidates: [
      {
        ticker: "NVDA",
        companyName: "NVIDIA",
        researchPriority: priority,
        linkedSectorTicker: "XLK",
        linkedSectorLabel: "기술",
        whyNow: "시장 대비 비정상 상대수익",
        promotionCondition: "공식 촉매와 밸류에이션 확인",
        firstRejection: "XLK 상대강세가 꺾이면 재검토",
        evidenceSummary: "공식 근거 1건",
        fundamentalGateLabel: sectorGate === "supported" ? "펀더멘털 확인" : "추가 확인 필요",
      },
    ],
  };
}

test.afterEach(async () => {
  await rm(join(process.cwd(), "data", ".test-pb-investment-thesis-memory"), {
    recursive: true,
    force: true,
  });
});

test("PB thesis memory builds only bounded sector and displayed stock theses", () => {
  const rows = buildTrackedInvestmentTheses({
    decisionChain: chain(),
    reportDate: "2026-07-28",
  });
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((row) => row.continuityId), [
    "pb-sector-xlk",
    "pb-stock-nvda",
  ]);
  assert.equal(rows[1].state, "watching");
});

test("PB thesis memory is idempotent per date and records only real transitions", async () => {
  const first = await syncInvestmentThesisMemory({
    decisionChain: chain(),
    reportDate: "2026-07-28",
    env,
    now: () => "2026-07-28T08:00:00+09:00",
  });
  assert.equal(first.createdCount, 2);
  assert.equal(first.transitionCount, 0);

  const sameDay = await syncInvestmentThesisMemory({
    decisionChain: chain(),
    reportDate: "2026-07-28",
    env,
    now: () => "2026-07-28T08:05:00+09:00",
  });
  assert.equal(sameDay.createdCount, 0);
  assert.equal(sameDay.transitionCount, 0);
  assert.equal(
    sameDay.records.find((row) => row.entityId === "NVDA").observationCount,
    1,
  );

  const promoted = await syncInvestmentThesisMemory({
    decisionChain: chain({ priority: "A", sectorGate: "supported" }),
    reportDate: "2026-07-29",
    env,
    now: () => "2026-07-29T08:00:00+09:00",
  });
  assert.equal(promoted.transitionCount, 2);
  const stock = promoted.records.find((row) => row.entityId === "NVDA");
  assert.equal(stock.state, "confirmed");
  assert.equal(stock.priority, "A");
  assert.equal(stock.observationCount, 2);
  assert.equal(stock.observations.length, 2);
  assert.equal(stock.history.length, 2);
  assert.deepEqual(stock.history[1], {
    at: "2026-07-29",
    fromState: "watching",
    toState: "confirmed",
    fromPriority: "B",
    toPriority: "A",
    reason: "공식 근거 1건",
  });

  const stored = await readInvestmentThesisMemory({ env });
  assert.equal(stored.lastSyncedReportDate, "2026-07-29");
  assert.equal(stored.recordCount, 2);
});

test("PB thesis memory stores only an eligible selected stock and dedupes by ticker", async () => {
  const candidate = {
    ticker: "NVDA",
    companyName: "NVIDIA",
    status: "qualified",
    researchPriority: "A",
    linkedSectorTicker: "XLK",
    linkedSectorLabel: "기술",
    whyNow: "공식 실적 촉매와 추정치 상향",
    evidenceSummary: "공식 근거 2건 · 확인 사실 4개",
    fundamentalGateStatus: "supported",
    researchProfile: {
      confirmationCondition: "추정치 상향과 섹터 상대강세 유지",
      invalidationCondition: "추정치 하향 또는 섹터 상대강세 반전",
    },
  };
  const first = await syncSelectedStockThesisMemory({
    candidate,
    reportDate: "2026-07-29",
    env,
    now: () => "2026-07-29T09:00:00+09:00",
  });
  assert.equal(first.createdCount, 1);
  assert.equal(first.recordCount, 1);
  assert.equal(first.records[0].continuityId, "pb-stock-nvda");
  assert.equal(first.records[0].state, "confirmed");
  assert.equal(
    first.records[0].confirmationCondition,
    "추정치 상향과 섹터 상대강세 유지",
  );

  const repeated = await syncSelectedStockThesisMemory({
    candidate,
    reportDate: "2026-07-29",
    env,
    now: () => "2026-07-29T09:05:00+09:00",
  });
  assert.equal(repeated.createdCount, 0);
  assert.equal(repeated.recordCount, 1);
  assert.equal(repeated.records[0].observationCount, 1);

  await assert.rejects(
    syncSelectedStockThesisMemory({
      candidate: { ...candidate, ticker: "CAT", status: "hold" },
      reportDate: "2026-07-29",
      env,
    }),
    /심층검토 또는 근거보강/,
  );
});

test("PB thesis memory keeps evaluating a selected stock from the full candidate pool", async () => {
  const baseCandidate = {
    ticker: "NVDA",
    companyName: "NVIDIA",
    status: "research",
    researchPriority: "B",
    linkedSectorTicker: "XLK",
    linkedSectorLabel: "기술",
    whyNow: "공식 촉매 확인",
    evidenceSummary: "공식 근거 1건",
    fundamentalGateLabel: "추가 확인 필요",
    stockVsSector5d: 0.8,
    estimateRevision: { revisionDirection: "positive_revision" },
    researchProfile: {
      confirmationCondition: "섹터 대비 상대강세 유지",
      invalidationCondition: "추정치 하향 또는 상대강세 반전",
    },
  };
  await syncSelectedStockThesisMemory({
    candidate: baseCandidate,
    reportDate: "2026-07-28",
    env,
  });

  const second = await syncInvestmentThesisMemory({
    decisionChain: {
      status: "ready",
      sectors: [],
      candidates: [],
      ideaFunnel: {
        candidatePool: [{
          ...baseCandidate,
          status: undefined,
          stockVsSector5d: 1.2,
        }],
      },
    },
    reportDate: "2026-07-29",
    env,
  });
  const tracked = second.records.find((record) => record.entityId === "NVDA");
  assert.equal(tracked.observationCount, 2);
  assert.equal(tracked.metricId, "stock_vs_sector_5d_pct_point");
  assert.equal(tracked.metricValue, 1.2);
  assert.equal(tracked.observations.length, 2);

  const confirmedCalibration = buildWeeklyThesisCalibration(second, {
    asOfDate: "2026-07-29",
  });
  const confirmed = confirmedCalibration.scored.find((row) => row.entityId === "NVDA");
  assert.equal(confirmed.status, "hit");
  assert.match(confirmed.reason, /\+1\.20%p/);
  assert.deepEqual(
    confirmedCalibration.alerts.map((alert) => ({
      entityId: alert.entityId,
      status: alert.status,
      previousStatus: alert.previousStatus,
      alertType: alert.alertType,
    })),
    [{
      entityId: "NVDA",
      status: "hit",
      previousStatus: "pending",
      alertType: "thesis_confirmed",
    }],
  );

  const weakened = await syncInvestmentThesisMemory({
    decisionChain: {
      status: "ready",
      sectors: [],
      candidates: [],
      ideaFunnel: {
        candidatePool: [{
          ...baseCandidate,
          status: undefined,
          stockVsSector5d: 1.4,
          estimateRevision: { revisionDirection: "negative_revision" },
        }],
      },
    },
    reportDate: "2026-07-30",
    env,
  });
  const weakenedRecord = weakened.records.find((record) => record.entityId === "NVDA");
  assert.equal(weakenedRecord.state, "weakened");
  const contradictedCalibration = buildWeeklyThesisCalibration(weakened, {
    asOfDate: "2026-07-30",
  });
  const contradicted = contradictedCalibration.scored.find((row) => row.entityId === "NVDA");
  assert.equal(contradicted.status, "miss");
  assert.match(contradicted.reason, /추정치 하향/);
  assert.equal(contradictedCalibration.alerts.length, 1);
  assert.equal(contradictedCalibration.alerts[0].status, "miss");
  assert.equal(contradictedCalibration.alerts[0].previousStatus, "hit");
  assert.equal(contradictedCalibration.alerts[0].alertType, "thesis_contradicted");
});

test("weekly calibration scores only directional theses and hides thin-sample hit rate", () => {
  const calibration = buildWeeklyThesisCalibration(
    {
      lastSyncedReportDate: "2026-07-29",
      records: [
        {
          continuityId: "pb-sector-xlk",
          kind: "sector",
          entityId: "XLK",
          title: "기술 섹터 가설",
          sectorTicker: "XLK",
          direction: 1,
          metricId: "sector_vs_spy_5d_pct_point",
          metricUnit: "%p",
          confirmationCondition: "상대강세 유지",
          invalidationCondition: "상대성과 반전",
          evidence: ["5일 상대강세"],
          lastSeenAt: "2026-07-29",
          observations: [
            { at: "2026-07-28", metricValue: 0.4 },
            { at: "2026-07-29", metricValue: 0.8 },
          ],
          history: [],
        },
        {
          continuityId: "pb-sector-xlc",
          kind: "sector",
          entityId: "XLC",
          title: "커뮤니케이션 섹터 가설",
          sectorTicker: "XLC",
          direction: -1,
          metricId: "sector_vs_spy_5d_pct_point",
          metricUnit: "%p",
          confirmationCondition: "상대약세 유지",
          invalidationCondition: "상대성과 반등",
          evidence: ["5일 상대약세"],
          lastSeenAt: "2026-07-29",
          observations: [
            { at: "2026-07-28", metricValue: -0.3 },
            { at: "2026-07-29", metricValue: 0.5 },
          ],
          history: [],
        },
        {
          continuityId: "pb-stock-nvda",
          kind: "stock",
          entityId: "NVDA",
          title: "NVDA 투자 가설",
          sectorTicker: "XLK",
          direction: 0,
          metricId: "",
          confirmationCondition: "공식 촉매 확인",
          invalidationCondition: "섹터 대비 약세",
          evidence: ["공식 근거 1건"],
          lastSeenAt: "2026-07-29",
          observations: [{ at: "2026-07-29", metricValue: null }],
          history: [],
        },
      ],
    },
    { asOfDate: "2026-07-29", minimumResolvedSample: 10 },
  );
  assert.equal(calibration.counts.hit, 1);
  assert.equal(calibration.counts.miss, 1);
  assert.equal(calibration.counts.not_scoreable, 1);
  assert.equal(calibration.resolvedCount, 2);
  assert.equal(calibration.successRateVisible, false);
  assert.equal(calibration.successRatePct, 50);
  assert.match(calibration.warnings[0], /적중률을 공개하지 않습니다/);
});

test("PB thesis memory refuses to persist blocked or empty conclusions", async () => {
  await assert.rejects(
    syncInvestmentThesisMemory({
      decisionChain: { status: "blocked", sectors: [], candidates: [] },
      reportDate: "2026-07-29",
      env,
    }),
    /추적 가설이 없습니다/,
  );
});
