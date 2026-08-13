# Option A (RQ): Implementation Plan §4.4 originally referenced Celery, but Phase 0
# scaffolded Redis Queue (rq) — pyproject.toml, worker.py, and docker-compose already
# use RQ; migrating to Celery would be a larger Phase 4 change with no Phase 1 benefit.
from redis import Redis
from rq import Queue

from app.api.deps import get_settings

DEFAULT_QUEUE_NAME = "sentiora.default"


def create_redis_connection() -> Redis:
    settings = get_settings()
    return Redis.from_url(
        settings.redis_url,
        socket_connect_timeout=1,
    )


def create_queues(connection: Redis | None = None) -> list[Queue]:
    redis_connection = connection or create_redis_connection()
    return [Queue(DEFAULT_QUEUE_NAME, connection=redis_connection)]
