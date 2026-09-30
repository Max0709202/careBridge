#!/usr/bin/env bash
# Serves CareBridge to other machines at http://<PUBLIC_HOST>:<port>, without
# Docker: the API natively against the local Postgres, and the three React web
# apps as Vite preview servers that proxy /api to it.
#
#   scripts/serve-public.sh start    # build nothing; start (or restart) everything
#   scripts/serve-public.sh stop
#   scripts/serve-public.sh status
#
# Ports: 8080 family, 8081 ops console, 8082 driver. The API listens on 3200
# (3000, 3001 and 3100 are taken on this machine). Build first with `pnpm --filter … build`.
#
# A demo arrangement, not production: plain HTTP (so driver location sharing,
# which needs HTTPS, will not work from another machine), no nginx security
# headers, and Redis-less in-process scheduling.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STATE="${XDG_CACHE_HOME:-$HOME/.cache}/carebridge-public"
PUBLIC_HOST="${PUBLIC_HOST:-$(hostname -I | awk '{print $1}')}"
API_PORT="${API_PORT_OVERRIDE:-3200}"
mkdir -p "$STATE"

launch() { # name, dir, command...
  local name=$1 dir=$2; shift 2
  # The process records its own pid after setsid, so it is the group leader
  # that `stop` signals, not the short-lived setsid wrapper.
  (cd "$dir" && setsid nohup bash -c 'echo $$ >"$0"; exec "$@"' "$STATE/$name.pid" "$@" \
    >"$STATE/$name.log" 2>&1 &)
}

stop() {
  for pidfile in "$STATE"/*.pid; do
    [ -e "$pidfile" ] || continue
    pid=$(cat "$pidfile")
    # setsid made each one a process-group leader: stop the whole group.
    kill -- "-$pid" 2>/dev/null || kill "$pid" 2>/dev/null || true
    rm -f "$pidfile"
  done
}

status() {
  for name in api family ops driver; do
    pidfile="$STATE/$name.pid"
    if [ -e "$pidfile" ] && kill -0 "$(cat "$pidfile")" 2>/dev/null; then echo "$name: running"; else echo "$name: stopped"; fi
  done
  echo "family  http://$PUBLIC_HOST:8080"
  echo "ops     http://$PUBLIC_HOST:8081"
  echo "driver  http://$PUBLIC_HOST:8082"
  echo "logs    $STATE"
}

start() {
  stop
  # .env is read by Node rather than sourced (it is not valid shell), and a
  # variable set here wins over the file. An empty REDIS_URL selects the
  # in-process scheduler, since no Redis runs on this machine.
  launch api "$ROOT/apps/api" env PORT="$API_PORT" REDIS_URL= PUBLIC_APP_URL="http://$PUBLIC_HOST:8080" \
    node --env-file="$ROOT/.env" dist/src/main.js

  local vite="$ROOT/apps/ops_web/node_modules/.bin/vite"
  for spec in family:family_web:8080 ops:ops_web:8081 driver:driver_web:8082; do
    IFS=: read -r name app port <<<"$spec"
    launch "$name" "$ROOT/apps/$app" env CAREBRIDGE_API_PROXY="http://127.0.0.1:$API_PORT" \
      "$vite" preview --host 0.0.0.0 --port "$port" --strictPort
  done
  sleep 4
  status
}

case "${1:-start}" in
  start) start ;;
  stop) stop; echo stopped ;;
  status) status ;;
  *) echo "usage: $0 start|stop|status" >&2; exit 2 ;;
esac
