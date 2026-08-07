import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import {
  attachMonthlyDecisionGoals,
  buildMonthlyDecisionGoalAlerts,
  buildMonthlyDecisionGoalProposals,
  buildMonthlyFailureChecklistSuggestions,
  classifyMonthlyDecisionFailureCauses,
  readPortfolioDecisionGoals,
  reviewMonthlyDecisionGoalProposal,
} from "../server/portfolioDecisionGoals.mjs";

test("monthly review habits become approval-only next-month goals", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "portfolio-decision-goals-"));
  try {
    const [proposal] = buildMonthlyDecisionGoalProposals({
      month: "2026-07",
      reviewHabits: [{
        action: "reduce_review",
        challengeRatePct: 60,
      }],
    });
    assert.equal(proposal.targetMonth, "2026-08");
    assert.equal(proposal.targetChallengeRatePct, 45);
    assert.equal(proposal.status, "pending_approval");

    reviewMonthlyDecisionGoalProposal({
      proposal,
      decision: "approved",
      dataDir,
    });
    const goals = readPortfolioDecisionGoals({ dataDir });
    const plan = attachMonthlyDecisionGoals(
      { month: "2026-08", byAction: [] },
      [],
      goals,
      {
        asOfDate: "2026-08-20",
        activity: Array.from({ length: 5 }, (_, index) => ({
          activityId: `activity-${index}`,
          reportDate: `2026-08-${10 + index}`,
          riskId: `stock:TEST${index}`,
          title: `판단 사례 ${index}`,
          portfolioResponseNote: `판단 메모 ${index}`,
          targets: [{ entityId: `TEST${index}` }],
          portfolioResponseAction: "reduce_review",
          portfolioResponseEvaluation: {
            status: index < 4 ? "supported" : "challenged",
            label: index < 4 ? "판단 부합" : "판단과 반대",
            summary: `평가 요약 ${index}`,
          },
        })),
      },
    );
    assert.equal(plan.activeGoals.length, 1);
    assert.equal(plan.activeGoals[0].progressStatus, "achieved");
    assert.equal(plan.activeGoals[0].challengeRatePct, 20);
    assert.equal(plan.activeGoals[0].evidenceCases.length, 5);
    assert.equal(plan.activeGoals[0].evidenceCases[0].reportDate, "2026-08-14");
    assert.equal(plan.activeGoals[0].evidenceCases[0].targets[0], "TEST4");
    assert.equal(plan.activeGoals[0].evidenceCases[0].evaluationSummary, "평가 요약 4");
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("excluded monthly goals never become active", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "portfolio-decision-goals-"));
  try {
    const [proposal] = buildMonthlyDecisionGoalProposals({
      month: "2026-07",
      reviewHabits: [{ action: "maintain", challengeRatePct: 50 }],
    });
    reviewMonthlyDecisionGoalProposal({
      proposal,
      decision: "rejected",
      dataDir,
    });
    const plan = attachMonthlyDecisionGoals(
      { month: "2026-08", byAction: [] },
      [],
      readPortfolioDecisionGoals({ dataDir }),
      { asOfDate: "2026-08-29", activity: [] },
    );
    assert.equal(plan.activeGoals.length, 0);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("past monthly goals miss only after the target month closes", () => {
  const goal = {
    goalId: "portfolio-decision-goal:2026-07:maintain",
    sourceMonth: "2026-07",
    targetMonth: "2026-08",
    action: "maintain",
    targetChallengeRatePct: 35,
    minimumDecisiveSample: 5,
    summary: "반대 비율을 낮춥니다.",
    decision: "approved",
  };
  const activity = Array.from({ length: 5 }, (_, index) => ({
    reportDate: `2026-08-${10 + index}`,
    portfolioResponseAction: "maintain",
    portfolioResponseEvaluation: {
      status: index < 2 ? "supported" : "challenged",
    },
  }));
  const during = attachMonthlyDecisionGoals(
    { month: "2026-08", byAction: [] },
    [],
    [goal],
    { asOfDate: "2026-08-29", activity },
  );
  assert.equal(during.activeGoals[0].progressStatus, "in_progress");
  const after = attachMonthlyDecisionGoals(
    { month: "2026-09", byAction: [] },
    [],
    [goal],
    { asOfDate: "2026-09-01", activity },
  );
  assert.equal(after.activeGoals[0].progressStatus, "missed");
});

test("monthly goals alert near month end only when decision samples are short", () => {
  const goal = {
    goalId: "portfolio-decision-goal:2026-07:monitor",
    targetMonth: "2026-08",
    action: "monitor",
    progressStatus: "in_progress",
    decisiveCount: 2,
    minimumDecisiveSample: 5,
    challengeRatePct: 50,
    targetChallengeRatePct: 35,
  };
  const alerts = buildMonthlyDecisionGoalAlerts(
    [goal],
    { asOfDate: "2026-08-27" },
  );

  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].alertType, "sample_shortfall");
  assert.equal(alerts[0].daysRemaining, 4);
  assert.match(alerts[0].summary, /2\/5/);
  assert.equal(buildMonthlyDecisionGoalAlerts(
    [{ ...goal, decisiveCount: 5 }],
    { asOfDate: "2026-08-27" },
  ).length, 0);
  assert.equal(buildMonthlyDecisionGoalAlerts(
    [goal],
    { asOfDate: "2026-08-20" },
  ).length, 0);
});

test("monthly goals emit stable achieved and missed alerts", () => {
  const base = {
    goalId: "portfolio-decision-goal:2026-07:monitor",
    targetMonth: "2026-08",
    action: "monitor",
    decisiveCount: 5,
    minimumDecisiveSample: 5,
    challengeRatePct: 20,
    targetChallengeRatePct: 35,
  };
  const [achieved] = buildMonthlyDecisionGoalAlerts(
    [{ ...base, progressStatus: "achieved" }],
    { asOfDate: "2026-08-20" },
  );
  const [missed] = buildMonthlyDecisionGoalAlerts(
    [{ ...base, progressStatus: "missed", challengeRatePct: 60 }],
    { asOfDate: "2026-09-01" },
  );

  assert.equal(achieved.alertType, "achieved");
  assert.equal(achieved.level, "watch");
  assert.match(achieved.id, /:achieved$/);
  assert.equal(missed.alertType, "missed");
  assert.equal(missed.level, "critical");
  assert.match(missed.id, /:missed$/);
});

test("repeated challenged cases surface only evidence-backed failure cause candidates", () => {
  const result = classifyMonthlyDecisionFailureCauses([
    {
      activityId: "a1",
      reportDate: "2026-08-10",
      status: "challenged",
      title: "실적 발표 이후 판단",
      note: "가이던스 해석이 낙관적이었습니다.",
      evaluationSummary: "가격은 반대로 움직였습니다.",
    },
    {
      activityId: "a2",
      reportDate: "2026-08-12",
      status: "challenged",
      title: "공시 이벤트 판단",
      note: "실적 이벤트를 선반영하지 못했습니다.",
      evaluationSummary: "가격은 하락했습니다.",
    },
    {
      activityId: "a3",
      reportDate: "2026-08-14",
      status: "supported",
      title: "섹터 판단",
      note: "상대강도 확인",
    },
  ]);

  assert.equal(result.challengedCount, 2);
  assert.equal(result.status, "candidate_found");
  assert.equal(result.primaryCause.id, "event_interpretation");
  assert.equal(result.primaryCause.count, 2);
  assert.match(result.warning, /확정 원인은 아닙니다/);
});

test("failure cause classification stays inconclusive for thin or split evidence", () => {
  const thin = classifyMonthlyDecisionFailureCauses([
    {
      activityId: "a1",
      status: "challenged",
      title: "진입 시점이 늦음",
    },
  ]);
  assert.equal(thin.status, "insufficient_sample");
  assert.equal(thin.primaryCause, null);

  const split = classifyMonthlyDecisionFailureCauses([
    {
      activityId: "a1",
      status: "challenged",
      title: "진입 시점이 늦음",
    },
    {
      activityId: "a2",
      status: "challenged",
      title: "섹터 상대강도 판단 오류",
    },
  ]);
  assert.equal(split.status, "unclear");
  assert.equal(split.primaryCause, null);
});

test("repeated failure causes create approval-only response checklist suggestions", () => {
  const suggestions = buildMonthlyFailureChecklistSuggestions([{
    goalId: "portfolio-decision-goal:2026-07:reduce_review",
    action: "reduce_review",
    decisiveCount: 5,
    challengeRatePct: 60,
    evidenceCases: [{
      activityId: "a1",
      reportDate: "2026-08-10",
      title: "실적 판단",
      evaluationSummary: "가격은 반대로 움직였습니다.",
    }],
    failureCauseAnalysis: {
      status: "candidate_found",
      challengedCount: 3,
      primaryCause: {
        id: "event_interpretation",
        label: "이벤트 해석",
      },
      cases: [{
        activityId: "a1",
        reportDate: "2026-08-10",
        causeId: "event_interpretation",
      }],
    },
  }]);

  assert.equal(suggestions.length, 1);
  assert.equal(
    suggestions[0].suggestionId,
    "portfolio-response-rule:cause:reduce_review:event_interpretation",
  );
  assert.equal(suggestions[0].status, "pending_approval");
  assert.equal(suggestions[0].autoApply, false);
  assert.match(suggestions[0].proposal, /확인된 사실과 시장 해석/);
  assert.equal(suggestions[0].evidence.length, 1);
});
