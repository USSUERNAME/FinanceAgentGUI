# Portfolio Widget Contract

This document is the runtime contract for Portfolio canvas agents. Treat it like a developer reference page for creating, updating, and connecting widgets.

The Portfolio page is a procedural workspace. Do not collapse a multi-step investment workflow into one big chart or one long prose widget. Model the workflow as a small graph of typed widgets.

## Canvas Modes

Portfolio has two product modes. Strategy research is the executable backtest graph; asset management is a broker-sync snapshot canvas.

- `strategy-research`: active calculation canvas. It has exactly one pinned scenario root, displayed as the non-draggable `기간 및 타임프레임` bar below the flow map. User-created process widgets must keep `scenarioId:"portfolio_scenario_root"` and flow one way from scenario to result.
- `asset-management`: visible only when the Toss Securities connection and position snapshot generation are ready. Empty-cell creation uses local snapshot-backed widgets instead of manual ledger prompts.

The empty grid-cell control is not a direct widget creator. It opens a prompt modal and sends that prompt to the sidebar agent. The user may move and resize existing widgets directly on the grid; direct create/delete/edit content changes should still route through the sidebar agent.

## Canvas Persistence

Portfolio canvases are file-backed local state. The primary store is `data/portfolio/portfolio-canvases.json`, with `data/portfolio/portfolio-canvases.backup.json` as the last non-empty backup. Browser `localStorage` remains only as a migration and emergency backup layer for older sessions.

On startup, the app loads the file store first. If the file store is empty but a browser backup or legacy single-workspace state still has a meaningful canvas, the app promotes that browser state into the file store. This prevents an empty browser store from hiding an existing canvas after browser restarts or refactors.

## Strategy Scenario Root

The strategy canvas starts from a single scenario contract rather than a movable numbered widget.

- Scenario root id: `portfolio_scenario_root`.
- Default run: `period:"1y"`, `timeframe:"1d"`.
- User-facing title: `기간 및 타임프레임`.
- The scenario panel can accept a prompt for changing timeframe, period, or multiple comparison periods, but the prompt is still routed through the sidebar agent.
- Sidebar prompts may still create the full scenario-to-results shape in one turn.
- A scenario may contain multiple `runs`. Backtest preparation expands those runs into separate execution requests, so comparisons such as `2020년` vs `2021년` stay inside one scenario graph instead of requiring sibling graphs to merge later.
- Each `/api/portfolio/backtest` payload carries `scenarioMatrix`, `inputMatrixRoles`, `sourceMatrix`, and optional `signalMatrix`. The Python yfinance runner accepts `startDate`, `endDate`, and `timeframe` from the scenario run; date-ranged runs should prefer explicit `startDate`/`endDate` over a free-form yfinance `period` string.

Strategy-research widgets should declare one output role:

| Role | Typical widget |
| --- | --- |
| `source_matrix` | portfolio/price/holdings table under the scenario |
| `signal_matrix` | function widget that emits `signalMatrix` rows for signals or target weights |
| `backtest_result` | line/result chart generated from matrices |
| `metrics` | metrics table derived from a backtest result |

Metrics widgets are derived views, not calculation widgets. A `metrics-table` should normally depend on a `backtest_result` line widget and render that widget's `chartSpec.metrics` / `chartSpec.standardMetrics`. Repairing or refreshing a metrics table should preserve `visualType:"metrics-table"` and should not create a markdown/report widget unless the user explicitly asks for a separate explanatory note.

Do not turn a `backtest_result` widget into a metrics widget just because it contains metric rows or currently renders like a table. If a stored widget has `outputRole:"backtest_result"` or `nextActions:["run_backtest_chart_widget"]`, agents and repair code must treat it as an executable backtest result first. Refreshing it must rerun the backtest path, not perform `metrics-table` synchronization. A true metrics table should use `outputRole:"metrics"` and depend on the backtest result widget.

DCA / contribution-based backtests should still use the same `metrics-table` visual type. Set `chartSpec.metricProfile:"dca"` when the table should show contribution-aware columns. The backtest metric rows may include `totalContribution`, `netProfit`, `contributionReturn`, `irr`, `twr`, `contributionCount`, and `averageContribution`; the renderer switches from the standard metrics columns to the DCA cashflow columns when this profile or those fields are present.

Backtest follow-up analysis has a narrow table rule:

- Use `metrics-table` only for the canonical backtest evaluation table: CAGR, MDD, Sharpe, Sortino, Calmar, Ulcer, UPI, BETA, contribution-aware DCA metrics, and adjacent standard performance columns.
- For any other calculation or interpretation after a `backtest_result` exists, create a `markdown` widget. Put compact numeric comparisons in markdown tables, and use `widget.echarts` or fenced `echarts` / `chart` JSON blocks for ECharts visuals such as efficient frontiers, risk-return scatter plots, rolling-correlation lines, drawdown distributions, sensitivity bars, or scenario comparison charts.
- ECharts option blocks must be plain JSON. For array-valued scatter data in tooltip templates, use indexed value placeholders such as `{value[0]}`, `{value[1]}`, and `{value[2]}`; the GUI renderer converts them to runtime tooltip functions before passing options to ECharts.
- These markdown follow-ups may be context-derived rather than graph-derived. When the LLM already sees the backtest widget in the Context Packet, keep `dependsOn`, `derivedFrom`, and `nextActions` empty unless the user explicitly asks for refreshable dependency behavior.
- The Context Packet may include only edge samples for `chartSpec.xLabels` and `chartSpec.series`. If a follow-up needs more sequence data, the agent must request exact backtest matrix context first with `actionId:"request_backtest_matrix_context"` rather than guessing from samples.
- Do not invent uncomputed values. If the required backtest series, returns, covariance, or scenario data is absent from context, make the markdown widget state the missing input or create a checklist instead of fabricating a chart.

Backtest matrix retrieval is not vector search. It is deterministic series retrieval by widget and axes:

```json
{
  "actionId": "request_backtest_matrix_context",
  "widgetDisplayId": "W-005",
  "matrixRequest": {
    "transform": "yearly_returns",
    "frequency": "yearly",
    "seriesNames": ["Buy & Hold", "전략"],
    "assets": ["QQQ"],
    "startDate": "2020-01-01",
    "endDate": "2026-12-31",
    "maxPoints": 1200,
    "nextPrompt": "이 연도별 수익률로 markdown 위젯과 ECharts 막대 차트를 만들어 주세요."
  }
}
```

Supported filters are `widgetId` / `widgetDisplayId`, date range, `seriesNames`, and `assets` / `tickers`. Supported transforms are `raw`, `returns`, `drawdown`, `monthly_returns`, and `yearly_returns`. The GUI returns a compact matrix with `date`, `seriesName`, `asset`, `field`, and `value`; the agent then uses that returned matrix to build the requested markdown table and ECharts block.

## Multiple Asset Comparison Contract

When the agent classifies a request as an independent comparison of multiple assets, ETFs, or strategy portfolio candidates, it must set `classification.isMultipleAssetComparison=true`.

This is an LLM classification flag, not a local text-matching parser. The GUI validates the structured action after generation.

For executable backtests with `classification.isMultipleAssetComparison=true`:

- Create one `source_matrix` table widget per independent candidate, such as `SOXX 100%` and `DRAM 100%`.
- Create one `backtest_result` line widget that depends on all candidate source widgets.
- Do not represent independent candidates as one source table with multiple rows such as `SOXX 50%` and `DRAM 50%`. That shape is a blended portfolio and will be rejected by the action contract harness.
- If the user also wants a blended 50/50 portfolio, add it as a separate candidate source widget in addition to the independent candidates.
- A downstream `metrics` widget should depend on the `backtest_result` line widget so it receives one metric row per actual backtest variant.

Do not make dependencies flow backward. A signal widget should not depend on a backtest result, and a source matrix should not depend on metrics. Raw CSV files are provenance/data-source inputs for a function widget; the backtest should consume the completed `source_matrix` and `signal_matrix` contracts rather than asking a downstream result widget to repair missing raw files.

Because direct widget action buttons are hidden from the canvas surface, stale `backtest_result` widgets with `run_backtest_chart_widget` are auto-run candidates once their source and signal dependencies are ready. Legacy stored widgets with `updatePolicy:"manual"` are promoted to `auto` during workspace normalization for this executable backtest path.

Function widgets must now materialize a `signalMatrix` object in addition to `functionSpec`:

```json
{
  "role": "signal_matrix",
  "status": "pending-source",
  "dimensions": ["runId", "date", "asset", "field"],
  "schema": ["runId", "date", "asset", "field", "value", "ruleId", "source"],
  "language": "portfolio-matrix-dsl",
  "executionMode": "matrix-dsl",
  "outputs": ["signal_matrix"],
  "program": [
    {"op":"indicator","name":"macd","field":"close","fastPeriod":12,"slowPeriod":26,"signalPeriod":9,"outputField":"macd"},
    {"op":"rule","when":"macd > 0","emit":{"field":"target_weight","value":1}},
    {"op":"rule","when":"macd < 0","emit":{"field":"target_weight","value":0}}
  ],
  "rowCount": 0,
  "rows": []
}
```

`functionSpec` is the source contract. `signalMatrix` is the produced contract. Downstream widgets must treat `signalMatrix` as the handoff surface: inspect `signalMatrix.status`, `rows`, `strategyType`, `executionMode`, and `compiler.issues` first, and do not re-infer executability directly from the original `functionSpec`.

The frontend compiler materializes rows when source rows are already available. If the function widget is valid but has no local source rows yet, it should return `status:"pending-source"` with the normalized `program`. The backtest runner then synthesizes a runtime `source_matrix` from yfinance price/NAV rows and executes the same DSL program there. In other words, `pending-source` is executable when the DSL program is valid; it is not a request to fall back to legacy strategy parsing.

If an agent supplies explicit `signalMatrix.rows`, those rows are preserved and normalized, but downstream widgets still read `signalMatrix` first. Legacy `functionSpec.rules`, `signal-rules`, and `external-signal` rows are not restored as executable strategy paths.

Buy & Hold is not a function widget. A connected `source_matrix` table automatically produces the Buy & Hold baseline in `run_backtest_chart_widget`. If an agent emits an unconditional full-exposure function such as `when:"true" -> target_weight:1`, the backtest preparation treats it as redundant baseline metadata and does not execute it as a separate strategy.

## Function Widget v2: Portfolio Matrix DSL

The long-term function widget contract is not "one strategy type per feature." It is a safe matrix transformer:

```text
source_matrix
  runId / date / asset / field / value

function widget
  source_matrix -> signal_matrix

signal_matrix
  runId / date / asset / field / value / ruleId / source
```

Use `functionSpec.language:"portfolio-matrix-dsl"` for new general function widgets. The DSL is a declarative program, not arbitrary JavaScript or Python. A widget that declares `portfolio-matrix-dsl` must include a non-empty `functionSpec.program` array; otherwise the action contract harness rejects the widget and asks the agent to regenerate it. The GUI and runner must reject unsupported operations instead of fabricating backtest results.

Minimal v1 shape:

```json
{
  "language": "portfolio-matrix-dsl",
  "version": 1,
  "inputs": ["W-001"],
  "outputs": ["signal_matrix"],
  "program": [
    { "op": "indicator", "name": "rsi", "period": 14, "field": "close", "outputField": "rsi" },
    { "op": "rule", "when": "rsi < 20", "emit": { "field": "target_weight", "value": 1, "ruleId": "buy_oversold" } },
    { "op": "rule", "when": "rsi > 80", "emit": { "field": "target_weight", "value": 0, "ruleId": "sell_overbought" } }
  ]
}
```

Supported v1 operations:

| Op | Purpose | Current executable subset |
| --- | --- | --- |
| `indicator` | Add derived indicator fields to each run/asset/date record | `name:"rsi"` over a numeric source field such as `close` |
| `rolling` | Add rolling statistics | `mean`/`avg`, `sum`, `min`, `max`, `std` |
| `rank` | Rank assets within the same `runId` and `date` | Frontend compiler only for source matrices that already contain comparable asset rows |
| `swap` / `allocation_event` | Declare a dated asset replacement intent | yfinance runner resolves the effective trading date, adds the replacement ticker to the price universe, and transfers the current `fromAsset` position value to `toAsset` |
| `portfolio_swap` / `allocation_event eventType:"portfolio_swap"` | Declare a one-way portfolio A to portfolio B allocation switch | yfinance runner watches the safe `when` condition from runtime fields/indicators, then reallocates total portfolio value into `targetWeights` for the next interval |
| `dca` / `contribution` | Declare periodic external contributions into the portfolio | yfinance runner snaps scheduled deposits to trading dates, invests each contribution into `targetWeights` or the input portfolio weights, and emits contribution-aware metrics such as IRR/TWR |
| `rebalance` | Rebalance when portfolio drift crosses a threshold or on a periodic schedule | `method:"threshold_band"` / `drift_rebalance` / `band_rebalance`, plus `method:"periodic", frequency:"monthly"` |
| `rule` | Convert conditions into `signal_matrix` rows | simple comparison expressions, optional `and`/`or`, `true`/`false`, emitting `target_weight` or another named field |
| `emit` | Optional output declaration metadata | ignored by the runner when it has no condition; conditional `emit` is normalized as `rule` |

Asset swaps are still function-widget intent, not execution. The function widget declares the event; the backtest runner fetches the needed prices, chooses the trading date, applies the swap, and stores the result series. Example:

```json
{
  "op": "swap",
  "fromAsset": "META",
  "toAsset": "LLY",
  "effective": { "anchor": "run_start", "offsetMonths": 6, "snap": "next_trading_day" },
  "weightPolicy": "preserve_value"
}
```

`weightPolicy:"preserve_value"` sells the current `fromAsset` position at the event date and buys the `toAsset` with that value. It does not force the whole portfolio back to equal weight unless a separate rebalance event is added.

Portfolio swaps are also function-widget intent. Use them when a condition changes the whole strategy allocation rather than one ticker. The first executable version is one-way: once the condition becomes true, the runner switches from the current portfolio A to target portfolio B and stays there. If the strategy needs B to A recovery, model that as a later explicit reverse event rather than assuming automatic round-trips. Example:

```json
{
  "op": "portfolio_swap",
  "when": "rsi < 40",
  "fromLabel": "A 공격 포트폴리오",
  "toLabel": "B 방어 포트폴리오",
  "targetWeights": { "TLT": 0.6, "GLD": 0.25, "SHY": 0.15 }
}
```

`targetWeights` accepts either decimal weights or percentage-like numbers; values above 1 are normalized to 100%. If the weights sum below 1, the remaining value is held as cash. Conditions use the same small expression grammar below and may reference fields created by earlier `indicator` or `rolling` steps, such as `rsi`, `ema`, or `macd`.

The yfinance runner also exposes time fields for date-based conditions:

- `bar_index`
- `trading_days_since_run_start`
- `days_since_run_start`
- `months_since_run_start`
- `years_since_run_start`

For example, `when:"months_since_run_start >= 6"` switches on the first trading date at or after the six-calendar-month anniversary of the run start.

DCA / contribution operations are function-widget intent, not standalone portfolio tables. Use them when the user asks for 적립식, DCA, periodic buys, or monthly contributions. Example:

```json
{
  "op": "dca",
  "amount": 1000,
  "frequency": "monthly",
  "dayOfMonth": 1,
  "targetWeights": { "QQQ": 0.7, "TLT": 0.3 }
}
```

`frequency` supports `daily`, `weekly`, `biweekly`, `monthly`, and `quarterly`. If `targetWeights` is omitted, each contribution follows the input portfolio weights. The runner records each deposit as an external cashflow and returns DCA metrics in `metrics.standard`: `totalContribution`, `netProfit`, `contributionReturn`, `irr`, `twr`, `contributionCount`, and `averageContribution`.

Expression grammar is deliberately small:

```text
comparison := field ("<" | "<=" | ">" | ">=" | "==" | "=" | "!=") number_or_field
condition  := ("true" | "false") | comparison (("and" | "&&" | "or" | "||") comparison)*
```

The compiler also accepts the same expression as an AST:

```json
{
  "type": "comparison",
  "left": { "type": "field", "name": "rsi" },
  "operator": "<",
  "right": { "type": "literal", "value": 20 }
}
```

Compiler output must include `signalMatrix.compiler` metadata:

```json
{
  "role": "signal_matrix",
  "status": "ready",
  "dimensions": ["runId", "date", "asset", "field"],
  "schema": ["runId", "date", "asset", "field", "value", "ruleId", "source"],
  "executionMode": "matrix-dsl",
  "rows": [
    { "runId": "base", "date": "2026-04-10", "asset": "QQQ", "field": "target_weight", "value": 1, "ruleId": "buy_oversold", "source": "portfolio-matrix-dsl" }
  ],
  "compiler": {
    "language": "portfolio-matrix-dsl",
    "version": 1,
    "ops": ["indicator", "rule", "rule"],
    "sourceRowCount": 58,
    "issueCount": 0,
    "issues": []
  }
}
```

Compiler statuses:

| Status | Meaning |
| --- | --- |
| `ready` | Program validated and emitted rows from an available `source_matrix` |
| `pending-source` | Program is valid but this frontend pass does not have source rows yet; the runner may still execute it against yfinance price rows |
| `unsupported_op` | At least one op is not in the allowed DSL subset |
| `invalid_expression` | A rule condition could not be parsed into the safe expression grammar |

Execution timing follows the scenario assumptions. In the current yfinance runner, DSL rules observe the current close-derived state and change exposure for the next interval, matching the existing `next_open`/next-bar safety model. Swap events are applied after the effective date's portfolio value is observed, so the replacement asset affects the next interval. This is close to the important Pine Script strategy distinction that scripts evaluate bar by bar, while strategy orders are filled by the broker emulator on a subsequent available tick. See the official Pine docs for the execution model and strategy order behavior:

- https://www.tradingview.com/pine-script-docs/language/execution-model/
- https://www.tradingview.com/pine-script-docs/concepts/strategies/

Pine Script should be treated as an authoring UX, not as a runtime dependency. Do not execute full Pine inside the local app. A future Pine-compatible layer may parse a safe subset such as:

```pine
r = ta.rsi(close, 14)

if r < 20
    strategy.entry("long", strategy.long)

if r > 80
    strategy.close("long")
```

and lower it to the internal DSL:

```json
[
  { "op": "indicator", "name": "rsi", "period": 14, "field": "close", "outputField": "rsi" },
  { "op": "rule", "when": "rsi < 20", "emit": { "field": "target_weight", "value": 1 } },
  { "op": "rule", "when": "rsi > 80", "emit": { "field": "target_weight", "value": 0 } }
]
```

Unsupported Pine syntax, unavailable indicators, lookahead-prone constructs, file/network access, arbitrary loops, and unrestricted user functions must result in "transform unavailable" or "execution unavailable" states. They must not become fake rows, fake metrics, or markdown explanations pretending to be computed output.

The runtime enforces this contract in three places:

- agent-created widget actions must declare a canonical `widget.visualType`; `memo` / `프롬프트 위젯` fallback nodes are rejected and regenerated instead of being stored;
- agent-created and agent-updated widget relations are filtered through the output-role order;
- stored/legacy widget relations are pruned during workspace normalization;
- backtest chart execution stores its scenario runs and input matrix roles in `chartSpec.scenarioMatrix` for downstream metrics widgets.

## Core Widget Types

Use these types as the default primitives:

- `table`: portfolio holdings, target weights, imported rows, source datasets, or beta benchmark reference portfolios.
- `function`: strategy rules, rebalance schedules, buy/sell signals, data-file contracts.
- `line`: backtest, benchmark, NAV, drawdown, or performance chart output.
- `price-history`: asset-management investment cost-basis history output rendered with Lightweight Charts from Toss Securities Open API sync snapshots.
- `position-status`: asset-management position-composition snapshot output from Toss Securities Open API sync snapshots. It renders the query-end-date holdings composition as either a pie view or a long stacked-rectangle view and uses `knownCostBasis*`, not mark-to-market valuation.
- `seasonal-comparison`: asset-management annual YTD return overlay from Toss Securities Open API sync snapshots. It renders one line per calendar year with Lightweight Charts, keeps the latest year visually heavier, and uses a clickable year legend to show or hide individual seasons.
- `metrics-table`: computed backtest metrics such as CAGR, MDD, Sharpe, Sortino, Calmar, Ulcer, UPI, and beta.
- `allocation`: allocation or pie/donut visualization.
- `checklist`: validation, missing inputs, blocked execution, or repair steps.
- `markdown`: document-style agent output for explanation, web-search result review, analysis notes, backtest follow-up calculations, or narrative reports. It has no calculation input or return value; use `kind:"마크다운 위젯"`, `outputRole:"note"`, empty `dataset`, empty `dependsOn`, empty `derivedFrom`, and empty `nextActions`. Default layout is `3x3`. Optional embedded charts are allowed through `widget.echarts=[{title, body, option}]` or fenced `echarts` / `chart` JSON blocks in `widget.markdown`, where `option` is a plain ECharts option object.

`memo` is a legacy/local display fallback only. Agents must not create new `memo` or `프롬프트 위젯` nodes. If an action lacks a canonical `visualType`, the harness rejects the action and asks the agent to regenerate a complete `portfolio_widget_action` JSON.

Do not convert existing `table`, `function`, `line`, `price-history`, `position-status`, `seasonal-comparison`, `metrics-table`, `allocation`, or `checklist` widgets into `markdown`. A targeted `update_widget` must preserve the target widget's calculation role and canonical `visualType`; if an agent needs to show a document-style explanation about an existing widget or external research result, it must emit a separate `action:"create_widget"` markdown action instead.

Runtime helpers now live under `web/src/portfolio/` for new portfolio-specific engine work. Keep reusable action parsing, widget type normalization, deterministic widget compilers, and portfolio route components there instead of adding more portfolio domain code to `web/src/App.jsx`. `App.jsx` lazy-loads the portfolio guide and active workspace route components.

Current local engine modules:

- `agentPromptBuilder.js`: builds sidebar-agent prompt and portfolio widget action contract text.
- `actionParser.js`: parses and strips `portfolio_widget_action` fenced JSON blocks.
- `widgetTypes.js`: owns visual type normalization and shared widget type constants.
- `widgetActions.js`: decides executable widget actions, action routes, footer action labels, refresh actions, and local allocation-chart affordances.
- `widgetAgentActionApply.js`: turns sidebar-agent action results into pure apply states so `PortfolioWorkspace.jsx` only consumes, remembers, logs, refreshes, or swaps widget lists.
- `widgetAgentCreate.js`: turns untargeted sidebar-agent widget actions into concrete widget state, including asset-management allocation chart auto-derivation.
- `widgetAgentUpdate.js`: applies targeted sidebar-agent widget patches, preserving guarded conversions, dependency relations, and stale dependent marking.
- `widgetAutoRefresh.js`: selects stale auto-update widgets whose dependencies are ready and returns the action/key App should schedule.
- `allocationActions.js`: builds local allocation-chart create/update action state so `PortfolioWorkspace.jsx` only applies the resulting widget list and logs.
- `allocationCompiler.js`: builds deterministic asset-management allocation/pie chart widgets from holdings rows.
- `backtestChartRun.js`: builds table-to-backtest chart conversion patches, scenario-expanded run preparation state, backtest run requests, `/api/portfolio/backtest` execution, running/error/stale patches, result series/metrics, dependency rows, and ready-widget patches.
- `backtestWidgetSelectors.js`: resolves runnable portfolio, strategy, and beta-reference widgets for chart execution.
- `backtestRequestBuilder.js`: owns inline benchmark gating, beta reference selection, scenario matrix metadata, and `/api/portfolio/backtest` payload construction.
- `backtestResults.js`: formats backtest variant labels, issue messages, source table snapshots, and line-chart table restoration.
- `canvasStoreActions.js`: builds pure create, select, rename, duplicate, delete, and active-workspace update states for portfolio canvas stores.
- `liveBacktestRun.js`: builds and executes legacy holdings-panel yfinance backtest payloads without injecting a benchmark unless the user provided one.
- `canvasModes.jsx`: owns asset-management and strategy-research canvas metadata, labels, and icons.
- `chartBuilders.js`: builds chart specs and ECharts options for allocation/pie and line/backtest widgets.
- `PortfolioAssetPriceHistoryChart.jsx`: renders asset-management `price-history` widgets with a Lightweight Charts area series from local Toss Securities sync snapshots.
- `PortfolioInvestmentPositionStatusChart.jsx`: renders asset-management `position-status` widgets with pie and stacked-rectangle composition views from local Toss Securities sync snapshots.
- `PortfolioSeasonalComparisonChart.jsx`: renders asset-management `seasonal-comparison` widgets with a Lightweight Charts multi-line YTD return overlay and a clickable per-year legend.
- `contextPacketBuilder.js`: builds the portfolio canvas context packet handed to the sidebar agent.
- `datasetParser.js`: parses ticker lists, markdown holdings tables, weights, and known asset labels into normalized widget datasets.
- `functionSpecParser.js`: normalizes function widgets, strategy rules, attached CSV metadata, and inline external data.
- `holdingsSummary.js`: parses asset-management holdings input and builds value/weight summaries and display labels.
- `scenarioContract.js`: owns the pinned strategy scenario root, default run grid, widget output roles, and one-way role ordering.
- `signalMatrixCompiler.js`: materializes function widget `signalMatrix` rows from strategy rules, explicit agent rows, and inline CSV/text data.
- `strategyCompiler.js`: classifies function widgets into executable strategy types and recoverable data states.
- `PortfolioCanvasDeleteDialog.jsx`: renders the canvas delete confirmation dialog used by the sidebar canvas menu.
- `PortfolioCanvasNavList.jsx`: renders the sidebar canvas submenu, rename field, and per-canvas menu actions.
- `PortfolioGuidePage.jsx`: renders the portfolio landing/guide screen and keeps asset-management pie-chart framing out of `App.jsx`.
- `PortfolioWorkspace.jsx`: owns one active portfolio canvas workspace, including widget state persistence, local pie-chart actions, yfinance backtest dispatch, sidebar-agent widget actions, and legacy holdings-panel mode.
- `PortfolioWidgetCanvas.jsx`: renders the widget grid shell, flow map, pinned scenario panel, agent-prompt empty cells, and local move/resize widget placement.
- `PortfolioEChart.jsx`: owns the modular ECharts runtime registration and canvas lifecycle.
- `PortfolioWidgetChart.jsx`: renders interactive allocation/line widget charts and lazy-loads the chart runtime from widget content.
- `PortfolioMarkdownEChart.jsx`: renders optional ECharts option blocks embedded inside markdown widgets.
- `PortfolioWidgetPreview.jsx`: renders lightweight widget-card visual previews without loading ECharts.
- `PortfolioWidgetContent.jsx`: renders widget-card content for tables, function rules, metrics tables, markdown documents with optional ECharts blocks, checklists, memo widgets, and lazy visual-widget handoff.
- `PortfolioWidgetFlowMap.jsx`: renders the input/function/output widget dependency graph above the grid.
- `PortfolioWidgetModal.jsx`: renders the prompt-only modal that forwards empty-cell or scenario-panel input to the sidebar agent.
- `PortfolioWorkspaceHeader.jsx`: renders the canvas mode label, editable title, guide button, and workspace health badge.
- `PortfolioWorkspaceLegacyPanel.jsx`: renders the direct holdings input mode, allocation chart, yfinance chart controls, holdings table, principles, and log.
- `widgetGraph.js`: resolves source, function, and beta-reference widgets for backtest chart execution.
- `widgetIdentity.js`: owns widget display ids, status normalization, numeric clamping, compact text cleaning, and short list normalization.
- `widgetIntentParser.js`: infers widget title, kind, visual type, local draft eligibility, and explicit allocation-value hints from prompts.
- `widgetLayout.js`: owns widget-grid placement search, occupancy, and collision checks shared by App-level placement and the canvas component.
- `widgetFlowBuilder.js`: builds multi-widget `create_widget_flow` drafts and resolved dependency graphs from agent action payloads.
- `widgetMetrics.js`: normalizes standard backtest metric rows and shared metric-table columns for runner output and widget rendering.
- `widgetPatchParser.js`: converts agent widget actions and prose into guarded widget patches and target widget references.
- `widgetRelations.js`: resolves widget references, dependencies, derived-from rows, update policy, cycles, and computed-from version maps.
- `widgetRoleClassifier.js`: classifies widget relationships, table rows, holdings inputs, function widgets, benchmark references, and yfinance refreshability.
- `widgetDrafts.js`: builds create/edit widget drafts and manual submit results from modal form input, including local table/function inference, asset-management pie-chart eligibility, agent handoff metadata, and stale dependent marking.
- `widgetRefreshPrompts.js`: builds guarded agent prompts and working-state patches for stale or dependent widget refreshes.
- `widgetRestore.js`: builds restore action state when a self-table-toggle backtest chart is converted back to its source table, including missing-source errors and stale dependent marking.
- `widgetStrategySpec.js`: resolves function widget strategy specs from inline rules, text inference, dependencies, and attached external data.
- `widgetStateTransitions.js`: marks dependent widgets stale, reports missing dependencies, and sorts refresh targets by dependency depth.
- `workspaceReferenceContent.js`: owns portfolio theory principles and schema-reference copy shared by the workspace and agent context packet.
- `workspaceState.js`: owns portfolio workspace/canvas storage keys, widget state normalization, canvas creation, and canvas chat compaction.

The yfinance runner uses `parse_portfolio_strategy_config` as the strategy router. Strategy-specific parser names such as `parse_supertrend_strategy_config` should stay narrow and should not become general backtest routers again.

## Asset Management Snapshot Widgets

Asset-management canvas creation is available only after the Toss Securities connection and position snapshot generation are ready. Empty cells use local widget creation for snapshot-backed widgets rather than asking the agent to invent manual holdings.

Toss Securities asset-management data is stored in the runtime-local SQLite ledger `data/tossinvest/tossinvest-ledger.sqlite3`; the schema contract is `config/tossinvest-ledger.schema.sql`. The snapshot-backed widgets read the API projections from `position_snapshots`, not CSV files. Snapshot rebuild progress is tracked in `rebuild_runs.total_snapshots` and `rebuild_runs.completed_snapshots`, so Settings and the asset-management header can display `completed / total` and percent while the rebuild is running.

The asset-management reconstruction path must use Toss data only. Daily candles are cached per symbol/date in `market_candles`, coverage is tracked in `market_candle_cache_state`, and USD/KRW rates are cached per date in `fx_rates`. These tables are generated runtime data and should not be committed or shipped with releases.

The latest snapshot date is not treated as final. When snapshot generation reaches the current KST date, the rebuild flow refreshes that latest candle/rate slice even if the symbol already has cached historical coverage, because the market may still be moving during the sync window. Historical covered dates can remain cached, but the latest-date row must stay refreshable at sync time.

Asset-management empty cells use a local widget picker instead of an agent prompt. The picker includes `보유 자산 과거 내역 차트`, which creates a `visualType:"price-history"` widget. That widget reads `/api/tossinvest/order-sync/investment-history`, uses the visible asset-history period and timeframe, and renders an investment cost-basis area chart with Lightweight Charts. Its value series is `knownCostBasis*`, so it is not a market-price valuation series and should not be labeled as current asset value. It is not a yfinance backtest widget and should not receive `run_backtest_chart_widget`.

The picker also includes `투자 종목 현황`, which creates a `visualType:"position-status"` widget. That widget reads `/api/tossinvest/order-sync/position-status`, follows the visible asset-history query end date, and defaults to a stacked-rectangle view with a `원 | 사각형` view toggle in the widget header. The `원` view is the pie view; `사각형` is the long composition-bar view. Position list labels should include the ratio in parentheses, such as `AMD (24.31%)`.

The picker also includes `시즌별 비교`, which creates a `visualType:"seasonal-comparison"` widget. That widget reads `/api/tossinvest/order-sync/investment-history?timeframe=1d`, groups the snapshot series by calendar year, and overlays year-to-date return lines on a shared January-to-December axis. The last available year is drawn with a heavier line because it may be incomplete up to the latest synced date; earlier years use thinner lines. The widget renders a custom clickable legend so each year can be toggled on or off without mutating stored snapshot data.

- A `table` widget with holdings rows can be converted directly to an `allocation` widget through the local action `create_allocation_chart_from_widget`.
- This action should not call Codex or any LLM. It reads the source widget rows, creates a separate `visualType:"allocation"` widget, and links it back with `dependsOn` and `derivedFrom`.
- If the source table already has a derived allocation chart, running the action again should update that chart instead of duplicating it.
- Keep the source table visible. Do not replace the table with the chart.
- Treat the pie/donut chart as the default asset-management visual. It is a derived allocation widget, not a backtest result.
- Prefer explicit `weight`, `비중`, `percent`, or `ratio` fields for pie sizing. If no weight exists, use value-like fields such as `marketValue`, `market_value`, `평가금액`, `평가액`, `금액`, `현재가치`, `nav`, or `value`, and display the computed share separately from the raw value.
- Value parsing should tolerate common portfolio notations such as `1,000,000원`, `$2,500`, `1.2억`, `3천만원`, `25%`, `2.5m`, or `4k`.
- Manual prompts can also create a local allocation widget from compact weighted text such as `AAPL 60%, MSFT 40%` or from markdown tables with `평가금액`, `평가액`, `marketValue`, `market_value`, `amount`, `비중`, or `weight` columns.
- In asset-management mode, when the manual `+` widget modal creates a local `table` from explicit weight/value fields, the GUI should also create a separate derived pie chart automatically. Do not auto-create this chart from ticker names alone.
- Normalized dataset rows should preserve whether a value was explicit through `hasExplicitAllocationValue` and `valueBasis`. Rows inferred from ticker names alone may keep a placeholder value for table display, but the allocation compiler must ignore them for automatic pie-chart creation.
- Equal-weight pie charts are allowed only when the prompt or data explicitly says equal weight, 동일비중, or 균등.
- In asset-management mode, when a future broker-API response or explicit agent action creates a ready holdings `table`, the GUI should use the same automatic derived pie chart path.
- The derived chart should use `kind:"포트폴리오 파이차트"` and `chartSpec.role:"portfolio_allocation_chart"`.
- Strategy-research canvases can still prioritize backtest actions; the allocation-chart fast path is specifically the default asset-management table affordance.
- Prompt-only modals should not directly create asset-management widgets while the API path is gated. All modal text is forwarded to the sidebar agent.

## Built-In Strategy Functions

The built-in strategy list is a legacy compatibility layer and a fast path for common cases. For new generalized strategy work, prefer `functionSpec.language:"portfolio-matrix-dsl"` with an explicit `program` and compile the function widget into `signal_matrix` rows. If a widget uses one of the built-in strategy functions below, keep it on the legacy `strategy-dsl` path instead of labeling it as `portfolio-matrix-dsl`.

Use these internal strategy function types before inventing a custom shape:

| Function type | `functionSpec.executionMode` | Typical request | Execution status |
| --- | --- | --- | --- |
| `periodic_rebalance` | `periodic-rebalance` | 1개월/3개월 리밸런싱, 월말/분기말 목표 비중 복원 | executable through `run_backtest_chart_widget` |
| `threshold_rebalance` | `signal-rules` with `rebalance:"threshold_band"` | 10%p 이탈, 허용 밴드 초과 시 목표 비중 복원 | executable through `run_backtest_chart_widget` |
| `supertrend` | `indicator-signal` | Supertrend ATR 기반 매수/매도 | executable through `run_backtest_chart_widget` |
| `indicator_signal` | `indicator-signal` | RSI, MACD, 이동평균, Bollinger 등 지표 기반 규칙 | executable through `run_backtest_chart_widget` for the built-in yfinance price indicators only; simple RSI rules such as `RSI < 20 -> buy`, `RSI > 80 -> sell` are honored |
| `external_signal` | `external-signal` | TradingView CSV, Shiller PE, macro/sentiment series 등 외부 시계열 기반 매수/매도 | executable through `run_backtest_chart_widget` when the CSV content is attached to `dataFiles` / `functionSpec.dataSources` |
| `universe_rotation` | `universe-rotation` | 랭킹 기반 종목 교체, 상위 N개 편입, 하위 종목 제외 | executable through `run_backtest_chart_widget` using momentum ranking over the source universe |

Function widgets are compact rule nodes. Unless the user asks for a large inspection surface, create them as `w: 1`, `h: 1`.

Never fake an unsupported function's result series. If a requested indicator, ranking input, or execution rule is outside the built-in runner, keep the result chart waiting for execution or create a checklist with required data and runner support gaps. A function is not "supported" just because its high-level family is recognized; the runner must also understand the concrete rule shape and parameters.

Uploaded CSV, TradingView exports, Shiller PE, macro series, sentiment series, or other external signal files must be represented as `external_signal` rules, not as generic built-in `indicator_signal`. The current runner supports simple comparison rules such as `close > open` / `close <= open` against attached CSV columns, then applies the resulting exposure to yfinance portfolio prices. For lower-frequency CSV rows, signals use next-bar timing to avoid applying a completed monthly/weekly value before that bar could be known.

For `external_signal`, `dataFiles[].frequency` or `functionSpec.dataSources[].frequency` describes the external data cadence only. It is not a portfolio rebalance schedule. Only use `functionSpec.rebalance`, `periodic_rebalance`, `calendar_month_end`, or `calendar_quarter_end` when the user explicitly wants target-weight rebalancing.

## Attached File Strategy Widgets

When the user attaches a CSV/XLSX file and asks for a buy/sell strategy, the attached file belongs to the strategy `function` widget, not to the portfolio holdings table.

Required shape:

- Create one source `table` widget for tradable holdings only, such as `QQQ 100%`.
- Create one `function` widget for the file-driven strategy.
- The chat composer preserves readable CSV/text attachments as inline text previews and executable `dataFiles` content.
- Do not attach chat CSV files to ordinary holdings `table` or allocation widgets by default; only explicit strategy/data-source widgets should carry them.
- Put the attached file metadata and preserved inline content on both `widget.dataFiles` and `widget.functionSpec.dataSources` when available.
- Set `functionSpec.executionMode="external-signal"` for Shiller PE, TradingView CSV, macro CSV, sentiment CSV, or any non-yfinance signal file.
- Keep `functionSpec.rebalance` empty unless the user explicitly asks for target-weight rebalancing.
- Set `functionSpec.dataSources[].frequency` to the file cadence such as `daily`, `weekly`, `monthly`, or `quarterly`; this is not a rebalance interval.
- Create a separate result `line` widget that depends on the holdings table and the function widget, with `nextActions:["run_backtest_chart_widget"]`.

The runner can execute external CSV signals only when the function widget carries readable CSV content. At least one data file should have `text`, `content`, `csv`, `rawText`, or `dataUrl`. Metadata-only rows such as a filename, size, or status are not enough to run a backtest.

Do not convert an attached signal CSV into a fake holdings table like `{ "label": "항목1", "value": 100 }`. That loses the CSV columns and makes the backtest runner unable to evaluate rules such as `close > open`.

Minimal external CSV strategy:

```json
{
  "kind": "함수 위젯",
  "visualType": "function",
  "w": 1,
  "h": 1,
  "dataFiles": [
    {
      "name": "MULTPL_SHILLER_PE_RATIO_MONTH.csv",
      "type": "text/csv",
      "source": "user_upload",
      "role": "external_signal",
      "status": "attached",
      "requiredColumns": ["time", "open", "high", "low", "close"],
      "dateColumn": "time",
      "frequency": "monthly",
      "dataUrl": "<preserved data URL or inline CSV text>"
    }
  ],
  "functionSpec": {
    "language": "strategy-dsl",
    "executionMode": "external-signal",
    "inputs": ["source_portfolio"],
    "outputs": ["signals"],
    "dataSources": [
      {
        "name": "MULTPL_SHILLER_PE_RATIO_MONTH.csv",
        "type": "text/csv",
        "source": "user_upload",
        "role": "external_signal",
        "status": "attached",
        "requiredColumns": ["time", "open", "high", "low", "close"],
        "dateColumn": "time",
        "frequency": "monthly",
        "dataUrl": "<same preserved data URL or inline CSV text>"
      }
    ],
    "rules": [
      { "when": "close > open", "action": "buy", "target": "portfolio", "size": "target_weight" },
      { "when": "close <= open", "action": "sell", "target": "portfolio", "size": "0" }
    ],
    "riskControls": ["CSV 컬럼 확인", "월간 데이터는 다음 바부터 적용"]
  },
  "nextActions": ["run_backtest_chart_widget"]
}
```

External CSV flow with no benchmark:

```json
{
  "action": "create_widget_flow",
  "widgets": [
    {
      "id": "source_portfolio",
      "title": "QQQ 100% 포트폴리오",
      "kind": "포트폴리오 표",
      "visualType": "table",
      "dataset": [{ "label": "QQQ", "ticker": "QQQ", "value": 100 }]
    },
    {
      "id": "shiller_signal",
      "title": "Shiller PE HA 월 상승 전환 전략",
      "kind": "함수 위젯",
      "visualType": "function",
      "w": 1,
      "h": 1,
      "dataFiles": ["<attached CSV file object with inline content>"],
      "functionSpec": {
        "language": "strategy-dsl",
        "executionMode": "external-signal",
        "inputs": ["source_portfolio"],
        "outputs": ["signals"],
        "dataSources": ["<same attached CSV file object with inline content>"],
        "rules": [
          { "when": "close > open", "action": "buy", "target": "portfolio", "size": "target_weight" },
          { "when": "close <= open", "action": "sell", "target": "portfolio", "size": "0" }
        ]
      }
    },
    {
      "id": "result_chart",
      "title": "QQQ Buy & Hold vs Shiller PE HA 전략 백테스트",
      "kind": "백테스트 비교",
      "visualType": "line",
      "dependsOn": ["source_portfolio", "shiller_signal"],
      "derivedFrom": [
        { "widgetId": "source_portfolio", "field": "dataset", "role": "portfolio_input" },
        { "widgetId": "shiller_signal", "field": "functionSpec", "role": "strategy_rules" }
      ],
      "chartSpec": {
        "type": "line",
        "xField": "date",
        "includeBenchmark": false,
        "benchmarkMode": "none",
        "benchmark": "",
        "dataset": []
      },
      "nextActions": ["run_backtest_chart_widget"],
      "updatePolicy": "manual"
    }
  ]
}
```

## Graph Rules

- Keep every widget single-purpose.
- A source portfolio should be a `table` widget, not hidden inside a chart.
- A rebalance rule should be a `function` widget, not prose inside a chart.
- A backtest result should be a separate `line` widget that depends on the source portfolio and the function widgets.
- A backtest result's identity is `outputRole:"backtest_result"` plus the backtest execution contract. Do not demote it to `outputRole:"metrics"` or route refresh through metrics sync when repairing legacy `visualType:"metrics-table"` contamination.
- A backtest result chart must use time on the X axis. Do not put holdings, tickers, symbols, or target weights into the result chart `dataset`; those belong only in the source `table` widget.
- Backtest result charts should not add SPY, KODEX 200, or any other benchmark line by default. Set `chartSpec.includeBenchmark=false`, `chartSpec.benchmarkMode="none"`, and `chartSpec.benchmark=""` unless the user explicitly asks for an inline chart comparison line. Inline comparison lines must use `chartSpec.benchmarkMode="inline"`; older `benchmarkMode="ticker"` is not enough.
- If beta or benchmark-relative metrics are needed, create a separate beta benchmark reference `table` widget and link it through `chartSpec.benchmarkSourceWidgetIds` / `chartSpec.betaBenchmarkWidgetIds`, not as a chart line.
- A metrics table should be a separate `metrics-table` widget that depends on the backtest chart.
- DCA / contribution metrics should not create a separate widget type. Use a `metrics-table` with `chartSpec.metricProfile:"dca"` and metric rows that include contribution fields such as `totalContribution`, `netProfit`, `contributionReturn`, `irr`, and `twr`.
- Use `dependsOn` for widget ids or display ids that must be read before computing this widget.
- Use `derivedFrom` for explicit fields and roles:
  - `{ "widgetId": "W-001", "field": "dataset", "role": "portfolio_input" }`
  - `{ "widgetId": "W-002", "field": "functionSpec", "role": "strategy_rules" }`
- Set `updatePolicy` to `manual` for user-driven backtests, `auto` only for deterministic derived visuals, and `confirm` for investment interpretation.
- Do not invent execution results. If a chart has no computed series yet, make a line widget with `nextActions: ["run_backtest_chart_widget"]` and describe it as waiting for execution.

## Beta Benchmark Reference Tables

Benchmark and beta are no longer implicit chart settings. If the user needs beta against SPY, KODEX 200, QQQ, or any custom benchmark, create an explicit reference portfolio table.

Default beta benchmark selection:

- For US-listed stocks or US-listed ETFs, the default beta reference is `SPY`.
- Do not copy the source portfolio into the beta reference table. A `QQQ 100%` source portfolio should not produce a `QQQ 100%` beta reference unless the user explicitly asks for Nasdaq-100 or QQQ-relative beta.
- Use `QQQ` only when the user explicitly asks for a Nasdaq-100, technology-growth, or QQQ benchmark. `QQQ` is index-tracking, but it is not the default US equity beta market proxy.
- For Korea-listed equities, prefer a broad Korea equity proxy such as KODEX 200 when the ticker/source is available; otherwise ask for or document the benchmark data source.

Reference table rules:

- Use `visualType:"table"` and normal holdings rows such as `{ "label": "SPY", "ticker": "SPY", "value": 100 }`.
- Set `kind` or `chartSpec.role` so the table is clearly a beta reference, for example `kind:"베타 기준 포트폴리오"` or `chartSpec.role:"beta_benchmark"`.
- Do not put the benchmark reference table into `chartSpec.sourceWidgetIds`, because that makes it a plotted portfolio variant.
- Put the reference id in the backtest chart's `chartSpec.benchmarkSourceWidgetIds` and `chartSpec.betaBenchmarkWidgetIds`.
- The runner may use that table as `betaBenchmarkHoldings` for BETA calculation, while keeping the chart series limited to the source portfolio and strategy variants.

## Recoverable External Data States

Do not mark an external CSV/Shiller/TradingView signal widget as a hard `error` only because the attached file body is missing. That state is recoverable.

- Use `status:"stale"` when the strategy intent is recognizable but CSV text/dataUrl is missing.
- Show checks that say the strategy needs CSV original text in `dataFiles` / `functionSpec.dataSources`.
- Keep `nextActions` focused on repairing data attachment first, then rerunning `run_backtest_chart_widget`.
- Use hard `error` only when the strategy is unsupported even after required data is present, or when the backtest runner actually returns a non-recoverable failure.

Example:

```json
{
  "id": "beta_ref_spy",
  "title": "SPY 베타 기준 포트폴리오",
  "kind": "베타 기준 포트폴리오",
  "visualType": "table",
  "dataset": [{ "label": "SPY", "ticker": "SPY", "value": 100 }],
  "chartSpec": { "role": "beta_benchmark" }
}
```

Backtest chart linked to that reference:

```json
{
  "id": "result_chart",
  "kind": "백테스트 비교",
  "visualType": "line",
  "dependsOn": ["source_portfolio", "strategy_function", "beta_ref_spy"],
  "derivedFrom": [
    { "widgetId": "source_portfolio", "field": "dataset", "role": "portfolio_input" },
    { "widgetId": "strategy_function", "field": "functionSpec", "role": "strategy_rules" },
    { "widgetId": "beta_ref_spy", "field": "dataset", "role": "beta_benchmark" }
  ],
  "chartSpec": {
    "type": "line",
    "xField": "date",
    "sourceWidgetIds": ["source_portfolio"],
    "strategyWidgetIds": ["strategy_function"],
    "benchmarkSourceWidgetIds": ["beta_ref_spy"],
    "betaBenchmarkWidgetIds": ["beta_ref_spy"],
    "includeBenchmark": false,
    "benchmarkMode": "none",
    "benchmark": ""
  },
  "nextActions": ["run_backtest_chart_widget"]
}
```

## Multi-Widget Action

When one user request naturally creates a workflow, emit one `portfolio_widget_action` block with `action: "create_widget_flow"` and a `widgets` array. Each item may use temporary ids such as `source`, `rebalance_1m`, and `rebalance_3m`; the GUI resolves them to real widget ids.

```portfolio_widget_action
{
  "action": "create_widget_flow",
  "canvasId": "current-canvas-id",
  "widgets": [
    {
      "id": "source",
      "title": "M7 동일비중 포트폴리오",
      "kind": "포트폴리오 표",
      "visualType": "table",
      "summary": "백테스트 입력이 되는 원본 포트폴리오입니다.",
      "dataset": [
        { "label": "AAPL", "ticker": "AAPL", "value": 14.2857 },
        { "label": "MSFT", "ticker": "MSFT", "value": 14.2857 },
        { "label": "NVDA", "ticker": "NVDA", "value": 14.2857 }
      ]
    },
    {
      "id": "rebalance_1m",
      "title": "1개월 리밸런싱 함수",
      "kind": "함수 위젯",
      "visualType": "function",
      "w": 1,
      "h": 1,
      "summary": "매월 목표 비중으로 되돌리는 전략 규칙입니다.",
      "dependsOn": ["source"],
      "derivedFrom": [{ "widgetId": "source", "field": "dataset", "role": "portfolio_input" }],
      "functionSpec": {
        "language": "strategy-dsl",
        "executionMode": "periodic-rebalance",
        "inputs": ["source"],
        "outputs": ["target_weights"],
        "rebalance": "1개월",
        "rules": [
          { "when": "calendar_month_end", "action": "rebalance", "target": "portfolio", "size": "target_weights", "note": "1개월마다 목표 비중 복원" }
        ],
        "riskControls": ["비중 합계 100% 확인", "거래비용 별도 민감도 확인"]
      }
    },
    {
      "id": "rebalance_3m",
      "title": "3개월 리밸런싱 함수",
      "kind": "함수 위젯",
      "visualType": "function",
      "w": 1,
      "h": 1,
      "summary": "분기마다 목표 비중으로 되돌리는 전략 규칙입니다.",
      "dependsOn": ["source"],
      "derivedFrom": [{ "widgetId": "source", "field": "dataset", "role": "portfolio_input" }],
      "functionSpec": {
        "language": "strategy-dsl",
        "executionMode": "periodic-rebalance",
        "inputs": ["source"],
        "outputs": ["target_weights"],
        "rebalance": "3개월",
        "rules": [
          { "when": "calendar_quarter_end", "action": "rebalance", "target": "portfolio", "size": "target_weights", "note": "3개월마다 목표 비중 복원" }
        ],
        "riskControls": ["비중 합계 100% 확인", "거래비용 별도 민감도 확인"]
      }
    },
    {
      "id": "result_chart",
      "title": "M7 리밸런싱 비교 차트",
      "kind": "백테스트 비교",
      "visualType": "line",
	      "summary": "Buy & Hold, 1개월 리밸런싱, 3개월 리밸런싱을 비교합니다.",
      "dependsOn": ["source", "rebalance_1m", "rebalance_3m"],
      "derivedFrom": [
        { "widgetId": "source", "field": "dataset", "role": "portfolio_input" },
        { "widgetId": "rebalance_1m", "field": "functionSpec", "role": "strategy_rules" },
        { "widgetId": "rebalance_3m", "field": "functionSpec", "role": "strategy_rules" }
      ],
      "chartSpec": {
        "type": "line",
        "xField": "date",
        "yField": "portfolio",
        "sourceWidgetIds": ["source"],
        "strategyWidgetIds": ["rebalance_1m", "rebalance_3m"],
	        "includeBenchmark": false,
	        "benchmarkMode": "none",
	        "benchmark": "",
	        "expectedSeries": ["Buy & Hold", "1개월 리밸런싱", "3개월 리밸런싱"],
	        "dataset": []
	      },
      "nextActions": ["run_backtest_chart_widget"],
      "updatePolicy": "manual"
    }
  ]
}
```

## Function Widget Examples

Periodic rebalance:

```json
{
  "kind": "함수 위젯",
  "visualType": "function",
  "w": 1,
  "h": 1,
  "functionSpec": {
    "language": "strategy-dsl",
    "executionMode": "periodic-rebalance",
    "rebalance": "1개월",
    "rules": [
      { "when": "calendar_month_end", "action": "rebalance", "target": "portfolio", "size": "target_weights" }
    ]
  }
}
```

Indicator signal:

```json
{
  "kind": "함수 위젯",
  "visualType": "function",
  "w": 1,
  "h": 1,
  "functionSpec": {
    "language": "strategy-dsl",
    "executionMode": "indicator-signal",
    "rules": [
      { "when": "rsi(close, 14) < 30", "action": "buy", "target": "portfolio", "size": "target_weight" },
      { "when": "rsi(close, 14) > 70", "action": "sell", "target": "portfolio", "size": "0" }
    ],
    "riskControls": ["거래비용 민감도 확인", "지표 계산 기준 OHLC 출처 확인"]
  }
}
```

Universe rotation:

```json
{
  "kind": "함수 위젯",
  "visualType": "function",
  "w": 1,
  "h": 1,
  "functionSpec": {
    "language": "strategy-dsl",
    "executionMode": "universe-rotation",
    "outputs": ["target_weights"],
    "rules": [
      { "when": "ranking_review_date", "action": "rotate", "target": "portfolio", "size": "top_10_equal_weight" }
    ],
    "dataSources": [
      { "name": "ranking_source", "role": "ranking", "status": "required", "requiredColumns": ["date", "symbol", "rank"] }
    ],
    "riskControls": ["교체 주기 확인", "거래비용과 슬리피지 확인"]
  }
}
```

## Wrong Pattern

Do not create only this:

```json
{
  "action": "create_widget",
  "widget": {
    "title": "M7 1개월 vs 3개월 리밸런싱",
    "visualType": "line",
    "summary": "1개월과 3개월을 비교합니다."
  }
}
```

This loses the source portfolio, hides the rebalance functions, and prevents the GUI from showing or repairing dependency order.

Also do not create a result line chart whose X axis is the holdings list:

```json
{
  "visualType": "line",
  "dataset": [
    { "label": "AAPL", "value": 14.2857 },
    { "label": "MSFT", "value": 14.2857 }
  ]
}
```

That is an allocation/holdings table, not a backtest result. A result chart waits for execution and later receives `xLabels` as dates plus one `series` entry per variant.

## Response Checklist

Before ending a Portfolio answer, check:

- Is the source data represented as a source widget?
- Are strategy or rebalance rules represented as function widgets?
- Does the result widget depend on both the source and the functions?
- Is the result chart free of ticker/holding rows and ready to receive date-based `xLabels` plus multiple series?
- Did you avoid claiming execution before the GUI action actually runs?
- Does the JSON action include the current `canvasId`?
