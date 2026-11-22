"""Load the CI eval library (scripts/eval-rag/fixture/library.json) for one run.

The library is original text written for the eval (REBUILD_PLAN D15). Each run
creates a throwaway user, saves every item through the normal capture path
(normalise, chunk, embed with the active embedding model), stores each save's
questions the way enrichment would (question bank), and deletes the user at
the end; every table cascades from ``users``.

Nothing is sent to an AI provider: captures are processed inline, enrichment
is not requested, and questions are embedded with the local model.
"""

from __future__ import annotations

import json
import uuid
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Any

from sqlalchemy import delete, select

from app.core.db import SessionLocal
from app.models.memory_chunk import MemoryChunk
from app.models.memory_question import MemoryQuestion
from app.models.user import User
from app.schemas.memory_item import MemoryItemCreate
from app.services import memory_service
from app.services.embedding_service import get_embedding_adapter, is_local_model
from app.services.memory_service import MemoryService

FIXTURE_DIR = Path(__file__).resolve().parents[2] / "scripts" / "eval-rag" / "fixture"
LIBRARY = FIXTURE_DIR / "library.json"
QUESTIONS = FIXTURE_DIR / "questions.json"


def _normalize(text: str) -> str:
    return " ".join(text.lower().split())


def _payload(save: dict[str, Any]) -> MemoryItemCreate:
    url = f"https://library.example.org/{save['slug']}"
    if save["source_type"] != "youtube":
        return MemoryItemCreate(
            source_type=save["source_type"], url=url, title=save["title"], content=save["content"]
        )
    lines = save["transcript"]
    nodes = []
    for order, (start, text) in enumerate(lines):
        end = lines[order + 1][0] if order + 1 < len(lines) else start + 10
        nodes.append(
            {
                "id": f"node-{order}",
                "type": "paragraph",
                "text": text,
                "order": order,
                "metadata": {"start_seconds": start, "end_seconds": end},
            }
        )
    return MemoryItemCreate(
        source_type="youtube",
        url=f"https://www.youtube.com/watch?v=eval{save['slug'][:7]}",
        title=save["title"],
        content=" ".join(text for _, text in lines),
        structured_content=nodes,
        extraction={
            "method": "youtube_transcript",
            "duration_ms": 1,
            "status": "success",
            "quality_score": 1.0,
            "quality_reasons": [],
        },
    )


def _no_queue() -> None:
    raise RuntimeError("eval fixture: process captures inline")


def load_library(user_id: uuid.UUID) -> int:
    """Save every fixture item for ``user_id`` and store its questions; returns the count."""
    saves = json.loads(LIBRARY.read_text(encoding="utf-8"))["saves"]
    adapter = get_embedding_adapter()
    local = adapter is not None and is_local_model(getattr(adapter, "model_id", None))
    original = memory_service.create_queues
    memory_service.create_queues = _no_queue  # type: ignore[assignment]
    try:
        with SessionLocal() as db:
            service = MemoryService(db)
            for save in saves:
                created = service.create_item(user_id, _payload(save))
                if created.status != "ready":
                    raise SystemExit(f"Fixture save {save['slug']!r} was not indexed: {created.status}")
                chunks = db.execute(
                    select(MemoryChunk).where(MemoryChunk.memory_id == created.id)
                ).scalars().all()
                for item in save.get("questions", []):
                    target = next(
                        (c for c in chunks if _normalize(item["passage"]) in _normalize(c.content)),
                        None,
                    )
                    if target is None:
                        raise SystemExit(
                            f"Fixture question {item['question']!r}: no chunk holds its passage"
                        )
                    db.add(
                        MemoryQuestion(
                            memory_id=created.id,
                            user_id=user_id,
                            chunk_id=target.id,
                            question=item["question"],
                            embedding_local=adapter.embed_query(item["question"]) if local and adapter else None,
                        )
                    )
            db.commit()
    finally:
        memory_service.create_queues = original  # type: ignore[assignment]
    return len(saves)


@contextmanager
def fixture_user() -> Iterator[uuid.UUID]:
    """A throwaway user holding the fixture library, deleted afterwards."""
    with SessionLocal() as db:
        user = User(
            email=f"eval-fixture-{uuid.uuid4().hex[:12]}@sentiora.invalid",
            password_hash=None,
            is_email_verified=False,
            is_active=True,
        )
        db.add(user)
        db.commit()
        user_id = user.id
    try:
        load_library(user_id)
        yield user_id
    finally:
        with SessionLocal() as db:
            db.execute(delete(User).where(User.id == user_id))
            db.commit()
