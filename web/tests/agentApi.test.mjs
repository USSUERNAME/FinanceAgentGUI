import assert from "node:assert/strict";
import test from "node:test";
import { fetchAgentOptions, patchAgentSettings, requestAgentChatStream } from "../src/agent/agentApi.js";

function response(payload = { ok: true }, { ok = true, status = 200 } = {}) {
  return { ok, status, body: {}, async json() { return payload; } };
}

test("Agent API client preserves settings, options, and stream contracts", async () => {
  const calls = [];
  const fetchImpl = async (path, options) => {
    calls.push({ path, options });
    return response({ ok: true });
  };
  await patchAgentSettings({ personaMode: "calm" }, fetchImpl);
  await fetchAgentOptions({}, fetchImpl);
  await fetchAgentOptions({ force: true }, fetchImpl);
  await requestAgentChatStream({ prompt: "hello" }, { fetchImpl });
  assert.deepEqual(calls.map((item) => item.path), [
    "/api/codex/settings",
    "/api/codex/options",
    "/api/codex/options?refresh=1",
    "/api/codex/chat/stream",
  ]);
  assert.equal(calls[0].options.method, "PATCH");
  assert.deepEqual(JSON.parse(calls[0].options.body), { personaMode: "calm" });
  assert.equal(calls[3].options.method, "POST");
  assert.deepEqual(JSON.parse(calls[3].options.body), { prompt: "hello" });
});

test("Agent settings client surfaces structured failures", async () => {
  const fetchImpl = async () => response({ ok: false, error: "invalid model" }, { ok: false, status: 400 });
  await assert.rejects(() => patchAgentSettings({}, fetchImpl), /invalid model/);
});
