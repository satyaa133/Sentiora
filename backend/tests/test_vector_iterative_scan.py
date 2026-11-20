"""S1: vector search keeps finding a user's own chunks among everyone else's."""

from __future__ import annotations

import random
import uuid

from pgvector import Vector
from sqlalchemy import text

from app.core.db import SessionLocal, _get_engine


def test_every_pooled_connection_uses_iterative_scans() -> None:
    db = SessionLocal()
    try:
        assert db.execute(text("SHOW hnsw.iterative_scan")).scalar() == "relaxed_order"
        db.rollback()  # what the pool does when a connection is returned
        assert db.execute(text("SHOW hnsw.iterative_scan")).scalar() == "relaxed_order"
    finally:
        db.close()


def test_hnsw_scan_finds_a_users_chunks_behind_other_users_neighbours() -> None:
    """Reproduces the failure: 1,000 closer chunks from another user.

    The planner is pushed onto the HNSW index (enable_sort = off). Without
    iterative scans this returned 0 rows for the user; it must return all 5.
    """
    rng = random.Random(7)
    base = [rng.uniform(-1, 1) for _ in range(1536)]

    def near(noise: float) -> Vector:
        return Vector([value + rng.uniform(-noise, noise) for value in base])

    other, me = uuid.uuid4(), uuid.uuid4()
    raw = _get_engine().raw_connection()
    try:
        dbapi = raw.driver_connection
        assert dbapi is not None
        with dbapi.cursor() as cursor:
            cursor.execute(
                "CREATE TEMP TABLE scan_probe (id int, user_id uuid, embedding vector(1536))"
            )
            with cursor.copy(
                "COPY scan_probe (id, user_id, embedding) FROM STDIN WITH (FORMAT BINARY)"
            ) as copy:
                copy.set_types(["int4", "uuid", "vector"])
                for index in range(1000):
                    copy.write_row((index, other, near(0.05)))
                for index in range(5):
                    copy.write_row((10_000 + index, me, near(0.6)))
            cursor.execute("CREATE INDEX ON scan_probe USING hnsw (embedding vector_cosine_ops)")
            cursor.execute("ANALYZE scan_probe")
            cursor.execute("SET LOCAL enable_sort = off")
            cursor.execute(
                "SELECT id FROM scan_probe WHERE user_id = %s "
                "ORDER BY embedding <=> %s LIMIT 30",
                (me, Vector(base)),
            )
            found = cursor.fetchall()
        dbapi.rollback()
    finally:
        raw.close()

    assert len(found) == 5
