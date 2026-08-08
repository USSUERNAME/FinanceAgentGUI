from __future__ import annotations

import unittest

from collect_korea_company_exposure import collect_korea_company_exposure


class KoreaCompanyExposureTests(unittest.TestCase):
    def registry(self) -> dict:
        return {
            "schema_version": "korea_company_exposure_sources.v1",
            "companies": [{
                "ticker": "000660",
                "company_name": "SK하이닉스",
                "sector_id": "semiconductors_ai_compute",
                "verified_pathway_ids": ["accelerators_memory"],
                "exposure_sources": [{
                    "source_id": "exposure",
                    "url": "https://official.example/exposure",
                    "required_term_groups": [["HBM4"], ["mass production"]],
                    "evidence_summary": "HBM4 양산 체계 확인",
                }],
                "relationship_sources": [{
                    "source_id": "relationship",
                    "url": "https://official.example/relationship",
                    "source_tickers": ["NVDA"],
                    "relationship_scope": "direct_supply_or_codevelopment",
                    "required_term_groups": [["NVIDIA"], ["co-developing"], ["supply"]],
                    "evidence_summary": "NVIDIA 공동개발·공급 확인",
                }],
            }],
            "policy": {"primary_sources_only": True},
        }

    def test_verified_terms_promote_exposure_and_direct_relationship(self) -> None:
        pages = {
            "https://official.example/exposure": "HBM4 mass production is ready.",
            "https://official.example/relationship": "NVIDIA and the company are co-developing memory and support supply.",
        }
        payload = collect_korea_company_exposure(
            "2026-08-09",
            registry=self.registry(),
            fetch_text=lambda url: pages[url],
        )
        company = payload["companies"][0]
        self.assertEqual(company["exposure_status"], "verified_primary")
        self.assertEqual(company["verified_pathway_ids"], ["accelerators_memory"])
        self.assertEqual(company["relationship_evidence"]["status"], "verified_primary")
        self.assertEqual(company["relationship_evidence"]["source_tickers"], ["NVDA"])

    def test_missing_terms_fail_closed(self) -> None:
        payload = collect_korea_company_exposure(
            "2026-08-09",
            registry=self.registry(),
            fetch_text=lambda _url: "generic semiconductor page",
        )
        company = payload["companies"][0]
        self.assertEqual(company["exposure_status"], "candidate_unverified")
        self.assertEqual(company["verified_pathway_ids"], [])
        self.assertEqual(company["relationship_evidence"]["status"], "not_verified")

    def test_industry_collaboration_does_not_become_direct_relationship(self) -> None:
        registry = self.registry()
        registry["companies"][0]["relationship_sources"][0]["relationship_scope"] = "industry_collaboration"
        payload = collect_korea_company_exposure(
            "2026-08-09",
            registry=registry,
            fetch_text=lambda url: (
                "HBM4 mass production" if url.endswith("exposure")
                else "NVIDIA co-developing supply"
            ),
        )
        relationship = payload["companies"][0]["relationship_evidence"]
        self.assertEqual(relationship["status"], "industry_collaboration_primary")
        self.assertEqual(relationship["source_tickers"], [])


if __name__ == "__main__":
    unittest.main()
