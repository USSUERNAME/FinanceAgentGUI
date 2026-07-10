import React, { useEffect, useMemo, useRef, useState } from "react";
import { AreaSeries, ColorType, TickMarkType, createChart } from "lightweight-charts";
import PortfolioAssetComparisonChart from "./PortfolioAssetComparisonChart.jsx";

function normalizeHistoryQuery(chartSpec = {}) {
  const query = chartSpec?.query && typeof chartSpec.query === "object" ? chartSpec.query : {};
  const currency = String(query.currency || chartSpec.currency || chartSpec.valueCurrency || "KRW").toUpperCase() === "USD" ? "USD" : "KRW";
  return {
    startDate: String(query.startDate || chartSpec.startDate || "").trim(),
    endDate: String(query.endDate || chartSpec.endDate || "").trim(),
    timeframe: String(query.timeframe || chartSpec.timeframe || "1d").trim() || "1d",
    currency,
  };
}

function historyQueryUrl(query) {
  const params = new URLSearchParams();
  params.set("timeframe", query.timeframe || "1d");
  params.set("currency", query.currency || "KRW");
  if (query.startDate) params.set("startDate", query.startDate);
  if (query.endDate) params.set("endDate", query.endDate);
  return `/api/tossinvest/order-sync/investment-history?${params.toString()}`;
}

function formatHistoryValue(value, unit = "") {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) return "-";
  if (unit === "KRW") {
    return `₩${Math.round(number).toLocaleString("ko-KR")}`;
  }
  if (unit === "USD") {
    return `$${number.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
  }
  return number.toLocaleString("ko-KR", { maximumFractionDigits: 2 });
}

function historyDatePartsFromTime(time) {
  if (typeof time === "string") {
    const match = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(time.trim());
    if (match) {
      return {
        year: Number(match[1]),
        month: Number(match[2]),
        day: Number(match[3]),
      };
    }
  }
  if (time && typeof time === "object") {
    const year = Number(time.year);
    const month = Number(time.month);
    const day = Number(time.day);
    if (Number.isFinite(year) && Number.isFinite(month) && Number.isFinite(day)) {
      return { year, month, day };
    }
  }
  if (typeof time === "number" && Number.isFinite(time)) {
    const date = new Date(time * (time > 10_000_000_000 ? 1 : 1000));
    if (!Number.isNaN(date.getTime())) {
      return {
        year: date.getUTCFullYear(),
        month: date.getUTCMonth() + 1,
        day: date.getUTCDate(),
      };
    }
  }
  return null;
}

function formatHistoryYear(year, style = "full") {
  return style === "short" ? String(year).slice(-2).padStart(2, "0") : String(year);
}

function formatHistoryDateLabel(time, { yearStyle = "short", includeDay = true } = {}) {
  const parts = historyDatePartsFromTime(time);
  if (!parts) return "";
  const year = `${formatHistoryYear(parts.year, yearStyle)}년`;
  const month = `${parts.month}월`;
  const day = `${parts.day}일`;
  return includeDay ? `${year} ${month} ${day}` : `${year} ${month}`;
}

function formatHistoryTickMark(time, tickMarkType) {
  const parts = historyDatePartsFromTime(time);
  if (!parts) return null;
  if (tickMarkType === TickMarkType.Year) return `${formatHistoryYear(parts.year, "short")}년`;
  if (tickMarkType === TickMarkType.Month) return `${formatHistoryYear(parts.year, "short")}년 ${parts.month}월`;
  if (tickMarkType === TickMarkType.DayOfMonth) return `${parts.month}월 ${parts.day}일`;
  return formatHistoryDateLabel(time, { yearStyle: "short" });
}

function formatHistoryCrosshairDate(time) {
  return formatHistoryDateLabel(time, { yearStyle: "short" }) || String(time || "");
}

function rangeLabel(query, payload) {
  const points = Array.isArray(payload?.points) ? payload.points : [];
  const start = query.startDate || points[0]?.time || "";
  const end = query.endDate || payload?.timelineEndDate || points[points.length - 1]?.time || "";
  const startLabel = formatHistoryDateLabel(start, { yearStyle: "full" }) || start || "첫 거래일";
  const endLabel = formatHistoryDateLabel(end, { yearStyle: "full" }) || end || "최신";
  return [startLabel, endLabel].join(" ~ ");
}

function normalizeChartData(points = []) {
  const byTime = new Map();
  for (const point of Array.isArray(points) ? points : []) {
    const time = String(point?.time || "").trim();
    const value = Number(point?.value || 0);
    if (!time || !Number.isFinite(value)) continue;
    byTime.set(time, { time, value });
  }
  return [...byTime.values()].sort((left, right) => left.time.localeCompare(right.time));
}

export default function PortfolioAssetPriceHistoryChart({ widget, onWidgetDisplayData }) {
  const comparisonAssets = widget?.chartSpec?.query?.comparisonAssets;
  if (Array.isArray(comparisonAssets) && comparisonAssets.length) {
    return <PortfolioAssetComparisonChart widget={widget} onWidgetDisplayData={onWidgetDisplayData} />;
  }
  return <PortfolioAssetPriceHistoryAreaChart widget={widget} onWidgetDisplayData={onWidgetDisplayData} />;
}

function PortfolioAssetPriceHistoryAreaChart({ widget, onWidgetDisplayData }) {
  const containerRef = useRef(null);
  const chartRef = useRef(null);
  const seriesRef = useRef(null);
  const resizeObserverRef = useRef(null);
  const hasFitContentRef = useRef(false);
  const previousRangeKeyRef = useRef("");
  const chartSpec = widget?.chartSpec && typeof widget.chartSpec === "object" ? widget.chartSpec : {};
  const query = useMemo(() => normalizeHistoryQuery(chartSpec), [chartSpec]);
  const rangeKey = `${query.startDate}|${query.endDate}|${query.timeframe}`;
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const metricLabel = payload?.metricLabel || "투자 원금";
  const valueLabel = payload?.valueLabel || `${query.currency === "USD" ? "달러" : "원화"} ${metricLabel}`;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    fetch(historyQueryUrl(query), { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok || body?.ok === false) {
          throw new Error(body?.error || `HTTP ${response.status}`);
        }
        if (!cancelled) setPayload(body);
      })
      .catch((fetchError) => {
        if (!cancelled) setError(fetchError.message || "차트 데이터를 불러오지 못했습니다.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [query]);

  const chartData = useMemo(() => normalizeChartData(payload?.points), [payload]);
  const displayData = useMemo(() => ({
    schemaVersion: "portfolio-widget-display-data.v1",
    kind: "asset-price-history",
    query,
    summary: {
      status: loading ? "loading" : error ? "error" : chartData.length ? "ready" : "empty",
      error,
      dataProvider: payload?.dataProvider || "토스 증권 Open API",
      source: payload?.source || "position-reconstruction",
      metricLabel,
      valueLabel,
      unit: payload?.unit || query.currency,
      pointCount: chartData.length,
      startTime: chartData[0]?.time || "",
      endTime: chartData.at(-1)?.time || payload?.timelineEndDate || "",
      latestValue: chartData.at(-1)?.value,
    },
    data: {
      points: chartData,
    },
  }), [chartData, error, loading, metricLabel, payload, query, valueLabel]);

  useEffect(() => {
    onWidgetDisplayData?.(widget?.id, displayData);
  }, [displayData, onWidgetDisplayData, widget?.id]);

  useEffect(() => {
    const node = containerRef.current;
    if (!node || !chartData.length) return undefined;
    const unit = payload?.unit || "";
    let chart = chartRef.current;
    let areaSeries = seriesRef.current;
    const visibleLogicalRange = chart?.timeScale?.().getVisibleLogicalRange?.() || null;
    const rangeChanged = Boolean(previousRangeKeyRef.current && previousRangeKeyRef.current !== rangeKey);

    if (!chart) {
      chart = createChart(node, {
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
          priceFormatter: (price) => formatHistoryValue(price, unit),
          timeFormatter: formatHistoryCrosshairDate,
          dateFormat: "yy년 MM월 dd일",
          locale: "ko-KR",
        },
        rightPriceScale: {
          borderColor: "rgba(129, 148, 141, 0.22)",
          scaleMargins: { top: 0.16, bottom: 0.12 },
        },
        timeScale: {
          borderColor: "rgba(129, 148, 141, 0.22)",
          timeVisible: false,
          secondsVisible: false,
          tickMarkFormatter: formatHistoryTickMark,
        },
        crosshair: {
          mode: 1,
        },
      });
      areaSeries = chart.addSeries(AreaSeries, {
        title: metricLabel,
        lineColor: "#237a68",
        topColor: "rgba(35, 122, 104, 0.28)",
        bottomColor: "rgba(35, 122, 104, 0.03)",
        lineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: true,
      });
      chartRef.current = chart;
      seriesRef.current = areaSeries;
      if (typeof ResizeObserver !== "undefined") {
        resizeObserverRef.current = new ResizeObserver(() => {
          const range = chart.timeScale().getVisibleLogicalRange?.() || null;
          if (range) {
            chart.timeScale().setVisibleLogicalRange(range);
          }
        });
        resizeObserverRef.current.observe(node);
      }
    } else {
      chart.applyOptions({
        localization: {
          priceFormatter: (price) => formatHistoryValue(price, unit),
          timeFormatter: formatHistoryCrosshairDate,
          dateFormat: "yy년 MM월 dd일",
          locale: "ko-KR",
        },
        timeScale: {
          tickMarkFormatter: formatHistoryTickMark,
        },
      });
      areaSeries.applyOptions({
        title: metricLabel,
      });
    }

    areaSeries.setData(chartData);
    if (!hasFitContentRef.current || rangeChanged) {
      chart.timeScale().fitContent();
      hasFitContentRef.current = true;
    } else if (visibleLogicalRange) {
      chart.timeScale().setVisibleLogicalRange(visibleLogicalRange);
    }
    previousRangeKeyRef.current = rangeKey;

    return undefined;
  }, [chartData, metricLabel, payload?.unit, rangeKey]);

  useEffect(
    () => () => {
      if (resizeObserverRef.current) {
        resizeObserverRef.current.disconnect();
        resizeObserverRef.current = null;
      }
      if (chartRef.current) {
        chartRef.current.remove();
        chartRef.current = null;
      }
      seriesRef.current = null;
      hasFitContentRef.current = false;
      previousRangeKeyRef.current = "";
    },
    []
  );

  const latestPoint = chartData[chartData.length - 1] || null;
  const unit = payload?.unit || "KRW";

  return (
    <div className="portfolio-asset-price-chart" aria-label={`${widget?.title || "보유 자산 과거 내역"} Lightweight Charts`}>
      <div className="portfolio-asset-price-chart-meta">
        <span>{payload?.dataProvider || "토스 증권 Open API"}</span>
        <span title={payload?.metricDescription || ""}>{valueLabel}</span>
        <span>{query.timeframe}</span>
        <strong>{latestPoint ? formatHistoryValue(latestPoint.value, unit) : "데이터 대기"}</strong>
      </div>
      <div className="portfolio-asset-price-chart-range">{rangeLabel(query, payload)}</div>
      <div className="portfolio-asset-price-chart-frame">
        {loading ? <div className="portfolio-asset-price-chart-state">차트 데이터 로딩</div> : null}
        {!loading && error ? <div className="portfolio-asset-price-chart-state is-error">{error}</div> : null}
        {!loading && !error && !chartData.length ? (
          <div className="portfolio-asset-price-chart-state">선택한 기간의 투자 원금 스냅샷이 없습니다.</div>
        ) : null}
        <div
          className={chartData.length && !loading && !error ? "portfolio-asset-price-chart-canvas" : "portfolio-asset-price-chart-canvas is-hidden"}
          ref={containerRef}
        />
      </div>
      <div className="portfolio-asset-price-chart-credit">
        <span>{[payload?.source || "position-reconstruction", metricLabel].filter(Boolean).join(" · ")}</span>
        <a href="https://www.tradingview.com/" target="_blank" rel="noreferrer">
          Lightweight Charts™
        </a>
      </div>
    </div>
  );
}
