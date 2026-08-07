"""Fetch a small, auditable list of recent SEC EDGAR filings.

This script intentionally uses SEC's documented company submissions endpoint,
not a third-party scraper. It creates a local inbox for Codex to review.
"""

from __future__ import annotations

import argparse
import json
import os
import time
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parent
WORKSPACE = ROOT / "workspace"
INBOX = WORKSPACE / "inbox"
STATE_FILE = WORKSPACE / "seen_accessions.json"
CONFIG_FILE = ROOT / "targets.json"


def load_dotenv() -> None:
    env_file = ROOT / ".env"
    if not env_file.exists():
        return
    for raw in env_file.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"'))


def sec_json(url: str, user_agent: str) -> dict[str, Any]:
    # Do not request compressed content here: urllib does not transparently
    # decompress every SEC response and this PoC has no need for it.
    request = Request(url, headers={"User-Agent": user_agent})
    with urlopen(request, timeout=30) as response:
        return json.loads(response.read().decode("utf-8"))


def archive_url(cik: str, accession: str, primary_document: str) -> str:
    cik_number = str(int(cik))
    accession_folder = accession.replace("-", "")
    return f"https://www.sec.gov/Archives/edgar/data/{cik_number}/{accession_folder}/{primary_document}"


def recent_filings(target: dict[str, str], accepted_forms: set[str], since: date, user_agent: str) -> list[dict[str, str]]:
    cik = target["cik"].zfill(10)
    payload = sec_json(f"https://data.sec.gov/submissions/CIK{cik}.json", user_agent)
    recent = payload.get("filings", {}).get("recent", {})
    rows: list[dict[str, str]] = []
    for index, form in enumerate(recent.get("form", [])):
        if form not in accepted_forms:
            continue
        filing_date = recent["filingDate"][index]
        if date.fromisoformat(filing_date) < since:
            continue
        primary = recent.get("primaryDocument", [""] * len(recent["form"]))[index]
        accession = recent["accessionNumber"][index]
        if not primary:
            continue
        rows.append(
            {
                "ticker": target["ticker"],
                "company": target["name"],
                "cik": cik,
                "form": form,
                "filing_date": filing_date,
                "report_date": recent.get("reportDate", [""] * len(recent["form"]))[index],
                "accession_number": accession,
                "primary_document": primary,
                "source_url": archive_url(cik, accession, primary),
            }
        )
    return rows


def main() -> None:
    parser = argparse.ArgumentParser(description="Fetch recent SEC EDGAR filing metadata.")
    parser.add_argument("--reset-state", action="store_true", help="Forget prior runs and treat all recent items as new.")
    parser.add_argument("--include-seen", action="store_true", help="Write all filings in the lookback period, not only new filings.")
    args = parser.parse_args()

    load_dotenv()
    user_agent = os.getenv("SEC_USER_AGENT", "").strip()
    if not user_agent or "example.com" in user_agent:
        raise SystemExit("Set SEC_USER_AGENT in .env to your real name and email before fetching SEC data.")

    config = json.loads(CONFIG_FILE.read_text(encoding="utf-8"))
    lookback = int(os.getenv("SEC_LOOKBACK_DAYS", "14"))
    delay = float(os.getenv("SEC_REQUEST_DELAY_SECONDS", "0.25"))
    timezone = ZoneInfo(os.getenv("BRIEF_TIMEZONE", "Asia/Seoul"))
    run_now = datetime.now(timezone)
    since = run_now.date() - timedelta(days=lookback)

    WORKSPACE.mkdir(exist_ok=True)
    INBOX.mkdir(exist_ok=True)
    if args.reset_state or not STATE_FILE.exists():
        seen: set[str] = set()
    else:
        seen = set(json.loads(STATE_FILE.read_text(encoding="utf-8")))

    all_rows: list[dict[str, str]] = []
    for target in config["targets"]:
        all_rows.extend(recent_filings(target, set(config["forms"]), since, user_agent))
        time.sleep(delay)

    new_rows = [row for row in all_rows if args.include_seen or row["accession_number"] not in seen]
    run_stamp = run_now.strftime("%Y%m%d_%H%M%S")
    output = INBOX / f"sec_filings_{run_stamp}.json"
    output.write_text(json.dumps(new_rows, ensure_ascii=False, indent=2), encoding="utf-8")
    seen.update(row["accession_number"] for row in all_rows)
    STATE_FILE.write_text(json.dumps(sorted(seen), ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Saved {len(new_rows)} new filing(s) to {output.relative_to(ROOT)}")
    for row in new_rows:
        print(f"- {row['ticker']} {row['form']} {row['filing_date']} | {row['source_url']}")


if __name__ == "__main__":
    main()
