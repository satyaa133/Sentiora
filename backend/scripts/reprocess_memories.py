"""Re-clean and re-chunk memories that were saved before the RAG v2 pipeline.

Usage (from the repo root):

    node scripts/run-python.mjs -m scripts.reprocess_memories --reclean --dry-run
    node scripts/run-python.mjs -m scripts.reprocess_memories --reclean [--user EMAIL] [--batch 25]

``--reclean`` re-runs normalization (rolling-caption removal, no title in chunk
text) and chunking for every READY memory, then tries to embed the new chunks.
If embedding fails, the memory keeps its new chunks without vectors and stays
READY; run the embedding backfill later to fill them.

The run is resumable: the last processed memory id is written to a checkpoint
file after every batch, and a re-run continues after it (``--restart`` starts
over). Re-running a finished memory is harmless, so the script is idempotent.
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
from pathlib import Path
from uuid import UUID

from sqlalchemy import select

from app.core.db import SessionLocal
from app.models.memory_chunk import MemoryChunk
from app.models.memory_item import ItemStatus, MemoryItem
from app.models.user import User
from app.repositories.chunk_repository import ChunkRepository
from app.workers.jobs.process_capture import (
    CaptureProcessingError,
    embed_chunks,
    prepare_chunks,
)

logger = logging.getLogger("reprocess_memories")
DEFAULT_CHECKPOINT = (
    Path(__file__).resolve().parent.parent / ".reprocess-checkpoint.json"
)


def _load_checkpoint(path: Path, mode: str) -> UUID | None:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        value = data.get(mode)
        return UUID(value) if value else None
    except (FileNotFoundError, ValueError, json.JSONDecodeError):
        return None


def _save_checkpoint(path: Path, mode: str, last_id: UUID | None) -> None:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        data = {}
    data[mode] = str(last_id) if last_id else None
    path.write_text(json.dumps(data, indent=2), encoding="utf-8")


def _user_id(db, user: str | None) -> UUID | None:
    if not user:
        return None
    try:
        return UUID(user)
    except ValueError:
        found = db.execute(
            select(User.id).where(User.email == user.lower())
        ).scalar_one_or_none()
        if found is None:
            raise SystemExit(f"No user with email {user}") from None
        return found


def reclean(args: argparse.Namespace) -> int:
    checkpoint = Path(args.checkpoint)
    after = None if args.restart else _load_checkpoint(checkpoint, "reclean")
    totals = {
        "seen": 0,
        "rechunked": 0,
        "embedded": 0,
        "embed_pending": 0,
        "skipped": 0,
    }

    with SessionLocal() as db:
        user_id = _user_id(db, args.user)
        while True:
            stmt = (
                select(MemoryItem.id)
                .where(
                    MemoryItem.status == ItemStatus.ready,
                    MemoryItem.deleted_at.is_(None),
                )
                .order_by(MemoryItem.id)
                .limit(args.batch)
            )
            if user_id:
                stmt = stmt.where(MemoryItem.user_id == user_id)
            if after:
                stmt = stmt.where(MemoryItem.id > after)
            ids = list(db.execute(stmt).scalars())
            if not ids:
                break

            for item_id in ids:
                totals["seen"] += 1
                item = db.get(MemoryItem, item_id)
                old_count = len(
                    ChunkRepository(db).list_for_memory(item.id, item.user_id)
                )
                try:
                    drafts = prepare_chunks(item)
                except CaptureProcessingError as exc:
                    db.rollback()
                    totals["skipped"] += 1
                    logger.warning("memory_id=%s skipped reason=%s", item_id, exc)
                    continue

                logger.info(
                    "memory_id=%s source=%s chunks %d -> %d",
                    item_id,
                    item.source_type.value,
                    old_count,
                    len(drafts),
                )
                if args.dry_run:
                    db.rollback()
                    continue

                chunks = [
                    MemoryChunk(
                        memory_id=item.id,
                        user_id=item.user_id,
                        chunk_index=draft.chunk_index,
                        content=draft.content,
                        heading=draft.heading,
                        page_number=draft.page_number,
                        source_type=item.source_type,
                    )
                    for draft in drafts
                ]
                ChunkRepository(db).replace_for_memory(item.id, item.user_id, chunks)
                try:
                    embedded = embed_chunks(chunks, str(item_id)) is not None
                except CaptureProcessingError as exc:
                    for chunk in chunks:
                        chunk.embedding = None
                    embedded = False
                    logger.warning("memory_id=%s embed_pending reason=%s", item_id, exc)
                db.commit()
                totals["rechunked"] += 1
                totals["embedded" if embedded else "embed_pending"] += 1

            after = ids[-1]
            if not args.dry_run:
                _save_checkpoint(checkpoint, "reclean", after)

    if not args.dry_run:
        _save_checkpoint(checkpoint, "reclean", None)
    logger.info(
        "done %s%s", totals, " (dry run, nothing written)" if args.dry_run else ""
    )
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument(
        "--reclean",
        action="store_true",
        help="re-normalize and re-chunk READY memories",
    )
    parser.add_argument("--user", help="limit to one user (email or id)")
    parser.add_argument("--batch", type=int, default=25)
    parser.add_argument(
        "--dry-run", action="store_true", help="report changes without writing"
    )
    parser.add_argument("--restart", action="store_true", help="ignore the checkpoint")
    parser.add_argument("--checkpoint", default=str(DEFAULT_CHECKPOINT))
    args = parser.parse_args(argv)

    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    if args.reclean:
        return reclean(args)
    parser.print_help()
    return 2


if __name__ == "__main__":
    sys.exit(main())
