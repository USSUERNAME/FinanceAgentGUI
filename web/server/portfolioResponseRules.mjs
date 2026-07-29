import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { classifyMonthlyDecisionFailureCauses } from "./portfolioDecisionGoals.mjs";

const WEB_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const GUIBUILD_ROOT = resolve(WEB_ROOT, "..");
const DEFAULT_DATA_DIR = join(GUIBUILD_ROOT, "data", "pb-daily-intelligence");
const STORE_FILE_NAME = "portfolio-response-rules.json";
const ALLOWED_DECISIONS = new Set(["approved", "rejected"]);
const ALLOWED_MANAGEMENT_DECISIONS = new Set(["maintain", "modify", "deactivate"]);
const ALLOWED_ACTIONS = new Set([
  "maintain",
  "increase_monitoring",
  "reduce_review",
  "exit_review",
]);

function cleanText(value, limit = 1000) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, limit);
}

function readStore(path) {
  if (!existsSync(path)) return [];
  try {
    const payload = JSON.parse(readFileSync(path, "utf8"));
    return Array.isArray(payload?.decisions) ? payload.decisions : [];
  } catch {
    return [];
  }
}

function writeStore(path, decisions) {
  const payload = {
    schemaVersion: "portfolio-response-rules.v1",
    updatedAt: new Date().toISOString(),
    decisions: decisions.slice(-100),
  };
  const tmpPath = `${path}.tmp`;
  writeFileSync(tmpPath, `${JSON.stringify(payload, null, 2)}\n`);
  renameSync(tmpPath, path);
}

export function readPortfolioResponseRuleDecisions({
  dataDir = DEFAULT_DATA_DIR,
} = {}) {
  return readStore(join(dataDir, STORE_FILE_NAME))
    .sort((a, b) => String(b.reviewedAt || "").localeCompare(String(a.reviewedAt || "")));
}

export function reviewPortfolioResponseRuleSuggestion({
  suggestionId,
  action,
  proposal,
  decision,
  decisiveCount = 0,
  challengedCount = 0,
  challengeRatePct = 0,
  origin = "",
  causeId = "",
  causeLabel = "",
  sourceGoalId = "",
  dataDir = DEFAULT_DATA_DIR,
} = {}) {
  const cleanSuggestionId = cleanText(suggestionId, 160);
  const cleanAction = cleanText(action, 40);
  const cleanProposal = cleanText(proposal, 1000);
  const cleanDecision = cleanText(decision, 30);
  if (!cleanSuggestionId || !cleanSuggestionId.startsWith("portfolio-response-rule:")) {
    throw new Error("유효한 규칙 개선 제안 ID가 필요합니다.");
  }
  if (!ALLOWED_ACTIONS.has(cleanAction)) {
    throw new Error("지원하지 않는 포트폴리오 대응 규칙입니다.");
  }
  if (!cleanProposal) throw new Error("승인할 검토 규칙 내용이 필요합니다.");
  if (!ALLOWED_DECISIONS.has(cleanDecision)) {
    throw new Error("규칙 개선 제안은 승인 또는 제외만 가능합니다.");
  }
  mkdirSync(dataDir, { recursive: true });
  const path = join(dataDir, STORE_FILE_NAME);
  const now = new Date().toISOString();
  const existing = readStore(path);
  const previous = existing.find((item) => item.suggestionId === cleanSuggestionId);
  const record = {
    suggestionId: cleanSuggestionId,
    action: cleanAction,
    proposal: cleanProposal,
    decision: cleanDecision,
    decisiveCount: Math.max(0, Number(decisiveCount) || 0),
    challengedCount: Math.max(0, Number(challengedCount) || 0),
    challengeRatePct: Math.max(0, Math.min(100, Number(challengeRatePct) || 0)),
    origin: cleanText(origin, 40),
    causeId: cleanText(causeId, 60),
    causeLabel: cleanText(causeLabel, 100),
    sourceGoalId: cleanText(sourceGoalId, 180),
    createdAt: previous?.createdAt || now,
    reviewedAt: now,
  };
  const decisions = existing
    .filter((item) => item.suggestionId !== cleanSuggestionId)
    .concat(record);
  writeStore(path, decisions);
  return {
    record,
    path: "data/pb-daily-intelligence/portfolio-response-rules.json",
  };
}

export function attachPortfolioResponseRuleDecisions(calibration = {}, decisions = []) {
  const decisionById = new Map(
    decisions.map((item) => [cleanText(item?.suggestionId, 160), item]),
  );
  return {
    ...calibration,
    ruleSuggestions: (calibration.ruleSuggestions || []).map((suggestion) => {
      const decision = decisionById.get(suggestion.suggestionId);
      return {
        ...suggestion,
        status: decision?.decision || "pending_approval",
        reviewedAt: decision?.reviewedAt || "",
      };
    }),
    activeRules: decisions
      .filter((item) =>
        item?.decision === "approved"
        && item?.lifecycleStatus !== "inactive"
      )
      .map((item) => ({
        suggestionId: item.suggestionId,
        action: item.action,
        proposal: item.proposal,
        origin: item.origin || "",
        causeId: item.causeId || "",
        causeLabel: item.causeLabel || "",
        sourceGoalId: item.sourceGoalId || "",
        approvedAt: item.reviewedAt,
      })),
  };
}

export function buildPortfolioResponseRuleImpact(activity = [], decisions = [], {
  minimumSamplePerGroup = 5,
} = {}) {
  const minimumSample = Math.max(1, Number(minimumSamplePerGroup) || 5);
  const decisiveRows = (Array.isArray(activity) ? activity : [])
    .filter((item) =>
      item?.portfolioResponseAction
      && ["supported", "challenged"].includes(
        item?.portfolioResponseEvaluation?.status,
      )
    );
  return decisions
    .filter((decision) =>
      decision?.decision === "approved"
      && decision?.lifecycleStatus !== "inactive"
    )
    .map((decision) => {
      const approvedAt = String(decision.reviewedAt || "");
      const sameAction = decisiveRows.filter(
        (item) => item.portfolioResponseAction === decision.action,
      );
      const after = sameAction.filter((item) =>
        (item.portfolioResponseRuleIds || []).includes(decision.suggestionId)
        && (
          !approvedAt
          || !item.portfolioResponseRecordedAt
          || String(item.portfolioResponseRecordedAt) >= approvedAt
        )
      );
      const before = sameAction.filter((item) => {
        const recordedAt = String(item.portfolioResponseRecordedAt || "");
        return !approvedAt || !recordedAt || recordedAt < approvedAt;
      });
      const summarize = (rows) => {
        const supported = rows.filter(
          (item) => item.portfolioResponseEvaluation?.status === "supported",
        ).length;
        const challenged = rows.length - supported;
        return {
          count: rows.length,
          supported,
          challenged,
          successRatePct: rows.length
            ? Number(((supported / rows.length) * 100).toFixed(1))
            : 0,
        };
      };
      const beforeSummary = summarize(before);
      const afterSummary = summarize(after);
      const comparisonReady =
        beforeSummary.count >= minimumSample
        && afterSummary.count >= minimumSample;
      const deltaPctPoint = comparisonReady
        ? Number(
          (afterSummary.successRatePct - beforeSummary.successRatePct).toFixed(1),
        )
        : null;
      const latestAfterRecordedAt = after
        .map((item) => String(item.portfolioResponseRecordedAt || ""))
        .sort()
        .at(-1) || "";
      const declineReviewed = comparisonReady
        && deltaPctPoint < 0
        && decision.managementDecision === "maintain"
        && decision.managementReviewedAt
        && (
          !latestAfterRecordedAt
          || String(decision.managementReviewedAt) >= latestAfterRecordedAt
        );
      return {
        suggestionId: decision.suggestionId,
        action: decision.action,
        proposal: decision.proposal,
        approvedAt,
        minimumSamplePerGroup: minimumSample,
        before: beforeSummary,
        after: afterSummary,
        comparisonReady,
        deltaPctPoint,
        latestAfterRecordedAt,
        status: !comparisonReady
          ? "insufficient_sample"
          : deltaPctPoint > 0
            ? "improved"
            : deltaPctPoint < 0
              ? declineReviewed
                ? "reviewed_decline"
                : "declined"
              : "unchanged",
        warning: comparisonReady
          ? ""
          : `적용 전·후 각각 ${minimumSample}건이 쌓여야 효과를 비교합니다.`,
      };
    })
    .sort((a, b) => String(b.approvedAt).localeCompare(String(a.approvedAt)));
}

export function buildPortfolioFailureCauseRuleImpact(
  activity = [],
  decisions = [],
  { minimumSamplePerGroup = 5 } = {},
) {
  const minimumSample = Math.max(1, Number(minimumSamplePerGroup) || 5);
  const decisiveRows = (Array.isArray(activity) ? activity : [])
    .filter((item) =>
      item?.portfolioResponseAction
      && ["supported", "challenged"].includes(
        item?.portfolioResponseEvaluation?.status,
      )
    );
  const rowCauseId = (item) => {
    if (item?.portfolioResponseEvaluation?.status !== "challenged") return "";
    return classifyMonthlyDecisionFailureCauses([{
      activityId: item.activityId,
      reportDate: item.reportDate,
      status: "challenged",
      riskId: item.riskId,
      title: item.title,
      note: item.portfolioResponseNote || item.summary,
      evaluationSummary: item.portfolioResponseEvaluation?.summary,
    }]).cases[0]?.causeId || "";
  };
  const recordedAt = (item) =>
    String(
      item?.portfolioResponseRecordedAt
      || (item?.reportDate ? `${item.reportDate}T23:59:59.999Z` : ""),
    );
  const summarize = (rows, causeId) => {
    const recurrenceCount = rows.filter(
      (item) => rowCauseId(item) === causeId,
    ).length;
    return {
      count: rows.length,
      recurrenceCount,
      recurrenceRatePct: rows.length
        ? Number(((recurrenceCount / rows.length) * 100).toFixed(1))
        : 0,
    };
  };
  return (Array.isArray(decisions) ? decisions : [])
    .filter((decision) =>
      decision?.decision === "approved"
      && decision?.lifecycleStatus !== "inactive"
      && decision?.origin === "failure_cause"
      && decision?.causeId
    )
    .map((decision) => {
      const approvedAt = String(decision.reviewedAt || "");
      const sameAction = decisiveRows.filter(
        (item) => item.portfolioResponseAction === decision.action,
      );
      const beforeRows = sameAction.filter(
        (item) => !approvedAt || !recordedAt(item) || recordedAt(item) < approvedAt,
      );
      const afterRows = sameAction.filter((item) =>
        (item.portfolioResponseRuleIds || []).includes(decision.suggestionId)
        && (!approvedAt || !recordedAt(item) || recordedAt(item) >= approvedAt)
      );
      const before = summarize(beforeRows, decision.causeId);
      const after = summarize(afterRows, decision.causeId);
      const comparisonReady =
        before.count >= minimumSample
        && after.count >= minimumSample;
      const recurrenceDeltaPctPoint = comparisonReady
        ? Number((after.recurrenceRatePct - before.recurrenceRatePct).toFixed(1))
        : null;
      const latestAfterRecordedAt = afterRows
        .map(recordedAt)
        .filter(Boolean)
        .sort()
        .at(-1) || "";
      const worseningReviewed = comparisonReady
        && recurrenceDeltaPctPoint > 0
        && decision.managementDecision === "maintain"
        && decision.managementReviewedAt
        && (
          !latestAfterRecordedAt
          || String(decision.managementReviewedAt) >= latestAfterRecordedAt
        );
      return {
        suggestionId: decision.suggestionId,
        action: decision.action,
        causeId: decision.causeId,
        causeLabel: decision.causeLabel || decision.causeId,
        approvedAt,
        minimumSamplePerGroup: minimumSample,
        before,
        after,
        comparisonReady,
        recurrenceDeltaPctPoint,
        latestAfterRecordedAt,
        status: !comparisonReady
          ? "insufficient_sample"
          : recurrenceDeltaPctPoint < 0
            ? "improved"
            : recurrenceDeltaPctPoint > 0
              ? worseningReviewed
                ? "reviewed_worsening"
                : "worsened"
              : "unchanged",
        warning: comparisonReady
          ? "동일 원인 후보의 재발 비율이며 확정 인과관계는 아닙니다."
          : `적용 전·후 결정 표본이 각각 ${minimumSample}건 이상이어야 재발률을 비교합니다.`,
      };
    })
    .sort((a, b) => String(b.approvedAt).localeCompare(String(a.approvedAt)));
}

export function reviewPortfolioResponseActiveRule({
  suggestionId,
  managementDecision,
  modifiedProposal = "",
  dataDir = DEFAULT_DATA_DIR,
} = {}) {
  const cleanSuggestionId = cleanText(suggestionId, 160);
  const cleanManagementDecision = cleanText(managementDecision, 30);
  const cleanModifiedProposal = cleanText(modifiedProposal, 1000);
  if (!ALLOWED_MANAGEMENT_DECISIONS.has(cleanManagementDecision)) {
    throw new Error("활성 규칙은 유지, 수정 또는 비활성화만 가능합니다.");
  }
  const path = join(dataDir, STORE_FILE_NAME);
  const existing = readStore(path);
  const previous = existing.find(
    (item) =>
      item.suggestionId === cleanSuggestionId
      && item.decision === "approved"
      && item.lifecycleStatus !== "inactive"
  );
  if (!previous) throw new Error("재검토할 활성 규칙을 찾지 못했습니다.");
  if (cleanManagementDecision === "modify" && !cleanModifiedProposal) {
    throw new Error("규칙 수정에는 새 검토 기준이 필요합니다.");
  }
  mkdirSync(dataDir, { recursive: true });
  const now = new Date().toISOString();
  const record = {
    ...previous,
    proposal: cleanManagementDecision === "modify"
      ? cleanModifiedProposal
      : previous.proposal,
    previousProposal: cleanManagementDecision === "modify"
      ? previous.proposal
      : previous.previousProposal || "",
    lifecycleStatus: cleanManagementDecision === "deactivate" ? "inactive" : "active",
    managementDecision: cleanManagementDecision,
    managementReviewedAt: now,
    reviewedAt: cleanManagementDecision === "modify" ? now : previous.reviewedAt,
  };
  const decisions = existing
    .filter((item) => item.suggestionId !== cleanSuggestionId)
    .concat(record);
  writeStore(path, decisions);
  return {
    record,
    path: "data/pb-daily-intelligence/portfolio-response-rules.json",
  };
}

export function buildMonthlyPortfolioDecisionReview(
  activity = [],
  decisions = [],
  {
    asOfDate = "",
    minimumRateSample = 10,
    minimumHabitSample = 3,
  } = {},
) {
  const cleanAsOfDate = cleanText(asOfDate, 20);
  const month = /^\d{4}-\d{2}-\d{2}$/.test(cleanAsOfDate)
    ? cleanAsOfDate.slice(0, 7)
    : new Date().toISOString().slice(0, 7);
  const minimumRate = Math.max(1, Number(minimumRateSample) || 10);
  const minimumHabit = Math.max(1, Number(minimumHabitSample) || 3);
  const rows = (Array.isArray(activity) ? activity : [])
    .filter((item) =>
      item?.portfolioResponseAction
      && String(item.reportDate || "").startsWith(month)
    );
  const statusCounts = {
    supported: 0,
    challenged: 0,
    inconclusive: 0,
    observed: 0,
    pending: 0,
    unavailable: 0,
  };
  const actionMap = new Map();
  for (const row of rows) {
    const status = statusCounts[row.portfolioResponseEvaluation?.status] === undefined
      ? "unavailable"
      : row.portfolioResponseEvaluation.status;
    statusCounts[status] += 1;
    const summary = actionMap.get(row.portfolioResponseAction) || {
      action: row.portfolioResponseAction,
      total: 0,
      supported: 0,
      challenged: 0,
      decisiveCount: 0,
      successRatePct: 0,
    };
    summary.total += 1;
    if (status === "supported") summary.supported += 1;
    if (status === "challenged") summary.challenged += 1;
    actionMap.set(row.portfolioResponseAction, summary);
  }
  const byAction = [...actionMap.values()]
    .map((item) => {
      const decisiveCount = item.supported + item.challenged;
      return {
        ...item,
        decisiveCount,
        successRatePct: decisiveCount
          ? Number(((item.supported / decisiveCount) * 100).toFixed(1))
          : 0,
      };
    })
    .sort((a, b) => b.total - a.total || a.action.localeCompare(b.action));
  const decisiveCount = statusCounts.supported + statusCounts.challenged;
  const successRateVisible = decisiveCount >= minimumRate;
  const successRatePct = decisiveCount
    ? Number(((statusCounts.supported / decisiveCount) * 100).toFixed(1))
    : 0;
  const habitCandidates = byAction.filter(
    (item) => item.decisiveCount >= minimumHabit,
  );
  const keepHabits = habitCandidates
    .filter((item) => item.successRatePct >= 70)
    .map((item) => ({
      action: item.action,
      decisiveCount: item.decisiveCount,
      successRatePct: item.successRatePct,
      summary: `결정 ${item.decisiveCount}건 중 ${item.supported}건이 판단 방향과 부합했습니다.`,
    }));
  const reviewHabits = habitCandidates
    .filter((item) => item.challenged / item.decisiveCount >= 0.5)
    .map((item) => ({
      action: item.action,
      decisiveCount: item.decisiveCount,
      challengeRatePct: Number(
        ((item.challenged / item.decisiveCount) * 100).toFixed(1),
      ),
      summary: `결정 ${item.decisiveCount}건 중 ${item.challenged}건이 판단 방향과 반대로 움직였습니다.`,
    }));
  const decisionRows = Array.isArray(decisions) ? decisions : [];
  const ruleActivity = {
    approved: decisionRows.filter(
      (item) =>
        item.decision === "approved"
        && String(item.createdAt || "").startsWith(month),
    ).length,
    modified: decisionRows.filter(
      (item) =>
        item.managementDecision === "modify"
        && String(item.managementReviewedAt || "").startsWith(month),
    ).length,
    deactivated: decisionRows.filter(
      (item) =>
        item.lifecycleStatus === "inactive"
        && String(item.managementReviewedAt || "").startsWith(month),
    ).length,
    active: decisionRows.filter(
      (item) =>
        item.decision === "approved"
        && item.lifecycleStatus !== "inactive",
    ).length,
  };
  return {
    month,
    totalCount: rows.length,
    decisiveCount,
    minimumRateSample: minimumRate,
    successRateVisible,
    successRatePct,
    counts: statusCounts,
    byAction,
    keepHabits,
    reviewHabits,
    ruleActivity,
    warning: successRateVisible
      ? ""
      : `결정 가능한 판단 ${decisiveCount}건으로 월간 부합률을 공개하지 않습니다. 최소 ${minimumRate}건이 필요합니다.`,
  };
}
