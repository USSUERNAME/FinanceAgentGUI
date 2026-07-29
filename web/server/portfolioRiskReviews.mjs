import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const WEB_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const GUIBUILD_ROOT = resolve(WEB_ROOT, "..");
const DEFAULT_DATA_DIR = join(GUIBUILD_ROOT, "data", "pb-daily-intelligence");
const STORE_FILE_NAME = "portfolio-risk-reviews.json";
const ALLOWED_STATUSES = new Set(["pending", "checked", "deferred", "resolved"]);
const MAX_RECORDS = 500;

function cleanText(value, limit = 500) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, limit);
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

export function savePortfolioRiskReview({
  reportDate,
  riskId,
  status,
  note = "",
  reviewDate = "",
  title = "",
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
  mkdirSync(dataDir, { recursive: true });
  const path = join(dataDir, STORE_FILE_NAME);
  const existing = readStore(path);
  const now = new Date().toISOString();
  const previous = existing.find(
    (item) => item.reportDate === cleanDate && item.riskId === cleanRiskId,
  );
  const review = {
    reportDate: cleanDate,
    riskId: cleanRiskId,
    title: cleanText(title, 160) || previous?.title || cleanRiskId,
    status: cleanStatus,
    note: cleanText(note, 500),
    reviewDate: cleanStatus === "deferred" ? cleanReviewDate : "",
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

export function listDuePortfolioRiskReviews({
  asOfDate,
  dataDir = DEFAULT_DATA_DIR,
} = {}) {
  const cleanDate = cleanText(asOfDate, 20);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cleanDate)) return [];
  return readStore(join(dataDir, STORE_FILE_NAME))
    .filter((item) =>
      item?.status === "deferred"
      && /^\d{4}-\d{2}-\d{2}$/.test(item?.reviewDate || "")
      && item.reviewDate <= cleanDate,
    )
    .sort((a, b) =>
      String(a.reviewDate || "").localeCompare(String(b.reviewDate || ""))
      || String(a.riskId || "").localeCompare(String(b.riskId || "")),
    );
}

export function attachPortfolioRiskReviews({
  reportDate,
  actions = [],
  dataDir = DEFAULT_DATA_DIR,
} = {}) {
  const reviews = readPortfolioRiskReviews({ reportDate, dataDir });
  const reviewByRiskId = new Map(reviews.map((item) => [item.riskId, item]));
  const annotated = (Array.isArray(actions) ? actions : []).map((action) => ({
    ...action,
    review: reviewByRiskId.get(action.id) || {
      reportDate: cleanText(reportDate, 20),
      riskId: action.id,
      status: "pending",
      note: "",
      reviewDate: "",
      createdAt: "",
      updatedAt: "",
    },
  }));
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
  };
}
