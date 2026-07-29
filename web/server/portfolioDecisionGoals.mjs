import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const WEB_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const GUIBUILD_ROOT = resolve(WEB_ROOT, "..");
const DEFAULT_DATA_DIR = join(GUIBUILD_ROOT, "data", "pb-daily-intelligence");
const STORE_FILE_NAME = "portfolio-decision-goals.json";
const ALLOWED_DECISIONS = new Set(["approved", "rejected"]);
const FAILURE_CAUSE_RULES = [
  {
    id: "data_gap",
    label: "데이터 부족",
    terms: ["데이터 부족", "자료 부족", "근거 부족", "표본 부족", "미확인", "검증 대기", "data gap"],
  },
  {
    id: "entry_timing",
    label: "진입 시점",
    terms: ["진입", "추격", "선반영", "시점", "타이밍", "급등 후", "갭 상승", "늦게", "조기"],
  },
  {
    id: "event_interpretation",
    label: "이벤트 해석",
    terms: ["실적", "가이던스", "공시", "정책", "규제", "뉴스", "발표", "서프라이즈", "컨센서스", "이벤트"],
  },
  {
    id: "sector_view",
    label: "섹터 판단",
    terms: ["섹터", "업종", "순환매", "상대강도", "동조", "확산", "테마", "산업"],
  },
  {
    id: "market_regime",
    label: "시장 환경",
    terms: ["금리", "달러", "유가", "크레딧", "변동성 지수", "시장 체제", "레짐", "지수", "매크로"],
  },
  {
    id: "risk_response",
    label: "위험 대응",
    terms: ["비중", "집중", "손절", "헤지", "분할", "노출", "포지션", "리스크 관리"],
  },
];
const FAILURE_CAUSE_CHECKLISTS = {
  data_gap: "판단 전에 최신 가격, 공식자료, 비교 기준이 모두 확보됐는지 확인합니다.",
  entry_timing: "진입·축소 판단 전에 최근 가격 급변과 선반영 여부를 확인하고 판단 시점을 기록합니다.",
  event_interpretation: "실적·공시·정책 이벤트의 확인된 사실과 시장 해석을 분리해 기록합니다.",
  sector_view: "종목 판단 전에 섹터 상대강도와 동종 종목 확산 여부를 함께 확인합니다.",
  market_regime: "종목 대응 전에 금리·달러·변동성 등 현재 시장 체제가 같은 방향을 지지하는지 확인합니다.",
  risk_response: "비중·집중도·무효화 조건을 확인한 뒤 유지·축소 판단의 위험 한도를 기록합니다.",
};

function cleanText(value, limit = 1000) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, limit);
}

function nextMonth(month = "") {
  if (!/^\d{4}-\d{2}$/.test(month)) return "";
  const [year, rawMonth] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, rawMonth, 1));
  return date.toISOString().slice(0, 7);
}

function daysUntilMonthEnd(asOfDate = "") {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOfDate)) return null;
  const [year, month, day] = asOfDate.split("-").map(Number);
  const current = Date.UTC(year, month - 1, day);
  const monthEnd = Date.UTC(year, month, 0);
  return Math.max(0, Math.round((monthEnd - current) / 86_400_000));
}

export function buildMonthlyDecisionGoalAlerts(
  activeGoals = [],
  { asOfDate = "", sampleReminderDays = 5 } = {},
) {
  const cleanAsOfDate = cleanText(asOfDate, 20);
  const currentMonth = /^\d{4}-\d{2}-\d{2}$/.test(cleanAsOfDate)
    ? cleanAsOfDate.slice(0, 7)
    : "";
  const remainingDays = daysUntilMonthEnd(cleanAsOfDate);
  return (Array.isArray(activeGoals) ? activeGoals : []).flatMap((goal) => {
    let alertType = "";
    let level = "watch";
    let title = "";
    let summary = "";
    if (goal.progressStatus === "achieved") {
      alertType = "achieved";
      title = "월간 개선 목표 달성";
      summary = `${goal.targetMonth} ${goal.action} 목표를 달성했습니다. 반대 비율 ${goal.challengeRatePct.toFixed(0)}%, 결정 표본 ${goal.decisiveCount}건입니다.`;
    } else if (goal.progressStatus === "missed") {
      alertType = "missed";
      level = "critical";
      title = "월간 개선 목표 미달";
      summary = `${goal.targetMonth} ${goal.action} 목표가 미달로 확정됐습니다. 반대 비율 ${goal.challengeRatePct.toFixed(0)}%, 결정 표본 ${goal.decisiveCount}/${goal.minimumDecisiveSample}건입니다.`;
    } else if (
      goal.progressStatus === "in_progress"
      && currentMonth === goal.targetMonth
      && remainingDays !== null
      && remainingDays <= sampleReminderDays
      && goal.decisiveCount < goal.minimumDecisiveSample
    ) {
      alertType = "sample_shortfall";
      title = "월간 개선 목표 표본 부족";
      summary = `${goal.targetMonth} 종료까지 ${remainingDays}일 남았지만 ${goal.action} 결정 표본이 ${goal.decisiveCount}/${goal.minimumDecisiveSample}건입니다.`;
    }
    if (!alertType) return [];
    return [{
      id: `portfolio-decision-goal-alert:${goal.goalId}:${alertType}`,
      goalId: goal.goalId,
      alertType,
      level,
      title,
      summary,
      action: goal.action,
      targetMonth: goal.targetMonth,
      progressStatus: goal.progressStatus,
      decisiveCount: goal.decisiveCount,
      minimumDecisiveSample: goal.minimumDecisiveSample,
      challengeRatePct: goal.challengeRatePct,
      targetChallengeRatePct: goal.targetChallengeRatePct,
      daysRemaining: remainingDays,
    }];
  });
}

export function classifyMonthlyDecisionFailureCauses(
  evidenceCases = [],
  { minimumRepeatedCount = 2 } = {},
) {
  const challengedCases = (Array.isArray(evidenceCases) ? evidenceCases : [])
    .filter((item) => item?.status === "challenged");
  const counts = new Map();
  const cases = challengedCases.map((item) => {
    const text = cleanText(
      `${item.title || ""} ${item.note || ""} ${item.evaluationSummary || ""} ${item.riskId || ""}`,
      1600,
    ).toLowerCase();
    const scoredRules = FAILURE_CAUSE_RULES
      .map((rule, index) => ({
        rule,
        index,
        matchedTerms: rule.terms
          .filter((term) => text.includes(term.toLowerCase()))
          .slice(0, 3),
      }))
      .filter((item) => item.matchedTerms.length)
      .sort((a, b) =>
        b.matchedTerms.length - a.matchedTerms.length
        || a.index - b.index,
      );
    const matchedRule = scoredRules[0]?.rule;
    const causeId = matchedRule?.id || "unclassified";
    const causeLabel = matchedRule?.label || "분류 단서 없음";
    const matchedTerms = scoredRules[0]?.matchedTerms || [];
    counts.set(causeId, (counts.get(causeId) || 0) + 1);
    return {
      activityId: item.activityId,
      reportDate: item.reportDate,
      causeId,
      causeLabel,
      matchedTerms,
    };
  });
  const categories = [...counts.entries()]
    .map(([id, count]) => ({
      id,
      label: FAILURE_CAUSE_RULES.find((rule) => rule.id === id)?.label
        || "분류 단서 없음",
      count,
      sharePct: challengedCases.length
        ? Number(((count / challengedCases.length) * 100).toFixed(1))
        : 0,
      repeated: id !== "unclassified" && count >= minimumRepeatedCount,
    }))
    .sort((a, b) =>
      b.count - a.count
      || a.label.localeCompare(b.label, "ko"),
    );
  const primaryCause = categories.find((item) => item.repeated) || null;
  const eligible = challengedCases.length >= minimumRepeatedCount;
  return {
    challengedCount: challengedCases.length,
    minimumRepeatedCount,
    eligible,
    status: !eligible
      ? "insufficient_sample"
      : primaryCause
        ? "candidate_found"
        : "unclear",
    primaryCause,
    categories,
    cases,
    warning: !eligible
      ? `반대 판정 ${challengedCases.length}/${minimumRepeatedCount}건으로 반복 원인을 분류하지 않습니다.`
      : primaryCause
        ? "기록 문구에서 반복된 단서를 찾은 결과이며 확정 원인은 아닙니다."
        : "반대 사례는 있으나 2건 이상 반복된 동일 원인 단서가 없습니다.",
  };
}

export function buildMonthlyFailureChecklistSuggestions(activeGoals = []) {
  return (Array.isArray(activeGoals) ? activeGoals : [])
    .flatMap((goal) => {
      const analysis = goal?.failureCauseAnalysis;
      const cause = analysis?.primaryCause;
      const proposal = FAILURE_CAUSE_CHECKLISTS[cause?.id];
      if (analysis?.status !== "candidate_found" || !cause || !proposal) return [];
      const evidenceById = new Map(
        (goal.evidenceCases || []).map((item) => [item.activityId, item]),
      );
      const evidence = (analysis.cases || [])
        .filter((item) => item.causeId === cause.id)
        .slice(0, 5)
        .map((item) => {
          const source = evidenceById.get(item.activityId) || {};
          return {
            activityId: item.activityId,
            reportDate: item.reportDate,
            title: source.title || source.riskId || item.activityId,
            summary: source.evaluationSummary || source.note || "",
          };
        });
      return [{
        suggestionId: `portfolio-response-rule:cause:${goal.action}:${cause.id}`,
        action: goal.action,
        proposal,
        decisiveCount: goal.decisiveCount,
        challengedCount: analysis.challengedCount,
        challengeRatePct: goal.challengeRatePct,
        status: "pending_approval",
        autoApply: false,
        origin: "failure_cause",
        causeId: cause.id,
        causeLabel: cause.label,
        sourceGoalId: goal.goalId,
        evidence,
      }];
    })
    .sort((a, b) =>
      b.challengedCount - a.challengedCount
      || a.action.localeCompare(b.action)
      || a.causeId.localeCompare(b.causeId),
    );
}

function readStore(path) {
  if (!existsSync(path)) return [];
  try {
    const payload = JSON.parse(readFileSync(path, "utf8"));
    return Array.isArray(payload?.goals) ? payload.goals : [];
  } catch {
    return [];
  }
}

function writeStore(path, goals) {
  const payload = {
    schemaVersion: "portfolio-decision-goals.v1",
    updatedAt: new Date().toISOString(),
    goals: goals.slice(-100),
  };
  const tmpPath = `${path}.tmp`;
  writeFileSync(tmpPath, `${JSON.stringify(payload, null, 2)}\n`);
  renameSync(tmpPath, path);
}

export function buildMonthlyDecisionGoalProposals(monthlyReview = {}) {
  const sourceMonth = cleanText(monthlyReview?.month, 7);
  const targetMonth = nextMonth(sourceMonth);
  if (!targetMonth) return [];
  return (monthlyReview?.reviewHabits || []).map((habit) => {
    const baselineChallengeRatePct = Math.max(
      0,
      Math.min(100, Number(habit.challengeRatePct) || 0),
    );
    const targetChallengeRatePct = Math.max(
      20,
      Number((baselineChallengeRatePct - 15).toFixed(1)),
    );
    return {
      goalId: `portfolio-decision-goal:${sourceMonth}:${habit.action}`,
      sourceMonth,
      targetMonth,
      action: habit.action,
      baselineChallengeRatePct,
      targetChallengeRatePct,
      minimumDecisiveSample: 5,
      summary: `${targetMonth}에는 반대 비율을 ${targetChallengeRatePct.toFixed(0)}% 이하로 낮추고 결정 표본 5건 이상을 확보합니다.`,
      status: "pending_approval",
    };
  });
}

export function readPortfolioDecisionGoals({
  dataDir = DEFAULT_DATA_DIR,
} = {}) {
  return readStore(join(dataDir, STORE_FILE_NAME))
    .sort((a, b) => String(b.reviewedAt || "").localeCompare(String(a.reviewedAt || "")));
}

export function reviewMonthlyDecisionGoalProposal({
  proposal,
  decision,
  dataDir = DEFAULT_DATA_DIR,
} = {}) {
  const cleanDecision = cleanText(decision, 30);
  if (!ALLOWED_DECISIONS.has(cleanDecision)) {
    throw new Error("월간 개선 목표는 승인 또는 제외만 가능합니다.");
  }
  const goalId = cleanText(proposal?.goalId, 180);
  if (!goalId.startsWith("portfolio-decision-goal:")) {
    throw new Error("유효한 월간 개선 목표 제안이 필요합니다.");
  }
  mkdirSync(dataDir, { recursive: true });
  const path = join(dataDir, STORE_FILE_NAME);
  const existing = readStore(path);
  const now = new Date().toISOString();
  const previous = existing.find((item) => item.goalId === goalId);
  const record = {
    goalId,
    sourceMonth: cleanText(proposal.sourceMonth, 7),
    targetMonth: cleanText(proposal.targetMonth, 7),
    action: cleanText(proposal.action, 40),
    baselineChallengeRatePct: Number(proposal.baselineChallengeRatePct) || 0,
    targetChallengeRatePct: Number(proposal.targetChallengeRatePct) || 0,
    minimumDecisiveSample: Math.max(1, Number(proposal.minimumDecisiveSample) || 5),
    summary: cleanText(proposal.summary, 1000),
    decision: cleanDecision,
    createdAt: previous?.createdAt || now,
    reviewedAt: now,
  };
  const goals = existing.filter((item) => item.goalId !== goalId).concat(record);
  writeStore(path, goals);
  return {
    record,
    path: "data/pb-daily-intelligence/portfolio-decision-goals.json",
  };
}

export function attachMonthlyDecisionGoals(
  monthlyReview = {},
  proposals = [],
  goals = [],
  { asOfDate = "", activity = [] } = {},
) {
  const goalById = new Map(goals.map((item) => [item.goalId, item]));
  const currentMonth = /^\d{4}-\d{2}-\d{2}$/.test(cleanText(asOfDate, 20))
    ? cleanText(asOfDate, 20).slice(0, 7)
    : cleanText(monthlyReview?.month, 7);
  const evaluate = (goal) => {
    const targetRows = (Array.isArray(activity) ? activity : []).filter(
      (item) =>
        item?.portfolioResponseAction === goal.action
        && String(item.reportDate || "").startsWith(goal.targetMonth)
        && ["supported", "challenged"].includes(
          item?.portfolioResponseEvaluation?.status,
        ),
    );
    const decisiveCount = targetRows.length;
    const challenged = targetRows.filter(
      (item) => item.portfolioResponseEvaluation.status === "challenged",
    ).length;
    const challengeRatePct = decisiveCount
      ? Number(((challenged / decisiveCount) * 100).toFixed(1))
      : 0;
    const enoughSample = decisiveCount >= goal.minimumDecisiveSample;
    const achieved = enoughSample
      && challengeRatePct <= goal.targetChallengeRatePct;
    const evidenceCases = targetRows
      .map((item) => ({
        activityId: cleanText(item.activityId, 180),
        reportDate: cleanText(item.reportDate, 10),
        riskId: cleanText(item.riskId, 120),
        title: cleanText(item.title || item.riskId, 300),
        note: cleanText(item.portfolioResponseNote || item.summary, 600),
        evidenceUrl: cleanText(item.evidenceUrl, 1000),
        status: cleanText(item.portfolioResponseEvaluation?.status, 30),
        label: cleanText(item.portfolioResponseEvaluation?.label, 100),
        evaluationSummary: cleanText(
          item.portfolioResponseEvaluation?.summary,
          600,
        ),
        targets: (Array.isArray(item.targets) ? item.targets : [])
          .slice(0, 8)
          .map((target) => cleanText(target?.entityId, 40))
          .filter(Boolean),
      }))
      .sort((a, b) =>
        b.reportDate.localeCompare(a.reportDate)
        || a.activityId.localeCompare(b.activityId),
      );
    const failureCauseAnalysis = classifyMonthlyDecisionFailureCauses(evidenceCases);
    return {
      ...goal,
      decisiveCount,
      challengeRatePct,
      evidenceCases,
      failureCauseAnalysis,
      progressStatus: currentMonth < goal.targetMonth
        ? "scheduled"
        : currentMonth === goal.targetMonth
          ? achieved
            ? "achieved"
            : "in_progress"
          : achieved
            ? "achieved"
            : "missed",
      warning: enoughSample
        ? ""
        : `결정 표본 ${decisiveCount}/${goal.minimumDecisiveSample}`,
    };
  };
  const activeGoals = goals
    .filter((goal) => goal?.decision === "approved")
    .map(evaluate)
    .sort((a, b) =>
      a.targetMonth.localeCompare(b.targetMonth)
      || a.action.localeCompare(b.action),
    );
  return {
    proposals: proposals.map((proposal) => ({
      ...proposal,
      status: goalById.get(proposal.goalId)?.decision || "pending_approval",
      reviewedAt: goalById.get(proposal.goalId)?.reviewedAt || "",
    })),
    activeGoals,
    alerts: buildMonthlyDecisionGoalAlerts(activeGoals, { asOfDate }),
  };
}
