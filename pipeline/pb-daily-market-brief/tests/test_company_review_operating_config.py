from __future__ import annotations

import copy
import json
import tempfile
import unittest
from datetime import date
from pathlib import Path

from collect_company_review_operating_config import (
    collect_company_review_operating_config,
    load_operating_config_inputs,
    validate_company_review_operating_config,
    validate_operating_config_record,
)


def approved_config(version: int = 1) -> dict:
    return {
        "operating_config_id": f"company:GEV:review-operations:v{version}",
        "ticker": "GEV", "company_name": "GE Vernova", "version": version,
        "effective_from": "2026-10-30",
        "approval": {
            "status": "approved_by_user_or_pm", "approved_by": "portfolio_manager",
            "approved_at": "2026-10-30T12:00:00+09:00", "approval_note": "Reviewed operating responsibilities and timing.",
        },
        "owners": {
            "decision_authority": "portfolio_manager", "pm_owner": "portfolio_manager",
            "analyst_owner": "research_analyst", "evidence_owner": "research_analyst",
            "kpi_owner": "research_analyst", "model_owner": "model_analyst",
            "decision_log_owner": "portfolio_manager",
        },
        "review_policy": {
            "cadence": "event_driven", "next_scheduled_review_date": "2026-11-05",
            "prep_lead_time": {"value": 5, "unit": "calendar_days"},
            "post_event_update_sla": {
                "value": 24, "unit": "hours",
                "start_condition": "verified_primary_results_available",
            },
            "escalation_triggers": ["Confirmed date changes", "Approved kill criterion is matched"],
        },
        "automatic_position_action_allowed": False,
        "source_index": [{
            "source_id": f"OPS-GEV-V{version}",
            "source_name": f"GEV approved review operating configuration v{version}",
            "source_type": "user_provided_internal_operating_policy",
            "as_of_date": "2026-10-30", "source_location": "company_review_operating_registry.json",
            "reliability": "explicit_user_or_pm_approval",
            "limitation": "Operating policy only; not an investment action.",
        }],
    }


def collected_config(version: int = 1) -> dict:
    return collect_company_review_operating_config("2026-10-31", [approved_config(version)])


class CompanyReviewOperatingConfigTests(unittest.TestCase):
    def test_approved_complete_record_is_selected(self) -> None:
        payload = collected_config()
        selected = payload["companies"][0]["selected_config"]
        self.assertEqual(selected["owners"]["analyst_owner"], "research_analyst")
        self.assertEqual(selected["review_policy"]["prep_lead_time"]["value"], 5)
        self.assertEqual(selected["review_policy"]["post_event_update_sla"]["value"], 24)
        self.assertFalse(selected["automatic_position_action_allowed"])

    def test_latest_version_is_selected_without_deleting_history(self) -> None:
        payload = collect_company_review_operating_config(
            "2026-10-31", [approved_config(1), approved_config(2)],
        )
        company = payload["companies"][0]
        self.assertEqual(company["selected_config"]["version"], 2)
        self.assertEqual(company["available_version_count"], 2)

    def test_duplicate_ticker_version_is_rejected(self) -> None:
        with self.assertRaisesRegex(ValueError, "Duplicate"):
            collect_company_review_operating_config(
                "2026-10-31", [approved_config(), copy.deepcopy(approved_config())],
            )

    def test_draft_placeholder_or_future_approval_is_rejected(self) -> None:
        draft = approved_config()
        draft["approval"]["status"] = "draft_pending_user_or_pm_approval"
        with self.assertRaisesRegex(ValueError, "explicit"):
            validate_operating_config_record(draft, date.fromisoformat("2026-10-31"))
        placeholder = approved_config()
        placeholder["owners"]["analyst_owner"] = "REPLACE_WITH_NAME_OR_ROLE"
        with self.assertRaisesRegex(ValueError, "analyst_owner"):
            validate_operating_config_record(placeholder, date.fromisoformat("2026-10-31"))
        future = approved_config()
        future["approval"]["approved_at"] = "2026-11-01T00:00:00+09:00"
        with self.assertRaisesRegex(ValueError, "future-dated"):
            validate_operating_config_record(future, date.fromisoformat("2026-10-31"))

    def test_invalid_timing_or_position_authority_is_rejected(self) -> None:
        row = approved_config()
        row["review_policy"]["post_event_update_sla"]["value"] = 0
        with self.assertRaisesRegex(ValueError, "1-168"):
            validate_operating_config_record(row, date.fromisoformat("2026-10-31"))
        row = approved_config()
        row["automatic_position_action_allowed"] = True
        with self.assertRaisesRegex(ValueError, "automatic position"):
            validate_operating_config_record(row, date.fromisoformat("2026-10-31"))

    def test_payload_validator_rejects_false_selected_status(self) -> None:
        payload = collected_config()
        payload["companies"][0]["configuration_status"] = "draft"
        with self.assertRaisesRegex(ValueError, "Only approved"):
            validate_company_review_operating_config(payload)

    def test_unapproved_draft_is_owned_by_review_queue_not_input_errors(self) -> None:
        draft = approved_config()
        draft["approval"] = {
            "status": "draft_pending_user_or_pm_approval",
            "approved_by": None, "approved_at": None, "approval_note": "Review required.",
        }
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "GEV_v1.json"
            path.write_text(json.dumps(draft), encoding="utf-8")
            records, errors = load_operating_config_inputs("2026-10-31", Path(directory))
        self.assertEqual(records, [])
        self.assertEqual(errors, [])


if __name__ == "__main__":
    unittest.main()
