import React, { useEffect, useMemo, useRef, useState } from "react";
import { ColorType, LineSeries, TickMarkType, createChart } from "lightweight-charts";

const SEASONAL_ANCHOR_YEAR = 2000;
const SEASONAL_SERIES_COLORS = [
  "#1f6f8b",
  "#9a5a12",
  "#7c3aed",
  "#0f8f68",
  "#c24172",
  "#4f6f1f",
  "#aa5c00",
  "#0b7285",
  "#8b5cf6",
  "#4d7c0f",
];

function normalizeSeasonalQuery(chartSpec = {}) {
  const query = chartSpec?.query && typeof chartSpec.query === "object" ? chartSpec.query : {};
  const currency = String(query.currency || chartSpec.currency || chartSpec.valueCurrency || "KRW").toUpperCase() === "USD" ? "USD" : "KRW";
  return {
    startDate: String(query.startDate || chartSpec.startDate || "").trim(),
    endDate: String(query.endDate || chartSpec.endDate || "").trim(),
    timeframe: "1d",
    currency,
  };
}

function seasonalQueryUrl(query) {
  const params = new URLSearchParams();
  params.set("timeframe", "1d");
  params.set("currency", query.currency || "KRW");
  if (query.startDate) params.set("startDate", query.startDate);
  if (query.endDate) params.set("endDate", query.endDate);
  return `/api/tossinvest/order-sync/investment-history?${params.toString()}`;
}

function dateParts(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || "").trim());
  if (!match) return null;
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
}

function seasonalTime(value) {
  const parts = dateParts(value);
  if (!parts) return "";
  return `${SEASONAL_ANCHOR_YEAR}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function formatSeasonalDate(time) {
  const parts = dateParts(time);
  if (!parts) return String(time || "");
  return `${parts.month}월 ${parts.day}일`;
}

function formatSeasonalTickMark(time, tickMarkType) {
  const parts = dateParts(time);
  if (!parts) return null;
  if (tickMarkType === TickMarkType.Month) return `${parts.month}월`;
  if (tickMarkType === TickMarkType.DayOfMonth) return `${parts.month}월 ${parts.day}일`;
  return `${parts.month}월`;
}

function formatSeasonalReturn(value, digits = 1) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "-";
  const sign = number > 0 ? "+" : "";
  return `${sign}${number.toLocaleString("ko-KR", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}%`;
}

function normalizeHistoryPoints(points = []) {
  const byTime = new Map();
  for (const point of Array.isArray(points) ? points : []) {
    const time = String(point?.time || "").trim();
    const value = Number(point?.value);
    if (!time || !Number.isFinite(value) || value <= 0) continue;
    byTime.set(time, { time, value });
  }
  return [...byTime.values()].sort((left, right) => left.time.localeCompare(right.time));
}

function buildSeasonalSeries(points = []) {
  const grouped = new Map();
  for (const point of points) {
    const parts = dateParts(point.time);
    if (!parts?.year) continue;
    if (!grouped.has(parts.year)) grouped.set(parts.year, []);
    grouped.get(parts.year).push(point);
  }

  const years = [...grouped.keys()].sort((left, right) => left - right);
  const latestYear = years[years.length - 1] || 0;
  return years
    .map((year, index) => {
      const rows = grouped.get(year) || [];
      const base = rows.find((row) => Number(row.value) > 0);
      if (!base) return null;
      const baseValue = Number(base.value);
      const dataByTime = new Map();
      for (const row of rows) {
        if (row.time < base.time) continue;
        const overlayTime = seasonalTime(row.time);
        if (!overlayTime) continue;
        dataByTime.set(overlayTime, {
          time: overlayTime,
          value: ((Number(row.value) / baseValue) - 1) * 100,
        });
      }
      const data = [...dataByTime.values()].sort((left, right) => left.time.localeCompare(right.time));
      if (!data.length) return null;
      return {
        year,
        color: SEASONAL_SERIES_COLORS[index % SEASONAL_SERIES_COLORS.length],
        data,
        baseDate: base.time,
        endDate: rows[rows.length - 1]?.time || "",
        finalReturn: data[data.length - 1]?.value ?? 0,
        isLatest: year === latestYear,
      };
    })
    .filter(Boolean);
}

function rangeLabel(payload, seriesModels) {
  const first = seriesModels[0]?.baseDate || payload?.startDate || "";
  const latest = payload?.timelineEndDate || seriesModels[seriesModels.length - 1]?.endDate || "";
  return [first || "첫 거래일", latest || "최신"].join(" ~ ");
}

export default function PortfolioSeasonalComparisonChart({ widget, onWidgetDisplayData }) {
  const containerRef = useRef(null);
  const chartRef = useRef(null);
  const seriesRefs = useRef(new Map());
  const resizeObserverRef = useRef(null);
  const hasFitContentRef = useRef(false);
  const chartSpec = widget?.chartSpec && typeof widget.chartSpec === "object" ? widget.chartSpec : {};
  const query = useMemo(() => normalizeSeasonalQuery(chartSpec), [chartSpec]);
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [hiddenYears, setHiddenYears] = useState({});

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    fetch(seasonalQueryUrl(query), { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok || body?.ok === false) {
          throw new Error(body?.error || `HTTP ${response.status}`);
        }
        if (!cancelled) setPayload(body);
      })
      .catch((fetchError) => {
        if (!cancelled) setError(fetchError.message || "시즌별 비교 데이터를 불러오지 못했습니다.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [query]);

  const historyPoints = useMemo(() => normalizeHistoryPoints(payload?.points), [payload]);
  const seriesModels = useMemo(() => buildSeasonalSeries(historyPoints), [historyPoints]);
  const yearsKey = seriesModels.map((model) => model.year).join("|");

  useEffect(() => {
    setHiddenYears((current) => {
      const allowed = new Set(seriesModels.map((model) => String(model.year)));
      const next = Object.fromEntries(Object.entries(current).filter(([year]) => allowed.has(year)));
      return JSON.stringify(next) === JSON.stringify(current) ? current : next;
    });
  }, [yearsKey, seriesModels]);

  useEffect(() => {
    const node = containerRef.current;
    if (!node || !seriesModels.length) return undefined;
    let chart = chartRef.current;
    if (!chart) {
      chart = createChart(node, {
        autoSize: true,
        layout: {
          background: { type: ColorType.Solid, color: "#ffffff" },
          textColor: "#52635d",
          fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
        },
        grid: {
          vertLines: { color: "rgba(129, 148, 141, 0.12)" },
          horzLines: { color: "rgba(129, 148, 141, 0.14)" },
        },
        localization: {
          priceFormatter: (price) => formatSeasonalReturn(price, 1),
          timeFormatter: formatSeasonalDate,
          dateFormat: "MM월 dd일",
          locale: "ko-KR",
        },
        rightPriceScale: {
          borderColor: "rgba(129, 148, 141, 0.22)",
          scaleMargins: { top: 0.16, bottom: 0.16 },
        },
        timeScale: {
          borderColor: "rgba(129, 148, 141, 0.22)",
          timeVisible: false,
          secondsVisible: false,
          tickMarkFormatter: formatSeasonalTickMark,
        },
        crosshair: {
          mode: 1,
        },
      });
      chartRef.current = chart;
      if (typeof ResizeObserver !== "undefined") {
        resizeObserverRef.current = new ResizeObserver(() => {
          const range = chart.timeScale().getVisibleLogicalRange?.() || null;
          if (range) chart.timeScale().setVisibleLogicalRange(range);
        });
        resizeObserverRef.current.observe(node);
      }
    }

    const refs = seriesRefs.current;
    const activeYears = new Set(seriesModels.map((model) => String(model.year)));
    for (const [year, series] of refs.entries()) {
      if (!activeYears.has(year)) {
        chart.removeSeries(series);
        refs.delete(year);
      }
    }

    for (const model of seriesModels) {
      const year = String(model.year);
      const hidden = hiddenYears[year] === true;
      let series = refs.get(year);
      if (!series) {
        series = chart.addSeries(LineSeries, {
          priceLineVisible: false,
          lastValueVisible: model.isLatest,
        });
        refs.set(year, series);
      }
      series.applyOptions({
        title: `${model.year}년`,
        color: model.color,
        lineWidth: model.isLatest ? 4 : 1,
        lastValueVisible: model.isLatest && !hidden,
        priceLineVisible: false,
      });
      series.setData(hidden ? [] : model.data);
    }

    if (!hasFitContentRef.current) {
      chart.timeScale().fitContent();
      hasFitContentRef.current = true;
    }
    return undefined;
  }, [hiddenYears, seriesModels]);

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
      seriesRefs.current.clear();
      hasFitContentRef.current = false;
    },
    []
  );

  const latestModel = seriesModels.find((model) => model.isLatest) || seriesModels[seriesModels.length - 1] || null;
  const metricLabel = payload?.metricLabel || "평가금액";
  const valueLabel = payload?.valueLabel || `${query.currency === "USD" ? "달러" : "원화"} ${metricLabel}`;
  const displayData = useMemo(() => ({
    schemaVersion: "portfolio-widget-display-data.v1",
    kind: "asset-seasonal-comparison",
    query,
    summary: {
      status: loading ? "loading" : error ? "error" : seriesModels.length ? "ready" : "empty",
      error,
      dataProvider: payload?.dataProvider || "토스 증권 Open API",
      metricLabel,
      valueLabel,
      unit: payload?.unit || query.currency,
      rawPointCount: historyPoints.length,
      yearCount: seriesModels.length,
      years: seriesModels.map((model) => model.year),
      latestYear: latestModel?.year || null,
      latestYearReturn: latestModel?.finalReturn,
    },
    data: {
      rawPoints: historyPoints,
      yearlySeries: seriesModels.map((model) => ({
        year: model.year,
        baseDate: model.baseDate,
        endDate: model.endDate,
        finalReturn: model.finalReturn,
        points: model.data,
      })),
    },
  }), [error, historyPoints, latestModel, loading, metricLabel, payload, query, seriesModels, valueLabel]);

  useEffect(() => {
    onWidgetDisplayData?.(widget?.id, displayData);
  }, [displayData, onWidgetDisplayData, widget?.id]);

  function toggleYear(year) {
    const key = String(year);
    setHiddenYears((current) => ({
      ...current,
      [key]: current[key] !== true,
    }));
  }

  return (
    <div className="portfolio-seasonal-comparison-chart" aria-label={`${widget?.title || "시즌별 비교"} 연간 수익률 차트`}>
      <div className="portfolio-seasonal-comparison-meta">
        <span>{payload?.dataProvider || "토스 증권 Open API"}</span>
        <span title={payload?.metricDescription || ""}>{valueLabel}</span>
        <span>연도별 YTD</span>
        <strong>
          {latestModel ? `${latestModel.year}년 ${formatSeasonalReturn(latestModel.finalReturn, 1)}` : "데이터 대기"}
        </strong>
      </div>
      <div className="portfolio-seasonal-comparison-range">{rangeLabel(payload, seriesModels)}</div>
      <div className="portfolio-seasonal-comparison-frame">
        {loading ? <div className="portfolio-seasonal-comparison-state">시즌별 비교 데이터 로딩</div> : null}
        {!loading && error ? <div className="portfolio-seasonal-comparison-state is-error">{error}</div> : null}
        {!loading && !error && !seriesModels.length ? (
          <div className="portfolio-seasonal-comparison-state">연도별 수익률을 만들 수 있는 일별 스냅샷이 없습니다.</div>
        ) : null}
        <div
          className={seriesModels.length && !loading && !error ? "portfolio-seasonal-comparison-canvas" : "portfolio-seasonal-comparison-canvas is-hidden"}
          ref={containerRef}
        />
      </div>
      {seriesModels.length ? (
        <div className="portfolio-seasonal-comparison-legend" aria-label="연도별 선 표시">
          {seriesModels.map((model) => {
            const hidden = hiddenYears[String(model.year)] === true;
            return (
              <button
                className={[model.isLatest ? "is-latest" : "", hidden ? "is-hidden" : ""].filter(Boolean).join(" ")}
                type="button"
                key={`season-${model.year}`}
                aria-pressed={!hidden}
                title={`${model.year}년 ${hidden ? "켜기" : "끄기"}`}
                onClick={() => toggleYear(model.year)}
              >
                <i style={{ backgroundColor: model.color }} aria-hidden="true" />
                <span>{model.year}년</span>
                <strong>{formatSeasonalReturn(model.finalReturn, 1)}</strong>
              </button>
            );
          })}
        </div>
      ) : null}
      <div className="portfolio-seasonal-comparison-credit">
        <span>{[payload?.source || "position-reconstruction", "1월 1일 기준 연도별 수익률"].filter(Boolean).join(" · ")}</span>
        <a href="https://www.tradingview.com/" target="_blank" rel="noreferrer">
          Lightweight Charts™
        </a>
      </div>
    </div>
  );
}
