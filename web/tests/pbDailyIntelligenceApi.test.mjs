import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import {
  buildBrokerSectorImpactChanges,
  buildBrokerSectorImpactProfiles,
  buildBrokerSectorSignalPersistence,
  buildSectorStockShortlists,
  buildSectorWatchlistRanking,
  buildMarketSectorStockChain,
  buildPortfolioImpact,
  buildPortfolioResponseCalibration,
  buildRiskThesisReviewActivity,
  extractPortfolioUniverse,
  linkThesisAlertsToPortfolio,
  loadPbDailyIntelligenceSnapshot,
  evaluatePortfolioResponse,
  portfolioResponseObservation,
} from "../server/pbDailyIntelligenceApi.mjs";

const tempRoot = join(process.cwd(), "data", ".test-pb-daily-intelligence");

async function writeJson(filePath, payload) {
  await mkdir(join(filePath, ".."), { recursive: true });
  await writeFile(filePath, JSON.stringify(payload), "utf8");
}

test.afterEach(async () => {
  await rm(tempRoot, { recursive: true, force: true });
});

test("PB Daily Intelligence exposes only completed thesis review decisions in audit order", () => {
  const activity = buildRiskThesisReviewActivity({
    thesisMemory: {
      records: [{
        continuityId: "pb-stock-nvda",
        entityId: "NVDA",
        state: "weakened",
        stateLabel: "약화",
      }],
    },
    stockCandidates: {
      candidates: [{ ticker: "NVDA", reaction: { close: 130 } }],
    },
    reportDate: "2026-07-29",
    reviews: [
      {
        reportDate: "2026-07-29",
        riskId: "stock:NVDA",
        title: "NVDA 집중 위험",
        thesisImpact: "contradicts",
        thesisProposalStatus: "approved",
        thesisProposalReviewedAt: "2026-07-29T09:00:00+09:00",
        thesisContinuityIds: ["pb-stock-nvda"],
        note: "공식 실적 근거 확인",
        portfolioResponseAction: "maintain",
        portfolioResponseMetricId: "stock_close",
        portfolioResponseMetricLabel: "종목 종가",
        portfolioResponseMetricTicker: "NVDA",
        portfolioResponseBaselineValue: 125,
        portfolioResponseBaselineDate: "2026-07-28",
      },
      {
        reportDate: "2026-07-29",
        riskId: "sector:XLK",
        title: "기술 섹터 위험",
        thesisImpact: "neutral",
        thesisProposalStatus: "pending",
        thesisContinuityIds: ["pb-sector-xlk"],
      },
      {
        reportDate: "2026-07-28",
        riskId: "sector:XLY",
        title: "경기소비재 위험",
        thesisImpact: "neutral",
        thesisProposalStatus: "rejected",
        thesisProposalReviewedAt: "2026-07-29T08:00:00+09:00",
        thesisContinuityIds: ["pb-sector-xly"],
      },
    ],
  });
  assert.equal(activity.length, 2);
  assert.equal(activity[0].decision, "approved");
  assert.equal(activity[0].targets[0].entityId, "NVDA");
  assert.equal(activity[0].portfolioResponseAction, "maintain");
  assert.equal(activity[0].portfolioResponseEvaluation.status, "supported");
  assert.equal(activity[1].decision, "rejected");
  assert.equal(activity[1].targets[0].entityId, "XLY");
});

test("portfolio response evaluation uses only comparable next-report observations", () => {
  assert.deepEqual(
    portfolioResponseObservation("stock:NVDA", {
      stockCandidates: {
        candidates: [{ ticker: "NVDA", reaction: { close: 125 } }],
      },
    }),
    {
      metricId: "stock_close",
      metricLabel: "종목 종가",
      ticker: "NVDA",
      value: 125,
    },
  );
  assert.equal(
    portfolioResponseObservation("stock:NVDA", {
      stockCandidates: {
        candidates: [{ ticker: "NVDA", reaction: { close: null } }],
      },
    }),
    null,
  );
  assert.deepEqual(
    portfolioResponseObservation("sector:XLK", {
      marketInternals: {
        sectors: { "5d": [{ ticker: "XLK", vsSpyPctPoint: -2.1 }] },
      },
    }),
    {
      metricId: "sector_vs_spy_5d_pct_point",
      metricLabel: "섹터의 SPY 대비 5일 상대수익률",
      ticker: "XLK",
      value: -2.1,
    },
  );
  const supported = evaluatePortfolioResponse({
    action: "reduce_review",
    metricId: "stock_close",
    metricLabel: "종목 종가",
    metricTicker: "NVDA",
    baselineValue: 125,
    baselineDate: "2026-07-29",
    currentObservation: {
      metricId: "stock_close",
      metricLabel: "종목 종가",
      ticker: "NVDA",
      value: 120,
    },
    currentReportDate: "2026-07-30",
  });
  assert.equal(supported.status, "supported");
  assert.equal(supported.change, -4);

  const pending = evaluatePortfolioResponse({
    action: "maintain",
    metricId: "stock_close",
    baselineValue: 125,
    baselineDate: "2026-07-29",
    currentObservation: { metricId: "stock_close", ticker: "NVDA", value: 126 },
    currentReportDate: "2026-07-29",
  });
  assert.equal(pending.status, "pending");

  const unavailable = evaluatePortfolioResponse({
    action: "maintain",
    metricId: "stock_close",
    baselineValue: 125,
    baselineDate: "2026-07-29",
    currentObservation: null,
    currentReportDate: "2026-07-30",
  });
  assert.equal(unavailable.status, "unavailable");
});

test("portfolio response calibration hides thin-sample rates and separates non-directional actions", () => {
  const activity = [
    {
      activityId: "a",
      reportDate: "2026-07-29",
      riskId: "stock:NVDA",
      title: "NVDA",
      portfolioResponseAction: "maintain",
      portfolioResponseEvaluation: { status: "supported", summary: "상승" },
    },
    {
      activityId: "b",
      reportDate: "2026-07-29",
      riskId: "stock:TSLA",
      title: "TSLA",
      portfolioResponseAction: "reduce_review",
      portfolioResponseEvaluation: { status: "challenged", summary: "상승" },
    },
    {
      activityId: "c",
      reportDate: "2026-07-29",
      riskId: "sector:XLK",
      title: "XLK",
      portfolioResponseAction: "increase_monitoring",
      portfolioResponseEvaluation: { status: "observed", summary: "변화 관측" },
    },
    {
      activityId: "d",
      reportDate: "2026-07-29",
      riskId: "sector:XLY",
      title: "XLY",
      portfolioResponseAction: "no_position_change",
      portfolioResponseEvaluation: { status: "pending", summary: "평가 전" },
    },
  ];
  const calibration = buildPortfolioResponseCalibration(activity, {
    minimumDecisiveSample: 10,
  });
  assert.equal(calibration.totalCount, 4);
  assert.equal(calibration.decisiveCount, 2);
  assert.equal(calibration.successRateVisible, false);
  assert.equal(calibration.successRatePct, 50);
  assert.equal(calibration.counts.observed, 1);
  assert.equal(calibration.counts.pending, 1);
  assert.equal(calibration.challenged.length, 1);
  assert.equal(calibration.ruleSuggestions.length, 0);
  assert.match(calibration.warning, /최소 10건/);

  const mature = buildPortfolioResponseCalibration(
    Array.from({ length: 10 }, (_, index) => ({
      activityId: `mature-${index}`,
      reportDate: "2026-07-29",
      riskId: `stock:T${index}`,
      title: `T${index}`,
      portfolioResponseAction: "maintain",
      portfolioResponseEvaluation: {
        status: index < 8 ? "supported" : "challenged",
        summary: "평가",
      },
    })),
  );
  assert.equal(mature.successRateVisible, true);
  assert.equal(mature.successRatePct, 80);
  assert.equal(mature.warning, "");
  assert.equal(mature.ruleSuggestions.length, 0);

  const repeatedChallenges = buildPortfolioResponseCalibration(
    [
      ...Array.from({ length: 2 }, (_, index) => ({
        activityId: `reduce-challenged-${index}`,
        reportDate: `2026-07-${28 + index}`,
        riskId: `stock:C${index}`,
        title: `C${index}`,
        portfolioResponseAction: "reduce_review",
        portfolioResponseEvaluation: {
          status: "challenged",
          summary: "축소 검토 이후 가격이 상승했습니다.",
        },
      })),
      {
        activityId: "reduce-supported",
        reportDate: "2026-07-27",
        riskId: "stock:S1",
        title: "S1",
        portfolioResponseAction: "reduce_review",
        portfolioResponseEvaluation: {
          status: "supported",
          summary: "축소 검토 이후 가격이 하락했습니다.",
        },
      },
    ],
  );
  assert.equal(repeatedChallenges.ruleSuggestions.length, 1);
  assert.equal(repeatedChallenges.ruleSuggestions[0].action, "reduce_review");
  assert.equal(repeatedChallenges.ruleSuggestions[0].status, "pending_approval");
  assert.equal(repeatedChallenges.ruleSuggestions[0].autoApply, false);
  assert.equal(repeatedChallenges.ruleSuggestions[0].challengeRatePct, 66.7);
  assert.match(repeatedChallenges.ruleSuggestions[0].proposal, /가격 추세/);
});

test("PB Daily Intelligence separates direct report tickers from indirect sector candidates", () => {
  const [sector] = buildBrokerSectorImpactProfiles({
    coverage: [{
      sectorId: "metals_critical_materials",
      sector: "금속·핵심소재",
      topTickers: [{ ticker: "FCX", reportCount: 2 }],
      stanceCounts: { positive: 2, neutral: 0, cautious: 0, negative: 0 },
      publisherOpinion: { ratedPublisherCount: 2 },
      attributionRole: "primary",
    }],
    marketInternals: {
      sectors: {
        "5d": [{ ticker: "XLB", returnPct: 3.4, vsSpyPctPoint: 2.2 }],
      },
    },
    stockCandidates: {
      candidates: [
        {
          ticker: "FCX",
          companyName: "Freeport-McMoRan",
          sectorIds: ["metals_critical_materials"],
          score: 70,
        },
        {
          ticker: "NUE",
          companyName: "Nucor",
          sectorIds: ["metals_critical_materials"],
          score: 55,
        },
      ],
    },
  });

  assert.equal(sector.impactProfile.direction, "beneficiary");
  assert.equal(sector.impactProfile.strength, "strong");
  assert.equal(sector.impactProfile.evidenceState, "cross_confirmed");
  assert.deepEqual(
    sector.impactProfile.directTickers.map((item) => item.ticker),
    ["FCX"],
  );
  assert.deepEqual(
    sector.impactProfile.indirectTickers.map((item) => item.ticker),
    ["NUE"],
  );
});

test("PB Daily Intelligence alerts only on comparable sector impact changes", () => {
  const result = buildBrokerSectorImpactChanges({
    currentDate: "2026-07-29",
    previousDate: "2026-07-28",
    previousCoverage: [{
      sectorId: "technology_hardware_services",
      sector: "정보기술·하드웨어",
      impactProfile: {
        direction: "beneficiary",
        strength: "moderate",
        evidenceState: "cross_confirmed",
        marketTicker: "XLK",
        vsSpy5d: 1.4,
      },
    }],
    currentCoverage: [
      {
        sectorId: "technology_hardware_services",
        sector: "정보기술·하드웨어",
        impactProfile: {
          direction: "pressure",
          strength: "moderate",
          evidenceState: "cross_confirmed",
          marketTicker: "XLK",
          vsSpy5d: -1.6,
        },
      },
      {
        sectorId: "travel_leisure",
        sector: "여행·레저",
        impactProfile: {
          direction: "beneficiary",
          strength: "weak",
          evidenceState: "price_only",
          marketTicker: "XLY",
          vsSpy5d: 1.1,
        },
      },
    ],
  });

  assert.equal(result.baseline.available, true);
  assert.equal(result.baseline.comparableSectorCount, 1);
  assert.equal(result.alerts.length, 1);
  assert.equal(result.alerts[0].alertType, "pressure_turn");
  assert.equal(result.alerts[0].severity, "high");
  assert.equal(
    result.coverage.find((item) => item.sectorId === "travel_leisure")
      .impactProfile.change.status,
    "baseline_unavailable",
  );
});

test("PB Daily Intelligence tracks signal persistence but hides rates below minimum sample", () => {
  const sectorPoint = (date, vsSpy1d) => ({
    date,
    coverage: [{
      sectorId: "semiconductors_ai_compute",
      sector: "반도체·AI 컴퓨트",
      impactProfile: {
        direction: "beneficiary",
        strength: "moderate",
        evidenceState: "cross_confirmed",
        marketTicker: "XLK",
        vsSpy1d,
      },
    }],
  });
  const result = buildBrokerSectorSignalPersistence({
    history: [
      sectorPoint("2026-07-24", null),
      sectorPoint("2026-07-25", 0.8),
      sectorPoint("2026-07-28", 0.4),
      sectorPoint("2026-07-29", -0.6),
    ],
  });
  const persistence = result.coverage[0].impactProfile.persistence;

  assert.equal(persistence.streakCount, 4);
  assert.equal(persistence.state, "persistent");
  assert.equal(persistence.hitCount, 2);
  assert.equal(persistence.missCount, 1);
  assert.equal(persistence.decisiveCount, 3);
  assert.equal(persistence.hitRatePct, null);
  assert.equal(persistence.sampleState, "insufficient_sample");
  assert.equal(result.summary.hitRatePct, null);
});

test("PB Daily Intelligence promotes sectors only after every evidence gate passes", () => {
  const sector = (sectorId, direction, overrides = {}) => ({
    sectorId,
    sector: sectorId,
    impactProfile: {
      direction,
      directionLabel: direction,
      strength: "moderate",
      evidenceState: "cross_confirmed",
      marketTicker: "XLK",
      vsSpy5d: 2,
      directTickers: [{ ticker: "NVDA", exposureType: "direct" }],
      indirectTickers: [],
      persistence: {
        streakCount: 3,
        hitCount: 1,
        missCount: 0,
        recentOutcome: { status: "hit" },
      },
      ...overrides,
    },
  });
  const result = buildSectorWatchlistRanking([
    sector("promoted-sector", "beneficiary"),
    sector("watch-sector", "beneficiary", {
      evidenceState: "price_only",
      persistence: {
        streakCount: 1,
        hitCount: 0,
        missCount: 0,
        recentOutcome: null,
      },
    }),
    sector("caution-sector", "pressure"),
    sector("not-ready-sector", "neutral", {
      directTickers: [],
      persistence: {
        streakCount: 0,
        hitCount: 0,
        missCount: 0,
        recentOutcome: null,
      },
    }),
  ]);

  assert.equal(result.promoted.length, 1);
  assert.equal(result.promoted[0].sectorId, "promoted-sector");
  assert.equal(result.watch.length, 1);
  assert.deepEqual(
    result.watch[0].missingRequirements,
    ["3회 지속", "가격·리서치 교차확인", "후속 반응 적중"],
  );
  assert.equal(result.caution.length, 1);
  assert.equal(result.notReadyCount, 1);
});

test("PB Daily Intelligence re-screens sector stocks through catalyst and valuation gates", () => {
  const result = buildSectorStockShortlists({
    sectorWatchlist: {
      promoted: [{
        sectorId: "semiconductors_ai_compute",
        sector: "반도체·AI 컴퓨트",
        status: "promoted",
        relatedTickers: [{ ticker: "NVDA" }],
      }],
      watch: [{
        sectorId: "construction_infrastructure",
        sector: "건설·인프라",
        status: "watch",
        relatedTickers: [{ ticker: "CAT" }, { ticker: "NUE" }],
      }],
    },
    candidatePool: [
      {
        ticker: "NVDA",
        companyName: "NVIDIA",
        researchPriority: "A",
        exposureState: "linked",
        exposureType: "direct",
        primaryEvidenceCount: 2,
        verifiedFactCount: 3,
        evidenceSummary: "공식 실적과 가이던스 확인",
        estimateRevision: {
          status: "available",
          rows: [{ metric: "revenue" }],
          revisionDirection: "positive_revision",
          directionLabel: "상향",
        },
        valuationScreen: {
          status: "screening_available",
          usablePeerCount: 3,
          minimumPeerCount: 2,
        },
      },
      {
        ticker: "CAT",
        companyName: "Caterpillar",
        researchPriority: "B",
        exposureState: "linked",
        exposureType: "indirect",
        primaryEvidenceCount: 0,
        verifiedFactCount: 0,
        evidenceSummary: "가격 후보만 존재",
        estimateRevision: {
          status: "not_available",
          rows: [],
          revisionDirection: "not_stated",
          directionLabel: "자료 없음",
        },
        valuationScreen: {
          status: "not_available",
          usablePeerCount: 0,
          minimumPeerCount: 2,
        },
      },
      {
        ticker: "NUE",
        companyName: "Nucor",
        researchPriority: "C",
        exposureState: "linked",
        exposureType: "direct",
        primaryEvidenceCount: 1,
        verifiedFactCount: 1,
        evidenceSummary: "공식 자료 확인",
        estimateRevision: {
          status: "available",
          rows: [{ metric: "eps" }],
          revisionDirection: "negative_revision",
          directionLabel: "하향",
        },
        valuationScreen: {
          status: "screening_available",
          usablePeerCount: 2,
          minimumPeerCount: 2,
        },
      },
    ],
  });

  assert.equal(result.totals.qualified, 1);
  assert.equal(result.totals.hold, 1);
  assert.equal(result.totals.excluded, 1);
  assert.equal(result.candidateCount, 3);
  assert.equal(result.sectors[0].candidates[0].status, "qualified");
  assert.equal(
    result.sectors[0].candidates[0].researchProfile.readiness,
    "research_ready",
  );
  assert.match(
    result.sectors[0].candidates[0].researchProfile.researchQuestion,
    /NVDA/,
  );
  assert.equal(
    result.sectors[0].candidates[0].researchProfile.evidenceBasis.length,
    5,
  );
  assert.equal(result.sectors[1].candidates[0].status, "hold");
  assert.equal(
    result.sectors[1].candidates[0].researchProfile.readiness,
    "gate_blocked",
  );
  assert.match(
    result.sectors[1].candidates[0].researchProfile.evidenceBoundary,
    /투자 결론으로 승격하지 않습니다/,
  );
  assert.deepEqual(
    result.sectors[1].candidates[0].missingRequirements,
    ["섹터 승격", "공식 촉매", "추정치 지지", "비교 가능한 밸류에이션"],
  );
  assert.equal(result.sectors[1].candidates[1].status, "excluded");
});

test("PB Daily Intelligence links portfolio and watchlist tickers to bounded evidence", () => {
  const universe = extractPortfolioUniverse({
    transactionSettings: {
      watchlistGroups: [
        { name: "AI 관심", symbols: ["NVDA", "MSFT"] },
      ],
      portfolioHoldings: [
        { ticker: "TSLA", weight: 45, label: "간편 보유" },
      ],
    },
    portfolioCanvasSnapshot: {
      store: {
        canvases: [
          {
            name: "미국 성장",
            workspace: {
              strategyPortfolios: [
                {
                  name: "핵심",
                  weights: [
                    { ticker: "NVDA", weight: 60 },
                    { ticker: "QQQ", weight: 40 },
                  ],
                },
              ],
            },
          },
        ],
      },
    },
  });
  assert.deepEqual(universe.map((item) => item.ticker), ["MSFT", "NVDA", "QQQ", "TSLA"]);
  assert.deepEqual(
    universe.find((item) => item.ticker === "NVDA").roles,
    ["watchlist", "portfolio"],
  );
  assert.deepEqual(universe.find((item) => item.ticker === "TSLA").roles, ["portfolio"]);
  assert.deepEqual(universe.find((item) => item.ticker === "TSLA").weights, [45]);
  assert.deepEqual(universe.find((item) => item.ticker === "TSLA").quickWeights, [45]);
  assert.deepEqual(universe.find((item) => item.ticker === "TSLA").sources, ["quick_portfolio"]);

  const impact = buildPortfolioImpact({
    universe,
    intelligence: {
      events: {
        items: [
          {
            event_id: "event-nvda",
            title: "NVDA 가이던스 업데이트",
            listed_entities: [{ ticker: "NVDA" }],
            verification: { primary_fact_confirmed: true },
            impact_analysis: {
              summary: "반도체 섹터 전이 여부를 확인한다.",
              confirmation_condition: "SOXX 동반 강세",
              invalidation_condition: "NVDA 단독 약세",
            },
          },
          {
            event_id: "event-ai",
            title: "AI 투자 확대",
            verification: { primary_fact_confirmed: false },
          },
        ],
      },
    },
    report: {
      executiveSummary: ["금리와 실적을 함께 본다."],
      earningsWatch: {
        companies: [{ ticker: "MSFT", companyName: "Microsoft" }],
      },
    },
    stockCandidates: {
      candidates: [
        {
          ticker: "NVDA",
          score: 82,
          deepAnalysisEligible: true,
          reaction: { return1d: 4.1 },
        },
      ],
    },
    candidatePool: [
      {
        ticker: "NVDA",
        score: 82,
        deepAnalysisEligible: true,
        reaction: { return1d: 4.1 },
        linkedSectorTicker: "XLK",
        linkedSectorLabel: "기술",
      },
      {
        ticker: "TSLA",
        score: 67,
        linkedSectorTicker: "XLY",
        linkedSectorLabel: "경기소비재",
      },
    ],
    sectorPaths: [
      {
        ticker: "XLY",
        label: "경기소비재",
        stance: "pressure",
        reason: "5일 상대약세가 관측됐습니다.",
      },
    ],
  });

  assert.equal(impact.configured, true);
  assert.equal(impact.portfolioCount, 3);
  assert.equal(impact.watchlistCount, 2);
  assert.equal(impact.matchedCount, 2);
  assert.equal(impact.unmatchedCount, 2);
  assert.equal(impact.quickPortfolioWeight, 45);
  assert.deepEqual(impact.riskReview.stockConcentration, [{
    ticker: "TSLA",
    weight: 45,
    severity: "high",
  }]);
  assert.equal(impact.riskReview.sectorConcentration[0].ticker, "XLY");
  assert.equal(impact.riskReview.sectorConcentration[0].weight, 45);
  assert.equal(impact.riskReview.thesisConflicts[0].ticker, "TSLA");
  assert.equal(impact.riskReview.unmapped.length, 0);
  assert.equal(impact.assets[0].ticker, "NVDA");
  assert.equal(impact.assets[0].evidenceState, "primary_verified");
  assert.equal(impact.assets[0].relatedEvents.length, 1);
  assert.equal(impact.assets.find((item) => item.ticker === "MSFT").evidenceState, "quantitative_only");
  assert.equal(impact.assets.find((item) => item.ticker === "QQQ").evidenceState, "no_direct_evidence");
});

test("PB thesis alerts prioritize contradicted holdings and link sector paths", () => {
  const alerts = linkThesisAlertsToPortfolio({
    alerts: [
      {
        id: "pb-sector-xlk-2026-07-29-hit",
        kind: "sector",
        entityId: "XLK",
        status: "hit",
        reason: "기술 섹터 가설 확인",
      },
      {
        id: "pb-stock-nvda-2026-07-29-miss",
        kind: "stock",
        entityId: "NVDA",
        status: "miss",
        reason: "NVDA 가설 반증",
      },
      {
        id: "pb-stock-tsla-2026-07-29-miss",
        kind: "stock",
        entityId: "TSLA",
        status: "miss",
        reason: "TSLA 가설 반증",
      },
    ],
    portfolioImpact: {
      assets: [
        {
          ticker: "NVDA",
          roles: ["portfolio", "watchlist"],
          labels: ["미국 성장"],
          weights: [60],
        },
        {
          ticker: "MSFT",
          roles: ["watchlist"],
          labels: ["AI 관심"],
          weights: [],
        },
      ],
    },
    candidatePool: [
      { ticker: "NVDA", linkedSectorTicker: "XLK" },
      { ticker: "MSFT", linkedSectorTicker: "XLK" },
      { ticker: "TSLA", linkedSectorTicker: "XLY" },
    ],
  });

  assert.equal(alerts[0].entityId, "NVDA");
  assert.equal(alerts[0].priorityLevel, "critical");
  assert.equal(alerts[0].holdingCount, 1);
  assert.equal(alerts[0].directCount, 1);
  assert.equal(alerts[1].entityId, "XLK");
  assert.deepEqual(
    alerts[1].affectedAssets.map((asset) => [asset.ticker, asset.relationship]),
    [["NVDA", "sector"], ["MSFT", "sector"]],
  );
  assert.equal(alerts[1].holdingCount, 1);
  assert.equal(alerts[1].watchlistCount, 2);
  assert.equal(alerts[2].entityId, "TSLA");
  assert.equal(alerts[2].priorityLevel, "normal");
});

test("PB Daily Intelligence builds a bounded market to sector to stock research chain", () => {
  const chain = buildMarketSectorStockChain({
    report: {
      reportDate: "2026-07-28",
      executiveSummary: ["시장 폭이 확산되고 있습니다."],
      earningsWatch: {
        companies: [
          {
            ticker: "NVDA",
            estimateRevision: {
              rows: [
                { metricId: "eps", revisionPct30d: 4.5 },
              ],
            },
            guidance: [{ metricId: "revenue" }],
          },
        ],
      },
    },
    decisionGate: { status: "ready" },
    scoreboard: {
      regime: {
        summary: "시장 폭 확산과 기술주 리더십이 함께 관측됩니다.",
        quantitativeEvidence: ["RSP/SPY +0.8%p", "상승 종목 62%"],
      },
    },
    marketInternals: {
      sectors: {
        "5d": [
          { ticker: "XLK", sector: "Technology", returnPct: 4.2, vsSpyPctPoint: 2.1 },
          { ticker: "XLI", sector: "Industrials", returnPct: 2.3, vsSpyPctPoint: 0.2 },
          { ticker: "XLP", sector: "Staples", returnPct: -1.4, vsSpyPctPoint: -3.5 },
        ],
      },
      sectorBreadth: {
        sectors: [
          { ticker: "XLK", advancePct: 70, above50dPct: 68 },
          { ticker: "XLP", advancePct: 34, above50dPct: 40 },
        ],
      },
    },
    stockCandidates: {
      candidates: [
        {
          ticker: "NVDA",
          companyName: "NVIDIA",
          score: 84,
          sectorIds: ["semiconductors_ai_compute"],
          reasons: ["실적 발표 후 거래량 급증"],
          deepAnalysisEligible: true,
          reaction: {
            close: 100,
            return1d: 5.2,
            spyRelative1d: 4.8,
            volumeRatio20d: 2.7,
          },
          evidence: [
            { primaryConfirmed: true, factCount: 2 },
          ],
        },
        {
          ticker: "BAD",
          companyName: "Invalidated Candidate",
          score: 12,
          sectorIds: [],
          reasons: ["material_price_move"],
          deepAnalysisEligible: false,
          evidenceStatus: "invalidated",
          reaction: {
            close: 10,
            return1d: -8,
            spyRelative1d: -7.5,
            volumeRatio20d: 3,
          },
          evidence: [],
        },
      ],
    },
    brokerResearch: {
      reports: [
        {
          publishedAt: "2026-07-27",
          tickers: ["NVDA"],
          standardSectors: [{ id: "semiconductors_ai_compute" }],
          targetPrice: { value: 125, currency: "USD" },
        },
        {
          publishedAt: "2026-07-29",
          tickers: ["NVDA"],
          standardSectors: [{ id: "semiconductors_ai_compute" }],
          targetPrice: { value: 200, currency: "USD" },
        },
      ],
    },
  });

  assert.equal(chain.status, "ready");
  assert.equal(chain.sectors[0].ticker, "XLK");
  assert.equal(chain.sectors[0].stance, "beneficiary");
  assert.equal(chain.sectors[0].fundamentalGate.status, "supported");
  assert.equal(chain.sectors[0].fundamentalGate.revisionCount, 1);
  assert.equal(chain.sectors[0].fundamentalGate.researchReportCount, 1);
  assert.equal(chain.sectors[0].fundamentalGate.medianTargetUpsidePct, 25);
  assert.equal(chain.sectors.at(-1).ticker, "XLP");
  assert.equal(chain.sectors.at(-1).stance, "pressure");
  assert.equal(chain.sectors.at(-1).fundamentalGate.status, "price_only");
  assert.equal(chain.candidates[0].researchPriority, "A");
  assert.equal(chain.candidates[0].linkedSectorTicker, "XLK");
  assert.equal(chain.candidates[0].exposureState, "linked");
  assert.equal(chain.ideaFunnel.priorityCounts.A, 1);
  assert.equal(chain.ideaFunnel.priorityCounts.REJECTED, 1);
  assert.equal(chain.ideaFunnel.rejectedCandidates[0].ticker, "BAD");
  assert.match(chain.ideaFunnel.rejectedCandidates[0].rejectionReason, /무효화/);
  assert.match(chain.disclaimer, /매수·매도 추천이 아닙니다/);
});

test("PB Daily Intelligence accepts labeled peer screening only with minimum peer support", () => {
  const buildChain = (usablePeerCount) => buildMarketSectorStockChain({
    report: {
      reportDate: "2026-07-29",
      executiveSummary: ["기술주 리더십을 추정치와 비교기업으로 재검증합니다."],
      earningsWatch: {
        companies: [
          {
            ticker: "NVDA",
            estimateRevision: {
              rows: [{ metricId: "eps", revisionPct30d: 3.2 }],
            },
            guidance: [],
            valuationScreen: {
              status: "screening_available",
              relativeValuationStatus: "discount_to_watchlist_peer_median",
              primaryMetric: "forward_pe",
              targetValue: 21.92,
              peerMedian: 47.28,
              premiumDiscountPct: -53.6,
              usablePeerCount,
              minimumPeerCount: 2,
              evidenceLabel: "derived_screening_calculation",
            },
          },
        ],
      },
    },
    decisionGate: { status: "ready" },
    scoreboard: {
      regime: {
        summary: "기술주 상대강세가 관측됩니다.",
        quantitativeEvidence: ["XLK/SPY +1.2%p"],
      },
    },
    marketInternals: {
      sectors: {
        "5d": [
          { ticker: "XLK", sector: "Technology", returnPct: 3.4, vsSpyPctPoint: 1.2 },
        ],
      },
      sectorBreadth: {
        sectors: [{ ticker: "XLK", advancePct: 66, above50dPct: 61 }],
      },
    },
    stockCandidates: {
      candidates: [
        {
          ticker: "NVDA",
          companyName: "NVIDIA",
          score: 84,
          sectorIds: ["semiconductors_ai_compute"],
          reasons: ["실적 추정치 상향"],
          deepAnalysisEligible: true,
          reaction: {
            close: 197.05,
            return1d: 2.1,
            spyRelative1d: 1.7,
            volumeRatio20d: 1.5,
          },
          evidence: [{ primaryConfirmed: true, factCount: 1 }],
        },
      ],
    },
    brokerResearch: { reports: [] },
  });

  const supported = buildChain(2);
  assert.equal(supported.sectors[0].fundamentalGate.status, "supported");
  assert.equal(supported.sectors[0].fundamentalGate.valuationStatus, "comparable");
  assert.equal(supported.sectors[0].fundamentalGate.comparableValuationCount, 1);
  assert.match(supported.sectors[0].fundamentalGate.valuationLabel, /forward_pe/);
  assert.equal(supported.candidates[0].researchPriority, "A");
  assert.equal(supported.candidates[0].valuationScreen.primaryMetric, "forward_pe");
  assert.equal(supported.candidates[0].valuationScreen.usablePeerCount, 2);
  assert.equal(supported.candidates[0].estimateRevision.rows[0].revisionPct30d, 3.2);

  const insufficient = buildChain(1);
  assert.equal(insufficient.sectors[0].fundamentalGate.status, "watch");
  assert.equal(insufficient.sectors[0].fundamentalGate.valuationStatus, "unavailable");
  assert.equal(insufficient.candidates[0].researchPriority, "B");
});

test("PB Daily Intelligence reports an explicit disconnected state", async () => {
  const snapshot = await loadPbDailyIntelligenceSnapshot({ env: {} });
  assert.deepEqual(snapshot.connection, {
    configured: false,
    available: false,
    reason: "not_configured",
  });
  assert.equal(snapshot.report, null);
});

test("PB Daily Intelligence exposes Gmail research collection status without secrets", async () => {
  const reportDate = "2026-07-28";
  const engineRoot = join(tempRoot, "engine");
  await writeJson(
    join(tempRoot, "v2_reader_reports", reportDate, "reader_report.json"),
    {
      schema_version: "v2_reader_report.v1",
      report_date: reportDate,
      generated_at: "2026-07-28T08:00:00+09:00",
      title: "Daily Market Intelligence",
      executive_summary: [],
      market_findings: [],
      verified_events: [],
      korea_connection: {},
      next_checks: [],
      data_status: {},
      sources: [],
    }
  );
  await writeJson(
    join(tempRoot, "source_status", reportDate, "source_status_190241.json"),
    {
      report_date: reportDate,
      generated_at: "2026-07-28T19:02:41+09:00",
      sources: [
        {
          source_id: "gmail_research",
          status: "ok",
          item_count: 2,
          checked_at: "2026-07-28T19:02:41+09:00",
        },
      ],
    }
  );
  await writeJson(
    join(tempRoot, "normalized", reportDate, "inbox_190241.json"),
    [
      {
        id: "gmail-1",
        source_id: "morgan_stanley",
        source_type: "broker_report",
        publisher: "Morgan Stanley",
        title: "Global Investment Committee Weekly",
        published_at: "2026-07-28T18:40:00+09:00",
        source_reference: "gmail:message-1",
        tags: ["institutional_research", "official_email_source"],
        market_scope: "US",
        research_metadata: {
          report_type: "market_strategy",
          stance: "not_stated",
          summary: "",
          key_claims: [],
        },
        gmail_message: {
          attachment_count: 1,
          pdf_attachment_count: 1,
          attachment_review_required: true,
          attachments: [
            {
              attachment_key: "safe-attachment-key",
              filename: "weekly-outlook.pdf",
              mime_type: "application/pdf",
              size: 2048,
              is_pdf: true,
              approval_state: "pending",
              provider_attachment_id: "must-not-leak",
            },
          ],
        },
      },
      {
        id: "not-gmail",
        source_id: "newsapi",
        source_type: "news",
        title: "Unrelated news",
      },
      {
        id: "gmail-pdf-1",
        source_id: "morgan_stanley",
        source_type: "broker_report",
        publisher: "Morgan Stanley",
        title: "Global Investment Committee Weekly · weekly-outlook.pdf",
        published_at: "2026-07-28T18:40:00+09:00",
        source_reference: "gmail:message-1:attachment:safe-attachment-key",
        tags: ["institutional_research", "official_email_source"],
        market_scope: "US",
        research_metadata: {
          report_type: "sector",
          stance: "not_stated",
          summary: "",
          key_claims: [],
        },
        gmail_attachment: {
          attachment_key: "safe-attachment-key",
          filename: "weekly-outlook.pdf",
          mime_type: "application/pdf",
          size: 2048,
          approval_state: "approved",
          parent_source_reference: "gmail:message-1",
        },
      },
    ]
  );
  await writeJson(
    join(
      tempRoot,
      "broker_research_analysis",
      reportDate,
      "broker_research_analysis.json"
    ),
    {
      schema_version: "broker_research_analysis.v1",
      report_date: reportDate,
      generated_at: "2026-07-28T19:10:00+09:00",
      status: "complete",
      reports: [
        {
          report_id: "gmail-1",
          analyst: "Global Investment Committee",
          report_type: "strategy",
          stance: "cautious",
          summary: "미국 주식의 이익 전망은 유지되지만 장기금리 부담을 함께 점검한다.",
          key_claims: ["대형주 이익 가시성은 유지된다.", "시장 폭 확산 여부가 중요하다."],
          catalysts: ["실적 가이던스 상향"],
          risks: ["장기금리 재상승"],
          sectors: ["Technology"],
          tickers: ["SPY"],
          monitoring_conditions: ["10년물 금리와 동일가중 상대강도 확인"],
        },
        {
          report_id: "gmail-pdf-1",
          analyst: "US Equity Strategy Team",
          report_type: "sector",
          stance: "constructive",
          summary: "첨부 리포트는 AI 투자와 전력 인프라 수요의 동반 확장을 전망한다.",
          key_claims: ["AI 설비투자가 전력망 투자로 확산된다.", "반도체와 전력기기의 실적 가시성이 높다."],
          catalysts: ["하이퍼스케일러 투자계획 상향"],
          risks: ["금리 상승에 따른 밸류에이션 압박"],
          sectors: ["Semiconductors", "Electrical Equipment"],
          tickers: ["NVDA", "ETN"],
          monitoring_conditions: ["다음 분기 AI CAPEX와 수주잔고 확인"],
        },
      ],
    }
  );
  await mkdir(engineRoot, { recursive: true });
  await writeFile(
    join(engineRoot, ".env"),
    [
      "GOOGLE_GMAIL_REFRESH_TOKEN=secret-refresh-token",
      "GOOGLE_GMAIL_RESEARCH_LABEL=Stocks",
    ].join("\n"),
    "utf8"
  );
  await writeJson(join(engineRoot, "sources.json"), {
    gmail_research: {
      sender_sources: [
        { sender_domains: ["morganstanley.com"] },
        { sender_domains: ["blackrock.com"] },
      ],
    },
  });

  const snapshot = await loadPbDailyIntelligenceSnapshot({
    env: {
      PB_DAILY_INTELLIGENCE_DIR: tempRoot,
      PB_DAILY_INTELLIGENCE_ENGINE_DIR: engineRoot,
    },
  });

  assert.deepEqual(snapshot.gmailResearch, {
    configured: true,
    label: "Stocks",
    readOnly: true,
    allowlistedSenderDomains: ["morganstanley.com", "blackrock.com"],
    collection: {
      reportDate,
      status: "ok",
      itemCount: 2,
      lastCollectedAt: "2026-07-28T19:02:41+09:00",
    },
    candidates: [
      {
        id: "gmail-1",
        publisher: "Morgan Stanley",
        title: "Global Investment Committee Weekly",
        publishedAt: "2026-07-28T18:40:00+09:00",
        marketScope: "US",
        analyst: "Global Investment Committee",
        reportType: "strategy",
        stance: "cautious",
        analysisState: "analyzed",
        summary: "미국 주식의 이익 전망은 유지되지만 장기금리 부담을 함께 점검한다.",
        keyClaims: ["대형주 이익 가시성은 유지된다.", "시장 폭 확산 여부가 중요하다."],
        catalysts: ["실적 가이던스 상향"],
        risks: ["장기금리 재상승"],
        sectors: ["Technology"],
        tickers: ["SPY"],
        monitoringConditions: ["10년물 금리와 동일가중 상대강도 확인"],
        attachmentCount: 1,
        pdfAttachmentCount: 1,
        attachmentReviewRequired: true,
        attachments: [
          {
            attachmentKey: "safe-attachment-key",
            filename: "weekly-outlook.pdf",
            mimeType: "application/pdf",
            size: 2048,
            isPdf: true,
            approvalState: "pending",
          },
        ],
        sourceReference: "gmail:message-1",
        analyzedAttachments: [
          {
            id: "gmail-pdf-1",
            attachmentKey: "safe-attachment-key",
            filename: "weekly-outlook.pdf",
            title: "Global Investment Committee Weekly · weekly-outlook.pdf",
            analyst: "US Equity Strategy Team",
            reportType: "sector",
            stance: "constructive",
            analysisState: "analyzed",
            summary: "첨부 리포트는 AI 투자와 전력 인프라 수요의 동반 확장을 전망한다.",
            keyClaims: ["AI 설비투자가 전력망 투자로 확산된다.", "반도체와 전력기기의 실적 가시성이 높다."],
            catalysts: ["하이퍼스케일러 투자계획 상향"],
            risks: ["금리 상승에 따른 밸류에이션 압박"],
            sectors: ["Semiconductors", "Electrical Equipment"],
            tickers: ["NVDA", "ETN"],
            monitoringConditions: ["다음 분기 AI CAPEX와 수주잔고 확인"],
          },
        ],
      },
    ],
  });
  assert.equal(JSON.stringify(snapshot).includes("secret-refresh-token"), false);
  assert.equal(JSON.stringify(snapshot).includes("must-not-leak"), false);
});

test("PB Daily Intelligence separates verified reader content from review queue", async () => {
  const reportDate = "2026-07-23";
  await writeJson(
    join(tempRoot, "v2_reader_reports", reportDate, "reader_report.json"),
    {
      schema_version: "v2_reader_report.v1",
      report_date: reportDate,
      generated_at: "2026-07-24T08:00:00+09:00",
      title: "Daily Market Intelligence",
      executive_summary: ["선별적 순환매가 이어졌다."],
      market_findings: [{ title: "시장 폭", body: "동일가중이 우위였다." }],
      verified_events: [],
      earnings_watch: {
        status: "ready",
        companies: [
          {
            ticker: "NVDA",
            company_name: "NVIDIA",
            upcoming_event: {
              event_date: "2026-08-26",
              confidence: "provider_expected",
            },
            estimate_revision: {
              status: "third_party_estimate_bar_available",
              freeze_as_of: "2026-07-28",
              revision_direction: "positive_revision",
              rows: [
                {
                  metric_id: "diluted_eps",
                  period_end: "2026-08-31",
                  value: 1.25,
                  units: "USD per share",
                  revision_pct_30d: 4.2,
                  evidence_label: "third_party_forward_estimate",
                },
              ],
            },
            guidance: [
              {
                metric_id: "revenue",
                period_end: "2026-08-31",
                midpoint: 50000000000,
                units: "USD",
                evidence_label: "issuer_management_claim",
              },
            ],
            historical_surprises: [
              {
                reported_date: "2026-05-20",
                surprise_pct: 4.2,
                reaction_pct: 2.1,
              },
            ],
            post_result_estimate_revision: {
              status: "not_established",
            },
          },
        ],
      },
      korea_connection: { status: "insufficient", summary: "수급 데이터가 부족하다." },
      next_checks: ["외국인 선물 수급"],
      data_status: {
        latest_price_as_of: "2026-07-22",
        verified_event_count: 0,
        korea_data_status: "insufficient",
        warnings: ["한국시장 데이터 부족"],
      },
      sources: [{ source_id: "fred:DGS10", title: "US 10Y", url: "https://example.com" }],
    }
  );
  await writeJson(
    join(tempRoot, "intelligence", reportDate, "daily_intelligence.json"),
    {
      schema_version: "daily_market_intelligence.v2",
      events: {
        cluster_count: 15,
        selected_count: 15,
        verified_primary_fact_count: 0,
        synthesis_status: "not_run",
        fallback_reason: "no_eligible_events",
        items: Array.from({ length: 15 }, (_, index) => ({
            event_id: `event-${index + 1}`,
            title: `검증 전 후보 ${index + 1}`,
            event_type: "policy",
            source_summary: { source_urls: ["https://example.com/candidate"] },
            verification: {
              publication_eligible_as_fact: false,
              extraction_status: "not_run",
            },
            ranking: { priority_score: 42 - index, evidence_readiness_score: 15 },
          })),
      },
      market: {
        regime: { label: "selective_rotation", confidence: 0.6, summary: "순환매" },
        scoreboard: {
          breadth: {
            rsp_vs_spy_5d_pct: 0.86,
            rsp_vs_spy_1d_pct: 0.08,
            as_of: "2026-07-22",
          },
          volatility: {
            vix: { value: 17.05, change_1d: -1.6, as_of: "2026-07-21" },
            vix_term_ratio: 0.87,
            as_of: "2026-07-21",
          },
          rule_based_signal: {
            participation: { qqq_vs_spy_5d_pct: -0.75, iwm_vs_spy_5d_pct: 0.31 },
          },
        },
      },
    }
  );
  await writeJson(
    join(tempRoot, "us_market_internals", reportDate, "market_internals.json"),
    {
      schema_version: "us_market_internals.v1",
      collection_status: "partial_coverage",
      market_source: {
        provider: "Alpaca Historical Bars (iex)",
        as_of: "2026-07-22",
        freshness_status: "current",
        provider_configuration: {
          alpaca_batch_enabled: true,
          alpaca_feed: "iex",
          alpaca_configuration_status: "ready",
        },
      },
      coverage: { available_ticker_count: 3, required_ticker_count: 11, missing_tickers: ["XLY"] },
      market_structure: { classification: "insufficient_data", reason: "partial" },
      constituent_breadth: {
        schema_version: "us_constituent_breadth.v1",
        collection_status: "ready",
        data_gaps: [],
        as_of: "2026-07-22",
        universe: { membership_scope: "fund_holdings_proxy" },
        coverage: { daily_price_pct: 96.4 },
        breadth: {
          advance_decline: { advance_pct: 61.2, decline_pct: 38.0, net_advances: 116 },
          volume: { up_volume_pct: 58.3 },
          moving_averages: {
            "20d": { above_pct: 64.0 },
            "50d": { above_pct: 59.0 },
            "200d": { above_pct: 70.0 },
          },
          highs_lows_52w: { new_highs: 24, new_lows: 5 },
        },
        sector_breadth: {
          collection_status: "partial",
          coverage: {
            required_sector_count: 11,
            available_sector_count: 1,
            ready_sector_count: 1,
          },
          sectors: [
            {
              sector_ticker: "XLE",
              sector_name: "Energy",
              collection_status: "ready",
              membership_as_of: "2026-07-22",
              coverage: { daily_price_pct: 100 },
              breadth: {
                advance_decline: { advance_pct: 68.2 },
                volume: { up_volume_pct: 72.4 },
                moving_averages: {
                  "50d": { above_pct: 71.0 },
                  "200d": { above_pct: 64.0 },
                },
                highs_lows_52w: { new_highs: 4, new_lows: 0 },
              },
            },
          ],
        },
      },
      style_pairs: [
        {
          pair_id: "growth_vs_value",
          first_ticker: "IWF",
          second_ticker: "IWD",
          five_day_leader: "IWF",
          relative_returns_pct_point: { "1d": 0.2, "5d": 1.1, "20d": 2.4 },
        },
      ],
      sector_leadership: {
        "5d": {
          all_sectors: [
            { ticker: "XLE", sector: "Energy", return_pct: 4.7, vs_spy_pct_point: 5.8 },
          ],
        },
      },
      data_gaps: ["partial coverage"],
    }
  );
  await writeJson(
    join(tempRoot, "sector_metrics", reportDate, "sector_metrics.json"),
    {
      schema_version: "sector_metric_observations.v1",
      collection_status: "complete",
      available_metric_count: 1,
      metrics: [
        {
          metric_id: "semis",
          sector_id: "semiconductors_ai_compute",
          label_ko: "미국 반도체 산업생산",
          status: "available",
          score: 89.4,
          change_1_period_pct: 0.5,
          source_url: "https://example.com/semis",
        },
      ],
    }
  );
  await writeJson(
    join(tempRoot, "us_equity_candidate_screen", reportDate, "candidate_screen.json"),
    {
      schema_version: "us_equity_candidate_screen.v1",
      screen_status: "complete",
      universe_security_count: 506,
      market_covered_security_count: 506,
      material_candidate_count: 25,
      deep_analysis_count: 1,
      universe_coverage: {
        full_index_scan_ready: false,
        membership_counts: { sp500: 500, nasdaq100: 0 },
        membership_source_count: 1,
      },
      candidates: [
        {
          ticker: "NVDA",
          company_name: "NVIDIA",
          selection_score: 39,
          market_reaction: { return_1d_pct: 2.3, spy_relative_1d_pct: 2.4 },
          event_evidence: [
            {
              title: "NVDA 8-K",
              source_url: "https://example.com/nvda",
              primary_source_confirmed: true,
              verified_facts: [{ field: "sec_item" }],
            },
          ],
        },
      ],
    }
  );

  const snapshot = await loadPbDailyIntelligenceSnapshot({
    env: { PB_DAILY_INTELLIGENCE_DIR: tempRoot },
  });
  assert.equal(snapshot.connection.available, true);
  assert.equal(snapshot.connection.sameReportDate, true);
  assert.equal(snapshot.decisionGate.status, "blocked");
  assert.ok(
    snapshot.decisionGate.blockers.some(
      (blocker) => blocker.code === "market_coverage_incomplete"
    )
  );
  assert.ok(
    snapshot.decisionGate.blockers.some(
      (blocker) => blocker.code === "insufficient_quantitative_evidence"
    )
  );
  assert.equal(snapshot.report.verifiedEvents.length, 0);
  assert.equal(snapshot.pipeline.reviewQueue.length, 15);
  assert.equal(snapshot.pipeline.reviewQueue[0].title, "검증 전 후보 1");
  assert.equal(snapshot.pipeline.reviewQueue[0].priorityScore, 42);
  assert.equal(snapshot.scoreboard.cards[0].label, "RSP/SPY");
  assert.equal(snapshot.marketInternals.sectors["5d"][0].ticker, "XLE");
  assert.equal(snapshot.marketInternals.provider.alpacaBatchEnabled, true);
  assert.equal(snapshot.marketInternals.provider.alpacaFeed, "iex");
  assert.equal(snapshot.marketInternals.constituentBreadth.advancePct, 61.2);
  assert.equal(snapshot.marketInternals.constituentBreadth.above200dPct, 70);
  assert.equal(snapshot.marketInternals.sectorBreadth.readyCount, 1);
  assert.equal(snapshot.marketInternals.sectorBreadth.sectors[0].advancePct, 68.2);
  assert.equal(snapshot.marketInternals.stylePairs[0].relative1d, 0.2);
  assert.equal(snapshot.marketInternals.stylePairs[0].relative20d, 2.4);
  assert.equal(snapshot.sectorMetrics.metrics[0].score, 89.4);
  assert.equal(snapshot.stockCandidates.candidates[0].ticker, "NVDA");
  assert.equal(snapshot.stockCandidates.marketCoveredCount, 506);
  assert.equal(snapshot.stockCandidates.materialCandidateCount, 25);
  assert.equal(snapshot.stockCandidates.universeCoverage.sp500Count, 500);
  assert.equal(snapshot.stockCandidates.universeCoverage.nasdaq100Count, 0);
  assert.equal(snapshot.decisionChain.status, "blocked");
  assert.equal(snapshot.decisionChain.sectors.length, 0);
  assert.equal(snapshot.decisionChain.candidates[0].researchPriority, "C");
  assert.equal(snapshot.decisionChain.ideaFunnel.priorityCounts.C, 1);
  assert.equal(snapshot.thesisMemory.available, true);
  assert.equal(snapshot.thesisMemory.pendingCandidates.length, 0);
  assert.equal(
    snapshot.decisionChain.candidates[0].exposureState,
    "needs_exposure_attribution",
  );
  assert.equal(snapshot.report.earningsWatch.status, "ready");
  assert.equal(snapshot.report.earningsWatch.companies[0].ticker, "NVDA");
  assert.equal(
    snapshot.report.earningsWatch.companies[0].estimateRevision.rows[0].evidenceLabel,
    "third_party_forward_estimate"
  );
  assert.equal(
    snapshot.report.earningsWatch.companies[0].guidance[0].evidenceLabel,
    "issuer_management_claim"
  );
});

test("PB Daily Intelligence selects the newest valid reader artifact", async () => {
  await writeJson(
    join(tempRoot, "v2_reader_reports", "2026-07-22", "reader_report.json"),
    { schema_version: "v2_reader_report.v1", report_date: "2026-07-22", title: "Old" }
  );
  await writeJson(
    join(tempRoot, "v2_reader_reports", "2026-07-24", "reader_report.json"),
    { schema_version: "v2_reader_report.v1", report_date: "2026-07-24", title: "Latest" }
  );
  const snapshot = await loadPbDailyIntelligenceSnapshot({
    env: { PB_DAILY_INTELLIGENCE_DIR: tempRoot },
  });
  assert.equal(snapshot.report.title, "Latest");
  assert.equal(snapshot.connection.readerDate, "2026-07-24");
});

test("PB Daily Intelligence reports Telegram readiness and event consolidation without exposing secrets", async () => {
  const reportDate = "2026-07-24";
  await writeJson(
    join(tempRoot, "v2_reader_reports", reportDate, "reader_report.json"),
    { schema_version: "v2_reader_report.v1", report_date: reportDate, title: "Telegram monitor" }
  );
  await writeJson(
    join(tempRoot, "telegram_channels.json"),
    {
      schema_version: "telegram_channel_registry.v1",
      collection_policy: {},
      channels: [
        {
          username: "pb_channel_one",
          name: "PB 채널 1",
          category: "market_commentary",
          origin: "user_supplied",
          priority: 1,
          enabled: true,
          publication_policy: "internal_summary_with_attribution",
        },
        {
          username: "pb_channel_two",
          name: "PB 채널 2",
          category: "broker_research",
          origin: "user_supplied",
          priority: 2,
          enabled: true,
          publication_policy: "link_only_bounded_summary",
        },
      ],
    }
  );
  await writeFile(
    join(tempRoot, ".env"),
    [
      "TELEGRAM_API_ID=12345",
      "TELEGRAM_API_HASH=secret-hash",
      "TELEGRAM_SESSION_STRING=secret-session",
    ].join("\n"),
    "utf8"
  );
  await writeJson(
    join(tempRoot, "source_status", reportDate, "source_status_090000.json"),
    {
      report_date: reportDate,
      sources: [{ source_id: "telegram_channels", status: "ok", item_count: 3 }],
    }
  );
  await writeJson(
    join(tempRoot, "triaged", reportDate, "triaged_inbox.json"),
    [
      {
        id: "tg-1",
        title: "같은 시장 사건 첫 관점",
        url: "https://t.me/pb_channel_one/1",
        published_at: "2026-07-24T01:00:00Z",
        source_id: "telegram_pb_channel_one",
        source_type: "telegram_commentary",
        telegram: { channel_username: "pb_channel_one", channel_name: "PB 채널 1" },
        event_cluster: { event_id: "event-shared", event_type: "macro_policy" },
      },
      {
        id: "tg-2",
        title: "같은 시장 사건 두 번째 관점",
        url: "https://t.me/pb_channel_two/2",
        published_at: "2026-07-24T02:00:00Z",
        source_id: "telegram_pb_channel_two",
        source_type: "telegram_commentary",
        telegram: { channel_username: "pb_channel_two", channel_name: "PB 채널 2" },
        event_cluster: { event_id: "event-shared", event_type: "macro_policy" },
      },
      {
        id: "tg-3",
        title: "별도 시장 사건",
        url: "https://t.me/pb_channel_one/3",
        published_at: "2026-07-24T03:00:00Z",
        source_id: "telegram_pb_channel_one",
        source_type: "telegram_commentary",
        telegram: { channel_username: "pb_channel_one", channel_name: "PB 채널 1" },
        event_cluster: { event_id: "event-other" },
      },
    ]
  );

  const snapshot = await loadPbDailyIntelligenceSnapshot({
    env: {
      PB_DAILY_INTELLIGENCE_DIR: tempRoot,
      PB_DAILY_INTELLIGENCE_ENGINE_DIR: tempRoot,
    },
  });
  assert.equal(snapshot.telegramSources.channelCount, 2);
  assert.equal(snapshot.telegramSources.credentials.ready, true);
  assert.equal(snapshot.telegramSources.collection.itemCount, 3);
  assert.equal(snapshot.telegramSources.deduplication.rawPostCount, 3);
  assert.equal(snapshot.telegramSources.deduplication.eventClusterCount, 2);
  assert.equal(snapshot.telegramSources.deduplication.consolidatedPostCount, 1);
  assert.equal(snapshot.telegramSources.clusters[0].eventId, "event-shared");
  assert.equal(snapshot.telegramSources.clusters[0].postCount, 2);
  assert.deepEqual(snapshot.telegramSources.clusters[0].channels, ["PB 채널 1", "PB 채널 2"]);
  assert.equal(JSON.stringify(snapshot.telegramSources).includes("secret-session"), false);
  assert.equal(JSON.stringify(snapshot.telegramSources).includes("secret-hash"), false);
});

test("PB Daily Intelligence prefers the latest Telegram-only refresh artifact", async () => {
  const reportDate = "2026-07-27";
  await writeJson(
    join(tempRoot, "v2_reader_reports", reportDate, "reader_report.json"),
    { schema_version: "v2_reader_report.v1", report_date: reportDate, title: "Live Telegram" }
  );
  await writeJson(
    join(tempRoot, "telegram_channels.json"),
    {
      schema_version: "telegram_channel_registry.v1",
      collection_policy: {},
      channels: [{
        username: "pb_channel_one",
        name: "PB 채널 1",
        category: "market_commentary",
        origin: "user_supplied",
        priority: 1,
        enabled: true,
        publication_policy: "internal_summary_with_attribution",
      }],
    }
  );
  await writeJson(
    join(tempRoot, "telegram_refresh", "2026-07-28", "telegram_intelligence.json"),
    {
      schema_version: "telegram_intelligence_refresh.v1",
      generated_at: "2026-07-28T12:34:56+09:00",
      status: "ok",
      raw_post_count: 12,
      deduplicated_post_count: 9,
      duplicate_post_count: 3,
      event_cluster_count: 2,
      represented_channel_count: 1,
      pdf_attachment_count: 1,
      pdf_attachments: [{
        attachment_key: "telegram-pdf-key",
        filename: "global-strategy.pdf",
        mime_type: "application/pdf",
        size: 2048,
        channel_username: "pb_channel_one",
        channel_name: "PB 채널 1",
        message_id: 11,
        post_url: "https://t.me/pb_channel_one/11",
        published_at: "2026-07-28T03:00:00Z",
        title: "글로벌 전략",
      }],
      clusters: [{
        event_id: "event-live",
        title: "실시간 텔레그램 사건",
        event_type: "market_structure",
        verification_status: "discovery_metadata_only",
        latest_published_at: "2026-07-27T03:00:00Z",
        post_count: 4,
        channels: ["PB 채널 1"],
        post_urls: ["https://t.me/pb_channel_one/10"],
      }],
    }
  );

  const snapshot = await loadPbDailyIntelligenceSnapshot({
    env: {
      PB_DAILY_INTELLIGENCE_DIR: tempRoot,
      PB_DAILY_INTELLIGENCE_ENGINE_DIR: tempRoot,
    },
  });
  assert.equal(snapshot.telegramSources.collection.reportDate, "2026-07-28");
  assert.equal(snapshot.telegramSources.collection.lastCollectedAt, "2026-07-28T12:34:56+09:00");
  assert.equal(snapshot.telegramSources.collection.itemCount, 12);
  assert.equal(snapshot.telegramSources.deduplication.consolidatedPostCount, 3);
  assert.equal(snapshot.telegramSources.clusters[0].eventId, "event-live");
  assert.equal(snapshot.telegramSources.pdfAttachmentCount, 1);
  assert.equal(snapshot.telegramSources.pdfAttachments[0].filename, "global-strategy.pdf");
});

test("PB Daily Intelligence exposes a rights-safe analyst research digest", async () => {
  const reportDate = "2026-07-24";
  await writeJson(
    join(tempRoot, "v2_reader_reports", reportDate, "reader_report.json"),
    { schema_version: "v2_reader_report.v1", report_date: reportDate, title: "Research monitor" }
  );
  await writeJson(
    join(tempRoot, "broker_research_digest", reportDate, "broker_research_digest.json"),
    {
      schema_version: "broker_research_digest.v1",
      report_date: reportDate,
      generated_at: "2026-07-24T08:00:00+09:00",
      summary: {
        archived_report_count: 2,
        selected_report_count: 2,
        structured_report_count: 1,
        awaiting_analysis_count: 1,
        publisher_count: 2,
        analysis_status: "complete",
        telegram_linked_report_count: 1,
        stance_counts: { positive: 1, cautious: 1 },
      },
      consensus: {
        top_tickers: [{ ticker: "NVDA", report_count: 2 }],
        sector_assessments: [
          {
            sector: "semiconductor",
            report_count: 2,
            signal: "mixed",
            stance_counts: { positive: 1, cautious: 1 },
            catalysts: ["AI demand"],
            risks: ["Valuation"],
            monitoring_conditions: ["Next earnings"],
          },
        ],
        disagreements: [
          { topic: "NVDA", stances: ["positive", "cautious"], report_count: 2 },
        ],
      },
      reports: [
        {
          report_id: "research-1",
          publisher: "Example Securities",
          analyst: "A. Analyst",
          title: "NVDA earnings review",
          published_at: "2026-07-24T07:00:00+09:00",
          report_type: "earnings",
          market_scope: "US",
          issuer_country: "US",
          original_language: "en",
          base_currency: "USD",
          original_rating: "Overweight",
          normalized_rating: "positive",
          target_price: {
            value: 240,
            currency: "USD",
            as_of: "2026-07-24",
          },
          stance: "positive",
          tickers: ["NVDA"],
          sectors: ["semiconductor"],
          summary: "Demand remains constructive.",
          key_claims: ["Estimate direction improved."],
          catalysts: [],
          risks: ["Valuation"],
          monitoring_conditions: ["Next earnings"],
          source: { reference: "REF-1", url: "https://example.com/research-1" },
          processing: { structured_analysis_available: true, status: "ready" },
          linked_telegram_events: [
            {
              event_id: "event-nvda",
              title: "NVDA demand update",
              score: 5,
              match_reasons: ["ticker:NVDA"],
              telegram_url: "https://t.me/pb/1",
              channel: "PB Channel",
            },
          ],
        },
        {
          report_id: "research-2",
          publisher: "SK증권",
          analyst: "B. Analyst",
          title: "국내 반도체 업황",
          published_at: "2026-07-24T08:00:00+09:00",
          report_type: "industry",
          stance: "not_stated",
          tickers: ["005930"],
          sectors: ["반도체"],
          summary: "Legacy artifacts infer the domestic market from the publisher.",
          source: { reference: "REF-2", url: "" },
          processing: { structured_analysis_available: true, status: "ready" },
        },
      ],
    }
  );

  const snapshot = await loadPbDailyIntelligenceSnapshot({
    env: { PB_DAILY_INTELLIGENCE_DIR: tempRoot },
  });
  assert.equal(snapshot.brokerResearch.summary.selectedReportCount, 2);
  assert.equal(snapshot.brokerResearch.reports[0].publisher, "Example Securities");
  assert.equal(snapshot.brokerResearch.consensus.disagreements[0].topic, "NVDA");
  assert.equal(snapshot.brokerResearch.consensus.sectorAssessments[0].signal, "mixed");
  assert.equal(
    snapshot.brokerResearch.consensus.sectorAssessments[0].monitoringConditions[0],
    "Next earnings"
  );
  assert.equal(snapshot.brokerResearch.reports[0].monitoringConditions[0], "Next earnings");
  assert.equal(snapshot.brokerResearch.summary.analysisStatus, "complete");
  assert.equal(snapshot.brokerResearch.reports[0].linkedTelegramEvents[0].eventId, "event-nvda");
  assert.equal(snapshot.brokerResearch.reports[0].marketScope, "US");
  assert.equal(snapshot.brokerResearch.reports[0].originalLanguage, "en");
  assert.equal(snapshot.brokerResearch.reports[0].rating.original, "Overweight");
  assert.equal(snapshot.brokerResearch.reports[0].targetPrice.value, 240);
  assert.equal(snapshot.brokerResearch.summary.marketScopeCounts.US, 1);
  assert.equal(snapshot.brokerResearch.summary.marketScopeCounts.KR, 1);
  assert.equal(snapshot.brokerResearch.reports[1].marketScope, "KR");
  assert.equal(snapshot.brokerResearchIndex.latest.reportCount, 2);
  assert.equal(snapshot.brokerResearchIndex.latest.domesticCount, 1);
  assert.equal(snapshot.brokerResearchIndex.latest.overseasCount, 1);
  assert.equal(snapshot.brokerResearchIndex.latest.targetPriceCount, 1);
  assert.equal(snapshot.brokerResearchIndex.history.length, 1);
  assert.equal(snapshot.brokerResearch.summary.sectorTaxonomyVersion, "research-sector-taxonomy.v3");
  assert.equal(snapshot.brokerResearch.reports[0].sectors[0], "semiconductor");
  assert.equal(
    snapshot.brokerResearch.reports[0].standardSectors[0].id,
    "semiconductors_ai_compute",
  );
  assert.equal(snapshot.brokerResearch.reports[1].sectors[0], "반도체");
  assert.equal(
    snapshot.brokerResearch.reports[1].standardSectors[0].id,
    "semiconductors_ai_compute",
  );
  assert.equal(snapshot.brokerResearch.consensus.coverage[0].sectorId, "semiconductors_ai_compute");
  assert.equal(snapshot.brokerResearch.consensus.coverage[0].sector, "반도체·AI 컴퓨트");
  assert.deepEqual(
    new Set(snapshot.brokerResearch.consensus.coverage[0].sourceLabels),
    new Set(["반도체", "semiconductor"]),
  );
  assert.equal(snapshot.brokerResearch.consensus.coverage[0].reportCount, 2);
  assert.equal(snapshot.brokerResearch.consensus.coverage[0].publisherCount, 2);
  assert.equal(snapshot.brokerResearch.consensus.coverage[0].domesticCount, 1);
  assert.equal(snapshot.brokerResearch.consensus.coverage[0].overseasCount, 1);
  assert.equal(snapshot.brokerResearch.consensus.coverage[0].structuredCount, 2);
  assert.equal(snapshot.brokerResearch.consensus.coverage[0].ratedCount, 1);
  assert.equal(snapshot.brokerResearch.consensus.coverage[0].depth, "cross_checked");
  assert.deepEqual(
    snapshot.brokerResearch.consensus.coverage[0].topTickers,
    [
      { ticker: "005930", reportCount: 1 },
      { ticker: "NVDA", reportCount: 1 },
    ],
  );
  assert.equal(JSON.stringify(snapshot.brokerResearch).includes("raw_text"), false);
});

test("PB Daily Intelligence shows newer analyst research independently of the reader date", async () => {
  const readerDate = "2026-07-24";
  const researchDate = "2026-07-25";
  await writeJson(
    join(tempRoot, "v2_reader_reports", readerDate, "reader_report.json"),
    { schema_version: "v2_reader_report.v1", report_date: readerDate, title: "Prior reader report" }
  );
  await writeJson(
    join(tempRoot, "broker_research_digest", readerDate, "broker_research_digest.json"),
    {
      schema_version: "broker_research_digest.v1",
      report_date: readerDate,
      summary: { selected_report_count: 0, analysis_status: "no_eligible_reports" },
      consensus: {},
      reports: [],
    }
  );
  await writeJson(
    join(tempRoot, "broker_research_digest", researchDate, "broker_research_digest.json"),
    {
      schema_version: "broker_research_digest.v1",
      report_date: researchDate,
      summary: {
        selected_report_count: 3,
        structured_report_count: 3,
        publisher_count: 1,
        analysis_status: "complete",
      },
      consensus: {},
      reports: [],
    }
  );

  const snapshot = await loadPbDailyIntelligenceSnapshot({
    env: { PB_DAILY_INTELLIGENCE_DIR: tempRoot },
  });
  assert.equal(snapshot.connection.readerDate, readerDate);
  assert.equal(snapshot.brokerResearch.reportDate, researchDate);
  assert.equal(snapshot.brokerResearch.summary.selectedReportCount, 3);
  assert.equal(snapshot.brokerResearch.summary.analysisStatus, "complete");
  assert.deepEqual(snapshot.brokerResearchHistory.availableDates, [researchDate, readerDate]);
  assert.equal(snapshot.brokerResearchHistory.selectedDate, researchDate);
  assert.equal(snapshot.brokerResearchHistory.latestDate, researchDate);
  assert.equal(snapshot.brokerResearchIndex.history.length, 2);
  assert.equal(snapshot.brokerResearchIndex.latest.date, researchDate);
  assert.equal(snapshot.brokerResearchIndex.latest.reportCount, 3);
  assert.equal(snapshot.brokerResearchIndex.change.reportCount, 3);

  const priorSnapshot = await loadPbDailyIntelligenceSnapshot({
    env: { PB_DAILY_INTELLIGENCE_DIR: tempRoot },
    brokerResearchDate: readerDate,
  });
  assert.equal(priorSnapshot.brokerResearch.reportDate, readerDate);
  assert.equal(priorSnapshot.brokerResearchHistory.selectedDate, readerDate);
});

test("PB Daily Intelligence tracks standardized sector coverage across research dates", async () => {
  const priorDate = "2026-07-27";
  const latestDate = "2026-07-28";
  await writeJson(
    join(tempRoot, "v2_reader_reports", latestDate, "reader_report.json"),
    { schema_version: "v2_reader_report.v1", report_date: latestDate, title: "Sector trend" },
  );
  await writeJson(
    join(tempRoot, "broker_research_digest", priorDate, "broker_research_digest.json"),
    {
      schema_version: "broker_research_digest.v1",
      report_date: priorDate,
      summary: {
        selected_report_count: 1,
        structured_report_count: 1,
        publisher_count: 1,
        analysis_status: "complete",
      },
      consensus: {},
      reports: [{
        report_id: "prior-semiconductor",
        publisher: "Prior Securities",
        title: "Memory update",
        market_scope: "US",
        sectors: ["Semiconductors"],
        stance: "positive",
        key_claims: ["Legacy memory thesis"],
        catalysts: ["Prior catalyst"],
        risks: ["Shared risk"],
        processing: { structured_analysis_available: true, status: "ready" },
      }],
    },
  );
  await writeJson(
    join(tempRoot, "broker_research_digest", latestDate, "broker_research_digest.json"),
    {
      schema_version: "broker_research_digest.v1",
      report_date: latestDate,
      summary: {
        selected_report_count: 2,
        structured_report_count: 2,
        publisher_count: 2,
        analysis_status: "complete",
      },
      consensus: {},
      reports: [
        {
          report_id: "latest-semiconductor-1",
          publisher: "Latest Securities",
          title: "AI compute update",
          market_scope: "US",
          sectors: ["semiconductor"],
          normalized_rating: "positive",
          key_claims: ["AI demand expanded"],
          catalysts: ["New accelerator cycle"],
          risks: ["Shared risk"],
          processing: { structured_analysis_available: true, status: "ready" },
        },
        {
          report_id: "latest-semiconductor-2",
          publisher: "국내증권",
          title: "메모리 업황",
          sectors: ["반도체"],
          stance: "neutral",
          key_claims: ["AI demand expanded"],
          processing: { structured_analysis_available: true, status: "ready" },
        },
      ],
    },
  );

  const snapshot = await loadPbDailyIntelligenceSnapshot({
    env: { PB_DAILY_INTELLIGENCE_DIR: tempRoot },
  });
  const sectorHistory = snapshot.brokerResearchIndex.sectorHistory;
  assert.equal(sectorHistory.length, 2);
  assert.deepEqual(sectorHistory.map((point) => point.date), [priorDate, latestDate]);
  assert.equal(sectorHistory[0].sectors[0].sectorId, "semiconductors_ai_compute");
  assert.equal(sectorHistory[0].sectors[0].reportCount, 1);
  assert.equal(sectorHistory[0].sectors[0].publisherCount, 1);
  assert.deepEqual(sectorHistory[0].sectors[0].claims, ["Legacy memory thesis"]);
  assert.deepEqual(sectorHistory[0].sectors[0].catalysts, ["Prior catalyst"]);
  assert.deepEqual(sectorHistory[0].sectors[0].risks, ["Shared risk"]);
  assert.equal(sectorHistory[0].sectors[0].publisherOpinion.status, "single_source");
  assert.equal(sectorHistory[0].sectors[0].publisherOpinion.ratedPublisherCount, 1);
  assert.equal(sectorHistory[1].sectors[0].sectorId, "semiconductors_ai_compute");
  assert.equal(sectorHistory[1].sectors[0].reportCount, 2);
  assert.equal(sectorHistory[1].sectors[0].publisherCount, 2);
  assert.deepEqual(sectorHistory[1].sectors[0].claims, ["AI demand expanded"]);
  assert.deepEqual(sectorHistory[1].sectors[0].catalysts, ["New accelerator cycle"]);
  assert.deepEqual(sectorHistory[1].sectors[0].risks, ["Shared risk"]);
  assert.deepEqual(sectorHistory[1].sectors[0].publisherOpinion, {
    status: "divided",
    ratedPublisherCount: 2,
    mixedPublisherCount: 0,
    dominantStance: "",
    dominantSharePct: null,
    stances: {
      positive: ["Latest Securities"],
      neutral: ["국내증권"],
      cautious: [],
      negative: [],
      mixed: [],
    },
  });
  assert.deepEqual(sectorHistory[1].sectors[0].crossPublisherThemes, [{
    text: "AI demand expanded",
    publisherCount: 2,
    reportCount: 2,
    publishers: ["국내증권", "Latest Securities"],
    type: "claim",
  }]);
});

test("PB Daily Intelligence separates document scope labels from transport coverage", async () => {
  const reportDate = "2026-07-28";
  await writeJson(
    join(tempRoot, "v2_reader_reports", reportDate, "reader_report.json"),
    { schema_version: "v2_reader_report.v1", report_date: reportDate, title: "Scope test" },
  );
  await writeJson(
    join(tempRoot, "broker_research_digest", reportDate, "broker_research_digest.json"),
    {
      schema_version: "broker_research_digest.v1",
      report_date: reportDate,
      summary: {
        selected_report_count: 6,
        structured_report_count: 6,
        publisher_count: 6,
        analysis_status: "complete",
      },
      consensus: {},
      reports: [
        {
          report_id: "daily",
          publisher: "Daily Securities",
          title: "데일리 마켓",
          report_type: "strategy",
          sectors: ["데일리"],
          processing: { structured_analysis_available: true, status: "ready" },
        },
        {
          report_id: "all-research",
          publisher: "All Securities",
          title: "전체 리서치",
          report_type: "other",
          sectors: ["전체리서치"],
          processing: { structured_analysis_available: true, status: "ready" },
        },
        {
          report_id: "transport",
          publisher: "Transport Securities",
          title: "운송 위클리",
          report_type: "sector",
          sectors: ["운송"],
          processing: { structured_analysis_available: true, status: "ready" },
        },
        {
          report_id: "index-strategy",
          publisher: "Index Securities",
          title: "지수 전략",
          report_type: "strategy",
          sectors: ["지수"],
          processing: { structured_analysis_available: true, status: "ready" },
        },
        {
          report_id: "credit",
          publisher: "Credit Securities",
          title: "크레딧 위클리",
          report_type: "fixed_income",
          sectors: ["크레딧"],
          processing: { structured_analysis_available: true, status: "ready" },
        },
        {
          report_id: "compound-sector",
          publisher: "Compound Securities",
          title: "AI 인터넷 게임",
          report_type: "sector",
          sectors: ["AI인터넷게임"],
          processing: { structured_analysis_available: true, status: "ready" },
        },
      ],
    },
  );

  const snapshot = await loadPbDailyIntelligenceSnapshot({
    env: { PB_DAILY_INTELLIGENCE_DIR: tempRoot },
  });
  const reports = snapshot.brokerResearch.reports;
  assert.equal(reports[0].researchScope, "daily_digest");
  assert.equal(reports[1].researchScope, "multi_sector_digest");
  assert.equal(reports[2].researchScope, "sector");
  assert.equal(reports[3].researchScope, "market_strategy");
  assert.equal(reports[4].researchScope, "asset_class");
  assert.deepEqual(snapshot.brokerResearch.summary.researchScopeCounts, {
    daily_digest: 1,
    multi_sector_digest: 1,
    sector: 2,
    market_strategy: 1,
    asset_class: 1,
  });
  assert.equal(snapshot.brokerResearch.consensus.coverage.length, 3);
  const transportCoverage = snapshot.brokerResearch.consensus.coverage.find(
    (item) => item.sectorId === "transportation_logistics",
  );
  assert.equal(
    transportCoverage.sectorId,
    "transportation_logistics",
  );
  assert.equal(transportCoverage.sector, "운송·물류");
  assert.deepEqual(transportCoverage.sourceLabels, ["운송"]);
  const compoundReport = reports.find((report) => report.reportId === "compound-sector");
  assert.deepEqual(
    compoundReport.standardSectors.map((sector) => [sector.mappingRole, sector.id]),
    [
      ["primary", "consumer_internet_platforms"],
      ["secondary", "media_gaming_entertainment"],
    ],
  );
  assert.deepEqual(
    snapshot.brokerResearch.consensus.coverage
      .filter((item) => item.sourceLabels.includes("AI인터넷게임"))
      .map((item) => item.sectorId)
      .sort(),
    ["consumer_internet_platforms", "media_gaming_entertainment"],
  );
});
