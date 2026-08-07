"""Extract evidence-linked filing fact candidates without semantic guesswork."""

from __future__ import annotations

import hashlib
import re
from typing import Any

SCHEMA_VERSION = "filing_fact_candidates.v1"

DART_LABELS = {
    "발행금액": ("issuance_amount", "money"),
    "사채의 권면(전자등록)총액": ("bond_principal_amount", "money"),
    "전환가액": ("conversion_price", "money_per_share"),
    "신주의 수": ("new_share_count", "shares"),
    "발행할 주식의 총수": ("authorized_share_count", "shares"),
    "증자전 발행주식총수": ("pre_issue_share_count", "shares"),
    "자금조달의 목적": ("use_of_proceeds", "text"),
    "시설자금": ("facility_funding", "money"),
    "운영자금": ("working_capital_funding", "money"),
    "채무상환자금": ("debt_repayment_funding", "money"),
    "타법인 증권 취득자금": ("acquisition_funding", "money"),
    "납입일": ("payment_date", "date"),
    "전환청구기간": ("conversion_period", "period"),
}


def compact_context(text: str, start: int, end: int, radius: int = 100) -> str:
    left = max(0, start - radius)
    right = min(len(text), end + radius)
    return re.sub(r"\s+", " ", text[left:right]).strip()


def fact_row(
    record: dict[str, Any],
    field: str,
    value_text: str,
    context: str,
    evidence_status: str,
) -> dict[str, Any]:
    source_key = str(
        record.get("filing_receipt_no")
        or record.get("filing_accession_number")
        or record.get("id")
        or ""
    )
    fingerprint = f"{source_key}|{field}|{value_text}|{context}"
    return {
        "fact_id": hashlib.sha256(fingerprint.encode("utf-8")).hexdigest()[:20],
        "field": field,
        "value_text": value_text.strip(),
        "context": context.strip(),
        "evidence_status": evidence_status,
        "evidence_scope": "bounded_filing_body_excerpt",
        "source_url": record.get("url"),
    }


def extract_dart_facts(record: dict[str, Any], text: str) -> list[dict[str, Any]]:
    lines = [re.sub(r"\s+", " ", line).strip(" :\t") for line in text.splitlines()]
    lines = [line for line in lines if line]
    facts: list[dict[str, Any]] = []
    seen_fields: set[tuple[str, str]] = set()
    labels = list(DART_LABELS)
    for index, line in enumerate(lines):
        for label, (field, value_kind) in DART_LABELS.items():
            position = line.find(label)
            if position < 0:
                continue
            value = line[position + len(label):].strip(" :：-\t")
            if not value and index + 1 < len(lines):
                candidate = lines[index + 1]
                if not any(
                    candidate == other or candidate.startswith(f"{other}:") or candidate.startswith(f"{other}：")
                    for other in labels
                ):
                    value = candidate
            if not value or len(value) > 240:
                continue
            if value_kind in {"money", "money_per_share", "shares", "date"} and not re.search(r"\d", value):
                continue
            key = (field, value)
            if key in seen_fields:
                continue
            seen_fields.add(key)
            facts.append(fact_row(
                record,
                field,
                value,
                f"{label}: {value}",
                "exact_label_value_excerpt",
            ))
    return facts[:12]


def sec_field_for_context(context: str) -> str:
    lowered = context.casefold()
    if "revenue" in lowered or "net sales" in lowered:
        return "reported_revenue_amount_candidate"
    if "net income" in lowered or "net loss" in lowered:
        return "reported_net_income_amount_candidate"
    if "capital expenditure" in lowered or "capex" in lowered:
        return "reported_capex_amount_candidate"
    if "guidance" in lowered or "outlook" in lowered or "expects" in lowered:
        return "management_outlook_amount_candidate"
    return "reported_amount_candidate"


def extract_sec_facts(record: dict[str, Any], text: str) -> list[dict[str, Any]]:
    facts: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()
    for match in re.finditer(r"\bItem\s+([1-9]\.\d{2})\b", text, flags=re.IGNORECASE):
        value = match.group(1)
        key = ("sec_item", value)
        if key not in seen:
            seen.add(key)
            facts.append(fact_row(
                record,
                "sec_item",
                value,
                compact_context(text, match.start(), match.end(), radius=80),
                "exact_text_excerpt",
            ))

    amount_pattern = re.compile(
        r"\$\s?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?"
        r"(?:\s?(?:million|billion|thousand))?",
        flags=re.IGNORECASE,
    )
    for match in amount_pattern.finditer(text):
        context = compact_context(text, match.start(), match.end(), radius=120)
        field = sec_field_for_context(context)
        key = (field, match.group(0))
        if key in seen:
            continue
        seen.add(key)
        facts.append(fact_row(
            record,
            field,
            match.group(0),
            context,
            "exact_text_amount_candidate",
        ))
    return facts[:12]


def extract_filing_facts(record: dict[str, Any]) -> dict[str, Any]:
    if record.get("evidence_scope") != "filing_body_excerpt":
        return {
            "schema_version": SCHEMA_VERSION,
            "extraction_status": "body_unavailable",
            "facts": [],
            "materiality_status": "not_computable",
        }
    text = str(record.get("raw_text") or "")
    if record.get("source_id") == "opendart":
        facts = extract_dart_facts(record, text)
    elif record.get("source_id") == "sec_edgar":
        facts = extract_sec_facts(record, text)
    else:
        facts = []
    return {
        "schema_version": SCHEMA_VERSION,
        "extraction_status": "fact_candidates_available" if facts else "no_supported_facts",
        "facts": facts,
        "materiality_status": "not_computable",
        "policy_note": (
            "Exact excerpt candidates only. Do not infer omitted terms, materiality, "
            "dilution, or full-period comparability."
        ),
    }
