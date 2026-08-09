"""Small stdlib helpers shared by every source adapter."""

from __future__ import annotations

import hashlib
import json
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
TRACKING_QUERY_KEYS = {
    "fbclid", "gclid", "mc_cid", "mc_eid", "ref", "source",
}
SOURCE_URL_KINDS = {
    "primary_source",
    "publisher_article",
    "official_research_document",
    "licensed_report",
    "provider_metadata",
    "missing",
}


def load_dotenv() -> None:
    # Prefer the pipeline-specific file, then fill missing shared settings from
    # the repository root.  This keeps provider credentials scoped locally
    # while allowing shared keys (for example OPENAI_API_KEY) to live once.
    env_files = (ROOT / ".env", ROOT.parents[1] / ".env")
    for env_file in env_files:
        if not env_file.exists():
            continue
        for raw in env_file.read_text(encoding="utf-8").splitlines():
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            os.environ.setdefault(key.strip(), value.strip().strip('"'))
    if not os.environ.get("ALPHAVANTAGE_API_KEY", "").strip():
        alias = os.environ.get("ALPHA_VANTAGE_API_KEY", "").strip()
        if alias:
            os.environ["ALPHAVANTAGE_API_KEY"] = alias


def get_json(url: str, headers: dict[str, str] | None = None) -> dict[str, Any]:
    request = Request(url, headers=headers or {"User-Agent": "market-brief-poc/1.0"})
    with urlopen(request, timeout=30) as response:
        return json.loads(response.read().decode("utf-8"))


def normalize_url_text(url: str) -> str:
    """Decode common JSON/HTML URL escapes without interpreting arbitrary text."""
    value = str(url or "").strip()
    replacements = {
        "003d": "=",
        "0026": "&",
        "003f": "?",
        "002f": "/",
        "003a": ":",
    }
    for code, replacement in replacements.items():
        value = re.sub(rf"\\+u{code}", replacement, value, flags=re.IGNORECASE)
    return value.replace("\\/", "/").replace("\\&", "&").replace("\\=", "=")


def canonicalize_url(url: str) -> str:
    """Return a stable source URL for lineage and duplicate checks."""
    value = normalize_url_text(url)
    try:
        parsed = urlsplit(value)
    except ValueError:
        return ""
    if parsed.scheme.lower() not in {"http", "https"} or not parsed.netloc:
        return ""
    host = parsed.netloc.lower()
    if host.startswith("www."):
        host = host[4:]
    query = urlencode([
        (key, item)
        for key, item in parse_qsl(parsed.query, keep_blank_values=True)
        if not key.lower().startswith("utm_") and key.lower() not in TRACKING_QUERY_KEYS
    ], doseq=True)
    path = parsed.path.rstrip("/") or "/"
    return urlunsplit((parsed.scheme.lower(), host, path, query, ""))


def make_item(
    *, source_id: str, source_type: str, published_at: str, title: str,
    url: str, tickers: list[str], tags: list[str], raw_text: str,
    rights_label: str, observation_date: str | None = None,
    release_date: str | None = None, market_cutoff: str | None = None,
    source_grade: str = "D", primary_source_confirmed: bool = False,
    evidence_scope: str = "metadata_only", evidence_label: str = "unknown",
    freshness_state: str = "unknown", publisher: str | None = None,
    source_url_kind: str | None = None, link_required: bool = True,
    source_reference: str | None = None, derivation_note: str | None = None,
) -> dict[str, Any]:
    """Create the single contract consumed by later de-duplication and AI steps."""
    text = raw_text.strip()
    normalized_url = normalize_url_text(url)
    fingerprint = "|".join([source_id, published_at, title.strip(), normalized_url, text])
    canonical_url = canonicalize_url(normalized_url)
    resolved_url_kind = source_url_kind or (
        "primary_source" if primary_source_confirmed and canonical_url else
        "publisher_article" if canonical_url else "missing"
    )
    if resolved_url_kind not in SOURCE_URL_KINDS:
        raise ValueError(f"Unsupported source_url_kind: {resolved_url_kind}")
    return {
        "id": hashlib.sha256(fingerprint.encode("utf-8")).hexdigest()[:24],
        "source_id": source_id,
        "source_type": source_type,
        "published_at": published_at or datetime.now(timezone.utc).isoformat(),
        "title": title.strip(),
        "url": normalized_url,
        "canonical_url": canonical_url,
        "publisher": (publisher or source_id).strip(),
        "source_url_kind": resolved_url_kind,
        "link_required": bool(link_required),
        "source_reference": (source_reference or "").strip() or None,
        "tickers": sorted({ticker.upper() for ticker in tickers if ticker}),
        "tags": sorted({tag for tag in tags if tag}),
        "raw_text": text,
        "rights_label": rights_label,
        "observation_date": observation_date,
        "release_date": release_date,
        "collected_at": datetime.now(timezone.utc).isoformat(),
        "market_cutoff": market_cutoff,
        "source_grade": source_grade,
        "primary_source_confirmed": primary_source_confirmed,
        "evidence_scope": evidence_scope,
        "evidence_label": evidence_label,
        "freshness_state": freshness_state,
        "derivation_note": (derivation_note or "").strip() or None,
    }


def load_source_config() -> dict[str, Any]:
    return json.loads((ROOT / "sources.json").read_text(encoding="utf-8"))
