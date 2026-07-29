import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  attachPortfolioRiskReviews,
  buildPortfolioRiskFollowUpQueue,
  buildPortfolioRiskReviewAnalytics,
  classifyPortfolioRiskDeferReason,
  listDuePortfolioRiskReviews,
  portfolioRiskDeferFollowUp,
  portfolioRiskThesisContinuityIds,
  readPortfolioRiskReviews,
  reviewPortfolioRiskThesisProposal,
  savePortfolioRiskResponse,
  savePortfolioRiskFollowUp,
  savePortfolioRiskReview,
} from "../server/portfolioRiskReviews.mjs";

test("portfolio risks map only to bounded stock and sector thesis ids", () => {
  assert.deepEqual(portfolioRiskThesisContinuityIds("stock:NVDA"), ["pb-stock-nvda"]);
  assert.deepEqual(portfolioRiskThesisContinuityIds("sector:XLK"), ["pb-sector-xlk"]);
  assert.deepEqual(
    portfolioRiskThesisContinuityIds("conflict:NVDA:XLK"),
    ["pb-stock-nvda", "pb-sector-xlk"],
  );
  assert.deepEqual(portfolioRiskThesisContinuityIds("unmapped:NVDA"), []);
});

test("portfolio risk defer reasons classify bounded legacy notes", () => {
  assert.equal(classifyPortfolioRiskDeferReason("실적 발표 후 다시 판단"), "event_wait");
  assert.equal(classifyPortfolioRiskDeferReason("확인할 자료가 부족함"), "data_gap");
  assert.equal(classifyPortfolioRiskDeferReason("판단 기준이 모호함"), "criteria_unclear");
  assert.equal(classifyPortfolioRiskDeferReason("조금 더 생각"), "other");
});

test("portfolio risk defer follow-ups route to bounded evidence surfaces", () => {
  assert.equal(
    portfolioRiskDeferFollowUp({ deferReason: "data_gap" }).target,
    "research-operations",
  );
  assert.equal(
    portfolioRiskDeferFollowUp({ deferReason: "criteria_unclear" }).target,
    "investment-thesis-memory",
  );
  assert.equal(
    portfolioRiskDeferFollowUp({
      deferReason: "event_wait",
      note: "CPI 발표 대기",
    }).target,
    "economic-calendar",
  );
  assert.equal(
    portfolioRiskDeferFollowUp({
      deferReason: "event_wait",
      note: "NVDA 실적 발표 대기",
    }).target,
    "earning-calendar",
  );
});

test("portfolio risk reviews persist by report date and risk id", () => {
  const dataDir = mkdtempSync(join(tmpdir(), "portfolio-risk-review-"));
  const saved = savePortfolioRiskReview({
    reportDate: "2026-07-29",
    riskId: "stock:NVDA",
    status: "checked",
    note: "실적과 거래량 확인 완료",
    dataDir,
  });
  assert.equal(saved.review.status, "checked");
  const reviews = readPortfolioRiskReviews({ reportDate: "2026-07-29", dataDir });
  assert.equal(reviews.length, 1);
  assert.equal(reviews[0].note, "실적과 거래량 확인 완료");
});

test("completed risk reviews wait for an explicit thesis proposal decision", () => {
  const dataDir = mkdtempSync(join(tmpdir(), "portfolio-risk-review-"));
  const saved = savePortfolioRiskReview({
    reportDate: "2026-07-29",
    riskId: "stock:NVDA",
    status: "checked",
    note: "공식 실적 근거가 기존 가설을 약화함",
    thesisImpact: "contradicts",
    dataDir,
  });
  assert.deepEqual(saved.review.thesisContinuityIds, ["pb-stock-nvda"]);
  assert.equal(saved.review.thesisImpact, "contradicts");
  assert.equal(saved.review.thesisProposalStatus, "pending");

  const reviewed = reviewPortfolioRiskThesisProposal({
    reportDate: "2026-07-29",
    riskId: "stock:NVDA",
    decision: "approved",
    dataDir,
  });
  assert.equal(reviewed.review.thesisProposalStatus, "approved");
  assert.match(reviewed.review.thesisProposalReviewedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.throws(
    () => reviewPortfolioRiskThesisProposal({
      reportDate: "2026-07-29",
      riskId: "stock:NVDA",
      decision: "approved",
      dataDir,
    }),
    /승인 대기/,
  );

  savePortfolioRiskReview({
    reportDate: "2026-07-29",
    riskId: "sector:XLK",
    status: "checked",
    note: "가격 신호만으로는 기존 가설을 바꾸지 않음",
    thesisImpact: "neutral",
    dataDir,
  });
  const rejected = reviewPortfolioRiskThesisProposal({
    reportDate: "2026-07-29",
    riskId: "sector:XLK",
    decision: "rejected",
    dataDir,
  });
  assert.equal(rejected.review.thesisProposalStatus, "rejected");
  assert.throws(
    () => savePortfolioRiskResponse({
      reportDate: "2026-07-29",
      riskId: "sector:XLK",
      action: "maintain",
      note: "반영 제외 항목",
      dataDir,
    }),
    /가설 반영이 승인된/,
  );

  const response = savePortfolioRiskResponse({
    reportDate: "2026-07-29",
    riskId: "stock:NVDA",
    action: "increase_monitoring",
    note: "다음 실적 전까지 관찰 빈도를 높임",
    reviewDate: "2026-08-01",
    metricId: "stock_close",
    metricLabel: "종목 종가",
    metricTicker: "NVDA",
    baselineValue: 125.5,
    baselineDate: "2026-07-29",
    acknowledgedRuleIds: ["portfolio-response-rule:increase_monitoring"],
    dataDir,
  });
  assert.equal(response.review.portfolioResponseAction, "increase_monitoring");
  assert.equal(response.review.portfolioResponseReviewDate, "2026-08-01");
  assert.equal(response.review.portfolioResponseMetricId, "stock_close");
  assert.equal(response.review.portfolioResponseBaselineValue, 125.5);
  assert.deepEqual(
    response.review.portfolioResponseRuleIds,
    ["portfolio-response-rule:increase_monitoring"],
  );
  assert.match(
    response.review.portfolioResponseRuleAcknowledgedAt,
    /^\d{4}-\d{2}-\d{2}T/,
  );
  assert.match(response.review.portfolioResponseRecordedAt, /^\d{4}-\d{2}-\d{2}T/);
});

test("portfolio response journal requires an approved thesis decision and rationale", () => {
  const dataDir = mkdtempSync(join(tmpdir(), "portfolio-risk-review-"));
  savePortfolioRiskReview({
    reportDate: "2026-07-29",
    riskId: "stock:NVDA",
    status: "checked",
    note: "근거 확인",
    dataDir,
  });
  assert.throws(
    () => savePortfolioRiskResponse({
      reportDate: "2026-07-29",
      riskId: "stock:NVDA",
      action: "maintain",
      note: "아직 승인 전",
      dataDir,
    }),
    /가설 반영이 승인된/,
  );
  reviewPortfolioRiskThesisProposal({
    reportDate: "2026-07-29",
    riskId: "stock:NVDA",
    decision: "approved",
    dataDir,
  });
  assert.throws(
    () => savePortfolioRiskResponse({
      reportDate: "2026-07-29",
      riskId: "stock:NVDA",
      action: "maintain",
      note: "",
      dataDir,
    }),
    /근거 메모/,
  );
  assert.throws(
    () => savePortfolioRiskResponse({
      reportDate: "2026-07-29",
      riskId: "stock:NVDA",
      action: "buy_now",
      note: "허용되지 않은 자동 대응",
      dataDir,
    }),
    /지원하지 않는/,
  );
});

test("portfolio risk reviews replace the same date and risk id", () => {
  const dataDir = mkdtempSync(join(tmpdir(), "portfolio-risk-review-"));
  savePortfolioRiskReview({
    reportDate: "2026-07-29",
    riskId: "sector:XLK",
    status: "deferred",
    note: "장 마감 후 재검토",
    reviewDate: "2026-07-30",
    dataDir,
  });
  savePortfolioRiskReview({
    reportDate: "2026-07-29",
    riskId: "sector:XLK",
    status: "resolved",
    note: "집중도 기준 하회",
    dataDir,
  });
  const reviews = readPortfolioRiskReviews({ reportDate: "2026-07-29", dataDir });
  assert.equal(reviews.length, 1);
  assert.equal(reviews[0].status, "resolved");
  assert.equal(reviews[0].note, "집중도 기준 하회");
  assert.equal(reviews[0].followUpStatus, "completed");
  assert.match(reviews[0].followUpCompletedAt, /^\d{4}-\d{2}-\d{2}T/);
});

test("portfolio risk actions receive pending defaults and review summary", () => {
  const dataDir = mkdtempSync(join(tmpdir(), "portfolio-risk-review-"));
  savePortfolioRiskReview({
    reportDate: "2026-07-29",
    riskId: "stock:NVDA",
    status: "checked",
    dataDir,
  });
  const result = attachPortfolioRiskReviews({
    reportDate: "2026-07-29",
    actions: [{ id: "stock:NVDA" }, { id: "unmapped:ABC" }],
    dataDir,
  });
  assert.equal(result.actions[0].review.status, "checked");
  assert.equal(result.actions[1].review.status, "pending");
  assert.deepEqual(result.summary, {
    total: 2,
    pending: 1,
    checked: 1,
    deferred: 0,
    resolved: 0,
    completed: 1,
  });
});

test("portfolio risk reviews reject unsupported states", () => {
  const dataDir = mkdtempSync(join(tmpdir(), "portfolio-risk-review-"));
  assert.throws(() => savePortfolioRiskReview({
    reportDate: "2026-07-29",
    riskId: "stock:NVDA",
    status: "approved",
    dataDir,
  }), /지원하지 않는/);
});

test("portfolio risk reviews require a date when deferred", () => {
  const dataDir = mkdtempSync(join(tmpdir(), "portfolio-risk-review-"));
  assert.throws(() => savePortfolioRiskReview({
    reportDate: "2026-07-29",
    riskId: "stock:NVDA",
    status: "deferred",
    dataDir,
  }), /재검토 날짜/);
});

test("portfolio risk follow-up state progresses independently from review status", () => {
  const dataDir = mkdtempSync(join(tmpdir(), "portfolio-risk-review-"));
  savePortfolioRiskReview({
    reportDate: "2026-07-29",
    riskId: "stock:NVDA",
    status: "deferred",
    reviewDate: "2026-07-30",
    deferReason: "event_wait",
    dataDir,
  });
  const started = savePortfolioRiskFollowUp({
    reportDate: "2026-07-29",
    riskId: "stock:NVDA",
    status: "in_progress",
    dataDir,
  });
  assert.equal(started.review.status, "deferred");
  assert.equal(started.review.followUpStatus, "in_progress");
  assert.match(started.review.followUpStartedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(started.review.followUpCompletedAt, "");

  const completed = savePortfolioRiskFollowUp({
    reportDate: "2026-07-29",
    riskId: "stock:NVDA",
    status: "completed",
    evidenceUrl: "https://www.sec.gov/Archives/example",
    evidenceNote: "공식 공시와 가격 반응 확인",
    dataDir,
  });
  assert.equal(completed.review.followUpStatus, "completed");
  assert.equal(completed.review.followUpStartedAt, started.review.followUpStartedAt);
  assert.match(completed.review.followUpCompletedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(completed.review.followUpEvidenceUrl, "https://www.sec.gov/Archives/example");
  assert.equal(completed.review.followUpEvidenceNote, "공식 공시와 가격 반응 확인");
});

test("portfolio risk follow-up completion requires evidence", () => {
  const dataDir = mkdtempSync(join(tmpdir(), "portfolio-risk-review-"));
  savePortfolioRiskReview({
    reportDate: "2026-07-29",
    riskId: "stock:NVDA",
    status: "deferred",
    reviewDate: "2026-07-30",
    dataDir,
  });
  assert.throws(() => savePortfolioRiskFollowUp({
    reportDate: "2026-07-29",
    riskId: "stock:NVDA",
    status: "completed",
    dataDir,
  }), /근거 링크 또는 근거 메모/);
  assert.throws(() => savePortfolioRiskFollowUp({
    reportDate: "2026-07-29",
    riskId: "stock:NVDA",
    status: "completed",
    evidenceUrl: "file:///private/report.pdf",
    dataDir,
  }), /http 또는 https/);
  assert.throws(() => savePortfolioRiskReview({
    reportDate: "2026-07-29",
    riskId: "stock:NVDA",
    status: "resolved",
    dataDir,
  }), /검토 메모 또는 저장된 근거/);
});

test("portfolio risk follow-up state rejects non-deferred reviews", () => {
  const dataDir = mkdtempSync(join(tmpdir(), "portfolio-risk-review-"));
  savePortfolioRiskReview({
    reportDate: "2026-07-29",
    riskId: "stock:NVDA",
    status: "checked",
    dataDir,
  });
  assert.throws(() => savePortfolioRiskFollowUp({
    reportDate: "2026-07-29",
    riskId: "stock:NVDA",
    status: "in_progress",
    dataDir,
  }), /보류 중인 위험/);
});

test("portfolio risk reviews surface due deferred records across report dates", () => {
  const dataDir = mkdtempSync(join(tmpdir(), "portfolio-risk-review-"));
  savePortfolioRiskReview({
    reportDate: "2026-07-28",
    riskId: "stock:NVDA",
    title: "NVDA 종목 집중",
    status: "deferred",
    reviewDate: "2026-07-29",
    dataDir,
  });
  savePortfolioRiskReview({
    reportDate: "2026-07-29",
    riskId: "sector:XLK",
    title: "기술 섹터 집중",
    status: "deferred",
    reviewDate: "2026-08-01",
    dataDir,
  });
  const due = listDuePortfolioRiskReviews({
    asOfDate: "2026-07-29",
    dataDir,
  });
  assert.equal(due.length, 1);
  assert.equal(due[0].riskId, "stock:NVDA");
  assert.equal(due[0].title, "NVDA 종목 집중");
});

test("portfolio risk follow-up queue prioritizes active overdue and not-started work", () => {
  const dataDir = mkdtempSync(join(tmpdir(), "portfolio-risk-review-"));
  savePortfolioRiskReview({
    reportDate: "2026-07-25",
    riskId: "stock:NVDA",
    title: "NVDA 종목 집중",
    status: "deferred",
    reviewDate: "2026-07-27",
    deferReason: "event_wait",
    dataDir,
  });
  savePortfolioRiskReview({
    reportDate: "2026-07-25",
    riskId: "sector:XLK",
    title: "기술 섹터 집중",
    status: "deferred",
    reviewDate: "2026-07-28",
    deferReason: "data_gap",
    dataDir,
  });
  savePortfolioRiskFollowUp({
    reportDate: "2026-07-25",
    riskId: "sector:XLK",
    status: "in_progress",
    dataDir,
  });
  savePortfolioRiskReview({
    reportDate: "2026-07-26",
    riskId: "stock:TSLA",
    title: "TSLA 이벤트 대기",
    status: "deferred",
    reviewDate: "2026-08-02",
    deferReason: "event_wait",
    dataDir,
  });
  savePortfolioRiskReview({
    reportDate: "2026-07-24",
    riskId: "stock:MSFT",
    title: "MSFT 과거 보류",
    status: "deferred",
    reviewDate: "2026-07-25",
    dataDir,
  });
  savePortfolioRiskReview({
    reportDate: "2026-07-28",
    riskId: "stock:MSFT",
    title: "MSFT 위험 해소",
    status: "resolved",
    note: "집중도 기준 하회",
    dataDir,
  });

  const queue = buildPortfolioRiskFollowUpQueue({
    asOfDate: "2026-07-29",
    dataDir,
  });
  assert.deepEqual(queue.items.map((item) => item.riskId), [
    "stock:NVDA",
    "sector:XLK",
    "stock:TSLA",
  ]);
  assert.equal(queue.items[0].priority, "overdue_not_started");
  assert.equal(queue.items[0].daysOverdue, 2);
  assert.equal(queue.items[1].priority, "overdue_in_progress");
  assert.equal(queue.items[2].priority, "upcoming_not_started");
  assert.deepEqual(queue.counts, {
    total: 3,
    overdue: 2,
    dueToday: 0,
    notStarted: 2,
    inProgress: 1,
  });
});

test("portfolio risk review analytics separates completion overdue and repeat deferrals", () => {
  const dataDir = mkdtempSync(join(tmpdir(), "portfolio-risk-review-"));
  const rows = [
    ["2026-07-20", "stock:NVDA", "deferred", "2026-07-22", "event_wait"],
    ["2026-07-21", "stock:NVDA", "deferred", "2026-07-30", "event_wait"],
    ["2026-07-22", "sector:XLK", "checked", "", ""],
    ["2026-07-23", "conflict:TSLA:XLY", "resolved", "", ""],
    ["2026-07-24", "unmapped:ABC", "pending", "", ""],
  ];
  for (const [reportDate, riskId, status, reviewDate, deferReason] of rows) {
    savePortfolioRiskReview({
      reportDate,
      riskId,
      title: riskId,
      status,
      reviewDate,
      deferReason,
      dataDir,
    });
  }
  const analytics = buildPortfolioRiskReviewAnalytics({
    asOfDate: "2026-07-29",
    dataDir,
  });
  assert.equal(analytics.sampleCount, 5);
  assert.equal(analytics.eligible, true);
  assert.equal(analytics.completionRate, 40);
  assert.equal(analytics.counts.overdue, 1);
  assert.equal(analytics.repeatedDeferrals[0].riskId, "stock:NVDA");
  assert.equal(analytics.repeatedDeferrals[0].count, 2);
  assert.equal(analytics.repeatedDeferrals[0].primaryReason, "event_wait");
  assert.equal(
    analytics.deferReasons.find((item) => item.id === "event_wait").count,
    2,
  );
  assert.deepEqual(analytics.followUpCounts, {
    not_started: 2,
    in_progress: 0,
    completed: 0,
  });
  assert.equal(analytics.status, "attention");
});
