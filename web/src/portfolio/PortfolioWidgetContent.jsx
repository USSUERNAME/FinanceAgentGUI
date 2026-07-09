import React from "react";
import Paperclip from "lucide-react/dist/esm/icons/paperclip.js";
import { portfolioWidgetBenchmarkPreference } from "./backtestRequestBuilder.js";
import {
  filterPortfolioFunctionDataSources,
  normalizePortfolioWidgetDataFiles,
} from "./functionSpecParser.js";
import { formatPortfolioPercent } from "./holdingsSummary.js";
import { portfolioWidgetStatusLabel } from "./widgetActions.js";
import { cleanPortfolioWidgetText } from "./widgetIdentity.js";
import {
  formatPortfolioMetricCell,
  portfolioMetricColumnsForWidget,
  portfolioBacktestMetricRows,
} from "./widgetMetrics.js";
import {
  portfolioWidgetDependencyIds,
  portfolioWidgetRelationLabel,
} from "./widgetRelations.js";
import {
  portfolioWidgetLooksLikeMetricsTarget,
  portfolioWidgetTableRows,
} from "./widgetRoleClassifier.js";
import {
  normalizePortfolioMarkdownECharts,
  normalizePortfolioMarkdownText,
  stripPortfolioMarkdownEChartsFences,
  stripDuplicatePortfolioMarkdownTitle,
} from "./markdownWidget.js";
import { portfolioFunctionSpecForWidget } from "./widgetStrategySpec.js";
import { normalizePortfolioWidgetVisualType } from "./widgetTypes.js";
import { PortfolioWidgetMiniPreview } from "./PortfolioWidgetPreview.jsx";
import { MarkdownText } from "../utils/MarkdownText.jsx";

const PortfolioWidgetChart = React.lazy(() => import("./PortfolioWidgetChart.jsx"));
const PortfolioMarkdownEChart = React.lazy(() => import("./PortfolioMarkdownEChart.jsx"));
const BACKTEST_CHART_ACTIONS = new Set(["run_backtest_chart_widget", "run_yfinance_backtest_comparison"]);

function normalizeWidgetActionToken(value = "") {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
}

function formatWidgetFileSize(bytes) {
  const value = Number(bytes || 0);
  if (!Number.isFinite(value) || value <= 0) return "";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function formatPortfolioFunctionEffectiveLabel(effective = {}) {
  if (typeof effective === "string") {
    return cleanPortfolioWidgetText(effective, 80);
  }
  if (!effective || typeof effective !== "object" || Array.isArray(effective)) {
    return "런 시작 기준";
  }
  const date = cleanPortfolioWidgetText(effective.date || effective.effectiveDate || "", 40);
  if (date) return date;
  const anchor = cleanPortfolioWidgetText(effective.anchor || "run_start", 40);
  const months = Number(effective.offsetMonths || effective.months || 0);
  const days = Number(effective.offsetDays || effective.days || 0);
  const offsets = [
    Number.isFinite(months) && months > 0 ? `${months}개월 후` : "",
    Number.isFinite(days) && days > 0 ? `${days}일 후` : "",
  ].filter(Boolean);
  const snap = cleanPortfolioWidgetText(effective.snap || effective.roll || effective.tradingDay || "", 40);
  const snapLabel = snap === "next_trading_day" ? "다음 거래일" : snap === "previous_trading_day" ? "직전 거래일" : snap;
  return [anchor, ...offsets, snapLabel].filter(Boolean).join(" · ") || "런 시작 기준";
}

function formatPortfolioFunctionWeightsLabel(weights = {}) {
  const entries = weights && typeof weights === "object" && !Array.isArray(weights)
    ? Object.entries(weights)
    : [];
  return entries
    .filter(([ticker, weight]) => ticker && Number(weight) > 0)
    .slice(0, 4)
    .map(([ticker, weight]) => `${cleanPortfolioWidgetText(ticker, 16).toUpperCase()} ${formatPortfolioPercent(Number(weight) * 100, 1)}`)
    .join(" / ");
}

export function PortfolioWidgetRelationMeta({ widget, widgets }) {
  const relationLabel = portfolioWidgetRelationLabel(widget, widgets);
  const versionLabel = `v${widget.version || 1}`;
  if (!relationLabel && !widget.staleReason) {
    return <div className="portfolio-widget-relation-meta">{versionLabel}</div>;
  }
  return (
    <div className={`portfolio-widget-relation-meta ${widget.staleReason ? "is-stale" : ""}`}>
      <span>{versionLabel}</span>
      {widget.outputRole ? <span>{widget.outputRole}</span> : null}
      {relationLabel ? <span>{relationLabel}</span> : null}
      {widget.updatePolicy ? <span>{widget.updatePolicy}</span> : null}
      {widget.staleReason ? <strong>{widget.staleReason}</strong> : null}
    </div>
  );
}

function portfolioWidgetIsBacktestSetupTable(widget = {}) {
  const type = normalizePortfolioWidgetVisualType(widget?.visualType);
  if (type !== "table" || portfolioWidgetLooksLikeMetricsTarget(widget)) return false;
  const actions = Array.isArray(widget?.nextActions) ? widget.nextActions : [];
  const hasBacktestAction = actions.some((action) => BACKTEST_CHART_ACTIONS.has(normalizeWidgetActionToken(action)));
  return hasBacktestAction;
}

function PortfolioWidgetTable({ widget }) {
  const rows = portfolioWidgetTableRows(widget);
  if (!rows.length) {
    return (
      <div className="portfolio-widget-table-empty">
        <strong>테이블 데이터 대기</strong>
        <span>dataset 또는 holdings가 들어오면 표로 표시됩니다.</span>
      </div>
    );
  }
  const total = rows.reduce((sum, row) => sum + Number(row.value || 0), 0);
  const usePercentScale = total > 99.5 && total <= 100.5;
  return (
    <div className="portfolio-widget-table-wrap">
      <table className="portfolio-widget-table" aria-label={`${widget?.title || "포트폴리오"} 표`}>
        <thead>
          <tr>
            <th scope="col">종목</th>
            <th scope="col">비중</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const percent = total > 0 ? (usePercentScale ? row.value : (row.value / total) * 100) : 0;
            const digits = Math.abs(percent - Math.round(percent)) < 0.05 ? 0 : 1;
            return (
              <tr key={`${widget?.id || "widget"}-${row.label}`}>
                <td>
                  <strong>{row.label}</strong>
                  {row.detail ? <span>{row.detail}</span> : null}
                </td>
                <td>{formatPortfolioPercent(percent, digits)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function PortfolioWidgetBacktestSetupTable({ widget, widgets = [] }) {
  const byId = new Map(widgets.map((item) => [item.id, item]));
  const dependencyLabels = portfolioWidgetDependencyIds(widget)
    .map((id) => {
      const source = byId.get(id) || widgets.find((candidate) => candidate.displayId === id);
      if (!source) return cleanPortfolioWidgetText(id, 24);
      return `${source.displayId || cleanPortfolioWidgetText(source.id, 24)} ${source.title || "입력 위젯"}`;
    })
    .filter(Boolean);
  const sourceTables = Array.isArray(widget?.chartSpec?.sourceTables) ? widget.chartSpec.sourceTables : [];
  const sourceTableLabels = sourceTables
    .map((table) => `${table.displayId || cleanPortfolioWidgetText(table.id, 24) || "입력"} ${table.title || "포트폴리오"}`)
    .filter(Boolean);
  const inputRows = portfolioWidgetTableRows(widget);
  const inputLabel = dependencyLabels.length
    ? dependencyLabels.join(", ")
    : sourceTableLabels.length
      ? sourceTableLabels.join(", ")
      : inputRows.length
        ? `현재 위젯의 입력 행 ${inputRows.length}개`
        : "입력 포트폴리오 연결 대기";
  const benchmarkPreference = portfolioWidgetBenchmarkPreference(widget, "");
  const benchmarkLabel = benchmarkPreference.enabled ? benchmarkPreference.label : "없음";
  const betaReferenceIds = [
    ...(Array.isArray(widget?.chartSpec?.benchmarkSourceWidgetIds) ? widget.chartSpec.benchmarkSourceWidgetIds : []),
    ...(Array.isArray(widget?.chartSpec?.betaBenchmarkWidgetIds) ? widget.chartSpec.betaBenchmarkWidgetIds : []),
  ];
  const betaReferenceLabels = betaReferenceIds
    .map((id) => byId.get(id) || widgets.find((candidate) => candidate.displayId === id))
    .filter(Boolean)
    .map((source) => `${source.displayId || cleanPortfolioWidgetText(source.id, 24)} ${source.title || "베타 기준"}`);
  return (
    <div className="portfolio-widget-backtest-setup" role="group" aria-label={`${widget?.title || "백테스트"} 실행 준비`}>
      <table>
        <tbody>
          <tr>
            <th scope="row">역할</th>
            <td>백테스트 실행 준비</td>
          </tr>
          <tr>
            <th scope="row">입력</th>
            <td>{inputLabel}</td>
          </tr>
          <tr>
            <th scope="row">차트 비교선</th>
            <td>{benchmarkLabel}</td>
          </tr>
          <tr>
            <th scope="row">BETA 기준</th>
            <td>{betaReferenceLabels.length ? betaReferenceLabels.join(", ") : "별도 기준 포트폴리오 없음"}</td>
          </tr>
          <tr>
            <th scope="row">상태</th>
            <td>{widget?.status === "ready" ? "실행 전 입력 확인" : portfolioWidgetStatusLabel(widget?.status)}</td>
          </tr>
        </tbody>
      </table>
      <p>종목/비중 목록은 백테스트 결과가 아니라 실행 입력입니다. 실행 후 결과는 선 차트 또는 표준 지표 테이블로 표시됩니다.</p>
    </div>
  );
}

function PortfolioWidgetMetricsTable({ widget, widgets = [] }) {
  const rows = portfolioBacktestMetricRows(widget, widgets);
  const metricColumns = portfolioMetricColumnsForWidget(widget, rows);
  if (!rows.length) {
    return (
      <div className="portfolio-widget-table-empty">
        <strong>백테스트 지표 대기</strong>
        <span>chartSpec.metrics 또는 standardMetrics가 들어오면 표준 지표 테이블로 표시됩니다.</span>
      </div>
    );
  }
  return (
    <div className="portfolio-widget-metrics-table-wrap">
      <table className="portfolio-widget-metrics-table" aria-label={`${widget?.title || "백테스트"} 표준 지표 테이블`}>
        <thead>
          <tr>
            {metricColumns.map((column) => (
              <th scope="col" key={column.key}>
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={`${widget?.id || "metrics"}-${row.name}-${rowIndex}`}>
              {metricColumns.map((column) => (
                <td key={`${row.name}-${column.key}`}>{formatPortfolioMetricCell(row, column.key)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function portfolioWidgetDataFileStatusLabel(status = "") {
  const normalized = String(status || "").toLowerCase();
  if (/attached|uploaded|첨부|업로드/.test(normalized)) return "첨부됨";
  if (/required|needed|missing|필요|대기/.test(normalized)) return "필요";
  if (/planned|draft|계획/.test(normalized)) return "예정";
  return status || "필요";
}

function portfolioFunctionProgramDisplayRows(program = []) {
  if (!Array.isArray(program)) return [];
  return program
    .slice(0, 8)
    .map((step, index) => {
      if (!step || typeof step !== "object" || Array.isArray(step)) return null;
      const op = cleanPortfolioWidgetText(step.op || step.type || "", 32).toLowerCase();
      if (op === "indicator") {
        const name = cleanPortfolioWidgetText(step.name || step.indicator || "indicator", 32).toUpperCase();
        const field = cleanPortfolioWidgetText(step.field || "close", 32);
        const periods = name === "MACD"
          ? [step.fastPeriod || step.fast || 12, step.slowPeriod || step.slow || 26, step.signalPeriod || step.signal || 9].join("/")
          : cleanPortfolioWidgetText(step.period || step.length || "", 20);
        return {
          when: `${field}${periods ? ` · ${periods}` : ""}`,
          action: name,
          target: cleanPortfolioWidgetText(step.outputField || step.as || step.name || "", 60),
          size: "",
          note: "",
        };
      }
      if (op === "rolling") {
        return {
          when: `${cleanPortfolioWidgetText(step.field || "close", 32)} · ${step.period || step.window || 20}`,
          action: cleanPortfolioWidgetText(step.name || step.method || "ROLLING", 32).toUpperCase(),
          target: cleanPortfolioWidgetText(step.outputField || step.as || "", 60),
          size: "",
          note: "",
        };
      }
      if (op === "rebalance") {
        const method = cleanPortfolioWidgetText(step.method || step.name || "threshold_band", 80).toLowerCase();
        const frequency = cleanPortfolioWidgetText(step.frequency || step.cadence || step.interval || "monthly", 40).toLowerCase();
        const isPeriodic = ["periodic", "calendar", "calendar_month_end", "monthly", "month_end"].includes(method);
        const frequencyLabel =
          frequency === "monthly"
            ? "월 1회"
            : frequency === "quarterly"
              ? "분기 1회"
              : frequency === "weekly"
                ? "주 1회"
                : frequency || "주기";
        return {
          when: isPeriodic ? `${frequencyLabel} · 전체 기간` : method,
          action: "REBALANCE",
          target: isPeriodic
            ? cleanPortfolioWidgetText(step.target || "target_weights", 80)
            : Array.isArray(step.assets)
              ? step.assets.join(" / ")
              : cleanPortfolioWidgetText(step.target || "", 80),
          size: isPeriodic ? "" : step.threshold ? `${Number(step.threshold) * 100}%p` : "",
          note: cleanPortfolioWidgetText(step.note || step.reason || "", 120),
        };
      }
      if (["dca", "contribution", "cashflow", "deposit", "periodic_buy"].includes(op)) {
        return {
          when: cleanPortfolioWidgetText(step.frequency || step.cadence || step.interval || formatPortfolioFunctionEffectiveLabel(step.effective || step.start || step.startDate), 80),
          action: "DCA",
          target: formatPortfolioFunctionWeightsLabel(step.targetWeights) || "입력 포트폴리오",
          size: cleanPortfolioWidgetText(step.amount ?? step.contributionAmount ?? step.depositAmount ?? step.periodicAmount ?? step.monthlyAmount ?? "", 60),
          note: cleanPortfolioWidgetText(step.condition || step.if || step.note || step.reason || "", 120),
        };
      }
      if (op === "swap" || op === "portfolio_swap" || op === "allocation_event") {
        const hasPortfolioWeights = step.targetWeights && typeof step.targetWeights === "object";
        const eventType = cleanPortfolioWidgetText(step.eventType || step.event || step.kind || step.method || step.action || (op === "portfolio_swap" ? "portfolio_swap" : op === "swap" ? "swap" : hasPortfolioWeights ? "portfolio_swap" : ""), 40).toLowerCase();
        if (["portfolio_swap", "portfolio_allocation_swap", "allocation_swap", "target_weights"].includes(eventType)) {
          return {
            when: cleanPortfolioWidgetText(step.condition || step.when || step.if || formatPortfolioFunctionEffectiveLabel(step.effective || step.dateRule || step.date || step.effectiveDate), 140),
            action: "PORTFOLIO SWAP",
            target: [step.fromLabel || step.fromPortfolio || "A", step.toLabel || step.toPortfolioLabel || step.targetLabel || "B"]
              .map((item) => cleanPortfolioWidgetText(item, 40))
              .filter(Boolean)
              .join(" -> "),
            size: formatPortfolioFunctionWeightsLabel(step.targetWeights),
            note: cleanPortfolioWidgetText(step.note || step.reason || "", 120),
          };
        }
        if (eventType && eventType !== "swap") {
          return {
            when: `지원되지 않는 allocation_event: ${eventType}`,
            action: "EVENT",
            target: "",
            size: "",
            note: "",
          };
        }
        const fromAsset = cleanPortfolioWidgetText(step.fromAsset || step.from || step.sell || step.sourceAsset || "", 40).toUpperCase();
        const toAsset = cleanPortfolioWidgetText(step.toAsset || step.to || step.buy || step.targetAsset || "", 40).toUpperCase();
        return {
          when: formatPortfolioFunctionEffectiveLabel(step.effective || step.dateRule || step.when || step.date || step.effectiveDate),
          action: "SWAP",
          target: [fromAsset, toAsset].filter(Boolean).join(" -> "),
          size: cleanPortfolioWidgetText(step.weightPolicy || step.policy || "preserve_value", 60),
          note: cleanPortfolioWidgetText(step.note || step.reason || "", 120),
        };
      }
      if (op === "emit") return null;
      if (op === "rule") {
        const emit = step.emit && typeof step.emit === "object" ? step.emit : step;
        return {
          when: cleanPortfolioWidgetText(step.when || step.condition || step.if || `rule_${index + 1}`, 140),
          action: cleanPortfolioWidgetText(emit.field || emit.action || "EMIT", 32).toUpperCase(),
          target: cleanPortfolioWidgetText(emit.asset || emit.target || "", 60),
          size: cleanPortfolioWidgetText(emit.value ?? emit.size ?? emit.weight ?? "", 60),
          note: "",
        };
      }
      return {
        when: cleanPortfolioWidgetText(step.reason || "지원되지 않는 DSL 단계", 140),
        action: cleanPortfolioWidgetText(op || "OP", 32).toUpperCase(),
        target: "",
        size: "",
        note: "",
      };
    })
    .filter(Boolean);
}

function PortfolioWidgetFunctionSpec({ widget, widgets = [] }) {
  const spec = portfolioFunctionSpecForWidget(widget, widgets);
  const dataSources = filterPortfolioFunctionDataSources(
    spec,
    normalizePortfolioWidgetDataFiles(widget?.dataFiles, spec.dataSources)
  );
  const signalMatrix = widget?.signalMatrix && typeof widget.signalMatrix === "object" ? widget.signalMatrix : null;
  const programRows = portfolioFunctionProgramDisplayRows(spec.program);
  const rules = programRows.length
    ? programRows
    : spec.rules.length
      ? spec.rules
    : [{ when: "조건 대기", action: "signal", target: "", size: "", note: "매수/매도 조건이 들어오면 함수 규칙으로 표시됩니다." }];
  return (
    <div className="portfolio-widget-function" aria-label={`${widget?.title || "함수 위젯"} 규칙`}>
      <div className="portfolio-widget-function-meta">
        <span>{spec.language || "portfolio-matrix-dsl"}</span>
        <span>{spec.executionMode || "matrix-dsl"}</span>
        {spec.rebalance ? <span>{spec.rebalance}</span> : null}
      </div>
      {signalMatrix ? (
        <div className="portfolio-widget-function-meta">
          <span>{signalMatrix.role || "signal_matrix"}</span>
          <span>{signalMatrix.status || "pending"}</span>
          <span>{Number(signalMatrix.rowCount || signalMatrix.rows?.length || 0)}행</span>
        </div>
      ) : null}
      {dataSources.length ? (
        <div className="portfolio-widget-function-files" aria-label="함수 위젯 데이터 입력">
          {dataSources.slice(0, 3).map((file, index) => (
            <span key={`${widget?.id || "function"}-file-${index}-${file.id || file.name}`} title={[file.name, file.notes].filter(Boolean).join(" · ")}>
              <Paperclip size={11} strokeWidth={2.2} />
              <strong>{file.name}</strong>
              <em>{[file.role, portfolioWidgetDataFileStatusLabel(file.status), file.size ? formatWidgetFileSize(file.size) : ""].filter(Boolean).join(" · ")}</em>
            </span>
          ))}
        </div>
      ) : null}
      <ol>
        {rules.slice(0, 5).map((rule, index) => (
          <li key={`${widget?.id || "function"}-${index}-${rule.when}-${rule.action}`}>
            <strong>{rule.action}</strong>
            <span>{rule.when}</span>
            {rule.size || rule.target ? <em>{[rule.target, rule.size].filter(Boolean).join(" · ")}</em> : null}
          </li>
        ))}
      </ol>
      {spec.riskControls.length ? (
        <div className="portfolio-widget-function-guards">
          {spec.riskControls.slice(0, 3).map((item) => (
            <span key={`${widget?.id || "function"}-guard-${item}`}>{item}</span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function PortfolioWidgetMarkdown({ widget }) {
  const markdown = stripDuplicatePortfolioMarkdownTitle(
    stripPortfolioMarkdownEChartsFences(
      normalizePortfolioMarkdownText(
        widget?.markdown,
        widget?.markdownText,
        widget?.content,
        widget?.document,
        widget?.body,
        widget?.lastAgentAnswer,
        widget?.prompt
      )
    ),
    widget?.title
  );
  const charts = normalizePortfolioMarkdownECharts(
    widget?.echarts,
    widget?.eCharts,
    widget?.echartsOptions,
    widget?.echartsOption,
    widget?.markdown,
    widget?.markdownText,
    widget?.content,
    widget?.document,
    widget?.body,
    widget?.chartSpec?.echarts,
    widget?.chartSpec?.echartsOptions,
    widget?.chartSpec?.echartsOption,
    widget?.chartSpec?.option,
    widget?.chartSpec
  );
  return (
    <div className="portfolio-widget-markdown">
      {markdown ? (
        <MarkdownText text={markdown} splitSingleLineParagraphs />
      ) : (
        <div className="portfolio-widget-table-empty">
          <strong>마크다운 본문 대기</strong>
          <span>markdown 문자열이 들어오면 문서 스타일로 표시됩니다.</span>
        </div>
      )}
      {charts.length ? (
        <div className="portfolio-widget-markdown-charts" aria-label={`${widget?.title || "마크다운 위젯"} ECharts`}>
          {charts.map((chart, index) => (
            <figure className="portfolio-widget-markdown-chart" key={`${widget?.id || "markdown"}-chart-${chart.id || index}`}>
              {chart.title ? <figcaption>{chart.title}</figcaption> : null}
              {chart.body ? <p>{chart.body}</p> : null}
              <React.Suspense fallback={<div className="portfolio-widget-markdown-chart-loading">차트 로딩</div>}>
                <PortfolioMarkdownEChart chart={chart} widgetTitle={widget?.title} />
              </React.Suspense>
            </figure>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function PortfolioWidgetProducedContent({ widget, widgets = [] }) {
  const type = normalizePortfolioWidgetVisualType(widget?.visualType);
  const hasBacktestResultSeries =
    widget?.outputRole === "backtest_result" &&
    Array.isArray(widget?.chartSpec?.series) &&
    widget.chartSpec.series.length > 0;
  const renderType = hasBacktestResultSeries ? "line" : type;
  const checklistItems = [...(widget?.checks || []), ...(widget?.requirements || [])].slice(0, 4);
  if (renderType === "function") {
    return (
      <div className="portfolio-widget-produced is-function-only">
        <PortfolioWidgetFunctionSpec widget={widget} widgets={widgets} />
      </div>
    );
  }
  if (renderType === "metrics-table") {
    return (
      <div className="portfolio-widget-produced is-metrics-table-only">
        <PortfolioWidgetMetricsTable widget={widget} widgets={widgets} />
      </div>
    );
  }
  if (renderType === "markdown") {
    return (
      <div className="portfolio-widget-produced is-markdown-only">
        <PortfolioWidgetMarkdown widget={widget} />
      </div>
    );
  }
  if (renderType === "table") {
    if (portfolioWidgetIsBacktestSetupTable(widget)) {
      return (
        <div className="portfolio-widget-produced is-backtest-setup-only">
          <PortfolioWidgetBacktestSetupTable widget={widget} widgets={widgets} />
        </div>
      );
    }
    return (
      <div className="portfolio-widget-produced is-table-only">
        <PortfolioWidgetTable widget={widget} />
      </div>
    );
  }
  if (["allocation", "line", "price-history", "position-status", "seasonal-comparison"].includes(renderType)) {
    const chartWidget = renderType === type ? widget : { ...widget, visualType: renderType };
    return (
      <div className="portfolio-widget-produced is-visual-only">
        <React.Suspense fallback={<PortfolioWidgetMiniPreview widget={widget} />}>
          <PortfolioWidgetChart widget={chartWidget} />
        </React.Suspense>
      </div>
    );
  }
  if (renderType === "checklist") {
    return (
      <div className="portfolio-widget-produced is-checklist-only">
        <ul className="portfolio-widget-check-items" aria-label="위젯 체크리스트">
          {(checklistItems.length ? checklistItems : [widget?.agentSummary || "확인 항목을 생성 중입니다."]).map((item) => (
            <li key={`check-${widget.id}-${item}`}>{item}</li>
          ))}
        </ul>
      </div>
    );
  }
  return (
    <div className="portfolio-widget-produced is-memo-only">
      <p>{widget?.agentSummary || widget?.prompt || "설명 위젯 초안이 생성되었습니다."}</p>
    </div>
  );
}
