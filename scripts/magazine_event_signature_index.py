#!/usr/bin/env python3
from __future__ import annotations

import argparse
import contextlib
import hashlib
import json
import math
import os
import sqlite3
import sys
from array import array
from pathlib import Path
from typing import Any


DEFAULT_ENGINE = "sentence-transformers"
DEFAULT_MODEL = "ibm-granite/granite-embedding-97m-multilingual-r2"
DEFAULT_BATCH_SIZE = 16
DEFAULT_WARN_THRESHOLD = 0.9
DEFAULT_ERROR_THRESHOLD = 0.97
SCHEMA_VERSION = 1
PROJECT_ROOT = Path(__file__).resolve().parents[1]


def normalize_space(value: Any) -> str:
    return " ".join(str(value or "").split())


def resolve_project_path(value: str) -> Path:
    path = Path(value)
    return path if path.is_absolute() else PROJECT_ROOT / path


def display_project_path(path: Path) -> str:
    try:
        return str(path.resolve().relative_to(PROJECT_ROOT))
    except ValueError:
        return str(path)


def truncate_text(value: Any, limit: int = 220) -> str:
    text = normalize_space(value)
    return text if len(text) <= limit else text[: limit - 1] + "…"


def text_hash(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def vector_to_blob(vector: list[float]) -> bytes:
    return array("f", [float(value) for value in vector]).tobytes()


def blob_to_vector(raw: bytes | memoryview) -> list[float]:
    values = array("f")
    values.frombytes(bytes(raw))
    return [float(value) for value in values]


def cosine_similarity(left: list[float], right: list[float]) -> float:
    if not left or not right or len(left) != len(right):
        return 0.0
    dot = sum(a * b for a, b in zip(left, right))
    left_norm = math.sqrt(sum(a * a for a in left))
    right_norm = math.sqrt(sum(b * b for b in right))
    if left_norm <= 0.0 or right_norm <= 0.0:
        return 0.0
    return dot / (left_norm * right_norm)


class SentenceTransformerEmbedder:
    def __init__(self, *, model: str, batch_size: int, device: str = "", quiet_load: bool = True) -> None:
        try:
            from sentence_transformers import SentenceTransformer  # type: ignore
        except Exception as exc:
            raise RuntimeError(
                "sentence-transformers is required for magazine event-signature embeddings. "
                "Install project requirements first: `pip install -r requirements.txt`."
            ) from exc

        kwargs: dict[str, Any] = {}
        if device.strip():
            kwargs["device"] = device.strip()
        if quiet_load:
            with open(os.devnull, "w", encoding="utf-8") as sink:
                with contextlib.redirect_stdout(sink), contextlib.redirect_stderr(sink):
                    self.model = SentenceTransformer(model, **kwargs)
        else:
            self.model = SentenceTransformer(model, **kwargs)
        self.batch_size = max(1, int(batch_size))

    def encode(self, texts: list[str]) -> list[list[float]]:
        if not texts:
            return []
        vectors = self.model.encode(
            texts,
            batch_size=self.batch_size,
            normalize_embeddings=True,
            show_progress_bar=False,
        )
        return [list(map(float, row)) for row in vectors]


def article_dirs(path: Path) -> list[Path]:
    if not path.exists():
        return []
    return sorted([item for item in path.iterdir() if item.is_dir()], key=lambda item: item.name)


def read_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
        return value if isinstance(value, dict) else {}
    except Exception:
        return {}


def list_values(value: Any) -> list[str]:
    if isinstance(value, list):
        values = value
    elif value:
        values = [value]
    else:
        values = []
    return sorted({normalize_space(item).lower() for item in values if normalize_space(item)})


def event_signature_list(metadata: dict[str, Any]) -> list[dict[str, Any]]:
    explicit_list = metadata.get("eventSignatures")
    if isinstance(explicit_list, list):
        signatures = [item for item in explicit_list if isinstance(item, dict)]
    else:
        single = metadata.get("eventSignature")
        signatures = [single] if isinstance(single, dict) else []
    return signatures


def primary_event_signature(metadata: dict[str, Any]) -> dict[str, Any]:
    signatures = event_signature_list(metadata)
    for signature in signatures:
        if normalize_space(signature.get("role")).lower() == "primary":
            return signature
    return signatures[0] if signatures else {}


def news_feed_items(metadata: dict[str, Any]) -> list[dict[str, Any]]:
    news_feed = metadata.get("newsFeed")
    news_feed = news_feed if isinstance(news_feed, dict) else {}
    items = news_feed.get("items", [])
    return [item for item in items if isinstance(item, dict)] if isinstance(items, list) else []


def news_feed_ids(metadata: dict[str, Any]) -> list[str]:
    return list_values([item.get("id") or item.get("sourceFingerprint") for item in news_feed_items(metadata)])


def source_titles(metadata: dict[str, Any]) -> list[str]:
    titles = []
    for item in news_feed_items(metadata):
        title = item.get("translatedTitle") or item.get("title") or item.get("translatedText") or item.get("originalText")
        if title:
            titles.append(title)
    return titles


def item_timestamp(item: dict[str, Any]) -> str:
    for field in ("publishedAt", "fetchedAt", "translatedAt"):
        value = normalize_space(item.get(field))
        if value:
            return value
    return ""


def primary_time(metadata: dict[str, Any]) -> str:
    timestamps = [item_timestamp(item) for item in news_feed_items(metadata)]
    timestamps = sorted(item for item in timestamps if item)
    if timestamps:
        return timestamps[0]
    for field in ("publishedAt", "uploadedAt", "generatedAt", "createdAt", "updatedAt"):
        value = normalize_space(metadata.get(field))
        if value:
            return value
    return ""


def split_actor_action(title: str, fallback_title: str) -> tuple[str, str]:
    text = normalize_space(title or fallback_title)
    for marker in (":", "："):
        if marker in text:
            left, right = text.split(marker, 1)
            actor = truncate_text(left, 100)
            action = truncate_text(right, 220)
            if actor and action:
                return actor, action
    return "", truncate_text(text, 220)


def build_event_signature(metadata: dict[str, Any]) -> dict[str, Any]:
    existing = primary_event_signature(metadata)
    if existing:
        signature = dict(existing)
        signature.setdefault("role", "primary")
        return signature

    titles = source_titles(metadata)
    first_title = titles[0] if titles else normalize_space(metadata.get("title"))
    actor, action = split_actor_action(first_title, normalize_space(metadata.get("title")))
    source_ids = news_feed_ids(metadata)
    objects = [truncate_text(item, 180) for item in titles[:4]]
    if not objects:
        for value in (metadata.get("summary"), metadata.get("noveltyNote"), metadata.get("storyFamily")):
            text = truncate_text(value, 180)
            if text:
                objects.append(text)
            if len(objects) >= 3:
                break

    return {
        "role": "primary",
        "actor": actor or truncate_text(metadata.get("storyFamily") or metadata.get("title"), 100),
        "action": action or truncate_text(metadata.get("title"), 220),
        "object": objects,
        "time": primary_time(metadata),
        "marketMechanism": truncate_text(metadata.get("storyFamily") or metadata.get("editorialAngle"), 160),
        "sourceIds": source_ids,
        "generatedBy": "magazine_event_signature_index.py backfill-scaffold-v1",
    }


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def event_signature_text(metadata: dict[str, Any]) -> str:
    signature = primary_event_signature(metadata)

    source_ids = list_values(signature.get("sourceIds") or signature.get("source_ids") or news_feed_ids(metadata))
    objects = list_values(signature.get("object") or signature.get("objects"))
    source_title_values = source_titles(metadata)

    parts = [
        ("actor", signature.get("actor")),
        ("action", signature.get("action")),
        ("object", ", ".join(objects)),
        ("time", signature.get("time") or signature.get("occurredAt") or signature.get("publishedAt")),
        ("market_mechanism", signature.get("marketMechanism") or signature.get("market_mechanism")),
        ("source_ids", ", ".join(source_ids)),
        ("source_titles", " | ".join(source_title_values)),
        ("story_family", metadata.get("storyFamily") or metadata.get("storyKey")),
        ("editorial_angle", metadata.get("editorialAngle")),
        ("novelty_note", metadata.get("noveltyNote")),
        ("title", metadata.get("title")),
        ("summary", metadata.get("summary")),
    ]
    lines = [f"{label}: {normalize_space(value)}" for label, value in parts if normalize_space(value)]
    return "\n".join(lines)


def article_record(article_dir: Path, *, source: str) -> dict[str, Any] | None:
    metadata = read_json(article_dir / "metadata.json")
    if not metadata:
        return None
    text = event_signature_text(metadata)
    if not text:
        return None
    return {
        "articleId": article_dir.name,
        "source": source,
        "title": normalize_space(metadata.get("title") or article_dir.name),
        "storyFamily": normalize_space(metadata.get("storyFamily") or metadata.get("storyKey")),
        "editorialAngle": normalize_space(metadata.get("editorialAngle")),
        "newsFeedIds": news_feed_ids(metadata),
        "signatureText": text,
        "signatureHash": text_hash(text),
    }


def load_records(articles_dir: Path, *, source: str, limit: int = 0) -> list[dict[str, Any]]:
    records = [record for item in article_dirs(articles_dir) if (record := article_record(item, source=source))]
    if source == "baseline":
        records = list(reversed(records))
        if limit > 0:
            records = records[:limit]
    return records


def run_backfill(args: argparse.Namespace) -> int:
    articles_dir = resolve_project_path(args.articles_dir)
    updated: list[str] = []
    skipped: list[str] = []
    for article_dir in article_dirs(articles_dir):
        metadata_path = article_dir / "metadata.json"
        metadata = read_json(metadata_path)
        if not metadata:
            continue
        has_card = bool(primary_event_signature(metadata))
        if has_card and not args.overwrite:
            skipped.append(article_dir.name)
            continue
        metadata["eventSignature"] = build_event_signature(metadata)
        if isinstance(metadata.get("eventSignatures"), list):
            metadata.pop("eventSignatures", None)
        write_json(metadata_path, metadata)
        updated.append(article_dir.name)

    payload = {
        "ok": True,
        "articlesDir": str(articles_dir),
        "updatedCount": len(updated),
        "skippedCount": len(skipped),
        "updated": updated,
        "skipped": skipped,
    }
    if args.json:
        print(json.dumps(payload, ensure_ascii=False, indent=2))
    else:
        print(f"Magazine event-signature backfill: updated={len(updated)} skipped={len(skipped)}")
    return 0


def connect_index(path: Path) -> sqlite3.Connection:
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path)
    current_schema_version = int(conn.execute("PRAGMA user_version").fetchone()[0])
    if current_schema_version > SCHEMA_VERSION:
        conn.close()
        raise RuntimeError(
            f"Magazine index schema version {current_schema_version} is newer than supported version {SCHEMA_VERSION}"
        )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS magazine_event_signature_embeddings (
            article_id TEXT PRIMARY KEY,
            embedding_engine TEXT NOT NULL,
            embedding_model TEXT NOT NULL,
            signature_hash TEXT NOT NULL,
            embedding_dims INTEGER NOT NULL,
            embedding_blob BLOB NOT NULL,
            signature_text TEXT NOT NULL,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
        """
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_magazine_event_signature_hash "
        "ON magazine_event_signature_embeddings(signature_hash)"
    )
    conn.execute(f"PRAGMA user_version = {SCHEMA_VERSION}")
    conn.commit()
    return conn


def run_init(args: argparse.Namespace) -> int:
    index_path = resolve_project_path(args.index_path)
    existed = index_path.exists()
    conn = connect_index(index_path)
    try:
        row_count = int(
            conn.execute("SELECT COUNT(*) FROM magazine_event_signature_embeddings").fetchone()[0]
        )
        actual_version = int(conn.execute("PRAGMA user_version").fetchone()[0])
    finally:
        conn.close()
    payload = {
        "ok": True,
        "initialized": not existed,
        "indexPath": display_project_path(index_path),
        "schemaPath": "config/magazine-event-signature-index.schema.sql",
        "schemaVersion": actual_version,
        "rowCount": row_count,
    }
    print(json.dumps(payload, ensure_ascii=False, indent=2) if args.json else (
        f"Magazine event-signature index ready: rows={row_count} schema={actual_version}"
    ))
    return 0


def upsert_embeddings(conn: sqlite3.Connection, records: list[dict[str, Any]], vectors: list[list[float]], *, engine: str, model: str) -> None:
    for record, vector in zip(records, vectors):
        conn.execute(
            """
            INSERT INTO magazine_event_signature_embeddings (
                article_id, embedding_engine, embedding_model, signature_hash,
                embedding_dims, embedding_blob, signature_text, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(article_id) DO UPDATE SET
                embedding_engine=excluded.embedding_engine,
                embedding_model=excluded.embedding_model,
                signature_hash=excluded.signature_hash,
                embedding_dims=excluded.embedding_dims,
                embedding_blob=excluded.embedding_blob,
                signature_text=excluded.signature_text,
                updated_at=CURRENT_TIMESTAMP
            """,
            (
                record["articleId"],
                engine,
                model,
                record["signatureHash"],
                len(vector),
                vector_to_blob(vector),
                record["signatureText"],
            ),
        )
    conn.commit()


def shared_values(left: list[str], right: list[str]) -> list[str]:
    right_set = set(right)
    return [item for item in left if item in right_set]


def compare_records(
    records: list[dict[str, Any]],
    vectors: list[list[float]],
    *,
    warn_threshold: float,
    error_threshold: float,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    errors: list[dict[str, Any]] = []
    warnings: list[dict[str, Any]] = []
    previous: list[tuple[dict[str, Any], list[float]]] = []
    for record, vector in zip(records, vectors):
        for other, other_vector in previous:
            if record["articleId"] == other["articleId"] and record["source"] == other["source"]:
                continue
            score = cosine_similarity(vector, other_vector)
            shared_sources = shared_values(record["newsFeedIds"], other["newsFeedIds"])
            if record["signatureHash"] == other["signatureHash"]:
                errors.append({
                    "articleId": record["articleId"],
                    "level": "error",
                    "code": "duplicate-event-signature-hash",
                    "similarity": round(score, 6),
                    "otherArticleId": other["articleId"],
                    "message": f"event signature exactly matches {other['source']} article {other['articleId']}",
                })
            elif shared_sources and score >= warn_threshold:
                errors.append({
                    "articleId": record["articleId"],
                    "level": "error",
                    "code": "duplicate-event-signature-source",
                    "similarity": round(score, 6),
                    "otherArticleId": other["articleId"],
                    "sharedNewsFeedIds": shared_sources,
                    "message": f"event signature is near {other['source']} article {other['articleId']} and reuses source id(s) {', '.join(shared_sources)}",
                })
            elif score >= error_threshold:
                warnings.append({
                    "articleId": record["articleId"],
                    "level": "warn",
                    "code": "near-event-signature",
                    "similarity": round(score, 6),
                    "otherArticleId": other["articleId"],
                    "message": f"event signature is very close to {other['source']} article {other['articleId']}; run LLM novelty judgment before publishing",
                })
        previous.append((record, vector))
    return errors, warnings


def run_check(args: argparse.Namespace) -> int:
    articles_dir = resolve_project_path(args.articles_dir)
    baseline_dir = resolve_project_path(args.baseline_articles_dir) if args.baseline_articles_dir else None
    records: list[dict[str, Any]] = []
    if baseline_dir:
        records.extend(load_records(baseline_dir, source="baseline", limit=max(0, int(args.baseline_limit))))
    records.extend(load_records(articles_dir, source="candidate"))

    if not records:
        payload = {"ok": True, "records": 0, "errors": [], "warnings": []}
        print(json.dumps(payload, ensure_ascii=False, indent=2) if args.json else "Magazine event-signature check: no records")
        return 0

    try:
        embedder = SentenceTransformerEmbedder(
            model=args.model,
            batch_size=max(1, int(args.batch_size)),
            device=args.device or "",
            quiet_load=not args.verbose_model_load,
        )
    except RuntimeError as exc:
        if args.mode == "require":
            print(str(exc), file=sys.stderr)
            return 2
        payload = {"ok": True, "skipped": True, "reason": str(exc), "records": len(records), "errors": [], "warnings": []}
        print(json.dumps(payload, ensure_ascii=False, indent=2) if args.json else f"Magazine event-signature check skipped: {exc}")
        return 0

    vectors = embedder.encode([record["signatureText"] for record in records])
    if args.index_path:
        conn = connect_index(resolve_project_path(args.index_path))
        try:
            upsert_embeddings(conn, records, vectors, engine=DEFAULT_ENGINE, model=args.model)
        finally:
            conn.close()

    errors, warnings = compare_records(
        records,
        vectors,
        warn_threshold=float(args.warn_threshold),
        error_threshold=float(args.error_threshold),
    )
    failed = bool(errors) or (args.strict and bool(warnings))
    payload = {
        "ok": not failed,
        "records": len(records),
        "model": args.model,
        "errors": errors,
        "warnings": warnings,
    }
    if args.json:
        print(json.dumps(payload, ensure_ascii=False, indent=2))
    else:
        print(f"Magazine event-signature check: {len(records)} record(s)")
        for issue in [*errors, *warnings]:
            print(f"- {issue['articleId']}: [{issue['level']}] {issue['code']} similarity={issue.get('similarity')}: {issue['message']}")
    return 1 if failed else 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Embed magazine event signatures and audit near-duplicate articles.")
    parser.add_argument("command", choices=["init", "check", "backfill"], nargs="?", default="check")
    parser.add_argument("--articles-dir", default="data/magazine/articles")
    parser.add_argument("--baseline-articles-dir", default="")
    parser.add_argument("--baseline-limit", type=int, default=12)
    parser.add_argument("--index-path", default="data/magazine/event-signature-index.sqlite3")
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--batch-size", type=int, default=DEFAULT_BATCH_SIZE)
    parser.add_argument("--device", default="")
    parser.add_argument("--warn-threshold", type=float, default=DEFAULT_WARN_THRESHOLD)
    parser.add_argument("--error-threshold", type=float, default=DEFAULT_ERROR_THRESHOLD)
    parser.add_argument("--mode", choices=["auto", "require"], default=os.getenv("MAGAZINE_EVENT_SIGNATURE_EMBEDDING_MODE", "auto"))
    parser.add_argument("--strict", action="store_true")
    parser.add_argument("--json", action="store_true")
    parser.add_argument("--overwrite", action="store_true")
    parser.add_argument("--verbose-model-load", action="store_true")
    return parser


def main() -> int:
    args = build_parser().parse_args()
    if args.command == "init":
        return run_init(args)
    if args.command == "backfill":
        return run_backfill(args)
    if args.command == "check":
        return run_check(args)
    raise AssertionError(args.command)


if __name__ == "__main__":
    sys.exit(main())
