"""Collect recent high-signal Korean disclosures from the official OpenDART API."""

from __future__ import annotations

import os
import time
from datetime import datetime, timedelta
from typing import Any
from urllib.parse import urlencode
from zoneinfo import ZoneInfo

from collectors.common import get_json, make_item
from collectors.filing_body import fetch_dart_document
from collectors.filing_facts import extract_filing_facts


DART_LIST_URL = "https://opendart.fss.or.kr/api/list.json"
DART_VIEWER_URL = "https://dart.fss.or.kr/dsaf001/main.do"
TYPE_LABELS = {
    "A": "정기공시",
    "B": "주요사항보고",
    "C": "발행공시",
    "D": "지분공시",
    "I": "거래소공시",
}
TYPE_PRIORITY = {"B": 50, "I": 40, "C": 30, "A": 20, "D": 10}
HIGH_SIGNAL_KEYWORDS = (
    "주요사항보고", "유상증자", "무상증자", "전환사채", "신주인수권부사채",
    "교환사채", "합병", "분할", "영업양수", "영업양도", "타법인주식",
    "자기주식", "최대주주", "공급계약", "단일판매", "소송", "횡령", "배임",
    "부도", "회생", "상장폐지", "거래정지", "실적", "잠정", "배당",
)


def _score(row: dict[str, Any], disclosure_type: str) -> int:
    report_name = str(row.get("report_nm", ""))
    signal_score = sum(8 for keyword in HIGH_SIGNAL_KEYWORDS if keyword in report_name)
    listed_bonus = 5 if row.get("corp_cls") in {"Y", "K", "N"} else 0
    return TYPE_PRIORITY.get(disclosure_type, 0) + signal_score + listed_bonus


def collect(config: dict[str, Any]) -> tuple[list[dict[str, Any]], str | None]:
    api_key = os.getenv("OPENDART_API_KEY", "").strip()
    if not api_key:
        return [], "OPENDART_API_KEY not set"

    settings = config.get("opendart", {})
    max_items = max(1, min(int(settings.get("max_items", 8)), 20))
    fetch_bodies = bool(settings.get("fetch_bodies", False))
    max_body_fetches = max(0, min(int(settings.get("max_body_fetches", 3)), max_items))
    max_body_chars = max(1000, min(int(settings.get("max_body_chars", 6000)), 12000))
    body_request_delay = max(0.0, float(settings.get("body_request_delay_seconds", 0.2)))
    lookback_days = max(1, min(int(os.getenv(
        "OPENDART_LOOKBACK_DAYS", str(settings.get("lookback_days", 3))
    )), 30))
    disclosure_types = [
        value for value in settings.get("disclosure_types", ["B", "I", "C", "A"])
        if value in TYPE_LABELS
    ]
    if not disclosure_types:
        return [], "No valid OpenDART disclosure types are configured"

    timezone = ZoneInfo(os.getenv("BRIEF_TIMEZONE", "Asia/Seoul"))
    end_date = datetime.now(timezone).date()
    start_date = end_date - timedelta(days=lookback_days - 1)
    candidates: dict[str, tuple[int, str, dict[str, Any]]] = {}

    for disclosure_type in disclosure_types:
        query = urlencode({
            "crtfc_key": api_key,
            "bgn_de": start_date.strftime("%Y%m%d"),
            "end_de": end_date.strftime("%Y%m%d"),
            "last_reprt_at": "Y",
            "pblntf_ty": disclosure_type,
            "sort": "date",
            "sort_mth": "desc",
            "page_count": "100",
        })
        payload = get_json(f"{DART_LIST_URL}?{query}")
        status = str(payload.get("status", ""))
        if status == "013":  # No data for this disclosure type and period.
            continue
        if status != "000":
            return [], f"OpenDART returned status {status or 'unknown'}"
        for row in payload.get("list", []):
            receipt_no = str(row.get("rcept_no", "")).strip()
            if not receipt_no:
                continue
            score = _score(row, disclosure_type)
            filed = str(row.get("rcept_dt", ""))
            existing = candidates.get(receipt_no)
            if existing is None or score > existing[0]:
                candidates[receipt_no] = (score, filed, {**row, "disclosure_type": disclosure_type})

    selected = sorted(candidates.values(), key=lambda value: (value[0], value[1]), reverse=True)[:max_items]
    items: list[dict[str, Any]] = []
    for item_index, (_, filed, row) in enumerate(selected):
        receipt_no = str(row["rcept_no"])
        disclosure_type = str(row["disclosure_type"])
        company = str(row.get("corp_name", "회사명 미상"))
        report_name = str(row.get("report_nm", "공시명 미상"))
        stock_code = str(row.get("stock_code", "")).strip()
        source_url = f"{DART_VIEWER_URL}?rcpNo={receipt_no}"
        body = (
            fetch_dart_document(receipt_no, api_key, max_chars=max_body_chars)
            if fetch_bodies and item_index < max_body_fetches
            else {"status": "body_fetch_not_selected", "text": None}
        )
        body_text = str(body.get("text") or "").strip()
        raw_text = (
            f"OpenDART 공시 본문 발췌. 접수일: {filed or '미상'}. "
            f"법인명: {company}. 공시명: {report_name}. 접수번호: {receipt_no}.\n\n"
            f"{body_text}"
            if body_text else
            (
                f"OpenDART 공시 메타데이터. 접수일: {filed or '미상'}. "
                f"법인명: {company}. 공시명: {report_name}. "
                f"제출인: {row.get('flr_nm') or '미상'}. 접수번호: {receipt_no}. "
                "공시 본문을 확인하기 전에는 공시명 이상의 사실을 추정하지 말 것."
            )
        )
        item = make_item(
            source_id="opendart",
            source_type="korean_filing",
            published_at=(
                f"{filed[:4]}-{filed[4:6]}-{filed[6:8]}T00:00:00+09:00"
                if len(filed) == 8 else ""
            ),
            title=f"OpenDART | {company} | {report_name}",
            url=source_url,
            tickers=[stock_code] if stock_code else [],
            tags=["opendart", "국내공시", TYPE_LABELS[disclosure_type]],
            raw_text=raw_text,
            rights_label=(
                "금융감독원 OpenDART 공개 공시 원문 발췌; 원문 링크와 발췌 범위를 유지할 것."
                if body_text else
                "금융감독원 OpenDART 공개 공시 메타데이터; 원문 링크를 유지하고 본문을 1차 자료로 확인할 것."
            ),
            observation_date=(f"{filed[:4]}-{filed[4:6]}-{filed[6:8]}" if len(filed) == 8 else None),
            release_date=(f"{filed[:4]}-{filed[4:6]}-{filed[6:8]}" if len(filed) == 8 else None),
            market_cutoff="filing_acceptance_date",
            source_grade="A",
            primary_source_confirmed=True,
            evidence_scope="filing_body_excerpt" if body_text else "filing_metadata_only",
            evidence_label="verified_primary_body_excerpt" if body_text else "fact_source_reported",
            freshness_state="current_filing_body" if body_text else "current_filing_metadata",
            publisher="금융감독원 OpenDART",
            source_url_kind="primary_source",
            link_required=True,
        )
        item["filing_receipt_no"] = receipt_no
        item["filing_body"] = {
            key: value for key, value in body.items() if key != "text"
        }
        item["filing_facts"] = extract_filing_facts(item)
        items.append(item)
        if fetch_bodies and item_index < max_body_fetches and body_request_delay:
            time.sleep(body_request_delay)
    return items, None
