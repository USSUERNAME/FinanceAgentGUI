"""Collect estimate revisions and validate primary-source operating disclosures."""

from __future__ import annotations

import argparse
import json
import os
import time
from datetime import date, datetime, timezone
from pathlib import Path
from statistics import median
from typing import Any, Callable
from urllib.parse import urlencode, urlsplit

from collectors.common import ROOT, get_json, load_dotenv
from sector_master import load_sector_master

REGISTRY_PATH = ROOT / "sector_fundamental_registry.json"
SCHEMA_VERSION = "sector_fundamental_observations.v1"


def _number(value: Any) -> float | None:
    if value in {None, "", ".", "None"}:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _is_http_url(value: Any) -> bool:
    if not isinstance(value, str):
        return False
    parsed = urlsplit(value)
    return parsed.scheme in {"http", "https"} and bool(parsed.netloc)


def load_fundamental_registry(path: Path = REGISTRY_PATH) -> dict[str, Any]:
    registry = json.loads(path.read_text(encoding="utf-8"))
    validate_fundamental_registry(registry)
    return registry


def validate_fundamental_registry(registry: dict[str, Any]) -> None:
    if registry.get("schema_version") != "sector_fundamental_registry.v1":
        raise ValueError("Unexpected sector fundamental registry schema")
    master = load_sector_master()
    sectors = {item["sector_id"]: item for item in master["sectors"]}
    focus = registry.get("focus_sector_ids", [])
    if not focus or len(focus) != len(set(focus)) or any(item not in sectors for item in focus):
        raise ValueError("Focus sectors must be unique valid sector IDs")
    estimates = registry.get("earnings_revisions", {})
    if estimates.get("function") != "EARNINGS_ESTIMATES":
        raise ValueError("Earnings revision provider function must be EARNINGS_ESTIMATES")
    if int(estimates.get("minimum_companies_for_sector_score", 0)) < 2:
        raise ValueError("Earnings revisions require at least two companies")
    orders = registry.get("orders_capex_backlog", {})
    if int(orders.get("minimum_companies_for_sector_score", 0)) < 2:
        raise ValueError("Orders/CAPEX/backlog requires at least two companies")
    for exposure in registry.get("verified_exposures", []):
        sector = sectors.get(exposure.get("sector_id"))
        if not sector:
            raise ValueError(f"Unknown verified exposure sector: {exposure.get('sector_id')}")
        key = (exposure.get("market"), exposure.get("ticker"))
        representatives = {
            (item["market"], item["ticker"]) for item in sector["representative_companies"]
        }
        if key not in representatives:
            raise ValueError(f"Verified exposure is not in sector master: {key}")
        if not _is_http_url(exposure.get("source_url")) or not exposure.get("body_location"):
            raise ValueError(f"Verified exposure needs a primary URL and body location: {key}")
        if exposure.get("primary_source_confirmed") is not True:
            raise ValueError(f"Verified exposure must be primary-confirmed: {key}")
        if not str(exposure.get("evidence_summary") or "").strip():
            raise ValueError(f"Verified exposure needs an evidence summary: {key}")
    operating_ids = [item.get("record_id") for item in registry.get("verified_operating_metrics", [])]
    if len(operating_ids) != len(set(operating_ids)):
        raise ValueError("Verified operating metric IDs must be unique")


def verified_exposure_map(registry: dict[str, Any]) -> dict[tuple[str, str, str], dict[str, Any]]:
    return {
        (item["sector_id"], item["market"], item["ticker"]): item
        for item in registry.get("verified_exposures", [])
    }


def estimate_revision_score(row: dict[str, Any]) -> dict[str, Any]:
    current = _number(row.get("eps_estimate_average"))
    prior = _number(row.get("eps_estimate_average_30_days_ago"))
    up = _number(row.get("eps_estimate_revision_up_trailing_30_days")) or 0.0
    down = _number(row.get("eps_estimate_revision_down_trailing_30_days")) or 0.0
    revision_pct = None
    if current is not None and prior is not None and current > 0 and prior > 0:
        revision_pct = (current / prior - 1) * 100
    breadth = (up - down) / (up + down) if up + down > 0 else None
    if revision_pct is None and breadth is None:
        return {"score": None, "revision_pct": None, "revision_breadth": None}
    score = 50.0
    if revision_pct is not None:
        score += max(-30.0, min(revision_pct * 4.0, 30.0))
    if breadth is not None:
        score += max(-20.0, min(breadth * 20.0, 20.0))
    return {
        "score": round(max(0.0, min(score, 100.0)), 2),
        "revision_pct": round(revision_pct, 4) if revision_pct is not None else None,
        "revision_breadth": round(breadth, 4) if breadth is not None else None,
    }


def select_estimate_rows(payload: dict[str, Any], report_day: date) -> list[dict[str, Any]]:
    future = []
    for row in payload.get("estimates", []):
        try:
            period_date = date.fromisoformat(str(row.get("date")))
        except ValueError:
            continue
        if period_date < report_day or row.get("horizon") not in {"fiscal quarter", "fiscal year"}:
            continue
        scored = estimate_revision_score(row)
        future.append({
            "fiscal_period_end": period_date.isoformat(),
            "horizon": row.get("horizon"),
            "eps_estimate_average": _number(row.get("eps_estimate_average")),
            "eps_estimate_average_30_days_ago": _number(row.get("eps_estimate_average_30_days_ago")),
            "eps_estimate_analyst_count": _number(row.get("eps_estimate_analyst_count")),
            "revision_up_30d": _number(row.get("eps_estimate_revision_up_trailing_30_days")),
            "revision_down_30d": _number(row.get("eps_estimate_revision_down_trailing_30_days")),
            "revenue_estimate_average": _number(row.get("revenue_estimate_average")),
            "revenue_estimate_analyst_count": _number(row.get("revenue_estimate_analyst_count")),
            **scored,
        })
    selected: list[dict[str, Any]] = []
    for horizon in ("fiscal quarter", "fiscal year"):
        matches = sorted((item for item in future if item["horizon"] == horizon), key=lambda item: item["fiscal_period_end"])
        if matches:
            selected.append(matches[0])
    return selected


def fetch_alpha_vantage_estimates(ticker: str, api_key: str) -> dict[str, Any]:
    query = urlencode({"function": "EARNINGS_ESTIMATES", "symbol": ticker, "apikey": api_key})
    return get_json(f"https://www.alphavantage.co/query?{query}")


def estimate_universe(registry: dict[str, Any], master: dict[str, Any]) -> list[dict[str, str]]:
    allowed = set(registry["earnings_revisions"]["allowed_markets"])
    limit = int(registry["earnings_revisions"]["max_companies_per_sector"])
    focus = set(registry["focus_sector_ids"])
    rows: list[dict[str, str]] = []
    for sector in master["sectors"]:
        if sector["sector_id"] not in focus:
            continue
        eligible = [item for item in sector["representative_companies"] if item["market"] in allowed]
        for company in eligible[:limit]:
            rows.append({
                "sector_id": sector["sector_id"],
                "market": company["market"],
                "ticker": company["ticker"],
                "company_name": company["name"],
            })
    return rows


def collect_estimate_observations(
    report_date: str,
    api_key: str,
    registry: dict[str, Any],
    fetcher: Callable[[str, str], dict[str, Any]] = fetch_alpha_vantage_estimates,
    sleeper: Callable[[float], None] = time.sleep,
    delay_seconds: float = 0.0,
    max_companies: int | None = None,
) -> tuple[list[dict[str, Any]], list[dict[str, str]]]:
    if not api_key:
        return [], []
    report_day = date.fromisoformat(report_date)
    master = load_sector_master()
    exposure_map = verified_exposure_map(registry)
    universe = estimate_universe(registry, master)
    if max_companies is not None:
        universe = universe[:max_companies]
    observations: list[dict[str, Any]] = []
    errors: list[dict[str, str]] = []
    for index, company in enumerate(universe):
        if index and delay_seconds > 0:
            sleeper(delay_seconds)
        try:
            payload = fetcher(company["ticker"], api_key)
            if payload.get("Information") or payload.get("Note") or payload.get("Error Message"):
                raise ValueError("provider notice or unavailable symbol")
            rows = select_estimate_rows(payload, report_day)
            row_scores = [float(item["score"]) for item in rows if isinstance(item.get("score"), (int, float))]
            candidate_score = round(median(row_scores), 2) if row_scores else None
            exposure = exposure_map.get((company["sector_id"], company["market"], company["ticker"]))
            observations.append({
                **company,
                "dimension_id": "earnings_revisions",
                "status": "available" if candidate_score is not None else "missing_revision_history",
                "score_candidate": candidate_score,
                "score": candidate_score if exposure and candidate_score is not None else None,
                "eligible_for_sector_score": bool(exposure and candidate_score is not None),
                "exposure_status": "verified_primary" if exposure else "candidate_unverified",
                "exposure_source_url": exposure.get("source_url") if exposure else None,
                "exposure_body_location": exposure.get("body_location") if exposure else None,
                "source_provider": registry["earnings_revisions"]["provider"],
                "source_url": registry["earnings_revisions"]["source_url"],
                "source_grade": registry["earnings_revisions"]["source_grade"],
                "primary_source_confirmed": False,
                "as_of": report_date,
                "rows": rows,
                "formula_version": "earnings_revisions.v1",
                "note": "Consensus direction is not sector exposure proof.",
            })
        except Exception as exc:
            errors.append({"ticker": company["ticker"], "sector_id": company["sector_id"], "error": str(exc)})
    return observations, errors


def validate_operating_input(record: dict[str, Any], registry: dict[str, Any], report_day: date) -> dict[str, Any]:
    policy = registry["orders_capex_backlog"]
    required = {
        "record_id", "sector_id", "market", "ticker", "company_name", "metric_type",
        "current_value", "prior_value", "unit", "currency", "current_period",
        "prior_period", "source_type", "source_url", "source_date", "body_location",
        "primary_source_confirmed", "body_verified", "exposure_verified",
        "exposure_source_url", "exposure_body_location",
    }
    missing = sorted(required - set(record))
    if missing:
        raise ValueError(f"{record.get('record_id', 'record')} missing fields: {missing}")
    text_fields = (
        "record_id", "sector_id", "market", "ticker", "company_name", "metric_type",
        "unit", "currency", "current_period", "prior_period", "source_type",
        "body_location", "exposure_body_location",
    )
    if any(not isinstance(record.get(field), str) or not record[field].strip() for field in text_fields):
        raise ValueError("Operating input contains a blank required text field")
    if record["current_period"] == record["prior_period"]:
        raise ValueError("Operating input current and prior periods must differ")
    if record["sector_id"] not in registry["focus_sector_ids"]:
        raise ValueError("Operating input sector is outside the focus registry")
    sector = next(item for item in load_sector_master()["sectors"] if item["sector_id"] == record["sector_id"])
    representative_keys = {
        (item["market"], item["ticker"]) for item in sector["representative_companies"]
    }
    if (record["market"], record["ticker"]) not in representative_keys:
        raise ValueError("Operating input company is not registered in the sector master")
    if record["metric_type"] not in policy["allowed_metric_types"]:
        raise ValueError("Unsupported orders/CAPEX/backlog metric type")
    if record["source_type"] not in policy["allowed_source_types"]:
        raise ValueError("Operating input must come from a company filing or IR source")
    if not all((record["primary_source_confirmed"], record["body_verified"], record["exposure_verified"])):
        raise ValueError("Operating input requires primary body and exposure verification")
    if not _is_http_url(record["source_url"]) or not _is_http_url(record["exposure_source_url"]):
        raise ValueError("Operating input requires primary source and exposure URLs")
    if not str(record["body_location"]).strip() or not str(record["exposure_body_location"]).strip():
        raise ValueError("Operating input requires exact body locations")
    if date.fromisoformat(record["source_date"]) > report_day:
        raise ValueError("Operating input source date is after report date")
    current, prior = _number(record["current_value"]), _number(record["prior_value"])
    if current is None or prior is None or prior <= 0:
        raise ValueError("Operating input requires positive comparable numeric values")
    change_pct = (current / prior - 1) * 100
    score = 50.0 + max(-40.0, min(change_pct * 1.5, 40.0))
    return {
        **record,
        "dimension_id": "orders_capex_backlog",
        "status": "available",
        "score": round(max(0.0, min(score, 100.0)), 2),
        "change_pct": round(change_pct, 4),
        "source_grade": "A",
        "eligible_for_sector_score": True,
        "formula_version": "orders_capex_backlog.v1",
    }


def load_operating_inputs(report_date: str, registry: dict[str, Any]) -> tuple[list[dict[str, Any]], list[dict[str, str]]]:
    directory = ROOT / "workspace" / "sector_fundamental_inputs" / report_date
    if not directory.exists():
        return [], []
    accepted: list[dict[str, Any]] = []
    errors: list[dict[str, str]] = []
    seen_ids: set[str] = set()
    for path in sorted(directory.glob("*.json")):
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
            rows = payload if isinstance(payload, list) else payload.get("records", [])
        except Exception as exc:
            errors.append({"file": str(path.relative_to(ROOT)), "error": str(exc)})
            continue
        for row in rows:
            try:
                record_id = str(row.get("record_id") or "")
                if record_id in seen_ids:
                    raise ValueError(f"duplicate operating record ID: {record_id}")
                validated = validate_operating_input(row, registry, date.fromisoformat(report_date))
                seen_ids.add(record_id)
                accepted.append(validated)
            except Exception as exc:
                errors.append({
                    "file": str(path.relative_to(ROOT)),
                    "record_id": str(row.get("record_id") or "unknown"),
                    "error": str(exc),
                })
    return accepted, errors


def load_registry_operating_inputs(
    report_date: str,
    registry: dict[str, Any],
) -> tuple[list[dict[str, Any]], list[dict[str, str]]]:
    report_day = date.fromisoformat(report_date)
    accepted: list[dict[str, Any]] = []
    errors: list[dict[str, str]] = []
    for row in registry.get("verified_operating_metrics", []):
        try:
            if report_day > date.fromisoformat(str(row.get("valid_until"))):
                continue
            accepted.append(validate_operating_input(row, registry, report_day))
        except Exception as exc:
            errors.append({
                "file": str(REGISTRY_PATH.relative_to(ROOT)),
                "record_id": str(row.get("record_id") or "unknown"),
                "error": str(exc),
            })
    return accepted, errors


def aggregate_dimension_scores(
    registry: dict[str, Any],
    estimate_observations: list[dict[str, Any]],
    operating_observations: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    results: list[dict[str, Any]] = []
    dimension_inputs = {
        "earnings_revisions": (
            estimate_observations,
            int(registry["earnings_revisions"]["minimum_companies_for_sector_score"]),
        ),
        "orders_capex_backlog": (
            operating_observations,
            int(registry["orders_capex_backlog"]["minimum_companies_for_sector_score"]),
        ),
    }
    for sector_id in registry["focus_sector_ids"]:
        for dimension_id, (observations, minimum) in dimension_inputs.items():
            candidate_rows = [
                item for item in observations
                if item.get("sector_id") == sector_id
                and (isinstance(item.get("score_candidate"), (int, float)) or isinstance(item.get("score"), (int, float)))
            ]
            rows = [
                item for item in observations
                if item.get("sector_id") == sector_id
                and item.get("eligible_for_sector_score") is True
                and isinstance(item.get("score"), (int, float))
            ]
            companies = sorted({f"{item.get('market')}:{item.get('ticker')}" for item in rows})
            candidate_companies = sorted({
                f"{item.get('market')}:{item.get('ticker')}" for item in candidate_rows
            })
            sources = sorted({str(item.get("source_url")) for item in rows if item.get("source_url")})
            required_sources = 1 if dimension_id == "earnings_revisions" else minimum
            available = len(companies) >= minimum and len(sources) >= required_sources
            results.append({
                "sector_id": sector_id,
                "dimension_id": dimension_id,
                "status": "available" if available else "insufficient_verified_company_coverage",
                "score": round(median(float(item["score"]) for item in rows), 2) if available else None,
                "confidence": "medium" if available else "none",
                "company_count": len(companies),
                "candidate_company_count": len(candidate_companies),
                "minimum_company_count": minimum,
                "independent_source_count": len(sources),
                "minimum_independent_source_count": required_sources,
                "companies": companies,
                "candidate_companies": candidate_companies,
                "source_urls": sources,
                "observation_ids": [item.get("record_id") or f"{item.get('market')}:{item.get('ticker')}" for item in rows],
                "note": "Research-priority input only; company coverage and primary-evidence gates apply.",
            })
    return results


def collect_sector_fundamentals(
    report_date: str,
    api_key: str,
    registry: dict[str, Any] | None = None,
    fetcher: Callable[[str, str], dict[str, Any]] = fetch_alpha_vantage_estimates,
    sleeper: Callable[[float], None] = time.sleep,
    delay_seconds: float = 0.0,
    max_companies: int | None = None,
) -> dict[str, Any]:
    registry = registry or load_fundamental_registry()
    estimates, estimate_errors = collect_estimate_observations(
        report_date, api_key, registry, fetcher, sleeper, delay_seconds, max_companies,
    )
    registry_operating, registry_errors = load_registry_operating_inputs(report_date, registry)
    manual_operating, manual_errors = load_operating_inputs(report_date, registry)
    operating: list[dict[str, Any]] = []
    operating_errors = [*registry_errors, *manual_errors]
    seen_operating_ids: set[str] = set()
    for item in [*registry_operating, *manual_operating]:
        record_id = str(item.get("record_id"))
        if record_id in seen_operating_ids:
            operating_errors.append({"record_id": record_id, "error": "duplicate operating record ID across inputs"})
            continue
        seen_operating_ids.add(record_id)
        operating.append(item)
    dimensions = aggregate_dimension_scores(registry, estimates, operating)
    return {
        "schema_version": SCHEMA_VERSION,
        "report_date": report_date,
        "registry_version": registry["version_date"],
        "collection_status": "missing_alpha_vantage_api_key" if not api_key else (
            "partial" if estimate_errors or operating_errors else "complete"
        ),
        "estimate_observations": estimates,
        "operating_observations": operating,
        "dimension_scores": dimensions,
        "errors": {"estimates": estimate_errors, "operating_inputs": operating_errors},
        "policy_note": "Unverified representative-company estimates are retained for monitoring but excluded from sector scores.",
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }


def write_sector_fundamentals(payload: dict[str, Any]) -> Path:
    output_dir = ROOT / "workspace" / "sector_fundamentals" / payload["report_date"]
    output_dir.mkdir(parents=True, exist_ok=True)
    output = output_dir / "sector_fundamentals.json"
    output.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return output


def main() -> None:
    parser = argparse.ArgumentParser(description="Collect verified sector fundamental signals")
    parser.add_argument("--date", default=date.today().isoformat())
    parser.add_argument("--max-companies", type=int)
    args = parser.parse_args()
    load_dotenv()
    delay = float(os.getenv("ALPHAVANTAGE_REQUEST_DELAY_SECONDS", "13"))
    payload = collect_sector_fundamentals(
        args.date,
        os.getenv("ALPHAVANTAGE_API_KEY", "").strip(),
        delay_seconds=delay,
        max_companies=args.max_companies,
    )
    output = write_sector_fundamentals(payload)
    available = sum(item.get("score") is not None for item in payload["dimension_scores"])
    print(f"Sector fundamentals saved: {output.relative_to(ROOT)}")
    print(
        f"Sector fundamentals status: {payload['collection_status']} | "
        f"estimate_candidates={len(payload['estimate_observations'])} | "
        f"scored_dimensions={available}"
    )


if __name__ == "__main__":
    main()
