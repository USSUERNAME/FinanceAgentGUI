"""List top-level report blocks so charts can be inserted under their headings."""

from __future__ import annotations

import argparse
import json
import os
from urllib.request import Request, urlopen

from collectors.common import load_dotenv
from publish_to_notion import NOTION_VERSION


def plain_text(block: dict) -> str:
    kind = block.get("type", "")
    data = block.get(kind, {})
    return "".join(piece.get("plain_text", "") for piece in data.get("rich_text", []))


def main() -> None:
    parser = argparse.ArgumentParser(description="Print report heading IDs for ordered image insertion.")
    parser.add_argument("page_id")
    args = parser.parse_args()
    load_dotenv()
    token = os.getenv("NOTION_TOKEN", "").strip()
    if not token:
        raise SystemExit("Set NOTION_TOKEN in .env first.")
    request = Request(
        f"https://api.notion.com/v1/blocks/{args.page_id}/children?page_size=100",
        headers={"Authorization": f"Bearer {token}", "Notion-Version": NOTION_VERSION},
    )
    with urlopen(request, timeout=30) as response:
        payload = json.loads(response.read().decode("utf-8"))
    for index, block in enumerate(payload.get("results", []), start=1):
        if block.get("type") in {"heading_1", "heading_2", "heading_3"}:
            print(f"{index}\t{block['id']}\t{plain_text(block)}")
        elif block.get("type") == "image":
            caption = block.get("image", {}).get("caption", [])
            caption_text = caption[0].get("plain_text", "") if caption else ""
            print(f"{index}\t[image]\t{caption_text}")
        elif block.get("type") == "callout":
            print(f"{index}\t[card]\t{plain_text(block)}")


if __name__ == "__main__":
    main()
