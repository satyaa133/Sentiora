import os

from rq import SimpleWorker, Worker
from rq.connections import Connection
from rq.timeouts import TimerDeathPenalty

from app.workers.queue import create_queues, create_redis_connection


def main() -> None:
    from app.workers.jobs.process_capture import recover_stale_captures

    recovered = recover_stale_captures()
    if recovered:
        print(f"Reprocessed {recovered} stale capture(s) left in pending/processing.")

    connection = create_redis_connection()
    queues = create_queues(connection)
    with Connection(connection):
        # RQ's default Worker uses os.fork() and SIGALRM, which Windows does not support.
        if os.name == "nt":
            worker = SimpleWorker(queues)
            worker.death_penalty_class = TimerDeathPenalty
        else:
            worker = Worker(queues)
        worker.work(with_scheduler=False)


if __name__ == "__main__":
    main()
