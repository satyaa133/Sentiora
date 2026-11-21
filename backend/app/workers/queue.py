# Option A (RQ): Implementation Plan §4.4 originally referenced Celery, but Phase 0
# scaffolded Redis Queue (rq) — pyproject.toml, worker.py, and docker-compose already
# use RQ; migrating to Celery would be a larger Phase 4 change with no Phase 1 benefit.
from redis import Redis
from rq import Queue

from app.api.deps import get_settings

# Saves being processed (normalise, chunk, embed) and their embedding retries.
CAPTURE_QUEUE_NAME = "sentiora.capture"
# AI enrichment of saves that matter (summary, key points, questions); slower
# and rate-limited by the AI provider, so it never holds up captures.
ENRICH_QUEUE_NAME = "sentiora.enrich"
# Queue used before S5; workers still drain it so no queued capture is lost.
LEGACY_QUEUE_NAME = "sentiora.default"

QUEUE_NAMES = {
    "capture": CAPTURE_QUEUE_NAME,
    "enrich": ENRICH_QUEUE_NAME,
}
ALL_QUEUE_NAMES = (CAPTURE_QUEUE_NAME, ENRICH_QUEUE_NAME, LEGACY_QUEUE_NAME)


def create_redis_connection() -> Redis:
    settings = get_settings()
    return Redis.from_url(
        settings.redis_url,
        socket_connect_timeout=1,
    )


def capture_queue(connection: Redis | None = None) -> Queue:
    return Queue(CAPTURE_QUEUE_NAME, connection=connection or create_redis_connection())


def enrich_queue(connection: Redis | None = None) -> Queue:
    return Queue(ENRICH_QUEUE_NAME, connection=connection or create_redis_connection())


def create_queues(
    connection: Redis | None = None, names: tuple[str, ...] | None = None
) -> list[Queue]:
    """Queues a worker listens to, in priority order (captures first).

    ``names`` are "capture" and/or "enrich"; default both. A capture worker
    also drains the pre-S5 queue.
    """
    redis_connection = connection or create_redis_connection()
    wanted = names or ("capture", "enrich")
    queue_names = [QUEUE_NAMES[name] for name in wanted]
    if "capture" in wanted:
        queue_names.append(LEGACY_QUEUE_NAME)
    return [Queue(name, connection=redis_connection) for name in queue_names]
