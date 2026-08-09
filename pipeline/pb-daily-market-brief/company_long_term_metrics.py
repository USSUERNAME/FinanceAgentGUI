"""Normalize multi-year company facts into bounded long-term investment metrics."""

from __future__ import annotations

import math
import statistics
from typing import Any


LONG_TERM_METRIC_IDS = (
    "revenue",
    "operating_income",
    "operating_cash_flow",
    "capital_expenditures",
    "dividends_paid",
    "share_repurchases",
    "share_issuance",
    "diluted_shares",
)


def _number(value: Any) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    result = float(value)
    return result if math.isfinite(result) else None


def _ratio(numerator: float | None, denominator: float | None) -> float | None:
    if numerator is None or denominator in (None, 0):
        return None
    return numerator / denominator


def _pct(value: float | None) -> float | None:
    return round(value * 100, 2) if value is not None else None


def _cagr(values: list[float]) -> float | None:
    years = len(values) - 1
    if years <= 0 or values[0] <= 0 or values[-1] < 0:
        return None
    return (values[-1] / values[0]) ** (1 / years) - 1


def _median_ratio(rows: list[dict[str, Any]], numerator: str, denominator: str) -> float | None:
    values = [
        value
        for row in rows
        if (value := _ratio(_number(row.get(numerator)), _number(row.get(denominator)))) is not None
    ]
    return statistics.median(values) if values else None


def build_long_term_metrics(annual_metrics: dict[str, list[dict[str, Any]]]) -> dict[str, Any]:
    """Build aligned fiscal-year rows without inventing missing observations."""
    by_metric: dict[str, dict[str, dict[str, Any]]] = {}
    period_labels: set[str] = set()
    for metric_id in LONG_TERM_METRIC_IDS:
        metric_rows: dict[str, dict[str, Any]] = {}
        for row in annual_metrics.get(metric_id, []) or []:
            label = str(row.get("period_end") or "")
            if not label or _number(row.get("value")) is None:
                continue
            metric_rows[label] = row
            period_labels.add(label)
        by_metric[metric_id] = metric_rows

    rows: list[dict[str, Any]] = []
    for label in sorted(period_labels)[-5:]:
        values = {
            metric_id: _number(by_metric[metric_id].get(label, {}).get("value"))
            for metric_id in LONG_TERM_METRIC_IDS
        }
        operating_cash_flow = values["operating_cash_flow"]
        capital_expenditures = values["capital_expenditures"]
        fcf = (
            operating_cash_flow - abs(capital_expenditures)
            if operating_cash_flow is not None and capital_expenditures is not None
            else None
        )
        dividends = values["dividends_paid"] or 0.0
        buybacks = values["share_repurchases"] or 0.0
        issuance = values["share_issuance"]
        gross_returns = dividends + buybacks if values["dividends_paid"] is not None or values["share_repurchases"] is not None else None
        net_returns = gross_returns - issuance if gross_returns is not None and issuance is not None else None
        representative = next(
            (by_metric[metric_id].get(label) for metric_id in LONG_TERM_METRIC_IDS if by_metric[metric_id].get(label)),
            {},
        )
        rows.append({
            "period": label,
            "period_end": representative.get("period_end"),
            "fiscal_year": representative.get("fiscal_year"),
            "currency": representative.get("unit"),
            **values,
            "fcf": fcf,
            "operating_margin_pct": _pct(_ratio(values["operating_income"], values["revenue"])),
            "fcf_margin_pct": _pct(_ratio(fcf, values["revenue"])),
            "fcf_conversion_pct": _pct(_ratio(fcf, values["operating_income"])),
            "gross_shareholder_returns": gross_returns,
            "net_cash_returns_after_issuance": net_returns,
        })

    complete_core = [
        row for row in rows
        if all(_number(row.get(field)) is not None for field in ("revenue", "operating_income", "fcf"))
    ]
    summary: dict[str, Any] = {
        "observation_count": len(rows),
        "complete_core_years": len(complete_core),
        "first_period": rows[0]["period"] if rows else None,
        "last_period": rows[-1]["period"] if rows else None,
        "revenue_cagr_pct": None,
        "operating_income_cagr_pct": None,
        "fcf_cagr_pct": None,
        "latest_operating_margin_pct": rows[-1].get("operating_margin_pct") if rows else None,
        "latest_fcf_margin_pct": rows[-1].get("fcf_margin_pct") if rows else None,
        "median_fcf_conversion_pct": _pct(_median_ratio(complete_core, "fcf", "operating_income")),
        "positive_operating_income_years": sum((_number(row.get("operating_income")) or 0) > 0 for row in rows),
        "positive_fcf_years": sum((_number(row.get("fcf")) or 0) > 0 for row in rows),
        "diluted_share_count_change_pct": None,
        "dilution_comparability_status": "not_available",
        "cumulative_gross_shareholder_returns": None,
        "cumulative_net_cash_returns_after_issuance": None,
        "cumulative_returns_to_fcf_pct": None,
    }
    if len(complete_core) >= 2:
        for field in ("revenue", "operating_income", "fcf"):
            values = [_number(row[field]) for row in complete_core]
            if all(value is not None for value in values):
                summary[f"{field}_cagr_pct"] = _pct(_cagr(values))
    share_rows = [row for row in rows if _number(row.get("diluted_shares")) is not None]
    if len(share_rows) >= 2:
        share_change = _pct(
            _ratio(
                _number(share_rows[-1]["diluted_shares"]) - _number(share_rows[0]["diluted_shares"]),
                _number(share_rows[0]["diluted_shares"]),
            )
        )
        if share_change is not None and abs(share_change) <= 50:
            summary["diluted_share_count_change_pct"] = share_change
            summary["dilution_comparability_status"] = "comparable"
        else:
            summary["dilution_comparability_status"] = "withheld_possible_split_or_unit_discontinuity"
    return_rows = [row for row in rows if _number(row.get("gross_shareholder_returns")) is not None]
    net_return_rows = [row for row in return_rows if _number(row.get("net_cash_returns_after_issuance")) is not None]
    if return_rows:
        gross = sum(_number(row["gross_shareholder_returns"]) or 0 for row in return_rows)
        summary.update({
            "cumulative_gross_shareholder_returns": round(gross, 4),
        })
    if net_return_rows and len(net_return_rows) == len(return_rows):
        net = sum(_number(row["net_cash_returns_after_issuance"]) or 0 for row in net_return_rows)
        total_fcf = sum(_number(row.get("fcf")) or 0 for row in net_return_rows)
        summary.update({
            "cumulative_net_cash_returns_after_issuance": round(net, 4),
            "cumulative_returns_to_fcf_pct": _pct(_ratio(net, total_fcf)),
        })
    quality_gate = {
        "status": "ready" if len(complete_core) >= 5 else "insufficient_history",
        "required_core_years": 5,
        "complete_core_years": len(complete_core),
        "capital_allocation_available": bool(return_rows),
        "dilution_available": summary["dilution_comparability_status"] == "comparable",
        "missing": [
            label for condition, label in (
                (len(complete_core) >= 5, "5개년 매출·영업이익·FCF"),
                (bool(return_rows), "배당·자사주"),
                (bool(net_return_rows) and len(net_return_rows) == len(return_rows), "신주발행·주식보상"),
                (summary["dilution_comparability_status"] == "comparable", "분할 조정 희석주식수 변화"),
            ) if not condition
        ],
    }
    return {
        "periods": rows,
        "summary": summary,
        "quality_gate": quality_gate,
        "calculation_policy": {
            "fcf": "operating_cash_flow_minus_absolute_capital_expenditures",
            "net_shareholder_returns": "dividends_plus_repurchases_minus_share_issuance",
            "negative_or_zero_start_cagr": "withheld",
            "missing_values": "not_inferred",
        },
    }
