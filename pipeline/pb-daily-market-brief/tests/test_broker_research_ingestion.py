from __future__ import annotations

import json
import tempfile
import unittest
from io import BytesIO
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request
from unittest.mock import patch

from broker_research_policy import (
    cached_document_text,
    document_text_cache_key,
    load_registry,
    report_record,
    validate_report_metadata,
)
from collectors import file_drop, google_drive_reports


def metadata() -> dict:
    return {
        "publisher": "Example Securities",
        "title": "Semiconductor outlook",
        "published_at": "2026-07-24T00:00:00+09:00",
        "source_reference": "EXAMPLE-001",
        "source_url": "https://research.example.com/report/1",
        "acquisition_mode": "operator_authorized_local",
        "analysis_allowed": True,
        "redistribution_allowed": False,
        "publication_policy": "summary_and_link_only",
        "rights_review_status": "operator_confirmed",
        "tags": ["semiconductor"],
    }


class BrokerResearchIngestionTests(unittest.TestCase):
    def test_registry_fails_closed_for_scraping_and_redistribution(self) -> None:
        registry = load_registry()
        sources = {row["id"]: row for row in registry["sources"]}
        self.assertFalse(sources["naver_finance_research"]["automated_collection_allowed"])
        self.assertFalse(sources["broker_official_website"]["automated_collection_allowed"])
        self.assertTrue(all(row["redistribution_allowed"] is False for row in sources.values()))

    def test_report_record_preserves_rights_contract(self) -> None:
        record = report_record(
            source_id="authorized_report_drop",
            file_name="report.md",
            payload=b"# Report\nPrivate analyst view.",
            metadata=metadata(),
        )
        self.assertEqual(record["source_type"], "broker_report")
        self.assertEqual(record["source_grade"], "INTERNAL")
        self.assertFalse(record["primary_source_confirmed"])
        self.assertEqual(record["evidence_scope"], "operator_authorized_report_excerpt")
        self.assertFalse(record["research_rights"]["redistribution_allowed"])
        self.assertEqual(record["document_format"], "md")

    def test_official_public_document_uses_attributed_evidence_contract(self) -> None:
        public = metadata()
        public.update({
            "acquisition_mode": "official_public_document",
            "rights_review_status": "public_source_reviewed",
        })
        record = report_record(
            source_id="example_public_document",
            file_name="report.md",
            payload=b"# Official public market commentary",
            metadata=public,
        )
        self.assertEqual(record["source_grade"], "B")
        self.assertTrue(record["primary_source_confirmed"])
        self.assertIn("official_public_source", record["tags"])
        self.assertNotIn("operator_authorized", record["tags"])
        self.assertEqual(
            record["evidence_scope"],
            "official_institutional_commentary_document",
        )

    def test_report_record_preserves_overseas_market_contract(self) -> None:
        overseas = metadata()
        overseas.update({
            "market_scope": "US",
            "issuer_country": "US",
            "original_language": "en",
            "base_currency": "USD",
            "research_path": ["US", "Semiconductors"],
            "research": {
                "stance": "not_stated",
                "target_currency": "USD",
                "key_claims": [],
                "catalysts": [],
                "risks": [],
                "sectors": ["semiconductor"],
            },
        })
        record = report_record(
            source_id="google_drive_research_inbox",
            file_name="20260728_US_Example_NVDA.md",
            payload=b"Authorized U.S. analyst research.",
            metadata=overseas,
        )
        self.assertEqual(record["market_scope"], "US")
        self.assertEqual(record["base_currency"], "USD")
        self.assertEqual(record["original_language"], "en")
        self.assertEqual(record["research_path"], ["US", "Semiconductors"])
        self.assertEqual(record["research_metadata"]["currency"], "USD")

    def test_unknown_market_scope_is_rejected(self) -> None:
        invalid = metadata()
        invalid["market_scope"] = "MARS"
        with self.assertRaisesRegex(ValueError, "market_scope"):
            validate_report_metadata(invalid, file_name="report.md")

    def test_rights_flags_are_required(self) -> None:
        unsafe = metadata()
        unsafe.pop("analysis_allowed")
        with self.assertRaisesRegex(ValueError, "analysis_allowed"):
            validate_report_metadata(unsafe, file_name="report.md")

    def test_file_drop_rejects_missing_sidecar_without_leaking_filename(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            drop = Path(directory)
            (drop / "private-client-name.md").write_text("private", encoding="utf-8")
            with (
                patch.object(file_drop, "DROP_DIR", drop),
                patch.object(
                    file_drop,
                    "DOCUMENT_TEXT_CACHE_DIR",
                    drop / "cache",
                ),
            ):
                items, notice = file_drop.collect({})
        self.assertEqual(items, [])
        self.assertEqual(
            notice,
            "1 report(s) rejected by the rights or document gate",
        )
        self.assertNotIn("private-client-name", notice)

    def test_drive_adapter_is_optional_when_credentials_are_missing(self) -> None:
        env = {
            "GOOGLE_DRIVE_CLIENT_ID": "",
            "GOOGLE_DRIVE_CLIENT_SECRET": "",
            "GOOGLE_DRIVE_REFRESH_TOKEN": "",
            "GOOGLE_DRIVE_RESEARCH_FOLDER_ID": "",
        }
        with patch.dict("os.environ", env, clear=False):
            records, notice = google_drive_reports.collect({})
        self.assertEqual(records, [])
        self.assertEqual(notice, "Google Drive research inbox not configured")

    def test_drive_http_error_identifies_operation_without_description(self) -> None:
        error = HTTPError(
            "https://oauth2.googleapis.com/token",
            401,
            "Unauthorized",
            {},
            BytesIO(json.dumps({
                "error": "invalid_client",
                "error_description": "must not be logged",
            }).encode("utf-8")),
        )
        with patch.object(google_drive_reports, "urlopen", side_effect=error):
            with self.assertRaisesRegex(
                RuntimeError,
                r"OAuth token exchange returned HTTP 401 \(invalid_client\)",
            ) as raised:
                google_drive_reports._json_request(
                    Request("https://oauth2.googleapis.com/token"),
                    operation="OAuth token exchange",
                )
        self.assertNotIn("must not be logged", str(raised.exception))

    def test_drive_adapter_accepts_local_operator_approval_without_sidecar(self) -> None:
        approved = metadata()
        approved["acquisition_mode"] = "operator_authorized_drive"
        approved["source_reference"] = "drive:report-1"
        files = [{
            "id": "report-1",
            "name": "20260724_Example Securities_Semiconductor outlook.txt",
            "mimeType": "text/plain",
        }]
        with tempfile.TemporaryDirectory() as directory:
            approval_path = Path(directory) / "google_drive.json"
            approval_path.write_text(json.dumps({
                "schema_version": google_drive_reports.APPROVAL_REGISTRY_SCHEMA,
                "decisions": [{
                    "file_id": "report-1",
                    "file_name": files[0]["name"],
                    "decision": "approved",
                    "metadata": approved,
                }],
            }), encoding="utf-8")
            with (
                patch.object(google_drive_reports, "APPROVAL_REGISTRY_PATH", approval_path),
                patch.object(
                    google_drive_reports,
                    "DOCUMENT_TEXT_CACHE_DIR",
                    Path(directory) / "cache",
                ),
                patch.object(
                    google_drive_reports,
                    "_credentials",
                    return_value=({"folder_id": "folder"}, []),
                ),
                patch.object(google_drive_reports, "refresh_access_token", return_value="token"),
                patch.object(google_drive_reports, "list_folder_files", return_value=files),
                patch.object(
                    google_drive_reports,
                    "download_file",
                    return_value=b"Authorized analyst research",
                ),
            ):
                records, notice = google_drive_reports.collect({})
        self.assertIsNone(notice)
        self.assertEqual(len(records), 1)
        self.assertEqual(records[0]["source_reference"], "drive:report-1")

    def test_drive_adapter_skips_locally_excluded_report(self) -> None:
        files = [{"id": "report-1", "name": "excluded.txt", "mimeType": "text/plain"}]
        with tempfile.TemporaryDirectory() as directory:
            approval_path = Path(directory) / "google_drive.json"
            approval_path.write_text(json.dumps({
                "schema_version": google_drive_reports.APPROVAL_REGISTRY_SCHEMA,
                "decisions": [{
                    "file_id": "report-1",
                    "file_name": "excluded.txt",
                    "decision": "excluded",
                }],
            }), encoding="utf-8")
            with (
                patch.object(google_drive_reports, "APPROVAL_REGISTRY_PATH", approval_path),
                patch.object(
                    google_drive_reports,
                    "_credentials",
                    return_value=({"folder_id": "folder"}, []),
                ),
                patch.object(google_drive_reports, "refresh_access_token", return_value="token"),
                patch.object(google_drive_reports, "list_folder_files", return_value=files),
                patch.object(google_drive_reports, "download_file") as download,
            ):
                records, notice = google_drive_reports.collect({})
        self.assertEqual(records, [])
        self.assertIsNone(notice)
        download.assert_not_called()

    def test_drive_tree_preserves_nested_us_folder_scope(self) -> None:
        root_children = [{
            "id": "us-folder",
            "name": "US",
            "mimeType": google_drive_reports.DRIVE_FOLDER_MIME_TYPE,
        }]
        us_children = [{
            "id": "sector-folder",
            "name": "Semiconductors",
            "mimeType": google_drive_reports.DRIVE_FOLDER_MIME_TYPE,
        }]
        sector_children = [{
            "id": "report-1",
            "name": "20260728_NVDA.txt",
            "mimeType": "text/plain",
        }]
        with patch.object(
            google_drive_reports,
            "_list_direct_children",
            side_effect=[root_children, us_children, sector_children],
        ):
            files = google_drive_reports.list_folder_files(
                "token",
                "root-folder",
                max_files=10,
            )
        self.assertEqual(len(files), 1)
        self.assertEqual(files[0]["drive_path"], ["US", "Semiconductors"])
        inferred = google_drive_reports.infer_folder_metadata(files[0])
        self.assertEqual(inferred["market_scope"], "US")
        self.assertEqual(inferred["issuer_country"], "US")
        self.assertEqual(inferred["base_currency"], "USD")
        self.assertEqual(inferred["research_path"], ["US", "Semiconductors"])

    def test_drive_tree_does_not_let_busy_root_hide_nested_market_folder(self) -> None:
        root_children = [
            {
                "id": f"root-report-{index}",
                "name": f"root-{index}.pdf",
                "mimeType": "application/pdf",
                "modifiedTime": "2026-07-20T00:00:00Z",
            }
            for index in range(5)
        ] + [{
            "id": "us-folder",
            "name": "US",
            "mimeType": google_drive_reports.DRIVE_FOLDER_MIME_TYPE,
        }]
        us_children = [{
            "id": "new-us-report",
            "name": "new-us-report.pdf",
            "mimeType": "application/pdf",
            "modifiedTime": "2026-07-28T00:00:00Z",
        }]
        with patch.object(
            google_drive_reports,
            "_list_direct_children",
            side_effect=[root_children, us_children],
        ):
            files = google_drive_reports.list_folder_files(
                "token",
                "root-folder",
                max_files=2,
            )
        report_files = [
            row for row in files
            if Path(row["name"]).suffix.lower() in {".pdf", ".md", ".txt"}
        ]
        self.assertEqual(len(report_files), 2)
        self.assertEqual(report_files[0]["id"], "new-us-report")
        self.assertEqual(report_files[0]["drive_path"], ["US"])

    def test_drive_folder_scope_only_fills_missing_operator_metadata(self) -> None:
        document = {
            "drive_path": ["GLOBAL", "Macro"],
        }
        approved = metadata()
        approved["market_scope"] = "US"
        approved["research_path"] = ["US", "Strategy"]
        enriched = google_drive_reports.apply_folder_metadata(approved, document)
        self.assertEqual(enriched["market_scope"], "US")
        self.assertEqual(enriched["research_path"], ["US", "Strategy"])
        self.assertEqual(enriched["drive_path"], ["GLOBAL", "Macro"])

    def test_drive_sidecar_lookup_is_scoped_to_same_folder(self) -> None:
        approved = metadata()
        approved["acquisition_mode"] = "operator_authorized_drive"
        files = [
            {
                "id": "us-report",
                "name": "report.txt",
                "mimeType": "text/plain",
                "drive_parent_id": "us-folder",
                "drive_path": ["US"],
            },
            {
                "id": "us-sidecar",
                "name": "report.meta.json",
                "mimeType": "application/json",
                "drive_parent_id": "us-folder",
                "drive_path": ["US"],
            },
            {
                "id": "global-sidecar",
                "name": "report.meta.json",
                "mimeType": "application/json",
                "drive_parent_id": "global-folder",
                "drive_path": ["GLOBAL"],
            },
        ]
        with tempfile.TemporaryDirectory() as directory:
            with (
                patch.object(
                    google_drive_reports,
                    "DOCUMENT_TEXT_CACHE_DIR",
                    Path(directory) / "cache",
                ),
                patch.object(
                    google_drive_reports,
                    "_credentials",
                    return_value=({"folder_id": "root-folder"}, []),
                ),
                patch.object(google_drive_reports, "refresh_access_token", return_value="token"),
                patch.object(google_drive_reports, "list_folder_files", return_value=files),
                patch.object(
                    google_drive_reports,
                    "download_file",
                    side_effect=lambda _token, file_id: (
                        json.dumps(approved).encode("utf-8")
                        if file_id == "us-sidecar"
                        else (
                            b"wrong folder"
                            if file_id == "global-sidecar"
                            else b"Authorized U.S. research"
                        )
                    ),
                ),
            ):
                records, notice = google_drive_reports.collect({})
        self.assertIsNone(notice)
        self.assertEqual(len(records), 1)
        self.assertEqual(records[0]["market_scope"], "US")
        self.assertEqual(records[0]["research_path"], ["US"])

    def test_file_drop_accepts_rights_sidecar(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            drop = Path(directory)
            (drop / "report.txt").write_text("Authorized report excerpt", encoding="utf-8")
            (drop / "report.meta.json").write_text(
                json.dumps(metadata()),
                encoding="utf-8",
            )
            with (
                patch.object(file_drop, "DROP_DIR", drop),
                patch.object(
                    file_drop,
                    "DOCUMENT_TEXT_CACHE_DIR",
                    drop / "cache",
                ),
            ):
                items, notice = file_drop.collect({})
        self.assertIsNone(notice)
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]["source_reference"], "EXAMPLE-001")

    def test_document_text_cache_reuses_unchanged_payload(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            cache_dir = Path(directory)
            with patch(
                "broker_research_policy.document_text",
                return_value="Extracted analyst report",
            ) as extract:
                first = cached_document_text(
                    "report.pdf",
                    b"same-pdf-bytes",
                    cache_dir=cache_dir,
                )
                second = cached_document_text(
                    "renamed-report.pdf",
                    b"same-pdf-bytes",
                    cache_dir=cache_dir,
                )
        self.assertEqual(first[1], "miss")
        self.assertEqual(second[1], "hit")
        self.assertEqual(first[0], second[0])
        self.assertEqual(first[2], second[2])
        extract.assert_called_once()

    def test_changed_payload_invalidates_document_cache(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            cache_dir = Path(directory)
            with patch(
                "broker_research_policy.document_text",
                side_effect=["First extraction", "Second extraction"],
            ) as extract:
                first = cached_document_text(
                    "report.pdf",
                    b"version-one",
                    cache_dir=cache_dir,
                )
                second = cached_document_text(
                    "report.pdf",
                    b"version-two",
                    cache_dir=cache_dir,
                )
        self.assertEqual(first[1], "miss")
        self.assertEqual(second[1], "miss")
        self.assertNotEqual(first[2], second[2])
        self.assertEqual(extract.call_count, 2)

    def test_corrupt_cache_is_rebuilt(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            cache_dir = Path(directory)
            key = document_text_cache_key("report.pdf", b"payload")
            cache_dir.mkdir(parents=True, exist_ok=True)
            (cache_dir / f"{key}.json").write_text("{broken", encoding="utf-8")
            with patch(
                "broker_research_policy.document_text",
                return_value="Recovered extraction",
            ) as extract:
                text, status, resolved_key = cached_document_text(
                    "report.pdf",
                    b"payload",
                    cache_dir=cache_dir,
                )
        self.assertEqual(text, "Recovered extraction")
        self.assertEqual(status, "miss")
        self.assertEqual(resolved_key, key)
        extract.assert_called_once()

    def test_report_record_exposes_cache_status_without_cache_path(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            cache_dir = Path(directory)
            first = report_record(
                source_id="authorized_report_drop",
                file_name="report.txt",
                payload=b"Authorized analyst research",
                metadata=metadata(),
                document_text_cache_dir=cache_dir,
            )
            second = report_record(
                source_id="authorized_report_drop",
                file_name="report.txt",
                payload=b"Authorized analyst research",
                metadata=metadata(),
                document_text_cache_dir=cache_dir,
            )
        self.assertEqual(first["document_extraction"]["cache_status"], "miss")
        self.assertEqual(second["document_extraction"]["cache_status"], "hit")
        self.assertNotIn("cache_path", second["document_extraction"])


if __name__ == "__main__":
    unittest.main()
