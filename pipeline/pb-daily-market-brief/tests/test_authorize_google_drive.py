from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from authorize_google_drive import (
    authorization_url,
    load_client_config,
    update_env_file,
)


class AuthorizeGoogleDriveTests(unittest.TestCase):
    def test_loads_installed_client_configuration(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "client.json"
            path.write_text(json.dumps({
                "installed": {
                    "client_id": "client-id",
                    "client_secret": "client-secret",
                    "auth_uri": "https://accounts.google.com/o/oauth2/v2/auth",
                    "token_uri": "https://oauth2.googleapis.com/token",
                },
            }), encoding="utf-8")
            config = load_client_config(path)
        self.assertEqual(config["client_id"], "client-id")
        self.assertEqual(config["client_secret"], "client-secret")

    def test_authorization_url_requests_offline_read_only_access(self) -> None:
        url = authorization_url(
            {
                "client_id": "client-id",
                "auth_uri": "https://accounts.google.com/o/oauth2/v2/auth",
            },
            redirect_uri="http://127.0.0.1:53682/",
            state="state-value",
        )
        self.assertIn("drive.readonly", url)
        self.assertIn("access_type=offline", url)
        self.assertIn("prompt=consent", url)
        self.assertIn("state=state-value", url)

    def test_env_update_preserves_unrelated_values_and_replaces_drive_keys(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / ".env"
            path.write_text(
                'OPENAI_API_KEY="keep-me"\n'
                'GOOGLE_DRIVE_CLIENT_ID="old"\n',
                encoding="utf-8",
            )
            update_env_file(path, {
                "GOOGLE_DRIVE_CLIENT_ID": "new-client",
                "GOOGLE_DRIVE_CLIENT_SECRET": "new-secret",
                "GOOGLE_DRIVE_REFRESH_TOKEN": "refresh",
                "GOOGLE_DRIVE_RESEARCH_FOLDER_ID": "folder",
            })
            text = path.read_text(encoding="utf-8")
        self.assertIn('OPENAI_API_KEY="keep-me"', text)
        self.assertIn('GOOGLE_DRIVE_CLIENT_ID="new-client"', text)
        self.assertEqual(text.count("GOOGLE_DRIVE_CLIENT_ID="), 1)
        self.assertIn('GOOGLE_DRIVE_REFRESH_TOKEN="refresh"', text)


if __name__ == "__main__":
    unittest.main()
