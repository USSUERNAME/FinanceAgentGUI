"""Collect reviewed public research documents from official publisher URLs.

This adapter is intentionally allowlist-only. It downloads only explicitly
configured documents from official domains and passes them through the same
no-redistribution broker-research gate used by operator-supplied reports.
"""

from __future__ import annotations

from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path
from typing import Any, Callable
from urllib.parse import urlsplit
from urllib.request import Request, urlopen

from broker_research_policy import DOCUMENT_TEXT_CACHE_DIR, report_record
from candidate_pipeline import domain_for_url, domain_matches

FetchedDocument = tuple[bytes, str, dict[str, str]]


def _download_document(url: str, *, max_bytes: int) -> FetchedDocument:
    request = Request(
        url,
        headers={
            "User-Agent": (
                "PB-Daily-Market-Brief/1.0 "
                "(official public institutional research document)"
            ),
        },
    )
    with urlopen(request, timeout=45) as response:
        payload = response.read(max_bytes + 1)
        if len(payload) > max_bytes:
            raise ValueError("Official research document exceeds the size limit")
        headers = {
            "content-type": str(response.headers.get("Content-Type") or ""),
            "last-modified": str(response.headers.get("Last-Modified") or ""),
        }
        return payload, str(response.geturl() or url), headers


def _published_at(headers: dict[str, str], reference_time: datetime) -> str:
    value = str(headers.get("last-modified") or "").strip()
    if value:
        try:
            parsed = parsedate_to_datetime(value)
            if parsed.tzinfo is None:
                parsed = parsed.replace(tzinfo=timezone.utc)
            return parsed.astimezone(timezone.utc).isoformat()
        except (TypeError, ValueError):
            pass
    return reference_time.astimezone(timezone.utc).isoformat()


def _document_name(source: dict[str, Any], final_url: str) -> str:
    configured = str(source.get("file_name") or "").strip()
    if configured:
        return Path(configured).name
    name = Path(urlsplit(final_url).path).name
    return name or f"{source.get('id') or 'official_research'}.pdf"


def collect(
    config: dict[str, Any],
    *,
    fetcher: Callable[..., FetchedDocument] = _download_document,
    now: datetime | None = None,
) -> tuple[list[dict[str, Any]], str | None]:
    sources = config.get("official_research_documents") or []
    if not sources:
        return [], "No official research documents configured"

    reference_time = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
    records: list[dict[str, Any]] = []
    failures = 0
    for source in sources[:10]:
        if not isinstance(source, dict) or not source.get("enabled", True):
            continue
        document_url = str(source.get("document_url") or "").strip()
        official_domains = [
            str(value).strip()
            for value in source.get("official_domains") or []
            if str(value).strip()
        ]
        if (
            not document_url
            or not official_domains
            or not domain_matches(domain_for_url(document_url), official_domains)
        ):
            failures += 1
            continue
        try:
            max_bytes = max(
                100_000,
                min(int(source.get("max_bytes", 20_000_000)), 30_000_000),
            )
            payload, final_url, headers = fetcher(
                document_url,
                max_bytes=max_bytes,
            )
            if not domain_matches(domain_for_url(final_url), official_domains):
                raise ValueError("Official document redirected outside its allowlist")
            file_name = _document_name(source, final_url)
            if Path(file_name).suffix.lower() == ".pdf" and not payload.startswith(b"%PDF"):
                raise ValueError("Official research PDF has an invalid signature")
            published_at = _published_at(headers, reference_time)
            metadata = {
                "publisher": str(source.get("publisher") or source.get("id") or ""),
                "title": str(source.get("title") or Path(file_name).stem),
                "published_at": published_at,
                "source_reference": final_url,
                "source_url": str(source.get("landing_page_url") or final_url),
                "acquisition_mode": "official_public_document",
                "analysis_allowed": True,
                "redistribution_allowed": False,
                "publication_policy": "summary_and_link_only",
                "rights_review_status": "public_source_reviewed",
                "rights_label": str(
                    source.get("rights_label")
                    or "Official publisher document; summary and source link only."
                ),
                "tags": [
                    "institutional_research",
                    "attributed_analysis",
                    *[
                        str(value)
                        for value in source.get("tags") or []
                        if str(value).strip()
                    ],
                ],
                "tickers": [
                    str(value)
                    for value in source.get("tickers") or []
                    if str(value).strip()
                ],
                "market_scope": str(source.get("market_scope") or "GLOBAL"),
                "issuer_country": str(source.get("issuer_country") or ""),
                "original_language": str(source.get("original_language") or "en"),
                "base_currency": str(source.get("base_currency") or ""),
                "research_path": [
                    str(value)
                    for value in source.get("research_path") or []
                    if str(value).strip()
                ],
                "observation_date": published_at[:10],
                "release_date": published_at,
                "market_cutoff": "official_document_last_modified",
                "research": {
                    "analyst": str(source.get("analyst") or ""),
                    "report_type": str(
                        source.get("report_type") or "market_strategy"
                    ),
                    "stance": "not_stated",
                    "summary": "",
                    "key_claims": [],
                    "catalysts": [],
                    "risks": [],
                    "sectors": [
                        str(value)
                        for value in source.get("sectors") or []
                        if str(value).strip()
                    ],
                },
            }
            records.append(
                report_record(
                    source_id=str(source.get("id") or "official_research_document"),
                    file_name=file_name,
                    payload=payload,
                    metadata=metadata,
                    document_text_cache_dir=DOCUMENT_TEXT_CACHE_DIR,
                )
            )
        except (OSError, RuntimeError, TypeError, ValueError):
            failures += 1

    notice = (
        f"{failures} official research document(s) failed the source or document gate"
        if failures
        else None
    )
    if not records and notice is None:
        notice = "Official research document collection produced no records"
    return records, notice
