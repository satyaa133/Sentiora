"""Seed the S9 load-test database: N users, each holding the eval library (D17).

Run inside the load stack only (``scripts/load/README.md``)::

    python -m scripts.load_seed --users 500

The fixture library (scripts/eval-rag/fixture, original text) is saved once
for a template user through the normal capture path, so its chunks and
question-bank rows carry real local embeddings. Its rows are then copied to
every load user with set-based SQL: embedding 6,000 saves one by one would
take hours and measure nothing S9 cares about.

Users are ``load-0001@example.com`` ... with one shared password from
``LOAD_USER_PASSWORD``; k6 signs them in like real users. Re-running drops the
previous load users first. Refuses to run unless APP_ENVIRONMENT=loadtest, so
it can never write into a development or production database.
"""

from __future__ import annotations

import argparse
import os
import sys
import time
import uuid

from sqlalchemy import delete, select, text

from app.core.config import get_settings
from app.core.db import SessionLocal
from app.core.security import hash_password
from app.models.memory_item import MemoryItem
from app.models.user import User
from app.repositories.user_repository import UserRepository
from scripts.eval_fixture import load_library

EMAIL_PATTERN = "load-{index:04d}@example.com"
EMAIL_LIKE = "load-%@example.com"
TEMPLATE_EMAIL = "load-template@example.com"
COPY_BATCH = 50

# Columns copied from the template rows; ids, owners and generated columns are
# set by the copy itself.
ITEM_COLUMNS = (
    "source_type, url, title, content, summary, author, favicon_url, thumbnail_url, "
    "word_count, reading_time_seconds, status, captured_at, created_at, updated_at, "
    "deleted_at, domain, language, content_length, processing_error, structured_content, "
    "content_hash, extraction_method, extraction_status, extraction_quality_score, "
    "extraction_quality_reasons, raw_content_length, received_at, key_points, "
    "enrichment_status, enrich_requested_at, enriched_at, enrichment_model"
)
CHUNK_COLUMNS = (
    "chunk_index, content, heading, page_number, source_type, created_at, embedding, "
    "start_sec, end_sec, embedding_model, embedding_local, context"
)


def _prefixed(columns: str, alias: str) -> str:
    return ", ".join(f"{alias}.{c.strip()}" for c in columns.split(","))


def _drop_previous() -> int:
    with SessionLocal() as db:
        result = db.execute(
            delete(User).where(User.email.like(EMAIL_LIKE) | (User.email == TEMPLATE_EMAIL))
        )
        db.commit()
        return int(result.rowcount or 0)  # type: ignore[attr-defined]


def _create_users(count: int, password: str) -> list[uuid.UUID]:
    password_hash = hash_password(password)  # once: hashing is deliberately slow
    version = get_settings().privacy_notice_version
    ids: list[uuid.UUID] = []
    with SessionLocal() as db:
        repo = UserRepository(db)
        for index in range(1, count + 1):
            user = repo.create_user(
                email=EMAIL_PATTERN.format(index=index),
                password_hash=password_hash,
                full_name=f"Load User {index}",
                privacy_consent_version=version,
            )
            ids.append(user.id)
    return ids


def _copy_library(template_id: uuid.UUID, user_ids: list[uuid.UUID]) -> None:
    """Copy the template's saves, chunks and questions to every user in one transaction."""
    with SessionLocal() as db:
        db.execute(text("CREATE TEMP TABLE load_users (user_id uuid PRIMARY KEY) ON COMMIT DROP"))
        db.execute(
            text("INSERT INTO load_users (user_id) SELECT unnest(CAST(:ids AS uuid[]))"),
            {"ids": [str(u) for u in user_ids]},
        )
        db.execute(
            text(
                "CREATE TEMP TABLE item_map ON COMMIT DROP AS "
                "SELECT u.user_id, mi.id AS old_id, gen_random_uuid() AS new_id "
                "FROM load_users u CROSS JOIN memory_items mi WHERE mi.user_id = :tpl"
            ),
            {"tpl": template_id},
        )
        db.execute(
            text(
                "CREATE TEMP TABLE chunk_map ON COMMIT DROP AS "
                "SELECT im.user_id, im.new_id AS memory_id, c.id AS old_id, "
                "gen_random_uuid() AS new_id "
                "FROM item_map im JOIN memory_chunks c ON c.memory_id = im.old_id"
            )
        )
        db.execute(
            text(
                f"INSERT INTO memory_items (id, user_id, {ITEM_COLUMNS}) "
                f"SELECT im.new_id, im.user_id, {_prefixed(ITEM_COLUMNS, 'mi')} "
                "FROM item_map im JOIN memory_items mi ON mi.id = im.old_id"
            )
        )
        db.execute(
            text(
                f"INSERT INTO memory_chunks (id, memory_id, user_id, {CHUNK_COLUMNS}) "
                f"SELECT cm.new_id, cm.memory_id, cm.user_id, {_prefixed(CHUNK_COLUMNS, 'c')} "
                "FROM chunk_map cm JOIN memory_chunks c ON c.id = cm.old_id"
            )
        )
        db.execute(
            text(
                "INSERT INTO memory_questions (id, memory_id, user_id, chunk_id, question, "
                "embedding_local, created_at) "
                "SELECT gen_random_uuid(), im.new_id, im.user_id, cm.new_id, q.question, "
                "q.embedding_local, q.created_at "
                "FROM memory_questions q "
                "JOIN item_map im ON im.old_id = q.memory_id "
                "LEFT JOIN chunk_map cm ON cm.old_id = q.chunk_id AND cm.user_id = im.user_id"
            )
        )
        db.commit()


def _analyze() -> None:
    with SessionLocal() as db:
        db.execute(text("ANALYZE memory_items; ANALYZE memory_chunks; ANALYZE memory_questions"))
        db.commit()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--users", type=int, default=500)
    args = parser.parse_args(argv)

    settings = get_settings()
    if settings.app_environment != "loadtest":
        print("Refusing to seed: APP_ENVIRONMENT must be 'loadtest'.", file=sys.stderr)
        return 2
    password = os.environ.get("LOAD_USER_PASSWORD", "")
    if len(password) < 12:
        print("Set LOAD_USER_PASSWORD (12+ characters) first.", file=sys.stderr)
        return 2

    started = time.monotonic()
    dropped = _drop_previous()
    print(f"Removed {dropped} previous load users.")

    with SessionLocal() as db:
        template = UserRepository(db).create_user(
            email=TEMPLATE_EMAIL, password_hash=None, full_name="Load template"
        )
        template_id = template.id
    saves = load_library(template_id)
    # An active user's saves are already enriched (the fixture brings its own
    # question bank). Left at "none", every Ask would queue enrichment for its
    # sources, and with no Groq key in the load stack those jobs fail and
    # retry: 18,000 jobs and 1.2 cores in S9 run 2, a cost production pays
    # once per save, not on every question.
    with SessionLocal() as db:
        db.execute(
            text(
                "UPDATE memory_items SET enrichment_status = 'ready', enriched_at = now(), "
                "enrichment_model = 'load-seed' WHERE user_id = :tpl"
            ),
            {"tpl": template_id},
        )
        db.commit()
    print(f"Template library: {saves} saves embedded ({time.monotonic() - started:.0f} s).")

    user_ids = _create_users(args.users, password)
    print(f"Created {len(user_ids)} users ({time.monotonic() - started:.0f} s).")

    # Batches keep each transaction (and Postgres's memory) small: one copy of
    # 500 users' chunks with their vectors ran a 7 GB laptop out of memory.
    for start in range(0, len(user_ids), COPY_BATCH):
        _copy_library(template_id, user_ids[start : start + COPY_BATCH])
        print(f"  copied {min(start + COPY_BATCH, len(user_ids))}/{len(user_ids)} users")
    _analyze()
    with SessionLocal() as db:
        items = db.execute(
            select(MemoryItem.id).where(MemoryItem.user_id.in_(user_ids))
        ).all()
    print(
        f"Copied the library: {len(items)} saves for {len(user_ids)} users "
        f"({time.monotonic() - started:.0f} s total)."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
