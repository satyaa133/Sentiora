import os
import time
from collections.abc import Callable

import redis
from rq import SimpleWorker, Worker
from rq.timeouts import TimerDeathPenalty

from app.workers.queue import create_queues, create_redis_connection

RECONNECT_DELAY_SECONDS = 5


def _build_worker() -> Worker:
    connection = create_redis_connection()
    queues = create_queues(connection)
    # RQ's default Worker uses os.fork() and SIGALRM, which Windows does not support.
    if os.name == "nt":
        worker: Worker = SimpleWorker(queues, connection=connection)
        worker.death_penalty_class = TimerDeathPenalty  # type: ignore[assignment] # Unavoidable RQ typeshed limitation
        return worker
    return Worker(queues, connection=connection)


def _recover_stale_captures() -> None:
    from app.workers.jobs.process_capture import recover_stale_captures

    try:
        recovered = recover_stale_captures()
    except Exception as exc:  # database down: the next reconnect retries
        print(f"Could not reprocess stale captures yet: {exc}")
        return
    if recovered:
        print(f"Reprocessed {recovered} stale capture(s) left in pending/processing.")


def run_until_stopped(
    build_worker: Callable[[], Worker] = _build_worker,
    recover: Callable[[], None] = _recover_stale_captures,
    sleep: Callable[[float], None] = time.sleep,
) -> None:
    """Run the worker, reconnecting after Redis outages until a stop is requested.

    RQ's work() returns (instead of raising) when Redis times out, so without this
    loop a short Redis restart would end the worker and leave captures pending.
    """
    while True:
        recover()
        try:
            worker = build_worker()
            worker.work(with_scheduler=False)
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
    run_until_stopped()


if __name__ == "__main__":
    main()
