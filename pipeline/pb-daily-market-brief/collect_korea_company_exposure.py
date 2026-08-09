"""Verify Korean company pathway and relationship evidence from official IR sources."""

from __future__ import annotations

import argparse
import html
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable
from urllib.request import Request, urlopen

from collectors.common import ROOT


SCHEMA_VERSION = "korea_company_exposure.v1"
REGISTRY_SCHEMA = "korea_company_exposure_sources.v1"
DEFAULT_REGISTRY_PATH = ROOT.parents[1] / "config" / "korea-company-exposure-sources.json"


def _load(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8-sig"))
    if not isinstance(value, dict):
        raise ValueError(f"Expected JSON object: {path}")
    return value


def _fetch_text(url: str) -> str:
    request = Request(
        url,
        headers={
            "User-Agent": "FinanceAgentGUI/1.0 official-source-verifier",
            "Accept-Language": "en-US,en;q=0.8,ko;q=0.6",
        },
    )
    with urlopen(request, timeout=30) as response:
        body = response.read().decode(response.headers.get_content_charset() or "utf-8", errors="replace")
    body = re.sub(r"(?is)<script[^>]*>.*?</script>|<style[^>]*>.*?</style>", " ", body)
    body = re.sub(r"(?s)<[^>]+>", " ", body)
    return re.sub(r"\s+", " ", html.unescape(body)).strip()


def _verify_source(source: dict[str, Any], fetch_text: Callable[[str], str]) -> dict[str, Any]:
    url = str(source.get("url") or "")
    result = {
        "source_id": source.get("source_id"),
        "source_type": source.get("source_type"),
        "published_at": source.get("published_at"),
        "url": url,
        "relationship_scope": source.get("relationship_scope"),
        "source_tickers": list(source.get("source_tickers") or []),
        "status": "fetch_failed",
        "evidence_summary": None,
        "missing_term_groups": [],
        "error": None,
    }
    try:
        text = fetch_text(url)
    except Exception as exc:  # network errors are recorded without promoting evidence
        result["error"] = str(exc)[:300]
        return result
    lowered = text.casefold()
    missing = []
    for group in source.get("required_term_groups") or []:
        terms = [str(term).strip() for term in group if str(term).strip()]
        if terms and not any(term.casefold() in lowered for term in terms):
            missing.append(terms)
    result["missing_term_groups"] = missing
    if missing:
        result["status"] = "required_terms_missing"
        return result
    result["status"] = "verified_primary"
    result["evidence_summary"] = source.get("evidence_summary")
    return result


def collect_korea_company_exposure(
    report_date: str,
    *,
    registry: dict[str, Any],
    fetch_text: Callable[[str], str] = _fetch_text,
) -> dict[str, Any]:
    if registry.get("schema_version") != REGISTRY_SCHEMA:
        raise ValueError("Unexpected Korea company exposure source registry schema")
    companies = []
    request_count = 0
    verified_source_count = 0
    for company in registry.get("companies", []):
        exposure_rows = []
        relationship_rows = []
        for source in company.get("exposure_sources") or []:
            request_count += 1
            row = _verify_source(source, fetch_text)
            exposure_rows.append(row)
            verified_source_count += row["status"] == "verified_primary"
        for source in company.get("relationship_sources") or []:
            request_count += 1
            row = _verify_source(source, fetch_text)
            relationship_rows.append(row)
            verified_source_count += row["status"] == "verified_primary"
        exposure_verified = bool(exposure_rows) and all(
            row["status"] == "verified_primary" for row in exposure_rows
        )
        direct_rows = [
            row for row in relationship_rows
            if row["status"] == "verified_primary"
            and row.get("relationship_scope") == "direct_supply_or_codevelopment"
        ]
        collaboration_rows = [
            row for row in relationship_rows
            if row["status"] == "verified_primary"
            and row.get("relationship_scope") == "industry_collaboration"
        ]
        companies.append({
            "market": "KR",
            "ticker": company.get("ticker"),
            "company_name": company.get("company_name"),
            "sector_id": company.get("sector_id"),
            "exposure_status": "verified_primary" if exposure_verified else "candidate_unverified",
            "verified_pathway_ids": (
                list(company.get("verified_pathway_ids") or []) if exposure_verified else []
            ),
            "exposure_evidence": exposure_rows,
            "relationship_evidence": {
                "status": "verified_primary" if direct_rows else "industry_collaboration_primary" if collaboration_rows else "not_verified",
                "source_tickers": sorted({
                    str(ticker).upper()
                    for row in direct_rows
                    for ticker in row.get("source_tickers") or []
                }),
                "sources": relationship_rows,
            },
        })
    payload = {
        "schema_version": SCHEMA_VERSION,
        "report_date": report_date,
        "collected_at": datetime.now(timezone.utc).isoformat(),
        "status": (
            "verified" if companies and all(row["exposure_status"] == "verified_primary" for row in companies)
            else "partial"
        ),
        "summary": {
            "company_count": len(companies),
            "request_count": request_count,
            "verified_source_count": int(verified_source_count),
        },
        "companies": companies,
        "policy": dict(registry.get("policy") or {}),
    }
    validate_korea_company_exposure(payload)
    return payload


def validate_korea_company_exposure(payload: dict[str, Any]) -> None:
    if payload.get("schema_version") != SCHEMA_VERSION:
        raise ValueError("Unexpected Korea company exposure schema")
    for company in payload.get("companies", []):
        relationship = company.get("relationship_evidence") or {}
        if relationship.get("status") == "verified_primary" and not relationship.get("source_tickers"):
            raise ValueError("Verified direct relationship requires an explicit source ticker")
        if company.get("exposure_status") != "verified_primary" and company.get("verified_pathway_ids"):
            raise ValueError("Unverified company exposure cannot carry verified pathways")


def main() -> None:
    parser = argparse.ArgumentParser(description="Verify Korean company exposure from official sources")
    parser.add_argument("--date", required=True)
    parser.add_argument("--registry-file")
    args = parser.parse_args()
    registry_path = Path(args.registry_file) if args.registry_file else DEFAULT_REGISTRY_PATH
    payload = collect_korea_company_exposure(args.date, registry=_load(registry_path))
    output = ROOT / "workspace" / "korea_company_exposure" / args.date / "korea_company_exposure.json"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(
        f"Korea company exposure saved: {output.relative_to(ROOT)} "
        f"({payload['summary']['verified_source_count']}/{payload['summary']['request_count']})"
    )


if __name__ == "__main__":
    main()
