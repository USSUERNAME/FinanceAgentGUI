"""Collect allowlisted newsletter bodies from one explicit Gmail label."""

from __future__ import annotations

import base64
import hashlib
import json
import os
import re
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime, parseaddr
from html import unescape
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen

from broker_research_policy import DOCUMENT_TEXT_CACHE_DIR, report_record
from collectors.common import ROOT

TOKEN_URL = "https://oauth2.googleapis.com/token"
GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me"
GMAIL_ATTACHMENT_APPROVALS_SCHEMA = "gmail_research_attachment_approvals.v1"
GMAIL_ATTACHMENT_APPROVALS_PATH = (
    ROOT / "workspace" / "gmail_research_approvals" / "attachments.json"
)
GMAIL_SENDER_APPROVALS_SCHEMA = "gmail_research_sender_approvals.v1"
GMAIL_SENDER_APPROVALS_PATH = (
    ROOT / "workspace" / "gmail_research_approvals" / "senders.json"
)
GMAIL_SENDER_REVIEWS_SCHEMA = "gmail_research_sender_reviews.v1"
GMAIL_SENDER_REVIEWS_PATH = (
    ROOT / "workspace" / "gmail_research_reviews" / "blocked_senders.json"
)
DEFAULT_MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024
DEFAULT_MAX_INLINE_BODY_BYTES = 2 * 1024 * 1024


def _credentials() -> tuple[dict[str, str], list[str]]:
    keys = {
        "client_id": os.getenv("GOOGLE_GMAIL_CLIENT_ID", "").strip(),
        "client_secret": os.getenv("GOOGLE_GMAIL_CLIENT_SECRET", "").strip(),
        "refresh_token": os.getenv("GOOGLE_GMAIL_REFRESH_TOKEN", "").strip(),
    }
    return keys, [key for key, value in keys.items() if not value]


def _json_request(request: Request, *, operation: str) -> dict[str, Any]:
    try:
        with urlopen(request, timeout=30) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except HTTPError as exc:
        raise RuntimeError(f"Gmail {operation} returned HTTP {exc.code}") from exc
    except URLError as exc:
        raise RuntimeError(f"Gmail {operation} could not reach Google") from exc
    if not isinstance(payload, dict):
        raise RuntimeError(f"Gmail {operation} returned an unexpected response")
    return payload


def refresh_access_token(credentials: dict[str, str]) -> str:
    body = urlencode({
        "client_id": credentials["client_id"],
        "client_secret": credentials["client_secret"],
        "refresh_token": credentials["refresh_token"],
        "grant_type": "refresh_token",
    }).encode("utf-8")
    payload = _json_request(
        Request(
            TOKEN_URL,
            method="POST",
            data=body,
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        ),
        operation="OAuth token exchange",
    )
    token = str(payload.get("access_token") or "").strip()
    if not token:
        raise RuntimeError("Gmail OAuth response did not include an access token")
    return token


def _authorized_json(token: str, url: str, *, operation: str) -> dict[str, Any]:
    return _json_request(
        Request(url, headers={"Authorization": f"Bearer {token}"}),
        operation=operation,
    )


def resolve_label_id(token: str, label_name: str) -> str:
    payload = _authorized_json(
        token,
        f"{GMAIL_API}/labels",
        operation="label listing",
    )
    target = label_name.casefold()
    for row in payload.get("labels") or []:
        if (
            isinstance(row, dict)
            and str(row.get("name") or "").strip().casefold() == target
        ):
            return str(row.get("id") or "").strip()
    return ""


def list_message_ids(
    token: str,
    *,
    label_id: str,
    lookback_days: int,
    max_messages: int,
) -> list[str]:
    query = urlencode({
        "labelIds": label_id,
        "q": f"newer_than:{lookback_days}d",
        "maxResults": str(max_messages),
    })
    payload = _authorized_json(
        token,
        f"{GMAIL_API}/messages?{query}",
        operation="message listing",
    )
    return [
        str(row.get("id") or "").strip()
        for row in payload.get("messages") or []
        if isinstance(row, dict) and str(row.get("id") or "").strip()
    ]


def get_message(token: str, message_id: str) -> dict[str, Any]:
    return _authorized_json(
        token,
        f"{GMAIL_API}/messages/{quote(message_id)}?format=full",
        operation="message retrieval",
    )


def get_attachment(
    token: str,
    message_id: str,
    attachment_id: str,
    *,
    max_bytes: int = DEFAULT_MAX_ATTACHMENT_BYTES,
) -> bytes:
    payload = _authorized_json(
        token,
        (
            f"{GMAIL_API}/messages/{quote(message_id)}/attachments/"
            f"{quote(attachment_id)}"
        ),
        operation="attachment retrieval",
    )
    encoded = str(payload.get("data") or "").strip()
    if not encoded:
        raise RuntimeError("Gmail attachment response did not include data")
    padding = "=" * (-len(encoded) % 4)
    try:
        decoded = base64.urlsafe_b64decode(encoded + padding)
    except (ValueError, TypeError) as exc:
        raise RuntimeError("Gmail attachment response was not valid base64") from exc
    if len(decoded) > max_bytes:
        raise RuntimeError("Gmail attachment exceeds the configured size limit")
    return decoded


def _decode_body(value: str) -> str:
    text = str(value or "").strip()
    if not text:
        return ""
    padding = "=" * (-len(text) % 4)
    try:
        return base64.urlsafe_b64decode(text + padding).decode(
            "utf-8",
            errors="replace",
        )
    except (ValueError, UnicodeDecodeError):
        return ""


def _walk_parts(payload: dict[str, Any]) -> list[dict[str, Any]]:
    output = [payload]
    for part in payload.get("parts") or []:
        if isinstance(part, dict):
            output.extend(_walk_parts(part))
    return output


def _html_to_text(value: str) -> str:
    text = re.sub(r"(?is)<(script|style).*?>.*?</\1>", " ", value)
    text = re.sub(r"(?i)<br\s*/?>", "\n", text)
    text = re.sub(r"(?i)</(p|div|li|tr|h[1-6])>", "\n", text)
    text = re.sub(r"(?s)<[^>]+>", " ", text)
    return unescape(text)


def message_text(payload: dict[str, Any], *, max_chars: int = 30_000) -> str:
    plain: list[str] = []
    html: list[str] = []
    for part in _walk_parts(payload):
        mime_type = str(part.get("mimeType") or "").lower()
        body = part.get("body") or {}
        decoded = _decode_body(str(body.get("data") or ""))
        if not decoded:
            continue
        if mime_type == "text/plain":
            plain.append(decoded)
        elif mime_type in {"text/html", "text/x-amp-html"}:
            html.append(_html_to_text(decoded))
    selected = plain or html
    normalized = "\n".join(
        line.strip()
        for line in "\n".join(selected).splitlines()
        if line.strip()
    )
    return normalized[:max_chars]


def message_snippet(message: dict[str, Any], *, max_chars: int = 1000) -> str:
    snippet = unescape(str(message.get("snippet") or ""))
    normalized = " ".join(snippet.split())
    return normalized[:max_chars]


def remote_message_text(
    token: str,
    message_id: str,
    payload: dict[str, Any],
    *,
    max_chars: int = 30_000,
    max_bytes: int = DEFAULT_MAX_INLINE_BODY_BYTES,
) -> str:
    """Read Gmail-managed inline body parts without touching file attachments."""
    plain: list[str] = []
    html: list[str] = []
    for part in _walk_parts(payload):
        mime_type = str(part.get("mimeType") or "").strip().lower()
        if mime_type not in {"text/plain", "text/html", "text/x-amp-html"}:
            continue
        if str(part.get("filename") or "").strip():
            continue
        body = part.get("body") or {}
        if str(body.get("data") or "").strip():
            continue
        attachment_id = str(body.get("attachmentId") or "").strip()
        if not attachment_id:
            continue
        decoded = get_attachment(
            token,
            message_id,
            attachment_id,
            max_bytes=max_bytes,
        ).decode("utf-8", errors="replace")
        if mime_type == "text/plain":
            plain.append(decoded)
        else:
            html.append(_html_to_text(decoded))
    selected = plain or html
    normalized = "\n".join(
        line.strip()
        for line in "\n".join(selected).splitlines()
        if line.strip()
    )
    return normalized[:max_chars]


def _headers(payload: dict[str, Any]) -> dict[str, str]:
    output: dict[str, str] = {}
    for row in payload.get("headers") or []:
        if not isinstance(row, dict):
            continue
        name = str(row.get("name") or "").strip().lower()
        if name:
            output[name] = str(row.get("value") or "").strip()
    return output


def _published_at(message: dict[str, Any], headers: dict[str, str]) -> str:
    date_header = headers.get("date", "")
    if date_header:
        try:
            parsed = parsedate_to_datetime(date_header)
            if parsed.tzinfo is None:
                parsed = parsed.replace(tzinfo=timezone.utc)
            return parsed.astimezone(timezone.utc).isoformat()
        except (TypeError, ValueError):
            pass
    try:
        timestamp = int(str(message.get("internalDate") or "0")) / 1000
        if timestamp > 0:
            return datetime.fromtimestamp(timestamp, tz=timezone.utc).isoformat()
    except ValueError:
        pass
    return datetime.now(timezone.utc).isoformat()


def _sender_source(
    sender: str,
    sources: list[dict[str, Any]],
) -> dict[str, Any] | None:
    address = parseaddr(sender)[1].strip().lower()
    domain = address.rsplit("@", 1)[-1] if "@" in address else ""
    for source in sources:
        domains = [
            str(value).strip().lower()
            for value in source.get("sender_domains") or []
            if str(value).strip()
        ]
        if any(domain == allowed or domain.endswith(f".{allowed}") for allowed in domains):
            return source
    return None


def _sender_identity(sender: str) -> tuple[str, str, str]:
    display_name, address = parseaddr(sender)
    normalized_address = address.strip().lower()
    domain = normalized_address.rsplit("@", 1)[-1] if "@" in normalized_address else ""
    return display_name.strip(), normalized_address, domain


def _authentication_passes(
    headers: dict[str, str],
    source: dict[str, Any],
) -> bool:
    authentication = " ".join([
        headers.get("authentication-results", ""),
        headers.get("arc-authentication-results", ""),
    ]).casefold()
    if not authentication.strip():
        return False
    domains = [
        str(value).strip().casefold()
        for value in source.get("sender_domains") or []
        if str(value).strip()
    ]
    dkim_pass = "dkim=pass" in authentication
    dmarc_pass = "dmarc=pass" in authentication
    return any(
        (
            dkim_pass
            and (
                f"header.d={domain}" in authentication
                or f"header.i=@{domain}" in authentication
            )
        )
        or (
            dmarc_pass
            and (
                f"header.from={domain}" in authentication
                or f"header.from={domain};" in authentication
            )
        )
        for domain in domains
    )


def _sender_approvals(
    path: Path = GMAIL_SENDER_APPROVALS_PATH,
) -> tuple[dict[str, str], str | None]:
    if not path.exists():
        return {}, None
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
        if (
            payload.get("schema_version") != GMAIL_SENDER_APPROVALS_SCHEMA
            or not isinstance(payload.get("decisions"), list)
        ):
            raise ValueError("unexpected sender approval registry schema")
        decisions: dict[str, str] = {}
        for row in payload["decisions"]:
            if not isinstance(row, dict):
                continue
            sender_email = str(row.get("sender_email") or "").strip().lower()
            decision = str(row.get("decision") or "").strip()
            if sender_email and decision in {"approved", "excluded"}:
                decisions[sender_email] = decision
        return decisions, None
    except (OSError, UnicodeDecodeError, json.JSONDecodeError, ValueError):
        return {}, "Gmail sender approval registry is invalid; reviewed senders were blocked"


def _review_key(sender_email: str) -> str:
    return hashlib.sha256(sender_email.encode("utf-8")).hexdigest()


def _persist_sender_reviews(
    candidates: list[dict[str, Any]],
    resolved_sender_emails: set[str] | None = None,
    path: Path = GMAIL_SENDER_REVIEWS_PATH,
) -> None:
    existing: dict[str, dict[str, Any]] = {}
    try:
        payload = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
        if (
            payload.get("schema_version") == GMAIL_SENDER_REVIEWS_SCHEMA
            and isinstance(payload.get("items"), list)
        ):
            existing = {
                str(row.get("sender_key") or ""): row
                for row in payload["items"]
                if isinstance(row, dict) and str(row.get("sender_key") or "")
            }
    except (OSError, UnicodeDecodeError, json.JSONDecodeError):
        existing = {}
    resolved = {
        str(value).strip().lower()
        for value in resolved_sender_emails or set()
        if str(value).strip()
    }
    before_count = len(existing)
    existing = {
        key: row
        for key, row in existing.items()
        if str(row.get("sender_email") or "").strip().lower() not in resolved
    }
    if not candidates and len(existing) == before_count:
        return
    now = datetime.now(timezone.utc).isoformat()
    for candidate in candidates:
        sender_key = str(candidate["sender_key"])
        previous = existing.pop(sender_key, {})
        existing[sender_key] = {
            **candidate,
            "message_count": int(previous.get("message_count") or 0) + 1,
            "first_seen_at": str(previous.get("first_seen_at") or now),
            "last_seen_at": now,
        }
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary_path = path.with_suffix(f"{path.suffix}.tmp-{os.getpid()}")
    temporary_path.write_text(
        json.dumps({
            "schema_version": GMAIL_SENDER_REVIEWS_SCHEMA,
            "updated_at": now,
            "items": list(existing.values())[-500:],
        }, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    temporary_path.replace(path)


def _review_candidate(
    *,
    sender_header: str,
    headers: dict[str, str],
    message: dict[str, Any],
    reason: str,
) -> dict[str, Any] | None:
    sender_name, sender_email, sender_domain = _sender_identity(sender_header)
    if not sender_email:
        return None
    return {
        "sender_key": _review_key(sender_email),
        "sender_name": sender_name[:200],
        "sender_email": sender_email[:320],
        "sender_domain": sender_domain[:255],
        "latest_subject": str(headers.get("subject") or "")[:500],
        "latest_published_at": _published_at(message, headers),
        "reason": reason,
        "reviewable": reason == "sender_not_allowlisted",
    }


def _reviewed_sender_source(
    sender_header: str,
    decisions: dict[str, str],
) -> dict[str, Any] | None:
    sender_name, sender_email, sender_domain = _sender_identity(sender_header)
    if decisions.get(sender_email) != "approved" or not sender_domain:
        return None
    return {
        "id": "gmail_reviewed_sender",
        "publisher": sender_name or sender_domain,
        "sender_domains": [sender_domain],
        "market_scope": "GLOBAL",
        "original_language": "en",
        "research_path": ["GLOBAL", "Reviewed Gmail sender"],
        "tags": ["operator_reviewed_sender"],
    }


def _attachment_key(
    message_id: str,
    attachment_id: str,
    filename: str,
) -> str:
    digest = hashlib.sha256()
    digest.update(message_id.encode("utf-8"))
    digest.update(b"\0")
    digest.update(attachment_id.encode("utf-8"))
    digest.update(b"\0")
    digest.update(filename.encode("utf-8"))
    return digest.hexdigest()


def _attachments(payload: dict[str, Any], message_id: str) -> list[dict[str, Any]]:
    output: list[dict[str, Any]] = []
    for part in _walk_parts(payload):
        filename = str(part.get("filename") or "").strip()
        if not filename:
            continue
        body = part.get("body") or {}
        attachment_id = str(body.get("attachmentId") or "").strip()
        if not attachment_id:
            continue
        mime_type = str(part.get("mimeType") or "").strip().lower()
        output.append({
            "attachment_key": _attachment_key(
                message_id,
                attachment_id,
                filename,
            ),
            "filename": filename[:500],
            "mime_type": mime_type[:120],
            "size": max(0, int(body.get("size") or 0)),
            "is_pdf": (
                mime_type == "application/pdf"
                or Path(filename).suffix.lower() == ".pdf"
            ),
            "provider_attachment_id": attachment_id,
        })
    return output


def _attachment_approvals(
    path: Path = GMAIL_ATTACHMENT_APPROVALS_PATH,
) -> tuple[dict[str, str], str | None]:
    if not path.exists():
        return {}, None
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
        if (
            payload.get("schema_version") != GMAIL_ATTACHMENT_APPROVALS_SCHEMA
            or not isinstance(payload.get("decisions"), list)
        ):
            raise ValueError("unexpected approval registry schema")
        decisions: dict[str, str] = {}
        for row in payload["decisions"]:
            if not isinstance(row, dict):
                continue
            key = str(row.get("attachment_key") or "").strip()
            decision = str(row.get("decision") or "").strip()
            if key and decision in {"approved", "excluded"}:
                decisions[key] = decision
        return decisions, None
    except (OSError, UnicodeDecodeError, json.JSONDecodeError, ValueError):
        return {}, "Gmail attachment approval registry is invalid; downloads were blocked"


def collect(config: dict[str, Any]) -> tuple[list[dict[str, Any]], str | None]:
    settings = config.get("gmail_research") or {}
    if not settings.get("enabled", True):
        return [], "Gmail research collector disabled"
    credentials, missing = _credentials()
    if missing:
        return [], "Gmail research inbox not configured"
    label_name = str(
        os.getenv("GOOGLE_GMAIL_RESEARCH_LABEL")
        or settings.get("label_name")
        or "Stocks"
    ).strip()
    if not label_name:
        return [], "Gmail research label is not configured"
    sources = [
        row
        for row in settings.get("sender_sources") or []
        if isinstance(row, dict)
    ]
    if not sources:
        return [], "Gmail research sender allowlist is empty"

    token = refresh_access_token(credentials)
    label_id = resolve_label_id(token, label_name)
    if not label_id:
        return [], "Configured Gmail research label was not found"
    max_messages = max(1, min(int(settings.get("max_messages", 40)), 100))
    lookback_days = max(1, min(int(settings.get("lookback_days", 14)), 90))
    message_ids = list_message_ids(
        token,
        label_id=label_id,
        lookback_days=lookback_days,
        max_messages=max_messages,
    )
    records: list[dict[str, Any]] = []
    rejected = 0
    sender_review_candidates: list[dict[str, Any]] = []
    accepted_sender_emails: set[str] = set()
    attachment_reviews = 0
    attachment_failures = 0
    approval_decisions, approval_notice = _attachment_approvals(
        GMAIL_ATTACHMENT_APPROVALS_PATH
    )
    sender_decisions, sender_approval_notice = _sender_approvals(
        GMAIL_SENDER_APPROVALS_PATH
    )
    max_attachment_bytes = max(
        1,
        min(
            int(settings.get("max_attachment_bytes", DEFAULT_MAX_ATTACHMENT_BYTES)),
            50 * 1024 * 1024,
        ),
    )
    for message_id in message_ids:
        try:
            message = get_message(token, message_id)
            payload = message.get("payload") or {}
            if not isinstance(payload, dict):
                raise ValueError("Gmail message payload is invalid")
            headers = _headers(payload)
            sender_header = headers.get("from", "")
            sender_name, sender_email, _ = _sender_identity(sender_header)
            source = _sender_source(sender_header, sources)
            if source is None:
                source = _reviewed_sender_source(sender_header, sender_decisions)
            if source is None:
                rejected += 1
                candidate = _review_candidate(
                    sender_header=sender_header,
                    headers=headers,
                    message=message,
                    reason=(
                        "sender_excluded"
                        if sender_decisions.get(sender_email) == "excluded"
                        else "sender_not_allowlisted"
                    ),
                )
                if candidate:
                    sender_review_candidates.append(candidate)
                continue
            if not _authentication_passes(headers, source):
                rejected += 1
                candidate = _review_candidate(
                    sender_header=sender_header,
                    headers=headers,
                    message=message,
                    reason="authentication_failed",
                )
                if candidate:
                    sender_review_candidates.append(candidate)
                continue
            body_mode = "full_body"
            text = message_text(payload)
            if not text:
                text = remote_message_text(token, message_id, payload)
                body_mode = "inline_body_attachment"
            if not text:
                text = message_snippet(message)
                body_mode = "snippet_fallback"
            if not text:
                rejected += 1
                candidate = _review_candidate(
                    sender_header=sender_header,
                    headers=headers,
                    message=message,
                    reason="empty_body",
                )
                if candidate:
                    sender_review_candidates.append(candidate)
                continue
            accepted_sender_emails.add(sender_email)
            attachments = _attachments(payload, message_id)
            attachment_count = len(attachments)
            pdf_attachment_count = sum(
                attachment["is_pdf"]
                for attachment in attachments
            )
            attachment_reviews += sum(
                attachment["is_pdf"]
                and approval_decisions.get(attachment["attachment_key"]) is None
                for attachment in attachments
            )
            published_at = _published_at(message, headers)
            title = headers.get("subject") or str(source.get("publisher") or "Research newsletter")
            metadata = {
                "publisher": str(source.get("publisher") or source.get("id") or ""),
                "title": title,
                "published_at": published_at,
                "source_reference": f"gmail:{message_id}",
                "acquisition_mode": "official_email",
                "analysis_allowed": True,
                "redistribution_allowed": False,
                "publication_policy": "summary_and_link_only",
                "rights_review_status": "public_source_reviewed",
                "rights_label": "Subscribed newsletter body; paraphrased summary only.",
                "tags": [
                    "newsletter",
                    "institutional_research",
                    "attributed_analysis",
                    *[
                        str(value)
                        for value in source.get("tags") or []
                        if str(value).strip()
                    ],
                ],
                "tickers": [],
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
                "market_cutoff": "gmail_message_received",
                "research": {
                    "report_type": str(source.get("report_type") or "market_strategy"),
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
            record = report_record(
                source_id=str(source.get("id") or "gmail_research"),
                file_name=f"{message_id}.txt",
                payload=text.encode("utf-8"),
                metadata=metadata,
                document_text_cache_dir=DOCUMENT_TEXT_CACHE_DIR,
            )
            record["gmail_message"] = {
                "label_name": label_name,
                "body_mode": body_mode,
                "attachment_count": attachment_count,
                "pdf_attachment_count": pdf_attachment_count,
                "attachment_review_required": pdf_attachment_count > 0,
                "attachment_downloaded": False,
                "attachments": [
                    {
                        "attachment_key": attachment["attachment_key"],
                        "filename": attachment["filename"],
                        "mime_type": attachment["mime_type"],
                        "size": attachment["size"],
                        "is_pdf": attachment["is_pdf"],
                        "approval_state": approval_decisions.get(
                            attachment["attachment_key"],
                            "pending",
                        ),
                    }
                    for attachment in attachments
                ],
            }
            records.append(record)
            for attachment in attachments:
                if (
                    not attachment["is_pdf"]
                    or approval_decisions.get(attachment["attachment_key"]) != "approved"
                ):
                    continue
                try:
                    attachment_payload = get_attachment(
                        token,
                        message_id,
                        attachment["provider_attachment_id"],
                        max_bytes=max_attachment_bytes,
                    )
                    attachment_metadata = {
                        **metadata,
                        "title": f"{title} · {attachment['filename']}",
                        "source_reference": (
                            f"gmail:{message_id}:attachment:"
                            f"{attachment['attachment_key']}"
                        ),
                        "tags": [*metadata["tags"], "approved_pdf_attachment"],
                    }
                    attachment_record = report_record(
                        source_id=str(source.get("id") or "gmail_research"),
                        file_name=attachment["filename"],
                        payload=attachment_payload,
                        metadata=attachment_metadata,
                        document_text_cache_dir=DOCUMENT_TEXT_CACHE_DIR,
                    )
                    attachment_record["gmail_attachment"] = {
                        "attachment_key": attachment["attachment_key"],
                        "filename": attachment["filename"],
                        "mime_type": attachment["mime_type"],
                        "size": len(attachment_payload),
                        "approval_state": "approved",
                        "parent_source_reference": f"gmail:{message_id}",
                    }
                    records.append(attachment_record)
                    record["gmail_message"]["attachment_downloaded"] = True
                except (OSError, RuntimeError, TypeError, ValueError):
                    attachment_failures += 1
        except (OSError, RuntimeError, TypeError, ValueError):
            rejected += 1
    _persist_sender_reviews(
        sender_review_candidates,
        accepted_sender_emails,
        GMAIL_SENDER_REVIEWS_PATH,
    )
    notices = []
    if approval_notice:
        notices.append(approval_notice)
    if sender_approval_notice:
        notices.append(sender_approval_notice)
    if rejected:
        notices.append(f"{rejected} Gmail message(s) rejected by label or sender gate")
    if attachment_reviews:
        notices.append(
            f"{attachment_reviews} PDF attachment(s) require explicit analysis approval"
        )
    if attachment_failures:
        notices.append(
            f"{attachment_failures} approved Gmail attachment(s) could not be analyzed"
        )
    return records, "; ".join(notices) or None
