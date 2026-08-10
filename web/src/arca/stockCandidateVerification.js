const TICKER_PATTERN = /^[A-Z][A-Z0-9.-]{0,14}$/;

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

function normalizedSource(source, fallback = {}) {
  const url = text(source?.sourceUrl || source?.url);
  if (!/^https?:\/\//i.test(url)) return null;
  return {
    title: text(source?.title) || fallback.title || "원문",
    url,
    type: text(source?.type || source?.eventType || fallback.type) || "공식 사실",
    sourceGrade: text(source?.sourceGrade || fallback.sourceGrade),
    asOf: text(source?.asOf || fallback.asOf),
    primary: source?.primaryConfirmed === true || fallback.primary === true,
  };
}

function primarySourceCount(candidate, rawCandidate, filing, sources) {
  const explicit = Math.max(
    Number(candidate?.primaryEvidenceCount || 0),
    list(rawCandidate?.evidence).filter((item) => item?.primaryConfirmed).length,
  );
  return Math.max(explicit, filing?.filing?.sourceUrl ? 1 : 0, sources.filter((item) => item.primary).length);
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
    financialRows: list(filing?.financialComparison?.rows).slice(0, 6),
    segmentRows: list(filing?.financialComparison?.segmentRows).slice(0, 8),
    financialSummary: longTerm?.financialSummary || null,
    qualityStatus: text(longTerm?.companyQuality?.label || longTerm?.companyQuality?.status),
    attractivenessStatus: text(longTerm?.stockAttractiveness?.label || longTerm?.stockAttractiveness?.status),
    portfolioFitStatus: text(longTerm?.portfolioFit?.label || longTerm?.portfolioFit?.status),
    valuation: candidate?.valuationScreen || earningsCompany?.valuationScreen || null,
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
        value: koreaTransmission
          ? `${text(koreaTransmission.sectorNameKo)} 전파경로`
          : "미국 기업→한국시장 직접 연결 미작성",
        detail: koreaTransmission
          ? text(koreaTransmission.sourceSignalLabel)
          : text(context?.koreaConnection?.summary),
        evidenceType: koreaTransmission ? "작성자 추론" : "자료 부족",
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
      type: source?.primaryConfirmed ? "공식 사실" : "언론 보도",
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
  result.macroPath = buildMacroPath(result, context);
  return result;
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
    sourceCandidateCount: Number(payload?.decisionChain?.ideaFunnel?.inputCount || candidatePool.length),
    connection: payload?.connection || null,
  };
}
