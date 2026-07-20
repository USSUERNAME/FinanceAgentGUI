import test from "node:test";
import assert from "node:assert/strict";

import { createAgentMessageStreamState } from "../server/agentMessageStream.mjs";

test("app-server stream excludes commentary and keeps only the final answer", () => {
  const state = createAgentMessageStreamState();
  state.start({ id: "commentary-1", type: "agentMessage", phase: "commentary" });
  assert.equal(
    state.delta({ itemId: "commentary-1", delta: "공식 자료를 확인하겠습니다." }).kind,
    "commentary",
  );
  state.complete({
    id: "commentary-1",
    type: "agentMessage",
    phase: "commentary",
    text: "공식 자료를 확인하겠습니다.",
  });

  state.start({ id: "final-1", type: "agentMessage", phase: "final_answer" });
  assert.equal(state.delta({ itemId: "final-1", delta: "# 이란 " }).kind, "delta");
  assert.equal(state.delta({ itemId: "final-1", delta: "거시경제 분석" }).answer, "# 이란 거시경제 분석");
  state.complete({
    id: "final-1",
    type: "agentMessage",
    phase: "final_answer",
    text: "# 이란 거시경제 분석",
  });

  assert.equal(state.answer(), "# 이란 거시경제 분석");
  assert.doesNotMatch(state.answer(), /공식 자료/);
});

test("phase-less legacy messages remain buffered and use the last completed item", () => {
  const state = createAgentMessageStreamState();
  assert.equal(state.delta({ itemId: "legacy-1", delta: "첫번째" }).kind, "buffer");
  state.complete({ id: "legacy-1", type: "agentMessage", text: "첫번째" });
  state.complete({ id: "legacy-2", type: "agentMessage", text: "마지막 답변" });
  assert.equal(state.answer(), "마지막 답변");
});
