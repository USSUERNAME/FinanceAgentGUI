"""Load and validate the stable sector taxonomy used by the report pipeline."""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from typing import Any

from collectors.common import ROOT

DEFAULT_SECTOR_MASTER_PATH = ROOT / "sector_master.json"
SCHEMA_VERSION = "sector_master.v1"

_ID_PATTERN = re.compile(r"^[a-z][a-z0-9_]*$")
_TICKER_PATTERN = re.compile(r"^[A-Z0-9][A-Z0-9.\-]{0,14}$")
_ALLOWED_MARKETS = {"US", "KR"}
_ALLOWED_INSTRUMENT_TYPES = {"ETF", "EQUITY"}
_ALLOWED_PROXY_ROLES = {"sector_proxy", "theme_proxy", "broad_proxy"}
_ALLOWED_EXPOSURE_STATES = {"candidate_unverified", "verified_primary"}
_ALLOWED_DIRECTIONS = {"up", "down", "context_dependent"}
_ALLOWED_SENSITIVITIES = {"positive", "negative", "mixed"}


def _require(condition: bool, message: str) -> None:
    if not condition:
        raise ValueError(message)


def _require_text(value: Any, field: str) -> str:
    _require(isinstance(value, str) and bool(value.strip()), f"{field} must be non-empty text")
    return value.strip()


def _require_id(value: Any, field: str) -> str:
    text = _require_text(value, field)
    _require(bool(_ID_PATTERN.fullmatch(text)), f"{field} must be lower_snake_case: {text}")
    return text


def _validate_security(item: dict[str, Any], field: str, *, proxy: bool) -> None:
    market = _require_text(item.get("market"), f"{field}.market")
    _require(market in _ALLOWED_MARKETS, f"{field}.market is unsupported: {market}")
    ticker = _require_text(item.get("ticker"), f"{field}.ticker")
    _require(bool(_TICKER_PATTERN.fullmatch(ticker)), f"{field}.ticker is invalid: {ticker}")
    instrument_type = _require_text(item.get("instrument_type"), f"{field}.instrument_type")
    _require(
        instrument_type in _ALLOWED_INSTRUMENT_TYPES,
        f"{field}.instrument_type is unsupported: {instrument_type}",
    )
    _require_text(item.get("name"), f"{field}.name")
    role_field = "proxy_role" if proxy else "exposure_status"
    allowed = _ALLOWED_PROXY_ROLES if proxy else _ALLOWED_EXPOSURE_STATES
    role = _require_text(item.get(role_field), f"{field}.{role_field}")
    _require(role in allowed, f"{field}.{role_field} is unsupported: {role}")


def validate_sector_master(payload: dict[str, Any]) -> dict[str, Any]:
    """Reject ambiguous IDs and incomplete research metadata before ingestion."""
    _require(isinstance(payload, dict), "sector master must be a JSON object")
    _require(payload.get("schema_version") == SCHEMA_VERSION, f"schema_version must be {SCHEMA_VERSION}")
    _require_text(payload.get("version_date"), "version_date")

    scoring = payload.get("scoring_dimensions")
    _require(isinstance(scoring, list) and scoring, "scoring_dimensions must be a non-empty list")
    score_ids: set[str] = set()
    total_weight = 0
    for index, dimension in enumerate(scoring):
        field = f"scoring_dimensions[{index}]"
        _require(isinstance(dimension, dict), f"{field} must be an object")
        score_id = _require_id(dimension.get("dimension_id"), f"{field}.dimension_id")
        _require(score_id not in score_ids, f"duplicate scoring dimension: {score_id}")
        score_ids.add(score_id)
        weight = dimension.get("weight")
        _require(isinstance(weight, int) and 0 < weight <= 100, f"{field}.weight must be an integer from 1 to 100")
        total_weight += weight
        _require_text(dimension.get("label_ko"), f"{field}.label_ko")
    _require(total_weight == 100, f"scoring dimension weights must total 100, got {total_weight}")

    evidence_policy = payload.get("default_evidence_policy")
    _require(isinstance(evidence_policy, dict), "default_evidence_policy must be an object")
    _require(
        isinstance(evidence_policy.get("minimum_independent_sources"), int)
        and evidence_policy["minimum_independent_sources"] >= 2,
        "default evidence policy requires at least two independent sources",
    )

    sectors = payload.get("sectors")
    _require(isinstance(sectors, list) and sectors, "sectors must be a non-empty list")
    sector_ids: set[str] = set()
    for index, sector in enumerate(sectors):
        field = f"sectors[{index}]"
        _require(isinstance(sector, dict), f"{field} must be an object")
        sector_id = _require_id(sector.get("sector_id"), f"{field}.sector_id")
        _require(sector_id not in sector_ids, f"duplicate sector_id: {sector_id}")
        sector_ids.add(sector_id)
        _require_text(sector.get("name_ko"), f"{field}.name_ko")
        _require_text(sector.get("name_en"), f"{field}.name_en")
        _require_text(sector.get("classification"), f"{field}.classification")

        anchors = sector.get("gics_anchors")
        _require(isinstance(anchors, list) and anchors, f"{field}.gics_anchors must be non-empty")
        _require(all(isinstance(value, str) and value.strip() for value in anchors), f"{field}.gics_anchors contains blank values")

        pathways = sector.get("beneficiary_pathways")
        _require(isinstance(pathways, list) and pathways, f"{field}.beneficiary_pathways must be non-empty")
        pathway_ids: set[str] = set()
        for path_index, pathway in enumerate(pathways):
            path_field = f"{field}.beneficiary_pathways[{path_index}]"
            _require(isinstance(pathway, dict), f"{path_field} must be an object")
            pathway_id = _require_id(pathway.get("pathway_id"), f"{path_field}.pathway_id")
            _require(pathway_id not in pathway_ids, f"duplicate pathway_id in {sector_id}: {pathway_id}")
            pathway_ids.add(pathway_id)
            _require_text(pathway.get("label_ko"), f"{path_field}.label_ko")
            _require_text(pathway.get("economic_link"), f"{path_field}.economic_link")

        proxies = sector.get("market_proxies")
        _require(isinstance(proxies, list) and proxies, f"{field}.market_proxies must be non-empty")
        representatives = sector.get("representative_companies")
        _require(isinstance(representatives, list) and representatives, f"{field}.representative_companies must be non-empty")
        security_keys: set[tuple[str, str]] = set()
        for security_index, security in enumerate(proxies):
            security_field = f"{field}.market_proxies[{security_index}]"
            _require(isinstance(security, dict), f"{security_field} must be an object")
            _validate_security(security, security_field, proxy=True)
            key = (security["market"], security["ticker"])
            _require(key not in security_keys, f"duplicate security in {sector_id}: {key}")
            security_keys.add(key)
        for security_index, security in enumerate(representatives):
            security_field = f"{field}.representative_companies[{security_index}]"
            _require(isinstance(security, dict), f"{security_field} must be an object")
            _validate_security(security, security_field, proxy=False)
            key = (security["market"], security["ticker"])
            _require(key not in security_keys, f"duplicate security in {sector_id}: {key}")
            security_keys.add(key)

        indicators = sector.get("leading_indicators")
        _require(isinstance(indicators, list) and len(indicators) >= 3, f"{field} needs at least three leading indicators")
        indicator_ids: set[str] = set()
        for indicator_index, indicator in enumerate(indicators):
            indicator_field = f"{field}.leading_indicators[{indicator_index}]"
            _require(isinstance(indicator, dict), f"{indicator_field} must be an object")
            indicator_id = _require_id(indicator.get("indicator_id"), f"{indicator_field}.indicator_id")
            _require(indicator_id not in indicator_ids, f"duplicate indicator in {sector_id}: {indicator_id}")
            indicator_ids.add(indicator_id)
            _require_text(indicator.get("label_ko"), f"{indicator_field}.label_ko")
            direction = _require_text(indicator.get("improving_direction"), f"{indicator_field}.improving_direction")
            _require(direction in _ALLOWED_DIRECTIONS, f"unsupported improving_direction: {direction}")
            _require_text(indicator.get("frequency"), f"{indicator_field}.frequency")
            sources = indicator.get("preferred_source_types")
            _require(isinstance(sources, list) and sources, f"{indicator_field}.preferred_source_types must be non-empty")

        sensitivities = sector.get("macro_sensitivities")
        _require(isinstance(sensitivities, list) and sensitivities, f"{field}.macro_sensitivities must be non-empty")
        for sensitivity_index, sensitivity in enumerate(sensitivities):
            sensitivity_field = f"{field}.macro_sensitivities[{sensitivity_index}]"
            _require_id(sensitivity.get("factor_id"), f"{sensitivity_field}.factor_id")
            direction = _require_text(sensitivity.get("direction"), f"{sensitivity_field}.direction")
            _require(direction in _ALLOWED_SENSITIVITIES, f"unsupported sensitivity direction: {direction}")

        keywords = sector.get("keywords")
        _require(isinstance(keywords, dict), f"{field}.keywords must be an object")
        for language in ("ko", "en"):
            values = keywords.get(language)
            _require(isinstance(values, list) and values, f"{field}.keywords.{language} must be non-empty")

        requirements = sector.get("evidence_requirements")
        _require(isinstance(requirements, dict), f"{field}.evidence_requirements must be an object")
        _require(
            isinstance(requirements.get("minimum_independent_sources"), int)
            and requirements["minimum_independent_sources"] >= 2,
            f"{field} requires at least two independent sources",
        )
        classes = requirements.get("required_evidence_classes")
        _require(isinstance(classes, list) and classes, f"{field}.required_evidence_classes must be non-empty")

    return payload


def load_sector_master(path: str | Path | None = None) -> dict[str, Any]:
    target = Path(path) if path else DEFAULT_SECTOR_MASTER_PATH
    payload = json.loads(target.read_text(encoding="utf-8"))
    return validate_sector_master(payload)


def sector_by_id(payload: dict[str, Any], sector_id: str) -> dict[str, Any] | None:
    return next((sector for sector in payload.get("sectors", []) if sector.get("sector_id") == sector_id), None)


def sectors_for_ticker(payload: dict[str, Any], ticker: str, market: str | None = None) -> list[dict[str, Any]]:
    """Return every sector containing a proxy or candidate company for a ticker."""
    normalized_ticker = ticker.strip().upper()
    normalized_market = market.strip().upper() if market else None
    matches: list[dict[str, Any]] = []
    for sector in payload.get("sectors", []):
        securities = sector.get("market_proxies", []) + sector.get("representative_companies", [])
        if any(
            security.get("ticker") == normalized_ticker
            and (normalized_market is None or security.get("market") == normalized_market)
            for security in securities
        ):
            matches.append(sector)
    return matches


def main() -> None:
    parser = argparse.ArgumentParser(description="Validate the sector research master")
    parser.add_argument("--path", type=Path, default=DEFAULT_SECTOR_MASTER_PATH)
    args = parser.parse_args()
    payload = load_sector_master(args.path)
    proxy_count = sum(len(sector["market_proxies"]) for sector in payload["sectors"])
    company_count = sum(len(sector["representative_companies"]) for sector in payload["sectors"])
    indicator_count = sum(len(sector["leading_indicators"]) for sector in payload["sectors"])
    print(
        f"Validated {len(payload['sectors'])} sectors | "
        f"{proxy_count} market proxies | {company_count} candidate companies | "
        f"{indicator_count} leading indicators"
    )


if __name__ == "__main__":
    main()
