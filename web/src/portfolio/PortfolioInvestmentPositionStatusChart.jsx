import React, { useEffect, useMemo, useRef, useState } from "react";

function normalizePositionStatusView(value = "") {
  return String(value || "").trim().toLowerCase() === "pie" ? "pie" : "bar";
}

function normalizePositionStatusQuery(chartSpec = {}) {
  const query = chartSpec?.query && typeof chartSpec.query === "object" ? chartSpec.query : {};
  const currency = String(query.currency || chartSpec.currency || chartSpec.valueCurrency || "KRW").toUpperCase() === "USD" ? "USD" : "KRW";
  return {
    endDate: String(query.endDate || chartSpec.endDate || "").trim(),
    currency,
    view: normalizePositionStatusView(query.view || chartSpec.view || "bar"),
  };
}

function positionStatusQueryUrl(query) {
  const params = new URLSearchParams();
  params.set("currency", query.currency || "KRW");
  if (query.endDate) params.set("endDate", query.endDate);
  return `/api/tossinvest/order-sync/position-status?${params.toString()}`;
}

function formatPositionValue(value, unit = "") {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) return "-";
  if (unit === "USD") {
    return `$${number.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
  }
  return `₩${Math.round(number).toLocaleString("ko-KR")}`;
}

function formatPositionPercent(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) return "0%";
  return `${number.toLocaleString("ko-KR", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}%`;
}

function positionStatusDateLabel(query, payload) {
  if (query.endDate) return query.endDate;
  if (payload?.asOfDate) return payload.asOfDate;
  return "최신";
}

function positionItemKey(item = {}) {
  return `${item.currency || ""}-${item.symbol || item.label || ""}`;
}

function formatPositionQuantity(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) return "";
  return number.toLocaleString("ko-KR", { maximumFractionDigits: 6 });
}

function polarToCartesian(centerX, centerY, radius, angleInDegrees) {
  const angleInRadians = ((angleInDegrees - 90) * Math.PI) / 180;
  return {
    x: centerX + radius * Math.cos(angleInRadians),
    y: centerY + radius * Math.sin(angleInRadians),
  };
}

function pieSlicePath(startPercent, endPercent) {
  const startAngle = (startPercent / 100) * 360;
  const endAngle = (endPercent / 100) * 360;
  const start = polarToCartesian(50, 50, 48, endAngle);
  const end = polarToCartesian(50, 50, 48, startAngle);
  const largeArcFlag = endAngle - startAngle <= 180 ? "0" : "1";
  return ["M 50 50", `L ${start.x.toFixed(3)} ${start.y.toFixed(3)}`, `A 48 48 0 ${largeArcFlag} 0 ${end.x.toFixed(3)} ${end.y.toFixed(3)}`, "Z"].join(" ");
}

function PortfolioPositionPie({ items = [], activeItem = null, onActivate, onClear }) {
  let cursor = 0;
  return (
    <svg
      className="portfolio-position-status-pie-svg"
      viewBox="0 0 100 100"
      role="img"
      aria-label={`총 ${items.length}개 종목 구성 파이차트`}
      onMouseLeave={onClear}
    >
      {items.map((item) => {
        const percent = Math.max(0, Number(item?.percent || 0));
        const start = cursor;
        const end = Math.min(100, cursor + percent);
        cursor = end;
        if (!percent) return null;
        return (
          <path
            className="portfolio-position-status-pie-slice"
            d={pieSlicePath(start, end)}
            fill={item.color || "#207a68"}
            key={`pie-${positionItemKey(item)}`}
            tabIndex={0}
            aria-label={`${item.label || item.symbol} ${formatPositionPercent(item.percent)}`}
            onMouseEnter={(event) => onActivate?.(item, event)}
            onMouseMove={(event) => onActivate?.(item, event)}
            onPointerMove={(event) => onActivate?.(item, event)}
            onFocus={(event) => onActivate?.(item, event)}
            onBlur={onClear}
          />
        );
      })}
      <circle cx="50" cy="50" r="29" fill="#ffffff" pointerEvents="none" />
      <text x="50" y="53" textAnchor="middle" pointerEvents="none">
        {formatPositionPercent((activeItem || items[0])?.percent)}
      </text>
    </svg>
  );
}

export default function PortfolioInvestmentPositionStatusChart({ widget }) {
  const stageRef = useRef(null);
  const chartSpec = widget?.chartSpec && typeof widget.chartSpec === "object" ? widget.chartSpec : {};
  const query = useMemo(() => normalizePositionStatusQuery(chartSpec), [chartSpec]);
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 });
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [hoveredItem, setHoveredItem] = useState(null);
  const [tooltipPosition, setTooltipPosition] = useState({ x: 8, y: 8 });

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    fetch(positionStatusQueryUrl(query), { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok || body?.ok === false) {
          throw new Error(body?.error || `HTTP ${response.status}`);
        }
        if (!cancelled) setPayload(body);
      })
      .catch((fetchError) => {
        if (!cancelled) setError(fetchError.message || "투자 종목 현황을 불러오지 못했습니다.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [query.endDate, query.currency]);

  useEffect(() => {
    const stageNode = stageRef.current;
    if (!stageNode) return undefined;

    function updateStageSize() {
      const rect = stageNode.getBoundingClientRect();
      setStageSize((current) => {
        const width = Math.round(rect.width);
        const height = Math.round(rect.height);
        if (current.width === width && current.height === height) return current;
        return { width, height };
      });
    }

    updateStageSize();
    if (typeof ResizeObserver === "undefined") {
      return undefined;
    }
    const observer = new ResizeObserver(updateStageSize);
    observer.observe(stageNode);
    return () => observer.disconnect();
  }, [query.view]);

  const items = Array.isArray(payload?.items) ? payload.items : [];
  const topItem = items[0] || null;
  const activeItem = hoveredItem || topItem;
  const unit = payload?.unit || query.currency || "KRW";
  const listItems = items.slice(0, 18);
  const view = query.view;
  const pieLayout = useMemo(() => {
    const width = Number(stageSize.width || 0);
    const height = Number(stageSize.height || 0);
    if (view !== "pie" || !width || !height) return { pieSize: 220, focusWidth: 180 };
    const focusWidth = width >= 620 ? Math.min(300, Math.max(180, width * 0.22)) : Math.max(148, Math.min(172, width * 0.42));
    const focusGap = width >= 760 ? 24 : 16;
    const availableWidth = width >= 520 ? width - focusWidth - focusGap : width * 0.48;
    const size = Math.min(height, availableWidth, 520);
    return { pieSize: Math.max(132, Math.floor(size)), focusWidth: Math.floor(focusWidth) };
  }, [stageSize.height, stageSize.width, view]);

  function updateHoveredItem(item, event) {
    setHoveredItem(item);
    const stageRect = stageRef.current?.getBoundingClientRect();
    const targetRect = event?.currentTarget?.getBoundingClientRect?.();
    if (!stageRect) return;
    const rawClientX = Number(event?.clientX);
    const rawClientY = Number(event?.clientY);
    const clientX = Number.isFinite(rawClientX)
      ? rawClientX
      : targetRect
        ? targetRect.left + targetRect.width / 2
        : stageRect.left + 8;
    const clientY = Number.isFinite(rawClientY)
      ? rawClientY
      : targetRect
        ? targetRect.top + targetRect.height / 2
        : stageRect.top + 8;
    const tooltipWidth = 220;
    const tooltipHeight = 86;
    const x = Math.min(Math.max(clientX - stageRect.left + 14, 8), Math.max(8, stageRect.width - tooltipWidth - 8));
    const y = Math.min(Math.max(clientY - stageRect.top + 14, 8), Math.max(8, stageRect.height - tooltipHeight - 8));
    setTooltipPosition({ x, y });
  }

  function clearHoveredItem() {
    setHoveredItem(null);
  }

  return (
    <div
      className={`portfolio-position-status-chart is-${view}-view`}
      aria-label={`${widget?.title || "투자 종목 현황"} 구성 차트`}
      style={{
        "--portfolio-position-pie-size": `${pieLayout.pieSize}px`,
        "--portfolio-position-focus-width": `${pieLayout.focusWidth}px`,
      }}
    >
      <div className="portfolio-position-status-meta">
        <span>{payload?.dataProvider || "토스 증권 Open API"}</span>
        <span title={payload?.metricDescription || ""}>{payload?.metricLabel || "투자 원금"} 기준</span>
        <span>{positionStatusDateLabel(query, payload)}</span>
        <strong>{items.length ? formatPositionValue(payload?.totalValue, unit) : "데이터 대기"}</strong>
      </div>

      <div className="portfolio-position-status-stage" ref={stageRef}>
        {loading ? <div className="portfolio-position-status-state">투자 종목 현황 로딩</div> : null}
        {!loading && error ? <div className="portfolio-position-status-state is-error">{error}</div> : null}
        {!loading && !error && !items.length ? (
          <div className="portfolio-position-status-state">선택한 기준일의 보유 종목 스냅샷이 없습니다.</div>
        ) : null}
        {!loading && !error && items.length ? (
          view === "pie" ? (
            <div className="portfolio-position-status-pie-view">
              <div className="portfolio-position-status-pie">
                <PortfolioPositionPie
                  items={items}
                  activeItem={activeItem}
                  onActivate={updateHoveredItem}
                  onClear={clearHoveredItem}
                />
              </div>
              <div className="portfolio-position-status-focus">
                <i style={{ backgroundColor: activeItem?.color || "#207a68" }} aria-hidden="true" />
                <strong>{activeItem?.label || activeItem?.symbol}</strong>
                <span>
                  {formatPositionPercent(activeItem?.percent)} · {formatPositionValue(activeItem?.value, unit)}
                </span>
                {activeItem?.quantity ? <small>수량 {formatPositionQuantity(activeItem.quantity)}</small> : null}
              </div>
            </div>
          ) : (
            <div className="portfolio-position-status-bar-view" onMouseLeave={clearHoveredItem}>
              <div className="portfolio-position-status-focus is-horizontal">
                <i style={{ backgroundColor: activeItem?.color || "#207a68" }} aria-hidden="true" />
                <div>
                  <strong>{formatPositionPercent(activeItem?.percent)}</strong>
                  <span>{activeItem?.label || activeItem?.symbol}</span>
                </div>
                <em>보유종목 {items.length}</em>
              </div>
              <div className="portfolio-position-status-stack" role="img" aria-label={`총 ${items.length}개 종목 구성 막대차트`}>
                {items.map((item) => (
                  <span
                    key={`bar-${positionItemKey(item)}`}
                    tabIndex={0}
                    aria-label={`${item.label || item.symbol} ${formatPositionPercent(item.percent)}`}
                    style={{
                      backgroundColor: item.color || "#207a68",
                      width: `${Math.max(0, Number(item.percent || 0))}%`,
                    }}
                    onMouseEnter={(event) => updateHoveredItem(item, event)}
                    onMouseMove={(event) => updateHoveredItem(item, event)}
                    onPointerMove={(event) => updateHoveredItem(item, event)}
                    onFocus={(event) => updateHoveredItem(item, event)}
                    onBlur={clearHoveredItem}
                  />
                ))}
              </div>
            </div>
          )
        ) : null}
        {!loading && !error && hoveredItem ? (
          <div
            className={`portfolio-position-status-tooltip is-${view}`}
            role="status"
            style={{
              "--portfolio-position-tooltip-x": `${tooltipPosition.x}px`,
              "--portfolio-position-tooltip-y": `${tooltipPosition.y}px`,
            }}
          >
            <strong>{hoveredItem.label || hoveredItem.symbol}</strong>
            <span>
              {formatPositionPercent(hoveredItem.percent)} · {formatPositionValue(hoveredItem.value, unit)}
            </span>
            {hoveredItem.quantity ? <span>수량 {formatPositionQuantity(hoveredItem.quantity)}</span> : null}
          </div>
        ) : null}
      </div>

      {items.length ? (
        <ol className="portfolio-position-status-list" aria-label="투자 종목 비율">
          {listItems.map((item) => (
            <li key={`position-status-list-${item.currency || ""}-${item.symbol}`}>
              <i style={{ backgroundColor: item.color || "#207a68" }} aria-hidden="true" />
              <span>
                {item.label || item.symbol} ({formatPositionPercent(item.percent)})
              </span>
              <strong>{formatPositionValue(item.value, unit)}</strong>
            </li>
          ))}
        </ol>
      ) : null}

      <div className="portfolio-position-status-credit">
        <span>
          {[payload?.source || "position-reconstruction", payload?.carriedForward ? `스냅샷 ${payload.snapshotDate}` : ""]
            .filter(Boolean)
            .join(" · ")}
        </span>
        <span>{payload?.valueLabel || "원화 투자 원금"}</span>
      </div>
    </div>
  );
}
