"""Extract filing-backed reportable segment and product-line facts from SEC inline XBRL."""

from __future__ import annotations

import html as html_module
import json
import re
from datetime import date
from typing import Any, Callable
from urllib.request import Request, urlopen


SEGMENT_AXES = {
    "statementbusinesssegmentsaxis": "reportable_segment",
    "productorserviceaxis": "product_or_service",
}
REVENUE_CONCEPTS = {
    "revenuefromcontractwithcustomerexcludingassessedtax",
    "salesrevenuenet",
    "revenues",
}
OPERATING_INCOME_CONCEPTS = {"operatingincomeloss"}
CONTEXT_RE = re.compile(
    r"<xbrli:context\b[^>]*\bid=[\"']([^\"']+)[\"'][^>]*>(.*?)</xbrli:context>",
    re.IGNORECASE | re.DOTALL,
)
FACT_RE = re.compile(r"<ix:nonfraction\b([^>]*)>(.*?)</ix:nonfraction>", re.IGNORECASE | re.DOTALL)
MEMBER_RE = re.compile(
    r"<xbrldi:explicitmember\b([^>]*)>(.*?)</xbrldi:explicitmember>",
    re.IGNORECASE | re.DOTALL,
)


def _attribute(source: str, name: str) -> str:
    match = re.search(rf"\b{re.escape(name)}=[\"']([^\"']*)[\"']", source, re.IGNORECASE)
    return html_module.unescape(match.group(1)).strip() if match else ""


def _tag_text(source: str, tag: str) -> str:
    match = re.search(rf"<{re.escape(tag)}\b[^>]*>(.*?)</{re.escape(tag)}>", source, re.IGNORECASE | re.DOTALL)
    return re.sub(r"<[^>]+>", "", html_module.unescape(match.group(1))).strip() if match else ""


def _local_name(value: str) -> str:
    return value.split(":", 1)[-1]


def _previous_year(value: str) -> str:
    parsed = date.fromisoformat(value)
    try:
        return parsed.replace(year=parsed.year - 1).isoformat()
    except ValueError:
        return parsed.replace(year=parsed.year - 1, day=28).isoformat()


def _humanize_member(value: str) -> str:
    local = re.sub(r"Member$", "", _local_name(value))
    if local.lower() == "reportablesegment":
        return "단일 보고부문"
    spaced = re.sub(r"(?<=[a-z0-9])(?=[A-Z])", " ", local).replace("_", " ")
    return " ".join(spaced.split()) or value


def _number(text: str, attrs: str) -> float | None:
    if _attribute(attrs, "nil").lower() == "true":
        return None
    cleaned = re.sub(r"<[^>]+>", "", html_module.unescape(text)).strip()
    if not cleaned or cleaned in {"—", "–", "-"}:
        return None
    negative = cleaned.startswith("(") and cleaned.endswith(")")
    cleaned = cleaned.strip("()").replace(",", "").replace("$", "").replace("%", "").strip()
    try:
        value = float(cleaned)
        scale = int(_attribute(attrs, "scale") or "0")
    except (TypeError, ValueError):
        return None
    if _attribute(attrs, "sign") == "-" or negative:
        value = -abs(value)
    return value * (10 ** scale)


def _fetch_json(url: str, user_agent: str) -> dict[str, Any]:
    request = Request(url, headers={"User-Agent": user_agent, "Accept": "application/json"})
    with urlopen(request, timeout=30) as response:
        return json.loads(response.read().decode("utf-8"))


def _fetch_text(url: str, user_agent: str) -> str:
    request = Request(url, headers={"User-Agent": user_agent, "Accept": "text/html"})
    with urlopen(request, timeout=30) as response:
        return response.read().decode("utf-8", errors="ignore")


def primary_document_url(
    cik: str,
    accession: str,
    user_agent: str,
    json_fetcher: Callable[[str, str], dict[str, Any]] = _fetch_json,
) -> str:
    submissions = json_fetcher(f"https://data.sec.gov/submissions/CIK{cik.zfill(10)}.json", user_agent)
    recent = (submissions.get("filings") or {}).get("recent") or {}
    accessions = recent.get("accessionNumber") or []
    if accession not in accessions:
        raise ValueError(f"SEC submissions does not contain accession {accession}")
    index = accessions.index(accession)
    document = str((recent.get("primaryDocument") or [])[index])
    if not document or "/" in document or "\\" in document:
        raise ValueError("SEC primary document name is invalid")
    return (
        f"https://www.sec.gov/Archives/edgar/data/{int(cik)}/"
        f"{accession.replace('-', '')}/{document}"
    )


def parse_segment_facts(
    source: str,
    *,
    ticker: str,
    accession: str,
    source_url: str,
    target_period_start: str,
    target_period_end: str,
) -> dict[str, Any]:
    prior_start = _previous_year(target_period_start)
    prior_end = _previous_year(target_period_end)
    contexts: dict[str, dict[str, Any]] = {}
    for context_match in CONTEXT_RE.finditer(source):
        context_id, body = context_match.groups()
        members = []
        for member_match in MEMBER_RE.finditer(body):
            attrs, member_body = member_match.groups()
            dimension = _attribute(attrs, "dimension")
            axis_type = SEGMENT_AXES.get(_local_name(dimension).lower())
            if not axis_type:
                continue
            member = re.sub(r"<[^>]+>", "", html_module.unescape(member_body)).strip()
            if member:
                members.append({"axis": dimension, "axis_type": axis_type, "member": member})
        if not members:
            continue
        contexts[context_id] = {
            "period_start": _tag_text(body, "xbrli:startdate"),
            "period_end": _tag_text(body, "xbrli:enddate") or _tag_text(body, "xbrli:instant"),
            "members": members,
        }

    observations: dict[tuple[str, str, str], dict[str, Any]] = {}
    for fact_match in FACT_RE.finditer(source):
        attrs, fact_body = fact_match.groups()
        context_id = _attribute(attrs, "contextref")
        context = contexts.get(context_id)
        if not context:
            continue
        concept = _attribute(attrs, "name")
        local_concept = _local_name(concept).lower()
        if local_concept in REVENUE_CONCEPTS:
            metric_id = "revenue"
        elif local_concept in OPERATING_INCOME_CONCEPTS:
            metric_id = "operating_income"
        else:
            continue
        value = _number(fact_body, attrs)
        if value is None:
            continue
        period_key = ""
        if context["period_start"] == target_period_start and context["period_end"] == target_period_end:
            period_key = "current"
        elif context["period_start"] == prior_start and context["period_end"] == prior_end:
            period_key = "prior"
        if not period_key:
            continue
        for member in context["members"]:
            key = (member["axis_type"], member["member"], metric_id)
            observation = observations.setdefault(key, {
                "segment_id": member["member"],
                "segment_label": _humanize_member(member["member"]),
                "axis": member["axis"],
                "breakdown_type": member["axis_type"],
                "metric_id": metric_id,
                "unit": "USD" if _attribute(attrs, "unitref").lower().startswith("usd") else _attribute(attrs, "unitref"),
                "current_value": None,
                "prior_value": None,
                "current_period_start": target_period_start,
                "current_period_end": target_period_end,
                "prior_period_start": prior_start,
                "prior_period_end": prior_end,
                "source_url": source_url,
                "body_location": f"Inline XBRL context {context_id}; {member['axis']}={member['member']}",
                "evidence_label": "fact_source_reported_dimensioned",
            })
            observation[f"{period_key}_value"] = value

    rows = []
    for observation in observations.values():
        if observation["current_value"] is None:
            continue
        prior_value = observation.get("prior_value")
        change_pct = None
        if isinstance(prior_value, (int, float)) and prior_value > 0:
            change_pct = round((observation["current_value"] / prior_value - 1) * 100, 4)
        rows.append({**observation, "change_pct": change_pct})
    rows.sort(key=lambda row: (
        0 if row["breakdown_type"] == "reportable_segment" else 1,
        row["segment_label"],
        0 if row["metric_id"] == "revenue" else 1,
    ))
    reportable_members = {
        row["segment_id"] for row in rows if row["breakdown_type"] == "reportable_segment"
    }
    if rows:
        status = "single_reportable_segment" if len(reportable_members) == 1 else "available"
    else:
        status = "not_disclosed_for_exact_period"
    return {
        "status": status,
        "accession_number": accession,
        "source_url": source_url,
        "current_period_start": target_period_start,
        "current_period_end": target_period_end,
        "prior_period_start": prior_start,
        "prior_period_end": prior_end,
        "rows": rows[:24],
        "row_count": min(len(rows), 24),
        "policy": {
            "exact_period_required": True,
            "accepted_axes": sorted(SEGMENT_AXES),
            "reported_facts_only": True,
            "company_extension_member_names_not_translated_by_inference": True,
        },
    }


def collect_company_segments_from_sec(
    company: dict[str, Any],
    user_agent: str,
    *,
    json_fetcher: Callable[[str, str], dict[str, Any]] = _fetch_json,
    text_fetcher: Callable[[str, str], str] = _fetch_text,
) -> dict[str, Any]:
    metrics = [
        row for row in company.get("reported_metrics") or []
        if row.get("metric_id") == "revenue" and row.get("accession_number")
    ]
    if not metrics:
        return {"status": "missing_current_revenue_period", "rows": [], "row_count": 0}
    metric = max(metrics, key=lambda row: str(row.get("filed_date") or ""))
    source_url = primary_document_url(
        str(company.get("cik") or ""), str(metric["accession_number"]), user_agent, json_fetcher,
    )
    source = text_fetcher(source_url, user_agent)
    return parse_segment_facts(
        source,
        ticker=str(company.get("ticker") or ""),
        accession=str(metric["accession_number"]),
        source_url=source_url,
        target_period_start=str(metric.get("period_start") or ""),
        target_period_end=str(metric.get("period_end") or ""),
    )
