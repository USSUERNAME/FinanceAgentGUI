"""Rights-first ingestion helpers for operator-authorized broker research."""

from __future__ import annotations

import json
import os
import hashlib
from datetime import datetime
from io import BytesIO
from pathlib import Path
from typing import Any

from collectors.common import ROOT, make_item

REGISTRY_PATH = ROOT / "broker_research_sources.json"
DOCUMENT_TEXT_CACHE_DIR = ROOT / "workspace" / "broker_research_cache" / "document_text"
DOCUMENT_TEXT_CACHE_SCHEMA = "broker_document_text_cache.v1"
SUPPORTED_DOCUMENT_SUFFIXES = {".md", ".txt", ".pdf"}
DOCUMENT_ACQUISITION_MODES = {
    "operator_authorized_local",
    "operator_authorized_drive",
    "official_email",
    "official_public_document",
}
PUBLICATION_POLICIES = {"private_analysis_only", "summary_and_link_only"}
RIGHTS_REVIEW_STATUSES = {
    "operator_confirmed",
    "licensed_internal_use",
    "public_source_reviewed",
}
RESEARCH_STANCES = {"positive", "neutral", "cautious", "negative", "not_stated"}
MARKET_SCOPES = {"KR", "US", "EU", "JP", "GLOBAL", "UNKNOWN"}


def load_registry(path: Path = REGISTRY_PATH) -> dict[str, Any]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    validate_registry(payload)
    return payload


def validate_registry(payload: dict[str, Any]) -> None:
    if payload.get("schema_version") != "broker_research_sources.v1":
        raise ValueError("Unsupported broker research source registry schema")
    sources = payload.get("sources")
    if not isinstance(sources, list) or not sources:
        raise ValueError("Broker research source registry requires at least one source")
    identifiers: set[str] = set()
    for source in sources:
        if not isinstance(source, dict):
            raise ValueError("Every broker research source must be an object")
        source_id = str(source.get("id") or "").strip()
        if not source_id or source_id in identifiers:
            raise ValueError(f"Missing or duplicate broker research source id: {source_id}")
        identifiers.add(source_id)
        if not str(source.get("name") or "").strip():
            raise ValueError(f"Broker research source is missing a name: {source_id}")
        mode = str(source.get("acquisition_mode") or "")
        if not mode:
            raise ValueError(f"Broker research source is missing acquisition_mode: {source_id}")
        automated = bool(source.get("automated_collection_allowed"))
        if mode in {"manual_discovery_only", "prohibited_automated_scrape"} and automated:
            raise ValueError(f"Manual-only source cannot enable automation: {source_id}")
        if source.get("redistribution_allowed") is not False:
            raise ValueError(f"Redistribution must fail closed for broker research: {source_id}")


def _required_text(metadata: dict[str, Any], key: str) -> str:
    value = str(metadata.get(key) or "").strip()
    if not value:
        raise ValueError(f"Report metadata requires `{key}`")
    return value


def _required_bool(metadata: dict[str, Any], key: str, expected: bool) -> bool:
    value = metadata.get(key)
    if not isinstance(value, bool):
        raise ValueError(f"Report metadata `{key}` must be true or false")
    if value is not expected:
        raise ValueError(f"Report metadata `{key}` must be {str(expected).lower()}")
    return value


def validate_report_metadata(metadata: dict[str, Any], *, file_name: str) -> dict[str, Any]:
    """Validate explicit operator authority before any report body is analysed."""
    publisher = _required_text(metadata, "publisher")
    title = _required_text(metadata, "title")
    published_at = _required_text(metadata, "published_at")
    source_reference = _required_text(metadata, "source_reference")
    acquisition_mode = _required_text(metadata, "acquisition_mode")
    publication_policy = _required_text(metadata, "publication_policy")
    rights_review_status = _required_text(metadata, "rights_review_status")
    _required_bool(metadata, "analysis_allowed", True)
    _required_bool(metadata, "redistribution_allowed", False)

    if acquisition_mode not in DOCUMENT_ACQUISITION_MODES:
        raise ValueError(f"Unsupported document acquisition_mode: {acquisition_mode}")
    if publication_policy not in PUBLICATION_POLICIES:
        raise ValueError(f"Unsupported publication_policy: {publication_policy}")
    if rights_review_status not in RIGHTS_REVIEW_STATUSES:
        raise ValueError(f"Unsupported rights_review_status: {rights_review_status}")
    try:
        datetime.fromisoformat(published_at.replace("Z", "+00:00"))
    except ValueError as exc:
        raise ValueError("Report metadata `published_at` must be ISO-8601") from exc
    tags = metadata.get("tags") or []
    if not isinstance(tags, list) or not all(isinstance(tag, str) for tag in tags):
        raise ValueError("Report metadata `tags` must be a list of strings")
    tickers = metadata.get("tickers") or []
    if not isinstance(tickers, list) or not all(isinstance(ticker, str) for ticker in tickers):
        raise ValueError("Report metadata `tickers` must be a list of strings")
    research = metadata.get("research") or {}
    if not isinstance(research, dict):
        raise ValueError("Report metadata `research` must be an object")
    stance = str(research.get("stance") or "not_stated").strip()
    if stance not in RESEARCH_STANCES:
        raise ValueError(
            "Report metadata `research.stance` must be one of "
            + ", ".join(sorted(RESEARCH_STANCES))
        )
    for key in ("key_claims", "catalysts", "risks", "sectors"):
        values = research.get(key) or []
        if not isinstance(values, list) or not all(isinstance(value, str) for value in values):
            raise ValueError(f"Report metadata `research.{key}` must be a list of strings")
    market_scope = str(metadata.get("market_scope") or "UNKNOWN").strip().upper()
    if market_scope not in MARKET_SCOPES:
        raise ValueError(
            "Report metadata `market_scope` must be one of "
            + ", ".join(sorted(MARKET_SCOPES))
        )
    research_path = metadata.get("research_path") or []
    if not isinstance(research_path, list) or not all(
        isinstance(value, str) for value in research_path
    ):
        raise ValueError("Report metadata `research_path` must be a list of strings")

    return {
        **metadata,
        "publisher": publisher,
        "title": title,
        "published_at": published_at,
        "source_reference": source_reference,
        "acquisition_mode": acquisition_mode,
        "publication_policy": publication_policy,
        "rights_review_status": rights_review_status,
        "tags": tags,
        "tickers": tickers,
        "market_scope": market_scope,
        "issuer_country": str(metadata.get("issuer_country") or "").strip().upper()[:12],
        "original_language": str(metadata.get("original_language") or "").strip().lower()[:20],
        "base_currency": str(metadata.get("base_currency") or "").strip().upper()[:12],
        "research_path": [str(value).strip()[:120] for value in research_path if str(value).strip()],
        "research": {**research, "stance": stance},
        "file_name": file_name,
    }


def document_text(file_name: str, payload: bytes, *, max_chars: int = 30_000) -> str:
    suffix = Path(file_name).suffix.lower()
    if suffix not in SUPPORTED_DOCUMENT_SUFFIXES:
        raise ValueError(f"Unsupported broker report format: {suffix or 'missing'}")
    if suffix in {".md", ".txt"}:
        text = payload.decode("utf-8", errors="replace")
    else:
        try:
            from pypdf import PdfReader
        except ImportError as exc:  # pragma: no cover - dependency failure is environment-specific.
            raise RuntimeError("Install pypdf to ingest authorized PDF reports") from exc
        reader = PdfReader(BytesIO(payload))
        pages: list[str] = []
        for page in reader.pages:
            pages.append(page.extract_text() or "")
            if sum(len(value) for value in pages) >= max_chars:
                break
        text = "\n".join(pages)
        from broker_pdf_ocr import ocr_pdf_text, usable_report_text
        if (
            not usable_report_text(text)
            and os.getenv("BROKER_REPORT_OCR_ENABLED", "1").strip().lower()
            not in {"0", "false", "no", "off"}
        ):
            text = ocr_pdf_text(payload, max_chars=max_chars)
    normalized = "\n".join(line.rstrip() for line in text.splitlines()).strip()
    if not normalized:
        raise ValueError("Broker report contains no extractable text")
    return normalized[:max_chars]


def ocr_enabled() -> bool:
    return (
        os.getenv("BROKER_REPORT_OCR_ENABLED", "1").strip().lower()
        not in {"0", "false", "no", "off"}
    )


def document_text_cache_key(
    file_name: str,
    payload: bytes,
    *,
    max_chars: int = 30_000,
) -> str:
    """Key extraction output by content and every setting that changes text."""
    policy = json.dumps({
        "schema_version": DOCUMENT_TEXT_CACHE_SCHEMA,
        "suffix": Path(file_name).suffix.lower(),
        "max_chars": max_chars,
        "ocr_enabled": ocr_enabled(),
    }, sort_keys=True, separators=(",", ":")).encode("utf-8")
    digest = hashlib.sha256()
    digest.update(policy)
    digest.update(b"\0")
    digest.update(payload)
    return digest.hexdigest()


def cached_document_text(
    file_name: str,
    payload: bytes,
    *,
    cache_dir: Path,
    max_chars: int = 30_000,
) -> tuple[str, str, str]:
    """Return extracted text plus cache status and a non-secret content key."""
    cache_key = document_text_cache_key(file_name, payload, max_chars=max_chars)
    cache_path = cache_dir / f"{cache_key}.json"
    if cache_path.exists():
        try:
            cached = json.loads(cache_path.read_text(encoding="utf-8"))
            if (
                cached.get("schema_version") == DOCUMENT_TEXT_CACHE_SCHEMA
                and cached.get("cache_key") == cache_key
                and isinstance(cached.get("text"), str)
                and cached["text"].strip()
            ):
                return cached["text"][:max_chars], "hit", cache_key
        except (OSError, UnicodeDecodeError, json.JSONDecodeError):
            pass

    text = document_text(file_name, payload, max_chars=max_chars)
    cache_dir.mkdir(parents=True, exist_ok=True)
    cache_payload = {
        "schema_version": DOCUMENT_TEXT_CACHE_SCHEMA,
        "cache_key": cache_key,
        "max_chars": max_chars,
        "ocr_enabled": ocr_enabled(),
        "text": text,
        "created_at": datetime.now().astimezone().isoformat(),
    }
    temporary = cache_path.with_suffix(".tmp")
    temporary.write_text(
        json.dumps(cache_payload, ensure_ascii=False),
        encoding="utf-8",
    )
    temporary.replace(cache_path)
    return text, "miss", cache_key


def report_record(
    *,
    source_id: str,
    file_name: str,
    payload: bytes,
    metadata: dict[str, Any],
    document_text_cache_dir: Path | None = None,
) -> dict[str, Any]:
    checked = validate_report_metadata(metadata, file_name=file_name)
    official_public_document = checked["acquisition_mode"] == "official_public_document"
    official_email = checked["acquisition_mode"] == "official_email"
    official_attributed_source = official_public_document or official_email
    if document_text_cache_dir is None:
        text = document_text(file_name, payload)
        cache_status = "disabled"
        cache_key = document_text_cache_key(file_name, payload)
    else:
        text, cache_status, cache_key = cached_document_text(
            file_name,
            payload,
            cache_dir=document_text_cache_dir,
        )
    source_url = str(checked.get("source_url") or "").strip()
    record = make_item(
        source_id=source_id,
        source_type="broker_report",
        published_at=checked["published_at"],
        title=checked["title"][:180],
        url=source_url,
        tickers=[str(value) for value in checked.get("tickers") or []],
        tags=[
            (
                "institutional_research"
                if official_attributed_source
                else "sell_side"
            ),
            (
                (
                    "official_public_source"
                    if official_public_document
                    else "official_email_source"
                )
                if official_attributed_source
                else "operator_authorized"
            ),
            checked["acquisition_mode"],
            *checked["tags"],
        ],
        raw_text=text,
        rights_label=str(
            checked.get("rights_label")
            or (
                "Official publisher document; summarize with attribution and link only."
                if official_attributed_source
                else "Operator confirmed private analysis rights; no source-text redistribution."
            )
        ),
        observation_date=str(checked.get("observation_date") or checked["published_at"][:10]),
        release_date=checked.get("release_date"),
        market_cutoff=str(
            checked.get("market_cutoff")
            or (
                "official_document_last_modified"
                if official_public_document
                else (
                    "official_email_received"
                    if official_email
                    else "operator_supplied_report_time"
                )
            )
        ),
        source_grade="B" if official_attributed_source else "INTERNAL",
        primary_source_confirmed=official_attributed_source,
        evidence_scope=(
            (
                "official_institutional_commentary_document"
                if official_public_document
                else "authenticated_official_newsletter_body"
            )
            if official_attributed_source
            else "operator_authorized_report_excerpt"
        ),
        evidence_label=(
            "attributed_analysis"
            if official_attributed_source
            else "assumption_user_provided"
        ),
        freshness_state=(
            (
                "official_document_current"
                if official_public_document
                else "official_email_current"
            )
            if official_attributed_source
            else "user_supplied_date"
        ),
        publisher=checked["publisher"],
        source_url_kind=(
            "official_research_document"
            if official_public_document and source_url
            else ("licensed_report" if source_url else "missing")
        ),
        link_required=bool(checked.get("link_required", bool(source_url))),
        source_reference=checked["source_reference"],
        derivation_note=checked.get("derivation_note"),
    )
    record["research_rights"] = {
        "acquisition_mode": checked["acquisition_mode"],
        "analysis_allowed": True,
        "redistribution_allowed": False,
        "publication_policy": checked["publication_policy"],
        "rights_review_status": checked["rights_review_status"],
        "full_text_published": False,
    }
    record["document_format"] = Path(file_name).suffix.lower().lstrip(".")
    record["document_extraction"] = {
        "cache_status": cache_status,
        "cache_key": cache_key,
        "cache_schema_version": DOCUMENT_TEXT_CACHE_SCHEMA,
    }
    record["market_scope"] = checked["market_scope"]
    record["issuer_country"] = checked["issuer_country"]
    record["original_language"] = checked["original_language"]
    record["base_currency"] = checked["base_currency"]
    record["research_path"] = checked["research_path"]
    research = checked.get("research") or {}
    record["research_metadata"] = {
        "analyst": str(research.get("analyst") or "").strip(),
        "report_type": str(research.get("report_type") or "").strip(),
        "stance": str(research.get("stance") or "not_stated").strip(),
        "summary": str(research.get("summary") or "").strip()[:1200],
        "key_claims": [str(value).strip()[:500] for value in research.get("key_claims") or [] if str(value).strip()][:8],
        "catalysts": [str(value).strip()[:300] for value in research.get("catalysts") or [] if str(value).strip()][:6],
        "risks": [str(value).strip()[:300] for value in research.get("risks") or [] if str(value).strip()][:6],
        "sectors": [str(value).strip()[:120] for value in research.get("sectors") or [] if str(value).strip()][:8],
        "rating": str(
            research.get("rating")
            or research.get("original_rating")
            or ""
        ).strip()[:80],
        "previous_rating": str(research.get("previous_rating") or "").strip()[:80],
        "target_price": research.get("target_price"),
        "previous_target_price": research.get("previous_target_price"),
        "currency": str(
            research.get("currency")
            or research.get("target_currency")
            or checked["base_currency"]
            or ""
        ).strip().upper()[:12],
    }
    return record
