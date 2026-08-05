from __future__ import annotations

import copy
import unittest

from sector_classifier import (
    annotate_market_payload,
    classify_record,
    classify_records,
    sector_evidence_summary,
)
from sector_master import load_sector_master, sector_by_id, sectors_for_ticker, validate_sector_master


class SectorMasterTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.master = load_sector_master()

    def test_initial_universe_has_twenty_one_research_sectors(self) -> None:
        self.assertEqual(self.master["schema_version"], "sector_master.v1")
        self.assertEqual(len(self.master["sectors"]), 21)
        self.assertEqual(sum(item["weight"] for item in self.master["scoring_dimensions"]), 100)

    def test_every_sector_has_pathways_and_research_inputs(self) -> None:
        for sector in self.master["sectors"]:
            self.assertTrue(sector["beneficiary_pathways"], sector["sector_id"])
            self.assertGreaterEqual(len(sector["leading_indicators"]), 3, sector["sector_id"])
            self.assertGreaterEqual(sector["evidence_requirements"]["minimum_independent_sources"], 2)
            self.assertTrue(sector["market_proxies"], sector["sector_id"])
            self.assertTrue(sector["representative_companies"], sector["sector_id"])

    def test_lookup_supports_us_and_korean_tickers(self) -> None:
        us_ids = {item["sector_id"] for item in sectors_for_ticker(self.master, "nvda", "us")}
        kr_ids = {item["sector_id"] for item in sectors_for_ticker(self.master, "005930", "KR")}
        self.assertIn("semiconductors_ai_compute", us_ids)
        self.assertIn("semiconductors_ai_compute", kr_ids)
        self.assertEqual(sector_by_id(self.master, "grid_electrification")["name_ko"], "전력망·전기화")

    def test_duplicate_sector_id_is_rejected(self) -> None:
        payload = copy.deepcopy(self.master)
        payload["sectors"][1]["sector_id"] = payload["sectors"][0]["sector_id"]
        with self.assertRaisesRegex(ValueError, "duplicate sector_id"):
            validate_sector_master(payload)

    def test_scoring_weights_must_total_one_hundred(self) -> None:
        payload = copy.deepcopy(self.master)
        payload["scoring_dimensions"][0]["weight"] += 1
        with self.assertRaisesRegex(ValueError, "must total 100"):
            validate_sector_master(payload)

    def test_representatives_are_not_silently_treated_as_verified_exposure(self) -> None:
        for sector in self.master["sectors"]:
            for company in sector["representative_companies"]:
                self.assertEqual(company["exposure_status"], "candidate_unverified")

    def test_ticker_match_is_high_confidence_but_still_needs_exposure_proof(self) -> None:
        result = classify_record({
            "tickers": ["NVDA"], "title": "Quarterly filing", "tags": [], "raw_text": "",
        }, self.master)
        match = next(item for item in result["sector_matches"] if item["sector_id"] == "semiconductors_ai_compute")
        self.assertEqual(match["confidence"], "high")
        self.assertEqual(match["exposure_posture"], "needs_exposure_attribution")
        self.assertIn("semiconductors_ai_compute", result["sector_ids"])

    def test_two_thematic_keywords_create_medium_candidate(self) -> None:
        result = classify_record({
            "tickers": [],
            "title": "AI accelerator and HBM order outlook",
            "tags": [],
            "raw_text": "Demand for advanced compute is increasing.",
        }, self.master)
        match = next(item for item in result["sector_matches"] if item["sector_id"] == "semiconductors_ai_compute")
        self.assertEqual(match["confidence"], "medium")
        self.assertTrue(match["accepted"])

    def test_single_title_keyword_stays_candidate_only(self) -> None:
        result = classify_record({
            "tickers": [], "title": "Semiconductor outlook", "tags": [], "raw_text": "",
        }, self.master)
        self.assertEqual(result["sector_classification_status"], "candidate_only")
        self.assertEqual(result["sector_ids"], [])
        self.assertIn("semiconductors_ai_compute", result["sector_candidate_ids"])

    def test_raw_text_single_keyword_does_not_create_false_connection(self) -> None:
        result = classify_record({
            "tickers": [], "title": "General market update", "tags": [], "raw_text": "semiconductor",
        }, self.master)
        self.assertEqual(result["sector_classification_status"], "unmatched")
        self.assertEqual(result["sector_candidate_ids"], [])

    def test_market_payload_and_evidence_summary_are_connected(self) -> None:
        records = classify_records([{
            "id": "r1", "tickers": ["NVDA"], "title": "Filing", "tags": [], "raw_text": "",
            "source_grade": "A", "primary_source_confirmed": True,
        }], self.master)
        market = annotate_market_payload({"items": [
            {"ticker": "SMH", "return_5d_pct": 2.0},
            {"ticker": "SPY", "return_5d_pct": 1.0},
        ]}, self.master)
        self.assertIn("semiconductors_ai_compute", market["items"][0]["sector_ids"])
        self.assertEqual(market["items"][1]["sector_ids"], [])
        summary = sector_evidence_summary(records, market, self.master)
        semis = next(item for item in summary["sectors"] if item["sector_id"] == "semiconductors_ai_compute")
        self.assertEqual(semis["accepted_record_count"], 1)
        self.assertEqual(semis["primary_confirmed_record_count"], 1)
        self.assertEqual(semis["market_proxy_tickers"], ["SMH"])
        self.assertEqual(semis["evidence_posture"], "connected_not_scored")


if __name__ == "__main__":
    unittest.main()
