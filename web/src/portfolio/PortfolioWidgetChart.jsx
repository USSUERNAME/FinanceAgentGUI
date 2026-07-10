import React, { useMemo } from "react";
import {
  buildPortfolioWidgetAllocationOption,
  buildPortfolioWidgetLineOption,
  portfolioWidgetAllocationPercent,
} from "./chartBuilders.js";
import { normalizePortfolioWidgetDataset } from "./datasetParser.js";
import { PortfolioEChart } from "./PortfolioEChart.jsx";
import { PortfolioWidgetMiniPreview } from "./PortfolioWidgetPreview.jsx";
import PortfolioAssetPriceHistoryChart from "./PortfolioAssetPriceHistoryChart.jsx";
import PortfolioInvestmentPositionStatusChart from "./PortfolioInvestmentPositionStatusChart.jsx";
import PortfolioSeasonalComparisonChart from "./PortfolioSeasonalComparisonChart.jsx";
import { formatPortfolioPercent } from "./holdingsSummary.js";
import { normalizePortfolioWidgetVisualType } from "./widgetTypes.js";

export default function PortfolioWidgetChart({ widget, onWidgetDisplayData }) {
  const type = normalizePortfolioWidgetVisualType(widget?.visualType);
  const allocationOption = useMemo(() => buildPortfolioWidgetAllocationOption(widget), [widget]);
  const lineOption = useMemo(() => buildPortfolioWidgetLineOption(widget), [widget]);
  if (type === "allocation") {
    const dataset = normalizePortfolioWidgetDataset(widget?.dataset || widget?.chartSpec?.dataset, 12);
    const isCompact = Number(widget.h || 1) <= 2;
    return (
      <div className={`portfolio-widget-allocation-view ${isCompact ? "is-compact" : ""}`}>
        <PortfolioEChart
          option={allocationOption}
          className={`portfolio-widget-echart ${isCompact ? "is-compact" : ""}`}
          ariaLabel={`${widget.title} 인터랙티브 비중 차트`}
        />
        {!isCompact && dataset.length ? (
          <ol className="portfolio-widget-allocation-list" aria-label={`${widget.title} 구성 비중`}>
            {dataset.slice(0, 7).map((row) => (
              <li key={`${widget?.id || "allocation"}-${row.label}`}>
                <i style={{ backgroundColor: row.color }} aria-hidden="true" />
                <span>{row.label}</span>
                <strong>{formatPortfolioPercent(portfolioWidgetAllocationPercent(row, dataset), 1)}</strong>
              </li>
            ))}
          </ol>
        ) : null}
      </div>
    );
  }
  if (type === "line") {
    return (
      <PortfolioEChart
        option={lineOption}
        className={`portfolio-widget-echart ${Number(widget.h || 1) <= 2 ? "is-compact" : ""}`}
        ariaLabel={`${widget.title} 인터랙티브 선 차트`}
      />
    );
  }
  if (type === "price-history") {
    return <PortfolioAssetPriceHistoryChart widget={widget} onWidgetDisplayData={onWidgetDisplayData} />;
  }
  if (type === "position-status") {
    return <PortfolioInvestmentPositionStatusChart widget={widget} onWidgetDisplayData={onWidgetDisplayData} />;
  }
  if (type === "seasonal-comparison") {
    return <PortfolioSeasonalComparisonChart widget={widget} onWidgetDisplayData={onWidgetDisplayData} />;
  }
  return <PortfolioWidgetMiniPreview widget={widget} />;
}
