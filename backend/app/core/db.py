import logging
from collections.abc import Generator
from functools import lru_cache
from typing import Any

from sqlalchemy import create_engine, event
from sqlalchemy.engine import Engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.core.config import get_settings

logger = logging.getLogger(__name__)


def _register_pgvector(dbapi_connection: Any, _connection_record: Any) -> None:
    from pgvector.psycopg import register_vector

    register_vector(dbapi_connection)
    # The HNSW index spans every user's chunks and the user filter runs after
    # it. Without iterative scans the index returns its first ef_search (40)
    # neighbours across all users, and a user whose chunks are not among them
    # gets no vector results at all. relaxed_order keeps scanning until enough
    # rows pass the filter (pgvector 0.8+); callers re-sort by distance.
    try:
        with dbapi_connection.cursor() as cursor:
            cursor.execute("SET hnsw.iterative_scan = relaxed_order")
        dbapi_connection.commit()  # keep the setting past the pool's rollback
    except Exception:
        dbapi_connection.rollback()
        logger.warning("Could not enable pgvector iterative scans", exc_info=True)


@lru_cache(maxsize=1)
def _get_engine() -> Engine:
    settings = get_settings()
    engine = create_engine(
        settings.database_url,
        pool_pre_ping=True,
        pool_size=settings.db_pool_size,
        max_overflow=settings.db_max_overflow,
        echo=False,
        connect_args={"connect_timeout": 10},
    )
    event.listen(engine, "connect", _register_pgvector)
    return engine


def _get_session_factory() -> sessionmaker[Session]:
    return sessionmaker(
        autocommit=False,
        autoflush=False,
        bind=_get_engine(),
    )


def SessionLocal() -> Session:  # noqa: N802
    return _get_session_factory()()


class Base(DeclarativeBase):
    pass


def get_db_session() -> Generator[Session, Any, None]:
    session_factory = _get_session_factory()
    db = session_factory()
    try:
        yield db
    finally:
        db.close()
