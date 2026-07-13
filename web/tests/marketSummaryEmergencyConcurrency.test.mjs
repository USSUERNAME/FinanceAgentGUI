import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("market summary emergency procedure generates once across reloaded worker modules", async () => {
  const notificationDir = mkdtempSync(join(tmpdir(), "finance-agent-emergency-"));
  const previousDir = process.env.FINANCE_AGENT_GUI_NOTIFICATION_DIR;
  process.env.FINANCE_AGENT_GUI_NOTIFICATION_DIR = notificationDir;
  try {
    const modules = await Promise.all(
      Array.from({ length: 12 }, (_value, index) =>
        import(`../server/notificationsApi.mjs?emergency-worker-${Date.now()}-${index}`),
      ),
    );
    let buildCount = 0;
    const buildReport = async ({ level }) => {
      buildCount += 1;
      await new Promise((resolve) => setTimeout(resolve, 40));
      return {
        generatedAt: new Date().toISOString(),
        saved: { report: { id: `report-${buildCount}` } },
        notification: { id: `notification-${buildCount}`, level },
      };
    };
    const urgentSummary = {
      alertLevel: "urgent",
      shouldCreateReport: true,
      basedOnWorldMemoryCollectionAt: "2026-07-13T00:00:00.000Z",
      newsItemsSummarized: 50,
      text: "동일한 빨강 시장 요약",
    };

    const results = await Promise.all(
      modules.map((module) =>
        module.runEmergencyProcedureForMarketSummary(urgentSummary, { buildReport }),
      ),
    );
    assert.equal(buildCount, 1);
    assert.equal(results.filter((result) => result.skipped === false).length, 1);

    const covered = await modules[0].runEmergencyProcedureForMarketSummary(
      { ...urgentSummary, text: "새로운 문구지만 같은 빨강 에피소드" },
      { buildReport },
    );
    assert.equal(covered.reason, "severity-already-covered");
    assert.equal(buildCount, 1);

    const escalated = await modules[1].runEmergencyProcedureForMarketSummary(
      { ...urgentSummary, alertLevel: "critical", text: "보라로 격상된 시장 요약" },
      { buildReport },
    );
    assert.equal(escalated.skipped, false);
    assert.equal(buildCount, 2);

    const store = JSON.parse(readFileSync(join(notificationDir, "stock-channel-notifications.json"), "utf8"));
    assert.equal(store.emergencyProcedures.marketSummary.activeAlertLevel, "critical");
  } finally {
    if (previousDir === undefined) delete process.env.FINANCE_AGENT_GUI_NOTIFICATION_DIR;
    else process.env.FINANCE_AGENT_GUI_NOTIFICATION_DIR = previousDir;
    rmSync(notificationDir, { recursive: true, force: true });
  }
});
