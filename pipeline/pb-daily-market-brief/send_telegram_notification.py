"""Send one concise success or failure message without exposing bot credentials."""

from __future__ import annotations

import argparse
import json
import os
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


def main() -> None:
    parser = argparse.ArgumentParser(description="Send a daily-brief status message to Telegram.")
    parser.add_argument("--status", choices=("success", "failure"), required=True)
    parser.add_argument("--notion-url", default="")
    parser.add_argument("--run-url", default="")
    args = parser.parse_args()
    token = os.getenv("TELEGRAM_BOT_TOKEN", "").strip()
    chat_id = os.getenv("TELEGRAM_CHAT_ID", "").strip()
    if not token or not chat_id:
        print("Telegram notification skipped: TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID is not set.")
        return
    if args.status == "success":
        text = "✅ 미국시장 일일 리포트 발행 완료"
        if args.notion_url:
            text += f"\n노션: {args.notion_url}"
    else:
        text = "⚠️ 미국시장 일일 리포트 발행 실패"
        if args.run_url:
            text += f"\nGitHub 로그: {args.run_url}"
    body = json.dumps({"chat_id": chat_id, "text": text, "disable_web_page_preview": True}).encode("utf-8")
    request = Request(
        f"https://api.telegram.org/bot{token}/sendMessage", method="POST", data=body,
        headers={"Content-Type": "application/json"},
    )
    try:
        with urlopen(request, timeout=30) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except (HTTPError, URLError) as exc:
        raise SystemExit(f"Telegram notification request failed ({type(exc).__name__}).") from exc
    if not payload.get("ok"):
        raise SystemExit("Telegram did not accept the notification.")
    print("Telegram notification sent.")


if __name__ == "__main__":
    main()
