import assert from "node:assert/strict";
import test from "node:test";
import { postReportAction } from "../src/reports/reportsApi.js";

function response(payload = { ok: true }, { ok = true, status = 200 } = {}) {
  return { ok, status, async json() { return payload; } };
}

test("Reports API client preserves action payloads", async () => {
  const calls = [];
  const fetchImpl = async (path, options) => {
    calls.push({ path, options });
    return response({ ok: true, saved: true });
  };
  const payload = await postReportAction(
    { action: "classify_report_request", prompt: "market" },
    { fetchImpl }
  );
  assert.equal(calls[0].path, "/api/reports");
  assert.equal(calls[0].options.method, "POST");
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    action: "classify_report_request",
    prompt: "market",
  });
  assert.equal(payload.saved, true);
});

test("Reports API client surfaces structured failures", async () => {
  const fetchImpl = async () => response({ ok: false, error: "report failed" }, { ok: false, status: 500 });
  await assert.rejects(() => postReportAction({}, { fetchImpl }), /report failed/);
});
