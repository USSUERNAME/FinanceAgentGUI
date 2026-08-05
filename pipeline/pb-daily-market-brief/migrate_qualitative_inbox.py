"""Add the user-provided article-excerpt field to an existing Notion inbox."""

from __future__ import annotations

from qualitative_inbox import api_json, token_and_source_id


def main() -> None:
    token, data_source_id = token_and_source_id()
    schema = api_json(f"https://api.notion.com/v1/data_sources/{data_source_id}", "GET", token)
    properties = schema.get("properties", {})
    if "원문 발췌" in properties:
        print("Qualitative inbox already has the '원문 발췌' field.")
        return
    api_json(
        f"https://api.notion.com/v1/data_sources/{data_source_id}",
        "PATCH",
        token,
        {"properties": {"원문 발췌": {"rich_text": {}}}},
    )
    print("Added the '원문 발췌' field to the qualitative inbox.")


if __name__ == "__main__":
    main()
