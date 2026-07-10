import React, { useEffect, useMemo, useState } from "react";
import { formatPortfolioMetricCell } from "./widgetMetrics.js";
import { portfolioWidgetDependencyIds } from "./widgetRelations.js";
import {
  loadPortfolioAssetComparisonData,
  normalizePortfolioAssetComparisonQuery,
} from "./portfolioAssetComparisonData.js";
import {
  buildPortfolioAssetMetricRows,
  portfolioAssetBetaBenchmark,
  portfolioAssetEvaluationMetricColumns,
} from "./portfolioAssetMetrics.js";

function sourceWidgetForEvaluation(widget, widgets = []) {
  const references = [
    widget?.chartSpec?.sourceWidgetId,
    ...portfolioWidgetDependencyIds(widget),
  ].filter(Boolean);
  return references
    .map((id) => widgets.find((candidate) => candidate?.id === id || candidate?.displayId === id))
    .find(Boolean) || null;
}

export function PortfolioAssetEvaluationTable({ widget, widgets = [], onWidgetDisplayData }) {
  const sourceWidget = sourceWidgetForEvaluation(widget, widgets);
  const sourceWidgetId = sourceWidget?.id || "";
  const sourceChartSpec = sourceWidget?.chartSpec;
  const query = useMemo(
    () => normalizePortfolioAssetComparisonQuery(sourceChartSpec || {}),
    [sourceChartSpec]
  );
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(Boolean(sourceWidget));
  const [error, setError] = useState("");
  const betaBenchmark = portfolioAssetBetaBenchmark(widget?.chartSpec?.betaBenchmark);

  useEffect(() => {
    if (!sourceWidgetId) {
      setData(null);
      setLoading(false);
      return undefined;
    }
    const controller = new AbortController();
    setLoading(true);
    setError("");
    loadPortfolioAssetComparisonData(query, controller.signal, { betaBenchmark })
      .then((result) => {
        if (!controller.signal.aborted) setData(result);
      })
      .catch((fetchError) => {
        if (!controller.signal.aborted) setError(fetchError.message || "평가 데이터를 불러오지 못했습니다.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [betaBenchmark.id, query, sourceWidgetId]);

  const rows = useMemo(
    () => buildPortfolioAssetMetricRows({
      portfolioRows: data?.portfolioPayload?.points,
      assetSeries: data?.assetSeries,
      timeframe: query.timeframe,
      benchmarkRows: data?.betaBenchmarkSeries?.rows,
      benchmarkLabel: betaBenchmark.label,
    }),
    [betaBenchmark.label, data, query.timeframe]
  );
  const displayData = useMemo(() => ({
    schemaVersion: "portfolio-widget-display-data.v1",
    kind: "asset-evaluation-table",
    query: {
      ...query,
      betaBenchmark: betaBenchmark.id,
    },
    summary: {
      status: loading ? "loading" : error ? "error" : rows.length ? "ready" : "empty",
      error,
      rowCount: rows.length,
      metricColumns: portfolioAssetEvaluationMetricColumns.map((column) => ({ key: column.key, label: column.label })),
      betaBenchmark: betaBenchmark.label,
      failedAssetCount: Number(data?.failedAssetCount || 0),
      betaBenchmarkFailed: Boolean(data?.betaBenchmarkFailed),
    },
    data: {
      rows,
    },
  }), [betaBenchmark.id, betaBenchmark.label, data, error, loading, query, rows]);

  useEffect(() => {
    onWidgetDisplayData?.(widget?.id, displayData);
  }, [displayData, onWidgetDisplayData, widget?.id]);

  if (!sourceWidget) {
    return (
      <div className="portfolio-widget-table-empty">
        <strong>원본 위젯 연결 필요</strong>
        <span>보유 자산 과거 내역 위젯에서 평가 테이블을 다시 열어주세요.</span>
      </div>
    );
  }
  if (loading) {
    return <div className="portfolio-widget-table-empty"><strong>포트폴리오 지표 계산 중</strong><span>선택한 기간과 비교 자산을 같은 주기로 평가하고 있습니다.</span></div>;
  }
  if (error) {
    return <div className="portfolio-widget-table-empty is-error"><strong>평가 테이블 생성 실패</strong><span>{error}</span></div>;
  }
  if (!rows.length) {
    return <div className="portfolio-widget-table-empty"><strong>평가할 데이터 없음</strong><span>선택한 기간의 보유자산 시리즈를 확인해 주세요.</span></div>;
  }
  return (
    <div className="portfolio-asset-evaluation-table">
      <div className="portfolio-asset-evaluation-meta">
        <span>{query.timeframe}</span>
        <span>{rows.length}개 자산</span>
        <strong>평가액·종가 흐름 기준</strong>
        <strong>BETA 기준 {betaBenchmark.label}</strong>
        {data?.failedAssetCount ? <em>{data.failedAssetCount}개 시세 누락</em> : null}
        {data?.betaBenchmarkFailed ? <em>BETA 기준 시세 누락</em> : null}
      </div>
      <div className="portfolio-widget-metrics-table-wrap">
        <table className="portfolio-widget-metrics-table" aria-label={`${widget?.title || "포트폴리오 평가 테이블"} 자산별 평가`}>
          <thead>
            <tr>
              {portfolioAssetEvaluationMetricColumns.map((column) => <th scope="col" key={column.key}>{column.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr key={`${widget?.id || "asset-evaluation"}-${row.name}-${rowIndex}`}>
                {portfolioAssetEvaluationMetricColumns.map((column) => (
                  <td key={`${row.name}-${column.key}`}>{formatPortfolioMetricCell(row, column.key)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
