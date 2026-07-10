import React, { useEffect, useMemo, useRef, useState } from "react";
import { ColorType, LineSeries, TickMarkType, createChart } from "lightweight-charts";
import {
  indexedPortfolioAssetSeries,
  loadPortfolioAssetComparisonData,
  normalizePortfolioAssetComparisonQuery,
} from "./portfolioAssetComparisonData.js";

const COMPARISON_COLORS = ["#2f80ed", "#e67e22", "#8e44ad", "#c0392b", "#16a085"];
const PORTFOLIO_LINE_COLOR = "#176957";

function dateParts(time) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(time || ""));
  return match ? { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) } : null;
}

function formatDate(time, shortYear = true) {
  const parts = dateParts(time);
  if (!parts) return String(time || "");
  const year = shortYear ? String(parts.year).slice(-2) : String(parts.year);
  return `${year}년 ${parts.month}월 ${parts.day}일`;
}

function tickFormatter(time, tickMarkType) {
  const parts = dateParts(time);
  if (!parts) return null;
  if (tickMarkType === TickMarkType.Year) return `${String(parts.year).slice(-2)}년`;
  if (tickMarkType === TickMarkType.Month) return `${String(parts.year).slice(-2)}년 ${parts.month}월`;
  if (tickMarkType === TickMarkType.DayOfMonth) return `${parts.month}월 ${parts.day}일`;
  return formatDate(time);
}

function comparisonRangeLabel(query, portfolioPayload) {
  const points = Array.isArray(portfolioPayload?.points) ? portfolioPayload.points : [];
  const start = query.startDate || points[0]?.time || "";
  const end = query.endDate || portfolioPayload?.timelineEndDate || points.at(-1)?.time || "";
  return `${formatDate(start, false) || "첫 거래일"} ~ ${formatDate(end, false) || "최신"}`;
}

export default function PortfolioAssetComparisonChart({ widget, onWidgetDisplayData }) {
  const containerRef = useRef(null);
  const chartSpec = widget?.chartSpec && typeof widget.chartSpec === "object" ? widget.chartSpec : {};
  const query = useMemo(() => normalizePortfolioAssetComparisonQuery(chartSpec), [chartSpec]);
  const [portfolioPayload, setPortfolioPayload] = useState(null);
  const [assetSeries, setAssetSeries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [partialError, setPartialError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    setPartialError("");
    async function loadComparison() {
      const result = await loadPortfolioAssetComparisonData(query, controller.signal);
      if (controller.signal.aborted) return;
      setPortfolioPayload(result.portfolioPayload);
      setAssetSeries(result.assetSeries);
      if (result.failedAssetCount) setPartialError(`${result.failedAssetCount}개 종목의 시세를 표시하지 못했습니다.`);
    }
    loadComparison()
      .catch((fetchError) => {
        if (!controller.signal.aborted) setError(fetchError.message || "비교 차트 데이터를 불러오지 못했습니다.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [query]);

  const portfolioData = useMemo(() => indexedPortfolioAssetSeries(portfolioPayload?.points), [portfolioPayload]);
  const comparisonLines = useMemo(
    () => assetSeries.map((series, index) => ({
      ...series,
      color: COMPARISON_COLORS[index % COMPARISON_COLORS.length],
      data: indexedPortfolioAssetSeries(series.rows),
    })).filter((series) => series.data.length),
    [assetSeries]
  );
  const displayData = useMemo(() => ({
    schemaVersion: "portfolio-widget-display-data.v1",
    kind: "asset-price-comparison",
    query,
    summary: {
      status: loading ? "loading" : error ? "error" : portfolioData.length ? "ready" : "empty",
      error,
      partialError,
      dataProvider: portfolioPayload?.dataProvider || "토스 증권 Open API",
      unit: portfolioPayload?.unit || query.currency,
      portfolioPointCount: portfolioData.length,
      comparisonSeriesCount: comparisonLines.length,
      comparisonSymbols: comparisonLines.map((line) => line.asset?.symbol).filter(Boolean),
      startTime: portfolioData[0]?.time || "",
      endTime: portfolioData.at(-1)?.time || portfolioPayload?.timelineEndDate || "",
    },
    data: {
      displayedSeries: [
        { name: "보유자산", points: portfolioData },
        ...comparisonLines.map((line) => ({
          name: line.asset?.symbol || line.asset?.name || "비교 자산",
          asset: line.asset,
          points: line.data,
        })),
      ],
      portfolioRawPoints: Array.isArray(portfolioPayload?.points) ? portfolioPayload.points : [],
      comparisonRawSeries: assetSeries.map((series) => ({ asset: series.asset, rows: series.rows })),
    },
  }), [assetSeries, comparisonLines, error, loading, partialError, portfolioData, portfolioPayload, query]);

  useEffect(() => {
    onWidgetDisplayData?.(widget?.id, displayData);
  }, [displayData, onWidgetDisplayData, widget?.id]);

  useEffect(() => {
    const node = containerRef.current;
    if (!node || !portfolioData.length || loading || error) return undefined;
    const chart = createChart(node, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "#ffffff" },
        textColor: "#52635d",
        fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
      },
      grid: {
        vertLines: { color: "rgba(129, 148, 141, 0.14)" },
        horzLines: { color: "rgba(129, 148, 141, 0.14)" },
      },
      localization: {
        priceFormatter: (value) => `${Number(value).toFixed(1)}`,
        timeFormatter: (time) => formatDate(time),
        dateFormat: "yy년 MM월 dd일",
        locale: "ko-KR",
      },
      rightPriceScale: {
        borderColor: "rgba(129, 148, 141, 0.22)",
        scaleMargins: { top: 0.12, bottom: 0.12 },
      },
      timeScale: {
        borderColor: "rgba(129, 148, 141, 0.22)",
        timeVisible: false,
        secondsVisible: false,
        tickMarkFormatter: tickFormatter,
      },
      crosshair: { mode: 1 },
    });
    const portfolioSeries = chart.addSeries(LineSeries, {
      title: "보유자산",
      color: PORTFOLIO_LINE_COLOR,
      lineWidth: 4,
      priceLineVisible: false,
      lastValueVisible: true,
    });
    portfolioSeries.setData(portfolioData);
    for (const line of comparisonLines) {
      const series = chart.addSeries(LineSeries, {
        title: line.asset.symbol,
        color: line.color,
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: true,
      });
      series.setData(line.data);
    }
    chart.timeScale().fitContent();
    return () => chart.remove();
  }, [comparisonLines, error, loading, portfolioData]);

  const hasData = portfolioData.length > 0;
  return (
    <div className="portfolio-asset-price-chart portfolio-asset-comparison-chart" aria-label={`${widget?.title || "보유 자산 과거 내역"} 비교 라인차트`}>
      <div className="portfolio-asset-price-chart-meta">
        <span>{portfolioPayload?.dataProvider || "토스 증권 Open API"}</span>
        <span>수익률 지수 · 시작점 100</span>
        <span>{query.timeframe}</span>
        <strong>{comparisonLines.length + 1}개 라인</strong>
      </div>
      <div className="portfolio-asset-price-chart-range">{comparisonRangeLabel(query, portfolioPayload)}</div>
      <div className="portfolio-asset-comparison-legend" aria-label="비교 차트 범례">
        <span className="is-portfolio"><i style={{ backgroundColor: PORTFOLIO_LINE_COLOR }} />보유자산</span>
        {comparisonLines.map((line) => (
          <span key={`comparison-legend-${line.asset.symbol}`} title={line.asset.name}>
            <i style={{ backgroundColor: line.color }} />{line.asset.symbol}
          </span>
        ))}
      </div>
      <div className="portfolio-asset-price-chart-frame">
        {loading ? <div className="portfolio-asset-price-chart-state">비교 차트 데이터 로딩</div> : null}
        {!loading && error ? <div className="portfolio-asset-price-chart-state is-error">{error}</div> : null}
        {!loading && !error && !hasData ? (
          <div className="portfolio-asset-price-chart-state">선택한 기간의 보유자산 데이터가 없습니다.</div>
        ) : null}
        <div className={hasData && !loading && !error ? "portfolio-asset-price-chart-canvas" : "portfolio-asset-price-chart-canvas is-hidden"} ref={containerRef} />
      </div>
      <div className="portfolio-asset-price-chart-credit">
        <span>{partialError || "보유자산은 굵게 · 비교 자산은 얇게 표시"}</span>
        <a href="https://www.tradingview.com/" target="_blank" rel="noreferrer">Lightweight Charts™</a>
      </div>
    </div>
  );
}
