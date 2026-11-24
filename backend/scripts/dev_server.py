"""Development API server that restarts on code changes, Windows included.

``uvicorn --reload`` restarts its server on Windows by sending Ctrl+C to the
whole console process group. Under ``npm run dev:backend`` that also reaches
cmd and npm, which ask "Terminate batch job (Y/N)?" and stop everything; in a
terminal without a console (Git Bash, IDE runners) the signal reaches nothing
and the old server keeps running with stale code.

This script watches ``backend/app`` with watchfiles and runs uvicorn (without
its reloader) in a child process. On a change it stops only that child
(``os.kill(pid, SIGINT)``, which Windows turns into TerminateProcess for that
one process) and starts a new one.

Usage (from the repo root): ``npm run dev:backend``, or
``node scripts/run-python.mjs -m scripts.dev_server --port 8001``.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from watchfiles import PythonFilter, run_process

BACKEND_DIR = Path(__file__).resolve().parents[1]


def serve(host: str, port: int) -> None:
    """Child process: one uvicorn server, no reloader of its own."""
    import uvicorn

    uvicorn.run("app.main:app", host=host, port=port)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8000)
    args = parser.parse_args(argv)
    print(f"[dev] serving on http://{args.host}:{args.port}; restarting on changes in app/", flush=True)
    run_process(
        BACKEND_DIR / "app",
        target=serve,
        args=(args.host, args.port),
        target_type="function",
        watch_filter=PythonFilter(),
        sigint_timeout=5,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
