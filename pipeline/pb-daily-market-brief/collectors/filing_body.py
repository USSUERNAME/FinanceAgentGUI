"""Bounded official filing-body extraction helpers for SEC EDGAR and OpenDART."""

from __future__ import annotations

import re
import zipfile
from html.parser import HTMLParser
from io import BytesIO
from typing import Any
from urllib.parse import urlencode, urlsplit
from urllib.parse import urljoin
from urllib.request import Request, urlopen


class FilingTextParser(HTMLParser):
    BLOCKED = {"script", "style", "noscript", "svg", "form"}
    BREAKS = {
        "br", "div", "p", "li", "tr", "td", "th", "table", "section",
        "h1", "h2", "h3", "h4", "h5", "h6",
    }

    def __init__(self) -> None:
        super().__init__()
        self.blocked_depth = 0
        self.parts: list[str] = []

    def handle_starttag(self, tag: str, _attrs: list[tuple[str, str | None]]) -> None:
        lowered = tag.lower()
        if lowered in self.BLOCKED:
            self.blocked_depth += 1
        elif not self.blocked_depth and lowered in self.BREAKS:
            self.parts.append("\n")

    def handle_endtag(self, tag: str) -> None:
        lowered = tag.lower()
        if lowered in self.BLOCKED and self.blocked_depth:
            self.blocked_depth -= 1
        elif not self.blocked_depth and lowered in self.BREAKS:
            self.parts.append("\n")

    def handle_data(self, data: str) -> None:
        if not self.blocked_depth:
            text = re.sub(r"\s+", " ", data).strip()
            if text:
                self.parts.append(text)


class FilingLinkParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.current_href: str | None = None
        self.current_text: list[str] = []
        self.links: list[tuple[str, str]] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag.lower() != "a":
            return
        values = {key.lower(): value for key, value in attrs}
        self.current_href = values.get("href")
        self.current_text = []

    def handle_data(self, data: str) -> None:
        if self.current_href is not None:
            self.current_text.append(data)

    def handle_endtag(self, tag: str) -> None:
        if tag.lower() == "a" and self.current_href is not None:
            self.links.append((
                self.current_href,
                re.sub(r"\s+", " ", " ".join(self.current_text)).strip(),
            ))
            self.current_href = None
            self.current_text = []


def extract_filing_text(markup: str, max_chars: int) -> str:
    parser = FilingTextParser()
    parser.feed(markup)
    text = " ".join(parser.parts)
    text = re.sub(r"[ \t]*\n[ \t]*", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    text = re.sub(r"[ \t]{2,}", " ", text).strip()
    return text[:max_chars]


def decode_document(raw: bytes) -> str:
    for encoding in ("utf-8-sig", "utf-8", "cp949", "euc-kr"):
        try:
            return raw.decode(encoding)
        except UnicodeDecodeError:
            continue
    return raw.decode("utf-8", errors="replace")


def sec_exhibit_links(markup: str, base_url: str, max_links: int = 2) -> list[dict[str, str]]:
    parser = FilingLinkParser()
    parser.feed(markup)
    results: list[dict[str, str]] = []
    seen: set[str] = set()
    for href, label in parser.links:
        combined = f"{label} {href}".casefold()
        if not any(token in combined for token in ("ex-99", "exhibit 99", "99.1", "exhibit99")):
            continue
        url = urljoin(base_url, href)
        host = (urlsplit(url).hostname or "").lower()
        if host != "sec.gov" and not host.endswith(".sec.gov"):
            continue
        if url in seen:
            continue
        seen.add(url)
        results.append({"url": url, "label": label or "Exhibit 99"})
        if len(results) >= max_links:
            break
    return results


def fetch_sec_markup(
    url: str,
    user_agent: str,
    *,
    max_bytes: int,
) -> dict[str, Any]:
    request = Request(url, headers={"User-Agent": user_agent, "Accept-Encoding": "identity"})
    try:
        with urlopen(request, timeout=30) as response:
            final_url = response.geturl()
            final_host = (urlsplit(final_url).hostname or "").lower()
            if final_host != "sec.gov" and not final_host.endswith(".sec.gov"):
                return {"status": "redirected_outside_sec", "markup": None}
            raw = response.read(max_bytes + 1)
            byte_limit_reached = len(raw) > max_bytes
            raw = raw[:max_bytes]
            charset = response.headers.get_content_charset() or "utf-8"
            return {
                "status": "markup_fetched",
                "markup": raw.decode(charset, errors="replace"),
                "final_url": final_url,
                "byte_limit_reached": byte_limit_reached,
            }
    except Exception as exc:
        return {
            "status": "filing_body_fetch_failed",
            "error_type": type(exc).__name__,
            "markup": None,
        }


def fetch_sec_document(
    url: str,
    user_agent: str,
    *,
    form: str | None = None,
    max_chars: int = 6000,
    max_bytes: int = 2_000_000,
) -> dict[str, Any]:
    host = (urlsplit(url).hostname or "").lower()
    if host != "sec.gov" and not host.endswith(".sec.gov"):
        return {"status": "not_permitted_non_sec_domain", "text": None}
    if not user_agent or "@" not in user_agent:
        return {"status": "missing_sec_user_agent", "text": None}
    primary = fetch_sec_markup(url, user_agent, max_bytes=max_bytes)
    markup = str(primary.get("markup") or "")
    if not markup:
        return {
            key: value for key, value in primary.items() if key != "markup"
        } | {"text": None}
    primary_text = extract_filing_text(
        markup,
        max_chars * 4 if str(form or "").upper() == "8-K" else max_chars,
    )
    if str(form or "").upper() == "8-K":
        item_match = re.search(r"\bItem\s+[1-9]\.\d{2}\b", primary_text, flags=re.IGNORECASE)
        if item_match:
            primary_text = primary_text[item_match.start():]

    attachment_rows: list[dict[str, Any]] = []
    attachment_texts: list[str] = []
    if str(form or "").upper() == "8-K":
        for attachment in sec_exhibit_links(markup, str(primary.get("final_url") or url)):
            fetched = fetch_sec_markup(attachment["url"], user_agent, max_bytes=max_bytes)
            attachment_markup = str(fetched.get("markup") or "")
            attachment_text = extract_filing_text(attachment_markup, max_chars) if attachment_markup else ""
            attachment_rows.append({
                "url": str(fetched.get("final_url") or attachment["url"]),
                "label": attachment["label"],
                "status": "filing_body_extracted" if attachment_text else fetched.get("status"),
                "text_chars": len(attachment_text),
            })
            if attachment_text:
                attachment_texts.append(
                    f"[{attachment['label']}]\n{attachment_text}"
                )

    primary_budget = max_chars if not attachment_texts else max(1500, max_chars // 2)
    combined = primary_text[:primary_budget]
    if attachment_texts:
        combined = f"{combined}\n\n" + "\n\n".join(attachment_texts)
    text = combined[:max_chars].strip()
    if not text:
        return {"status": "no_filing_body_text", "text": None}
    return {
        "status": "filing_body_extracted",
        "text": text,
        "text_chars": len(text),
        "byte_limit_reached": bool(primary.get("byte_limit_reached")),
        "final_url": primary.get("final_url"),
        "attachments": attachment_rows,
    }


def fetch_dart_document(
    receipt_no: str,
    api_key: str,
    *,
    max_chars: int = 6000,
    max_bytes: int = 4_000_000,
) -> dict[str, Any]:
    query = urlencode({"crtfc_key": api_key, "rcept_no": receipt_no})
    request = Request(
        f"https://opendart.fss.or.kr/api/document.xml?{query}",
        headers={"User-Agent": "pb-daily-market-brief/1.0"},
    )
    try:
        with urlopen(request, timeout=30) as response:
            raw = response.read(max_bytes + 1)
        if len(raw) > max_bytes:
            return {"status": "filing_archive_too_large", "text": None}
        try:
            archive = zipfile.ZipFile(BytesIO(raw))
        except zipfile.BadZipFile:
            return {"status": "invalid_dart_document_archive", "text": None}

        remaining = max_bytes
        documents: list[str] = []
        entry_count = 0
        for info in archive.infolist():
            if info.is_dir() or not info.filename.lower().endswith((".xml", ".html", ".htm")):
                continue
            if info.file_size > remaining:
                break
            with archive.open(info) as member:
                member_raw = member.read(remaining + 1)
            if len(member_raw) > remaining:
                break
            remaining -= len(member_raw)
            entry_count += 1
            documents.append(decode_document(member_raw))
        text = extract_filing_text("\n".join(documents), max_chars)
        if not text:
            return {"status": "no_filing_body_text", "text": None}
        return {
            "status": "filing_body_extracted",
            "text": text,
            "text_chars": len(text),
            "archive_entry_count": entry_count,
        }
    except Exception as exc:
        return {
            "status": "filing_body_fetch_failed",
            "error_type": type(exc).__name__,
            "text": None,
        }
