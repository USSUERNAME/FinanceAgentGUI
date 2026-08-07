"""Download a selected SEC filing and make a bounded packet for Codex review."""

from __future__ import annotations

import argparse
import html
import json
import os
import re
from pathlib import Path
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parent
WORKSPACE = ROOT / "workspace"


def load_dotenv() -> None:
    env_file = ROOT / ".env"
    if not env_file.exists():
        return
    for raw in env_file.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if line and not line.startswith("#") and "=" in line:
            key, value = line.split("=", 1)
            os.environ.setdefault(key.strip(), value.strip().strip('"'))


def clean_html(raw: str) -> str:
    without_code = re.sub(r"<(script|style)[^>]*>.*?</\\1>", " ", raw, flags=re.IGNORECASE | re.DOTALL)
    text = re.sub(r"<[^>]+>", " ", without_code)
    return re.sub(r"\\s+", " ", html.unescape(text)).strip()


def main() -> None:
    parser = argparse.ArgumentParser(description="Create a Codex review packet from one filing JSON entry.")
    parser.add_argument("filing_json", help="A JSON file in workspace/inbox created by fetch_sec_filings.py")
    parser.add_argument("--index", type=int, default=0, help="Zero-based item to prepare from the file")
    parser.add_argument("--max-chars", type=int, default=14000, help="Maximum extracted source characters in the packet")
    args = parser.parse_args()

    load_dotenv()
    user_agent = os.getenv("SEC_USER_AGENT", "").strip()
    if not user_agent or "example.com" in user_agent:
        raise SystemExit("Set SEC_USER_AGENT in .env to your real name and email before downloading SEC data.")

    items = json.loads(Path(args.filing_json).read_text(encoding="utf-8"))
    if not items:
        raise SystemExit("The selected inbox file contains no new filings.")
    try:
        filing = items[args.index]
    except IndexError as exc:
        raise SystemExit(f"--index must be between 0 and {len(items)-1}") from exc

    request = Request(filing["source_url"], headers={"User-Agent": user_agent})
    with urlopen(request, timeout=30) as response:
        raw = response.read().decode("utf-8", errors="replace")
    source_text = clean_html(raw)[: args.max_chars]

    source_dir = WORKSPACE / "source"
    packet_dir = WORKSPACE / "packets"
    source_dir.mkdir(parents=True, exist_ok=True)
    packet_dir.mkdir(parents=True, exist_ok=True)
    slug = f"{filing['filing_date']}_{filing['ticker']}_{filing['form']}_{filing['accession_number'].replace('-', '')}"
    (source_dir / f"{slug}.html").write_text(raw, encoding="utf-8")
    packet = f"""# SEC filing review packet\n\n- Company: {filing['company']} ({filing['ticker']})\n- Form: {filing['form']}\n- Filing date: {filing['filing_date']}\n- Report date: {filing['report_date'] or 'not stated'}\n- SEC source: {filing['source_url']}\n\n## Codex instruction\nRead the bounded source extract below. Write a Korean internal brief, not a full translation.\n\nRules:\n1. State only facts supported by the extract.\n2. Separate confirmed facts, possible market relevance, and items requiring primary-source review.\n3. Do not give buy/sell advice or predict price movements.\n4. Include the SEC source URL and filing date.\n5. Use this exact Markdown structure:\n\n# [Ticker] [Form] | [Korean short title]\n\n## 확인된 사실\n- \n\n## 시장에서 볼 변수\n- \n\n## 원문 확인 필요\n- \n\n## 출처\n- SEC EDGAR: [URL]\n\n## Source extract (bounded)\n{source_text}\n"""
    packet_path = packet_dir / f"{slug}.md"
    packet_path.write_text(packet, encoding="utf-8")
    print(f"Source saved: {source_dir / (slug + '.html')}")
    print(f"Codex review packet saved: {packet_path}")


if __name__ == "__main__":
    main()
