"""Build a source-bounded Korea-market transmission data contract."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from collectors.common import ROOT, load_dotenv
from generate_macro_chart import observations

SCHEMA_VERSION = "korea_market_snapshot.v1"
FRED_SERIES_ID = "DEXKOUS"
FRED_SOURCE_URL = "https://fred.stlouisfed.org/series/DEXKOUS"
ECOS_SOURCE_URL = "https://ecos.bok.or.kr/"
ECOS_USDKRW_STAT_CODE = "731Y001"
ECOS_USDKRW_ITEM_CODE = "0000001"
KIS_API_BASE = "https://openapi.koreainvestment.com:9443"
KIS_INVESTOR_ENDPOINT = (
    f"{KIS_API_BASE}/uapi/domestic-stock/v1/quotations/"
    "inquire-investor-time-by-market"
)
KIS_USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0 Safari/537.36"
)
KIS_TOKEN_CACHE_PATH = ROOT / "workspace" / "secrets" / "kis-access-token.json"
KIS_FLOW_CONFIG = {
    "foreign_kospi_cash_net_buy_krw": {
        "market": "KSP",
        "subcode": "0001",
        "field": "frgn_ntby_tr_pbmn",
        "multiplier": 1_000_000,
        "unit": "KRW",
        "label": "외국인 코스피 현물 순매수",
        "provider_unit": "million KRW",
    },
    "foreign_kospi200_futures_net_buy_contracts": {
        "market": "K2I",
        "subcode": "F001",
        "field": "frgn_ntby_qty",
        "multiplier": 1,
        "unit": "contracts",
        "label": "외국인 코스피200 선물 순매수",
        "provider_unit": "contracts",
    },
}
KRX_API_BASE = "https://data-dbg.krx.co.kr/svc/apis/idx"
KRX_INDEX_ENDPOINTS = {
    "kospi": f"{KRX_API_BASE}/kospi_dd_trd",
    "kosdaq": f"{KRX_API_BASE}/kosdaq_dd_trd",
}
KRX_STOCK_ENDPOINT = "https://data-dbg.krx.co.kr/svc/apis/sto/stk_bydd_trd"
KRX_STOCKS = {
    "samsung_electronics": {"isu_cd": "005930", "label": "삼성전자"},
    "sk_hynix": {"isu_cd": "000660", "label": "SK하이닉스"},
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
KOREA_ALIGNMENT_METRIC_KEYS = (
    "usdkrw",
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


def business_day_gap(start: date, end: date) -> int:
    if end <= start:
        return 0
    cursor = start
    count = 0
    while cursor < end:
        cursor += timedelta(days=1)
        if cursor.weekday() < 5:
            count += 1
    return count


def evaluate_market_date_alignment(metrics: dict[str, dict[str, Any]]) -> dict[str, Any]:
    metric_dates: dict[str, date] = {}
    for key in KOREA_ALIGNMENT_METRIC_KEYS:
        metric = metrics.get(key) or {}
        if metric.get("status") != "available":
            continue
        try:
            metric_dates[key] = date.fromisoformat(str(metric.get("as_of") or ""))
        except ValueError:
            continue
    if len(metric_dates) != len(KOREA_ALIGNMENT_METRIC_KEYS):
        return {
            "status": "insufficient_dates",
            "required_metric_count": len(KOREA_ALIGNMENT_METRIC_KEYS),
            "dated_metric_count": len(metric_dates),
            "metric_dates": {
                key: value.isoformat() for key, value in metric_dates.items()
            },
        }
    earliest = min(metric_dates.values())
    latest = max(metric_dates.values())
    gap = business_day_gap(earliest, latest)
    return {
        "status": (
            "aligned"
            if earliest == latest else
            "source_lag_within_tolerance"
            if gap <= 1 else
            "source_lag_exceeds_tolerance"
        ),
        "earliest_as_of": earliest.isoformat(),
        "latest_as_of": latest.isoformat(),
        "calendar_day_gap": (latest - earliest).days,
        "business_day_gap": gap,
        "max_allowed_business_day_gap": 1,
        "metric_dates": {
            key: value.isoformat() for key, value in metric_dates.items()
        },
    }


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


def fetch_ecos_usdkrw(
    api_key: str,
    start_date: str,
    end_date: str,
) -> list[tuple[date, float]]:
    url = (
        f"https://ecos.bok.or.kr/api/StatisticSearch/{api_key}/json/kr/1/100/"
        f"{ECOS_USDKRW_STAT_CODE}/D/{start_date}/{end_date}/{ECOS_USDKRW_ITEM_CODE}"
    )
    request = Request(url, headers={"User-Agent": "pb-daily-market-brief/1.0"})
    with urlopen(request, timeout=30) as response:
        payload = json.loads(response.read().decode("utf-8"))
    rows = (payload.get("StatisticSearch") or {}).get("row")
    if not isinstance(rows, list):
        raise ValueError("ECOS response is missing StatisticSearch.row")
    values: list[tuple[date, float]] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        values.append((
            date.fromisoformat(str(row.get("TIME") or "")),
            parse_krx_number(row.get("DATA_VALUE")),
        ))
    return values


def load_cached_kis_access_token(app_key: str) -> str:
    if not KIS_TOKEN_CACHE_PATH.exists():
        return ""
    try:
        payload = json.loads(KIS_TOKEN_CACHE_PATH.read_text(encoding="utf-8"))
        expected_hash = hashlib.sha256(app_key.encode("utf-8")).hexdigest()
        if payload.get("app_key_sha256") != expected_hash:
            return ""
        expires_at = datetime.fromisoformat(str(payload.get("expires_at_utc") or ""))
        if expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=timezone.utc)
        if expires_at <= datetime.now(timezone.utc) + timedelta(minutes=5):
            return ""
        return str(payload.get("access_token") or "").strip()
    except (OSError, ValueError, TypeError, json.JSONDecodeError):
        return ""


def save_kis_access_token(app_key: str, token_payload: dict[str, Any]) -> None:
    access_token = str(token_payload.get("access_token") or "").strip()
    if not access_token:
        raise ValueError("KIS token response is missing access_token")
    expires_in = int(token_payload.get("expires_in") or 0)
    if expires_in <= 0:
        expires_in = 23 * 60 * 60
    expires_at = datetime.now(timezone.utc) + timedelta(seconds=expires_in)
    KIS_TOKEN_CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
    KIS_TOKEN_CACHE_PATH.write_text(json.dumps({
        "schema_version": "kis_access_token_cache.v1",
        "app_key_sha256": hashlib.sha256(app_key.encode("utf-8")).hexdigest(),
        "access_token": access_token,
        "expires_at_utc": expires_at.isoformat(),
    }, ensure_ascii=False, indent=2), encoding="utf-8")


def get_kis_access_token(app_key: str, app_secret: str) -> str:
    cached = load_cached_kis_access_token(app_key)
    if cached:
        return cached
    token_request = Request(
        f"{KIS_API_BASE}/oauth2/tokenP",
        data=json.dumps({
            "grant_type": "client_credentials",
            "appkey": app_key,
            "appsecret": app_secret,
        }).encode("utf-8"),
        headers={"Content-Type": "application/json; charset=utf-8"},
        method="POST",
    )
    token_request.add_header("User-Agent", KIS_USER_AGENT)
    with urlopen(token_request, timeout=30) as response:
        token_payload = json.loads(response.read().decode("utf-8"))
    access_token = str(token_payload.get("access_token") or "").strip()
    if not access_token:
        raise ValueError("KIS token response is missing access_token")
    save_kis_access_token(app_key, token_payload)
    return access_token


def fetch_kis_foreign_flow_snapshots(
    app_key: str,
    app_secret: str,
) -> dict[str, dict[str, Any]]:
    access_token = get_kis_access_token(app_key, app_secret)

    results: dict[str, dict[str, Any]] = {}
    for metric_id, config in KIS_FLOW_CONFIG.items():
        query = urlencode({
            'fid_input_iscd': config['market'],
            'fid_input_iscd_2': config['subcode'],
        })
        request_url = f"{KIS_INVESTOR_ENDPOINT}?{query}"
        request = Request(
            request_url,
            headers={
                "authorization": f"Bearer {access_token}",
                "appkey": app_key,
                "appsecret": app_secret,
                "tr_id": "FHPTJ04030000",
                "custtype": "P",
                "Accept": "application/json",
                "User-Agent": KIS_USER_AGENT,
            },
        )
        with urlopen(request, timeout=30) as response:
            payload = json.loads(response.read().decode("utf-8"))
        if str(payload.get("rt_cd") or "") != "0":
            raise ValueError(f"KIS flow response failed for {metric_id}")
        output = payload.get("output")
        if isinstance(output, list) and len(output) == 1:
            output = output[0]
        if not isinstance(output, dict):
            raise ValueError(f"KIS flow response is missing output for {metric_id}")
        results[metric_id] = output
    return results


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


def collect_krx_stock(
    report_date: str,
    metric_id: str,
    auth_key: str,
    fetcher: Callable[[str, str, str], dict[str, Any]] = fetch_krx_json,
) -> dict[str, Any]:
    source_url = KRX_STOCK_ENDPOINT
    if not auth_key:
        return missing_metric(metric_id, "missing_krx_open_api_authorization", source_url)
    report_day = date.fromisoformat(report_date)
    stock = KRX_STOCKS[metric_id]
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
                and str(row.get("ISU_CD") or "").strip() == stock["isu_cd"]
            ]
            if not matched:
                if rows:
                    return missing_metric(metric_id, "security_not_found", source_url)
                continue
            row = matched[0]
            as_of = date.fromisoformat(str(row["BAS_DD"]))
            observations_found.append((
                as_of,
                parse_krx_number(row.get("TDD_CLSPRC")),
                parse_krx_number(row.get("FLUC_RT")),
            ))
            if len(observations_found) >= 6:
                break
        if observations_found:
            as_of, current_value, current_change = observations_found[0]
            age_days = (report_day - as_of).days
            max_age_days = 4
            five_day_base = observations_found[5] if len(observations_found) >= 6 else None
            return {
                "metric_id": metric_id,
                "label": stock["label"],
                "status": "available" if age_days <= max_age_days else "stale",
                "value": current_value,
                "unit": "KRW per share",
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
                    if five_day_base else
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
                "security_code": stock["isu_cd"],
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


def collect_usdkrw_ecos(
    report_date: str,
    api_key: str,
    fetcher: Callable[[str, str, str], list[tuple[date, float]]] = fetch_ecos_usdkrw,
) -> dict[str, Any]:
    if not api_key:
        return missing_metric("usdkrw", "missing_bok_ecos_api_key", ECOS_SOURCE_URL)
    report_day = date.fromisoformat(report_date)
    try:
        values = [
            item for item in fetcher(
                api_key,
                (report_day - timedelta(days=45)).strftime("%Y%m%d"),
                report_day.strftime("%Y%m%d"),
            )
            if item[0] <= report_day
        ]
    except Exception as exc:
        return {
            **missing_metric("usdkrw", "provider_error", ECOS_SOURCE_URL),
            "error_type": type(exc).__name__,
        }
    if len(values) < 2:
        return missing_metric("usdkrw", "insufficient_observations", ECOS_SOURCE_URL)
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
        "source_provider": "Bank of Korea ECOS",
        "source_url": ECOS_SOURCE_URL,
        "source_grade": "A",
        "primary_source_confirmed": True,
        "evidence_label": "fact_source_reported",
        "market_cutoff": "latest_available_daily_reference_rate",
        "series_code": ECOS_USDKRW_STAT_CODE,
        "item_code": ECOS_USDKRW_ITEM_CODE,
    }


def collect_kis_foreign_flows(
    report_date: str,
    app_key: str,
    app_secret: str,
    fetcher: Callable[[str, str], dict[str, dict[str, Any]]] = fetch_kis_foreign_flow_snapshots,
) -> dict[str, dict[str, Any]]:
    if not app_key or not app_secret:
        return {
            metric_id: missing_metric(
                metric_id,
                "missing_kis_open_api_authorization",
                KIS_INVESTOR_ENDPOINT,
            )
            for metric_id in KIS_FLOW_CONFIG
        }
    report_day = date.fromisoformat(report_date)
    session_day = report_day
    while session_day.weekday() >= 5:
        session_day -= timedelta(days=1)
    try:
        snapshots = fetcher(app_key, app_secret)
        results: dict[str, dict[str, Any]] = {}
        for metric_id, config in KIS_FLOW_CONFIG.items():
            output = snapshots.get(metric_id)
            if not isinstance(output, dict):
                raise ValueError(f"KIS flow snapshot is missing {metric_id}")
            provider_value = parse_krx_number(output.get(config["field"]))
            multiplier = int(config["multiplier"])
            value = provider_value * multiplier
            if multiplier == 1:
                value = int(value)
            results[metric_id] = {
                "metric_id": metric_id,
                "label": config["label"],
                "status": "available",
                "value": value,
                "unit": config["unit"],
                "as_of": session_day.isoformat(),
                "age_days": (report_day - session_day).days,
                "max_age_days": 4,
                "change_1d_pct": None,
                "change_5d_pct": None,
                "source_provider": "Korea Investment & Securities Open API",
                "upstream_source": "Korea Exchange market data",
                "source_url": KIS_INVESTOR_ENDPOINT,
                "source_grade": "B",
                "primary_source_confirmed": False,
                "evidence_label": "fact_licensed_provider_reported",
                "market_cutoff": "latest_provider_market_snapshot",
                "as_of_derivation": "latest_weekday_on_or_before_report_date",
                "provider_value": provider_value,
                "provider_unit": config["provider_unit"],
            }
        return results
    except Exception as exc:
        return {
            metric_id: {
                **missing_metric(
                    metric_id,
                    "provider_or_authorization_error",
                    KIS_INVESTOR_ENDPOINT,
                ),
                "error_type": type(exc).__name__,
            }
            for metric_id in KIS_FLOW_CONFIG
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
    response_cache: dict[tuple[str, str], dict[str, Any]] = {}

    def cached_fetcher(url: str, key: str, bas_dd: str) -> dict[str, Any]:
        cache_key = (url, bas_dd)
        if cache_key not in response_cache:
            response_cache[cache_key] = krx_fetcher(url, key, bas_dd)
        return response_cache[cache_key]

    for key in KRX_METRIC_KEYS:
        supplied = payload["metrics"].get(key) if payload else None
        if not supplied:
            if key in KRX_INDEX_ENDPOINTS:
                results[key] = collect_krx_index(
                    report_date,
                    key,
                    krx_auth_key,
                    cached_fetcher,
                )
            elif key in KRX_STOCKS:
                results[key] = collect_krx_stock(
                    report_date,
                    key,
                    krx_auth_key,
                    cached_fetcher,
                )
            else:
                results[key] = missing_metric(
                    key,
                    (
                        "not_supplied_by_verified_input"
                        if payload else
                        "not_available_in_connected_krx_services"
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
    ecos_api_key: str = "",
    kis_app_key: str = "",
    kis_app_secret: str = "",
    fred_fetcher: Callable[[str, str, str], list[tuple[date, float]]] = observations,
    ecos_fetcher: Callable[[str, str, str], list[tuple[date, float]]] = fetch_ecos_usdkrw,
    krx_fetcher: Callable[[str, str, str], dict[str, Any]] = fetch_krx_json,
    kis_fetcher: Callable[[str, str], dict[str, dict[str, Any]]] = fetch_kis_foreign_flow_snapshots,
) -> dict[str, Any]:
    usdkrw = (
        collect_usdkrw_ecos(report_date, ecos_api_key, ecos_fetcher)
        if ecos_api_key else
        collect_usdkrw(report_date, fred_api_key, fred_fetcher)
    )
    krx_metrics = normalized_krx_metrics(
        report_date,
        official_krx_input,
        krx_auth_key,
        krx_fetcher,
    )
    supplied_metrics = (official_krx_input or {}).get("metrics") or {}
    kis_flows = collect_kis_foreign_flows(
        report_date,
        kis_app_key,
        kis_app_secret,
        kis_fetcher,
    )
    for metric_id, metric in kis_flows.items():
        if metric_id not in supplied_metrics:
            krx_metrics[metric_id] = metric
    metrics = {
        "usdkrw": usdkrw,
        **krx_metrics,
    }
    available = [key for key, item in metrics.items() if item.get("status") == "available"]
    missing = [key for key, item in metrics.items() if item.get("status") != "available"]
    date_alignment = evaluate_market_date_alignment(metrics)
    price_ready = all(key in available for key in ("usdkrw", "kospi", "kosdaq"))
    full_ready = price_ready and all(
        key in available for key in (
            "foreign_kospi_cash_net_buy_krw",
            "foreign_kospi200_futures_net_buy_contracts",
        )
    )
    gate_status = (
        "ready_for_korea_transmission"
        if full_ready and date_alignment["status"] == "aligned" else
        "ready_for_korea_transmission_with_source_lag"
        if full_ready and date_alignment["status"] == "source_lag_within_tolerance" else
        "misaligned_verified_korea_data"
        if full_ready and date_alignment["status"] == "source_lag_exceeds_tolerance" else
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
            "date_alignment": date_alignment,
            "decision_limit": (
                "Do not infer Korean-market direction from U.S. assets when required prices "
                "or flows are unavailable, or when their source dates differ by more than "
                "one business day."
            ),
        },
        "source_policy": (
            "USD/KRW prefers Bank of Korea ECOS when configured and otherwise uses FRED. "
            "KRX indices and listed-stock closes use approved KRX Open API services. "
            "KOSPI cash and KOSPI 200 futures foreign flows use the licensed KIS Open API "
            "market snapshot unless an official verified input overrides them."
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
        ecos_api_key=os.getenv("BOK_ECOS_API_KEY", "").strip(),
        kis_app_key=os.getenv("KIS_APP_KEY", "").strip(),
        kis_app_secret=os.getenv("KIS_APP_SECRET", "").strip(),
    )
    output = write_payload(payload)
    print(
        f"Korea market snapshot saved: {output.relative_to(ROOT)} "
        f"({payload['collection_status']})"
    )


if __name__ == "__main__":
    main()
