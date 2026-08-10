const TICKER_PATTERN = /^[A-Z][A-Z0-9.-]{0,14}$/;

export const STOCK_ANALYSIS_STAGE_IDS = [
  "business_structure",
  "trade_suitability",
  "growth_quality",
  "financial_statements",
  "market_expectations",
  "valuation",
  "catalyst_risk",
  "technical_trade_plan",
];

export const STOCK_TRADE_HORIZONS = ["day", "earnings", "position", "long_term"];

export const STOCK_HORIZON_REQUIREMENTS = {
  day: ["trade_suitability", "technical_trade_plan"],
  earnings: ["trade_suitability", "market_expectations", "catalyst_risk", "technical_trade_plan"],
  position: ["trade_suitability", "valuation", "catalyst_risk", "technical_trade_plan"],
  long_term: ["business_structure", "growth_quality", "financial_statements", "valuation", "catalyst_risk"],
};

function list(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function text(value) {
  return String(value || "").trim();
}

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function tickerOf(value) {
  const ticker = text(value).toUpperCase();
  return TICKER_PATTERN.test(ticker) ? ticker : "";
}

function sourceKey(source) {
  return `${text(source?.url).toLowerCase()}|${text(source?.title).toLowerCase()}`;
}

function uniqueSources(sources) {
  const seen = new Set();
  return sources.filter((source) => {
    if (!source?.url) return false;
    const key = sourceKey(source);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizedEvidenceTier(source, fallback = {}) {
  const explicit = text(source?.evidenceTier || source?.sourceTier || fallback.evidenceTier);
  if (["authoritative", "discovery", "unverified"].includes(explicit)) return explicit;
  if (source?.primaryConfirmed === true || fallback.primary === true) return "authoritative";
  const grade = text(source?.sourceGrade || fallback.sourceGrade).toUpperCase();
  const type = text(source?.type || source?.eventType || fallback.type).toLowerCase();
  if (["B", "C"].includes(grade) || /media|news|research|report|언론|리서치/.test(type)) {
    return "discovery";
  }
  return "unverified";
}

function normalizedSource(source, fallback = {}) {
  const url = text(source?.sourceUrl || source?.url);
  if (!/^https?:\/\//i.test(url)) return null;
  const evidenceTier = normalizedEvidenceTier(source, fallback);
  return {
    title: text(source?.title) || fallback.title || "원문",
    url,
    type: text(source?.type || source?.eventType || fallback.type)
      || (evidenceTier === "authoritative"
        ? "공식 사실"
        : evidenceTier === "discovery"
          ? "탐색 출처"
          : "미검증"),
    sourceGrade: text(source?.sourceGrade || fallback.sourceGrade),
    asOf: text(source?.asOf || fallback.asOf),
    evidenceTier,
    primary: evidenceTier === "authoritative",
  };
}

function primarySourceCount(candidate, rawCandidate, filing, sources) {
  const explicit = Math.max(
    Number(candidate?.primaryEvidenceCount || 0),
    list(rawCandidate?.evidence).filter((item) => item?.primaryConfirmed).length,
  );
  return Math.max(
    explicit,
    filing?.filing?.sourceUrl ? 1 : 0,
    sources.filter((item) => item.evidenceTier === "authoritative").length,
  );
}

function verifiedFactCount(candidate, rawCandidate, filing) {
  const rawFacts = list(rawCandidate?.evidence).reduce(
    (sum, item) => sum + Math.max(0, Number(item?.factCount || 0)),
    0,
  );
  const filingFacts = list(filing?.metrics).filter((metric) => metric?.value !== null).length;
  return Math.max(Number(candidate?.verifiedFactCount || 0), rawFacts, filingFacts);
}

function valuationReady(candidate, earningsCompany) {
  const valuation = candidate?.valuationScreen || earningsCompany?.valuationScreen || {};
  if (valuation?.status === "available" || valuation?.status === "ready") return true;
  if (Number(valuation?.usablePeerCount || 0) >= Number(valuation?.minimumPeerCount || 2)) return true;
  return earningsCompany?.longTermAnalysis?.judgmentFramework?.decisions?.stockAttractiveness?.status === "met";
}

function liquidityRiskCheck(candidate) {
  const reaction = candidate?.reaction || {};
  const close = finite(reaction.close);
  const return1d = finite(reaction.return1d);
  const volumeRatio20d = finite(reaction.volumeRatio20d);
  const checked = close !== null && close > 0 && return1d !== null && volumeRatio20d !== null;
  const momentumRisk = checked && (Math.abs(return1d) >= 15 || volumeRatio20d >= 3);
  return {
    checked,
    momentumRisk,
    label: !checked
      ? "가격·거래량 위험 점검 자료 부족"
      : momentumRisk
        ? "급등락·거래량 과열 주의"
        : "가격·거래량 위험 점검 완료",
  };
}

function normalizedTradeHorizon(candidate) {
  const value = text(candidate?.tradePlan?.tradeHorizon || candidate?.tradeHorizon);
  return STOCK_TRADE_HORIZONS.includes(value) ? value : "unclassified";
}

function buildFinancialWarnings(rows = []) {
  const rowById = new Map(list(rows).map((row) => [text(row?.metricId), row]));
  const change = (id) => finite(rowById.get(id)?.changePct);
  const warnings = [];
  const revenueChange = change("revenue");
  const operatingIncomeChange = change("operating_income");
  const netIncomeChange = change("net_income");
  const operatingCashFlowChange = change("operating_cash_flow");

  if (revenueChange > 0 && operatingIncomeChange < 0) {
    warnings.push({
      id: "revenue_up_operating_income_down",
      severity: "warning",
      metricIds: ["revenue", "operating_income"],
      label: "매출 증가에도 영업이익이 감소했습니다.",
    });
  }
  if (netIncomeChange > 0 && operatingCashFlowChange < 0) {
    warnings.push({
      id: "net_income_up_operating_cash_flow_down",
      severity: "warning",
      metricIds: ["net_income", "operating_cash_flow"],
      label: "순이익 증가와 영업현금흐름 감소가 엇갈립니다.",
    });
  }
  if (operatingIncomeChange > 0 && operatingCashFlowChange < 0) {
    warnings.push({
      id: "operating_income_up_operating_cash_flow_down",
      severity: "warning",
      metricIds: ["operating_income", "operating_cash_flow"],
      label: "영업이익 증가가 영업현금흐름으로 이어지지 않았습니다.",
    });
  }
  return warnings;
}

function stageStatus(id, status, reason, data = null) {
  return {
    id,
    status,
    completed: status === "verified",
    reason,
    data,
  };
}

function buildTradeSuitability(candidate) {
  const reaction = candidate?.reaction || {};
  const close = finite(reaction.close);
  const avgVolume20d = finite(reaction.avgVolume20d);
  const avgDailyDollarVolume = close !== null && avgVolume20d !== null
    ? close * avgVolume20d
    : null;
  const data = {
    marketCap: finite(candidate?.marketCap),
    close,
    volume: finite(reaction.volume),
    avgVolume20d,
    avgDailyDollarVolume,
    spreadBps: finite(candidate?.spreadBps),
    atrPct: finite(candidate?.atrPct),
    freeFloat: finite(candidate?.freeFloat),
    volumeRatio20d: finite(reaction.volumeRatio20d),
  };
  const missingFields = ["marketCap", "avgDailyDollarVolume", "spreadBps", "atrPct", "freeFloat"]
    .filter((field) => data[field] === null);
  return {
    status: missingFields.length ? "insufficient" : "verified",
    reason: missingFields.length
      ? `거래 적합성 자료 부족: ${missingFields.join(", ")}`
      : "시총·거래대금·스프레드·ATR·유통주식 자료가 확인됐습니다.",
    missingFields,
    ...data,
  };
}

function buildMarketExpectations(candidate, earningsCompany) {
  const providerEstimate = candidate?.estimateRevision || earningsCompany?.estimateRevision || null;
  const providerRows = list(providerEstimate?.rows);
  return {
    status: "insufficient",
    reason: providerRows.length
      ? "제공자 추정치는 있으나 전체 컨센서스의 기여자 범위·동결시각·방법론이 검증되지 않았습니다."
      : "검증된 EPS·매출 컨센서스와 옵션 예상 변동폭 자료가 없습니다.",
    providerEstimate,
    providerEstimateStatus: providerRows.length ? "discovery" : "insufficient",
    earningsConsensus: null,
    revenueConsensus: null,
    estimateRevision: null,
    impliedMove: null,
  };
}

function buildAnalysisFramework(candidate, filing, earningsCompany) {
  const integrated = candidate.integratedResearch || {};
  const tradeSuitability = buildTradeSuitability(candidate);
  const marketExpectations = buildMarketExpectations(candidate, earningsCompany);
  const tradeHorizon = normalizedTradeHorizon(candidate);
  const tradePlan = {
    tradeHorizon,
    entryCondition: text(candidate?.tradePlan?.entryCondition),
    addCondition: text(candidate?.tradePlan?.addCondition),
    exitCondition: text(candidate?.tradePlan?.exitCondition),
    maxLossPct: finite(candidate?.tradePlan?.maxLossPct),
    positionSizePct: finite(candidate?.tradePlan?.positionSizePct),
  };
  const hasTradePlan = tradeHorizon !== "unclassified"
    && Boolean(tradePlan.exitCondition)
    && (tradeHorizon === "long_term" || Boolean(tradePlan.entryCondition));
  const growthBridge = integrated.growthBridge || null;
  const financialReady = list(integrated.financialRows).length >= 2;
  const valuationIsReady = valuationReady(candidate, earningsCompany);
  const catalystRiskReady = list(integrated.catalysts).length > 0
    && Boolean(candidate.counterEvidence)
    && list(candidate.invalidationConditions).length > 0;
  const stages = [
    stageStatus(
      "business_structure",
      integrated.businessSummary ? "verified" : "insufficient",
      integrated.businessSummary ? "공식 공시 기반 사업 요약이 있습니다." : "사업 구조 자료가 부족합니다.",
      {
        businessSummary: integrated.businessSummary || "",
        productMix: integrated.productMix || null,
        geographicMix: integrated.geographicMix || null,
        recurringRevenueShare: integrated.recurringRevenueShare || null,
      },
    ),
    stageStatus("trade_suitability", tradeSuitability.status, tradeSuitability.reason, tradeSuitability),
    stageStatus(
      "growth_quality",
      growthBridge ? "verified" : "insufficient",
      growthBridge ? "성장을 물량·가격·믹스·M&A로 분해했습니다." : "성장 원인 분해 자료가 부족합니다.",
      growthBridge,
    ),
    stageStatus(
      "financial_statements",
      financialReady ? "verified" : "insufficient",
      financialReady ? "비교 가능한 재무제표 항목이 2개 이상입니다." : "비교 가능한 재무제표 항목이 부족합니다.",
      {
        financialRows: list(integrated.financialRows),
        segmentRows: list(integrated.segmentRows),
        warnings: list(integrated.financialWarnings),
      },
    ),
    stageStatus("market_expectations", marketExpectations.status, marketExpectations.reason, marketExpectations),
    stageStatus(
      "valuation",
      valuationIsReady ? "verified" : "insufficient",
      valuationIsReady ? "비교 가능한 밸류에이션 근거가 있습니다." : "업종에 맞는 비교 가능한 밸류에이션 근거가 부족합니다.",
      { screen: integrated.valuation || null, sectorKpis: integrated.sectorKpis || null },
    ),
    stageStatus(
      "catalyst_risk",
      catalystRiskReady ? "verified" : "insufficient",
      catalystRiskReady ? "촉매·반대근거·무효화조건이 연결됐습니다." : "촉매·반대근거·무효화조건 중 일부가 부족합니다.",
      {
        catalysts: list(integrated.catalysts),
        risks: list(integrated.risks),
        counterEvidence: candidate.counterEvidence || "",
        invalidationConditions: list(candidate.invalidationConditions),
      },
    ),
    stageStatus(
      "technical_trade_plan",
      hasTradePlan ? "verified" : "insufficient",
      hasTradePlan ? "선택한 매매 유형의 진입·정리 규칙이 있습니다." : "매매 유형과 진입·정리 규칙이 필요합니다.",
      tradePlan,
    ),
  ];
  const completed = stages.filter((stage) => stage.completed).length;
  const stageById = new Map(stages.map((stage) => [stage.id, stage]));
  const requiredStageIds = STOCK_HORIZON_REQUIREMENTS[tradeHorizon] || [];
  const missingStageIds = requiredStageIds.filter((stageId) => !stageById.get(stageId)?.completed);
  return {
    schemaVersion: "stock_analysis_framework.v1",
    stages,
    completeness: { completed, total: 8, label: `${completed}/8` },
    tradeReadiness: {
      tradeHorizon,
      ready: tradeHorizon !== "unclassified" && missingStageIds.length === 0,
      requiredStageIds,
      missingStageIds,
      reason: tradeHorizon === "unclassified"
        ? "매매 유형을 선택해야 합니다."
        : missingStageIds.length
          ? `필수 분석 축 부족: ${missingStageIds.join(", ")}`
          : "선택한 매매 유형의 필수 분석 축이 준비됐습니다.",
    },
  };
}

function missingLabel(id) {
  return {
    ticker: "티커 식별",
    primarySource: "SEC·DART·기업 IR 1차 출처",
    verifiedFacts: "검증된 핵심 사실 2개",
    dimensions: "실적·밸류에이션·촉매 중 2개",
    liquidityRisk: "유동성·급등주 위험 점검",
    counterEvidence: "반대 근거",
    invalidation: "투자 가설 무효화 조건",
    dates: "데이터 기준일·최근 갱신 시각",
  }[id] || id;
}

function formatClaimValue(metric) {
  const value = finite(metric?.value);
  if (value === null) return "";
  const unit = text(metric?.unit);
  const formatted = Math.abs(value) >= 1000
    ? new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value)
    : String(value);
  return `${formatted}${unit ? ` ${unit}` : ""}`;
}

function buildClaimLedger({ candidate, rawCandidate, filing, updatedAt }) {
  const filingUrl = text(filing?.filing?.sourceUrl);
  const filingClaims = list(filing?.metrics).slice(0, 5).map((metric) => ({
    id: `${candidate.ticker}-filing-${text(metric?.metricId)}`,
    claim: `${text(metric?.labelKo) || text(metric?.metricId)} ${formatClaimValue(metric)}`.trim(),
    evidenceType: "공식 사실",
    evidenceTier: "authoritative",
    sourceTitle: `${candidate.ticker} ${text(filing?.filing?.form) || "공시"}`,
    sourceUrl: filingUrl,
    publishedAt: text(filing?.filing?.filedDate),
    dataAsOf: text(metric?.periodEnd || filing?.filing?.periodEnd),
    retrievedAt: updatedAt,
  })).filter((claim) => claim.claim && claim.sourceUrl);
  const eventClaims = list(rawCandidate?.evidence).map((evidence, index) => ({
    id: `${candidate.ticker}-event-${index}`,
    claim: text(evidence?.title) || `${candidate.ticker} 이벤트 근거`,
    evidenceType: evidence?.primaryConfirmed ? "공식 사실" : "언론 보도",
    evidenceTier: evidence?.primaryConfirmed ? "authoritative" : "discovery",
    sourceTitle: text(evidence?.title) || "이벤트 원문",
    sourceUrl: text(evidence?.sourceUrl),
    publishedAt: "",
    dataAsOf: text(candidate.asOf),
    retrievedAt: updatedAt,
  })).filter((claim) => /^https?:\/\//i.test(claim.sourceUrl));
  const inferenceClaims = [
    text(filing?.analysis?.thesisEffectReasonKo),
    text(filing?.analysis?.risksKo?.[0]),
  ].filter(Boolean).map((claim, index) => ({
    id: `${candidate.ticker}-inference-${index}`,
    claim,
    evidenceType: "작성자 추론",
    evidenceTier: "discovery",
    sourceTitle: `${candidate.ticker} ${text(filing?.filing?.form) || "공시"} 기반 분석`,
    sourceUrl: filingUrl,
    publishedAt: text(filing?.filing?.filedDate),
    dataAsOf: text(filing?.filing?.periodEnd),
    retrievedAt: updatedAt,
  })).filter((claim) => claim.sourceUrl);
  return [...filingClaims, ...eventClaims, ...inferenceClaims];
}

function buildIntegratedResearch(candidate, filing, earningsCompany) {
  const longTerm = earningsCompany?.longTermAnalysis || {};
  const action = longTerm?.action || {};
  return {
    businessSummary: text(filing?.analysis?.summaryKo),
    productMix: null,
    geographicMix: null,
    recurringRevenueShare: null,
    growthBridge: null,
    financialRows: list(filing?.financialComparison?.rows).slice(0, 6),
    segmentRows: list(filing?.financialComparison?.segmentRows).slice(0, 8),
    financialWarnings: buildFinancialWarnings(filing?.financialComparison?.rows),
    financialSummary: longTerm?.financialSummary || null,
    qualityStatus: text(longTerm?.companyQuality?.label || longTerm?.companyQuality?.status),
    attractivenessStatus: text(longTerm?.stockAttractiveness?.label || longTerm?.stockAttractiveness?.status),
    portfolioFitStatus: text(longTerm?.portfolioFit?.label || longTerm?.portfolioFit?.status),
    valuation: candidate?.valuationScreen || earningsCompany?.valuationScreen || null,
    sectorKpis: candidate?.sectorKpiSet || null,
    catalysts: [text(candidate?.whyNow), ...list(action?.confirmationConditions).map(text)].filter(Boolean),
    risks: [...list(filing?.analysis?.risksKo).map(text), text(action?.reason)].filter(Boolean),
    scenarios: {
      bull: text(action?.confirmationConditions?.[0]),
      base: text(filing?.analysis?.thesisEffectReasonKo || filing?.analysis?.summaryKo),
      bear: text(action?.invalidationConditions?.[0]),
    },
    nextChecks: [
      ...list(filing?.analysis?.monitoringPointsKo).map(text),
      ...list(action?.nextRequiredEvidence).map(text),
    ].filter(Boolean).slice(0, 6),
    filingUrl: text(filing?.filing?.sourceUrl),
    filingLabel: `${candidate.ticker} ${text(filing?.filing?.form) || "공시"}`,
  };
}

function buildMacroPath(candidate, context) {
  const linkedSector = list(context?.sectorPaths).find(
    (sector) => text(sector?.ticker) === text(candidate?.linkedSectorTicker),
  );
  const rateFinding = list(context?.marketFindings).find((finding) => /금리|환율|유가|인플레이션/i.test(`${text(finding?.title)} ${text(finding?.body)}`))
    || list(context?.marketFindings)[0];
  const koreaTransmission = list(context?.koreaConnection?.companyTransmissions).find(
    (item) => tickerOf(item?.sourceTicker) === tickerOf(candidate?.ticker),
  );
  const koreaTargets = list(koreaTransmission?.targets).filter(
    (target) => ["direct", "industry", "watch_candidate"].includes(text(target?.classification)),
  );
  const directKoreaTarget = koreaTargets.find((target) => text(target?.classification) === "direct");
  const koreaTargetSummary = koreaTargets
    .map((target) => `${text(target?.companyName) || text(target?.ticker)} ${text(target?.classificationLabel)}`.trim())
    .filter(Boolean)
    .join(" · ");
  return {
    status: rateFinding && linkedSector ? "linked" : "partial",
    steps: [
      {
        label: "경제지표",
        value: text(rateFinding?.title) || "공식 거시 지표 연결 대기",
        detail: text(rateFinding?.body),
        evidenceType: rateFinding ? "공식 사실" : "미검증",
      },
      {
        label: "금리·환율·유가",
        value: text(context?.regime?.primaryDriver) || "시장 체제 연결 대기",
        detail: text(context?.regime?.evidence?.[0]),
        evidenceType: context?.regime?.primaryDriver ? "작성자 추론" : "미검증",
      },
      {
        label: "섹터·기업 영향",
        value: linkedSector
          ? `${text(linkedSector.label)} ${text(linkedSector.stanceLabel)}`
          : "표준 섹터 노출 확인 대기",
        detail: text(linkedSector?.reason || candidate?.exposureLabel),
        evidenceType: linkedSector ? "작성자 추론" : "미검증",
      },
      {
        label: "한국시장 연결",
        value: koreaTargetSummary
          || (koreaTransmission
          ? `${text(koreaTransmission.sectorNameKo)} 전파경로`
          : "미국 기업→한국시장 직접 연결 미작성"),
        detail: koreaTargets.length
          ? koreaTargets.map((target) => text(target?.reason)).filter(Boolean).join(" ")
          : koreaTransmission
            ? text(koreaTransmission.sourceSignalLabel)
            : text(context?.koreaConnection?.summary),
        evidenceType: directKoreaTarget
          ? "1차 자료 직접 연결"
          : koreaTargets.length
            ? "1차 자료 산업 경로"
            : koreaTransmission
              ? "작성자 추론"
              : "자료 부족",
      },
      {
        label: "무효화 조건",
        value: text(candidate?.invalidationConditions?.[0]) || text(context?.regime?.invalidationCondition) || "조건 미작성",
        detail: "조건 충족 시 후보 등급을 재검토합니다.",
        evidenceType: candidate?.invalidationConditions?.[0] ? "검증 규칙" : "시장 공통 규칙",
      },
    ],
  };
}

export function evaluateStockCandidateGate(candidate = {}, context = {}) {
  const ticker = tickerOf(candidate.ticker);
  const rawCandidate = list(context?.rawCandidates).find((item) => tickerOf(item?.ticker) === ticker) || null;
  const filing = list(context?.companyFilings).find((item) => tickerOf(item?.ticker) === ticker) || null;
  const earningsCompany = list(context?.earningsCompanies).find((item) => tickerOf(item?.ticker) === ticker) || null;
  const reportSources = list(context?.reportSources)
    .filter((source) => {
      const haystack = `${text(source?.id)} ${text(source?.title)}`.toUpperCase();
      return ticker && new RegExp(`(^|[^A-Z0-9])${ticker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^A-Z0-9]|$)`).test(haystack);
    })
    .map((source) => normalizedSource(source, { type: "공식 사실", primary: /sec|dart|ir/i.test(text(source?.id)) }))
    .filter(Boolean);
  const candidateSources = list(rawCandidate?.evidence)
    .map((source) => normalizedSource(source, {
      type: source?.primaryConfirmed
        ? "공식 사실"
        : source?.sourceGrade || source?.eventType
          ? "언론 보도"
          : "",
      primary: source?.primaryConfirmed === true,
      asOf: context.asOf,
    }))
    .filter(Boolean);
  const filingSource = normalizedSource({
    title: filing?.filing ? `${ticker} ${filing.filing.form || "공시"}` : "",
    sourceUrl: filing?.filing?.sourceUrl,
    type: "공식 사실",
    asOf: filing?.filing?.filedDate,
    primaryConfirmed: true,
  });
  const sources = uniqueSources([...candidateSources, ...(filingSource ? [filingSource] : []), ...reportSources]);
  const primaryCount = primarySourceCount(candidate, rawCandidate, filing, sources);
  const sourceTierCounts = sources.reduce(
    (counts, source) => {
      counts[source.evidenceTier] += 1;
      return counts;
    },
    { authoritative: 0, discovery: 0, unverified: 0 },
  );
  const factCount = verifiedFactCount(candidate, rawCandidate, filing);
  const earningsReady = Boolean(
    filing?.analysisStatus === "complete"
    || list(filing?.financialComparison?.rows).length >= 2
    || list(filing?.metrics).length >= 2,
  );
  const catalystReady = primaryCount >= 1 && Boolean(text(candidate?.whyNow));
  const valuationIsReady = valuationReady(candidate, earningsCompany);
  const dimensions = [earningsReady, valuationIsReady, catalystReady].filter(Boolean).length;
  const riskCheck = liquidityRiskCheck(candidate);
  const counterEvidence = text(filing?.analysis?.risksKo?.[0])
    || text(earningsCompany?.longTermAnalysis?.action?.reason)
    || text(candidate?.firstRejection);
  const invalidationConditions = list(
    earningsCompany?.longTermAnalysis?.action?.invalidationConditions,
  ).map(text).filter(Boolean);
  const asOf = text(context.asOf);
  const updatedAt = text(context.updatedAt);
  const checks = [
    { id: "ticker", passed: Boolean(ticker), detail: ticker || "식별되지 않음" },
    { id: "primarySource", passed: primaryCount >= 1, detail: `${primaryCount}건` },
    { id: "verifiedFacts", passed: factCount >= 2, detail: `${factCount}개` },
    { id: "dimensions", passed: dimensions >= 2, detail: `실적 ${earningsReady ? "○" : "×"} · 밸류 ${valuationIsReady ? "○" : "×"} · 촉매 ${catalystReady ? "○" : "×"}` },
    { id: "liquidityRisk", passed: riskCheck.checked, detail: riskCheck.label },
    { id: "counterEvidence", passed: Boolean(counterEvidence), detail: counterEvidence || "미작성" },
    { id: "invalidation", passed: invalidationConditions.length > 0, detail: invalidationConditions[0] || "미작성" },
    { id: "dates", passed: Boolean(asOf && updatedAt), detail: asOf && updatedAt ? `${asOf} · ${updatedAt}` : "기준일 또는 갱신 시각 없음" },
  ];
  const missingRequirements = checks.filter((check) => !check.passed).map((check) => missingLabel(check.id));
  const passed = missingRequirements.length === 0;
  const grade = passed && candidate?.researchPriority === "A" ? "A" : passed ? "B" : "C";

  const result = {
    ...candidate,
    ticker,
    grade,
    gatePassed: passed,
    checks,
    missingRequirements,
    dimensions: { earnings: earningsReady, valuation: valuationIsReady, catalyst: catalystReady },
    primarySourceCount: primaryCount,
    authoritativeSourceCount: sourceTierCounts.authoritative,
    sourceTierCounts,
    verifiedFactCount: factCount,
    liquidityRisk: riskCheck,
    counterEvidence,
    invalidationConditions,
    asOf,
    updatedAt,
    sources,
    companyFiling: filing,
    earningsCompany,
    allocationAllowed: passed,
  };
  result.claims = buildClaimLedger({ candidate: result, rawCandidate, filing, updatedAt });
  result.integratedResearch = buildIntegratedResearch(result, filing, earningsCompany);
  result.analysisFramework = buildAnalysisFramework(result, filing, earningsCompany);
  result.tradeAllocationAllowed = passed && result.analysisFramework.tradeReadiness.ready;
  result.macroPath = buildMacroPath(result, context);
  return result;
}

export function buildStockGateRolloutSimulation(candidates = []) {
  const evaluated = list(candidates);
  const targetChecksFor = (candidate) => ({
    ticker: Boolean(tickerOf(candidate?.ticker)),
    authoritative_source: Number(candidate?.authoritativeSourceCount || 0) >= 1,
    verified_facts: Number(candidate?.verifiedFactCount || 0) >= 2,
    counter_evidence: Boolean(text(candidate?.counterEvidence)),
    invalidation: list(candidate?.invalidationConditions).length > 0,
    dates: Boolean(text(candidate?.asOf) && text(candidate?.updatedAt)),
    trade_suitability: candidate?.analysisFramework?.stages?.find(
      (stage) => stage.id === "trade_suitability",
    )?.status === "verified",
  });
  const rows = evaluated.map((candidate) => {
    const checks = targetChecksFor(candidate);
    const evidenceCorePassed = Object.entries(checks)
      .filter(([id]) => id !== "trade_suitability")
      .every(([, passed]) => passed);
    const targetPassed = Object.values(checks).every(Boolean);
    return {
      ticker: candidate.ticker,
      currentGrade: candidate.grade,
      currentPassed: candidate.gatePassed === true,
      evidenceCorePassed,
      targetPassed,
      failedTargetGateIds: Object.entries(checks)
        .filter(([, passed]) => !passed)
        .map(([id]) => id),
    };
  });
  const blockerCounts = rows.reduce((counts, row) => {
    for (const id of row.failedTargetGateIds) counts[id] = Number(counts[id] || 0) + 1;
    return counts;
  }, {});
  const currentPassingCount = rows.filter((row) => row.currentPassed).length;
  const evidenceCorePassingCount = rows.filter((row) => row.evidenceCorePassed).length;
  const targetPassingCount = rows.filter((row) => row.targetPassed).length;
  const passRetention = currentPassingCount
    ? targetPassingCount / currentPassingCount
    : targetPassingCount ? 1 : 0;
  const activationDecision = rows.length > 0
    && (targetPassingCount === 0 || passRetention < 0.5)
    ? "hold_activation"
    : "ready_for_review";
  return {
    schemaVersion: "stock_gate_rollout_simulation.v1",
    activeGateChanged: false,
    candidateCount: rows.length,
    currentPassingCount,
    evidenceCorePassingCount,
    targetPassingCount,
    passRetention,
    activationDecision,
    reason: activationDecision === "hold_activation"
      ? "목표 게이트를 즉시 켜면 통과 후보가 사라지거나 절반 미만으로 줄어 활성화를 보류합니다."
      : "목표 게이트의 후보 유지율을 검토할 수 있습니다.",
    blockerCounts,
    rows,
  };
}

export function buildStockResearchGatewaySnapshot(payload = {}) {
  const candidatePool = list(payload?.decisionChain?.ideaFunnel?.candidatePool);
  const context = {
    rawCandidates: list(payload?.stockCandidates?.candidates),
    companyFilings: list(payload?.report?.companyFilings?.companies),
    earningsCompanies: list(payload?.report?.earningsWatch?.companies),
    reportSources: list(payload?.report?.sources),
    asOf: text(payload?.report?.reportDate),
    updatedAt: text(payload?.report?.generatedAt),
    marketFindings: list(payload?.report?.findings),
    regime: payload?.decisionChain?.regime || null,
    sectorPaths: list(payload?.decisionChain?.sectors),
    koreaConnection: payload?.report?.koreaConnection || null,
  };
  const candidates = candidatePool.map((candidate) => evaluateStockCandidateGate(candidate, context));
  return {
    asOf: context.asOf,
    updatedAt: context.updatedAt,
    verifiedCandidates: candidates.filter((candidate) => candidate.gatePassed),
    reviewCandidates: candidates.filter((candidate) => !candidate.gatePassed),
    candidates,
    gateSimulation: buildStockGateRolloutSimulation(candidates),
    sourceCandidateCount: Number(payload?.decisionChain?.ideaFunnel?.inputCount || candidatePool.length),
    connection: payload?.connection || null,
  };
}
