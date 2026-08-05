"""Upload one local PNG to Notion and append it as an image block to a report page."""

from __future__ import annotations

import argparse
import json
import mimetypes
import os
import secrets
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from collectors.common import ROOT, load_dotenv
from publish_to_notion import NOTION_VERSION, rich_text


def api_json(url: str, method: str, token: str, payload: dict) -> dict:
    body = json.dumps(payload).encode("utf-8")
    request = Request(url, method=method, data=body, headers={
        "Authorization": f"Bearer {token}", "Notion-Version": NOTION_VERSION, "Content-Type": "application/json",
    })
    with urlopen(request, timeout=45) as response:
        return json.loads(response.read().decode("utf-8"))


def multipart_file(path: Path, boundary: str) -> bytes:
    content_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
    return b"".join([
        f"--{boundary}\r\n".encode(),
        f'Content-Disposition: form-data; name="file"; filename="{path.name}"\r\n'.encode(),
        f"Content-Type: {content_type}\r\n\r\n".encode(),
        path.read_bytes(), b"\r\n", f"--{boundary}--\r\n".encode(),
    ])


def main() -> None:
    parser = argparse.ArgumentParser(description="Append a private Notion-hosted image to a report page.")
    parser.add_argument("page_id", help="Notion page ID to receive the image")
    parser.add_argument("image_path", help="Local PNG/JPG path")
    parser.add_argument("--caption", default="미국 거시 모니터링 | FRED", help="Visible Notion image caption")
    parser.add_argument("--replace-image-block-id", help="Replace this existing Notion image block instead of appending a new one")
    args = parser.parse_args()
    load_dotenv()
    token = os.getenv("NOTION_TOKEN", "").strip()
    image_path = Path(args.image_path)
    if not token:
        raise SystemExit("Set NOTION_TOKEN in .env before uploading an image.")
    if not image_path.exists():
        raise SystemExit(f"Image does not exist: {image_path}")
    if image_path.stat().st_size > 20 * 1024 * 1024:
        raise SystemExit("This direct upload helper supports images up to 20 MB.")
    try:
        upload = api_json("https://api.notion.com/v1/file_uploads", "POST", token, {
            "filename": image_path.name,
            "content_type": mimetypes.guess_type(image_path.name)[0] or "image/png",
        })
        boundary = "----NotionUpload" + secrets.token_hex(12)
        upload_request = Request(upload["upload_url"], method="POST", data=multipart_file(image_path, boundary), headers={
            "Authorization": f"Bearer {token}", "Notion-Version": NOTION_VERSION,
            "Content-Type": f"multipart/form-data; boundary={boundary}",
        })
        with urlopen(upload_request, timeout=60) as response:
            sent = json.loads(response.read().decode("utf-8"))
        if sent.get("status") != "uploaded":
            raise SystemExit(f"Notion did not mark the image uploaded: {sent.get('status')}")
        image_block = {"type": "file_upload", "file_upload": {"id": upload["id"]}, "caption": rich_text(args.caption)}
        if args.replace_image_block_id:
            # The 2026-03-11 update-block schema infers image file-upload type.
            update_image = {"file_upload": {"id": upload["id"]}, "caption": rich_text(args.caption)}
            api_json(f"https://api.notion.com/v1/blocks/{args.replace_image_block_id}", "PATCH", token, {"image": update_image})
            print(f"Image replaced in Notion block: {args.replace_image_block_id}")
        else:
            append_payload = {
                "children": [{"object": "block", "type": "image", "image": image_block}],
            }
            api_json(f"https://api.notion.com/v1/blocks/{args.page_id}/children", "PATCH", token, append_payload)
            print(f"Image attached to Notion page: {args.page_id}")
    except HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise SystemExit(f"Notion returned HTTP {exc.code}: {detail}") from exc


if __name__ == "__main__":
    main()
