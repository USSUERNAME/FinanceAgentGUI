import assert from "node:assert/strict";
import test from "node:test";
import {
  applyWorldMemoryOfflineWaitState,
  completeWorldMemoryCollectionCollectorState,
  completeWorldMemoryReportRefreshCollectorState,
  filterWorldMemoryReportView,
  isConnectivityHttpStatus,
  normalizeWorldMemoryGeneratedSuggestionItems,
  normalizeWorldMemorySuggestionFingerprint,
  reconcileWorldMemoryChangeSuggestionLedger,
  recoverWorldMemoryCollectorStateFromArtifacts,
  shouldClearWorldMemoryConnectivityInFlight,
  validateWorldMemorySuggestionContinuityOutput,
  worldMemorySuggestionStatusForAction,
} from "../server/worldMemoryApi.mjs";
import { normalizeMemoryChangeSuggestionItem, worldMemorySuggestionCanAskAgent } from "../src/worldMemory/suggestionStatus.js";
import { buildWorldMemoryAskRequest } from "../src/worldMemory/askRequest.js";

const acceptedText =
  "AI 물리 인프라 비즈니스 안에서는 `AI 전력망 병목과 데이터센터 접속 지연`을 상위 watch state로 유지하고, `PJM 운영 비상·피크 전력가격 관찰축`은 하위 관찰축으로 연결한다. 기존 `PJM 전력 공급 비상과 AI 전력망 병목 검증`은 중복 가능성이 있어 이후 supersede 또는 storyLink 정리를 검토한다.";

function reportViewWithSuggestions(memoryChangeSuggestions) {
  return {
    title: "World Memory 시장 상황 인식",
    asOf: "2026-07-05 00:00 KST",
    stance: "mixed",
    summary: "요약",
    narrative: "본문",
    signalRadar: [],
    highlights: [],
    memoryChangeSuggestions,
    portfolioSuggestions: [],
    nextChecks: [],
  };
}

test("world memory report view marks exactly handled change suggestions", () => {
  const handledChangeSuggestions = [
    {
      text: acceptedText,
      fingerprint: normalizeWorldMemorySuggestionFingerprint(acceptedText),
      action: "stateAdd",
      target: {
        stateLabel: "PJM 운영 비상·피크 전력가격 관찰축",
        story: "AI 물리 인프라 비즈니스",
      },
    },
  ];
  const other = "`호르무즈 통항 규칙·보험료 검증 꼬리위험` state는 유지한다.";
  const filtered = filterWorldMemoryReportView(reportViewWithSuggestions([acceptedText, other]), {
    handledChangeSuggestions,
  });

  assert.deepEqual(filtered.memoryChangeSuggestions, [acceptedText, other]);
  assert.equal(filtered.memoryChangeSuggestionItems[0].handled, true);
  assert.equal(filtered.memoryChangeSuggestionItems[0].status, "completed");
  assert.equal(filtered.memoryChangeSuggestionItems[1].handled, false);
  assert.equal(filtered.memoryChangeSuggestionItems[1].status, "open");
});

test("world memory suggestion actions separate watching from completed", () => {
  assert.equal(worldMemorySuggestionStatusForAction("semanticSearch"), "watching");
  assert.equal(worldMemorySuggestionStatusForAction("storyFamilyReview"), "watching");
  assert.equal(worldMemorySuggestionStatusForAction("briefStoryBackfill"), "completed");
  assert.equal(worldMemorySuggestionStatusForAction("stateAdd"), "completed");
});

test("completed suggestions remove Codex follow-up while watching suggestions keep it", () => {
  assert.equal(normalizeMemoryChangeSuggestionItem({ text: "관찰", status: "watching" }).status, "watching");
  assert.equal(worldMemorySuggestionCanAskAgent({ text: "관찰", status: "watching" }), true);
  assert.equal(worldMemorySuggestionCanAskAgent({ text: "완료", status: "completed" }), false);
  assert.equal(worldMemorySuggestionCanAskAgent({ text: "과거 완료", status: "handled" }), false);
});

test("world memory follow-up request preserves suggestion continuity id", () => {
  const request = buildWorldMemoryAskRequest("memory-change", {
    text: "orphan brief 후속 검증",
    continuityId: "handled_orphan_brief_followup",
    status: "watching",
  });

  assert.equal(request.focusContext.item.continuityId, "handled_orphan_brief_followup");
});

test("world memory report view keeps read-only investigation suggestions watching", () => {
  const watchingChangeSuggestions = [
    {
      text: acceptedText,
      fingerprint: normalizeWorldMemorySuggestionFingerprint(acceptedText),
      status: "watching",
      action: "semanticSearch",
    },
  ];
  const filtered = filterWorldMemoryReportView(reportViewWithSuggestions([acceptedText]), {
    handledChangeSuggestions: watchingChangeSuggestions,
  });

  assert.equal(filtered.memoryChangeSuggestionItems[0].handled, false);
  assert.equal(filtered.memoryChangeSuggestionItems[0].watching, true);
  assert.equal(filtered.memoryChangeSuggestionItems[0].status, "watching");
});

test("world memory report view drops watching suggestions not reselected during regeneration", () => {
  const watchingChangeSuggestions = [
    {
      text: acceptedText,
      fingerprint: normalizeWorldMemorySuggestionFingerprint(acceptedText),
      status: "watching",
      action: "semanticSearch",
    },
  ];
  const other = "`호르무즈 통항 규칙·보험료 검증 꼬리위험` state는 유지한다.";
  const filtered = filterWorldMemoryReportView(reportViewWithSuggestions([other]), {
    handledChangeSuggestions: watchingChangeSuggestions,
    handledDisplayMode: "omit",
  });

  assert.deepEqual(filtered.memoryChangeSuggestions, [other]);
  assert.equal(filtered.memoryChangeSuggestionItems[0].status, "open");
});

test("world memory report refresh expires watching ledger rows omitted by the model", () => {
  const watchingId = "handled_expiring_watch";
  const completedId = "handled_completed_change";
  const state = {
    changeSuggestionLedger: {
      version: 1,
      handled: [
        { id: watchingId, continuityId: watchingId, text: acceptedText, status: "watching" },
        { id: completedId, continuityId: completedId, text: "완료된 제안", status: "completed" },
      ],
    },
  };
  const reportView = filterWorldMemoryReportView(reportViewWithSuggestions(["새로운 일반 제안"]), {
    handledChangeSuggestions: state.changeSuggestionLedger.handled,
    handledDisplayMode: "omit",
  });
  const reconciled = reconcileWorldMemoryChangeSuggestionLedger(state, reportView);

  assert.deepEqual(
    reconciled.changeSuggestionLedger.handled.map((item) => item.continuityId),
    [completedId]
  );
});

test("world memory report refresh keeps a watching ledger row reselected by the model", () => {
  const watchingId = "handled_reselected_watch";
  const state = {
    changeSuggestionLedger: {
      version: 1,
      handled: [
        { id: watchingId, continuityId: watchingId, text: acceptedText, status: "watching" },
      ],
    },
  };
  const reportView = filterWorldMemoryReportView(
    {
      ...reportViewWithSuggestions(["새 근거로 재선정된 관찰 제안"]),
      memoryChangeSuggestionItems: [
        { text: "새 근거로 재선정된 관찰 제안", continuityId: watchingId },
      ],
    },
    { handledChangeSuggestions: state.changeSuggestionLedger.handled }
  );
  const reconciled = reconcileWorldMemoryChangeSuggestionLedger(state, reportView);

  assert.equal(reportView.memoryChangeSuggestionItems[0].status, "watching");
  assert.deepEqual(
    reconciled.changeSuggestionLedger.handled.map((item) => item.continuityId),
    [watchingId]
  );
});

test("world memory suggestion continuity keeps only the latest LLM-classified follow-up", () => {
  const watchingId = "handled_orphan_brief_followup";
  const watchingText =
    "메타데이터가 있으나 story가 없는 brief가 112건으로 전체 brief의 25.57%에 달해 경고 기준을 소폭 초과했다.";
  const refreshedText =
    "계속 관찰 중인 orphan brief 정리를 유지한다. 최신 집계는 story가 없는 brief 126건, 전체 brief의 25.51%다.";
  const filtered = filterWorldMemoryReportView(
    {
      ...reportViewWithSuggestions([watchingText, refreshedText]),
      memoryChangeSuggestionItems: [
        { text: watchingText, continuityId: watchingId },
        { text: refreshedText, continuityId: watchingId },
      ],
    },
    {
      handledChangeSuggestions: [
        {
          id: watchingId,
          continuityId: watchingId,
          text: watchingText,
          status: "watching",
          action: "list",
        },
      ],
    }
  );

  assert.deepEqual(filtered.memoryChangeSuggestions, [refreshedText]);
  assert.equal(filtered.memoryChangeSuggestionItems[0].continuityId, watchingId);
  assert.equal(filtered.memoryChangeSuggestionItems[0].status, "watching");
});

test("world memory suggestion continuity harness rejects invented ids", () => {
  const allowedId = "handled_known";
  const normalized = normalizeWorldMemoryGeneratedSuggestionItems(
    [
      { text: "기존 관찰의 최신 문장", continuityId: allowedId },
      { text: "모델이 만든 잘못된 ID", continuityId: "handled_invented" },
    ],
    [allowedId]
  );

  assert.equal(normalized[0].continuityId, allowedId);
  assert.equal(normalized[1].continuityId, "");
});

test("world memory suggestion continuity harness requires an explicit LLM decision", () => {
  const watching = [{ id: "handled_known", text: "기존 관찰", status: "watching" }];
  const legacy = validateWorldMemorySuggestionContinuityOutput(["문자열 형식의 새 제안"], watching);
  const missing = validateWorldMemorySuggestionContinuityOutput([{ text: "판정을 생략한 제안" }], watching);
  const explicitNew = validateWorldMemorySuggestionContinuityOutput(
    [{ text: "별개 제안", continuityId: "" }],
    watching
  );

  assert.equal(legacy.ok, false);
  assert.equal(missing.ok, false);
  assert.equal(explicitNew.ok, true);
});

test("world memory report view marks close restatements for the same accepted target", () => {
  const handledChangeSuggestions = [
    {
      text: acceptedText,
      fingerprint: normalizeWorldMemorySuggestionFingerprint(acceptedText),
      action: "stateAdd",
      target: {
        stateLabel: "PJM 운영 비상·피크 전력가격 관찰축",
        story: "AI 물리 인프라 비즈니스",
      },
    },
  ];
  const restated =
    "AI 물리 인프라 비즈니스 안에서 `PJM 운영 비상·피크 전력가격 관찰축`은 하위 관찰축으로 두고, `AI 전력망 병목과 데이터센터 접속 지연` watch state를 상위 축으로 유지한다.";
  const filtered = filterWorldMemoryReportView(reportViewWithSuggestions([restated]), {
    handledChangeSuggestions,
  });

  assert.deepEqual(filtered.memoryChangeSuggestions, [restated]);
  assert.equal(filtered.memoryChangeSuggestionItems[0].handled, true);
});

test("world memory report view keeps unrelated suggestions that only mention the same state", () => {
  const handledChangeSuggestions = [
    {
      text: acceptedText,
      fingerprint: normalizeWorldMemorySuggestionFingerprint(acceptedText),
      action: "stateAdd",
      target: {
        stateLabel: "PJM 운영 비상·피크 전력가격 관찰축",
      },
    },
  ];
  const unrelated = "`PJM 운영 비상·피크 전력가격 관찰축`의 다음 확인 시각을 오후 피크 뒤로 조정한다.";
  const filtered = filterWorldMemoryReportView(reportViewWithSuggestions([unrelated]), {
    handledChangeSuggestions,
  });

  assert.deepEqual(filtered.memoryChangeSuggestions, [unrelated]);
  assert.equal(filtered.memoryChangeSuggestionItems[0].handled, false);
});

test("world memory report view drops handled ledger items when regenerated report omits them", () => {
  const handledChangeSuggestions = [
    {
      text: acceptedText,
      fingerprint: normalizeWorldMemorySuggestionFingerprint(acceptedText),
      action: "stateAdd",
      target: {
        stateLabel: "PJM 운영 비상·피크 전력가격 관찰축",
      },
    },
  ];
  const other = "`호르무즈 통항 규칙·보험료 검증 꼬리위험` state는 유지한다.";
  const filtered = filterWorldMemoryReportView(reportViewWithSuggestions([other]), {
    handledChangeSuggestions,
  });

  assert.deepEqual(filtered.memoryChangeSuggestions, [other]);
  assert.equal(filtered.memoryChangeSuggestionItems[0].handled, false);
});

test("world memory report view can show the just accepted suggestion as handled feedback", () => {
  const handledChangeSuggestions = [
    {
      text: acceptedText,
      fingerprint: normalizeWorldMemorySuggestionFingerprint(acceptedText),
      action: "stateAdd",
      target: {
        stateLabel: "PJM 운영 비상·피크 전력가격 관찰축",
      },
    },
  ];
  const other = "`호르무즈 통항 규칙·보험료 검증 꼬리위험` state는 유지한다.";
  const filtered = filterWorldMemoryReportView(reportViewWithSuggestions([other]), {
    handledChangeSuggestions,
    handledDisplayMode: "omit",
    appendHandledChangeSuggestions: [handledChangeSuggestions[0]],
  });

  assert.deepEqual(filtered.memoryChangeSuggestions, [acceptedText, other]);
  assert.equal(filtered.memoryChangeSuggestionItems[0].handled, true);
  assert.equal(filtered.memoryChangeSuggestionItems[1].handled, false);
});

test("world memory report refresh does not advance the collection cutoff", () => {
  const collector = completeWorldMemoryReportRefreshCollectorState(
    {
      running: true,
      status: "writing_report",
      lastSuccessfulAt: "2026-07-05T12:00:00.000Z",
    },
    "2026-07-05T12:45:00.000Z",
  );

  assert.equal(collector.status, "ok");
  assert.equal(collector.lastFinishedAt, "2026-07-05T12:45:00.000Z");
  assert.equal(collector.lastReportSuccessfulAt, "2026-07-05T12:45:00.000Z");
  assert.equal(collector.lastSuccessfulAt, "2026-07-05T12:00:00.000Z");
});

test("world memory collection cutoff is captured before report completion", () => {
  const collector = completeWorldMemoryCollectionCollectorState(
    {
      running: true,
      status: "writing_report",
      lastSuccessfulAt: "2026-07-05T06:00:00.000Z",
    },
    {
      collectionSuccessfulAt: "2026-07-05T12:20:00.000Z",
      reportFinishedAt: "2026-07-05T12:45:00.000Z",
      importedCandidates: 6,
      attempt: 2,
    },
  );

  assert.equal(collector.status, "ok");
  assert.equal(collector.lastSuccessfulAt, "2026-07-05T12:20:00.000Z");
  assert.equal(collector.lastFinishedAt, "2026-07-05T12:45:00.000Z");
  assert.equal(collector.lastReportSuccessfulAt, "2026-07-05T12:45:00.000Z");
  assert.match(collector.lastAction, /신규 후보 6건/);
  assert.equal(collector.attempt, 2);
});

test("world memory state recovers empty collector metadata from DB and report artifacts", () => {
  const recovery = recoverWorldMemoryCollectorStateFromArtifacts(
    {
      version: 1,
      collector: {
        running: false,
        status: "idle",
        lastAction: "대기 중",
        lastSuccessfulAt: "",
        lastReportSuccessfulAt: "",
        lastFinishedAt: "",
      },
      schedule: {
        intervalMs: 21600000,
        retryIntervalMs: 1800000,
        retryWindowMs: 21600000,
        nextRunAt: "2026-07-09T02:52:07.641Z",
        nextRetryAt: "",
        pausedUntil: "",
        activeCycle: null,
      },
      report: {
        status: "empty",
        generatedAt: "",
        view: null,
      },
      changeSuggestionLedger: {
        version: 1,
        handled: [],
      },
      history: [],
    },
    {
      dbSnapshot: {
        entryCount: 376,
        maxAsOf: "2026-07-08T23:49:30.195569+09:00",
        maxLoggedAt: "2026-07-08T23:49:30.195570+09:00",
      },
      reportArtifact: {
        generatedAt: "2026-07-08T14:50:43.000Z",
        htmlPath: "logs/world-memory/world_memory_market_situation_20260708_145043.html",
        jsonPath: "logs/world-memory/world_memory_market_situation_20260708_145043.json",
        textPath: "logs/world-memory/world_memory_market_situation_20260708_145043.txt",
        view: reportViewWithSuggestions(["새 watch state 후보"]),
      },
    },
  );

  assert.equal(recovery.recovered, true);
  assert.equal(recovery.state.collector.status, "ok");
  assert.equal(recovery.state.collector.lastSuccessfulAt, "2026-07-08T23:49:30.195570+09:00");
  assert.equal(recovery.state.collector.lastReportSuccessfulAt, "2026-07-08T14:50:43.000Z");
  assert.equal(recovery.state.report.status, "ready");
  assert.equal(recovery.state.report.jsonPath, "logs/world-memory/world_memory_market_situation_20260708_145043.json");
  assert.equal(recovery.state.schedule.nextRunAt, "2026-07-08T20:49:30.195Z");
  assert.equal(recovery.state.history[0].type, "state_recovery");
  assert.equal(recovery.state.history[0].dbEntryCount, 376);
});

test("world memory offline preflight waits for connectivity without advancing attempts", () => {
  const state = applyWorldMemoryOfflineWaitState(
    {
      collector: {
        running: false,
        status: "idle",
        attempt: 1,
      },
      schedule: {
        nextRunAt: "2026-07-09T00:00:00.000Z",
        nextRetryAt: "",
        pausedUntil: "",
        activeCycle: null,
      },
      history: [],
    },
    {
      cycleId: "wm_test",
      trigger: "scheduled",
      scheduledAt: "2026-07-09T00:00:00.000Z",
      deadlineAt: "2026-07-09T06:00:00.000Z",
      attempt: 1,
      checkedAt: "2026-07-09T00:01:00.000Z",
      connectivity: { error: "offline" },
    },
  );

  assert.equal(state.collector.status, "offline_wait");
  assert.equal(state.collector.running, false);
  assert.equal(state.collector.attempt, 1);
  assert.equal(state.collector.lastError, "offline");
  assert.equal(state.schedule.nextRetryAt, "2026-07-09T00:11:00.000Z");
  assert.equal(state.schedule.activeCycle.awaitingConnectivity, true);
  assert.equal(state.schedule.activeCycle.attempt, 1);
  assert.equal(state.history[0].status, "offline_wait");
});

test("world memory connectivity probe treats reachable 4xx as online", () => {
  assert.equal(isConnectivityHttpStatus(204), true);
  assert.equal(isConnectivityHttpStatus(302), true);
  assert.equal(isConnectivityHttpStatus(404), true);
  assert.equal(isConnectivityHttpStatus(500), false);
  assert.equal(isConnectivityHttpStatus(0), false);
});

test("world memory clears stale connectivity in-flight state after retry time passes", () => {
  const state = {
    collector: {
      running: false,
      status: "offline_wait",
    },
    schedule: {
      nextRetryAt: "2026-07-09T00:11:00.000Z",
      activeCycle: {
        awaitingConnectivity: true,
        nextRetryAt: "2026-07-09T00:11:00.000Z",
      },
    },
  };

  assert.equal(
    shouldClearWorldMemoryConnectivityInFlight(
      state,
      { inFlight: true, inFlightStartedAt: "2026-07-09T00:00:00.000Z" },
      new Date("2026-07-09T00:11:01.000Z").getTime(),
    ),
    true,
  );
  assert.equal(
    shouldClearWorldMemoryConnectivityInFlight(
      state,
      { inFlight: true, inFlightStartedAt: "2026-07-09T00:10:58.000Z" },
      new Date("2026-07-09T00:11:01.000Z").getTime(),
    ),
    false,
  );
});

test("world memory report view omits handled suggestions during collection-cycle output", () => {
  const handledChangeSuggestions = [
    {
      text: acceptedText,
      fingerprint: normalizeWorldMemorySuggestionFingerprint(acceptedText),
      action: "stateAdd",
      target: {
        stateLabel: "PJM 운영 비상·피크 전력가격 관찰축",
        story: "AI 물리 인프라 비즈니스",
      },
    },
  ];
  const restated =
    "AI 물리 인프라 비즈니스 안에서 `PJM 운영 비상·피크 전력가격 관찰축`은 하위 관찰축으로 두고, `AI 전력망 병목과 데이터센터 접속 지연` watch state를 상위 축으로 유지한다.";
  const other = "`호르무즈 통항 규칙·보험료 검증 꼬리위험` state는 유지한다.";
  const filtered = filterWorldMemoryReportView(reportViewWithSuggestions([restated, other]), {
    handledChangeSuggestions,
    handledDisplayMode: "omit",
  });

  assert.deepEqual(filtered.memoryChangeSuggestions, [other]);
  assert.equal(filtered.memoryChangeSuggestionItems[0].handled, false);
});
