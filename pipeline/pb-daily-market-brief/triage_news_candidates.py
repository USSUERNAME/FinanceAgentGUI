"""Triage candidate headlines and cluster retained records into events.

Stages implemented here:

4. classify title + bounded description as keep / discard / needs_more_text;
5. cluster kept records by entity, topic, title similarity, and time.

The optional model endpoint must resolve to a loopback address.  This keeps the
"local AI" stage local by construction.  GitHub-hosted runs use the
deterministic fallback unless a self-hosted runner exposes a local endpoint.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo

from candidate_pipeline import (
    is_candidate_record,
    parse_timestamp,
    record_rank,
    title_similarity,
    within_time_window,
)
from collectors.common import ROOT, load_dotenv, load_source_config

TRIAGE_DECISIONS = {"keep", "discard", "needs_more_text"}
EVENT_TYPES = {
    "monetary_policy",
    "economic_data",
    "earnings_guidance",
    "corporate_action",
    "regulation_policy",
    "commodity_supply",
    "geopolitics",
    "market_structure",
    "other",
}
GENERIC_TAGS = {
    "news", "international", "market", "gdelt", "english", "united states",
    "rss", "current_metadata",
}
EVENT_TYPE_KEYWORDS = {
    "monetary_policy": {
        "federal reserve", "fed", "fomc", "interest rate", "rates", "central bank",
        "연준", "금리", "통화정책", "중앙은행",
    },
    "economic_data": {
        "inflation", "cpi", "jobs", "employment", "gdp", "retail sales", "pmi",
        "물가", "고용", "실업", "소매판매", "경제지표",
    },
    "earnings_guidance": {
        "earnings", "revenue", "profit", "guidance", "forecast", "quarter",
        "실적", "매출", "영업이익", "순이익", "가이던스", "전망",
    },
    "corporate_action": {
        "merger", "acquisition", "buyback", "dividend", "offering", "convertible",
        "합병", "인수", "자사주", "배당", "유상증자", "전환사채",
    },
    "regulation_policy": {
        "regulation", "regulator", "tariff", "sanction", "policy", "antitrust",
        "규제", "관세", "제재", "정책", "독점",
    },
    "commodity_supply": {
        "oil", "gas", "gold", "copper", "opec", "inventory", "supply",
        "원유", "유가", "천연가스", "금", "구리", "재고", "공급",
    },
    "geopolitics": {
        "war", "ceasefire", "conflict", "iran", "china", "russia", "ukraine",
        "전쟁", "휴전", "분쟁", "이란", "중국", "러시아", "우크라이나",
    },
    "market_structure": {
        "hedge fund", "positioning", "volatility", "liquidity", "flows", "short interest",
        "헤지펀드", "포지셔닝", "변동성", "유동성", "수급", "공매도",
    },
}
ENTITY_ALIASES = {
    "federal reserve": "Federal Reserve",
    "fomc": "Federal Reserve",
    "fed ": "Federal Reserve",
    "sec ": "SEC",
    "openai": "OpenAI",
    "nvidia": "NVIDIA",
    "microsoft": "Microsoft",
    "tesla": "Tesla",
    "opec": "OPEC",
    "china": "China",
    "iran": "Iran",
    "russia": "Russia",
    "ukraine": "Ukraine",
}


def validate_local_endpoint(url: str) -> str:
    """Allow only explicit loopback HTTP endpoints for local inference."""
    value = url.strip()
    if not value:
        return ""
    parsed = urlsplit(value)
    if parsed.scheme not in {"http", "https"}:
        raise ValueError("LOCAL_NEWS_CLASSIFIER_URL must use http or https")
    if (parsed.hostname or "").lower() not in {"127.0.0.1", "localhost", "::1"}:
        raise ValueError("LOCAL_NEWS_CLASSIFIER_URL must point to a loopback host")
    if not parsed.path:
        raise ValueError("LOCAL_NEWS_CLASSIFIER_URL must include the inference path")
    return value


def bounded_description(record: dict[str, Any], limit: int = 1200) -> str:
    text = str(record.get("raw_text") or "").strip()
    title = str(record.get("title") or "").strip()
    return (text if text and text != title else "")[:limit]


def infer_event_type(text: str) -> str:
    lowered = text.casefold()
    scores = {
        event_type: sum(keyword in lowered for keyword in keywords)
        for event_type, keywords in EVENT_TYPE_KEYWORDS.items()
    }
    winner, score = max(scores.items(), key=lambda item: (item[1], item[0]))
    return winner if score else "other"


def deterministic_entities(record: dict[str, Any]) -> list[str]:
    text = f"{record.get('title', '')} {record.get('raw_text', '')}".casefold()
    entities = {str(ticker).upper() for ticker in record.get("tickers", []) if ticker}
    for needle, entity in ENTITY_ALIASES.items():
        if needle in text:
            entities.add(entity)
    for token in re.findall(r"\b[A-Z][A-Z0-9.-]{1,7}\b", str(record.get("title") or "")):
        if token not in {"THE", "AND", "FOR", "WITH", "FROM"}:
            entities.add(token)
    return sorted(entities)


def deterministic_topics(record: dict[str, Any], event_type: str) -> list[str]:
    text = f"{record.get('title', '')} {record.get('raw_text', '')}".casefold()
    topics = {
        keyword
        for keywords in EVENT_TYPE_KEYWORDS.values()
        for keyword in keywords
        if keyword in text
    }
    topics.update(
        str(tag).casefold()
        for tag in record.get("tags", [])
        if str(tag).casefold() not in GENERIC_TAGS
    )
    topics.add(event_type)
    return sorted(topics)


def deterministic_triage(record: dict[str, Any]) -> dict[str, Any]:
    candidate_filter = record.get("candidate_filter", {})
    source_tier = str(candidate_filter.get("source_tier") or "general")
    matched = list(candidate_filter.get("matched_include_keywords") or [])
    description = bounded_description(record)
    text = f"{record.get('title', '')} {description}"
    event_type = infer_event_type(text)
    if source_tier in {"primary", "trusted"}:
        decision = "keep"
        confidence = 0.82 if source_tier == "primary" else 0.72
        reason_codes = ["source_tier_supports_relevance"]
    elif (
        record.get("discovery_role") == "breaking_news_radar"
        and matched
        and event_type != "other"
        and record.get("publication_eligible") is False
    ):
        decision = "keep"
        confidence = 0.60
        reason_codes = ["radar_keyword_event_candidate_nonpublication"]
    elif matched and len(description) >= 80 and event_type != "other":
        decision = "keep"
        confidence = 0.64
        reason_codes = ["keyword_match_with_substantive_description"]
    else:
        decision = "needs_more_text"
        confidence = 0.58
        reason_codes = ["headline_metadata_insufficient_for_safe_rejection"]
    return {
        "version": "candidate_triage_v1",
        "decision": decision,
        "confidence": confidence,
        "classifier": "deterministic_fallback",
        "input_scope": "title_and_bounded_description",
        "reason_codes": reason_codes,
        "event_type": event_type,
        "entities": deterministic_entities(record),
        "topic_tags": deterministic_topics(record, event_type),
    }


def parse_model_json(text: str) -> dict[str, Any]:
    value = text.strip()
    if value.startswith("```"):
        value = re.sub(r"^```(?:json)?\s*", "", value)
        value = re.sub(r"\s*```$", "", value)
    try:
        payload = json.loads(value)
    except json.JSONDecodeError:
        start, end = value.find("{"), value.rfind("}")
        if start < 0 or end <= start:
            raise
        payload = json.loads(value[start:end + 1])
    if not isinstance(payload, dict):
        raise ValueError("Local classifier response must be a JSON object")
    return payload


def validated_model_triage(payload: dict[str, Any], record: dict[str, Any]) -> dict[str, Any]:
    decision = str(payload.get("decision") or "")
    if decision not in TRIAGE_DECISIONS:
        raise ValueError(f"Unsupported triage decision: {decision}")
    event_type = str(payload.get("event_type") or "other")
    if event_type not in EVENT_TYPES:
        event_type = "other"
    confidence = max(0.0, min(float(payload.get("confidence", 0.5)), 1.0))
    entities = sorted({
        str(item).strip()[:80]
        for item in payload.get("entities", [])
        if str(item).strip()
    })[:12]
    topics = sorted({
        str(item).strip().casefold()[:80]
        for item in payload.get("topic_tags", [])
        if str(item).strip()
    })[:12]
    reasons = sorted({
        str(item).strip()[:120]
        for item in payload.get("reason_codes", [])
        if str(item).strip()
    })[:8]
    return {
        "version": "candidate_triage_v1",
        "decision": decision,
        "confidence": confidence,
        "classifier": "local_openai_compatible",
        "input_scope": "title_and_bounded_description",
        "reason_codes": reasons or ["local_model_classification"],
        "event_type": event_type,
        "entities": entities or deterministic_entities(record),
        "topic_tags": topics or deterministic_topics(record, event_type),
    }


def call_local_classifier(record: dict[str, Any], endpoint: str, model: str) -> dict[str, Any]:
    prompt = {
        "title": str(record.get("title") or "")[:500],
        "description": bounded_description(record),
    }
    instruction = (
        "Classify one market-news candidate using only its title and description. "
        "Return JSON only with decision (keep|discard|needs_more_text), confidence 0..1, "
        "reason_codes (short string array), event_type "
        "(monetary_policy|economic_data|earnings_guidance|corporate_action|"
        "regulation_policy|commodity_supply|geopolitics|market_structure|other), "
        "entities (array), and topic_tags (array). Keep only items useful to a public-equity "
        "PB brief. Use needs_more_text when headline metadata is insufficient; do not infer facts."
    )
    request_payload = {
        "model": model,
        "temperature": 0,
        "messages": [
            {"role": "system", "content": instruction},
            {"role": "user", "content": json.dumps(prompt, ensure_ascii=False)},
        ],
    }
    request = Request(
        endpoint,
        method="POST",
        data=json.dumps(request_payload, ensure_ascii=False).encode("utf-8"),
        headers={"Content-Type": "application/json"},
    )
    with urlopen(request, timeout=45) as response:
        payload = json.loads(response.read().decode("utf-8"))
    content = payload.get("choices", [{}])[0].get("message", {}).get("content", "")
    return validated_model_triage(parse_model_json(str(content)), record)


def triage_record(
    record: dict[str, Any],
    *,
    endpoint: str = "",
    model: str = "",
) -> dict[str, Any]:
    if not is_candidate_record(record):
        return record
    result: dict[str, Any]
    if endpoint:
        try:
            result = call_local_classifier(record, endpoint, model)
        except Exception as exc:
            result = deterministic_triage(record)
            result["fallback_reason"] = f"local_classifier_unavailable:{type(exc).__name__}"
    else:
        result = deterministic_triage(record)
        result["fallback_reason"] = "local_classifier_not_configured"
    record["triage"] = result
    return record


def cluster_topics(record: dict[str, Any]) -> set[str]:
    triage = record.get("triage", {})
    return {
        str(item).casefold()
        for item in triage.get("topic_tags", [])
        if str(item).casefold() not in GENERIC_TAGS
    }


def cluster_entities(record: dict[str, Any]) -> set[str]:
    return {str(item).casefold() for item in record.get("triage", {}).get("entities", []) if item}


def same_event(left: dict[str, Any], right: dict[str, Any], settings: dict[str, Any]) -> bool:
    if not within_time_window(left, right, float(settings.get("cluster_time_window_hours", 48))):
        return False
    entities_overlap = cluster_entities(left) & cluster_entities(right)
    topics_overlap = cluster_topics(left) & cluster_topics(right)
    if not entities_overlap and not topics_overlap:
        return False
    similarity = title_similarity(str(left.get("title") or ""), str(right.get("title") or ""))
    threshold = float(settings.get("cluster_title_similarity_threshold", 0.58))
    if similarity >= threshold:
        return True
    left_type = str(left.get("triage", {}).get("event_type") or "other")
    right_type = str(right.get("triage", {}).get("event_type") or "other")
    return bool(entities_overlap and topics_overlap and left_type == right_type and left_type != "other")


def verification_status(records: list[dict[str, Any]]) -> str:
    if records and all(
        item.get("source_type") == "institutional_research_metadata"
        for item in records
    ):
        return "official_institutional_commentary_metadata"
    if any(item.get("primary_source_confirmed") for item in records):
        return "primary_source_available"
    if any(item.get("candidate_filter", {}).get("source_tier") == "trusted" for item in records):
        return "trusted_secondary_only"
    return "discovery_metadata_only"


def build_event_clusters(
    records: list[dict[str, Any]],
    settings: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    resolved = settings or {}
    kept = [
        item for item in records
        if is_candidate_record(item) and item.get("triage", {}).get("decision") == "keep"
    ]
    parents = list(range(len(kept)))

    def find(index: int) -> int:
        while parents[index] != index:
            parents[index] = parents[parents[index]]
            index = parents[index]
        return index

    def union(left: int, right: int) -> None:
        left_root, right_root = find(left), find(right)
        if left_root != right_root:
            parents[right_root] = left_root

    for index, record in enumerate(kept):
        for other_index in range(index):
            if same_event(record, kept[other_index], resolved):
                union(index, other_index)

    grouped: dict[int, list[dict[str, Any]]] = {}
    for index, record in enumerate(kept):
        grouped.setdefault(find(index), []).append(record)

    clusters: list[dict[str, Any]] = []
    for group in grouped.values():
        ranked = sorted(group, key=record_rank, reverse=True)
        representative = ranked[0]
        timestamps = sorted(
            parsed.astimezone(timezone.utc).isoformat()
            for parsed in (parse_timestamp(item.get("published_at")) for item in group)
            if parsed
        )
        record_ids = sorted(str(item.get("id") or "") for item in group)
        event_date = (timestamps[0][:10] if timestamps else "undated").replace("-", "")
        signature = hashlib.sha256("|".join(record_ids).encode("utf-8")).hexdigest()[:12]
        event_id = f"event_{event_date}_{signature}"
        event_types = Counter(str(item.get("triage", {}).get("event_type") or "other") for item in group)
        event_type = event_types.most_common(1)[0][0]
        entities = sorted(set().union(*(cluster_entities(item) for item in group)))
        topics = sorted(set().union(*(cluster_topics(item) for item in group)))
        cluster = {
            "event_id": event_id,
            "event_type": event_type,
            "representative_record_id": representative.get("id"),
            "representative_title": representative.get("title"),
            "record_ids": record_ids,
            "article_count": len(group),
            "publisher_count": len({str(item.get("publisher") or item.get("source_id") or "") for item in group}),
            "published_from": timestamps[0] if timestamps else None,
            "published_to": timestamps[-1] if timestamps else None,
            "entities": entities,
            "topic_tags": topics,
            "verification_status": verification_status(group),
            "source_urls": [
                item.get("canonical_url") or item.get("url")
                for item in ranked[:3]
                if item.get("canonical_url") or item.get("url")
            ],
        }
        for item in group:
            item["event_cluster"] = {
                "event_id": event_id,
                "event_type": event_type,
                "article_count": len(group),
                "verification_status": cluster["verification_status"],
            }
        clusters.append(cluster)
    return sorted(
        clusters,
        key=lambda item: (item["article_count"], item.get("published_to") or ""),
        reverse=True,
    )


def build_triage_outputs(
    records: list[dict[str, Any]],
    settings: dict[str, Any],
    *,
    endpoint: str = "",
    model: str = "",
) -> tuple[list[dict[str, Any]], dict[str, Any], dict[str, Any]]:
    triaged = [triage_record(item, endpoint=endpoint, model=model) for item in records]
    clusters = build_event_clusters(triaged, settings)
    decisions = Counter(
        item.get("triage", {}).get("decision")
        for item in triaged
        if is_candidate_record(item)
    )
    classifier_counts = Counter(
        item.get("triage", {}).get("classifier")
        for item in triaged
        if is_candidate_record(item)
    )
    report_records = [
        item for item in triaged
        if (
            not is_candidate_record(item)
            or (
                item.get("triage", {}).get("decision") == "keep"
                and item.get("publication_eligible") is not False
            )
        )
    ]
    audit = {
        "schema_version": "candidate_triage_audit.v1",
        "decision_counts": {decision: decisions.get(decision, 0) for decision in sorted(TRIAGE_DECISIONS)},
        "classifier_counts": dict(sorted((str(key), value) for key, value in classifier_counts.items())),
        "input_candidate_count": sum(decisions.values()),
        "report_candidate_count": decisions.get("keep", 0),
        "needs_more_text_record_ids": [
            item.get("id")
            for item in triaged
            if item.get("triage", {}).get("decision") == "needs_more_text"
        ],
        "discarded_record_ids": [
            item.get("id")
            for item in triaged
            if item.get("triage", {}).get("decision") == "discard"
        ],
        "publication_blocked_record_ids": [
            item.get("id")
            for item in triaged
            if (
                is_candidate_record(item)
                and item.get("triage", {}).get("decision") == "keep"
                and item.get("publication_eligible") is False
            )
        ],
    }
    event_payload = {
        "schema_version": "event_clusters.v1",
        "cluster_count": len(clusters),
        "clustered_record_count": sum(item["article_count"] for item in clusters),
        "unclustered_needs_more_text_count": decisions.get("needs_more_text", 0),
        "clusters": clusters,
    }
    return report_records, audit, event_payload


def main() -> None:
    parser = argparse.ArgumentParser(description="Triage normalized news candidates and build event clusters.")
    parser.add_argument("--date", required=True, help="Report date in YYYY-MM-DD")
    parser.add_argument("--inbox-file", required=True)
    parser.add_argument("--require-local-model", action="store_true")
    args = parser.parse_args()

    load_dotenv()
    endpoint = validate_local_endpoint(os.getenv("LOCAL_NEWS_CLASSIFIER_URL", ""))
    model = os.getenv("LOCAL_NEWS_CLASSIFIER_MODEL", "local-news-classifier").strip()
    if args.require_local_model and not endpoint:
        raise SystemExit("LOCAL_NEWS_CLASSIFIER_URL is required in --require-local-model mode.")
    inbox_path = Path(args.inbox_file)
    if not inbox_path.exists():
        raise SystemExit(f"Normalized inbox not found: {inbox_path}")
    records = json.loads(inbox_path.read_text(encoding="utf-8"))
    settings = load_source_config().get("candidate_pipeline", {})
    report_records, audit, event_payload = build_triage_outputs(
        records,
        settings,
        endpoint=endpoint,
        model=model,
    )
    timezone_name = os.getenv("BRIEF_TIMEZONE", "Asia/Seoul")
    generated_at = datetime.now(ZoneInfo(timezone_name)).isoformat()
    audit.update({"report_date": args.date, "generated_at": generated_at})
    event_payload.update({"report_date": args.date, "generated_at": generated_at})

    output_dir = ROOT / "workspace" / "triaged" / args.date
    output_dir.mkdir(parents=True, exist_ok=True)
    triaged_output = output_dir / "triaged_inbox.json"
    audit_output = output_dir / "triage_audit.json"
    event_output = output_dir / "event_clusters.json"
    triaged_output.write_text(json.dumps(report_records, ensure_ascii=False, indent=2), encoding="utf-8")
    audit_output.write_text(json.dumps(audit, ensure_ascii=False, indent=2), encoding="utf-8")
    event_output.write_text(json.dumps(event_payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Triaged report inbox saved: {triaged_output.relative_to(ROOT)}")
    print(
        "Candidate triage:",
        ", ".join(f"{key}={value}" for key, value in audit["decision_counts"].items()),
    )
    print(f"Event clusters saved: {event_output.relative_to(ROOT)} ({event_payload['cluster_count']} cluster(s))")


if __name__ == "__main__":
    main()
