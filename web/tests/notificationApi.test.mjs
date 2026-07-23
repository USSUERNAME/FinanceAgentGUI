import assert from "node:assert/strict";
import test from "node:test";
import { fetchNotificationStatus, markReportsNotificationsOpened } from "../src/reports/notificationApi.js";

function response(payload = { ok: true }, { ok = true, status = 200 } = {}) {
  return { ok, status, async json() { return payload; } };
}

test("Notification API client preserves status and read-state contracts", async () => {
  const calls = [];
  const fetchImpl = async (path, options) => {
    calls.push({ path, options });
    return response({ ok: true });
  };
  await fetchNotificationStatus(fetchImpl);
  await markReportsNotificationsOpened(fetchImpl);
  assert.deepEqual(calls.map((item) => item.path), [
    "/api/notifications/status",
    "/api/notifications/read-state",
  ]);
  assert.equal(calls[1].options.method, "POST");
  assert.deepEqual(JSON.parse(calls[1].options.body), { action: "mark-reports-opened" });
});
