"""Expose the already-fetched SEC filing metadata through the common inbox."""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

from collectors.common import ROOT, make_item
from collectors.filing_body import fetch_sec_document
from collectors.filing_facts import extract_filing_facts

SEC_INBOX = ROOT / "workspace" / "inbox"


def collect(config: dict[str, Any]) -> tuple[list[dict[str, Any]], str | None]:
    if not SEC_INBOX.exists():
        return [], "No SEC inbox exists yet; run fetch_sec_filings.py first"

    settings = config.get("sec_filings", {})
    fetch_bodies = bool(settings.get("fetch_bodies", False))
    max_body_fetches = max(0, min(int(settings.get("max_body_fetches", 3)), 10))
    max_body_chars = max(1000, min(int(settings.get("max_body_chars", 6000)), 12000))
    user_agent = os.getenv("SEC_USER_AGENT", "").strip()
    fetched_bodies = 0
    seen_accessions: set[str] = set()
    items: list[dict[str, Any]] = []
    for path in sorted(SEC_INBOX.glob("sec_filings_*.json"), reverse=True):
        try:
            rows = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as exc:
            return [], f"Unreadable SEC inbox {path.name}: {exc}"
        for row in rows:
            accession = str(row.get("accession_number") or "").strip()
            if accession and accession in seen_accessions:
                continue
            if accession:
                seen_accessions.add(accession)
            ticker = row.get("ticker", "")
            form = row.get("form", "SEC filing")
            filed = row.get("filing_date", "")
            company = row.get("company", ticker)
            source_url = str(row.get("source_url") or "")
            body = (
                fetch_sec_document(source_url, user_agent, form=form, max_chars=max_body_chars)
                if fetch_bodies and fetched_bodies < max_body_fetches
                else {"status": "body_fetch_not_selected", "text": None}
            )
            if fetch_bodies and fetched_bodies < max_body_fetches:
                fetched_bodies += 1
            body_text = str(body.get("text") or "").strip()
            raw_text = (
                f"SEC filing body excerpt. Filing date: {filed}. Form: {form}. "
                f"Report date: {row.get('report_date') or 'not stated'}. "
                f"Accession: {accession}.\n\n{body_text}"
                if body_text else
                (
                    f"SEC filing metadata. Filing date: {filed}. "
                    f"Report date: {row.get('report_date') or 'not stated'}. "
                    f"Accession: {accession}. "
                    "Prepare a bounded SEC review packet before making factual interpretations."
                )
            )
            item = make_item(
                source_id="sec_edgar",
                source_type="filing",
                published_at=f"{filed}T00:00:00+00:00" if filed else "",
                title=f"{ticker} {form} filed | {company}",
                url=source_url,
                tickers=[ticker],
                tags=["sec", form],
                raw_text=raw_text,
                rights_label="SEC EDGAR public filing; retain the original filing link and review the primary document.",
                observation_date=filed or None,
                release_date=filed or None,
                market_cutoff="filing_acceptance_date",
                source_grade="A",
                primary_source_confirmed=True,
                evidence_scope="filing_body_excerpt" if body_text else "filing_metadata_only",
                evidence_label="verified_primary_body_excerpt" if body_text else "fact_source_reported",
                freshness_state="current_filing_body" if body_text else "current_filing_metadata",
                publisher="SEC EDGAR",
                source_url_kind="primary_source",
                link_required=True,
            )
            item["filing_accession_number"] = accession or None
            item["filing_body"] = {
                key: value for key, value in body.items() if key != "text"
            }
            item["filing_facts"] = extract_filing_facts(item)
            items.append(item)
    return items, None
