# Load test (REBUILD_PLAN S9, D17)

500 signed-in users against the production stack, measured against the plan's
targets: instant answer p95 < 1 s, zero 5xx, the database pool never exhausted,
queues drain, memory stable.

## What runs

`docker-compose.prod.yml` plus `docker-compose.load.yml`, as Compose project
`sentiora-load`: the production images, nginx, API and workers, with its own
Postgres and Redis volumes. Differences from production:

- `APP_ENVIRONMENT=loadtest`, `LLM_PROVIDER=fake`: Explain with AI streams a fixed
  answer after ~2 s; no AI provider is called, whatever keys exist.
- Per-IP rate limits raised: every k6 user comes from the k6 container's address.
  Per-user limits (Ask 10/min, search 30/min) are as in production.
- `seed` and `k6` services behind the `load` profile.

k6 runs from the official `grafana/k6` image; nothing is installed on the machine.

## Users and their traffic (`sentiora.js`)

| Group | Share | What each user does |
|---|---|---|
| browse | 85% | Opens the dashboard (5 requests) about once a minute, reloads the feed when the tab is focused again, opens a save now and then. The web app polls the feed only while a save is processing; the seeded saves are all ready. |
| ask | 10% | Asks an instant question, reads for 8–15 s, asks another (under the 10/min per-user limit) |
| explain | 5% | Asks, then clicks Explain with AI (fake provider), waits 8–15 s |

Ramp `RAMP` (2m) to all users, hold `HOLD` (10m), ramp down. Thresholds:
`instant_answer_ms` p95 < 1000, `server_errors` = 0, feed p95 < 500 ms.

## Run it

From the repo root, Git Bash:

```bash
cp scripts/load/.env.load.example scripts/load/.env.load   # then set throwaway secrets
L="docker compose -f docker-compose.prod.yml -f scripts/load/docker-compose.load.yml --env-file scripts/load/.env.load"

$L build migrate web                      # first time, and after code changes (migrate builds the backend image)
$L up -d                                  # postgres, redis, migrate, API, workers, web
$L --profile load run --rm seed           # 500 users × the 12-save eval library (re-run safe)

bash scripts/load/monitor.sh &            # connections, queues, memory every 10 s
$L --profile load run --rm k6             # the test; summary in scripts/load/results/

$L down                                   # stop; add -v to delete the load database
```

A quick check before a full run: `LOAD_USERS=20 RAMP=20s HOLD=1m $L --profile load run --rm k6`
(seed at least that many users first).

Stop the development servers (`npm start`) during a full run: they compete for
the same CPU and memory.

## Tuning

Change in `.env.load`, then `$L up -d` (no rebuild needed):
`API_WORKERS`, `WORKER_COUNT`, `DB_POOL_SIZE`, `DB_MAX_OVERFLOW`, `LLM_MAX_CONCURRENT`.

Connections in use can reach `API_WORKERS × (DB_POOL_SIZE + DB_MAX_OVERFLOW)`
plus the workers'; keep that under Postgres `max_connections` (100).

## Results

Raw output (`results/`) is git-ignored. Record each run's numbers, the machine
and the settings in `docs/TASKS.md` (S9 row).
