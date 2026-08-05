"""Materialize primary-source structural drivers and durable catalysts."""

from __future__ import annotations

import argparse
import json
from collections import defaultdict
from datetime import date
from pathlib import Path
from statistics import median
from typing import Any

from collectors.common import ROOT
from sector_master import load_sector_master

SCHEMA_VERSION = "sector_driver_observations.v1"
REGISTRY_PATH = ROOT / "sector_driver_registry.json"
STRUCTURAL_STATUSES = {"in_force", "published"}
CATALYST_STATUSES = {"confirmed"}


def load_driver_registry(path: Path = REGISTRY_PATH) -> dict[str, Any]:
    registry = json.loads(path.read_text(encoding="utf-8"))
    if registry.get("schema_version") != "sector_driver_registry.v1":
        raise ValueError("Unexpected sector driver registry schema")
    return registry


def validate_driver_registry(registry: dict[str, Any], master: dict[str, Any]) -> None:
    sector_ids = {item["sector_id"] for item in master["sectors"]}
    seen: dict[str, str] = {}
    required = {
        "evidence_id", "sector_id", "dimension_id", "evidence_type", "status",
        "direction", "effective_date", "horizon_end", "source_owner", "source_url",
        "body_location", "evidence_summary", "transmission_path", "invalidation_condition",
        "source_grade", "primary_source_confirmed",
    }
    for record in registry.get("records", []):
        missing = sorted(required - set(record))
        if missing:
            raise ValueError(f"Driver record missing fields {missing}: {record.get('evidence_id')}")
        evidence_id = str(record["evidence_id"])
        dimension = str(record["dimension_id"])
        if evidence_id in seen:
            raise ValueError(f"Evidence reuse is not allowed: {evidence_id}")
        seen[evidence_id] = dimension
        if record["sector_id"] not in sector_ids:
            raise ValueError(f"Unknown sector_id: {record['sector_id']}")
        if dimension not in {"structural_driver", "catalyst_durability"}:
            raise ValueError(f"Unsupported driver dimension: {dimension}")
        if not str(record["source_url"]).startswith("https://"):
            raise ValueError(f"Primary source URL must be https: {evidence_id}")
        if record["source_grade"] != "A" or record["primary_source_confirmed"] is not True:
            raise ValueError(f"Only confirmed grade-A evidence is permitted: {evidence_id}")
        date.fromisoformat(record["effective_date"])
        date.fromisoformat(record["horizon_end"])
        if dimension == "catalyst_durability" and int(record.get("expected_duration_months", 0)) <= 0:
            raise ValueError(f"Catalyst duration is required: {evidence_id}")


def _structural_score(record: dict[str, Any], report_date: date) -> float:
    horizon_months = max(
        0,
        (date.fromisoformat(record["horizon_end"]).year - report_date.year) * 12
        + date.fromisoformat(record["horizon_end"]).month - report_date.month,
    )
    type_base = {
        "enacted_law": 84, "enacted_program": 80, "final_rule": 78,
        "binding_commitment": 76, "multilateral_commitment": 76,
        "executive_order": 70, "official_roadmap": 70, "official_forecast": 68,
    }.get(record["evidence_type"], 65)
    score = min(95.0, type_base + min(horizon_months, 60) * 0.15)
    return round(score if record["direction"] == "supportive" else 100 - score, 2)


def _catalyst_score(record: dict[str, Any]) -> float:
    duration = min(int(record["expected_duration_months"]), 60)
    score = min(95.0, 50 + duration * 0.75)
    return round(score if record["direction"] == "supportive" else 100 - score, 2)


def build_driver_observations(
    report_date: str,
    registry: dict[str, Any],
    master: dict[str, Any],
) -> dict[str, Any]:
    validate_driver_registry(registry, master)
    as_of = date.fromisoformat(report_date)
    eligible: list[dict[str, Any]] = []
    excluded: list[dict[str, Any]] = []
    for source in registry["records"]:
        record = dict(source)
        dimension = record["dimension_id"]
        allowed_status = STRUCTURAL_STATUSES if dimension == "structural_driver" else CATALYST_STATUSES
        reasons: list[str] = []
        if record["status"] not in allowed_status:
            reasons.append("status_not_eligible")
        if date.fromisoformat(record["horizon_end"]) < as_of:
            reasons.append("evidence_horizon_expired")
        if dimension == "structural_driver" and date.fromisoformat(record["effective_date"]) > as_of:
            reasons.append("not_yet_effective")
        if reasons:
            record["eligible_for_score"] = False
            record["exclusion_reasons"] = reasons
            excluded.append(record)
            continue
        record["eligible_for_score"] = True
        record["score"] = _structural_score(record, as_of) if dimension == "structural_driver" else _catalyst_score(record)
        eligible.append(record)

    grouped: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)
    for record in eligible:
        grouped[(record["sector_id"], record["dimension_id"])].append(record)
    policy = registry["policy"]
    dimensions: list[dict[str, Any]] = []
    for sector in master["sectors"]:
        for dimension in ("structural_driver", "catalyst_durability"):
            rows = grouped[(sector["sector_id"], dimension)]
            owners = sorted({row["source_owner"] for row in rows})
            minimum = int(
                policy["minimum_structural_sources"]
                if dimension == "structural_driver"
                else policy["minimum_catalyst_sources"]
            )
            available = len(owners) >= minimum
            dimensions.append({
                "sector_id": sector["sector_id"],
                "dimension_id": dimension,
                "status": "available" if available else "insufficient_independent_primary_sources",
                "score": round(median([row["score"] for row in rows]), 2) if available else None,
                "confidence": "high" if len(owners) >= 3 else "medium" if len(owners) >= 2 else "low" if available else "none",
                "independent_source_count": len(owners),
                "minimum_independent_sources": minimum,
                "source_owners": owners,
                "evidence_ids": [row["evidence_id"] for row in rows],
                "source_urls": [row["source_url"] for row in rows],
            })
    return {
        "schema_version": SCHEMA_VERSION,
        "report_date": report_date,
        "registry_as_of": registry["as_of"],
        "collection_status": "available",
        "policy": policy,
        "eligible_record_count": len(eligible),
        "excluded_record_count": len(excluded),
        "observations": eligible,
        "excluded_observations": excluded,
        "dimension_scores": dimensions,
        "note": "Primary-source research inputs only; scores measure evidence durability, not expected returns.",
    }


def write_driver_observations(report_date: str) -> Path:
    payload = build_driver_observations(report_date, load_driver_registry(), load_sector_master())
    output_dir = ROOT / "workspace" / "sector_drivers" / report_date
    output_dir.mkdir(parents=True, exist_ok=True)
    output = output_dir / "sector_drivers.json"
    output.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return output


def main() -> None:
    parser = argparse.ArgumentParser(description="Build sector structural-driver and catalyst evidence")
    parser.add_argument("--date", default=date.today().isoformat())
    args = parser.parse_args()
    output = write_driver_observations(args.date)
    print(f"Sector drivers saved: {output.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
