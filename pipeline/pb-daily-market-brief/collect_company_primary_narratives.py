"""Collect bounded business and risk disclosures from official annual filings."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import time
from datetime import date, datetime
from pathlib import Path
from typing import Any, Callable
from zoneinfo import ZoneInfo

from build_us_equity_universe import normalize_ticker
from collectors.common import ROOT, load_dotenv
from collectors.filing_body import fetch_sec_document
from enrich_us_equity_candidate_evidence import SEC_TICKER_MAP_URL, _company_map
from fetch_sec_filings import archive_url, sec_json


SCHEMA_VERSION = "company_primary_narratives.v1"
ANNUAL_FORMS = {"10-K", "10-K/A", "20-F", "20-F/A"}
DEFAULT_MAX_COMPANIES = 4
DEFAULT_MAX_BODY_CHARS = 120_000
DEFAULT_MAX_SECTION_CHARS = 2_000


def _root_path(value: str | None, default: Path) -> Path:
    path = Path(value) if value else default
    return path if path.is_absolute() else ROOT / path


def latest_annual_filing(submissions: dict[str, Any], report_day: date) -> dict[str, str] | None:
    recent = (submissions.get("filings") or {}).get("recent") or {}
    rows: list[dict[str, str]] = []
    for index, form_value in enumerate(recent.get("form") or []):
        form = str(form_value).upper()
        if form not in ANNUAL_FORMS:
            continue
        try:
            filing_day = date.fromisoformat(str((recent.get("filingDate") or [])[index]))
            accession = str((recent.get("accessionNumber") or [])[index])
            primary = str((recent.get("primaryDocument") or [])[index])
        except (ValueError, IndexError):
            continue
        if filing_day <= report_day and accession and primary:
            rows.append({
                "form": form,
                "filing_date": filing_day.isoformat(),
                "accession": accession,
                "primary": primary,
            })
    if not rows:
        return None
    rows.sort(
        key=lambda row: (
            row["filing_date"],
            row["form"] in {"10-K", "20-F"},
        ),
        reverse=True,
    )
    return rows[0]


def _section(
    text: str,
    starts: tuple[str, ...],
    ends: tuple[str, ...],
    *,
    max_chars: int = DEFAULT_MAX_SECTION_CHARS,
) -> str:
    candidates: list[str] = []
    start_matches = [
        match
        for pattern in starts
        for match in re.finditer(pattern, text, flags=re.IGNORECASE)
    ]
    for start in sorted(start_matches, key=lambda match: match.start()):
        end_positions = [
            match.start()
            for pattern in ends
            for match in re.finditer(pattern, text[start.end():], flags=re.IGNORECASE)
            if match.start() >= 120
        ]
        end = start.end() + min(end_positions) if end_positions else min(len(text), start.end() + max_chars * 3)
        value = re.sub(r"\s+", " ", text[start.end():end]).strip(" .:-\n\t")
        if len(value) >= 180:
            candidates.append(value)
    if not candidates:
        return ""
    return max(candidates, key=len)[:max_chars].strip()


def extract_annual_narratives(text: str) -> dict[str, Any]:
    business = _section(
        text,
        (
            r"\bITEM\s+1\s*[.:\-]?\s*BUSINESS\b",
            r"\bITEM\s+1\s*[.:\-]?\s*DESCRIPTION\s+OF\s+BUSINESS\b",
        ),
        (
            r"\bITEM\s+1A\s*[.:\-]?\s*RISK\s+FACTORS\b",
            r"\bITEM\s+2\s*[.:\-]?\s*PROPERTIES\b",
        ),
    )
    risks = _section(
        text,
        (r"\bITEM\s+1A\s*[.:\-]?\s*RISK\s+FACTORS\b",),
        (
            r"\bITEM\s+1B\s*[.:\-]?",
            r"\bITEM\s+1C\s*[.:\-]?",
            r"\bITEM\s+2\s*[.:\-]?\s*PROPERTIES\b",
        ),
    )
    claim_keywords = (
        "competitive", "competition", "proprietary", "network effect",
        "switching", "ecosystem", "scale", "brand", "intellectual property",
        "patent", "customer retention", "market position",
    )
    claims: list[str] = []
    for sentence in re.split(r"(?<=[.!?])\s+", business):
        normalized = re.sub(r"\s+", " ", sentence).strip()
        lowered = normalized.casefold()
        if 60 <= len(normalized) <= 520 and any(keyword in lowered for keyword in claim_keywords):
            if normalized not in claims:
                claims.append(normalized)
        if len(claims) >= 3:
            break
    return {
        "business_excerpt": business,
        "risk_excerpt": risks,
        "competitive_claims": claims,
    }


def collect_company_primary_narratives(
    report_date: str,
    queue: dict[str, Any],
    *,
    user_agent: str,
    no_network: bool = False,
    max_companies: int = DEFAULT_MAX_COMPANIES,
    request_delay_seconds: float = 0.0,
    company_map_payload: dict[str, Any] | None = None,
    submissions_fetcher: Callable[[str], dict[str, Any]] | None = None,
    document_fetcher: Callable[..., dict[str, Any]] = fetch_sec_document,
) -> dict[str, Any]:
    candidates = [
        row for row in queue.get("candidates", [])
        if row.get("queue_stage") == "valuation_expectations_gated"
        and str(row.get("market") or "").upper() == "US"
    ][:max_companies]
    base = {
        "schema_version": SCHEMA_VERSION,
        "report_date": report_date,
        "network_enabled": not no_network,
        "eligible_company_count": len(candidates),
        "collected_company_count": 0,
        "companies": [],
        "audit": [],
        "policy": {
            "maximum_companies": max_companies,
            "annual_forms": sorted(ANNUAL_FORMS),
            "bounded_excerpts_only": True,
            "issuer_competitive_claims_are_not_independent_moat_verification": True,
            "management_execution_is_not_inferred_from_narrative_text": True,
        },
    }
    if no_network or not candidates:
        return {**base, "collection_status": "offline" if no_network else "no_eligible_companies"}
    if not user_agent or "@" not in user_agent:
        return {**base, "collection_status": "missing_sec_user_agent"}

    report_day = date.fromisoformat(report_date)
    mapping_payload = company_map_payload or sec_json(SEC_TICKER_MAP_URL, user_agent)
    mapping = _company_map(mapping_payload)
    fetch_submissions = submissions_fetcher or (
        lambda cik: sec_json(f"https://data.sec.gov/submissions/CIK{cik}.json", user_agent)
    )
    companies: list[dict[str, Any]] = []
    audit_rows: list[dict[str, Any]] = []
    for candidate in candidates:
        ticker = normalize_ticker(candidate.get("ticker"))
        audit = {"candidate_id": candidate.get("candidate_id"), "ticker": ticker, "status": "not_checked"}
        identity = mapping.get(ticker)
        if not identity:
            audit["status"] = "sec_company_mapping_missing"
            audit_rows.append(audit)
            continue
        try:
            submissions = fetch_submissions(identity["cik"])
            filing = latest_annual_filing(submissions, report_day)
        except Exception as exc:
            audit.update({"status": "sec_submissions_fetch_failed", "error_type": type(exc).__name__})
            audit_rows.append(audit)
            continue
        if not filing:
            audit["status"] = "annual_filing_not_found"
            audit_rows.append(audit)
            continue
        source_url = archive_url(identity["cik"], filing["accession"], filing["primary"])
        fetched = document_fetcher(
            source_url,
            user_agent,
            form=filing["form"],
            max_chars=DEFAULT_MAX_BODY_CHARS,
            max_bytes=8_000_000,
        )
        narratives = extract_annual_narratives(str(fetched.get("text") or ""))
        business = narratives["business_excerpt"]
        risks = narratives["risk_excerpt"]
        if not business:
            audit.update({"status": "business_section_not_extracted", "body_status": fetched.get("status")})
            audit_rows.append(audit)
            continue
        source_id = "SEC-ANNUAL-" + hashlib.sha256(
            f"{ticker}|{filing['accession']}".encode()
        ).hexdigest()[:16]
        companies.append({
            "candidate_id": candidate.get("candidate_id"),
            "ticker": ticker,
            "company_name": candidate.get("company_name") or submissions.get("name") or identity["name"],
            "cik": identity["cik"],
            "annual_filing": {
                "form": filing["form"],
                "filing_date": filing["filing_date"],
                "accession_number": filing["accession"],
                "source_id": source_id,
                "source_url": source_url,
                "source_grade": "A",
                "evidence_label": "verified_primary_issuer_disclosure",
                "rights_label": "SEC EDGAR public filing; bounded research excerpts only.",
            },
            "business_model": {
                "status": "verified_primary",
                "body_location": f"{filing['form']} Item 1 Business",
                "excerpt": business,
                "evidence_class": "issuer_disclosed_fact_and_claim",
            },
            "risk_factors": {
                "status": "verified_primary" if risks else "section_not_extracted",
                "body_location": f"{filing['form']} Item 1A Risk Factors" if risks else None,
                "excerpt": risks or None,
                "evidence_class": "issuer_disclosed_risk",
            },
            "competitive_advantage": {
                "status": (
                    "issuer_claims_available_not_independently_verified"
                    if narratives["competitive_claims"] else "not_verified"
                ),
                "verified": False,
                "issuer_claims": narratives["competitive_claims"],
                "independent_confirmation_required": True,
            },
            "management_execution": {
                "status": "not_verified",
                "verified": False,
                "reason": "연차보고서 사업 설명만으로 경영진 실행력을 판정하지 않습니다.",
            },
        })
        audit.update({"status": "annual_narrative_collected", "form": filing["form"], "filing_date": filing["filing_date"]})
        audit_rows.append(audit)
        if request_delay_seconds > 0:
            time.sleep(request_delay_seconds)

    payload = {
        **base,
        "collection_status": (
            "available" if len(companies) == len(candidates)
            else "partial" if companies else "unavailable"
        ),
        "collected_company_count": len(companies),
        "companies": companies,
        "audit": audit_rows,
    }
    validate_company_primary_narratives(payload)
    return payload


def validate_company_primary_narratives(payload: dict[str, Any]) -> None:
    if payload.get("schema_version") != SCHEMA_VERSION:
        raise ValueError("Unexpected company primary narratives schema")
    if int(payload.get("collected_company_count", -1)) != len(payload.get("companies", [])):
        raise ValueError("Collected company narrative count mismatch")
    tickers: set[str] = set()
    for company in payload.get("companies", []):
        ticker = str(company.get("ticker") or "")
        if not ticker or ticker in tickers:
            raise ValueError("Company primary narratives require unique tickers")
        tickers.add(ticker)
        filing = company.get("annual_filing") or {}
        if filing.get("form") not in ANNUAL_FORMS:
            raise ValueError("Company narrative must come from an annual filing")
        if not str(filing.get("source_url") or "").startswith("https://www.sec.gov/"):
            raise ValueError("Company narrative requires an official SEC source URL")
        business = company.get("business_model") or {}
        if business.get("status") != "verified_primary" or not business.get("excerpt"):
            raise ValueError("Collected company narrative requires a business excerpt")
        advantage = company.get("competitive_advantage") or {}
        if advantage.get("verified") is not False:
            raise ValueError("Issuer competitive claims cannot independently verify a moat")
        if (company.get("management_execution") or {}).get("verified") is not False:
            raise ValueError("Narrative text cannot independently verify management execution")


def main() -> None:
    parser = argparse.ArgumentParser(description="Collect official annual business narratives")
    parser.add_argument("--date", required=True)
    parser.add_argument("--queue-file")
    parser.add_argument("--output-file")
    parser.add_argument("--no-network", action="store_true")
    parser.add_argument("--max-companies", type=int)
    args = parser.parse_args()
    load_dotenv()
    queue_path = _root_path(
        args.queue_file,
        ROOT / "workspace" / "company_research_queue" / args.date / "company_research_queue.json",
    )
    if not queue_path.exists():
        raise SystemExit(f"Company research queue does not exist: {queue_path}")
    payload = collect_company_primary_narratives(
        args.date,
        json.loads(queue_path.read_text(encoding="utf-8-sig")),
        user_agent=os.getenv("SEC_USER_AGENT", "").strip(),
        no_network=args.no_network,
        max_companies=max(1, min(args.max_companies or DEFAULT_MAX_COMPANIES, 6)),
        request_delay_seconds=max(0.0, float(os.getenv("SEC_REQUEST_DELAY_SECONDS", "0.25"))),
    )
    payload["generated_at"] = datetime.now(
        ZoneInfo(os.getenv("BRIEF_TIMEZONE", "Asia/Seoul"))
    ).isoformat()
    output = _root_path(
        args.output_file,
        ROOT / "workspace" / "company_primary_narratives" / args.date / "company_primary_narratives.json",
    )
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Company primary narratives saved: {output.relative_to(ROOT)}")
    print(
        "Company primary narratives status: "
        f"{payload['collection_status']} | "
        f"companies={payload['collected_company_count']}/{payload['eligible_company_count']}"
    )


if __name__ == "__main__":
    main()
