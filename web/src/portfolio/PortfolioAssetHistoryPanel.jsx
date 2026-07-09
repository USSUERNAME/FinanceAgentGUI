import React from "react";
import CalendarClock from "lucide-react/dist/esm/icons/calendar-clock.js";
import Database from "lucide-react/dist/esm/icons/database.js";
import LockKeyhole from "lucide-react/dist/esm/icons/lock-keyhole.js";

import {
  clampPortfolioAssetHistoryRange,
  portfolioAssetHistoryTimeframeOptions,
} from "./workspaceState.js";

function formatAssetHistoryDate(value = "") {
  const [year, month, day] = String(value || "").split("-");
  if (!year || !month || !day) return "-";
  return `${year}.${month}.${day}`;
}

export function PortfolioAssetHistoryPanel({
  range,
  minimumDate = "",
  maximumDate = "",
  onRangeChange,
}) {
  const inputId = React.useId();
  const startDateInputId = `${inputId}-asset-history-start`;
  const endDateInputId = `${inputId}-asset-history-end`;
  const clampedRange = clampPortfolioAssetHistoryRange(range, {
    minimumDate,
    maximumDate,
  });
  const startDateMax = clampedRange.endDate || maximumDate;
  const endDateMin = clampedRange.startDate || minimumDate;

  function updateRange(patch) {
    onRangeChange?.(
      clampPortfolioAssetHistoryRange(
        {
          ...clampedRange,
          ...patch,
        },
        {
          minimumDate,
          maximumDate,
        }
      )
    );
  }

  return (
    <section className="portfolio-asset-history-panel" aria-labelledby="portfolio-asset-history-title">
      <div className="portfolio-asset-history-heading">
        <span>
          <LockKeyhole size={12} strokeWidth={2.4} />
          첫 거래 이전 잠금
        </span>
        <h3 id="portfolio-asset-history-title">기간 및 타임프레임</h3>
      </div>

      <div className="portfolio-asset-history-grid">
        <div className="portfolio-asset-history-date-field">
          <label htmlFor={startDateInputId}>조회 시작</label>
          <div className="portfolio-asset-history-date-control">
            <input
              id={startDateInputId}
              type="date"
              min={minimumDate}
              max={startDateMax}
              value={clampedRange.startDate}
              onInput={(event) => updateRange({ startDate: event.currentTarget.value })}
              onChange={(event) => updateRange({ startDate: event.target.value })}
              onBlur={(event) => updateRange({ startDate: event.currentTarget.value })}
            />
            <button
              className="portfolio-asset-history-clear-date"
              type="button"
              onClick={() => updateRange({ startDate: "" })}
              aria-label="조회 시작 날짜 지우기"
            >
              날짜 지우기
            </button>
          </div>
        </div>
        <div className="portfolio-asset-history-date-field">
          <label htmlFor={endDateInputId}>조회 종료</label>
          <div className="portfolio-asset-history-date-control">
            <input
              id={endDateInputId}
              type="date"
              min={endDateMin}
              max={maximumDate}
              value={clampedRange.endDate}
              onInput={(event) => updateRange({ endDate: event.currentTarget.value })}
              onChange={(event) => updateRange({ endDate: event.target.value })}
              onBlur={(event) => updateRange({ endDate: event.currentTarget.value })}
            />
            <button
              className="portfolio-asset-history-clear-date"
              type="button"
              onClick={() => updateRange({ endDate: "" })}
              aria-label="조회 종료 날짜 지우기"
            >
              날짜 지우기
            </button>
          </div>
        </div>
        <div className="portfolio-asset-history-timeframes" role="group" aria-label="자산관리 타임프레임">
          {portfolioAssetHistoryTimeframeOptions.map((option) => (
            <button
              className={option.id === clampedRange.timeframe ? "is-selected" : ""}
              type="button"
              key={option.id}
              onClick={() => updateRange({ timeframe: option.id })}
              aria-pressed={option.id === clampedRange.timeframe}
            >
              {option.label}
            </button>
          ))}
        </div>
        <span className="portfolio-asset-history-source">
          <Database size={13} strokeWidth={2.4} />
          데이터 <strong>토스 증권 Open API</strong>
        </span>
        <span className="portfolio-asset-history-source">
          <CalendarClock size={13} strokeWidth={2.4} />
          첫 거래 <strong>{formatAssetHistoryDate(minimumDate)}</strong>
        </span>
      </div>
    </section>
  );
}
