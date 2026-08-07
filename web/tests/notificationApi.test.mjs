import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  fetchNotificationStatus,
  markDailyIntelligenceNotificationsOpened,
  markReportsNotificationsOpened,
} from "../src/reports/notificationApi.js";

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
  await markDailyIntelligenceNotificationsOpened(fetchImpl);
  assert.deepEqual(calls.map((item) => item.path), [
    "/api/notifications/status",
    "/api/notifications/read-state",
    "/api/notifications/read-state",
  ]);
  assert.equal(calls[1].options.method, "POST");
  assert.deepEqual(JSON.parse(calls[1].options.body), { action: "mark-reports-opened" });
  assert.deepEqual(
    JSON.parse(calls[2].options.body),
    { action: "mark-daily-intelligence-opened" },
  );
});

test("critical thesis notifications keep a stable id and Daily Intelligence target", async () => {
  const notificationDir = mkdtempSync(join(tmpdir(), "finance-agent-thesis-alert-"));
  process.env.FINANCE_AGENT_GUI_NOTIFICATION_DIR = notificationDir;
  try {
    const { pushSystemNotification } = await import(
      `../server/notificationsApi.mjs?thesis-alert-${Date.now()}`
    );
    const payload = {
      level: "critical",
      source: "pb-investment-thesis",
      clickTarget: "daily-intelligence",
      dedupeKey: "pb-stock-nvda-2026-07-29-miss",
      summary: "NVDA 보유종목 가설 반증",
    };
    const first = await pushSystemNotification(payload);
    const repeated = await pushSystemNotification(payload);
    assert.equal(first.record.delivery.clickTarget, "daily-intelligence");
    assert.equal(repeated.skipped, true);
    assert.equal(repeated.reason, "duplicate-notification");
    assert.equal(repeated.record.id, first.record.id);

    const stored = JSON.parse(
      readFileSync(join(notificationDir, "stock-channel-notifications.json"), "utf8"),
    );
    assert.equal(stored.records.length, 1);
    assert.equal(stored.records[0].delivery.clickTarget, "daily-intelligence");
  } finally {
    delete process.env.FINANCE_AGENT_GUI_NOTIFICATION_DIR;
    rmSync(notificationDir, { recursive: true, force: true });
  }
});
