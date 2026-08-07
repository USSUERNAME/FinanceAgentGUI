"""Authorize label-scoped Gmail research collection without printing secrets."""

from __future__ import annotations

import argparse
import json
import os
import secrets
import threading
import webbrowser
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlencode, urlparse
from urllib.request import Request, urlopen

from collectors.common import ROOT, load_dotenv
from collectors.gmail_research import resolve_label_id

SCOPE = "https://www.googleapis.com/auth/gmail.readonly"
AUTH_URI = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN_URI = "https://oauth2.googleapis.com/token"
DEFAULT_PORT = 53682
ENV_KEYS = (
    "GOOGLE_GMAIL_CLIENT_ID",
    "GOOGLE_GMAIL_CLIENT_SECRET",
    "GOOGLE_GMAIL_REFRESH_TOKEN",
    "GOOGLE_GMAIL_RESEARCH_LABEL",
)


def authorization_url(
    *,
    client_id: str,
    redirect_uri: str,
    state: str,
) -> str:
    query = urlencode({
        "client_id": client_id,
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "scope": SCOPE,
        "access_type": "offline",
        "prompt": "consent",
        "state": state,
    })
    return f"{AUTH_URI}?{query}"


class CallbackResult:
    def __init__(self) -> None:
        self.code = ""
        self.error = ""
        self.state = ""
        self.event = threading.Event()


def callback_handler(result: CallbackResult) -> type[BaseHTTPRequestHandler]:
    class Handler(BaseHTTPRequestHandler):
        def do_GET(self) -> None:  # noqa: N802
            query = parse_qs(urlparse(self.path).query)
            result.code = str((query.get("code") or [""])[0])
            result.error = str((query.get("error") or [""])[0])
            result.state = str((query.get("state") or [""])[0])
            result.event.set()
            success = bool(result.code and not result.error)
            message = (
                "Gmail read-only authorization completed. "
                "You can close this tab and return to Codex."
                if success
                else "Gmail authorization was not completed."
            )
            body = message.encode("utf-8")
            self.send_response(200 if success else 400)
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, _format: str, *_args: Any) -> None:
            return

    return Handler


def exchange_code(
    *,
    client_id: str,
    client_secret: str,
    code: str,
    redirect_uri: str,
) -> dict[str, Any]:
    body = urlencode({
        "client_id": client_id,
        "client_secret": client_secret,
        "code": code,
        "redirect_uri": redirect_uri,
        "grant_type": "authorization_code",
    }).encode("utf-8")
    with urlopen(
        Request(
            TOKEN_URI,
            method="POST",
            data=body,
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        ),
        timeout=30,
    ) as response:
        payload = json.loads(response.read().decode("utf-8"))
    if not isinstance(payload, dict):
        raise RuntimeError("Google OAuth returned an unexpected response")
    return payload


def _env_value(value: str) -> str:
    return json.dumps(value, ensure_ascii=False)


def update_env_file(path: Path, values: dict[str, str]) -> None:
    existing = path.read_text(encoding="utf-8").splitlines() if path.exists() else []
    output: list[str] = []
    replaced: set[str] = set()
    for line in existing:
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in line:
            output.append(line)
            continue
        key = line.split("=", 1)[0].strip()
        if key in values:
            output.append(f"{key}={_env_value(values[key])}")
            replaced.add(key)
        else:
            output.append(line)
    for key in ENV_KEYS:
        if key in values and key not in replaced:
            output.append(f"{key}={_env_value(values[key])}")
    path.write_text("\n".join(output).rstrip() + "\n", encoding="utf-8")


def authorize(
    *,
    env_path: Path,
    label_name: str,
    port: int,
    open_browser: bool,
    timeout_seconds: int,
    authorization_url_path: Path | None = None,
) -> str:
    load_dotenv()
    client_id = (
        os.getenv("GOOGLE_GMAIL_CLIENT_ID", "").strip()
        or os.getenv("GOOGLE_DRIVE_CLIENT_ID", "").strip()
    )
    client_secret = (
        os.getenv("GOOGLE_GMAIL_CLIENT_SECRET", "").strip()
        or os.getenv("GOOGLE_DRIVE_CLIENT_SECRET", "").strip()
    )
    if not client_id or not client_secret:
        raise RuntimeError(
            "Google OAuth client id and secret are not configured in .env"
        )
    redirect_uri = f"http://127.0.0.1:{port}/"
    expected_state = secrets.token_urlsafe(24)
    result = CallbackResult()
    server = HTTPServer(("127.0.0.1", port), callback_handler(result))
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    url = authorization_url(
        client_id=client_id,
        redirect_uri=redirect_uri,
        state=expected_state,
    )
    if authorization_url_path is not None:
        authorization_url_path.parent.mkdir(parents=True, exist_ok=True)
        authorization_url_path.write_text(url + "\n", encoding="utf-8")
    if open_browser:
        webbrowser.open(url)
    else:
        print(f"Open this authorization URL in your browser:\n{url}")
    try:
        if not result.event.wait(timeout_seconds):
            raise TimeoutError("Gmail authorization callback timed out")
    finally:
        server.shutdown()
        server.server_close()
    if result.error:
        raise RuntimeError(f"Google authorization returned: {result.error}")
    if result.state != expected_state:
        raise RuntimeError("Google authorization state did not match")
    if not result.code:
        raise RuntimeError("Google authorization did not return a code")
    token_payload = exchange_code(
        client_id=client_id,
        client_secret=client_secret,
        code=result.code,
        redirect_uri=redirect_uri,
    )
    refresh_token = str(token_payload.get("refresh_token") or "").strip()
    access_token = str(token_payload.get("access_token") or "").strip()
    if not refresh_token:
        raise RuntimeError(
            "Google did not return a refresh token; revoke the prior grant and retry"
        )
    if not access_token:
        raise RuntimeError("Google did not return an access token")
    update_env_file(env_path, {
        "GOOGLE_GMAIL_CLIENT_ID": client_id,
        "GOOGLE_GMAIL_CLIENT_SECRET": client_secret,
        "GOOGLE_GMAIL_REFRESH_TOKEN": refresh_token,
        "GOOGLE_GMAIL_RESEARCH_LABEL": label_name,
    })
    label_id = resolve_label_id(access_token, label_name)
    if not label_id:
        raise RuntimeError(
            f"Gmail label was not found: {label_name}"
        )
    return label_name


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Authorize one Gmail research label with read-only access"
    )
    parser.add_argument("--label", default="Stocks")
    parser.add_argument("--env-file", default=str(ROOT / ".env"))
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    parser.add_argument("--timeout-seconds", type=int, default=300)
    parser.add_argument("--no-browser", action="store_true")
    parser.add_argument("--authorization-url-file")
    args = parser.parse_args()
    label = authorize(
        env_path=Path(args.env_file).expanduser().resolve(),
        label_name=args.label.strip(),
        port=args.port,
        open_browser=not args.no_browser,
        timeout_seconds=args.timeout_seconds,
        authorization_url_path=(
            Path(args.authorization_url_file).expanduser().resolve()
            if args.authorization_url_file
            else None
        ),
    )
    print(
        "Gmail authorization saved without printing secrets. "
        f"Research label: {label}."
    )


if __name__ == "__main__":
    main()
