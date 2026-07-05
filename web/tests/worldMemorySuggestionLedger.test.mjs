import assert from "node:assert/strict";
import test from "node:test";
import {
  completeWorldMemoryCollectionCollectorState,
  completeWorldMemoryReportRefreshCollectorState,
  filterWorldMemoryReportView,
  normalizeWorldMemorySuggestionFingerprint,
} from "../server/worldMemoryApi.mjs";

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
  assert.equal(filtered.memoryChangeSuggestionItems[1].handled, false);
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
