"""Build a rights-safe, cross-report analyst research digest."""

from __future__ import annotations

import argparse
import json
import re
from collections import Counter, defaultdict
from copy import deepcopy
from datetime import datetime
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

from collectors.common import ROOT

SCHEMA_VERSION = "broker_research_digest.v1"
MAX_REPORTS = 20
PUBLICATION_POLICIES = {"private_analysis_only", "summary_and_link_only"}
STANCE_ORDER = ("positive", "neutral", "cautious", "negative", "not_stated")


def _clean(value: Any, limit: int) -> str:
    text = " ".join(str(value or "").split()).strip()
    return text[:limit]


def _strings(value: Any, *, limit: int, item_chars: int) -> list[str]:
    if not isinstance(value, list):
        return []
    output: list[str] = []
    for item in value:
        text = _clean(item, item_chars)
        if text and text not in output:
            output.append(text)
        if len(output) >= limit:
            break
    return output


def _tokens(value: Any) -> set[str]:
    return {
        token.lower()
        for token in re.findall(r"[A-Za-z0-9가-힣_]{3,}", str(value or ""))
        if token.lower() not in {"report", "market", "research", "리포트", "시장"}
    }


def _telegram_matches(
    card: dict[str, Any],
    records: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    card_tickers = {value.upper() for value in card.get("tickers") or []}
    card_sectors = {value.lower() for value in card.get("sectors") or []}
    card_tokens = _tokens(card.get("title"))
    card_url = str((card.get("source") or {}).get("url") or "")
    by_event: dict[str, dict[str, Any]] = {}
    for record in records:
        if (
            not isinstance(record, dict)
            or record.get("source_type") != "telegram_commentary"
        ):
            continue
        cluster = record.get("event_cluster") or {}
        event_id = str(cluster.get("event_id") or record.get("id") or "")
        if not event_id:
            continue
        record_tickers = {str(value).upper() for value in record.get("tickers") or []}
        record_sectors = {
            str(value).lower()
            for value in [
                *(record.get("sector_ids") or []),
                *(record.get("sector_candidate_ids") or []),
            ]
        }
        record_links = {
            str(value)
            for value in [
                record.get("canonical_url"),
                record.get("url"),
                *(record.get("linked_urls") or []),
            ]
            if value
        }
        shared_tickers = sorted(card_tickers & record_tickers)
        shared_sectors = sorted(card_sectors & record_sectors)
        shared_tokens = sorted(
            card_tokens
            & _tokens(f"{record.get('title', '')} {record.get('raw_text', '')[:1200]}")
        )
        same_source_link = bool(card_url and card_url in record_links)
        score = (
            (8 if same_source_link else 0)
            + 5 * len(shared_tickers)
            + 3 * len(shared_sectors)
            + min(3, len(shared_tokens))
        )
        if score < 3:
            continue
        candidate = {
            "event_id": event_id,
            "title": _clean(record.get("title"), 240),
            "score": score,
            "match_reasons": [
                *(["same_source_link"] if same_source_link else []),
                *([f"ticker:{value}" for value in shared_tickers]),
                *([f"sector:{value}" for value in shared_sectors]),
                *([f"topic:{value}" for value in shared_tokens[:3]]),
            ],
            "telegram_url": _clean(record.get("url"), 1000),
            "channel": _clean(
                (record.get("telegram") or {}).get("channel_name")
                or record.get("publisher"),
                160,
            ),
        }
        current = by_event.get(event_id)
        if current is None or candidate["score"] > current["score"]:
            by_event[event_id] = candidate
    return sorted(
        by_event.values(),
        key=lambda row: (row["score"], row["event_id"]),
        reverse=True,
    )[:3]


def _eligible(record: dict[str, Any]) -> bool:
    rights = record.get("research_rights") or {}
    return (
        record.get("source_type") == "broker_report"
        and rights.get("analysis_allowed") is True
        and rights.get("redistribution_allowed") is False
        and rights.get("publication_policy") in PUBLICATION_POLICIES
    )


def _report_type(record: dict[str, Any], metadata: dict[str, Any]) -> str:
    explicit = _clean(metadata.get("report_type"), 80)
    if explicit:
        return explicit
    haystack = " ".join(
        [
            _clean(record.get("title"), 300),
            " ".join(_strings(record.get("tags"), limit=20, item_chars=80)),
        ]
    ).lower()
    mappings = (
        ("earnings", ("earnings", "실적", "review", "preview")),
        ("company", ("company", "기업", "initiation")),
        ("sector", ("sector", "industry", "산업", "업종")),
        ("strategy", ("strategy", "market", "전략", "시황")),
        ("macro", ("macro", "economy", "경제", "금리", "환율")),
    )
    for label, keywords in mappings:
        if any(keyword in haystack for keyword in keywords):
            return label
    return "other"


def _card(
    record: dict[str, Any],
    *,
    generated_analysis: dict[str, Any] | None = None,
) -> dict[str, Any]:
    operator_metadata = record.get("research_metadata") or {}
    generated = generated_analysis or {}
    operator_overrides = {
        key: value
        for key, value in operator_metadata.items()
        if value not in (None, "", [])
        and not (key == "stance" and value == "not_stated")
    }
    metadata = {
        **generated,
        **operator_overrides,
    }
    rights = record.get("research_rights") or {}
    stance = _clean(metadata.get("stance") or "not_stated", 20)
    if stance not in STANCE_ORDER:
        stance = "not_stated"
    tickers = _strings(
        [*(record.get("tickers") or []), *(metadata.get("tickers") or [])],
        limit=12,
        item_chars=20,
    )
    sectors = _strings(metadata.get("sectors"), limit=8, item_chars=120)
    if not sectors:
        sectors = _strings(record.get("sector_ids"), limit=8, item_chars=120)
    summary = _clean(metadata.get("summary"), 1200)
    key_claims = _strings(metadata.get("key_claims"), limit=8, item_chars=500)
    catalysts = _strings(metadata.get("catalysts"), limit=6, item_chars=300)
    risks = _strings(metadata.get("risks"), limit=6, item_chars=300)
    monitoring_conditions = _strings(
        metadata.get("monitoring_conditions"),
        limit=6,
        item_chars=300,
    )
    structured = bool(summary or key_claims or catalysts or risks)
    return {
        "report_id": _clean(record.get("id") or record.get("source_reference"), 120),
        "publisher": _clean(record.get("publisher") or record.get("source_id"), 160),
        "analyst": _clean(metadata.get("analyst"), 120),
        "title": _clean(record.get("title"), 240),
        "published_at": _clean(record.get("published_at"), 80),
        "market_scope": _clean(record.get("market_scope") or "UNKNOWN", 20).upper(),
        "issuer_country": _clean(record.get("issuer_country"), 20).upper(),
        "original_language": _clean(record.get("original_language"), 20).lower(),
        "base_currency": _clean(record.get("base_currency"), 12).upper(),
        "report_type": _report_type(record, metadata),
        "stance": stance,
        "tickers": tickers,
        "sectors": sectors,
        "summary": summary,
        "key_claims": key_claims,
        "catalysts": catalysts,
        "risks": risks,
        "monitoring_conditions": monitoring_conditions,
        "opinion_change": {
            "rating": _clean(metadata.get("rating"), 80),
            "previous_rating": _clean(metadata.get("previous_rating"), 80),
            "target_price": metadata.get("target_price"),
            "previous_target_price": metadata.get("previous_target_price"),
            "currency": _clean(metadata.get("currency"), 12),
        },
        "source": {
            "reference": _clean(record.get("source_reference"), 240),
            "url": _clean(record.get("canonical_url") or record.get("url"), 1000),
        },
        "processing": {
            "structured_analysis_available": structured,
            "status": "ready" if structured else "awaiting_structured_analysis",
            "analysis_source": (
                "operator_metadata"
                if operator_metadata and structured
                else "model_generated"
                if generated and structured
                else "none"
            ),
        },
        "rights": {
            "publication_policy": rights.get("publication_policy"),
            "redistribution_allowed": False,
            "full_text_included": False,
        },
    }


def build_digest(
    report_date: str,
    records: list[dict[str, Any]],
    *,
    analysis_payload: dict[str, Any] | None = None,
    generated_at: str | None = None,
    max_reports: int = MAX_REPORTS,
) -> dict[str, Any]:
    analysis_payload = analysis_payload or {}
    analysis_by_id = {
        str(row.get("report_id") or ""): row
        for row in analysis_payload.get("reports") or []
        if isinstance(row, dict) and row.get("report_id")
    }
    eligible = [
        _card(
            record,
            generated_analysis=analysis_by_id.get(
                str(record.get("id") or record.get("source_reference") or "")
            ),
        )
        for record in records
        if isinstance(record, dict) and _eligible(record)
    ]
    eligible.sort(key=lambda row: (row["published_at"], row["report_id"]), reverse=True)
    cards = eligible[: max(0, min(max_reports, MAX_REPORTS))]
    for card in cards:
        card["linked_telegram_events"] = _telegram_matches(card, records)

    stance_counts = Counter(card["stance"] for card in cards)
    publisher_counts = Counter(card["publisher"] for card in cards if card["publisher"])
    ticker_counts = Counter(ticker for card in cards for ticker in card["tickers"])
    sector_counts = Counter(sector for card in cards for sector in card["sectors"])
    market_scope_counts = Counter(
        card["market_scope"] or "UNKNOWN" for card in cards
    )
    topic_stances: dict[str, set[str]] = defaultdict(set)
    for card in cards:
        for topic in [*card["tickers"], *card["sectors"]]:
            if card["stance"] != "not_stated":
                topic_stances[topic].add(card["stance"])
    disagreements = [
        {"topic": topic, "stances": sorted(stances), "report_count": sum(
            topic in [*card["tickers"], *card["sectors"]] for card in cards
        )}
        for topic, stances in topic_stances.items()
        if len(stances) > 1
    ]
    disagreements.sort(key=lambda row: (row["report_count"], row["topic"]), reverse=True)
    sector_assessments: list[dict[str, Any]] = []
    for sector, report_count in sector_counts.most_common(8):
        related = [card for card in cards if sector in card["sectors"]]
        related_stances = Counter(card["stance"] for card in related)
        positive = related_stances.get("positive", 0)
        caution = (
            related_stances.get("cautious", 0)
            + related_stances.get("negative", 0)
        )
        explicit = sum(
            related_stances.get(value, 0)
            for value in ("positive", "neutral", "cautious", "negative")
        )
        if explicit == 0:
            signal = "evidence_only"
        elif positive > caution and positive >= related_stances.get("neutral", 0):
            signal = "positive"
        elif caution > positive:
            signal = "cautious"
        elif related_stances.get("neutral", 0) == explicit:
            signal = "neutral"
        else:
            signal = "mixed"
        sector_assessments.append({
            "sector": sector,
            "report_count": report_count,
            "signal": signal,
            "stance_counts": {
                key: related_stances.get(key, 0)
                for key in STANCE_ORDER
            },
            "catalysts": _strings(
                [value for card in related for value in card["catalysts"]],
                limit=3,
                item_chars=300,
            ),
            "risks": _strings(
                [value for card in related for value in card["risks"]],
                limit=3,
                item_chars=300,
            ),
            "monitoring_conditions": _strings(
                [
                    value
                    for card in related
                    for value in card["monitoring_conditions"]
                ],
                limit=3,
                item_chars=300,
            ),
        })

    packet = {
        "schema_version": SCHEMA_VERSION,
        "report_date": report_date,
        "generated_at": generated_at or datetime.now(ZoneInfo("Asia/Seoul")).isoformat(),
        "summary": {
            "archived_report_count": len(eligible),
            "selected_report_count": len(cards),
            "structured_report_count": sum(
                card["processing"]["structured_analysis_available"] for card in cards
            ),
            "awaiting_analysis_count": sum(
                not card["processing"]["structured_analysis_available"] for card in cards
            ),
            "publisher_count": len(publisher_counts),
            "market_scope_counts": dict(sorted(market_scope_counts.items())),
            "domestic_report_count": market_scope_counts.get("KR", 0),
            "overseas_report_count": sum(
                count
                for scope, count in market_scope_counts.items()
                if scope not in {"KR", "UNKNOWN"}
            ),
            "unclassified_report_count": market_scope_counts.get("UNKNOWN", 0),
            "stance_counts": {key: stance_counts.get(key, 0) for key in STANCE_ORDER},
            "analysis_status": analysis_payload.get("status") or "not_available",
            "telegram_linked_report_count": sum(
                bool(card.get("linked_telegram_events")) for card in cards
            ),
        },
        "consensus": {
            "top_publishers": [
                {"publisher": key, "report_count": value}
                for key, value in publisher_counts.most_common(8)
            ],
            "top_tickers": [
                {"ticker": key, "report_count": value}
                for key, value in ticker_counts.most_common(10)
            ],
            "top_sectors": [
                {"sector": key, "report_count": value}
                for key, value in sector_counts.most_common(10)
            ],
            "disagreements": disagreements[:10],
            "sector_assessments": sector_assessments,
        },
        "reports": cards,
        "policy": {
            "operator_authorized_only": True,
            "full_text_redistribution": False,
            "reader_output_is_paraphrase_or_metadata_only": True,
        },
    }
    validate_digest(packet)
    return packet


def validate_digest(packet: dict[str, Any]) -> None:
    if packet.get("schema_version") != SCHEMA_VERSION:
        raise ValueError("Unsupported broker research digest schema")
    if len(packet.get("reports") or []) > MAX_REPORTS:
        raise ValueError("Broker research digest report limit exceeded")
    for report in packet.get("reports") or []:
        if (report.get("rights") or {}).get("redistribution_allowed") is not False:
            raise ValueError("Broker research redistribution must fail closed")
        if (report.get("rights") or {}).get("full_text_included") is not False:
            raise ValueError("Broker research digest cannot include full report text")
        if "raw_text" in report:
            raise ValueError("Broker research digest cannot expose raw_text")


def load_records(path: Path) -> list[dict[str, Any]]:
    payload = json.loads(path.read_text(encoding="utf-8-sig"))
    if not isinstance(payload, list):
        raise ValueError(f"Expected a JSON array: {path}")
    return [row for row in payload if isinstance(row, dict)]


def load_optional_object(path: Path | None) -> dict[str, Any]:
    if path is None or not path.exists():
        return {}
    payload = json.loads(path.read_text(encoding="utf-8-sig"))
    if not isinstance(payload, dict):
        raise ValueError(f"Expected a JSON object: {path}")
    return payload


def main() -> None:
    parser = argparse.ArgumentParser(description="Build the analyst research digest")
    parser.add_argument("--date", required=True)
    parser.add_argument("--inbox-file", required=True)
    parser.add_argument("--analysis-file")
    args = parser.parse_args()
    analysis_path = (
        ROOT / args.analysis_file
        if args.analysis_file
        else ROOT
        / "workspace"
        / "broker_research_analysis"
        / args.date
        / "broker_research_analysis.json"
    )
    packet = build_digest(
        args.date,
        load_records(ROOT / args.inbox_file),
        analysis_payload=load_optional_object(analysis_path),
    )
    output = ROOT / "workspace" / "broker_research_digest" / args.date / "broker_research_digest.json"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(packet, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Broker research digest saved: {output.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
