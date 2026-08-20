from collections.abc import Generator
from functools import lru_cache
from typing import Any

from sqlalchemy import create_engine, event
from sqlalchemy.engine import Engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.core.config import get_settings


def _register_pgvector(dbapi_connection: Any, _connection_record: Any) -> None:
    from pgvector.psycopg import register_vector

    register_vector(dbapi_connection)


@lru_cache(maxsize=1)
def _get_engine() -> Engine:
    settings = get_settings()
    engine = create_engine(
        settings.database_url,
        pool_pre_ping=True,
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
