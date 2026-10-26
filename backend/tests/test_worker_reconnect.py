from datetime import UTC, datetime
from unittest.mock import MagicMock

import redis

from app.workers.worker import run_until_stopped


def _worker(*, stop_requested: bool, work_error: Exception | None = None) -> MagicMock:
    worker = MagicMock()
    worker._shutdown_requested_date = datetime.now(UTC) if stop_requested else None
    if work_error is not None:
        worker.work.side_effect = work_error
    return worker


def test_worker_reconnects_after_redis_timeout_instead_of_exiting():
    # RQ's work() returns normally after "Redis connection timeout, quitting...".
    lost = _worker(stop_requested=False)
    stopped = _worker(stop_requested=True)
    workers = iter([lost, stopped])
    recover = MagicMock()
    sleeps: list[float] = []

    run_until_stopped(
        build_worker=lambda: next(workers), recover=recover, sleep=sleeps.append
    )

    assert lost.work.call_count == 1
    assert stopped.work.call_count == 1
    assert len(sleeps) == 1
    # Stale captures are re-enqueued on every (re)connect.
    assert recover.call_count == 2


def test_worker_retries_while_redis_is_down():
    down = _worker(
        stop_requested=False, work_error=redis.exceptions.ConnectionError("refused")
    )
    stopped = _worker(stop_requested=True)
    attempts = iter([down, down, stopped])
    sleeps: list[float] = []

    run_until_stopped(
        build_worker=lambda: next(attempts), recover=lambda: None, sleep=sleeps.append
    )

    assert len(sleeps) == 2
    assert stopped.work.call_count == 1


def test_worker_exits_on_requested_shutdown():
    stopped = _worker(stop_requested=True)
    sleeps: list[float] = []

    run_until_stopped(
        build_worker=lambda: stopped, recover=lambda: None, sleep=sleeps.append
    )

    assert sleeps == []
