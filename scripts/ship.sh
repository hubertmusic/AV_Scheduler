#!/usr/bin/env bash
# Ship code changes to the live site: save to GitHub, build the images here, send them to the
# church box, and restart the app there. The source code never leaves this server.
#   scripts/ship.sh "what you changed"     (message is optional)
set -euo pipefail
cd "$(dirname "$0")/.."
HOST=impactchurch@church-signage
CC='/usr/local/bin/cc docker compose -f /srv/appdata/crew-call/compose.yaml'
say() { printf '%s  %s\n' "$(date '+%T')" "$*"; }

./save.sh "${1:-}"

say "Building images"
docker compose build api web

say "Sending images to the church box"
docker save crew-call-api:latest crew-call-web:latest | gzip | ssh "$HOST" '/usr/local/bin/cc docker load' >/dev/null

say "Restarting the app at church"
ssh "$HOST" "$CC up -d --force-recreate api web"
ssh "$HOST" '/usr/local/bin/cc docker image prune -f' >/dev/null

say "Checking that it's healthy"
ok=
for i in $(seq 1 30); do
  ssh "$HOST" 'curl -fsS -m 3 -o /dev/null http://127.0.0.1:8780/api/health' 2>/dev/null && { ok=1; break; }
  sleep 2
done
[ -n "$ok" ] || { say "WARNING: the church app isn't healthy. See: ssh $HOST \"$CC logs api --tail 50\""; exit 1; }

if [ -f /srv/stacks/infra/church/state/failover-active ]; then
  say "The site is running from home right now, so updating the home copy too"
  docker compose up -d --no-build api web
fi
say "Shipped. Live at https://sched-mas.us"
