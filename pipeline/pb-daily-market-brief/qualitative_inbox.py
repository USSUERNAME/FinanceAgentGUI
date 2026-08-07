"""Notion helpers for a private qualitative-research inbox.

Article text is never fetched from publishers.  The only long-form input used
for analysis is text the user pasted into the private Notion item.
"""

from __future__ import annotations

import json
import os
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from collectors.common import load_dotenv
from publish_to_notion import NOTION_VERSION

INBOX_STATUS_CANDIDATE = "후보"
INBOX_STATUS_SELECTED = "분석할 글"
INBOX_STATUS_DONE = "완료"


def rich_text(content: str) -> list[dict[str, Any]]:
    return [{"type": "text", "text": {"content": content[:1900]}}] if content else []


def api_json(url: str, method: str, token: str, payload: dict[str, Any] | None = None) -> dict[str, Any]:
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8") if payload is not None else None
    request = Request(url, method=method, data=body, headers={
        "Authorization": f"Bearer {token}", "Notion-Version": NOTION_VERSION, "Content-Type": "application/json",
    })
    try:
        with urlopen(request, timeout=45) as response:
            return json.loads(response.read().decode("utf-8"))
    except HTTPError as exc:
        # Provider details are intentionally not printed because request context can be sensitive.
        raise SystemExit(f"Notion returned HTTP {exc.code} while processing the qualitative inbox.") from exc
    except URLError as exc:
        raise SystemExit("Notion could not be reached while processing the qualitative inbox.") from exc


def token_and_source_id() -> tuple[str, str]:
    load_dotenv()
    token = os.getenv("NOTION_TOKEN", "").strip()
    data_source_id = os.getenv("QUALITATIVE_INBOX_DATA_SOURCE_ID", "").strip()
    if not token:
        raise SystemExit("Set NOTION_TOKEN before using the qualitative inbox.")
    if not data_source_id:
        raise SystemExit("Set QUALITATIVE_INBOX_DATA_SOURCE_ID before using the qualitative inbox.")
    return token, data_source_id


def plain_text(value: dict[str, Any]) -> str:
    return "".join(part.get("plain_text", "") for part in value.get("rich_text", []))


def title_text(value: dict[str, Any]) -> str:
    return "".join(part.get("plain_text", "") for part in value.get("title", []))


def block_text(block: dict[str, Any]) -> str:
    """Return visible rich text from one ordinary Notion block."""
    for block_type in (
        "paragraph", "heading_1", "heading_2", "heading_3", "bulleted_list_item",
        "numbered_list_item", "to_do", "toggle", "quote", "callout", "code",
    ):
        value = block.get(block_type)
        if isinstance(value, dict):
            text = "".join(part.get("plain_text", "") for part in value.get("rich_text", []))
            if text:
                return text
    return ""


def page_body_text(token: str, page_id: str, max_chars: int = 12000) -> str:
    """Read only text pasted by the user into the private Notion page body."""
    parts: list[str] = []
    cursor: str | None = None
    while len("\n".join(parts)) < max_chars:
        url = f"https://api.notion.com/v1/blocks/{page_id}/children?page_size=100"
        if cursor:
            url += f"&start_cursor={cursor}"
        response = api_json(url, "GET", token)
        for block in response.get("results", []):
            text = block_text(block)
            if text:
                parts.append(text)
        cursor = response.get("next_cursor")
        if not response.get("has_more"):
            break
    return "\n\n".join(parts)[:max_chars]


def fetch_pages(token: str, data_source_id: str) -> list[dict[str, Any]]:
    pages: list[dict[str, Any]] = []
    cursor: str | None = None
    while True:
        payload: dict[str, Any] = {"page_size": 100}
        if cursor:
            payload["start_cursor"] = cursor
        response = api_json(f"https://api.notion.com/v1/data_sources/{data_source_id}/query", "POST", token, payload)
        pages.extend(response.get("results", []))
        cursor = response.get("next_cursor")
        if not response.get("has_more"):
            return pages


def existing_urls(token: str, data_source_id: str) -> set[str]:
    urls: set[str] = set()
    for page in fetch_pages(token, data_source_id):
        value = page.get("properties", {}).get("원문 링크", {}).get("url")
        if value:
            urls.add(value)
    return urls


def create_candidate(token: str, data_source_id: str, candidate: dict[str, Any]) -> None:
    properties = {
        "제목": {"title": rich_text(candidate["title"])},
        "원문 링크": {"url": candidate["url"]},
        "출처": {"select": {"name": candidate["source"]}},
        "발행일": {"date": {"start": candidate["published_at"][:10]}} if candidate.get("published_at") else {"date": None},
        "테마": {"multi_select": [{"name": theme} for theme in candidate.get("themes", [])]},
        "상태": {"select": {"name": INBOX_STATUS_CANDIDATE}},
        "후보 이유": {"rich_text": rich_text(candidate["reason"])},
        "권리 처리": {"select": {"name": "링크 전용"}},
    }
    api_json("https://api.notion.com/v1/pages", "POST", token, {
        "parent": {"type": "data_source_id", "data_source_id": data_source_id},
        "properties": properties,
    })


def selected_items(token: str, data_source_id: str) -> list[dict[str, Any]]:
    selected: list[dict[str, Any]] = []
    for page in fetch_pages(token, data_source_id):
        props = page.get("properties", {})
        if props.get("상태", {}).get("select", {}).get("name") != INBOX_STATUS_SELECTED:
            continue
        property_excerpt = plain_text(props.get("원문 발췌", {}))
        page_excerpt = page_body_text(token, page["id"])
        selected.append({
            "page_id": page["id"],
            "title": title_text(props.get("제목", {})),
            "url": props.get("원문 링크", {}).get("url", ""),
            "source": props.get("출처", {}).get("select", {}).get("name", ""),
            "themes": [item.get("name", "") for item in props.get("테마", {}).get("multi_select", [])],
            # Keep the legacy field readable so existing selected rows still work.
            "memo": plain_text(props.get("내 메모", {})),
            "property_excerpt": property_excerpt,
            "page_excerpt": page_excerpt,
            "reason": plain_text(props.get("후보 이유", {})),
        })
    return selected


def mark_done(token: str, page_id: str) -> None:
    api_json(f"https://api.notion.com/v1/pages/{page_id}", "PATCH", token, {
        "properties": {"상태": {"select": {"name": INBOX_STATUS_DONE}}},
    })
