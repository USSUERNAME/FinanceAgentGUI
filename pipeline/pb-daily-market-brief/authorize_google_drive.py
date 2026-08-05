"""Authorize the private Google Drive research inbox without printing secrets."""

from __future__ import annotations

import argparse
import json
import secrets
import threading
import webbrowser
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlencode, urlparse
from urllib.request import Request, urlopen

from collectors.common import ROOT
from collectors.google_drive_reports import list_folder_files

SCOPE = "https://www.googleapis.com/auth/drive.readonly"
DEFAULT_PORT = 53682
ENV_KEYS = (
    "GOOGLE_DRIVE_CLIENT_ID",
    "GOOGLE_DRIVE_CLIENT_SECRET",
    "GOOGLE_DRIVE_REFRESH_TOKEN",
    "GOOGLE_DRIVE_RESEARCH_FOLDER_ID",
)


def load_client_config(path: Path) -> dict[str, str]:
    payload = json.loads(path.read_text(encoding="utf-8-sig"))
    if not isinstance(payload, dict):
        raise ValueError("OAuth client JSON must be an object")
    source = payload.get("installed") or payload.get("web")
    if not isinstance(source, dict):
        raise ValueError("OAuth client JSON requires an installed or web client")
    client_id = str(source.get("client_id") or "").strip()
    client_secret = str(source.get("client_secret") or "").strip()
    auth_uri = str(
        source.get("auth_uri")
        or "https://accounts.google.com/o/oauth2/v2/auth"
    ).strip()
    token_uri = str(
        source.get("token_uri")
        or "https://oauth2.googleapis.com/token"
    ).strip()
    if not client_id or not client_secret:
        raise ValueError("OAuth client JSON is missing client_id or client_secret")
    return {
        "client_id": client_id,
        "client_secret": client_secret,
        "auth_uri": auth_uri,
        "token_uri": token_uri,
    }


def authorization_url(
    config: dict[str, str],
    *,
    redirect_uri: str,
    state: str,
) -> str:
    query = urlencode({
        'client_id': config['client_id'],
        'redirect_uri': redirect_uri,
        'response_type': 'code',
        'scope': SCOPE,
        'access_type': 'offline',
        'prompt': 'consent',
        'state': state,
    })
    return f"{config['auth_uri']}?{query}"


class CallbackResult:
    def __init__(self) -> None:
        self.code = ""
        self.error = ""
        self.state = ""
        self.event = threading.Event()


def callback_handler(result: CallbackResult) -> type[BaseHTTPRequestHandler]:
    class Handler(BaseHTTPRequestHandler):
        def do_GET(self) -> None:  # noqa: N802 - stdlib callback name
            query = parse_qs(urlparse(self.path).query)
            result.code = str((query.get("code") or [""])[0])
            result.error = str((query.get("error") or [""])[0])
            result.state = str((query.get("state") or [""])[0])
            result.event.set()
            success = bool(result.code and not result.error)
            message = (
                "Google Drive read-only authorization completed. "
                "You can close this tab and return to Codex."
                if success
                else "Google Drive authorization was not completed."
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
    config: dict[str, str],
    *,
    code: str,
    redirect_uri: str,
) -> dict[str, Any]:
    body = urlencode({
        "client_id": config["client_id"],
        "client_secret": config["client_secret"],
        "code": code,
        "redirect_uri": redirect_uri,
        "grant_type": "authorization_code",
    }).encode("utf-8")
    request = Request(
        config["token_uri"],
        method="POST",
        data=body,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    with urlopen(request, timeout=30) as response:
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
    client_config_path: Path,
    folder_id: str,
    env_path: Path,
    port: int,
    open_browser: bool,
    timeout_seconds: int,
    authorization_url_path: Path | None = None,
) -> tuple[int, int]:
    config = load_client_config(client_config_path)
    redirect_uri = f"http://127.0.0.1:{port}/"
    expected_state = secrets.token_urlsafe(24)
    result = CallbackResult()
    server = HTTPServer(("127.0.0.1", port), callback_handler(result))
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    url = authorization_url(
        config,
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
            raise TimeoutError("Google Drive authorization callback timed out")
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
        config,
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
    files = list_folder_files(access_token, folder_id, max_files=100)
    update_env_file(env_path, {
        "GOOGLE_DRIVE_CLIENT_ID": config["client_id"],
        "GOOGLE_DRIVE_CLIENT_SECRET": config["client_secret"],
        "GOOGLE_DRIVE_REFRESH_TOKEN": refresh_token,
        "GOOGLE_DRIVE_RESEARCH_FOLDER_ID": folder_id,
    })
    document_count = sum(
        Path(str(item.get("name") or "")).suffix.lower() in {".pdf", ".md", ".txt"}
        for item in files
    )
    return len(files), document_count


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Authorize a read-only Google Drive broker-research folder"
    )
    parser.add_argument("--client-secret-json", required=True)
    parser.add_argument("--folder-id", required=True)
    parser.add_argument("--env-file", default=str(ROOT / ".env"))
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    parser.add_argument("--timeout-seconds", type=int, default=300)
    parser.add_argument("--no-browser", action="store_true")
    parser.add_argument(
        "--authorization-url-file",
        help="Optional local-only file for handing the transient URL to Codex.",
    )
    parser.add_argument("--validate-only", action="store_true")
    args = parser.parse_args()
    config_path = Path(args.client_secret_json).expanduser().resolve()
    if not config_path.exists():
        raise SystemExit(f"OAuth client JSON does not exist: {config_path}")
    load_client_config(config_path)
    if args.validate_only:
        print("Google OAuth client JSON is valid. No authorization was performed.")
        return
    total, documents = authorize(
        client_config_path=config_path,
        folder_id=args.folder_id.strip(),
        env_path=Path(args.env_file).expanduser().resolve(),
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
        "Google Drive authorization saved without printing secrets. "
        f"Folder items: {total}; supported research documents: {documents}."
    )


if __name__ == "__main__":
    main()
