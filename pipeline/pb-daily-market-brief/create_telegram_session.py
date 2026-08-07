"""Create a Telegram StringSession on the operator's trusted machine.

The resulting credential is written beneath the ignored workspace directory
and is never printed.  Copy it to the TELEGRAM_SESSION_STRING secret, then
remove the local file when no longer needed.
"""

from __future__ import annotations

import os
from pathlib import Path

from collectors.common import ROOT, load_dotenv

OUTPUT = ROOT / "workspace" / "local_secrets" / "telegram_session_string.txt"


def main() -> None:
    load_dotenv()
    api_id_text = os.getenv("TELEGRAM_API_ID", "").strip()
    api_hash = os.getenv("TELEGRAM_API_HASH", "").strip()
    if not api_id_text or not api_hash:
        raise SystemExit("Set TELEGRAM_API_ID and TELEGRAM_API_HASH in the local .env first.")
    try:
        api_id = int(api_id_text)
    except ValueError as exc:
        raise SystemExit("TELEGRAM_API_ID must be an integer.") from exc
    try:
        from telethon import TelegramClient
        from telethon.sessions import StringSession
    except ImportError as exc:
        raise SystemExit("Telethon is missing. Install requirements.txt first.") from exc

    client = TelegramClient(StringSession(), api_id, api_hash)
    try:
        client.start()
        value = client.session.save()
        if not value:
            raise SystemExit("Telegram did not return a reusable session string.")
        OUTPUT.parent.mkdir(parents=True, exist_ok=True)
        OUTPUT.write_text(value, encoding="utf-8")
    finally:
        client.disconnect()
    print(
        "Telegram session created. Copy the value from "
        f"{OUTPUT.relative_to(ROOT)} into the TELEGRAM_SESSION_STRING secret. "
        "The credential itself was not printed."
    )


if __name__ == "__main__":
    main()
