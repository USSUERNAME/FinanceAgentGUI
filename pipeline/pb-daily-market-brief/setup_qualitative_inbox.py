"""Create the private Notion inbox once and print its data-source ID."""

from __future__ import annotations

import os

from collectors.common import load_dotenv
from qualitative_inbox import api_json, rich_text


def main() -> None:
    load_dotenv()
    token = os.getenv("NOTION_TOKEN", "").strip()
    parent = os.getenv("NOTION_PARENT_PAGE_ID", "").strip()
    if not token or not parent:
        raise SystemExit("Set NOTION_TOKEN and NOTION_PARENT_PAGE_ID first.")
    response = api_json("https://api.notion.com/v1/databases", "POST", token, {
        "parent": {"type": "page_id", "page_id": parent},
        "title": rich_text("정성 리서치 Inbox"),
        "description": rich_text("화이트리스트에서 찾은 링크 후보를 검토하고, 선택된 글만 메모 기반으로 분석합니다."),
        "is_inline": True,
        "initial_data_source": {
            "properties": {
                "제목": {"title": {}},
                "원문 링크": {"url": {}},
                "출처": {"select": {"options": [{"name": value} for value in ["SemiAnalysis", "Stratechery", "The Diff", "더밀크"]]}},
                "발행일": {"date": {}},
                "테마": {"multi_select": {"options": [{"name": value} for value in ["AI 인프라", "반도체", "공급망", "빅테크", "플랫폼 전략", "기술", "금융", "장기 테마", "미국 기술", "투자", "실리콘밸리"]]}},
                "상태": {"select": {"options": [{"name": value} for value in ["후보", "분석할 글", "보류", "완료"]]}},
                "후보 이유": {"rich_text": {}},
                "내 메모": {"rich_text": {}},
                "원문 발췌": {"rich_text": {}},
                "권리 처리": {"select": {"options": [{"name": value} for value in ["링크 전용", "내 메모 기반"]]}},
            },
        },
    })
    sources = response.get("data_sources") or []
    data_source_id = (sources[0].get("id") if sources else response.get("initial_data_source", {}).get("id"))
    if not data_source_id:
        raise SystemExit("Notion created the database but did not return a data-source ID.")
    print(f"INBOX_URL={response.get('url', '')}")
    print(f"QUALITATIVE_INBOX_DATA_SOURCE_ID={data_source_id}")


if __name__ == "__main__":
    main()
