"""Publish a brief in reading order: heading, chart, then its Korean explanation."""

from __future__ import annotations

import argparse
import json
import mimetypes
import os
import secrets
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from collectors.common import load_dotenv
from publish_to_notion import (
    NOTION_VERSION,
    archive_page,
    compact_page_title,
    markdown_blocks,
    report_masthead,
    report_navigation,
    rich_text,
)


MAX_CHILDREN_PER_REQUEST = 100


def api_json(url: str, method: str, token: str, payload: dict) -> dict:
    request = Request(url, method=method, data=json.dumps(payload).encode("utf-8"), headers={
        "Authorization": f"Bearer {token}", "Notion-Version": NOTION_VERSION, "Content-Type": "application/json",
    })
    with urlopen(request, timeout=45) as response:
        return json.loads(response.read().decode("utf-8"))


def append_blocks(page_id: str, blocks: list[dict], token: str) -> None:
    """Append page children without exceeding Notion's per-request limit."""
    for start in range(0, len(blocks), MAX_CHILDREN_PER_REQUEST):
        api_json(f"https://api.notion.com/v1/blocks/{page_id}/children", "PATCH", token, {
            "children": blocks[start:start + MAX_CHILDREN_PER_REQUEST],
        })


def http_error_detail(error: HTTPError) -> str:
    """Return a bounded Notion response body so remote failures are actionable."""
    try:
        body = error.read().decode("utf-8", errors="replace").strip()
    except (AttributeError, OSError):
        body = ""
    detail = f"HTTP {error.code}"
    if error.reason:
        detail += f" {error.reason}"
    if body:
        detail += f": {body[:2000]}"
    return detail


def multipart_file(path: Path, boundary: str) -> bytes:
    content_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
    return b"".join([
        f"--{boundary}\r\n".encode(),
        f'Content-Disposition: form-data; name="file"; filename="{path.name}"\r\n'.encode(),
        f"Content-Type: {content_type}\r\n\r\n".encode(),
        path.read_bytes(), b"\r\n", f"--{boundary}--\r\n".encode(),
    ])


def append_image(page_id: str, path: Path, caption: str, token: str) -> None:
    upload = api_json("https://api.notion.com/v1/file_uploads", "POST", token, {
        "filename": path.name,
        "content_type": mimetypes.guess_type(path.name)[0] or "image/png",
    })
    boundary = "----NotionUpload" + secrets.token_hex(12)
    request = Request(upload["upload_url"], method="POST", data=multipart_file(path, boundary), headers={
        "Authorization": f"Bearer {token}", "Notion-Version": NOTION_VERSION,
        "Content-Type": f"multipart/form-data; boundary={boundary}",
    })
    with urlopen(request, timeout=60) as response:
        result = json.loads(response.read().decode("utf-8"))
    if result.get("status") != "uploaded":
        raise SystemExit(f"Notion did not mark the image uploaded: {result.get('status')}")
    image = {"type": "file_upload", "file_upload": {"id": upload["id"]}}
    if caption:
        image["caption"] = rich_text(caption)
    append_blocks(page_id, [{"object": "block", "type": "image", "image": image}], token)


def block_text(block: dict) -> str:
    kind = block.get("type", "")
    return "".join(part.get("text", {}).get("content", "") for part in block.get(kind, {}).get("rich_text", []))


def main() -> None:
    parser = argparse.ArgumentParser(description="Publish a Korean chart-first Notion report.")
    parser.add_argument("brief_markdown")
    parser.add_argument("--pulse-image", required=True)
    parser.add_argument("--macro-image", required=True)
    parser.add_argument("--etf-image", required=True)
    parser.add_argument("--etf-heatmap-image", required=True)
    parser.add_argument("--news-images", nargs="*", default=[], help="Optional mobile-readable Korean international-news cards")
    parser.add_argument("--archive-page-id", help="Archive this page only after successful publication")
    parser.add_argument("--dry-run", action="store_true", help="Validate the brief and all visual inputs without calling Notion")
    args = parser.parse_args()
    load_dotenv()
    pulse_image = Path(args.pulse_image)
    macro_image, etf_image, etf_heatmap_image = Path(args.macro_image), Path(args.etf_image), Path(args.etf_heatmap_image)
    news_images = [Path(image) for image in args.news_images]
    for image in (pulse_image, macro_image, etf_image, etf_heatmap_image, *news_images):
        if not image.exists():
            raise SystemExit(f"Image does not exist: {image}")

    title, blocks = markdown_blocks(Path(args.brief_markdown).read_text(encoding="utf-8"))
    if args.dry_run:
        print(f"Dry run validated: {compact_page_title(title)} · blocks {len(blocks)} · images {4 + len(news_images)}")
        return
    token = os.getenv("NOTION_TOKEN", "").strip()
    parent = os.getenv("NOTION_PARENT_PAGE_ID", "").strip()
    if not token or not parent:
        raise SystemExit("Set NOTION_TOKEN and NOTION_PARENT_PAGE_ID in .env first.")
    page = api_json("https://api.notion.com/v1/pages", "POST", token, {
        "parent": {"type": "page_id", "page_id": parent},
        "properties": {"title": {"title": rich_text(compact_page_title(title))}},
    })
    page_id = page["id"]
    pending: list[dict] = [report_masthead(title), report_navigation()]
    chart_after_heading = {
        "오늘의 결론": (pulse_image, "시장 펄스 | 주요 자산 1일 변화와 향후 7일 확정 일정"),
        "거시 지표와 시장 맥락": (macro_image, "미국 거시 모니터링 | FRED 관측치"),
        "ETF 모니터링": [
            (etf_image, "ETF 모니터링 | 최근 약 3개월 일별 종가"),
            (etf_heatmap_image, "ETF 상대강도 | 1일·1주·3개월 수익률"),
        ],
    }
    if news_images:
        chart_after_heading["해외 뉴스"] = [
            # The headline and Korean explanation are already inside each
            # image.  Repeating a long Notion caption beneath every card made
            # the narrow mobile layout look like broken, duplicated text.
            (image, "")
            for image in news_images
        ]
    try:
        for block in blocks:
            pending.append(block)
            chart = chart_after_heading.get(block_text(block)) if block.get("type") == "heading_2" else None
            if chart:
                append_blocks(page_id, pending, token)
                pending = []
                charts = chart if isinstance(chart, list) else [chart]
                for image, caption in charts:
                    append_image(page_id, image, caption, token)
        if pending:
            append_blocks(page_id, pending, token)
    except HTTPError as exc:
        raise SystemExit(
            f"Notion visual publish failed after page creation ({http_error_detail(exc)}). "
            "Page was not archived."
        ) from exc
    except KeyError as exc:
        raise SystemExit(
            f"Notion visual publish failed after page creation (missing response field: {exc}). "
            "Page was not archived."
        ) from exc
    print(f"Published: {page.get('url', '(Notion returned no URL)')}")
    github_output = os.getenv("GITHUB_OUTPUT", "").strip()
    if github_output and page.get("url"):
        with Path(github_output).open("a", encoding="utf-8") as output_file:
            output_file.write(f"notion_url={page['url']}\n")
    if args.archive_page_id:
        archive_page(args.archive_page_id, token)


if __name__ == "__main__":
    main()
