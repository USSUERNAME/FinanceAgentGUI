"""Attach bounded SEC and company-IR evidence to market-anomaly candidates.

The initial candidate screen is intentionally market-data only when no matching
primary record is already in the normalized inbox.  This second pass checks a
small number of top-ranked candidates against SEC's official company registry,
recent filings, and the SEC-declared investor-relations site.  It emits
normalized evidence records; the screen is then rebuilt with those records.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import time
from datetime import date, datetime, timedelta
from html.parser import HTMLParser
from pathlib import Path
from typing import Any, Callable
from urllib.parse import urljoin, urlsplit
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo

from build_us_equity_universe import normalize_ticker, root_path
from collectors.common import ROOT, load_dotenv
from collectors.filing_body import extract_filing_text, fetch_sec_document
from collectors.filing_facts import extract_filing_facts
from fetch_sec_filings import archive_url, sec_json

SCHEMA_VERSION = "candidate_official_evidence.v1"
SCREEN_SCHEMA_VERSION = "us_equity_candidate_screen.v1"
SEC_TICKER_MAP_URL = "https://www.sec.gov/files/company_tickers.json"
ACCEPTED_FORMS = {"8-K", "10-Q", "10-K", "6-K", "20-F"}
DEFAULT_MAX_CANDIDATES = 6
DEFAULT_MAX_VERIFIED_RECORDS = 3
DEFAULT_LOOKBACK_DAYS = 7
DEFAULT_MAX_BODY_CHARS = 8000


class InvestorPageParser(HTMLParser):
    """Collect visible links and common publication metadata from an IR page."""

    def __init__(self) -> None:
        super().__init__()
        self.links: list[dict[str, str]] = []
        self.current_href = ""
        self.current_text: list[str] = []
        self.published_at = ""
        self.title = ""
        self._in_title = False

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        values = {str(key).casefold(): str(value or "") for key, value in attrs}
        lowered = tag.casefold()
        if lowered == "a":
            self.current_href = values.get("href", "")
            self.current_text = []
        elif lowered == "title":
            self._in_title = True
        elif lowered == "meta":
            key = (values.get("property") or values.get("name") or "").casefold()
            if key in {
                "article:published_time", "date", "datepublished", "publishdate",
                "publication_date", "parsely-pub-date",
            }:
                self.published_at = values.get("content", "")

    def handle_endtag(self, tag: str) -> None:
        lowered = tag.casefold()
        if lowered == "a" and self.current_href:
            self.links.append({
                "href": self.current_href,
                "text": re.sub(r"\s+", " ", " ".join(self.current_text)).strip(),
            })
            self.current_href = ""
            self.current_text = []
        elif lowered == "title":
            self._in_title = False

    def handle_data(self, data: str) -> None:
        if self.current_href:
            self.current_text.append(data)
        if self._in_title:
            self.title = re.sub(r"\s+", " ", f"{self.title} {data}").strip()


def _official_host(url: str) -> str:
    return (urlsplit(str(url or "")).hostname or "").casefold().removeprefix("www.")


def _same_official_host(url: str, expected_host: str) -> bool:
    host = _official_host(url)
    return bool(host and expected_host and (host == expected_host or host.endswith(f".{expected_host}")))


def _parse_publication_date(value: str, url: str = "") -> date | None:
    candidates = [str(value or ""), str(url or "")]
    patterns = (
        r"(?<!\d)(20\d{2})[-/](\d{1,2})[-/](\d{1,2})(?!\d)",
        r"(?<!\d)(20\d{2})(\d{2})(\d{2})(?!\d)",
    )
    for candidate in candidates:
        for pattern in patterns:
            match = re.search(pattern, candidate)
            if not match:
                continue
            try:
                return date(int(match.group(1)), int(match.group(2)), int(match.group(3)))
            except ValueError:
                continue
    return None


def _within_window(published: date | None, report_day: date, lookback_days: int) -> bool:
    return bool(published and report_day - timedelta(days=lookback_days) <= published <= report_day)


def _context(text: str, start: int, end: int, radius: int = 140) -> str:
    return re.sub(r"\s+", " ", text[max(0, start - radius):min(len(text), end + radius)]).strip()


def extract_ir_facts(text: str, source_url: str) -> list[dict[str, Any]]:
    """Return exact number excerpts only when a financial keyword is nearby."""

    facts: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()
    amount_pattern = re.compile(
        r"(?:"
        r"\$\s?(?:\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)(?:\s?(?:million|billion|thousand|mn|bn))?"
        r"|(?:\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s?(?:%|million|billion|thousand|mn|bn)"
        r")",
        flags=re.IGNORECASE,
    )
    keyword_fields = (
        ("revenue", "reported_revenue_candidate"),
        ("net sales", "reported_revenue_candidate"),
        ("operating income", "reported_operating_income_candidate"),
        ("operating margin", "reported_operating_margin_candidate"),
        ("net income", "reported_net_income_candidate"),
        ("free cash flow", "reported_fcf_candidate"),
        ("guidance", "management_guidance_candidate"),
        ("outlook", "management_outlook_candidate"),
    )
    for match in amount_pattern.finditer(text):
        value = match.group(0).strip()
        if not re.search(r"\d", value):
            continue
        excerpt = _context(text, match.start(), match.end())
        lowered = excerpt.casefold()
        field = next((name for keyword, name in keyword_fields if keyword in lowered), "")
        if not field:
            continue
        key = (field, value)
        if key in seen:
            continue
        seen.add(key)
        fingerprint = hashlib.sha256(f"{source_url}|{field}|{value}|{excerpt}".encode()).hexdigest()[:20]
        facts.append({
            "fact_id": fingerprint,
            "field": field,
            "value_text": value,
            "context": excerpt,
            "evidence_status": "exact_official_ir_excerpt",
            "evidence_scope": "bounded_official_ir_body_excerpt",
            "source_url": source_url,
        })
        if len(facts) >= 8:
            break
    return facts


def _request_html(url: str, user_agent: str, max_bytes: int = 2_000_000) -> dict[str, Any]:
    request = Request(url, headers={"User-Agent": user_agent, "Accept": "text/html,application/xhtml+xml"})
    try:
        with urlopen(request, timeout=30) as response:
            content_type = str(response.headers.get("Content-Type") or "").casefold()
            if "html" not in content_type:
                return {"status": "unsupported_content_type", "url": response.geturl()}
            raw = response.read(max_bytes + 1)
            if len(raw) > max_bytes:
                return {"status": "response_too_large", "url": response.geturl()}
            charset = response.headers.get_content_charset() or "utf-8"
            return {
                "status": "html_fetched",
                "url": response.geturl(),
                "html": raw.decode(charset, errors="replace"),
            }
    except Exception as exc:
        return {"status": "fetch_failed", "url": url, "error_type": type(exc).__name__}


def _rank_ir_links(landing_url: str, html: str, expected_host: str) -> list[str]:
    parser = InvestorPageParser()
    parser.feed(html)
    ranked: list[tuple[int, str]] = []
    seen: set[str] = set()
    for link in parser.links:
        url = urljoin(landing_url, link["href"])
        if url in seen or not _same_official_host(url, expected_host):
            continue
        seen.add(url)
        searchable = f"{link['text']} {url}".casefold()
        score = sum(
            weight for token, weight in (
                ("earnings", 8), ("financial results", 8), ("quarter", 5),
                ("guidance", 6), ("press release", 4), ("news release", 4),
                ("results", 3), ("investor", 1),
            ) if token in searchable
        )
        if score:
            ranked.append((score, url))
    return [url for _score, url in sorted(ranked, reverse=True)[:2]]


def _ir_record(
    ticker: str,
    company_name: str,
    investor_website: str,
    report_day: date,
    lookback_days: int,
    user_agent: str,
    page_fetcher: Callable[[str, str], dict[str, Any]],
) -> tuple[dict[str, Any] | None, dict[str, Any]]:
    expected_host = _official_host(investor_website)
    audit: dict[str, Any] = {"investor_website": investor_website, "status": "not_checked"}
    if not investor_website.startswith("https://") or not expected_host:
        audit["status"] = "invalid_sec_declared_investor_website"
        return None, audit
    landing = page_fetcher(investor_website, user_agent)
    audit["landing_status"] = landing.get("status")
    if landing.get("status") != "html_fetched" or not _same_official_host(str(landing.get("url") or ""), expected_host):
        audit["status"] = "investor_landing_unavailable"
        return None, audit
    for url in _rank_ir_links(str(landing.get("url")), str(landing.get("html") or ""), expected_host):
        document = page_fetcher(url, user_agent)
        if document.get("status") != "html_fetched" or not _same_official_host(str(document.get("url") or ""), expected_host):
            continue
        final_url = str(document.get("url") or url)
        parser = InvestorPageParser()
        parser.feed(str(document.get("html") or ""))
        published = _parse_publication_date(parser.published_at, final_url)
        if not _within_window(published, report_day, lookback_days):
            continue
        body = extract_filing_text(str(document.get("html") or ""), DEFAULT_MAX_BODY_CHARS)
        facts = extract_ir_facts(body, final_url)
        if not facts:
            continue
        record_id = hashlib.sha256(f"company_ir|{ticker}|{final_url}".encode()).hexdigest()[:24]
        audit.update({"status": "verified_company_ir", "source_url": final_url})
        return {
            "id": f"company-ir-{record_id}",
            "source_id": "company_ir",
            "source_type": "official_release",
            "published_at": f"{published.isoformat()}T00:00:00+00:00",
            "title": parser.title or f"{company_name} official investor release",
            "url": final_url,
            "tickers": [ticker],
            "tags": ["earnings", "guidance", "candidate_official_enrichment"],
            "source_grade": "A",
            "primary_source_confirmed": True,
            "evidence_scope": "official_ir_body_excerpt",
            "evidence_label": "verified_primary_full_text",
            "freshness_state": "current_official_ir",
            "publisher": expected_host,
            "source_url_kind": "primary_source",
            "verified_facts": facts,
            "rights_label": "SEC-declared official investor site; bounded research excerpts only.",
        }, audit
    audit["status"] = "no_recent_verified_ir_release"
    return None, audit


def _company_map(payload: dict[str, Any]) -> dict[str, dict[str, Any]]:
    result: dict[str, dict[str, Any]] = {}
    for row in payload.values():
        if not isinstance(row, dict):
            continue
        ticker = normalize_ticker(row.get("ticker"))
        cik = str(row.get("cik_str") or "").strip()
        if ticker and cik:
            result[ticker] = {"cik": cik.zfill(10), "name": str(row.get("title") or ticker)}
    return result


def _recent_filings(submissions: dict[str, Any], report_day: date, lookback_days: int) -> list[dict[str, str]]:
    recent = (submissions.get("filings") or {}).get("recent") or {}
    forms = recent.get("form") or []
    rows: list[dict[str, str]] = []
    for index, form in enumerate(forms):
        if str(form).upper() not in ACCEPTED_FORMS:
            continue
        try:
            filed = date.fromisoformat(str((recent.get("filingDate") or [])[index]))
        except (ValueError, IndexError):
            continue
        if not _within_window(filed, report_day, lookback_days):
            continue
        try:
            accession = str(recent["accessionNumber"][index])
            primary = str(recent["primaryDocument"][index])
        except (KeyError, IndexError):
            continue
        if accession and primary:
            rows.append({"form": str(form).upper(), "filing_date": filed.isoformat(), "accession": accession, "primary": primary})
    priority = {"8-K": 0, "6-K": 1, "10-Q": 2, "10-K": 3, "20-F": 4}
    return sorted(rows, key=lambda row: (row["filing_date"], -priority.get(row["form"], 99)), reverse=True)


def _sec_record(
    ticker: str,
    company_name: str,
    cik: str,
    filing: dict[str, str],
    user_agent: str,
    document_fetcher: Callable[..., dict[str, Any]],
) -> tuple[dict[str, Any] | None, dict[str, Any]]:
    url = archive_url(cik, filing["accession"], filing["primary"])
    body = document_fetcher(url, user_agent, form=filing["form"], max_chars=DEFAULT_MAX_BODY_CHARS)
    audit = {"form": filing["form"], "filing_date": filing["filing_date"], "source_url": url, "body_status": body.get("status")}
    text = str(body.get("text") or "").strip()
    if not text:
        audit["status"] = "filing_body_unavailable"
        return None, audit
    record_id = hashlib.sha256(f"sec|{filing['accession']}|{ticker}".encode()).hexdigest()[:24]
    record: dict[str, Any] = {
        "id": f"candidate-sec-{record_id}",
        "source_id": "sec_edgar",
        "source_type": "filing",
        "published_at": f"{filing['filing_date']}T00:00:00+00:00",
        "title": f"{ticker} {filing['form']} filed | {company_name}",
        "url": url,
        "tickers": [ticker],
        "tags": ["sec", filing["form"], "candidate_official_enrichment"],
        "source_grade": "A",
        "primary_source_confirmed": True,
        "evidence_scope": "filing_body_excerpt",
        "evidence_label": "verified_primary_body_excerpt",
        "freshness_state": "current_candidate_filing_body",
        "publisher": "SEC EDGAR",
        "source_url_kind": "primary_source",
        "filing_accession_number": filing["accession"],
        "raw_text": text,
        "rights_label": "SEC EDGAR public filing; bounded research excerpts only.",
    }
    record["filing_facts"] = extract_filing_facts(record)
    if not record["filing_facts"].get("facts"):
        audit["status"] = "filing_body_without_supported_facts"
        return None, audit
    record.pop("raw_text", None)
    audit["status"] = "verified_sec_filing"
    return record, audit


def collect_candidate_official_evidence(
    report_date: str,
    screen: dict[str, Any],
    *,
    user_agent: str,
    no_network: bool = False,
    max_candidates: int = DEFAULT_MAX_CANDIDATES,
    max_verified_records: int = DEFAULT_MAX_VERIFIED_RECORDS,
    lookback_days: int = DEFAULT_LOOKBACK_DAYS,
    request_delay_seconds: float = 0.0,
    company_map_payload: dict[str, Any] | None = None,
    submissions_fetcher: Callable[[str], dict[str, Any]] | None = None,
    document_fetcher: Callable[..., dict[str, Any]] = fetch_sec_document,
    ir_page_fetcher: Callable[[str, str], dict[str, Any]] = _request_html,
) -> dict[str, Any]:
    if screen.get("schema_version") != SCREEN_SCHEMA_VERSION or screen.get("report_date") != report_date:
        raise ValueError("Candidate screen schema or report date does not match")
    candidates = [row for row in screen.get("candidates", []) if row.get("deep_analysis_eligible") is not True][:max_candidates]
    base = {
        "schema_version": SCHEMA_VERSION,
        "report_date": report_date,
        "network_enabled": not no_network,
        "candidate_count": len(candidates),
        "checked_candidate_count": 0,
        "verified_record_count": 0,
        "records": [],
        "candidate_audit": [],
        "policy": {
            "maximum_candidates_checked": max_candidates,
            "maximum_verified_records": max_verified_records,
            "lookback_days": lookback_days,
            "official_body_and_exact_fact_required": True,
            "market_anomaly_alone_never_promotes": True,
        },
    }
    if no_network or not candidates:
        return base
    if not user_agent or "@" not in user_agent:
        return {**base, "status": "missing_sec_user_agent"}
    report_day = date.fromisoformat(report_date)
    mapping_payload = company_map_payload or sec_json(SEC_TICKER_MAP_URL, user_agent)
    mapping = _company_map(mapping_payload)
    fetch_submissions = submissions_fetcher or (
        lambda cik: sec_json(f"https://data.sec.gov/submissions/CIK{cik}.json", user_agent)
    )
    records: list[dict[str, Any]] = []
    audits: list[dict[str, Any]] = []
    for candidate in candidates:
        if len(records) >= max_verified_records:
            break
        ticker = normalize_ticker(candidate.get("ticker"))
        audit: dict[str, Any] = {"ticker": ticker, "status": "not_checked", "official_sources": []}
        identity = mapping.get(ticker)
        if not identity:
            audit["status"] = "sec_company_mapping_missing"
            audits.append(audit)
            continue
        try:
            submissions = fetch_submissions(identity["cik"])
        except Exception as exc:
            audit.update({"status": "sec_submissions_fetch_failed", "error_type": type(exc).__name__})
            audits.append(audit)
            continue
        company_name = str(candidate.get("company_name") or submissions.get("name") or identity["name"])
        verified: dict[str, Any] | None = None
        for filing in _recent_filings(submissions, report_day, lookback_days)[:1]:
            verified, filing_audit = _sec_record(
                ticker, company_name, identity["cik"], filing, user_agent, document_fetcher
            )
            audit["official_sources"].append({"source_type": "sec_filing", **filing_audit})
            if verified:
                audit["status"] = "verified_sec_filing"
                break
        investor_website = str(submissions.get("investorWebsite") or "").strip()
        if verified is None and investor_website:
            verified, ir_audit = _ir_record(
                ticker, company_name, investor_website, report_day, lookback_days,
                user_agent, ir_page_fetcher,
            )
            audit["official_sources"].append({"source_type": "company_ir", **ir_audit})
            if verified:
                audit["status"] = "verified_company_ir"
        if verified:
            records.append(verified)
        elif audit["status"] == "not_checked":
            audit["status"] = "no_recent_verified_official_material"
        audits.append(audit)
        if request_delay_seconds > 0:
            time.sleep(request_delay_seconds)
    return {
        **base,
        "status": "verified_records_ready" if records else "no_recent_verified_official_material",
        "checked_candidate_count": len(audits),
        "verified_record_count": len(records),
        "records": records,
        "candidate_audit": audits,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Enrich U.S. equity candidates with official evidence")
    parser.add_argument("--date", required=True)
    parser.add_argument("--candidate-screen-file")
    parser.add_argument("--output-file")
    parser.add_argument("--no-network", action="store_true")
    args = parser.parse_args()
    load_dotenv()
    screen_path = root_path(
        args.candidate_screen_file,
        ROOT / "workspace" / "us_equity_candidate_screen" / args.date / "candidate_screen.json",
    )
    if not screen_path.exists():
        raise SystemExit(f"Candidate screen does not exist: {screen_path}")
    payload = collect_candidate_official_evidence(
        args.date,
        json.loads(screen_path.read_text(encoding="utf-8")),
        user_agent=os.getenv("SEC_USER_AGENT", "").strip(),
        no_network=args.no_network,
        max_candidates=max(1, min(int(os.getenv("US_CANDIDATE_EVIDENCE_MAX_CANDIDATES", str(DEFAULT_MAX_CANDIDATES))), 10)),
        max_verified_records=max(1, min(int(os.getenv("US_CANDIDATE_EVIDENCE_MAX_VERIFIED", str(DEFAULT_MAX_VERIFIED_RECORDS))), 3)),
        lookback_days=max(1, min(int(os.getenv("US_CANDIDATE_EVIDENCE_LOOKBACK_DAYS", str(DEFAULT_LOOKBACK_DAYS))), 30)),
        request_delay_seconds=max(0.0, float(os.getenv("SEC_REQUEST_DELAY_SECONDS", "0.25"))),
    )
    payload["generated_at"] = datetime.now(ZoneInfo(os.getenv("BRIEF_TIMEZONE", "Asia/Seoul"))).isoformat()
    output = root_path(
        args.output_file,
        ROOT / "workspace" / "candidate_official_evidence" / args.date / "candidate_official_evidence.json",
    )
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Candidate official evidence saved: {output.relative_to(ROOT)}")
    print(
        f"Candidate official evidence: checked={payload['checked_candidate_count']} | "
        f"verified={payload['verified_record_count']} | status={payload.get('status', 'offline')}"
    )


if __name__ == "__main__":
    main()
