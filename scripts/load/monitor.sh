#!/usr/bin/env bash
# Samples the load stack every INTERVAL seconds while k6 runs (REBUILD_PLAN S9):
#   - Postgres connections by state, against max_connections
#   - capture and enrichment queue lengths in Redis
#   - memory and CPU of every container
# Writes scripts/load/results/monitor-<time>.csv and stops on Ctrl+C or after
# DURATION seconds. Run from the repo root in a second terminal:
#   bash scripts/load/monitor.sh            # default: every 10 s for 20 min
set -euo pipefail

INTERVAL="${INTERVAL:-10}"
DURATION="${DURATION:-1200}"
PROJECT=sentiora-load
ENV_FILE=scripts/load/.env.load
OUT_DIR=scripts/load/results
mkdir -p "$OUT_DIR"
OUT="$OUT_DIR/monitor-$(date +%Y%m%d-%H%M%S).csv"

# shellcheck disable=SC1090
set -a; source "$ENV_FILE"; set +a
PG_USER="${POSTGRES_USER:-sentiora}"
PG_DB="${POSTGRES_DB:-sentiora}"

pg() { docker compose -p "$PROJECT" exec -T postgres psql -U "$PG_USER" -d "$PG_DB" -Atc "$1"; }
rc() { docker compose -p "$PROJECT" exec -T -e REDISCLI_AUTH="$REDIS_PASSWORD" redis redis-cli "$@"; }

echo "time,pg_active,pg_idle,pg_idle_in_tx,pg_total,pg_max,queue_capture,queue_enrich,container,mem_usage,mem_pct,cpu_pct" > "$OUT"
end=$(( $(date +%s) + DURATION ))
echo "Writing $OUT (every ${INTERVAL}s; Ctrl+C to stop)"
while [ "$(date +%s)" -lt "$end" ]; do
  now=$(date +%H:%M:%S)
  conns=$(pg "select count(*) filter (where state='active'), count(*) filter (where state='idle'), count(*) filter (where state like 'idle in transaction%'), count(*) from pg_stat_activity where datname='$PG_DB'" | tr '|' ',')
  max=$(pg "show max_connections")
  capture=$(rc LLEN rq:queue:sentiora.capture | tr -d '\r')
  enrich=$(rc LLEN rq:queue:sentiora.enrich | tr -d '\r')
  docker stats --no-stream --format '{{.Name}},{{.MemUsage}},{{.MemPerc}},{{.CPUPerc}}' \
    | grep "^$PROJECT" \
    | while IFS= read -r line; do echo "$now,$conns,$max,$capture,$enrich,$line" >> "$OUT"; done
  echo "$now  pg(active,idle,idle-tx,total)=$conns/$max  queues capture=$capture enrich=$enrich"
  sleep "$INTERVAL"
done
