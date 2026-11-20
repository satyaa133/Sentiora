import contextlib
import logging
import os
import threading
import time
from collections.abc import Callable

import redis
from rq import Queue, SimpleWorker, Worker
from rq.job import Job
from rq.scheduler import RQScheduler
from rq.timeouts import TimerDeathPenalty

from app.core.logging import configure_logging, request_id_var
from app.workers.queue import create_queues, create_redis_connection

logger = logging.getLogger(__name__)

RECONNECT_DELAY_SECONDS = 5
# How often due scheduled jobs (such as embedding retries) are queued.
SCHEDULE_CHECK_SECONDS = 5


class _JobContextMixin:
    """Tag every log line written during a job with ``job_<id>``."""

    def perform_job(self, job: Job, queue: Queue) -> bool:
        token = request_id_var.set(f"job_{job.id}")
        try:
            return bool(super().perform_job(job, queue))  # type: ignore[misc]
        finally:
            request_id_var.reset(token)


class SentioraWorker(_JobContextMixin, Worker):
    pass


class SentioraSimpleWorker(_JobContextMixin, SimpleWorker):
    pass


def _build_worker() -> Worker:
    connection = create_redis_connection()
    queues = create_queues(connection)
    # RQ's default Worker uses os.fork() and SIGALRM, which Windows does not support.
    if os.name == "nt":
        worker: Worker = SentioraSimpleWorker(queues, connection=connection)
        worker.death_penalty_class = TimerDeathPenalty  # type: ignore[assignment] # Unavoidable RQ typeshed limitation
        return worker
    return SentioraWorker(queues, connection=connection)


def _recover_stale_captures() -> None:
    from app.workers.jobs.process_capture import recover_stale_captures

    try:
        recovered = recover_stale_captures()
    except Exception as exc:  # database down: the next reconnect retries
        print(f"Could not reprocess stale captures yet: {exc}")
        return
    if recovered:
        print(f"Reprocessed {recovered} stale capture(s) left in pending/processing.")


def _move_due_jobs(worker: Worker, stop: threading.Event) -> None:
    """Queue scheduled jobs (``enqueue_in``) once they are due.

    RQ's own scheduler runs in a separate process, which doesn't work on
    Windows, so its job-moving logic runs here in a thread instead. RQ's Redis
    lock still makes sure only one worker moves jobs at a time.
    """
    scheduler = RQScheduler(
        worker.queues, connection=worker.connection, interval=SCHEDULE_CHECK_SECONDS
    )
    while not stop.is_set():
        try:
            if not scheduler.acquired_locks or scheduler.should_reacquire_locks:
                scheduler.acquire_locks()
            if scheduler.acquired_locks:
                scheduler.enqueue_scheduled_jobs()
                scheduler.heartbeat()
        except redis.exceptions.RedisError as exc:
            logger.warning("Could not queue scheduled jobs yet: %s", exc)
        stop.wait(SCHEDULE_CHECK_SECONDS)
    with contextlib.suppress(redis.exceptions.RedisError):
        scheduler.release_locks()


def _start_scheduled_job_mover(worker: Worker) -> Callable[[], None]:
    """Start moving due scheduled jobs in a thread; returns a function that stops it."""
    stop = threading.Event()
    thread = threading.Thread(
        target=_move_due_jobs, args=(worker, stop), name="scheduled-jobs", daemon=True
    )
    thread.start()

    def stop_mover() -> None:
        stop.set()
        thread.join(timeout=SCHEDULE_CHECK_SECONDS + 1)

    return stop_mover


def run_until_stopped(
    build_worker: Callable[[], Worker] = _build_worker,
    recover: Callable[[], None] = _recover_stale_captures,
    sleep: Callable[[float], None] = time.sleep,
    start_scheduler: Callable[[Worker], Callable[[], None]] = _start_scheduled_job_mover,
) -> None:
    """Run the worker, reconnecting after Redis outages until a stop is requested.

    RQ's work() returns (instead of raising) when Redis times out, so without this
    loop a short Redis restart would end the worker and leave captures pending.
    """
    while True:
        recover()
        try:
            worker = build_worker()
            stop_scheduler = start_scheduler(worker)
            try:
                worker.work(with_scheduler=False)
            finally:
                stop_scheduler()
        except (redis.exceptions.ConnectionError, redis.exceptions.TimeoutError) as exc:
            print(f"Redis unavailable ({exc}); retrying in {RECONNECT_DELAY_SECONDS}s.")
            sleep(RECONNECT_DELAY_SECONDS)
            continue
        if worker._shutdown_requested_date is not None:
            return
        print(
            f"Worker lost its Redis connection; reconnecting in {RECONNECT_DELAY_SECONDS}s."
        )
        sleep(RECONNECT_DELAY_SECONDS)


def main() -> None:
    configure_logging()
    run_until_stopped()


if __name__ == "__main__":
    main()
