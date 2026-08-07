import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const WEB_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const GUIBUILD_ROOT = resolve(WEB_ROOT, "..");
const DEFAULT_DATA_DIR = join(GUIBUILD_ROOT, "data", "pb-daily-intelligence");
const STORE_FILE_NAME = "portfolio-risk-reviews.json";
const ALLOWED_STATUSES = new Set(["pending", "checked", "deferred", "resolved"]);
const ALLOWED_FOLLOW_UP_STATUSES = new Set(["not_started", "in_progress", "completed"]);
const ALLOWED_THESIS_IMPACTS = new Set(["supports", "contradicts", "neutral"]);
const ALLOWED_THESIS_PROPOSAL_DECISIONS = new Set(["approved", "rejected"]);
const ALLOWED_PORTFOLIO_RESPONSES = new Set([
  "maintain",
  "increase_monitoring",
  "reduce_review",
  "exit_review",
  "no_position_change",
]);
const DEFER_REASON_LABELS = {
  data_gap: "데이터 부족",
  criteria_unclear: "판단 기준 불명확",
  event_wait: "이벤트 대기",
  other: "기타",
};
const ALLOWED_DEFER_REASONS = new Set(Object.keys(DEFER_REASON_LABELS));
const MAX_RECORDS = 500;

function cleanText(value, limit = 500) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, limit);
}

function cleanEvidenceUrl(value) {
  const raw = cleanText(value, 1000);
  if (!raw) return "";
  try {
    const url = new URL(raw);
    if (!["http:", "https:"].includes(url.protocol)) {
      throw new Error("unsupported protocol");
    }
    return url.toString();
  } catch {
    throw new Error("근거 링크는 유효한 http 또는 https 주소여야 합니다.");
  }
}

function readStore(path) {
  if (!existsSync(path)) return [];
  try {
    const payload = JSON.parse(readFileSync(path, "utf8"));
    return Array.isArray(payload?.reviews) ? payload.reviews : [];
  } catch {
    return [];
  }
}

function writeStore(path, reviews) {
  const payload = {
    schemaVersion: "portfolio-risk-reviews.v1",
    updatedAt: new Date().toISOString(),
    reviews: reviews.slice(-MAX_RECORDS),
  };
  const tmpPath = `${path}.tmp`;
  writeFileSync(tmpPath, `${JSON.stringify(payload, null, 2)}\n`);
  renameSync(tmpPath, path);
}

export function classifyPortfolioRiskDeferReason(note = "") {
  const text = cleanText(note, 500).toLowerCase();
  if (/(실적|발표|이벤트|장 마감|공시|회의|fomc|cpi|고용)/i.test(text)) {
    return "event_wait";
  }
  if (/(데이터|자료|수치|근거|표본|정보).*(부족|없|대기|필요)|확인할 자료/i.test(text)) {
    return "data_gap";
  }
  if (/(기준|판단|조건|정의).*(불명확|모호|정리|설정|필요)|판단하기 어려/i.test(text)) {
    return "criteria_unclear";
  }
  return "other";
}

export function portfolioRiskDeferFollowUp(review = {}) {
  const reason = ALLOWED_DEFER_REASONS.has(review?.deferReason)
    ? review.deferReason
    : classifyPortfolioRiskDeferReason(review?.note);
  if (reason === "data_gap") {
    return {
      reason,
      label: "필요한 근거 확인",
      description: "검증 대기열에서 공식 원문·가격·리서치 누락을 확인합니다.",
      target: "research-operations",
      targetType: "view",
    };
  }
  if (reason === "criteria_unclear") {
    return {
      reason,
      label: "판단 기준 작성",
      description: "투자 가설 원장에 확인 조건·무효화 조건·검토 기한을 명시합니다.",
      target: "investment-thesis-memory",
      targetType: "section",
    };
  }
  if (reason === "event_wait") {
    const macroEvent = /(fomc|cpi|고용|금리|연준|fed|gdp|물가|경제)/i.test(
      cleanText(review?.note, 500),
    );
    return {
      reason,
      label: macroEvent ? "경제 일정 확인" : "실적 일정 확인",
      description: macroEvent
        ? "경제 캘린더에서 발표 시각과 관련 시장 변수를 확인합니다."
        : "실적 캘린더에서 발표일과 가이던스 확인 항목을 점검합니다.",
      target: macroEvent ? "economic-calendar" : "earning-calendar",
      targetType: "view",
    };
  }
  return {
    reason: "other",
    label: "검토 메모 보완",
    description: "보류 이유와 다음에 결론을 바꿀 객관적 조건을 메모에 추가합니다.",
    target: "portfolio-risk-review",
    targetType: "section",
  };
}

export function readPortfolioRiskReviews({
  reportDate = "",
  dataDir = DEFAULT_DATA_DIR,
} = {}) {
  const cleanDate = cleanText(reportDate, 20);
  const path = join(dataDir, STORE_FILE_NAME);
  return readStore(path)
    .filter((item) => !cleanDate || item.reportDate === cleanDate)
    .sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
}

export function portfolioRiskThesisContinuityIds(riskId = "") {
  const parts = cleanText(riskId, 160).split(":").filter(Boolean);
  if (parts[0] === "stock" && parts[1]) {
    return [`pb-stock-${parts[1].toLowerCase()}`];
  }
  if (parts[0] === "sector" && parts[1]) {
    return [`pb-sector-${parts[1].toLowerCase()}`];
  }
  if (parts[0] === "conflict") {
    return [
      parts[1] ? `pb-stock-${parts[1].toLowerCase()}` : "",
      parts[2] ? `pb-sector-${parts[2].toLowerCase()}` : "",
    ].filter(Boolean);
  }
  return [];
}

export function savePortfolioRiskReview({
  reportDate,
  riskId,
  status,
  note = "",
  reviewDate = "",
  title = "",
  deferReason = "",
  thesisImpact = "",
  dataDir = DEFAULT_DATA_DIR,
} = {}) {
  const cleanDate = cleanText(reportDate, 20);
  const cleanRiskId = cleanText(riskId, 160);
  const cleanStatus = cleanText(status, 30);
  if (!cleanDate || !/^\d{4}-\d{2}-\d{2}$/.test(cleanDate)) {
    throw new Error("유효한 리포트 날짜가 필요합니다.");
  }
  if (!cleanRiskId) throw new Error("검토할 위험 ID가 필요합니다.");
  if (!ALLOWED_STATUSES.has(cleanStatus)) {
    throw new Error("지원하지 않는 위험 검토 상태입니다.");
  }
  const cleanReviewDate = cleanText(reviewDate, 20);
  if (cleanStatus === "deferred" && !/^\d{4}-\d{2}-\d{2}$/.test(cleanReviewDate)) {
    throw new Error("보류 상태에는 재검토 날짜가 필요합니다.");
  }
  const cleanDeferReason = cleanText(deferReason, 40);
  const normalizedDeferReason = ALLOWED_DEFER_REASONS.has(cleanDeferReason)
    ? cleanDeferReason
    : classifyPortfolioRiskDeferReason(note);
  mkdirSync(dataDir, { recursive: true });
  const path = join(dataDir, STORE_FILE_NAME);
  const existing = readStore(path);
  const now = new Date().toISOString();
  const previous = existing.find(
    (item) => item.reportDate === cleanDate && item.riskId === cleanRiskId,
  );
  const continuesSameDeferral = cleanStatus === "deferred"
    && previous?.status === "deferred"
    && previous.reviewDate === cleanReviewDate
    && previous.deferReason === normalizedDeferReason;
  const completesFollowUp = previous?.status === "deferred"
    && ["checked", "resolved"].includes(cleanStatus);
  const thesisContinuityIds = portfolioRiskThesisContinuityIds(cleanRiskId);
  const normalizedThesisImpact = ALLOWED_THESIS_IMPACTS.has(cleanText(thesisImpact, 30))
    ? cleanText(thesisImpact, 30)
    : cleanStatus === "resolved"
      ? "supports"
      : "neutral";
  const proposesThesisUpdate = ["checked", "resolved"].includes(cleanStatus)
    && thesisContinuityIds.length > 0;
  if (
    completesFollowUp
    && !previous?.followUpEvidenceUrl
    && !previous?.followUpEvidenceNote
    && !cleanText(note, 500)
  ) {
    throw new Error("보류 항목을 완료하려면 검토 메모 또는 저장된 근거가 필요합니다.");
  }
  const review = {
    reportDate: cleanDate,
    riskId: cleanRiskId,
    title: cleanText(title, 160) || previous?.title || cleanRiskId,
    status: cleanStatus,
    note: cleanText(note, 500),
    reviewDate: cleanStatus === "deferred" ? cleanReviewDate : "",
    deferReason: cleanStatus === "deferred" ? normalizedDeferReason : "",
    followUpStatus: completesFollowUp
      ? "completed"
      : cleanStatus === "deferred"
        ? continuesSameDeferral
          ? previous?.followUpStatus || "not_started"
          : "not_started"
        : previous?.followUpStatus || "",
    followUpStartedAt: completesFollowUp
      ? previous?.followUpStartedAt || now
      : continuesSameDeferral
        ? previous?.followUpStartedAt || ""
        : "",
    followUpCompletedAt: completesFollowUp
      ? previous?.followUpCompletedAt || now
      : continuesSameDeferral
        ? previous?.followUpCompletedAt || ""
        : "",
    followUpEvidenceUrl: continuesSameDeferral || completesFollowUp
      ? previous?.followUpEvidenceUrl || ""
      : "",
    followUpEvidenceNote: completesFollowUp
      ? previous?.followUpEvidenceNote || cleanText(note, 500)
      : continuesSameDeferral
        ? previous?.followUpEvidenceNote || ""
        : "",
    thesisContinuityIds,
    thesisImpact: proposesThesisUpdate ? normalizedThesisImpact : "",
    thesisProposalStatus: proposesThesisUpdate ? "pending" : "",
    thesisProposalReviewedAt: "",
    portfolioResponseAction: "",
    portfolioResponseNote: "",
    portfolioResponseReviewDate: "",
    portfolioResponseRecordedAt: "",
    portfolioResponseRuleIds: [],
    portfolioResponseRuleAcknowledgedAt: "",
    createdAt: previous?.createdAt || now,
    updatedAt: now,
  };
  const reviews = existing
    .filter((item) => !(item.reportDate === cleanDate && item.riskId === cleanRiskId))
    .concat(review)
    .sort((a, b) =>
      `${a.reportDate}:${a.riskId}`.localeCompare(`${b.reportDate}:${b.riskId}`),
    );
  writeStore(path, reviews);
  return {
    review,
    path: "data/pb-daily-intelligence/portfolio-risk-reviews.json",
  };
}

export function reviewPortfolioRiskThesisProposal({
  reportDate,
  riskId,
  decision,
  dataDir = DEFAULT_DATA_DIR,
} = {}) {
  const cleanDate = cleanText(reportDate, 20);
  const cleanRiskId = cleanText(riskId, 160);
  const cleanDecision = cleanText(decision, 30);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cleanDate) || !cleanRiskId) {
    throw new Error("유효한 위험 검토 기록이 필요합니다.");
  }
  if (!ALLOWED_THESIS_PROPOSAL_DECISIONS.has(cleanDecision)) {
    throw new Error("지원하지 않는 가설 반영 결정입니다.");
  }
  const path = join(dataDir, STORE_FILE_NAME);
  const existing = readStore(path);
  const previous = existing.find(
    (item) => item.reportDate === cleanDate && item.riskId === cleanRiskId,
  );
  if (!previous || previous.thesisProposalStatus !== "pending") {
    throw new Error("승인 대기 중인 가설 반영 제안을 찾지 못했습니다.");
  }
  const review = {
    ...previous,
    thesisProposalStatus: cleanDecision,
    thesisProposalReviewedAt: new Date().toISOString(),
    portfolioResponseAction: "",
    portfolioResponseNote: "",
    portfolioResponseReviewDate: "",
    portfolioResponseRecordedAt: "",
    portfolioResponseRuleIds: [],
    portfolioResponseRuleAcknowledgedAt: "",
    updatedAt: new Date().toISOString(),
  };
  const reviews = existing
    .filter((item) => !(item.reportDate === cleanDate && item.riskId === cleanRiskId))
    .concat(review)
    .sort((a, b) =>
      `${a.reportDate}:${a.riskId}`.localeCompare(`${b.reportDate}:${b.riskId}`),
    );
  writeStore(path, reviews);
  return {
    review,
    path: "data/pb-daily-intelligence/portfolio-risk-reviews.json",
  };
}

export function savePortfolioRiskResponse({
  reportDate,
  riskId,
  action,
  note,
  reviewDate = "",
  metricId = "",
  metricLabel = "",
  metricTicker = "",
  baselineValue = null,
  baselineDate = "",
  acknowledgedRuleIds = [],
  dataDir = DEFAULT_DATA_DIR,
} = {}) {
  const cleanDate = cleanText(reportDate, 20);
  const cleanRiskId = cleanText(riskId, 160);
  const cleanAction = cleanText(action, 40);
  const cleanNote = cleanText(note, 500);
  const cleanReviewDate = cleanText(reviewDate, 20);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cleanDate) || !cleanRiskId) {
    throw new Error("유효한 위험 검토 기록이 필요합니다.");
  }
  if (!ALLOWED_PORTFOLIO_RESPONSES.has(cleanAction)) {
    throw new Error("지원하지 않는 포트폴리오 대응 판단입니다.");
  }
  if (!cleanNote) {
    throw new Error("포트폴리오 대응 판단에는 근거 메모가 필요합니다.");
  }
  if (cleanReviewDate && !/^\d{4}-\d{2}-\d{2}$/.test(cleanReviewDate)) {
    throw new Error("재검토일은 유효한 날짜여야 합니다.");
  }
  mkdirSync(dataDir, { recursive: true });
  const path = join(dataDir, STORE_FILE_NAME);
  const existing = readStore(path);
  const previous = existing.find(
    (item) => item.reportDate === cleanDate && item.riskId === cleanRiskId,
  );
  if (!previous || previous.thesisProposalStatus !== "approved") {
    throw new Error("가설 반영이 승인된 위험 검토만 포트폴리오 대응을 기록할 수 있습니다.");
  }
  const now = new Date().toISOString();
  const cleanAcknowledgedRuleIds = [...new Set(
    (Array.isArray(acknowledgedRuleIds) ? acknowledgedRuleIds : [])
      .map((item) => cleanText(item, 160))
      .filter((item) => item.startsWith("portfolio-response-rule:")),
  )].slice(0, 10);
  const numericBaseline = baselineValue === null || baselineValue === ""
    ? null
    : Number(baselineValue);
  const review = {
    ...previous,
    portfolioResponseAction: cleanAction,
    portfolioResponseNote: cleanNote,
    portfolioResponseReviewDate: cleanReviewDate,
    portfolioResponseRecordedAt: now,
    portfolioResponseMetricId: cleanText(metricId, 80),
    portfolioResponseMetricLabel: cleanText(metricLabel, 120),
    portfolioResponseMetricTicker: cleanText(metricTicker, 20).toUpperCase(),
    portfolioResponseBaselineValue: Number.isFinite(numericBaseline)
      ? numericBaseline
      : null,
    portfolioResponseBaselineDate: /^\d{4}-\d{2}-\d{2}$/.test(cleanText(baselineDate, 20))
      ? cleanText(baselineDate, 20)
      : "",
    portfolioResponseRuleIds: cleanAcknowledgedRuleIds,
    portfolioResponseRuleAcknowledgedAt: cleanAcknowledgedRuleIds.length ? now : "",
    updatedAt: now,
  };
  const reviews = existing
    .filter((item) => !(item.reportDate === cleanDate && item.riskId === cleanRiskId))
    .concat(review)
    .sort((a, b) =>
      `${a.reportDate}:${a.riskId}`.localeCompare(`${b.reportDate}:${b.riskId}`),
    );
  writeStore(path, reviews);
  return {
    review,
    path: "data/pb-daily-intelligence/portfolio-risk-reviews.json",
  };
}

export function savePortfolioRiskFollowUp({
  reportDate,
  riskId,
  status,
  evidenceUrl = "",
  evidenceNote = "",
  dataDir = DEFAULT_DATA_DIR,
} = {}) {
  const cleanDate = cleanText(reportDate, 20);
  const cleanRiskId = cleanText(riskId, 160);
  const cleanStatus = cleanText(status, 30);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cleanDate) || !cleanRiskId) {
    throw new Error("유효한 위험 검토 기록이 필요합니다.");
  }
  if (!ALLOWED_FOLLOW_UP_STATUSES.has(cleanStatus)) {
    throw new Error("지원하지 않는 후속 작업 상태입니다.");
  }
  mkdirSync(dataDir, { recursive: true });
  const path = join(dataDir, STORE_FILE_NAME);
  const existing = readStore(path);
  const previous = existing.find(
    (item) => item.reportDate === cleanDate && item.riskId === cleanRiskId,
  );
  if (!previous || previous.status !== "deferred") {
    throw new Error("보류 중인 위험만 후속 작업 상태를 변경할 수 있습니다.");
  }
  const cleanEvidenceReference = cleanEvidenceUrl(evidenceUrl);
  const cleanEvidenceNote = cleanText(evidenceNote, 500);
  const savedEvidenceUrl = cleanEvidenceReference || previous.followUpEvidenceUrl || "";
  const savedEvidenceNote = cleanEvidenceNote || previous.followUpEvidenceNote || "";
  if (cleanStatus === "completed" && !savedEvidenceUrl && !savedEvidenceNote) {
    throw new Error("후속 작업 완료에는 근거 링크 또는 근거 메모가 필요합니다.");
  }
  const now = new Date().toISOString();
  const review = {
    ...previous,
    followUpStatus: cleanStatus,
    followUpStartedAt: cleanStatus === "not_started"
      ? ""
      : previous.followUpStartedAt || now,
    followUpCompletedAt: cleanStatus === "completed" ? now : "",
    followUpEvidenceUrl: savedEvidenceUrl,
    followUpEvidenceNote: savedEvidenceNote,
    updatedAt: now,
  };
  const reviews = existing
    .filter((item) => !(item.reportDate === cleanDate && item.riskId === cleanRiskId))
    .concat(review)
    .sort((a, b) =>
      `${a.reportDate}:${a.riskId}`.localeCompare(`${b.reportDate}:${b.riskId}`),
    );
  writeStore(path, reviews);
  return {
    review,
    path: "data/pb-daily-intelligence/portfolio-risk-reviews.json",
  };
}

export function listDuePortfolioRiskReviews({
  asOfDate,
  dataDir = DEFAULT_DATA_DIR,
} = {}) {
  return buildPortfolioRiskFollowUpQueue({ asOfDate, dataDir }).items
    .filter((item) => ["overdue", "due_today"].includes(item.dueState));
}

function dateDistanceDays(fromDate, toDate) {
  const from = new Date(`${fromDate}T00:00:00.000Z`);
  const to = new Date(`${toDate}T00:00:00.000Z`);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return 0;
  return Math.round((to.getTime() - from.getTime()) / 86_400_000);
}

export function buildPortfolioRiskFollowUpQueue({
  asOfDate,
  dataDir = DEFAULT_DATA_DIR,
} = {}) {
  const cleanDate = cleanText(asOfDate, 20);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cleanDate)) {
    return {
      asOfDate: cleanDate,
      counts: { total: 0, overdue: 0, dueToday: 0, notStarted: 0, inProgress: 0 },
      items: [],
    };
  }
  const latestByRiskId = new Map();
  for (const review of readStore(join(dataDir, STORE_FILE_NAME))) {
    if (!review?.riskId || review.reportDate > cleanDate) continue;
    const previous = latestByRiskId.get(review.riskId);
    if (
      !previous
      || review.reportDate > previous.reportDate
      || (
        review.reportDate === previous.reportDate
        && String(review.updatedAt || "") > String(previous.updatedAt || "")
      )
    ) {
      latestByRiskId.set(review.riskId, review);
    }
  }
  const priorityRank = {
    overdue_not_started: 0,
    overdue_in_progress: 1,
    due_today: 2,
    upcoming_not_started: 3,
  };
  const items = [...latestByRiskId.values()]
    .filter((item) => item.status === "deferred")
    .map((item) => {
      const followUpStatus = ALLOWED_FOLLOW_UP_STATUSES.has(item.followUpStatus)
        ? item.followUpStatus
        : "not_started";
      const hasReviewDate = /^\d{4}-\d{2}-\d{2}$/.test(item.reviewDate || "");
      const dueState = !hasReviewDate
        ? "unscheduled"
        : item.reviewDate < cleanDate
          ? "overdue"
          : item.reviewDate === cleanDate
            ? "due_today"
            : "upcoming";
      const priority = dueState === "overdue"
        ? followUpStatus === "not_started"
          ? "overdue_not_started"
          : "overdue_in_progress"
        : dueState === "due_today"
          ? "due_today"
          : "upcoming_not_started";
      return {
        ...item,
        followUpStatus,
        dueState,
        daysOverdue: dueState === "overdue"
          ? dateDistanceDays(item.reviewDate, cleanDate)
          : 0,
        priority,
        nextStep: portfolioRiskDeferFollowUp(item),
      };
    })
    .filter((item) =>
      item.followUpStatus !== "completed"
      && (
        ["overdue", "due_today"].includes(item.dueState)
        || item.followUpStatus === "not_started"
      ))
    .sort((a, b) =>
      (priorityRank[a.priority] ?? 9) - (priorityRank[b.priority] ?? 9)
      || String(a.reviewDate || "9999-12-31").localeCompare(
        String(b.reviewDate || "9999-12-31"),
      )
      || String(a.riskId || "").localeCompare(String(b.riskId || "")),
    );
  return {
    asOfDate: cleanDate,
    counts: {
      total: items.length,
      overdue: items.filter((item) => item.dueState === "overdue").length,
      dueToday: items.filter((item) => item.dueState === "due_today").length,
      notStarted: items.filter((item) => item.followUpStatus === "not_started").length,
      inProgress: items.filter((item) => item.followUpStatus === "in_progress").length,
    },
    items,
  };
}

function reviewWindowStart(asOfDate, days) {
  const date = new Date(`${asOfDate}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return "";
  date.setUTCDate(date.getUTCDate() - Math.max(1, Number(days) || 30) + 1);
  return date.toISOString().slice(0, 10);
}

export function buildPortfolioRiskReviewAnalytics({
  asOfDate,
  days = 30,
  dataDir = DEFAULT_DATA_DIR,
} = {}) {
  const cleanDate = cleanText(asOfDate, 20);
  const windowDays = Math.max(7, Math.min(90, Number(days) || 30));
  const startDate = reviewWindowStart(cleanDate, windowDays);
  if (!startDate) {
    return {
      days: windowDays,
      sampleCount: 0,
      eligible: false,
      completionRate: null,
      counts: { pending: 0, checked: 0, deferred: 0, resolved: 0, overdue: 0 },
      repeatedDeferrals: [],
    };
  }
  const reviews = readStore(join(dataDir, STORE_FILE_NAME))
    .filter((item) => item?.reportDate >= startDate && item.reportDate <= cleanDate);
  const counts = { pending: 0, checked: 0, deferred: 0, resolved: 0, overdue: 0 };
  const deferralsByRiskId = new Map();
  const deferReasonCounts = Object.fromEntries(
    Object.keys(DEFER_REASON_LABELS).map((key) => [key, 0]),
  );
  const followUpCounts = { not_started: 0, in_progress: 0, completed: 0 };
  for (const review of reviews) {
    const status = ALLOWED_STATUSES.has(review?.status) ? review.status : "pending";
    counts[status] += 1;
    if (
      status === "deferred"
      && /^\d{4}-\d{2}-\d{2}$/.test(review?.reviewDate || "")
      && review.reviewDate <= cleanDate
    ) {
      counts.overdue += 1;
    }
    if (status === "deferred") {
      const deferReason = ALLOWED_DEFER_REASONS.has(review?.deferReason)
        ? review.deferReason
        : classifyPortfolioRiskDeferReason(review?.note);
      deferReasonCounts[deferReason] += 1;
      const followUpStatus = ALLOWED_FOLLOW_UP_STATUSES.has(review?.followUpStatus)
        ? review.followUpStatus
        : "not_started";
      followUpCounts[followUpStatus] += 1;
      const current = deferralsByRiskId.get(review.riskId) || {
        riskId: review.riskId,
        title: review.title || review.riskId,
        count: 0,
        lastReportDate: "",
        nextReviewDate: "",
        reasonCounts: {},
      };
      current.count += 1;
      current.reasonCounts[deferReason] = (current.reasonCounts[deferReason] || 0) + 1;
      if (!current.lastReportDate || review.reportDate > current.lastReportDate) {
        current.lastReportDate = review.reportDate;
        current.nextReviewDate = review.reviewDate || "";
        current.title = review.title || current.title;
      }
      deferralsByRiskId.set(review.riskId, current);
    }
  }
  const completed = counts.checked + counts.resolved;
  const eligible = reviews.length >= 5;
  const repeatedDeferrals = [...deferralsByRiskId.values()]
    .filter((item) => item.count >= 2)
    .map((item) => {
      const primaryReason = Object.entries(item.reasonCounts)
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] || "other";
      return {
        ...item,
        primaryReason,
        primaryReasonLabel: DEFER_REASON_LABELS[primaryReason],
        nextStep: portfolioRiskDeferFollowUp({
          ...item,
          deferReason: primaryReason,
        }),
      };
    })
    .sort((a, b) => b.count - a.count || a.riskId.localeCompare(b.riskId));
  return {
    days: windowDays,
    startDate,
    endDate: cleanDate,
    sampleCount: reviews.length,
    eligible,
    completionRate: eligible ? Math.round((completed / reviews.length) * 100) : null,
    counts,
    followUpCounts,
    deferReasons: Object.entries(deferReasonCounts).map(([id, count]) => ({
      id,
      label: DEFER_REASON_LABELS[id],
      count,
    })),
    repeatedDeferrals,
    status: counts.overdue || repeatedDeferrals.length
      ? "attention"
      : eligible
        ? "stable"
        : "insufficient_sample",
    label: counts.overdue || repeatedDeferrals.length
      ? "재검토 필요"
      : eligible
        ? "안정"
        : "표본 부족",
  };
}

export function attachPortfolioRiskReviews({
  reportDate,
  actions = [],
  dataDir = DEFAULT_DATA_DIR,
} = {}) {
  const reviews = readPortfolioRiskReviews({ reportDate, dataDir });
  const reviewByRiskId = new Map(reviews.map((item) => [item.riskId, item]));
  const annotated = (Array.isArray(actions) ? actions : []).map((action) => {
    const savedReview = reviewByRiskId.get(action.id);
    const review = savedReview
      ? {
        ...savedReview,
        nextStep: savedReview.status === "deferred"
          ? portfolioRiskDeferFollowUp(savedReview)
          : null,
      }
      : {
      reportDate: cleanText(reportDate, 20),
      riskId: action.id,
      status: "pending",
      note: "",
      reviewDate: "",
      deferReason: "",
      followUpStatus: "",
      followUpStartedAt: "",
      followUpCompletedAt: "",
      followUpEvidenceUrl: "",
      followUpEvidenceNote: "",
      thesisContinuityIds: [],
      thesisImpact: "",
      thesisProposalStatus: "",
      thesisProposalReviewedAt: "",
      createdAt: "",
      updatedAt: "",
      nextStep: null,
    };
    return { ...action, review };
  });
  const counts = { pending: 0, checked: 0, deferred: 0, resolved: 0 };
  for (const action of annotated) {
    const status = ALLOWED_STATUSES.has(action.review?.status)
      ? action.review.status
      : "pending";
    counts[status] += 1;
  }
  return {
    actions: annotated,
    summary: {
      total: annotated.length,
      ...counts,
      completed: counts.checked + counts.resolved,
    },
    dueFollowUps: listDuePortfolioRiskReviews({ asOfDate: reportDate, dataDir }),
    followUpQueue: buildPortfolioRiskFollowUpQueue({ asOfDate: reportDate, dataDir }),
    analytics: buildPortfolioRiskReviewAnalytics({
      asOfDate: reportDate,
      days: 30,
      dataDir,
    }),
  };
}
