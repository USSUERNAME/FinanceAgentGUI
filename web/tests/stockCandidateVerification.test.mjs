import test from "node:test";
import assert from "node:assert/strict";
import {
  STOCK_ANALYSIS_STAGE_IDS,
  STOCK_HORIZON_REQUIREMENTS,
  buildStockGateRolloutSimulation,
  buildStockResearchGatewaySnapshot,
  evaluateStockCandidateGate,
} from "../src/arca/stockCandidateVerification.js";

function completeContext() {
  return {
    asOf: "2026-08-10",
    updatedAt: "2026-08-10T07:00:00Z",
    rawCandidates: [{
      ticker: "ABNB",
      evidence: [{
        title: "ABNB 10-Q",
        sourceUrl: "https://www.sec.gov/Archives/abnb-10q",
        primaryConfirmed: true,
        factCount: 3,
      }],
    }],
    companyFilings: [{
      ticker: "ABNB",
      analysisStatus: "complete",
      filing: {
        form: "10-Q",
        filedDate: "2026-08-06",
        sourceUrl: "https://www.sec.gov/Archives/abnb-10q",
      },
      metrics: [{ value: 10 }, { value: 2 }],
      financialComparison: { rows: [{ metricId: "revenue" }, { metricId: "operating_income" }] },
      analysis: { risksKo: ["수요 둔화 시 마진이 낮아질 수 있습니다."] },
    }],
    earningsCompanies: [{
      ticker: "ABNB",
      valuationScreen: { status: "insufficient_peer_data", usablePeerCount: 0 },
      longTermAnalysis: {
        action: {
          reason: "현재 가격의 기대가 높습니다.",
          invalidationConditions: ["FCF와 마진이 동시에 훼손되면 가설을 폐기합니다."],
        },
      },
    }],
    reportSources: [],
  };
}

test("candidate gate promotes only evidence-complete candidates to B or higher", () => {
  const result = evaluateStockCandidateGate({
    ticker: "ABNB",
    companyName: "Airbnb",
    researchPriority: "C",
    whyNow: "실적 공시",
    primaryEvidenceCount: 1,
    verifiedFactCount: 2,
    reaction: { close: 180, return1d: 3.2, volumeRatio20d: 1.4 },
    valuationScreen: { status: "insufficient_peer_data", usablePeerCount: 0 },
  }, completeContext());

  assert.equal(result.gatePassed, true);
  assert.equal(result.grade, "B");
  assert.equal(result.allocationAllowed, true);
  assert.equal(result.dimensions.earnings, true);
  assert.equal(result.dimensions.catalyst, true);
  assert.equal(result.sources.length, 1);
  assert.equal(result.sources[0].evidenceTier, "authoritative");
  assert.equal(result.authoritativeSourceCount, 1);
  assert.ok(result.claims.some((claim) => claim.evidenceType === "공식 사실"));
  assert.ok(result.claims.some((claim) => claim.evidenceType === "작성자 추론"));
  assert.equal(result.integratedResearch.financialRows.length, 2);
  assert.equal(result.integratedResearch.scenarios.bear, "FCF와 마진이 동시에 훼손되면 가설을 폐기합니다.");
  assert.equal(result.analysisFramework.stages.length, 8);
  assert.equal(result.analysisFramework.completeness.total, 8);
  assert.equal(result.analysisFramework.tradeReadiness.tradeHorizon, "unclassified");
  assert.equal(result.analysisFramework.tradeReadiness.ready, false);
  assert.equal(result.tradeAllocationAllowed, false);
  assert.equal(result.allocationAllowed, true);
  assert.deepEqual(result.missingRequirements, []);
});

test("discovery and unverified sources never satisfy the authoritative gate", () => {
  const result = evaluateStockCandidateGate({
    ticker: "ONDS",
    whyNow: "커뮤니티 신호",
  }, {
    asOf: "2026-08-10",
    updatedAt: "2026-08-10T07:00:00Z",
    rawCandidates: [{
      ticker: "ONDS",
      evidence: [{
        title: "Secondary research note",
        sourceUrl: "https://example.com/research-note",
        sourceGrade: "B",
        primaryConfirmed: false,
        factCount: 4,
      }, {
        title: "Unknown link",
        sourceUrl: "https://example.net/post",
        primaryConfirmed: false,
      }],
    }],
  });

  assert.equal(result.primarySourceCount, 0);
  assert.equal(result.authoritativeSourceCount, 0);
  assert.equal(result.sourceTierCounts.discovery, 1);
  assert.equal(result.sourceTierCounts.unverified, 1);
  assert.equal(result.gatePassed, false);
  assert.ok(result.missingRequirements.includes("SEC·DART·기업 IR 1차 출처"));
});

test("framework implementation stays aligned with the policy config", async () => {
  const { readFile } = await import("node:fs/promises");
  const config = JSON.parse(await readFile(
    new URL("../../config/stock-analysis-framework.json", import.meta.url),
    "utf8",
  ));
  assert.deepEqual(STOCK_ANALYSIS_STAGE_IDS, config.stages.map((stage) => stage.id));
  assert.deepEqual(STOCK_HORIZON_REQUIREMENTS, config.horizonRequirements);
});

test("new trust gate rollout is simulated before it can change active grades", () => {
  const candidate = evaluateStockCandidateGate({
    ticker: "ABNB",
    companyName: "Airbnb",
    researchPriority: "C",
    whyNow: "실적 공시",
    primaryEvidenceCount: 1,
    verifiedFactCount: 2,
    reaction: { close: 180, return1d: 3.2, volumeRatio20d: 1.4 },
  }, completeContext());
  const simulation = buildStockGateRolloutSimulation([candidate]);

  assert.equal(candidate.grade, "B");
  assert.equal(simulation.activeGateChanged, false);
  assert.equal(simulation.currentPassingCount, 1);
  assert.equal(simulation.evidenceCorePassingCount, 1);
  assert.equal(simulation.targetPassingCount, 0);
  assert.equal(simulation.blockerCounts.trade_suitability, 1);
  assert.equal(simulation.activationDecision, "hold_activation");
});

test("community-style candidate stays C and blocks allocation when primary evidence is absent", () => {
  const result = evaluateStockCandidateGate({
    ticker: "ONDS",
    companyName: "Ondas",
    researchPriority: "C",
    whyNow: "커뮤니티 수급 언급",
    reaction: { close: 9, return1d: 18, volumeRatio20d: 4.1 },
  }, {
    asOf: "2026-08-10",
    updatedAt: "2026-08-10T07:00:00Z",
  });

  assert.equal(result.gatePassed, false);
  assert.equal(result.grade, "C");
  assert.equal(result.allocationAllowed, false);
  assert.equal(result.liquidityRisk.momentumRisk, true);
  assert.equal(result.claims.length, 0);
  assert.equal(result.macroPath.status, "partial");
  assert.ok(result.missingRequirements.includes("SEC·DART·기업 IR 1차 출처"));
  assert.ok(result.missingRequirements.includes("투자 가설 무효화 조건"));
});

test("macro path names evidence-gated Korean direct and industry targets", () => {
  const context = completeContext();
  context.koreaConnection = {
    companyTransmissions: [{
      sourceTicker: "NVDA",
      sectorNameKo: "반도체·AI 컴퓨트",
      targets: [{
        ticker: "000660",
        companyName: "SK하이닉스",
        classification: "direct",
        classificationLabel: "직접 연결",
        reason: "공식 공동개발·공급 관계와 HBM 사업 노출을 확인했습니다.",
      }, {
        ticker: "005930",
        companyName: "삼성전자",
        classification: "industry",
        classificationLabel: "산업 연결",
        reason: "HBM 사업 노출은 확인했지만 직접 공급 관계는 확인되지 않았습니다.",
      }],
    }],
  };
  const result = evaluateStockCandidateGate({ ticker: "NVDA" }, context);
  const koreaStep = result.macroPath.steps.find((step) => step.label === "한국시장 연결");
  assert.match(koreaStep.value, /SK하이닉스 직접 연결/);
  assert.match(koreaStep.value, /삼성전자 산업 연결/);
  assert.equal(koreaStep.evidenceType, "1차 자료 직접 연결");
});

test("gateway snapshot separates verified and review candidates", () => {
  const baseCandidate = {
    ticker: "ABNB",
    companyName: "Airbnb",
    researchPriority: "C",
    whyNow: "실적 공시",
    primaryEvidenceCount: 1,
    verifiedFactCount: 2,
    reaction: { close: 180, return1d: 3.2, volumeRatio20d: 1.4 },
  };
  const context = completeContext();
  const payload = {
    connection: { available: true },
    report: {
      reportDate: context.asOf,
      generatedAt: context.updatedAt,
      companyFilings: { companies: context.companyFilings },
      earningsWatch: { companies: context.earningsCompanies },
      sources: [],
    },
    stockCandidates: { candidates: context.rawCandidates },
    decisionChain: {
      ideaFunnel: {
        inputCount: 2,
        candidatePool: [baseCandidate, {
          ticker: "ONDS",
          researchPriority: "C",
          whyNow: "커뮤니티 수급 언급",
          reaction: { close: 9, return1d: 18, volumeRatio20d: 4.1 },
        }],
      },
    },
  };

  const snapshot = buildStockResearchGatewaySnapshot(payload);
  assert.equal(snapshot.verifiedCandidates.length, 1);
  assert.equal(snapshot.verifiedCandidates[0].ticker, "ABNB");
  assert.equal(snapshot.reviewCandidates.length, 1);
  assert.equal(snapshot.reviewCandidates[0].ticker, "ONDS");
});
