import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  attachPortfolioRiskReviews,
  listDuePortfolioRiskReviews,
  readPortfolioRiskReviews,
  savePortfolioRiskReview,
} from "../server/portfolioRiskReviews.mjs";

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
