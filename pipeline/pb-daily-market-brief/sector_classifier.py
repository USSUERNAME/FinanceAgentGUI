"""Deterministically connect normalized evidence and market rows to sectors."""

from __future__ import annotations

import re
from collections import Counter
from typing import Any

from sector_master import SCHEMA_VERSION, sectors_for_ticker

CLASSIFICATION_VERSION = "sector_classification.v1"
_FIELD_WEIGHTS = {"title": 4, "tags": 5, "raw_text": 1}
_ACCEPTED_CONFIDENCE = {"high", "medium"}


def _normalized_text(value: Any) -> str:
    if isinstance(value, list):
        value = " ".join(str(item) for item in value)
    return re.sub(r"\s+", " ", str(value or "").casefold()).strip()


def _contains_keyword(text: str, keyword: str) -> bool:
    normalized = _normalized_text(keyword)
    if not normalized:
        return False
    if re.fullmatch(r"[a-z0-9 .+\-]+", normalized):
        return bool(re.search(rf"(?<![a-z0-9]){re.escape(normalized)}(?![a-z0-9])", text))
    return normalized in text


def _security_index(sector: dict[str, Any]) -> dict[str, tuple[str, str]]:
    index: dict[str, tuple[str, str]] = {}
    for item in sector.get("market_proxies", []):
        index[item["ticker"]] = ("market_proxy", item.get("proxy_role", "sector_proxy"))
    for item in sector.get("representative_companies", []):
        index[item["ticker"]] = ("candidate_company", item.get("exposure_status", "candidate_unverified"))
    return index


def classify_record(record: dict[str, Any], master: dict[str, Any]) -> dict[str, Any]:
    """Return an auditable classification without treating a theme mention as proof."""
    tickers = sorted({str(ticker).strip().upper() for ticker in record.get("tickers", []) if ticker})
    fields = {
        "title": _normalized_text(record.get("title")),
        "tags": _normalized_text(record.get("tags", [])),
        "raw_text": _normalized_text(record.get("raw_text")),
    }
    matches: list[dict[str, Any]] = []
    for sector in master.get("sectors", []):
        security_index = _security_index(sector)
        ticker_hits = [ticker for ticker in tickers if ticker in security_index]
        keyword_hits: dict[str, set[str]] = {}
        keyword_score = 0
        for keyword in sector.get("keywords", {}).get("ko", []) + sector.get("keywords", {}).get("en", []):
            hit_fields = {
                field for field, text in fields.items()
                if _contains_keyword(text, keyword)
            }
            if hit_fields:
                normalized_keyword = _normalized_text(keyword)
                existing = keyword_hits.setdefault(normalized_keyword, set())
                new_fields = hit_fields - existing
                keyword_score += sum(_FIELD_WEIGHTS[field] for field in new_fields)
                existing.update(hit_fields)

        if not ticker_hits and keyword_score < 4:
            continue

        if ticker_hits:
            confidence = "high"
            score = 100 + min(keyword_score, 20)
        elif len(keyword_hits) >= 2 or keyword_score >= 8:
            confidence = "medium"
            score = min(80, 50 + keyword_score)
        else:
            confidence = "low"
            score = min(49, 30 + keyword_score)

        ticker_basis = [
            {
                "ticker": ticker,
                "mapping_type": security_index[ticker][0],
                "master_posture": security_index[ticker][1],
            }
            for ticker in ticker_hits
        ]
        exposure_posture = (
            "market_proxy" if any(item["mapping_type"] == "market_proxy" for item in ticker_basis)
            else "needs_exposure_attribution"
        )
        matches.append({
            "sector_id": sector["sector_id"],
            "name_ko": sector["name_ko"],
            "confidence": confidence,
            "score": score,
            "accepted": confidence in _ACCEPTED_CONFIDENCE,
            "ticker_basis": ticker_basis,
            "keyword_basis": [
                {"keyword": keyword, "fields": sorted(hit_fields)}
                for keyword, hit_fields in sorted(keyword_hits.items())
            ],
            "exposure_posture": exposure_posture,
        })

    matches.sort(key=lambda item: (-item["score"], item["sector_id"]))
    accepted_ids = [item["sector_id"] for item in matches if item["accepted"]]
    candidate_ids = [item["sector_id"] for item in matches]
    return {
        "sector_classification_version": CLASSIFICATION_VERSION,
        "sector_master_version": master.get("version_date"),
        "sector_ids": accepted_ids,
        "sector_candidate_ids": candidate_ids,
        "sector_matches": matches,
        "sector_classification_status": "matched" if accepted_ids else "candidate_only" if matches else "unmatched",
    }


def classify_records(records: list[dict[str, Any]], master: dict[str, Any]) -> list[dict[str, Any]]:
    classified: list[dict[str, Any]] = []
    for record in records:
        row = dict(record)
        row.update(classify_record(row, master))
        classified.append(row)
    return classified


def annotate_market_payload(payload: dict[str, Any], master: dict[str, Any]) -> dict[str, Any]:
    """Attach direct master mappings to ETF/equity price rows."""
    annotated = dict(payload)
    items: list[dict[str, Any]] = []
    for item in payload.get("items", []):
        row = dict(item)
        matches = sectors_for_ticker(master, str(row.get("ticker") or ""), "US")
        row["sector_ids"] = [sector["sector_id"] for sector in matches]
        row["sector_classification_version"] = CLASSIFICATION_VERSION
        row["sector_mapping_basis"] = "master_ticker" if matches else "unmatched"
        items.append(row)
    annotated["items"] = items
    annotated["sector_master_schema"] = SCHEMA_VERSION
    annotated["sector_master_version"] = master.get("version_date")
    return annotated


def sector_evidence_summary(
    records: list[dict[str, Any]],
    market_payload: dict[str, Any],
    master: dict[str, Any],
) -> dict[str, Any]:
    """Build connection counts only; sector scoring belongs to the next stage."""
    sectors: list[dict[str, Any]] = []
    accepted_record_ids: set[str] = set()
    candidate_record_ids: set[str] = set()
    for sector in master.get("sectors", []):
        sector_id = sector["sector_id"]
        accepted = [record for record in records if sector_id in record.get("sector_ids", [])]
        candidates = [
            record for record in records
            if sector_id in record.get("sector_candidate_ids", []) and sector_id not in record.get("sector_ids", [])
        ]
        accepted_record_ids.update(str(record.get("id")) for record in accepted)
        candidate_record_ids.update(str(record.get("id")) for record in candidates)
        proxies = [
            item.get("ticker") for item in market_payload.get("items", [])
            if sector_id in item.get("sector_ids", [])
        ]
        if not accepted and not candidates and not proxies:
            continue
        grade_counts = Counter(str(record.get("source_grade") or "unknown") for record in accepted)
        sectors.append({
            "sector_id": sector_id,
            "name_ko": sector["name_ko"],
            "accepted_record_count": len(accepted),
            "candidate_only_record_count": len(candidates),
            "primary_confirmed_record_count": sum(bool(record.get("primary_source_confirmed")) for record in accepted),
            "accepted_records_by_grade": dict(sorted(grade_counts.items())),
            "market_proxy_tickers": sorted({ticker for ticker in proxies if ticker}),
            "evidence_posture": "connected_not_scored",
        })
    sectors.sort(
        key=lambda item: (
            -(item["accepted_record_count"] + len(item["market_proxy_tickers"])),
            -item["candidate_only_record_count"],
            item["sector_id"],
        )
    )
    return {
        "schema_version": "sector_evidence_connections.v1",
        "classification_version": CLASSIFICATION_VERSION,
        "sector_master_version": master.get("version_date"),
        "accepted_record_count": len(accepted_record_ids),
        "candidate_only_record_count": len(candidate_record_ids),
        "unmatched_record_count": sum(
            record.get("sector_classification_status") == "unmatched" for record in records
        ),
        "covered_sector_count": len(sectors),
        "note": "Connections are research inputs, not sector scores or investment recommendations.",
        "sectors": sectors,
    }
