"""Re-clean and re-chunk memories that were saved before the RAG v2 pipeline.

Usage (from the repo root):

    node scripts/run-python.mjs -m scripts.reprocess_memories --reclean --dry-run
    node scripts/run-python.mjs -m scripts.reprocess_memories --reclean [--user EMAIL] [--batch 25]
    node scripts/run-python.mjs -m scripts.reprocess_memories --embed [--user EMAIL] [--force] [--dry-run]
    node scripts/run-python.mjs -m scripts.reprocess_memories --retry-failed-embedding [--dry-run]
    node scripts/run-python.mjs -m scripts.reprocess_memories --enrich [--user EMAIL] [--memory ID] [--limit N] [--delay 5] [--dry-run]

``--enrich`` enriches READY saves that aren't enriched yet (summary, key
points, question bank, chunk context lines; REBUILD_PLAN S5), one AI call per
save with ``--delay`` seconds between calls so the provider's rate limits hold.
It ignores ENRICH_DAILY_LIMIT, skips saves already enriched (so it can be
stopped and re-run) and stops at the first save the AI provider can't enrich.

``--embed`` embeds every chunk that has no vector for the active embedding
model: for a remote provider, no ``embedding`` or one from a model other than
the current ``EMBEDDING_MODEL``; for ``EMBEDDING_PROVIDER=local``, no
``embedding_local``. ``--embed --force`` re-embeds every chunk (needed after
changing ``LOCAL_EMBEDDING_MODEL`` to a model of the same size). It commits after every batch and
only ever selects chunks that still need work, so it is idempotent and can be
stopped and re-run at any time. It stops at the first provider failure.

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
import time
from pathlib import Path
from uuid import UUID

from sqlalchemy import func, select

from app.core.config import get_settings
from app.core.db import SessionLocal
from app.models.memory_chunk import MemoryChunk
from app.models.memory_item import ItemStatus, MemoryItem
from app.models.memory_question import MemoryQuestion
from app.models.user import User
from app.repositories.chunk_repository import ChunkRepository
from app.services.enrichment_service import forget_enrichment
from app.services.embedding_service import (
    get_embedding_adapter,
    needs_vector_for,
    set_chunk_vector,
)
from app.workers.jobs.process_capture import (
    CaptureProcessingError,
    build_chunk_rows,
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

                # Context lines and questions point at the old chunks; the save
                # is enriched again when it next matters (lazy rules).
                forget_enrichment(db, item)
                chunks = build_chunk_rows(item, drafts)
                ChunkRepository(db).replace_for_memory(item.id, item.user_id, chunks)
                try:
                    embedded = embed_chunks(chunks, str(item_id)) is not None
                except CaptureProcessingError as exc:
                    for chunk in chunks:
                        chunk.embedding = None
                        chunk.embedding_model = None
                        chunk.embedding_local = None
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


def embed(args: argparse.Namespace) -> int:
    adapter = get_embedding_adapter()
    model_id = getattr(adapter, "model_id", None)
    if adapter is None or model_id is None:
        logger.error(
            "No embedding provider is configured (EMBEDDING_PROVIDER / API keys)."
        )
        return 1
    expected = int(getattr(adapter, "dimensions", 0) or get_settings().embedding_dimensions)
    batch_size = max(1, min(args.batch, 256))
    embedded = 0

    with SessionLocal() as db:
        user_id = _user_id(db, args.user)
        needs_work = (
            select(MemoryChunk)
            .join(MemoryItem, MemoryItem.id == MemoryChunk.memory_id)
            .where(
                MemoryItem.status == ItemStatus.ready,
                MemoryItem.deleted_at.is_(None),
                MemoryItem.user_id == MemoryChunk.user_id,
            )
            .order_by(MemoryChunk.id)
        )
        if not args.force:
            needs_work = needs_work.where(needs_vector_for(model_id))
        if user_id:
            needs_work = needs_work.where(MemoryChunk.user_id == user_id)

        total = db.execute(
            select(func.count()).select_from(needs_work.subquery())
        ).scalar_one()
        logger.info("model=%s chunks_to_embed=%d", model_id, total)
        if args.dry_run:
            return 0

        # Keyset paging by id: a re-embedded chunk (--force) is never picked twice.
        after: UUID | None = None
        while True:
            page = needs_work if after is None else needs_work.where(MemoryChunk.id > after)
            chunks = list(db.execute(page.limit(batch_size)).scalars())
            if not chunks:
                break
            after = chunks[-1].id
            try:
                vectors = adapter.embed_texts([chunk.content for chunk in chunks])
                if len(vectors) != len(chunks) or any(
                    len(v) != expected for v in vectors
                ):
                    raise RuntimeError(
                        "provider returned the wrong number or size of vectors"
                    )
            except Exception as exc:
                db.rollback()
                logger.error(
                    "stopped after %d/%d chunks: %s. Re-run to continue.",
                    embedded,
                    total,
                    exc,
                )
                return 1
            for chunk, vector in zip(chunks, vectors, strict=True):
                set_chunk_vector(chunk, model_id, vector)
            db.commit()
            embedded += len(chunks)
            logger.info("embedded %d/%d", embedded, total)

    logger.info("done model=%s embedded=%d", model_id, embedded)
    return 0


EMBED_FAILURE_PREFIX = "Embedding generation failed"


def retry_failed_embedding(args: argparse.Namespace) -> int:
    """Re-run captures that were marked FAILED only because embedding failed.

    Older builds failed the whole capture when the embedding provider was down
    or out of quota; the capture job now keeps such memories READY (full-text
    searchable) and leaves vectors to the backfill. Captures that failed for
    any other reason (no readable content) are left alone.
    """
    from app.workers.jobs.process_capture import process_capture

    with SessionLocal() as db:
        user_id = _user_id(db, args.user)
        stmt = select(MemoryItem).where(
            MemoryItem.status == ItemStatus.failed,
            MemoryItem.deleted_at.is_(None),
            MemoryItem.processing_error.startswith(EMBED_FAILURE_PREFIX),
        )
        if user_id:
            stmt = stmt.where(MemoryItem.user_id == user_id)
        items = list(db.execute(stmt).scalars())
        logger.info("captures_failed_on_embedding=%d", len(items))
        if args.dry_run or not items:
            return 0
        ids = [str(item.id) for item in items]
        for item in items:
            item.status = ItemStatus.pending
            item.processing_error = None
        db.commit()

    for item_id in ids:
        process_capture(item_id)

    with SessionLocal() as db:
        statuses = db.execute(
            select(MemoryItem.status, func.count())
            .where(MemoryItem.id.in_([UUID(i) for i in ids]))
            .group_by(MemoryItem.status)
        ).all()
    logger.info("retried=%d result=%s", len(ids), {str(s): n for s, n in statuses})
    return 0


def enrich(args: argparse.Namespace) -> int:
    from app.models.memory_item import EnrichmentStatus
    from app.services.enrichment_service import EnrichmentError, EnrichmentService

    with SessionLocal() as db:
        user_id = _user_id(db, args.user)
        stmt = (
            select(MemoryItem)
            .where(
                MemoryItem.status == ItemStatus.ready,
                MemoryItem.deleted_at.is_(None),
                MemoryItem.enrichment_status != EnrichmentStatus.ready.value,
            )
            .order_by(MemoryItem.captured_at.desc())
        )
        if user_id:
            stmt = stmt.where(MemoryItem.user_id == user_id)
        if args.memory:
            stmt = stmt.where(MemoryItem.id.in_([UUID(m) for m in args.memory]))
        items = list(db.execute(stmt).scalars())
        if args.limit:
            items = items[: args.limit]
        logger.info("saves_to_enrich=%d", len(items))
        if args.dry_run:
            for item in items:
                logger.info("would enrich memory_id=%s title=%r", item.id, item.title[:80])
            return 0
        service = EnrichmentService(db)
        for done, item in enumerate(items, start=1):
            if done > 1 and args.delay > 0:
                time.sleep(args.delay)
            started = time.perf_counter()
            try:
                service.enrich_now(item)
            except EnrichmentError as exc:
                db.rollback()
                logger.error(
                    "stopped at memory_id=%s after %d/%d: %s. Re-run to continue.",
                    item.id,
                    done - 1,
                    len(items),
                    exc,
                )
                return 1
            logger.info(
                "enriched %d/%d memory_id=%s questions=%d in %.1fs title=%r",
                done,
                len(items),
                item.id,
                db.execute(
                    select(func.count())
                    .select_from(MemoryQuestion)
                    .where(MemoryQuestion.memory_id == item.id)
                ).scalar_one(),
                time.perf_counter() - started,
                item.title[:60],
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
    parser.add_argument(
        "--embed",
        action="store_true",
        help="embed chunks missing a current-model vector",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="with --embed: re-embed every chunk, not only those missing a vector",
    )
    parser.add_argument(
        "--retry-failed-embedding",
        action="store_true",
        help="re-run captures that FAILED only because embedding failed",
    )
    parser.add_argument(
        "--enrich",
        action="store_true",
        help="enrich READY saves that aren't enriched yet (one AI call each)",
    )
    parser.add_argument(
        "--memory", action="append", help="with --enrich: only this save id (repeatable)"
    )
    parser.add_argument(
        "--limit", type=int, default=0, help="with --enrich: at most this many saves"
    )
    parser.add_argument(
        "--delay",
        type=float,
        default=5.0,
        help="with --enrich: seconds between AI calls (provider rate limits)",
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
    if args.retry_failed_embedding:
        status = retry_failed_embedding(args)
        if status or not args.embed:
            return status
    if args.reclean:
        status = reclean(args)
        if status or not args.embed:
            return status
    if args.embed:
        status = embed(args)
        if status or not args.enrich:
            return status
    if args.enrich:
        return enrich(args)
    parser.print_help()
    return 2


if __name__ == "__main__":
    sys.exit(main())
