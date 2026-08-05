"""Build a source-bounded Korea-market transmission data contract."""

from __future__ import annotations

import argparse
import json
import os
from datetime import date, timedelta
from pathlib import Path
from typing import Any, Callable
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from collectors.common import ROOT, load_dotenv
from generate_macro_chart import observations

SCHEMA_VERSION = "korea_market_snapshot.v1"
FRED_SERIES_ID = "DEXKOUS"
FRED_SOURCE_URL = "https://fred.stlouisfed.org/series/DEXKOUS"
KRX_API_BASE = "https://data-dbg.krx.co.kr/svc/apis/idx"
KRX_INDEX_ENDPOINTS = {
    "kospi": f"{KRX_API_BASE}/kospi_dd_trd",
    "kosdaq": f"{KRX_API_BASE}/kosdaq_dd_trd",
}
KRX_INDEX_ALIASES = {
    "kospi": {"KOSPI", "코스피"},
    "kosdaq": {"KOSDAQ", "코스닥"},
}
KRX_METRIC_KEYS = (
    "kospi",
    "kosdaq",
    "foreign_kospi_cash_net_buy_krw",
    "foreign_kospi200_futures_net_buy_contracts",
    "samsung_electronics",
    "sk_hynix",
)


def return_pct(current: float, previous: float) -> float | None:
    if previous == 0:
        return None
    return round((current / previous - 1) * 100, 4)


def missing_metric(metric_id: str, status: str, source_url: str | None = None) -> dict[str, Any]:
    return {
        "metric_id": metric_id,
        "status": status,
        "value": None,
        "as_of": None,
        "change_1d_pct": None,
        "change_5d_pct": None,
        "source_url": source_url,
    }


def fetch_krx_json(url: str, auth_key: str, bas_dd: str) -> dict[str, Any]:
    request_url = f"{url}?{urlencode({'basDd': bas_dd})}"
    request = Request(
        request_url,
        headers={
            "AUTH_KEY": auth_key,
            "Accept": "application/json",
            "User-Agent": "pb-daily-market-brief/1.0",
        },
    )
    with urlopen(request, timeout=30) as response:
        payload = json.loads(response.read().decode("utf-8"))
    if not isinstance(payload, dict):
        raise ValueError("KRX response must be a JSON object")
    return payload


def parse_krx_number(value: Any) -> float:
    text = str(value or "").replace(",", "").strip()
    if not text:
        raise ValueError("KRX numeric field is empty")
    return float(text)


def collect_krx_index(
    report_date: str,
    metric_id: str,
    auth_key: str,
    fetcher: Callable[[str, str, str], dict[str, Any]] = fetch_krx_json,
) -> dict[str, Any]:
    source_url = KRX_INDEX_ENDPOINTS[metric_id]
    if not auth_key:
        return missing_metric(metric_id, "missing_krx_open_api_authorization", source_url)
    report_day = date.fromisoformat(report_date)
    aliases = KRX_INDEX_ALIASES[metric_id]
    try:
        observations_found: list[tuple[date, float, float]] = []
        for days_back in range(16):
            candidate = report_day - timedelta(days=days_back)
            payload = fetcher(source_url, auth_key, candidate.strftime("%Y%m%d"))
            rows = payload.get("OutBlock_1")
            if rows is None:
                raise ValueError("KRX response is missing OutBlock_1")
            if not isinstance(rows, list):
                raise ValueError("KRX OutBlock_1 must be an array")
            matched = [
                row for row in rows
                if isinstance(row, dict)
                and str(row.get("IDX_NM") or "").strip().upper() in aliases
            ]
            if not matched:
                if rows:
                    return missing_metric(metric_id, "main_index_not_found", source_url)
                continue
            row = matched[0]
            as_of = date.fromisoformat(str(row["BAS_DD"]))
            observations_found.append((
                as_of,
                parse_krx_number(row.get("CLSPRC_IDX")),
                parse_krx_number(row.get("FLUC_RT")),
            ))
            if len(observations_found) >= 6:
                break
        if observations_found:
            as_of, current_value, current_change = observations_found[0]
            age_days = (report_day - as_of).days
            max_age_days = 4
            five_day_ready = len(observations_found) >= 6
            five_day_base = observations_found[5] if five_day_ready else None
            return {
                "metric_id": metric_id,
                "label": "코스피" if metric_id == "kospi" else "코스닥",
                "status": "available" if age_days <= max_age_days else "stale",
                "value": current_value,
                "unit": "index points",
                "as_of": as_of.isoformat(),
                "age_days": age_days,
                "max_age_days": max_age_days,
                "change_1d_pct": current_change,
                "change_5d_pct": (
                    return_pct(current_value, five_day_base[1])
                    if five_day_base else None
                ),
                "change_5d_status": (
                    "calculated_from_six_official_closes"
                    if five_day_ready else
                    "insufficient_recent_trading_observations"
                ),
                "change_5d_base_as_of": (
                    five_day_base[0].isoformat()
                    if five_day_base else None
                ),
                "history_observation_count": len(observations_found),
                "source_provider": "Korea Exchange",
                "source_url": source_url,
                "source_grade": "A",
                "primary_source_confirmed": True,
                "evidence_label": "fact_source_reported",
                "market_cutoff": "official_daily_close",
            }
    except Exception as exc:
        return {
            **missing_metric(metric_id, "provider_or_authorization_error", source_url),
            "error_type": type(exc).__name__,
        }
    return missing_metric(metric_id, "no_recent_trading_observation", source_url)


def collect_usdkrw(
    report_date: str,
    api_key: str,
    fetcher: Callable[[str, str, str], list[tuple[date, float]]] = observations,
) -> dict[str, Any]:
    if not api_key:
        return missing_metric("usdkrw", "missing_fred_api_key", FRED_SOURCE_URL)
    report_day = date.fromisoformat(report_date)
    try:
        values = [
            item for item in fetcher(
                FRED_SERIES_ID,
                api_key,
                (report_day - timedelta(days=45)).isoformat(),
            )
            if item[0] <= report_day
        ]
    except Exception as exc:
        return {
            **missing_metric("usdkrw", "provider_error", FRED_SOURCE_URL),
            "error_type": type(exc).__name__,
        }
    if len(values) < 2:
        return missing_metric("usdkrw", "insufficient_observations", FRED_SOURCE_URL)
    values = sorted(values, key=lambda item: item[0])
    current_date, current = values[-1]
    previous = values[-2][1]
    five_session = values[-6][1] if len(values) > 5 else values[0][1]
    age_days = (report_day - current_date).days
    max_age_days = 4
    return {
        "metric_id": "usdkrw",
        "label": "원/달러 환율",
        "status": "available" if age_days <= max_age_days else "stale",
        "value": current,
        "unit": "KRW per USD",
        "as_of": current_date.isoformat(),
        "age_days": age_days,
        "max_age_days": max_age_days,
        "change_1d_pct": return_pct(current, previous),
        "change_5d_pct": return_pct(current, five_session),
        "source_provider": "FRED",
        "upstream_source": "Federal Reserve H.10",
        "source_url": FRED_SOURCE_URL,
        "source_grade": "A",
        "primary_source_confirmed": True,
        "evidence_label": "fact_provider_standardized",
        "market_cutoff": "latest_available_daily_observation",
    }


def validate_krx_input(payload: dict[str, Any], report_date: str) -> None:
    if payload.get("schema_version") != "krx_official_market_input.v1":
        raise ValueError("Unexpected KRX input schema")
    if payload.get("report_date") != report_date:
        raise ValueError("KRX input report date does not match")
    if payload.get("source_provider") != "Korea Exchange":
        raise ValueError("KRX input must identify Korea Exchange")
    if payload.get("source_grade") != "A" or payload.get("primary_source_confirmed") is not True:
        raise ValueError("KRX input must retain grade-A primary lineage")
    source_url = str(payload.get("source_url") or "")
    if not source_url.startswith((
        "https://openapi.krx.co.kr/",
        "https://data.krx.co.kr/",
        "https://data-dbg.krx.co.kr/",
    )):
        raise ValueError("KRX input requires an official KRX URL")
    metrics = payload.get("metrics")
    if not isinstance(metrics, dict):
        raise ValueError("KRX input metrics must be an object")
    unknown = sorted(set(metrics) - set(KRX_METRIC_KEYS))
    if unknown:
        raise ValueError("Unknown KRX input metrics: " + ", ".join(unknown))
    report_day = date.fromisoformat(report_date)
    for key, metric in metrics.items():
        if not isinstance(metric, dict):
            raise ValueError(f"KRX metric {key} must be an object")
        if not isinstance(metric.get("value"), (int, float)):
            raise ValueError(f"KRX metric {key} requires a numeric value")
        if not str(metric.get("unit") or "").strip():
            raise ValueError(f"KRX metric {key} requires a unit")
        try:
            as_of = date.fromisoformat(str(metric.get("as_of") or ""))
        except ValueError as exc:
            raise ValueError(f"KRX metric {key} requires an ISO as_of date") from exc
        if as_of > report_day:
            raise ValueError(f"KRX metric {key} cannot be dated after the report")


def normalized_krx_metrics(
    report_date: str,
    payload: dict[str, Any] | None,
    krx_auth_key: str,
    krx_fetcher: Callable[[str, str, str], dict[str, Any]] = fetch_krx_json,
) -> dict[str, dict[str, Any]]:
    if payload is not None:
        validate_krx_input(payload, report_date)
    source_url = payload["source_url"] if payload else "https://openapi.krx.co.kr/"
    results: dict[str, dict[str, Any]] = {}
    for key in KRX_METRIC_KEYS:
        supplied = payload["metrics"].get(key) if payload else None
        if not supplied:
            if key in KRX_INDEX_ENDPOINTS:
                results[key] = collect_krx_index(
                    report_date,
                    key,
                    krx_auth_key,
                    krx_fetcher,
                )
            else:
                results[key] = missing_metric(
                    key,
                    (
                        "not_supplied_by_verified_input"
                        if payload else
                        "not_available_in_connected_krx_index_services"
                        if krx_auth_key else
                        "missing_krx_open_api_authorization"
                    ),
                    source_url,
                )
            continue
        results[key] = {
            "metric_id": key,
            "status": "available",
            "value": supplied.get("value"),
            "unit": supplied.get("unit"),
            "as_of": supplied.get("as_of"),
            "change_1d_pct": supplied.get("change_1d_pct"),
            "change_5d_pct": supplied.get("change_5d_pct"),
            "source_provider": "Korea Exchange",
            "source_url": source_url,
            "source_grade": "A",
            "primary_source_confirmed": True,
            "evidence_label": "fact_source_reported",
            "market_cutoff": supplied.get("market_cutoff", "official_input_as_supplied"),
        }
    return results


def build_korea_market(
    report_date: str,
    fred_api_key: str,
    *,
    official_krx_input: dict[str, Any] | None = None,
    krx_auth_key: str = "",
    fred_fetcher: Callable[[str, str, str], list[tuple[date, float]]] = observations,
    krx_fetcher: Callable[[str, str, str], dict[str, Any]] = fetch_krx_json,
) -> dict[str, Any]:
    metrics = {
        "usdkrw": collect_usdkrw(report_date, fred_api_key, fred_fetcher),
        **normalized_krx_metrics(
            report_date,
            official_krx_input,
            krx_auth_key,
            krx_fetcher,
        ),
    }
    available = [key for key, item in metrics.items() if item.get("status") == "available"]
    missing = [key for key, item in metrics.items() if item.get("status") != "available"]
    price_ready = all(key in available for key in ("usdkrw", "kospi", "kosdaq"))
    full_ready = price_ready and all(
        key in available for key in (
            "foreign_kospi_cash_net_buy_krw",
            "foreign_kospi200_futures_net_buy_contracts",
        )
    )
    gate_status = (
        "ready_for_korea_transmission"
        if full_ready else
        "partial_price_transmission_no_verified_flows"
        if price_ready else
        "insufficient_verified_korea_data"
    )
    return {
        "schema_version": SCHEMA_VERSION,
        "report_date": report_date,
        "collection_status": "complete" if not missing else ("partial" if available else "blocked"),
        "metrics": metrics,
        "transmission_gate": {
            "status": gate_status,
            "available_metrics": available,
            "missing_metrics": missing,
            "decision_limit": (
                "Do not infer Korean-market direction from U.S. assets until verified KOSPI, "
                "KOSDAQ, and flow data are available."
            ),
        },
        "source_policy": (
            "USD/KRW uses FRED's Federal Reserve H.10 series. KRX indices and flows require "
            "an approved KRX Open API service or a separately verified official input."
        ),
    }


def write_payload(payload: dict[str, Any]) -> Path:
    output_dir = ROOT / "workspace" / "korea_market" / payload["report_date"]
    output_dir.mkdir(parents=True, exist_ok=True)
    output = output_dir / "korea_market.json"
    output.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return output


def main() -> None:
    parser = argparse.ArgumentParser(description="Collect the Korea-market transmission contract.")
    parser.add_argument("--date", default=date.today().isoformat())
    parser.add_argument("--official-krx-input")
    args = parser.parse_args()
    load_dotenv()
    default_input = ROOT / "workspace" / "korea_market_inputs" / args.date / "krx_official.json"
    input_path = Path(args.official_krx_input) if args.official_krx_input else default_input
    official_input = (
        json.loads(input_path.read_text(encoding="utf-8"))
        if input_path.exists() else None
    )
    payload = build_korea_market(
        args.date,
        os.getenv("FRED_API_KEY", "").strip(),
        official_krx_input=official_input,
        krx_auth_key=os.getenv("KRX_OPEN_API_KEY", "").strip(),
    )
    output = write_payload(payload)
    print(
        f"Korea market snapshot saved: {output.relative_to(ROOT)} "
        f"({payload['collection_status']})"
    )


if __name__ == "__main__":
    main()
