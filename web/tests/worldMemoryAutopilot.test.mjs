import assert from "node:assert/strict";
import test from "node:test";
import {
  buildWorldMemoryAutopilotPrompt,
  normalizeWorldMemoryAutopilotDecision,
  worldMemoryAutopilotSuggestionItems,
} from "../server/worldMemoryApi.mjs";
import { normalizeWorldMemorySettings } from "../server/worldMemorySettings.mjs";

test("world memory autopilot defaults off and requires world memory enabled", () => {
  assert.equal(normalizeWorldMemorySettings({}).autopilotEnabled, false);
  assert.equal(normalizeWorldMemorySettings({ enabled: false, autopilotEnabled: true }).autopilotEnabled, false);
  assert.equal(normalizeWorldMemorySettings({ enabled: true, autopilotEnabled: true }).autopilotEnabled, true);
});

test("world memory autopilot accepts a validated mutation decision", () => {
  const decision = normalizeWorldMemoryAutopilotDecision({
    recommendation: "accept_modified",
    action: "stateAdd",
    label: "조정된 watch state 기록",
    reason: "원안의 방향은 맞지만 감시 수준으로 한정하는 편이 현재 근거에 맞다.",
    params: {
      title: "AI 전력 병목 감시",
      summary: "전력 접속 지연을 watch 상태로 추적한다.",
      stateStatus: "watch",
    },
  });

  assert.equal(decision.recommendation, "accept_modified");
  assert.equal(decision.action, "stateAdd");
  assert.equal(decision.params.stateStatus, "watch");
});

test("world memory autopilot keeps investigation read-only and rejects unsafe contracts", () => {
  const investigation = normalizeWorldMemoryAutopilotDecision({
    recommendation: "investigate",
    action: "semanticSearch",
    reason: "쓰기 전에 실제 event id와 기존 story를 확인한다.",
    params: { query: "AI 전력 병목 story" },
  });
  assert.equal(investigation.action, "semanticSearch");

  assert.throws(
    () => normalizeWorldMemoryAutopilotDecision({
      recommendation: "investigate",
      action: "stateAdd",
      reason: "읽기 단계에서 쓰기 액션을 선택했다.",
      params: { title: "잘못된 상태", summary: "잘못된 계약" },
    }),
    /mismatch/
  );
  assert.throws(
    () => normalizeWorldMemoryAutopilotDecision({
      recommendation: "accept_original",
      action: "feedScan",
      reason: "허용 범위 밖 액션",
      params: {},
    }),
    /not allowed/
  );
  assert.throws(
    () => normalizeWorldMemoryAutopilotDecision({
      recommendation: "accept_original",
      action: "briefStoryBackfill",
      reason: "event id가 없는 잘못된 쓰기",
      params: { story: "AI 인프라" },
    }),
    /requires eventIds/
  );
  assert.throws(
    () => normalizeWorldMemoryAutopilotDecision({
      recommendation: "accept_modified",
      action: "stateAdd",
      reason: "dry-run은 실제 수용이 아니다.",
      params: { title: "검증만", summary: "실제 반영 없음", dryRun: true },
    }),
    /cannot be dry-run/
  );
});

test("world memory autopilot selects only unresolved report suggestions", () => {
  const selected = worldMemoryAutopilotSuggestionItems({
    memoryChangeSuggestionItems: [
      { text: "새 제안", status: "open" },
      { text: "후속 조사", status: "watching", continuityId: "handled_watch" },
      { text: "이미 완료", status: "completed", continuityId: "handled_done" },
    ],
  });

  assert.deepEqual(selected.map((item) => item.text), ["새 제안", "후속 조사"]);
  assert.equal(selected[1].continuityId, "handled_watch");
});

test("world memory autopilot prompt carries the suggestion and bounded action contract", () => {
  const prompt = buildWorldMemoryAutopilotPrompt({
    suggestion: { text: "orphan brief를 정리한다", continuityId: "" },
    reportView: { title: "World Memory 시장 상황 인식" },
    evidence: { audit: { orphanBriefs: 12 } },
  });

  assert.match(prompt, /accept_original/);
  assert.match(prompt, /investigate/);
  assert.match(prompt, /orphan brief를 정리한다/);
  assert.match(prompt, /임의 shell 명령/);
});
