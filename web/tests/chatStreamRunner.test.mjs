import assert from "node:assert/strict";
import test from "node:test";

import { consumeAgentChatStream } from "../src/agent/chatStreamRunner.js";

const runtime = {
  provider: "codex-cli",
  providerLabel: "Codex CLI",
  modelSummaryLabel: "5.6-Sol 보통",
  selectedModelGroup: { slug: "gpt-5.6-sol", label: "5.6-Sol" },
  selectedReasoning: { id: "medium", label: "보통" },
  selectedApproval: { id: "on-request", label: "요청시 승인" },
};

function sseResponse(events, init = {}) {
  return new Response(events.join("\n\n"), {
    status: init.status || 200,
    headers: { "content-type": "text/event-stream" },
  });
}

test("agent chat stream runner consumes SSE, throttles renders, and reports one first delta", async () => {
  const renders = [];
  let firstDeltaCount = 0;
  const result = await consumeAgentChatStream(
    sseResponse([
      'event: started\ndata: {"providerLabel":"Codex CLI","model":"gpt-5.6-sol","reasoning":"medium"}',
      'event: delta\ndata: {"text":"안녕"}',
      'event: delta\ndata: {"text":" 세계"}',
      'event: done\ndata: {"answer":"안녕 세계","elapsedMs":1500}',
    ]),
    {
      runtime,
      transformText: (text) => text.toUpperCase(),
      onFirstDelta: () => {
        firstDeltaCount += 1;
      },
      onRender: (snapshot) => renders.push(snapshot),
    },
  );

  assert.equal(result.answer, "안녕 세계");
  assert.equal(result.latestStatus.tone, "done");
  assert.equal(result.latestStatus.title, "Codex CLI 응답");
  assert.equal(firstDeltaCount, 1);
  assert.equal(renders.at(-1).text, "안녕 세계".toUpperCase());
});

test("earning stream mode preserves earning-specific status copy", async () => {
  const renders = [];
  const result = await consumeAgentChatStream(
    sseResponse([
      'event: started\ndata: {"providerLabel":"Codex CLI"}',
      'event: done\ndata: {"answer":"분석 완료","elapsedMs":2100}',
    ]),
    {
      runtime,
      mode: "earning",
      onRender: (snapshot) => renders.push(snapshot),
    },
  );

  assert.equal(result.answer, "분석 완료");
  assert.equal(result.latestStatus.title, "Codex CLI 어닝 분석");
  assert.ok(renders.some((snapshot) => snapshot.status.title === "Codex CLI 어닝 분석 시작"));
});

test("stream errors retain partial text for cancellation and failure recovery", async () => {
  await assert.rejects(
    consumeAgentChatStream(
      sseResponse([
        'event: delta\ndata: {"text":"부분 응답"}',
        'event: error\ndata: {"error":"provider failed"}',
      ]),
      { runtime },
    ),
    (error) => {
      assert.equal(error.message, "provider failed");
      assert.equal(error.partialText, "부분 응답");
      return true;
    },
  );
});

test("HTTP stream failures surface the structured server error", async () => {
  const response = new Response(JSON.stringify({ error: "stream unavailable" }), {
    status: 503,
    headers: { "content-type": "application/json" },
  });
  await assert.rejects(
    consumeAgentChatStream(response, { runtime }),
    /stream unavailable/,
  );
});
