#!/usr/bin/env bash
# Ship the app to the live site: pull from GitHub, save any local edits, build the images here,
# send them to the church box, and restart the app there. The source code never leaves this server.
#   scripts/ship.sh "what you changed"     (message is optional)
set -euo pipefail
cd "$(dirname "$0")/.."
HOST=impactchurch@church-signage
CC='/usr/local/bin/cc docker compose -f /srv/appdata/crew-call/compose.yaml'
SHIPPED=/srv/stacks/infra/church/state/last-shipped-commit
say() { printf '%s  %s\n' "$(date '+%T')" "$*"; }

say "Getting the latest code from GitHub"
git pull --ff-only || { say "STOPPED: this server and GitHub both have different changes. Sort out with git, then re-run."; exit 1; }
./save.sh "${1:-}"

# Changes the church box needs by hand
prev=$(cat "$SHIPPED" 2>/dev/null || git rev-parse HEAD~1)
changed=$(git diff --name-only "$prev" HEAD -- docker-compose.yml compose.override.yaml .env.example || true)
if [ -n "$changed" ]; then
  echo; echo "These changed since the last ship:"; echo "$changed" | sed 's/^/  - /'
  echo "If there are new services, settings, or .env variables, add them to the church box's"
  echo "compose.yaml / .env too (and to the home .env). See: git diff $prev HEAD -- $changed"
  read -rp "Continue shipping? [y/N] " ok; [ "$ok" = y ] || { say "Stopped. Nothing was shipped."; exit 1; }
fi

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
git rev-parse HEAD > "$SHIPPED"
say "Shipped $(git log -1 --format='%h %s'). Live at https://sched-mas.us"
