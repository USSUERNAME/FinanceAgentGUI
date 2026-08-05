"""Render source-linked market-commentary consensus from a private research inbox.

Only text pasted by the user in the private Notion inbox is analyzed.  This
keeps third-party research link-out-only while making the daily brief useful as
an editorial map of the views the user chose to monitor.
"""

from __future__ import annotations

import argparse
import json
import os
from collections import Counter
from datetime import date
from pathlib import Path
from typing import Any
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from collectors.common import load_dotenv
from compose_daily_brief import response_text
from qualitative_inbox import mark_done, selected_items, token_and_source_id


STANCE_LABELS = {
    "positive": "🟢 긍정",
    "neutral": "🟡 중립",
    "caution": "🔴 부정·경계",
}
STANCE_ORDER = ("positive", "neutral", "caution")
SOURCE_POSTURE = {
    "linked_excerpt": "사용자 발췌 · 원문 링크 첨부",
    "unlinked_excerpt": "사용자 발췌 · 원문 링크 미등록",
    "note_only": "사용자 메모 · 원문 발췌 미입력",
}

COMMENTARY_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "required": ["comments", "consensus"],
    "properties": {
        "comments": {
            "type": "array",
            "maxItems": 15,
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": [
                    "item_index", "stance", "speaker", "affiliation", "theme",
                    "summary", "confirmation_or_risk",
                ],
                "properties": {
                    "item_index": {"type": "integer", "minimum": 0},
                    "stance": {"type": "string", "enum": list(STANCE_ORDER)},
                    "speaker": {"type": "string"},
                    "affiliation": {"type": "string"},
                    "theme": {"type": "string"},
                    "summary": {"type": "string"},
                    "confirmation_or_risk": {"type": "string"},
                },
            },
        },
        "consensus": {
            "type": "object",
            "additionalProperties": False,
            "required": ["common_view", "key_confirmation", "key_risk", "coverage_limit"],
            "properties": {
                "common_view": {"type": "string"},
                "key_confirmation": {"type": "string"},
                "key_risk": {"type": "string"},
                "coverage_limit": {"type": "string"},
            },
        },
    },
}


def _compact(value: Any, fallback: str = "자료 없음") -> str:
    text = " ".join(str(value or "").split())
    return text or fallback


def source_posture(item: dict[str, Any]) -> str:
    has_excerpt = bool(_compact(item.get("property_excerpt"), "") or _compact(item.get("page_excerpt"), ""))
    if has_excerpt and str(item.get("url") or "").startswith(("https://", "http://")):
        return "linked_excerpt"
    if has_excerpt:
        return "unlinked_excerpt"
    return "note_only"


def bounded_items(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Keep the model input explicit, short, and free of Notion implementation fields."""
    return [{
        "item_index": index,
        "title": _compact(item.get("title")),
        "publisher": _compact(item.get("source")),
        "themes": item.get("themes") or [],
        "user_note": _compact(item.get("memo"), ""),
        "pasted_excerpt": _compact(
            "\n".join(filter(None, [item.get("property_excerpt"), item.get("page_excerpt")])), ""
        )[:12000],
        "source_posture": source_posture(item),
    } for index, item in enumerate(items)]


def validate_commentary(payload: dict[str, Any], item_count: int) -> None:
    comments = payload.get("comments")
    if not isinstance(comments, list) or not comments:
        raise ValueError("Market-commentary output contains no attributable comments")
    if len(comments) > 15:
        raise ValueError("Market-commentary output exceeds the display limit")
    for comment in comments:
        if comment.get("stance") not in STANCE_LABELS:
            raise ValueError("Market-commentary output has an invalid stance")
        index = comment.get("item_index")
        if not isinstance(index, int) or not 0 <= index < item_count:
            raise ValueError("Market-commentary output references an unknown inbox item")
        if not _compact(comment.get("summary"), ""):
            raise ValueError("Market-commentary output has an empty summary")


def analyze_commentary(items: list[dict[str, Any]]) -> dict[str, Any]:
    api_key = os.getenv("OPENAI_API_KEY", "").strip()
    if not api_key:
        raise SystemExit("Set OPENAI_API_KEY before analysing selected qualitative research.")
    model = os.getenv("OPENAI_ITEM_MODEL", "gpt-5-mini").strip()
    instructions = """Extract a compact Korean market-commentary map from the supplied private inbox items.
Use only each item's title, publisher, themes, user note, and text the user personally pasted. Do not fetch publisher pages, reconstruct missing passages, create facts, create analyst names, create affiliations, or quote text verbatim.

Create one to three comments per supplied item only where that item actually contains a market view. Classify each view as positive, neutral, or caution according to its stated market implication; this is an editorial grouping, not a forecast. Set speaker to the explicitly named person only. If no person appears in the supplied text, set speaker to `발언자 미식별`; likewise set affiliation to `소속 미식별` when absent. Keep the summary to one bounded paraphrase and write the stated confirmation condition or risk; do not add an investment action.

The final consensus must aggregate only your returned comments. It must say what these selected items commonly emphasize, what would support that view, the principal risk they name, and that this is a selected, source-linked (where available) opinion sample rather than verified market fact or a representative survey. Write concise Korean strings."""
    body = json.dumps({
        "model": model,
        "instructions": instructions,
        "input": json.dumps(bounded_items(items), ensure_ascii=False, indent=2),
        "reasoning": {"effort": "minimal"},
        "text": {"format": {
            "type": "json_schema",
            "name": "market_commentary_consensus",
            "description": "Source-bounded Korean market-commentary aggregation.",
            "strict": True,
            "schema": COMMENTARY_SCHEMA,
        }},
        "max_output_tokens": 2200,
        "store": False,
    }, ensure_ascii=False).encode("utf-8")
    request = Request("https://api.openai.com/v1/responses", method="POST", data=body, headers={
        "Authorization": f"Bearer {api_key}", "Content-Type": "application/json",
    })
    try:
        with urlopen(request, timeout=90) as response:
            response_payload = json.loads(response.read().decode("utf-8"))
    except HTTPError as exc:
        raise SystemExit(f"OpenAI returned HTTP {exc.code} while analysing market commentary.") from exc
    if response_payload.get("status") == "incomplete":
        reason = (response_payload.get("incomplete_details") or {}).get("reason", "unknown")
        raise SystemExit(f"Market-commentary analysis was incomplete ({reason}).")
    text = response_text(response_payload)
    if not text:
        raise SystemExit("OpenAI returned no market-commentary analysis.")
    payload = json.loads(text)
    validate_commentary(payload, len(items))
    return payload


def _source_line(item: dict[str, Any]) -> str:
    publisher = _compact(item.get("source"), "출처 미식별")
    posture = SOURCE_POSTURE[source_posture(item)]
    url = str(item.get("url") or "").strip()
    if url.startswith(("https://", "http://")):
        return f"[원문 링크 · {publisher}]({url}) · {posture}"
    return f"원문 링크 미등록 · {publisher} · {posture}"


def render_section(items: list[dict[str, Any]], payload: dict[str, Any], report_date: str | None = None) -> str:
    """Render deterministic counts, source links, and evidence labels around model paraphrases."""
    validate_commentary(payload, len(items))
    today = date.today()
    display_date = report_date or f"{today.month}월 {today.day}일"
    grouped = {stance: [] for stance in STANCE_ORDER}
    for comment in payload["comments"]:
        grouped[comment["stance"]].append(comment)
    counts = Counter(comment["stance"] for comment in payload["comments"])
    lines = [
        f"## 주요 시장 코멘트 ({display_date})",
        "",
        "> 자료 상태: 선택된 내부 Inbox의 사용자 발췌·메모를 정리한 의견 모음입니다. "
        "링크가 있는 항목만 원문으로 되짚을 수 있으며, 개별 의견은 검증된 사실·시장 컨센서스 조사·투자 권고가 아닙니다.",
    ]
    for stance in STANCE_ORDER:
        lines.extend(["", f"### {STANCE_LABELS[stance]}"])
        comments = grouped[stance]
        if not comments:
            lines.append("- 해당 분류의 선택 의견 없음")
            continue
        for comment in comments:
            item = items[comment["item_index"]]
            speaker = _compact(comment.get("speaker"), "발언자 미식별")
            affiliation = _compact(comment.get("affiliation"), "소속 미식별")
            theme = _compact(comment.get("theme"), "시장 논지")
            lines.extend([
                f"- **{speaker} · {affiliation}** — {theme}",
                f"  - 논지: {_compact(comment.get('summary'))}",
                f"  - 확인·경계 조건: {_compact(comment.get('confirmation_or_risk'))}",
                f"  - {_source_line(item)}",
            ])
    consensus = payload["consensus"]
    lines.extend([
        "",
        "### 📌 시장 컨센서스",
        f"- 🟢 긍정 {counts['positive']}건 · 🟡 중립 {counts['neutral']}건 · 🔴 부정·경계 {counts['caution']}건",
        f"- 공통 논지: {_compact(consensus.get('common_view'))}",
        f"- 확인 포인트: {_compact(consensus.get('key_confirmation'))}",
        f"- 핵심 경계: {_compact(consensus.get('key_risk'))}",
        f"- 해석 한계: {_compact(consensus.get('coverage_limit'))}",
    ])
    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser(description="Append source-linked market-commentary consensus to one daily brief.")
    parser.add_argument("brief_markdown")
    parser.add_argument("--date", help="Display date, for example '7월 21일'.")
    args = parser.parse_args()
    load_dotenv()
    try:
        token, data_source_id = token_and_source_id()
    except SystemExit as exc:
        print(f"Market-commentary analysis skipped: {exc}")
        return
    selected = selected_items(token, data_source_id)
    if not selected:
        print("Market-commentary analysis skipped: no Inbox items are marked '분석할 글'.")
        return
    items = [item for item in selected if any((
        str(item["memo"] or "").strip(), str(item["property_excerpt"] or "").strip(), str(item["page_excerpt"] or "").strip(),
    ))]
    if not items:
        print("Market-commentary analysis skipped: selected Inbox items need a pasted excerpt or a short memo first.")
        return
    section = render_section(items, analyze_commentary(items), args.date)
    path = Path(args.brief_markdown)
    markdown = path.read_text(encoding="utf-8")
    marker = "## 종목 및 공시"
    if marker not in markdown:
        raise SystemExit("Could not find the filing section in the daily brief.")
    path.write_text(markdown.replace(marker, section + "\n\n" + marker, 1), encoding="utf-8")
    for item in items:
        mark_done(token, item["page_id"])
    print(f"Market-commentary consensus added for {len(items)} selected item(s).")


if __name__ == "__main__":
    main()
