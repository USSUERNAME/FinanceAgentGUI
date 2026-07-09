import test from "node:test";
import assert from "node:assert/strict";

import { buildPortfolioAgentCreatedWidgetState } from "../src/portfolio/widgetAgentCreate.js";
import { normalizePortfolioWidgetOutputRole } from "../src/portfolio/scenarioContract.js";
import { normalizePortfolioWidgetVisualType } from "../src/portfolio/widgetTypes.js";

test("seasonal comparison is a canonical asset-management visual type", () => {
  assert.equal(normalizePortfolioWidgetVisualType("seasonal_return_chart"), "seasonal-comparison");
  assert.equal(
    normalizePortfolioWidgetOutputRole({ visualType: "seasonal-comparison" }),
    "seasonal_comparison"
  );
});

test("agent-created seasonal comparison widgets use Lightweight Charts and latest query", () => {
  const state = buildPortfolioAgentCreatedWidgetState({
    currentWidgets: [],
    patch: {
      visualType: "seasonal-comparison",
    },
    request: {
      prompt: "시즌별 비교 위젯을 만들어줘",
    },
    createdDisplayId: "W-001",
    now: "2026-07-08T00:00:00.000Z",
    nowMs: 1234,
  });

  const widget = state.candidate;
  assert.equal(widget.title, "시즌별 비교");
  assert.equal(widget.kind, "시즌별 비교");
  assert.equal(widget.visualType, "seasonal-comparison");
  assert.equal(widget.outputRole, "seasonal_comparison");
  assert.equal(widget.chartSpec.engine, "lightweight-charts");
  assert.equal(widget.chartSpec.chartType, "line");
  assert.equal(widget.chartSpec.query.startMode, "first_trade");
  assert.equal(widget.chartSpec.query.endMode, "latest");
  assert.equal(widget.chartSpec.query.timeframe, "1d");
  assert.deepEqual(widget.badges, ["Lightweight Charts"]);
  assert.equal(widget.w, 3);
  assert.equal(widget.h, 3);
});
