"""Collect bounded public-channel posts through an authorized Telegram user session.

Telegram posts enter the research pipeline only as discovery or viewpoint
leads.  They never receive primary-source status, even when a broker or filing
summary channel publishes them.  Material claims must graduate through the
existing official-source matching pipeline before they can be presented as
facts.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import os
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Iterable

from broker_research_policy import DOCUMENT_TEXT_CACHE_DIR, report_record
from collectors.common import ROOT, canonicalize_url, make_item

REGISTRY_PATH = ROOT / "telegram_channels.json"
LOCAL_SESSION_PATH = ROOT / "workspace" / "local_secrets" / "telegram_session_string.txt"
ATTACHMENT_APPROVALS_SCHEMA = "telegram_research_attachment_approvals.v1"
ATTACHMENT_APPROVALS_PATH = (
    ROOT / "workspace" / "telegram_research_approvals" / "attachments.json"
)
DEFAULT_MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024
PUBLICATION_POLICIES = {
    "internal_summary_with_attribution",
    "link_only_bounded_summary",
    "link_only_no_republication",
    "discovery_only",
}
URL_PATTERN = re.compile(r"https?://[^\s<>()\[\]{}\"']+")


def bounded_failure(exc: Exception, *, limit: int = 240) -> str:
    """Expose a useful error reason without emitting multiline or unbounded logs."""
    message = re.sub(r"\s+", " ", str(exc)).strip()
    suffix = f":{message[:limit]}" if message else ""
    return f"{type(exc).__name__}{suffix}"


def load_session_string(path: Path = LOCAL_SESSION_PATH) -> str:
    """Load a Telegram session without exposing or committing the credential."""
    configured = os.getenv("TELEGRAM_SESSION_STRING", "").strip()
    if configured:
        return configured
    try:
        if not path.is_file() or path.stat().st_size > 16_384:
            return ""
        return path.read_text(encoding="utf-8").strip()
    except OSError:
        return ""


def load_registry(path: Path = REGISTRY_PATH) -> dict[str, Any]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if payload.get("schema_version") != "telegram_channel_registry.v1":
        raise ValueError("Unsupported Telegram channel registry schema")
    channels = payload.get("channels")
    if not isinstance(channels, list) or not channels:
        raise ValueError("Telegram channel registry must contain channels")
    seen: set[str] = set()
    for channel in channels:
        username = str(channel.get("username") or "").strip().lstrip("@")
        if not username or not re.fullmatch(r"[A-Za-z0-9_]{5,64}", username):
            raise ValueError(f"Invalid public Telegram username: {username!r}")
        normalized = username.casefold()
        if normalized in seen:
            raise ValueError(f"Duplicate Telegram username: {username}")
        seen.add(normalized)
        policy = str(channel.get("publication_policy") or "")
        if policy not in PUBLICATION_POLICIES:
            raise ValueError(f"Unsupported Telegram publication policy: {policy}")
        if not str(channel.get("rights_label") or "").strip():
            raise ValueError(f"Telegram channel lacks a rights label: {username}")
        if channel.get("attachment_collection_allowed") is True:
            if not str(channel.get("category") or "").startswith("broker_"):
                raise ValueError(
                    "Telegram attachment collection is limited to broker channels: "
                    f"{username}"
                )
            if policy != "link_only_bounded_summary":
                raise ValueError(
                    "Telegram broker attachments require link-only bounded summary policy: "
                    f"{username}"
                )
    return payload


def linked_urls(text: str, entity_urls: Iterable[str] = ()) -> list[str]:
    """Return stable outbound links while excluding Telegram post permalinks."""
    candidates = [*URL_PATTERN.findall(text), *entity_urls]
    unique: dict[str, str] = {}
    for candidate in candidates:
        cleaned = str(candidate).rstrip(".,;:!?)\"]}'")
        canonical = canonicalize_url(cleaned)
        if not canonical or canonical.startswith(("https://t.me/", "http://t.me/")):
            continue
        unique.setdefault(canonical, cleaned)
    return list(unique.values())


def post_title(text: str, channel_name: str) -> str:
    first = next((line.strip(" #*-•\t") for line in text.splitlines() if line.strip()), "")
    return (first or f"{channel_name} 새 게시물")[:180]


def attachment_approval_key(
    *,
    channel_username: str,
    message_id: int,
    document_id: str,
    filename: str,
    size: int,
) -> str:
    digest = hashlib.sha256()
    digest.update(channel_username.casefold().encode("utf-8"))
    digest.update(str(int(message_id)).encode("ascii"))
    digest.update(document_id.encode("utf-8"))
    digest.update(filename.casefold().encode("utf-8"))
    digest.update(str(max(0, int(size))).encode("ascii"))
    return digest.hexdigest()


def attachment_for_message(
    channel: dict[str, Any],
    message: Any,
) -> dict[str, Any] | None:
    """Return bounded PDF metadata for explicitly allowlisted broker channels."""
    if channel.get("attachment_collection_allowed") is not True:
        return None
    file = getattr(message, "file", None)
    if not file:
        return None
    filename = str(getattr(file, "name", None) or "").strip()
    mime_type = str(getattr(file, "mime_type", None) or "").strip().lower()
    if Path(filename).suffix.lower() != ".pdf" and mime_type != "application/pdf":
        return None
    if not filename:
        filename = f"telegram_{channel['username']}_{int(message.id)}.pdf"
    size = max(0, int(getattr(file, "size", None) or 0))
    document = getattr(message, "document", None)
    document_id = str(getattr(document, "id", None) or "")
    username = str(channel["username"]).lstrip("@")
    return {
        "attachment_key": attachment_approval_key(
            channel_username=username,
            message_id=int(message.id),
            document_id=document_id,
            filename=filename,
            size=size,
        ),
        "filename": filename[:500],
        "mime_type": mime_type or "application/pdf",
        "size": size,
        "is_pdf": True,
        "channel_username": username,
        "channel_name": str(channel.get("name") or username)[:160],
        "message_id": int(message.id),
        "post_url": f"https://t.me/{username}/{int(message.id)}",
    }


def load_attachment_approval_registry(
    path: Path = ATTACHMENT_APPROVALS_PATH,
) -> tuple[dict[str, str], list[dict[str, Any]], str | None]:
    if not path.exists():
        return {}, [], None
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
        if (
            payload.get("schema_version") != ATTACHMENT_APPROVALS_SCHEMA
            or not isinstance(payload.get("decisions"), list)
        ):
            raise ValueError("unexpected approval registry schema")
        decisions: dict[str, str] = {}
        approved_targets: list[dict[str, Any]] = []
        for row in payload["decisions"]:
            if not isinstance(row, dict):
                continue
            key = str(row.get("attachment_key") or "").strip()
            decision = str(row.get("decision") or "").strip()
            if key and decision in {"approved", "excluded"}:
                decisions[key] = decision
            message_id = int(row.get("message_id") or 0)
            channel_username = str(row.get("channel_username") or "").strip().lstrip("@")
            if decision == "approved" and key and message_id > 0 and channel_username:
                approved_targets.append({
                    "attachment_key": key,
                    "message_id": message_id,
                    "channel_username": channel_username,
                })
        return decisions, approved_targets, None
    except (OSError, UnicodeDecodeError, json.JSONDecodeError, ValueError):
        return {}, [], "Telegram attachment approval registry is invalid; downloads were blocked"


def load_attachment_approvals(
    path: Path = ATTACHMENT_APPROVALS_PATH,
) -> tuple[dict[str, str], str | None]:
    decisions, _, notice = load_attachment_approval_registry(path)
    return decisions, notice


def broker_attachment_metadata(
    channel: dict[str, Any],
    attachment: dict[str, Any],
    *,
    published_at: datetime,
) -> dict[str, Any]:
    category = str(channel.get("category") or "broker_research")
    market_scope = "US" if category == "broker_us_equity_research" else "UNKNOWN"
    filename = str(attachment["filename"])
    return {
        "publisher": str(channel.get("name") or channel["username"]),
        "title": Path(filename).stem[:300],
        "published_at": published_at.astimezone(timezone.utc).isoformat(),
        "source_reference": (
            f"telegram:{attachment['channel_username']}:"
            f"{attachment['message_id']}:attachment:{attachment['attachment_key']}"
        ),
        "source_url": str(attachment["post_url"]),
        "acquisition_mode": "official_public_document",
        "analysis_allowed": True,
        "redistribution_allowed": False,
        "publication_policy": "summary_and_link_only",
        "rights_review_status": "public_source_reviewed",
        "rights_label": (
            "Official broker-channel PDF approved for private analysis; "
            "publish bounded summary and source link only."
        ),
        "tags": [category, "telegram_official_broker_pdf"],
        "tickers": [],
        "market_scope": market_scope,
        "issuer_country": "",
        "original_language": "ko",
        "base_currency": "USD" if market_scope == "US" else "",
        "research_path": ["Telegram", str(channel.get("name") or channel["username"])],
        "research": {
            "stance": "not_stated",
            "key_claims": [],
            "catalysts": [],
            "risks": [],
            "sectors": [],
        },
    }


def message_item(
    channel: dict[str, Any],
    *,
    message_id: int,
    published_at: datetime,
    text: str,
    entity_urls: Iterable[str] = (),
    max_analysis_chars: int = 1600,
    max_external_links: int = 8,
    forwarded_from: str | None = None,
    attachments: Iterable[dict[str, Any]] = (),
) -> dict[str, Any]:
    username = str(channel["username"]).lstrip("@")
    channel_name = str(channel.get("name") or username)
    policy = str(channel["publication_policy"])
    post_url = f"https://t.me/{username}/{int(message_id)}"
    outbound = linked_urls(text, entity_urls)[:max_external_links]
    bounded_text = text.strip()[:max_analysis_chars]
    if policy == "link_only_no_republication":
        # Preserve enough text for deterministic topic classification while
        # preventing the protected post from becoming a reusable text corpus.
        bounded_text = post_title(text, channel_name)
    item = make_item(
        source_id=f"telegram_{username.casefold()}",
        source_type="telegram_commentary",
        published_at=published_at.astimezone(timezone.utc).isoformat(),
        title=post_title(text, channel_name),
        url=post_url,
        tickers=[],
        tags=[
            "telegram",
            "market",
            str(channel.get("category") or "market_commentary"),
            f"telegram_priority_{int(channel.get('priority', 3))}",
        ],
        raw_text=bounded_text,
        rights_label=str(channel["rights_label"]),
        observation_date=published_at.date().isoformat(),
        release_date=published_at.astimezone(timezone.utc).isoformat(),
        market_cutoff="telegram_post_time",
        source_grade="D",
        primary_source_confirmed=False,
        evidence_scope="telegram_channel_post",
        evidence_label="discovery_lead_only",
        freshness_state="current_channel_post",
        publisher=channel_name,
        source_url_kind="publisher_article",
        link_required=True,
        source_reference=f"@{username}:{int(message_id)}",
        derivation_note=(
            "Telegram viewpoint/discovery lead. Verify material claims with "
            "official or trusted independent sources before factual use."
        ),
    )
    item["telegram"] = {
        "channel_username": username,
        "channel_name": channel_name,
        "category": str(channel.get("category") or "market_commentary"),
        "priority": int(channel.get("priority", 3)),
        "origin": str(channel.get("origin") or "configured"),
        "publication_policy": policy,
        "message_id": int(message_id),
        "forwarded_from": forwarded_from,
        "attachments": [dict(attachment) for attachment in attachments],
    }
    item["linked_urls"] = outbound
    return item


def entity_urls_for_message(message: Any) -> list[str]:
    urls: list[str] = []
    for entity in getattr(message, "entities", None) or []:
        value = getattr(entity, "url", None)
        if value:
            urls.append(str(value))
    return urls


def forwarded_source_for_message(message: Any) -> str | None:
    forward = getattr(message, "forward", None)
    if not forward:
        return None
    for attribute in ("from_name", "post_author"):
        value = getattr(forward, attribute, None)
        if value:
            return str(value)[:160]
    chat = getattr(forward, "chat", None)
    username = getattr(chat, "username", None) if chat else None
    return f"@{username}" if username else None


async def collect_async(
    registry: dict[str, Any],
    *,
    api_id: int,
    api_hash: str,
    session_string: str,
) -> tuple[list[dict[str, Any]], list[str]]:
    try:
        from telethon import TelegramClient
        from telethon.sessions import StringSession
    except ImportError as exc:
        raise RuntimeError("Telethon is not installed; install requirements.txt") from exc

    policy = registry["collection_policy"]
    cutoff = datetime.now(timezone.utc) - timedelta(hours=float(policy["lookback_hours"]))
    items: list[dict[str, Any]] = []
    failures: list[str] = []
    approval_decisions, approval_targets, approval_notice = (
        load_attachment_approval_registry()
    )
    if approval_notice:
        failures.append("attachment_approvals:invalid_registry")
    client = TelegramClient(StringSession(session_string), api_id, api_hash)
    await client.connect()
    try:
        if not await client.is_user_authorized():
            raise RuntimeError("Telegram session is not authorized")
        for channel in sorted(
            (item for item in registry["channels"] if item.get("enabled", True)),
            key=lambda item: (int(item.get("priority", 3)), str(item.get("username", "")).casefold()),
        ):
            username = str(channel["username"]).lstrip("@")
            try:
                seen_message_ids: set[int] = set()

                async def consume_message(message: Any, *, enforce_cutoff: bool) -> bool:
                    message_date = getattr(message, "date", None)
                    if not message_date:
                        return False
                    if message_date.tzinfo is None:
                        message_date = message_date.replace(tzinfo=timezone.utc)
                    if enforce_cutoff and message_date.astimezone(timezone.utc) < cutoff:
                        return True
                    message_id = int(message.id)
                    seen_message_ids.add(message_id)
                    attachment = attachment_for_message(channel, message)
                    if attachment:
                        attachment["approval_state"] = approval_decisions.get(
                            attachment["attachment_key"],
                            "pending",
                        )
                    text = str(getattr(message, "raw_text", None) or "").strip()
                    if not text and not attachment:
                        return False
                    if not text and attachment:
                        text = attachment["filename"]
                    items.append(message_item(
                        channel,
                        message_id=message_id,
                        published_at=message_date,
                        text=text,
                        entity_urls=entity_urls_for_message(message),
                        max_analysis_chars=int(policy["max_analysis_chars_per_post"]),
                        max_external_links=int(policy["max_external_links_per_post"]),
                        forwarded_from=forwarded_source_for_message(message),
                        attachments=[attachment] if attachment else [],
                    ))
                    if not attachment or attachment["approval_state"] != "approved":
                        return False
                    max_bytes = max(
                        1,
                        int(policy.get("max_attachment_bytes", DEFAULT_MAX_ATTACHMENT_BYTES)),
                    )
                    if attachment["size"] > max_bytes:
                        failures.append(f"{username}:{message_id}:attachment_too_large")
                        return False
                    try:
                        payload = await message.download_media(file=bytes)
                        if not isinstance(payload, bytes) or not payload:
                            raise RuntimeError("empty attachment payload")
                        if len(payload) > max_bytes:
                            raise RuntimeError("attachment exceeds size limit")
                        record = report_record(
                            source_id=f"telegram_broker_pdf_{username.casefold()}",
                            file_name=attachment["filename"],
                            payload=payload,
                            metadata=broker_attachment_metadata(
                                channel,
                                attachment,
                                published_at=message_date,
                            ),
                            document_text_cache_dir=DOCUMENT_TEXT_CACHE_DIR,
                        )
                        record["telegram_attachment"] = {
                            **attachment,
                            "approval_state": "approved",
                            "downloaded": True,
                        }
                        items.append(record)
                    except Exception as exc:
                        failures.append(
                            f"{username}:{message_id}:attachment_{bounded_failure(exc)}"
                        )
                    return False

                async for message in client.iter_messages(
                    username,
                    limit=int(policy["max_messages_per_channel"]),
                ):
                    if await consume_message(message, enforce_cutoff=True):
                        break

                backfill_ids = sorted({
                    int(target["message_id"])
                    for target in approval_targets
                    if str(target["channel_username"]).casefold() == username.casefold()
                    and int(target["message_id"]) not in seen_message_ids
                })
                if backfill_ids:
                    backfill_messages = await client.get_messages(username, ids=backfill_ids)
                    for message in backfill_messages or []:
                        if message:
                            await consume_message(message, enforce_cutoff=False)
            except Exception as exc:
                failures.append(f"{username}:{bounded_failure(exc)}")
    finally:
        await client.disconnect()
    return items, failures


def collect(_: dict[str, Any]) -> tuple[list[dict[str, Any]], str | None]:
    registry = load_registry()
    api_id_text = os.getenv("TELEGRAM_API_ID", "").strip()
    api_hash = os.getenv("TELEGRAM_API_HASH", "").strip()
    session_string = load_session_string()
    if not api_id_text or not api_hash or not session_string:
        return [], (
            "Telegram user-session collection is not configured. Set "
            "TELEGRAM_API_ID, TELEGRAM_API_HASH, and TELEGRAM_SESSION_STRING."
        )
    try:
        api_id = int(api_id_text)
    except ValueError as exc:
        raise ValueError("TELEGRAM_API_ID must be an integer") from exc
    items, failures = asyncio.run(collect_async(
        registry,
        api_id=api_id,
        api_hash=api_hash,
        session_string=session_string,
    ))
    failure_details = ", ".join(failures[:12])
    if len(failures) > 12:
        failure_details = f"{failure_details}, +{len(failures) - 12} more"
    if not items:
        suffix = (
            f" ({len(failures)} failure(s): {failure_details})"
            if failures
            else ""
        )
        return [], f"Telegram collection produced no usable posts{suffix}"
    notice = (
        f"Partial Telegram collection: {len(failures)} failure(s): {failure_details}"
        if failures else None
    )
    return items, notice
