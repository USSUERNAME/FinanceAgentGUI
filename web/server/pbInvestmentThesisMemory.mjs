import { existsSync } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const WEB_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const GUI_ROOT = resolve(WEB_ROOT, "..");
const DEFAULT_LEDGER_PATH = join(
  GUI_ROOT,
  "data",
  "world-memory",
  "pb-investment-theses.json",
);
const LEDGER_SCHEMA = "pb_investment_thesis_memory.v1";
const MAX_HISTORY = 60;
const MAX_OBSERVATIONS = 120;
const MAX_REVIEW_EVIDENCE = 80;
const ledgerWriteQueues = new Map();

function cleanText(value, maxLength = 800) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  return text.length > maxLength ? `${text.slice(0, maxLength - 1).trim()}…` : text;
}

function optionalFiniteNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function uniqueTextList(value, limit = 8) {
  return [...new Set(
    (Array.isArray(value) ? value : [])
      .map((item) => cleanText(item, 300))
      .filter(Boolean),
  )].slice(0, limit);
}

function priorityState(priority) {
  return {
    A: "confirmed",
    B: "watching",
    C: "candidate",
    REJECTED: "invalidated",
  }[priority] || "candidate";
}

function stateLabel(state) {
  return {
    confirmed: "근거 확인",
    watching: "추적 중",
    candidate: "후보",
    weakened: "약화",
    invalidated: "무효화",
    archived: "보관",
  }[state] || state;
}

function metricLabel(metricId) {
  return {
    sector_vs_spy_5d_pct_point: "섹터의 S&P 500 대비 5일 상대수익률",
    stock_vs_sector_5d_pct_point: "종목의 섹터 대비 5일 상대수익률",
  }[metricId] || "상대성과 지표";
}

function emptyLedger() {
  return {
    schemaVersion: LEDGER_SCHEMA,
    updatedAt: "",
    lastSyncedReportDate: "",
    records: [],
  };
}

function ledgerPath(env = process.env) {
  const configured = cleanText(env.PB_INVESTMENT_THESIS_MEMORY_PATH, 4000);
  return configured ? resolve(configured) : DEFAULT_LEDGER_PATH;
}

function stockThesis(candidate, reportDate) {
  const priority = cleanText(candidate?.researchPriority, 20) || "C";
  const ticker = cleanText(candidate?.ticker, 20).toUpperCase();
  if (!ticker) return null;
  const revisionDirection = cleanText(
    candidate?.estimateRevision?.revisionDirection,
    80,
  );
  const negativeRevision = /negative|down|cut|lower/i.test(revisionDirection);
  const explicitlyRejected = priority === "REJECTED" || Boolean(candidate?.rejectionReason);
  const state = explicitlyRejected
    ? "invalidated"
    : negativeRevision
      ? "weakened"
      : priorityState(priority);
  const stockVsSector5d = optionalFiniteNumber(candidate?.stockVsSector5d);
  return {
    continuityId: `pb-stock-${ticker.toLowerCase()}`,
    kind: "stock",
    entityId: ticker,
    title: `${ticker} 투자 가설`,
    thesis: cleanText(
      `${candidate.whyNow || "이상 움직임 확인"} · ${candidate.linkedSectorLabel || "섹터 연결 확인 대기"}`,
    ),
    state,
    stateLabel: stateLabel(state),
    priority,
    sectorTicker: cleanText(candidate.linkedSectorTicker, 20),
    sectorLabel: cleanText(candidate.linkedSectorLabel, 80),
    confirmationCondition: cleanText(candidate.promotionCondition, 500),
    invalidationCondition: cleanText(candidate.firstRejection, 500),
    evidence: uniqueTextList([
      candidate.evidenceSummary,
      candidate.fundamentalGateLabel,
      candidate.whyNow,
      stockVsSector5d === null
        ? ""
        : `5일 섹터 대비 상대수익률 ${stockVsSector5d >= 0 ? "+" : ""}${stockVsSector5d.toFixed(2)}%p`,
      negativeRevision ? "30일 추정치 하향 신호" : "",
    ]),
    direction: 1,
    metricId: stockVsSector5d === null ? "" : "stock_vs_sector_5d_pct_point",
    metricValue: stockVsSector5d,
    metricUnit: "%p",
    reportDate,
  };
}

function sectorThesis(sector, reportDate) {
  const ticker = cleanText(sector?.ticker, 20).toUpperCase();
  if (!ticker) return null;
  const pressure = sector.stance === "pressure";
  const state = sector.fundamentalGate?.status === "caution"
    ? "weakened"
    : sector.fundamentalGate?.status === "supported"
      ? "confirmed"
      : "watching";
  return {
    continuityId: `pb-sector-${ticker.toLowerCase()}`,
    kind: "sector",
    entityId: ticker,
    title: `${sector.label || ticker} 섹터 가설`,
    thesis: cleanText(
      `${pressure ? "부담" : "수혜"} 경로 · ${sector.reason || "상대강도와 내부 확산을 추적합니다."}`,
    ),
    state,
    stateLabel: stateLabel(state),
    priority: pressure ? "WATCH-DOWN" : "WATCH-UP",
    sectorTicker: ticker,
    sectorLabel: cleanText(sector.label, 80),
    confirmationCondition: cleanText(
      pressure
        ? "5일 상대약세와 내부 브레드스 악화가 함께 이어지는지 확인합니다."
        : "5일 상대강세와 내부 브레드스 개선이 함께 이어지는지 확인합니다.",
      500,
    ),
    invalidationCondition: cleanText(
      pressure
        ? "SPY 대비 상대성과와 내부 브레드스가 함께 반등하면 부담 가설을 재검토합니다."
        : "SPY 대비 상대성과와 내부 브레드스가 함께 반전되면 수혜 가설을 재검토합니다.",
      500,
    ),
    evidence: uniqueTextList([
      ...(sector.evidence || []),
      sector.fundamentalGate?.estimateLabel,
      sector.fundamentalGate?.valuationLabel,
    ]),
    direction: pressure ? -1 : 1,
    metricId: "sector_vs_spy_5d_pct_point",
    metricValue: optionalFiniteNumber(sector.vsSpy5d),
    metricUnit: "%p",
    reportDate,
  };
}

export function buildTrackedInvestmentTheses({ decisionChain, reportDate }) {
  if (!decisionChain || decisionChain.status === "blocked") return [];
  const sectors = (decisionChain.sectors || [])
    .map((sector) => sectorThesis(sector, reportDate))
    .filter(Boolean);
  const stocks = (decisionChain.candidates || [])
    .slice(0, 3)
    .map((candidate) => stockThesis(candidate, reportDate))
    .filter(Boolean);
  return [...sectors, ...stocks];
}

function normalizeRecord(record) {
  const history = Array.isArray(record?.history) ? record.history.slice(-MAX_HISTORY) : [];
  const observations = (Array.isArray(record?.observations) ? record.observations : [])
    .filter((item) => item && typeof item === "object" && item.at)
    .slice(-MAX_OBSERVATIONS)
    .map((item) => ({
      at: cleanText(item.at, 20),
      state: cleanText(item.state, 40),
      priority: cleanText(item.priority, 30),
      metricId: cleanText(item.metricId, 80),
      metricValue: optionalFiniteNumber(item.metricValue),
      evidenceCount: Math.max(0, Number(item.evidenceCount || 0)),
    }));
  const reviewEvidence = (Array.isArray(record?.reviewEvidence) ? record.reviewEvidence : [])
    .filter((item) => item && typeof item === "object" && item.id)
    .slice(-MAX_REVIEW_EVIDENCE)
    .map((item) => ({
      id: cleanText(item.id, 220),
      at: cleanText(item.at, 40),
      relation: cleanText(item.relation, 30),
      riskId: cleanText(item.riskId, 160),
      reportDate: cleanText(item.reportDate, 20),
      summary: cleanText(item.summary, 500),
      url: cleanText(item.url, 1000),
    }));
  return {
    continuityId: cleanText(record?.continuityId, 120),
    kind: record?.kind === "sector" ? "sector" : "stock",
    entityId: cleanText(record?.entityId, 30),
    title: cleanText(record?.title, 180),
    thesis: cleanText(record?.thesis, 900),
    state: cleanText(record?.state, 40) || "candidate",
    stateLabel: cleanText(record?.stateLabel, 80) || stateLabel(record?.state),
    priority: cleanText(record?.priority, 30),
    sectorTicker: cleanText(record?.sectorTicker, 20),
    sectorLabel: cleanText(record?.sectorLabel, 80),
    confirmationCondition: cleanText(record?.confirmationCondition, 500),
    invalidationCondition: cleanText(record?.invalidationCondition, 500),
    evidence: uniqueTextList(record?.evidence),
    direction: [-1, 1].includes(Number(record?.direction))
      ? Number(record.direction)
      : 0,
    metricId: cleanText(record?.metricId, 80),
    metricValue: optionalFiniteNumber(record?.metricValue),
    metricUnit: cleanText(record?.metricUnit, 20),
    firstSeenAt: cleanText(record?.firstSeenAt, 20),
    lastSeenAt: cleanText(record?.lastSeenAt, 20),
    observationCount: Math.max(1, Number(record?.observationCount || 1)),
    history,
    observations,
    reviewEvidence,
  };
}

function reviewedState(previousState, relation) {
  if (["invalidated", "archived"].includes(previousState)) return previousState;
  if (relation === "supports") return "confirmed";
  if (relation === "contradicts") return "weakened";
  return previousState;
}

export async function applyRiskReviewEvidenceToInvestmentTheses({
  continuityIds = [],
  relation,
  riskId,
  reportDate,
  summary,
  evidenceUrl = "",
  env = process.env,
  now = () => new Date().toISOString(),
} = {}) {
  const cleanRelation = cleanText(relation, 30);
  if (!["supports", "contradicts", "neutral"].includes(cleanRelation)) {
    throw new Error("지원하지 않는 투자 가설 근거 관계입니다.");
  }
  const ids = uniqueTextList(continuityIds, 8);
  if (!ids.length) throw new Error("연결할 투자 가설 ID가 없습니다.");
  const path = ledgerPath(env);
  const previousWrite = ledgerWriteQueues.get(path) || Promise.resolve();
  let release;
  const currentWrite = new Promise((resolveQueue) => {
    release = resolveQueue;
  });
  const queued = previousWrite.then(() => currentWrite);
  ledgerWriteQueues.set(path, queued);
  await previousWrite;
  try {
    const current = await readInvestmentThesisMemory({ env });
    if (!current.available) throw new Error(current.error);
    const at = now();
    const evidenceId = `portfolio-risk:${cleanText(reportDate, 20)}:${cleanText(riskId, 160)}`;
    let appliedCount = 0;
    let matchedCount = 0;
    const records = current.records.map((record) => {
      if (!ids.includes(record.continuityId)) return record;
      matchedCount += 1;
      if (record.reviewEvidence?.some((item) => item.id === evidenceId)) return record;
      const nextState = reviewedState(record.state, cleanRelation);
      const evidenceSummary = cleanText(summary, 500)
        || `${riskId} 검토 결과를 ${cleanRelation} 근거로 반영했습니다.`;
      const history = nextState === record.state
        ? record.history
        : [...record.history, {
          at: cleanText(reportDate, 20),
          fromState: record.state,
          toState: nextState,
          fromPriority: record.priority,
          toPriority: record.priority,
          reason: evidenceSummary,
        }].slice(-MAX_HISTORY);
      appliedCount += 1;
      return {
        ...record,
        state: nextState,
        stateLabel: stateLabel(nextState),
        evidence: uniqueTextList([...record.evidence, evidenceSummary], 8),
        history,
        reviewEvidence: [...(record.reviewEvidence || []), {
          id: evidenceId,
          at,
          relation: cleanRelation,
          riskId: cleanText(riskId, 160),
          reportDate: cleanText(reportDate, 20),
          summary: evidenceSummary,
          url: cleanText(evidenceUrl, 1000),
        }].slice(-MAX_REVIEW_EVIDENCE),
      };
    });
    if (!matchedCount) {
      throw new Error("승인된 근거를 반영할 투자 가설을 찾지 못했습니다.");
    }
    if (!appliedCount) {
      return {
        ...current,
        appliedCount: 0,
        relation: cleanRelation,
      };
    }
    const payload = {
      schemaVersion: LEDGER_SCHEMA,
      updatedAt: at,
      lastSyncedReportDate: current.lastSyncedReportDate,
      records: records
        .map(normalizeRecord)
        .sort((first, second) => first.continuityId.localeCompare(second.continuityId)),
    };
    await mkdir(dirname(path), { recursive: true });
    const tempPath = `${path}.${Date.now()}-${Math.random().toString(16).slice(2)}.tmp`;
    const serialized = `${JSON.stringify(payload, null, 2)}\n`;
    await writeFile(tempPath, serialized, "utf8");
    try {
      await rename(tempPath, path);
    } catch (error) {
      if (!["EPERM", "EEXIST"].includes(error?.code)) throw error;
      await writeFile(path, serialized, "utf8");
      await rm(tempPath, { force: true });
    }
    return {
      ...(await readInvestmentThesisMemory({ env })),
      appliedCount,
      relation: cleanRelation,
    };
  } finally {
    release();
    if (ledgerWriteQueues.get(path) === queued) ledgerWriteQueues.delete(path);
  }
}

export async function readInvestmentThesisMemory({ env = process.env } = {}) {
  const path = ledgerPath(env);
  if (!existsSync(path)) {
    return {
      ...emptyLedger(),
      available: true,
      pathLabel: "data/world-memory/pb-investment-theses.json",
      recordCount: 0,
      activeRecords: [],
    };
  }
  try {
    const parsed = JSON.parse(await readFile(path, "utf8"));
    const records = (Array.isArray(parsed?.records) ? parsed.records : [])
      .map(normalizeRecord)
      .filter((record) => record.continuityId);
    return {
      schemaVersion: LEDGER_SCHEMA,
      updatedAt: cleanText(parsed?.updatedAt, 40),
      lastSyncedReportDate: cleanText(parsed?.lastSyncedReportDate, 20),
      records,
      available: true,
      pathLabel: "data/world-memory/pb-investment-theses.json",
      recordCount: records.length,
      activeRecords: records
        .filter((record) => !["invalidated", "archived"].includes(record.state))
        .sort((first, second) => second.lastSeenAt.localeCompare(first.lastSeenAt))
        .slice(0, 8),
    };
  } catch (error) {
    return {
      ...emptyLedger(),
      available: false,
      error: `투자 가설 메모리를 읽지 못했습니다: ${error.message}`,
      pathLabel: "data/world-memory/pb-investment-theses.json",
      recordCount: 0,
      activeRecords: [],
    };
  }
}

function transitionFor(previous, current, reportDate) {
  const changed = previous.state !== current.state || previous.priority !== current.priority;
  if (!changed) return null;
  return {
    at: reportDate,
    fromState: previous.state,
    toState: current.state,
    fromPriority: previous.priority,
    toPriority: current.priority,
    reason: cleanText(
      current.evidence[0]
        || "최신 가격·펀더멘털·공식 근거 게이트에 따라 상태를 재평가했습니다.",
      300,
    ),
  };
}

function observationFor(candidate, reportDate) {
  return {
    at: reportDate,
    state: candidate.state,
    priority: candidate.priority,
    metricId: candidate.metricId || "",
    metricValue: optionalFiniteNumber(candidate.metricValue),
    evidenceCount: candidate.evidence.length,
  };
}

function appendObservation(previous, candidate, reportDate) {
  const observation = observationFor(candidate, reportDate);
  const prior = Array.isArray(previous?.observations) ? previous.observations : [];
  const existingIndex = prior.findIndex((item) => item.at === reportDate);
  if (existingIndex === -1) return [...prior, observation].slice(-MAX_OBSERVATIONS);
  const next = [...prior];
  next[existingIndex] = observation;
  return next.slice(-MAX_OBSERVATIONS);
}

async function persistInvestmentThesesUnlocked({
  candidates,
  reportDate,
  env,
  now,
  path,
}) {
  if (!reportDate) throw new Error("투자 가설 동기화에는 reportDate가 필요합니다.");
  if (!candidates.length) {
    throw new Error("판단 근거 게이트를 통과한 추적 가설이 없습니다.");
  }
  const current = await readInvestmentThesisMemory({ env });
  if (!current.available) throw new Error(current.error);
  const byId = new Map(current.records.map((record) => [record.continuityId, record]));
  let createdCount = 0;
  let transitionCount = 0;
  for (const candidate of candidates) {
    const previous = byId.get(candidate.continuityId);
    if (!previous) {
      createdCount += 1;
      byId.set(candidate.continuityId, {
        ...candidate,
        firstSeenAt: reportDate,
        lastSeenAt: reportDate,
        observationCount: 1,
        observations: [observationFor(candidate, reportDate)],
        history: [{
          at: reportDate,
          fromState: "",
          toState: candidate.state,
          fromPriority: "",
          toPriority: candidate.priority,
          reason: candidate.evidence[0] || "최초 추적 등록",
        }],
      });
      continue;
    }
    const transition = transitionFor(previous, candidate, reportDate);
    if (transition) transitionCount += 1;
    const sameDate = previous.lastSeenAt === reportDate;
    byId.set(candidate.continuityId, {
      ...previous,
      ...candidate,
      firstSeenAt: previous.firstSeenAt || reportDate,
      lastSeenAt: reportDate,
      observationCount: sameDate
        ? previous.observationCount
        : previous.observationCount + 1,
      history: transition
        ? [...previous.history, transition].slice(-MAX_HISTORY)
        : previous.history,
      observations: appendObservation(previous, candidate, reportDate),
    });
  }
  const payload = {
    schemaVersion: LEDGER_SCHEMA,
    updatedAt: now(),
    lastSyncedReportDate: reportDate,
    records: [...byId.values()]
      .map(normalizeRecord)
      .sort((first, second) => first.continuityId.localeCompare(second.continuityId)),
  };
  await mkdir(dirname(path), { recursive: true });
  const tempPath = `${path}.${Date.now()}-${Math.random().toString(16).slice(2)}.tmp`;
  const serialized = `${JSON.stringify(payload, null, 2)}\n`;
  await writeFile(tempPath, serialized, "utf8");
  try {
    await rename(tempPath, path);
  } catch (error) {
    if (!["EPERM", "EEXIST"].includes(error?.code)) throw error;
    await writeFile(path, serialized, "utf8");
    await rm(tempPath, { force: true });
  }
  const snapshot = await readInvestmentThesisMemory({ env });
  return {
    ...snapshot,
    synced: true,
    candidateCount: candidates.length,
    createdCount,
    transitionCount,
  };
}

async function persistInvestmentTheses(options) {
  const path = ledgerPath(options.env);
  const previous = ledgerWriteQueues.get(path) || Promise.resolve();
  let release;
  const current = new Promise((resolveQueue) => {
    release = resolveQueue;
  });
  const queued = previous.then(() => current);
  ledgerWriteQueues.set(path, queued);
  await previous;
  try {
    return await persistInvestmentThesesUnlocked({ ...options, path });
  } finally {
    release();
    if (ledgerWriteQueues.get(path) === queued) ledgerWriteQueues.delete(path);
  }
}

export async function syncInvestmentThesisMemory({
  decisionChain,
  reportDate,
  env = process.env,
  now = () => new Date().toISOString(),
} = {}) {
  const candidates = buildTrackedInvestmentTheses({ decisionChain, reportDate });
  const current = await readInvestmentThesisMemory({ env });
  if (!current.available) throw new Error(current.error);
  const trackedStockIds = new Set(
    current.records
      .filter((record) => record.kind === "stock")
      .map((record) => record.entityId),
  );
  const existingCandidateIds = new Set(candidates.map((candidate) => candidate.continuityId));
  for (const candidate of decisionChain?.ideaFunnel?.candidatePool || []) {
    if (!trackedStockIds.has(candidate.ticker)) continue;
    const thesis = stockThesis(candidate, reportDate);
    if (thesis && !existingCandidateIds.has(thesis.continuityId)) {
      candidates.push(thesis);
      existingCandidateIds.add(thesis.continuityId);
    }
  }
  return persistInvestmentTheses({ candidates, reportDate, env, now });
}

export async function syncSelectedStockThesisMemory({
  candidate,
  reportDate,
  env = process.env,
  now = () => new Date().toISOString(),
} = {}) {
  if (!["qualified", "research"].includes(candidate?.status)) {
    throw new Error("심층검토 또는 근거보강 단계의 종목만 투자 가설로 저장할 수 있습니다.");
  }
  const thesis = stockThesis({
    ...candidate,
    researchPriority: candidate.status === "qualified"
      ? "A"
      : candidate.researchPriority === "A"
        ? "A"
        : "B",
    promotionCondition: candidate.researchProfile?.confirmationCondition
      || candidate.promotionCondition,
    firstRejection: candidate.researchProfile?.invalidationCondition
      || candidate.firstRejection,
    fundamentalGateLabel: candidate.fundamentalGateLabel
      || candidate.fundamentalGateStatus,
  }, reportDate);
  if (!thesis) throw new Error("저장할 종목 티커가 없습니다.");
  return persistInvestmentTheses({
    candidates: [thesis],
    reportDate,
    env,
    now,
  });
}

function dateFloor(value) {
  const date = new Date(`${cleanText(value, 20).slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function recentDateCutoff(asOfDate, windowDays) {
  const end = dateFloor(asOfDate) || new Date();
  return new Date(end.getTime() - (Math.max(1, windowDays) - 1) * 86_400_000);
}

function scoreRecord(record, cutoff) {
  if (!record.direction || !record.metricId) {
    return {
      status: "not_scoreable",
      reason: "방향과 비교 지표가 정의된 가설만 성과 판정합니다.",
    };
  }
  const observations = record.observations
    .filter((item) => {
      const date = dateFloor(item.at);
      return date && date >= cutoff && Number.isFinite(item.metricValue);
    })
    .sort((first, second) => first.at.localeCompare(second.at));
  if (observations.length < 2 || observations[0].at === observations.at(-1).at) {
    return { status: "pending", reason: "서로 다른 거래일 관측이 2회 이상 필요합니다." };
  }
  const latest = observations.at(-1);
  if (record.kind === "stock") {
    if (latest.state === "invalidated") {
      return {
        status: "miss",
        reason: "최신 공식 근거·펀더멘털 게이트에서 종목 가설이 무효화됐습니다.",
        latestValue: latest.metricValue,
      };
    }
    if (latest.state === "weakened") {
      return {
        status: "miss",
        reason: "최신 추정치 하향 신호로 종목 가설이 약화됐습니다.",
        latestValue: latest.metricValue,
      };
    }
    if (latest.metricValue > 0.5) {
      return {
        status: "hit",
        reason: `최신 5일 섹터 대비 상대수익률이 +${latest.metricValue.toFixed(2)}%p입니다.`,
        latestValue: latest.metricValue,
      };
    }
    if (latest.metricValue < -0.5) {
      return {
        status: "miss",
        reason: `최신 5일 섹터 대비 상대수익률이 ${latest.metricValue.toFixed(2)}%p입니다.`,
        latestValue: latest.metricValue,
      };
    }
    return {
      status: "inconclusive",
      reason: "최신 종목의 섹터 대비 상대수익률이 ±0.50%p 중립 구간입니다.",
      latestValue: latest.metricValue,
    };
  }
  const alignedValue = latest.metricValue * record.direction;
  if (alignedValue > 0.1) {
    return {
      status: "hit",
      reason: `최신 ${metricLabel(record.metricId)}이 가설 방향으로 ${latest.metricValue >= 0 ? "+" : ""}${latest.metricValue.toFixed(2)}${record.metricUnit || ""}입니다.`,
      latestValue: latest.metricValue,
    };
  }
  if (alignedValue < -0.1) {
    return {
      status: "miss",
      reason: `최신 ${metricLabel(record.metricId)}이 가설 반대 방향으로 ${latest.metricValue >= 0 ? "+" : ""}${latest.metricValue.toFixed(2)}${record.metricUnit || ""}입니다.`,
      latestValue: latest.metricValue,
    };
  }
  return {
    status: "inconclusive",
    reason: "최신 상대성과가 ±0.10%p 중립 구간에 있어 판정을 보류합니다.",
    latestValue: latest.metricValue,
  };
}

function buildOutcomeAlerts(records, scored, cutoff, asOfDate) {
  const scoredById = new Map(scored.map((item) => [item.continuityId, item]));
  const alerts = records.flatMap((record) => {
    const current = scoredById.get(record.continuityId);
    if (!["hit", "miss"].includes(current?.status)) return [];
    const observations = record.observations
      .filter((item) => Number.isFinite(item.metricValue))
      .slice()
      .sort((first, second) => first.at.localeCompare(second.at));
    const latestDate = observations.at(-1)?.at || "";
    if (!latestDate || latestDate !== asOfDate) return [];
    const priorObservations = observations.filter((item) => item.at < latestDate);
    const priorLatest = priorObservations.at(-1);
    const previous = scoreRecord({
      ...record,
      state: priorLatest?.state || record.state,
      observations: priorObservations,
    }, cutoff);
    if (previous.status === current.status) return [];
    return [{
      id: `${record.continuityId}-${latestDate}-${current.status}`,
      continuityId: record.continuityId,
      kind: record.kind,
      entityId: record.entityId,
      title: record.title,
      at: latestDate,
      status: current.status,
      previousStatus: previous.status,
      alertType: current.status === "miss"
        ? "thesis_contradicted"
        : "thesis_confirmed",
      severity: current.status === "miss" ? "high" : "positive",
      reason: current.reason,
      latestValue: current.latestValue ?? null,
      confirmationCondition: record.confirmationCondition,
      invalidationCondition: record.invalidationCondition,
    }];
  });
  const severityRank = { high: 0, positive: 1 };
  return alerts
    .sort((first, second) =>
      Number(severityRank[first.severity] ?? 9) - Number(severityRank[second.severity] ?? 9)
      || first.entityId.localeCompare(second.entityId))
    .slice(0, 8);
}

export function buildWeeklyThesisCalibration(
  memory,
  {
    asOfDate = memory?.lastSyncedReportDate || new Date().toISOString().slice(0, 10),
    windowDays = 7,
    minimumResolvedSample = 10,
  } = {},
) {
  const cutoff = recentDateCutoff(asOfDate, windowDays);
  const recentRecords = (memory?.records || []).filter((record) => {
    const lastSeen = dateFloor(record.lastSeenAt);
    return lastSeen && lastSeen >= cutoff;
  });
  const scored = recentRecords.map((record) => ({
    continuityId: record.continuityId,
    kind: record.kind,
    entityId: record.entityId,
    title: record.title,
    direction: record.direction,
    ...scoreRecord(record, cutoff),
  }));
  const alerts = buildOutcomeAlerts(recentRecords, scored, cutoff, asOfDate);
  const counts = scored.reduce(
    (result, item) => {
      result[item.status] = Number(result[item.status] || 0) + 1;
      return result;
    },
    { hit: 0, miss: 0, inconclusive: 0, pending: 0, not_scoreable: 0 },
  );
  const resolvedCount = counts.hit + counts.miss;
  const directionRows = recentRecords.filter((record) => record.direction);
  const upCount = directionRows.filter((record) => record.direction > 0).length;
  const thesisBiasPct = directionRows.length ? (upCount / directionRows.length) * 100 : null;
  const sectorCounts = recentRecords.reduce((result, record) => {
    const key = record.sectorTicker || "unmapped";
    result[key] = Number(result[key] || 0) + 1;
    return result;
  }, {});
  const largestSectorCount = Math.max(0, ...Object.values(sectorCounts));
  const concentrationPct = recentRecords.length
    ? (largestSectorCount / recentRecords.length) * 100
    : null;
  const evidenceGapCount = recentRecords.filter(
    (record) => !record.confirmationCondition || !record.invalidationCondition || !record.evidence.length,
  ).length;
  const transitions = recentRecords
    .flatMap((record) => record.history
      .filter((item) => {
        const date = dateFloor(item.at);
        return date && date >= cutoff && item.fromState;
      })
      .map((item) => ({
        continuityId: record.continuityId,
        entityId: record.entityId,
        ...item,
      })))
    .sort((first, second) => second.at.localeCompare(first.at))
    .slice(0, 8);
  const warnings = [];
  if (resolvedCount < minimumResolvedSample) {
    warnings.push(`판정 완료 표본 ${resolvedCount}건으로 적중률을 공개하지 않습니다. 최소 ${minimumResolvedSample}건이 필요합니다.`);
  }
  if (thesisBiasPct !== null && thesisBiasPct >= 70) {
    warnings.push(`상승 방향 가설이 ${thesisBiasPct.toFixed(0)}%로 편중됐습니다.`);
  }
  if (concentrationPct !== null && concentrationPct > 50) {
    warnings.push(`단일 섹터 비중이 ${concentrationPct.toFixed(0)}%로 높습니다.`);
  }
  if (evidenceGapCount) {
    warnings.push(`확인·무효화·근거 필드가 불완전한 가설이 ${evidenceGapCount}건입니다.`);
  }
  return {
    asOfDate,
    windowDays,
    windowStart: cutoff.toISOString().slice(0, 10),
    recentThesisCount: recentRecords.length,
    resolvedCount,
    minimumResolvedSample,
    successRateVisible: resolvedCount >= minimumResolvedSample,
    successRatePct: resolvedCount ? (counts.hit / resolvedCount) * 100 : null,
    counts,
    thesisBiasPct,
    concentrationPct,
    evidenceGapCount,
    scored,
    alerts,
    transitions,
    warnings,
  };
}
