from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from authorize_gmail import authorization_url, update_env_file


class AuthorizeGmailTests(unittest.TestCase):
    def test_authorization_url_requests_offline_gmail_readonly(self) -> None:
        url = authorization_url(
            client_id="client-id",
            redirect_uri="http://127.0.0.1:53682/",
            state="state-value",
        )
        self.assertIn("gmail.readonly", url)
        self.assertIn("access_type=offline", url)
        self.assertIn("prompt=consent", url)
        self.assertIn("state=state-value", url)

    def test_env_update_preserves_drive_credentials(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / ".env"
            path.write_text(
                'GOOGLE_DRIVE_REFRESH_TOKEN="test-drive-token"\n',
                encoding="utf-8",
            )
            update_env_file(path, {
                "GOOGLE_GMAIL_CLIENT_ID": "client",
                "GOOGLE_GMAIL_CLIENT_SECRET": "secret",
                "GOOGLE_GMAIL_REFRESH_TOKEN": "refresh",
                "GOOGLE_GMAIL_RESEARCH_LABEL": "Stocks",
            })
            text = path.read_text(encoding="utf-8")
        self.assertIn('GOOGLE_DRIVE_REFRESH_TOKEN="test-drive-token"', text)
        self.assertIn('GOOGLE_GMAIL_REFRESH_TOKEN="refresh"', text)
        self.assertEqual(text.count("GOOGLE_GMAIL_REFRESH_TOKEN="), 1)


if __name__ == "__main__":
    unittest.main()
