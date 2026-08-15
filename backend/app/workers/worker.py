import os

from rq import SimpleWorker, Worker
from rq.connections import Connection
from rq.timeouts import TimerDeathPenalty

from app.workers.queue import create_queues, create_redis_connection


def main() -> None:
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
