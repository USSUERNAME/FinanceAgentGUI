import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { newsFeedSidebarHealthState } from "../src/news/newsFeedStatus.js";

test("shared memory controller loads the News Feed market summary before the page is opened", () => {
  const appSource = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
  const controllerSource = readFileSync(
    new URL("../src/memory/useSharedMemoryController.js", import.meta.url),
    "utf8",
  );
  const startupPollingEffect = controllerSource.match(
    /useEffect\(\(\) => \{\s*void loadSharedMemoryStatus\(\);[\s\S]*?MARKET_SUMMARY_POLL_INTERVAL_MS\);[\s\S]*?\}, \[loadSharedMemoryStatus\]\);/,
  );

  assert.match(appSource, /useSharedMemoryController\(\{ activeView \}\)/);
  assert.ok(startupPollingEffect, "shared memory market summary should be loaded by the controller at startup");
  assert.doesNotMatch(startupPollingEffect[0], /activeView/);
});

test("news feed sidebar dot follows market summary alert level", () => {
  const health = newsFeedSidebarHealthState(
    {
      collector: { healthy: true },
      feeds: [
        { id: "financialjuice", enabled: true, lastFetchStatus: "ok" },
        { id: "first-squawk", enabled: true, lastFetchStatus: "ok" },
      ],
    },
    {
      alertLevel: "critical",
      severityKo: "주요 시장 신호가 비상 확인 구간에 들어왔다.",
    },
  );

  assert.equal(health.sidebarLevel, "critical");
  assert.match(health.title, /비상 확인/);
  assert.match(health.title, /주요 시장 신호/);
});

test("news feed sidebar dot uses network-error when every enabled feed fails", () => {
  const health = newsFeedSidebarHealthState(
    {
      collector: { healthy: false, lastError: "financialjuice: fetch failed / first-squawk: fetch failed" },
      feeds: [
        { id: "financialjuice", enabled: true, lastFetchStatus: "error", lastError: "fetch failed" },
        { id: "first-squawk", enabled: true, lastFetchStatus: "error", lastError: "fetch failed" },
        { id: "disabled-feed", enabled: false, lastFetchStatus: "disabled" },
      ],
    },
    {
      alertLevel: "critical",
      severityKo: "이 값보다 네트워크 전체 장애가 우선한다.",
    },
  );

  assert.equal(health.sidebarLevel, "network-error");
  assert.match(health.title, /네트워크 오류/);
});

test("news feed sidebar dot keeps market summary when at least one feed connects", () => {
  const health = newsFeedSidebarHealthState(
    {
      collector: { healthy: false, lastError: "first-squawk: fetch failed" },
      feeds: [
        { id: "financialjuice", enabled: true, lastFetchStatus: "ok" },
        { id: "first-squawk", enabled: true, lastFetchStatus: "error", lastError: "fetch failed" },
      ],
    },
    {
      alertLevel: "urgent",
      severityKo: "위험회피가 빠르게 확산되고 있다.",
    },
  );

  assert.equal(health.sidebarLevel, "urgent");
  assert.match(health.title, /긴급 확인/);
});
