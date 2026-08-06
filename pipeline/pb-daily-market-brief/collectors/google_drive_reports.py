"""Collect explicitly authorized broker reports from one private Drive folder."""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from broker_research_policy import (
    DOCUMENT_TEXT_CACHE_DIR,
    SUPPORTED_DOCUMENT_SUFFIXES,
    report_record,
)

TOKEN_URL = "https://oauth2.googleapis.com/token"
DRIVE_API = "https://www.googleapis.com/drive/v3/files"
DRIVE_FOLDER_MIME_TYPE = "application/vnd.google-apps.folder"
MAX_DRIVE_FOLDERS = 100
DEFAULT_MAX_FILES = 100
MARKET_SCOPE_FOLDER_ALIASES = {
    "KR": "KR",
    "KOREA": "KR",
    "국내": "KR",
    "US": "US",
    "USA": "US",
    "미국": "US",
    "GLOBAL": "GLOBAL",
    "글로벌": "GLOBAL",
    "EU": "EU",
    "EUROPE": "EU",
    "유럽": "EU",
    "JP": "JP",
    "JAPAN": "JP",
    "일본": "JP",
}
APPROVAL_REGISTRY_SCHEMA = "google_drive_broker_research_approvals.v1"
APPROVAL_REGISTRY_PATH = (
    Path(__file__).resolve().parents[1]
    / "workspace"
    / "broker_research_approvals"
    / "google_drive.json"
)


def _credentials() -> tuple[dict[str, str], list[str]]:
    keys = {
        "client_id": os.getenv("GOOGLE_DRIVE_CLIENT_ID", "").strip(),
        "client_secret": os.getenv("GOOGLE_DRIVE_CLIENT_SECRET", "").strip(),
        "refresh_token": os.getenv("GOOGLE_DRIVE_REFRESH_TOKEN", "").strip(),
        "folder_id": os.getenv("GOOGLE_DRIVE_RESEARCH_FOLDER_ID", "").strip(),
    }
    return keys, [key for key, value in keys.items() if not value]


def _json_request(
    request: Request,
    *,
    operation: str,
    timeout: int = 30,
) -> dict[str, Any]:
    try:
        with urlopen(request, timeout=timeout) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except HTTPError as exc:
        error_code = ""
        try:
            error_payload = json.loads(exc.read().decode("utf-8"))
            if isinstance(error_payload, dict):
                raw_error = error_payload.get("error")
                if isinstance(raw_error, str):
                    error_code = raw_error.strip()
                elif isinstance(raw_error, dict):
                    error_code = str(raw_error.get("status") or "").strip()
        except (AttributeError, UnicodeDecodeError, json.JSONDecodeError):
            pass
        suffix = f" ({error_code})" if error_code else ""
        raise RuntimeError(
            f"Google Drive {operation} returned HTTP {exc.code}{suffix}"
        ) from exc
    except URLError as exc:
        raise RuntimeError("Google Drive could not be reached") from exc
    if not isinstance(payload, dict):
        raise RuntimeError("Google Drive returned an unexpected response")
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
        raise RuntimeError("Google Drive OAuth response did not include an access token")
    return token


def _list_direct_children(
    token: str,
    folder_id: str,
    *,
    page_size: int,
) -> list[dict[str, Any]]:
    query = urlencode({
        "q": f"'{folder_id}' in parents and trashed = false",
        "fields": "files(id,name,mimeType,modifiedTime,size,md5Checksum,parents)",
        "orderBy": "modifiedTime desc",
        "pageSize": str(page_size),
    })
    payload = _json_request(
        Request(
            f"{DRIVE_API}?{query}",
            headers={"Authorization": f"Bearer {token}"},
        ),
        operation="folder listing",
    )
    files = payload.get("files") or []
    return [item for item in files if isinstance(item, dict)]


def list_folder_files(token: str, folder_id: str, *, max_files: int) -> list[dict[str, Any]]:
    """List report files below the configured root while preserving folder lineage."""
    queue: list[tuple[str, list[str]]] = [(folder_id, [])]
    visited: set[str] = set()
    discovered: list[dict[str, Any]] = []
    while queue and len(visited) < MAX_DRIVE_FOLDERS:
        current_id, path = queue.pop(0)
        if current_id in visited:
            continue
        visited.add(current_id)
        for item in _list_direct_children(
            token,
            current_id,
            page_size=100,
        ):
            item_id = str(item.get("id") or "").strip()
            name = str(item.get("name") or "").strip()
            if not item_id or not name:
                continue
            if item.get("mimeType") == DRIVE_FOLDER_MIME_TYPE:
                queue.append((item_id, [*path, name]))
                continue
            discovered.append({
                **item,
                "drive_parent_id": current_id,
                "drive_path": path,
            })
    supported = sorted(
        (
            item for item in discovered
            if Path(str(item.get("name") or "")).suffix.lower()
            in SUPPORTED_DOCUMENT_SUFFIXES
        ),
        key=lambda item: str(item.get("modifiedTime") or ""),
        reverse=True,
    )[:max_files]
    selected_keys = {
        (
            str(item.get("drive_parent_id") or folder_id),
            f"{Path(str(item.get('name') or '')).stem}.meta.json",
        )
        for item in supported
    }
    sidecars = [
        item for item in discovered
        if (
            str(item.get("drive_parent_id") or folder_id),
            str(item.get("name") or ""),
        ) in selected_keys
    ]
    return [*supported, *sidecars]


def infer_folder_metadata(document: dict[str, Any]) -> dict[str, Any]:
    path = [
        str(value).strip()
        for value in document.get("drive_path") or []
        if str(value).strip()
    ]
    market_scope = "UNKNOWN"
    for segment in path:
        alias = MARKET_SCOPE_FOLDER_ALIASES.get(segment.upper())
        if alias:
            market_scope = alias
            break
    inferred: dict[str, Any] = {
        "drive_path": path,
        "research_path": path,
        "market_scope": market_scope,
    }
    if market_scope in {"KR", "US", "JP"}:
        inferred["issuer_country"] = market_scope
    if market_scope == "US":
        inferred.update({"original_language": "en", "base_currency": "USD"})
    return inferred


def apply_folder_metadata(
    metadata: dict[str, Any],
    document: dict[str, Any],
) -> dict[str, Any]:
    inferred = infer_folder_metadata(document)
    enriched = dict(metadata)
    if str(enriched.get("market_scope") or "UNKNOWN").upper() == "UNKNOWN":
        enriched["market_scope"] = inferred["market_scope"]
    for field in ("issuer_country", "original_language", "base_currency"):
        if not str(enriched.get(field) or "").strip() and inferred.get(field):
            enriched[field] = inferred[field]
    if not enriched.get("research_path") and inferred["research_path"]:
        enriched["research_path"] = inferred["research_path"]
    enriched["drive_path"] = inferred["drive_path"]
    return enriched


def download_file(token: str, file_id: str) -> bytes:
    request = Request(
        f"{DRIVE_API}/{file_id}?alt=media",
        headers={"Authorization": f"Bearer {token}"},
    )
    try:
        with urlopen(request, timeout=30) as response:
            return response.read()
    except HTTPError as exc:
        raise RuntimeError(f"Google Drive file download returned HTTP {exc.code}") from exc
    except URLError as exc:
        raise RuntimeError("Google Drive file download failed") from exc


def load_local_approvals(path: Path | None = None) -> dict[str, dict[str, Any]]:
    registry_path = path or APPROVAL_REGISTRY_PATH
    if not registry_path.exists():
        return {}
    try:
        payload = json.loads(registry_path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError):
        return {}
    if payload.get("schema_version") != APPROVAL_REGISTRY_SCHEMA:
        return {}
    decisions = payload.get("decisions")
    if not isinstance(decisions, list):
        return {}
    indexed: dict[str, dict[str, Any]] = {}
    for decision in decisions:
        if not isinstance(decision, dict):
            continue
        file_id = str(decision.get("file_id") or "").strip()
        state = str(decision.get("decision") or "").strip()
        if file_id and state in {"approved", "excluded"}:
            indexed[file_id] = decision
    return indexed


def collect(_: dict[str, Any]) -> tuple[list[dict[str, Any]], str | None]:
    credentials, missing = _credentials()
    if missing:
        return [], "Google Drive research inbox not configured"
    max_files = max(
        2,
        min(
            int(os.getenv("GOOGLE_DRIVE_RESEARCH_MAX_FILES", str(DEFAULT_MAX_FILES))),
            100,
        ),
    )
    token = refresh_access_token(credentials)
    files = list_folder_files(
        token,
        credentials["folder_id"],
        max_files=max_files,
    )
    by_folder_and_name = {
        (
            str(item.get("drive_parent_id") or credentials["folder_id"]),
            str(item.get("name") or ""),
        ): item
        for item in files if str(item.get("name") or "")
    }
    approvals = load_local_approvals()
    documents = [
        item for item in files
        if Path(str(item.get("name") or "")).suffix.lower() in SUPPORTED_DOCUMENT_SUFFIXES
    ]
    records: list[dict[str, Any]] = []
    rejected = 0
    for document in documents:
        name = str(document["name"])
        sidecar_name = f"{Path(name).stem}.meta.json"
        parent_id = str(document.get("drive_parent_id") or credentials["folder_id"])
        sidecar = by_folder_and_name.get((parent_id, sidecar_name))
        file_id = str(document.get("id") or "").strip()
        local_decision = approvals.get(file_id)
        if (
            local_decision
            and str(local_decision.get("file_name") or "") != name
        ):
            local_decision = None
        if local_decision and local_decision.get("decision") == "excluded":
            continue
        if not sidecar and not (
            local_decision
            and local_decision.get("decision") == "approved"
            and isinstance(local_decision.get("metadata"), dict)
        ):
            rejected += 1
            continue
        try:
            metadata_payload = (
                json.loads(download_file(token, str(sidecar["id"])).decode("utf-8"))
                if sidecar
                else dict(local_decision["metadata"])
            )
            if not isinstance(metadata_payload, dict):
                raise ValueError("Drive report sidecar must be an object")
            metadata_payload = apply_folder_metadata(metadata_payload, document)
            metadata_payload["acquisition_mode"] = "operator_authorized_drive"
            metadata_payload.setdefault(
                "source_reference",
                f"drive:{file_id}",
            )
            records.append(report_record(
                source_id="google_drive_research_inbox",
                file_name=name,
                payload=download_file(token, file_id),
                metadata=metadata_payload,
                document_text_cache_dir=DOCUMENT_TEXT_CACHE_DIR,
            ))
        except (RuntimeError, ValueError, UnicodeDecodeError, json.JSONDecodeError):
            rejected += 1
    notice = (
        f"{rejected} Drive report(s) rejected by the rights or document gate"
        if rejected else None
    )
    return records, notice
