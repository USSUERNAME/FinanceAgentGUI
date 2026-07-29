import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import {
  attachPortfolioResponseRuleDecisions,
  buildMonthlyPortfolioDecisionReview,
  buildPortfolioFailureCauseRuleImpact,
  buildPortfolioResponseRuleImpact,
  readPortfolioResponseRuleDecisions,
  reviewPortfolioResponseActiveRule,
  reviewPortfolioResponseRuleSuggestion,
} from "../server/portfolioResponseRules.mjs";

test("portfolio response rules require explicit approval and persist separately", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "portfolio-response-rules-"));
  try {
    const result = reviewPortfolioResponseRuleSuggestion({
      suggestionId: "portfolio-response-rule:reduce_review",
      action: "reduce_review",
      proposal: "가격 추세와 공식 펀더멘털 악화를 함께 확인합니다.",
      decision: "approved",
      decisiveCount: 3,
      challengedCount: 2,
      challengeRatePct: 66.7,
      origin: "failure_cause",
      causeId: "event_interpretation",
      causeLabel: "이벤트 해석",
      sourceGoalId: "portfolio-decision-goal:2026-07:reduce_review",
      dataDir,
    });
    assert.equal(result.record.decision, "approved");
    const decisions = readPortfolioResponseRuleDecisions({ dataDir });
    assert.equal(decisions.length, 1);
    assert.equal(decisions[0].action, "reduce_review");
    assert.equal(decisions[0].causeId, "event_interpretation");

    const calibration = attachPortfolioResponseRuleDecisions({
      ruleSuggestions: [{
        suggestionId: "portfolio-response-rule:reduce_review",
        action: "reduce_review",
        proposal: "가격 추세와 공식 펀더멘털 악화를 함께 확인합니다.",
      }],
    }, decisions);
    assert.equal(calibration.ruleSuggestions[0].status, "approved");
    assert.equal(calibration.activeRules.length, 1);
    assert.equal(calibration.activeRules[0].action, "reduce_review");
    assert.equal(calibration.activeRules[0].causeLabel, "이벤트 해석");
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("rejected portfolio response rules never become active", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "portfolio-response-rules-"));
  try {
    reviewPortfolioResponseRuleSuggestion({
      suggestionId: "portfolio-response-rule:maintain",
      action: "maintain",
      proposal: "상대강도와 무효화 조건을 함께 확인합니다.",
      decision: "rejected",
      dataDir,
    });
    const calibration = attachPortfolioResponseRuleDecisions(
      { ruleSuggestions: [] },
      readPortfolioResponseRuleDecisions({ dataDir }),
    );
    assert.equal(calibration.activeRules.length, 0);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("portfolio response rule impact compares only acknowledged after records", () => {
  const suggestionId = "portfolio-response-rule:reduce_review";
  const decisions = [{
    suggestionId,
    action: "reduce_review",
    proposal: "가격 추세와 공식 펀더멘털 악화를 함께 확인합니다.",
    decision: "approved",
    reviewedAt: "2026-07-20T00:00:00.000Z",
  }];
  const activity = [
    ...Array.from({ length: 5 }, (_, index) => ({
      activityId: `before-${index}`,
      portfolioResponseAction: "reduce_review",
      portfolioResponseRecordedAt: `2026-07-1${index}T00:00:00.000Z`,
      portfolioResponseRuleIds: [],
      portfolioResponseEvaluation: {
        status: index < 2 ? "supported" : "challenged",
      },
    })),
    ...Array.from({ length: 5 }, (_, index) => ({
      activityId: `after-${index}`,
      portfolioResponseAction: "reduce_review",
      portfolioResponseRecordedAt: `2026-07-2${index + 1}T00:00:00.000Z`,
      portfolioResponseRuleIds: [suggestionId],
      portfolioResponseEvaluation: {
        status: index < 4 ? "supported" : "challenged",
      },
    })),
    {
      activityId: "unrelated",
      portfolioResponseAction: "maintain",
      portfolioResponseRuleIds: [],
      portfolioResponseEvaluation: { status: "supported" },
    },
  ];
  const [impact] = buildPortfolioResponseRuleImpact(activity, decisions);
  assert.equal(impact.comparisonReady, true);
  assert.equal(impact.before.successRatePct, 40);
  assert.equal(impact.after.successRatePct, 80);
  assert.equal(impact.deltaPctPoint, 40);
  assert.equal(impact.status, "improved");
});

test("portfolio response rule impact hides thin-sample comparisons", () => {
  const [impact] = buildPortfolioResponseRuleImpact(
    [{
      portfolioResponseAction: "maintain",
      portfolioResponseRuleIds: [],
      portfolioResponseEvaluation: { status: "supported" },
    }],
    [{
      suggestionId: "portfolio-response-rule:maintain",
      action: "maintain",
      proposal: "상대강도와 무효화 조건을 확인합니다.",
      decision: "approved",
      reviewedAt: "2026-07-20T00:00:00.000Z",
    }],
  );
  assert.equal(impact.comparisonReady, false);
  assert.equal(impact.deltaPctPoint, null);
  assert.match(impact.warning, /각각 5건/);
});

test("failure cause rule impact measures recurrence only for the same cause", () => {
  const suggestionId =
    "portfolio-response-rule:cause:reduce_review:event_interpretation";
  const decisions = [{
    suggestionId,
    action: "reduce_review",
    proposal: "확인된 사실과 시장 해석을 분리합니다.",
    origin: "failure_cause",
    causeId: "event_interpretation",
    causeLabel: "이벤트 해석",
    decision: "approved",
    reviewedAt: "2026-07-20T00:00:00.000Z",
  }];
  const activity = [
    ...Array.from({ length: 5 }, (_, index) => ({
      activityId: `before-${index}`,
      reportDate: `2026-07-1${index}`,
      title: index < 3 ? "실적 이벤트 해석" : "판단 부합",
      portfolioResponseAction: "reduce_review",
      portfolioResponseRecordedAt: `2026-07-1${index}T00:00:00.000Z`,
      portfolioResponseRuleIds: [],
      portfolioResponseEvaluation: {
        status: index < 3 ? "challenged" : "supported",
        summary: index < 3 ? "실적 발표 이후 반대로 움직임" : "판단 부합",
      },
    })),
    ...Array.from({ length: 5 }, (_, index) => ({
      activityId: `after-${index}`,
      reportDate: `2026-07-2${index + 1}`,
      title: index === 0
        ? "공시 이벤트 해석"
        : index === 1
          ? "섹터 상대강도 판단"
          : "판단 부합",
      portfolioResponseAction: "reduce_review",
      portfolioResponseRecordedAt: `2026-07-2${index + 1}T00:00:00.000Z`,
      portfolioResponseRuleIds: [suggestionId],
      portfolioResponseEvaluation: {
        status: index < 2 ? "challenged" : "supported",
        summary: index === 0
          ? "공시 발표를 잘못 해석"
          : index === 1
            ? "섹터 상대강도가 반대로 움직임"
            : "판단 부합",
      },
    })),
  ];

  const [impact] = buildPortfolioFailureCauseRuleImpact(activity, decisions);
  assert.equal(impact.comparisonReady, true);
  assert.equal(impact.before.recurrenceRatePct, 60);
  assert.equal(impact.after.recurrenceRatePct, 20);
  assert.equal(impact.recurrenceDeltaPctPoint, -40);
  assert.equal(impact.status, "improved");
});

test("failure cause recurrence stays hidden below the before and after sample gate", () => {
  const [impact] = buildPortfolioFailureCauseRuleImpact(
    [{
      activityId: "after-1",
      reportDate: "2026-07-21",
      title: "실적 이벤트 해석",
      portfolioResponseAction: "maintain",
      portfolioResponseRecordedAt: "2026-07-21T00:00:00.000Z",
      portfolioResponseRuleIds: [
        "portfolio-response-rule:cause:maintain:event_interpretation",
      ],
      portfolioResponseEvaluation: {
        status: "challenged",
        summary: "실적 발표 이후 반대로 움직임",
      },
    }],
    [{
      suggestionId:
        "portfolio-response-rule:cause:maintain:event_interpretation",
      action: "maintain",
      origin: "failure_cause",
      causeId: "event_interpretation",
      causeLabel: "이벤트 해석",
      decision: "approved",
      reviewedAt: "2026-07-20T00:00:00.000Z",
    }],
  );

  assert.equal(impact.comparisonReady, false);
  assert.equal(impact.recurrenceDeltaPctPoint, null);
  assert.match(impact.warning, /각각 5건/);
});

test("maintained worsening cause rules reopen only after new evidence", () => {
  const suggestionId =
    "portfolio-response-rule:cause:maintain:event_interpretation";
  const before = Array.from({ length: 5 }, (_, index) => ({
    activityId: `before-${index}`,
    reportDate: `2026-07-1${index}`,
    title: index === 0 ? "실적 이벤트 해석" : "판단 부합",
    portfolioResponseAction: "maintain",
    portfolioResponseRecordedAt: `2026-07-1${index}T00:00:00.000Z`,
    portfolioResponseRuleIds: [],
    portfolioResponseEvaluation: {
      status: index === 0 ? "challenged" : "supported",
      summary: index === 0 ? "실적 발표 이후 반대로 움직임" : "판단 부합",
    },
  }));
  const after = Array.from({ length: 5 }, (_, index) => ({
    activityId: `after-${index}`,
    reportDate: `2026-07-2${index + 1}`,
    title: index < 3 ? "공시 이벤트 해석" : "판단 부합",
    portfolioResponseAction: "maintain",
    portfolioResponseRecordedAt: `2026-07-2${index + 1}T00:00:00.000Z`,
    portfolioResponseRuleIds: [suggestionId],
    portfolioResponseEvaluation: {
      status: index < 3 ? "challenged" : "supported",
      summary: index < 3 ? "공시 발표 이후 반대로 움직임" : "판단 부합",
    },
  }));
  const decision = {
    suggestionId,
    action: "maintain",
    origin: "failure_cause",
    causeId: "event_interpretation",
    causeLabel: "이벤트 해석",
    decision: "approved",
    reviewedAt: "2026-07-20T00:00:00.000Z",
    managementDecision: "maintain",
    managementReviewedAt: "2026-07-26T00:00:00.000Z",
  };

  const [reviewed] = buildPortfolioFailureCauseRuleImpact(
    [...before, ...after],
    [decision],
  );
  assert.equal(reviewed.status, "reviewed_worsening");

  const [reopened] = buildPortfolioFailureCauseRuleImpact(
    [
      ...before,
      ...after,
      {
        activityId: "after-new",
        reportDate: "2026-07-27",
        title: "실적 이벤트 해석",
        portfolioResponseAction: "maintain",
        portfolioResponseRecordedAt: "2026-07-27T00:00:00.000Z",
        portfolioResponseRuleIds: [suggestionId],
        portfolioResponseEvaluation: {
          status: "challenged",
          summary: "실적 발표 이후 반대로 움직임",
        },
      },
    ],
    [decision],
  );
  assert.equal(reopened.status, "worsened");
  assert.equal(reopened.latestAfterRecordedAt, "2026-07-27T00:00:00.000Z");
});

test("maintained declining rules wait for new evidence before reopening review", () => {
  const suggestionId = "portfolio-response-rule:reduce_review";
  const activity = [
    ...Array.from({ length: 5 }, (_, index) => ({
      portfolioResponseAction: "reduce_review",
      portfolioResponseRecordedAt: `2026-07-1${index}T00:00:00.000Z`,
      portfolioResponseRuleIds: [],
      portfolioResponseEvaluation: { status: "supported" },
    })),
    ...Array.from({ length: 5 }, (_, index) => ({
      portfolioResponseAction: "reduce_review",
      portfolioResponseRecordedAt: `2026-07-2${index + 1}T00:00:00.000Z`,
      portfolioResponseRuleIds: [suggestionId],
      portfolioResponseEvaluation: {
        status: index < 2 ? "supported" : "challenged",
      },
    })),
  ];
  const [impact] = buildPortfolioResponseRuleImpact(activity, [{
    suggestionId,
    action: "reduce_review",
    proposal: "가격 추세와 펀더멘털 악화를 확인합니다.",
    decision: "approved",
    reviewedAt: "2026-07-20T00:00:00.000Z",
    managementDecision: "maintain",
    managementReviewedAt: "2026-07-29T00:00:00.000Z",
  }]);
  assert.equal(impact.deltaPctPoint, -60);
  assert.equal(impact.status, "reviewed_decline");
});

test("active portfolio response rules require explicit management decisions", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "portfolio-response-rules-"));
  try {
    reviewPortfolioResponseRuleSuggestion({
      suggestionId: "portfolio-response-rule:exit_review",
      action: "exit_review",
      proposal: "가설 무효화와 상대약세를 함께 확인합니다.",
      decision: "approved",
      dataDir,
    });
    const modified = reviewPortfolioResponseActiveRule({
      suggestionId: "portfolio-response-rule:exit_review",
      managementDecision: "modify",
      modifiedProposal: "가설 무효화와 섹터 상대약세를 2거래일 확인합니다.",
      dataDir,
    });
    assert.equal(modified.record.managementDecision, "modify");
    assert.match(modified.record.previousProposal, /상대약세/);
    assert.match(modified.record.proposal, /2거래일/);

    const deactivated = reviewPortfolioResponseActiveRule({
      suggestionId: "portfolio-response-rule:exit_review",
      managementDecision: "deactivate",
      dataDir,
    });
    assert.equal(deactivated.record.lifecycleStatus, "inactive");
    const calibration = attachPortfolioResponseRuleDecisions(
      { ruleSuggestions: [] },
      readPortfolioResponseRuleDecisions({ dataDir }),
    );
    assert.equal(calibration.activeRules.length, 0);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("active portfolio response rule modification requires replacement text", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "portfolio-response-rules-"));
  try {
    reviewPortfolioResponseRuleSuggestion({
      suggestionId: "portfolio-response-rule:maintain",
      action: "maintain",
      proposal: "상대강도와 무효화 조건을 확인합니다.",
      decision: "approved",
      dataDir,
    });
    assert.throws(
      () => reviewPortfolioResponseActiveRule({
        suggestionId: "portfolio-response-rule:maintain",
        managementDecision: "modify",
        modifiedProposal: "",
        dataDir,
      }),
      /새 검토 기준/,
    );
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("monthly portfolio decision review separates habits and rule activity", () => {
  const activity = [
    ...Array.from({ length: 5 }, (_, index) => ({
      reportDate: `2026-07-${10 + index}`,
      portfolioResponseAction: "maintain",
      portfolioResponseEvaluation: { status: "supported" },
    })),
    ...Array.from({ length: 5 }, (_, index) => ({
      reportDate: `2026-07-${20 + index}`,
      portfolioResponseAction: "reduce_review",
      portfolioResponseEvaluation: {
        status: index < 2 ? "supported" : "challenged",
      },
    })),
    {
      reportDate: "2026-06-30",
      portfolioResponseAction: "maintain",
      portfolioResponseEvaluation: { status: "challenged" },
    },
  ];
  const review = buildMonthlyPortfolioDecisionReview(
    activity,
    [{
      suggestionId: "portfolio-response-rule:maintain",
      action: "maintain",
      proposal: "상대강도와 무효화 조건을 확인합니다.",
      decision: "approved",
      lifecycleStatus: "active",
      createdAt: "2026-07-15T00:00:00.000Z",
      managementDecision: "modify",
      managementReviewedAt: "2026-07-25T00:00:00.000Z",
    }, {
      suggestionId: "portfolio-response-rule:exit_review",
      action: "exit_review",
      proposal: "가설 무효화를 확인합니다.",
      decision: "approved",
      lifecycleStatus: "inactive",
      createdAt: "2026-06-10T00:00:00.000Z",
      managementDecision: "deactivate",
      managementReviewedAt: "2026-07-26T00:00:00.000Z",
    }],
    { asOfDate: "2026-07-29" },
  );
  assert.equal(review.month, "2026-07");
  assert.equal(review.totalCount, 10);
  assert.equal(review.decisiveCount, 10);
  assert.equal(review.successRateVisible, true);
  assert.equal(review.successRatePct, 70);
  assert.equal(review.keepHabits[0].action, "maintain");
  assert.equal(review.reviewHabits[0].action, "reduce_review");
  assert.deepEqual(review.ruleActivity, {
    approved: 1,
    modified: 1,
    deactivated: 1,
    active: 1,
  });
});

test("monthly portfolio decision review hides thin sample rates", () => {
  const review = buildMonthlyPortfolioDecisionReview(
    [{
      reportDate: "2026-07-29",
      portfolioResponseAction: "maintain",
      portfolioResponseEvaluation: { status: "supported" },
    }],
    [],
    { asOfDate: "2026-07-29" },
  );
  assert.equal(review.successRateVisible, false);
  assert.match(review.warning, /최소 10건/);
});
